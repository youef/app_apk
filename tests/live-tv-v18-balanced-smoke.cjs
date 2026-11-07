#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const live=read("web/js/live.js");
const css=read("web/css/live.css");
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const html=read("web/index.view");
function test(name,condition){assert.ok(condition,name);console.log("PASS | "+name);}
new vm.Script(live,{filename:"web/js/live.js"});
const sandbox={window:{AlezzExplore:{picker:()=>'<button data-live-filter="">الكل</button>',matches:()=>true},AlezzStore:{pref:()=>null,setPref:()=>{}}}};
vm.runInNewContext(live,sandbox,{filename:"web/js/live.js"});
const page=sandbox.window.AlezzLive.render({channels:[{key:"channel:test",title:"News",
    category:"News",stream:"https://example.org/news.m3u8",playback:"stream"}],categories:[]},"");
const iconButtons=["livePrev","liveNext","liveRetry","liveGoLive","liveFavorite","livePip",
    "liveMute","liveFit","liveFullscreen","liveCinemaToggle","liveRefresh","liveGuideOverlay"];
for(const id of iconButtons){
    const re=new RegExp('<button\\b[^>]*\\bid="'+id+'"[^>]*>([\\s\\S]*?)<\\/button>');
    const match=page.match(re);
    test("Icon button "+id+" is accessible",match && match[0].includes('aria-label=') &&
      match[0].includes('title=') && match[1].includes("<svg") &&
      match[1].replace(/<[^>]*>/g,"").trim()==="");
}
test("Quality keeps its necessary text label",page.includes('class="live-quality-label">تلقائي</span>'));
test("Favorite action updates accessible state",live.includes('setLiveAction("liveFavorite","star"') &&
    live.includes('aria-pressed'));
test("Muted state updates the speaker artwork",live.includes('button.innerHTML=icon(muted?"mute":"volume")'));
test("TV fit icon still changes crop mode",live.includes('setLiveAction("liveFit","aspect"') &&
    live.includes('Store.setPref("videoFit"'));
test("Live TV toolbar scrolls without stacking",css.includes('.live-toolbar .live-icon-action') &&
    css.includes('.live-toolbar__spacer') && css.includes('overflow-x:auto'));
test("Focused TV remote buttons announce their actions",player.includes('private Button tvTool(') &&
    player.includes('control.setContentDescription(label)') &&
    player.includes('if(focused)showLiveHud(label)'));
test("Native live and VOD share font-independent vector icon controls",
    player.includes('playButton=tvTool(') &&
    player.includes('Button guideButton=tvTool(') &&
    player.includes('new CinemaGlyph(icon,') &&
    player.includes('if(!live)footer.addView(externalButton'));
test("Native favorite uses existing profile-scoped keys",player.includes('getSharedPreferences("alizz_v11_favorites."+MemberAuth.userId(this)') &&
    player.includes('.putBoolean(profile+".channel:"+itemId,selected)') &&
    player.includes('updateLiveFavorite()'));
test("Native mute persists and ExoPlayer volume follows it",player.includes('putBoolean("live_mute_"+profile,liveMuted)') &&
    player.includes('engine.setVolume(liveMuted?0f:1f)'));
test("Browser cache keys changed but private shell policy retained",html.includes("tv-studio-v18-balanced-20261107") &&
    html.includes("tv-v18-balanced-20261107") &&
    read("web/sw.js").includes("alezz-shell-member-privacy-") &&
    read("web/sw.js").includes("css/glass.css") &&
    read("web/sw.js").includes('request.mode === "navigate"'));
console.log("PASS | V18 icon-first balanced live TV static acceptance; physical-device playback still needs field verification.");
