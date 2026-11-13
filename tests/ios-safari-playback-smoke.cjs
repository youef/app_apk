"use strict";
const assert=require("node:assert/strict"), fs=require("node:fs"), vm=require("node:vm");
const load=p=>fs.readFileSync(p,"utf8");
const p=load("web/js/player.js"),html=load("web/index.html"),css=load("web/css/unified.css"),sw=load("web/sw.js");
new vm.Script(p,{filename:"web/js/player.js"});
for (const s of [
  "function requestPlayback(ticket)", "function needsUserGesture()", "function recoverSource(message)",
  "function playSelectedSource(url, forceJs)", "attemptedJsHls[failed] = true",
  "instance.on(Hls.Events.MEDIA_ATTACHED", "instance.loadSource(url)",
  "instance.on(Hls.Events.MANIFEST_PARSED", 'if (err && err.name === "NotAllowedError")',
  "v.getAttribute(\"src\") !== attemptedUrl", "sourceFailureMessage(code)",
  "el.video.controls = iosSafari", "rejectedSources.indexOf(option.url)"
])assert(p.includes(s),"iOS media regression: "+s);
assert(!p.includes("var token = playbackToken;\n    var ready = function"),"metadata binding must use active source token");
assert(p.includes("el.video.addEventListener(\"loadedmetadata\", function () {"),"resume on current source required");
assert(p.indexOf("function startPlayback(item)")<p.indexOf("playSelectedSource(url, false);"),"source handoff missing");
assert(p.indexOf("instance.on(Hls.Events.MEDIA_ATTACHED")<p.indexOf("instance.loadSource(url)"),
  "HLS must load manifest only after media attachment");
assert(/js\/player\.js\?v=[a-z0-9][\w.-]+/i.test(html),"iOS player cache-bust missing");
assert(css.includes(".player.needs-user-play .player__center"),"portrait/landscape tap button missing");
assert(/var CACHE = "alezz-shell-[^"]+"/.test(sw) && sw.includes('request.mode === "navigate"') && sw.includes("caches.delete(name)"),"ServiceWorker must invalidate the old cache without caching private viewer HTML");
assert(!html.includes("js/offline.js"),"Offline downloads should stay removed");
console.log("PASS: Safari user gesture, stale error guard, native HLS, bounded alternatives, cache refresh");