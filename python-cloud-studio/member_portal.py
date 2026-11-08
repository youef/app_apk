"""Server-gated viewer and administration pages with provisioned Supabase accounts."""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import re
import secrets
import time
from pathlib import Path
from urllib.parse import parse_qs
from uuid import UUID
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import requests
from fastapi import Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool
from member_devices import DeviceRegistry, DEVICE_COOKIE, DEVICE_MAX_AGE, friendly_device
from member_sessions import (MemberSessions, AdminSessions, CUSTOMER_SESSION_SECONDS, ADMIN_SESSION_SECONDS)
from member_expiry import (account_state, expiration_from_date, expiry_epoch, expiry_date,
    plan_90_dates, subscription_summary, EXPIRES_KEY, PLAN_KEY, PLAN_DAYS, DEVICE_REVOKED_KEY)

COOKIE = 'alezz_member'
USERNAME = re.compile(r'[a-z0-9][a-z0-9_.-]{2,39}\Z')
ALIAS_DOMAIN = 'members.alezz.invalid'
HEADERS = {'Cache-Control':'private, no-store','X-Frame-Options':'DENY',
           'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}


class DeviceBindingError(ValueError):
    """Successful credentials, but this account is bound to another device."""



class Portal:
    def __init__(self, root, db_url, public_key, secure):
        self.root = Path(root).resolve()
        self.db_url = db_url.rstrip('/')
        self.public_key = public_key
        self.secure = secure
        self.attempts = {}
        private_dir = os.getenv('ALEZZ_DATA_DIR') or root
        device_secret = os.getenv('ALEZZ_SITE_SECRET') or 'alezz-local-only-device-secret-not-for-hosted-production'
        self.devices = DeviceRegistry(private_dir, device_secret)
        self.member_sessions = MemberSessions(private_dir)
        self.admin_sessions = AdminSessions(private_dir)

    def admin_active(self, uid):
        rows = self.upstream('GET', '/rest/v1/aseel_admins', secret=True,
                             params={'user_id': 'eq.' + uid, 'active': 'eq.true',
                                     'select': 'user_id', 'limit': 1})
        return bool(rows)

    def renew_browser_cookie(self, response, token, session, renewed, device_token=''):
        if not renewed:
            return response
        if session[1] == 'admin':
            ttl = max(1, min(ADMIN_SESSION_SECONDS, int(session[2] - time.monotonic())))
            response.set_cookie(COOKIE, token, max_age=ttl, path='/', httponly=True,
                                secure=self.secure, samesite='strict')
        else:
            response.set_cookie(COOKIE, token, max_age=CUSTOMER_SESSION_SECONDS, path='/',
                                httponly=True, secure=self.secure, samesite='lax')
            response.set_cookie(DEVICE_COOKIE, device_token, max_age=DEVICE_MAX_AGE,
                                path='/', httponly=True, secure=self.secure, samesite='lax')
        return response

    def upstream(self, method, endpoint, *, secret=False, token='', prefer='', **options):
        key = (os.getenv('ALEZZ_SUPABASE_SECRET_KEY') or os.getenv('ALEZZ_SUPABASE_SERVICE_ROLE_KEY')) if secret else self.public_key
        if not key:
            raise ValueError('مفتاح إدارة الحسابات غير متوفر على الخادم.')
        headers = {'apikey':key}
        if prefer:headers['Prefer']=prefer
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
            state=account_state(user.get('app_metadata',{}))
            if state == 'expired':
                raise ValueError('Customer subscription expired')
            if state != 'active':
                raise ValueError('Inactive customer')
            return uid,'customer',expiry_epoch(user.get('app_metadata',{}))
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
        if not admin and message and 'انتهت صلاحية' in message:
            return self.page('انتهت صلاحية اشتراكك',
                '<div class="expired-mark" aria-hidden="true">⌛</div>'
                '<p class="member-alert" role="alert">'+html.escape(message)+'</p>'
                '<p>تم إيقاف المشاهدة لحماية حسابك. باقة العز TV قابلة للتجديد لمدة 90 يومًا من الإدارة.</p>'
                '<p>تظل المفضلة وتقدم المشاهدة محفوظين في حسابك. تواصل مع المسؤول لتجديد الاشتراك.</p>'
                '<a class="member-cta" href="/account/login">تسجيل الدخول بعد التجديد</a>')
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
        self.member_sessions.revoke_user(uid)

    def manage(self, form):
        username=form.get('username','').strip().lower()
        if not USERNAME.fullmatch(username):
            raise ValueError('أدخل اسمًا من 3 إلى 40 حرفًا لاتينيًا أو رقمًا.')
        action=form.get('action','')
        if action=='create':
            password=form.get('password','')
            if not 12<=len(password)<=72 or len(password.encode('utf-8'))>72:
                raise ValueError('اختر كلمة مرور من 12 إلى 72 بايت.')
            if form.get('expires_on','').strip():
                expires=expiration_from_date(form['expires_on'])
                ending=form['expires_on']
                package=None
            else:
                expires,ending=plan_90_dates()
                package=PLAN_DAYS
            app_meta={'alezz_customer':'active',EXPIRES_KEY:expires}
            if package:
                app_meta[PLAN_KEY]=package
            self.upstream('POST','/auth/v1/admin/users',secret=True,json={
                'email':username+'@'+ALIAS_DOMAIN,'password':password,'email_confirm':True,
                'app_metadata':app_meta})
            return 'تم إنشاء العميل '+username+'، وتنتهي صلاحيته في '+ending+'.'
        if action not in ('disable','enable','reset-device','set-expiry','renew-90'):
            raise ValueError('أمر غير معروف.')
        expires=expiration_from_date(form.get('expires_on','')) if action=='set-expiry' else None
        # Resolve the exact alias. Pagination prevents modifying an unrelated user.
        for page in range(1,101):
            users=self.upstream('GET','/auth/v1/admin/users',secret=True,params={'page':page,'per_page':100}).get('users',[])
            for user in users:
                if user.get('email')!=username+'@'+ALIAS_DOMAIN:
                    continue
                uid=str(UUID(user['id']))
                current_meta=user.get('app_metadata') or {}
                metadata=dict(current_meta)
                if action=='reset-device':
                    metadata[DEVICE_REVOKED_KEY]=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                    self.upstream('PUT','/auth/v1/admin/users/'+uid,secret=True,json={
                        'app_metadata':metadata})
                    self.devices.reset(uid)
                    try:
                        self.upstream('DELETE','/rest/v1/aseel_device_sessions',
                                      secret=True,params={'user_id':'eq.'+uid})
                    except requests.RequestException:
                        # Native sessions are still revoked via server-owned metadata,
                        # even if cleaning the informational inventory fails.
                        pass
                elif action in ('set-expiry','renew-90'):
                    if action=='renew-90':
                        expires,ending=plan_90_dates(metadata)
                        metadata[PLAN_KEY]=PLAN_DAYS
                    else:
                        metadata.pop(PLAN_KEY,None)
                    metadata[EXPIRES_KEY]=expires
                    self.upstream('PUT','/auth/v1/admin/users/'+uid,secret=True,json={
                        'app_metadata':metadata})
                    self.member_sessions.set_user_expiry(uid,expiry_epoch(metadata))
                else:
                    if action=='enable' and account_state({**metadata,'alezz_customer':'active'})=='expired':
                        raise ValueError('صلاحية هذا الحساب منتهية. جدّد التاريخ أولًا قبل التفعيل.')
                    metadata['alezz_customer']='active' if action=='enable' else 'disabled'
                    self.upstream('PUT','/auth/v1/admin/users/'+uid,secret=True,json={
                        'app_metadata':metadata})
                return uid
            if len(users)<100:
                break
        raise ValueError('حساب العميل غير موجود.')

    def member_sync_read(self, uid):
        favorites=self.upstream('GET','/rest/v1/aseel_favorites',secret=True,
            params={'user_id':'eq.'+uid,'select':'item_type,item_id','limit':400})
        progress=self.upstream('GET','/rest/v1/aseel_watch_progress',secret=True,
            params={'user_id':'eq.'+uid,
                    'select':'item_type,item_id,position_ms,duration_ms,updated_at',
                    'order':'updated_at.desc','limit':120})
        return {'favorites':favorites,'progress':progress}

    def member_sync_write(self, uid, payload):
        if not isinstance(payload,dict):
            raise ValueError('طلب غير صالح')
        kind=payload.get('kind','')
        action=payload.get('action','')
        if kind in ('favorites_reset','progress_reset') and action=='clear':
            table='aseel_favorites' if kind=='favorites_reset' else 'aseel_watch_progress'
            self.upstream('DELETE','/rest/v1/'+table,secret=True,
                params={'user_id':'eq.'+uid})
            return {'ok':True}
        if kind not in ('favorite','progress') or action not in ('save','remove'):
            raise ValueError('نوع الإجراء غير صحيح')
        item_type=payload.get('item_type','')
        if item_type not in ('movie','series','episode','channel'):
            raise ValueError('نوع المحتوى غير صحيح')
        try:
            item_id=str(UUID(payload.get('item_id','')))
        except (ValueError,AttributeError,TypeError):
            raise ValueError('معرف المحتوى غير صحيح')
        table='aseel_favorites' if kind=='favorite' else 'aseel_watch_progress'
        if action=='remove':
            self.upstream('DELETE','/rest/v1/'+table,secret=True,
                params={'user_id':'eq.'+uid,'item_type':'eq.'+item_type,
                        'item_id':'eq.'+item_id})
            return {'ok':True}
        record={'user_id':uid,'item_type':item_type,'item_id':item_id}
        if kind=='progress':
            position=payload.get('position_ms')
            duration=payload.get('duration_ms')
            if type(position) is not int or type(duration) is not int or position<0 or duration<=0 or \
               position>duration or duration>14*24*60*60*1000:
                raise ValueError('موضع المشاهدة غير صالح')
            record.update(position_ms=position,duration_ms=duration)
        self.upstream('POST','/rest/v1/'+table,secret=True,json=record,
            params={'on_conflict':'user_id,item_type,item_id'},
            prefer='resolution=merge-duplicates,return=minimal')
        return {'ok':True}

    def customers_page(self, session, message='', page=1):
        from customer_directory import page as render_customer_directory
        return render_customer_directory(self, session, message, number=page)

    async def middleware(self, request: Request, call_next):
        path=request.url.path
        # Local development remains usable without hosting credentials. Public Render is always gated.
        if not self.secure and os.getenv('ALEZZ_ENFORCE_PORTAL_LOCAL') != '1' and path.split('/')[1] in ('api','static','studio'):
            import cloud_auth
            if not cloud_auth.ENABLED:
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
                identity=await run_in_threadpool(self.authenticate,username,password)
                uid,role=identity[:2]
                account_deadline=identity[2] if len(identity)>2 else 0
                if role!=mode:raise ValueError('Role mismatch')
                browser_token = request.cookies.get(DEVICE_COOKIE, '')
                if role == 'customer':
                    if not re.fullmatch(r'[A-Za-z0-9_-]{32,100}', browser_token):
                        browser_token = secrets.token_urlsafe(32)
                    allowed = await run_in_threadpool(
                        self.devices.register, uid, browser_token, request.headers.get('user-agent', ''))
                    if not allowed:
                        raise DeviceBindingError('Device is already registered')
            except DeviceBindingError:
                return self.login_page('هذا الحساب مرتبط بجهاز آخر. اطلب من الإدارة فك ارتباط الجهاز قبل تغييره.',mode=mode)
            except ValueError as error:
                if str(error)=='Customer subscription expired':
                    return self.login_page('انتهت صلاحية اشتراكك، وحسابك غير نشط. تواصل مع الإدارة لتجديد الصلاحية.',mode=mode)
                if str(error)=='Inactive customer':
                    return self.login_page('حسابك غير نشط. تواصل مع الإدارة.',mode=mode)
                return self.login_page('تعذّر تسجيل الدخول. تحقق من بيانات الحساب.',mode=mode)
            except (KeyError,requests.RequestException):
                return self.login_page('تعذّر الاتصال بخادم الحسابات. حاول مجددًا.',mode=mode)
            self.attempts.pop(host,None)
            token=secrets.token_urlsafe(32)
            await run_in_threadpool(self.member_sessions.delete, request.cookies.get(COOKIE,''))
            await run_in_threadpool(self.admin_sessions.delete, request.cookies.get(COOKIE,''))
            csrf=secrets.token_urlsafe(24)
            if role=='customer':
                try:
                    await run_in_threadpool(self.member_sessions.create,token,uid,csrf,account_deadline)
                except OSError:
                    return HTMLResponse('تعذّر حفظ الجلسة بأمان، تحقق من القرص الخاص بالخادم.',503,headers=HEADERS)
            else:
                try:
                    await run_in_threadpool(self.admin_sessions.create, token, uid, csrf)
                except (OSError, RuntimeError):
                    return HTMLResponse('تعذّر حفظ جلسة الإدارة على قرص الخادم.',503,headers=HEADERS)
            response=RedirectResponse('/studio/' if role=='admin' else '/web/',303,headers=HEADERS)
            response.set_cookie(COOKIE,token,max_age=CUSTOMER_SESSION_SECONDS if role=='customer' else ADMIN_SESSION_SECONDS,
                                httponly=True,secure=self.secure,path='/',
                                samesite='lax' if role=='customer' else 'strict')
            if role == 'customer':
                response.set_cookie(DEVICE_COOKIE,browser_token,max_age=DEVICE_MAX_AGE,
                                    httponly=True,secure=self.secure,samesite='lax')
            return response
        token=request.cookies.get(COOKIE,'')
        session=None
        cookie_renewed=False
        needs_admin_check=False
        persisted=await run_in_threadpool(self.member_sessions.get,token)
        if persisted:
            session,cookie_renewed=persisted
        else:
            admin_persisted=await run_in_threadpool(self.admin_sessions.get,token)
            if admin_persisted:
                session,cookie_renewed,needs_admin_check=admin_persisted
        if session and session[1] == 'customer':
            if not await run_in_threadpool(self.devices.matches, session[0], request.cookies.get(DEVICE_COOKIE, '')):
                await run_in_threadpool(self.member_sessions.delete,token)
                session = None
        if path in ('/account/login','/account/admin'):
            expected_role = 'admin' if path == '/account/admin' else 'customer'
            if session and session[2] > time.monotonic() and session[1] == expected_role:
                return RedirectResponse('/studio/' if expected_role == 'admin' else '/web/',303,headers=HEADERS)
            expired_notice=('انتهت صلاحية حسابك وأصبح غير نشط. تواصل مع الإدارة لتجديد الصلاحية.'
                            if path=='/account/login' and request.query_params.get('expired')=='1' else '')
            return self.login_page(expired_notice,mode='admin' if path=='/account/admin' else 'customer')
        section=path.split('/')[1]
        admin_area=section in ('admin','studio','static','api') or path=='/account/customers'
        if not session or session[2]<=time.monotonic():
            if path=='/account/status':
                from fastapi.responses import JSONResponse
                return JSONResponse({'active':False,'detail':'انتهت الجلسة أو صلاحية الحساب.'},status_code=401,headers=HEADERS)
            if section=='api':
                from fastapi.responses import JSONResponse
                return JSONResponse({'detail':'يجب تسجيل الدخول بحساب مسؤول.'},status_code=401,headers=HEADERS)
            return RedirectResponse('/account/admin' if admin_area else '/account/login',303,headers=HEADERS)
        if path=='/account/logout' and request.method=='POST':
            if request.headers.get('origin')!=str(request.base_url).rstrip('/'):
                return Response(status_code=403,headers=HEADERS)
            await run_in_threadpool(self.member_sessions.delete,token)
            await run_in_threadpool(self.admin_sessions.delete,token)
            response=RedirectResponse('/',303,headers={**HEADERS,'Clear-Site-Data':'"cache"'})
            response.delete_cookie(COOKIE,secure=self.secure,httponly=True,samesite='strict')
            response.delete_cookie('alezz_studio_session',secure=self.secure,httponly=True,samesite='strict')
            return response
        if admin_area and session[1]!='admin':
            if section=='api':
                from fastapi.responses import JSONResponse
                return JSONResponse({'detail':'صلاحية المسؤول مطلوبة.'},status_code=403,headers=HEADERS)
            return HTMLResponse('هذه الصفحة مخصصة للإدارة.',403,headers=HEADERS)
        if admin_area and session[1]=='admin' and needs_admin_check:
            try:
                permitted=await run_in_threadpool(self.admin_active,session[0])
            except (ValueError, requests.RequestException):
                # A transient Supabase outage must not erase a valid browser session.
                if section=='api':
                    from fastapi.responses import JSONResponse
                    return JSONResponse({'detail':'تعذّر التحقق مؤقتًا من صلاحية الإدارة.'},503,headers=HEADERS)
                return HTMLResponse('تعذّر التحقق من صلاحية الإدارة مؤقتًا. أعد المحاولة.',503,headers=HEADERS)
            if not permitted:
                await run_in_threadpool(self.admin_sessions.delete,token)
                result=RedirectResponse('/account/admin',303,headers=HEADERS)
                result.delete_cookie(COOKIE,path='/',secure=self.secure,httponly=True,samesite='strict')
                return result
            await run_in_threadpool(self.admin_sessions.mark_verified,token)
        if path=='/account/customers':
            raw_page=request.query_params.get('page','1')
            page_number=min(100,max(1,int(raw_page))) if re.fullmatch(r'[0-9]{1,3}',raw_page) else 1
            if request.method=='GET':
                return self.renew_browser_cookie(await run_in_threadpool(self.customers_page,session,page=page_number),token,session,cookie_renewed,request.cookies.get(DEVICE_COOKIE,''))
            if request.method=='POST':
                try:
                    form=await self.form(request)
                    if not secrets.compare_digest(form.get('csrf',''),session[3]):
                        return Response(status_code=403,headers=HEADERS)
                    action=form.get('action','')
                    result=await run_in_threadpool(self.manage,form)
                    if action!='create':
                        if action not in ('set-expiry','renew-90'):
                            self.revoke(result)
                        result=('تم تجديد الباقة 90 يومًا بنجاح.' if action=='renew-90'
                                else 'تم تحديث تاريخ صلاحية الحساب.' if action=='set-expiry'
                                else 'تم فك ارتباط الجهاز وإبطال الجلسات السابقة.' if action=='reset-device'
                                else 'تم تحديث حالة الحساب.')
                    return self.renew_browser_cookie(await run_in_threadpool(self.customers_page,session,result,page_number),token,session,cookie_renewed,request.cookies.get(DEVICE_COOKIE,''))
                except ValueError as exc:
                    return self.renew_browser_cookie(await run_in_threadpool(self.customers_page,session,str(exc),page_number),token,session,cookie_renewed,request.cookies.get(DEVICE_COOKIE,''))
                except requests.RequestException:
                    return self.renew_browser_cookie(await run_in_threadpool(self.customers_page,session,'تعذّر تنفيذ العملية. تحقق من حالة الحساب وإعدادات Supabase.',page_number),token,session,cookie_renewed,request.cookies.get(DEVICE_COOKIE,''))
        if path=='/account/status':
            from fastapi.responses import JSONResponse
            if request.method!='GET' or session[1]!='customer':
                return JSONResponse({'active':False},status_code=403,headers=HEADERS)
            deadline=session[4] if len(session)>4 else 0
            if deadline:
                end_local=datetime.fromtimestamp(deadline-1,ZoneInfo('Asia/Riyadh')).date()
                days=max(0,(end_local-datetime.now(ZoneInfo('Asia/Riyadh')).date()).days+1)
                summary={'active':True,'expires_on':end_local.isoformat(),
                         'remaining_days':days,'warning':days<=7}
            else:
                summary={'active':True,'expires_on':None,'remaining_days':None,'warning':False}
            return JSONResponse(summary,headers=HEADERS)
        if path=='/account/sync':
            from fastapi.responses import JSONResponse
            if session[1]!='customer':
                return JSONResponse({'detail':'صلاحية العميل مطلوبة'},status_code=403,headers=HEADERS)
            if request.method not in ('GET','POST'):
                return JSONResponse({'detail':'طريقة غير مدعومة'},status_code=405,headers=HEADERS)
            if request.method=='GET':
                try:
                    response_data=await run_in_threadpool(self.member_sync_read,session[0])
                    return JSONResponse(response_data,headers=HEADERS)
                except (ValueError,requests.RequestException):
                    return JSONResponse({'detail':'تعذرت مزامنة الحساب'},status_code=503,headers=HEADERS)
            if (request.headers.get('origin') != str(request.base_url).rstrip('/') or
                not secrets.compare_digest(request.headers.get('x-csrf-token',''),session[3]) or
                not request.headers.get('content-type','').lower().startswith('application/json')):
                return JSONResponse({'detail':'طلب غير مسموح'},status_code=403,headers=HEADERS)
            try:
                body=bytearray()
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body)>2048:
                        return JSONResponse({'detail':'حجم الطلب كبير'},status_code=413,headers=HEADERS)
                data=json.loads(body.decode('utf-8'))
                result=await run_in_threadpool(self.member_sync_write,session[0],data)
                return JSONResponse(result,headers=HEADERS)
            except (ValueError,TypeError,json.JSONDecodeError):
                return JSONResponse({'detail':'بيانات غير صحيحة'},status_code=400,headers=HEADERS)
            except requests.RequestException:
                return JSONResponse({'detail':'تعذرت كتابة المزامنة'},status_code=503,headers=HEADERS)
        if section in ('api','studio','static'):
            response=await call_next(request)
            response.headers['Cache-Control']='private, no-store'
            response.headers.setdefault('X-Content-Type-Options','nosniff')
            return self.renew_browser_cookie(response,token,session,cookie_renewed,request.cookies.get(DEVICE_COOKIE,''))
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
        if section.name=='web' and requested.name=='index.view' and request.method=='GET':
            # The session is checked above; the opaque HMAC key only selects this
            # account's device-local favourites and playback progress. It is not a token.
            scope_secret=os.getenv('ALEZZ_SITE_SECRET') or 'local-development-profile-scope'
            profile_key=hmac.new(scope_secret.encode('utf-8'),session[0].encode('utf-8'),hashlib.sha256).hexdigest()[:32]
            context={'authenticated':True,'accountKey':profile_key,'csrf':session[3]}
            script='<script>window.ALEZZ_MEMBER_CONTEXT='+json.dumps(context,separators=(',',':'))+';</script>'
            markup=target.read_text(encoding='utf-8')
            marker='<script src="js/store.js?v=member-scope-1"></script>'
            # Inject before the store module so every subsequent module reads the
            # correct account namespace, even after switching logins on one device.
            markup=markup.replace(marker,script+marker) if marker in markup else markup+script
            result=HTMLResponse(markup,headers=headers)
            return self.renew_browser_cookie(result,token,session,cookie_renewed,request.cookies.get(DEVICE_COOKIE,''))
        result=FileResponse(target,media_type=mime,headers=headers)
        return self.renew_browser_cookie(result,token,session,cookie_renewed,request.cookies.get(DEVICE_COOKIE,''))
