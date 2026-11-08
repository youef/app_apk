"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const page = fs.readFileSync("admin/catalog-import.html", "utf8");
const serverView = fs.readFileSync("admin/catalog-import.view", "utf8");
assert.equal(page, serverView, "Render's .view page must match the frontend HTML");
const script = fs.readFileSync("admin/catalog-import.js", "utf8");
const required = ["catalogFile","previewButton","seriesCount","movieCount","seasonCount",
  "episodeCount","preview","rights","updateExisting","updateStreams",
  "start","stop","report","progress","activity","message","sample",
  "authPanel","authForm","authEmail","authPassword","authSubmit"];
for (const id of required) assert.ok(page.includes('id="' + id + '"'), "Missing UI element: " + id);
assert.ok(page.includes("catalog-import.js"), "Missing importer JS link");

const source = script.replace(/\s*counts\(\);\s*checkAdmin\(\);\s*\}\)\(\);\s*$/,
  "\nwindow.__tests = { parse, importOne, counters };\n})();");
assert.notEqual(source, script, "Cannot expose importer functions to tests");

const elements = new Map();
function elem(id) {
  if (!elements.has(id)) elements.set(id, {
    checked: id === "updateExisting", disabled: false, value: "",
    dataset: {}, textContent: "", files: [], addEventListener() {},
    replaceChildren() {}, append() {}
  });
  return elements.get(id);
}
const tables = { aseel_series: [], aseel_movies: [], aseel_seasons: [], aseel_episodes: [] };
let seq = 0;
async function mockFetch(url, options = {}) {
  const uri = new URL(url);
  const table = uri.pathname.split("/").pop();
  assert.ok(tables[table], "Unexpected database table: " + table);
  const params = uri.searchParams;
  const method = options.method || "GET";
  let result = [];
  if (method === "GET") {
    result = tables[table].filter(row => Array.from(params).every(([key, value]) =>
      !value.startsWith("eq.") || String(row[key]) === value.slice(3)))
      .slice(Number(params.get("offset") || 0), Number(params.get("offset") || 0) + Number(params.get("limit") || 10000));
  } else if (method === "POST") {
    const data = JSON.parse(options.body);
    for (const item of (Array.isArray(data) ? data : [data])) {
      const exists = tables[table].some(row =>
        table === "aseel_episodes" && row.season_id === item.season_id && row.number === item.number);
      if (exists) continue;
      const row = { ...item, id: "row" + (++seq) };
      tables[table].push(row);
      if (options.headers.Prefer.includes("return=representation")) result.push(row);
    }
  } else if (method === "PATCH") {
    const patch = JSON.parse(options.body);
    assert.ok(!Object.hasOwn(patch, "status"), "Updates must preserve status");
    assert.ok(!Object.hasOwn(patch, "rights_status"), "Updates must preserve rights");
    result = tables[table].filter(row => row.id === params.get("id").slice(3));
    for (const row of result) Object.assign(row, patch);
  } else throw Error("Unexpected HTTP method " + method);
  return { ok: true, text: async () => JSON.stringify(result) };
}
const windowStub = {
  ALEZZ_ADMIN_CONFIG: {
    storagePrefix: "alezz.admin.", supabaseUrl: "https://supabase.example.org",
    publishableKey: "public-key"
  }
};
const context = {
  window: windowStub, document: { getElementById: elem },
  localStorage: { getItem: () => JSON.stringify({user_id:"admin",access_token:"test-jwt"}) },
  fetch: mockFetch, URL, URLSearchParams, console
};
vm.runInNewContext(source, context, { timeout: 1000 });
const { parse, importOne, counters } = windowStub.__tests;

const seed = { series: [{
  title_ar: "مسلسل تجريبي", release_year: 2026, country_code: "SA",
  source_page_url: "https://licensed.example.org/s/1",
  description: "الوصف السابق",
  seasons: [{ number: 1, episodes: [{
    number: 1, title_ar: "الحلقة الأولى", stream_url: "https://licensed.example.org/ep1.m3u8"
  }] }]
}], movies: [{
  title_ar: "فيلم تجريبي", release_year: 2026,
  source_page_url: "https://licensed.example.org/m/1",
  description: "الوصف السابق", stream_url: "https://licensed.example.org/m1.m3u8"
}] };
const reject = item => assert.throws(() => parse(item));
assert.equal(parse(seed).length, 2);
assert.equal(parse({movies:[seed.movies[0]]}).length, 1);
reject({movies:[seed.movies[0],seed.movies[0]]});
reject({series:[seed.series[0],seed.series[0]]});
reject({series:[{title_ar:"س",poster_url:"http://bad.example.org/a.jpg"}]});
reject({series:[{title_ar:"س",seasons:[{number:1,episodes:[{number:1},{number:1}]}]}]});
reject({series:[{title_ar:"س",seasons:[{number:1},{number:1}]}]});
reject({movies:[{title_ar:"س",release_year:"2025"}]});

(async () => {
  const initial = parse(seed);
  for (const work of initial) await importOne(work);
  assert.deepEqual(Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length])), {
    aseel_series:1, aseel_movies:1, aseel_seasons:1, aseel_episodes:1
  });
  assert.equal(tables.aseel_movies[0].status, "draft");
  assert.equal(tables.aseel_episodes[0].rights_status, "pending");
  for (const work of initial) await importOne(work);
  assert.equal(tables.aseel_movies.length,1);
  assert.equal(tables.aseel_episodes.length,1);
  tables.aseel_movies[0].status = "published";
  tables.aseel_movies[0].rights_status = "approved";
  tables.aseel_movies[0].link_health_status = "healthy";
  tables.aseel_episodes[0].status = "published";
  tables.aseel_episodes[0].rights_status = "approved";
  tables.aseel_episodes[0].link_health_status = "healthy";
  const oldIds = [tables.aseel_movies[0].id, tables.aseel_episodes[0].id];

  const update = parse({series:[{...seed.series[0],description:"وصف جديد",
    seasons:[{number:1,episodes:[{number:1,title_ar:"عنوان جديد",
      stream_url:"https://licensed.example.org/ep2.m3u8"}]}]}],
    movies:[{...seed.movies[0],description:"وصف جديد",
      stream_url:"https://licensed.example.org/m2.m3u8"}]});
  for (const work of update) await importOne(work);
  assert.equal(tables.aseel_movies[0].description,"وصف جديد");
  assert.equal(tables.aseel_series[0].description,"وصف جديد");
  assert.equal(tables.aseel_episodes[0].title_ar,"عنوان جديد");
  assert.ok(tables.aseel_movies[0].stream_url.endsWith("m1.m3u8"),"Stream must not change without explicit option");
  assert.ok(tables.aseel_episodes[0].stream_url.endsWith("ep1.m3u8"),"Episode stream must stay");
  elem("updateStreams").checked = true;
  for (const work of update) await importOne(work);
  assert.ok(tables.aseel_movies[0].stream_url.endsWith("m2.m3u8"));
  assert.ok(tables.aseel_episodes[0].stream_url.endsWith("ep2.m3u8"));
  assert.equal(tables.aseel_movies[0].link_health_status,"unchecked");
  assert.equal(tables.aseel_episodes[0].link_health_status,"unchecked");
  assert.equal(tables.aseel_movies[0].status,"published");
  assert.equal(tables.aseel_episodes[0].rights_status,"approved");
  assert.deepEqual([tables.aseel_movies[0].id,tables.aseel_episodes[0].id],oldIds);
  assert.equal(counters.movies_created,1);
  assert.equal(counters.movies_updated,2);
  assert.equal(counters.episodes_updated,2);
  console.log("PASS: Catalog uploader validation, movie/series/episode upserts, rights and stable IDs");
})().catch(error => { console.error(error); process.exitCode = 1; });
