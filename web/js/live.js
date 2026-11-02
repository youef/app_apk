/* AL EZZ TV — dedicated live television page, browser-safe and RTL. */
(function () {
  "use strict";
  var Explore=window.AlezzExplore;
  var Store=window.AlezzStore;
  var state = {
    channels: [], shown: [], current: null, search: "", category: "",
    hls: null, dash: null, frame: null, request: 0, timeout: null, mounted: false,
    hlsRecoveries: 0, favoritesOnly: false, favorites: [],
    dial: "", dialTimer: null, qualityLevels: [], qualityChoice: -1,
    lastChannelKey: null, startAt: 0, pipActive: false
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
      tv: '<rect x="3" y="5" width="18" height="13" rx="3"/><path d="M8 21h8"/>',
      star: '<path d="m12 2 3.2 6.5 7.2 1.1-5.2 5.1 1.2 7.2-6.4-3.4-6.4 3.4 1.2-7.2-5.2-5.1 7.2-1.1z"/>',
      pip: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="11" y="12" width="8" height="6" rx="1"/>'
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
    var cover = channel && https(channel.poster);
    return '<span class="live-channel-art">' +
      '<img class="live-channel-art__fallback" src="alizz-tv-transparent.png" alt="" loading="lazy" onerror="this.remove()">' +
      (cover ? '<img class="live-channel-art__cover" src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.remove()">' : "") +
      '</span>';
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
      '<span class="live-guide__indicator">' + (state.favorites.indexOf(channel.key)>=0 ? '<span aria-label="مفضلة" class="live-guide__star">★</span>' : '') +
      (isOfficial(channel) ? icon("external") : '<i></i>') + '</span></button>';
  }
  function sortedChannels() {
    return state.channels.filter(function (c) {
      if (state.favoritesOnly && state.favorites.indexOf(c.key) === -1) return false;
      if (state.category && !Explore.matches(c,state.category)) return false;
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
    var filterButton = $("liveFavoritesFilter");
    if (filterButton) {
      filterButton.setAttribute("aria-pressed", state.favoritesOnly ? "true" : "false");
      filterButton.textContent = state.favoritesOnly ? "★ المفضلة فقط" : "☆ عرض المفضلة";
    }
    markGuideSelection();
  }
  function markGuideSelection() {
    var host = $("liveGuideItems");
    if (!host) return;
    var key = state.current && state.current.key;
    Array.prototype.forEach.call(host.querySelectorAll("[data-live-key]"),function(button){
      var selected = key === button.getAttribute("data-live-key");
      button.classList.toggle("is-selected",selected);
      button.setAttribute("aria-pressed",String(selected));
    });
    var favorite = $("liveFavorite");
    if (favorite) {
      var on = key && state.favorites.indexOf(key) >= 0;
      favorite.textContent = on ? "★ في المفضلة" : "☆ أضف للمفضلة";
      favorite.setAttribute("aria-pressed",String(!!on));
      favorite.disabled = !key;
    }
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
    resetLiveQuality();
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
      if (ticket !== state.request) return;
      clearTimeout(state.timeout);
      stateText("المتصفح منع التشغيل التلقائي. اضغط تشغيل من أدوات الفيديو.", false);
      if ($("liveStage")) $("liveStage").classList.remove("is-loading");
      if ($("livePoster")) $("livePoster").hidden = true;
      if ($("liveStart")) $("liveStart").hidden = false;
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
  function closeLiveQuality() {
    var menu = $("liveQualityMenu"),button = $("liveQuality");
    if (menu) menu.hidden = true;
    if (button) button.setAttribute("aria-expanded","false");
  }
  function resetLiveQuality() {
    state.qualityLevels = [];
    state.qualityChoice = -1;
    closeLiveQuality();
    renderLiveQuality();
  }
  function renderLiveQuality() {
    var button = $("liveQuality"),menu = $("liveQualityMenu");
    if (!button || !menu) return;
    var available = !!(state.hls && state.qualityLevels.length > 1);
    button.disabled = !available;
    var currentLevel = state.qualityLevels.filter(function (x) {
      return x.index === state.qualityChoice;
    })[0];
    button.textContent = "الجودة: " + (currentLevel ? currentLevel.label : "تلقائي");
    menu.replaceChildren();
    if (!available) return;
    [{index:-1,label:"تلقائي"}].concat(state.qualityLevels).forEach(function (level) {
      var entry=document.createElement("button");
      entry.type="button";
      entry.className="live-quality-option"+(state.qualityChoice===level.index?" is-selected":"");
      entry.setAttribute("role","menuitemradio");
      entry.setAttribute("aria-checked",String(state.qualityChoice===level.index));
      entry.textContent=level.label;
      entry.addEventListener("click",function(){
        if (state.hls) state.hls.currentLevel=level.index;
        state.qualityChoice=level.index;
        closeLiveQuality();
        renderLiveQuality();
        stateText("جودة البث: "+level.label,false);
        if (button) button.focus();
      });
      menu.appendChild(entry);
    });
  }
  function refreshHlsQuality(hls) {
    if (hls !== state.hls || !hls.levels) return;
    var seen={};
    state.qualityLevels=hls.levels.map(function (level,index) {
      var label=level.height?level.height+"p":
        level.bitrate?Math.round(level.bitrate/1000)+" Kbps":"المستوى "+(index+1);
      if (seen[label])label+=" ("+(index+1)+")";
      seen[label]=true;
      return {index:index,label:label,sort:level.height||level.bitrate||0};
    }).sort(function (a,b) {return b.sort-a.sort;});
    renderLiveQuality();
  }
  function showChannelHud(channel, override) {
    var hud=$("liveChannelHud");
    if (!hud) return;
    clearTimeout(state.hudTimer);
    var idx=state.shown.indexOf(channel);
    if (idx<0)idx=state.channels.indexOf(channel);
    var num=idx<0?"TV":String(idx+1).padStart(3,"0");
    hud.textContent=(override||num)+"   "+(channel?channel.title:"");
    hud.hidden=false;
    state.hudTimer=setTimeout(function(){if(hud)hud.hidden=true;},2600);
  }
  function tuneChannelNumber() {
    if (!state.dial) return;
    var number=Number(state.dial);
    state.dial="";
    clearTimeout(state.dialTimer);
    state.dialTimer=null;
    var items=state.shown.length?state.shown:state.channels;
    if (number>=1 && number<=items.length) select(items[number-1],true);
    else stateText("لا توجد قناة بهذا الرقم في الدليل الحالي.",true);
  }
  function toggleLivePip() {
    var video=$("liveVideo");
    if (!video || video.hidden || !state.current) return;
    try {
      if (document.pictureInPictureElement && document.exitPictureInPicture) {
        var exit=document.exitPictureInPicture();
        if(exit&&exit.catch)exit.catch(function(){});
      } else if (video.requestPictureInPicture) {
        var request=video.requestPictureInPicture();
        if(request&&request.catch)request.catch(function(){stateText("النافذة العائمة غير مدعومة أو منعها المتصفح.",true);});
      } else if (video.webkitSupportsPresentationMode && video.webkitSupportsPresentationMode("picture-in-picture")) {
        video.webkitSetPresentationMode(video.webkitPresentationMode==="picture-in-picture"?"inline":"picture-in-picture");
      } else stateText("وضع النافذة العائمة غير متاح في هذا الجهاز.",false);
    } catch (e) {stateText("تعذّر تشغيل النافذة العائمة.",true);}
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
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            if (ticket !== state.request) return;
            refreshHlsQuality(hls);
            requestPlay(video, ticket);
          });
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
    showChannelHud(channel);
    displaySelection(channel);
    markGuideSelection();
    if (Store && Store.setPref) Store.setPref("lastLiveChannel", channel.key);
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
    var target = at<0 ? (direction<0 ? list.length-1 : 0) : (at+direction+list.length)%list.length;
    select(list[target], true);
  }
  function mount() {
    if (!$("livePage")) return;
    state.mounted = true;
    state.favorites = (Store && Store.pref && Store.pref("liveFavorites",[])) || [];
    if (!Array.isArray(state.favorites)) state.favorites = [];
    state.favoritesOnly = false;
    updateGuide();
    var last = Store && Store.pref ? Store.pref("lastLiveChannel","") : "";
    var first = null;
    for (var a=0; a<state.shown.length; a++) {
      if (state.shown[a].key === last && playable(state.shown[a])) {first = state.shown[a];break;}
    }
    for (var i = 0; i < state.shown.length; i++) {
      if (!first && !isOfficial(state.shown[i]) && playable(state.shown[i])) { first = state.shown[i]; break; }
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
    $("liveFavoritesFilter").addEventListener("click", function () {
      state.favoritesOnly = !state.favoritesOnly;
      updateGuide();
    });
    $("liveFavorite").addEventListener("click", function () {
      if (!state.current) return;
      var key = state.current.key, at = state.favorites.indexOf(key);
      if (at < 0) state.favorites.push(key); else state.favorites.splice(at,1);
      state.favorites = state.favorites.slice(0,150);
      if (Store && Store.setPref) Store.setPref("liveFavorites",state.favorites);
      if (state.favoritesOnly) updateGuide(); else markGuideSelection();
    });
    function chooseLiveCategory(value) {
      state.category=value||"";
      $("liveFilters").innerHTML=Explore.picker(state.channels,state.category,"live",state.catalogCategories);
      updateGuide();
    }
    $("liveFilters").addEventListener("click",function(event){
      var btn=event.target.closest("[data-live-filter]");
      if(btn)chooseLiveCategory(btn.getAttribute("data-live-filter"));
    });
    $("liveFilters").addEventListener("change",function(event){
      if(event.target.getAttribute("data-browse-select")==="live")chooseLiveCategory(event.target.value);
    });
    $("liveStart").addEventListener("click", function () { if (state.current) select(state.current, true); });
    $("liveRetry").addEventListener("click", function () { if (state.current) select(state.current, true); });
    $("livePrev").addEventListener("click", function () { navigate(-1); });
    $("liveNext").addEventListener("click", function () { navigate(1); });
    $("liveFullscreen").addEventListener("click", function () {
      var stage = $("liveStage"), video = $("liveVideo");
      var fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreen) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) { try { var out = exit.call(document); if (out && out.catch) out.catch(function () {}); } catch (e) {} }
        return;
      }
      if (stage.classList.contains("is-immersive")) { stage.classList.remove("is-immersive"); return; }
      function fallback() {
        if (video && !video.hidden && video.webkitEnterFullscreen) {
          try { video.webkitEnterFullscreen(); return; } catch (e) {}
        }
        stage.classList.add("is-immersive");
      }
      if (/iPhone|iPod/i.test(navigator.userAgent || "") && video && !video.hidden && video.webkitEnterFullscreen) {
        try { video.webkitEnterFullscreen(); return; } catch (e) {}
      }
      var enter = stage.requestFullscreen || stage.webkitRequestFullscreen;
      if (enter) {
        try { var started = enter.call(stage); if (started && started.catch) started.catch(fallback); }
        catch (e) { fallback(); }
      } else fallback();
    });
    $("liveFit").addEventListener("click", function () {
      var stage = $("liveStage"), fit = !stage.classList.contains("is-cropped");
      stage.classList.toggle("is-cropped", fit);
      $("liveFit").textContent = fit ? "احتواء الصورة" : "ملء الصورة";
      $("liveFit").setAttribute("aria-pressed", String(fit));
      Store.setPref("videoFit", fit ? "cover" : "contain");
    });
    if (Store.pref("videoFit","contain") === "cover") {
      $("liveStage").classList.add("is-cropped");
      $("liveFit").textContent = "احتواء الصورة";
      $("liveFit").setAttribute("aria-pressed","true");
    }
    $("liveMute").addEventListener("click", function () {
      var video = $("liveVideo"); video.muted = !video.muted;
      $("liveMute").setAttribute("aria-pressed", String(video.muted));
      $("liveMute").title = video.muted ? "إلغاء كتم الصوت" : "كتم الصوت";
    });
    $("liveQuality").addEventListener("click", function () {
      var menu=$("liveQualityMenu");
      if(!menu || $("liveQuality").disabled)return;
      var opening=menu.hidden;
      menu.hidden=!opening;
      $("liveQuality").setAttribute("aria-expanded",String(opening));
      if(opening) {
        var active=menu.querySelector(".is-selected");
        if(active)active.focus();
      }
    });
    $("liveQualityMenu").addEventListener("keydown",function(event){
      if(event.key==="Escape"){event.preventDefault();closeLiveQuality();$("liveQuality").focus();}
      if(event.key==="ArrowUp"||event.key==="ArrowDown"){
        event.preventDefault();
        var options=Array.prototype.slice.call(this.querySelectorAll("button"));
        var at=options.indexOf(document.activeElement);
        if(options.length)options[(at+(event.key==="ArrowDown"?1:-1)+options.length)%options.length].focus();
      }
    });
    $("livePip").addEventListener("click",toggleLivePip);
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
      if (!$("liveQualityMenu").hidden) {
        if(event.key==="Escape"){event.preventDefault();closeLiveQuality();$("liveQuality").focus();}
        return;
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && /^[0-9]$/.test(event.key)) {
        event.preventDefault();
        state.dial = (state.dial+event.key).slice(-3);
        clearTimeout(state.dialTimer);
        state.dialTimer=setTimeout(tuneChannelNumber,1150);
        var hud=$("liveChannelHud");
        if (hud) {hud.hidden=false;hud.textContent="القناة "+state.dial+" … اضغط Enter"; }
        return;
      }
      if (event.key==="Enter" && state.dial) {
        event.preventDefault();tuneChannelNumber();return;
      }
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
    clearTimeout(state.dialTimer);state.dialTimer=null;state.dial="";
    clearTimeout(state.hudTimer);state.hudTimer=null;closeLiveQuality();
    state.keydown = null;
  }
  function render(catalog, initialCategory) {
    state.channels = (catalog && catalog.channels) || [];
    state.catalogCategories=(catalog && catalog.categories)||[];
    state.search = "";
    state.category = initialCategory || "";
    state.shown = [];
    state.current = null;
    var count = state.channels.length;
    var categoryButtons=Explore.picker(state.channels,state.category,"live",state.catalogCategories);
    return '<section class="live-page" id="livePage" aria-label="البث المباشر">' +
      '<div class="live-heading"><div><span class="live-eyebrow"><i></i> AL EZZ TV · LIVE STATION</span>' +
      '<h1>البث المباشر <em>على شاشتك</em></h1>' +
      '<p>شغّل القنوات داخل الموقع، وتصفح الدليل، وانتقل بين المحطات دون مغادرة الصفحة.</p></div>' +
      '<div class="live-heading__actions"><span class="live-total">' + count + ' قناة في الدليل</span>' +
      '<button type="button" class="live-outline" id="liveRefresh">' + icon("refresh") + ' تحديث القنوات</button></div></div>' +
      '<div class="live-discovery" id="liveFilters">' + categoryButtons + '</div>' +
      '<div class="live-layout"><div class="live-viewer">' +
      '<div class="live-stage" id="liveStage">' +
      '<video id="liveVideo" controls playsinline webkit-playsinline preload="none" aria-label="مشغل البث المباشر"></video>' +
      '<div class="live-channel-hud" id="liveChannelHud" aria-live="off" hidden></div>' +
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
      '<button id="liveFavorite" type="button" class="live-control" aria-pressed="false">☆ أضف للمفضلة</button>' +
      '<div class="live-quality-wrap"><button id="liveQuality" type="button" class="live-control" aria-haspopup="menu" aria-expanded="false" aria-controls="liveQualityMenu" disabled>الجودة: تلقائي</button><div id="liveQualityMenu" class="live-quality-menu" role="menu" hidden></div></div>' +
      '<button id="livePip" type="button" class="live-control" title="نافذة عائمة" aria-label="عرض القناة في نافذة عائمة">' + icon("pip") + ' نافذة عائمة</button>' +
      '<button id="liveMute" type="button" class="live-control live-control--icon" aria-pressed="false" title="كتم الصوت">' + icon("volume") + '</button>' +
      '<button id="liveFit" type="button" class="live-control" aria-pressed="false" title="ملء الصورة مع احتمال قص الأطراف">ملء الصورة</button>' +
      '<button id="liveFullscreen" type="button" class="live-control live-control--icon" title="ملء الشاشة" aria-label="ملء الشاشة">' + icon("expand") + '</button></div>' +
      '<a id="liveOfficial" class="live-official" target="_blank" rel="noopener noreferrer" hidden>' + icon("external") + ' فتح المصدر الرسمي</a>' +
      '<p class="live-help">البث متاح وفق المصدر وبلد المشاهدة. قد يرفض بعض الناشرين تشغيله داخل المتصفح (CORS)، كما أن iPhone وiPad يتحكمان تلقائيًا في جودات HLS الأصلية.</p>' +
      '</div><aside class="live-guide" aria-label="دليل القنوات">' +
      '<div class="live-guide__head"><div><span class="live-eyebrow">TV GUIDE</span><h2>دليل القنوات</h2></div>' +
      '<span class="live-guide__count" id="liveFilteredCount">' + count + ' قناة</span></div>' +
      '<div class="live-search">' + icon("search") + '<input id="liveSearch" type="search" placeholder="ابحث عن قناة أو دولة..." aria-label="بحث القنوات" autocomplete="off">' +
      '<button id="liveSearchClear" type="button" aria-label="مسح البحث" hidden>×</button></div>' +
      '<button id="liveFavoritesFilter" type="button" class="live-favorites-filter" aria-pressed="false">☆ عرض المفضلة</button>' +
      '<div class="live-guide__items" id="liveGuideItems" role="group" aria-label="القنوات"></div>' +
      '<div class="live-guide__bottom">رقم القناة + Enter للتنقل · PgUp / PgDn أو ريموت التلفزيون</div>' +
      '</aside></div></section>';
  }

  window.AlezzLive = { render: render, mount: mount, destroy: destroy, playable: playable, mediaType: mediaType };
})();
