#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const auth=read("app/src/main/java/sa/aseel/tv/MemberAuth.java");
const memory=read("app/src/main/java/sa/aseel/tv/PlaybackMemory.java");
const css=read("web/css/red-cinema.css");
const js=read("web/js/app.js");
new vm.Script(js,{filename:"web/js/app.js"});
function check(message,expression){assert(expression,message);console.log("PASS:",message);}
check("A featured title preview updates on focus without video autoplay",
    home.includes("private void scheduleFeatured(")&&home.includes("private void applyFeatured(")&&
    home.includes("if(focused&&\"home\".equals(section))scheduleFeatured(item)")&&
    !home.includes("featuredArtwork.setOnClickListener("));
check("Main portal keeps exactly three primary categories with compact extras",
    home.includes('{"المسلسلات","المواسم والحلقات","series"}') &&
    home.includes('{"الأفلام","مكتبة السينما","movies"}') &&
    home.includes('{"البث المباشر","القنوات والبرامج","live"}')&&
    home.includes('{"الأطفال","kids"},{"قائمتي","favorites"},{"البحث","search"},{"الإعدادات","settings"}'));
check("Native poster quality badges and saved watch progress are data-driven",
    home.includes('quality.contains("4K")')&&home.includes('quality.contains("1080")')&&
    home.includes('PlaybackMemory.recent(this,PlaybackMemory.activeProfile(this))')&&
    home.includes("imageSurface.addView(progressView"));
check("Series screen filters seasons locally and remembers the latest played episode",
    home.includes("private void renderSeriesSeason(")&&home.includes('capsule.setTag("season:"+no)')&&
    home.includes('card.setTag("episode:"+id)')&&home.includes("lastEpisodeId")&&
    home.includes("episodeQueue.clear();episodeQueue.addAll(episodes);"));
check("Subscription labels come from verified Auth metadata, not fabricated plan data",
    auth.includes("public static String planName(")&&
    auth.includes('metadata.optString("alezz_plan_name"')&&
    auth.includes("public static int daysRemaining(")&&
    home.includes("MemberAuth.planName(this)")&&home.includes("MemberAuth.daysRemaining(this)"));
check("Playback profiles remain scoped to the authenticated account",
    memory.includes('PREF+"."+(user.matches')&&
    memory.includes("public static String displayProfile(")&&
    memory.includes("public static void renameProfile(")&&
    memory.includes('prefs(context).edit().putString("profile.name."+safe,label).apply()')&&
    home.includes('goTo("profiles")'));
check("Account and profile pages never show missing-catalog warnings",
    home.includes('!"account".equals(section)&&!"profiles".equals(section)'));
check("Web hero preview changes metadata without replacing the focused card",
    js.includes("function previewHeroOnFocus(item)")&&
    js.includes('hero.setAttribute("data-preview-key",item.key)')&&
    js.includes('document.addEventListener("focusin"')&&
    js.includes('if (dot) dot.focus()'));
check("Web poster depth and accessibility feedback are present",
    css.includes(".card__quality")&&css.includes(".card__remaining")&&
    css.includes(".seasons .filter.is-on")&&css.includes(".ep.is-playing")&&
    css.includes("prefers-reduced-motion:reduce"));
console.log("PASS: v24 native cinema/profile and web red glass acceptance; device verification remains recommended.");
