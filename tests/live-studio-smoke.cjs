#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const dir=path.resolve(__dirname,".."),read=x=>fs.readFileSync(path.join(dir,x),"utf8");
const live=read("web/js/live.js"),player=read("web/js/player.js"),css=read("web/css/live.css"),appCss=read("web/css/app.css");
const html=read("web/index.html"),manifest=JSON.parse(read("web/manifest.webmanifest")),icon=read("web/assets/al-ezz-app-icon.svg");
const explore=read("web/js/explore.js");
for(const [name,src] of [["live.js",live],["player.js",player]])new vm.Script(src,{filename:name});
const context={window:{}};
vm.runInNewContext(explore,context,{filename:"explore.js"});
vm.runInNewContext(live,context,{filename:"live.js"});
const L=context.window.AlezzLive;
const page=L.render({channels:[{key:"channel:one",title:"اختبار حي",stream:"https://example.org/live.m3u8",
    category:"أخبار",categoryId:"news",playback:"stream"}],
    categories:[{id:"news",name_ar:"أخبار"}]},"");
for(const id of ["livePip","liveQuality","liveQualityMenu","liveFavoritesFilter","liveFavorite","liveChannelHud",
    "liveGuideItems","liveStart","livePrev","liveNext","liveFullscreen","liveVideo"]){
    assert.ok(page.includes('id="'+id+'"'),"missing TV control "+id);
}
assert.ok(live.includes("markGuideSelection();"),"zapping must preserve guide rows");
assert.ok(!live.includes("    displaySelection(channel);\n    updateGuide();"),"zapping should not redraw all channels");
assert.ok(live.includes("Store.setPref(\"liveFavorites\""),"favorites must persist");
assert.ok(live.includes("Store.setPref(\"lastLiveChannel\""),"last channel must persist");
assert.ok(live.includes("tuneChannelNumber()"),"number pad should tune a station");
assert.ok(live.includes("Hls.Events.MANIFEST_PARSED"),"HLS levels must be read from the manifest");
assert.ok(live.includes("hls.currentLevel=level.index"),"quality menu must select real HLS variants");
assert.ok(live.includes("document.pictureInPictureElement"),"PiP support must be capability-gated");
assert.ok(live.includes('video.canPlayType("application/vnd.apple.mpegurl")'),"iPhone/iPad native HLS must be preferred");
assert.ok(player.includes("ticket !== playbackToken"),"stale player promises must not change a new episode");
assert.ok(player.includes('v.canPlayType("application/vnd.apple.mpegurl")'),"cinema player should use Safari native HLS");
assert.ok(player.includes("attempts++ < 2"),"HLS recovery attempts should be bounded");
assert.ok(html.includes('rel="manifest"'),"installable app manifest required");
assert.ok(html.includes('apple-mobile-web-app-title'),"iPhone home screen metadata missing");
assert.ok(html.includes('href="assets/al-ezz-app-icon.svg"'),"app icon should be linked");
assert.ok(html.includes('css/live.css?v=tv-studio-'),"CSS must bust older browser cache");
assert.ok(html.includes('js/live.js?v='),"live.js must bust older browser cache");
assert.equal(manifest.display,"standalone");
assert.equal(manifest.scope,"./");
assert.ok(manifest.icons.some(x=>x.src.includes("al-ezz-app-icon.svg")));
assert.ok(icon.includes('viewBox="0 0 512 512"'));
for(const marker of [".live-quality-menu",".live-channel-hud",".live-favorites-filter","@media (max-width:600px)"])assert.ok(css.includes(marker),marker+" CSS missing");
assert.ok(appCss.includes("safe-area-inset-bottom"),"iOS safe area missing");
assert.ok(appCss.includes(".player__controls{flex-wrap:wrap"),"phone player controls must wrap");
console.log("PASS: responsive iPhone/iPad, PiP, native HLS, TV remote numbers, favorites, quality, PWA manifest and icon");
