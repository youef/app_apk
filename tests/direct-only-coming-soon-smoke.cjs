#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = p => fs.readFileSync(p,"utf8");
const player=read("web/js/player.js"),live=read("web/js/live.js");
const app=read("web/js/app.js"),viewer=read("web/index.view");
const tv=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const legacy=read("app/src/main/java/sa/aseel/tv/MainActivity.java");
const cinema=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const fallback=read("app/src/main/java/sa/aseel/tv/UnavailableVideoActivity.java");
const sources=read("app/src/main/java/sa/aseel/tv/PlaybackSources.java");
assert(!player.includes("window.open("),"VOD player must never open an external browser");
assert(!live.includes("window.open("),"Live player must never open an external browser");
assert(!app.includes("window.open("),"Movie/episode clicks must never open external viewing pages");
assert(!tv.includes("Intent.ACTION_VIEW"),"Native TV content should not exit the app");
assert(!legacy.includes("Intent.ACTION_VIEW"),"Legacy TV content should not exit the app");
assert(!cinema.includes("Intent.ACTION_VIEW"),"ExoPlayer failure cannot launch another app");
assert(!tv.includes("new Intent(this,EmbedPlayerActivity.class)"),"TV embed webview must be unreachable");
assert(!legacy.includes("new Intent(this,EmbedPlayerActivity.class)"),"Legacy embed webview must be unreachable");
assert(tv.includes("UnavailableVideoActivity.show(")&&cinema.includes("UnavailableVideoActivity.show("));
assert(sources.includes('if(path.endsWith(".mpd"))return "dash"'),"Native DASH classification");
assert(player.includes('if(/\\.mpd$/i.test(u.pathname))return "dash"'),"Web DASH classification");
assert(viewer.includes('id="playerComingSoonVideo"')&&viewer.includes('id="playerErrorTitle"'));
assert(live.includes('id="liveComingSoonVideo"')&&live.includes('id="liveUnavailable"'));
assert(fallback.includes("setLooping(true)")&&fallback.includes('getIdentifier("al_ezz_coming_soon"'));
assert(fallback.includes("android.resource://")&&!fallback.includes("WebView"));
for(const path of ["web/assets/al_ezz_coming_soon.mp4","app/src/main/res/raw/al_ezz_coming_soon.mp4"]){
  const data=fs.readFileSync(path);
  assert(data.length>15000 && data.subarray(4,8).toString()==="ftyp",path+" is a valid MP4 container");
}
assert(fs.readFileSync("app/src/main/res/raw/al_ezz_coming_soon.mp4").equals(
  fs.readFileSync("web/assets/al_ezz_coming_soon.mp4")),"Web/TV use identical first-party media");
console.log("PASS: browser-free direct playback (HLS/MP4/DASH) with original in-app MP4 fallback");
