# أسيل | أفلام ومسلسلات (Aseel TV)

تطبيق Native Android TV بالعربية، مُصمم للشاشات القديمة بما فيها Android 4.4.4 / API 19. المستودع يحتوي على **APK تجريبي قابل للبناء** ولوحة إدارة ويب مستقلة وبيانات Supabase فعلية.

## الحالة الفنية — 2026-10-29
- كود Android: Java 7، دون Kotlin/AndroidX/Play Services، minSdk 19.
- بنيته: Android Gradle Plugin 7.4.2 / Gradle 7.6 / JDK 11 / compileSdk 28.
- GitHub Actions يبني APK ويفحص DEX 035 وV1 signature وManifest وZIP وABI.
- ملاحظة: نجاح CI لا يثبت نجاح التثبيت الفعلي أو جميع الصيغ وSSL على شاشة المستخدم.
- البنية الخلفية: Supabase project `smart-tv-plus` (`qyzmlwtvzzgooccqxglq`) **المستقل عن حيّنا**. جميع الجداول الجديدة تبدأ `aseel_`؛ الجداول القديمة لم تُحذف أو تُستخدم.
- النشر والإدارة: `admin/` لوحة إدارة ويب عربية بنظام JWT+RLS؛ تحتاج أولًا إلى تفعيل حساب مسؤول ثم نشرها عبر GitHub Pages أو Vercel.
- لا يضم المشروع محتوى مقرصنًا؛ توجد أعمال ومقاطع مفتوحة الترخيص ببيانات إسناد موثقة.

## تحديث المكتبة — 29 أكتوبر 2026
- تمت إضافة أفلام/مقاطع CC0 وCC BY 3.0 مرخّصة: Big Buck Bunny، إعلان Sintel، ومقطع زهرة MDN.
- تمت إضافة **مختارات سينمائية تجريبية** بموسم وحلقتين؛ ليست مسلسلًا تجاريًا ولا عملًا أصليًا من Blender.
- تمت إضافة قناة **تجريبية غير مباشرة** لاختبار تبويب القنوات؛ ليست قناة بث تلفزيوني حي.
- تم تعيين بوسترات رسمية مرخصة للفيلمين من Wikimedia Commons. مصادر الترخيص ونسب الحقوق: [docs/OPEN_CONTENT_LICENSES.md](docs/OPEN_CONTENT_LICENSES.md).
- يتضمن التطبيق تصنيفات وتصفية وبحثًا ومفضلة محلية ومتابعة آخر فيديو وانتقالًا للحلقة التالية.
- يمنع التخزين المؤقت للكتالوج إعادة استخدام البيانات لأكثر من 15 دقيقة عند انقطاع الاتصال.
- تم تقليل أذونات دور `anon` إلى **SELECT** على جداول الكتالوج العامة فقط، وتقييد حلقات الأعمال المنتهية الحقوق في RLS.
- **فحص ترخيص العمل لا يعني التحقق من قدرة شاشة Android 4.4 على فتح خادم الفيديو أو صورته.**
- لوحة الإدارة مبنية لكنها غير منشورة حاليًا؛ Vercel رفض إنشاء المشروع بخطأ صلاحيات 403. الحساب الإداري المعتمد لم يُعين بعد.

## إصلاح تشغيل الفيديو — الإصدار 1.0.1 (29 أكتوبر 2026)
- أجهزة Android 4.4/API 19: عند تشغيل MP4 HTTPS، يمرّر `LegacyStreamProxy` طلبات الفيديو عبر خادم محلي مقيد إلى `127.0.0.1` مع نقل TLS 1.2 إلى المصدر. يُحافظ على التحقق الحقيقي من شهادة HTTPS واسم المضيف دون تعطيل الأمان، ويدعم طلبات Range وHTTP 206 للاستكمال والتقدم.
- Android 5+: يظل المسار الأصلي HTTPS عبر `VideoView`.
- تظهر للمشاهد شفرة خطأ MediaPlayer، إصدار Android وطريقة التشغيل، وكذلك خطأ الشبكة في الـProxy عند حصوله.
- لا تُفتح منافذ على الشبكة المحلية؛ يُستخدم منفذ عشوائي وToken خاص لكل جلسة، وتغلق الموارد عند خروج المشغل.
- **تنبيه:** هذا يصلح مسار الاتصال المحتمل، لكنه لا يضيف Decoder مفقودًا ولا يضمن أن سيرفر المصدر متاح. نتائج Appetize لا تعوّض اختبار شاشة KitKat.
- ملف البناء التجريبي قد يختلف توقيعه عن APK سابق. لا تحذف النسخة القديمة أو بياناتها دون نسخ احتياطي وموافقة.

## وظائف التطبيق
- الرئيسية، الأفلام، المسلسلات، الحلقات، القنوات، المفضلة، البحث، والإعدادات.
- تحكم الأسهم وOK، تمييز العناصر المحددة، واجهة عربية RTL، وضع أفقي مناسب لـ720p/1080p/4K.
- كتالوج يتجدد دون إعادة تثبيت APK، مع Cache للبيانات عند انقطاع الشبكة.
- صور HTTPS تُحمّل بالخلفية مع قيود على الحجم والذاكرة.
- تشغيل فيديو Native باستخدام VideoView / MediaPlayer، MP4/H.264/AAC هو الخيار المفضل.
- HLS متوقف على نظام العرض والـDecoder الفعلي؛ لا يمكن ضمانه على Android 4.4.4.
- موضع المشاهدة والمفضلة يُحفظان محليًا على الجهاز، مع اختصار لاستكمال آخر مشاهدة. مزامنة حساب المشاهد إلى Supabase ليست مفعلة بعد.
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

## المحتوى وتحديثه تلقائيًا — أكتوبر 2026
- تمت إضافة أفلام Blender مفتوحة الترخيص: Elephants Dream، Agent 327، Coffee Run، فيلم Sintel الكامل، Glass Half، Tears of Steel، Spring، Sprite Fright، إلى جانب Big Buck Bunny ومقطع Sintel الدعائي واختبار MDN.
- المسلسلات/المختارات تشمل Caminandes (حلقتان)، Cosmos Laundromat (حلقة تجريبية واحدة)، ومختارات اختبارية سابقة. لا تُنشأ حلقات غير موجودة.
- القنوات: رابط NASA Live وNASA+ الرسميان، إلى جانب قناة اختبار مسجلة بوضوح. وصلات NASA تفتح موقع الجهة ولا تعيد بث القناة.
- Android يجلب الكتالوج من Supabase دورياً كل 5 دقائق أثناء عرض التطبيق، ويحدّثه عند العودة إليه بعد الفترة نفسها. iOS يعيد جلب المحتوى كل 5 دقائق مع البحث والمفضلة والحلقات.
- لا تُنشر أعمال جديدة تلقائيًا دون التأكد من الحقوق؛ الإدارة وحدها تتحكم بالحالة المنشورة.
- تعذر اختبار توافق فيديوهات 720p على جهاز Android 4.4.4 الفعلي؛ قد تحتاج بعض الفيديوهات صيغة أخف أو شهادات HTTPS أحدث.
- نسخة iOS التجريبية صُممت **لمحاكي iPhone/Appetize** فقط: https://github.com/youef/app_apk/releases/tag/aseel-ios-simulator-preview
- لربط Appetize بتحديثات GitHub تلقائياً أضف Secrets: APPETIZE_API_TOKEN وAPPETIZE_IOS_PUBLIC_KEY وAPPETIZE_ANDROID_PUBLIC_KEY. يرفع سير العمل نسخًا جديدة للتطبيق الموجود فقط عند وجود المفتاح والرمز؛ يظل البناء والنشر على GitHub يعملان دونها.

## Verified media sources — 29 October 2026
A scheduled GitHub Actions probe downloads a true MP4 byte range and checks the ISO BMFF ftyp signature; a separate check follows HLS master/variant playlists and downloads 4096 bytes of an actual TS/fMP4 media segment.
- Older Blender webseed URLs had HTTP 404 or HTML rather than playable video; these items were hidden from the public Supabase catalog without deleting their database records.
- Published 15 archive-sourced silent-film files (from original 1914–1929 works) after byte-range checks. Musical scores/new remasters may have separate copyright and require review.
- Published nine HLS live-channel pointers whose media segment fetched successfully on the CI runner; streams can change or be geographically restricted.
- Android 4.4: Native VideoView HLS depends on device support. The player exposes an explicit external HLS-player launch and an official broadcaster web fallback. Do not claim this is verified on an Android 4.4 TV.
- iOS: AVPlayer uses the verified channel m3u8 URLs directly.
- Run these audits under GitHub Actions for fresh reports: Aseel Media URL Health Audit and Aseel Real HLS Segment Audit.
