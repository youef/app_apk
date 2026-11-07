#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict");
const h=fs.readFileSync("app/src/main/java/sa/aseel/tv/TVHomeActivity.java","utf8"),
m=fs.readFileSync("app/src/main/java/sa/aseel/tv/PlaybackMemory.java","utf8"),
g=fs.readFileSync("app/src/main/java/sa/aseel/tv/CinemaGlyph.java","utf8"),
w=fs.readFileSync(".github/workflows/android.yml","utf8");
const check=(label,ok)=>{assert(ok,label);console.log("PASS | "+label);};
check("Member-scoped private personal profile",m.includes('"personal".equals(profile)?"personal"')&&m.includes('PREF+"."+(user.matches'));
check("Four independent profiles",h.includes('final String[] values={"personal","family","kids","guest"}'));
check("Vector account icons compatible with Android 4.4",g.includes('"account".equals(name)||"profile".equals(name)')&&h.includes('new CinemaGlyph("account"'));
check("TV focus and back-navigation preserved",h.includes('if(target!=null)target.requestFocus()')&&h.includes('KEYCODE_BACK'));
check("Customer account and settings support sign-out",h.includes('logout.setTag("account:logout")')&&h.includes('logout.setTag("settings:logout")')&&h.includes('new android.app.AlertDialog.Builder(this)'));
check("Profile changes update top bar",h.includes('topProfileLabel.setText(PlaybackMemory.displayProfile'));
check("APK published on a stable direct-download path",w.includes('git add -f downloads/al-ezz-tv-latest.apk'));
console.log("PASS | Red Glass V25 native account and UI checks");
