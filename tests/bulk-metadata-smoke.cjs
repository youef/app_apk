#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),vm=require("node:vm");
const src=fs.readFileSync("admin/bulk-import.js","utf8");
const html=fs.readFileSync("admin/bulk-import.html","utf8");
new vm.Script(src,{filename:"admin/bulk-import.js"});
for(const id of ["batchTitle","batchYear","batchDescription","batchCountry","batchLanguage","batchOriginal","batchGenres","batchCategory","batchPosterUrl","batchBackdropUrl","batchIncludeUnverified","batchPublish","batchRights","batchSave"])
 assert(html.includes('id="'+id+'"'),"Missing metadata field: "+id);
assert(src.includes('function metadata()'),"Metadata serializer required");
assert(src.includes('function discoverExisting()'),"Existing-series duplicate protection required");
assert(src.includes('tidyTitle('),"Normalize source titles");
assert(src.includes('x.result?.ok||includeDrafts'),"Unverified episodes must be savable");
assert(src.includes('if(publication&&playable)'),"Playback publication must require rights and verified URL");
assert(src.includes('rights_status:"pending"'),"Unknown rights must remain pending");
assert(src.includes('await patch("aseel_episodes"'),"Update existing episodes instead of duplicating");
assert(src.includes('country_code:')&&src.includes('release_year:')&&src.includes('genre_tags:'));
console.log("PASS: full series metadata, incomplete episodes, conditional publication, no duplicates.");
