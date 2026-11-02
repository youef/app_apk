#!/usr/bin/env node
"use strict";
const fs=require("fs"),assert=require("assert");
const home=fs.readFileSync("app/src/main/java/sa/aseel/tv/TVHomeActivity.java","utf8");
const player=fs.readFileSync("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java","utf8");
const workflow=fs.readFileSync(".github/workflows/android.yml","utf8");
function check(n,ok){assert.ok(ok,n);console.log("PASS "+n);}
check("Splash -> welcome -> portal",home.includes("showSplash()")&&home.includes("showWelcome()")&&home.includes("startViewer()"));
check("No viewer PIN or login",!home.includes("PinGate.")&&!home.includes("loginUser")&&!home.includes("activation_code"));
check("Six actionable RTL tiles",["series","movies","live","kids","favorites","settings"].every(k=>home.includes('"'+k+'"'))&&home.includes("private void portal()")&&home.includes("dashboardTile("));
check("Real remote focus on native tiles",home.includes("tile.setOnFocusChangeListener")&&home.includes("tile.setOnClickListener")&&home.includes("setScaleX"));
check("Native catalog from Supabase",home.includes("catalog.listQuery(")&&home.includes("aseel_seasons")&&home.includes("aseel_episodes"));
check("Native player",home.includes("CinemaPlayerActivity.class")&&player.includes("ExoPlayer.Builder"));
check("No external browser for official-link-only channels",home.includes("المحتوى غير قابل للتشغيل داخل التطبيق")&&!home.includes("Intent.ACTION_VIEW"));
check("Settings are persisted and honored by player",home.includes('prefs.edit().putBoolean("auto_next"')&&player.includes('getBoolean("auto_next",true)'));
check("V14 APK and API19",workflow.includes("14.0.0-native-")&&workflow.includes("v14-figma-native-api19.apk"));
console.log("Figma v14 UI acceptance static checks passed; real TV installation still requires hardware verification.");
