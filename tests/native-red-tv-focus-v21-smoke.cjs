#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=x=>fs.readFileSync(x,"utf8");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const glyph=read("app/src/main/java/sa/aseel/tv/CinemaGlyph.java");
const check=(name,condition)=>{assert(condition,name);console.log("PASS:",name);};

const portal=home.slice(home.indexOf("private void portal(){"),home.indexOf("private void refreshLocalPlaylist("));
check("Main portal has exactly three primary groups in order",portal.includes('{"المسلسلات","المواسم والحلقات","series"}') &&
  portal.includes('{"الأفلام","مكتبة السينما","movies"}') &&
  portal.includes('{"البث المباشر","القنوات والبرامج","live"}')&&
  portal.includes('for(int i=0;i<main.length;i++)'));
check("Kids, favorites and settings render as compact shortcuts",portal.includes('{"الأطفال","kids"}') &&
  portal.includes('{"قائمتي","favorites"}') && portal.includes('{"الإعدادات","settings"}') &&
  portal.includes('new LinearLayout.LayoutParams(dp(30),dp(30))') &&
  portal.includes('new LinearLayout.LayoutParams(0,dp(91),1)'));
check("Catalog refresh keeps the focused semantic content item",home.includes("focusedItemTag()") &&
  home.includes("restorePosition(focusTag,previousScroll)")&&
  home.includes("findTagged(content,tag)")&&home.includes("scroller.scrollTo(0,scroll)"));
check("Remote MENU cannot teleport to live from other sections",home.includes('if("live".equals(section))return super.onKeyDown(code,event)') &&
  !home.includes('section="live";render();scroller.scrollTo(0,0);return true;'));
check("Remote numeric channel jumping is live-only",home.includes('if("live".equals(section) && !(getCurrentFocus() instanceof EditText)'));
check("Focus remains stable after channel category changes",player.includes('filter.setTag("filter:"+group)') &&
  player.includes('findViewWithTag("filter:"+group)'));
check("Live and film playback both use compact native vector icons",player.includes('private String playbackGlyph(') &&
  player.includes('new CinemaGlyph(icon,') &&
  player.includes('playButton=tvTool(') && player.includes('Button guideButton=tvTool('));
for(const name of ["playpause","retry","guide","mute","volume","audio","screen","more","close","star"])
  check("Native font-independent icon: "+name,glyph.includes('"'+name+'".equals(name)'));
check("VOD has a native episode/movie drawer instead of a generic alert dialog",
  player.includes("private void updateMediaRail()") &&
  player.includes('episodes?"☷  جميع حلقات المسلسل":"☷  مكتبة الأفلام"') &&
  player.includes("if(live){showChannelGuide();return;}"));
check("D-pad does not redirect focus away from an open rail",player.includes("if(!guideShown&&!optionsShown&&controlPanel!=null&&"));
check("Back dismisses a drawer in all playback modes",player.includes("if(code==KeyEvent.KEYCODE_BACK &&") &&
  player.includes("hideControls();return true;"));
check("Old Android API 19 remains build target",read("app/build.gradle").includes("minSdkVersion 19"));
console.log("PASS: Red TV focus and cinema player drawer static acceptance (device testing still needed).");
