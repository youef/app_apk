#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict");
const read=p=>fs.readFileSync(p,"utf8");
const native=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const workflow=read(".github/workflows/android.yml");
const css=read("web/css/watermark-v28.css");
const nativeAdd=native.indexOf("root.addView(fixedWatermark,watermarkPosition)");
const chromeAdd=native.indexOf("root.addView(playerHeader,headerPos)");
const hideStart=native.indexOf("private void hideControls(){");
const hideEnd=native.indexOf("private void showControls(",hideStart);
assert(nativeAdd>0&&chromeAdd>nativeAdd,"Native official logo must be a separate layer before chrome");
assert(native.includes('getIdentifier("alizz_brand","drawable",getPackageName())'),"Official installed logo resource required");
assert(native.includes("fixedWatermark.setAlpha(0.82f)"),"Watermark should remain unobtrusive");
assert(native.includes("fixedWatermark.setClickable(false)")&&native.includes("fixedWatermark.setFocusable(false)"),"Never intercept remote/touch");
assert(native.includes("Gravity.TOP|Gravity.LEFT"),"Watermark must be in the physical top-left corner");
assert(hideStart>0&&hideEnd>hideStart&&!native.slice(hideStart,hideEnd).includes("fixedWatermark"),"The 3-second auto-hide must not hide the fixed logo");
assert(native.includes("HIDE_DELAY=3000L"),"Keep the Cinema Pro 3-second UI fade");
assert(workflow.includes("cp web/alizz-tv-transparent.png app/src/main/res/drawable-nodpi/alizz_brand.png"),"Official logo must be bundled in universal Android APK");
for(const path of ["web/index.html","web/index.view"]){
 const html=read(path);
 assert(html.includes('class="player__watermark" src="alizz-tv-transparent.png"'),path+" must use the official PNG");
 assert(html.includes('css/watermark-v28.css?v=official-logo-20261108'),"Stylesheet cache refresh is required");
 assert(html.indexOf('id="video"')<html.indexOf('class="player__watermark"')&&
        html.indexOf('class="player__watermark"')<html.indexOf('class="player__chrome"'),
        "The logo must sit outside controls and above video");
}
assert(css.includes("pointer-events:none!important")&&css.includes("z-index:7"),"Fixed overlay must not block controls");
assert(css.includes(".player.is-embed .player__watermark{display:none!important}"),"Third-party YouTube/embed players must remain unobscured");
console.log("PASS | Official Al Ezz V28 fixed watermark on direct video and 3-second chrome separation");
