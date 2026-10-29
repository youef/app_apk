# أسيل | أفلام ومسلسلات (Aseel TV)

تطبيق Native Android TV بالعربية، مُصمم للشاشات القديمة بما فيها Android 4.4.4 / API 19. المستودع يحتوي على **APK تجريبي قابل للبناء** ولوحة إدارة ويب مستقلة وبيانات Supabase فعلية.

## الحالة الفنية — 2026-10-29
- كود Android: Java 7، دون Kotlin/AndroidX/Play Services، minSdk 19.
- بنيته: Android Gradle Plugin 7.4.2 / Gradle 7.6 / JDK 11 / compileSdk 28.
- GitHub Actions يبني APK ويفحص DEX 035 وV1 signature وManifest وZIP وABI.
- ملاحظة: نجاح CI لا يثبت نجاح التثبيت الفعلي أو جميع الصيغ وSSL على شاشة المستخدم.
- البنية الخلفية: Supabase project `smart-tv-plus` (`qyzmlwtvzzgooccqxglq`) **المستقل عن حيّنا**. جميع الجداول الجديدة تبدأ `aseel_`؛ الجداول القديمة لم تُحذف أو تُستخدم.
- النشر والإدارة: `admin/` لوحة إدارة ويب عربية بنظام JWT+RLS؛ تحتاج أولًا إلى تفعيل حساب مسؤول ثم نشرها عبر GitHub Pages أو Vercel.
- لا يضم المشروع محتوى مقرصنًا؛ يوجد مقطع تجريبي قصير CC0 فقط.

## وظائف التطبيق
- الرئيسية، الأفلام، المسلسلات، الحلقات، القنوات، المفضلة، البحث، والإعدادات.
- تحكم الأسهم وOK، تمييز العناصر المحددة، واجهة عربية RTL، وضع أفقي مناسب لـ720p/1080p/4K.
- كتالوج يتجدد دون إعادة تثبيت APK، مع Cache للبيانات عند انقطاع الشبكة.
- صور HTTPS تُحمّل بالخلفية مع قيود على الحجم والذاكرة.
- تشغيل فيديو Native باستخدام VideoView / MediaPlayer، MP4/H.264/AAC هو الخيار المفضل.
- HLS متوقف على نظام العرض والـDecoder الفعلي؛ لا يمكن ضمانه على Android 4.4.4.
- موضع المشاهدة والمفضلة يُحفظان محليًا على الجهاز. مزامنة حساب المشاهد إلى Supabase ليست مفعلة بعد.
- TLS 1.2 يُفعّل لاتصالات الكتالوج والصور عندما يتوفر، مع التحقق الطبيعي من الشهادة واسم المضيف؛ MediaPlayer يتحكم باتصال الفيديو وفق النظام.
- «الإعدادات» تعرض مواصفات الشاشة الفعلية ومقطع اختبار MP4 قصير CC0 مرخّص من MDN.

## تنزيل APK
[GitHub Release — Aseel TV Full Beta Android 4.4](https://github.com/youef/app_apk/releases/tag/aseel-tv-full-beta-api19)

اسم ملف الإصدار: `aseel-tv-api19-full-beta.apk`، اختبار تجريبي لا إصدار إنتاج نهائي.

**مهم جدًا:** GitHub Runner يوقّع Debug بمفتاح مؤقت مختلف بين بعض عمليات البناء، ولذلك قد يرفض الهاتف/التلفزيون ترقية النسخة السابقة فوقها بخطأ `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. يلزم مفتاح توقيع ثابت محفوظ ضمن GitHub Actions Secrets للإصدارات النهائية. لا تحذف نسخة مثبتة أو بياناتها إلا بعد عمل نسخة احتياطية وموافقتك.

## قاعدة البيانات وإدارة الحقوق
جداول Supabase الجديدة:
`aseel_movies`, `aseel_series`, `aseel_seasons`, `aseel_episodes`,
`aseel_channels`, `aseel_categories`, `aseel_favorites`,
`aseel_watch_progress`, `aseel_settings`, `aseel_content_sources`, `aseel_admins`.

المشاهد العام لا يرى سوى الأعمال ذات الحالة `published` والحقوق `approved` ووثيقة الترخيص وHTTPS فعال. الأعمال منتهية الترخيص مخفية. الإدارة تتطلب عضوية موثقة في `aseel_admins`. الصور داخل `aseel-posters` تُكتب من حساب إدارة فقط.

**تفعيل الإدارة:** انظر [admin/README.md](admin/README.md).

## البناء والتحقق
```bash
# Requires Android SDK platform 28 + build-tools 33.0.2, JDK 11, Gradle 7.6
gradle clean assembleDebug
python3 scripts/verify_apk.py app/build/outputs/apk/debug/app-debug.apk
```
التقارير الكاملة وملف APK موجودة داخل GitHub Actions.

## قائمة اختبارات الجهاز
انظر [docs/BETA_TEST.md](docs/BETA_TEST.md). لا يمكن اعتبار التطبيق مثبتًا أو مشغلًا بنجاح على Huidi Smart SMART_PC822 بدون نتيجة من التلفزيون نفسه.

## الحدود التي تحتاج تحققًا قبل الإنتاج
1. التثبيت على الشاشة الحقيقية واختبار الريموت وMP4 وTLS واستهلاك الذاكرة.
2. اعتماد مفتاح توقيع إصدار مستقر بدل مفتاح Debug المؤقت.
3. تعيين مسؤول موثوق ثم نشر لوحة الإدارة؛ نشر Vercel رُفض بالصلاحيات، وPages يحتاج تفعيلًا يدويًا.
4. إدخال أعمال مرخصة ومُتحقق من روابطها. المقطع الحالي مجرد اختبار.
5. لم تُفعّل مزامنة مستخدم المشاهدة عبر حساب، أو تبديل الجودة متعدد المصادر؛ لا تدّعِ أن هذه العناصر جاهزة.
