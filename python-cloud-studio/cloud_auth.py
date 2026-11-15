"""Durable Supabase administrator login gate for Al Ezz Studio.

The site's HttpOnly Secure cookie holds only an encrypted Supabase refresh
token. The server's existing ALEZZ_SITE_SECRET encrypts it with Fernet.
A restarted Render worker restores the admin session through Supabase Auth
without storing a password or exposing access tokens to JavaScript.
The frozen November 3 media extraction engine is deliberately untouched.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import html
import json
import os
import secrets
import threading
import time
from collections import defaultdict
from urllib.parse import parse_qs

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

PUBLIC_MODE = os.getenv("ALEZZ_PUBLIC_MODE", "0") == "1"
SECRET = os.getenv("ALEZZ_SITE_SECRET", "")
COOKIE = "alezz_site_auth"
VALID_FOR = 30 * 24 * 3600
DEFAULT_DB_URL = "https://qyzmlwtvzzgooccqxglq.supabase.co"
DEFAULT_PUBLIC_KEY = "sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES"

if PUBLIC_MODE and len(SECRET) < 32:
    raise RuntimeError("Public hosting requires ALEZZ_SITE_SECRET (32+ chars).")

ENABLED = PUBLIC_MODE
FAILED: dict[str, list[float]] = defaultdict(list)
_SESSIONS: dict[str, object] = {}
_SESSION_LOCK = threading.RLock()
_RESTORE_LOCK = asyncio.Lock()
_MAX_SESSIONS = 80
_MISSING = object()


def _cipher() -> Fernet:
    material = hashlib.sha256(("al-ezz-studio-remembered-admin-v2:" + SECRET).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(material))


def _token(refresh_token: str) -> str:
    if not refresh_token:
        raise ValueError("Missing administrator refresh token")
    # Fernet provides authenticated encryption, a timestamp, and an explicit
    # maximum age when decoded; it never embeds plaintext account secrets.
    return _cipher().encrypt(json.dumps(
        {"version":2, "refresh_token": refresh_token},
        separators=(",", ":")).encode()).decode()


def _decode(value: str | None) -> str:
    if not value or len(value) > 3200 or len(SECRET) < 32:
        return ""
    try:
        data = json.loads(_cipher().decrypt(value.encode(), ttl=VALID_FOR))
        if data.get("version") != 2:
            return ""
        refresh_token = data.get("refresh_token", "")
        if not isinstance(refresh_token, str) or not 10 <= len(refresh_token) <= 2000:
            return ""
        return refresh_token
    except (InvalidToken, ValueError, TypeError, UnicodeError, json.JSONDecodeError):
        return ""


def _valid(value: str | None) -> bool:
    return bool(_decode(value))


def _prune() -> None:
    for token in list(_SESSIONS):
        if not _valid(token):
            _SESSIONS.pop(token, None)
    if len(_SESSIONS) > _MAX_SESSIONS:
        for token in list(_SESSIONS)[:len(_SESSIONS) - _MAX_SESSIONS]:
            _SESSIONS.pop(token, None)


def get_site_admin(request: Request):
    """Read the request's verified admin client; never accept a bare cookie."""
    if not ENABLED:
        return None
    on_request = getattr(request.state, "site_admin", _MISSING)
    if on_request is not _MISSING:
        return on_request
    token = request.cookies.get(COOKIE, "")
    if not _valid(token):
        return None
    with _SESSION_LOCK:
        return _SESSIONS.get(token)


def invalidate_site_admin(request: Request) -> None:
    token = request.cookies.get(COOKIE, "")
    request.state.site_admin = None
    with _SESSION_LOCK:
        _SESSIONS.pop(token, None)


def _verify_admin(email: str, password: str):
    # The existing Supabase client verifies Auth AND an active aseel_admins row.
    from alezz_fetchv_importer import Supabase
    return Supabase(
        os.getenv("ALEZZ_SUPABASE_URL", DEFAULT_DB_URL),
        os.getenv("ALEZZ_SUPABASE_PUBLISHABLE_KEY", DEFAULT_PUBLIC_KEY),
        email=email, password=password,
    )


def _restore_admin(refresh_token: str):
    # Refresh tokens are one-time-use / rotated by Supabase. Never log them.
    import requests
    from alezz_fetchv_importer import Supabase
    root = os.getenv("ALEZZ_SUPABASE_URL", DEFAULT_DB_URL).rstrip("/")
    key = os.getenv("ALEZZ_SUPABASE_PUBLISHABLE_KEY", DEFAULT_PUBLIC_KEY)
    session = requests.Session()
    session.trust_env = False
    response = session.post(
        root + "/auth/v1/token?grant_type=refresh_token",
        headers={"apikey":key, "Content-Type":"application/json"},
        json={"refresh_token": refresh_token}, timeout=18,
        allow_redirects=False,
    )
    if not response.ok:
        raise ValueError("Supabase administrator refresh failed")
    payload = response.json()
    access_token = payload.get("access_token", "")
    new_refresh = payload.get("refresh_token", "")
    if not access_token or not new_refresh:
        raise ValueError("Missing refreshed administrator credentials")
    # A restored session is checked against the active administrator row
    # again, not merely against a previously issued browser cookie.
    admin = Supabase(root, key, access_token=access_token)
    admin.refresh_token = new_refresh
    admin.expires_at = time.time() + float(payload.get("expires_in", 3600))
    return admin


async def _ensure_admin(request: Request):
    if not ENABLED:
        return None
    token = request.cookies.get(COOKIE, "")
    cached = get_site_admin(request)
    if cached is not None:
        request.state.site_admin = cached
        return cached
    old_refresh = _decode(token)
    if not old_refresh:
        request.state.site_admin = None
        return None
    # Prevent concurrent requests after a deploy from consuming the same
    # rotated refresh token multiple times.
    async with _RESTORE_LOCK:
        cached = get_site_admin(request)
        if cached is not None:
            request.state.site_admin = cached
            return cached
        try:
            admin = await run_in_threadpool(_restore_admin, old_refresh)
        except Exception:
            request.state.site_admin = None
            return None
        request.state.site_admin = admin
        with _SESSION_LOCK:
            _SESSIONS[token] = admin
            _prune()
        return admin


def _session_cookie(response, admin, request: Request) -> None:
    previous = request.cookies.get(COOKIE, "")
    current_refresh = getattr(admin, "refresh_token", "")
    old_refresh = _decode(previous)
    if not current_refresh:
        return
    # Rotate the secure cookie when GoTrue refreshes its token, or on first
    # login. Reissuing also supports regular active sessions indefinitely.
    if not old_refresh or old_refresh != current_refresh:
        sealed = _token(current_refresh)
        with _SESSION_LOCK:
            _SESSIONS[sealed] = admin
            _prune()
        response.set_cookie(
            COOKIE, sealed, max_age=VALID_FOR, path="/", httponly=True,
            samesite="lax", secure=PUBLIC_MODE or request.url.scheme == "https",
        )
        response.headers["Cache-Control"] = "no-store"


def _logout_remote(admin):
    # Best-effort revocation of this Supabase session so logging out also
    # invalidates the encrypted refresh token on a later server restart.
    session = getattr(admin, "session", None)
    root = getattr(admin, "root", "")
    if session is not None and root and getattr(admin, "refresh_token", ""):
        try:
            session.post(root.rstrip("/") + "/auth/v1/logout?scope=local",
                         timeout=8, allow_redirects=False)
        except Exception:
            pass


async def revoke_site_admin(request: Request):
    admin = get_site_admin(request)
    if admin is not None:
        await run_in_threadpool(_logout_remote, admin)
    invalidate_site_admin(request)


def _login_page(message: str = "", status: int = 200) -> HTMLResponse:
    note = '<p class="error" role="alert">' + html.escape(message) + '</p>' if message else ""
    page = '''<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="dark">
<title>الدخول إلى استوديو العز TV</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 80% 0,#402d23 0,transparent 55%),#070a11;color:#f6f4ee;font-family:system-ui,Tahoma,sans-serif;padding:18px}
main{width:min(100%,450px);padding:34px;background:#141922;border:1px solid #343942;border-radius:22px;box-shadow:0 18px 70px #0009}
.brand{display:flex;align-items:center;gap:14px;margin-bottom:15px;color:#e8bf78;font-size:24px;font-weight:900}.mark{display:grid;place-items:center;border-radius:15px;background:#40321f;width:60px;height:60px}
h1{font-size:24px;margin:8px 0}.sub{color:#b8bbc6;line-height:1.8;font-size:14px;margin-bottom:26px}
label{display:block;font-size:14px;margin:14px 0 9px}input{display:block;width:100%;height:52px;border-radius:12px;border:1px solid #4c5362;background:#090e17;color:white;font:inherit;padding:10px 14px}input:focus{outline:2px solid #e8bf78}
button{border:0;background:#e8bf78;color:#24190d;border-radius:12px;width:100%;padding:14px;font:inherit;font-weight:900;margin-top:22px;cursor:pointer}.error{background:#4d222b;color:#ffd5d5;padding:12px;border-radius:11px}.footer{color:#9299aa;font-size:12px;margin-top:17px}
</style></head><body><main><div class="brand"><span class="mark">▶</span> العز TV</div>
<h1>الدخول إلى استوديو الاستيراد</h1>
<p class="sub">سجّل الدخول ببريدك الإلكتروني وكلمة مرور حساب المسؤول في العز TV. يتم تذكر جهازك لمدة 30 يومًا قابلة للتجديد من خلال جلسة Supabase آمنة، حتى بعد تحديث الخادم.</p>''' + note + '''
<form action="/login" method="POST" autocomplete="on">
<label for="email">البريد الإلكتروني</label>
<input id="email" name="email" type="email" dir="ltr" autocomplete="username" inputmode="email" placeholder="name@example.com" maxlength="200" required autofocus>
<label for="password">كلمة المرور</label>
<input id="password" name="password" type="password" dir="ltr" autocomplete="current-password" maxlength="250" required>
<button type="submit">دخول الاستوديو</button></form>
<p class="footer">اتصال مشفر HTTPS · جهازك يبقى مسجلًا ما دامت جلسة Supabase صالحة</p></main></body></html>'''
    return HTMLResponse(page, status_code=status, headers={
        "Cache-Control": "no-store", "X-Frame-Options":"DENY",
        "Referrer-Policy":"no-referrer", "X-Content-Type-Options":"nosniff",
        "Content-Security-Policy": ("default-src 'none'; style-src 'unsafe-inline'; "
                                    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'"),
    })


async def site_auth_middleware(request: Request, call_next):
    if not ENABLED or request.url.path in ("/login", "/healthz"):
        return await call_next(request)
    admin = await _ensure_admin(request)
    if admin is None:
        if request.url.path.startswith("/api/"):
            return JSONResponse(
                {"detail":"انتهت جلسة المسؤول؛ سجّل الدخول بالبريد وكلمة المرور"},
                status_code=401, headers={"Cache-Control":"no-store"})
        return RedirectResponse("/login", status_code=303)
    response = await call_next(request)
    _session_cookie(response, admin, request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


async def site_login(request: Request):
    if not ENABLED:
        return RedirectResponse("/", status_code=303)
    if request.method == "GET":
        admin = await _ensure_admin(request)
        if admin is not None:
            response = RedirectResponse("/", status_code=303)
            _session_cookie(response, admin, request)
            return response
        return _login_page()
    if "application/x-www-form-urlencoded" not in request.headers.get("content-type",""):
        return _login_page("نوع الطلب غير صحيح", 400)
    raw = await request.body()
    if len(raw) > 2048:
        return _login_page("حجم البيانات كبير جدًا", 413)
    try:
        form = parse_qs(raw.decode("utf-8", errors="replace"))
        email = form.get("email", [""])[0].strip().lower()
        password = form.get("password", [""])[0]
    except (ValueError, UnicodeError):
        email, password = "", ""
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _SESSION_LOCK:
        FAILED[key] = [t for t in FAILED[key] if now-t < 300]
        if len(FAILED[key]) >= 8:
            return _login_page("محاولات كثيرة. حاول مجددًا بعد خمس دقائق.",429)
    if not email or "@" not in email or len(email)>200 or not password or len(password)>250:
        return _login_page("أدخل البريد الإلكتروني وكلمة المرور",400)
    try:
        admin = await run_in_threadpool(_verify_admin, email, password)
    except Exception:
        with _SESSION_LOCK:
            FAILED[key].append(time.monotonic())
        return _login_page("البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الحساب لا يملك صلاحية مسؤول.",401)
    if not getattr(admin, "refresh_token", ""):
        return _login_page("لم يرجع خادم Supabase جلسة قابلة للتجديد. أعد المحاولة.",503)
    with _SESSION_LOCK:
        FAILED.pop(key, None)
    request.state.site_admin = admin
    response = RedirectResponse("/", status_code=303)
    _session_cookie(response,admin,request)
    return response


async def site_logout(request: Request):
    await revoke_site_admin(request)
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(COOKIE,path="/")
    response.headers["Cache-Control"] = "no-store"
    return response


async def site_health():
    return JSONResponse({"ok":True,"service":"al-ezz-tv-python-studio"})
