"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(root, "web/js/api.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web/js/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");

const movie = { id: "m1", title_ar: "فيلم اختبار", status: "published", rights_status: "approved" };
const video = { id: "y1", youtube_url: "https://www.youtube.com/watch?v=uCYv55twbhE",
  title_ar: "فيديو اختبار", status: "published", is_kids: true, sort_order: 1 };
const rows = {
  aseel_categories: [],
  aseel_movies: [movie],
  aseel_series: [],
  aseel_seasons: [],
  aseel_episodes: [],
  aseel_channels: [],
  aseel_youtube_videos: [video],
  aseel_home_collections: [{ id: "c1", title_ar: "مختارات", display_order: 1, is_active: true }],
  aseel_home_collection_items: [{ id: "i1", collection_id: "c1", movie_id: "m1", display_order: 1 }]
};

function client(failed) {
  const requested = [];
  const window = { ALEZZ_CONFIG: { supabaseUrl: "https://example.supabase.co",
    publishableKey: "public-test", requestTimeout: 5000, snapshotUrl: "data/snapshot.json" } };
  function fetch(url) {
    const match = String(url).match(/\/rest\/v1\/([^?]+)/);
    assert.ok(match, "Unexpected network request: " + url);
    const table = match[1];
    requested.push(table);
    assert.ok(Object.prototype.hasOwnProperty.call(rows, table), "Wrong Supabase REST table: " + table);
    if (failed && table === failed) return Promise.resolve({ ok: false, status: 503 });
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve(rows[table]) });
  }
  vm.runInNewContext(code, { window, fetch, Promise, Date, setTimeout, clearTimeout });
  return { api: window.AlezzApi, requested };
}

async function main() {
  const live = client();
  const loaded = await live.api.load();
  assert.equal(live.api.source, "live");
  assert.equal(loaded.youtube.length, 1, "Published videos should render on YouTube page");
  assert.equal(loaded.youtube[0].youtubeId, "uCYv55twbhE");
  assert.equal(loaded.rows.length, 1, "Home collections must load from actual tables");
  assert.equal(loaded.rows[0].items[0].id, "m1");
  assert.ok(live.requested.includes("aseel_youtube_videos"));
  assert.ok(live.requested.includes("aseel_home_collections"));
  assert.ok(live.requested.includes("aseel_home_collection_items"));
  assert.deepEqual(live.api.failedTables, []);
  const partial = client("aseel_youtube_videos");
  const partialCatalog = await partial.api.load();
  assert.equal(partialCatalog.youtube.length, 0);
  assert.ok(partial.api.failedTables.includes("youtube"), "Failures should be visible to page UI");
  assert.ok(app.includes('تعذّر تحميل فيديوهات يوتيوب'), "Page must show a retriable loading error");
  assert.ok(app.includes('section=([a-z]+)'), "Old query links should still route to YouTube");
  assert.ok(html.includes('youtube-catalog-fix-20261101'), "Cache busting prevents stale scripts");
  console.log("PASS: published YouTube REST path, home collections, error state, old route and cache busting");
}
main().catch(err => { console.error(err); process.exitCode = 1; });
