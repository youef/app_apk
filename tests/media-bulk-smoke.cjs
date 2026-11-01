#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("admin/admin.js","utf8");
const hook='  if (document.readyState === \'loading\') {';
assert.ok(source.includes(hook),"admin bootstrap anchor");
const exported=source.replace(hook,'  window.__bulkTest={isMediaBulkTable,canPublishMedia,fetchAllMedia,patchMediaBatch};\n'+hook);
const fakeRows=Array.from({length:620},(_,i)=>({
  id:"00000000-0000-4000-8000-"+String(i).padStart(12,"0"),
  title_ar:"فيلم "+i,created_at:"2026-01-01T00:00:00Z",rights_status:"approved",
  license_reference:"official-licence",stream_url:"https://media.example.org/"+i+".mp4",
  status:"draft",link_health_status:"unchecked"
}));
const requests=[];
const context={
  window:{ALEZZ_ADMIN_CONFIG:{storagePrefix:"test.",supabaseUrl:"https://fake.supabase.co",publishableKey:"publishable-test",requestTimeout:15000}},
  document:{readyState:"loading",addEventListener:()=>{}},
  URL,Promise,AbortController,setTimeout,clearTimeout,Date,console,
  fetch:async (uri,init={})=>{
    const url=new URL(uri);
    requests.push({url:url.toString(),method:init.method||"GET"});
    assert.equal(url.pathname,"/rest/v1/aseel_movies","Unexpected table");
    let rows;
    if(init.method==="PATCH"){
      const ids=url.searchParams.get("id").slice(4,-1).split(",");
      const data=JSON.parse(init.body);
      rows=fakeRows.filter(r=>ids.includes(r.id));
      rows.forEach(row=>Object.assign(row,data));
    }else if(url.searchParams.has("id")){
      const ids=url.searchParams.get("id").slice(4,-1).split(",");
      rows=fakeRows.filter(r=>ids.includes(r.id));
    }else{
      const offset=Number(url.searchParams.get("offset")||0);
      const limit=Number(url.searchParams.get("limit")||500);
      rows=fakeRows.slice(offset,offset+limit);
    }
    return {ok:true,status:200,text:async()=>JSON.stringify(rows)};
  }
};
vm.runInNewContext(exported,context,{filename:"admin/admin.js"});
const {isMediaBulkTable,canPublishMedia,fetchAllMedia,patchMediaBatch}=context.window.__bulkTest;
for(const name of ["aseel_movies","aseel_series","aseel_episodes","aseel_youtube_videos"]){
  assert.ok(isMediaBulkTable({table:name}),"Bulk controls unavailable for "+name);
}
assert.ok(!isMediaBulkTable({table:"aseel_seasons"}),"Seasons have no separate licenses");
const movie={rights_status:"approved",license_reference:"reference",stream_url:"https://cdn.test/movie.mp4"};
assert.ok(canPublishMedia(movie,"aseel_movies"));
assert.ok(!canPublishMedia({...movie,link_health_status:"broken"},"aseel_movies"));
assert.ok(!canPublishMedia({...movie,license_reference:""},"aseel_movies"));
assert.ok(canPublishMedia({...movie,stream_url:null},"aseel_series"));
assert.ok(!canPublishMedia({...movie,stream_url:null,youtube_url:"https://youtube.com/watch?v=abcdefghijk"},"aseel_episodes"),
  "Episodes must match the public RLS requirement for a direct HTTPS stream");
assert.ok(canPublishMedia({youtube_url:"https://www.youtube.com/watch?v=abcdefghijk"},"aseel_youtube_videos"));
assert.ok(!canPublishMedia({youtube_url:"https://youtube.com.fake.org/watch?v=abcdefghijk"},"aseel_youtube_videos"));
assert.ok(source.includes("mediaBulkIncludeEpisodes"),"Optional series and episode one-click batch missing");
assert.ok(source.includes("bulkPanel.querySelectorAll(\'.media-bulk-control\')"), "Bulk toolbar must iterate over multiple controls, not a single element");
(async()=>{
  const all=await fetchAllMedia({table:"aseel_movies",label:"الأفلام"});
  assert.equal(all.length,620,"Select all must include more than the first 300 or 500 rows");
  assert.equal(requests.filter(x=>x.method==="GET").length,2,"Paginated catalogue should use two pages");
  const chosen=all.slice(0,55);
  const report=await patchMediaBatch("aseel_movies",chosen,{status:"published"});
  assert.equal(report.changed,55);
  assert.equal(report.failures,0);
  assert.ok(chosen.every(r=>r.status==="published"),"Confirmed DB data must update local state");
  console.log("PASS media bulk: 620 loaded, secure eligibility, and 55 verified publications in two batches.");
})().catch(error=>{console.error(error);process.exitCode=1;});
