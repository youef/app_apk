/* Al Ezz TV — authenticated PWA shell.
   Do not cache HTML, authenticated navigation, API data or snapshot.json.
   Offline playback/navigation is intentionally unavailable without a live session. */
var CACHE = "alezz-shell-member-privacy-20261107-v24-dynamic-cinema";
var BASE = self.registration.scope;
var FILES = [
  "assets/logo.svg", "assets/al-ezz-app-icon.svg", "assets/al-ezz-red-glass-background.svg", "assets/al-ezz-glass-button.svg",
  "css/app.css", "css/unified.css", "css/glass.css", "css/red-cinema.css", "css/live.css", "css/kids.css", "css/cast.css",
  "css/member-ui.css",
  "js/legacy-polyfills.js", "js/config.js", "js/api.js", "js/explore.js",
  "js/store.js", "js/app.js", "js/player.js", "js/live.js", "js/kids.js",
  "js/cast.js", "js/install.js"
];

self.addEventListener("install", function (event) {
  // Pre-caching a protected URL may accidentally store an authentication
  // redirect response, so assets are stored only after successful fetches.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (name) {
      return name.indexOf("alezz-shell-") === 0 || name.indexOf("alezz-wallpaper-") === 0 || name === "alezz-offline-media-v1";
    }).map(function (name) { return caches.delete(name); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method!=="GET" || request.mode === "navigate" ||
      request.url.indexOf(BASE) !== 0) return;
  var url = new URL(request.url);
  var basePath = new URL(BASE).pathname;
  var relative = url.pathname.slice(basePath.length);
  if (FILES.indexOf(relative) === -1) return;
  event.respondWith(fetch(request).then(function (response) {
    var cc = response.headers.get("Cache-Control") || "";
    if (response.ok && response.type === "basic" &&
        !/(?:no-store|private)/i.test(cc)) {
      var safeCopy = response.clone();
      caches.open(CACHE).then(function (cache) {
        return cache.put(request, safeCopy);
      }).catch(function () {});
    }
    return response;
  }).catch(function () {
    return caches.match(request).then(function (asset) {
      return asset || Response.error();
    });
  }));
});
