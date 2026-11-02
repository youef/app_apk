"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8"),app=read("web/js/app.js"),player=read("web/js/player.js");
const page=read("web/index.html"),css=read("web/css/unified.css");
new vm.Script(app);new vm.Script(player);
for(const name of ["function viewDetail(key)","function viewWatch(key)","function leaveWatch()",
  'case "title": html = viewDetail(route.arg)','case "watch": html = viewWatch(route.arg)',
  "document.body.appendChild(playerNode)","location.hash = detailLink(key)",
  "location.hash = watchLink(epKey)"]) assert(app.includes(name),"Missing routed feature: "+name);
assert(!app.includes("sheet.hidden = false;"),"Details must no longer open popup");
assert(app.includes("currentSeries.seasons"),"Season picker must target open series");
assert(page.includes('id="player"')&&page.includes("viewport-fit=cover"));
assert(css.includes("body.watch-route #player")&&css.includes(".watch-player-slot"));
assert(css.includes("orientation:landscape")&&css.includes("safe-area-inset-left")&&css.includes("safe-area-inset-bottom"));
assert(player.includes("window.Alezz.leaveWatch"));
console.log("PASS: full-page title/watch routing, episodes and landscape safe areas");
