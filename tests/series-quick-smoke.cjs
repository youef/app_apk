#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"admin/series-quick.html"),"utf8");
const js=fs.readFileSync(path.join(root,"admin/series-quick.js"),"utf8");
new vm.Script(js,{filename:"admin/series-quick.js"});
for(const marker of [
  'id="seriesSelect"','id="seriesTitle"','id="seasonGroups"',
  'id="addSeason"','id="addEpisode"','id="addBulk"',
  'id="bulkLinks"','id="bulkQuality"','id="save"',
  'series-quick.js','config.js'
])assert.ok(html.includes(marker),marker+" missing from editor");
assert.ok(js.includes('rpc/aseel_quick_publish_series'),"Quick series must call the atomic RPC");
assert.ok(js.includes("p_episodes:data"),"Episodes must be submitted in a single request");
assert.ok(js.includes("p_series_id:selected||null"),"Existing series must be supported");
assert.ok(js.includes("season:g.season"),"Episodes must link to their season");
assert.ok(js.includes("quality:e.quality"),"Individual episode quality must be submitted");
assert.ok(!/service.?role|sb_secret_/i.test(js),"No privileged API keys in browser");
console.log("PASS: series, seasons and episodes quick editor syntax, links and fields");
