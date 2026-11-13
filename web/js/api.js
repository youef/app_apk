/* ============================================================================
   AL EZZ TV — catalogue layer
   Reads the public Supabase catalogue. A failed request can reuse a recently
   fetched table for a limited time.
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.ALEZZ_CONFIG;
  var API = CFG.supabaseUrl.replace(/\/+$/, "") + "/rest/v1";

  var SELECT = {
    categories: "id,name_ar,sort_order,published",
    movies: "id,title_ar,title_original,description,poster_url,backdrop_url,release_year,category_id,duration_minutes,quality,stream_url,stream_variants,subtitle_url,subtitle_language_code,link_health_status,is_kids,age_rating,featured,display_order,status,rights_status,rights_holder,license_reference,youtube_url,country_code,language_code,genre_tags,auto_tags",
    series: "id,title_ar,title_original,description,poster_url,backdrop_url,release_year,category_id,quality,is_kids,age_rating,featured,display_order,status,rights_status,rights_holder,license_reference,country_code,language_code,genre_tags,auto_tags",
    seasons: "id,series_id,number,title_ar",
    episodes: "id,season_id,number,title_ar,description,poster_url,duration_minutes,stream_url,stream_variants,youtube_url,status,link_health_status,rights_status,genre_tags,auto_tags,source_page_url",
    channels: "id,title_ar,description,poster_url,stream_url,official_url,category_id,is_kids,country_code,language_code,youtube_url,playback_mode,status,rights_status,link_health_status,age_rating,display_order,genre_tags,auto_tags",
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
    return withTimeout(req, Math.max(Number(CFG.requestTimeout) || 0, 15000));
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

  /* Logical catalogue names are not always identical to PostgreSQL table names. */
  var TABLE_PATHS = {
    categories: "aseel_categories",
    movies: "aseel_movies",
    series: "aseel_series",
    seasons: "aseel_seasons",
    episodes: "aseel_episodes",
    channels: "aseel_channels",
    youtube: "aseel_youtube_videos",
    collections: "aseel_home_collections",
    collection_items: "aseel_home_collection_items"
  };
  var recentTables = Object.create(null);
  var MAX_OFFLINE_AGE_MS = 15 * 60 * 1000;

  function loadPaged(table) {
    var all = [];
    var settings = publishedFilters(table);
    settings.order += ",id.asc";
    function fetchPage(offset) {
      if (offset >= 10000) return Promise.reject(new Error("Catalogue exceeds the safe page limit"));
      var params = Object.assign({}, settings);
      if (offset) params.offset = offset;
      return rest(TABLE_PATHS[table], params).then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        all = all.concat(rows);
        return rows.length === settings.limit ? fetchPage(offset + settings.limit) : all;
      });
    }
    return fetchPage(0);
  }

  function loadLive() {
    var tables = ["categories", "movies", "series", "seasons", "episodes", "channels", "youtube", "collections", "collection_items"];
    var failedTables = [];
    var usedCache = false;
    return Promise.all(tables.map(function (t) {
      return loadPaged(t).then(function (rows) {
        recentTables[t] = { rows: rows, savedAt: Date.now() };
        return rows;
      }, function () {
        failedTables.push(t);
        var saved = recentTables[t];
        var age = saved ? Date.now() - saved.savedAt : -1;
        if (age >= 0 && age <= MAX_OFFLINE_AGE_MS) {
          usedCache = true;
          return saved.rows;
        }
        delete recentTables[t];
        return [];
      });
    })).then(function (results) {
      var out = {};
      tables.forEach(function (t, i) { out[t] = results[i]; });
      return { rows: out, failedTables: failedTables,
        unavailable: failedTables.length === tables.length, usedCache: usedCache };
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
        genreTags: (row.genre_tags || []).concat(row.auto_tags || []),
        category: cat ? cat.name_ar : "",
        featured: !!row.featured,
        country: row.country_code || null,
        language: row.language_code || null,
        stream: row.stream_url || "",
        variants: Array.isArray(row.stream_variants) ? row.stream_variants : [],
        health: row.link_health_status || "unchecked",
        subtitleTrack: row.subtitle_url || "",
        subtitleLanguage: row.subtitle_language_code || "",
        youtubeId: yt,
        rights: {
          status: row.rights_status || null,
          holder: row.rights_holder || null,
          reference: row.license_reference || null
        },
        order: row.display_order || 0
      };
    }

    // A source-level health flag is a snapshot, not proof that every alternate
    // player is unavailable. Keep published catalogue entries visible and let
    // the video player test licensed direct alternatives when the user selects
    // a title. Never relabel untested sources as healthy.
    function visibleMedia(row) {
      return row && row.status === "published";
    }
    var movies = (raw.movies || []).filter(visibleMedia).map(function (r) { return base("movie", r); });

    var series = (raw.series || []).map(function (r) {
      var item = base("series", r);
      item.seasons = [];
      return item;
    });

    var seriesById = {};
    series.forEach(function (s) { seriesById[s.id] = s; });

    var seasonsById = {};
    (raw.seasons || []).forEach(function (s) {
      var season = { id: s.id, number: s.number || 1, title: s.title_ar || ("الموسم " + (s.number || 1)), episodes: [], poster: null };
      seasonsById[s.id] = season;
      var parent = seriesById[s.series_id];
      if (parent) {
        // No invented image URLs or database writes: episodes can inherit
        // their own series artwork when no episode-specific poster exists.
        season.poster = parent.poster || parent.backdrop || null;
        parent.seasons.push(season);
      }
    });

    (raw.episodes || []).filter(visibleMedia).forEach(function (e) {
      var season = seasonsById[e.season_id];
      if (!season) return;
      season.episodes.push({
        key: "episode:" + e.id,
        kind: "episode",
        id: e.id,
        number: e.number || 0,
        title: e.title_ar || ("الحلقة " + (e.number || "")),
        description: e.description || "",
        poster: e.poster_url || season.poster || null,
        genreTags: (e.genre_tags || []).concat(e.auto_tags || []),
        duration: e.duration_minutes || null,
        stream: e.stream_url || "",
        variants: Array.isArray(e.stream_variants) ? e.stream_variants : [],
        health: e.link_health_status || "unchecked",
        youtubeId: e.youtube_url ? youtubeId(e.youtube_url) : "",
        rightsStatus: e.rights_status || "pending",
        officialPage: /^https:\/\/roya\.tv\/program\/1703\/episodes(?:[?#]|$)/.test(e.source_page_url || "") ? e.source_page_url : ""
      });
    });

    series.forEach(function (s) {
      s.seasons.sort(function (a, b) { return a.number - b.number; });
      s.seasons.forEach(function (season) {
        season.episodes.sort(function (a, b) { return a.number - b.number; });
      });
      s.episodeCount = s.seasons.reduce(function (n, season) { return n + season.episodes.length; }, 0);
    });

    // Publication decides visibility. Broken/missing streams remain visible as
    // unavailable content; the player must assess playback separately.
    var channels = (raw.channels || []).filter(visibleMedia)    }).map(function (r) {
      var item = base("channel", r);
      item.live = true;
      item.playback = r.playback_mode;
      item.official = r.playback_mode === "official_link" ? r.official_url : null;
      return item;
    }).sort(function (a, b) {
      // Keep every channel rail, including the home preview, in Arabic-aware A–Z order.
      var aName = String(a.title || "").trim(), bName = String(b.title || "").trim();
      var order = aName.localeCompare(bName, "ar", { sensitivity: "base", numeric: true });
      return order || String(a.key || "").localeCompare(String(b.key || ""));
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

    // Keep series with published episodes visible. A stale primary-source
    // health flag must not erase all of the series' alternative players.
    var playableSeries = series.filter(function (s) { return s.episodeCount > 0; });
    var all = movies.concat(playableSeries, channels, youtube);

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
      series: playableSeries,
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
    failedTables: [],

    // Read the latest rights-approved playback sources, bypassing stale catalogue
    // snapshots. The upstream signer must be refreshed by its authorised provider.
    freshPlayback: function (kind, id) {
      var name = kind === "movie" ? "movies" : kind === "episode" ? "episodes" : "";
      if (!name || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(id || "")))
        return Promise.resolve(null);
      return rest(TABLE_PATHS[name], {
        select: "id,stream_url,stream_variants,youtube_url,status,rights_status,link_health_status",
        id: "eq." + id, limit: 1
      }).then(function (rows) {
        var row = Array.isArray(rows) && rows[0];
        if (!row || row.status !== "published") return null;
        // Do not turn a suspect/broken source into a verified result. Return
        // the saved alternatives for the first-party player to try normally.
        return { stream: row.stream_url || "", variants: Array.isArray(row.stream_variants) ? row.stream_variants : [],
          health: row.link_health_status || "unchecked",
          youtubeId: row.youtube_url ? youtubeId(row.youtube_url) : "" };
      });
    },

    /* returns {catalog, source} */
    load: function () {
      return loadLive().then(function (result) {
        if (result.unavailable && !result.usedCache && !Catalog.state)
          throw new Error("catalogue unavailable");
        Catalog.source = result.usedCache ? "snapshot" : result.unavailable ? "offline" : "live";
        Catalog.failedTables = result.failedTables;
        Catalog.loadedAt = Date.now();
        Catalog.state = normalise(result.rows);
        return Catalog.state;
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
