(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const form = $("titleSearchForm");
  if (!form) return;
  const query = $("titleSearchInput");
  const kind = $("titleSearchKind");
  const status = $("titleSearchStatus");
  const results = $("titleSearchResults");
  const searchButton = $("titleSearchBtn");
  const sourceButton = $("titleSearchFeedsBtn");
  let busy = false;
  let requestId = 0;

  function message(value, error = false) {
    status.textContent = value;
    status.dataset.error = String(error);
  }
  function node(tag, cls, content) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (content !== undefined) element.textContent = String(content);
    return element;
  }
  function setBusy(active) {
    busy = active;
    searchButton.disabled = sourceButton.disabled = active;
    results.querySelectorAll("button").forEach(el => el.disabled = active);
  }
  async function readResponse(res) {
    let body;
    try { body = await res.json(); }
    catch (_) { throw new Error("تعذّر قراءة استجابة استوديو العز"); }
    if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "فشل الطلب (" + res.status + ")");
    return body;
  }
  async function search(includeFeeds = false) {
    const term = query.value.trim();
    if (term.length < 2) return message("اكتب حرفين على الأقل من الاسم", true);
    const sequence = ++requestId;
    setBusy(true);
    message(includeFeeds ? "أبحث في مصادر الفهرسة المسجلة..." : "أبحث في مكتبة العز...");
    try {
      const params = new URLSearchParams({q: term, kind: kind.value, sources: String(includeFeeds)});
      const response = await fetch("/api/title-search?" + params.toString(), {credentials:"same-origin",cache:"no-store"});
      const data = await readResponse(response);
      if (sequence !== requestId) return;
      draw(data.results || []);
      if (!data.count) message(includeFeeds ?
        "ما حصلت عنوانًا مطابقًا في المصادر المسجلة. تقدر تضيف صفحة المصدر من الأسفل." :
        "ما حصلت عنوانًا مطابقًا في مكتبة العز. جرّب زر البحث في المصادر المسجلة أو أضف رابط العمل.");
      else message("وجدت " + data.count + " نتيجة. اختر العمل لجلبه أو جدولة تجديده.");
    } catch (error) {
      message(error.message, true);
      results.replaceChildren();
    } finally {
      setBusy(false);
    }
  }
  function draw(entries) {
    results.replaceChildren();
    if (!entries.length) {
      results.append(node("p","title-finder-empty","لم توجد نتائج مطابقة للاسم حتى الآن."));
      return;
    }
    for (const item of entries) {
      const box = node("article","title-finder-result");
      const info = node("div","title-finder-text");
      info.append(node("strong","",item.title),
        node("small","",(item.kind === "series" ? "مسلسل" : "فيلم") +
          (item.source === "feed" ? " · مرشح من مصدر مسجل" : " · في مكتبة العز") +
          (item.has_source ? " · لديه صفحة أصلية" : " · بلا صفحة أصلية")));
      if (item.original_title) info.append(node("small","",item.original_title));
      const actions = node("div","title-finder-actions");
      if (item.source === "library") {
        const combined = node("button","","جلب + تحديث + تجديد");
        combined.type = "button"; combined.dataset.main = "true";
        combined.onclick = () => refreshItem(item, true);
        actions.append(combined);
        const renew = node("button","","تجديد بالخلفية");
        renew.type = "button"; renew.onclick = () => refreshItem(item, false);
        actions.append(renew);
      } else {
        const importButton = node("button","","جلب للمراجعة");
        importButton.type = "button"; importButton.dataset.main = "true";
        importButton.onclick = () => openOriginal(item);
        actions.append(importButton);
      }
      box.append(info,actions);
      results.append(box);
    }
  }
  function openOriginal(item) {
    if (!item.source_url) return message("لا توجد صفحة مصدر أصلية لهذا العمل. أضفها من إدارة المصادر.",true);
    const sourceInput = $("sourceUrl"), sourceKind = $("sourceKind");
    const discover = $("discoverBtn");
    if (!sourceInput || !sourceKind || !discover) return message("تعذر فتح نموذج الاستيراد",true);
    sourceInput.value = item.source_url;
    sourceKind.value = item.kind;
    message("تم اختيار " + item.title + ". بدأ الاكتشاف بالمحرك الأصلي. راجع النتائج ثم احفظ التعديلات.");
    discover.click();
  }
  async function refreshItem(item, openInStudio) {
    if (busy) return;
    setBusy(true);
    message("أجهّز تجديد " + item.title + " من مصادره المحفوظة...");
    try {
      // /api/init refreshes the same HttpOnly-bound session's CSRF token.
      const initial = await readResponse(await fetch("/api/init", {credentials:"same-origin",cache:"no-store"}));
      const response = await fetch("/api/title-refresh",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json","X-CSRF-Token":initial.csrf},
        body:JSON.stringify({table:item.kind === "movie" ? "aseel_movies" : "aseel_series",id:item.id}),
      });
      const saved = await readResponse(response);
      let note = "جُدول " + saved.queued + " عنصر للتحديث والتجديد بالمحرك القديم.";
      if (saved.missing_episode_sources) note += " " + saved.missing_episode_sources + " حلقة بلا مصدر أصلّي مستقل.";
      if (saved.partial) note += " بعض الحلقات المتبقية ستُراجع عند فحص صفحة المسلسل.";
      if (!saved.worker_enabled || !saved.worker_connected) note += " تنبيه: تأكد من تفعيل عامل المزامنة واتصاله في لوحة المزامنة.";
      message(note);
      if (openInStudio) openOriginal(item);
    } catch (error) {
      message(error.message,true);
    } finally {
      setBusy(false);
    }
  }
  form.addEventListener("submit", event => {event.preventDefault();search(false);});
  sourceButton.addEventListener("click", () => search(true));
})();