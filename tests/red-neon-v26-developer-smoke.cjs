#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs");
const get=p=>fs.readFileSync(p,"utf8");
const home=get("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const player=get("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const dev=get("app/src/main/java/sa/aseel/tv/DeveloperActivity.java");
const yt=get("app/src/main/java/sa/aseel/tv/YouTubeActivity.java");
assert(home.includes('new Intent(this,DeveloperActivity.class)'),"Developer route");
assert(home.includes("CinemaNeonDrawable")&&home.includes("CinemaPosterView"),"Poster glow");
assert(player.includes("GlassSurface.transparentHeader"),"Player transparent chrome");
assert(yt.includes("GlassSurface.transparentHeader")&&yt.includes("CinemaPosterView"),"YouTube UI");
assert(dev.includes("https://wa.me/966538243481")&&dev.includes("f.0x0"),"Contacts");
assert(get("web/js/app.js").includes('case "developer": html = viewDeveloper();'),"Web route");
assert(get("app/src/main/AndroidManifest.xml").includes('android:name="sa.aseel.tv.DeveloperActivity"'),"Activity manifest");
assert(get("app/build.gradle").includes("minSdkVersion 19"),"Android 4.4 support");
console.log("PASS | Red Neon V26 + Developer + API19");
