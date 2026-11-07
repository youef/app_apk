Al Ezz TV — iPhone / iPad — Red Glass Cinema V4

To use the strongest iPhone interface immediately, open
https://app-apk-oquy.onrender.com/web/ in Safari, select Share
and choose "Add to Home Screen". This opens the actual, authenticated
current viewer with movies, series, seasons, live television, profiles,
subscription status and mobile red-glass styling.

The native iOS project is ios/AlEzzIOSApp.swift (iOS 15+, HTTPS WKWebView).
Generate the Xcode project on macOS:
  bash ios/generate-app-icons.sh
  cd ios
  xcodegen generate
  open AlEzzTV.xcodeproj

A physical iPhone IPA requires signing and provisioning with Apple Developer.
The GitHub Actions artifact AlEzzTV.app is for iPhone Simulator ONLY.
A ZIP file is not an installable iPhone app. Source and simulator artifacts
are bundled together as al-ezz-tv-iphone-complete-v4.zip.

Workflow: .github/workflows/ios-simulator.yml
Arabic instructions: ios/README-AR.md

Legacy ios/AseelApp.swift remains an old, unbuilt catalog prototype.
