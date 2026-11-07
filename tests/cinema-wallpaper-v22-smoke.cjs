#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict");
const read=x=>fs.readFileSync(x,"utf8");
const wallpaper=read("web/assets/al-ezz-red-glass-background.svg");
const css=read("web/css/red-cinema.css");
const sw=read("web/sw.js");
const native=read("app/src/main/java/sa/aseel/tv/CinemaBackdropDrawable.java");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
assert(wallpaper.startsWith("<svg")&&wallpaper.includes('viewBox="0 0 1920 1080"'),
    "SVG wallpaper must be a responsive 16:9 background");
assert(wallpaper.includes('id="base"')&&wallpaper.includes('id="glassRight"')&&
    wallpaper.includes('id="redLine"')&&!wallpaper.includes("<script"),
    "Wallpaper must remain declarative and noninteractive");
assert(css.includes('url("../assets/al-ezz-red-glass-background.svg")')&&
    css.includes('linear-gradient(180deg,rgba(5,6,10,.46)'),
    "Viewer must apply the red wallpaper with contrast-protecting overlay");
assert(sw.includes('"assets/al-ezz-red-glass-background.svg"')&&
    sw.includes("alezz-shell-member-privacy-")&&
    sw.includes('request.mode === "navigate"'),
    "Cache can store only the public asset, never protected navigation HTML");
assert(native.includes("extends Drawable")&&native.includes("LinearGradient")&&
    !native.includes("RenderEffect")&&!native.includes("BlurMaskFilter"),
    "Native KitKat wallpaper must avoid expensive unsupported blur");
assert(home.includes("root.setBackgroundDrawable(new CinemaBackdropDrawable());")&&
    home.includes("splash.setBackgroundDrawable(new CinemaBackdropDrawable());")&&
    home.includes("panel.setBackgroundDrawable(new CinemaBackdropDrawable());"),
    "Android home, login and splash screens must all use the branded wallpaper");
console.log("PASS: Al Ezz TV red glass wallpaper, native API19 and private PWA shell.");
