#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const up=fs.readFileSync("app/src/main/java/sa/aseel/tv/AppUpdater.java","utf8");
const home=fs.readFileSync("app/src/main/java/sa/aseel/tv/TVHomeActivity.java","utf8");
const feed=JSON.parse(fs.readFileSync("data/android-update.json","utf8"));
assert.match(up,/public String updateMode\(\)/,"updater exposes persistent mode");
assert.match(up,/public void setUpdateMode\(String mode\)/);
assert.match(up,/"off"\.equals\(mode\).*"manual"\.equals\(mode\).*"automatic"\.equals\(mode\)/);
assert.match(up,/if\("off"\.equals\(updateMode\(\)\)\)/,"no APK check while mode=off");
assert.match(up,/if\(!manual && !automaticChecksEnabled\(\)\)return;/,"no background checks unless automatic");
assert.match(up,/requiredUpdate=false;/,"APK feed cannot force update");
assert.match(up,/private void openBrowserDownload\(\)/);
assert.match(up,/browser\.addCategory\(Intent\.CATEGORY_BROWSABLE\)/);
assert.match(up,/new Intent\(Intent\.ACTION_VIEW,Uri\.parse\(url\)\)/);
const prompt=up.slice(up.indexOf("private void showAvailable(boolean manual)"),up.indexOf("/**\n     * DownloadManager queries",up.indexOf("private void showAvailable(boolean manual)")));
assert.match(prompt,/setPositiveButton\("فتح APK في المتصفح"/);
assert.match(prompt,/openBrowserDownload\(\)/);
assert.doesNotMatch(prompt,/beginDownload\(\)/,"no in-app DownloadManager update from prompt");
assert.doesNotMatch(prompt,/تحديث إلزامي/);
assert.match(prompt,/setCancelable\(true\)/);
for(const key of ["settings:apk-off","settings:apk-manual","settings:apk-auto-checks","settings:app-update"]){
  assert.ok(home.includes(key),"missing settings option "+key);
}
assert.match(home,/appUpdater\.setUpdateMode\("off"\)/);
assert.match(home,/appUpdater\.setUpdateMode\("manual"\)/);
assert.match(home,/appUpdater\.setAutomaticChecksEnabled\(true\)/);
assert.match(home,/if\(!"off"\.equals\(apkUpdateMode\)\)/);
assert.equal(feed.required,false);
assert.equal(feed.min_supported_version_code,0);
console.log("PASS: off/manual/auto update choices; browser-only APK download; never forced");
