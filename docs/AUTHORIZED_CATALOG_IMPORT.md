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
