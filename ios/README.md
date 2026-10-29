Aseel TV - iPhone Simulator

Native Swift UIKit app, Arabic interface, movies, series, episodes, official-source channels, favorites, search and automatic refresh every 5 minutes.

GitHub Actions workflow: .github/workflows/ios-simulator.yml
Deliverable: aseel-tv-ios-simulator.app.zip
Upload: https://appetize.io/upload

This archive contains a simulator .app, NOT an IPA for physical iPhones. Publishing and installation on a real iPhone requires an Apple Developer identity and proper signing.

The app reads licensed public Supabase content through RLS. NASA streams are official links, not redistributed media.

Automatic Appetize uploads: set three GitHub Actions secrets, APPETIZE_API_TOKEN and APPETIZE_IOS_PUBLIC_KEY for iOS, plus APPETIZE_ANDROID_PUBLIC_KEY for Android. Both workflows skip Appetize upload safely unless the token and appropriate publicKey are present. Obtain each publicKey from an initial manual upload in Appetize.
