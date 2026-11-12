#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const player=read("web/js/player.js"),html=read("web/index.view"),
  admin=read("admin/admin.js"),config=read("admin/config.js"),css=read("web/css/app.css");
new vm.Script(player,{filename:"web/js/player.js"});
new vm.Script(admin,{filename:"admin/admin.js"});

const start=player.indexOf("  function isEmbedUrl(value)"),end=player.indexOf("  function playEmbed(url)");
assert(start>=0 && end>start,"Unified URL classifier must exist");
const ctx={URL};
vm.runInNewContext(player.slice(start,end)+"\nresult={sourceKind,canonicalSource};",ctx);
const kind=ctx.result.sourceKind,canonical=ctx.result.canonicalSource;
assert.equal(kind("https://example.org/f.mp4?token=xyz"),"mp4");
assert.equal(kind("https://example.org/master.m3u8?token=xyz"),"hls");
assert.equal(kind("https://hanerix.com/e/1ylubtvqck6l"),"embed");
assert.equal(kind("https://youtu.be/uCYv55twbhE"),"youtube");
assert.equal(kind("https://www.youtube.com/watch?v=uCYv55twbhE"),"youtube");
assert.equal(kind("https://www.youtube-nocookie.com/embed/uCYv55twbhE"),"youtube");
assert.equal(canonical("https://youtu.be/uCYv55twbhE"),"https://www.youtube-nocookie.com/embed/uCYv55twbhE");
for(const denied of ["javascript:alert(1)","http://example.org/video.mp4",
  "https://hanerix.com.evil.example/e/a","https://bad.example/embed/abc",
  "https://example.org/index.html","https://user:pass@example.org/a.mp4"])
  assert.equal(kind(denied),"","Unsupported source should be rejected: "+denied);

for(const text of ["appendSource(item.stream","entry.url||entry.stream_url",
  'Store.pref("source:"','Store.setPref("source:"+current.key',
  "function toggleSourceMenu","function renderSourcesMenu","function isPlayableUrl(url)",
  'if(directFormat!=="mp4"',"playSelectedSource(url, false)"])
  assert(player.includes(text),"Unified playback integration missing: "+text);
for(const id of ["playerSourcesToggle","playerSourcesMenu","playerEmbedExternal"])
  assert(html.includes('id="'+id+'"'),"Player control missing: "+id);
assert(css.includes(".player__sources-menu")&&css.includes(".player.is-embed .player__chrome"),
  "Cinematic UI and source picker styles missing");
assert(config.includes("مصادر إضافية وجودات") && admin.includes("+ إضافة مصدر"),
  "Admin must allow adding named sources");

const java=read("app/src/main/java/sa/aseel/tv/PlaybackSources.java");
const tv=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const legacy=read("app/src/main/java/sa/aseel/tv/MainActivity.java");
const cinema=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const embed=read("app/src/main/java/sa/aseel/tv/EmbedPlayerActivity.java");
for(const fragment of ["class PlaybackSources","collect(String main","preferred(ArrayList<Source> sources)",
  "type(String raw)","public static void show","available_sources"])
  assert(java.includes(fragment),"Android source controller missing: "+fragment);
assert(tv.includes("PlaybackSources.collect(")&&tv.includes("PlaybackSources.preferred(available)")&&
  tv.includes('intent.putExtra("available_sources",sourceList)'),
  "Android TV must choose and pass multiple sources");
assert(legacy.includes("PlaybackSources.collect("),"Android legacy catalogue must support multiple sources");
assert(cinema.includes("PlaybackSources.show(CinemaPlayerActivity.this)"),
  "Native player source selection unavailable");
assert(embed.includes("PlaybackSources.show(EmbedPlayerActivity.this)")&&
  embed.includes("KEYCODE_MENU")&&embed.includes("KEYCODE_DPAD_UP")&&
  embed.includes("chromeHandler.postDelayed"),
  "Embedded player must support cinematic remote controls");
assert.equal(kind("https://cdn.example.org/video.mpd"),"dash");
assert(java.includes('if(path.endsWith(".mpd"))return "dash"'),"TV DASH support missing");
assert(html.includes('id="playerComingSoonVideo"'));
console.log("PASS: unified direct MP4/HLS/DASH, quality selector and internal coming-soon playback.");
