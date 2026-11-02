#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const offlineSource=fs.readFileSync("web/js/offline.js","utf8");
const swSource=fs.readFileSync("web/sw.js","utf8");
const page=fs.readFileSync("web/index.html","utf8"),app=fs.readFileSync("web/js/app.js","utf8");
const player=fs.readFileSync("web/js/player.js","utf8");
new vm.Script(offlineSource);new vm.Script(swSource);new vm.Script(app);new vm.Script(player);
assert(page.includes('src="js/offline.js?v='),"Offline module must load before player");
assert(app.includes("function viewDownloads()")&&app.includes('data-offline-save="'));
assert(app.includes('case "downloads": html = viewDownloads()'));
assert(player.includes("AlezzOffline.resolve(item.key)")&&player.includes("AlezzOffline.maybeAutoSave(current)"));
assert(swSource.includes("serveSavedVideo(request)")&&swSource.includes("Content-Range"));
function makeCache(){
 const entries=new Map();
 return {
  match:async key=>{const v=entries.get(String(key));return v?v.clone():undefined;},
  put:async(key,response)=>{entries.set(String(key),response.clone());await response.arrayBuffer();},
  delete:async key=>entries.delete(String(key))
 };
}
(async()=>{
 const cache=makeCache(),caches={open:async()=>cache},values=new Map(),events={};
 const localStorage={getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v))};
 const navigator={onLine:true,serviceWorker:{controller:{}},storage:{estimate:async()=>({quota:2e9,usage:10000})}};
 const payload=new Uint8Array(128);for(let i=0;i<payload.length;i++)payload[i]=i;
 const fetch=async()=>new Response(payload,{status:200,headers:{"Content-Length":"128","Content-Type":"video/mp4"}});
 const win={caches,fetch,dispatchEvent:()=>{}};
 vm.runInNewContext(offlineSource,{
  window:win,localStorage,navigator,caches,fetch,location:{href:"https://youef.github.io/app_apk/web/index.html#/movies"},
  URL,Response,AbortController,Event,Promise,console
 });
 const Offline=win.AlezzOffline;
 const movie={key:"movie:test",kind:"movie",title:"تجريبي",stream:"https://media.example.org/film.mp4",
   offlinePermitted:true,poster:""};
 assert(Offline.canSave(movie));
 assert(!Offline.canSave({...movie,offlinePermitted:false}));
 assert(!Offline.canSave({...movie,stream:"https://media.example.org/film.m3u8"}));
 assert(!Offline.canSave({...movie,youtubeId:"abc"}));
 assert(!Offline.canSave({...movie,kind:"channel",live:true}));
 const entry=await Offline.save(movie);
 assert.equal(entry.size,128);
 assert.equal(Offline.list().length,1);
 assert.equal(Offline.get(movie.key).title,"تجريبي");
 const offlineURL=await Offline.resolve(movie.key);
 assert(offlineURL.includes("__offline_media__"));
 const self={registration:{scope:"https://youef.github.io/app_apk/web/"},
  addEventListener:(name,fn)=>{events[name]=fn;},
  skipWaiting:()=>Promise.resolve(),clients:{claim:()=>Promise.resolve()}};
 vm.runInNewContext(swSource,{self,caches,Response,URL,Request,Promise});
 const ranged=new Request(offlineURL,{headers:{Range:"bytes=10-19"}});
 let handled;events.fetch({request:ranged,respondWith:p=>handled=p});
 const output=await handled;
 assert.equal(output.status,206);
 assert.equal(output.headers.get("Content-Range"),"bytes 10-19/128");
 const sliced=new Uint8Array(await output.arrayBuffer());
 assert.equal(sliced.length,10);assert.equal(sliced[0],10);
 await Offline.remove(movie.key);
 assert.equal(Offline.list().length,0);
 assert.equal(await Offline.resolve(movie.key),null);
 let missing;events.fetch({request:new Request(offlineURL),respondWith:p=>missing=p});
 assert.equal((await missing).status,404);
 console.log("PASS: rights-gated MP4 cache, offline routing, range seek, delete and unavailable states");
})().catch(e=>{console.error(e);process.exitCode=1;});
