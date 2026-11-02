'''Server-side gate for the cloud-hosted Python studio.

No credentials are baked into source files, cookies or the HTML response.
Use with TLS and a single instance behind the hosting provider's proxy.
'''
from __future__ import annotations
import hashlib
import hmac
import html
import os
import secrets
import time
from collections import defaultdict
from urllib.parse import parse_qs

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

PUBLIC_MODE = os.getenv('ALEZZ_PUBLIC_MODE', '0') == '1'
PASSWORD = os.getenv('ALEZZ_SITE_PASSWORD', '')
SECRET = os.getenv('ALEZZ_SITE_SECRET', '')
COOKIE = 'alezz_site_auth'
VALID_FOR = 12 * 3600

if PUBLIC_MODE and (len(PASSWORD) < 12 or len(SECRET) < 32):
    raise RuntimeError('Public hosting requires ALEZZ_SITE_PASSWORD (12+ chars) and ALEZZ_SITE_SECRET (32+ chars).')

# Protect local site too when an owner sets a site password explicitly.
ENABLED = PUBLIC_MODE or bool(PASSWORD)
FAILED: dict[str, list[float]] = defaultdict(list)


def _token(when: int | None = None) -> str:
    epoch = int(time.time()) if when is None else when
    nonce = secrets.token_urlsafe(14)
    data = f'{epoch}.{nonce}'
    signature = hmac.new(SECRET.encode(), data.encode(), hashlib.sha256).hexdigest()
    return f'{data}.{signature}'


def _valid(value: str | None) -> bool:
    if not value or not SECRET: return False
    parts = value.split('.')
    if len(parts) != 3: return False
    ts, nonce, sig = parts
    if not ts.isdigit() or len(nonce) > 128: return False
    now = int(time.time())
    if int(ts) > now + 120 or now - int(ts) > VALID_FOR: return False
    computed = hmac.new(SECRET.encode(), f'{ts}.{nonce}'.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, sig)


def _login_page(message: str = '') -> HTMLResponse:
    note = '<p class="error">'+html.escape(message)+'</p>' if message else ''
    return HTMLResponse('''<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="dark">
<title>الدخول إلى استوديو العز TV</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 80% 0,#402d23 0,transparent 55%),#070a11;color:#f6f4ee;font-family:system-ui,Tahoma,sans-serif;padding:18px}
main{width:min(100%,450px);padding:34px;background:#141922;border:1px solid #343942;border-radius:22px;box-shadow:0 18px 70px #0009}
.brand{display:flex;align-items:center;gap:14px;margin-bottom:15px;color:#e8bf78;font-size:24px;font-weight:900}.mark{display:grid;place-items:center;border-radius:15px;background:#40321f;width:60px;height:60px}
h1{font-size:24px;margin:8px 0}.sub{color:#b8bbc6;line-height:1.8;font-size:14px;margin-bottom:26px}
label{display:block;font-size:14px;margin:14px 0 9px}input{display:block;width:100%;height:52px;border-radius:12px;border:1px solid #4c5362;background:#090e17;color:white;font:inherit;padding:10px 14px}input:focus{outline:2px solid #e8bf78}
button{border:0;background:#e8bf78;color:#24190d;border-radius:12px;width:100%;padding:14px;font:inherit;font-weight:900;margin-top:16px;cursor:pointer}.error{background:#4d222b;color:#ffd5d5;padding:12px;border-radius:11px}.footer{color:#9299aa;font-size:12px;margin-top:17px}
</style></head><body><main><div class="brand"><span class="mark">▶</span> العز TV</div>
<h1>الدخول إلى استوديو الاستيراد</h1>
<p class="sub">الوصول للمكتبة وفهرسة الأفلام والمسلسلات محمي بكلمة مرور الموقع. بعد الدخول ستحتاج إلى حساب Supabase المسؤول عند حفظ البيانات.</p>'''+note+'''<form action="/login" method="POST" autocomplete="off">
<label for="password">كلمة مرور الموقع</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus minlength="12" maxlength="512">
<button type="submit">دخول الاستوديو</button></form><p class="footer">اتصال مشفر HTTPS · موقع خاص بإدارة العز TV</p></main></body></html>''',headers={'Cache-Control':'no-store','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'})


async def site_auth_middleware(request: Request, call_next):
    if not ENABLED or request.url.path in ('/login','/healthz'):
        return await call_next(request)
    if not _valid(request.cookies.get(COOKIE)):
        if request.url.path.startswith('/api/'):
            return JSONResponse({'detail':'انتهت جلسة الموقع؛ ادخل من /login'},status_code=401,
                headers={'Cache-Control':'no-store'})
        return RedirectResponse('/login',status_code=303)
    response = await call_next(request)
    response.headers.setdefault('X-Content-Type-Options','nosniff')
    response.headers.setdefault('Referrer-Policy','same-origin')
    response.headers.setdefault('X-Frame-Options','DENY')
    return response


async def site_login(request: Request):
    if not ENABLED: return RedirectResponse('/',status_code=303)
    if request.method == 'GET':
        if _valid(request.cookies.get(COOKIE)): return RedirectResponse('/',status_code=303)
        return _login_page()
    content_type=request.headers.get('content-type','')
    if 'application/x-www-form-urlencoded' not in content_type:
        return _login_page('نوع الطلب غير صحيح')
    raw=await request.body()
    if len(raw)>2048:return _login_page('حجم البيانات كبير جدًا')
    try: submitted=parse_qs(raw.decode('utf-8',errors='replace')).get('password',[''])[0]
    except Exception:submitted=''
    # This is an application-level defense, not a substitute for provider rate limits.
    key=request.client.host if request.client else 'unknown'
    now=time.monotonic()
    FAILED[key] = [t for t in FAILED[key] if now-t<300]
    if len(FAILED[key])>=8:
        return HTMLResponse('محاولات كثيرة. أعد المحاولة بعد خمس دقائق.',status_code=429)
    if not hmac.compare_digest(submitted.encode(),PASSWORD.encode()):
        FAILED[key].append(now)
        return _login_page('كلمة مرور الموقع غير صحيحة')
    FAILED.pop(key,None)
    res=RedirectResponse('/',status_code=303)
    res.set_cookie(COOKIE,_token(),max_age=VALID_FOR,path='/',httponly=True,samesite='strict',secure=PUBLIC_MODE)
    res.headers['Cache-Control']='no-store'
    return res


async def site_logout():
    resp=RedirectResponse('/login',status_code=303)
    resp.delete_cookie(COOKIE,path='/')
    return resp


async def site_health():
    return JSONResponse({'ok':True,'service':'al-ezz-tv-python-studio'})
