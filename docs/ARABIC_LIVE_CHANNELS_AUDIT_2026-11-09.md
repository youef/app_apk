# تدقيق مصادر القنوات العربية — AL EZZ TV
**تاريخ العمل:** 9 نوفمبر 2026

## نطاق التنفيذ
ثمانية عناوين HLS من قائمة البحث السابقة. قوائم IPTV-org الشاملة (المئات/الآلاف) **لم تُعتمد أو تُستورد آليًا**، لأن توفر الرابط لا يعني ثبوت حقوق إعادة توزيعه. بياناتها وفهارسها ذات شروط مستقلة عن حقوق القنوات.

## التحقق الفني
- فحص GitHub Actions: https://github.com/youef/app_apk/actions/runs/42697237382
- **8 / 8**: استجابة HTTP 200 وملف M3U8 قابل للتحليل يوم 2026-11-09.
- الفحص يعالج ملف manifest فقط، ولا يضمن وصول المقاطع، أو الصوت والصورة، أو فك الترميز على جهاز المستخدم، أو استمرار الرابط.
- **الفحص الموسّع نجح 8/8:** تعرّف `ffprobe` على فيديو H.264 وصوت AAC في المصادر الثمانية يوم 2026-11-09 (قراءة محدودة ولا تعني تشغيلًا مستمرًا على شاشة المستخدم).\n- التقرير المباشر: https://github.com/youef/app_apk/actions/runs/42698478969

| القناة | عنوان HLS | حالة قاعدة البيانات عند الجرد |
|---|---|---|
| القرآن الكريم السعودية | https://cdn-globecast.akamaized.net/live/eds/saudi_quran/hls_roku/index.m3u8 | كان منشورًا مسبقًا |
| السنة النبوية | https://cdn-globecast.akamaized.net/live/eds/saudi_sunnah/hls_roku/index.m3u8 | كان منشورًا مسبقًا |
| السعودية الأولى | https://shd-gcp-live.edgenextcdn.net/live/bitmovin-saudi-tv/2ad66056b51fd8c1b624854623112e43/index.m3u8 | كان منشورًا مسبقًا |
| العربية | https://live.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8 | أضيفت مسودة HLS (الحقوق قيد المراجعة) |
| الحدث | https://av.alarabiya.net/alarabiapublish/alhadath.smil/playlist.m3u8 | أضيفت مسودة HLS (الحقوق قيد المراجعة) |
| الشرق الوثائقية | https://svs.itworkscdn.net/asharqdocumentarylive/asharqdocumentary.smil/playlist_dvr.m3u8 | كان منشورًا مسبقًا؛ أُخفي تكرار لنفس الرابط |
| TRT عربي | https://tv-trtarabi.medya.trt.com.tr/master.m3u8 | كان منشورًا مسبقًا |
| رؤيا TV | https://live.kwikmotion.com/royatvpublic/royatv.smil/playlist.m3u8 | HLS مسودة؛ توجد بطاقة منشورة تفتح الصفحة الرسمية |

## التغييرات المنشورة في قاعدة البيانات
- أضيفت 2 من روابط الصفحات الرسمية لقناتي العربية والحدث، ببث خارجي فقط: `playback_mode=official_link`, `stream_url=NULL`, `rights_status=pending`.
- أضيفت 2 من روابط HLS كمصادر مسودة: `status=draft`, `rights_status=pending`.
- رُبطت المصادر الخمسة المنشورة سابقًا بصفحات الناشرين الرسمية دون تغيير موافقات الحقوق القديمة.
- عُدّل قيد قاعدة البيانات للسماح بنشر **رابط رسمي خارجي** حتى مع انتظار موافقة إعادة بث الفيديو، دون تغيير شرط نشر مصدر HLS.
- اختُبرت سياسة RLS باستخدام دور `anon`: تظهر بطاقتا العربية والحدث كرابطين خارجيين.
- نُشر كود Android TV لفتح هذين الرابطين الخارجيين بدلاً من إرسال عنوان صفحة ويب إلى مشغل HLS.

## حدود الحقوق
- موافقة مسؤول تطبيق العز على **إدراج الرابط** لا تساوي موافقة الناشر الأصلي على إعادة البث.
- شروط رؤيا تشترط موافقة مكتوبة لإعادة بث محتواها: https://en.roya.tv/terms
- شروط الأولى تحمي المحتوى من إعادة التوزيع دون موافقة خطية: https://aloula.sba.sa/info/terms_of_use
- ترخيص CC0 في مشروع IPTV-org يخص بياناته، وليس حقوق البث التلفزيوني: https://github.com/iptv-org/iptv
- علامات الحقوق القديمة `approved` أو المرجع `0` في السجلات السابقة ليست بذاتها دليلًا على ترخيص قانوني.
- لا ترفع `status` لمصادر HLS الجديدة إلى `published` أو تبدل `rights_status` إلى `approved` دون توثيق ترخيص الناشر.

## روابط التحقق
- صفحة العرض: https://youef.github.io/app_apk/web/
- الإدارة: https://youef.github.io/app_apk/admin/
- CI Android TV: https://github.com/youef/app_apk/actions/workflows/android.yml
