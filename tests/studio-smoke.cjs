"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const admin=read("admin/index.html"),viewer=read("web/index.html"),landing=read("index.html");
function ids(html,label){const all=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(all).size,all.length,label+" duplicate DOM IDs");return new Set(all);}
const aid=ids(admin,"Admin");ids(viewer,"Viewer");
for(const id of ["loginScreen","loginForm","loginEmail","loginPassword","appScreen","nav","view","drawer","drawerForm","drawerSave","deleteModal","toasts"])assert.ok(aid.has(id),"Missing admin ID: "+id);
for(const asset of ["web/css/app.css","web/css/app-legacy.css","web/assets/logo.svg","web/data/snapshot.json","admin/admin.css","admin/import-studio.html","admin/legacy-config.js"]){
 assert.ok(fs.statSync(path.join(root,asset)).size>0,"Missing asset: "+asset);
}
for(const src of ["web/js/legacy-polyfills.js","web/js/config.js","web/js/api.js","web/js/store.js","web/js/player.js","web/js/app.js","admin/admin.js","admin/config.js"]){
 new vm.Script(read(src),{filename:src});
}
assert.ok(viewer.includes('src="js/legacy-polyfills.js"'),"Polyfills must be loaded before viewer app");
assert.ok(admin.includes('href="import-studio.html"'),"Legacy importer not reachable");
assert.ok(landing.includes('href="web/"')&&landing.includes('href="admin/"'),"Landing links missing");
const snapshot=JSON.parse(read("web/data/snapshot.json"));assert.ok(snapshot&&typeof snapshot==="object");
for(const unsafe of ["web/__api.html","web/__api2.html","web/__read.html","web/__diag.html","web/__diag2.html","web/__activate.html","web/__ls.html"]){
 assert.ok(!fs.existsSync(path.join(root,unsafe)),"Debug page must not ship: "+unsafe);
}
const health=read("admin/admin.js"),edgeHealth=read("supabase/functions/aseel-link-health/index.ts");
for(const feature of ["runSeriesHealthScan","seriesEpisodeIds","healthStopScan","healthIncludeDrafts","episode_ids:chunk","mode:'series'"]){
 assert.ok(health.includes(feature),"Series link-health feature missing: "+feature);
}
assert.ok(edgeHealth.includes('!children.length?"unchecked"'),"Series without published episodes must not be marked broken");
assert.ok(edgeHealth.includes("checkRow(tab.name,row,true)"),"All saved variant links must be probed");
console.log("PASS: new admin, legacy importer, viewer assets, browser compatibility and download links");