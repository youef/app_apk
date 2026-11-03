"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const read=p=>fs.readFileSync(p,"utf8");
const player=read("web/js/player.js"),page=read("web/index.html"),sw=read("web/sw.js");
new vm.Script(player,{filename:"web/js/player.js"});
for(const term of [
 "function recoverPlayback(message)","function sourceErrorText(code)",
 "failedSourceUrls.indexOf(candidate.url)","current.remoteStream",
 "instance.on(Hls.Events.MEDIA_ATTACHED","instance.on(Hls.Events.MANIFEST_PARSED",
 "instance.attachMedia(v)","recoverPlayback(sourceErrorText(v.error.code))",
 "window.AlezzOffline.get(item.key)",'v.error.code === 1'
])assert(player.includes(term),"Missing recovery behavior: "+term);
const attached=player.indexOf("instance.on(Hls.Events.MEDIA_ATTACHED");
const load=player.indexOf("instance.loadSource(url)");
assert(attached !== -1 && load > attached,"HLS should wait until media is attached");
assert(player.includes("lastRecoveryToken === playbackToken"),"Repeated media failures must not trigger loops");
assert(player.includes("data.type === Hls.ErrorTypes.NETWORK_ERROR"),"HLS network diagnostics required");
assert(page.includes("media-recovery-20261103-v1"),"Stale player must be version-busted");
assert(sw.includes("alezz-shell-media-recovery-20261103"),"Offline shell must be invalidated");
console.log("PASS: HLS lifecycle, native error diagnostics and bounded source failover");