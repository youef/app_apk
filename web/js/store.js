/* ============================================================================
   AL EZZ TV — local store (favorites, progress, prefs, activation)
   Each authenticated account has its own isolated device-local namespace.
   ========================================================================== */
(function () {
  "use strict";

  var ctx = window.ALEZZ_MEMBER_CONTEXT || null;
  var accountKey = ctx && ctx.authenticated === true && /^[a-f0-9]{32}$/.test(ctx.accountKey || "")
    ? ctx.accountKey : "";
  // The server provides an opaque, non-credential account key after authentication.
  // Unauthenticated legacy/native shells retain the previous device-local namespace.
  var NS = accountKey ? "alezz.member.v1." + accountKey + "." : "alezz.v10.";
  var memory = {};

  function read(key) {
    try {
      var raw = window.localStorage.getItem(NS + key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) {
      return memory[key] === undefined ? null : memory[key];
    }
  }

  function write(key, value) {
    memory[key] = value;
    try {
      window.localStorage.setItem(NS + key, JSON.stringify(value));
    } catch (e) { /* private mode / quota — keep in memory only */ }
  }

  var deviceId = (function () {
    var id = read("device");
    if (!id) {
      id = "d_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      write("device", id);
    }
    return id;
  })();

  var Store = {
    deviceId: deviceId,
    isMember: !!accountKey,

    /* ---- activation ---- */
    isActivated: function () { return !!accountKey || read("activated") === true; },
    activate: function () { write("activated", true); },
    deactivate: function () { write("activated", false); },

    /* ---- favorites ---- */
    favorites: function () {
      var list = read("favorites");
      return Array.isArray(list) ? list : [];
    },
    isFavorite: function (key) {
      return this.favorites().indexOf(key) !== -1;
    },
    clearFavorites: function () {
      write("favorites", []);
    },
    toggleFavorite: function (key) {
      var list = this.favorites();
      var i = list.indexOf(key);
      if (i === -1) list.unshift(key); else list.splice(i, 1);
      write("favorites", list.slice(0, 400));
      return i === -1; // true when added
    },

    /* ---- watch progress: {key: {t, d, at, kind, title, poster}} ---- */
    progressAll: function () {
      var map = read("progress");
      return map && typeof map === "object" ? map : {};
    },
    progress: function (key) {
      return this.progressAll()[key] || null;
    },
    saveProgress: function (key, data) {
      var map = this.progressAll();
      var pct = data.d > 0 ? data.t / data.d : 0;
      if (pct > 0.97 || data.t < 5) { delete map[key]; }
      else {
        map[key] = {
          t: Math.round(data.t), d: Math.round(data.d || 0), at: Date.now(),
          kind: data.kind, title: data.title, poster: data.poster || null,
          subtitle: data.subtitle || null, art: data.art || null
        };
      }
      var keys = Object.keys(map);
      if (keys.length > 60) {
        keys.sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0); });
        keys.slice(0, keys.length - 60).forEach(function (k) { delete map[k]; });
      }
      write("progress", map);
    },
    clearAllProgress: function () {
      write("progress", {});
    },
    clearProgress: function (key) {
      var map = this.progressAll();
      delete map[key];
      write("progress", map);
    },

    /* ---- preferences ---- */
    prefs: function () {
      var p = read("prefs");
      return p && typeof p === "object" ? p : {};
    },
    pref: function (name, fallback) {
      var p = this.prefs();
      return p[name] === undefined ? fallback : p[name];
    },
    setPref: function (name, value) {
      var p = this.prefs();
      p[name] = value;
      write("prefs", p);
    }
  };

  window.AlezzStore = Store;
})();
