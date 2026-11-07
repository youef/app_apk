#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const cast=read("web/js/cast.js"),player=read("web/js/player.js"),live=read("web/js/live.js"),
  html=read("web/index.html"),css=read("web/css/cast.css"),sw=read("web/sw.js");
for(const p of ["web/js/cast.js","web/js/player.js","web/js/live.js","web/sw.js"])
  new vm.Script(read(p),{filename:p});
for(const id of ["playerCast","playerAirPlay","playerCastStatus","liveCast","liveAirPlay","liveCastStatus"])
  assert(html.includes('id="'+id+'"')||live.includes('id=\\"'+id+'\\"')||live.includes('id="'+id+'"'),"Missing "+id);
assert(html.includes('js/cast.js?v='),"Web Cast sender must load before player");
assert(html.indexOf("js/cast.js")<html.indexOf("js/player.js"),"Cast controls must initialize before player");
assert(player.includes('window.AlezzCast.bind("player"')&&player.includes('window.AlezzCast.detach("player"'));
assert(live.includes('window.AlezzCast.bind("live"')&&live.includes('window.AlezzCast.detach("live"'));
assert(player.includes('el.video.disableRemotePlayback=!!current.kids'),"Child viewing limit must not be bypassed by casting");
assert(cast.includes("DEFAULT_MEDIA_RECEIVER_APP_ID"),"Official default receiver required");
assert(cast.includes("SESSION_STARTED")&&cast.includes("session.loadMedia(request)"),"Transfer video through receiver");
assert(cast.includes("webkitShowPlaybackTargetPicker"),"Native Safari AirPlay selector required");
assert(css.includes('.cast-launcher[hidden]'),"Unsupported devices must not show fake controls");
assert(sw.includes('"js/cast.js"')&&sw.includes('"css/cast.css"'),"Cast interface must remain among safe static assets");

const elements={};
for(const id of ["playerCast","playerAirPlay","playerCastStatus"])
  elements[id]={hidden:true,onclick:null,textContent:"",setAttribute(){},addEventListener(){}};
let picked=0,paused=0,loaded=[],listeners={},apiCallback;
const video={currentTime:46,webkitShowPlaybackTargetPicker(){picked++;},
  addEventListener(n,fn){listeners[n]=fn;},removeEventListener(n){delete listeners[n];},
  pause(){paused++;},setAttribute(){}};
const session={loadMedia(request){loaded.push(request);return {then(ok){ok();}};}};
const ctx={
  getCurrentSession(){return session;},getCastState(){return "NOT_CONNECTED";},
  setOptions(options){assert.equal(options.receiverApplicationId,"DEFAULT");},
  addEventListener(){}
};
function MediaInfo(id,type){this.contentId=id;this.contentType=type;}
function LoadRequest(info){this.mediaInfo=info;}
const chromecast={media:{DEFAULT_MEDIA_RECEIVER_APP_ID:"DEFAULT",MediaInfo,LoadRequest,
   GenericMediaMetadata:function(){},StreamType:{LIVE:"LIVE",BUFFERED:"BUFFERED"}},
   AutoJoinPolicy:{ORIGIN_SCOPED:"ORIGIN_SCOPED"},Image:function(url){this.url=url;}};
const fakeCast={framework:{
  CastContext:{getInstance(){return ctx;}},RemotePlayer:function(){this.canSeek=true;this.currentTime=10;},
  RemotePlayerController:function(){this.playOrPause=()=>{};this.seek=()=>{};},
  CastState:{NO_DEVICES_AVAILABLE:"NO_DEVICES_AVAILABLE"},
  CastContextEventType:{CAST_STATE_CHANGED:"CAST_STATE_CHANGED",SESSION_STATE_CHANGED:"SESSION_STATE_CHANGED"},
  SessionState:{SESSION_STARTED:"SESSION_STARTED",SESSION_ENDED:"SESSION_ENDED"}
}};
const win={chrome:{cast:chromecast},cast:fakeCast,Alezz:{toast(){}},Date,Math};
const doc={readyState:"complete",getElementById:id=>elements[id]||null,
 createElement:()=>({}),head:{appendChild(){}},addEventListener(){}};
const env={window:win,document:doc,location:{protocol:"https:",hash:"#/movies"},
 navigator:{userAgent:"Mozilla/5.0 Chrome/120"},cast:fakeCast,chrome:{cast:chromecast},Date,Math};
vm.runInNewContext(cast,env);
win.__onGCastApiAvailable(true);
const sdk=win.AlezzCast;
assert.equal(sdk.mime("https://cdn.example/a.m3u8?token=x"),"application/x-mpegURL");
assert.equal(sdk.mime("https://cdn.example/a.mp4"),"video/mp4");
assert.equal(sdk.mediaUrl("https://site.example/page"),"");
assert.equal(sdk.mediaUrl("http://cdn.example/a.mp4"),"");
assert.equal(sdk.currentUrl({stream:"https://cdn.example/video.mp4",kids:true}),"");
assert.equal(sdk.currentUrl({stream:"https://cdn.example/video.mp4",youtubeId:"video"}),"");
sdk.bind("player",video,{stream:"https://cdn.example/a.m3u8?token=x",title:"Episode",live:false},
 {cast:"playerCast",airplay:"playerAirPlay",status:"playerCastStatus"});
assert.equal(loaded.length,1,"Connected receiver must get content request");
assert.equal(loaded[0].mediaInfo.contentId,"https://cdn.example/a.m3u8?token=x");
assert.equal(loaded[0].mediaInfo.contentType,"application/x-mpegURL");
assert.equal(loaded[0].currentTime,46,"Receiver should resume from local position");
assert(paused>0,"Local playback must pause after cast succeeds");
assert(sdk.isRemote(),"Remote state should activate after successful transfer");
listeners.webkitplaybacktargetavailabilitychanged({target:video,availability:"available"});
assert.equal(elements.playerAirPlay.hidden,false);
elements.playerAirPlay.onclick();
assert.equal(picked,1,"AirPlay button must open native device picker");
sdk.detach("player");
assert.equal(elements.playerCast.hidden,true);
assert.equal(elements.playerAirPlay.hidden,true);
assert.equal(sdk.isRemote(),false);
sdk.bind("player",video,{stream:"https://cdn.example/a.mp4",title:"Child",kids:true},
 {cast:"playerCast",airplay:"playerAirPlay",status:"playerCastStatus"});
assert.equal(loaded.length,1,"No remote load for child profile");
console.log("PASS: Cast and AirPlay API wiring, media/age guards, UI state and remote playback");
