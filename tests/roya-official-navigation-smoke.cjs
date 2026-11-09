"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

function load(name) { return fs.readFileSync(name, "utf8"); }
const catalog = load("app/src/main/java/sa/aseel/tv/CatalogApi.java");
const tv = load("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const categories = load("app/src/main/java/sa/aseel/tv/ChannelGuideCategory.java");
const webLive = load("web/js/live.js");
const docs = load("docs/ROYA_CHANNELS_2026-11-09.md");

// Native channel catalogue must retain outbound-only support for official
// publisher pages. HLS replay is *not* unlocked by these checks.
assert.ok(catalog.includes('external.startsWith("https://roya.tv/")'),
  "The native catalogue must accept official Roya external-link entries");
assert.ok(tv.includes('external.startsWith("https://roya.tv/")'),
  "The TV remote must open official Roya pages in an external browser");
assert.ok(categories.includes('category.contains("قنوات رؤيا")'),
  "Android TV channel companies must group Roya separately");
assert.ok(webLive.includes('category.indexOf("قنوات رؤيا")'),
  "The web live guide must group Roya separately");
assert.ok(categories.includes('has(tag,"طبخ","مطبخ")'),
  "Arabic channel genre tags must be supported");

// This registry is a link directory, never an assertion that media may be rebroadcast.
assert.ok(docs.includes("official_link"));
assert.ok(docs.includes("لم يُنشر داخل مشغل العز"));
assert.ok(docs.includes("https://roya.tv/live-stream/1"));
const rows = docs.split("\n").filter(line => /^\|\s*\d+\s*\|/.test(line));
assert.equal(rows.length, 27, "All 27 current official Roya directory entries documented");

console.log("Roya official-link navigation and 27-channel directory: OK");
