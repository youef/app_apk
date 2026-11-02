/* AL EZZ TV — Google Cast Web Sender and native Safari AirPlay.
 * Public HTTPS MP4/HLS/DASH only; never a YouTube page or browser tab.
 * A child profile cannot cast because its local daily time limit cannot be enforced remotely.
 */
(function(w){
"use strict";
var active=null,ready=false,castContext=null,remote=null,controller=null,remoteActive=false;
var token=0,lastPushed="",castState="NO_DEVICES_AVAILABLE";
function get(id){return id?document.getElementById(id):null;}
function show(node,visible){if(node)node.hidden=!visible;}
function notify(message){if(w.Alezz&&w.Alezz.toast)w.Alezz.toast(message);}
function mediaUrl(url){
 url=String(url||"").trim();
 if(!/^https:\/\/[^\s]+$/i.test(url))return "";
 var path=url.split(/[?#]/)[0].toLowerCase();
 return /\.(m3u8|mp4|m4v|mpd|webm)$/.test(path)?url:"";
}
function mime(url){
 var path=String(url||"").split(/[?#]/)[0].toLowerCase();
 if(/\.m3u8$/.test(path))return "application/x-mpegURL";
 if(/\.mpd$/.test(path))return "application/dash+xml";
 if(/\.webm$/.test(path))return "video/webm";
 if(/\.(mp4|m4v)$/.test(path))return "video/mp4";
 return "";
}
function currentUrl(media){
 if(!media||media.youtubeId||media.kids)return "";
 var main=mediaUrl(media.stream);
 if(main)return main;
 var variants=media.variants||[];
 for(var i=0;i<variants.length;i++){var u=mediaUrl(variants[i].url);if(u)return u;}
 return "";
}
function status(text){if(active&&active.status){active.status.textContent=text||"";show(active.status,!!text);}}
function castConnected(){return !!(castContext&&castContext.getCurrentSession());}
function refreshCast(){
 var available=ready&&castState!=="NO_DEVICES_AVAILABLE";
 show(active&&active.castButton,!!(active&&active.url&&available));
}
function refreshAirPlay(){
 if(!active)return;
 show(active.airplayButton,!!(active.url&&active.airplayAvailable&&active.video&&
 typeof active.video.webkitShowPlaybackTargetPicker==="function"));
}
function airplayAvailability(event){
 if(!active||event.target!==active.video)return;
 active.airplayAvailable=event.availability==="available";
 refreshAirPlay();
}
function airplayChanged(event){
 if(!active||event.target!==active.video)return;
 status(active.video.webkitCurrentPlaybackTargetIsWireless?"AirPlay • تشغيل على التلفزيون":"");
}
function push(){
 if(!ready||!active||!active.url||!castConnected())return;
 var b=active,session=castContext.getCurrentSession();
 var key=token+"|"+b.url;
 if(lastPushed===key)return;
 lastPushed=key;
 try{
  var info=new chrome.cast.media.MediaInfo(b.url,mime(b.url));
  info.streamType=b.media.live?chrome.cast.media.StreamType.LIVE:chrome.cast.media.StreamType.BUFFERED;
  var meta=new chrome.cast.media.GenericMediaMetadata();
  meta.title=b.media.title||"العز TV";
  meta.subtitle=b.media.subtitle||"Al Ezz TV";
  if(b.media.poster&&/^https:\/\//i.test(b.media.poster))meta.images=[new chrome.cast.Image(b.media.poster)];
  info.metadata=meta;
  var request=new chrome.cast.media.LoadRequest(info);
  if(!b.media.live&&b.video&&isFinite(b.video.currentTime)&&b.video.currentTime>0)
   request.currentTime=b.video.currentTime;
  status("جارٍ الإرسال إلى التلفزيون…");
  session.loadMedia(request).then(function(){
   if(!active||b!==active||key!==lastPushed)return;
   remoteActive=true;
   if(b.video)try{b.video.pause();}catch(e){}
   status("Google Cast • التشغيل على التلفزيون");
  },function(){
   if(!active||b!==active||key!==lastPushed)return;
   remoteActive=false;lastPushed="";
   status("تعذّر الإرسال. تحقق من دعم الشاشة والرابط.");
   notify("لم تتمكن الشاشة من قراءة الفيديو. قد يتطلب المصدر صلاحيات أو صيغة متوافقة.");
  });
 }catch(e){
  remoteActive=false;lastPushed="";
  status("تعذّر إعداد إرسال Google Cast");
 }
}
function setupCast(){
 if(ready)return;
 if(!w.cast||!w.cast.framework||!w.chrome||!chrome.cast||!chrome.cast.media)return;
 try{
  castContext=cast.framework.CastContext.getInstance();
  castContext.setOptions({
   receiverApplicationId:chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
   autoJoinPolicy:chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });
  remote=new cast.framework.RemotePlayer();
  controller=new cast.framework.RemotePlayerController(remote);
  castContext.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED,function(){
   castState=castContext.getCastState();refreshCast();
   if(!castConnected()){remoteActive=false;lastPushed="";status("");}
  });
  castContext.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED,function(event){
   if(event.sessionState===cast.framework.SessionState.SESSION_STARTED)push();
   if(event.sessionState===cast.framework.SessionState.SESSION_ENDED){
    remoteActive=false;lastPushed="";status("");
   }
   refreshCast();
  });
  ready=true;castState=castContext.getCastState();refreshCast();
  if(castConnected())push();
 }catch(e){ready=false;castContext=null;}
}
function init(){
 // Web Cast sender is Chrome-family-only. Old Android-TV browsers and Safari keep working without SDK.
 var agent=(navigator&&navigator.userAgent)||"";
 if(!/^https:$/.test(location.protocol)||!/Chrome|Chromium|Edg\//i.test(agent)||/iPhone|iPad|iPod/i.test(agent))return;
 w.__onGCastApiAvailable=function(available){if(available)setupCast();};
 var tag=document.createElement("script");
 tag.async=true;
 tag.src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
 tag.onerror=function(){refreshCast();};
 (document.head||document.documentElement).appendChild(tag);
}
function detach(scope){
 if(!active||active.scope!==scope)return;
 var b=active;
 if(b.video){
  b.video.removeEventListener("webkitplaybacktargetavailabilitychanged",airplayAvailability);
  b.video.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged",airplayChanged);
 }
 show(b.castButton,false);show(b.airplayButton,false);show(b.status,false);
 active=null;token++;lastPushed="";remoteActive=false;
 // Never terminate a receiver session simply because the local overlay closes.
}
function bind(scope,video,media,controls){
 if(active)detach(active.scope);
 var url=currentUrl(media);
 if(!video||!url||!controls)return;
 active={scope:scope,video:video,media:media,url:url,
  castButton:get(controls.cast),airplayButton:get(controls.airplay),status:get(controls.status),
  airplayAvailable:false};
 token++;lastPushed="";remoteActive=false;
 show(active.castButton,false);show(active.airplayButton,false);status("");
 video.setAttribute("x-webkit-airplay","allow");
 video.addEventListener("webkitplaybacktargetavailabilitychanged",airplayAvailability);
 video.addEventListener("webkitcurrentplaybacktargetiswirelesschanged",airplayChanged);
 if(active.airplayButton){
  active.airplayButton.onclick=function(){
   if(active&&active.video&&active.airplayAvailable&&
    typeof active.video.webkitShowPlaybackTargetPicker==="function")
    try{active.video.webkitShowPlaybackTargetPicker();}catch(e){notify("AirPlay غير متاح الآن");}
  };
 }
 refreshCast();refreshAirPlay();
 if(castConnected())push();
}
function isRemote(){return !!(remoteActive&&castConnected());}
function playPause(){
 if(!isRemote()||!controller)return false;
 try{controller.playOrPause();return true;}catch(e){return false;}
}
function seekBy(seconds){
 if(!isRemote()||!controller||!remote||!remote.canSeek)return false;
 try{remote.currentTime=Math.max(0,(remote.currentTime||0)+seconds);controller.seek();return true;}
 catch(e){return false;}
}
w.AlezzCast={init:init,bind:bind,detach:detach,isRemote:isRemote,playPause:playPause,seekBy:seekBy,
 mediaUrl:mediaUrl,mime:mime,currentUrl:currentUrl};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
})(window);
