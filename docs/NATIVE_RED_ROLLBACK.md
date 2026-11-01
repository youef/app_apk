# Android TV — Native red rollback (2026-11-01)

Restores Android **native** red/black v9.3 navigation and Al Ezz TV logo from commit `8d1dd27816af760e147e0b4c603b4eee9a15a4b1` instead of the v10 WebView wrapper (unresponsive on legacy TV remotes).

- Restored `app/` (Java Activities, PIN gate, posters, menu/focus/navigation, playback) and Gradle 7.4.2/Gradle 7.6 toolchain.
- Code version incremented to `17` (name `9.3.1-native-red-rollback`) to prevent Android version downgrade rejection.
- Existing `web/`, `admin/`, `supabase/`, and iOS resources remain untouched.
- CI: `.github/workflows/android.yml` builds and verifies Android API 19 and APK v1 signing; APK is available as workflow artifact.
- **Signing:** Without `AL_EZZ_KEYSTORE_BASE64`, passwords and key alias, GitHub's debug key changes; installing over an existing same-package app can fail. Back up user data and test on a second device before uninstalling a current version.
- Actual remote responsiveness and SSL/media support still need physical TV testing. YouTube playback is subject to the official iframe API and the TV's browser capabilities.
