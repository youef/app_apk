#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const up=read("app/src/main/java/sa/aseel/tv/AppUpdater.java");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const feed=JSON.parse(read("data/android-update.json"));
const workflow=read(".github/workflows/android-stable-release.yml");
assert.match(up,/preferences\.getBoolean\("automatic_checks",true\)/,
  "Automatic checks default on while respecting a viewer who selected off/manual");
assert.match(up,/if\(!manual && !automaticChecksEnabled\(\)\)return;/,
  "Manual checks bypass the automatic preference while background checks respect it");
assert.match(up,/public void setAutomaticChecksEnabled\(boolean enabled\)/);
assert.match(up,/public void cancelPendingDownload\(\)/);
assert.match(up,/manager\.remove\(id\)/,"Stuck download must be cancellable without removing the app");
assert.match(up,/DownloadManager\.STATUS_PAUSED/);
assert.match(up,/pausedReason\(reason\)/,"Pause status must show a diagnostic reason");
assert.match(up,/System\.currentTimeMillis\(\)-pausedSinceMs>60000L/,
  "Abandoned DownloadManager jobs must not remain stuck indefinitely");
assert.match(home,/settings:apk-auto-checks/);
assert.match(home,/settings:app-update/);
assert.match(home,/settings:apk-cancel/);
assert.match(home,/appUpdater\.setAutomaticChecksEnabled/);
assert.match(home,/appUpdater\.check\(true\)/);
assert.match(home,/appUpdater\.cancelPendingDownload\(\)/);
assert.match(home,/appUpdater\.check\(false\)/,
  "Optional automatic update checks are still supported");
assert.equal(feed.required,false,"Routine stable releases must be optional");
assert.equal(feed.min_supported_version_code,0,"Newest release is not a mandatory minimum");
assert.ok(/^  push:$/m.test(workflow),"Native code changes must trigger signed optional updates");
assert.match(workflow,/  workflow_dispatch:/);
assert.match(workflow,/"required": False/);
assert.match(workflow,/"min_supported_version_code": 0/);
console.log("PASS: signed optional auto checks and manual/off modes verified");
