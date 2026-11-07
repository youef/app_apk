#!/usr/bin/env node
"use strict";
/* Cross-surface V20 design acceptance, independent of actual media availability. */
const fs=require("node:fs"),assert=require("node:assert/strict"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const css=read("web/css/red-cinema.css"),admin=read("admin/glass.css");
const app=read("web/js/app.js"),tv=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
new vm.Script(app,{filename:"web/js/app.js"});
assert(css.includes("--red:#E33246")&&css.includes("--gold:#E33246"),
  "Red is the single visual accent across old gold-dependent components");
assert(css.includes(".hero")&&css.includes(".card")&&css.includes(".live-guide__item")&&
  css.includes(".title-page .detail__hero")&&css.includes(".player.is-embed")&&
  css.includes(".app-dock")&&css.includes(".searchpanel"),
  "All core viewer routes must use the same glass theme");
assert(css.includes("prefers-reduced-motion:reduce")&&css.includes("forced-colors:active")&&
  css.includes("backdrop-filter:none!important"),
  "Fallbacks are required for older or accessibility-oriented devices");
assert(css.includes("@media(max-width:900px)")&&css.includes(".app-dock a{display:flex")&&
  css.includes(".nav__link span{display:none"),
  "Compact tablet navigation must preserve mobile dock and icon-only links");
for(const p of ["web/index.html","web/index.view","web/youtube-player.html","web/youtube-player.view"]){
  const html=read(p);
  assert(html.includes('red-cinema.css?v=red-glass-buttons-v23-20261107'),
    p+" must load the new theme after the glass layer");
  assert(html.indexOf("glass.css?v=")<html.indexOf("red-cinema.css?v="),
    p+" theme must be last");
}
for(const p of ["web/index.html","web/index.view"]){
  const html=read(p);
  assert(html.includes('data-dock="mylist"')&&!html.includes('data-dock="youtube"'),
    p+" must expose My List on mobile");
  assert((html.match(/class="nav__link"/g)||[]).length===7,
    p+" must keep all seven main routes");
  for(const [slug,label] of [["home","الرئيسية"],["movies","الأفلام"],
    ["series","المسلسلات"],["live","البث المباشر"],["kids","الأطفال"],
    ["youtube","يوتيوب"],["mylist","قائمتي"]]){
    assert(html.includes('data-nav="'+slug+'" aria-label="'+label+'" title="'+label+'"'),
      "Icon-only nav must preserve accessible labels");
  }
}
assert(admin.includes("--gold:#E33246")&&admin.includes(".batch-panel")&&
  admin.includes(".imp-studio")&&admin.includes(".login-card"),
  "Admin, bulk import, login and studios use the red skin");
for(const p of ["admin/index.view","admin/index.html","admin/bulk-import.html",
  "admin/bulk-import.view","admin/import-studio.html","admin/import-studio.view",
  "admin/series-quick.html","admin/series-quick.view"]){
  assert(read(p).includes('glass.css?v=glass-v19-20261107-red-v20'),
    p+" must invalidate the admin theme cache");
}
const manifest=JSON.parse(read("web/manifest.webmanifest"));
assert.equal(manifest.theme_color,"#E33246");
assert(read("web/sw.js").includes('"css/red-cinema.css"'),
  "Only theme CSS may be PWA cached; member HTML and APIs remain private");
assert(read("web/assets/logo.svg").includes("#F14C65"));
assert(read("web/assets/al-ezz-app-icon.svg").includes("#E33246"));

const surface=read("app/src/main/java/sa/aseel/tv/GlassSurface.java");
const icons=read("app/src/main/java/sa/aseel/tv/CinemaGlyph.java");
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const launch=read("app/src/main/res/drawable/red_cinema_launcher.xml");
const android=read("app/src/main/AndroidManifest.xml");
assert(android.includes('android:icon="@drawable/red_cinema_launcher"')&&
  launch.includes('android:drawable="@drawable/alizz_brand"'),
  "Installed APK must have a branded red launcher surface");
assert(surface.includes("0xFF21141F")&&!surface.includes("RenderEffect."),
  "Android 4.4.4 materials must be GPU-light gradients");
for(const name of ["movies","series","live","kids","favorites","settings"]){
  assert(tv.includes('"'+name+'"')&&icons.includes('"'+name+'"'),
    "Native red home icon missing: "+name);
}
assert(tv.includes("new CinemaGlyph(target,0xFFFF7A8D)")&&
  tv.includes('shelf("أفلام مختارة"')&&
  tv.includes("showContinueWatching(false)"),
  "TV launcher needs stroke icons, cinema shelves and resume history");
assert(player.includes("focused?0xFF77233E")&&
  player.includes("PlaybackSources.show(CinemaPlayerActivity.this)"),
  "Native player retains red focus and source picker");
assert(icons.includes("new RectF(")&&!icons.includes("canvas.drawRoundRect(x1"),
  "Native glyphs must use API19-safe Canvas operations");
console.log("PASS: red glass cinema layout, icons, accessibility, admin, PWA and KitKat native UI.");
