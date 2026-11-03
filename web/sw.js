/* Al Ezz TV — cache app shell only, never streamed video or external APIs. */
var CACHE="alezz-shell-media-recovery-20261103-v9";
var BASE=self.registration.scope;
var MEDIA_CACHE="alezz-offline-media-v1";
function serveSavedVideo(request){
 return caches.open(MEDIA_CACHE).then(function(cache){return cache.match(request.url);}).then(function(saved){
  if(!saved)return new Response("Offline file missing",{status:404});
  var range=request.headers.get("Range");
  if(!range)return saved;
  return saved.blob().then(function(blob){
   var match=/bytes=(\d*)-(\d*)/i.exec(range);
   if(!match)return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+blob.size}});
   var start=match[1]?Number(match[1]):0,end=match[2]?Number(match[2]):blob.size-1;
   if(!match[1]&&match[2])start=Math.max(0,blob.size-Number(match[2])),end=blob.size-1;
   if(!isFinite(start)||!isFinite(end)||start>=blob.size||end<start)
    return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+blob.size}});
   end=Math.min(end,blob.size-1);
   return new Response(blob.slice(start,end+1,"video/mp4"),{status:206,headers:{
    "Content-Type":"video/mp4","Accept-Ranges":"bytes",
    "Content-Length":String(end-start+1),"Content-Range":"bytes "+start+"-"+end+"/"+blob.size
   }});
  });
 });
}
var FILES=[
 "./","./index.html","./manifest.webmanifest","./assets/logo.svg",
 "./assets/al-ezz-app-icon.svg","./css/app.css","./css/unified.css","./css/live.css",
 "./js/legacy-polyfills.js","./js/config.js","./js/api.js","./js/explore.js",
 "./js/store.js","./js/offline.js","./js/app.js","./js/player.js","./js/live.js","./js/kids.js","./js/cast.js","./js/install.js","./css/kids.css","./css/cast.css",
 "./data/snapshot.json"
];
self.addEventListener("install",function(event){
 event.waitUntil(caches.open(CACHE).then(function(cache){
   return Promise.all(FILES.map(function(file){return cache.add(file).catch(function(){return null;});}));
 }).then(function(){return self.skipWaiting();}));
});
self.addEventListener("activate",function(event){
 event.waitUntil(caches.keys().then(function(names){
   return Promise.all(names.filter(function(name){return name.indexOf("alezz-shell-")===0&&name!==CACHE;})
     .map(function(name){return caches.delete(name);}));
 }).then(function(){return self.clients.claim();}));
});
self.addEventListener("fetch",function(event){
 var request=event.request;
 if(request.method!=="GET"||request.url.indexOf(BASE)!==0)return;
 if(request.url.slice(BASE.length).indexOf("__offline_media__/")===0){
   event.respondWith(serveSavedVideo(request));return;
 }
 var url=new URL(request.url);
 if(/\.(?:m3u8|mp4|mpd|m4v|mov|webm|ts|vtt|srt)$/i.test(url.pathname)||
   url.pathname.indexOf("/admin/")!==-1)return;
 var path=url.pathname.slice(new URL(BASE).pathname.length);
 var known=FILES.some(function(file){return file.replace(/^\.\//,"")===path;});
 if(!known&&request.mode!=="navigate")return;
 event.respondWith(fetch(request).then(function(response){
   if(response&&response.ok&&response.type==="basic"){
     var copy=response.clone();
     caches.open(CACHE).then(function(cache){return cache.put(request,copy);}).catch(function(){});
   }
   return response;
 }).catch(function(){
   return caches.match(request,{ignoreSearch:true}).then(function(saved){
     if(saved)return saved;
     if(request.mode==="navigate")return caches.match("./index.html");
     return Response.error();
   });
 }));
});
