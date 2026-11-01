/* ============================================================================
   AL EZZ TV — catalogue layer
   Reads the public Supabase catalogue (RLS: published rows only) and falls back
   to a bundled snapshot so the app still opens on a TV without connectivity.
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.ALEZZ_CONFIG;
  var API = CFG.supabaseUrl.replace(/\/+$/, "") + "/rest/v1";

  var SELECT = {
    categories: "id,name_ar,sort_order,published",
    movies: "id,title_ar,title_original,description,poster_url,backdrop_url,release_year,category_id,duration_minutes,quality,stream_url,stream_variants,is_kids,age_rating,featured,display_order,status,rights_status,rights_holder,license_reference,youtube_url,country_code,language_code",
    series: "id,title_ar,title_original,description,poster_url,backdrop_url,release_year,category_id,quality,is_kids,age_rating,featured,display_order,status,rights_status,rights_holder,license_reference,country_code,language_code",
    seasons: "id,series_id,number,title_ar",
    episodes: "id,season_id,number,title_ar,description,poster_url,duration_minutes,stream_url,stream_variants,youtube_url,status,rights_status",
    channels: "id,title_ar,description,poster_url,stream_url,category_id,is_kids,country_code,language_code,youtube_url,playback_mode,official_url,age_rating,display_order",
    youtube: "id,youtube_url,title_ar,channel_name,language_code,topic,age_rating,is_kids,sort_order,status",
    collections: "id,title_ar,slug,description,display_order,is_active",
    collection_items: "id,collection_id,movie_id,series_id,channel_id,episode_id,display_order"
  };

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
                   function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function rest(table, params) {
    var qs = Object.keys(params || {}).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    var url = API + "/" + table + "?" + qs;
    var req = fetch(url, {
      headers: {
        /* the publishable key travels in `apikey`; a Bearer header would be
           rejected because this key is not a JWT */
        apikey: CFG.publishableKey,
        Accept: "application/json"
      },
      cache: "no-store",
      credentials: "omit"
    }).then(function (res) {
      if (!res.ok) throw new Error(table + " HTTP " + res.status);
      return res.json();
    });
    return withTimeout(req, CFG.requestTimeout);
  }

  function publishedFilters(table) {
    /* table keys are logical; the REST path prefixes them with aseel_ */
    if (table === "categories") return { select: SELECT.categories, published: "eq.true", order: "sort_order.asc", limit: 500 };
    if (table === "collections") return { select: SELECT.collections, is_active: "eq.true", order: "display_order.asc", limit: 200 };
    if (table === "collection_items") return { select: SELECT.collection_items, order: "display_order.asc", limit: 800 };
    if (table === "seasons") return { select: SELECT.seasons, order: "number.asc", limit: 500 };
    var base = { select: SELECT[table], limit: 800 };
    if (table === "episodes") { base.status = "eq.published"; base.order = "number.asc"; }
    else if (table === "youtube") { base.status = "eq.published"; base.order = "sort_order.asc"; }
    else if (table === "movies" || table === "channels") { base.status = "eq.published"; base.order = "display_order.asc"; }
    else if (table === "series") { base.status = "eq.published"; base.order = "display_order.asc"; }
    return base;
  }

  function loadLive() {
    var tables = ["categories", "movies", "series", "seasons", "episodes", "channels", "youtube", "collections", "collection_items"];
    return Promise.all(tables.map(function (t) {
      return rest("aseel_" + t, publishedFilters(t)).then(function (rows) {
        return Array.isArray(rows) ? rows : [];
      }, function () { return []; });
    })).then(function (results) {
      var out = {};
      tables.forEach(function (t, i) { out[t] = results[i]; });
      if (!out.movies.length && !out.channels.length) throw new Error("empty catalogue");
      return out;
    });
  }

  function loadSnapshot() {
    return fetch(CFG.snapshotUrl, { cache: "force-cache" })
      .then(function (r) { if (!r.ok) throw new Error("snapshot " + r.status); return r.json(); })
      .then(function (json) {
        return {
          categories: json.categories || [],
          movies: json.movies || [],
          series: json.series || [],
          seasons: json.seasons || [],
          episodes: json.episodes || [],
          channels: json.channels || [],
          youtube: json.youtube || [],
          collections: json.collections || [],
          collection_items: json.collection_items || []
        };
      });
  }

  /* ------------------------------------------------------------------ */
  /* normalisation                                                       */
  /* ------------------------------------------------------------------ */

  function youtubeId(url) {
    if (!url) return "";
    var m = String(url).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : "";
  }

  function isHls(url) { return /\.m3u8(\?|#|$)/i.test(url || ""); }

  function normalise(raw) {
    var categories = (raw.categories || []).slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    var catById = {};
    categories.forEach(function (c) { catById[c.id] = c; });

    function base(kind, row) {
      var cat = catById[row.category_id];
      var yt = row.youtube_url ? youtubeId(row.youtube_url) : "";
      return {
        key: kind + ":" + row.id,
        kind: kind,
        id: row.id,
        title: row.title_ar || row.title_original || "بدون عنوان",
        original: row.title_original || "",
        description: row.description || "",
        poster: row.poster_url || null,
        backdrop: row.backdrop_url || null,
        year: row.release_year || null,
        quality: row.quality || null,
        duration: row.duration_minutes || null,
        kids: !!row.is_kids,
        age: row.age_rating || "all",
        categoryId: row.category_id || null,
        category: cat ? cat.name_ar : "",
        featured: !!row.featured,
        country: row.country_code || null,
        language: row.language_code || null,
        stream: row.stream_url || "",
        variants: Array.isArray(row.stream_variants) ? row.stream_variants : [],
        youtubeId: yt,
        rights: {
          status: row.rights_status || null,
          holder: row.rights_holder || null,
          reference: row.license_reference || null
        },
        order: row.display_order || 0
      };
    }

    var movies = (raw.movies || []).map(function (r) { return base("movie", r); });

    var series = (raw.series || []).map(function (r) {
      var item = base("series", r);
      item.seasons = [];
      return item;
    });

    var seriesById = {};
    series.forEach(function (s) { seriesById[s.id] = s; });

    var seasonsById = {};
    (raw.seasons || []).forEach(function (s) {
      var season = { id: s.id, number: s.number || 1, title: s.title_ar || ("الموسم " + (s.number || 1)), episodes: [] };
      seasonsById[s.id] = season;
      var parent = seriesById[s.series_id];
      if (parent) parent.seasons.push(season);
    });

    (raw.episodes || []).forEach(function (e) {
      var season = seasonsById[e.season_id];
      if (!season) return;
      season.episodes.push({
        key: "episode:" + e.id,
        kind: "episode",
        id: e.id,
        number: e.number || 0,
        title: e.title_ar || ("الحلقة " + (e.number || "")),
        description: e.description || "",
        poster: e.poster_url || null,
        duration: e.duration_minutes || null,
        stream: e.stream_url || "",
        variants: Array.isArray(e.stream_variants) ? e.stream_variants : [],
        youtubeId: e.youtube_url ? youtubeId(e.youtube_url) : ""
      });
    });

    series.forEach(function (s) {
      s.seasons.sort(function (a, b) { return a.number - b.number; });
      s.seasons.forEach(function (season) {
        season.episodes.sort(function (a, b) { return a.number - b.number; });
      });
      s.episodeCount = s.seasons.reduce(function (n, season) { return n + season.episodes.length; }, 0);
    });

    var channels = (raw.channels || []).map(function (r) {
      var item = base("channel", r);
      item.live = true;
      item.playback = r.playback_mode || "stream";
      item.official = r.official_url || null;
      return item;
    });

    var youtube = (raw.youtube || []).map(function (r) {
      var id = youtubeId(r.youtube_url);
      return {
        key: "youtube:" + r.id,
        kind: "youtube",
        id: r.id,
        title: r.title_ar || "فيديو",
        original: "",
        description: "",
        poster: id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : null,
        backdrop: id ? "https://i.ytimg.com/vi/" + id + "/maxresdefault.jpg" : null,
        year: null,
        quality: null,
        duration: null,
        kids: !!r.is_kids,
        age: r.age_rating || "all",
        category: r.channel_name || "",
        categoryId: null,
        featured: false,
        stream: "",
        variants: [],
        youtubeId: id,
        topic: r.topic || "",
        language: r.language_code || "ar",
        rights: { status: null, holder: r.channel_name || null, reference: r.youtube_url },
        order: r.sort_order || 0
      };
    });

    var all = movies.concat(series, channels, youtube);

    var byKey = {};
    all.forEach(function (i) { byKey[i.key] = i; });
    movies.forEach(function (m) { if (!byKey["movie:" + m.id]) byKey["movie:" + m.id] = m; });

    /* collections → curated rows */
    var rows = [];
    var collections = (raw.collections || []).slice().sort(function (a, b) {
      return (a.display_order || 0) - (b.display_order || 0);
    });
    collections.forEach(function (c) {
      var items = (raw.collection_items || [])
        .filter(function (it) { return it.collection_id === c.id; })
        .sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); })
        .map(function (it) {
          if (it.movie_id) return byKey["movie:" + it.movie_id];
          if (it.series_id) return byKey["series:" + it.series_id];
          if (it.channel_id) return byKey["channel:" + it.channel_id];
          return null;
        })
        .filter(Boolean)
        .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      if (items.length) rows.push({ id: c.id, title: c.title_ar, subtitle: c.description || "", items: items });
    });

    return {
      categories: categories,
      catById: catById,
      movies: movies,
      series: series,
      channels: channels,
      youtube: youtube,
      items: all,
      byKey: byKey,
      rows: rows
    };
  }

  var Catalog = {
    state: null,
    source: "live",
    loadedAt: null,

    /* returns {catalog, source} */
    load: function () {
      return loadLive().then(function (raw) {
        Catalog.source = "live";
        Catalog.loadedAt = Date.now();
        Catalog.state = normalise(raw);
        return Catalog.state;
      }).catch(function () {
        return loadSnapshot().then(function (raw) {
          Catalog.source = "snapshot";
          Catalog.loadedAt = Date.now();
          Catalog.state = normalise(raw);
          return Catalog.state;
        });
      });
    },

    /* featured titles for the hero */
    featured: function () {
      var s = this.state;
      if (!s) return [];
      var pool = s.movies.concat(s.series).filter(function (i) {
        return i.featured || i.poster || i.backdrop;
      });
      var withArt = pool.filter(function (i) { return i.backdrop || i.poster; });
      var list = (withArt.length ? withArt : pool).slice(0, 6);
      if (list.length < 3) {
        list = list.concat(s.movies.filter(function (m) { return list.indexOf(m) === -1; }).slice(0, 4 - list.length));
      }
      return list;
    },

    search: function (query) {
      var s = this.state;
      if (!s) return [];
      var q = query.trim().toLowerCase();
      if (!q) return [];
      return s.items.filter(function (i) {
        return (i.title + " " + i.original + " " + (i.category || "") + " " + (i.description || ""))
          .toLowerCase().indexOf(q) !== -1;
      }).slice(0, 60);
    },

    byCategory: function (categoryId) {
      var s = this.state;
      if (!s) return [];
      return s.movies.concat(s.series).filter(function (i) { return i.categoryId === categoryId; });
    },

    isHls: isHls,
    youtubeId: youtubeId
  };

  window.AlezzApi = Catalog;
})();
