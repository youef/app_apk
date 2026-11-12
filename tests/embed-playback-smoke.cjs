#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const read = p => fs.readFileSync(p, "utf8");

const player = read("web/js/player.js");
const index = read("web/index.view");
const css = read("web/css/app.css");
const admin = read("admin/admin.js");
const android = read("app/src/main/java/sa/aseel/tv/EmbedPlayerActivity.java");
const tv = read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const legacy = read("app/src/main/java/sa/aseel/tv/MainActivity.java");
const manifest = read("app/src/main/AndroidManifest.xml");

new vm.Script(player, { filename: "web/js/player.js" });
new vm.Script(admin, { filename: "admin/admin.js" });
const match = player.match(/  function isEmbedUrl\(value\) \{[\s\S]*?\n  \}/);
assert(match, "HTTPS embed classifier missing from web player");
const ctx = { URL };
vm.runInNewContext(match[0] + "\nresult=isEmbedUrl;", ctx);
const allowed = [
  "https://hanerix.com/e/1ylubtvqck6l",
  "https://player.vimeo.com/video/12345",
  "https://www.dailymotion.com/embed/video/x1234",
  "https://www.youtube-nocookie.com/embed/uCYv55twbhE",
  "https://ok.ru/video/16115671698037",
  "https://ok.ru/videoembed/16115671698037",
  "https://www.ok.ru/video/16115671698037"
];
for (const link of allowed) assert.equal(ctx.result(link), true, "approved embed: " + link);
for (const link of [
  "http://hanerix.com/e/123",
  "https://hanerix.com.evil.example/e/123",
  "https://hanerix.com/watch/123",
  "https://user@hanerix.com/e/123",
  "javascript:alert(1)",
  "https://localhost/e/123",
  "https://evil.example/e/1ylubtvqck6l",
  "http://ok.ru/video/16115671698037",
  "https://ok.ru.evil.example/video/16115671698037",
  "https://ok.ru/video/not-a-video",
  "https://ok.ru/video/16115671698037?redirect=https://example.com",
  "https://user@ok.ru/videoembed/16115671698037"
]) assert.equal(ctx.result(link), false, "rejected embed: " + link);
const ytMatch=player.match(/  function youtubeSourceId\(value\) \{[\s\S]*?\n  \}/);
const canonicalMatch=player.match(/  function canonicalSource\(url\)\{[\s\S]*?\n  \}/);
assert(ytMatch && canonicalMatch, "missing source canonicalization");
vm.runInNewContext(match[0]+"\n"+ytMatch[0]+"\n"+canonicalMatch[0]+"\ncanonical=canonicalSource;",ctx);
assert.equal(ctx.canonical("https://ok.ru/video/16115671698037"),
  "https://ok.ru/videoembed/16115671698037");
assert.equal(ctx.canonical("https://ok.ru/videoembed/16115671698037"),
  "https://ok.ru/videoembed/16115671698037");
assert(android.includes("okEmbedUrl") && android.includes("https://ok.ru/videoembed/"));
assert(player.includes('frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation")'),
  "iframe must restrict popups/top navigation");
assert(player.includes("if (embedFrame) { embedFrame.remove(); embedFrame = null; }"),
  "closing player must tear down embedded iframe");
assert(player.includes('sourceKind(url)==="embed"') && player.includes("playEmbed(url)"),
  "embed must use separate playback flow, not native HTML5 video");
assert(index.includes('id="playerEmbedExternal"'), "embedded player needs external-open fallback");
assert(css.includes(".player.is-embed .alezz-embed-frame"), "embedded player should fill viewing area");
assert(admin.includes("return 'embed'"), "movie editor must accept approved embed URLs");
assert(android.includes("class EmbedPlayerActivity") && android.includes("setJavaScriptEnabled(true)") &&
  android.includes("setAllowFileAccess(false)") && android.includes("onShowCustomView"),
  "Android embed must use sandboxed WebView with fullscreen");
assert(android.includes("MemberAuth.hasSession") && android.includes("MemberAuth.isExpiredLocally"),
  "expired members must not open Android embeds");
assert(tv.includes("PlaybackSources.collect(") && legacy.includes("PlaybackSources.collect(") &&
  tv.includes("new Intent(this,EmbedPlayerActivity.class)") &&
  legacy.includes("new Intent(this,EmbedPlayerActivity.class)"),
  "Android native catalogues must route embeds separately");
assert(manifest.includes('android:name="sa.aseel.tv.EmbedPlayerActivity"'),
  "Android Embed player activity missing from manifest");
console.log("PASS: approved HTTPS embeds, URL policy, in-player fallback and Android integration");
