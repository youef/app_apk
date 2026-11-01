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

## التكامل مع Movie Catalog Studio 3.0 (نوفمبر 2026)
- أضيفت في قاعدة `smart-tv-plus` الأعمدة `aseel_movies.source_page_url` و`aseel_movies.imported_at` وفهرس فريد على رابط صفحة المصدر لمنع تكرار الاستيراد.
- استوديو Python يتصل بنفس `qyzmlwtvzzgooccqxglq` عبر مفتاح `publishable` وSupabase Auth لحساب مسؤول معتمد في `aseel_admins`، ولا يحتاج أي `service_role` ولا يحتفظ بكلمات المرور محليًا.
- خطوة **حفظ مسودة** ترسل بيانات الفيلم مباشرة إلى `aseel_movies` بحالة `draft` وحقوق `pending`؛ وتظهر في لوحة الإدارة للمعاينة والتعديل.
- أضيفت حقول **مصدر الحقوق** (`source_id`)، و**رابط صفحة الاستخراج** (`source_page_url`)، و**ترتيب الظهور** (`display_order`) إلى نموذج تحرير الأفلام في `admin/app.js`.
- بعد مراجعة الحقوق والدليل وتوافر رابط MP4/HLS أو YouTube رسمي، يستطيع المسؤول نشر الفيلم من لوحة الإدارة أو برنامج الاستيراد. يقرأ تطبيق المشاهدة وAndroid المحتوى من Supabase مباشرة عند التحديث دون الحاجة إلى إصدار APK جديد لكل فيلم.
- لا تُخزن نسخ الفيديو في Supabase، بل روابط تشغيلها وبياناتها فقط؛ اكتشاف رابط لا يمثل إثباتًا لحق البث.
- سياسات RLS لا تسمح للزائر بقراءة الفيلم إلا إذا كان منشورًا، معتمد الحقوق، وله وثيقة ترخيص غير منتهية ورابط تشغيل متاح.
- يوجد حاليًا حساب إدارة مفعل واحد (دون الكشف عن هويته). استخدم حسابه الفعلي لتسجيل الدخول.

## روابط المنصة
- لوحة الإدارة: https://youef.github.io/app_apk/admin/
- المشاهدة: https://youef.github.io/app_apk/web/
- صفحة سير نشر GitHub Pages: https://github.com/youef/app_apk/actions/workflows/admin-pages.yml

تغييرات GitHub تُفعّل سير نشر Pages الآلي؛ يجب التحقق من نجاح التشغيل قبل الجزم بظهور واجهة الإدارة المحدثة للزوار.
