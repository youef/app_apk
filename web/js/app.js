/* ============================================================================
   AL EZZ TV — application shell
   Vanilla ES5-friendly JS: works on old TV browsers, no build step required.
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.ALEZZ_CONFIG;
  var Store = window.AlezzStore;
  var Api = window.AlezzApi;
  var Player = window.AlezzPlayer;
  var Live = window.AlezzLive;
  var Kids = window.AlezzKids;

  var $ = function (id) { return document.getElementById(id); };
  var view = $("view");
  var catalog = null;
  var source = "live";
  var heroTimer = null;
  var heroIndex = 0;
  var heroItems = [];
  var lastFocus = null;
  var kidsType = "all", kidsCountry = "", kidsLanguage = "";
  var DEFAULT_LOGO = "alizz-tv-transparent.png";

  /* ---------------------------------------------------------------- utils */

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDuration(min) {
    if (!min) return "";
    var h = Math.floor(min / 60);
    var m = min % 60;
    return h ? h + " س " + (m ? m + " د" : "") : m + " د";
  }

  function hashStr(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
    return h;
  }

  function hueFor(item) {
    if (item.live) return 202;
    if (item.kind === "youtube") return 352;
    var c = item.category || "";
    if (/أطفال|رسوم|عائل/.test(c)) return 32;
    if (/خيال|مغامر/.test(c)) return 262;
    if (/كلاسيك|صامت/.test(c)) return 10;
    if (/اختبار/.test(c)) return 158;
    if (/غموض|جريمة/.test(c)) return 285;
    return hashStr(String(item.id || item.title)) % 360;
  }

  function artStyle(item, hero) {
    var h = hueFor(item);
    return [
      "radial-gradient(" + (hero ? "110% 80% at 82% 4%" : "120% 95% at 76% 8%") + ", hsla(" + h + ",68%,56%," + (hero ? ".46" : ".34") + "), transparent 60%)",
      "radial-gradient(85% 70% at 8% 96%, hsla(" + ((h + 46) % 360) + ",70%,48%,.24), transparent 64%)",
      "linear-gradient(155deg,#161B27 0%,#0A0C12 54%,#06070A 100%)"
    ].join(",");
  }

  function letterOf(item) {
    var t = (item.title || "?").replace(/^(فيلم|مسلسل|قناة)\s+/g, "").trim();
    return (t.charAt(0) || "?").toUpperCase();
  }

  function art(item, cls) {
    var label = item.category || kindLabel(item.kind);
    return '<div class="card__art ' + (cls || "") + '" style="background:' + artStyle(item) + '">' +
      '<img class="art__logo" src="' + DEFAULT_LOGO + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' +
      '<span class="art__label">' + esc(label) + "</span></div>";
  }

  function heroFallback(item) {
    return '<div class="hero__art" style="background:' + artStyle(item, true) + '">' +
      '<img class="hero__fallback-logo" src="' + DEFAULT_LOGO + '" alt="" onerror="this.remove()"></div>';
  }

  function kindLabel(kind) {
    return { movie: "فيلم", series: "مسلسل", channel: "قناة", youtube: "فيديو", episode: "حلقة" }[kind] || "عمل";
  }

  function progressOf(item) {
    var p = Store.progress(item.key);
    if (!p || !p.d) return 0;
    return Math.max(0, Math.min(100, (p.t / p.d) * 100));
  }

  function toast(msg, kind) {
    var host = $("toasts");
    var node = document.createElement("div");
    node.className = "toast" + (kind === "err" ? " toast--err" : "");
    node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      (kind === "err" ? '<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>' : '<path d="M5 13l4 4L19 7"/>') +
      "</svg><span>" + esc(msg) + "</span>";
    host.appendChild(node);
    setTimeout(function () {
      node.style.transition = "opacity .3s, transform .3s";
      node.style.opacity = "0";
      node.style.transform = "translateY(8px)";
      setTimeout(function () { node.remove(); }, 320);
    }, 2600);
  }

  /* ---------------------------------------------------------------- cards */

  function cardHTML(item, opts) {
    opts = opts || {};
    var wide = opts.wide || item.live || item.kind === "youtube";
    var pct = progressOf(item);
    var tag = "";
    if (item.kind === "channel" && item.playback === "official_link") tag = '<span class="card__tag">↗ موقع رسمي</span>';
    else if (item.live) tag = '<span class="card__tag card__tag--live"><i></i>مباشر</span>';
    else if (item.featured) tag = '<span class="card__tag card__tag--gold">مختار</span>';
    else if (item.kind === "youtube") tag = '<span class="card__tag">يوتيوب</span>';

    var media = (item.poster || item.backdrop)
      ? art(item) + '<img loading="lazy" decoding="async" src="' + esc(item.poster || item.backdrop) +
        '" alt="" onerror="this.remove()">'
      : art(item);

    var metaBits = [];
    if (item.year) metaBits.push(esc(item.year));
    if (item.quality) metaBits.push("<em>" + esc(item.quality) + "</em>");
    if (item.duration) metaBits.push(esc(fmtDuration(item.duration)));
    if (item.kind === "series" && item.episodeCount) metaBits.push(item.episodeCount + " حلقة");
    if (item.category && !wide) metaBits.push(esc(item.category));
    if (item.playback === "official_link") metaBits.push("رابط رسمي");
    else if (item.live && !item.category) metaBits.push("بث حي");

    return '<article class="card' + (wide ? " card--wide" : "") + '" tabindex="0" role="button" data-key="' +
      esc(item.key) + '" aria-label="' + esc(item.title + " — " + kindLabel(item.kind)) + '">' +
      '<div class="card__media">' + media + "</div>" +
      '<div class="card__veil"></div>' + tag +
      '<div class="card__play"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L20 12z"/></svg></span></div>' +
      '<div class="card__body"><h3 class="card__title">' + esc(item.title) + "</h3>" +
      '<div class="card__meta">' + metaBits.join("<span>·</span>") + "</div></div>" +
      (pct > 1 ? '<div class="card__progress"><i style="width:' + pct.toFixed(1) + '%"></i></div>' : "") +
      "</article>";
  }

  function railHTML(title, items, opts) {
    if (!items || !items.length) return "";
    opts = opts || {};
    var id = "rail-" + hashStr(title);
    return '<section class="section" aria-label="' + esc(title) + '">' +
      '<div class="section__head"><div><h2 class="section__title">' + esc(title) + "</h2>" +
      (opts.subtitle ? '<p class="section__sub">' + esc(opts.subtitle) + "</p>" : "") +
      "</div>" +
      (opts.more ? '<a class="section__more" href="' + opts.more + '">عرض الكل <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>' : "") +
      "</div>" +
      '<div class="rail" id="' + id + '">' +
      '<button class="rail__arrow rail__arrow--prev" data-rail="' + id + '" data-dir="1" aria-label="السابق"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<div class="rail__track">' + items.map(function (i) { return cardHTML(i, opts); }).join("") + "</div>" +
      '<button class="rail__arrow rail__arrow--next" data-rail="' + id + '" data-dir="-1" aria-label="التالي"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>' +
      "</div></section>";
  }

  function gridHTML(items) {
    return '<div class="grid">' + items.map(function (i) { return cardHTML(i); }).join("") + "</div>";
  }

  /* ---------------------------------------------------------------- hero */

  function renderHero() {
    heroItems = Api.featured().slice(0, 5);
    if (!heroItems.length) return "";
    var item = heroItems[0];
    return heroHTML(item);
  }

  function heroHTML(item) {
    var backdrop = item.backdrop;
    var media = heroFallback(item) + (backdrop
      ? '<div class="hero__media"><img src="' + esc(backdrop) + '" alt="" onerror="this.parentNode.remove()"></div>'
      : "");
    var posterPanel = (!backdrop && item.poster)
      ? '<div class="hero__poster">' + art(item) + '<img src="' + esc(item.poster) + '" alt="" onerror="this.remove()"></div>'
      : "";

    var chips = [];
    if (item.featured) chips.push('<span class="chip chip--gold">اختيار العز</span>');
    if (item.year) chips.push('<span class="chip">' + esc(item.year) + "</span>");
    if (item.quality) chips.push('<span class="chip chip--hd">' + esc(item.quality) + "</span>");
    if (item.duration) chips.push('<span class="chip">' + esc(fmtDuration(item.duration)) + "</span>");
    if (item.kind === "series" && item.episodeCount) chips.push('<span class="chip">' + item.episodeCount + " حلقة</span>");
    if (item.kids) chips.push('<span class="chip chip--kid">عائلي</span>');
    if (!item.year && !item.duration && item.category) chips.push('<span class="chip">' + esc(item.category) + "</span>");

    return '<section class="hero" id="hero" aria-label="العمل المميز">' + media + posterPanel +
      '<div class="hero__body">' +
      '<p class="hero__eyebrow">العز TV · اخترنا لك</p>' +
      '<h1 class="hero__title">' + esc(item.title) + "</h1>" +
      '<div class="hero__meta">' + chips.join("") + "</div>" +
      (item.description ? '<p class="hero__desc">' + esc(item.description) + "</p>" : "") +
      '<div class="hero__actions">' +
      '<button class="btn btn--gold" data-play="' + esc(item.key) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L20 12z" fill="currentColor" stroke="none"/></svg>تشغيل الآن</button>' +
      '<button class="btn btn--ghost" data-detail="' + esc(item.key) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6h.01"/></svg>التفاصيل</button>' +
      '<button class="btn btn--ghost" data-fav="' + esc(item.key) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>قائمتي</button>' +
      "</div></div>" +
      '<div class="hero__dots" role="tablist">' +
      heroItems.map(function (_, i) {
        return '<button class="hero__dot' + (i === 0 ? " is-on" : "") + '" data-slide="' + i + '" aria-label="المميز ' + (i + 1) + '"></button>';
      }).join("") + "</div>" +
      '<div class="hero__side">AL EZZ ORIGINAL · ' + String(heroIndex + 1).padStart(2, "0") + "</div>" +
      "</section>";
  }

  function showSlide(index) {
    if (!heroItems.length) return;
    heroIndex = (index + heroItems.length) % heroItems.length;
    var host = $("hero");
    if (!host) return;
    var item = heroItems[heroIndex];
    var tmp = document.createElement("div");
    tmp.innerHTML = heroHTML(item);
    var next = tmp.firstElementChild;
    next.style.opacity = "0";
    host.parentNode.replaceChild(next, host);
    requestAnimationFrame(function () {
      next.style.transition = "opacity .5s ease";
      next.style.opacity = "1";
    });
  }

  function startHeroRotation() {
    // No automatic slider or layout shifts; people can change slides manually.
    clearInterval(heroTimer);
  }

    var Explore=window.AlezzExplore;
  function genreLabel(key){return Explore.genreLabel(key);}
  function itemMatches(item,choice){return Explore.matches(item,choice);}
  function classifiedFilterBar(list,selected,section){return Explore.picker(list,selected,section,catalog.categories);}

  /* ---------------------------------------------------------------- views */

  function continueWatching() {
    var map = Store.progressAll();
    var out = [], seen = Object.create(null), episodeParents = Object.create(null);
    // A saved episode should open its parent series rather than a fictitious
    // title page, and multiple saved episodes must not duplicate the series.
    (catalog.series || []).forEach(function (series) {
      (series.seasons || []).forEach(function (season) {
        (season.episodes || []).forEach(function (episode) {
          episodeParents[episode.key] = series;
        });
      });
    });
    Object.keys(map).sort(function (a, b) {
      return ((map[b] && map[b].at) || 0) - ((map[a] && map[a].at) || 0);
    }).forEach(function (key) {
      var progress = map[key];
      if (!progress || !isFinite(progress.d) || progress.d <= 0 ||
          !isFinite(progress.t) || progress.t <= 0) return;
      var item = catalog.byKey[key] || episodeParents[key];
      // Never offer a removed, unpublished or unavailable title as playable.
      if (!item || seen[item.key]) return;
      seen[item.key] = true;
      out.push({ item: item, p: progress });
    });
    return out.slice(0, 14);
  }

  function continueRail() {
    var list = continueWatching();
    if (!list.length) return "";
    return '<section class="section"><div class="section__head"><div>' +
      '<h2 class="section__title">أكمل المشاهدة</h2>' +
      '<p class="section__sub">من حيث توقفت، على هذا الجهاز</p></div></div>' +
      '<div class="rail"><div class="rail__track">' +
      list.map(function (entry) {
        var pct = Math.min(100, (entry.p.t / entry.p.d) * 100);
        var item = entry.item;
        var media = item.poster ? art(item) + '<img loading="lazy" src="' + esc(item.poster) + '" alt="" onerror="this.remove()">' : art(item);
        return '<article class="card" tabindex="0" role="button" data-key="' + esc(item.key) + '" aria-label="' + esc(item.title) + '">' +
          '<div class="card__media">' + media + '</div><div class="card__veil"></div>' +
          '<div class="card__play"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L20 12z"/></svg></span></div>' +
          '<div class="card__body"><h3 class="card__title">' + esc(item.title) + '</h3>' +
          '<div class="card__meta"><em>متبقي ' + fmtDuration(Math.max(1, Math.round((entry.p.d - entry.p.t) / 60))) + "</em></div></div>" +
          '<div class="card__progress"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
          "</article>";
      }).join("") + "</div></div></section>";
  }

  function bannerHTML() {
    if (source !== "snapshot") return "";
    return '<div class="banner"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>' +
      "أنت تشاهد المكتبة المحفوظة على الجهاز — سيتم التحديث تلقائيًا عند عودة الاتصال.</div>";
  }

  function viewHome() {
    var rows = [continueRail()];
    rows.push(railHTML("أحدث الأفلام", catalog.movies.slice(0, 18), { more: "#/movies" }));
    rows.push(railHTML("المسلسلات", catalog.series.slice(0, 18), { more: "#/series" }));
    rows.push(railHTML("قنوات مباشرة", catalog.channels.filter(function(c) { return c.live && c.stream; }).slice(0, 16), { more: "#/live" }));
    var kids = catalog.items.filter(function(i) { return i.kids; });
    if (kids.length) rows.push(railHTML("عالم الأطفال", kids.slice(0, 16), { more: "#/kids" }));
    if (catalog.youtube.length) rows.push(railHTML("الفيديوهات", catalog.youtube.slice(0, 14), { more: "#/youtube" }));
    return renderHero() + '<div class="home-content">' + rows.join("") + '</div>';
  }

    function pageHead(title, subtitle, count) {
    return '<div class="pagehead"><h1>' + esc(title) + '</h1>' +
      (count != null ? '<span class="pagehead__count">' + count + ' عنوان</span>' : '') +
      '</div>';
  }

    function filterBar(categories, active, kind) {
    var items = kind === 'noall' ? [] : ['<button class="filter' + (!active ? " is-on" : "") + '" data-filter="">الكل</button>'];
    categories.forEach(function (c) {
      items.push('<button class="filter' + (active === c.id ? " is-on" : "") + '" data-filter="' + esc(c.id) + '">' + esc(c.name_ar) + "</button>");
    });
    return '<div class="filters">' + items.join("") + "</div>";
  }


  function experienceHeader(route) {
    // The shared header and page heading replace the former oversized banners and duplicate tabs.
    return "";
  }

    function viewMovies(filterCat) {
    var list = catalog.movies;
    var shown = list.filter(function(x) { return itemMatches(x, filterCat); });
    var resume = shown.filter(function(x) { var p = progressOf(x); return p > 2 && p < 97; }).slice(0, 12);
    return pageHead("الأفلام", "", shown.length) +
      (resume.length && !filterCat ? railHTML("أكمل المشاهدة", resume) : "") +
      classifiedFilterBar(list, filterCat, "movies") +
      (shown.length ? gridHTML(shown) : emptyHTML("لا توجد أفلام في هذا القسم."));
  }

    function seriesEpisodes(item) {
    var result = [];
    (item.seasons || []).forEach(function (season) {
      (season.episodes || []).forEach(function (ep) { result.push(ep); });
    });
    return result;
  }

  function seriesResume(item) {
    var episodes = seriesEpisodes(item), active = null, latest = 0;
    episodes.forEach(function (ep) {
      var saved = Store.progress(ep.key);
      if (saved && saved.t > 5 && saved.at >= latest) { active = ep; latest = saved.at; }
    });
    return active;
  }

  function viewSeries(filterCat) {
    var list = catalog.series;
    var shown = list.filter(function(x) { return itemMatches(x, filterCat); });
    var resume = shown.filter(function(s) { return !!seriesResume(s); }).slice(0, 12);
    return pageHead("المسلسلات", "", shown.length) +
      (resume.length && !filterCat ? railHTML("أكمل مسلسلاتك", resume) : "") +
      classifiedFilterBar(list, filterCat, "series") +
      (shown.length ? gridHTML(shown) : emptyHTML("لا توجد مسلسلات في هذا القسم."));
  }

    function viewLive(filterCat) {
    if (Live) return Live.render(catalog, filterCat);
    var list = catalog.channels;
    var cats = catalog.categories.filter(function (c) { return list.some(function (x) { return x.categoryId === c.id; }); });
    var shown = list.filter(function (c) { return itemMatches(c,filterCat); });
    return pageHead("البث المباشر", "قنوات مجانية أو يبثها ناشرها علنًا. قد تختلف الإتاحة بحسب البلد والجهاز.", shown.length) +
      classifiedFilterBar(list,filterCat,"live") +
      (shown.length ? '<div class="grid grid--wide">' + shown.map(function (c) { return cardHTML(c, { wide: true }); }).join("") + "</div>" : emptyHTML("لا قنوات متاحة."));
  }

  function viewKids(filterCat) {
    return Kids.render(catalog, filterCat);
  }

  function viewYoutube(filterCat) {
    var list = catalog.youtube;
    var shown = list.filter(function(x) { return itemMatches(x, filterCat); });
    var content = pageHead("الفيديوهات", "", shown.length) + classifiedFilterBar(list, filterCat, "youtube");
    if (shown.length) return content + '<div class="grid grid--wide">' +
      shown.map(function(x) { return cardHTML(x, {wide:true}); }).join("") + '</div>';
    if (Api.failedTables && Api.failedTables.indexOf("youtube") !== -1)
      return content + '<div class="empty"><strong>تعذّر تحميل فيديوهات يوتيوب</strong>' +
        '<p>تعذّر الوصول إلى مكتبة المقاطع. تحقق من الاتصال وأعد المحاولة.</p>' +
        '<button type="button" class="btn btn--gold" onclick="location.reload()">تحديث المكتبة</button></div>';
    return content + emptyHTML("لا توجد فيديوهات منشورة الآن.");
  }

    function viewMyList(filterCat) {
    var keys = Store.favorites();
    var items = keys.map(function (k) { return catalog.byKey[k]; }).filter(Boolean);
    var cont = continueWatching().map(function (e) { return e.item; });
    var seen = {};
    var all = items.concat(cont).filter(function (i) { if (seen[i.key]) return false; seen[i.key] = true; return true; });
    var shown=all.filter(function(x){return itemMatches(x,filterCat);});
    var historyCount = Object.keys(Store.progressAll()).length;
    var tools = '<section class="member-library-tools" aria-label="إدارة بيانات المشاهدة">' +
      '<div><strong>مكتبتك الخاصة</strong><p>المفضلة والمتابعة لهذا الحساب على هذا الجهاز فقط. لا تتم مزامنتها بين الأجهزة.</p></div>' +
      '<div class="member-library-actions">' +
      (historyCount ? '<button type="button" data-history-action="clear-progress" aria-label="مسح سجل متابعة المشاهدة">مسح سجل المشاهدة</button>' : '') +
      (keys.length ? '<button type="button" data-history-action="clear-favorites" aria-label="إفراغ قائمة المفضلة">إفراغ المفضلة</button>' : '') +
      '</div></section>';
    return pageHead("قائمتي", "", shown.length) +
      tools + classifiedFilterBar(all,filterCat,"mylist") +
      (shown.length ? gridHTML(shown) : emptyHTML("لا توجد أعمال مطابقة أو محفوظة."));
  }

  function emptyHTML(msg) {
    return '<div class="empty"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9h8M8 13h5"/></svg>' +
      "<strong>لا شيء هنا بعد</strong><p>" + esc(msg) + "</p></div>";
  }

  /* ---------------------------------------------------------------- router */

  function parseHash() {
    var fallback = (location.search.match(/[?&]section=([a-z]+)/i) || [])[1] || "home";
    var raw = (location.hash || "#/" + fallback).replace(/^#\/?/, "");
    var parts = raw.split("/").filter(Boolean);
    return { name: parts[0] || "home", arg: parts[1] ? decodeURIComponent(parts.slice(1).join("/")) : "" };
  }

  function render(preserveScroll) {
    var y = window.scrollY, route = parseHash(), html = "";
    if (!catalog) { view.innerHTML = skeletonHTML(); return; }
    if (Live) Live.destroy();
    var playerNode = $("player");
    if (playerNode && playerNode.parentNode && playerNode.parentNode.id === "watchPlayerSlot") {
      if (Player.isOpen()) Player.close();
      document.body.appendChild(playerNode);
    } else if (Player.isOpen()) {
      Player.close();
    }
    document.body.style.overflow = "";
    document.body.classList.toggle("watch-route", route.name === "watch");
    switch (route.name) {
      case "movies": html = viewMovies(route.arg); break;
      case "series": html = viewSeries(route.arg); break;
      case "live": html = viewLive(route.arg); break;
      case "kids": html = viewKids(route.arg); break;
      case "youtube": html = viewYoutube(route.arg); break;
      case "mylist": html = viewMyList(route.arg); break;
      case "title": html = viewDetail(route.arg); break;
      case "watch": html = viewWatch(route.arg); break;
      default: html = viewHome();
    }
    var unified = /^(movies|series|live|kids|youtube|mylist)$/.test(route.name);
    view.className = "view" + (unified ? " is-experience experience--" + route.name : "") +
      (route.name === "title" ? " view--detail" : "") +
      (route.name === "watch" ? " view--watch" : "");
    view.innerHTML = route.name === "kids" ? html : (unified ? experienceHeader(route.name) + html : html);
    document.body.classList.toggle("kids-world-active", route.name === "kids");
    setNav(route.name === "title" || route.name === "watch" ? parentSection(route.arg) : route.name);
    if (preserveScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
    startHeroRotation();
    wireRails();
    if (route.name === "live" && Live) Live.mount();
    if (route.name === "kids" && Kids) Kids.mount(catalog,function(){render(true);});
    if (route.name === "title") {
      var item = findItem(route.arg);
      if (item && item.kind === "series") showUnavailableEpisodes(item);
    }
    if (route.name === "watch" && playerNode) {
      var slot = $("watchPlayerSlot");
      if (slot) {
        slot.appendChild(playerNode);
        if (Player.isOpen()) Player.close();
        var episode = findEpisode(route.arg);
        if (episode) playEpisode(route.arg);
        else playItem(findItem(route.arg));
      }
    }
  }

    function setNav(name) {
    var map = { home: "home", movies: "movies", series: "series", live: "live", kids: "kids", youtube: "youtube", mylist: "mylist" };
    var active = map[name] || "home";
    Array.prototype.forEach.call(document.querySelectorAll(".nav__link"), function (a) {
      var selected = a.getAttribute("data-nav") === active;
      a.classList.toggle("is-active", selected);
      if (selected) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".app-dock [data-dock]"), function(a) {
      var selected = a.getAttribute("data-dock") === active;
      a.classList.toggle("is-active", selected);
      if (selected) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  function skeletonHTML() {
    var cards = new Array(8).join().split(",").map(function () {
      return '<div class="skel skel--card"></div>';
    }).join("");
    return '<div class="skel skel--hero"></div>' +
      '<section class="section"><div class="section__head"><div class="skel" style="width:220px;height:26px"></div></div>' +
      '<div class="rail"><div class="rail__track">' + cards + "</div></div></section>";
  }

  function wireRails() {
    Array.prototype.forEach.call(document.querySelectorAll(".rail__arrow"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var rail = $(btn.getAttribute("data-rail"));
        if (!rail) return;
        var track = rail.querySelector(".rail__track");
        var dir = parseInt(btn.getAttribute("data-dir"), 10);
        track.scrollBy({ left: dir * track.clientWidth * 0.82, behavior: "smooth" });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".rail__track"), function (track) {
      track.addEventListener("scroll", function () {
        var rail = track.closest(".rail");
        if (rail) rail.classList.toggle("is-scrolled", Math.abs(track.scrollLeft) > 10);
      }, { passive: true });
    });
  }

  /* ---------------------------------------------------------------- detail */

  function findItem(key) {
    if (!catalog) return null;
    if (catalog.byKey[key]) return catalog.byKey[key];
    var m = continueWatching().filter(function (e) { return e.item.key === key; })[0];
    return m ? m.item : null;
  }

  function findEpisode(key) {
    if (!catalog || !catalog.series) return null;
    for (var i = 0; i < catalog.series.length; i++) {
      var series = catalog.series[i], all = seriesEpisodes(series);
      for (var j = 0; j < all.length; j++) {
        if (all[j].key === key) return { series: series, episode: all[j], list: all, index: j };
      }
    }
    return null;
  }

  function parentSection(key) {
    var entry = findEpisode(key), item = entry ? entry.series : findItem(key);
    if (!item) return "home";
    if (item.kids) return "kids";
    if (item.kind === "series") return "series";
    if (item.kind === "movie") return "movies";
    if (item.kind === "channel") return "live";
    if (item.kind === "youtube") return "youtube";
    return item.kids ? "kids" : "home";
  }
  function detailLink(key) { return "#/title/" + encodeURIComponent(key); }
  function watchLink(key) { return "#/watch/" + encodeURIComponent(key); }

  function viewDetail(key) {
    var item = findItem(key);
    if (!item) return '<div class="route-empty"><h1>هذا العمل غير متاح الآن</h1><a href="#/home" class="btn btn--gold">الرئيسية</a></div>';
    return '<article class="title-page" id="titlePage"><div class="title-page__breadcrumb">' +
      '<a href="#/' + parentSection(key) + '" data-detail-back>← العودة للمكتبة</a></div>' +
      detailHTML(item) + '</article>';
  }
  function viewWatch(key) {
    var entry = findEpisode(key), item = entry ? entry.series : findItem(key);
    if (!item) return '<div class="route-empty"><h1>الفيديو غير متاح الآن</h1><a href="#/home">الرئيسية</a></div>';
    var title = entry ? (item.title + " — " + entry.episode.title) : item.title;
    var back = detailLink(item.key), all = entry ? entry.list : [];
    var epLinks = all.length ? '<section class="watch-episodes"><div class="watch-section-head"><h2>حلقات المسلسل</h2><a href="' + back + '">كل التفاصيل</a></div>' +
      '<div class="watch-episodes__list">' + all.map(function(ep) {
        return '<a class="watch-episode' + (ep.key === key ? ' is-current' : '') + '" href="' + watchLink(ep.key) + '">' +
          '<span>الحلقة ' + esc(ep.number || "") + '</span><strong>' + esc(ep.title) + '</strong></a>';
      }).join("") + '</div></section>' : "";
    return '<div class="watch-page" id="watchPage"><nav class="watch-breadcrumb" aria-label="العودة">' +
      '<a href="' + back + '" data-watch-back>← ' + esc(item.title) + '</a></nav>' +
      '<div class="watch-player-slot" id="watchPlayerSlot"></div>' +
      '<div class="watch-page__below"><div class="watch-page__heading"><div><span>العز TV · مشاهدة</span><h1>' +
      esc(title) + '</h1></div><a class="watch-page__details" href="' + back + '">تفاصيل العمل</a></div>' +
      epLinks + '</div></div>';
  }

  function sourceLabel(item) {
    if (item.kind === "channel" && item.playback === "official_link") return "الموقع الرسمي";
    if (item.youtubeId) return "فيديو رسمي";
    if (item.live) return "بث مباشر";
    if (item.stream && /\\.mp4/i.test(item.stream)) return "MP4";
    if (item.stream && /\\.m3u8/i.test(item.stream)) return "HLS";
    return item.stream ? "مصدر مباشر" : "غير متوفر";
  }

    function detailHTML(item) {
    var fav = Store.isFavorite(item.key);
    var backdrop = item.backdrop;
    var canPlay = !!(item.stream || item.youtubeId || (item.seasons && item.episodeCount));
    var isOfficial = item.kind === "channel" && item.playback === "official_link" &&
      /^https:\/\//i.test(item.official || "") && !item.stream;
    var chips = [];
    if (isOfficial) chips.push('<span class="chip">↗ مصدر رسمي</span>');
    else if (item.live) chips.push('<span class="chip chip--live"><i></i>مباشر</span>');
    if (item.year) chips.push('<span class="chip">' + esc(item.year) + "</span>");
    if (item.quality) chips.push('<span class="chip chip--hd">' + esc(item.quality) + "</span>");
    if (item.duration) chips.push('<span class="chip">' + esc(fmtDuration(item.duration)) + "</span>");
    if (item.kids) chips.push('<span class="chip chip--kid">عائلي</span>');
    if (item.age && item.age !== "all") chips.push('<span class="chip">' + esc(item.age) + "</span>");
    chips.push('<span class="chip">' + kindLabel(item.kind) + "</span>");

    var meta = [];
    if (item.category) meta.push(["التصنيف", item.category]);
    if (item.genreTags && item.genreTags.length) meta.push(["الأنواع",item.genreTags.map(genreLabel).join("، ")]);
    if (item.country) meta.push(["البلد", item.country]);
    if (item.language) meta.push(["اللغة", item.language]);
    meta.push(["المصدر", sourceLabel(item)]);
    if (item.rights && item.rights.holder) meta.push(["صاحب الحقوق", item.rights.holder]);
    if (item.live) meta.push(["النوع", isOfficial ? "رابط للموقع الرسمي" : "قناة مباشرة"]);

    var epsHTML = "";
    if (item.kind === "series" && item.seasons && item.seasons.length) {
      var resumed = seriesResume(item);
      var firstSeason = item.seasons.filter(function(s) {
        return resumed && s.episodes.indexOf(resumed) !== -1;
      })[0] || item.seasons[0];
      epsHTML = '<div class="eps"><div class="eps__head"><div><h3>المواسم والحلقات</h3>' +
        '<p class="eps__summary">' + item.seasons.length + ' موسم · ' + (item.episodeCount || 0) + ' حلقة</p></div>' +
        '<div class="seasons" role="group" aria-label="اختيار الموسم">' +
        item.seasons.map(function (s) {
          return '<button class="filter' + (s.id === firstSeason.id ? " is-on" : "") + '" data-season="' + esc(s.id) + '" aria-label="' + esc(s.title) + '">' + esc(s.title) + "</button>";
        }).join("") + "</div></div>" +
        '<div id="epList">' + episodesHTML(firstSeason) + "</div></div>";
    }

    return '<div class="detail__hero">' +
      heroFallback(item) + (backdrop ? '<img src="' + esc(backdrop) + '" alt="" onerror="this.remove()">' : "") +
      '' +
      "</div>" +
      '<div class="detail__body"><div class="detail__head">' +
      '<div class="detail__poster">' + art(item) + (item.poster ? '<img src="' + esc(item.poster) + '" alt="" onerror="this.remove()">' : "") + "</div>" +
      '<div class="detail__info">' +
      '<p class="detail__kicker">' + esc(kindLabel(item.kind)) + (item.featured ? " · اختيار العز" : "") + "</p>" +
      '<h2 class="detail__title" id="sheetTitle">' + esc(item.title) + "</h2>" +
      (item.original && item.original !== item.title ? '<p class="detail__orig">' + esc(item.original) + "</p>" : "") +
      '<div class="detail__chips">' + chips.join("") + "</div>" +
      '<div class="detail__actions">' +
      (isOfficial ? '<a class="btn btn--gold" href="' + esc(item.official) + '" target="_blank" rel="noopener noreferrer">↗ فتح الموقع الرسمي</a>' : "") +
      (canPlay ? '<button class="btn btn--gold" data-play="' + esc(item.key) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L20 12z" fill="currentColor" stroke="none"/></svg>' +
        (progressOf(item) > 1 ? "متابعة المشاهدة" : item.live ? "مشاهدة مباشرة" : "تشغيل") + "</button>" : "") +
      '<button class="btn btn--ghost" data-fav="' + esc(item.key) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      (fav ? '<path d="M5 12l5 5L19 7"/>' : '<path d="M12 5v14M5 12h14"/>') + "</svg>" +
      (fav ? "في قائمتي" : "أضف إلى قائمتي") + "</button>" +
      "</div></div></div>" +
      (item.description ? '<p class="detail__desc">' + esc(item.description) + "</p>" : "") +
      (meta.length ? '<div class="detail__meta">' + meta.map(function (m) {
        return "<div><small>" + esc(m[0]) + "</small><strong>" + esc(m[1]) + "</strong></div>";
      }).join("") + "</div>" : "") +
      epsHTML +
      (item.rights && (item.rights.holder || item.rights.reference) ?
        '<div class="detail__rights">حقوق المحتوى: ' + esc(item.rights.holder || "مصدر خارجي") +
        (item.rights.reference ? ' — <a href="' + esc(item.rights.reference) + '" target="_blank" rel="noopener">مرجع الترخيص</a>' : "") +
        " · يعرض العز TV الروابط كما وردت من المصدر ولا يعيد استضافتها.</div>" : "") +
      "</div>";
  }

  function episodesHTML(season) {
    if (!season || !season.episodes.length) return '<p class="search__hint">لا حلقات منشورة في هذا الموسم.</p>';
    return season.episodes.map(function (e) {
      var pct = progressOf(e), started = pct > 1 && pct < 97;
      return '<button class="ep' + (started ? ' is-playing' : '') + '" data-ep="' + esc(e.key) + '" aria-label="تشغيل ' + esc(e.title) + '">' +
        '<span class="ep__thumb">' +
        (e.poster ? '<img src="' + esc(e.poster) + '" alt="" loading="lazy" onerror="this.remove()">' : '<span class="ep__thumb-placeholder">▶</span>') +
        '<span class="ep__number">الحلقة ' + esc(e.number || "—") + '</span></span>' +
        '<span class="ep__txt"><strong>' + esc(e.title) + '</strong>' +
        '<span>' + esc(e.description || 'اضغط لمشاهدة هذه الحلقة') + '</span>' +
        (started ? '<span class="ep__watching">● متابعة · ' + Math.round(pct) + '%</span>' : '') +
        (started ? '<span class="ep__progress"><i style="width:' + pct.toFixed(1) + '%"></i></span>' : '') +
        '</span><span class="ep__trailing">' +
        (e.duration ? '<span class="ep__dur">' + esc(fmtDuration(e.duration)) + '</span>' : '') +
        '<span class="ep__play">▶</span></span></button>';
    }).join("");
  }

  function showUnavailableEpisodes(item) {
    if (!item || item.kind !== "series" || parseHash().name !== "title") return;
    var host = $("titlePage") && $("titlePage").querySelector(".detail__body");
    if (!host) return;
    var section = document.createElement("section");
    section.className = "eps eps--outline";
    section.innerHTML = '<h3>حلقات إضافية</h3><p class="search__hint">جارٍ تحميل بيانات الحلقات…</p>';
    host.appendChild(section);
    var seen = {};
    (item.seasons || []).forEach(function(season) {
      (season.episodes || []).forEach(function(ep) { seen[season.number + ":" + ep.number] = true; });
    });
    if (!item.id || !CFG.supabaseUrl || !CFG.publishableKey) { section.remove(); return; }
    fetch(CFG.supabaseUrl + "/functions/v1/aseel-series-outline?series_id=" + encodeURIComponent(item.id), {
      headers: { apikey: CFG.publishableKey, Accept: "application/json" }, cache: "no-store"
    }).then(function(response) {
      if (!response.ok) throw Error("Metadata not available");
      return response.json();
    }).then(function(data) {
      if (!section.parentNode || parseHash().name !== "title" || parseHash().arg !== item.key ||
          !Array.isArray(data.seasons)) return;
      var parts = [];
      data.seasons.forEach(function(season) {
        var eps = (season.episodes || []).filter(function(ep) { return !seen[season.number + ":" + ep.number]; });
        if (!eps.length) return;
        parts.push('<h4>' + esc(season.title || "الموسم " + season.number) + '</h4>');
        eps.forEach(function(ep) {
          parts.push('<article class="outline-episode"><strong>' + esc(ep.title || "الحلقة " + ep.number) +
            '</strong><p>' + esc(ep.description || "بيانات الحلقة موجودة، والتشغيل لم يُعتمد بعد.") +
            '</p><small>التشغيل غير متاح</small></article>');
        });
      });
      if (!parts.length) { section.remove(); return; }
      section.innerHTML = '<h3>حلقات لم يُعتمد تشغيلها</h3>' + parts.join("");
    }).catch(function() {
      if (section.isConnected) section.innerHTML =
        '<h3>الحلقات الإضافية</h3><p class="search__hint">تعذر تحميل بيانات بعض الحلقات.</p>';
    });
  }

  function openDetail(key) {
    var item = findItem(key);
    if (!item) { toast("هذا العنصر لم يعد متوفرًا", "err"); return; }
    if (!$("searchPanel").hidden) closeSearch();
    location.hash = detailLink(key);
  }
  function closeDetail() {
    var route = parseHash();
    if (route.name === "title") location.hash = "#/" + parentSection(route.arg);
  }
  function leaveWatch() {
    if (parseHash().name !== "watch") { Player.close(); return; }
    var route = parseHash(), entry = findEpisode(route.arg);
    var item = entry ? entry.series : findItem(route.arg);
    location.hash = item ? detailLink(item.key) : "#/home";
  }

    /* ---------------------------------------------------------------- play */

  function nextEpisodeOf(item) {
    if (!item || item.kind !== "series") return null;
    var list = [];
    item.seasons.forEach(function (s) { list = list.concat(s.episodes); });
    return { list: list };
  }

  function playItem(item, opts) {
    opts = opts || {};
    if (!item) return;
    if (item.kind === "channel" && item.playback === "official_link" &&
        /^https:\/\//i.test(item.official || "") && !item.stream) {
      window.open(item.official, "_blank", "noopener,noreferrer");
      return;
    }

    /* a series has no stream of its own: start the first episode */
    if (item.kind === "series" && item.seasons && item.episodeCount) {
      var first = seriesResume(item);
      (item.seasons || []).forEach(function (s) {
        if (!first && s.episodes && s.episodes.length) first = s.episodes[0];
      });
      if (first) { playEpisode(first.key); return; }
      toast("لا توجد حلقات منشورة لهذا المسلسل بعد", "err");
      return;
    }

    if (parseHash().name !== "watch" || parseHash().arg !== item.key) {
      location.hash = watchLink(item.key);
      return;
    }
    var payload = {
      key: item.key, kind: item.kind, title: item.title, subtitle: kindLabel(item.kind) + (item.year ? " · " + item.year : ""),
      poster: item.poster, art: artStyle(item), stream: item.stream, youtubeId: item.youtubeId,
      live: !!item.live, quality: item.quality, variants: item.variants || [], kids: item.kids, age: item.age
    };
    if (opts.resumeAt) payload.resumeAt = opts.resumeAt;

    if (window.AlezzNative && window.AlezzNative.playMedia) {
      window.AlezzNative.playMedia(JSON.stringify(payload));
      return;
    }
    var saved = Store.progress(item.key);
    if (!opts.restart && saved && saved.t > 5) payload.resumeAt = saved.t;
    Player.open(payload, { next: opts.next || null });
  }

  function playEpisode(epKey) {
    var series = null, episode = null, list = [];
    catalog.series.forEach(function (s) {
      s.seasons.forEach(function (season) {
        season.episodes.forEach(function (e) {
          if (e.key === epKey) { episode = e; series = s; }
        });
      });
      if (series === s) list = seriesEpisodes(s);
    });
    if (!episode) return;
    if (parseHash().name !== "watch" || parseHash().arg !== epKey) {
      location.hash = watchLink(epKey);
      return;
    }
    var idx = list.indexOf(episode);
    var next = list[idx + 1] || null;
    var payload = {
      key: episode.key, kind: "episode", title: series.title + " — " + episode.title,
      subtitle: series.title, poster: series.poster, art: artStyle(series),
      stream: episode.stream, variants: episode.variants || [], youtubeId: episode.youtubeId, live: false,
      quality: series.quality, kids: series.kids, age: series.age
    };
    var saved = Store.progress(episode.key);
    if (saved && saved.t > 5) payload.resumeAt = saved.t;

    if (window.AlezzNative && window.AlezzNative.playMedia) {
      window.AlezzNative.playMedia(JSON.stringify(payload));
      return;
    }
    Player.queue(list, idx);
    Player.open(payload, { next: next ? {
      key: next.key, kind: "episode", title: series.title + " — " + next.title, subtitle: series.title,
      poster: next.poster || series.poster, stream: next.stream, variants: next.variants || [],
      youtubeId: next.youtubeId, art: artStyle(series)
    } : null, onNext: next ? function () { playEpisode(next.key); } : null });
  }

  /* ---------------------------------------------------------------- search */

  function openSearch() {
    var panel = $("searchPanel");
    panel.hidden = false;
    document.body.style.overflow = "hidden";
    var input = $("searchInput");
    input.value = "";
    $("searchResults").innerHTML = '<p class="search__hint">اكتب حرفًا واحدًا للبدء — ابحث في الأفلام والمسلسلات والقنوات وفيديوهات يوتيوب.</p>' + suggestionsHTML();
    setTimeout(function () { input.focus(); }, 60);
  }

  function suggestionsHTML() {
    var picks = catalog.items.filter(function (i) { return i.featured; }).slice(0, 6);
    if (!picks.length) picks = catalog.movies.slice(0, 6);
    if (!picks.length) return "";
    return '<div class="search__group"><h4>مقترحات</h4><div class="search__list">' +
      picks.map(searchRowHTML).join("") + "</div></div>";
  }

  function searchRowHTML(item) {
    var thumb = item.poster || item.backdrop;
    return '<button class="srow" data-key="' + esc(item.key) + '">' +
      '<span class="srow__thumb' + (item.live ? " srow__thumb--wide" : "") + '">' +
      art(item) + (thumb ? '<img loading="lazy" src="' + esc(thumb) + '" alt="" onerror="this.remove()">' : "") + "</span>" +
      "<span><b>" + esc(item.title) + "</b><small>" + esc(kindLabel(item.kind)) +
      (item.year ? " · " + item.year : "") + (item.quality ? " · " + item.quality : "") + "</small></span>" +
      "</button>";
  }

  function runSearch(q) {
    var host = $("searchResults");
    if (!q.trim()) { host.innerHTML = '<p class="search__hint">اكتب حرفًا واحدًا للبدء.</p>' + suggestionsHTML(); return; }
    var results = Api.search(q);
    if (!results.length) {
      host.innerHTML = '<div class="empty"><strong>لا نتائج لـ «' + esc(q) + '»</strong><p>جرّب كلمة أقصر أو اسمًا آخر.</p></div>';
      return;
    }
    var groups = { movie: [], series: [], channel: [], youtube: [] };
    results.forEach(function (r) { (groups[r.kind] || groups.movie).push(r); });
    host.innerHTML = Object.keys(groups).filter(function (k) { return groups[k].length; }).map(function (k) {
      return '<div class="search__group"><h4>' + kindLabel(k) + " · " + groups[k].length + "</h4><div class=\"search__list\">" +
        groups[k].map(searchRowHTML).join("") + "</div></div>";
    }).join("");
  }

  function closeSearch() {
    $("searchPanel").hidden = true;
    document.body.style.overflow = ($("sheet").hidden && $("player").hidden) ? "" : "hidden";
  }

  /* ---------------------------------------------------------------- TV mode */

  function setTvMode(on, silent) {
    document.body.classList.toggle("tv-mode", !!on);
    Store.setPref("tv", !!on);
    if (!silent) toast(on ? "وضع التلفزيون مفعّل — تنقّل بالأسهم" : "وضع التلفزيون متوقف");
  }

  function initTvMode() {
    var param = /[?&]tv=1/.test(location.search);
    var stored = Store.pref("tv", null);
    var auto = false; // Touch tablets must not automatically enter remote-control mode.
    if (param || stored === true || (stored === null && auto)) setTvMode(true, true);
  }

  /* spatial navigation for D-pad / arrow keys */
  function spatialMove(direction) {
    var focusables = Array.prototype.slice.call(
      document.querySelectorAll(".card, .btn, .nav__link, .filter, .iconbtn, .section__more, .ep, .live-guide__item, .live-chip, .live-control, .live-outline, .live-start")
    ).filter(function (el) {
      var r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (!focusables.length) return;
    var current = document.activeElement;
    if (!current || focusables.indexOf(current) === -1) {
      focusables[0].focus({ preventScroll: true });
      return;
    }
    var cr = current.getBoundingClientRect();
    var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    var best = null, bestScore = Infinity;

    focusables.forEach(function (el) {
      if (el === current) return;
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var dx = x - cx, dy = y - cy;
      var primary, secondary;
      if (direction === "right") { if (dx <= 8) return; primary = dx; secondary = Math.abs(dy); }
      else if (direction === "left") { if (dx >= -8) return; primary = -dx; secondary = Math.abs(dy); }
      else if (direction === "down") { if (dy <= 8) return; primary = dy; secondary = Math.abs(dx); }
      else { if (dy >= -8) return; primary = -dy; secondary = Math.abs(dx); }
      var score = primary + secondary * 2.1;
      if (score < bestScore) { bestScore = score; best = el; }
    });

    if (best) {
      best.focus({ preventScroll: true });
      var r = best.getBoundingClientRect();
      if (r.top < 90 || r.bottom > window.innerHeight - 20) best.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  /* ---------------------------------------------------------------- gate */

  var gateBuffer = "";

  function gateShow() {
    $("gate").hidden = false;
    document.body.style.overflow = "hidden";
    renderGateDots();
  }

  function renderGateDots() {
    var dots = $("gateDots");
    var html = "";
    for (var i = 0; i < 6; i++) html += '<i class="' + (i < gateBuffer.length ? "is-on" : "") + '"></i>';
    dots.innerHTML = html;
  }

  function gatePush(ch) {
    if (gateBuffer.length >= 6) return;
    gateBuffer += ch;
    renderGateDots();
    if (gateBuffer.length === 6) setTimeout(gateCheck, 130);
  }

  function gateCheck() {
    if (gateBuffer === CFG.activationCode) {
      Store.activate();
      $("gate").hidden = true;
      document.body.style.overflow = "";
      toast("تم التفعيل — أهلًا بك في العز TV");
      bootCatalog();
    } else {
      $("gateError").hidden = false;
      $("gate").classList.add("is-shaking");
      setTimeout(function () {
        gateBuffer = "";
        renderGateDots();
        $("gateError").hidden = true;
      }, 900);
    }
  }

  function wireGate() {
    $("gatePad").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-k]");
      if (!btn) return;
      var k = btn.getAttribute("data-k");
      if (k === "clear") { gateBuffer = ""; renderGateDots(); }
      else if (k === "back") { gateBuffer = gateBuffer.slice(0, -1); renderGateDots(); }
      else gatePush(k);
    });
    document.addEventListener("keydown", function (e) {
      if ($("gate").hidden) return;
      if (/^[0-9]$/.test(e.key)) gatePush(e.key);
      else if (e.key === "Backspace") { gateBuffer = gateBuffer.slice(0, -1); renderGateDots(); }
      else if (e.key === "Enter" && gateBuffer.length === 6) gateCheck();
    });
  }

  /* ---------------------------------------------------------------- events */

  function wireGlobal() {
    document.addEventListener("change",function(e){
      var target=e.target;
      if(target&&target.getAttribute&&target.getAttribute("data-browse-select")==="main"){
        var section=parseHash().name;
        location.hash="#/"+section+(target.value?"/"+encodeURIComponent(target.value):"");
        return;
      }
      if(!e.target || !e.target.id)return;
      if(e.target.id==="kidsTypeFilter") {kidsType=e.target.value;kidsCountry="";kidsLanguage="";render(true);}
      else if(e.target.id==="kidsCountryFilter"){kidsCountry=e.target.value;render(true);}
      else if(e.target.id==="kidsLanguageFilter"){kidsLanguage=e.target.value;render(true);}
    });
    document.addEventListener("click", function (e) {
      var t = e.target;

      // Device-local history controls, isolated by the logged-in account.
      var historyButton = t.closest("[data-history-action]");
      if (historyButton) {
        var action = historyButton.getAttribute("data-history-action");
        if (action === "clear-progress" && window.confirm("هل تريد مسح سجل متابعة المشاهدة لهذا الحساب على هذا الجهاز؟")) {
          Store.clearAllProgress();
          toast("مُسح سجل متابعة المشاهدة");
          render(true);
        } else if (action === "clear-favorites" && window.confirm("هل تريد إفراغ قائمة المفضلة لهذا الحساب على هذا الجهاز؟")) {
          Store.clearFavorites();
          toast("أُفرغت قائمة المفضلة");
          render(true);
        }
        return;
      }

      // Dedicated TV guide and kids world own their controls.
      if (t.closest("#livePage")) return;
      if (t.closest("#kidsWorld") && Kids && Kids.handleClick(e)) return;
      var playBtn = t.closest("[data-play]");
      if (playBtn) { playItem(findItem(playBtn.getAttribute("data-play"))); return; }

      var detailBtn = t.closest("[data-detail]");
      if (detailBtn) { openDetail(detailBtn.getAttribute("data-detail")); return; }

      var favBtn = t.closest("[data-fav]");
      if (favBtn) {
        var key = favBtn.getAttribute("data-fav");
        var added = Store.toggleFavorite(key);
        toast(added ? "أُضيف إلى قائمتك" : "أُزيل من قائمتك");
        var item = findItem(key);
        if (parseHash().name === "title" && item) render(true);
        if (parseHash().name === "mylist") render();
        return;
      }

      var closeSheet = t.closest("[data-close-sheet]");
      if (closeSheet) { closeDetail(); return; }

      var card = t.closest(".card");
      if (card) { openDetail(card.getAttribute("data-key")); return; }

      var srow = t.closest(".srow");
      if (srow) { closeSearch(); openDetail(srow.getAttribute("data-key")); return; }

      var ep = t.closest("[data-ep]");
      if (ep) { playEpisode(ep.getAttribute("data-ep")); return; }

      var seasonBtn = t.closest("[data-season]");
      if (seasonBtn) {
        var sid = seasonBtn.getAttribute("data-season");
        Array.prototype.forEach.call(seasonBtn.parentNode.children, function (b) { b.classList.remove("is-on"); });
        seasonBtn.classList.add("is-on");
        var seriesKey = parseHash().arg;
        var host = $("epList"), currentSeries = findItem(seriesKey);
        if (host && currentSeries && currentSeries.kind === "series") {
          currentSeries.seasons.forEach(function (season) {
            if (season.id === sid) host.innerHTML = episodesHTML(season);
          });
        }
        return;
      }

      var filter = t.closest("[data-filter]");
      if (filter) {
        var route = parseHash();
        var val = filter.getAttribute("data-filter");
        location.hash = "#/" + route.name + (val ? "/" + encodeURIComponent(val) : "");
        return;
      }

      var slide = t.closest("[data-slide]");
      if (slide) { showSlide(parseInt(slide.getAttribute("data-slide"), 10)); startHeroRotation(); return; }
    });

    $("searchBtn").addEventListener("click", openSearch);
    $("searchClose").addEventListener("click", closeSearch);
    $("searchInput").addEventListener("input", function (e) { runSearch(e.target.value); });
    $("tvBtn").addEventListener("click", function () { setTvMode(!document.body.classList.contains("tv-mode")); });

    window.addEventListener("scroll", function () {
      $("topbar").classList.toggle("is-stuck", window.scrollY > 24);
    }, { passive: true });

    window.addEventListener("hashchange", function () { render(); });

    document.addEventListener("keydown", function (e) {
      var openSheet = !$("sheet").hidden;
      var openSearchPanel = !$("searchPanel").hidden;

      if (e.key === "Escape") {
        if (parseHash().name === "watch") { leaveWatch(); return; }
        if (parseHash().name === "title") { closeDetail(); return; }
        if (openSheet) { closeDetail(); return; }
        if (openSearchPanel) { closeSearch(); return; }
        if (Player.isOpen()) { Player.close(); return; }
      }
      if (Player.isOpen()) return;

      if (e.key === "s" && !openSearchPanel && document.activeElement.tagName !== "INPUT") { e.preventDefault(); openSearch(); return; }
      if (e.key === "t" && document.activeElement.tagName !== "INPUT") { setTvMode(!document.body.classList.contains("tv-mode")); return; }

      if (!document.body.classList.contains("tv-mode")) return;
      if (openSearchPanel) return;
      if (document.activeElement.tagName === "INPUT") return;

      if (document.activeElement && document.activeElement.closest &&
          document.activeElement.closest("#liveGuideItems") &&
          (e.key === "ArrowDown" || e.key === "ArrowUp")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        spatialMove(e.key.replace("Arrow", "").toLowerCase());
      } else if (e.key === "Enter") {
        var focused = document.activeElement;
        if (focused && focused.classList.contains("card")) { e.preventDefault(); openDetail(focused.getAttribute("data-key")); }
      }
    });

    /* idle cursor in TV mode */
    var idleTimer = null;
    function bump() {
      document.body.classList.remove("is-idle");
      clearTimeout(idleTimer);
      if (document.body.classList.contains("tv-mode")) {
        idleTimer = setTimeout(function () { document.body.classList.add("is-idle"); }, 4000);
      }
    }
    ["mousemove", "keydown", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, bump, { passive: true });
    });

    if ($("year")) $("year").textContent = new Date().getFullYear();
  }

  /* ---------------------------------------------------------------- boot */

  function bootCatalog() {
    Api.load().then(function (state) {
      catalog = state;
      source = Api.source;
      document.body.setAttribute("data-boot", "ready");
      render();
      if (source === "snapshot") toast("تعذّر الاتصال — تم فتح النسخة المحفوظة");
    }).catch(function () {
      view.innerHTML = '<div class="empty" style="padding-top:22vh"><strong>تعذّر تحميل المكتبة</strong>' +
        "<p>تحقّق من الاتصال ثم أعد تحميل الصفحة.</p>" +
        '<button class="btn btn--gold" onclick="location.reload()">إعادة المحاولة</button></div>';
    });
  }

  function boot() {
    initTvMode();
    wireGate();
    wireGlobal();

    if (!Store.isActivated()) {
      gateShow();
      return;
    }
    bootCatalog();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* small public surface used by other modules / native shell */
  window.Alezz = {
    toast: toast,
    openDetail: openDetail,
    leaveWatch: leaveWatch,
    openSearch: openSearch,
    play: function (key) { playItem(findItem(key)); },
    setTvMode: setTvMode,
    reload: function () { bootCatalog(); }
  };
})();
