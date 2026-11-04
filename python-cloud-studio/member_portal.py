"""Server-gated viewer and administration pages with provisioned Supabase accounts."""
from __future__ import annotations

import html
import os
import re
import secrets
import time
from pathlib import Path
from urllib.parse import parse_qs
from uuid import UUID

import requests
from fastapi import Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

COOKIE = 'alezz_member'
SESSION_SECONDS = 8 * 3600
USERNAME = re.compile(r'[a-z0-9][a-z0-9_.-]{2,39}\Z')
ALIAS_DOMAIN = 'members.alezz.invalid'
HEADERS = {'Cache-Control':'private, no-store','X-Frame-Options':'DENY',
           'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}


class Portal:
    def __init__(self, root, db_url, public_key, secure):
        self.root = Path(root).resolve()
        self.db_url = db_url.rstrip('/')
        self.public_key = public_key
        self.secure = secure
        self.sessions = {}
        self.attempts = {}

    def upstream(self, method, endpoint, *, secret=False, token='', **options):
        key = (os.getenv('ALEZZ_SUPABASE_SECRET_KEY') or os.getenv('ALEZZ_SUPABASE_SERVICE_ROLE_KEY')) if secret else self.public_key
        if not key:
            raise ValueError('مفتاح إدارة الحسابات غير متوفر على الخادم.')
        headers = {'apikey':key}
        if token or not key.startswith(('sb_publishable_', 'sb_secret_')):
            headers['Authorization'] = 'Bearer '+(token or key)
        with requests.Session() as client:
            client.trust_env = False
            response = client.request(method,self.db_url+endpoint,headers=headers,timeout=12,allow_redirects=False,**options)
            response.raise_for_status()
            return response.json() if response.content else {}

    def authenticate(self, username, password):
        email = username if '@' in username else username+'@'+ALIAS_DOMAIN
        result = self.upstream('POST','/auth/v1/token?grant_type=password',json={'email':email,'password':password})
        user = result['user']
        uid = str(UUID(user['id']))
        if '@' not in username:
            if user.get('app_metadata',{}).get('alezz_customer') != 'active':
                raise ValueError('Inactive customer')
            return uid,'customer'
        rows = self.upstream('GET','/rest/v1/aseel_admins',token=result['access_token'],
                             params={'user_id':'eq.'+uid,'active':'eq.true','select':'user_id','limit':1})
        if not rows:
            raise ValueError('Administrator role required')
        return uid,'admin'

    @staticmethod
    def page(title, body):
        return HTMLResponse(f'''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>{title} | العز TV</title><link rel="stylesheet" href="/account/theme.css">
<main class="member-shell"><div class="member-art" aria-hidden="true"><span>ع</span><b>AL EZZ TV</b></div>
<section class="member-panel"><span class="member-brand">العز <b>TV</b></span><h1>{title}</h1>{body}</section></main></html>''',headers=HEADERS)

    def login_page(self, message='', mode='customer'):
        admin=mode=='admin'
        alert='<p role="alert" class="member-alert">'+html.escape(message)+'</p>' if message else ''
        label='البريد الإلكتروني للمسؤول' if admin else 'اسم المستخدم'
        input_attrs='type="email" maxlength="254"' if admin else 'maxlength="40" pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}"'
        return self.page('بوابة المسؤولين' if admin else 'دخول المشاهدة',f'''<p>{'هذه البوابة مخصصة للمسؤولين المعتمدين فقط.' if admin else 'مرحبًا بعودتك. ادخل باسم المستخدم وكلمة المرور المخصصة لحسابك.'}</p>{alert}
<form method="post" action="/account/{'admin' if admin else 'login'}">
<label>{label}<input name="username" dir="ltr" required autocomplete="username" {input_attrs}></label>
<label>كلمة المرور<input name="password" dir="ltr" required maxlength="128" type="password" autocomplete="current-password"></label>
<button>تسجيل الدخول</button></form>
<small>{'تُراجع صلاحيات المسؤول في قاعدة البيانات قبل السماح بالدخول.' if admin else 'يحصل كل عميل على حسابه من الإدارة.'}</small>
<p class="member-switch"><a href="/">الصفحة الرئيسية</a> · <a href="/account/{'login' if admin else 'admin'}">{'بوابة العملاء' if admin else 'بوابة المسؤولين'}</a></p>''')

    async def form(self, request):
        origin=request.headers.get('origin')
        if origin != str(request.base_url).rstrip('/'):
            raise ValueError('مصدر الطلب غير مسموح.')
        if not request.headers.get('content-type','').startswith('application/x-www-form-urlencoded'):
            raise ValueError('صيغة الطلب غير صحيحة.')
        body=bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body)>4096:
                raise ValueError('الطلب أكبر من الحد المسموح.')
        return {k:v[0] for k,v in parse_qs(body.decode('utf-8'),max_num_fields=8).items()}

    def revoke(self, uid):
        for key,value in list(self.sessions.items()):
            if value[0]==uid:
                self.sessions.pop(key,None)

    def manage(self, form):
        username=form.get('username','').strip().lower()
        if not USERNAME.fullmatch(username):
            raise ValueError('أدخل اسمًا من 3 إلى 40 حرفًا لاتينيًا أو رقمًا.')
        action=form.get('action','')
        if action=='create':
            password=form.get('password','')
            if not 12<=len(password)<=72 or len(password.encode('utf-8'))>72:
                raise ValueError('اختر كلمة مرور من 12 إلى 72 بايت.')
            self.upstream('POST','/auth/v1/admin/users',secret=True,json={
                'email':username+'@'+ALIAS_DOMAIN,'password':password,'email_confirm':True,
                'app_metadata':{'alezz_customer':'active'}})
            return 'تم إنشاء حساب '+username+'.'
        if action not in ('disable','enable'):
            raise ValueError('أمر غير معروف.')
        # Resolve the exact alias. Pagination prevents modifying an unrelated user.
        for page in range(1,101):
            users=self.upstream('GET','/auth/v1/admin/users',secret=True,params={'page':page,'per_page':100}).get('users',[])
            for user in users:
                if user.get('email')!=username+'@'+ALIAS_DOMAIN:
                    continue
                uid=str(UUID(user['id']))
                self.upstream('PUT','/auth/v1/admin/users/'+uid,secret=True,json={
                    'app_metadata':{'alezz_customer':'active' if action=='enable' else 'disabled'}})
                return uid
            if len(users)<100:
                break
        raise ValueError('حساب العميل غير موجود.')

    def customers_page(self, session, message=''):
        notice='<p role="status">'+html.escape(message)+'</p>' if message else ''
        return self.page('حسابات العملاء',f'''<p>إنشاء حساب مستقل لكل عميل أو إيقاف وصوله.</p>{notice}
<form method="post"><input type="hidden" name="csrf" value="{session[3]}">
<label>اسم العميل<input name="username" dir="ltr" required pattern="[a-zA-Z0-9][a-zA-Z0-9_.\\-]{{2,39}}" maxlength="40"></label>
<label>كلمة مرور الحساب الجديد<input name="password" type="password" dir="ltr" minlength="12" maxlength="72" autocomplete="new-password"></label>
<button name="action" value="create">إنشاء حساب</button>
<button name="action" value="disable" class="secondary">إيقاف الحساب</button>
<button name="action" value="enable" class="secondary">إعادة التفعيل</button></form><a href="/admin/">العودة إلى الإدارة</a>''')

    async def middleware(self, request: Request, call_next):
        path=request.url.path
        # Local development remains usable without hosting credentials. Public Render is always gated.
        if not self.secure and os.getenv('ALEZZ_ENFORCE_PORTAL_LOCAL') != '1' and path.split('/')[1] in ('api','static','studio'):
            return await call_next(request)
        if path.split('/')[1] not in ('web','admin','studio','static','api','account'):
            return await call_next(request)
        if path=='/account/theme.css':
            return FileResponse(Path(__file__).parent/'static'/'member.css',headers=HEADERS)
        if path in ('/account/login','/account/admin') and request.method=='POST':
            mode='admin' if path=='/account/admin' else 'customer'
            try:
                form=await self.form(request)
                username=form.get('username','').strip().lower()
                password=form.get('password','')
                if not (bool(re.fullmatch(r'[^\s@]+@[^\s@]+',username)) and len(username)<=254 if mode=='admin' else bool(USERNAME.fullmatch(username))) or not 0<len(password)<=128:
                    raise ValueError('Invalid credentials')
                now=time.monotonic()
                self.attempts={k:v for k,v in self.attempts.items() if v[0]>now}
                host=request.client.host if request.client else 'unknown'
                until,count=self.attempts.get(host,(now+300,0))
                if count>=10 or len(self.attempts)>=4096 and host not in self.attempts:
                    return HTMLResponse('محاولات كثيرة. أعد المحاولة بعد خمس دقائق.',429,headers=HEADERS)
                self.attempts[host]=(until,count+1)
                uid,role=await run_in_threadpool(self.authenticate,username,password)
                if role!=mode:raise ValueError('Role mismatch')
            except (ValueError,KeyError,requests.RequestException):
                return self.login_page('تعذّر تسجيل الدخول. تحقق من بيانات الحساب.',mode=mode)
            self.attempts.pop(host,None)
            self.sessions={k:v for k,v in self.sessions.items() if v[2]>now}
            if len(self.sessions)>=4096:
                return HTMLResponse('الخادم مشغول. حاول لاحقًا.',503,headers=HEADERS)
            token=secrets.token_urlsafe(32)
            self.sessions.pop(request.cookies.get(COOKIE,''),None)
            self.sessions[token]=(uid,role,now+SESSION_SECONDS,secrets.token_urlsafe(24))
            response=RedirectResponse('/studio/' if role=='admin' else '/web/',303,headers=HEADERS)
            response.set_cookie(COOKIE,token,max_age=SESSION_SECONDS,httponly=True,secure=self.secure,samesite='strict')
            return response
        token=request.cookies.get(COOKIE,'')
        session=self.sessions.get(token)
        if path in ('/account/login','/account/admin'):
            return self.login_page(mode='admin' if path=='/account/admin' else 'customer')
        section=path.split('/')[1]
        admin_area=section in ('admin','studio','static','api') or path=='/account/customers'
        if not session or session[2]<=time.monotonic():
            self.sessions.pop(token,None)
            if section=='api':
                from fastapi.responses import JSONResponse
                return JSONResponse({'detail':'يجب تسجيل الدخول بحساب مسؤول.'},status_code=401,headers=HEADERS)
            return RedirectResponse('/account/admin' if admin_area else '/account/login',303,headers=HEADERS)
        if path=='/account/logout' and request.method=='POST':
            if request.headers.get('origin')!=str(request.base_url).rstrip('/'):
                return Response(status_code=403,headers=HEADERS)
            self.sessions.pop(token,None)
            response=RedirectResponse('/',303,headers={**HEADERS,'Clear-Site-Data':'"cache", "storage"'})
            response.delete_cookie(COOKIE,secure=self.secure,httponly=True,samesite='strict')
            response.delete_cookie('alezz_studio_session',secure=self.secure,httponly=True,samesite='strict')
            return response
        if admin_area and session[1]!='admin':
            if section=='api':
                from fastapi.responses import JSONResponse
                return JSONResponse({'detail':'صلاحية المسؤول مطلوبة.'},status_code=403,headers=HEADERS)
            return HTMLResponse('هذه الصفحة مخصصة للإدارة.',403,headers=HEADERS)
        if path=='/account/customers':
            if request.method=='GET':
                return self.customers_page(session)
            if request.method=='POST':
                try:
                    form=await self.form(request)
                    if not secrets.compare_digest(form.get('csrf',''),session[3]):
                        return Response(status_code=403,headers=HEADERS)
                    result=await run_in_threadpool(self.manage,form)
                    if form.get('action')!='create':
                        self.revoke(result)
                        result='تم تحديث حالة الحساب.'
                    return self.customers_page(session,result)
                except ValueError as exc:
                    return self.customers_page(session,str(exc))
                except requests.RequestException:
                    return self.customers_page(session,'تعذّر تنفيذ العملية. تحقق من حالة الحساب وإعدادات Supabase.')
        if section in ('api','studio','static'):
            response=await call_next(request)
            response.headers['Cache-Control']='private, no-store'
            response.headers.setdefault('X-Content-Type-Options','nosniff')
            return response
        if request.method not in ('GET','HEAD') or path.startswith('/account/'):
            return Response(status_code=404,headers=HEADERS)
        if path in ('/web','/admin'):
            return RedirectResponse(path+'/',303,headers=HEADERS)
        relative=path.lstrip('/')
        if relative.endswith('/'):
            relative+='index.html'
        requested=Path(relative)
        if requested.suffix=='.html':
            requested=requested.with_suffix('.view')
            mime='text/html'
        else:
            if requested.suffix not in {'.js','.css','.svg','.png','.jpg','.jpeg','.webp','.ico','.json','.webmanifest','.woff2'}:
                return Response(status_code=404,headers=HEADERS)
            mime=None
        target=(self.root/requested).resolve()
        section=self.root/path.split('/')[1]
        if not target.is_relative_to(section) or not target.is_file():
            return Response(status_code=404,headers=HEADERS)
        headers=HEADERS if relative!='web/youtube-player.html' else {**HEADERS,'X-Frame-Options':'SAMEORIGIN'}
        return FileResponse(target,media_type=mime,headers=headers)
