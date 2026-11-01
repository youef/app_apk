#!/usr/bin/env node
"use strict";
const fs=require("fs");
const assert=require("assert");
const read=(file)=>fs.readFileSync(file,"utf8");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const source=read("app/src/main/java/sa/aseel/tv/StreamQuality.java");
const probe=read("app/src/main/java/sa/aseel/tv/StreamProbe.java");
const gradle=read("app/build.gradle");
const workflow=read(".github/workflows/android.yml");
function t(label,result){assert.ok(result,label);console.log("PASS "+label);}
t("Dedicated TV guide",home.includes("private void liveGuide()")&&home.includes("channelLine("));
t("Remote channel number selection on home",home.includes("remoteChannelDigits")&&home.includes("KEYCODE_0"));
t("Live channel playlist passed to player",home.includes('putExtra("channel_playlist"'));
t("Player has remote channel surfing",player.includes("KEYCODE_CHANNEL_UP")&&player.includes("KEYCODE_CHANNEL_DOWN"));
t("Player uses the TV guide",player.includes("showChannelGuide()"));
t("Player exposes audio and subtitle settings",player.includes("showTrackMenu()")&&player.includes("getCurrentTracks()"));
t("Player offers aspect-ratio control",player.includes("cycleAspectRatio()"));
t("Player offers VOD speed control",player.includes("showSpeedMenu()"));
t("Playback overlay can be hidden",player.includes("hideControls()")&&player.includes("toggleControls()"));
t("HTTPS-only media filtering stays in place",source.includes('url.startsWith("https://")'));
for(const extension of [".mp4",".m3u8",".mpd",".mkv",".webm",".ts"])t("Source extension "+extension,source.includes('path.endsWith("'+extension+'")'));
t("DASH parsing and media module present",probe.includes("dash+xml")&&gradle.includes("exoplayer-dash:2.18.7"));
t("Probe still rejects fake HTML",probe.includes('contentType.contains("text/html")'));
t("Unique Android package ID per build",workflow.includes('sa.alezz.tv.redclassic.b${GITHUB_RUN_ID}a${GITHUB_RUN_ATTEMPT}'));
console.log("Static remote/format smoke tests passed. Real device playback is NOT asserted.");
