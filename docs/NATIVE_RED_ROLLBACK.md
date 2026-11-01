# Android TV — Red Classic fresh-install fix (November 2026)

Android native red/black v9.3 design, original Al Ezz logo and D-pad navigation restored from commit `8d1dd27816af760e147e0b4c603b4eee9a15a4b1`.

**For "App not installed":** independent Android application ID `sa.alezz.tv.redclassic` bypasses same-package signature mismatch. Do not uninstall the older app. New version `9.3.2-redclassic-fresh-install`, versionCode 18, minSdk 19, Android 4.4.4 compatible DEX and V1 signature validated by CI.

- Java source package `sa.aseel.tv` and fully qualified Activities stay intact.
- Gradle 7.6, AGP 7.4.2, Java 7 source compatibility, Conscrypt, native UI.
- CI validates package, manifest, signing, ABI, ZIP, DEX. Rejected builds cannot publish.
- One immutable GitHub prerelease `al-ezz-tv-redclassic-install-test-v1` hosts the test APK for direct download.
- If no protected signing secrets are configured the APK is *debug signed* and future builds may use a different key. Do not treat as production/update-stable.
- Existing `web/`, `admin/`, `supabase/`, and iOS remain unchanged.
- Physical TV compatibility, media playback, and D-pad responsiveness still require on-device verification.
