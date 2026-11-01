# العز TV v11 — Android TV Native Cinema Rebuild (2026-11-01)

- Replaced the Android launcher with `TVHomeActivity`: lightweight native TV layout, red/black identity and existing logo, clickable movie shelves, series, seasons, ordered episodes, live TV, kids, favorites, searching, and D-pad focused states. Older complex MainActivity stays in source for rollback but is no longer the launcher.
- New `CinemaPlayerActivity`: native ExoPlayer 2.18.7 (legacy API19-compatible) for MP4 and adaptive HLS instead of KitKat VideoView. Buffering progress and explicit error codes, one retry, alternate source choice, external player option, resume position, clean release on exit.
- Catalog still uses the existing Supabase REST API with publishable key only, server policies and license/status filtering, 15-minute cache and no blocking of the UI main thread.
- New install `applicationId` automatically generated for **every APK build** as `sa.alezz.tv.redclassic.b<RUN_ID>a<RUN_ATTEMPT>`. This prevents mismatched signatures but each new copy needs separate activation and favorites.
- Android compileSdk33, minSdk19, targetSdk28, JDK11/Gradle7.6, signed V1 for Android 4.4.4; CI validates manifest, package, resources, ABI and DEX. All releases are test candidates, not stable production-signed without a configured keystore.
- YouTube on Android 4.4 remains outside the reliable feature set due to WebView limitations. This rebuild focuses on licensed MP4/HLS films, series and live TV.
- **Actual playback depends on the source URL, CDN availability/geo restrictions, codec support, SSL trust and the physical device.** CI cannot guarantee that all sources play. Use approved media sources only.
