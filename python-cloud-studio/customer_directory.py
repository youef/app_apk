"""Administrator-only member directory. Never expose Supabase service credentials."""
from datetime import datetime
from zoneinfo import ZoneInfo
from uuid import UUID
from html import escape
from fastapi.responses import HTMLResponse
from member_expiry import account_state, expiry_date, subscription_summary, PLAN_DAYS

ALIAS_DOMAIN='members.alezz.invalid'
HEADERS={'Cache-Control':'private, no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'}


def date(value):
    if not value:
        return '—'
    try:
        dt=datetime.fromtimestamp(value,ZoneInfo('Asia/Riyadh')) if isinstance(value,(int,float)) else datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return dt.astimezone(ZoneInfo('Asia/Riyadh')).strftime('%Y-%m-%d %H:%M')
    except (ValueError,TypeError,OverflowError):
        return '—'


def page(portal,session,message='',number=1):
    number=max(1,min(int(number),100))
    csrf=escape(session[3],quote=True)
    error=''
    users=[]
    try:
        data=portal.upstream('GET','/auth/v1/admin/users',secret=True,params={'page':number,'per_page':100})
        users=data.get('users',[]) if isinstance(data,dict) else []
    except Exception:
        error='تعذر تحميل الحسابات من Supabase. راجع الاتصال ومفتاح إدارة المستخدمين.'
    customers=[]
    for user in users:
        if not isinstance(user,dict):continue
        email=str(user.get('email') or '').lower()
        if not email.endswith('@'+ALIAS_DOMAIN):continue
        try:uid=str(UUID(user['id']))
        except (ValueError,TypeError,KeyError):continue
        metadata=user.get('app_metadata') or {}
        summary=subscription_summary(metadata)
        customers.append({'uid':uid,'name':email.split('@')[0],
                          'status':summary['status'],
                          'enabled':metadata.get('alezz_customer')=='active',
                          'expiry':summary['expires_on'],
                          'days_left':summary['remaining_days'],
                          'soon':summary['warning'],
                          'last':user.get('last_sign_in_at'),'created':user.get('created_at')})
    devices=portal.devices.details([u['uid'] for u in customers])
    native={}
    if customers:
        ids=[u['uid'] for u in customers]
        try:
            rows=portal.upstream('GET','/rest/v1/aseel_device_sessions',secret=True,
                params={'user_id':'in.('+','.join(ids)+')',
                        'select':'user_id,platform,device_model,last_seen_at,device_hash',
                        'order':'last_seen_at.desc','limit':400})
            if isinstance(rows,list):
                for device in rows:
                    if not isinstance(device,dict) or device.get('user_id') not in ids:
                        continue
                    uid=device['user_id']
                    if len(native.get(uid,[]))<5:
                        native.setdefault(uid,[]).append(device)
        except Exception:
            pass  # Subscription administration must work even if inventory is unavailable.
    cards=[]
    for user in customers:
        name=escape(user['name'],quote=True)
        active=user['status']=='active'
        disabled=user['status']=='disabled'
        expired=user['status']=='expired'
        label='منتهي الصلاحية' if expired else 'نشط' if active else 'غير نشط'
        linked=devices.get(user['uid'])
        info=('<strong>'+escape(linked['device_name'])+'</strong><small>رقم الجهاز: <b dir="ltr">'+escape(linked['device_id'])+
              '</b></small><small>آخر نشاط: '+date(linked['last_seen_at'])+'</small>') if linked else '<em>لم يسجل جهازًا بعد</em>'
        native_list=native.get(user['uid'],[])
        native_info=''.join(
            '<small class="device-item">📺 '+escape(str(d.get('device_model') or 'Android TV')[:70])+
            ' • آخر اتصال: '+date(d.get('last_seen_at'))+'</small>'
            for d in native_list if d.get('platform')=='android_tv')
        if not native_info:
            native_info='<em>لم يُسجل جهاز تلفزيون بهذا الحساب بعد</em>'
        actions='<form method="post" class="row-actions"><input type="hidden" name="csrf" value="'+csrf+'"><input type="hidden" name="username" value="'+name+'">'
        if linked or native_info:
            actions+='<button class="minor" name="action" value="reset-device" onclick="return confirm(\'إلغاء ارتباط أجهزة العميل وإبطال جلسات المشاهدة السابقة؟\')">فك الأجهزة / إنهاء الجلسات</button>'
        actions+='<button class="minor" name="action" value="'+('disable' if user['enabled'] else 'enable')+'">'+('إيقاف الحساب' if user['enabled'] else 'تفعيل الحساب')+'</button></form>'
        valid_date=user['expiry'] if user['expiry'] not in (None,'invalid') else ''
        renewal=('<form method="post" class="expiry-actions"><input type="hidden" name="csrf" value="'+csrf+'"><input type="hidden" name="username" value="'+name+'">'+
            '<label>تاريخ الانتهاء (شامل يوم الانتهاء، بتوقيت السعودية)<input type="date" name="expires_on" required value="'+escape(valid_date,quote=True)+'"></label>'+
            '<button class="minor" name="action" value="set-expiry">حفظ / تجديد الصلاحية</button></form>')
        subtitle=('تنتهي الصلاحية: '+user['expiry'] if valid_date
                  else 'انتهاء الصلاحية غير محدد — حساب قديم' if user['expiry'] is None
                  else 'تاريخ الصلاحية غير صالح — يُمنع الدخول')
        if active and user['days_left'] is not None:
            subtitle+=' • '+str(user['days_left'])+' يوم متبقٍ'
        renew=('<form method="post" class="renew-inline"><input type="hidden" name="csrf" value="'+csrf+
               '"><input type="hidden" name="username" value="'+name+
               '"><button class="renew" name="action" value="renew-90">↻ تجديد 90 يومًا</button></form>')
        cards.append('<article class="customer"><header><strong dir="ltr">'+name+'</strong><span class="'+('expired' if expired else 'soon' if user['soon'] else 'on' if active else 'off')+'">'+('قارب على الانتهاء' if user['soon'] else label)+'</span></header>'+
                     '<div class="detail"><div><small>آخر دخول</small><b>'+date(user['last'])+'</b><small>الإنشاء: '+date(user['created'])+'</small>'+
                     '<small>'+escape(subtitle)+'</small></div>'+
                     '<div><small>جهاز بوابة الويب</small>'+info+
                     '<small>أجهزة Android TV المسجلة</small>'+native_info+'</div></div>'+renew+renewal+actions+'</article>')
    if not cards:cards.append('<p class="empty">لا توجد حسابات عملاء في هذه الصفحة.</p>')
    prev=('<a href="/account/customers?page='+str(number-1)+'">السابق</a>') if number>1 else ''
    nxt=('<a href="/account/customers?page='+str(number+1)+'">التالي</a>') if len(users)>=100 and number<100 else ''
    note='<p class="notice" role="status">'+escape(message)+'</p>' if message else ''
    if error:note+='<p class="notice error" role="alert">'+escape(error)+'</p>'
    markup='''<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="theme-color" content="#0b1320"><title>حسابات العملاء | العز TV</title>
<style>
:root{color-scheme:dark;font:16px system-ui,Tahoma,sans-serif;color:#f5f7f5;background:#0b1320}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 80% 0,#244052,transparent 47%),#0b1320;min-height:100dvh}
a{color:#d9ebb4;text-decoration:none}:focus-visible{outline:3px solid #d9ebb4;outline-offset:3px}
main{max-width:1130px;padding:24px 16px 75px;margin:auto}.bar{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap;padding-bottom:22px;border-bottom:1px solid #ffffff25}
.bar nav{display:flex;gap:15px;flex-wrap:wrap;font-size:.88rem}.logo{font-weight:900;font-size:1.35rem}.logo b{color:#d9ebb4}
.intro{padding:32px 0}.intro small{color:#d9ebb4;letter-spacing:.1em;font-weight:700}.intro h1{font-size:clamp(2rem,4.5vw,3rem);margin:8px 0}
.intro p,.hint{color:#b3c3d1;line-height:1.9}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:15px 0 28px}
.stat{background:#172637;border:1px solid #3b5566;border-radius:14px;padding:14px 20px}.stat b{font-size:1.4rem;color:#d9ebb4;display:block}.stat span{font-size:.8rem;color:#b4c7d4}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0}
.section-head h2{font-size:1.35rem}.paging{display:flex;gap:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.customer,.new{background:#152231;border:1px solid #344a60;border-radius:18px;padding:20px}
.customer header{display:flex;align-items:center;justify-content:space-between;gap:8px}.customer header strong{font-size:1.18rem}.on,.off,.expired,.soon{border-radius:20px;padding:6px 11px;font-size:.76rem}.on{background:#1e443a;color:#b1e9c7}.off{background:#533330;color:#ffd4c1}.expired{background:#554221;color:#ffe5a4}.soon{background:#574222;color:#ffe4b2}
.detail{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:15px 0;padding-top:14px;border-top:1px solid #ffffff17}.detail small{display:block;font-size:.76rem;color:#a7bac9;line-height:1.9}.detail b,.detail strong{display:block;font-size:.85rem}.detail em{color:#e8c7a3;font-size:.85rem}
button,input{font:inherit}button{cursor:pointer}.row-actions{display:flex;gap:9px;flex-wrap:wrap}
.minor,.primary{padding:10px 15px;border-radius:11px;border:1px solid #527087;background:#263c50;color:#f3f7f9;font-weight:700;min-height:42px}
.minor:hover{background:#36566e}.primary,.renew{background:#d9ebb4;color:#182315;border:0}.new{margin-top:27px}.new h2{margin:0}
.renew-inline{margin:12px 0}.renew{border-radius:11px;padding:10px 14px;font-weight:800;min-height:44px}
.notice-board{border-radius:18px;background:#192b37;border:1px solid #455b68;margin:12px 0 27px;padding:15px 20px}
.notice-board h2{margin:5px 0;font-size:1.14rem}.notice-board p{color:#bdcdd6;font-size:.9rem;margin:6px 0}
.expiry-alerts{display:flex;gap:8px;flex-wrap:wrap}.expiry-alerts span{background:#263d4a;border-radius:10px;padding:8px 12px;font-size:.85rem}
.expiry-actions{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:12px;border-top:1px solid #ffffff20;padding-top:12px}.expiry-actions label{display:grid;gap:7px;flex:1;min-width:195px;color:#cfdee5;font-size:.82rem}
.expiry-actions input{width:100%;min-height:42px;border:1px solid #517080;border-radius:10px;padding:8px;color:#f6fafa;background:#0b1723;color-scheme:dark}
.new form{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:end;margin-top:18px}.new label{display:grid;gap:7px;font-size:.87rem}
.new input{background:#0b1723;color:#fff;border:1px solid #49647a;border-radius:10px;min-height:44px;padding:10px;width:100%}
.notice{background:#204136;border-radius:12px;padding:14px}.notice.error{background:#603636}.empty{padding:25px;background:#18283c;border-radius:15px}
footer{font-size:.79rem;color:#afbfcb;margin-top:30px;line-height:1.9}
@media(max-width:740px){.grid{grid-template-columns:1fr}.new form{grid-template-columns:1fr}.detail{gap:10px}}
@media(max-width:420px){.detail{grid-template-columns:1fr}}
</style><link rel="stylesheet" href="/static/customer-unified.css?v=20261108"></head><body><main><header class="bar"><div class="logo">العز <b>TV</b> · الإدارة</div>
<nav><a href="/studio/">الاستوديو</a><a href="/studio/sources">مصادر المسلسلات</a><a href="/admin/">إدارة المحتوى</a></nav></header>
<section class="intro"><small>CUSTOMER CONTROL</small><h1>إدارة العملاء وأجهزتهم</h1>
<p>باقة 90 يومًا افتراضيًا لكل عميل. التجديد يضيف 90 يومًا إلى آخر يوم نشط، أو يبدأ من اليوم إذا انتهى الاشتراك. جميع التواريخ بتوقيت السعودية.</p></section>'''+note+'''
<section class="stats"><div class="stat"><b>'''+str(len(customers))+'''</b><span>عملاء الصفحة</span></div>
<div class="stat"><b>'''+str(sum(u['status']=='active' for u in customers))+'''</b><span>حسابات نشطة</span></div>
<div class="stat"><b>'''+str(sum(u['status']=='expired' for u in customers))+'''</b><span>منتهية الصلاحية</span></div>
<div class="stat"><b>'''+str(sum(u['soon'] for u in customers))+'''</b><span>تنتهي خلال 7 أيام</span></div>
<div class="stat"><b>'''+str(len(devices)+sum(len(u) for u in native.values()))+'''</b><span>أجهزة مسجلة</span></div></section>
<section class="notice-board"><h2>تنبيهات الاشتراكات</h2>
<p>تنبيهات داخل لوحة الإدارة، ولا تُرسل رسائل SMS أو بريد تلقائيًا دون ربط خدمة إرسال.</p>
<div class="expiry-alerts">'''+''.join(
'<span>'+escape(u['name'])+' • '+('منتهي الصلاحية' if u['status']=='expired' else str(u['days_left'])+' أيام متبقية')+'</span>'
for u in customers if u['status']=='expired' or u['soon'])+'''
</div></section>
<div class="section-head"><h2>دليل حسابات العملاء</h2><div class="paging"><span>صفحة '''+str(number)+'''</span>'''+prev+nxt+'''</div></div>
<div class="grid">'''+''.join(cards)+'''</div>
<section class="new"><h2>إنشاء حساب جديد · باقة 90 يومًا</h2><p class="hint">يُحسب تلقائيًا 90 يومًا من تاريخ الإنشاء، أو حدّد تاريخًا مخصصًا عند الحاجة.</p>
<form method="post" action="/account/customers?page='''+str(number)+'''">
<input type="hidden" name="csrf" value="'''+csrf+'''">
<label>اسم المستخدم<input name="username" dir="ltr" required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}" maxlength="40" autocomplete="off"></label>
<label>كلمة المرور<input type="password" name="password" dir="ltr" required minlength="12" maxlength="72" autocomplete="new-password"></label>
<label>تاريخ مخصص (اختياري)<input type="date" name="expires_on"></label>
<button class="primary" name="action" value="create">إنشاء العميل · 90 يومًا</button></form></section>
<footer>معلومات الحساب من Supabase؛ ومعرّف الجهاز عشوائي وليس عنوان MAC. الأوقات بتوقيت السعودية، وتُحفظ ارتباطات الأجهزة على قرص الخادم الخاص.</footer>
</main></body></html>'''
    return HTMLResponse(markup,headers=HEADERS)
