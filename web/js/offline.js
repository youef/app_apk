/* AL EZZ TV — opt-in, rights-checked offline MP4 storage.
   Stores complete CORS-readable files only; no DRM/HLS/YouTube extraction. */
(function () {
  "use strict";
  var CACHE = "alezz-offline-media-v1";
  var META = "alezz.offline.items.v1";
  var AUTO = "alezz.offline.auto.v1";
  var MAX_BYTES = 900 * 1024 * 1024;
  var work = {};
  function meta() { try { var x=JSON.parse(localStorage.getItem(META)||"{}"); return x&&typeof x==="object"?x:{}; } catch(e) {return {};} }
  function write(m) { try { localStorage.setItem(META, JSON.stringify(m)); } catch(e) {} notify(); }
  function notify() { try { window.dispatchEvent(new Event("alezz-offline-change")); } catch(e) {} }
  function path(key) { return new URL("__offline_media__/" + encodeURIComponent(key) + ".mp4", location.href).href; }
  function mp4(url) { return /^https:\/\/[^\s]+\.mp4(?:[?#]|$)/i.test(String(url||"")); }
  function source(item) {
    if(!item) return "";
    if(mp4(item.stream)) return item.stream;
    var arr=Array.isArray(item.variants)?item.variants:[];
    for(var i=0;i<arr.length;i++) {
      var v=arr[i], url=typeof v==="string"?v:v&&(v.url||v.stream||v.stream_url);
      if(mp4(url))return url;
    }
    return "";
  }
  function allowed(item) {
    return !!(item && (item.kind==="movie"||item.kind==="episode") &&
      item.offlinePermitted===true && !item.youtubeId && !item.live && source(item));
  }
  function list() {
    var m=meta();
    return Object.keys(m).map(function(k){return m[k];}).sort(function(a,b){return (b.savedAt||0)-(a.savedAt||0);});
  }
  function get(key){return meta()[key]||null;}
  function autoEnabled(){try{return localStorage.getItem(AUTO)!=="off";}catch(e){return false;}}
  function setAuto(enabled){try{localStorage.setItem(AUTO,enabled?"on":"off");}catch(e){}notify();}
  function resolve(key) {
    if(!get(key) || !window.caches) return Promise.resolve(null);
    return caches.open(CACHE).then(function(c){return c.match(path(key));}).then(function(r){
      if(!r) { var m=meta();delete m[key];write(m);return null; }
      if(navigator.serviceWorker&&navigator.serviceWorker.controller) return path(key);
      return r.blob().then(function(b){return URL.createObjectURL(b);});
    }).catch(function(){return null;});
  }
  function remove(key) {
    var m=meta();delete m[key];write(m);
    return ("caches" in window?caches.open(CACHE).then(function(c){return c.delete(path(key));}):Promise.resolve(false)).then(function(){notify();return true;});
  }
  function save(item, onProgress) {
    if(!allowed(item))return Promise.reject(Error("هذا الفيديو ليس MP4 مباشرًا مرخصًا للحفظ المحلي."));
    if(!window.caches||!window.fetch)return Promise.reject(Error("التخزين المحلي غير مدعوم على هذا المتصفح."));
    if(navigator.onLine===false)return Promise.reject(Error("يلزم الاتصال أول مرة لحفظ الفيديو."));
    if(get(item.key))return Promise.resolve(get(item.key));
    if(work[item.key])return work[item.key];
    var downloadUrl=source(item), controller=typeof AbortController!=="undefined"?new AbortController():null;
    var options={mode:"cors",credentials:"omit",cache:"no-store"};
    if(controller)options.signal=controller.signal;
    var update=function(n,total){if(onProgress)try{onProgress(n,total);}catch(e){}notify();};
    work[item.key]=fetch(downloadUrl,options).then(function(response) {
      if(!response.ok||response.status!==200||response.type==="opaque")
        throw Error("المصدر لا يسمح بتنزيل ملف كامل. جرّب رابط MP4 مباشرًا.");
      var total=Number(response.headers.get("content-length")||0);
      if(!total || !isFinite(total))throw Error("المصدر لا يعلن حجم الفيلم؛ لا يمكن حفظه بأمان.");
      if(total>MAX_BYTES)throw Error("حجم الفيلم أكبر من حد التنزيل المحلي (900 ميجابايت).");
      return (navigator.storage&&navigator.storage.estimate?navigator.storage.estimate():Promise.resolve(null))
        .then(function(estimate){
          if(estimate&&estimate.quota&&estimate.usage&&estimate.quota-estimate.usage<total+30*1024*1024)
            throw Error("مساحة المتصفح غير كافية لتنزيل هذا الفيلم.");
          return caches.open(CACHE).then(function(cache){
            var body=response.clone().body, progress=Promise.resolve();
            if(body&&body.getReader){
              progress=(function(){var reader=body.getReader(),loaded=0;
                function step(){return reader.read().then(function(v){
                  if(v.done)return;
                  loaded+=v.value.byteLength;update(loaded,total);
                  if(loaded>MAX_BYTES){if(controller)controller.abort();throw Error("تجاوز الحجم الحد الآمن.");}
                  return step();
                });}
                return step();
              })();
            }
            var store=cache.put(path(item.key),new Response(response.body,{
              status:200,headers:{"Content-Type":"video/mp4"}
            }));
            return Promise.all([store,progress]).then(function(){
              var m=meta(),entry={
                key:item.key,title:item.title||"فيديو محفوظ",kind:item.kind,
                poster:item.poster||"",parentKey:item.parentKey||"",
                size:total,savedAt:Date.now()
              };
              m[item.key]=entry;write(m);update(total,total);return entry;
            }).catch(function(err){return cache.delete(path(item.key)).then(function(){throw err;});});
          });
        });
    }).catch(function(err){
      var message=String(err&&err.message||err);
      if(/Failed to fetch|NetworkError|Load failed|fetch/i.test(message))
        throw Error("رابط الفيديو لا يسمح بالتحميل من المتصفح (CORS) أو انقطع الاتصال.");
      throw err;
    });
    work[item.key]=work[item.key].then(function(v){delete work[item.key];notify();return v;},function(e){delete work[item.key];notify();throw e;});
    notify();return work[item.key];
  }
  function maybeAutoSave(item) {
    if(!autoEnabled()||!allowed(item)||get(item.key)||work[item.key])return;
    var c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(c&&(c.saveData||c.type==="cellular"||c.effectiveType==="2g"||c.effectiveType==="slow-2g"))return;
    save(item).catch(function(){});
  }
  function saving(key){return !!work[key];}
  function formatBytes(n){return n?(n/1024/1024).toFixed(n>=100*1024*1024?0:1)+" م.ب":"—";}
  window.AlezzOffline={
    canSave:allowed,source:source,get:get,list:list,save:save,remove:remove,resolve:resolve,
    autoEnabled:autoEnabled,setAuto:setAuto,maybeAutoSave:maybeAutoSave,saving:saving,
    formatBytes:formatBytes,virtualURL:path
  };
})();
