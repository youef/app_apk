# أسيل | أفلام ومسلسلات — Aseel TV

**المرحلة الأولى فقط:** اختبار تثبيت وتشغيل APK دون اتصال على Android TV 4.4.4 (API 19).

هذه الشفرة جديدة من الصفر. لا تعتمد على أي ملفات أو شفرات أو إعدادات من المشروع السابق.

## الجهاز المستهدف
- Huidi Smart SMART_PC822، لوحة CVTE
- Android 4.4.4 / API 19
- ARM Cortex-A7، ثنائي النواة، 32-bit
- Kernel 3.10.40
- RAM / الدقة / Build fingerprint: يتم قياسها محليًا عبر زر «عرض مواصفات هذه الشاشة».

## البناء
- Native Android / Java 7 source + target، بلا Kotlin أو Compose أو AndroidX
- Android Gradle Plugin 7.4.2، Gradle 7.6، JDK 11
- compileSdk 28، minSdk 19، targetSdk 28، Build Tools 33.0.2
- applicationId ثابت: `sa.aseel.tv`
- APK debug موقّع V1 وV2؛ الأقدم يعتمد V1.
- بلا `INTERNET`، بلا Native `.so`، بلا تبعيات خارجية.
- دعم ريموت D-pad وOK والخروج؛ وعرض معلومات الجهاز.

### Build
```bash
gradle clean assembleDebug
python3 scripts/verify_apk.py app/build/outputs/apk/debug/app-debug.apk
```
تتطلب أوامر التحقق متغير `ANDROID_HOME` ووجود Build Tools 33.0.2.

### تنزيل APK
بعد اكتمال GitHub Actions بنجاح:
- من **Releases**: الإصدار التجريبي `aseel-tv-phase1-install-test` وفيه APK مباشرة.
- من **Actions**: Artifact مع APK وتقرير الفحص وسجل البناء.

> نجاح البناء لا يعني نجاح التثبيت أو التشغيل على التلفزيون. لا تتقدم لأي مرحلة أخرى قبل نجاح الاختبار الفعلي.

## تنبيه التوقيع
هذه نسخة تثبيت تجريبية موقعة بمفتاح debug مؤقت يُنشئه GitHub Runner. النسخ التي تُبنى على Runner آخر قد تختلف شهادة توقيعها؛ لا يمكن تحديثها فوق هذه النسخة إلا مع نفس مفتاح التوقيع. بعد نجاح المرحلة الأولى، أنشئ مفتاح إصدار دائمًا واحفظه في أسرار GitHub قبل أي مسار تحديث إنتاجي. لا تحفظ مفاتيح التوقيع داخل المستودع.

## حدود المرحلة
لا توجد حاليًا قاعدة بيانات أو تسجيل دخول أو لوحة إدارة أو قنوات أو فيديو أو اتصال شبكة. هذه متطلبات المراحل القادمة بعد إثبات التثبيت.
