#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
function read(p){return fs.readFileSync(path.join(root,p),"utf8");}
const player=read("web/js/player.js"),app=read("web/js/app.js"),api=read("web/js/api.js");
const html=read("web/index.html"),css=read("web/css/app.css");
for (const file of ["web/js/player.js","web/js/app.js","web/js/api.js"])
  new vm.Script(read(file),{filename:file});
assert.ok(html.includes('id="playerQualityMenu"'),"Quality menu must exist inside player");
assert.ok(html.includes('aria-controls="playerQualityMenu"'),"Quality trigger needs accessible menu link");
assert.ok(html.includes('aria-expanded="false"'),"Quality trigger needs expanded state");
assert.ok(/player\.js\?v=(?:quality-select|tv-studio)-/.test(html),"Player cache bust required");
assert.ok(html.includes("app.js?v=quality-select"),"Episode payload cache bust required");
assert.ok(/app\.css\?v=(?:quality-select|tv-studio)-/.test(html),"Responsive styling cache bust required");
assert.ok(css.includes(".player__quality-menu[hidden]"),"Hidden quality menu must not be visible");
assert.ok(css.includes(".player__quality-option:focus-visible"),"D-pad focus must be visible");
assert.ok(app.includes("variants: episode.variants || []"),"Episode must forward its stream variants");
assert.ok(app.includes("variants: next.variants || []"),"Next episode must forward variants");
assert.ok(app.includes("variants: item.variants || []"),"Movies must forward stream variants");
assert.ok(api.includes("variants: Array.isArray(e.stream_variants)"),"API must normalize episode variants");
assert.ok(player.includes("Hls.Events.MANIFEST_PARSED"),"HLS levels must be read from live manifest");
assert.ok(player.includes("instance.levels || []"),"HLS levels must be obtained from the player");
assert.ok(player.includes('instance.currentLevel = match.index'),"Preference should follow compatible HLS levels");
assert.ok(player.includes("hls.currentLevel = levelIndex"),"Manual HLS quality selection must change rendition");
assert.ok(player.includes("switchQualitySource(qualitySources[index].url)"),"Explicit quality URL must be selectable");
assert.ok(player.includes("Store.setPref(\"preferredPlaybackQuality\""),"Chosen quality preference must be saved");
assert.ok(player.includes('el.video.currentTime = position'),"Switch must restore playhead position");
assert.ok(player.includes('row.setAttribute("role", "menuitemradio")'),"Menu must work with accessibility controls");
assert.ok(!player.includes("cycleQuality()"),"Cycling button must be replaced with direct picker");
console.log("PASS: real HLS levels, per-episode variant quality picker, resume and cache markers");
