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
  'id="duplicateHint"','id="duplicateSeriesName"','id="useExistingSeries"',
  'series-quick.js','config.js'
])assert.ok(html.includes(marker),marker+" missing from editor");
assert.ok(js.includes('rpc/aseel_quick_publish_series'),"Quick series must call the atomic RPC");
assert.ok(js.includes("p_episodes:data"),"Episodes must be submitted in a single request");
assert.ok(js.includes("p_series_id:selected||null"),"Existing series must be supported");
assert.ok(js.includes("season:g.season"),"Episodes must link to their season");
assert.ok(js.includes("quality:e.quality"),"Individual episode quality must be submitted");
assert.ok(!/service.?role|sb_secret_/i.test(js),"No privileged API keys in browser");
assert.ok(js.includes('function duplicateSuggestion()'),"Duplicate detection before saving");
assert.ok(js.includes('function remapDrafts('),"Draft preservation when switching to existing series");
assert.ok(js.includes('loadExisting(true)'),"Keep pasted links when changing series");
assert.ok(js.includes('SERIES_EXISTS_SELECT_FROM_LIST'),"Handle server-side duplicate race");
const start=js.indexOf("function remapDrafts("),finish=js.indexOf("function groupBySeason(",start);
assert.ok(start>=0&&finish>start,"Pure episode reindexer available");
const remap=vm.runInNewContext("("+js.slice(start,finish).trim()+")");
const migrated=remap([{season:2,episodes:[{url:"https://example.com/1.mp4",quality:"HD"},{url:"https://example.com/2.mp4",quality:"FHD"}]},
 {season:5,episodes:[{url:"https://example.com/3.mp4",quality:"HD"}]}],{2:7,5:0});
assert.deepEqual(Array.from(migrated[0].episodes,function(x){return x.number}),[8,9],
 "Must append after the last existing episode");
assert.equal(migrated[1].episodes[0].number,1,"New season should start from first episode");
assert.throws(function(){remap([{season:1,episodes:[{url:"a",quality:"HD"}]}],{1:300});},
 /300/,"Do not overwrite a season at its 300 episode limit");
console.log("PASS: series, seasons and episodes quick editor, existing series selection and safe draft migration");
