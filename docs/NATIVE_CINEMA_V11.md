# العز TV v11 — Android TV Native Cinema Rebuild (2026-11-01)

- Replaced the Android launcher with `TVHomeActivity`: lightweight native TV layout, red/black identity and existing logo, clickable movie shelves, series, seasons, ordered episodes, live TV, kids, favorites, searching, and D-pad focused states. Older complex MainActivity stays in source for rollback but is no longer the launcher.
- New `CinemaPlayerActivity`: native ExoPlayer 2.18.7 (legacy API19-compatible) for MP4 and adaptive HLS instead of KitKat VideoView. Buffering progress and explicit error codes, one retry, alternate source choice, external player option, resume position, clean release on exit.
- Catalog still uses the existing Supabase REST API with publishable key only, server policies and license/status filtering, 15-minute cache and no blocking of the UI main thread.
- New install `applicationId` automatically generated for **every APK build** as `sa.alezz.tv.redclassic.b<RUN_ID>a<RUN_ATTEMPT>`. This prevents mismatched signatures but each new copy needs separate activation and favorites.
- Android compileSdk33, minSdk19, targetSdk28, JDK11/Gradle7.6, signed V1 for Android 4.4.4; CI validates manifest, package, resources, ABI and DEX. All releases are test candidates, not stable production-signed without a configured keystore.
- YouTube on Android 4.4 remains outside the reliable feature set due to WebView limitations. This rebuild focuses on licensed MP4/HLS films, series and live TV.
- **Actual playback depends on the source URL, CDN availability/geo restrictions, codec support, SSL trust and the physical device.** CI cannot guarantee that all sources play. Use approved media sources only.

## v11.1 hotfix — YouTube kids catalog + media failure diagnostics

- The 34 published children YouTube videos were present in `aseel_youtube_videos`; the v11 launcher did **not load the table**. The new app fetches only `status=published,is_kids=true`, validates YouTube IDs, displays thumbnails and restores a YouTube tab and Kids shelf. Playback uses official YouTube IFrame API when supported and official app/browser fallback on ancient WebViews.
- Unlike a filename extension, a small TLS-validated HTTPS range response from `StreamProbe` detects `text/html`, error JSON, HTTP 401/403/404/410 and identifies HLS/MP4 markers before playback. Only an initial 1 KB sample is read, without downloading a video or circumventing site restrictions.
- ExoPlayer chooses detected HLS MIME when necessary, attempts each available distinct approved quality URL once, shows specific parser/network/decoder failure messages, and lets the user retry or choose another media player.
- Passing the APK build does **not** validate that live streams, hosted films or YouTube embeds play on the particular Android 4.4 television. Replace inaccessible or unsupported third-party video links with licensed playable H.264/AAC MP4 or compatible HLS sources from the admin interface. No website scraping or DRM bypass.
