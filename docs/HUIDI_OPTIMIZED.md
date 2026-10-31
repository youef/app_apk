# أسيل TV 2.0.0 — Huidi Android 4.4.4

الجهاز: CVTE SMART_PC822 / Android 4.4.4 API19 / ARMv7 32-bit / ذاكرة 468 MB تقريبًا.

- الحزمة الجديدة `sa.aseel.tv.huidi` مستقلة عن `sa.aseel.tv` و`sa.aseel.tv.full` و`sa.aseel.tv.kitkatfix`، فلا تحذف النسخ السابقة.
- تحميل أربعة أقسام في وقت واحد، مع الاستفادة من Cache الحديث فقط خلال 15 دقيقة ومنع إظهار البيانات القديمة بعد انتهاء صلاحية الحقوق.
- ذاكرة الصور حتى 2MB، RGB565، وضع خفيف لتعطيل الأغلفة، وتنظيف الذاكرة أثناء ضغط النظام.
- دعم أزرار الريموت التشغيل/الإيقاف والتقديم/الترجيع وإظهار شريط التحكم تلقائيًا.
- استمرار TLS الحديث مع التحقق من الشهادات؛ تشخيص SSL متاح من الإعدادات.
- جرّب الأفلام والقنوات واختبار MP4 ثم صور رمز الخطأ إن ظهر؛ نجاح البناء لا يضمن تشغيل كل ملف على جهازك.

**التثبيت:** نزّل `aseel-tv-huidi-optimized-api19.apk` وتأكد أن اسمه «أسيل TV | إصدار الشاشة» عند التثبيت.

**التحديثات القادمة:** توقيع Debug في GitHub غير ثابت. يلزم إعداد مفتاح توقيع دائم ومحمي في Secrets حتى يمكن تحديث حزمة Huidi دون حذفها، ولا ينبغي رفع المفتاح إلى مستودع عام.

## v2.2 Cinema Quality
- Quality choices are only for real URLs stored in stream_variants; app defaults to low-bandwidth on API19.
- Updated app ID sa.aseel.tv.cinema avoids conflicting debug signing certificate with previous Huidi builds.
- Stable production signing key still needed for in-place updates.

## Cinema Quality v2.2 — Android TV interface and playback
- Native UI improvements: cinematic hero gradient, gold selection state in remote navigation, content counts, quality availability indicators, focus styling for player controls.
- Support real publisher-provided `stream_variants`: up to 8 HTTPS URLs per movie, episode or channel. The default stream remains available. Unsupported/unlicensed qualities are NEVER synthesized or transcoded.
- API 19 default selects the lowest known source to reduce stalls. Remote-friendly quality popup enables switching when multiple sources exist; per-item preference is saved locally. For a single source there is an honest explanation rather than artificial 720p/1080p options.
- Recovery: playback buffering event instrumentation and up to 2 stream reconnect attempts with a lower quality if one exists; retry budget resets on a manual switch.
- HLS live on KitKat remains hardware dependent: the external-player button remains available. No guarantee of automatic bitrate adaptation on stock Android 4.4 MediaPlayer.
- MP4 720p/1080p compatibility depends on codec profile and decoder; 360p or 480p H.264/AAC recommended where authorized variants exist.
- Build uses independent package `sa.aseel.tv.cinema` because previous GitHub debug certificates are not stable across builds. A permanent signing key is still required for a repeatable upgrade path.
- This version does not claim to eliminate poor bandwidth, inaccessible upstream links, or missing hardware codecs.

- When HLS master playlists expose safe HTTPS same-host rendition URLs, a bounded background check discovers actual resolution/bitrate choices on opening a channel. It never transcodes HLS or guarantees the old system MediaPlayer can decode it. External player remains an option.
