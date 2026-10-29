# أسيل | لوحة إدارة المكتبة

واجهة ويب عربية ثابتة، تعمل بمفتاح Supabase **publishable** فقط وJWT محدود الصلاحيات. لا تحتوي على خدمة Backend خاصة أو مفاتيح service_role. الوصول إلى القوائم والتعديل محمي في PostgreSQL عبر RLS.

## نشر الموقع
- خيار GitHub Pages: **Repository Settings → Pages → Build and deployment → Source: GitHub Actions**. بعد تفعيل Pages يمكن تشغيل workflow `admin-pages.yml`. عادةً رابط الموقع `https://youef.github.io/app_apk/` لكنه لا يُعتبر فعالًا إلا بعد نجاح نشر Pages.
- خيار Vercel: ربط المستودع `youef/app_apk` بمشروع جديد وتعيين **Root Directory = admin** وFramework = Other/Static، ثم نشره. محاولة إنشاء المشروع آليًا واجهت خطأ صلاحية 403، ولذلك لم يُفعَّل بعد.

## تفعيل المسؤول أول مرة
1. افتح [Supabase Auth Users](https://supabase.com/dashboard/project/qyzmlwtvzzgooccqxglq/auth/users) وأنشئ حسابًا للمسؤول باستخدام بريدك الخاص (أو سجل الدخول بحساب موجود).
2. انسخ UUID لحساب المستخدم من Auth Users بعد تأكيد البريد.
3. باستخدام SQL Editor بصلاحيات إدارة المشروع، نفّذ (بعد استبدال `ACCOUNT_UUID` بالقيمة الفعلية):

```sql
insert into public.aseel_admins (user_id,active)
values ('ACCOUNT_UUID'::uuid, true)
on conflict (user_id) do update set active=true;
```

**لا تمنح الصلاحية لأي مستخدم مجهول.** لا يمكن لحساب عادي تعديل `aseel_admins` بنفسه عبر API.

## إجراء إضافة عمل مرخص
- أضف عنوانًا ووصفًا وتصنيفًا وصورة اختيارية ورابط فيديو HTTPS تملكه/مرخصًا.
- ابدأ بالحالة `draft` ثم راجع صاحب الحقوق ووثيقة الترخيص.
- اضبط `rights_status=approved` و`status=published` فقط عندما تكون الحقوق مؤكدة؛ وتُطبّق هذه الشروط أيضًا بواسطة قاعدة البيانات على عرض الجمهور.
- في حال انتهاء الترخيص يمكنك ضبط `rights_expires_at` ليختفي المحتوى تلقائيًا من الاستعلامات العامة.

## حماية الصور
- `aseel-posters` bucket عام للقراءة فقط. الرفع والتعديل والحذف يتطلب حساب Admin معتمد.
- الحجم الأقصى: 3MB، MIME: JPG/PNG/WebP.

لا تضف أي قائمة IPTV مقرصنة، أو مفاتيح إدارة إلى المستودع أو التطبيق.

## حالة النشر (29 أكتوبر 2026)
محاولة إنشاء المشروع `aseel-tv-admin` في فريق Vercel المتصل رُفضت بخطأ `403 Forbidden`؛ لم تُنشأ بيئة إنتاج. يمكن تفعيل **GitHub Pages** من إعدادات المستودع (Pages → Source: GitHub Actions) ثم تشغيل سير العمل `Aseel TV Admin - GitHub Pages` يدويًا. لا تدّعِ أن الرابط يعمل قبل تحقق نجاح النشر. حتى ذلك الوقت ملفات لوحة الإدارة موجودة في `admin/` وجاهزة للنشر، لكن جدول `aseel_admins` لا يضم مستخدمًا معتمدًا بعد.
