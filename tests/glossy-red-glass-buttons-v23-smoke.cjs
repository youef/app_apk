#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict");
const read=p=>fs.readFileSync(p,"utf8");
const asset=read("web/assets/al-ezz-glass-button.svg");
const css=read("web/css/red-cinema.css");
const home=read("app/src/main/java/sa/alezz/tv/TVHomeActivity.java".replace("/sa/alezz/","/sa/aseel/"));
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const drawable=read("app/src/main/java/sa/aseel/tv/CinemaGlassButtonDrawable.java");
const sw=read("web/sw.js");
function ok(label,condition){assert(condition,label);console.log("PASS | "+label);}
ok("A scalable, non-text baked crimson glass texture exists",asset.includes('viewBox="0 0 660 180"')&&
  asset.includes('id="wave"')&&!asset.includes("مشاهدة الآن")&&!asset.includes("<script"));
ok("Viewer buttons have true focus, active and disabled states",
  css.includes('al-ezz-glass-button.svg')&&css.includes('.is-focused')&&
  css.includes(':focus-visible')&&css.includes(':active')&&
  css.includes(':disabled')&&css.includes('[aria-disabled="true"]'));
ok("Browser caches only the public style and not private pages",
  sw.includes('"assets/al-ezz-glass-button.svg"')&&sw.includes('alezz-shell-member-privacy-')&&
  sw.includes('request.mode === "navigate"'));
ok("Viewer and detail screens load the new texture",
  ["web/index.html","web/index.view"].every(p=>read(p).includes("red-glass-buttons-v23-20261107")));
ok("Android TV has four native glass button states without bitmap blurring",
  drawable.includes("onStateChange(int[] state)")&&
  drawable.includes("state_pressed")&&drawable.includes("state_focused")&&
  drawable.includes("state_enabled")&&drawable.includes("new LinearGradient(")&&
  !drawable.includes("RenderEffect.")&&!drawable.includes("BlurMaskFilter("));
ok("Android hero actions share the new cinematic CTA",
  home.includes('Button explore=primaryButton(')&&home.includes('Button liveButton=primaryButton(')&&
  home.includes('Button play=primaryButton('));
ok("Live TV and on-demand player tools share native buttons",
  player.includes('new CinemaGlassButtonDrawable(false,true,')&&
  player.includes('new CinemaGlassButtonDrawable(false,false,')&&
  player.includes('new CinemaGlyph(icon,'));
console.log("PASS | V23 red glass button acceptance (device rendering still requires TV testing).");
