'''Email/password administrator gate for the cloud-hosted Al Ezz TV studio.

Credentials are verified against Supabase Auth and the active aseel_admins table.
Neither passwords nor access tokens are written into HTML, cookies or disk.
The original media extraction engine is intentionally not involved.
'''
from __future__ import annotations

import hashlib
import hmac
import html
import os
import secrets
import threading
import time
from collections import defaultdict
from urllib.parse import parse_qs

from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

PUBLIC_MODE = os.getenv('ALEZZ_PUBLIC_MODE', '0') == '1'
SECRET = os.getenv('ALEZZ_SITE_SECRET', '')
COOKIE = 'alezz_site_auth'
VALID_FOR = 12 * 3600
DEFAULT_DB_URL = 'https://qyzmlwtvzzgooccqxglq.supabase.co'
DEFAULT_PUBLIC_KEY = 'sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES'

if PUBLIC_MODE and len(SECRET) < 32:
    raise RuntimeError('Public hosting requires ALEZZ_SITE_SECRET (32+ chars).')

# The production studio is always gated. Optional local development can disable
# the gate with ALEZZ_PUBLIC_MODE=0; the old site password is no longer used.
ENABLED = PUBLIC_MODE
FAILED: dict[str, list[float]] = defaultdict(list)
_SESSIONS: dict[str, object] = {}
_SESSION_LOCK = threading.RLock()
_MAX_SESSIONS = 80


def _token(when: int | None = None) -> str:
    epoch = int(time.time()) if when is None else when
    nonce = secrets.token_urlsafe(14)
    data = f'{epoch}.{nonce}'
    signature = hmac.new(SECRET.encode(), data.encode(), hashlib.sha256).hexdigest()
    return f'{data}.{signature}'


def _valid(value: str | None) -> bool:
    if not value or not SECRET:
        return False
    parts = value.split('.')
    if len(parts) != 3:
        return False
    ts, nonce, sig = parts
    if not ts.isdigit() or len(nonce) > 128:
        return False
    now = int(time.time())
    if int(ts) > now + 120 or now - int(ts) > VALID_FOR:
        return False
    computed = hmac.new(SECRET.encode(), f'{ts}.{nonce}'.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, sig)


def _prune() -> None:
    now = int(time.time())
    for token in list(_SESSIONS):
        if not _valid(token):
            _SESSIONS.pop(token, None)
    if len(_SESSIONS) > _MAX_SESSIONS:
        ordered = sorted(_SESSIONS, key=lambda token: int(token.split('.')[0]))
        for token in ordered[:len(_SESSIONS) - _MAX_SESSIONS]:
            _SESSIONS.pop(token, None)


def get_site_admin(request: Request):
    '''Return the server-side verified administrator client, not a client token.'''
    if not ENABLED:
        return None
    token = request.cookies.get(COOKIE, '')
    if not _valid(token):
        return None
    with _SESSION_LOCK:
        return _SESSIONS.get(token)


def invalidate_site_admin(request: Request) -> None:
    token = request.cookies.get(COOKIE, '')
    with _SESSION_LOCK:
        _SESSIONS.pop(token, None)


def _verify_admin(email: str, password: str):
    # The existing Supabase client verifies both the Auth user and the active
    # aseel_admins row. No independent password or insecure admin bypass.
    from alezz_fetchv_importer import Supabase
    return Supabase(
        os.getenv('ALEZZ_SUPABASE_URL', DEFAULT_DB_URL),
        os.getenv('ALEZZ_SUPABASE_PUBLISHABLE_KEY', DEFAULT_PUBLIC_KEY),
        email=email, password=password,
    )


def _login_page(message: str = '', status: int = 200) -> HTMLResponse:
    note = '<p class="error" role="alert">' + html.escape(message) + '</p>' if message else ''
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
<p class="sub">سجّل الدخول ببريدك الإلكتروني وكلمة مرور حساب المسؤول في العز TV. حساب واحد للدخول وإدارة المحتوى في Supabase.</p>''' + note + '''
<form action="/login" method="POST" autocomplete="on">
<label for="email">البريد الإلكتروني</label>
<input id="email" name="email" type="email" dir="ltr" autocomplete="username" inputmode="email" placeholder="name@example.com" maxlength="200" required autofocus>
<label for="password">كلمة المرور</label>
<input id="password" name="password" type="password" dir="ltr" autocomplete="current-password" maxlength="250" required>
<button type="submit">دخول الاستوديو</button></form>
<p class="footer">اتصال مشفر HTTPS · دخول مخصص للمسؤولين المعتمدين</p></main></body></html>'''
    return HTMLResponse(page, status_code=status, headers={
        'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    })


async def site_auth_middleware(request: Request, call_next):
    if not ENABLED or request.url.path in ('/login', '/healthz'):
        return await call_next(request)
    if get_site_admin(request) is None:
        if request.url.path.startswith('/api/'):
            return JSONResponse({'detail': 'انتهت جلسة المسؤول؛ سجّل الدخول بالبريد وكلمة المرور'},
                                status_code=401, headers={'Cache-Control': 'no-store'})
        return RedirectResponse('/login', status_code=303)
    response = await call_next(request)
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('Referrer-Policy', 'same-origin')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    return response


async def site_login(request: Request):
    if not ENABLED:
        return RedirectResponse('/', status_code=303)
    if request.method == 'GET':
        if get_site_admin(request) is not None:
            return RedirectResponse('/', status_code=303)
        return _login_page()
    if 'application/x-www-form-urlencoded' not in request.headers.get('content-type', ''):
        return _login_page('نوع الطلب غير صحيح', 400)
    raw = await request.body()
    if len(raw) > 2048:
        return _login_page('حجم البيانات كبير جدًا', 413)
    try:
        form = parse_qs(raw.decode('utf-8', errors='replace'))
        email = form.get('email', [''])[0].strip().lower()
        password = form.get('password', [''])[0]
    except (ValueError, UnicodeError):
        email, password = '', ''
    key = request.client.host if request.client else 'unknown'
    now = time.monotonic()
    with _SESSION_LOCK:
        FAILED[key] = [t for t in FAILED[key] if now - t < 300]
        if len(FAILED[key]) >= 8:
            return _login_page('محاولات كثيرة. حاول مجددًا بعد خمس دقائق.', 429)
    if not email or '@' not in email or len(email) > 200 or not password or len(password) > 250:
        return _login_page('أدخل البريد الإلكتروني وكلمة المرور', 400)
    try:
        admin = await run_in_threadpool(_verify_admin, email, password)
    except Exception:
        with _SESSION_LOCK:
            FAILED[key].append(time.monotonic())
        return _login_page('البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الحساب لا يملك صلاحية مسؤول.', 401)
    with _SESSION_LOCK:
        FAILED.pop(key, None)
        _prune()
        token = _token()
        _SESSIONS[token] = admin
        _prune()
    response = RedirectResponse('/', status_code=303)
    response.set_cookie(COOKIE, token, max_age=VALID_FOR, path='/',
                        httponly=True, samesite='strict', secure=PUBLIC_MODE or request.url.scheme == 'https')
    response.headers['Cache-Control'] = 'no-store'
    return response


async def site_logout(request: Request):
    invalidate_site_admin(request)
    response = RedirectResponse('/login', status_code=303)
    response.delete_cookie(COOKIE, path='/')
    response.headers['Cache-Control'] = 'no-store'
    return response


async def site_health():
    return JSONResponse({'ok': True, 'service': 'al-ezz-tv-python-studio'})
