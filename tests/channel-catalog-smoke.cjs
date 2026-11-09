#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../web/js/api.js"), "utf8");
const native = fs.readFileSync(path.join(__dirname, "../app/src/main/java/sa/aseel/tv/TVHomeActivity.java"), "utf8");
assert.ok(native.includes('catalog.listPaged("aseel_channels"') &&
  native.includes("rights_status.eq.approved,and(rights_status.eq.pending,playback_mode.eq.official_link)") &&
  native.includes("order=display_order.asc,created_at.desc,id.asc"),
  "Android TV pages approved channels and separately permits external links.");

async function run(failChannels) {
  const channels = Array.from({ length: 216 }, (_, i) => ({
    id: String(i + 1), title_ar: "قناة " + (i + 1),
    status: i === 215 ? "draft" : "published", link_health_status: "healthy",
    rights_status: i === 214 ? "pending" : "approved",
    playback_mode: "stream", stream_url: "https://example.org/live/" + i + ".m3u8"
  }));
  const requests = [];
  const view = { ALEZZ_CONFIG: {
    supabaseUrl: "https://mock.supabase.test", publishableKey: "publishable-test",
    requestTimeout: 6000, snapshotUrl: "data/snapshot.json"
  } };
  const fakeFetch = async url => {
    requests.push(String(url));
    if (String(url).includes("data/snapshot.json")) return {
      ok: true, json: async () => ({ channels: channels.slice(0, 32), movies: [] })
    };
    const table = String(url).split("?")[0].split("/").pop();
    if (table === "aseel_channels" && failChannels)
      return { ok: false, status: 503, json: async () => [] };
    return { ok: true, json: async () => table === "aseel_channels" ? channels : [] };
  };
  new Function("window", "fetch", "setTimeout", "clearTimeout", source)(
    view, fakeFetch, setTimeout, clearTimeout
  );
  const catalog = await view.AlezzApi.load();
  assert.equal(catalog.channels.length, failChannels ? 32 : 214);
  assert.ok(catalog.channels.every(channel => channel.rights.status === "approved"));
  assert.equal(requests.filter(x => x.includes("aseel_channels")).length, 1,
    "under 800 channels must require only one remote API call");
  assert.equal(requests.some(x => x.includes("snapshot")), failChannels,
    "the snapshot is only used when the channel API fails");
}

(async () => {
  await run(false);
  await run(true);
  console.log("PASS: only published and approved live channels are visible; fallback retains curated channels.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
