## الاستيراد من الآيفون أو لوحة الإدارة

افتح [استيراد الكتالوج الجماعي](https://app-apk-oquy.onrender.com/admin/catalog-import.html) بعد تسجيل الدخول بصلاحية المسؤول. اختر ملف JSON من تطبيق «الملفات»، ثم اضغط **فحص الملف ومعاينته** لمراجعة عدد الأعمال والمواسم والحلقات. بعد إقرارك بأن الملف مرخّص، اضغط **استيراد كمسودات**. يمكنك إيقاف الاستيراد بعد انتهاء الطلب الجاري، وتنزيل تقرير CSV بنتيجة كل مسلسل.

الصفحة الجديدة تستخدم مفتاح Supabase publishable وجلسة المسؤول الحالية، وتخضع لـ RLS. لا تستخدم كلمات مرور أو مفاتيح خاصة داخل JSON. تقبل 500 مسلسل و30,000 حلقة بحد أقصى وملفًا حتى 15 ميغابايت. روابط الحلقات غير إلزامية؛ لا تستنتج الصفحة أي رابط من أرقام الحلقات أو مصادر الويب. جميع الأعمال والحلقات الجديدة تظل **draft / pending / unchecked**. وعند العثور على سجلات منشورة مسبقًا، تحتفظ بها دون تعديل أو إعادة نشر.

التعديلات في GitHub: `admin/catalog-import.html` و`admin/catalog-import.js`، والاختبار `tests/catalog-import-smoke.cjs`. يشغّل `.github/workflows/authorized-catalog-tests.yml` اختبارات Python وJavaScript.

# العز TV — الاستيراد الجماعي للكتالوجات المرخّصة

تقبل أداة `scripts/import_authorized_series.py` ملف JSON يرسله صاحب حقوق البث أو مزوّد المحتوى المرخّص. لا تزحف الأداة إلى أي موقع ولا تستخرج بثًا أو روابط من صفحات خارجية ولا تتجاوز DRM.

## مثال: `licensed-series.json`

```json
{
  "series": [
    {
      "title_ar": "مسلسل مرخّص",
      "release_year": 2026,
      "country_code": "SA",
      "description": "وصف صاحب المحتوى",
      "poster_url": "https://licensed-cdn.example.com/poster.jpg",
      "backdrop_url": "https://licensed-cdn.example.com/backdrop.jpg",
      "source_page_url": "https://licensed-cdn.example.com/series/123",
      "genre_tags": ["drama"],
      "seasons": [
        {
          "number": 1,
          "episodes": [
            {"number": 1, "stream_url": "https://licensed-cdn.example.com/ep1.m3u8"},
            {"number": 2, "stream_url": "https://licensed-cdn.example.com/ep2.m3u8"}
          ]
        }
      ]
    }
  ]
}
```

يمكن جمع مئات الأعمال ومواسمها في ملف واحد. ضع الروابط الحقيقية فقط؛ لا تخمّن عنوان البث من رقم الحلقة. يمكن ترك `stream_url` فارغًا لحفظ البيانات دون تشغيل.

## الاستخدام

```bash
python3 scripts/import_authorized_series.py licensed-series.json
```

هذا الأمر يعرض عدد المسلسلات والمواسم والحلقات ويتحقق من التنسيق **دون تعديل Supabase**.

عندما يكون الكتالوج مرخّصًا ويملك المستخدم جلسة مسؤول في Supabase Auth:

```bash
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
export SUPABASE_PUBLISHABLE_KEY='YOUR_PUBLISHABLE_KEY'
export SUPABASE_ACCESS_TOKEN='YOUR_ADMIN_ACCESS_TOKEN'
python3 scripts/import_authorized_series.py licensed-series.json --apply
```

- يستخدم `publishable key` مع رمز مستخدم الإدارة؛ لا تخزن `service_role` في المتصفح أو المستودع.
- يعتمد على RLS ويوقف العملية عند رفض صلاحيات قاعدة البيانات.
- كل سجل جديد `draft` و`pending`، وروابط التشغيل `unchecked`؛ لا يتم النشر أو منح صلاحية بث تلقائيًا.
- يمنع تكرار أرقام المواسم والحلقات داخل الملف. وعند وجود عمل/موسم/حلقة مسبقًا يتركه دون تغيير، للحفاظ على حالة النشر وسجل المشاهدة.
- بعد المراجعة يمكن اعتماد المصادر والحقوق والتحقق من المشغل ثم النشر من [إدارة العز TV](https://youef.github.io/app_apk/admin/).
- إن كانت شروط مزود المحتوى تمنع الكشط أو إعادة التوزيع، فلا تستخدم الاستخراج الآلي. اطلب تصدير كتالوج رسميًا أو API مرخّصًا أو اتفاقية إعادة بث.

اختبارات: `python3 -m unittest discover -s tests -p 'test_authorized_series_import.py' -v`.
