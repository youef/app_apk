#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const viewer=read("web/css/glass.css"),admin=read("admin/glass.css");
const java=read("app/src/main/java/sa/aseel/tv/GlassSurface.java");
function test(label,condition){assert.ok(condition,label);console.log("PASS | "+label);}
for(const p of ["web/index.html","web/index.view","web/youtube-player.html","web/youtube-player.view"]){
  const html=read(p);
  const n=(html.match(/css\/glass\.css\?v=glass-v19-20261107/g)||[]).length;
  test(p+" loads the universal glass layer exactly once",n===1);
}
for(const p of ["admin/index.html","admin/index.view","admin/bulk-import.html",
    "admin/bulk-import.view","admin/import-studio.html","admin/import-studio.view",
    "admin/series-quick.html","admin/series-quick.view"]){
  const html=read(p),n=(html.match(/href="glass\.css\?v=glass-v19-20261107(?:-red-v20)?"/g)||[]).length;
  test(p+" loads the administration glass layer exactly once",n===1);
}
test("Viewer has translucent material tokens and crisp readable text",
  viewer.includes("--glass-panel:rgba")&&viewer.includes("--glass-stroke:rgba")&&
  viewer.includes("color:#f9f9ff"));
test("Glass covers all core audience screens",
  [".topbar",".hero",".card",".live-viewer",".live-guide",".kid-card",
    ".sheet__panel",".live-toolbar",".live-stage__guide-btn"].every(x=>viewer.includes(x)));
test("Glass covers administration, importer and editable forms",
  [".login-card",".table-card",".batch-panel",".imp-sidepanel",".panelCard",".season",
    "input:not([type=checkbox])"].every(x=>admin.includes(x)));
test("Focused buttons preserve visibility and warning colors",
  viewer.includes(".live-guide__item:focus-visible")&&
  admin.includes(":not(.row-btn--danger)")&&admin.includes("[role=alert]"));
test("Only small overlay surfaces blur; mobile and reduced motion disable blur",
  viewer.includes("backdrop-filter:blur(10px)")&&
  viewer.includes("prefers-reduced-transparency:reduce")&&
  viewer.includes("backdrop-filter:none"));
test("Video surface remains black for decoding readability",
  viewer.includes(".live-stage video")&&viewer.includes("background-color:#020407"));
test("KitKat native glass uses drawable gradients, never unsupported runtime blur",
  java.includes("GradientDrawable")&&java.includes("public static GradientDrawable panel")&&
  java.includes("public static GradientDrawable canvas")&&
  !java.includes("RenderEffect.")&&!java.includes("BlurMaskFilter"));
for(const p of ["MainActivity","TVHomeActivity","CinemaPlayerActivity","PlayerActivity","YouTubeActivity"]){
  test(p+" uses the native glass library",
    read("app/src/main/java/sa/aseel/tv/"+p+".java").includes("GlassSurface."));
}
const service=read("web/sw.js");
test("PWA caches public glass CSS without caching session pages",
  service.includes('"css/glass.css"') &&
  service.includes("alezz-shell-member-privacy-")&&
  service.includes('request.mode === "navigate"'));
console.log("PASS | V19 glass theme acceptance. Hardware rendering still requires device testing.");
