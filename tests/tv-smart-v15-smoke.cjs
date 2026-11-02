#!/usr/bin/env node
"use strict";
const fs=require("fs"),assert=require("assert");
const source=f=>fs.readFileSync(f,"utf8");
const home=source("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const player=source("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const state=source("app/src/main/java/sa/aseel/tv/PlaybackMemory.java");
const poster=source("app/src/main/java/sa/aseel/tv/PosterLoader.java");
const flow=source(".github/workflows/android.yml");
function check(name,ok){assert.ok(ok,name);console.log("PASS | "+name);}
check("Independent local profiles without viewer login",state.includes('new String')===false&&state.includes('"family"')&&state.includes('"kids"')&&state.includes('"guest"')&&!home.includes("PinGate."));
check("Save playback time, duration, title, quality and episode identity",state.includes('item.put("position"')&&state.includes('item.put("quality"')&&state.includes('item.put("series_id"')&&player.includes("saveProgress()"));
check("Watch-history deletion is per item",home.includes('PlaybackMemory.remove(TVHomeActivity.this,profile,id)')&&state.includes('public static void remove('));
check("Continue watching resolves source from approved catalog",home.includes("showContinueWatching(true)")&&home.includes("findCatalogItem(")&&home.includes("pendingResumeEpisodeId"));
check("Episode next action on right",player.includes('button("⏭ الحلقة التالية")')&&player.includes("switchMedia(mediaIndex+1)"));
check("Live left channel group/filter rail",player.includes("Gravity.LEFT")&&player.includes("activeGroup")&&player.includes("updateChannelRail()"));
check("Playback right controls and fullscreen",player.includes("Gravity.RIGHT")&&player.includes('button("⛶ عرض كامل")')&&player.includes("hideControls()"));
check("Last working channel remembered by profile",player.includes("PlaybackMemory.lastChannel(CinemaPlayerActivity.this,profile,itemId)")&&home.includes('PlaybackMemory.lastChannel(this,PlaybackMemory.activeProfile(this))'));
check("EPG never guesses titles",home.includes("epgNow(")&&player.includes('item.optString("epg_now_title","")')&&player.includes('item.optString("epg_next_title","")'));
check("Episode count badge only when compared to previous count",home.includes("seenEpisodeCount")&&home.includes("markEpisodeCount"));
check("Manual intro and recap windows",player.includes("configureSegments()")&&player.includes("skipMarkedSegment()")&&state.includes("setSegmentEdge(")&&state.includes("segmentEnd("));
check("Stalled stream retries then attempts lower quality",player.includes("handler.postDelayed(watchdog,22000L)")&&player.includes("StreamQuality.lower(")&&player.includes("tryNextOrExplain("));
check("Poster bounded memory and disk cache",poster.includes("MAX_DISK_BYTES=14L*1024L*1024L")&&poster.includes("MAX_AGE=7L")&&poster.includes("LruCache"));
check("Android KitKat API19 stays supported",flow.includes("v15-smart-cinema-api19.apk")&&flow.includes("15.0.0-native-"));
check("No new backend credential exposure",!state.includes("SERVICE_ROLE")&&!state.includes("SUPABASE_SERVICE"));
console.log("PASS | Al Ezz TV v15 static acceptance; media playback still needs physical device verification.");
