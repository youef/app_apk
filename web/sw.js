/* Al Ezz TV — cache app shell only, never streamed video or external APIs. */
var CACHE="alezz-shell-kids-20261102-v1";
var BASE=self.registration.scope;
var FILES=[
 "./","./index.html","./manifest.webmanifest","./alizz-tv-transparent.png",
 "./assets/al-ezz-app-icon.svg","./css/app.css","./css/unified.css","./css/live.css",
 "./js/legacy-polyfills.js","./js/config.js","./js/api.js","./js/explore.js",
 "./js/store.js","./js/app.js","./js/player.js","./js/live.js","./js/kids.js","./js/install.js","./css/kids.css",
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
