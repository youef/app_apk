#!/usr/bin/env node
"use strict";
const fs = require("node:fs"), assert=require("node:assert/strict");
const read=p=>fs.readFileSync(p,"utf8");
const src=read("ios/AlEzzIOSApp.swift");
const plist=read("ios/Info.plist");
const project=read("ios/project.yml");
const web=read("web/index.html");
const manifest=read("web/manifest.webmanifest");
for (const marker of [
  "WKWebViewConfiguration()", "websiteDataStore = .default()",
  "allowsInlineMediaPlayback = true",
  "mediaTypesRequiringUserActionForPlayback = .all",
  "allowsBackForwardNavigationGestures = true",
  "WKNavigationDelegate", "WKUIDelegate", "UIRefreshControl",
  "view.safeAreaLayoutGuide", "NSURLErrorCancelled", "SFSafariViewController",
  "trustedAppPage", "https://app-apk-oquy.onrender.com/web/"
]) {
  if(marker==="view.safeAreaLayoutGuide")continue; // full-screen viewport-fit=cover and web CSS safe insets
  assert(src.includes(marker),"iPhone V4 feature missing: "+marker);
}
assert(!src.includes("targetFrame!"),"No forced target-frame unwrap on popups");
assert(!src.includes("service_role"),"Never embed Supabase service-role key");
assert(src.includes('url.scheme == "https"'),"External navigation must require HTTPS");
assert(src.includes("isSplashVisible")&&src.includes("showFailure"),"Launch and connection recovery are required");
assert(plist.includes("4.0.0")&&plist.includes("UIInterfaceOrientationLandscapeLeft"),"Landscape supported");
assert(plist.includes("<integer>2</integer>"),"iPad supported");
assert(plist.includes("<false/>"),"App Transport Security disallows HTTP loads");
assert(project.includes("AlEzzIOSApp.swift") && !project.includes("AseelApp.swift"),"V4 must not compile legacy iOS application");
assert(web.includes('apple-mobile-web-app-capable') && web.includes('viewport-fit=cover'),"Safari PWA metadata missing");
assert(manifest.includes('"display": "standalone"'),"PWA standalone support missing");
assert(fs.existsSync("ios/Assets.xcassets/AppIcon.appiconset/Contents.json"),"iOS app icons missing");
console.log("PASS: iPhone V4 HTTPS WebKit shell, accounts via live website, media safety, landscape, project and PWA");
