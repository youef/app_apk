#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
for(const f of ["web/js/app.js","web/js/player.js","web/js/live.js","web/js/install.js","web/sw.js"])
  new vm.Script(read(f),{filename:f});
const html=read("web/index.html"),app=read("web/js/app.js"),player=read("web/js/player.js"),
 live=read("web/js/live.js"),install=read("web/js/install.js"),style=read("web/css/unified.css"),sw=read("web/sw.js");
const manifest=JSON.parse(read("web/manifest.webmanifest"));
assert(html.includes('id="btnFit"')&&player.includes("function toggleFit()"),"Film zoom control missing");
assert(player.includes("webkitEnterFullscreen")&&player.includes("requestFullscreen"),"iOS fullscreen fallback missing");
assert(live.includes('id="liveFit"')&&live.includes("webkitEnterFullscreen"),"Live zoom and fullscreen missing");
assert(app.includes("experienceHeader(route.name)")&&app.includes("is-experience"),"Unified views missing");
assert(html.includes('class="app-dock"')&&html.includes('data-install-app'),"Install action/mobile dock missing");
assert(install.includes("beforeinstallprompt")&&install.includes("إضافة إلى الشاشة الرئيسية"),"Install help missing");
assert(sw.includes("snapshot.json")&&sw.includes('request.method!=="GET"'),"Safe offline catalog missing");
assert(manifest.id&&manifest.start_url&&manifest.scope&&manifest.display==="standalone","PWA manifest incorrect");
assert(style.includes(".experience-hero")&&style.includes(".app-dock")&&style.includes(".player.is-cropped"),"Shared visual CSS missing");
console.log("PASS: shared UI, iOS/Android fullscreen and installable PWA shell");
