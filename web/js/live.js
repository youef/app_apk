/* AL EZZ TV — dedicated live television page, browser-safe and RTL. */
(function () {
  "use strict";
  var state = {
    channels: [], shown: [], current: null, search: "", category: "",
    hls: null, dash: null, frame: null, request: 0, timeout: null, mounted: false,
    hlsRecoveries: 0
  };

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function https(url) {
    return /^https:\/\//i.test(String(url || "")) ? String(url).trim() : "";
  }
  function mediaType(url) {
    var path = (https(url).split(/[?#]/)[0] || "").toLowerCase();
    if (/\.m3u8$/.test(path)) return "hls";
    if (/\.mpd$/.test(path)) return "dash";
    if (/\.(mp4|m4v|mov|webm|mkv|ts)$/.test(path)) return "video";
    return "";
  }
  function icon(name) {
    var shapes = {
      play: '<path d="M8 5.5v13l11-6.5z"/>',
      refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a8 8 0 0 1 14-2M19 15A8 8 0 0 1 5 17"/>',
      expand: '<path d="M4 10V4h6M20 14v6h-6M20 10V4h-6M4 14v6h6"/>',
      volume: '<path d="M5 9h4l5-4v14l-5-4H5zM18 9a5 5 0 0 1 0 6"/>',
      arrow: '<path d="m9 6 6 6-6 6"/>',
      external: '<path d="M13 4h7v7M20 4l-9 9M18 14v5H5V6h5"/>',
      search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
      tv: '<rect x="3" y="5" width="18" height="13" rx="3"/><path d="M8 21h8"/>'
    };
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      (shapes[name] || shapes.play) + '</svg>';
  }
  function isOfficial(channel) { return channel.playback === "official_link" && !!https(channel.official); }
  function playable(channel) {
    if (!channel) return false;
    if (isOfficial(channel)) return true;
    if (channel.youtubeId && channel.playback === "youtube_embed") return true;
    return !!(https(channel.stream) && mediaType(channel.stream));
  }
  function stateText(message, error) {
    var node = $("liveStatus");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", !!error);
  }
  function poster(channel) {
    if (!channel || !https(channel.poster)) return '<span class="live-emblem">' + icon("tv") + '</span>';
    return '<img src="' + esc(channel.poster) + '" alt="" loading="lazy" onerror="this.remove()">';
  }
  function channelKind(channel) {
    return isOfficial(channel) ? "موقع الناشر" : !playable(channel) ? "رابط غير مدعوم" : "بث مباشر";
  }
  function row(channel, index) {
    var on = state.current && channel.key === state.current.key;
    return '<button type="button" class="live-guide__item' + (on ? " is-selected" : "") +
      '" data-live-key="' + esc(channel.key) + '" aria-pressed="' + (on ? "true" : "false") +
      '" title="' + esc(channel.title) + '">' +
      '<span class="live-guide__number">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<span class="live-guide__thumb">' + poster(channel) + '</span>' +
      '<span class="live-guide__copy"><strong>' + esc(channel.title) + '</strong><small>' +
      esc(channel.category || channelKind(channel)) + '</small></span>' +
      '<span class="live-guide__indicator">' + (isOfficial(channel) ? icon("external") : '<i></i>') + '</span></button>';
  }
  function sortedChannels() {
    return state.channels.filter(function (c) {
      if (state.category && c.categoryId !== state.category) return false;
      var query = state.search.trim().toLocaleLowerCase();
      return !query || (c.title + " " + c.category + " " + (c.country || "")).toLocaleLowerCase().indexOf(query) !== -1;
    });
  }
  function updateGuide() {
    var list = $("liveGuideItems"), count = $("liveFilteredCount");
    if (!list) return;
    state.shown = sortedChannels();
    list.innerHTML = state.shown.length ? state.shown.map(row).join("") :
      '<p class="live-guide__empty">لم نعثر على قنوات تطابق البحث. غيّر التصنيف أو جرّب اسمًا آخر.</p>';
    if (count) count.textContent = state.shown.length + " قناة";
    var label = $("liveSearchClear");
    if (label) label.hidden = !state.search;
  }
  function displaySelection(channel) {
    var title = $("liveCurrentTitle"), desc = $("liveCurrentDesc"), art = $("livePoster");
    if (!title || !channel) return;
    title.textContent = channel.title;
    desc.textContent = (channel.category || "قناة تلفزيونية") + " • " + channelKind(channel);
    art.innerHTML = poster(channel);
    art.hidden = false;
    var external = $("liveOfficial");
    external.hidden = !(isOfficial(channel) || https(channel.stream));
    external.href = isOfficial(channel) ? https(channel.official) : https(channel.stream) || "#";
    external.textContent = isOfficial(channel) ? "فتح موقع الناشر" : "فتح رابط البث";
    $("liveStart").textContent = isOfficial(channel) ? "زيارة البث الرسمي" : "تشغيل الآن";
    var direct = !isOfficial(channel);
    $("liveRetry").disabled = !direct;
    $("liveMute").disabled = !direct;
    $("liveGoLive").disabled = !direct;
    var badges = $("liveFormat");
    badges.textContent = isOfficial(channel) ? "رابط رسمي" :
      channel.playback === "youtube_embed" ? "YouTube" : mediaType(channel.stream).toUpperCase() || "غير معروف";
  }

  function stopStream() {
    state.request++;
    clearTimeout(state.timeout); state.timeout = null;
    if (state.hls) { try { state.hls.destroy(); } catch (e) {} state.hls = null; }
    if (state.dash) { try { state.dash.reset(); } catch (e) {} state.dash = null; }
    if (state.frame) { state.frame.remove(); state.frame = null; }
    var video = $("liveVideo");
    if (video) {
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
      video.hidden = false;
    }
    state.hlsRecoveries = 0;
  }
  function error(message) {
    clearTimeout(state.timeout);
    stateText(message, true);
    var stage = $("liveStage");
    if (stage) stage.classList.remove("is-loading", "is-playing");
    if ($("livePoster")) $("livePoster").hidden = false;
    if ($("liveStart")) $("liveStart").hidden = false;
  }
  function requestPlay(video, ticket) {
    if (ticket !== state.request) return;
    var p;
    try { p = video.play(); }
    catch (e) { stateText("اضغط زر التشغيل لبدء البث.", false); return; }
    if (p && p.catch) p.catch(function () {
      if (ticket === state.request) stateText("المتصفح منع التشغيل التلقائي. اضغط تشغيل في الفيديو.", false);
    });
  }
  function useScript(src, globalName, timeout) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (useScript[globalName]) return useScript[globalName];
    useScript[globalName] = new Promise(function (resolve) {
      var finished = false, script = document.createElement("script");
      var timer = setTimeout(function () { done(null); }, timeout || 10000);
      function done(lib) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(lib);
        if (!lib) useScript[globalName] = null;
      }
      script.src = src; script.async = true;
      script.onload = function () { done(window[globalName] || null); };
      script.onerror = function () { done(null); };
      document.head.appendChild(script);
    });
    return useScript[globalName];
  }
  function startVideo(channel) {
    stopStream();
    var ticket = state.request, video = $("liveVideo"), stage = $("liveStage");
    if (!video || !stage) return;
    stage.classList.add("is-loading");
    stage.classList.remove("is-playing");
    $("liveStart").hidden = true;
    $("livePoster").hidden = false;
    stateText("جارٍ الاتصال بمصدر القناة…", false);
    var url = https(channel.stream), type = mediaType(url);
    if (!url || !type) { error("لا يوجد رابط فيديو مباشر صالح لهذه القناة. افتح المصدر الرسمي إن توفر."); return; }
    state.timeout = setTimeout(function () {
      if (ticket === state.request && stage && !stage.classList.contains("is-playing"))
        error("تأخر بدء البث. قد يكون المصدر محجوبًا، أو غير متاح في بلدك، أو يمنع التشغيل عبر المتصفح.");
    }, 22000);
    if (type === "hls") {
      // Safari/iOS has native HLS support; use it first instead of requiring a CDN.
      if (video.canPlayType("application/vnd.apple.mpegurl") ||
          video.canPlayType("application/x-mpegURL")) {
        video.src = url; video.load(); requestPlay(video, ticket); return;
      }
      useScript("https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js", "Hls", 12000)
        .then(function (Hls) {
          if (ticket !== state.request) return;
          if (!Hls || !Hls.isSupported()) { error("هذا المتصفح لا يدعم HLS أو تعذّر تحميل مكتبة التشغيل. جرّب متصفحًا حديثًا."); return; }
          var hls = state.hls = new Hls({
            enableWorker: true, lowLatencyMode: true, backBufferLength: 30,
            maxBufferLength: 20, liveSyncDurationCount: 3
          });
          hls.on(Hls.Events.MEDIA_ATTACHED, function () { if (ticket === state.request) hls.loadSource(url); });
          hls.on(Hls.Events.MANIFEST_PARSED, function () { requestPlay(video, ticket); });
          hls.on(Hls.Events.ERROR, function (_event, detail) {
            if (ticket !== state.request || !detail || !detail.fatal) return;
            if (state.hlsRecoveries < 1 && detail.type === Hls.ErrorTypes.NETWORK_ERROR) {
              state.hlsRecoveries++; try { hls.startLoad(); return; } catch (e) {}
            }
            if (state.hlsRecoveries < 1 && detail.type === Hls.ErrorTypes.MEDIA_ERROR) {
              state.hlsRecoveries++; try { hls.recoverMediaError(); return; } catch (e) {}
            }
            error("فشل تشغيل بث HLS من المصدر. قد يكون الرابط متوقفًا أو محميًا أو يمنع CORS. جرّب قناة أخرى.");
          });
          hls.attachMedia(video);
        }).catch(function () { if (ticket === state.request) error("تعذّر تشغيل HLS في هذا المتصفح."); });
      return;
    }
    if (type === "dash") {
      useScript("https://cdn.dashjs.org/v4.7.4/dash.all.min.js", "dashjs", 12000)
        .then(function (dashjs) {
          if (ticket !== state.request) return;
          if (!dashjs || !dashjs.MediaPlayer) { error("تعذّر تحميل مشغّل DASH لهذا الجهاز."); return; }
          state.dash = dashjs.MediaPlayer().create();
          state.dash.initialize(video, url, true);
        }).catch(function () { if (ticket === state.request) error("تعذّر تشغيل DASH."); });
      return;
    }
    video.src = url; video.load(); requestPlay(video, ticket);
  }
  function select(channel, autoplay) {
    if (!channel) return;
    var same = state.current && state.current.key === channel.key;
    if (!same || autoplay) stopStream();
    state.current = channel;
    displaySelection(channel);
    updateGuide();
    if (isOfficial(channel)) {
      stateText("هذه القناة تُشاهد عبر موقع الناشر. لا يمكن تشغيل صفحة ويب كرابط فيديو.", false);
      if (autoplay) window.open(https(channel.official), "_blank", "noopener,noreferrer");
      return;
    }
    if (channel.playback === "youtube_embed" && channel.youtubeId) {
      if (!autoplay) { stateText("اضغط تشغيل لعرض الفيديو المضمّن.", false); return; }
      stopStream();
      var video = $("liveVideo");
      if (video) video.hidden = true;
      var iframe = document.createElement("iframe");
      iframe.className = "live-youtube-frame";
      iframe.title = channel.title;
      iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(channel.youtubeId) + "?autoplay=1&playsinline=1&rel=0";
      $("liveStage").appendChild(iframe);
      state.frame = iframe;
      $("livePoster").hidden = true;
      $("liveStart").hidden = true;
      stateText("تشغيل عبر تضمين يوتيوب الرسمي.", false);
      return;
    }
    if (!playable(channel)) { error("القناة محفوظة لكن رابطها غير متوافق مع مشغّل الويب."); return; }
    if (autoplay) startVideo(channel);
    else stateText("اختر تشغيل الآن لبدء البث.", false);
  }
  function navigate(direction) {
    var list = state.shown.length ? state.shown : state.channels;
    if (!list.length) return;
    var at = -1;
    for (var i = 0; i < list.length; i++) if (state.current && list[i].key === state.current.key) { at = i; break; }
    select(list[(at + direction + list.length) % list.length], true);
  }
  function mount() {
    if (!$("livePage")) return;
    state.mounted = true;
    updateGuide();
    var first = null;
    for (var i = 0; i < state.shown.length; i++) {
      if (!isOfficial(state.shown[i]) && playable(state.shown[i])) { first = state.shown[i]; break; }
    }
    first = first || state.shown[0];
    if (first) select(first, false);
    else stateText("لا توجد قنوات منشورة مطابقة للبحث حاليًا.", true);
    $("liveGuideItems").addEventListener("click", function (event) {
      var button = event.target.closest("[data-live-key]");
      if (!button) return;
      var key = button.getAttribute("data-live-key");
      var item = null;
      for (var i = 0; i < state.channels.length; i++) {
        if (state.channels[i].key === key) { item = state.channels[i]; break; }
      }
      select(item, true);
    });
    $("liveSearch").addEventListener("input", function (event) {
      state.search = event.target.value; updateGuide();
    });
    $("liveSearchClear").addEventListener("click", function () {
      state.search = ""; $("liveSearch").value = ""; updateGuide(); $("liveSearch").focus();
    });
    $("liveCategories").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-live-category]");
      if (!btn) return;
      state.category = btn.getAttribute("data-live-category");
      Array.prototype.forEach.call($("liveCategories").querySelectorAll("[data-live-category]"), function (item) {
        var active = item === btn; item.classList.toggle("is-on", active);
        item.setAttribute("aria-pressed", String(active));
      });
      updateGuide();
    });
    $("liveStart").addEventListener("click", function () { if (state.current) select(state.current, true); });
    $("liveRetry").addEventListener("click", function () { if (state.current) select(state.current, true); });
    $("livePrev").addEventListener("click", function () { navigate(-1); });
    $("liveNext").addEventListener("click", function () { navigate(1); });
    $("liveFullscreen").addEventListener("click", function () {
      var stage = $("liveStage");
      if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
      else if (stage.requestFullscreen) {
        var p = stage.requestFullscreen(); if (p && p.catch) p.catch(function () {});
      } else if ($("liveVideo") && $("liveVideo").webkitEnterFullscreen) $("liveVideo").webkitEnterFullscreen();
    });
    $("liveMute").addEventListener("click", function () {
      var video = $("liveVideo"); video.muted = !video.muted;
      $("liveMute").setAttribute("aria-pressed", String(video.muted));
      $("liveMute").title = video.muted ? "إلغاء كتم الصوت" : "كتم الصوت";
    });
    $("liveGoLive").addEventListener("click", function () {
      var video = $("liveVideo");
      try { if (video.seekable.length) video.currentTime = Math.max(0, video.seekable.end(video.seekable.length - 1) - 1); } catch (e) {}
    });
    $("liveRefresh").addEventListener("click", function () { if (window.Alezz) window.Alezz.reload(); });
    var video = $("liveVideo");
    video.addEventListener("playing", function () {
      if (!state.mounted) return;
      clearTimeout(state.timeout);
      $("liveStage").classList.remove("is-loading");
      $("liveStage").classList.add("is-playing");
      $("livePoster").hidden = true;
      $("liveStart").hidden = true;
      stateText("البث يعمل الآن • LIVE", false);
    });
    video.addEventListener("waiting", function () {
      if (state.mounted && state.current) stateText("جارٍ إعادة تخزين البث…", false);
    });
    video.addEventListener("error", function () {
      if (!state.mounted || !state.current || !https(state.current.stream)) return;
      error("المتصفح تعذّر عليه قراءة الفيديو. قد يكون رابط البث منتهيًا أو الترميز غير مدعوم.");
    });
    state.keydown = function (event) {
      if (!state.mounted || !state.current || !document.getElementById("livePage")) return;
      var target = event.target;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      var rowButton = target && target.closest && target.closest("#liveGuideItems [data-live-key]");
      if (rowButton && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        var guideRows = Array.prototype.slice.call($("liveGuideItems").querySelectorAll("[data-live-key]"));
        var rowIndex = guideRows.indexOf(rowButton);
        var next = guideRows[rowIndex + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) { next.focus(); next.scrollIntoView({ block: "nearest" }); }
        return;
      }
      if (event.altKey && event.key === "ArrowUp") { event.preventDefault(); navigate(-1); }
      if (event.altKey && event.key === "ArrowDown") { event.preventDefault(); navigate(1); }
      if (event.key === "PageUp" || event.key === "ChannelUp") { event.preventDefault(); navigate(-1); }
      if (event.key === "PageDown" || event.key === "ChannelDown") { event.preventDefault(); navigate(1); }
    };
    document.addEventListener("keydown", state.keydown);
  }
  function destroy() {
    if (!state.mounted) return;
    state.mounted = false;
    stopStream();
    if (state.keydown) document.removeEventListener("keydown", state.keydown);
    state.keydown = null;
  }
  function render(catalog, initialCategory) {
    state.channels = (catalog && catalog.channels) || [];
    state.search = "";
    state.category = initialCategory || "";
    state.shown = [];
    state.current = null;
    var count = state.channels.length;
    var categories = ((catalog && catalog.categories) || []).filter(function (c) {
      return state.channels.some(function (x) { return x.categoryId === c.id; });
    });
    var categoryButtons = '<button class="live-chip' + (!state.category ? ' is-on' : '') +
      '" data-live-category="" aria-pressed="' + (!state.category ? "true" : "false") + '">كل القنوات</button>' +
      categories.map(function (c) {
        return '<button class="live-chip' + (state.category === c.id ? ' is-on' : '') +
          '" data-live-category="' + esc(c.id) + '" aria-pressed="' +
          (state.category === c.id ? "true" : "false") + '">' + esc(c.name_ar) + '</button>';
      }).join("");
    return '<section class="live-page" id="livePage" aria-label="البث المباشر">' +
      '<div class="live-heading"><div><span class="live-eyebrow"><i></i> AL EZZ TV · LIVE STATION</span>' +
      '<h1>البث المباشر <em>على شاشتك</em></h1>' +
      '<p>شغّل القنوات داخل الموقع، وتصفح الدليل، وانتقل بين المحطات دون مغادرة الصفحة.</p></div>' +
      '<div class="live-heading__actions"><span class="live-total">' + count + ' قناة في الدليل</span>' +
      '<button type="button" class="live-outline" id="liveRefresh">' + icon("refresh") + ' تحديث القنوات</button></div></div>' +
      '<div class="live-layout"><div class="live-viewer">' +
      '<div class="live-stage" id="liveStage">' +
      '<video id="liveVideo" controls playsinline webkit-playsinline preload="none" aria-label="مشغل البث المباشر"></video>' +
      '<div class="live-poster" id="livePoster"><span class="live-poster__glow"></span><span class="live-emblem">' +
        icon("tv") + '</span><span class="live-poster__text">AL EZZ <b>LIVE</b></span></div>' +
      '<span class="live-stage__badge"><i></i> LIVE</span>' +
      '<button id="liveStart" class="live-start" type="button">' + icon("play") + '<span>تشغيل الآن</span></button></div>' +
      '<div class="live-now"><span class="live-now__pulse"></span><div class="live-now__copy">' +
      '<small>تشاهد الآن</small><h2 id="liveCurrentTitle">اختر قناة من الدليل</h2>' +
      '<p id="liveCurrentDesc">اضغط على إحدى القنوات للبدء</p></div><span class="live-format" id="liveFormat">LIVE</span></div>' +
      '<div class="live-status" id="liveStatus" role="status" aria-live="polite">اختر القناة التي تريد مشاهدتها.</div>' +
      '<div class="live-toolbar">' +
      '<button id="livePrev" type="button" class="live-control">' + icon("arrow") + ' السابقة</button>' +
      '<button id="liveNext" type="button" class="live-control">التالية ' + icon("arrow") + '</button>' +
      '<button id="liveRetry" type="button" class="live-control">' + icon("refresh") + ' إعادة الاتصال</button>' +
      '<button id="liveGoLive" type="button" class="live-control">● الآن</button>' +
      '<button id="liveMute" type="button" class="live-control live-control--icon" aria-pressed="false" title="كتم الصوت">' + icon("volume") + '</button>' +
      '<button id="liveFullscreen" type="button" class="live-control live-control--icon" title="ملء الشاشة">' + icon("expand") + '</button></div>' +
      '<a id="liveOfficial" class="live-official" target="_blank" rel="noopener noreferrer" hidden>' + icon("external") + ' فتح المصدر الرسمي</a>' +
      '<p class="live-help">إذا لم يبدأ البث، فقد يمنع المصدر عرضه داخل المتصفح (CORS)، أو يقيّده حسب البلد أو نوع الجهاز. افتح المصدر الأصلي عند توفره.</p>' +
      '</div><aside class="live-guide" aria-label="دليل القنوات">' +
      '<div class="live-guide__head"><div><span class="live-eyebrow">TV GUIDE</span><h2>دليل القنوات</h2></div>' +
      '<span class="live-guide__count" id="liveFilteredCount">' + count + ' قناة</span></div>' +
      '<div class="live-search">' + icon("search") + '<input id="liveSearch" type="search" placeholder="ابحث عن قناة أو دولة..." aria-label="بحث القنوات" autocomplete="off">' +
      '<button id="liveSearchClear" type="button" aria-label="مسح البحث" hidden>×</button></div>' +
      '<div class="live-categories" id="liveCategories" aria-label="تصفية التصنيف">' + categoryButtons + '</div>' +
      '<div class="live-guide__items" id="liveGuideItems" role="group" aria-label="القنوات"></div>' +
      '<div class="live-guide__bottom">اختر قناة للتشغيل · مفاتيح Alt + ↑ / ↓ للتنقل</div>' +
      '</aside></div></section>';
  }

  window.AlezzLive = { render: render, mount: mount, destroy: destroy, playable: playable, mediaType: mediaType };
})();
