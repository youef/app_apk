#!/usr/bin/env node
"use strict";
const fs=require("fs"),vm=require("vm"),assert=require("assert");
const read=p=>fs.readFileSync(p,"utf8");
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const css=read("web/css/live.css");
const js=read("web/js/live.js");
function check(label,condition){assert.ok(condition,label);console.log("PASS | "+label);}
check("Native fullscreen broadcast does not force open both channel rails",player.includes("setRailsVisible(!live)")&&player.includes("showChannelGuide()"));
check("Native channel information HUD auto hides",player.includes("showLiveHud(")&&player.includes("hideLiveHud")&&player.includes("3800L"));
check("Remote guide and channel keys have dedicated handlers",player.includes("KEYCODE_GUIDE")&&player.includes("KEYCODE_CHANNEL_UP")&&player.includes("KEYCODE_CHANNEL_DOWN")&&player.includes("KEYCODE_DPAD_UP"));
check("Native guide can be dismissed without leaving playback",player.includes("code==KeyEvent.KEYCODE_BACK && live")&&player.includes("hideControls();return true;"));
check("Native broadcast quality saved per-channel",player.includes('getString("quality_"+itemId,"auto")'));
check("Native channel catalog uses limited rendering",home.includes("liveGuideLimit=48")&&home.includes("matching>displayed")&&home.includes("liveGuideLimit+48"));
check("Native channel catalog supports favorites",home.includes('types.add("المفضلة")')&&home.includes('isFavorite(x)'));
check("Immersive layout is responsive",css.includes(".live-page--cinema .live-guide{display:none}")&&css.includes("@media (max-width:650px)"));
check("Adaptive HLS reports actual playback resolution",js.includes("Hls.Events.LEVEL_SWITCHED")&&js.includes("selected.height"));
const sandbox={
  window:{
    AlezzExplore:{picker:()=>'CATEGORY_PICKER',matches:()=>true},
    AlezzStore:{pref:()=>null,setPref:()=>{}}
  },
  setTimeout,clearTimeout,console
};
vm.runInNewContext(js,sandbox,{filename:"web/js/live.js",timeout:1500});
const Live=sandbox.window.AlezzLive;
const sample={channels:[{
  key:"channel:demo",title:"قناة اختبار",playback:"stream",
  stream:"https://example.org/live/channel.m3u8",category:"أخبار"
}],categories:[]};
const html=Live.render(sample,"");
check("Real renderer includes TV mode and quick guide button",
  html.includes('id="liveCinemaToggle"')&&html.includes('id="liveGuideOverlay"'));
check("Category filters live inside the channel guide",
  html.indexOf('<aside class="live-guide"')<html.indexOf('id="liveFilters"'));
check("Live player and guide retain direct playable stream",html.includes('id="liveVideo"')&&Live.playable(sample.channels[0]));
check("Unsafe or non-media URL cannot start playback",!Live.playable({playback:"stream",stream:"http://example.com/video.m3u8"}));
console.log("Al Ezz TV v16 live viewing integration checks passed; physical device verification remains necessary.");
