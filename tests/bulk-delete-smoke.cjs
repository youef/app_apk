#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const js=fs.readFileSync("admin/admin.js","utf8");
const html=fs.readFileSync("admin/index.html","utf8");
const hook="  if (document.readyState === 'loading') {";
assert.equal(js.split(hook).length,2,"bootstrap anchor");
const wrapped=js.replace(hook,
  "  window.__deleteTest={isOtherBulkTable,isMediaBulkTable,deleteSelectedBatch,selectedBulkRows,state};\n"+hook);
const makeId=(i)=>"10000000-0000-4000-8000-"+String(i).padStart(12,"0");
const fixtures=new Map(Array.from({length:88},(_,i)=>[makeId(i),{id:makeId(i),title_ar:"اختبار "+i}]));
const calls=[];
const fake={window:{ALEZZ_ADMIN_CONFIG:{
  supabaseUrl:"https://fake.supabase.co",publishableKey:"sb_publishable_test",storagePrefix:"test.",requestTimeout:15000,
  pageLimit:300
}},document:{readyState:"loading",addEventListener:()=>{},querySelector:()=>null},Promise,URL,AbortController,Date,console,
setTimeout,clearTimeout,fetch:async(url,init={})=>{
  const parsed=new URL(url),method=init.method||"GET";
  assert.equal(parsed.hostname,"fake.supabase.co");
  assert.equal(parsed.pathname.startsWith("/rest/v1/aseel_"),true,"Only allowed content table paths");
  const ids=(parsed.searchParams.get("id")||"").replace(/^in\.\(/,"").replace(/\)$/,"").split(",").filter(Boolean);
  calls.push({method,ids});
  let rows=[];
  if(method==="DELETE"){
    for(const id of ids){
      if(!fixtures.has(id)||id===makeId(50))continue; // simulate one RLS-protected item
      rows.push(fixtures.get(id));fixtures.delete(id);
    }
  } else if(method==="GET"){
    rows=ids.filter(id=>fixtures.has(id)).map(id=>fixtures.get(id));
  } else throw Error("Unsupported method "+method);
  return {ok:true,status:200,text:async()=>JSON.stringify(rows)};
}};
vm.runInNewContext(wrapped,fake,{filename:"admin/admin.js"});
const {deleteSelectedBatch,selectedBulkRows,isMediaBulkTable,isOtherBulkTable,state}=fake.window.__deleteTest;
for(const t of ["aseel_seasons","aseel_categories","aseel_home_collections","aseel_home_collection_items","aseel_content_sources"]) {
  assert.ok(isOtherBulkTable({table:t}),t+" should support selection");
}
for(const t of ["aseel_movies","aseel_series","aseel_episodes","aseel_youtube_videos"]){
  assert.ok(isMediaBulkTable({table:t}));
  assert.ok(!isOtherBulkTable({table:t}));
}
assert.ok(!isOtherBulkTable({table:"aseel_channels"}));
assert.ok(!isOtherBulkTable({table:"public.users"}));
assert.ok(html.includes('id="deleteConfirmLabel"'));
assert.ok(js.includes("state.deletePhrase = 'حذف ' + selected.length"),"Batch confirmation must include count");
assert.ok(js.includes("bulkDeleteWarning(tableCfg.table)"),"Show cascade warning before delete");
assert.ok(js.includes("!state.adminVerified"),"Administrator verification should be enforced");
assert.ok(js.includes("Prefer: 'return=representation'"),"Server must confirm deletion");
assert.ok(js.includes("select=id&' + filter"),"Deleted rows must be rechecked");
const table={table:"aseel_movies"};
state.table=table;
state.rows=Array.from(fixtures.values());
state.selectedMedia={};
for(let i=0;i<10;i++)state.selectedMedia[makeId(i)]=true;
assert.equal(selectedBulkRows(table).length,10,"Selected rows should only include marked movies");
state.selectedMedia["10000000-0000-4000-8000-999999999999"]=true;
assert.equal(selectedBulkRows(table).length,10,"Stale IDs must not be deleted");
const first=Array.from({length:62},(_,i)=>({id:makeId(i)}));
(async()=>{
  const result=await deleteSelectedBatch("aseel_movies",first);
  assert.equal(result.requested,62);
  assert.equal(result.deleted,61,"61 records deleted, 1 deliberately protected");
  assert.equal(result.failed,1,"Protected record must be reported as failed");
  assert.equal(fixtures.has(makeId(50)),true,"Protected record must still exist");
  assert.equal(fixtures.has(makeId(75)),true,"Unselected record must not be touched");
  assert.equal(calls.filter(x=>x.method==="DELETE").length,3,"Deletion should use safe 25-row batches");
  assert.equal(calls.filter(x=>x.method==="GET").length,3,"Every batch must be verified");
  assert.throws(()=>deleteSelectedBatch("aseel_movies",[{id:"not-a-uuid"}]),/معرف محتوى غير صالح/);
  console.log("PASS: all sections support selection; confirmed 61/62 batch deletes with protected row and cascade warning; no production changes");
})().catch(e=>{console.error(e);process.exitCode=1;});