/* ============================================================================
   AL EZZ TV — player
   MP4 + HLS (native or hls.js) with resume, quality switch, D-pad controls
   and official YouTube embeds (never scraped streams).
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.ALEZZ_CONFIG;
  var Store = window.AlezzStore;

  var el = {};
  var current = null;
  var nextItem = null;
  var hls = null;
  var hideTimer = null;
  var saveTimer = null;
  var scrubbing = false;
  var qualities = [];
  var activeQuality = "auto";
  var youtubeFrame = null;

  function $(id) { return document.getElementById(id); }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mm = (h ? String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
    return h ? h + ":" + mm : mm;
  }

  function toast(msg, kind) {
    if (window.Alezz && window.Alezz.toast) window.Alezz.toast(msg, kind);
  }

  function loadHlsScript() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (loadHlsScript._p) return loadHlsScript._p;
    loadHlsScript._p = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
      s.async = true;
      s.onload = function () { resolve(window.Hls || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
      setTimeout(function () { resolve(window.Hls || null); }, 8000);
    });
    return loadHlsScript._p;
  }

  function show(id, on) { if (el[id]) el[id].hidden = !on; }

  function setChromeIdle(idle) {
    el.root.classList.toggle("is-idle", !!idle);
  }

  function wake() {
    setChromeIdle(false);
    clearTimeout(hideTimer);
    if (!el.video.paused) {
      hideTimer = setTimeout(function () { setChromeIdle(true); }, 3200);
    }
  }

  function setPlayIcon(playing) {
    $("btnPlayIcon").innerHTML = playing
      ? '<path d="M8 5h3v14H8zM13 5h3v14h-3z"/>'
      : '<path d="M8 5.2v13.6L20 12z"/>';
  }

  function updateScrub() {
    var v = el.video;
    var d = v.duration || 0;
    var pct = d ? (v.currentTime / d) * 100 : 0;
    $("scrubPlayed").style.width = pct + "%";
    $("tNow").textContent = fmt(v.currentTime);
    $("tTotal").textContent = d && isFinite(d) ? fmt(d) : (current && current.live ? "مباشر" : "0:00");
    try {
      if (v.buffered.length) {
        var end = v.buffered.end(v.buffered.length - 1);
        $("scrubBuffer").style.width = (d ? (end / d) * 100 : 0) + "%";
      }
    } catch (e) { /* ignore */ }
  }

  function persist(force) {
    if (!current || !current.key) return;
    var v = el.video;
    if (!v.duration || current.live) return;
    if (!force && Date.now() - (persist._last || 0) < 5000) return;
    persist._last = Date.now();
    Store.saveProgress(current.key, {
      t: v.currentTime, d: v.duration, kind: current.kind, title: current.title,
      poster: current.poster, subtitle: current.subtitle, art: current.art
    });
  }

  function clearStage() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (youtubeFrame) { youtubeFrame.remove(); youtubeFrame = null; }
    var v = el.video;
    v.pause();
    v.removeAttribute("src");
    v.innerHTML = "";
    try { v.load(); } catch (e) {}
    v.hidden = false;
    show("playerError", false);
    show("playerSpinner", false);
    show("playerNext", false);
  }

  function fail(message) {
    show("playerSpinner", false);
    show("playerError", true);
    $("playerErrorMsg").textContent = message || "قد يكون الرابط غير متاح حاليًا أو غير مدعوم على هذا الجهاز.";
    el.root.classList.remove("is-idle");
  }

  function attachNative(url) {
    var v = el.video;
    v.src = url;
    v.load();
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked — show big play */ });
  }

  function attachHls(url) {
    var v = el.video;
    return loadHlsScript().then(function (Hls) {
      if (Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: !!current.live, backBufferLength: 60 });
        hls.loadSource(url);
        hls.attachMedia(v);
        hls.on(Hls.Events.ERROR, function (_e, data) {
          if (data && data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); return; } catch (e) {} }
            fail("تعذّر تحميل بث HLS من المصدر. جرّب مصدرًا آخر أو أعد المحاولة.");
          }
        });
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
        return true;
      }
      if (v.canPlayType("application/vnd.apple.mpegurl")) {
        attachNative(url);
        return true;
      }
      return false;
    });
  }

  function playYoutube(id, title) {
    clearStage();
    el.video.hidden = true;
    youtubeFrame = document.createElement("iframe");
    youtubeFrame.className = "yt-frame";
    youtubeFrame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    youtubeFrame.setAttribute("allowfullscreen", "");
    youtubeFrame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    youtubeFrame.src = "https://www.youtube-nocookie.com/embed/" + id +
      "?autoplay=1&rel=0&modestbranding=1&playsinline=1&hl=ar";
    youtubeFrame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#000";
    el.stage.appendChild(youtubeFrame);
    $("playerTitle").textContent = title || "فيديو";
    $("playerSubtitle").textContent = "YouTube — مشغل رسمي";
    $("playerBadges").innerHTML = '<span class="chip chip--gold">تضمين رسمي</span>';
    el.root.classList.add("is-idle");
  }

  function startPlayback(item) {
    clearStage();
    $("playerTitle").textContent = item.title || "—";
    $("playerSubtitle").textContent = item.subtitle || "";
    $("playerBadges").innerHTML = buildBadges(item);
    el.root.classList.remove("is-idle");

    if (item.youtubeId) { playYoutube(item.youtubeId, item.title); return; }

    var url = item.stream || "";
    if (!url) { fail("لا يوجد رابط تشغيل مسجّل لهذا العنصر."); return; }

    show("playerSpinner", true);
    el.video.hidden = false;

    var ready = function () {
      show("playerSpinner", false);
      var resume = item.resumeAt || 0;
      if (resume > 3 && !item.live) {
        try { el.video.currentTime = resume; } catch (e) {}
        toast("متابعة من " + fmt(resume));
      }
    };
    el.video.addEventListener("loadedmetadata", ready, { once: true });
    el.video.addEventListener("playing", function () { show("playerSpinner", false); setPlayIcon(true); wake(); });

    if (/\.m3u8(\?|#|$)/i.test(url)) {
      attachHls(url).then(function (ok) {
        if (!ok) fail("هذا الجهاز لا يدعم HLS مباشرة. افتح المصدر في مشغل خارجي أو جرّب جودة MP4.");
      });
    } else {
      attachNative(url);
    }
  }

  function buildBadges(item) {
    var out = [];
    if (item.live) out.push('<span class="chip chip--live"><i></i>مباشر</span>');
    if (item.quality) out.push('<span class="chip chip--gold">' + item.quality + '</span>');
    if (item.kids) out.push('<span class="chip chip--kid">عائلي</span>');
    if (item.age && item.age !== "all") out.push('<span class="chip">' + item.age + '</span>');
    return out.join("");
  }

  /* ---------------- public API ---------------- */

  var Player = {
    isOpen: function () { return !el.root.hidden; },

    open: function (item, options) {
      options = options || {};
      current = Object.assign({}, item);
      if (options.next) nextItem = options.next; else nextItem = null;

      var saved = Store.progress(item.key);
      if (!options.restart && saved && saved.t > 5) current.resumeAt = saved.t;

      el.root.hidden = false;
      document.body.style.overflow = "hidden";
      startPlayback(current);

      if (nextItem) {
        $("nextTitle").textContent = nextItem.title;
        show("playerNext", false); /* shown near the end */
      }
      return true;
    },

    close: function () {
      persist(true);
      clearStage();
      el.root.hidden = true;
      document.body.style.overflow = "";
      current = null;
      nextItem = null;
      activeQuality = "auto";
    },

    /* open an episode's series queue */
    queue: function (list, index) {
      Player._queue = { list: list, index: index };
    }
  };

  function playNext() {
    if (!nextItem) return;
    var next = nextItem;
    Player.open(next, { next: null });
  }

  function seek(delta) {
    var v = el.video;
    if (!v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + delta));
    wake();
    updateScrub();
  }

  function togglePlay() {
    var v = el.video;
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    else v.pause();
    wake();
  }

  function toggleFullscreen() {
    var root = el.root;
    if (!document.fullscreenElement) {
      if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }

  function cycleQuality() {
    if (!qualities.length) { toast("لا توجد جودات بديلة لهذا المصدر"); return; }
    var idx = qualities.findIndex(function (q) { return q.label === activeQuality; });
    var next = qualities[(idx + 1) % qualities.length];
    activeQuality = next.label;
    $("btnQuality").textContent = next.label === "auto" ? "تلقائي" : next.label;
    if (next.url) {
      var at = el.video.currentTime;
      var wasPlaying = !el.video.paused;
      clearStage();
      if (/\.m3u8(\?|#|$)/i.test(next.url)) attachHls(next.url);
      else attachNative(next.url);
      el.video.addEventListener("loadedmetadata", function () { el.video.currentTime = at; if (wasPlaying) el.video.play(); }, { once: true });
    }
    toast("الجودة: " + (next.label === "auto" ? "تلقائي" : next.label));
  }

  function init() {
    el.root = $("player");
    el.stage = $("playerStage");
    el.video = $("video");

    var v = el.video;

    v.addEventListener("timeupdate", function () { if (!scrubbing) updateScrub(); persist(false); });
    v.addEventListener("progress", updateScrub);
    v.addEventListener("pause", function () { setPlayIcon(false); setChromeIdle(false); });
    v.addEventListener("ended", function () {
      persist(true);
      if (nextItem) { show("playerNext", true); $("nextTitle").textContent = nextItem.title; }
      setChromeIdle(false);
    });
    v.addEventListener("error", function () {
      if (!el.root.hidden) fail("تعذّر قراءة المصدر. قد يكون الرابط منتهي الصلاحية أو الترميز غير مدعوم.");
    });
    v.addEventListener("waiting", function () { show("playerSpinner", true); });
    v.addEventListener("canplay", function () { show("playerSpinner", false); });

    $("playerClose").addEventListener("click", function () { Player.close(); });
    $("playerRetry").addEventListener("click", function () { if (current) startPlayback(current); });
    $("playerExternal").addEventListener("click", function () {
      var url = current && (current.stream || (current.youtubeId ? "https://www.youtube.com/watch?v=" + current.youtubeId : ""));
      if (!url) return;
      if (window.AlezzNative && window.AlezzNative.openExternal) window.AlezzNative.openExternal(url);
      else window.open(url, "_blank", "noopener");
    });
    $("btnPlay").addEventListener("click", togglePlay);
    $("playerBigPlay").addEventListener("click", togglePlay);
    $("btnBack10").addEventListener("click", function () { seek(-10); });
    $("btnFwd10").addEventListener("click", function () { seek(10); });
    $("btnFull").addEventListener("click", toggleFullscreen);
    $("btnQuality").addEventListener("click", cycleQuality);
    $("nextPlay").addEventListener("click", playNext);
    $("btnMute").addEventListener("click", function () {
      v.muted = !v.muted;
      $("volWave").style.opacity = v.muted ? ".15" : "1";
    });
    $("volume").addEventListener("input", function (e) {
      v.volume = parseFloat(e.target.value);
      v.muted = v.volume === 0;
    });

    /* scrubbing */
    var scrub = $("scrub");
    function ratioFromEvent(e) {
      var r = scrub.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var ratio = x / r.width;
      /* RTL: the bar is filled from the right */
      return Math.max(0, Math.min(1, 1 - ratio));
    }
    function beginScrub(e) { if (!v.duration) return; scrubbing = true; scrub.setPointerCapture && scrub.setPointerCapture(e.pointerId); applyScrub(e); }
    function applyScrub(e) {
      var ratio = ratioFromEvent(e);
      $("scrubPlayed").style.width = ratio * 100 + "%";
      $("tNow").textContent = fmt(ratio * (v.duration || 0));
      return ratio;
    }
    function endScrub(e) {
      if (!scrubbing) return;
      var ratio = ratioFromEvent(e);
      if (v.duration) v.currentTime = ratio * v.duration;
      scrubbing = false;
      updateScrub();
    }
    scrub.addEventListener("pointerdown", beginScrub);
    scrub.addEventListener("pointermove", function (e) { if (scrubbing) applyScrub(e); });
    scrub.addEventListener("pointerup", endScrub);
    scrub.addEventListener("pointercancel", function () { scrubbing = false; });

    el.root.addEventListener("mousemove", wake);
    el.root.addEventListener("touchstart", wake, { passive: true });

    document.addEventListener("keydown", function (e) {
      if (el.root.hidden) return;
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      switch (e.key) {
        case " ":
        case "k": e.preventDefault(); togglePlay(); break;
        case "ArrowRight": e.preventDefault(); seek(-10); break;
        case "ArrowLeft": e.preventDefault(); seek(10); break;
        case "ArrowUp": e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); $("volume").value = v.volume; break;
        case "ArrowDown": e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); $("volume").value = v.volume; break;
        case "m": v.muted = !v.muted; break;
        case "f": toggleFullscreen(); break;
        case "Escape": Player.close(); break;
        case "n": if (nextItem) playNext(); break;
      }
      wake();
    });

    document.addEventListener("fullscreenchange", function () {
      el.root.classList.toggle("is-fullscreen", !!document.fullscreenElement);
    });

    window.addEventListener("beforeunload", function () { persist(true); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.AlezzPlayer = Player;
})();
