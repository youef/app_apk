#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const html = read("web/index.html");
const css = read("web/css/live.css");
const source = read("web/js/live.js");
const explore = read("web/js/explore.js");
const app = read("web/js/app.js");
const context = { window: {} };
vm.runInNewContext(explore, context, { filename: "web/js/explore.js" });
vm.runInNewContext(source, context, { filename: "web/js/live.js" });
const live = context.window.AlezzLive;
assert.ok(live, "Missing live player module");
assert.equal(live.mediaType("https://example.org/test.m3u8?token=abc"), "hls");
assert.equal(live.mediaType("https://example.org/test.mp4"), "video");
assert.equal(live.mediaType("https://example.org/test.mpd"), "dash");
assert.equal(live.mediaType("http://example.org/test.m3u8"), "");
assert.ok(live.playable({ playback: "official_link", official: "https://example.org/live" }));
assert.ok(!live.playable({ playback: "stream", stream: "https://example.org/page.html" }));
const channels = [
  { key: "channel:1", title: "قناة اختبار", poster: "https://example.org/logo.png", stream: "https://example.org/live.m3u8", playback: "stream", category: "الأخبار", categoryId: "news" },
  { key: "channel:2", title: "قناة رسمية", official: "https://example.org/live", playback: "official_link", category: "الأطفال", categoryId: "kids" }
];
const page = live.render({ channels, categories: [
  { id: "news", name_ar: "أخبار" }, { id: "kids", name_ar: "أطفال" }
] }, "");
const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, "Duplicate live page IDs");
for (const id of ["livePage", "liveVideo", "liveGuideItems", "liveStart", "liveRetry", "liveSearch", "liveFilters", "liveNext", "livePrev", "liveStatus", "liveFullscreen"]) {
  assert.ok(ids.includes(id), "Missing live UI: " + id);
}
assert.ok(page.includes("قناة في الدليل") && page.includes("دليل القنوات"));
assert.ok(page.includes("data-live-filter=") && page.includes("data-browse-select="));
assert.ok(!page.includes('crossorigin="anonymous"'), "Native playback must not force CORS mode");
assert.ok(html.includes("css/live.css") && html.includes("js/live.js"));
assert.ok(app.includes("Live.mount()") && app.includes("Live.destroy()"));
assert.ok(css.includes(".live-guide__item") && css.includes(".live-stage"));
console.log("PASS: live TV page, supported media URL detection, responsive UI assets and route integration.");
