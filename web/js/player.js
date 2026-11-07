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
  var nextHandler = null;
  var nextDismissed = false;
  var autoNextTimer = null;
  var autoNextSeconds = 0;
  var hls = null;
  var hideTimer = null;
  var saveTimer = null;
  var scrubbing = false;
  var qualitySources = [];
  var hlsLevels = [];
  var activeQuality = "auto";
  var activeSourceIndex = 0;
  var activeStreamUrl = "";
  var preferredQuality = "auto";
  var youtubeFrame = null;
  var embedFrame = null;
  var sourceMenuVisible = false;
  var playbackToken = 0;
  var iosSafari = /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var rejectedSources = [], attemptedJsHls = {}, errorHandledToken = -1, usingJsHls = false;
  var fitMode = Store.pref("videoFit", "contain") === "cover" ? "cover" : "contain";

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

  function show(id, on) { var node = el[id] || $(id); if (node) node.hidden = !on; }

  function setChromeIdle(idle) {
    el.root.classList.toggle("is-idle", !!idle);
  }

  function wake() {
    setChromeIdle(false);
    clearTimeout(hideTimer);
    if (!embedFrame && !el.video.paused && !qualityMenuOpen()) {
      hideTimer = setTimeout(function () { if (!qualityMenuOpen()) setChromeIdle(true); }, 3200);
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
    if (!current || !current.key || embedFrame) return;
    var v = el.video;
    if (!v.duration || current.live) return;
    if (!force && Date.now() - (persist._last || 0) < 5000) return;
    persist._last = Date.now();
    Store.saveProgress(current.key, {
      t: v.currentTime, d: v.duration, kind: current.kind, title: current.title,
      poster: current.poster, subtitle: current.subtitle, art: current.art
    });
  }

  function stopAutoNext() {
    if (autoNextTimer) clearInterval(autoNextTimer);
    autoNextTimer = null;
    autoNextSeconds = 0;
  }

  function updateNextPrompt() {
    if (!nextItem || !current || current.live || !el.root || el.root.hidden || nextDismissed || youtubeFrame) return;
    var duration = el.video.duration, remaining = duration - el.video.currentTime;
    if (duration > 0 && isFinite(duration) && remaining <= 90 && remaining >= 0) {
      $("nextContext").textContent = "اقتربت نهاية الحلقة";
      $("nextCountdown").textContent = "متبقي " + fmt(remaining) + " · الانتقال متاح الآن";
      show("playerNext", true);
      setChromeIdle(false);
    } else if (!autoNextTimer) show("playerNext", false);
  }

  function beginAutoNext() {
    if (!nextItem) return;
    stopAutoNext();
    nextDismissed = false;
    autoNextSeconds = 8;
    $("nextContext").textContent = "انتهت الحلقة";
    $("nextCountdown").textContent = "تشغيل تلقائي بعد " + autoNextSeconds + " ثوانٍ";
    $("nextTitle").textContent = nextItem.title;
    show("playerNext", true);
    setChromeIdle(false);
    autoNextTimer = setInterval(function () {
      if (!nextItem || !current || el.root.hidden) { stopAutoNext(); return; }
      autoNextSeconds--;
      if (autoNextSeconds <= 0) { stopAutoNext(); playNext(); return; }
      $("nextCountdown").textContent = "تشغيل تلقائي بعد " + autoNextSeconds + " ثوانٍ";
    }, 1000);
  }

  function clearStage() {
    stopAutoNext();
    playbackToken++;
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (youtubeFrame) { youtubeFrame.remove(); youtubeFrame = null; }
    if (embedFrame) { embedFrame.remove(); embedFrame = null; }
    el.root.classList.remove("is-embed");
    show("playerEmbedExternal", false);
    closeSourceMenu();
    var v = el.video;
    v.pause();
    v.removeAttribute("src");
    v.innerHTML = "";
    try { v.load(); } catch (e) {}
    v.hidden = false;
    usingJsHls = false;
    el.root.classList.remove("needs-user-play");
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


  // iOS Safari blocks unmuted autoplay after hash navigation: this is not a bad source.
  // A visible, trusted tap on the existing player button must always remain available.
  function needsUserGesture() {
    show("playerSpinner", false);
    el.root.classList.add("needs-user-play");
    el.root.classList.remove("is-idle");
    var button = $("playerBigPlay");
    if (button) {
      button.title = "اضغط لتشغيل الفيديو على الآيفون";
      button.setAttribute("aria-label", "اضغط لتشغيل الفيديو");
    }
  }
  function requestPlayback(ticket) {
    if (ticket !== playbackToken) return;
    var result;
    try { result = el.video.play(); }
    catch (err) {
      if (err && err.name === "NotAllowedError") needsUserGesture();
      else if (err && err.name === "NotSupportedError")
        recoverSource("هذا المصدر غير مدعوم من مشغل الآيفون.");
      return;
    }
    if (result && result.catch) result.catch(function (err) {
      if (ticket !== playbackToken || !current || el.root.hidden) return;
      if (err && err.name === "NotAllowedError") needsUserGesture();
      // AbortError is expected when a source changes, not proof that a URL is invalid.
      else if (err && err.name === "NotSupportedError")
        recoverSource("المتصفح لا يدعم ترميز هذا الفيديو.");
    });
  }
  function sourceFailureMessage(code) {
    if (navigator.onLine === false) return "الآيفون غير متصل بالإنترنت.";
    if (code === 2) return "تعذّر اتصال الآيفون بخادم الفيديو؛ قد يكون الرابط محجوبًا أو منتهي الصلاحية.";
    if (code === 3) return "ترميز الفيديو أو الصوت غير مدعوم على الآيفون؛ يلزم H.264/AAC أو بث HLS متوافق.";
    if (code === 4) return "المصدر غير قابل للتشغيل في Safari؛ قد يكون الترميز غير مدعوم أو الخادم لا يرسل ملف فيديو صحيحًا.";
    return "تعذّر تحميل الفيديو من هذا المصدر على الآيفون.";
  }
  function playSelectedSource(url, forceJs) {
    if (!current || el.root.hidden) return;
    if (sourceKind(url)==="youtube") { playYoutube(youtubeSourceId(url), current.title); return; }
    if (sourceKind(url)==="embed") { playEmbed(url); return; }
    activeStreamUrl = url;
    clearStage();
    el.video.controls = iosSafari;
    el.video.disableRemotePlayback=!!current.kids;
    el.video.setAttribute("x-webkit-airplay",current.kids?"deny":"allow");
    if (window.AlezzCast) window.AlezzCast.bind("player",el.video,Object.assign({},current,{stream:url}),{
      cast:"playerCast",airplay:"playerAirPlay",status:"playerCastStatus"
    });
    bindSubtitleTrack(current);
    show("playerSpinner", true);
    var ticket = playbackToken;
    el.video.addEventListener("loadedmetadata", function () {
      if (ticket !== playbackToken || !current) return;
      show("playerSpinner", false);
      var resume = Number(current.resumeAt || 0);
      if (resume > 3 && !current.live) {
        try { el.video.currentTime = resume; current.resumeAt = 0; toast("متابعة من " + fmt(resume)); }
        catch (_e) {}
      }
    }, { once: true });
    if (/\.m3u8([?#]|$)/i.test(url)) {
      attachHls(url, !!forceJs).then(function (ok) {
        if (ticket === playbackToken && !ok) recoverSource(
          "هذا الجهاز لا يدعم طريقة تشغيل HLS الحالية. جرّب مصدر MP4 بترميز H.264/AAC.");
      }).catch(function () {
        if (ticket === playbackToken) recoverSource("تعذّر تهيئة بث HLS.");
      });
    } else attachNative(url);
  }
  function recoverSource(message) {
    if (!current || el.root.hidden || errorHandledToken === playbackToken) return;
    errorHandledToken = playbackToken;
    var failed = activeStreamUrl || current.stream || "";
    if (failed && rejectedSources.indexOf(failed) === -1) rejectedSources.push(failed);
    // An alternative must come from the catalogue; do not create proxy links or bypass restrictions.
    for (var i = 0; i < qualitySources.length; i++) {
      var option = qualitySources[i];
      if (!option || !isPlayableUrl(option.url) || rejectedSources.indexOf(option.url) !== -1) continue;
      activeSourceIndex = i;
      activeQuality = "source:" + i;
      toast("نجرب مصدرًا متاحًا آخر: " + option.label);
      playSelectedSource(option.url, false);
      renderQualityMenu();
      return;
    }
    // On recent iOS releases Hls.js may work if native Safari rejected a HLS playlist.
    // Try it once only, and only for a genuine HLS source.
    if (iosSafari && /\.m3u8([?#]|$)/i.test(failed) && !attemptedJsHls[failed] && !usingJsHls) {
      attemptedJsHls[failed] = true;
      toast("نجرب طريقة تشغيل ثانية لبث HLS على الآيفون.");
      playSelectedSource(failed, true);
      return;
    }
    fail((message || sourceFailureMessage(0)) +
      " إذا استمرت المشكلة، يلزم تحديث رابط المصدر بملف متوافق مع Safari من لوحة الإدارة.");
  }

  function bindSubtitleTrack(item) {
    var btn = $("btnCaptions");
    if (btn) { btn.hidden = !item.subtitleTrack; btn.textContent = "ترجمة عربية"; }
    if (!item.subtitleTrack || !/^https:\/\//i.test(item.subtitleTrack)) return;
    var track = document.createElement("track");
    track.kind = "subtitles";
    track.label = "العربية";
    track.srclang = item.subtitleLanguage || "ar";
    track.src = item.subtitleTrack;
    track.default = true;
    el.video.appendChild(track);
    track.addEventListener("load", function () {
      try { track.track.mode = "showing"; } catch (_e) {}
    });
    track.addEventListener("error", function () {
      if (btn) { btn.textContent = "الترجمة غير متاحة"; btn.disabled = true; }
    });
    if (btn) btn.disabled = false;
  }

  function toggleCaptions() {
    var tracks = el.video.textTracks;
    if (!tracks || !tracks.length) { toast("لا توجد ترجمة متاحة لهذا الفيلم"); return; }
    var on = tracks[0].mode === "showing";
    tracks[0].mode = on ? "disabled" : "showing";
    var btn = $("btnCaptions");
    if (btn) btn.textContent = on ? "إظهار الترجمة" : "إخفاء الترجمة";
  }

  function attachNative(url) {
    var v = el.video;
    usingJsHls = false;
    v.src = url;
    v.load();
    requestPlayback(playbackToken);
  }

  function attachHls(url, forceJs) {
    var v = el.video, ticket = playbackToken;
    // Safari on iOS/iPadOS/macOS supports HLS natively and does not need to
    // download a JavaScript player before the first frame.
    if (!forceJs && (v.canPlayType("application/vnd.apple.mpegurl") ||
        v.canPlayType("application/x-mpegURL"))) {
      attachNative(url);
      return Promise.resolve(true);
    }
    return loadHlsScript().then(function (Hls) {
      if (ticket !== playbackToken) return true; // a newer episode is now playing
      if (!Hls || !Hls.isSupported()) return false;
      usingJsHls = true;
      var attempts = 0;
      var instance = new Hls({
        enableWorker: true, lowLatencyMode: !!(current && current.live),
        backBufferLength: 40, maxBufferLength: 24,
        startLevel: -1
      });
      hls = instance;
      instance.on(Hls.Events.MEDIA_ATTACHED, function () {
        if (ticket === playbackToken && hls === instance) instance.loadSource(url);
      });
      instance.on(Hls.Events.MANIFEST_PARSED, function () {
        if (ticket === playbackToken && hls === instance) {
          updateHlsLevels(instance);
          requestPlayback(ticket);
        }
      });
      instance.on(Hls.Events.ERROR, function (_event, data) {
        if (ticket !== playbackToken || instance !== hls || !data || !data.fatal) return;
        if (attempts++ < 2) {
          try {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { instance.startLoad(); return; }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { instance.recoverMediaError(); return; }
          } catch (e) { /* show a readable error below */ }
        }
        recoverSource(data.type === Hls.ErrorTypes.MEDIA_ERROR
          ? "بث HLS يستخدم ترميزًا غير متوافق مع هذا الجهاز."
          : "خادم HLS لم يوفّر بيانات فيديو قابلة للتشغيل.");
      });
      instance.attachMedia(v);
      return true;
    });
  }

  function playYoutube(id, title) {
    clearStage();
    el.video.hidden = true;
    youtubeFrame = document.createElement("iframe");
    activeStreamUrl="https://www.youtube-nocookie.com/embed/"+id;
    el.root.classList.add("is-embed");
    show("playerEmbedExternal", true);
    youtubeFrame.className="yt-frame alezz-embed-frame";
    youtubeFrame.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms allow-presentation");
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
    el.root.classList.remove("is-idle");
  }

  // Keep embeds restricted to explicitly allowed HTTPS player endpoints.
  // Never scrape or bypass a provider's frame or media restrictions.
  function isEmbedUrl(value) {
    try {
      var u = new URL(String(value || "").trim());
      if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
      var host = u.hostname.toLowerCase(), path = u.pathname;
      return (host === "hanerix.com" && /^\/e\/[a-z0-9_-]+\/?$/i.test(path)) ||
        ((host === "1vid.xyz" || host === "www.1vid.xyz") && /^\/embed-[a-z0-9_-]+\.html$/i.test(path)) ||
        (host === "player.vimeo.com" && /^\/video\/[0-9]+\/?$/.test(path)) ||
        (host === "www.dailymotion.com" && /^\/embed\/video\/[a-z0-9_-]+\/?$/i.test(path)) ||
        (host === "www.youtube-nocookie.com" && /^\/embed\/[a-z0-9_-]{11}\/?$/i.test(path));
    } catch (_e) { return false; }
  }
  function youtubeSourceId(value) {
    try {
      var u=new URL(String(value||"").trim()), host=u.hostname.toLowerCase();
      if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443"))return "";
      var p=u.pathname.split("/").filter(Boolean),id="";
      if(host==="youtu.be"&&p.length===1)id=p[0];
      else if(["youtube.com","www.youtube.com","m.youtube.com","www.youtube-nocookie.com"].indexOf(host)>=0) {
        if(u.pathname==="/watch")id=u.searchParams.get("v")||"";
        else if(p.length===2 && /^(shorts|embed|live)$/.test(p[0]))id=p[1];
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id)?id:"";
    } catch(e){return "";}
  }
  function sourceKind(value) {
    if(youtubeSourceId(value))return "youtube";
    if(isEmbedUrl(value))return "embed";
    try {
      var u=new URL(String(value||"").trim());
      if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443"))return "";
      if(/\.m3u8$/i.test(u.pathname))return "hls";
      if(/\.mp4$/i.test(u.pathname))return "mp4";
    }catch(e){}
    return "";
  }
  function canonicalSource(url){
    var id=youtubeSourceId(url);
    return id?"https://www.youtube-nocookie.com/embed/"+id:String(url||"").trim();
  }
  function sourceTypeLabel(type){
    return {hls:"HLS",mp4:"MP4",embed:"Embed",youtube:"YouTube"}[type]||"فيديو";
  }
  function playEmbed(url) {
    clearStage();
    activeStreamUrl = url;
    if (window.AlezzCast) window.AlezzCast.detach("player");
    el.video.hidden = true;
    el.root.classList.add("is-embed");
    show("playerEmbedExternal", true);
    var frame = document.createElement("iframe");
    embedFrame = frame;
    frame.className = "alezz-embed-frame";
    frame.title = (current && current.title ? current.title : "الفيديو") + " — مشغل مضمّن";
    frame.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");
    frame.src = url;
    frame.addEventListener("load", function () { if (embedFrame === frame) show("playerSpinner", false); });
    el.stage.appendChild(frame);
    show("playerSpinner", true);
    $("playerBadges").innerHTML = '<span class="chip chip--gold">Embed</span>';
    $("playerSubtitle").textContent = "مشغل مضمّن — استخدم أدوات الفيديو داخله";
    $("playerClose").focus();
    setChromeIdle(false);
  }

  function startPlayback(item) {
    $("playerTitle").textContent = item.title || "—";
    $("playerSubtitle").textContent = item.subtitle || "";
    $("playerBadges").innerHTML = buildBadges(item);
    el.root.classList.remove("is-idle");
    configureQualities(item);

    var url = activeStreamUrl || item.stream || (item.youtubeId ?
      "https://www.youtube-nocookie.com/embed/"+item.youtubeId : "");
    if (!url) {
      clearStage();
      if (window.AlezzCast) window.AlezzCast.detach("player");
      fail("لا يوجد رابط تشغيل مسجّل لهذا العنصر."); return;
    }
    if (!isPlayableUrl(url)) {
      clearStage(); fail("نوع الرابط غير مدعوم. استخدم رابط فيديو مباشرًا أو Embed من مصدر معتمد.");
      return;
    }
    if(item.kids && sourceKind(url)!=="mp4" && sourceKind(url)!=="hls"){
      clearStage();fail("هذا المصدر غير متاح في وضع الأطفال.");return;
    }
    playSelectedSource(url, false);
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
      rejectedSources = [];
      attemptedJsHls = {};
      errorHandledToken = -1;
      current = Object.assign({}, item);
      if (options.next) nextItem = options.next; else nextItem = null;
      nextHandler = typeof options.onNext === "function" ? options.onNext : null;
      nextDismissed = false;

      var saved = Store.progress(item.key);
      if (!options.restart && saved && saved.t > 5) current.resumeAt = saved.t;

      el.root.hidden = false;
      document.body.style.overflow = document.body.classList.contains("watch-route") ? "" : "hidden";
      updateFit();
      startPlayback(current);

      show("playerQuickNext", !!nextItem);
      show("youtubeNext", !!(nextItem && current.youtubeId));
      if (nextItem) {
        $("nextTitle").textContent = nextItem.title;
        $("nextContext").textContent = "اقتربت نهاية الحلقة";
        $("nextCountdown").textContent = "الانتقال متاح أثناء المشاهدة";
      }
      show("playerNext", false);
      return true;
    },

    close: function () {
      persist(true);
      if (window.AlezzCast) window.AlezzCast.detach("player");
      if (window.AlezzKids && window.AlezzKids.stop) window.AlezzKids.stop();
      clearStage();
      if ((document.fullscreenElement === el.root || document.webkitFullscreenElement === el.root) && document.exitFullscreen) {
        try { var done = document.exitFullscreen(); if (done && done.catch) done.catch(function () {}); } catch (e) {}
      }
      el.root.classList.remove("is-immersive");
      el.root.hidden = true;
      syncFullscreen();
      document.body.style.overflow = "";
      current = null;
      nextItem = null;
      nextHandler = null;
      nextDismissed = false;
      show("playerQuickNext", false);
      show("youtubeNext", false);
      activeQuality = "auto";
      activeSourceIndex = 0;
      activeStreamUrl = "";
      hlsLevels = [];
      qualitySources = [];
      rejectedSources = [];
      attemptedJsHls = {};
      el.video.controls = false;
      closeQualityMenu();
      closeSourceMenu();
    },

    /* open an episode's series queue */
    queue: function (list, index) {
      Player._queue = { list: list, index: index };
    }
  };

  function playNext() {
    if (!nextItem) return;
    var next = nextItem, advance = nextHandler;
    persist(true);
    stopAutoNext();
    if (advance) advance();
    else Player.open(next, { next: null });
  }

  function seek(delta) {
    if (window.AlezzCast && window.AlezzCast.seekBy(delta)) return;
    var v = el.video;
    if (!v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + delta));
    wake();
    updateScrub();
  }

  function togglePlay() {
    if (embedFrame) { embedFrame.focus(); return; }
    if (window.AlezzCast && window.AlezzCast.playPause()) return;
    var v = el.video;
    if (v.paused) requestPlayback(playbackToken);
    else v.pause();
    wake();
  }

  function updateFit() {
    el.root.classList.toggle("is-cropped", fitMode === "cover");
    el.video.style.objectFit = fitMode;
    var button = $("btnFit");
    if (button) {
      button.textContent = fitMode === "cover" ? "احتواء الصورة" : "ملء الصورة";
      button.title = fitMode === "cover" ? "عرض الصورة دون قص" : "تكبير الصورة مع احتمال قص الأطراف";
      button.setAttribute("aria-pressed", String(fitMode === "cover"));
    }
  }
  function toggleFit() {
    fitMode = fitMode === "contain" ? "cover" : "contain";
    Store.setPref("videoFit", fitMode);
    updateFit();
    wake();
  }
  function syncFullscreen() {
    var full = document.fullscreenElement || document.webkitFullscreenElement;
    var isOn = !!full || el.root.classList.contains("is-immersive");
    el.root.classList.toggle("is-fullscreen", isOn);
    $("btnFull").setAttribute("aria-pressed", String(isOn));
    $("btnFull").title = isOn ? "الخروج من ملء الشاشة" : "ملء الشاشة";
  }
  function fallbackFullscreen() {
    if (!el.video.hidden && el.video.webkitEnterFullscreen) {
      try { el.video.webkitEnterFullscreen(); return; } catch (e) {}
    }
    el.root.classList.toggle("is-immersive");
    syncFullscreen();
    wake();
  }

  function toggleFullscreen() {
    var root = el.root, fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreen) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        try { var stopped = exit.call(document); if (stopped && stopped.catch) stopped.catch(function () {}); }
        catch (e) { syncFullscreen(); }
      }
      return;
    }
    if (root.classList.contains("is-immersive")) {
      root.classList.remove("is-immersive"); syncFullscreen(); return;
    }
    // Safari iPhone uses native video fullscreen rather than document-element fullscreen.
    if (/iPhone|iPod/i.test(navigator.userAgent || "") && !el.video.hidden && el.video.webkitEnterFullscreen) {
      try { el.video.webkitEnterFullscreen(); return; } catch (e) {}
    }
    var enter = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
    if (enter) {
      try {
        var started = enter.call(root);
        if (started && started.catch) started.catch(fallbackFullscreen);
      } catch (e) { fallbackFullscreen(); }
    } else fallbackFullscreen();
    syncFullscreen();
  }

  /* Sources are explicit episode variants; HLS levels come from the live manifest.
     Never invent a quality that the selected stream does not actually advertise. */
  function isPlayableUrl(url) { return !!sourceKind(url); }
  function qualityMenuOpen() {
    var menu = $("playerQualityMenu");
    return !!(menu && !menu.hidden);
  }
  function closeQualityMenu() {
    var menu = $("playerQualityMenu");
    if (menu) menu.hidden = true;
    var button = $("btnQuality");
    if (button) button.setAttribute("aria-expanded", "false");
  }
  function labelForQuality(label) {
    return label === "auto" ? "تلقائي" : label;
  }
  function configureQualities(item) {
    qualitySources = [];
    hlsLevels = [];
    activeQuality = "auto";
    activeSourceIndex = 0;
    activeStreamUrl = "";
    preferredQuality = String(Store.pref("source:"+(item.key||"video"), "auto")||"auto");
    function appendSource(raw,label){
      var type=sourceKind(raw),url=canonicalSource(raw);
      if(!type||(item.kids && type!=="mp4"&&type!=="hls")||qualitySources.length>=9)return;
      if(qualitySources.some(function(s){return s.url===url;}))return;
      qualitySources.push({url:url,label:String(label||sourceTypeLabel(type)).trim().slice(0,36),type:type});
    }
    appendSource(item.stream,item.quality||"الأساسي");
    (Array.isArray(item.variants)?item.variants:[]).forEach(function(entry){
      if(entry)appendSource(entry.url||entry.stream_url,entry.label||entry.quality);
    });
    if(item.youtubeId)appendSource("https://www.youtube-nocookie.com/embed/"+item.youtubeId,"YouTube");
    if(qualitySources.length)activeStreamUrl=qualitySources[0].url;
    if (qualitySources.length && preferredQuality !== "auto") {
      for (var i = 0; i < qualitySources.length; i++) {
        if (qualitySources[i].label.toLowerCase() === preferredQuality.toLowerCase()) {
          activeSourceIndex = i;
          activeQuality = "source:" + i;
          activeStreamUrl = qualitySources[i].url;
          break;
        }
      }
    }
    closeQualityMenu();
    renderQualityMenu();
  }
  function qualityOptions() {
    var out = [{ id: "auto", label: "تلقائي", hint: "أفضل جودة حسب الاتصال" }];
    qualitySources.forEach(function (src, i) {
      // A source whose URL has already appeared is de-duplicated in configureQualities.
      out.push({ id: "source:" + i, label: src.label, hint: sourceTypeLabel(src.type) });
    });
    hlsLevels.forEach(function (level) {
      out.push({ id: "level:" + level.index, label: level.label, hint: "جودة HLS" });
    });
    return out;
  }
  function activeQualityLabel() {
    if (activeQuality.indexOf("source:") === 0) {
      var src = qualitySources[activeSourceIndex];
      return src ? src.label : "تلقائي";
    }
    if (activeQuality.indexOf("level:") === 0) {
      var match = hlsLevels.filter(function (level) {
        return "level:" + level.index === activeQuality;
      })[0];
      return match ? match.label : "تلقائي";
    }
    return "تلقائي";
  }
  function renderQualityMenu() {
    var menu = $("playerQualityMenu");
    var button = $("btnQuality");
    if (!menu || !button) return;
    var options = qualityOptions();
    menu.innerHTML = "";
    options.forEach(function (option) {
      var row = document.createElement("button");
      var selected = option.id === activeQuality;
      row.type = "button";
      row.className = "player__quality-option" + (selected ? " is-selected" : "");
      row.setAttribute("role", "menuitemradio");
      row.setAttribute("aria-checked", selected ? "true" : "false");
      var label = document.createElement("span");
      label.textContent = option.label;
      var hint = document.createElement("small");
      hint.textContent = option.hint;
      row.appendChild(label);
      row.appendChild(hint);
      row.addEventListener("click", function () { selectQuality(option.id); });
      menu.appendChild(row);
    });
    button.textContent = "الجودة: " + activeQualityLabel();
    button.disabled = !current || options.length < 2;
    renderSourcesMenu();
    button.setAttribute("aria-label", "تحديد جودة الفيديو. " + activeQualityLabel());
    renderSourcesMenu();
  }
  function closeSourceMenu(){
    sourceMenuVisible=false;
    var menu=$("playerSourcesMenu"),button=$("playerSourcesToggle");
    if(menu)menu.hidden=true;
    if(button)button.setAttribute("aria-expanded","false");
  }
  function renderSourcesMenu(){
    var menu=$("playerSourcesMenu"),button=$("playerSourcesToggle");
    if(!menu||!button)return;
    button.hidden=qualitySources.length<2;
    menu.innerHTML="";
    var active=qualitySources[activeSourceIndex];
    button.textContent="المصادر ("+qualitySources.length+") · "+(active?active.label:"");
    qualitySources.forEach(function(src,i){
      var opt=document.createElement("button");
      opt.type="button";
      opt.className="player__sources-option"+(activeSourceIndex===i?" is-selected":"");
      opt.setAttribute("role","menuitemradio");
      opt.setAttribute("aria-checked",String(activeSourceIndex===i));
      opt.textContent=src.label+" · "+sourceTypeLabel(src.type);
      opt.addEventListener("click",function(){
        selectQuality("source:"+i);closeSourceMenu();button.focus();
      });
      menu.appendChild(opt);
    });
  }
  function toggleSourceMenu(){
    if(qualitySources.length<2)return;
    sourceMenuVisible=!sourceMenuVisible;
    $("playerSourcesMenu").hidden=!sourceMenuVisible;
    $("playerSourcesToggle").setAttribute("aria-expanded",String(sourceMenuVisible));
    if(sourceMenuVisible){
      var active=$("playerSourcesMenu").querySelector(".is-selected");
      if(active)active.focus();
    }
  }
  function switchQualitySource(url) {
    if (!isPlayableUrl(url)) { toast("رابط الجودة غير صالح", "err"); return; }
    if (embedFrame || youtubeFrame || (sourceKind(url)!=="mp4" && sourceKind(url)!=="hls")) {
      playSelectedSource(url, false); return;
    }
    var position = el.video.currentTime || 0;
    var playing = !el.video.paused;
    activeStreamUrl = url;
    // Save the position before swapping, then let the common path reset the video once.
    el.video.addEventListener("loadedmetadata", function () {
      if (position > 1 && isFinite(el.video.duration) && position < el.video.duration) {
        try { el.video.currentTime = position; } catch (e) {}
      }
      if (playing && el.video.paused) {
        var p = el.video.play();
        if (p && p.catch) p.catch(function () {});
      } else if (!playing) el.video.pause();
    }, { once: true });
    hlsLevels = [];
    // Changing a source must also use Safari's native controls and the new HLS lifecycle.
    playSelectedSource(url, false);
  }
  function selectQuality(id) {
    if (!current) return;
    closeQualityMenu();
    if (id === "auto") {
      activeQuality = "auto";
      preferredQuality = "auto";
      Store.setPref("source:"+current.key, "auto");
      if (activeSourceIndex !== 0 && qualitySources[0]) {
        activeSourceIndex = 0;
        switchQualitySource(qualitySources[0].url);
      } else if (hls) {
        hls.currentLevel = -1;
      }
    } else if (id.indexOf("source:") === 0) {
      var index = Number(id.slice(7));
      if (!qualitySources[index]) return;
      activeQuality = id;
      preferredQuality = qualitySources[index].label;
      Store.setPref("source:"+current.key, preferredQuality);
      if (activeSourceIndex !== index) {
        activeSourceIndex = index;
        switchQualitySource(qualitySources[index].url);
      } else if (hls) hls.currentLevel = -1;
    } else if (id.indexOf("level:") === 0 && hls) {
      var levelIndex = Number(id.slice(6));
      var chosen = hlsLevels.filter(function (q) { return q.index === levelIndex; })[0];
      if (!chosen) return;
      activeQuality = id;
      preferredQuality = chosen.label;
      Store.setPref("preferredPlaybackQuality", preferredQuality);
      hls.currentLevel = levelIndex;
    } else return;
    renderQualityMenu();
    toast("المصدر: " + activeQualityLabel());
    wake();
  }
  function updateHlsLevels(instance) {
    if (instance !== hls || !current) return;
    var seen = {};
    hlsLevels = [];
    (instance.levels || []).forEach(function (level, index) {
      var label = level.height ? level.height + "p" :
        level.bitrate ? (Math.round(level.bitrate / 100000) / 10) + " Mbps" : "مستوى " + (index + 1);
      if (seen[label]) label += " (" + (index + 1) + ")";
      seen[label] = true;
      hlsLevels.push({ index: index, label: label, height: level.height || 0 });
    });
    hlsLevels.sort(function (a, b) { return b.height - a.height || a.index - b.index; });
    if (activeQuality === "auto" && preferredQuality !== "auto") {
      var match = hlsLevels.filter(function (q) {
        return q.label.toLowerCase() === preferredQuality.toLowerCase();
      })[0];
      if (match) {
        activeQuality = "level:" + match.index;
        instance.currentLevel = match.index;
      }
    }
    renderQualityMenu();
  }
  function toggleQualityMenu() {
    var menu = $("playerQualityMenu");
    if (!menu || $("btnQuality").disabled) return;
    var open = menu.hidden;
    menu.hidden = !open;
    $("btnQuality").setAttribute("aria-expanded", open ? "true" : "false");
    wake();
    if (open) {
      var selected = menu.querySelector(".is-selected");
      if (selected) selected.focus();
    }
  }

  function init() {
    el.root = $("player");
    el.stage = $("playerStage");
    el.video = $("video");

    var v = el.video;

    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("x-webkit-airplay", "allow");
    v.addEventListener("timeupdate", function () { if (!scrubbing) updateScrub(); persist(false); updateNextPrompt(); });
    v.addEventListener("playing", function () {
      show("playerSpinner", false);
      el.root.classList.remove("needs-user-play");
      setPlayIcon(true);
      wake();
    });
    v.addEventListener("progress", updateScrub);
    v.addEventListener("pause", function () { setPlayIcon(false); setChromeIdle(false); });
    v.addEventListener("ended", function () {
      persist(true);
      if (nextItem) beginAutoNext();
      setChromeIdle(false);
    });
    v.addEventListener("error", function () {
      if (el.root.hidden || !current || !v.error || v.error.code === 1) return;
      // On iOS, removing an old src + video.load() can dispatch an asynchronous
      // MEDIA_ERR_SRC_NOT_SUPPORTED. Recheck after the active source settles.
      var ticket = playbackToken, attemptedUrl = activeStreamUrl || current.stream || "";
      setTimeout(function () {
        if (ticket !== playbackToken || !current || el.root.hidden || !v.error) return;
        if (!usingJsHls && (!attemptedUrl || v.getAttribute("src") !== attemptedUrl)) return;
        if (v.readyState >= 2) return;
        var code = v.error.code;
        try {
          console.warn("[Al Ezz TV] Safari playback:", {item: current.key, mediaCode: code,
            sourceHost: new URL(attemptedUrl).hostname, ios: iosSafari});
        } catch (_e) {}
        recoverSource(sourceFailureMessage(code));
      }, 120);
    });
    v.addEventListener("waiting", function () { show("playerSpinner", true); });
    v.addEventListener("canplay", function () { show("playerSpinner", false); });
    setInterval(function () {
      if (window.AlezzKids && window.AlezzKids.tick) {
        window.AlezzKids.tick(!el.root.hidden && !v.paused && !v.ended && v.readyState >= 2);
      }
    }, 1000);

    $("playerClose").addEventListener("click", function () {
      if (document.body.classList.contains("watch-route") && window.Alezz && window.Alezz.leaveWatch) window.Alezz.leaveWatch();
      else Player.close();
    });
    $("playerRetry").addEventListener("click", function () {
      if (!current) return;
      rejectedSources = [];
      attemptedJsHls = {};
      errorHandledToken = -1;
      startPlayback(current);
    });
    $("playerEmbedExternal").addEventListener("click", function () {
      if ((embedFrame || youtubeFrame) && activeStreamUrl && isPlayableUrl(activeStreamUrl))
        window.open(activeStreamUrl, "_blank", "noopener,noreferrer");
    });
    $("playerExternal").addEventListener("click", function () {
      var url = current && (activeStreamUrl || current.stream || (current.youtubeId ? "https://www.youtube.com/watch?v=" + current.youtubeId : ""));
      if (!url) return;
      if (window.AlezzNative && window.AlezzNative.openExternal) window.AlezzNative.openExternal(url);
      else window.open(url, "_blank", "noopener");
    });
    $("btnPlay").addEventListener("click", togglePlay);
    $("playerBigPlay").addEventListener("click", togglePlay);
    $("btnBack10").addEventListener("click", function () { seek(-10); });
    $("btnFwd10").addEventListener("click", function () { seek(10); });
    $("btnFull").addEventListener("click", toggleFullscreen);
    $("btnFit").addEventListener("click", toggleFit);
    $("btnQuality").addEventListener("click", toggleQualityMenu);
    if($("playerSourcesToggle"))$("playerSourcesToggle").addEventListener("click",toggleSourceMenu);
    document.addEventListener("click", function (event) {
      if (qualityMenuOpen() && !event.target.closest(".player__quality-wrap")) closeQualityMenu();
      if(sourceMenuVisible && !event.target.closest(".player__sources-wrap"))closeSourceMenu();
    });
    $("btnCaptions").addEventListener("click", toggleCaptions);
    $("nextPlay").addEventListener("click", playNext);
    $("playerQuickNext").addEventListener("click", playNext);
    $("youtubeNext").addEventListener("click", playNext);
    $("nextDismiss").addEventListener("click", function () {
      stopAutoNext();
      nextDismissed = true;
      show("playerNext", false);
      wake();
    });
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

    el.stage.addEventListener("dblclick", function (event) {
      if (event.target === v || event.target === el.stage || event.target.id === "playerVeil") toggleFullscreen();
    });
    el.root.addEventListener("mousemove", wake);
    el.root.addEventListener("touchstart", wake, { passive: true });

    document.addEventListener("keydown", function (e) {
      if (el.root.hidden) return;
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if(sourceMenuVisible){
        if(e.key==="Escape"||e.key==="Backspace"){
          e.preventDefault();closeSourceMenu();$("playerSourcesToggle").focus();return;
        }
        if(e.key==="ArrowUp"||e.key==="ArrowDown"){
          e.preventDefault();
          var options=Array.prototype.slice.call($("playerSourcesMenu").querySelectorAll("button"));
          var i=options.indexOf(document.activeElement),d=e.key==="ArrowDown"?1:-1;
          if(options.length)options[(i+d+options.length)%options.length].focus();
          return;
        }
        if(e.key==="Enter"||e.key===" ")return;
      }
      if((embedFrame||youtubeFrame) && e.key!=="Escape" && e.key!=="Backspace" && e.key!=="f")return;
      if (qualityMenuOpen()) {
        if (e.key === "Escape" || e.key === "Backspace") {
          e.preventDefault(); closeQualityMenu(); $("btnQuality").focus(); return;
        }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          var options = Array.prototype.slice.call($("playerQualityMenu").querySelectorAll("button"));
          var selected = options.indexOf(document.activeElement);
          var direction = e.key === "ArrowDown" ? 1 : -1;
          if (options.length) options[(selected + direction + options.length) % options.length].focus();
          return;
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") return;
      }
      switch (e.key) {
        case " ":
        case "k": e.preventDefault(); togglePlay(); break;
        case "ArrowRight": e.preventDefault(); seek(-10); break;
        case "ArrowLeft": e.preventDefault(); seek(10); break;
        case "ArrowUp": e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); $("volume").value = v.volume; break;
        case "ArrowDown": e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); $("volume").value = v.volume; break;
        case "m": v.muted = !v.muted; break;
        case "c": toggleCaptions(); break;
        case "f": toggleFullscreen(); break;
        case "z": toggleFit(); break;
        case "Backspace":
        case "Escape":
          if (document.body.classList.contains("watch-route") && window.Alezz && window.Alezz.leaveWatch) window.Alezz.leaveWatch();
          else Player.close();
          e.stopImmediatePropagation();
          break;
        case "n": if (nextItem) playNext(); break;
      }
      wake();
    });

    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);
    v.addEventListener("webkitbeginfullscreen", syncFullscreen);
    v.addEventListener("webkitendfullscreen", syncFullscreen);
    updateFit();

    window.addEventListener("beforeunload", function () { persist(true); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.AlezzPlayer = Player;
})();
