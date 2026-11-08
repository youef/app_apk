#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const main=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const yt=read("app/src/main/java/sa/aseel/tv/YouTubeActivity.java");
const embed=read("app/src/main/java/sa/aseel/tv/EmbedPlayerActivity.java");
const timeline=read("app/src/main/java/sa/aseel/tv/CinemaSeekBar.java");
const web=read("web/js/player.js");
const css=read("web/css/red-cinema.css");
new vm.Script(web,{filename:"web/js/player.js"});
assert(main.includes("HIDE_DELAY=3000L"),"Native player must auto-hide after 3 seconds");
assert(main.includes("onRenderedFirstFrame()")&&main.includes("onIsPlayingChanged(boolean playing)"),"Player readiness must be frame/playback driven");
assert(main.includes("noteChromeInteraction()")&&main.includes("playbackVisible"),"Key and touch focus must refresh idle timer");
assert(main.includes("progressClock")&&main.includes("new CinemaSeekBar(this)"),"Movie playback must expose real-time progress");
assert(timeline.includes("setProgress(long position,long duration,boolean isLive)"),"Progress must distinguish VOD and LIVE");
assert(timeline.includes("drawRoundRect(new RectF("),"Timeline must avoid API21-only float-rectangle drawing");
assert(main.includes("playerHeader")&&main.includes("alizz_brand"),"Official logo must display inside native player");
assert(main.includes('Button fullscreenButton=tvTool("","ملء الشاشة")')&&main.includes("mediaMuteButton"),"Fullscreen and movie audio controls must exist");
assert(main.includes('kidsPlayback?0xA33D2840:live?0x91301727'),"Live and kids skins should differ");
assert(yt.includes("CHROME_IDLE_MS=3000L")&&yt.includes("alezzvideo://paused"),"YouTube chrome must hide only during playing");
assert(embed.includes("chromeHandler.postDelayed(hideChrome,3000L)")&&embed.includes("embedLoadFailure"),"Embed chrome must keep errors visible");
assert(web.includes("}, 3000);")&&css.includes(".player__brand-mark"),"Web player needs 3-second idle and branding");
for(const p of ["web/index.html","web/index.view"]){
 assert(read(p).includes('class="player__brand-mark"'),p+" must display branded player");
}
console.log("PASS | Cinema Pro V27 shared player behavior, API19 timeline, remote safety");
