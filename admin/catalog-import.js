"use strict";
(function () {
  const cfg = window.ALEZZ_ADMIN_CONFIG;
  const el = id => document.getElementById(id);
  let admin = false, busy = false, cancelled = false, manifest = null;
  let report = [];
  const counters = { series_created: 0, series_updated: 0, movies_created: 0, movies_updated: 0, seasons_created: 0, seasons_updated: 0, episodes_created: 0, episodes_updated: 0, skipped: 0, errors: 0 };

  function message(value, tone) {
    el("message").textContent = value;
    el("message").dataset.tone = tone || "info";
  }
  function session() {
    try { return JSON.parse(localStorage.getItem(cfg.storagePrefix + "session") || "null"); }
    catch (_) { return null; }
  }
  function validUrl(value, label) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 2048) throw Error(label + ": رابط HTTPS غير صحيح.");
    let url;
    try { url = new URL(value); } catch (_) { throw Error(label + ": رابط غير صالح."); }
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname || url.hash) {
      throw Error(label + ": مطلوب HTTPS دون بيانات دخول أو fragment.");
    }
    return url.href;
  }
  function str(value, label, max, required) {
    if (value === undefined || value === null) value = "";
    if (typeof value !== "string") throw Error(label + ": النص غير صالح.");
    const result = value.trim();
    if (result.length > max || (required && !result)) throw Error(label + ": طول النص غير صالح.");
    return result;
  }
  function integer(value, label, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) throw Error(label + ": رقم غير صالح.");
    return value;
  }
  function uuid(value, label) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw Error(label + ": معرّف UUID غير صالح.");
    }
    return value.toLowerCase();
  }
  function metadata(item, title, year, source) {
    const tags = item.genre_tags || [];
    if (!Array.isArray(tags) || tags.length > 12 ||
        tags.some(x => typeof x !== "string" || !/^[a-z]{2,20}$/.test(x))) {
      throw Error(title + ": التصنيفات يجب أن تكون رموزًا إنجليزية.");
    }
    const country = str(item.country_code || "", title + ": الدولة", 2).toUpperCase() || null;
    if (country && !/^[A-Z]{2}$/.test(country)) throw Error(title + ": رمز الدولة غير صالح.");
    const quality = item.quality == null ? null : str(item.quality, title + ": الجودة", 3, true);
    if (quality && !["SD","HD","FHD","4K"].includes(quality)) throw Error(title + ": الجودة غير مدعومة.");
    const age = item.age_rating == null ? null : str(item.age_rating, title + ": العمر", 3, true);
    if (age && !["all","7+","13+","16+","18+"].includes(age)) throw Error(title + ": تصنيف العمر غير مدعوم.");
    return {
      id: uuid(item.id, title + ": المعرف"),
      title_ar: title, release_year: year, country_code: country, source_page_url: source,
      description: str(item.description || "", title + ": الوصف", 2000),
      poster_url: validUrl(item.poster_url, title + ": البوستر"),
      backdrop_url: validUrl(item.backdrop_url, title + ": الخلفية"),
      genre_tags: [...new Set(tags)], quality, age_rating: age
    };
  }
  function parse(input) {
    const sources = Array.isArray(input) ? input : input && (input.series || []);
    const movies = Array.isArray(input) ? [] : input && (input.movies || []);
    if (!Array.isArray(sources) || !Array.isArray(movies) ||
        !sources.length && !movies.length || sources.length + movies.length > 500) {
      throw Error("الملف يجب أن يحتوي على series و/أو movies، بحد أقصى 500 عمل.");
    }
    const out = [], keys = new Set();
    let episodeTotal = 0;
    for (const [i, item] of sources.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("سجل مسلسل غير صالح رقم " + (i + 1));
      const title = str(item.title_ar, "اسم المسلسل", 250, true);
      const year = item.release_year == null ? null : integer(item.release_year, title + ": سنة الإنتاج", 1880, 2100);
      const source = validUrl(item.source_page_url, title + ": صفحة المصدر");
      const key = "series:" + (source || title.toLocaleLowerCase("ar") + "|" + (year || ""));
      if (keys.has(key)) throw Error(title + ": نسخة مكررة داخل الملف.");
      keys.add(key);
      const s = metadata(item, title, year, source);
      if (!Array.isArray(item.seasons || [])) throw Error(title + ": seasons ليست قائمة.");
      const seasons = [], seasonKeys = new Set();
      for (const season of item.seasons || []) {
        if (!season || typeof season !== "object") throw Error(title + ": موسم غير صالح.");
        const sn = integer(season.number, title + ": الموسم", 1, 99);
        if (seasonKeys.has(sn)) throw Error(title + ": الموسم " + sn + " مكرر.");
        seasonKeys.add(sn);
        const eps = season.episodes || [];
        if (!Array.isArray(eps) || eps.length > 2000) throw Error(title + ": عدد حلقات الموسم غير صالح.");
        const episodes = [], epKeys = new Set();
        for (const ep of eps) {
          if (!ep || typeof ep !== "object") throw Error(title + ": حلقة غير صالحة.");
          const number = integer(ep.number, title + ": رقم الحلقة", 1, 2000);
          if (epKeys.has(number)) throw Error(title + ": تكرار الحلقة " + number + " بالموسم " + sn);
          epKeys.add(number);
          episodes.push({
            number, title_ar: str(ep.title_ar || "الحلقة " + number, "عنوان الحلقة", 250, true),
            description: str(ep.description || "", title + ": وصف الحلقة", 1800),
            stream_url: validUrl(ep.stream_url, title + ": رابط الفيديو"),
            source_page_url: validUrl(ep.source_page_url, title + ": رابط مصدر الحلقة"),
            poster_url: validUrl(ep.poster_url, title + ": صورة الحلقة")
          });
          episodeTotal++;
          if (episodeTotal > 30000) throw Error("الحد الأقصى 30 ألف حلقة في الملف الواحد.");
        }
        seasons.push({ number: sn, title_ar: str(season.title_ar || "الموسم " + sn, "عنوان الموسم", 250), episodes });
      }
      out.push({ type: "series", series: s, seasons });
    }
    for (const item of movies) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("سجل فيلم غير صالح.");
      const title = str(item.title_ar, "اسم الفيلم", 250, true);
      const year = item.release_year == null ? null : integer(item.release_year, title + ": سنة الإصدار", 1880, 2100);
      const source = validUrl(item.source_page_url, title + ": صفحة المصدر");
      const key = "movie:" + (source || title.toLocaleLowerCase("ar") + "|" + (year || ""));
      if (keys.has(key)) throw Error(title + ": نسخة مكررة داخل الملف.");
      keys.add(key);
      const movie = metadata(item, title, year, source);
      movie.stream_url = validUrl(item.stream_url, title + ": رابط التشغيل");
      movie.duration_minutes = item.duration_minutes == null ? null :
        integer(item.duration_minutes, title + ": مدة الفيلم", 1, 99999);
      out.push({ type: "movie", movie });
    }
    return out;
  }
  function counts() {
    el("seriesCount").textContent = manifest ? manifest.filter(x => x.type === "series").length : "0";
    el("movieCount").textContent = manifest ? manifest.filter(x => x.type === "movie").length : "0";
    el("seasonCount").textContent = manifest ? manifest.reduce((n, x) => n + (x.seasons?.length || 0), 0) : "0";
    el("episodeCount").textContent = manifest ? manifest.reduce((n, x) =>
      n + (x.seasons || []).reduce((m, y) => m + y.episodes.length, 0), 0) : "0";
    el("start").disabled = !admin || busy || !manifest || !el("rights").checked;
    el("stop").disabled = !busy;
    el("report").disabled = report.length === 0;
    el("previewButton").disabled = busy;
    el("catalogFile").disabled = busy;
    el("updateExisting").disabled = busy;
    el("updateStreams").disabled = busy;
  }
  function preview() {
    const list = el("preview");
    list.replaceChildren();
    if (!manifest) { counts(); return; }
    for (const work of manifest.slice(0, 12)) {
      const item = work.type === "movie" ? work.movie : work.series;
      const card = document.createElement("div");
      card.className = "item";
      const label = document.createElement("b");
      label.textContent = (work.type === "movie" ? "🎬 " : "📺 ") + item.title_ar;
      const detail = document.createElement("small");
      const episodeCount = (work.seasons || []).reduce((n, s) => n + s.episodes.length, 0);
      detail.textContent = (item.release_year || "بدون سنة") + " · " +
        (work.type === "movie" ? "فيلم · " + (item.stream_url ? "رابط تشغيل مُدخل" : "بيانات فقط") :
        work.seasons.length + " موسم · " + episodeCount + " حلقة");
      card.append(label, detail);
      list.append(card);
    }
    if (manifest.length > 12) {
      const rest = document.createElement("div");
      rest.className = "item";
      rest.textContent = "و" + (manifest.length - 12) + " عملًا آخر في الملف";
      list.append(rest);
    }
    counts();
  }
  async function rest(table, params, options) {
    const s = session();
    if (!s || !s.access_token) throw Error("انتهت جلسة الإدارة. سجل الدخول مرة أخرى.");
    const query = new URLSearchParams(params || {});
    const url = cfg.supabaseUrl + "/rest/v1/" + table + (query.toString() ? "?" + query : "");
    const opts = options || {};
    const headers = {
      "apikey": cfg.publishableKey,
      "Authorization": "Bearer " + s.access_token,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Prefer": opts.prefer || "return=representation"
    };
    const response = await fetch(url, {
      method: opts.method || "GET", headers,
      body: opts.data !== undefined ? JSON.stringify(opts.data) : undefined,
      cache: "no-store"
    });
    const body = await response.text();
    let parsed;
    try { parsed = body ? JSON.parse(body) : []; }
    catch (_) { parsed = { error: body.slice(0, 200) }; }
    if (!response.ok) {
      throw Error(table + " — " + (parsed.message || parsed.error || "HTTP " + response.status));
    }
    return parsed;
  }
  async function findOne(table, filters, select) {
    const rows = await rest(table, { ...filters, select: select || "id", limit: "2" });
    if (!Array.isArray(rows) || rows.length > 1) throw Error("تكرار غير متوقع في " + table + "؛ راجع البيانات يدويًا.");
    return rows[0] || null;
  }
  async function insertOne(table, data) {
    const rows = await rest(table, null, { method: "POST", data });
    if (!Array.isArray(rows) || !rows[0]?.id) throw Error("فشل تأكيد إنشاء " + table);
    return rows[0];
  }
  function providedFields(row, excludeStream) {
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "id" || (excludeStream && key === "stream_url")) continue;
      if (value === null || value === undefined || value === "" ||
          (Array.isArray(value) && value.length === 0)) continue;
      result[key] = value;
    }
    return result;
  }
  function different(left, right) {
    return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);
  }
  async function patchChanged(table, old, fields, allowPlayback) {
    if (!old) return false;
    const safe = providedFields(fields, !allowPlayback);
    // Metadata imports never modify rights, approval, status, account IDs or publish flags.
    const patch = {};
    for (const [key, value] of Object.entries(safe)) {
      if (key === "source_page_url" && old.source_page_url && old.source_page_url !== value &&
          !fields.id) continue;
      if (different(old[key], value)) patch[key] = value;
    }
    if (patch.stream_url && different(patch.stream_url, old.stream_url)) {
      patch.link_health_status = "unchecked";
      patch.link_health_checked_at = null;
      patch.link_health_failures = 0;
      patch.link_health_reason = "تم تغيير رابط الفيديو من كتالوج مرخّص؛ يحتاج فحص تشغيل جديد";
      patch.link_health_url = null;
    }
    if (!Object.keys(patch).length) return false;
    const rows = await rest(table, {id: "eq." + old.id}, {
      method: "PATCH", data: patch, prefer: "return=representation"
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== old.id) {
      throw Error("لم تؤكد قاعدة البيانات تعديل " + table + "؛ راجع صلاحيات المسؤول.");
    }
    return true;
  }
  const seriesSelect = "id,title_ar,release_year,description,source_page_url,country_code,poster_url,backdrop_url,genre_tags,quality,age_rating";
  const movieSelect = seriesSelect + ",stream_url,duration_minutes,link_health_status";
  async function lookupWork(table, item, select) {
    if (item.id) {
      const found = await findOne(table, {id: "eq." + item.id}, select);
      if (!found) throw Error("المعرّف المحدد لا يوجد في " + table + "، لن يُنشأ سجل آخر.");
      return found;
    }
    let existing = item.source_page_url ?
      await findOne(table, {source_page_url: "eq." + item.source_page_url}, select) : null;
    if (!existing) {
      const filter = {title_ar: "eq." + item.title_ar};
      if (item.release_year) filter.release_year = "eq." + item.release_year;
      existing = await findOne(table, filter, select);
    }
    return existing;
  }
  async function existingEpisodes(seasonId) {
    const episodes = new Map();
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const rows = await rest("aseel_episodes", {
        season_id: "eq." + seasonId,
        select: "id,number,title_ar,description,poster_url,source_page_url,stream_url,link_health_status",
        order: "number.asc", limit: "500", offset: String(offset)
      });
      if (!Array.isArray(rows)) throw Error("تعذر قراءة حلقات الموسم الموجودة.");
      rows.forEach(row => episodes.set(row.number, row));
      if (rows.length < 500) return episodes;
      offset += 500;
    }
    throw Error("لا يمكن جلب جميع حلقات الموسم بأمان بسبب حد الصفحات.");
  }
  function pushReport(title, state, details) {
    report.push({ title, state, details });
    el("activity").textContent = "تمت معالجة " + report.length + " / " + (manifest ? manifest.length : 0) +
      " · المسلسلات: " + counters.series_created + " جديد، " + counters.series_updated + " محدّث" +
      " · الأفلام: " + counters.movies_created + " جديد، " + counters.movies_updated + " محدّث" +
      " · الحلقات: " + counters.episodes_created + " جديد، " + counters.episodes_updated + " محدّث" +
      " · دون تغيير: " + counters.skipped +
      " · أخطاء: " + counters.errors +
      "\nآخر عمل: " + title + " — " + state;
    el("progress").value = manifest ? Math.round(100 * report.length / manifest.length) : 0;
    counts();
  }
  async function importOne(work) {
    const allowUpdate = el("updateExisting").checked;
    const allowStream = allowUpdate && el("updateStreams").checked;
    const row = work.type === "movie" ? work.movie : work.series;
    const isMovie = work.type === "movie";
    const table = isMovie ? "aseel_movies" : "aseel_series";
    const existing = await lookupWork(table, row, isMovie ? movieSelect : seriesSelect);
    let id;
    if (existing) {
      id = existing.id;
      if (allowUpdate) {
        const updated = await patchChanged(table, existing, row, allowStream);
        if (updated) counters[isMovie ? "movies_updated" : "series_updated"]++;
        else counters.skipped++;
      } else counters.skipped++;
    } else {
      const data = providedFields(row, false);
      const created = await insertOne(table, {
        ...data, status: "draft", rights_status: "pending",
        ...(isMovie ? {link_health_status: "unchecked"} : {quick_published: false})
      });
      id = created.id;
      counters[isMovie ? "movies_created" : "series_created"]++;
    }
    if (isMovie) return existing ? "تحديث الفيلم أو الاحتفاظ ببياناته" : "إضافة فيلم كمسودة";
    for (const season of work.seasons) {
      if (cancelled) return "توقف بعد العمل الجاري";
      let seasonRow = await findOne("aseel_seasons", {
        series_id: "eq." + id, number: "eq." + season.number
      }, "id,number,title_ar");
      if (!seasonRow) {
        seasonRow = await insertOne("aseel_seasons", {
          series_id: id, number: season.number, title_ar: season.title_ar
        });
        counters.seasons_created++;
      } else if (allowUpdate && season.title_ar &&
                 await patchChanged("aseel_seasons", seasonRow, {title_ar: season.title_ar}, false)) {
        counters.seasons_updated++;
      }
      const present = await existingEpisodes(seasonRow.id);
      const fresh = [];
      for (const ep of season.episodes) {
        const old = present.get(ep.number);
        if (!old) {
          fresh.push(ep);
        } else if (allowUpdate) {
          const updated = await patchChanged("aseel_episodes", old, ep, allowStream);
          if (updated) counters.episodes_updated++;
          else counters.skipped++;
        } else counters.skipped++;
      }
      for (let idx = 0; idx < fresh.length; idx += 50) {
        if (cancelled) return "توقف بعد حفظ الحلقات الحالية";
        const chunk = fresh.slice(idx, idx + 50).map(ep => ({
          ...providedFields(ep, false), number: ep.number,
          season_id: seasonRow.id, status: "draft", rights_status: "pending",
          link_health_status: "unchecked"
        }));
        const inserted = await rest("aseel_episodes", {on_conflict: "season_id,number"}, {
          method: "POST", prefer: "resolution=ignore-duplicates,return=representation", data: chunk
        });
        if (!Array.isArray(inserted)) throw Error("تعذّر تأكيد حفظ حلقات الموسم.");
        counters.episodes_created += inserted.length;
        counters.skipped += chunk.length - inserted.length;
      }
    }
    return existing ? "مزامنة مواسم وحلقات المسلسل" : "إضافة مسلسل جديد كمسودة";
  }
  async function checkAdmin() {
    const s = session();
    if (!s?.access_token || !s?.user_id) {
      message("يرجى تسجيل الدخول إلى إدارة العز TV أولًا.", "error");
      return;
    }
    try {
      const rows = await rest("aseel_admins", { select: "active", user_id: "eq." + s.user_id, limit: "1" });
      if (!Array.isArray(rows) || !rows.some(row => row.active)) throw Error("لا توجد صلاحية إدارة نشطة لهذا الحساب.");
      admin = true;
      message("تم التحقق من صلاحيات الإدارة. اختر ملف JSON مرخّصًا لمعاينته.", "success");
    } catch (err) {
      message("تعذر التحقق من الإدارة: " + err.message, "error");
    }
    counts();
  }
  async function load() {
    manifest = null;
    report = [];
    el("progress").value = 0;
    el("activity").textContent = "";
    for (const key of Object.keys(counters)) counters[key] = 0;
    const file = el("catalogFile").files?.[0];
    if (!file) { message("اختر ملف JSON أولًا.", "error"); preview(); return; }
    if (file.size > 15 * 1024 * 1024) { message("حجم الملف يتجاوز 15 ميغابايت.", "error"); preview(); return; }
    try {
      manifest = parse(JSON.parse(await file.text()));
      preview();
      message("نجح فحص الملف دون تكرار؛ يمكنك تحديث بيانات الأعمال الموجودة وإضافة الأعمال الجديدة كمسودات. اختر خيارات التحديث أولًا.", "success");
    } catch (error) {
      preview();
      message("فشل فحص الملف: " + error.message, "error");
    }
  }
  async function start() {
    if (!admin || busy || !manifest || !el("rights").checked) return;
    if (!window.confirm("ستُحفظ الأعمال الجديدة كمسودات. تحديث البيانات القديمة يحفظ حالة النشر والحقوق، وتحديث رابط تشغيل قائم يجعله غير مفحوص. متابعة؟")) return;
    busy = true; cancelled = false;
    report = [];
    for (const key of Object.keys(counters)) counters[key] = 0;
    el("progress").value = 0;
    counts();
    message("جارٍ استيراد البيانات وفق صلاحيات الإدارة. يمكنك الإيقاف بين الدفعات.", "info");
    for (const item of manifest) {
      if (cancelled) break;
      try {
        const detail = await importOne(item);
        pushReport((item.series || item.movie).title_ar, "نجاح", detail);
      } catch (error) {
        counters.errors++;
        pushReport((item.series || item.movie).title_ar, "خطأ", error.message);
      }
    }
    busy = false;
    counts();
    message((cancelled ? "توقف الاستيراد. " : "انتهى التحديث. ") +
      "مسلسلات: " + counters.series_created + " جديد و" + counters.series_updated + " محدّث؛ " +
      "أفلام: " + counters.movies_created + " جديد و" + counters.movies_updated + " محدّث؛ " +
      "حلقات: " + counters.episodes_created + " جديد و" + counters.episodes_updated + " محدّث؛ " +
      "أخطاء: " + counters.errors + ". الأعمال الجديدة مسودات، وحالة الحقوق السابقة محفوظة.",
      counters.errors ? "error" : "success");
  }
  function download(data, filename, type) {
    const object = URL.createObjectURL(new Blob([data], { type }));
    const link = document.createElement("a");
    link.href = object; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(object), 3000);
  }
  function sample() {
    const example = { series: [{
      title_ar: "مثال لمسلسل مرخّص", release_year: 2026, country_code: "SA",
      description: "بيانات مقدمة من صاحب الحقوق",
      poster_url: "https://licensed.example.org/series/poster.jpg",
      source_page_url: "https://licensed.example.org/series/1",
      genre_tags: ["drama"],
      seasons: [{ number: 1, episodes: [
        { number: 1, description: "يمكن تحديث وصف الحلقة", stream_url: "https://licensed.example.org/series/1/ep1.m3u8" },
        { number: 2, stream_url: "https://licensed.example.org/series/1/ep2.m3u8" }
      ] }]
    }], movies: [{
      title_ar: "مثال لفيلم مرخّص", release_year: 2026, country_code: "SA",
      source_page_url: "https://licensed.example.org/movies/1",
      stream_url: "https://licensed.example.org/movies/1.m3u8",
      description: "البيانات قابلة للتعديل عند إعادة استيراد الملف"
    }] };
    download(JSON.stringify(example, null, 2), "al-ezz-licensed-catalog-example.json", "application/json;charset=utf-8");
  }
  function exportReport() {
    const head = ["title", "state", "details"];
    const csv = [head, ...report.map(x => [x.title, x.state, x.details])]
      .map(row => row.map(x => '"' + String(x || "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
    download("\uFEFF" + csv, "al-ezz-catalog-report.csv", "text/csv;charset=utf-8");
  }

  el("catalogFile").addEventListener("change", () => {
    manifest = null;
    report = [];
    preview();
    message("تم اختيار الملف. اضغط «فحص الملف ومعاينته».", "info");
  });
  el("previewButton").addEventListener("click", load);
  el("rights").addEventListener("change", counts);
  el("sample").addEventListener("click", sample);
  el("start").addEventListener("click", start);
  el("stop").addEventListener("click", () => {
    cancelled = true;
    message("سيوقف الاستيراد عند انتهاء الطلب الجاري، دون حذف ما حفظ سابقًا.", "info");
  });
  el("report").addEventListener("click", exportReport);
  counts();
  checkAdmin();
})();
