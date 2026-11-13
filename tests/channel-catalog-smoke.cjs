#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../web/js/api.js"), "utf8");
const native = fs.readFileSync(path.join(__dirname, "../app/src/main/java/sa/aseel/tv/TVHomeActivity.java"), "utf8");
assert.ok(native.includes('catalog.listPaged("aseel_channels"') &&
  !native.includes("rights_status.eq.approved,and(rights_status.eq.pending,playback_mode.eq.official_link)") &&
  native.includes("order=display_order.asc,created_at.desc,id.asc"),
  "Android TV pages published channels without separate rights filters.");

async function run() {
  const channels = Array.from({ length: 216 }, (_, i) => ({
    id: String(i + 1), title_ar: "قناة " + (i + 1),
    status: i === 215 ? "draft" : "published", link_health_status: "healthy",
    rights_status: i === 214 ? "pending" : "approved",
    playback_mode: "stream", stream_url: "https://example.org/live/" + i + ".m3u8"
  }));
  const requests = [];
  let response = "full", now = 1000000;
  const view = { ALEZZ_CONFIG: {
    supabaseUrl: "https://mock.supabase.test", publishableKey: "publishable-test",
    requestTimeout: 6000
  } };
  const fakeFetch = async url => {
    requests.push(String(url));
    assert.ok(!String(url).includes("snapshot.json"), "bundled media must not be restored after unpublishing");
    const table = String(url).split("?")[0].split("/").pop();
    if (table === "aseel_channels" && response === "failed")
      return { ok: false, status: 503, json: async () => [] };
    return { ok: true, json: async () => table === "aseel_channels" && response === "full" ? channels : [] };
  };
  new Function("window", "fetch", "setTimeout", "clearTimeout", "Date", source)(
    view, fakeFetch, setTimeout, clearTimeout, { now: () => now }
  );
  const catalog = await view.AlezzApi.load();
  assert.equal(catalog.channels.length, 215);
  assert.ok(catalog.channels.some(channel => channel.id === "215"), "Pending-rights channel is visible when published");
  assert.equal(requests.filter(x => x.includes("aseel_channels")).length, 1,
    "under 800 channels must require only one remote API call");
  response = "failed";
  assert.equal((await view.AlezzApi.load()).channels.length, 215, "recent successful catalogue survives a failed request");
  now += 15 * 60 * 1000 + 1;
  assert.equal((await view.AlezzApi.load()).channels.length, 0, "expired media is dropped after sustained connection loss");
  response = "full";
  await view.AlezzApi.load();
  response = "empty";
  assert.equal((await view.AlezzApi.load()).channels.length, 0, "successful empty results remove unpublished channels");
  response = "failed";
  assert.equal((await view.AlezzApi.load()).channels.length, 0, "fallback cannot resurrect removed channels");
}

(async () => {
  await run();
  console.log("PASS: published channels, bounded fallback, and no resurrection of removed rows.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
