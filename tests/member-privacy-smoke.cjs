#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const read = path => fs.readFileSync(path, "utf8");
const storeJs = read("web/js/store.js");
const shared = new Map();
const storage = {
  getItem: key => shared.has(key) ? shared.get(key) : null,
  setItem: (key, value) => shared.set(key, String(value)),
  removeItem: key => shared.delete(key)
};
function member(key, authenticated = true) {
  const window = {localStorage: storage, ALEZZ_MEMBER_CONTEXT: {
    authenticated, accountKey: key
  }};
  vm.runInNewContext(storeJs, {window, Date, Math, JSON, Number});
  return window.AlezzStore;
}
const A = "a".repeat(32), B = "b".repeat(32);
const alice = member(A), bob = member(B);
assert.equal(alice.isActivated(), true, "Signed-in customer should not need a second PIN");
assert.equal(bob.isActivated(), true);
alice.toggleFavorite("series:alice");
alice.saveProgress("episode:1", {t: 21, d: 120, kind: "episode", title: "One"});
assert.deepEqual(Array.from(alice.favorites()), ["series:alice"]);
assert.deepEqual(Array.from(bob.favorites()), [], "Other customers must not see favourites");
assert.equal(bob.progress("episode:1"), null, "Other customers must not see watch history");
bob.toggleFavorite("movie:bob");
bob.saveProgress("movie:4", {t: 22, d: 150, kind: "movie", title: "Other"});
assert.equal(member(A).favorites()[0], "series:alice", "Re-login should preserve this account's local data");
alice.clearAllProgress();
assert.equal(alice.progress("episode:1"), null);
assert.notEqual(bob.progress("movie:4"), null, "Clearing account A must not affect B");
alice.clearFavorites();
assert.equal(alice.favorites().length, 0);
assert.equal(bob.favorites()[0], "movie:bob");
shared.set("alezz.v10.favorites", JSON.stringify(["movie:old-guest"]));
assert.equal(member(A).favorites().length, 0, "Legacy guest state must not leak into members");
const guest = member(A, false);
assert.equal(guest.isActivated(), false);
assert.equal(guest.favorites()[0], "movie:old-guest");
const viewer = read("web/index.view");
assert(viewer.includes('js/store.js?v=member-scope-1'), "Viewer store version was not updated");
const portal = read("python-cloud-studio/member_portal.py");
assert(portal.includes("window.ALEZZ_MEMBER_CONTEXT") && portal.includes("hmac.new("),
  "Server must inject opaque account scope after authentication");
const app = read("web/js/app.js");
assert(app.includes("episodeParents[episode.key] = series"), "Saved episodes must resolve to parent series");
assert(app.includes("clearAllProgress") && app.includes('clearFavorites()'),
  "Private history management actions are missing");
const recommendationStart = app.indexOf("  function recommendForYou() {");
const recommendationEnd = app.indexOf("\n  function viewHome()", recommendationStart);
assert(recommendationStart > 0 && recommendationEnd > recommendationStart, "Private recommendations are missing");
alice.toggleFavorite("movie:seen");
alice.saveProgress("episode:7", {t: 32, d: 220, kind: "episode", title: "Episode 7"});
const item = (key, category, tags) => ({
  key, title:key, categoryId:category, genreTags:tags, featured:false, seasons:[]
});
const watchedSeries = item("series:watch", "drama", ["family"]);
watchedSeries.kind = "series";
watchedSeries.seasons = [{episodes:[{key:"episode:7"}]}];
const context = {catalog:{movies:[
  item("movie:seen", "drama", ["mystery"]),
  item("movie:recommended", "drama", ["mystery"]),
  item("movie:unrelated", "sports", ["sport"])
],series:[watchedSeries]},Store:alice,Array,Object,String,Number};
vm.runInNewContext(app.slice(recommendationStart,recommendationEnd) +
  "\nresult = recommendForYou();",context);
assert.deepEqual(Array.from(context.result.map(x=>x.key)), ["movie:recommended"],
  "Recommendations must use private preferences without repeating seen or unrelated titles");
const sw = read("web/sw.js");
assert(sw.includes('request.mode === "navigate"'), "Service worker must never intercept navigation");
assert(!sw.includes('"./index.html"') && !sw.includes('"./"'), "Service worker must not cache viewer HTML");
console.log("PASS: member data isolation, saved episode routing and safe PWA navigation");