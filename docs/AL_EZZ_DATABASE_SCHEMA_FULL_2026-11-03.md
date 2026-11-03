# الدليل الكامل لجداول وحقول قاعدة بيانات العز TV

> تم استخراج أسماء الجداول والحقول والعلاقات والسياسات مباشرة من مشروع Supabase `smart-tv-plus` بتاريخ 2026-11-03.

**الملخص:** 34 جدولًا · 384 حقلًا · 34 جدولًا مع RLS · 16 جدولًا أُضيف حديثًا.

يشمل هذا الدليل كل عمود في مخطط `public` وقت الجرد. جداول `auth` و`storage` الداخلية مُدارة من Supabase ولا تتبع عدد الـ384 حقلًا. إعداد الجداول الإضافية لا يعني تلقائيًا أن الويب أو APK أو iOS يستخدمها؛ يلزم ربط التطبيق بها.

## الفهرس

| الجدول | عدد الحقول | RLS |
| --- | ---: | :---: |
| [`aseel_categories`](#aseelcategories) | 5 | نعم |
| [`aseel_movies`](#aseelmovies) | 38 | نعم |
| [`aseel_series`](#aseelseries) | 31 | نعم |
| [`aseel_seasons`](#aseelseasons) | 5 | نعم |
| [`aseel_episodes`](#aseelepisodes) | 23 | نعم |
| [`aseel_channels`](#aseelchannels) | 30 | نعم |
| [`aseel_youtube_videos`](#aseelyoutubevideos) | 21 | نعم |
| [`aseel_content_sources`](#aseelcontentsources) | 7 | نعم |
| [`aseel_home_collections`](#aseelhomecollections) | 7 | نعم |
| [`aseel_home_collection_items`](#aseelhomecollectionitems) | 8 | نعم |
| [`aseel_subtitle_tracks`](#aseelsubtitletracks) | 12 | نعم |
| [`aseel_epg_programs`](#aseelepgprograms) | 12 | نعم |
| [`aseel_viewer_profiles`](#aseelviewerprofiles) | 13 | نعم |
| [`aseel_child_profiles`](#aseelchildprofiles) | 10 | نعم |
| [`aseel_child_allowlist`](#aseelchildallowlist) | 4 | نعم |
| [`aseel_favorites`](#aseelfavorites) | 4 | نعم |
| [`aseel_watch_progress`](#aseelwatchprogress) | 6 | نعم |
| [`aseel_watch_history`](#aseelwatchhistory) | 11 | نعم |
| [`aseel_playlists`](#aseelplaylists) | 7 | نعم |
| [`aseel_playlist_items`](#aseelplaylistitems) | 5 | نعم |
| [`aseel_offline_downloads`](#aseelofflinedownloads) | 11 | نعم |
| [`aseel_device_sessions`](#aseeldevicesessions) | 8 | نعم |
| [`aseel_notifications`](#aseelnotifications) | 9 | نعم |
| [`aseel_admins`](#aseeladmins) | 3 | نعم |
| [`aseel_settings`](#aseelsettings) | 4 | نعم |
| [`aseel_stream_check_results`](#aseelstreamcheckresults) | 13 | نعم |
| [`aseel_playback_reports`](#aseelplaybackreports) | 18 | نعم |
| [`aseel_import_jobs`](#aseelimportjobs) | 14 | نعم |
| [`aseel_import_job_items`](#aseelimportjobitems) | 14 | نعم |
| [`aseel_admin_audit_logs`](#aseeladminauditlogs) | 9 | نعم |
| [`catalog_items`](#catalogitems) | 8 | نعم |
| [`episodes`](#episodes) | 6 | نعم |
| [`admin_users`](#adminusers) | 1 | نعم |
| [`catalog_sources`](#catalogsources) | 7 | نعم |

## الحقول كاملة

### المكتبة والبث التلفزيوني

<a id="aseelcategories"></a>
#### `public.aseel_categories`

5 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `name_ar` | `text` | لا | `—` | — |
| `sort_order` | `integer` | لا | `0` | — |
| `published` | `boolean` | لا | `true` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `category_id` → `public.aseel_categories(id)`؛ `category_id` → `public.aseel_categories(id)`؛ `category_id` → `public.aseel_categories(id)`

**الفهارس:** `aseel_categories_name_ar_key`، `aseel_categories_pkey`

**سياسات RLS:** `aseel_categories_admin` (ALL)؛ `aseel_categories_public` (SELECT)

<a id="aseelmovies"></a>
#### `public.aseel_movies`

38 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 10

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `title_ar` | `text` | لا | `—` | — |
| `title_original` | `text` | نعم | `—` | — |
| `description` | `text` | نعم | `—` | — |
| `poster_url` | `text` | نعم | `—` | — |
| `backdrop_url` | `text` | نعم | `—` | — |
| `release_year` | `integer` | نعم | `—` | — |
| `category_id` | `uuid` | نعم | `—` | FK → public.aseel_categories(id) |
| `duration_minutes` | `integer` | نعم | `—` | — |
| `language_code` | `text` | نعم | `'ar'::text` | — |
| `quality` | `text` | نعم | `'SD'::text` | — |
| `stream_url` | `text` | نعم | `—` | — |
| `status` | `text` | لا | `'draft'::text` | CHECK status = ANY (ARRAY['draft'::text, 'published'::text, 'hidden'::text]) |
| `rights_status` | `text` | لا | `'pending'::text` | CHECK rights_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]) |
| `rights_holder` | `text` | نعم | `—` | — |
| `license_reference` | `text` | نعم | `—` | — |
| `rights_expires_at` | `timestamp with time zone` | نعم | `—` | — |
| `featured` | `boolean` | لا | `false` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |
| `stream_variants` | `jsonb` | لا | `'[]'::jsonb` | CHECK jsonb_typeof(stream_variants) = 'array'::text AND jsonb_array_length(stream_variants) <= 8; Optional quality variants [{label: "360p", url: "https://..."}, ...] controlled by editors; publish only authorized playable URLs. |
| `is_kids` | `boolean` | لا | `false` | — |
| `country_code` | `text` | نعم | `—` | — |
| `youtube_url` | `text` | نعم | `—` | CHECK youtube_url IS NULL OR length(youtube_url) < 512 AND youtube_url ~ '^https://(www[.]youtube[.]com\|youtube[.]com\|m[.]youtube[.]com\|youtu[.]be)/'::text; Official YouTube video URL for embedded player only; no scraping or media download. |
| `source_id` | `uuid` | نعم | `—` | FK → public.aseel_content_sources(id) |
| `age_rating` | `text` | لا | `'all'::text` | CHECK age_rating = ANY (ARRAY['all'::text, '7+'::text, '13+'::text, '16+'::text, '18+'::text]) |
| `display_order` | `integer` | لا | `0` | — |
| `source_page_url` | `text` | نعم | `—` | CHECK source_page_url IS NULL OR source_page_url ~ '^https://'::text AND length(source_page_url) <= 2048; Original metadata/import page URL; does not establish distribution rights |
| `imported_at` | `timestamp with time zone` | نعم | `—` | Time of latest manual import from catalog studio |
| `link_health_status` | `text` | لا | `'unchecked'::text` | CHECK link_health_status = ANY (ARRAY['unchecked'::text, 'healthy'::text, 'suspect'::text, 'broken'::text]) |
| `link_health_reason` | `text` | نعم | `—` | — |
| `link_health_checked_at` | `timestamp with time zone` | نعم | `—` | — |
| `link_health_failures` | `integer` | لا | `0` | — |
| `link_health_url` | `text` | نعم | `—` | — |
| `subtitle_url` | `text` | نعم | `—` | CHECK subtitle_url IS NULL OR subtitle_url ~~ 'https://%'::text AND length(subtitle_url) <= 2048; Optional externally hosted WebVTT subtitle track. Arabic subtitles should only be labeled available if the external track actually exists and is compatible. |
| `subtitle_language_code` | `text` | نعم | `—` | — |
| `genre_tags` | `ARRAY` | لا | `ARRAY[]::text[]` | Manual, editable multi-genre tags; auto_tags is inferred from metadata |
| `auto_tags` | `ARRAY` | لا | `ARRAY[]::text[]` | — |

**العلاقات:** `category_id` → `public.aseel_categories(id)`؛ `source_id` → `public.aseel_content_sources(id)`؛ `movie_id` → `public.aseel_movies(id)`

**الفهارس:** `aseel_movies_auto_tags_idx`، `aseel_movies_category_idx`، `aseel_movies_genre_tags_idx`، `aseel_movies_kids_catalog_idx`، `aseel_movies_link_health_due_idx`، `aseel_movies_order_idx`، `aseel_movies_pkey`، `aseel_movies_source_idx`، `aseel_movies_source_page_url_unique`، `aseel_movies_visible_idx`

**سياسات RLS:** `aseel_movies_admin` (ALL)؛ `aseel_movies_public` (SELECT)

**المحفزات:** `aseel_movies_auto_tags_trigger`، `aseel_movies_reset_link_health`

<a id="aseelseries"></a>
#### `public.aseel_series`

31 حقلًا | RLS: مفعّل | عدد السياسات: 3 | عدد الفهارس: 9

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `title_ar` | `text` | لا | `—` | — |
| `title_original` | `text` | نعم | `—` | — |
| `description` | `text` | نعم | `—` | — |
| `poster_url` | `text` | نعم | `—` | — |
| `backdrop_url` | `text` | نعم | `—` | — |
| `release_year` | `integer` | نعم | `—` | — |
| `category_id` | `uuid` | نعم | `—` | FK → public.aseel_categories(id) |
| `language_code` | `text` | نعم | `'ar'::text` | — |
| `quality` | `text` | نعم | `'SD'::text` | — |
| `status` | `text` | لا | `'draft'::text` | CHECK status = ANY (ARRAY['draft'::text, 'published'::text, 'hidden'::text]) |
| `rights_status` | `text` | لا | `'pending'::text` | CHECK rights_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]) |
| `rights_holder` | `text` | نعم | `—` | — |
| `license_reference` | `text` | نعم | `—` | — |
| `rights_expires_at` | `timestamp with time zone` | نعم | `—` | — |
| `featured` | `boolean` | لا | `false` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |
| `is_kids` | `boolean` | لا | `false` | — |
| `country_code` | `text` | نعم | `—` | — |
| `source_id` | `uuid` | نعم | `—` | FK → public.aseel_content_sources(id) |
| `age_rating` | `text` | لا | `'all'::text` | CHECK age_rating = ANY (ARRAY['all'::text, '7+'::text, '13+'::text, '16+'::text, '18+'::text]) |
| `display_order` | `integer` | لا | `0` | — |
| `link_health_status` | `text` | لا | `'unchecked'::text` | CHECK link_health_status = ANY (ARRAY['unchecked'::text, 'healthy'::text, 'suspect'::text, 'broken'::text]) |
| `link_health_reason` | `text` | نعم | `—` | — |
| `link_health_checked_at` | `timestamp with time zone` | نعم | `—` | — |
| `link_health_failures` | `integer` | لا | `0` | — |
| `link_health_url` | `text` | نعم | `—` | — |
| `quick_published` | `boolean` | لا | `false` | — |
| `genre_tags` | `ARRAY` | لا | `ARRAY[]::text[]` | Manual, editable multi-genre tags; episodes inherit both |
| `auto_tags` | `ARRAY` | لا | `ARRAY[]::text[]` | — |

**العلاقات:** `source_id` → `public.aseel_content_sources(id)`؛ `category_id` → `public.aseel_categories(id)`؛ `series_id` → `public.aseel_series(id)`؛ `series_id` → `public.aseel_series(id)`

**الفهارس:** `aseel_series_auto_tags_idx`، `aseel_series_category_idx`، `aseel_series_genre_tags_idx`، `aseel_series_kids_catalog_idx`، `aseel_series_link_health_due_idx`، `aseel_series_order_idx`، `aseel_series_pkey`، `aseel_series_source_idx`، `aseel_series_visible_idx`

**سياسات RLS:** `aseel_series_admin` (ALL)؛ `aseel_series_public` (SELECT)؛ `aseel_series_quick_public` (SELECT)

**المحفزات:** `aseel_refresh_episode_genres_trigger`، `aseel_series_auto_tags_trigger`

<a id="aseelseasons"></a>
#### `public.aseel_seasons`

5 حقلًا | RLS: مفعّل | عدد السياسات: 3 | عدد الفهارس: 3

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `series_id` | `uuid` | لا | `—` | FK → public.aseel_series(id) |
| `number` | `integer` | لا | `—` | CHECK number > 0 |
| `title_ar` | `text` | نعم | `—` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `season_id` → `public.aseel_seasons(id)`؛ `series_id` → `public.aseel_series(id)`

**الفهارس:** `aseel_seasons_pkey`، `aseel_seasons_series_id_number_key`، `aseel_seasons_series_idx`

**سياسات RLS:** `aseel_seasons_admin` (ALL)؛ `aseel_seasons_public` (SELECT)؛ `aseel_seasons_quick_public` (SELECT)

<a id="aseelepisodes"></a>
#### `public.aseel_episodes`

23 حقلًا | RLS: مفعّل | عدد السياسات: 3 | عدد الفهارس: 5

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `season_id` | `uuid` | لا | `—` | FK → public.aseel_seasons(id) |
| `number` | `integer` | لا | `—` | CHECK number > 0 |
| `title_ar` | `text` | لا | `—` | — |
| `description` | `text` | نعم | `—` | — |
| `poster_url` | `text` | نعم | `—` | — |
| `duration_minutes` | `integer` | نعم | `—` | — |
| `stream_url` | `text` | نعم | `—` | — |
| `status` | `text` | لا | `'draft'::text` | CHECK status = ANY (ARRAY['draft'::text, 'published'::text, 'hidden'::text]) |
| `rights_status` | `text` | لا | `'pending'::text` | CHECK rights_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]) |
| `license_reference` | `text` | نعم | `—` | — |
| `rights_expires_at` | `timestamp with time zone` | نعم | `—` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `stream_variants` | `jsonb` | لا | `'[]'::jsonb` | CHECK jsonb_typeof(stream_variants) = 'array'::text AND jsonb_array_length(stream_variants) <= 8; Optional quality variants; array of {label,url}. No synthetic transcoding. |
| `youtube_url` | `text` | نعم | `—` | CHECK youtube_url IS NULL OR length(youtube_url) < 512 AND youtube_url ~ '^https://(www[.]youtube[.]com\|youtube[.]com\|m[.]youtube[.]com\|youtu[.]be)/'::text; Official YouTube episode URL, use hosted embed and retain YouTube controls. |
| `source_id` | `uuid` | نعم | `—` | FK → public.aseel_content_sources(id) |
| `link_health_status` | `text` | لا | `'unchecked'::text` | CHECK link_health_status = ANY (ARRAY['unchecked'::text, 'healthy'::text, 'suspect'::text, 'broken'::text]) |
| `link_health_reason` | `text` | نعم | `—` | — |
| `link_health_checked_at` | `timestamp with time zone` | نعم | `—` | — |
| `link_health_failures` | `integer` | لا | `0` | — |
| `link_health_url` | `text` | نعم | `—` | — |
| `genre_tags` | `ARRAY` | لا | `ARRAY[]::text[]` | — |
| `auto_tags` | `ARRAY` | لا | `ARRAY[]::text[]` | Inferred from episode and parent series metadata |

**العلاقات:** `episode_id` → `public.aseel_episodes(id)`؛ `episode_id` → `public.aseel_episodes(id)`؛ `source_id` → `public.aseel_content_sources(id)`؛ `season_id` → `public.aseel_seasons(id)`

**الفهارس:** `aseel_episodes_link_health_due_idx`، `aseel_episodes_pkey`، `aseel_episodes_season_id_number_key`، `aseel_episodes_season_idx`، `aseel_episodes_source_idx`

**سياسات RLS:** `aseel_episodes_admin` (ALL)؛ `aseel_episodes_public` (SELECT)؛ `aseel_episodes_quick_public` (SELECT)

**المحفزات:** `aseel_episodes_auto_tags_trigger`، `aseel_episodes_reset_link_health`

<a id="aseelchannels"></a>
#### `public.aseel_channels`

30 حقلًا | RLS: مفعّل | عدد السياسات: 8 | عدد الفهارس: 7

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `title_ar` | `text` | لا | `—` | — |
| `description` | `text` | نعم | `—` | — |
| `poster_url` | `text` | نعم | `—` | — |
| `stream_url` | `text` | نعم | `—` | — |
| `category_id` | `uuid` | نعم | `—` | FK → public.aseel_categories(id) |
| `status` | `text` | لا | `'published'::text` | CHECK status = ANY (ARRAY['draft'::text, 'published'::text, 'hidden'::text]); Channel records created via the simplified owner editor are published by default. Link-health can still hide broken media. |
| `rights_status` | `text` | لا | `'pending'::text` | CHECK rights_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]) |
| `rights_holder` | `text` | نعم | `—` | — |
| `license_reference` | `text` | نعم | `—` | — |
| `rights_expires_at` | `timestamp with time zone` | نعم | `—` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |
| `official_url` | `text` | نعم | `—` | CHECK official_url IS NULL OR official_url ~ '^https://'::text |
| `playback_mode` | `text` | لا | `'stream'::text` | CHECK playback_mode = ANY (ARRAY['stream'::text, 'official_link'::text, 'youtube_embed'::text]) |
| `stream_variants` | `jsonb` | لا | `'[]'::jsonb` | CHECK jsonb_typeof(stream_variants) = 'array'::text AND jsonb_array_length(stream_variants) <= 8; Optional alternate approved live stream URLs; legacy HLS requires capable external player. |
| `is_kids` | `boolean` | لا | `false` | — |
| `country_code` | `text` | نعم | `—` | — |
| `language_code` | `text` | لا | `'und'::text` | — |
| `youtube_url` | `text` | نعم | `—` | CHECK youtube_url IS NULL OR length(youtube_url) < 512 AND youtube_url ~ '^https://(www[.]youtube[.]com\|youtube[.]com\|m[.]youtube[.]com\|youtu[.]be)/'::text; Official YouTube URL, requires official iframe embed; available if provider permits embedding. |
| `source_id` | `uuid` | نعم | `—` | FK → public.aseel_content_sources(id) |
| `age_rating` | `text` | لا | `'all'::text` | CHECK age_rating = ANY (ARRAY['all'::text, '7+'::text, '13+'::text, '16+'::text, '18+'::text]) |
| `display_order` | `integer` | لا | `0` | — |
| `link_health_status` | `text` | لا | `'unchecked'::text` | CHECK link_health_status = ANY (ARRAY['unchecked'::text, 'healthy'::text, 'suspect'::text, 'broken'::text]) |
| `link_health_reason` | `text` | نعم | `—` | — |
| `link_health_checked_at` | `timestamp with time zone` | نعم | `—` | — |
| `link_health_failures` | `integer` | لا | `0` | — |
| `link_health_url` | `text` | نعم | `—` | — |
| `genre_tags` | `ARRAY` | لا | `ARRAY[]::text[]` | — |
| `auto_tags` | `ARRAY` | لا | `ARRAY[]::text[]` | — |

**العلاقات:** `category_id` → `public.aseel_categories(id)`؛ `source_id` → `public.aseel_content_sources(id)`؛ `channel_id` → `public.aseel_channels(id)`؛ `channel_id` → `public.aseel_channels(id)`

**الفهارس:** `aseel_channels_category_idx`، `aseel_channels_kids_catalog_idx`، `aseel_channels_link_health_due_idx`، `aseel_channels_order_idx`، `aseel_channels_pkey`، `aseel_channels_source_idx`، `aseel_channels_visible_idx`

**سياسات RLS:** `aseel_channels_admin` (ALL)؛ `aseel_channels_kids_official_navigation_public` (SELECT)؛ `aseel_channels_mbc_official_navigation_public` (SELECT)؛ `aseel_channels_official_navigation_public` (SELECT)؛ `aseel_channels_optional_rights_public` (SELECT)؛ `aseel_channels_public` (SELECT)؛ `aseel_documentary_public_streams` (SELECT)؛ `aseel_kids_live_public_hls` (SELECT)

**المحفزات:** `aseel_channels_auto_tags_trigger`، `aseel_channels_reset_link_health`

<a id="aseelyoutubevideos"></a>
#### `public.aseel_youtube_videos`

21 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 4

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `youtube_url` | `text` | لا | `—` | CHECK youtube_url ~ '^https://www[.]youtube[.]com/watch[?]v=[A-Za-z0-9_-]{11}$'::text |
| `title_ar` | `text` | لا | `—` | CHECK length(btrim(title_ar)) > 0 |
| `channel_name` | `text` | لا | `—` | — |
| `language_code` | `text` | لا | `'ar'::text` | CHECK language_code = ANY (ARRAY['ar'::text, 'en'::text, 'tr'::text, 'es'::text, 'fr'::text, 'und'::text]) |
| `topic` | `text` | لا | `'songs'::text` | CHECK topic = ANY (ARRAY['letters'::text, 'numbers'::text, 'animals'::text, 'colors'::text, 'stories'::text, 'songs'::text, 'science'::text]) |
| `age_rating` | `text` | لا | `'all'::text` | CHECK age_rating = ANY (ARRAY['all'::text, '7+'::text, '13+'::text]) |
| `is_kids` | `boolean` | لا | `true` | — |
| `sort_order` | `integer` | لا | `0` | — |
| `status` | `text` | لا | `'draft'::text` | CHECK status = ANY (ARRAY['draft'::text, 'published'::text, 'hidden'::text]) |
| `source_page_url` | `text` | لا | `—` | CHECK source_page_url ~ '^https://'::text |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |
| `licensed_stream_url` | `text` | نعم | `—` | Optional HTTPS MP4/HLS URL provided by a rights holder; not a derived YouTube stream |
| `licensed_stream_variants` | `jsonb` | لا | `'[]'::jsonb` | — |
| `licensed_stream_approved` | `boolean` | لا | `false` | True only when direct-media playback rights are confirmed independently of the YouTube listing |
| `link_health_status` | `text` | لا | `'unchecked'::text` | CHECK link_health_status = ANY (ARRAY['unchecked'::text, 'healthy'::text, 'suspect'::text, 'broken'::text]) |
| `link_health_reason` | `text` | نعم | `—` | — |
| `link_health_checked_at` | `timestamp with time zone` | نعم | `—` | — |
| `link_health_failures` | `integer` | لا | `0` | — |
| `link_health_url` | `text` | نعم | `—` | — |

**الفهارس:** `aseel_youtube_videos_link_health_due_idx`، `aseel_youtube_videos_pkey`، `aseel_youtube_videos_published_idx`، `aseel_youtube_videos_youtube_url_key`

**سياسات RLS:** `aseel_youtube_videos_admin_all` (ALL)؛ `aseel_youtube_videos_public_read` (SELECT)

**المحفزات:** `aseel_youtube_videos_reset_link_health`

<a id="aseelcontentsources"></a>
#### `public.aseel_content_sources`

7 حقلًا | RLS: مفعّل | عدد السياسات: 1 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `title` | `text` | لا | `—` | — |
| `source_url` | `text` | نعم | `—` | — |
| `rights_contact` | `text` | نعم | `—` | — |
| `license_reference` | `text` | نعم | `—` | — |
| `verified` | `boolean` | لا | `false` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `source_id` → `public.aseel_content_sources(id)`؛ `source_id` → `public.aseel_content_sources(id)`؛ `source_id` → `public.aseel_content_sources(id)`؛ `source_id` → `public.aseel_content_sources(id)`

**الفهارس:** `aseel_content_sources_pkey`

**سياسات RLS:** `aseel_sources_admin` (ALL)

<a id="aseelhomecollections"></a>
#### `public.aseel_home_collections`

7 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 3

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `title_ar` | `text` | لا | `—` | CHECK length(btrim(title_ar)) >= 2 AND length(btrim(title_ar)) <= 100 |
| `slug` | `text` | لا | `—` | CHECK slug ~ '^[a-z][a-z0-9-]{1,48}$'::text |
| `description` | `text` | نعم | `—` | — |
| `display_order` | `integer` | لا | `0` | — |
| `is_active` | `boolean` | لا | `false` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `collection_id` → `public.aseel_home_collections(id)`

**الفهارس:** `aseel_home_collections_order`، `aseel_home_collections_pkey`، `aseel_home_collections_slug_key`

**سياسات RLS:** `aseel_collections_admin` (ALL)؛ `aseel_collections_public_read` (SELECT)

<a id="aseelhomecollectionitems"></a>
#### `public.aseel_home_collection_items`

8 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 10

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `collection_id` | `uuid` | لا | `—` | FK → public.aseel_home_collections(id) |
| `movie_id` | `uuid` | نعم | `—` | FK → public.aseel_movies(id) |
| `series_id` | `uuid` | نعم | `—` | FK → public.aseel_series(id) |
| `channel_id` | `uuid` | نعم | `—` | FK → public.aseel_channels(id) |
| `episode_id` | `uuid` | نعم | `—` | FK → public.aseel_episodes(id) |
| `display_order` | `integer` | لا | `0` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `movie_id` → `public.aseel_movies(id)`؛ `series_id` → `public.aseel_series(id)`؛ `channel_id` → `public.aseel_channels(id)`؛ `collection_id` → `public.aseel_home_collections(id)`؛ `episode_id` → `public.aseel_episodes(id)`

**الفهارس:** `aseel_collection_item_channel_unique`، `aseel_collection_item_episode_unique`، `aseel_collection_item_movie_unique`، `aseel_collection_item_series_unique`، `aseel_home_collection_items_pkey`، `aseel_home_items_order`، `aseel_shelf_channel_fk_idx`، `aseel_shelf_episode_fk_idx`، `aseel_shelf_movie_fk_idx`، `aseel_shelf_series_fk_idx`

**سياسات RLS:** `aseel_collection_items_admin` (ALL)؛ `aseel_collection_items_public_read` (SELECT)

<a id="aseelsubtitletracks"></a>
#### `public.aseel_subtitle_tracks`

12 حقلًا | RLS: مفعّل | عدد السياسات: 5 | عدد الفهارس: 3

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `media_type` | `text` | لا | `—` | CHECK media_type = ANY (ARRAY['movie'::text, 'episode'::text]) |
| `media_id` | `uuid` | لا | `—` | — |
| `language_code` | `text` | لا | `—` | — |
| `label` | `text` | نعم | `—` | — |
| `format` | `text` | لا | `—` | CHECK format = ANY (ARRAY['vtt'::text, 'srt'::text]) |
| `subtitle_url` | `text` | لا | `—` | CHECK subtitle_url ~~ 'https://%'::text |
| `is_default` | `boolean` | لا | `false` | — |
| `is_published` | `boolean` | لا | `false` | — |
| `created_by` | `uuid` | نعم | `—` | FK → auth.users(id) |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `created_by` → `auth.users(id)`

**الفهارس:** `aseel_subtitle_tracks_media_idx`، `aseel_subtitle_tracks_media_type_media_id_language_code_sub_key`، `aseel_subtitle_tracks_pkey`

**سياسات RLS:** `aseel_subtitle_tracks_delete_authenticated` (DELETE)؛ `aseel_subtitle_tracks_insert_authenticated` (INSERT)؛ `aseel_subtitle_tracks_select_anon` (SELECT)؛ `aseel_subtitle_tracks_select_authenticated` (SELECT)؛ `aseel_subtitle_tracks_update_authenticated` (UPDATE)

<a id="aseelepgprograms"></a>
#### `public.aseel_epg_programs`

12 حقلًا | RLS: مفعّل | عدد السياسات: 5 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `channel_id` | `uuid` | لا | `—` | FK → public.aseel_channels(id) |
| `title_ar` | `text` | لا | `—` | CHECK length(TRIM(BOTH FROM title_ar)) >= 1 AND length(TRIM(BOTH FROM title_ar)) <= 250 |
| `description` | `text` | نعم | `—` | — |
| `genre` | `text` | نعم | `—` | — |
| `poster_url` | `text` | نعم | `—` | — |
| `source_url` | `text` | نعم | `—` | — |
| `language_code` | `text` | لا | `'ar'::text` | — |
| `starts_at` | `timestamp with time zone` | لا | `—` | — |
| `ends_at` | `timestamp with time zone` | لا | `—` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `channel_id` → `public.aseel_channels(id)`

**الفهارس:** `aseel_epg_channel_time_idx`، `aseel_epg_programs_pkey`

**سياسات RLS:** `aseel_epg_programs_delete_authenticated` (DELETE)؛ `aseel_epg_programs_insert_authenticated` (INSERT)؛ `aseel_epg_programs_select_anon` (SELECT)؛ `aseel_epg_programs_select_authenticated` (SELECT)؛ `aseel_epg_programs_update_authenticated` (UPDATE)

### المستخدمون وتجربة المشاهدة

<a id="aseelviewerprofiles"></a>
#### `public.aseel_viewer_profiles`

13 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `user_id` | `uuid` | لا | `—` | PK; FK → auth.users(id) |
| `display_name` | `text` | نعم | `—` | CHECK display_name IS NULL OR length(display_name) <= 100 |
| `avatar_url` | `text` | نعم | `—` | CHECK avatar_url IS NULL OR avatar_url ~~ 'https://%'::text |
| `language_code` | `text` | لا | `'ar'::text` | — |
| `country_code` | `text` | نعم | `—` | — |
| `auto_play_next` | `boolean` | لا | `true` | — |
| `preferred_quality` | `text` | لا | `'AUTO'::text` | — |
| `subtitle_language` | `text` | نعم | `—` | — |
| `video_fit` | `text` | لا | `'contain'::text` | CHECK video_fit = ANY (ARRAY['contain'::text, 'cover'::text]) |
| `data_saver` | `boolean` | لا | `false` | — |
| `notifications_enabled` | `boolean` | لا | `true` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `aseel_viewer_profiles_pkey`

**سياسات RLS:** `aseel_viewer_profiles_delete_authenticated` (DELETE)؛ `aseel_viewer_profiles_insert_authenticated` (INSERT)؛ `aseel_viewer_profiles_select_authenticated` (SELECT)؛ `aseel_viewer_profiles_update_authenticated` (UPDATE)

<a id="aseelchildprofiles"></a>
#### `public.aseel_child_profiles`

10 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | لا | `—` | FK → auth.users(id) |
| `name` | `text` | لا | `—` | CHECK length(TRIM(BOTH FROM name)) >= 1 AND length(TRIM(BOTH FROM name)) <= 80 |
| `age_band` | `text` | لا | `—` | CHECK age_band = ANY (ARRAY['0-4'::text, '5-7'::text, '8-12'::text, '13-17'::text]) |
| `daily_limit_minutes` | `integer` | لا | `60` | CHECK daily_limit_minutes >= 1 AND daily_limit_minutes <= 600 |
| `autoplay_next` | `boolean` | لا | `false` | — |
| `allowed_ratings` | `ARRAY` | لا | `ARRAY['all'::text]` | — |
| `is_active` | `boolean` | لا | `true` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `user_id` → `auth.users(id)`؛ `child_profile_id` → `public.aseel_child_profiles(id)`

**الفهارس:** `aseel_child_profiles_owner_idx`، `aseel_child_profiles_pkey`

**سياسات RLS:** `aseel_child_profiles_delete_authenticated` (DELETE)؛ `aseel_child_profiles_insert_authenticated` (INSERT)؛ `aseel_child_profiles_select_authenticated` (SELECT)؛ `aseel_child_profiles_update_authenticated` (UPDATE)

<a id="aseelchildallowlist"></a>
#### `public.aseel_child_allowlist`

4 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `child_profile_id` | `uuid` | لا | `—` | PK; FK → public.aseel_child_profiles(id) |
| `item_type` | `text` | لا | `—` | PK; CHECK item_type = ANY (ARRAY['movie'::text, 'series'::text, 'episode'::text, 'channel'::text]) |
| `item_id` | `uuid` | لا | `—` | PK |
| `added_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `child_profile_id` → `public.aseel_child_profiles(id)`

**الفهارس:** `aseel_child_allowlist_pkey`

**سياسات RLS:** `aseel_child_allowlist_delete_authenticated` (DELETE)؛ `aseel_child_allowlist_insert_authenticated` (INSERT)؛ `aseel_child_allowlist_select_authenticated` (SELECT)؛ `aseel_child_allowlist_update_authenticated` (UPDATE)

<a id="aseelfavorites"></a>
#### `public.aseel_favorites`

4 حقلًا | RLS: مفعّل | عدد السياسات: 1 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `user_id` | `uuid` | لا | `—` | PK; FK → auth.users(id) |
| `item_type` | `text` | لا | `—` | PK; CHECK item_type = ANY (ARRAY['movie'::text, 'series'::text, 'channel'::text]) |
| `item_id` | `uuid` | لا | `—` | PK |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `aseel_favorites_pkey`

**سياسات RLS:** `aseel_favorites_self` (ALL)

<a id="aseelwatchprogress"></a>
#### `public.aseel_watch_progress`

6 حقلًا | RLS: مفعّل | عدد السياسات: 1 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `user_id` | `uuid` | لا | `—` | PK; FK → auth.users(id) |
| `item_type` | `text` | لا | `—` | PK; CHECK item_type = ANY (ARRAY['movie'::text, 'episode'::text, 'channel'::text]) |
| `item_id` | `uuid` | لا | `—` | PK |
| `position_ms` | `bigint` | لا | `0` | CHECK position_ms >= 0 |
| `duration_ms` | `bigint` | لا | `0` | CHECK duration_ms >= 0 |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `aseel_watch_progress_pkey`

**سياسات RLS:** `aseel_progress_self` (ALL)

<a id="aseelwatchhistory"></a>
#### `public.aseel_watch_history`

11 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 3

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | لا | `—` | FK → auth.users(id) |
| `item_type` | `text` | لا | `—` | CHECK item_type = ANY (ARRAY['movie'::text, 'series'::text, 'episode'::text, 'channel'::text, 'youtube'::text]) |
| `item_id` | `uuid` | لا | `—` | — |
| `episode_id` | `uuid` | نعم | `—` | FK → public.aseel_episodes(id) |
| `position_ms` | `bigint` | لا | `0` | CHECK position_ms >= 0 |
| `duration_ms` | `bigint` | نعم | `—` | CHECK duration_ms IS NULL OR duration_ms >= 0 |
| `completed` | `boolean` | لا | `false` | — |
| `quality` | `text` | نعم | `—` | — |
| `device_type` | `text` | نعم | `—` | — |
| `watched_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `episode_id` → `public.aseel_episodes(id)`؛ `user_id` → `auth.users(id)`

**الفهارس:** `aseel_watch_history_item_idx`، `aseel_watch_history_owner_time_idx`، `aseel_watch_history_pkey`

**سياسات RLS:** `aseel_watch_history_delete_authenticated` (DELETE)؛ `aseel_watch_history_insert_authenticated` (INSERT)؛ `aseel_watch_history_select_authenticated` (SELECT)؛ `aseel_watch_history_update_authenticated` (UPDATE)

<a id="aseelplaylists"></a>
#### `public.aseel_playlists`

7 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | لا | `—` | FK → auth.users(id) |
| `name` | `text` | لا | `—` | CHECK length(TRIM(BOTH FROM name)) >= 1 AND length(TRIM(BOTH FROM name)) <= 100 |
| `description` | `text` | نعم | `—` | — |
| `is_default` | `boolean` | لا | `false` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `playlist_id` → `public.aseel_playlists(id)`؛ `user_id` → `auth.users(id)`

**الفهارس:** `aseel_playlists_owner_idx`، `aseel_playlists_pkey`

**سياسات RLS:** `aseel_playlists_delete_authenticated` (DELETE)؛ `aseel_playlists_insert_authenticated` (INSERT)؛ `aseel_playlists_select_authenticated` (SELECT)؛ `aseel_playlists_update_authenticated` (UPDATE)

<a id="aseelplaylistitems"></a>
#### `public.aseel_playlist_items`

5 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `playlist_id` | `uuid` | لا | `—` | PK; FK → public.aseel_playlists(id) |
| `item_type` | `text` | لا | `—` | PK; CHECK item_type = ANY (ARRAY['movie'::text, 'series'::text, 'episode'::text, 'channel'::text]) |
| `item_id` | `uuid` | لا | `—` | PK |
| `position` | `integer` | لا | `0` | — |
| `added_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `playlist_id` → `public.aseel_playlists(id)`

**الفهارس:** `aseel_playlist_items_pkey`

**سياسات RLS:** `aseel_playlist_items_delete_authenticated` (DELETE)؛ `aseel_playlist_items_insert_authenticated` (INSERT)؛ `aseel_playlist_items_select_authenticated` (SELECT)؛ `aseel_playlist_items_update_authenticated` (UPDATE)

<a id="aseelofflinedownloads"></a>
#### `public.aseel_offline_downloads`

11 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 3

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | لا | `—` | FK → auth.users(id) |
| `item_type` | `text` | لا | `—` | CHECK item_type = ANY (ARRAY['movie'::text, 'episode'::text]) |
| `item_id` | `uuid` | لا | `—` | — |
| `quality` | `text` | لا | `'AUTO'::text` | — |
| `state` | `text` | لا | `'queued'::text` | CHECK state = ANY (ARRAY['queued'::text, 'downloading'::text, 'completed'::text, 'expired'::text, 'deleted'::text, 'failed'::text]) |
| `downloaded_bytes` | `bigint` | لا | `0` | CHECK downloaded_bytes >= 0 |
| `total_bytes` | `bigint` | نعم | `—` | CHECK total_bytes IS NULL OR total_bytes >= 0 |
| `license_expires_at` | `timestamp with time zone` | نعم | `—` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `aseel_offline_downloads_owner_idx`، `aseel_offline_downloads_pkey`، `aseel_offline_downloads_user_id_item_type_item_id_quality_key`

**سياسات RLS:** `aseel_offline_downloads_delete_authenticated` (DELETE)؛ `aseel_offline_downloads_insert_authenticated` (INSERT)؛ `aseel_offline_downloads_select_authenticated` (SELECT)؛ `aseel_offline_downloads_update_authenticated` (UPDATE)

<a id="aseeldevicesessions"></a>
#### `public.aseel_device_sessions`

8 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 3

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | لا | `—` | FK → auth.users(id) |
| `device_hash` | `text` | لا | `—` | CHECK length(device_hash) >= 16 AND length(device_hash) <= 128 |
| `platform` | `text` | لا | `—` | CHECK platform = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text, 'tv'::text, 'desktop'::text, 'other'::text]) |
| `device_model` | `text` | نعم | `—` | — |
| `app_version` | `text` | نعم | `—` | — |
| `last_seen_at` | `timestamp with time zone` | لا | `now()` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `aseel_device_sessions_owner_idx`، `aseel_device_sessions_pkey`، `aseel_device_sessions_user_id_device_hash_key`

**سياسات RLS:** `aseel_device_sessions_delete_authenticated` (DELETE)؛ `aseel_device_sessions_insert_authenticated` (INSERT)؛ `aseel_device_sessions_select_authenticated` (SELECT)؛ `aseel_device_sessions_update_authenticated` (UPDATE)

<a id="aseelnotifications"></a>
#### `public.aseel_notifications`

9 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | لا | `—` | FK → auth.users(id) |
| `title` | `text` | لا | `—` | — |
| `body` | `text` | نعم | `—` | — |
| `notification_type` | `text` | لا | `'general'::text` | — |
| `item_type` | `text` | نعم | `—` | — |
| `item_id` | `uuid` | نعم | `—` | — |
| `read_at` | `timestamp with time zone` | نعم | `—` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `aseel_notifications_pkey`، `aseel_notifications_unread_idx`

**سياسات RLS:** `aseel_notifications_select_authenticated` (SELECT)؛ `aseel_notifications_update_authenticated` (UPDATE)

### الإدارة والفحص والاستيراد

<a id="aseeladmins"></a>
#### `public.aseel_admins`

3 حقلًا | RLS: مفعّل | عدد السياسات: 1 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `user_id` | `uuid` | لا | `—` | PK; FK → auth.users(id) |
| `active` | `boolean` | لا | `false` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `aseel_admins_pkey`

**سياسات RLS:** `aseel_admins_self_read` (SELECT)

<a id="aseelsettings"></a>
#### `public.aseel_settings`

4 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `key` | `text` | لا | `—` | PK |
| `value` | `jsonb` | لا | `'{}'::jsonb` | — |
| `is_public` | `boolean` | لا | `false` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**الفهارس:** `aseel_settings_pkey`

**سياسات RLS:** `aseel_settings_admin` (ALL)؛ `aseel_settings_public` (SELECT)

<a id="aseelstreamcheckresults"></a>
#### `public.aseel_stream_check_results`

13 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 3

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `item_type` | `text` | لا | `—` | CHECK item_type = ANY (ARRAY['movie'::text, 'episode'::text, 'channel'::text, 'youtube'::text]) |
| `item_id` | `uuid` | لا | `—` | — |
| `source_role` | `text` | لا | `—` | CHECK source_role = ANY (ARRAY['primary'::text, 'variant'::text, 'youtube'::text, 'official'::text]) |
| `source_index` | `integer` | لا | `0` | CHECK source_index >= 0 AND source_index <= 20 |
| `url_hash` | `text` | لا | `—` | — |
| `source_label` | `text` | نعم | `—` | — |
| `stream_format` | `text` | نعم | `—` | — |
| `health_status` | `text` | لا | `—` | CHECK health_status = ANY (ARRAY['healthy'::text, 'suspect'::text, 'broken'::text, 'unchecked'::text]) |
| `http_status` | `integer` | نعم | `—` | CHECK http_status IS NULL OR http_status >= 100 AND http_status <= 599 |
| `reason` | `text` | نعم | `—` | — |
| `checked_at` | `timestamp with time zone` | لا | `now()` | — |
| `checked_by` | `uuid` | نعم | `—` | FK → auth.users(id) |

**العلاقات:** `checked_by` → `auth.users(id)`

**الفهارس:** `aseel_stream_check_results_item_type_item_id_source_role_so_key`، `aseel_stream_check_results_pkey`، `aseel_stream_checks_date_idx`

**سياسات RLS:** `aseel_stream_check_results_delete_authenticated` (DELETE)؛ `aseel_stream_check_results_insert_authenticated` (INSERT)؛ `aseel_stream_check_results_select_authenticated` (SELECT)؛ `aseel_stream_check_results_update_authenticated` (UPDATE)

<a id="aseelplaybackreports"></a>
#### `public.aseel_playback_reports`

18 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 3

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | نعم | `—` | FK → auth.users(id) |
| `item_type` | `text` | لا | `—` | CHECK item_type = ANY (ARRAY['movie'::text, 'series'::text, 'episode'::text, 'channel'::text, 'youtube'::text]) |
| `item_id` | `uuid` | لا | `—` | — |
| `source_url_hash` | `text` | نعم | `—` | — |
| `error_code` | `text` | نعم | `—` | — |
| `http_status` | `integer` | نعم | `—` | CHECK http_status IS NULL OR http_status >= 100 AND http_status <= 599 |
| `error_message` | `text` | نعم | `—` | — |
| `player_engine` | `text` | نعم | `—` | — |
| `platform` | `text` | نعم | `—` | — |
| `device_model` | `text` | نعم | `—` | — |
| `app_version` | `text` | نعم | `—` | — |
| `media_codec` | `text` | نعم | `—` | — |
| `playback_position_ms` | `bigint` | نعم | `—` | CHECK playback_position_ms IS NULL OR playback_position_ms >= 0 |
| `status` | `text` | لا | `'new'::text` | CHECK status = ANY (ARRAY['new'::text, 'reviewing'::text, 'resolved'::text, 'ignored'::text]) |
| `resolution_note` | `text` | نعم | `—` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `resolved_at` | `timestamp with time zone` | نعم | `—` | — |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `aseel_playback_reports_date_idx`، `aseel_playback_reports_owner_idx`، `aseel_playback_reports_pkey`

**سياسات RLS:** `aseel_playback_reports_delete_authenticated` (DELETE)؛ `aseel_playback_reports_insert_authenticated` (INSERT)؛ `aseel_playback_reports_select_authenticated` (SELECT)؛ `aseel_playback_reports_update_authenticated` (UPDATE)

<a id="aseelimportjobs"></a>
#### `public.aseel_import_jobs`

14 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `created_by` | `uuid` | نعم | `—` | FK → auth.users(id) |
| `job_kind` | `text` | لا | `—` | CHECK job_kind = ANY (ARRAY['movie'::text, 'series'::text, 'episode'::text, 'channel'::text, 'playlist'::text, 'bulk'::text]) |
| `source_url` | `text` | نعم | `—` | — |
| `status` | `text` | لا | `'queued'::text` | CHECK status = ANY (ARRAY['queued'::text, 'running'::text, 'paused'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]) |
| `total_count` | `integer` | لا | `0` | CHECK total_count >= 0 |
| `processed_count` | `integer` | لا | `0` | CHECK processed_count >= 0 |
| `created_count` | `integer` | لا | `0` | CHECK created_count >= 0 |
| `rejected_count` | `integer` | لا | `0` | CHECK rejected_count >= 0 |
| `last_error` | `text` | نعم | `—` | — |
| `metadata` | `jsonb` | لا | `'{}'::jsonb` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `started_at` | `timestamp with time zone` | نعم | `—` | — |
| `finished_at` | `timestamp with time zone` | نعم | `—` | — |

**العلاقات:** `created_by` → `auth.users(id)`؛ `job_id` → `public.aseel_import_jobs(id)`

**الفهارس:** `aseel_import_jobs_pkey`، `aseel_import_jobs_status_idx`

**سياسات RLS:** `aseel_import_jobs_delete_authenticated` (DELETE)؛ `aseel_import_jobs_insert_authenticated` (INSERT)؛ `aseel_import_jobs_select_authenticated` (SELECT)؛ `aseel_import_jobs_update_authenticated` (UPDATE)

<a id="aseelimportjobitems"></a>
#### `public.aseel_import_job_items`

14 حقلًا | RLS: مفعّل | عدد السياسات: 4 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `job_id` | `uuid` | لا | `—` | FK → public.aseel_import_jobs(id) |
| `item_type` | `text` | لا | `—` | CHECK item_type = ANY (ARRAY['movie'::text, 'series'::text, 'episode'::text, 'channel'::text]) |
| `title` | `text` | نعم | `—` | — |
| `season_number` | `integer` | نعم | `—` | — |
| `episode_number` | `integer` | نعم | `—` | — |
| `source_url` | `text` | نعم | `—` | — |
| `target_id` | `uuid` | نعم | `—` | — |
| `status` | `text` | لا | `'pending'::text` | CHECK status = ANY (ARRAY['pending'::text, 'processing'::text, 'imported'::text, 'skipped'::text, 'failed'::text]) |
| `validation_status` | `text` | نعم | `—` | — |
| `error_message` | `text` | نعم | `—` | — |
| `metadata` | `jsonb` | لا | `'{}'::jsonb` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |
| `updated_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `job_id` → `public.aseel_import_jobs(id)`

**الفهارس:** `aseel_import_job_items_job_idx`، `aseel_import_job_items_pkey`

**سياسات RLS:** `aseel_import_job_items_delete_authenticated` (DELETE)؛ `aseel_import_job_items_insert_authenticated` (INSERT)؛ `aseel_import_job_items_select_authenticated` (SELECT)؛ `aseel_import_job_items_update_authenticated` (UPDATE)

<a id="aseeladminauditlogs"></a>
#### `public.aseel_admin_audit_logs`

9 حقلًا | RLS: مفعّل | عدد السياسات: 1 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `actor_id` | `uuid` | نعم | `—` | FK → auth.users(id) |
| `action` | `text` | لا | `—` | — |
| `entity_table` | `text` | لا | `—` | — |
| `entity_id` | `uuid` | نعم | `—` | — |
| `before_data` | `jsonb` | نعم | `—` | — |
| `after_data` | `jsonb` | نعم | `—` | — |
| `request_id` | `text` | نعم | `—` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `actor_id` → `auth.users(id)`

**الفهارس:** `aseel_admin_audit_logs_date_idx`، `aseel_admin_audit_logs_pkey`

**سياسات RLS:** `aseel_admin_audit_logs_select_authenticated` (SELECT)

### الجداول الأقدم

<a id="catalogitems"></a>
#### `public.catalog_items`

8 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `title` | `text` | لا | `—` | — |
| `type` | `text` | لا | `—` | CHECK type = ANY (ARRAY['movie'::text, 'series'::text, 'channel'::text]) |
| `description` | `text` | لا | `''::text` | — |
| `poster_url` | `text` | نعم | `—` | — |
| `stream_url` | `text` | نعم | `—` | — |
| `published` | `boolean` | لا | `false` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**العلاقات:** `item_id` → `public.catalog_items(id)`

**الفهارس:** `catalog_items_pkey`

**سياسات RLS:** `admins manage catalog` (ALL)؛ `public published catalog` (SELECT)

<a id="episodes"></a>
#### `public.episodes`

6 حقلًا | RLS: مفعّل | عدد السياسات: 2 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `item_id` | `uuid` | لا | `—` | FK → public.catalog_items(id) |
| `season_number` | `integer` | لا | `1` | — |
| `episode_number` | `integer` | لا | `—` | — |
| `title` | `text` | لا | `—` | — |
| `stream_url` | `text` | لا | `—` | — |

**العلاقات:** `item_id` → `public.catalog_items(id)`

**الفهارس:** `episodes_item_id_season_number_episode_number_key`، `episodes_pkey`

**سياسات RLS:** `admins manage episodes` (ALL)؛ `public published episodes` (SELECT)

<a id="adminusers"></a>
#### `public.admin_users`

1 حقلًا | RLS: مفعّل | عدد السياسات: 1 | عدد الفهارس: 1

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `user_id` | `uuid` | لا | `—` | PK; FK → auth.users(id) |

**العلاقات:** `user_id` → `auth.users(id)`

**الفهارس:** `admin_users_pkey`

**سياسات RLS:** `admin may see own membership` (SELECT)

<a id="catalogsources"></a>
#### `public.catalog_sources`

7 حقلًا | RLS: مفعّل | عدد السياسات: 0 | عدد الفهارس: 2

| الحقل | نوع البيانات | NULL | القيمة الافتراضية | مفتاح/علاقة/قيود |
| --- | --- | :---: | --- | --- |
| `id` | `uuid` | لا | `gen_random_uuid()` | PK |
| `name` | `text` | لا | `—` | — |
| `discovery_url` | `text` | لا | `—` | CHECK discovery_url ~ '^https://'::text |
| `media_type` | `text` | لا | `—` | CHECK media_type = ANY (ARRAY['movie'::text, 'series'::text]) |
| `enabled` | `boolean` | لا | `false` | — |
| `requires_rights_review` | `boolean` | لا | `true` | — |
| `created_at` | `timestamp with time zone` | لا | `now()` | — |

**الفهارس:** `catalog_sources_name_key`، `catalog_sources_pkey`

## دوال قاعدة البيانات
- `aseel_channel_auto_tags()`
- `aseel_episode_auto_tags()`
- `aseel_infer_genres(p_title text, p_original text, p_description text, p_category uuid, p_kids boolean)`
- `aseel_media_auto_tags()`
- `aseel_quick_publish_series(p_series_id uuid, p_title text, p_episodes jsonb, p_poster_url text)`
- `aseel_refresh_episode_genres()`
- `aseel_reset_link_health_on_edit()`
- `aseel_reset_youtube_health_on_edit()`

## حاويات Supabase Storage

| الاسم | عامة؟ | الأنواع المسموحة |
| --- | :---: | --- |
| `aseel-posters` | نعم | image/jpeg, image/png, image/webp |

## العلاقات بين الجداول الأساسية

- المسلسل `aseel_series` ← الموسم `aseel_seasons` ← الحلقة `aseel_episodes`.
- الروابط الإضافية في `aseel_episodes.stream_variants` (JSONB)؛ نتائج الروابط المستقلة في `aseel_stream_check_results`.
- القنوات `aseel_channels` ← دليل البرامج `aseel_epg_programs`.
- المستخدم في Supabase Auth ← ملف المشاهد، الأطفال، المفضلة، القوائم، السجل، الأجهزة، التنزيلات والإشعارات.
- الاستيراد الجماعي: `aseel_import_jobs` ← `aseel_import_job_items`.
- الإدارة: `aseel_admins` وصلاحيات RLS؛ سجل الإجراءات `aseel_admin_audit_logs`.

## قيود وملاحظات تنفيذية

- جرى إضافة 16 جدولًا بأوامر SQL غير مدمّرة، ولا توجد عملية نقل أو حذف لمحتوى الجداول الأصلية.
- تطبيقات العملاء تحتاج تعديل الـAPI والواجهات للاستفادة من الجداول الجديدة، وليس مجرد وجودها.
- `aseel_offline_downloads` يحتوي بيانات وصفية فقط، ولا يخزّن الفيديوهات المحمّلة من جهاز المستخدم.
- `aseel_stream_check_results` يحفظ بصمة الرابط بدل الروابط الموقعة نفسها لحماية بيانات الاعتماد.
- في التدقيق الأمني: جدول `catalog_sources` القديم مفعّل عليه RLS دون سياسة وصول، وحماية كلمات المرور المسربة في Auth غير مفعلة؛ يُنصح بمراجعتها قبل نشر نظام حسابات جديد.

## الملفات المرتبطة

- [ترحيل SQL للجداول الستة عشر](../supabase/migrations/20261103090000_al_ezz_tv_complete_feature_foundations_20261103.sql)
- [واجهة إدارة حلقات المسلسلات](../admin/series-quick.html)
- [منطق فحص الروابط](../supabase/functions/aseel-link-health/index.ts)
