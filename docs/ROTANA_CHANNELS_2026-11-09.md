# قنوات روتانا في العز TV — 9 نوفمبر 2026

## التنفيذ في قاعدة البيانات
- القسم: `قنوات روتانا` في `public.aseel_categories`، معرفه `d5b25347-5aac-4df9-8731-736cf13f4681`.
- الموجود حاليًا: 11 سجل قناة في `public.aseel_channels`.
- أضيفت 5 سجلات جديدة دون تكرار: روتانا سينما مصر، روتانا كليب، روتانا ميوزك، الرسالة، وLBC.
- روتانا كوميدي كانت موجودة من قبل؛ حُدّث شعارها ورابطها الرسمي.
- استُبدلت الروابط غير الرسمية لروتانا سينما وخليجية ودراما وكلاسيك بروابط دليل البث الرسمي.
- سجل روتانا كيدز القديم احتُفظ به؛ لم تَرِد ضمن قائمة القنوات الرسمية التي روجعت.
- `published` للقنوات أعلاه يعني وجود **روابط صفحات الناشر الخارجي**، لا تصريحًا بإعادة بث المحتوى داخل العز.
- التشغيل الحالي `playback_mode=official_link` مع `stream_url=NULL`. قيمة `rights_status=approved` تعني قبول إدراج **رابط التصفح** فقط، وليست إثبات حقوق HLS.

## روابط الناشر
- صفحة القنوات: https://rotana.net/en/channels
- دليل البث المباشر: https://rotana.net/en/streams
- روتانا كوميدي مباشرة في الموقع: https://rotana.net/en/channels#/live/rotana-comedy

## مصادر HLS التي قدّمها صاحب المشروع للفحص (غير منشورة كمصادر بث معتمدة)
المسار الرئيسي الذي تشير إليه صفحات وأدلة القنوات العامة:
```text
https://rotana.hibridcdn.net/rotananet/comedy_net-7Y83PP5adWixDF93/playlist.m3u8
```
البدائل الخاصة بجودة روتانا كوميدي لنفس القناة (ليست قنوات مستقلة):
```text
240p https://rotana.hibridcdn.net/rotananet/comedy_net-7Y83PP5adWixDF93/rotana/comedy_240p/chunks.m3u8
480p https://rotana.hibridcdn.net/rotananet/comedy_net-7Y83PP5adWixDF93/rotana/comedy_480p/chunks.m3u8
```
- رابط قائمة الجودة الرئيسي أُزيلت منه معاملات التتبع غير الضرورية عند تسجيله في هذا المستند؛ لا يعني ذلك نجاح التشغيل بدونها.
- الرابط `https://embed.hibridstreaming.com/video/undefined/chapters` يحتوي على `undefined`، وهو مسار للفصول غير صالح للاعتماد كرابط فيديو.
- بعض المصادر مقيّدة جغرافيًا أو تعتمد على متصفح الناشر. فحص `#EXTM3U` وتشغيل مقطع وحيد فعليًا وCORS وتوافق Android TV لم تؤكَّد من بيئة التنفيذ.
- لا تعتمد المصادر كـ `stream_url` و`rights_status=approved` لإعادة البث إلا بعد التأكد من الإذن الصحيح واختبار تشغيل مباشر من الجهاز.

## واجهة العز
- `web/js/live.js`: يجمع كل سجلات `قنوات روتانا` تحت شركة «روتانا»، ويُرتبها أبجديًا.
- `ChannelGuideCategory.java`: يجمعها في دليل Android TV بحسب الشبكة حتى لو كان اسم القناة «LBC» أو «الرسالة».
- `TVHomeActivity.java`: يسمح بفتح `https://rotana.net/` و`https://www.rotana.net/` كروابط ناشر خارجية مقيدة بنطاقات محددة.

## مصادر توثيق الأسماء
- القنوات الرسمية: https://rotana.net/en/streams
- فهرس القنوات: https://rotana.net/en/channels
