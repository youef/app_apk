# العز TV — تشخيص رفض التثبيت على Android 4.4.4

## العطل المثبت في الإصدارات السابقة
كانت GitHub Actions تبني Android debug لكل تشغيل وتوقعه بمفتاح جديد، مع تثبيت الاسم التقني sa.aseel.tv.cinema، ولهذا قد تظهر INSTALL_FAILED_UPDATE_INCOMPATIBLE على الجهاز الذي يحوي إصدارًا سابقًا من الحزمة نفسها. بناء APK ناجح وتوقيعه صحيح لا يكفي لنجاح التحديث فوق حزمة بشهادة مغايرة.

## v4: حزمة مستقلة لا تمس النسخة القديمة
- Package: sa.alezz.tv.kitkat (جديد ولا يتعارض مع sa.aseel.tv.cinema).
- Label: العز TV.
- Android minSdk 19 / KitKat 4.4.4، Java 7 وDEX035، ARMv7، V1 JAR signature وV2.
- ملف واحد APK كامل، لا يتطلب Split APK أو Google Play Services.
- Content: نفس قاعدة Supabase وقنوات وأفلام العز TV — لا تغيير في قواعد البيانات.
- النسخ القديمة لا تُحذف ولا تُرقّى في مكانها؛ المفضلة المحلية المستقلة لا تُنقل تلقائيًا.

## التحميل الصحيح
استخدم al-ezz-tv-kitkat-install-v4.apk من صفحة Releases على GitHub. انسخ ملف APK نفسه إلى ذاكرة الشاشة أو فلاش USB، ولا تحاول تثبيت ZIP أو artifact مضغوط. فعّل السماح بتثبيت التطبيقات من مصادر غير معروفة في إعدادات الأمن (حسب دعم جهازك).

## إذا ظهر الرفض مجددًا
تحتاج رسالة Package Manager الدقيقة؛ وصّل الشاشة بالحاسوب عبر ADB ثم:
```bash
adb devices
adb shell getprop ro.build.version.release
adb shell getprop ro.product.cpu.abi
adb shell pm list packages | grep -E 'aseel|alezz'
adb install -r al-ezz-tv-kitkat-install-v4.apk
```
- INSTALL_FAILED_UPDATE_INCOMPATIBLE: يوجد تطبيق بنفس Package ID وتوقيع مختلف. لا تحذفه قبل نسخ بياناته.
- INSTALL_FAILED_NO_MATCHING_ABIS: المعالج لا يطابق ARMv7؛ يلزم APK بعمارة مختلفة.
- INSTALL_FAILED_OLDER_SDK: Android الفعلي أقدم من API 19.
- INSTALL_FAILED_INSUFFICIENT_STORAGE: تحرير مساحة من إعدادات الشاشة.
- INSTALL_PARSE_FAILED_NO_CERTIFICATES / UNEXPECTED_EXCEPTION: APK ناقص أو تالف، توقيع غير مقبول أو خلل مصنع في PackageManager؛ أعد تنزيل الملف نفسه وتحقق من SHA-256.
- INSTALL_FAILED_ALREADY_EXISTS: تطبيق بنفس المعرّف موجود؛ تحقق من توقيع النسخة والإصدار.

## توقيع ثابت للترقيات المستقبلية
لتحديث نفس التطبيق دون تعارض التواقيع، يجب إنشاء keystore خاص، والاحتفاظ بنسخة احتياطية مشفرة منه خارج المستودع العام، ثم ضبط أسرار المستودع:
- AL_EZZ_KEYSTORE_BASE64: base64 كامل ملف keystore المشفر.
- AL_EZZ_STORE_PASSWORD: كلمة مرور keystore.
- AL_EZZ_KEY_ALIAS: الاسم داخل keystore.
- AL_EZZ_KEY_PASSWORD: كلمة مرور المفتاح.

عند وجود جميع الأسرار، سير العمل يبني APK Release موقعًا دائمًا؛ وإلا سيبني APK Debug صالحًا للتثبيت النظيف فقط، ولا يمكن ضمان ترقيته فوق APK بتوقيع Debug سابق. لا تضع الأسرار في المستودع أو الرسائل.

**الحد:** لا يمكن التأكد من نجاح تثبيت تطبيق على الشاشة أو التوافق مع نظامها المعدل دون نتيجة تثبيت حقيقية من الشاشة؛ فحص GitHub يتأكد فقط من صحة بنية APK وبيانات التوافق.
