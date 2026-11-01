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

  var $ = function (id) { return document.getElementById(id); };
  var view = $("view");
  var catalog = null;
  var source = "live";
  var heroTimer = null;
  var heroIndex = 0;
  var heroItems = [];
  var lastFocus = null;
  var kidsType = "channel", kidsCountry = "", kidsLanguage = "";

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
      '<span class="art__ring"><span class="art__letter">' + esc(letterOf(item)) + "</span></span>" +
      '<span class="art__label">' + esc(label) + "</span></div>";
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
    heroItems = Api.featured();
    if (!heroItems.length) return "";
    var item = heroItems[0];
    return heroHTML(item);
  }

  function heroHTML(item) {
    var backdrop = item.backdrop;
    var media = backdrop
      ? '<div class="hero__media"><img src="' + esc(backdrop) + '" alt="" onerror="this.parentNode.remove()"></div>'
      : '<div class="hero__art" style="background:' + artStyle(item, true) + '"></div>';
    var posterPanel = (!backdrop && item.poster)
      ? '<div class="hero__poster"><img src="' + esc(item.poster) + '" alt="" onerror="this.parentNode.remove()"></div>'
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
    clearInterval(heroTimer);
    heroTimer = setInterval(function () {
      if (document.hidden) return;
      if (!$("hero")) return;
      if (document.querySelector(".sheet:not([hidden]), .searchpanel:not([hidden]), .player:not([hidden])")) return;
      showSlide(heroIndex + 1);
    }, 9000);
  }

  /* ---------------------------------------------------------------- views */

  function continueWatching() {
    var map = Store.progressAll();
    var out = [];
    Object.keys(map).forEach(function (key) {
      var p = map[key];
      if (!p || !p.d) return;
      if (catalog.byKey[key]) out.push({ item: catalog.byKey[key], p: p });
      else out.push({ item: { key: key, id: key, kind: p.kind || "movie", title: p.title || "متابعة", poster: p.poster, duration: 0 }, p: p });
    });
    out.sort(function (a, b) { return (b.p.at || 0) - (a.p.at || 0); });
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
    var rows = [];
    rows.push(continueRail());
    (catalog.rows || []).slice(0, 4).forEach(function (row) {
      rows.push(railHTML(row.title, row.items, { subtitle: row.subtitle }));
    });
    rows.push(railHTML("أفلام تستحق المشاهدة", catalog.movies.filter(function (m) { return m.poster || m.description; }).slice(0, 18), { more: "#/movies", subtitle: "مختارات من المكتبة المرخّصة" }));
    rows.push(railHTML("مسلسلات وحكايات", catalog.series, { more: "#/series", subtitle: "مواسم وحلقات متتابعة" }));
    rows.push(railHTML("على الهواء الآن", catalog.channels, { more: "#/live", subtitle: "بث مباشر من المصادر الرسمية" }));
    rows.push(railHTML("وثائقيات من العالم", catalog.channels.filter(function(c){return c.categoryId==="d7070bfe-19e2-403d-97de-ef2d26614624";}).slice(0,18), { more: "#/live/d7070bfe-19e2-403d-97de-ef2d26614624", subtitle: "طبيعة وتاريخ وعلوم وثقافات — يتوفر البث حسب منطقتك" }));
    rows.push(railHTML("رياضة حول العالم", catalog.channels.filter(function(c){return c.categoryId==="146b8c7f-8e03-45ee-aa4f-2d8ab20e6c95";}).slice(0,20), { more: "#/live/146b8c7f-8e03-45ee-aa4f-2d8ab20e6c95", subtitle: "قنوات رياضية دولية • بث متاح حسب الدولة" }));
    rows.push(railHTML("beIN SPORTS — القنوات الرسمية", catalog.channels.filter(function(c){return c.categoryId==="f30c2110-ae62-47c4-99e4-b45762bde695";}).slice(0,20), { more: "#/live/f30c2110-ae62-47c4-99e4-b45762bde695", subtitle: "روابط مشاهدة رسمية • القنوات المشفرة تتطلب اشتراك beIN" }));
    var kidsCount = catalog.items.filter(function (i) { return i.kids; }).length;
    if (kidsCount) rows.push(railHTML("عالم الأطفال", catalog.items.filter(function (i) { return i.kids; }).slice(0, 18), { more: "#/kids", subtitle: "محتوى عائلي آمن" }));
    if (catalog.youtube.length) rows.push(railHTML("يوتيوب العز", catalog.youtube, { more: "#/youtube", subtitle: "فيديوهات رسمية مختارة" }));
    rows.push(railHTML("قنوات إخبارية", catalog.channels.filter(function (c) { return /أخبار|بث حي|الجزيرة|العربية|BBC|TRT|فرانس|سي جي تي/i.test(c.title + c.description); }).slice(0, 14)));

    return renderHero() + bannerHTML() + rows.join("") + "";
  }

  function pageHead(title, subtitle, count) {
    return '<div class="pagehead"><h1>' + esc(title) + "</h1>" +
      (subtitle ? "<p>" + esc(subtitle) + "</p>" : "") +
      (count != null ? '<p style="margin-top:6px;color:var(--gold);font-size:12px;letter-spacing:2px">' + count + " عمل</p>" : "") +
      "</div>";
  }

  function filterBar(categories, active, kind) {
    var items = ['<button class="filter' + (!active ? " is-on" : "") + '" data-filter="">الكل</button>'];
    categories.forEach(function (c) {
      items.push('<button class="filter' + (active === c.id ? " is-on" : "") + '" data-filter="' + esc(c.id) + '">' + esc(c.name_ar) + "</button>");
    });
    return '<div class="filters">' + items.join("") + "</div>";
  }

  function viewMovies(filterCat) {
    var list = catalog.movies;
    var cats = catalog.categories.filter(function (c) {
      return list.some(function (m) { return m.categoryId === c.id; });
    });
    var shown = filterCat ? list.filter(function (m) { return m.categoryId === filterCat; }) : list;
    return pageHead("الأفلام", "أفلام كاملة ومقاطع سينمائية من مصادر موثقة.", shown.length) +
      filterBar(cats, filterCat) +
      (shown.length ? gridHTML(shown) : emptyHTML("لا توجد أفلام في هذا التصنيف بعد."));
  }

  function viewSeries() {
    return pageHead("المسلسلات", "مواسم وحلقات مرتبة، مع متابعة تلقائية للحلقة.", catalog.series.length) +
      (catalog.series.length ? gridHTML(catalog.series) : emptyHTML("لم تُنشر مسلسلات بعد."));
  }

  function viewLive(filterCat) {
    if (Live) return Live.render(catalog, filterCat);
    var list = catalog.channels;
    var cats = catalog.categories.filter(function (c) { return list.some(function (x) { return x.categoryId === c.id; }); });
    var shown = filterCat ? list.filter(function (c) { return c.categoryId === filterCat; }) : list;
    return pageHead("البث المباشر", "قنوات مجانية أو يبثها ناشرها علنًا. قد تختلف الإتاحة بحسب البلد والجهاز.", shown.length) +
      filterBar(cats, filterCat) +
      (shown.length ? '<div class="grid grid--wide">' + shown.map(function (c) { return cardHTML(c, { wide: true }); }).join("") + "</div>" : emptyHTML("لا قنوات متاحة."));
  }

  function viewKids() {
    var all = catalog.items.filter(function (i) { return i.kids; });
    var channelItems=all.filter(function (i) {return i.kind==="channel";});
    var countries=[],languages=[];
    channelItems.forEach(function (i) {
      if(i.country && countries.indexOf(i.country)===-1)countries.push(i.country);
      if(i.language && languages.indexOf(i.language)===-1)languages.push(i.language);
    });
    countries.sort();languages.sort();
    var list=all.filter(function (i) {
      return (!kidsType || kidsType==="all" ||
        (kidsType==="channel"?i.kind==="channel":i.kind!=="channel")) &&
        (!kidsCountry || i.country===kidsCountry) &&
        (!kidsLanguage || i.language===kidsLanguage);
    });
    list.sort(function (a,b) {return a.title.localeCompare(b.title,"ar")});
    function options(values,selected) {
      return values.map(function (v) {
        return '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(v)+'</option>';
      }).join("");
    }
    var filters='<div style="display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 23px">'+
      '<label style="display:grid;gap:6px">النوع<select id="kidsTypeFilter" style="padding:10px;color:inherit;background:#191e29;border:1px solid #515663;border-radius:10px">'+
      '<option value="channel"'+(kidsType==="channel"?' selected':'')+'>قنوات الأطفال</option>'+
      '<option value="other"'+(kidsType==="other"?' selected':'')+'>أفلام ومسلسلات</option>'+
      '<option value="all"'+(kidsType==="all"?' selected':'')+'>كل محتوى الأطفال</option></select></label>'+
      '<label style="display:grid;gap:6px">الدولة<select id="kidsCountryFilter" style="padding:10px;color:inherit;background:#191e29;border:1px solid #515663;border-radius:10px">'+
      '<option value="">كل الدول</option>'+options(countries,kidsCountry)+'</select></label>'+
      '<label style="display:grid;gap:6px">اللغة<select id="kidsLanguageFilter" style="padding:10px;color:inherit;background:#191e29;border:1px solid #515663;border-radius:10px">'+
      '<option value="">كل اللغات</option>'+options(languages,kidsLanguage)+'</select></label></div>';
    return pageHead("عالم الأطفال", "قنوات وبرامج مجانية عبر مواقع الجهات الرسمية. قد يختلف التوفر حسب البلد.", list.length) +
      filters+(list.length ? gridHTML(list) : emptyHTML("لا يوجد محتوى يطابق الفلاتر."));
  }

  function viewYoutube() {
    var head = pageHead("يوتيوب العز", "فيديوهات رسمية تُعرض عبر مشغل YouTube الرسمي.", catalog.youtube.length);
    if (catalog.youtube.length) {
      return head + '<div class="grid grid--wide">' +
        catalog.youtube.map(function (v) { return cardHTML(v, { wide: true }); }).join("") + "</div>";
    }
    if (Api.failedTables && Api.failedTables.indexOf("youtube") !== -1) {
      return head + '<div class="empty"><strong>تعذّر تحميل فيديوهات يوتيوب</strong>' +
        '<p>تعذّر الاتصال بمكتبة المقاطع. تحقق من الإنترنت ثم أعد المحاولة.</p>' +
        '<button class="btn btn--gold" type="button" onclick="location.reload()">تحديث المكتبة</button></div>';
    }
    return head + emptyHTML("لا فيديوهات منشورة حاليًا.");
  }

  function viewMyList() {
    var keys = Store.favorites();
    var items = keys.map(function (k) { return catalog.byKey[k]; }).filter(Boolean);
    var cont = continueWatching().map(function (e) { return e.item; });
    var seen = {};
    var all = items.concat(cont).filter(function (i) { if (seen[i.key]) return false; seen[i.key] = true; return true; });
    return pageHead("قائمتي", "المحفوظات وآخر ما شاهدت، محليًا على هذا الجهاز.", all.length) +
      (all.length ? gridHTML(all) : emptyHTML("قائمتك فارغة — أضف أعمالًا من زر «قائمتي»."));
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
    var y = window.scrollY;
    var route = parseHash();
    var html = "";

    if (!catalog) { view.innerHTML = skeletonHTML(); return; }
    if (Live) Live.destroy();

    switch (route.name) {
      case "movies": html = viewMovies(route.arg); break;
      case "series": html = viewSeries(); break;
      case "live": html = viewLive(route.arg); break;
      case "kids": html = viewKids(); break;
      case "youtube": html = viewYoutube(); break;
      case "mylist": html = viewMyList(); break;
      case "title": html = viewHome(); break;
      case "search": html = viewHome(); break;
      default: html = viewHome();
    }

    view.innerHTML = html;
    setNav(route.name);
    if (preserveScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
    startHeroRotation();
    wireRails();
    if (route.name === "live" && Live) Live.mount();
    if (route.name === "title" && route.arg) {
      setTimeout(function () { openDetail(route.arg); }, 50);
    }
  }

  function setNav(name) {
    var map = { home: "home", movies: "movies", series: "series", live: "live", kids: "kids", youtube: "youtube", mylist: "mylist" };
    var active = map[name] || "home";
    Array.prototype.forEach.call(document.querySelectorAll(".nav__link"), function (a) {
      a.classList.toggle("is-active", a.getAttribute("data-nav") === active);
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

  function sourceLabel(item) {
    if (item.kind === "channel" && item.playback === "official_link") return "رابط جهة البث الرسمية (تنقل خارجي)";
    if (item.youtubeId) return "YouTube (تضمين رسمي)";
    if (item.live) return "بث مباشر من الناشر";
    if (item.stream && /\.mp4/i.test(item.stream)) return "ملف MP4 مباشر";
    if (item.stream && /\.m3u8/i.test(item.stream)) return "بث HLS";
    return item.stream ? "مصدر خارجي" : "غير متوفر";
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
    if (item.country) meta.push(["البلد", item.country]);
    if (item.language) meta.push(["اللغة", item.language]);
    meta.push(["المصدر", sourceLabel(item)]);
    if (item.rights && item.rights.holder) meta.push(["صاحب الحقوق", item.rights.holder]);
    if (item.live) meta.push(["النوع", isOfficial ? "رابط للموقع الرسمي" : "قناة مباشرة"]);

    var epsHTML = "";
    if (item.kind === "series" && item.seasons && item.seasons.length) {
      var firstSeason = item.seasons[0];
      epsHTML = '<div class="eps"><div class="eps__head"><h3>الحلقات</h3><div class="seasons">' +
        item.seasons.map(function (s, i) {
          return '<button class="filter' + (i === 0 ? " is-on" : "") + '" data-season="' + esc(s.id) + '">' + esc(s.title) + "</button>";
        }).join("") + "</div></div>" +
        '<div id="epList">' + episodesHTML(firstSeason) + "</div></div>";
    }

    return '<div class="detail__hero">' +
      (backdrop ? '<img src="' + esc(backdrop) + '" alt="" onerror="this.remove()">' :
        '<div class="hero__art" style="background:' + artStyle(item, true) + '"></div>') +
      '<button class="detail__close" data-close-sheet aria-label="إغلاق"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      "</div>" +
      '<div class="detail__body"><div class="detail__head">' +
      '<div class="detail__poster">' + (item.poster ? '<img src="' + esc(item.poster) + '" alt="" onerror="this.remove()">' : art(item)) + "</div>" +
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
      return '<button class="ep" data-ep="' + esc(e.key) + '">' +
        '<span class="ep__num">' + esc(e.number || "•") + "</span>" +
        '<span class="ep__txt"><strong>' + esc(e.title) + "</strong><span>" + esc(e.description || "اضغط للتشغيل") + "</span></span>" +
        (e.duration ? '<span class="ep__dur">' + esc(fmtDuration(e.duration)) + "</span>" : "") +
        "</button>";
    }).join("");
  }

  function openDetail(key) {
    var item = findItem(key);
    if (!item) { toast("هذا العنصر لم يعد متوفرًا", "err"); return; }
    lastFocus = document.activeElement;
    var sheet = $("sheet");
    $("sheetPanel").innerHTML = detailHTML(item);
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    $("sheetPanel").scrollTop = 0;
    var closeBtn = sheet.querySelector("[data-close-sheet]");
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function closeDetail() {
    var sheet = $("sheet");
    if (sheet.hidden) return;
    sheet.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
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
    if (item.kind === "series" && !item.stream && !item.youtubeId) {
      var first = null;
      (item.seasons || []).forEach(function (s) {
        if (!first && s.episodes && s.episodes.length) first = s.episodes[0];
      });
      if (first) { playEpisode(first.key); return; }
      toast("لا توجد حلقات منشورة لهذا المسلسل بعد", "err");
      return;
    }

    var payload = {
      key: item.key, kind: item.kind, title: item.title, subtitle: kindLabel(item.kind) + (item.year ? " · " + item.year : ""),
      poster: item.poster, art: artStyle(item), stream: item.stream, youtubeId: item.youtubeId,
      live: !!item.live, quality: item.quality, kids: item.kids, age: item.age
    };
    if (opts.resumeAt) payload.resumeAt = opts.resumeAt;

    if (window.AlezzNative && window.AlezzNative.playMedia) {
      window.AlezzNative.playMedia(JSON.stringify(payload));
      return;
    }
    var saved = Store.progress(item.key);
    if (!opts.restart && saved && saved.t > 5) payload.resumeAt = saved.t;
    Player.open(payload, { next: opts.next || null });
    closeDetail();
  }

  function playEpisode(epKey) {
    var series = null, episode = null, list = [];
    catalog.series.forEach(function (s) {
      s.seasons.forEach(function (season) {
        season.episodes.forEach(function (e) {
          if (e.key === epKey) { episode = e; series = s; list = season.episodes; }
        });
      });
    });
    if (!episode) return;
    var idx = list.indexOf(episode);
    var next = list[idx + 1] || null;
    var payload = {
      key: episode.key, kind: "episode", title: series.title + " — " + episode.title,
      subtitle: series.title, poster: series.poster, art: artStyle(series),
      stream: episode.stream, youtubeId: episode.youtubeId, live: false,
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
      poster: series.poster, stream: next.stream, youtubeId: next.youtubeId, art: artStyle(series)
    } : null });
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
      (thumb ? '<img loading="lazy" src="' + esc(thumb) + '" alt="" onerror="this.remove()">' : art(item)) + "</span>" +
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
    var auto = window.matchMedia && window.matchMedia("(hover: none) and (min-width: 900px)").matches;
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
      if(!e.target || !e.target.id)return;
      if(e.target.id==="kidsTypeFilter") {kidsType=e.target.value;kidsCountry="";kidsLanguage="";render(true);}
      else if(e.target.id==="kidsCountryFilter"){kidsCountry=e.target.value;render(true);}
      else if(e.target.id==="kidsLanguageFilter"){kidsLanguage=e.target.value;render(true);}
    });
    document.addEventListener("click", function (e) {
      var t = e.target;

      // The live guide owns its own buttons and event handling.
      if (t.closest("#livePage")) return;
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
        if (!$("sheet").hidden && item) $("sheetPanel").innerHTML = detailHTML(item);
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
        var host = $("epList");
        if (host && catalog) {
          catalog.series.forEach(function (s) {
            s.seasons.forEach(function (season) {
              if (season.id === sid) host.innerHTML = episodesHTML(season);
            });
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

    $("year").textContent = new Date().getFullYear();
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
    openSearch: openSearch,
    play: function (key) { playItem(findItem(key)); },
    setTvMode: setTvMode,
    reload: function () { bootCatalog(); }
  };
})();
