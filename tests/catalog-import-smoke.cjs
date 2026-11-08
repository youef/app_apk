"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const page = fs.readFileSync("admin/catalog-import.html", "utf8");
const script = fs.readFileSync("admin/catalog-import.js", "utf8");
const required = ["catalogFile","previewButton","seriesCount","seasonCount","episodeCount","preview","rights","start","stop","report","progress","activity","message","sample"];
for (const id of required) assert.ok(page.includes('id="' + id + '"'), "Missing page element " + id);
assert.ok(page.includes("catalog-import.js"), "Script not linked");

const exposed = script.replace(/\s*counts\(\);\s*checkAdmin\(\);\s*\}\)\(\);\s*$/, "\nwindow.__test = {parse};\n})();");
assert.notEqual(exposed, script, "Cannot expose parser for tests");

const fakeElement = {
  addEventListener() {},
  textContent: "",
  value: "",
  disabled: false,
  checked: false,
  files: [],
  dataset: {},
  replaceChildren() {},
  append() {}
};
const windowMock = { ALEZZ_ADMIN_CONFIG: {storagePrefix:"test.",supabaseUrl:"https://example.org",publishableKey:"public-demo"} };
const context = {
  window: windowMock,
  document: {getElementById: () => fakeElement},
  URL, URLSearchParams, console, Set, Map, Object, Array, Number, Error, String
};
vm.runInNewContext(exposed, context, {timeout:1000});
const parse = windowMock.__test.parse;
assert.equal(typeof parse,"function");
const sample = {series:[{
  title_ar:"مسلسل مصرح",release_year:2026,country_code:"SA",
  source_page_url:"https://example.org/series/1",
  genre_tags:["drama"],
  seasons:[{number:1,episodes:[
    {number:1,stream_url:"https://example.org/e1.m3u8"},
    {number:2}
  ]}]
}]};
assert.equal(parse(sample).length,1);
assert.equal(parse(sample)[0].seasons[0].episodes[1].stream_url,null);
assert.throws(() => parse({series:[sample.series[0],sample.series[0]]}), /مكررة/);
assert.throws(() => parse({series:[{title_ar:"عنوان",seasons:[{number:1,episodes:[{number:1},{number:1}]}]}]}), /تكرار/);
assert.throws(() => parse({series:[{title_ar:"عنوان",poster_url:"http://example.org/1.jpg"}]}), /HTTPS/);
assert.throws(() => parse({series:[{title_ar:"عنوان",seasons:[{number:1},{number:1}]}]}), /مكرر/);
assert.throws(() => parse({series:[{title_ar:"عنوان",release_year:"2025"}]}), /رقم غير صالح/);
console.log("PASS: catalog uploader markup and 7 validation scenarios");
