#!/usr/bin/env node
"use strict";
const fs=require("fs");
const assert=require("assert");
const read=p=>fs.readFileSync(p,"utf8");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const m3u=read("app/src/main/java/sa/aseel/tv/IPTVPlaylist.java");
const epg=read("app/src/main/java/sa/aseel/tv/XmltvGuide.java");
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const gradle=read("app/build.gradle");
const manifest=read("app/src/main/AndroidManifest.xml");
const probe=read("app/src/main/java/sa/aseel/tv/StreamProbe.java");
function ok(name, condition){assert.ok(condition,name);console.log("PASS | "+name);}
ok("Android 4.4 minSdk preserved",
  gradle.includes("minSdkVersion 19") && manifest.includes('android:minSdkVersion="19"'));
ok("Legacy ExoPlayer retained",gradle.includes("exoplayer-core:2.18.7") &&
  player.includes("com.google.android.exoplayer2"));
ok("HTTPS source only and bounded redirects",
  m3u.includes('"https".equalsIgnoreCase(current.getProtocol())') &&
  m3u.includes("redirects<=3") &&
  m3u.includes("setSSLSocketFactory(LegacyTls.factory("));
ok("No TLS validation bypass",
  !m3u.includes("setHostnameVerifier") && !m3u.includes("TrustAll"));
ok("M3U streaming parser with resource ceilings",
  m3u.includes("BufferedReader") && m3u.includes("BoundedStream") &&
  m3u.includes("MAX_CHANNELS") && m3u.includes("MAX_BYTES") && m3u.includes("#EXTINF"));
ok("Only direct media URLs",
  m3u.includes("StreamQuality.isDirectUrl(address)") &&
  probe.includes("StreamQuality.isDirectUrl(input)"));
ok("Local imports never publish to catalog",
  m3u.includes('"_local_iptv"') && !m3u.includes("listQuery") &&
  !m3u.includes("SUPABASE_SERVICE_ROLE_KEY"));
ok("XMLTV streaming, timezones and now/next",
  epg.includes("XmlPullParser") && epg.includes("SimpleDateFormat") &&
  epg.includes('"epg_now_title"') && epg.includes('"epg_next_title"') &&
  epg.includes("180000"));
ok("Remote settings expose playlist and EPG with saved URLs",
  home.includes('prefs.edit().putString("iptv_m3u"') &&
  home.includes('putString("iptv_xmltv"') &&
  home.includes("refreshLocalPlaylist(true)"));
ok("Local IPTV persists after refresh from Supabase",
  home.includes("channels.addAll(localChannels)") &&
  home.includes('getString("iptv_m3u"') &&
  home.includes('"_local_iptv"'));
ok("Device memory protects channel list UI and Binder",
  home.includes("displayed>350") && home.includes("selectedGlobal-75") &&
  home.includes("channelIndex<to"));
ok("Smart live-freeze watchdog with bounded recovery",
  player.includes("liveHealth") && player.includes("frozenTicks>=4") &&
  player.includes("liveRestarts<2") && player.includes("tryNextOrExplain("));
ok("Adaptive KitKat-sized ExoPlayer buffers",
  player.includes("DefaultLoadControl.Builder") &&
  player.includes("kitkat?12000:22000") &&
  player.includes("setBufferDurationsMs"));
console.log("Static IPTV adaptation checks passed; APK compile and real-device playback require separate verification.");
