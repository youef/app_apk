/* ==========================================================================
   AL EZZ Studio — configuration
   Only publishable Supabase values live here (safe for the browser).
   The schema mirrors the production database used by the viewer app.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- static select options ---------- */
  var OPTIONS = {
    status: [['published', 'منشور'], ['draft', 'مسودة']],
    rights: [['pending', 'قيد المراجعة'], ['approved', 'تم التحقق من الحقوق'], ['rejected', 'مرفوض']],
    quality: [['SD', 'SD'], ['HD', 'HD'], ['FHD', 'FHD'], ['4K', '4K']],
    genres: [["action","أكشن"],["adventure","مغامرات"],["animation","كرتون"],["anime","أنمي"],["biography","سيرة ذاتية"],["comedy","كوميديا"],["crime","جريمة"],["documentary","وثائقي"],["drama","دراما"],["education","تعليمي"],["family","عائلي"],["fantasy","فانتازيا"],["history","تاريخي"],["horror","رعب"],["kids","أطفال"],["mystery","غموض"],["nature","طبيعة"],["romance","رومانسي"],["scifi","خيال علمي"],["science","علوم"],["short","قصير"],["sports","رياضة"],["thriller","إثارة"],["war","حرب"],["western","ويسترن"],["music","موسيقي"],["classic","كلاسيكي"]],
    age: [['all', 'مناسب للجميع'], ['7+', '7+'], ['13+', '13+'], ['16+', '16+'], ['18+', '18+']],
    movieCountries: [
      ['SA','السعودية'],['EG','مصر'],['TR','تركيا'],['US','الولايات المتحدة'],
      ['GB','بريطانيا'],['KR','كوريا الجنوبية'],['IN','الهند'],['JP','اليابان'],
      ['CN','الصين'],['FR','فرنسا'],['DE','ألمانيا'],['ES','إسبانيا'],
      ['IT','إيطاليا'],['AE','الإمارات'],['KW','الكويت'],['MA','المغرب'],
      ['NL','هولندا'],['CA','كندا'],['AU','أستراليا'],['BR','البرازيل'],
      ['MX','المكسيك'],['RU','روسيا'],['PK','باكستان'],['ID','إندونيسيا']
    ],
    topic: [
      ['letters', 'الحروف'], ['numbers', 'الأرقام'], ['animals', 'الحيوانات'],
      ['colors', 'الألوان والأشكال'], ['stories', 'القصص'], ['songs', 'أناشيد وحركة'],
      ['science', 'العلوم']
    ],
    playback: [
      ['stream', 'بث مباشر مرخّص'], ['youtube_embed', 'يوتيوب رسمي'], ['official_link', 'رابط رسمي خارجي']
    ]
  };

  var TOPIC_LABELS = {};
  OPTIONS.topic.forEach(function (entry) { TOPIC_LABELS[entry[0]] = entry[1]; });

  /* ---------- shared field definitions ----------
     type: text | textarea | number | url | date | select | checkbox | variants
     group: basic | media | playback | rights | meta
     source: dynamic option source (loaded from Supabase)               */
  var F = {
    /* identity */
    title_ar: { key: 'title_ar', label: 'العنوان العربي', type: 'text', group: 'basic', required: true, max: 250, placeholder: 'عنوان العمل بالعربية' },
    title_original: { key: 'title_original', label: 'العنوان الأصلي', type: 'text', group: 'basic', max: 250, placeholder: 'Original title' },
    description: { key: 'description', label: 'الوصف', type: 'textarea', group: 'basic', max: 2000, span: 2, rows: 4 },
    release_year: { key: 'release_year', label: 'سنة الإنتاج', type: 'number', group: 'basic', min: 1880, max: 2100, placeholder: '2024' },
    category_id: { key: 'category_id', label: 'التصنيف', type: 'select', group: 'basic', source: 'categories', emptyLabel: 'بدون تصنيف' },
    genre_tags: { key: 'genre_tags', label: 'التصنيفات الإضافية', type: 'tags', group: 'basic', span: 2,
      hint: 'تُكتشف الأنواع تلقائيًا عند الحفظ من العنوان والوصف والتصنيف. يمكنك تحديد أنواع إضافية أو تصحيحها يدويًا.' },
    duration_minutes: { key: 'duration_minutes', label: 'المدة (دقائق)', type: 'number', group: 'basic', min: 1, max: 99999 },
    language_code: { key: 'language_code', label: 'رمز اللغة', type: 'text', group: 'basic', max: 3, default: 'ar', placeholder: 'ar', hint: 'حرفان أو ثلاثة لاتينية: ar / en / tr' },
    country_code: { key: 'country_code', label: 'رمز الدولة', type: 'text', group: 'basic', max: 2, placeholder: 'SA', hint: 'حرفان لاتينيان: SA / TR / US' },
    quality: { key: 'quality', label: 'الجودة', type: 'select', group: 'basic', options: 'quality', default: 'SD' },
    age_rating: { key: 'age_rating', label: 'الفئة العمرية', type: 'select', group: 'basic', options: 'age', default: 'all' },
    is_kids: { key: 'is_kids', label: 'مخصص للأطفال', type: 'checkbox', group: 'meta' },
    featured: { key: 'featured', label: 'محتوى مميز', type: 'checkbox', group: 'meta' },
    display_order: { key: 'display_order', label: 'ترتيب الظهور', type: 'number', group: 'meta', min: 0, max: 99999, emptyZero: true },

    /* media */
    poster_url: { key: 'poster_url', label: 'رابط البوستر (HTTPS)', type: 'url', group: 'media', hint: 'نسبة 2:3 — يظهر في المكتبة وبطاقات المحتوى.' },
    backdrop_url: { key: 'backdrop_url', label: 'رابط الخلفية (HTTPS)', type: 'url', group: 'media' },

    /* playback */
    stream_url: { key: 'stream_url', label: 'رابط التشغيل (MP4 / HLS / Embed)', type: 'url', group: 'playback', hint: 'مصدر HTTPS مباشر أو مشغل Embed مسموح (مثل hanerix.com/e/…).' },
    youtube_url: { key: 'youtube_url', label: 'رابط يوتيوب الرسمي', type: 'url', group: 'playback' },
    stream_variants: { key: 'stream_variants', label: 'جودات إضافية', type: 'variants', group: 'playback', span: 2, hint: 'حتى 8 جودات، وكل جودة تحتاج اسمًا ورابط HTTPS.' },
    source_id: { key: 'source_id', label: 'مصدر الحقوق', type: 'select', group: 'playback', source: 'sources', emptyLabel: 'غير محدد' },
    source_page_url: { key: 'source_page_url', label: 'صفحة المصدر الأصلية', type: 'url', group: 'playback' },
    official_url: { key: 'official_url', label: 'رابط المشاهدة الرسمي', type: 'url', group: 'playback' },
    playback_mode: { key: 'playback_mode', label: 'طريقة العرض', type: 'select', group: 'playback', options: 'playback', default: 'stream' },

    /* publish + rights */
    status: { key: 'status', label: 'حالة النشر', type: 'select', group: 'basic', options: 'status', default: 'draft' },
    rights_status: { key: 'rights_status', label: 'حالة الحقوق', type: 'select', group: 'rights', options: 'rights', default: 'pending' },
    rights_holder: { key: 'rights_holder', label: 'صاحب الحقوق', type: 'text', group: 'rights', max: 250 },
    license_reference: { key: 'license_reference', label: 'مرجع أو رابط الترخيص', type: 'text', group: 'rights', max: 500 },
    rights_expires_at: { key: 'rights_expires_at', label: 'انتهاء صلاحية الترخيص', type: 'date', group: 'rights' },

    /* hierarchy */
    series_id: { key: 'series_id', label: 'المسلسل', type: 'select', group: 'basic', source: 'series', emptyLabel: 'اختر مسلسلًا' },
    season_id: { key: 'season_id', label: 'الموسم', type: 'select', group: 'basic', source: 'seasons', emptyLabel: 'اختر موسمًا', required: true },
    number: { key: 'number', label: 'الرقم', type: 'number', group: 'basic', min: 0, max: 999, default: 1 },
    sort_order: { key: 'sort_order', label: 'الترتيب', type: 'number', group: 'meta', min: 0, max: 99999, emptyZero: true },

    /* youtube */
    channel_name: { key: 'channel_name', label: 'اسم القناة', type: 'text', group: 'basic', max: 250 },
    topic: { key: 'topic', label: 'نوع المقطع', type: 'select', group: 'basic', options: 'topic', emptyLabel: 'بدون تصنيف' },

    /* home rows */
    slug: { key: 'slug', label: 'المعرّف اللاتيني (slug)', type: 'text', group: 'basic', required: true, max: 80, placeholder: 'ramadan-classics', hint: 'حروف لاتينية وأرقام وشرطات فقط.' },
    is_active: { key: 'is_active', label: 'مفعّل في الرئيسية', type: 'checkbox', group: 'meta', default: true },
    collection_id: { key: 'collection_id', label: 'الصف', type: 'select', group: 'basic', source: 'collections', emptyLabel: 'اختر صفًا', required: true },
    movie_id: { key: 'movie_id', label: 'فيلم', type: 'select', group: 'basic', source: 'movies', emptyLabel: '—' },
    channel_id: { key: 'channel_id', label: 'قناة', type: 'select', group: 'basic', source: 'channels', emptyLabel: '—' },
    episode_id: { key: 'episode_id', label: 'حلقة', type: 'select', group: 'basic', source: 'episodes', emptyLabel: '—' },

    /* categories */
    name_ar: { key: 'name_ar', label: 'اسم التصنيف', type: 'text', group: 'basic', required: true, max: 120 },
    published: { key: 'published', label: 'منشور', type: 'checkbox', group: 'meta' },

    /* rights sources */
    title: { key: 'title', label: 'اسم المصدر', type: 'text', group: 'basic', required: true, max: 250 },
    source_url: { key: 'source_url', label: 'رابط المصدر', type: 'url', group: 'basic' },
    rights_contact: { key: 'rights_contact', label: 'جهة التواصل للحقوق', type: 'text', group: 'basic', max: 250 },
    verified: { key: 'verified', label: 'تم التحقق من المصدر', type: 'checkbox', group: 'meta' }
  };

  /* ---------- tables ---------- */
  var MOVIES = {
    table: 'aseel_movies',
    label: 'الأفلام',
    singular: 'فيلم',
    order: 'created_at.desc',
    fallbackOrder: 'title_ar.asc',
    searchKeys: ['title_ar', 'title_original', 'description'],
    statusFilter: { field: 'status', options: [['', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة']] },
    publishGuard: true,
    fields: [
      F.title_ar, F.title_original, F.description, F.release_year, F.category_id, F.genre_tags, F.duration_minutes,
      F.language_code, F.country_code, F.age_rating, F.quality, F.poster_url, F.backdrop_url,
      F.stream_url, F.youtube_url, F.stream_variants, F.source_id, F.source_page_url,
      F.status, F.rights_status, F.rights_holder, F.license_reference, F.rights_expires_at,
      F.is_kids, F.featured, F.display_order
    ],
    columns: [
      { key: 'poster_url', kind: 'poster', label: '' },
      { key: 'title_ar', kind: 'title', sub: 'title_original', label: 'العنوان' },
      { key: 'release_year', label: 'السنة' },
      { key: 'category_id', kind: 'lookup', source: 'categories', label: 'التصنيف' },
      { key: 'duration_minutes', label: 'المدة', suffix: ' د' },
      { key: 'quality', kind: 'chip', label: 'الجودة' },
      { key: 'status', kind: 'status', label: 'الحالة' }
    ]
  };

  var SERIES = {
    table: 'aseel_series',
    label: 'المسلسلات',
    singular: 'مسلسل',
    order: 'created_at.desc',
    fallbackOrder: 'title_ar.asc',
    searchKeys: ['title_ar', 'title_original', 'description'],
    statusFilter: { field: 'status', options: [['', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة']] },
    publishGuard: true,
    fields: [
      F.title_ar, F.title_original, F.description, F.release_year, F.category_id, F.genre_tags,
      F.language_code, F.country_code, F.age_rating, F.quality, F.poster_url, F.backdrop_url,
      F.status, F.rights_status, F.rights_holder, F.license_reference, F.rights_expires_at,
      F.is_kids, F.featured, F.display_order
    ],
    columns: [
      { key: 'poster_url', kind: 'poster', label: '' },
      { key: 'title_ar', kind: 'title', sub: 'title_original', label: 'العنوان' },
      { key: 'release_year', label: 'السنة' },
      { key: 'category_id', kind: 'lookup', source: 'categories', label: 'التصنيف' },
      { key: 'quality', kind: 'chip', label: 'الجودة' },
      { key: 'status', kind: 'status', label: 'الحالة' }
    ]
  };

  var SEASONS = {
    table: 'aseel_seasons',
    label: 'المواسم',
    singular: 'موسم',
    order: 'number.asc',
    fallbackOrder: 'id.asc',
    searchKeys: ['title_ar'],
    statusFilter: null,
    fields: [
      F.series_id,
      { key: 'number', label: 'رقم الموسم', type: 'number', group: 'basic', min: 0, max: 999, default: 1, required: true },
      { key: 'title_ar', label: 'عنوان الموسم (اختياري)', type: 'text', group: 'basic', max: 250 }
    ],
    columns: [
      { key: 'number', kind: 'number', label: 'الموسم', prefix: 'الموسم ' },
      { key: 'title_ar', kind: 'title', label: 'العنوان' },
      { key: 'series_id', kind: 'lookup', source: 'series', label: 'المسلسل' }
    ]
  };

  var EPISODES = {
    table: 'aseel_episodes',
    label: 'الحلقات',
    singular: 'حلقة',
    order: 'number.asc',
    fallbackOrder: 'id.asc',
    searchKeys: ['title_ar', 'description'],
    statusFilter: { field: 'status', options: [['', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة']] },
    publishGuard: true,
    fields: [
      F.season_id, F.number, F.title_ar, F.description, F.poster_url, F.duration_minutes,
      F.stream_url, F.youtube_url, F.stream_variants, F.status, F.rights_status, F.license_reference
    ],
    columns: [
      { key: 'number', kind: 'number', label: '#', prefix: '' },
      { key: 'title_ar', kind: 'title', sub: 'description', label: 'الحلقة' },
      { key: 'season_id', kind: 'lookup', source: 'seasons', label: 'الموسم' },
      { key: 'duration_minutes', label: 'المدة', suffix: ' د' },
      { key: 'status', kind: 'status', label: 'الحالة' }
    ]
  };

  // Simplified channel editor: publication is automatic; RLS/admin identity still protect writes.
  var CHANNELS = {
    table: 'aseel_channels',
    label: 'القنوات',
    singular: 'قناة',
    order: 'display_order.asc',
    fallbackOrder: 'title_ar.asc',
    searchKeys: ['title_ar', 'description'],
    statusFilter: null,
    publishGuard: false,
    fields: [
      Object.assign({}, F.title_ar, { required: true }),
      Object.assign({}, F.poster_url, { required: true }),
      Object.assign({}, F.stream_url, { required: true }),
      Object.assign({}, F.category_id, { required: true })
    ],
    columns: [
      { key: 'poster_url', kind: 'poster', label: '' },
      { key: 'title_ar', kind: 'title', sub: 'description', label: 'القناة' },
      { key: 'category_id', kind: 'lookup', source: 'categories', label: 'التصنيف' },
      { key: 'link_health_status', kind: 'map', map: { healthy: 'شغّال', suspect: 'يحتاج فحص', broken: 'معطوب', unchecked: 'غير مفحوص' }, label: 'فحص الرابط' }
    ]
  };

  var YOUTUBE = {
    table: 'aseel_youtube_videos',
    label: 'فيديوهات يوتيوب',
    singular: 'فيديو',
    order: 'sort_order.asc',
    fallbackOrder: 'id.asc',
    searchKeys: ['title_ar', 'channel_name', 'youtube_url'],
    statusFilter: { field: 'status', options: [['', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة']] },
    publishGuard: false,
    fields: [
      F.youtube_url, F.title_ar, F.channel_name, F.topic, F.age_rating,
      F.language_code, F.is_kids, F.sort_order, F.status, F.source_page_url
    ],
    columns: [
      { key: 'title_ar', kind: 'title', sub: 'channel_name', label: 'المقطع' },
      { key: 'topic', kind: 'map', map: TOPIC_LABELS, label: 'الموضوع' },
      { key: 'age_rating', label: 'الفئة العمرية' },
      { key: 'sort_order', label: 'الترتيب' },
      { key: 'status', kind: 'status', label: 'الحالة' }
    ]
  };

  var COLLECTIONS = {
    table: 'aseel_home_collections',
    label: 'صفوف الرئيسية',
    singular: 'صف',
    order: 'display_order.asc',
    fallbackOrder: 'id.asc',
    searchKeys: ['title_ar', 'slug'],
    statusFilter: { field: 'is_active', options: [['', 'الكل'], ['yes', 'مفعّل'], ['no', 'معطّل']] },
    fields: [F.title_ar, F.slug, F.description, F.display_order, F.is_active],
    columns: [
      { key: 'title_ar', kind: 'title', sub: 'slug', label: 'الصف' },
      { key: 'display_order', label: 'الترتيب' },
      { key: 'is_active', kind: 'flag', trueLabel: 'مفعّل', falseLabel: 'معطّل', label: 'الحالة' }
    ]
  };

  var COLLECTION_ITEMS = {
    table: 'aseel_home_collection_items',
    label: 'عناصر الصفوف',
    singular: 'عنصر',
    order: 'display_order.asc',
    fallbackOrder: 'id.asc',
    searchKeys: [],
    statusFilter: null,
    fields: [
      F.collection_id,
      F.movie_id,
      { key: 'series_id', label: 'مسلسل', type: 'select', group: 'basic', source: 'series', emptyLabel: '—' },
      F.channel_id,
      F.episode_id,
      F.display_order
    ],
    columns: [
      { key: 'content', kind: 'content', label: 'العنصر' },
      { key: 'collection_id', kind: 'lookup', source: 'collections', label: 'الصف' },
      { key: 'display_order', label: 'الترتيب' }
    ]
  };

  var CATEGORIES = {
    table: 'aseel_categories',
    label: 'التصنيفات',
    singular: 'تصنيف',
    order: 'sort_order.asc',
    fallbackOrder: 'name_ar.asc',
    searchKeys: ['name_ar'],
    statusFilter: { field: 'published', options: [['', 'الكل'], ['yes', 'منشور'], ['no', 'مسودة']] },
    fields: [F.name_ar, F.sort_order, F.published],
    columns: [
      { key: 'name_ar', kind: 'title', label: 'التصنيف' },
      { key: 'sort_order', label: 'الترتيب' },
      { key: 'published', kind: 'flag', trueLabel: 'منشور', falseLabel: 'مسودة', label: 'الحالة' }
    ]
  };

  var SOURCES = {
    table: 'aseel_content_sources',
    label: 'مصادر الحقوق',
    singular: 'مصدر',
    order: 'title.asc',
    fallbackOrder: 'id.asc',
    searchKeys: ['title', 'license_reference', 'rights_contact'],
    statusFilter: { field: 'verified', options: [['', 'الكل'], ['yes', 'موثّق'], ['no', 'قيد المراجعة']] },
    fields: [F.title, F.source_url, F.rights_contact, F.license_reference, F.verified],
    columns: [
      { key: 'title', kind: 'title', label: 'المصدر' },
      { key: 'source_url', kind: 'link', label: 'الرابط' },
      { key: 'license_reference', label: 'مرجع الترخيص' },
      { key: 'verified', kind: 'flag', trueLabel: 'موثّق', falseLabel: 'قيد المراجعة', label: 'التحقق' }
    ]
  };

  /* ---------- sections (sidebar order) ---------- */
  var SECTIONS = [
    { id: 'dashboard', label: 'لوحة التحكم', title: 'لوحة التحكم', subtitle: 'نظرة عامة على مكتبة العز TV', icon: 'dashboard', tables: [] },
    { id: 'movies', label: 'الأفلام', title: 'مكتبة الأفلام', subtitle: 'إدارة الأفلام والجودات وحقوق العرض', icon: 'film', tables: [MOVIES] },
    { id: 'series', label: 'المسلسلات', title: 'المسلسلات', subtitle: 'إدارة المسلسلات وبياناتها', icon: 'tv', tables: [SERIES] },
    { id: 'seasons', label: 'المواسم والحلقات', title: 'المواسم والحلقات', subtitle: 'تنظيم المواسم وإضافة الحلقات', icon: 'layers', tables: [SEASONS, EPISODES] },
    { id: 'channels', label: 'القنوات', title: 'القنوات', subtitle: 'القنوات المباشرة وطرق عرضها', icon: 'radio', tables: [CHANNELS] },
    { id: 'youtube', label: 'يوتيوب', title: 'فيديوهات يوتيوب', subtitle: 'مقاطع القناة الرسمية وترتيب ظهورها', icon: 'play', tables: [YOUTUBE] },
    { id: 'home', label: 'صفوف الرئيسية', title: 'صفوف الرئيسية', subtitle: 'بناء صفوف الصفحة الأولى من المحتوى', icon: 'layout', tables: [COLLECTIONS, COLLECTION_ITEMS] },
    { id: 'categories', label: 'التصنيفات', title: 'التصنيفات', subtitle: 'تصنيفات المكتبة وترتيب ظهورها', icon: 'tag', tables: [CATEGORIES] },
    { id: 'rights', label: 'المصادر والحقوق', title: 'المصادر والحقوق', subtitle: 'سجل مصادر الحقوق والتراخيص', icon: 'shield', tables: [SOURCES] }
  ];

  window.ALEZZ_ADMIN_CONFIG = {
    supabaseUrl: 'https://qyzmlwtvzzgooccqxglq.supabase.co',
    publishableKey: 'sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES',
    storagePrefix: 'alezz.admin.',
    bucket: 'aseel-posters',
    requestTimeout: 15000,
    pageLimit: 300,
    options: OPTIONS,
    fieldGroups: [
      ['basic', 'المعلومات الأساسية'],
      ['media', 'الوسائط والصور'],
      ['playback', 'التشغيل والمصادر'],
      ['rights', 'الحقوق والتراخيص'],
      ['meta', 'الإعدادات والترتيب']
    ],
    sections: SECTIONS
  };
})();
