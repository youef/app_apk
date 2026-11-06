"""Administrator-only member directory. Never expose Supabase service credentials."""
from datetime import datetime
from zoneinfo import ZoneInfo
from uuid import UUID
from html import escape
from fastapi.responses import HTMLResponse
from member_expiry import account_state, expiry_date

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
        customers.append({'uid':uid,'name':email.split('@')[0],
                          'status':account_state(metadata),
                          'enabled':metadata.get('alezz_customer')=='active',
                          'expiry':expiry_date(metadata),
                          'last':user.get('last_sign_in_at'),'created':user.get('created_at')})
    devices=portal.devices.details([u['uid'] for u in customers])
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
        actions='<form method="post" class="row-actions"><input type="hidden" name="csrf" value="'+csrf+'"><input type="hidden" name="username" value="'+name+'">'
        if linked:
            actions+='<button class="minor" name="action" value="reset-device" onclick="return confirm(\'فك ارتباط الجهاز الحالي وإنهاء جلسة العميل؟\')">فك الجهاز</button>'
        actions+='<button class="minor" name="action" value="'+('disable' if user['enabled'] else 'enable')+'">'+('إيقاف الحساب' if user['enabled'] else 'تفعيل الحساب')+'</button></form>'
        valid_date=user['expiry'] if user['expiry'] not in (None,'invalid') else ''
        renewal='<form method="post" class="expiry-actions"><input type="hidden" name="csrf" value="'+csrf+'"><input type="hidden" name="username" value="'+name+'">'+(
            '<label>تاريخ الانتهاء (شامل يوم الانتهاء، بتوقيت السعودية)<input type="date" name="expires_on" required value="'+escape(valid_date,quote=True)+'"></label>')+
            '<button class="minor" name="action" value="set-expiry">حفظ / تجديد الصلاحية</button></form>'
        subtitle=('تنتهي الصلاحية: '+user['expiry'] if valid_date
                  else 'انتهاء الصلاحية غير محدد — حساب قديم' if user['expiry'] is None
                  else 'تاريخ الصلاحية غير صالح — يُمنع الدخول')
        cards.append('<article class="customer"><header><strong dir="ltr">'+name+'</strong><span class="'+('expired' if expired else 'on' if active else 'off')+'">'+label+'</span></header>'+
                     '<div class="detail"><div><small>آخر دخول</small><b>'+date(user['last'])+'</b><small>الإنشاء: '+date(user['created'])+'</small>'+
                     '<small>'+escape(subtitle)+'</small></div>'+
                     '<div><small>الجهاز المعتمد</small>'+info+'</div></div>'+renewal+actions+'</article>')
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
.customer header{display:flex;align-items:center;justify-content:space-between;gap:8px}.customer header strong{font-size:1.18rem}.on,.off,.expired{border-radius:20px;padding:6px 11px;font-size:.76rem}.on{background:#1e443a;color:#b1e9c7}.off{background:#533330;color:#ffd4c1}.expired{background:#554221;color:#ffe5a4}
.detail{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:15px 0;padding-top:14px;border-top:1px solid #ffffff17}.detail small{display:block;font-size:.76rem;color:#a7bac9;line-height:1.9}.detail b,.detail strong{display:block;font-size:.85rem}.detail em{color:#e8c7a3;font-size:.85rem}
button,input{font:inherit}button{cursor:pointer}.row-actions{display:flex;gap:9px;flex-wrap:wrap}
.minor,.primary{padding:10px 15px;border-radius:11px;border:1px solid #527087;background:#263c50;color:#f3f7f9;font-weight:700;min-height:42px}
.minor:hover{background:#36566e}.primary{background:#d9ebb4;color:#182315;border:0}.new{margin-top:27px}.new h2{margin:0}
.expiry-actions{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:12px;border-top:1px solid #ffffff20;padding-top:12px}.expiry-actions label{display:grid;gap:7px;flex:1;min-width:195px;color:#cfdee5;font-size:.82rem}
.expiry-actions input{width:100%;min-height:42px;border:1px solid #517080;border-radius:10px;padding:8px;color:#f6fafa;background:#0b1723;color-scheme:dark}
.new form{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:end;margin-top:18px}.new label{display:grid;gap:7px;font-size:.87rem}
.new input{background:#0b1723;color:#fff;border:1px solid #49647a;border-radius:10px;min-height:44px;padding:10px;width:100%}
.notice{background:#204136;border-radius:12px;padding:14px}.notice.error{background:#603636}.empty{padding:25px;background:#18283c;border-radius:15px}
footer{font-size:.79rem;color:#afbfcb;margin-top:30px;line-height:1.9}
@media(max-width:740px){.grid{grid-template-columns:1fr}.new form{grid-template-columns:1fr}.detail{gap:10px}}
@media(max-width:420px){.detail{grid-template-columns:1fr}}
</style></head><body><main><header class="bar"><div class="logo">العز <b>TV</b> · الإدارة</div>
<nav><a href="/studio/">الاستوديو</a><a href="/studio/sources">مصادر المسلسلات</a><a href="/admin/">إدارة المحتوى</a></nav></header>
<section class="intro"><small>CUSTOMER CONTROL</small><h1>إدارة العملاء وأجهزتهم</h1>
<p>حدّد تاريخ انتهاء صلاحية كل عميل. يتوقف الحساب تلقائيًا بعد نهاية اليوم المحدد بتوقيت السعودية، ولا يدخل مجددًا إلا بعد تجديد التاريخ من الإدارة.</p></section>'''+note+'''
<section class="stats"><div class="stat"><b>'''+str(len(customers))+'''</b><span>عملاء الصفحة</span></div>
<div class="stat"><b>'''+str(sum(u['status']=='active' for u in customers))+'''</b><span>حسابات نشطة</span></div>
<div class="stat"><b>'''+str(sum(u['status']=='expired' for u in customers))+'''</b><span>منتهية الصلاحية</span></div>
<div class="stat"><b>'''+str(len(devices))+'''</b><span>أجهزة مرتبطة</span></div></section>
<div class="section-head"><h2>دليل حسابات العملاء</h2><div class="paging"><span>صفحة '''+str(number)+'''</span>'''+prev+nxt+'''</div></div>
<div class="grid">'''+''.join(cards)+'''</div>
<section class="new"><h2>إنشاء حساب جديد</h2><p class="hint">اختر اسم المستخدم وكلمة مرور قوية وتاريخ انتهاء الصلاحية. يبقى الحساب نشطًا حتى نهاية اليوم المحدد بتوقيت السعودية.</p>
<form method="post" action="/account/customers?page='''+str(number)+'''">
<input type="hidden" name="csrf" value="'''+csrf+'''">
<label>اسم المستخدم<input name="username" dir="ltr" required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}" maxlength="40" autocomplete="off"></label>
<label>كلمة المرور<input type="password" name="password" dir="ltr" required minlength="12" maxlength="72" autocomplete="new-password"></label>
<label>تنتهي الصلاحية في<input type="date" name="expires_on" required></label>
<button class="primary" name="action" value="create">إنشاء العميل</button></form></section>
<footer>معلومات الحساب من Supabase؛ ومعرّف الجهاز عشوائي وليس عنوان MAC. الأوقات بتوقيت السعودية، وتُحفظ ارتباطات الأجهزة على قرص الخادم الخاص.</footer>
</main></body></html>'''
    return HTMLResponse(markup,headers=HEADERS)
