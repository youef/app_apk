# أسيل | أفلام ومسلسلات — Aseel TV

## المرحلة الأولى — اختبار تثبيت Android 4.4.4 (API 19)

تطبيق Android Native **جديد من الصفر** للاختبار دون اتصال أو Supabase أو مشغل فيديو أو مكتبات خارجية.

- Package: `com.aseel.tv`
- minSdk 19; targetSdk 28; compileSdk 33
- Java source/target 7; AGP 7.4.2; Gradle 7.5; JDK 11 for CI
- توقيع Debug بواسطة V1 (للأجهزة القديمة) وV2 (للأحدث). **ليس مفتاح إنتاج**.
- لا يطلب صلاحية الإنترنت.
- LAUNCHER / LEANBACK_LAUNCHER؛ لا يلزم توفر شاشة لمس.

### البناء
تحتاج JDK 11 وAndroid SDK Platform 33 وBuild Tools 33.0.2 وGradle 7.5.

```bash
gradle clean assembleDebug --no-daemon --stacktrace
python3 scripts/validate_apk.py app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions ينشر APK اختبار، تقرير فحوص وبصمة SHA-256 بعد نجاح البناء، في GitHub Releases كإصدار تجريبي. يحفظ فحوص النجاح والفشل في Artifacts.

### اختبار التلفزيون الحقيقي

1. حمّل `Aseel-TV-API19-TEST.apk` من آخر إصدار تجريبي ناجح في GitHub Releases.
2. فعّل تثبيت التطبيقات من «مصادر غير معروفة» عند الحاجة.
3. إذا كان `com.aseel.tv` مثبّتًا بتوقيع مختلف: **احفظ البيانات المهمة أولًا** ثم أزل الإصدار السابق قبل تثبيت هذا الاختبار، وإلا قد يظهر `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
4. افتح تطبيق أسيل؛ يجب أن يظهر «تم تشغيل اختبار أسيل دون إنترنت بنجاح».
5. انتقل باستخدام أسهم الريموت بين زري «اختبار زر OK» و«خروج»، واضغط OK. ستظهر رسالة نجاح الاختبار.
6. أرسل نتيجة التثبيت والتشغيل والتنقل. عند الفشل أرسل رسالة النظام أو Package Manager مع اسم/طراز التلفزيون.

**نجاح GitHub Actions لا يُثبت نجاح التثبيت الفعلي. لا تبدأ المرحلة الثانية حتى التأكد من الجهاز الحقيقي.**
