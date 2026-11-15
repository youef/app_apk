"""Isolated customer authentication API for the public Al Ezz TV website.

The customer never receives admin credentials or a service-role key.
Only the existing studio server executes privileged lookups.
"""
import os
import re
import time
from collections import defaultdict
from threading import Lock

import requests
from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

ORIGIN = "https://youef.github.io"
DB = os.getenv("ALEZZ_SUPABASE_URL", "https://qyzmlwtvzzgooccqxglq.supabase.co").rstrip("/")
PUBLIC = os.getenv("ALEZZ_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES")
FAILURES = defaultdict(list)
LOCK = Lock()


def _result(status, data):
    return JSONResponse(data, status_code=status, headers={
        "Access-Control-Allow-Origin": ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    })


def _service():
    return os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY", "")


def _remote(method, path, *, service=False, payload=None, token=None):
    key = _service() if service else PUBLIC
    headers = {"apikey": key, "Accept": "application/json"}
    if service:
        headers["Authorization"] = "Bearer " + key
    elif token:
        headers["Authorization"] = "Bearer " + token
    if payload is not None:
        headers["Content-Type"] = "application/json"
    # Do not send credentials to arbitrary hosts; DB is server configured.
    return requests.request(method, DB + path, headers=headers, json=payload,
                            timeout=12, allow_redirects=False)


def _account(username=None, uid=None):
    from urllib.parse import quote
    if username:
        query = "username=eq." + quote(username, safe="")
    else:
        query = "user_id=eq." + quote(uid, safe="")
    response = _remote("GET", "/rest/v1/aseel_customer_accounts?select=user_id,username,is_active,expires_at&" + query + "&limit=1", service=True)
    response.raise_for_status()
    items = response.json()
    return items[0] if items else None


def _allowed(account):
    if not account or account.get("is_active") is not True:
        return False
    expires = account.get("expires_at")
    if not expires:
        return True
    try:
        from datetime import datetime, timezone
        return datetime.fromisoformat(expires.replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except (ValueError, TypeError):
        return False


def _check_login(username, password):
    account = _account(username=username)
    if not _allowed(account):
        return None
    identity = _remote("GET", "/auth/v1/admin/users/" + account["user_id"], service=True)
    if not identity.ok:
        return None
    email = identity.json().get("email")
    if not email:
        return None
    response = _remote("POST", "/auth/v1/token?grant_type=password",
                       payload={"email": email, "password": password})
    if not response.ok:
        return None
    session = response.json()
    if session.get("user", {}).get("id") != account["user_id"]:
        return None
    return {
        "ok": True,
        "username": account["username"],
        "user_id": account["user_id"],
        "access_token": session["access_token"],
        "refresh_token": session["refresh_token"],
        "expires_in": session.get("expires_in", 3600),
    }


def _check_session(token):
    response = _remote("GET", "/auth/v1/user", token=token)
    if not response.ok:
        return None
    user_id = response.json().get("id")
    if not user_id:
        return None
    account = _account(uid=user_id)
    if not _allowed(account):
        return None
    return {"ok": True, "username": account["username"], "user_id": user_id}


async def customer_auth(request: Request):
    if request.method == "OPTIONS":
        return Response(status_code=204, headers={
            "Access-Control-Allow-Origin": ORIGIN,
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin"})
    if request.headers.get("origin") not in ("", None, ORIGIN):
        return _result(403, {"error": "غير مصرح"})
    if not _service():
        return _result(503, {"error": "خدمة دخول العملاء غير مهيأة"})
    if request.headers.get("content-length") and int(request.headers["content-length"]) > 4096:
        return _result(413, {"error": "الطلب كبير جدًا"})
    try:
        if request.url.path.endswith("/session"):
            token = re.sub(r"^Bearer\s+", "", request.headers.get("authorization", ""), flags=re.I)
            if not token or len(token) > 4096:
                return _result(401, {"error": "جلسة العميل منتهية"})
            data = await run_in_threadpool(_check_session, token)
            return _result(200, data) if data else _result(401, {"error": "جلسة العميل منتهية"})
        body = await request.json()
        username = str(body.get("username", "")).strip().lower()
        password = str(body.get("password", ""))
        if not 3 <= len(username) <= 64 or re.search(r"\s", username) or not 1 <= len(password) <= 256:
            return _result(400, {"error": "أدخل اسم المستخدم وكلمة المرور"})
        key = (request.client.host if request.client else "unknown", username)
        with LOCK:
            attempts = [t for t in FAILURES[key] if time.monotonic() - t < 300]
            FAILURES[key] = attempts
            if len(attempts) >= 10:
                return _result(429, {"error": "محاولات كثيرة. حاول لاحقًا"})
        data = await run_in_threadpool(_check_login, username, password)
        if data:
            with LOCK:
                FAILURES.pop(key, None)
            return _result(200, data)
        with LOCK:
            FAILURES[key].append(time.monotonic())
        return _result(401, {"error": "اسم المستخدم أو كلمة المرور غير صحيحة"})
    except (requests.RequestException, ValueError, KeyError, TypeError):
        return _result(503, {"error": "خدمة الحسابات غير متاحة حاليًا"})
