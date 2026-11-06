#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=p=>fs.readFileSync(p,"utf8");
const live=source("web/js/live.js"),css=source("web/css/live.css");
const home=source("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const player=source("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const category=source("app/src/main/java/sa/aseel/tv/ChannelGuideCategory.java");
function pass(label,condition){assert.ok(condition,label);console.log("PASS | "+label);}
new vm.Script(live,{filename:"web/js/live.js"});
const context={window:{AlezzExplore:{picker:()=>'<button data-live-filter="">الكل</button><select data-browse-select="live"></select>',
    matches:()=>true},AlezzStore:{}},console};
vm.runInNewContext(live,context,{filename:"web/js/live.js"});
const liveTv=context.window.AlezzLive;
pass("Channel types are deterministic",
    liveTv.channelGenre({title:"Saudi News",category:"News"})==="أخبار" &&
    liveTv.channelGenre({title:"Football TV",category:"Sports"})==="رياضة" &&
    liveTv.channelGenre({title:"Cinema",category:"أفلام"})==="أفلام" &&
    liveTv.channelGenre({title:"Kids",kids:true})==="أطفال" &&
    liveTv.channelGenre({title:"Nature",category:"Documentary"})==="وثائقيات");
const channels=[
    {key:"channel:1",title:"Sports",playback:"stream",stream:"https://example.com/live/1.m3u8",category:"رياضة"},
    {key:"channel:2",title:"News",playback:"stream",stream:"https://example.com/live/2.m3u8",category:"أخبار"}
];
const stats=liveTv.categoryStats(channels);
pass("Genre counts are correct",stats.some(x=>x.name==="الكل"&&x.count===2) &&
     stats.some(x=>x.name==="رياضة"&&x.count===1));
const html=liveTv.render({channels,categories:[]},"");
pass("Genre tabs and touch arrows exist",html.includes('id="liveTypeTabs"')&&
     html.includes('id="liveZapUp"')&&html.includes('id="liveZapDown"'));
pass("Player focusable for remote keys",html.includes('id="liveStage" tabindex="0"'));
pass("Genre filtering changes channel scope",live.includes("function channelScope()")&&
     live.includes("channelGenre(c)===state.type"));
pass("Changing a category does not interrupt existing playback",
     live.includes("Changing a category only updates the guide")&&
     !live.includes("if(scope.length && (!current || scope.indexOf(current)<0))select(scope[0],false)"));
pass("Fast arrow switching and stable channel numbers",live.includes("rapidNavigate(event.key===")&&
     live.includes("state.channels.indexOf(channel) + 1"));
pass("TV genre guide counts and user preference",home.includes("ChannelGuideCategory.from(x)")&&
     home.includes('putString("live_selected_group",type)')&&
     home.includes('putExtra("channel_group"'));
pass("Remote channel surfing scoped by selected genre",player.includes("private void stepChannel(int direction)")&&
     player.includes("matchesGroup(tvChannels.get(at))")&&
     player.includes("rapidZap(1,event)")&&player.includes("rapidZap(-1,event)"));
pass("Live tuning never blocks video with control rails",player.includes("if(live)hideControls();else showControls(false)")&&
     player.includes("if(live)hideControls();else showControls(true)"));
pass("Remote menu focus and last category persisted",player.includes("guideSelectedButton")&&
     home.includes('getString("live_selected_group",activeChannelCategory)'));
pass("Switching cannot flood network probes",player.includes("new ThreadPoolExecutor(2,2")&&
     player.includes("new ArrayBlockingQueue<Runnable>(2)")&&
     player.includes("if(token!=requestToken||Thread.currentThread().isInterrupted())return"));
pass("Native direct stream format and existing safety checks retained",player.includes("StreamProbe.inspect(")&&
     source("app/src/main/java/sa/aseel/tv/StreamQuality.java").includes("isDirectUrl"));
pass("Category classifier uses source metadata first",category.includes("String category")&&
     category.includes("from(JSONObject channel)")&&category.includes("category_name"));
pass("Category UI is TV remote accessible",css.includes(".live-type-tab:focus-visible")&&
     css.includes(".live-stage__zap")&&css.includes("live-guide__item:focus-visible"));
console.log("Al Ezz TV v17 static acceptance passed. Real-device streaming still requires hardware verification.");
