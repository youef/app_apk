/* Al Ezz TV — authenticated customer data sync (never shares access tokens). */
(function(){
  "use strict";
  var member=window.ALEZZ_MEMBER_CONTEXT;
  var Store=window.AlezzStore;
  if(!member||member.authenticated!==true||!member.csrf||!Store||!window.fetch)return;
  var QUEUE="memberSyncPendingV1", queue=Store.pref(QUEUE,[]);
  if(!Array.isArray(queue))queue=[];
  queue=queue.filter(function(x){return x&&typeof x==="object";}).slice(-150);
  var sending=false,timer=null,hasLoaded=false;
  function saveQueue(){Store.setPref(QUEUE,queue.slice(-150));}
  function validKey(key){return /^(movie|series|episode|channel):[a-f0-9-]{36}$/i.test(key||"");}
  function splitKey(key){var parts=key.split(":");return{item_type:parts[0],item_id:parts[1]};}
  function post(change){
    return fetch("/account/sync",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Content-Type":"application/json","Accept":"application/json",
               "X-CSRF-Token":member.csrf},
      body:JSON.stringify(change)
    }).then(function(reply){if(!reply.ok)throw new Error("مزامنة غير متاحة");return reply.json();});
  }
  function flush(){
    if(sending)return Promise.resolve(false);
    sending=true;
    function step(){
      if(!queue.length)return Promise.resolve(true);
      var pending=queue[0];
      return post(pending).then(function(){
        var index=queue.indexOf(pending);
        if(index>=0)queue.splice(index,1);
        saveQueue();
        return step();
      });
    }
    return step().then(function(ok){sending=false;return ok;},function(){
      sending=false;return false;
    });
  }
  function schedule(delay){
    clearTimeout(timer);
    timer=setTimeout(function(){timer=null;flush();},delay||1500);
  }
  function enqueue(change,delay){
    if(!change)return;
    var key=change.kind+":"+change.item_type+":"+change.item_id;
    if(change.kind==="favorites_reset"||change.kind==="progress_reset"){
      queue=queue.filter(function(x){
        return x.kind!==(change.kind==="favorites_reset"?"favorite":"progress") &&
          x.kind!==change.kind;
      });
    }else queue=queue.filter(function(x){
      return x.kind+":"+x.item_type+":"+x.item_id!==key;
    });
    queue.push(change);saveQueue();schedule(delay);
  }
  function pull(){
    return fetch("/account/sync",{method:"GET",credentials:"same-origin",cache:"no-store",
      headers:{"Accept":"application/json"}})
    .then(function(reply){if(!reply.ok)throw new Error("Sync unavailable");return reply.json();})
    .then(function(data){
      var favorites=(data.favorites||[]).filter(function(x){return x&&validKey(x.item_type+":"+x.item_id);})
        .map(function(x){return x.item_type+":"+x.item_id;});
      Store.replaceFavorites(favorites);
      originalSetPref.call(Store,"liveFavorites",favorites.filter(function(key){
        return key.indexOf("channel:")===0;
      }));
      Store.mergeRemoteProgress(data.progress||[]);
      hasLoaded=true;
      // The app is already mounted by this point; update visible shelves if supported.
      if(window.Alezz&&typeof window.Alezz.reload==="function")window.Alezz.reload();
      return true;
    },function(){return false;});
  }
  var originalSetPref=Store.setPref;
  Store.setPref=function(name,value){
    if(name!=="liveFavorites" || !Array.isArray(value))
      return originalSetPref.call(Store,name,value);
    var before=Store.pref("liveFavorites",[]);
    if(!Array.isArray(before))before=[];
    originalSetPref.call(Store,name,value);
    var oldKeys=before.filter(validKey),newKeys=value.filter(validKey);
    newKeys.forEach(function(key){
      if(oldKeys.indexOf(key)>=0)return;
      var item=splitKey(key);
      if(item.item_type==="channel")
        enqueue({kind:"favorite",action:"save",item_type:"channel",item_id:item.item_id},900);
    });
    oldKeys.forEach(function(key){
      if(newKeys.indexOf(key)>=0)return;
      var item=splitKey(key);
      if(item.item_type==="channel")
        enqueue({kind:"favorite",action:"remove",item_type:"channel",item_id:item.item_id},900);
    });
  };
  var originalFav=Store.toggleFavorite;
  Store.toggleFavorite=function(key){
    var added=originalFav.call(Store,key);
    if(validKey(key)){
      var item=splitKey(key);
      enqueue({kind:"favorite",action:added?"save":"remove",item_type:item.item_type,item_id:item.item_id},900);
    }
    return added;
  };
  var originalSave=Store.saveProgress;
  Store.saveProgress=function(key,data){
    originalSave.call(Store,key,data);
    if(!validKey(key)||!data)return;
    var item=splitKey(key),position=Math.round(Number(data.t||0)*1000),
      duration=Math.round(Number(data.d||0)*1000);
    if(!isFinite(position)||!isFinite(duration)||duration<=0)return;
    if(position/duration>=.97){
      enqueue({kind:"progress",action:"remove",item_type:item.item_type,item_id:item.item_id},900);
    }else if(position>5000){
      enqueue({kind:"progress",action:"save",item_type:item.item_type,item_id:item.item_id,
        position_ms:position,duration_ms:duration},16000);
    }
  };
  var originalRemove=Store.clearProgress;
  Store.clearProgress=function(key){
    originalRemove.call(Store,key);
    if(validKey(key)){
      var item=splitKey(key);
      enqueue({kind:"progress",action:"remove",item_type:item.item_type,item_id:item.item_id},800);
    }
  };
  var clearFavorites=Store.clearFavorites;
  Store.clearFavorites=function(){
    clearFavorites.call(Store);
    enqueue({kind:"favorites_reset",action:"clear"},1000);
  };
  var clearAllProgress=Store.clearAllProgress;
  Store.clearAllProgress=function(){
    clearAllProgress.call(Store);
    enqueue({kind:"progress_reset",action:"clear"},1000);
  };
  window.addEventListener("online",function(){flush().then(pull);});
  // On launch, send pending local changes before replacing local state from the cloud.
  flush().then(function(flushed){if(flushed)pull();});
  window.AlezzMemberSync={flush:flush,pull:pull};
})();
