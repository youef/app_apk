#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const read=path=>fs.readFileSync(path,"utf8");
const live=read("web/js/live.js");
const context={window:{
  AlezzExplore:{picker:()=>'<button data-live-filter="">الكل</button>',matches:()=>true},
  AlezzStore:{pref:()=>null,setPref:()=>{}}
}};
vm.runInNewContext(live,context,{filename:"web/js/live.js"});
const guide=context.window.AlezzLive;
const mbc={key:"channel:1",title:"MBC 5",category:"قنوات MBC",stream:"https://example.org/mbc5.m3u8",playback:"stream",genreTags:["general"]};
const drama={key:"channel:2",title:"MBC DRAMA",category:"قنوات MBC",stream:"https://example.org/drama.m3u8",playback:"stream",genreTags:["series"]};
const kids={key:"channel:3",title:"MBC 3",category:"قنوات MBC",stream:"https://example.org/kids.m3u8",playback:"stream",genreTags:["kids"]};
const sport={key:"channel:4",title:"beIN SPORTS 1",category:"قنوات رياضية عالمية",stream:"https://example.org/sports.m3u8",playback:"stream",genreTags:["sports"]};
assert.equal(guide.channelCompany(mbc),"MBC");
assert.equal(guide.channelCompany(drama),"MBC");
assert.equal(guide.channelCompany(sport),"beIN SPORTS");
assert.equal(guide.channelGenre(drama),"مسلسلات");
assert.equal(guide.channelGenre(kids),"أطفال");
assert.equal(guide.channelGenre(sport),"رياضة");
assert.equal(guide.channelGenre(mbc),"عامة");
const stats=guide.companyStats([mbc,drama,kids,sport]);
assert.equal(stats.find(c=>c.name==="MBC").count,3);
assert.equal(stats.find(c=>c.name==="beIN SPORTS").count,1);
const sorted=[{title:"زهراء",key:"z"},{title:"أحمد",key:"a"},{title:"بدر",key:"b"}].sort(guide.compareChannels);
assert.equal(sorted.map(x=>x.title).join(","),"أحمد,بدر,زهراء");
const html=guide.render({channels:[sport,mbc,kids,drama],categories:[]},"");
assert.ok(html.includes('id="liveCompanyTabs"')&&html.includes('id="liveTypeTabs"'));
assert.ok(html.includes('aria-label="الشركة أو شبكة القنوات"'));
assert.ok(live.includes('state.company==="الكل" || channelCompany(c)===state.company'));
assert.ok(live.includes('.sort(compareChannels)'));
const api=read("web/js/api.js");
assert.ok(api.includes('aName.localeCompare(bName, "ar"'));
const native=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const classifier=read("app/src/main/java/sa/aseel/tv/ChannelGuideCategory.java");
assert.ok(classifier.includes("broadcaster(JSONObject channel)"));
assert.ok(native.includes('putString("live_selected_company",network)'));
assert.ok(native.includes('putExtra("channel_company"'));
assert.ok(native.includes('item.put("category_name"'));
assert.ok(native.includes('sortChannels();'));
assert.ok(player.includes('intent.getStringExtra("channel_company")'));
assert.ok(player.includes('activeCompany.equals(companyFor(channel))'));
assert.ok(read("web/css/live.css").includes(".live-company-tabs"));
console.log("PASS: MBC company category, independent genre, Arabic alphabetical order, native player and web filters.");
