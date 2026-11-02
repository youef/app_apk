"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8"),app=read("web/js/app.js"),css=read("web/css/unified.css"),html=read("web/index.html");
new vm.Script(app);
for(const part of ["function relatedHTML(item)","function filterVisibleEpisodes()","function shareCurrent(key,route)","episodeSearch","episodeControls","data-share-route"])
 assert(app.includes(part),"Missing cinema UI feature: "+part);
assert(css.includes(".episode-tools__search")&&css.includes(".watch-episode-nav")&&css.includes(".episode-line[hidden]"));
assert(html.includes("cinema-refined-20261102-v1"));
console.log("PASS: fast cinema recommendations, episode search, sharing and watch navigation");