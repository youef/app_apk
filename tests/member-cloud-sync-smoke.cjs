#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=p=>fs.readFileSync(p,"utf8");
const web=source("web/js/member-sync.js"),storeSource=source("web/js/store.js");
const portal=source("python-cloud-studio/member_portal.py");
const native=source("app/src/main/java/sa/aseel/tv/MemberSync.java");
const home=source("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const player=source("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const uuid="12345678-1234-1234-1234-123456789abc";
assert.doesNotThrow(()=>new vm.Script(web,{filename:"web/js/member-sync.js"}));
assert.ok(portal.includes("def member_sync_read(")&&portal.includes("def member_sync_write("));
assert.ok(portal.includes("not secrets.compare_digest(request.headers.get('x-csrf-token',''),session[3])"));
assert.ok(portal.includes("params={'user_id':'eq.'+uid"));
assert.ok(portal.includes("'user_id':uid"));
assert.ok(native.includes('MemberAuth.ensureFresh(context)')&&
          native.includes('getSharedPreferences(PREFIX+MemberAuth.userId(context)'));
assert.ok(home.includes("MemberSync.begin(this)")&&
          home.includes('MemberSync.favorite(this,kind(item),value(item,"id"),selected)'));
assert.ok(player.includes("MemberSync.progress(this,profile,mediaKind,itemId,position,duration)"));
assert.ok(storeSource.includes("replaceFavorites: function")&&
          storeSource.includes("mergeRemoteProgress: function"));
assert.ok(source("web/index.view").includes('js/member-sync.js?v=account-sync-20261107'));
const calls=[],prefs={},favorites=[];
const Store={
  pref:(name,fallback)=>prefs[name]===undefined?fallback:prefs[name],
  setPref:(name,value)=>{prefs[name]=value;},
  replaceFavorites:items=>{favorites.length=0;favorites.push(...items);},
  mergeRemoteProgress:()=>{},
  toggleFavorite:key=>{let i=favorites.indexOf(key);if(i<0){favorites.push(key);return true;}favorites.splice(i,1);return false;},
  saveProgress:()=>{},clearProgress:()=>{},clearFavorites:()=>{favorites.length=0;},
  clearAllProgress:()=>{}
};
const fetchMock=(url,options={})=>{
  calls.push({url,options});
  if(options.method==="POST"){
    assert.equal(options.headers["X-CSRF-Token"],"csrf-test");
    return Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true})});
  }
  return Promise.resolve({ok:true,json:()=>Promise.resolve({
    favorites:[{item_type:"channel",item_id:uuid}],
    progress:[]
  })});
};
const windowObj={ALEZZ_MEMBER_CONTEXT:{authenticated:true,csrf:"csrf-test"},
  AlezzStore:Store,fetch:fetchMock,addEventListener:()=>{}};
const context={window:windowObj,fetch:fetchMock,clearTimeout:()=>{},setTimeout:()=>1,
  console,Date,JSON,Promise};
vm.runInNewContext(web,context,{filename:"web/js/member-sync.js"});
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(calls.some(c=>c.url==="/account/sync"&&c.options.method==="GET"));
  assert.ok(favorites.includes("channel:"+uuid),"Cloud channel favorites pulled into account");
  assert.ok(Array.isArray(prefs.liveFavorites)&&prefs.liveFavorites.includes("channel:"+uuid));
  Store.toggleFavorite("movie:"+uuid);
  await windowObj.AlezzMemberSync.flush();
  assert.ok(calls.some(c=>c.options.method==="POST"&&
    JSON.parse(c.options.body).kind==="favorite"&&
    JSON.parse(c.options.body).item_type==="movie"));
  console.log("PASS | account-bound cloud favorites, watch sync, native RLS and CSRF smoke");
})().catch(error=>{console.error(error);process.exitCode=1;});
