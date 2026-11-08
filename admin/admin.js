/* ==========================================================================
   AL EZZ Studio — admin logic
   Auth (Supabase), REST data layer, routing, tables, drawer forms, toasts.
   No frameworks, no build step. UI strings are Arabic; comments are English.
   ========================================================================== */
(function () {
  'use strict';

  var cfg = window.ALEZZ_ADMIN_CONFIG;
  var TOKEN_KEY = cfg.storagePrefix + 'session';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- icons ---------- */
  var ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    tv: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="m8 3 4 4 4-4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/>',
    layout: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/>',
    tag: '<path d="M20.6 13.6 13 21a2 2 0 0 1-2.8 0L3 13.8V4h9.8l7.8 7.8a1.3 1.3 0 0 1 0 1.8Z"/><circle cx="8" cy="9" r="1.4"/>',
    shield: '<path d="M12 3 5 6v6c0 4.2 3 8 7 9 4-1 7-4.8 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/>',
    edit: '<path d="m4 20 4.5-1 9.6-9.6a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.4 4.3"/><path d="M6.3 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.4 0 2.7-.3 3.8-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
    inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 13 6 5h12l2 8v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z"/>'
  };

  function icon(name, size) {
    var s = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true" focusable="false">' +
      (ICONS[name] || '') + '</svg>';
  }

  /* ---------- tiny DOM helper ---------- */
  function el(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'style') node.setAttribute('style', value);
        else if (key === 'dataset') Object.keys(value).forEach(function (dk) { node.dataset[dk] = value[dk]; });
        else if (key === 'type') node.setAttribute('type', value);
        else if (key === 'colspan') node.setAttribute('colspan', value);
        else if (key === 'for') node.setAttribute('for', value);
        else if (key === 'role' || key === 'scope' || key.indexOf('aria-') === 0) node.setAttribute(key, value);
        else node[key] = value;
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) { child.forEach(function (c) { if (c !== null && c !== undefined) node.append(c); }); continue; }
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function formatNumber(n) { return Number(n || 0).toLocaleString('en-US'); }
  function isHttps(value) { return /^https:\/\/[^\s]+$/i.test(String(value || '')); }
  function fmtDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('en-CA');
  }

  /* ---------- application state ---------- */
  var state = {
    session: null,
    adminVerified: false,
    section: null,
    table: null,
    rows: [],
    selectedChannels: {},
    selectedMedia: {},
    selectedOther: {},
    filteredChannels: [],
    filteredMedia: [],
    filteredOther: [],
    deleteTargets: null,
    deleteBusy: false,
    deletePhrase: 'حذف',
    bulkBusy: false,
    healthOnly: false,
    scanBusy: false,
    scanCancelled: false,
    query: '',
    statusFilter: '',
    options: {},
    optionsTried: {},
    editing: null,
    saving: false,
    deleteTarget: null,
    deleteTable: null,
    loadToken: 0,
    lastFocus: null,
    els: {}
  };

  /* ---------- storage ---------- */
  function readSession() {
    try {
      var raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.access_token ? parsed : null;
    } catch (e) { return null; }
  }
  function writeSession(session) {
    state.session = session;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(session)); } catch (e) { /* storage full/private mode */ }
  }
  function clearSession() {
    state.session = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  /* ---------- toasts ---------- */
  function toast(message, type) {
    var host = $('#toasts');
    if (!host) return;
    var node = el('div', { class: 'toast toast--' + (type || 'info'), role: 'status' });
    node.append(el('span', { class: 'toast-dot', 'aria-hidden': 'true' }));
    node.append(el('span', { class: 'toast-text' }, message));
    var close = el('button', { class: 'toast-close', type: 'button', 'aria-label': 'إغلاق التنبيه', html: icon('close', 14) });
    node.append(close);
    var gone = false;
    var dismiss = function () {
      if (gone) return;
      gone = true;
      node.classList.add('is-out');
      setTimeout(function () { node.remove(); }, 260);
    };
    close.addEventListener('click', dismiss);
    host.append(node);
    setTimeout(dismiss, type === 'error' ? 7000 : 4200);
  }

  /* ---------- errors ---------- */
  function describeError(err) {
    if (!err) return 'حدث خطأ غير متوقع.';
    if (err.network) return 'لا يمكن الوصول إلى خادم Supabase. تحقّق من اتصال الإنترنت ثم أعد المحاولة.';
    if (err.status === 401) return 'انتهت الجلسة أو رُفضت المصادقة — سجّل الدخول من جديد.';
    if (err.status === 403 || /row-level security|permission denied|rls|not authorized/i.test(err.message || '')) {
      return 'تم رفض العملية — تحقّق من سياسات RLS أو صلاحية المسؤول.';
    }
    if (err.status === 409) return 'تعارض في البيانات: قد يكون السجل موجودًا مسبقًا.';
    return err.message || 'فشل الطلب غير المتوقع.';
  }

  /* ---------- REST layer ---------- */
  function api(path, options) {
    var opts = options || {};
    var url = cfg.supabaseUrl + '/rest/v1/' + path;
    var headers = Object.assign({
      apikey: cfg.publishableKey,
      Authorization: 'Bearer ' + (state.session ? state.session.access_token : ''),
      'Content-Type': 'application/json'
    }, opts.headers || {});
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, cfg.requestTimeout);

    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      cache: 'no-store'
    }).then(function (response) {
      if (response.status === 401 && !opts.retried) {
        return refreshSession().then(function (ok) {
          if (ok) {
            var retry = Object.assign({}, opts, { retried: true });
            return api(path, retry);
          }
          sessionExpired();
          var err = new Error('انتهت الجلسة — سجّل الدخول من جديد.');
          err.status = 401;
          throw err;
        });
      }
      return response.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
        if (!response.ok) {
          var detail = (data && (data.message || data.error_description || data.hint || data.error)) || text || ('HTTP ' + response.status);
          var err = new Error(String(detail).slice(0, 400));
          err.status = response.status;
          throw err;
        }
        return data;
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        var timeoutErr = new Error('انتهت مهلة الاتصال بالخادم.');
        timeoutErr.network = true;
        throw timeoutErr;
      }
      if (err && !err.status && err instanceof TypeError) err.network = true;
      throw err;
    }).finally(function () { clearTimeout(timer); });
  }

  function restList(table, query) { return api(table + '?' + query); }
  function restInsert(table, payload) {
    return api(table, { method: 'POST', body: payload, headers: { Prefer: 'return=representation' } });
  }
  function restUpdate(table, id, payload) {
    return api(table + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: payload, headers: { Prefer: 'return=representation' } });
  }
  function restDelete(table, id) {
    return api(table + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  }

  /* ---------- auth ---------- */
  var refreshInFlight = null;
  function refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    var current = state.session;
    if (!current || !current.refresh_token) return Promise.resolve(false);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, cfg.requestTimeout);
    refreshInFlight = fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
      signal: controller.signal
    }).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) return false;
        var data = null;
        try { data = JSON.parse(text); } catch (e) { return false; }
        if (!data || !data.access_token || state.session !== current) return false;
        writeSession(Object.assign({}, current, {
          access_token: data.access_token,
          refresh_token: data.refresh_token || current.refresh_token,
          expires_at: Date.now() + Number(data.expires_in || 3600) * 1000
        }));
        return true;
      });
    }).catch(function () { return false; }).finally(function () {
      clearTimeout(timer);
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  function signIn(email, password) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, cfg.requestTimeout);
    return fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey },
      body: JSON.stringify({ email: email, password: password }),
      signal: controller.signal
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* non-JSON auth error */ }
        if (!res.ok || !data || !data.access_token) {
          var message = (data && (data.error_description || data.msg || data.message)) || 'تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور.';
          var err = new Error(message);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        var timeoutErr = new Error('انتهت مهلة الاتصال بخادم المصادقة.');
        timeoutErr.network = true;
        throw timeoutErr;
      }
      if (err && !err.status && err instanceof TypeError) {
        err.network = true;
        err.message = 'تعذر الاتصال بخادم المصادقة — تحقق من الإنترنت.';
      }
      throw err;
    }).finally(function () { clearTimeout(timer); });
  }

  var expiredHandled = false;
  function sessionExpired() {
    if (expiredHandled) return;
    expiredHandled = true;
    clearSession();
    showLogin();
    toast('انتهت الجلسة — سجّل الدخول من جديد.', 'error');
    setTimeout(function () { expiredHandled = false; }, 2000);
  }

  function verifyAdmin() {
    if (!state.session) return Promise.resolve();
    var uid = state.session.user_id;
    var banner = $('#adminWarning');
    if (!uid) { showAdminWarning('تعذر التحقق من هوية الحساب. قد تُرفض عمليات الكتابة.'); return Promise.resolve(); }
    return api('aseel_admins?select=user_id,active&user_id=eq.' + encodeURIComponent(uid)).then(function (rows) {
      var allowed = Array.isArray(rows) && rows.some(function (row) {
        return row && (row.active === true || row.active === 1 || row.active === 'true');
      });
      if (allowed) {
        state.adminVerified = true;
        if (banner) banner.hidden = true;
        syncBulkDeleteButton();
      } else {
        state.adminVerified = false;
        showAdminWarning('لا يوجد سجل نشط لهذا الحساب في جدول aseel_admins. الجلسة صالحة لكن الكتابة قد تُرفض — راجع صلاحيات المسؤول.');
      }
    }).catch(function () {
      state.adminVerified = false;
      showAdminWarning('تعذر التحقق من صلاحية الإدارة في aseel_admins (الجدول محمي بسياسات RLS). الجلسة صالحة، لكن عمليات الكتابة قد تُرفض.');
    });
  }

  function showAdminWarning(message) {
    var banner = $('#adminWarning');
    var text = $('#adminWarningText');
    if (!banner || !text) return;
    text.textContent = message;
    banner.hidden = false;
  }

  /* ---------- option sources ---------- */
  var OPTION_SOURCES = {
    categories: {
      table: 'aseel_categories', query: 'select=id,name_ar&order=sort_order.asc&limit=300',
      label: function (r) { return r.name_ar; }
    },
    series: {
      table: 'aseel_series', query: 'select=id,title_ar&order=title_ar.asc&limit=400',
      label: function (r) { return r.title_ar; }
    },
    seasons: {
      table: 'aseel_seasons', query: 'select=id,number,series_id&order=number.asc&limit=800',
      label: function (r) {
        var series = (state.options.series || []).filter(function (s) { return s.value === r.series_id; })[0];
        return 'الموسم ' + r.number + (series ? ' — ' + series.label : '');
      }
    },
    sources: {
      table: 'aseel_content_sources', query: 'select=id,title,verified&limit=300',
      label: function (r) { return r.title; }
    },
    collections: {
      table: 'aseel_home_collections', query: 'select=id,title_ar&order=display_order.asc&limit=300',
      label: function (r) { return r.title_ar; }
    },
    movies: {
      table: 'aseel_movies', query: 'select=id,title_ar&order=title_ar.asc&limit=500',
      label: function (r) { return r.title_ar; }
    },
    channels: {
      table: 'aseel_channels', query: 'select=id,title_ar&order=title_ar.asc&limit=400',
      label: function (r) { return r.title_ar; }
    },
    episodes: {
      table: 'aseel_episodes', query: 'select=id,number,title_ar,season_id&limit=800',
      label: function (r) { return '#' + r.number + ' ' + r.title_ar; }
    }
  };

  function ensureOptions(sources) {
    var pending = (sources || []).filter(function (s) { return !state.options[s] && !state.optionsTried[s]; });
    if (!pending.length) return Promise.resolve();
    return Promise.all(pending.map(function (source) {
      state.optionsTried[source] = true;
      var def = OPTION_SOURCES[source];
      if (!def) { state.options[source] = []; return Promise.resolve(); }
      var ready = source === 'seasons' ? ensureOptions(['series']) : Promise.resolve();
      return ready.then(function () {
        return restList(def.table, def.query);
      }).then(function (rows) {
        state.options[source] = (Array.isArray(rows) ? rows : []).map(function (row) {
          return { value: row.id, label: def.label(row) };
        });
      }).catch(function () {
        state.options[source] = [];
      });
    }));
  }

  function optionLabel(source, value) {
    if (!value) return '—';
    var list = state.options[source] || [];
    var found = list.filter(function (item) { return item.value === value; })[0];
    return found ? found.label : '—';
  }

  function clearOptions() {
    state.options = {};
    state.optionsTried = {};
  }

  function neededSources(table) {
    var set = {};
    table.fields.forEach(function (f) { if (f.source) set[f.source] = true; });
    table.columns.forEach(function (c) { if (c.source) set[c.source] = true; });
    if (set.seasons) set.series = true;
    return Object.keys(set);
  }

  /* ---------- shell ---------- */
  function renderNav() {
    var nav = $('#nav');
    if (!nav) return;
    nav.replaceChildren();
    cfg.sections.forEach(function (section) {
      var button = el('button', { class: 'nav-item', type: 'button' });
      var iconSpan = el('span', { class: 'nav-icon', html: icon(section.icon, 19) });
      button.append(iconSpan, el('span', { class: 'nav-label' }, section.label));
      button.addEventListener('click', function () { openSection(section.id); });
      section._navButton = button;
      nav.append(button);
    });
  }

  function navActive(id) {
    cfg.sections.forEach(function (section) {
      if (!section._navButton) return;
      var active = section.id === id;
      section._navButton.classList.toggle('is-active', active);
      if (active) section._navButton.setAttribute('aria-current', 'page');
      else section._navButton.removeAttribute('aria-current');
    });
  }

  function showApp() {
    $('#loginScreen').hidden = true;
    $('#appScreen').hidden = false;
    document.body.classList.add('is-app');
    $('#accountEmail').textContent = state.session ? state.session.email : '';
    var view = $('#view');
    if (view && !view.childElementCount) view.replaceChildren();
  }

  function showLogin() {
    $('#appScreen').hidden = true;
    $('#loginScreen').hidden = false;
    document.body.classList.remove('is-app');
    $('#accountEmail').textContent = '';
    closeDrawer(true);
    closeDeleteModal(true);
  }

  function sectionFromHash() {
    var id = (location.hash || '').replace(/^#/, '');
    var match = cfg.sections.filter(function (s) { return s.id === id; })[0];
    return match ? match.id : 'dashboard';
  }

  function openSection(id, options) {
    var opts = options || {};
    var section = cfg.sections.filter(function (s) { return s.id === id; })[0] || cfg.sections[0];
    if ($('#drawer') && !$('#drawer').hidden) closeDrawer(true);
    if ($('#deleteModal') && !$('#deleteModal').hidden) closeDeleteModal(true);
    state.section = section;
    state.query = '';
    state.statusFilter = '';
    state.selectedChannels = {};
    state.selectedMedia = {};

    var globalSearch = $('#globalSearch');
    if (globalSearch) globalSearch.value = '';

    navActive(section.id);
    $('#pageTitle').textContent = section.title || section.label;
    $('#pageCrumb').textContent = section.subtitle || '';
    document.title = (section.title || section.label) + ' — العز TV';

    if (opts.push !== false) {
      var hash = '#' + section.id;
      if (location.hash !== hash) {
        try { history.replaceState(null, '', hash); } catch (e) { /* file:// may block history */ }
      }
    }

    if (section.id === 'dashboard') renderDashboard();
    else renderSection(section);
  }

  /* ---------- media health monitor ---------- */
  function hasLinkHealth(tableCfg) {
    return !!tableCfg && ['aseel_channels', 'aseel_movies', 'aseel_episodes', 'aseel_series', 'aseel_youtube_videos'].indexOf(tableCfg.table) !== -1;
  }
  function invokeLinkHealth(payload, retry) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 65000);
    return fetch(cfg.supabaseUrl + '/functions/v1/aseel-link-health', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + state.session.access_token,
        apikey: cfg.publishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store'
    }).then(function (response) {
      if ((response.status === 401 || response.status === 403) && !retry) {
        // The Edge function can return 403 for an expired JWT; retry once
        // with a fresh token before interpreting this as revoked admin access.
        return refreshSession().then(function (ok) {
          if (ok) return invokeLinkHealth(payload, true);
          if (response.status === 401) sessionExpired();
          var error = new Error(response.status === 403
            ? 'تعذر تأكيد صلاحية المسؤول في دالة الفحص؛ تحقق من حساب Supabase.'
            : 'انتهت جلسة Supabase. سجّل الدخول مرة أخرى.');
          error.status = response.status;
          throw error;
        });
      }
      return response.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (err) {
          var invalid = new Error('استجاب خادم الفحص برد غير مفهوم (HTTP ' + response.status + ').');
          invalid.status = response.status;
          throw invalid;
        }
        // 207 means some items failed, not that the entire scan failed.
        if (!response.ok && response.status !== 207) {
          var failure = new Error(data.error || data.message || 'فشل الفحص HTTP ' + response.status);
          failure.status = response.status;
          throw failure;
        }
        return data;
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('انتهت مهلة فحص المصادر. جرب دفعة أصغر بعد قليل، ولم تُغيّر حالة الروابط غير المفحوصة.');
      }
      if (err && err instanceof TypeError && !err.status) {
        throw new Error('تعذّر الاتصال بدالة فحص الروابط. تحقق من اتصال الإنترنت وإعداد CORS أو حالة Supabase، ثم أعد المحاولة.');
      }
      throw err;
    }).finally(function () { clearTimeout(timer); });
  }


  /* Scan actual episodes in authenticated batches; never delete or alter source URLs. */
  async function seriesEpisodeIds(seriesId, drafts) {
    var seasonFilter = '';
    if (seriesId) {
      var seasons = await restList('aseel_seasons',
        'select=id&series_id=eq.' + encodeURIComponent(seriesId) + '&limit=1000');
      if (!Array.isArray(seasons) || !seasons.length) return [];
      if (seasons.length === 1000) throw new Error('عدد المواسم كبير؛ افحص قسمًا أصغر.');
      seasonFilter = '&season_id=in.(' + seasons.map(function (row) { return row.id; }).join(',') + ')';
    }
    var ids = [], offset = 0, size = 400;
    for (;;) {
      var query = 'select=id,status&order=id.asc&limit=' + size + '&offset=' + offset +
        (drafts ? '' : '&status=eq.published') + seasonFilter;
      var batch = await restList('aseel_episodes', query);
      if (!Array.isArray(batch)) throw new Error('تعذر جلب قائمة الحلقات.');
      batch.forEach(function (row) { if (row.id) ids.push(row.id); });
      if (batch.length < size) return ids;
      offset += size;
      if (offset >= 10000) throw new Error('تجاوزت المكتبة حد الفحص الآمن؛ افحص مسلسلًا واحدًا.');
    }
  }

  async function runSeriesHealthScan(seriesId, seriesName) {
    if (state.scanBusy || !state.session || !state.adminVerified) {
      toast('يلزم حساب مسؤول، ويجب اكتمال الفحص السابق أولًا.', 'error'); return;
    }
    var tableAtStart = state.table;
    state.scanBusy = true; state.scanCancelled = false;
    var button = $('#healthScanNow'), cancel = $('#healthStopScan');
    if (button) { button.disabled = true; button.textContent = 'جارٍ فحص الحلقات…'; }
    if (cancel) { cancel.hidden = false; cancel.disabled = false; cancel.textContent = 'إيقاف الفحص'; }
    var drafts = !!($('#healthIncludeDrafts') && $('#healthIncludeDrafts').checked);
    var completed = 0, total = 0, results = {healthy:0,suspect:0,broken:0,unchecked:0}, errors = [];
    function progress(note) {
      if (state.table !== tableAtStart) return;
      var output = $('#healthMessage'), bar = $('#healthProgress'), report = $('#healthReport');
      if (output) output.textContent = note;
      if (bar) { bar.hidden = false; bar.max = Math.max(total,1); bar.value = completed; }
      if (report) {
        report.hidden = !errors.length;
        var details = $('#healthReportText');
        if (details) details.textContent = errors.slice(-40).join('\n');
      }
    }
    try {
      progress('جارٍ تحميل الحلقات من قاعدة البيانات…');
      var ids = await seriesEpisodeIds(seriesId, drafts);
      total = ids.length;
      for (var i=0; i<ids.length && !state.scanCancelled; i+=6) {
        var chunk = ids.slice(i,i+6);
        try {
          var info = await invokeLinkHealth({mode:'episodes',episode_ids:chunk}, false);
          if (!Array.isArray(info.results)) throw new Error('لم تُرجع الدالة قائمة نتائج.');
          info.results.forEach(function (row) {
            if (info.errors && info.errors[row.id]) return;
            var status = row.link_health_status || 'unchecked';
            results[status] = (results[status] || 0) + 1;
          });
          Object.keys(info.errors || {}).forEach(function (id) {
            errors.push('حلقة ' + id.slice(0,8) + ': ' + String(info.errors[id]).slice(0,180));
          });
          if (info.results.length < chunk.length) errors.push('لم يُستلم تقرير لبعض حلقات الدفعة.');
        } catch (e) {
          errors.push('دفعة ' + (Math.floor(i/6)+1) + ': ' + describeError(e));
          if (e.status === 401 || e.status === 403) state.scanCancelled = true;
        }
        completed += chunk.length;
        progress('التقدم: ' + completed + '/' + total + ' حلقة · صالح: ' + results.healthy +
          ' · قيد التحقق: ' + results.suspect + ' · معطوب: ' + results.broken +
          (errors.length ? ' · أخطاء: ' + errors.length : ''));
      }
      try { await invokeLinkHealth({mode:'series'}, false); }
      catch (e) { errors.push('تحديث المسلسلات: ' + describeError(e)); }
      var summary = (state.scanCancelled ? 'تم إيقاف' : 'اكتمل') + ' فحص ' +
        (seriesName || 'المسلسلات') + ': ' + completed + ' من ' + total + ' حلقة. ' +
        'سليم ' + results.healthy + '، يحتاج مراجعة ' + results.suspect +
        '، معطوب ' + results.broken + (errors.length ? '، أخطاء ' + errors.length : '') + '.';
      progress(total ? summary : 'لم توجد حلقات ' + (drafts ? '' : 'منشورة ') + 'في هذا النطاق.');
      toast(summary, errors.length ? 'error' : 'success');
      if (state.table === tableAtStart) loadTable(tableAtStart);
    } catch (e) {
      errors.push(describeError(e));
      progress('تعذّر بدء فحص الحلقات: ' + describeError(e));
      toast('فشل فحص الحلقات: ' + describeError(e), 'error');
    } finally {
      state.scanBusy = false; state.scanCancelled = false;
      if (cancel) cancel.hidden = true;
      if (button) { button.disabled = false; button.textContent = 'فحص حلقات المسلسلات'; }
    }
  }


  /* Complete-section scan, bounded and cancellable. Exact IDs prevent repeated
     scans of failing rows and ensure no item is silently skipped. */
  async function healthTableIds(table, drafts) {
    if (table === 'aseel_episodes') return seriesEpisodeIds(null,drafts);
    if (['aseel_movies','aseel_channels','aseel_youtube_videos'].indexOf(table) === -1)
      throw new Error('القسم لا يدعم الفحص الشامل.');
    var ids = [], offset = 0, size = 400;
    for (;;) {
      var page = await restList(table,'select=id&order=id.asc&limit=' + size +
        '&offset=' + offset + (drafts ? '' : '&status=eq.published'));
      if (!Array.isArray(page)) throw new Error('فشل تحميل سجلات القسم.');
      page.forEach(function (row) { if (row.id) ids.push(row.id); });
      if (page.length < size) return ids;
      offset += size;
      if (offset >= 10000) throw new Error('القسم كبير جدًا. افحصه على مجموعات أصغر.');
    }
  }

  async function runFullHealthScan() {
    if (state.scanBusy || !state.session || !state.adminVerified) {
      toast('يلزم حساب مسؤول، ويجب اكتمال الفحص السابق أولًا.','error'); return;
    }
    var startedAt = state.table, table = startedAt && startedAt.table;
    if (table === 'aseel_series') { runSeriesHealthScan(null,''); return; }
    state.scanBusy=true;state.scanCancelled=false;
    var button=$('#healthScanAll'), cancel=$('#healthStopScan'), failures=[], done=0,total=0;
    var totals={healthy:0,suspect:0,broken:0,unchecked:0};
    var drafts=!!($('#healthIncludeDrafts')&&$('#healthIncludeDrafts').checked);
    if(button){button.disabled=true;button.textContent='جارٍ الفحص الشامل…';}
    if(cancel){cancel.hidden=false;cancel.disabled=false;cancel.textContent='إيقاف الفحص';}
    function renderProgress(text){
      if(state.table!==startedAt)return;
      var status=$('#healthMessage'),bar=$('#healthProgress'),details=$('#healthReport');
      if(status)status.textContent=text;
      if(bar){bar.hidden=false;bar.max=Math.max(total,1);bar.value=done;}
      if(details){
        details.hidden=!failures.length;
        if($('#healthReportText'))$('#healthReportText').textContent=failures.slice(-40).join('\n');
      }
    }
    try{
      renderProgress('جارٍ حصر عناصر القسم…');
      var ids=await healthTableIds(table,drafts);total=ids.length;
      for(var i=0;i<ids.length&&!state.scanCancelled;i+=6){
        var chunk=ids.slice(i,i+6);
        try{
          var data=await invokeLinkHealth({mode:'items',table:table,item_ids:chunk},false);
          if(!Array.isArray(data.results))throw new Error('الدالة لم تُرجع نتائج الفحص.');
          var errors=data.errors||{};
          data.results.forEach(function(item){
            if(errors[item.id])return; // old status is not evidence of a new scan.
            var key=item.link_health_status||'unchecked';
            totals[key]=(totals[key]||0)+1;
          });
          Object.keys(errors).forEach(function(id){
            failures.push('عنصر '+id.slice(0,8)+': '+String(errors[id]).slice(0,160));
          });
          if(data.results.length<chunk.length)failures.push('تعذر الحصول على نتائج لبعض عناصر الدفعة.');
        }catch(error){
          failures.push('دفعة '+(Math.floor(i/6)+1)+': '+describeError(error));
          if(error.status===401||error.status===403)state.scanCancelled=true;
        }
        done+=chunk.length;
        renderProgress('فحص '+done+'/'+total+' · صالح '+totals.healthy+
          ' · غير حاسم '+totals.suspect+' · معطوب '+totals.broken+
          (failures.length?' · أخطاء '+failures.length:''));
      }
      if(table==='aseel_episodes'){
        try{await invokeLinkHealth({mode:'series'},false);}
        catch(e){failures.push('تحديث حالات المسلسلات: '+describeError(e));}
      }
      var summary=(state.scanCancelled?'أُوقف':'اكتمل')+' الفحص الشامل لقسم '+startedAt.label+
        ': '+done+'/'+total+' · صالح '+totals.healthy+' · يحتاج مراجعة '+totals.suspect+
        ' · معطوب '+totals.broken+
        (failures.length?' · أخطاء '+failures.length:'')+'.';
      renderProgress(total?summary:'لا يوجد محتوى '+(drafts?'':'منشور ')+'يحتاج للفحص.');
      toast(summary,failures.length?'error':'success');
      if(state.table===startedAt)loadTable(startedAt);
    }catch(e){
      failures.push(describeError(e));
      renderProgress('تعذر الفحص الشامل: '+describeError(e));
      toast('تعذر الفحص الشامل: '+describeError(e),'error');
    }finally{
      state.scanBusy=false;state.scanCancelled=false;
      if(cancel)cancel.hidden=true;
      if(button){button.disabled=false;button.textContent='فحص كامل القسم';}
    }
  }

  function runLinkHealthScan() {
    if (state.scanBusy || !state.adminVerified || !state.session) {
      toast('يلزم تسجيل دخول مسؤول لإجراء الفحص.', 'error');
      return;
    }
    var activeTable = state.table && state.table.table;
    if (activeTable === 'aseel_series') { runSeriesHealthScan(null, ''); return; }
    var supported = ['aseel_channels', 'aseel_movies', 'aseel_episodes', 'aseel_youtube_videos'];
    var payload = { table: supported.indexOf(activeTable) !== -1 ? activeTable : 'aseel_channels', per_table: 12 };
    var button = $('#healthScanNow'), message = $('#healthMessage');
    state.scanBusy = true;
    if (button) { button.disabled = true; button.textContent = 'جارٍ فحص الروابط…'; }
    if (message) message.textContent = 'جارٍ فحص حتى 12 عنصرًا من هذا القسم دون حذف أو تغيير روابط…';
    invokeLinkHealth(payload, false).then(function (data) {
      var summary = 'تم فحص ' + Number(data.scanned || 0) + ' عنصر؛ صالح: ' + Number(data.healthy || 0) +
        '، قيد التحقق: ' + Number(data.suspect || 0) + '، معطوب: ' + Number(data.broken || 0) + '.';
      if (data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length)) {
        summary += ' بعض المصادر تعذر فحصها؛ راجع أسبابها وأعد المحاولة.';
      }
      if (message) message.textContent = summary;
      toast(summary, 'success');
      if (hasLinkHealth(state.table)) loadTable(state.table);
    }).catch(function (err) {
      var text = 'تعذّر الفحص: ' + describeError(err);
      if (message) message.textContent = text;
      toast(text, 'error');
      // A failed network request is not proof the stream is broken.
    }).finally(function () {
      state.scanBusy = false;
      if (button) { button.disabled = false; button.textContent = 'فحص 12 رابطًا الآن'; }
    });
  }

  /* ---------- section + table rendering ---------- */
  function renderSection(section) {
    if (state.scanBusy) state.scanCancelled = true;
    var view = $('#view');
    view.replaceChildren();

    var head = el('div', { class: 'view-head' });
    var headText = el('div', { class: 'view-head-text' });
    headText.append(el('p', { class: 'eyebrow' }, section.id.toUpperCase()));
    headText.append(el('h2', { class: 'view-title' }, section.title || section.label));
    headText.append(el('p', { class: 'view-sub' }, section.subtitle || ''));

    var headActions = el('div', { class: 'view-actions' });
    var refreshBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' });
    refreshBtn.append(el('span', { class: 'btn-icon', html: icon('refresh', 15) }), el('span', null, 'تحديث'));
    var newBtn = el('button', { class: 'btn btn-gold btn-sm', type: 'button' });
    newBtn.append(el('span', { class: 'btn-icon', html: icon('plus', 16) }), el('span', null, 'إضافة'));
    headActions.append(refreshBtn, newBtn);
    head.append(headText, headActions);
    view.append(head);

    var tabsWrap = null;
    if (section.tables.length > 1) {
      tabsWrap = el('div', { class: 'segmented', role: 'tablist', 'aria-label': 'تبديل الجدول' });
      section.tables.forEach(function (tableCfg) {
        var tab = el('button', { class: 'seg-btn', type: 'button', role: 'tab' }, tableCfg.label);
        tab.dataset.table = tableCfg.table;
        tab.addEventListener('click', function () { selectTable(tableCfg); });
        tabsWrap.append(tab);
      });
      view.append(tabsWrap);
    }

    var toolbar = el('div', { class: 'toolbar' });
    var searchWrap = el('label', { class: 'table-search' });
    var searchIcon = el('span', { class: 'search-icon', html: icon('search', 16) });
    var searchInput = el('input', { type: 'search', placeholder: 'ابحث بالعنوان أو الوصف…', 'aria-label': 'بحث في الجدول' });
    var count = el('span', { class: 'row-count' }, '');
    searchWrap.append(searchIcon, searchInput, count);
    var chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'تصفية الحالة' });
    toolbar.append(searchWrap, chips);
    view.append(toolbar);
    var healthPanel = el('section', { class: 'health-panel', id: 'healthPanel' });
    var healthSummary = el('span', { class: 'health-panel__text', id: 'healthSummary' }, 'جارٍ قراءة حالة الروابط…');
    var healthOnly = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', id: 'healthOnly' }, 'عرض المعطوبة فقط');
    var scanNow = el('button', { class: 'btn btn-gold btn-sm', type: 'button', id: 'healthScanNow' }, 'فحص الروابط الآن');
    var healthMessage = el('small', { class: 'health-panel__message', id: 'healthMessage', role: 'status' }, '');
    var option = el('label', { class:'health-panel__option', id:'healthDraftChoice' });
    option.append(el('input',{type:'checkbox',id:'healthIncludeDrafts'}), ' شمول المسودات');
    var allScan = el('button',{class:'btn btn-ghost btn-sm',id:'healthScanAll',type:'button'},'فحص كامل القسم');
    allScan.addEventListener('click',runFullHealthScan);
    var cancel = el('button',{class:'btn btn-ghost btn-sm',id:'healthStopScan',type:'button'},'إيقاف الفحص');
    cancel.hidden = true;
    var bar = el('progress',{id:'healthProgress',max:100,value:0,'aria-label':'تقدم فحص الحلقات'});
    bar.hidden = true;
    var detail = el('details',{class:'health-panel__report',id:'healthReport'});
    detail.hidden = true;
    detail.append(el('summary',null,'تفاصيل أخطاء الفحص'),el('pre',{id:'healthReportText'}));
    healthPanel.append(healthSummary,healthOnly,scanNow,allScan,option,cancel,bar,healthMessage,detail);
    cancel.addEventListener('click',function(){
      state.scanCancelled = true; cancel.disabled = true; cancel.textContent = 'جارٍ الإيقاف…';
    });
    healthPanel.hidden = true;
    view.append(healthPanel);
    healthOnly.addEventListener('click', function () {
      state.healthOnly = !state.healthOnly;
      healthOnly.textContent = state.healthOnly ? 'عرض جميع الحالات' : 'عرض المعطوبة فقط';
      healthOnly.classList.toggle('is-active', state.healthOnly);
      applyFilter();
    });
    scanNow.addEventListener('click', runLinkHealthScan);
    var bulkPanel = el('section', { class: 'channel-bulk', id: 'channelBulk' });
    bulkPanel.hidden = true;
    view.append(bulkPanel);

    var card = el('section', { class: 'card table-card' });
    var tableScroll = el('div', { class: 'table-scroll' });
    var table = el('table', { class: 'data-table' });
    var thead = el('thead');
    var headRow = el('tr');
    thead.append(headRow);
    var tbody = el('tbody');
    table.append(thead, tbody);
    tableScroll.append(table);
    card.append(tableScroll);
    view.append(card);

    var note = el('p', { class: 'table-note' }, 'يعرض الجدول أحدث ' + cfg.pageLimit + ' سجل. البحث والتصفية يطبقان على الصفوف المحمّلة.');
    view.append(note);

    state.els = {
      search: searchInput,
      count: count,
      chips: chips,
      healthPanel: healthPanel,
      bulkPanel: bulkPanel,
      thead: headRow,
      tbody: tbody,
      note: note,
      newBtn: newBtn,
      refreshBtn: refreshBtn,
      tabs: tabsWrap
    };

    searchInput.addEventListener('input', function () {
      state.query = searchInput.value.trim().toLowerCase();
      applyFilter();
    });

    refreshBtn.addEventListener('click', function () {
      clearOptions();
      loadTable(state.table);
    });

    // The same single-step series editor serves the Series and Seasons sections.
    if (section.id === 'series' || section.id === 'seasons') {
      var quick = el('a', { class: 'btn btn-gold btn-sm', href: 'series-quick.html' },
        '⚡ إضافة مسلسل ومواسم وحلقات');
      headActions.insertBefore(quick, newBtn);
      var text = newBtn.querySelector('span:last-child');
      if (text) text.textContent = 'إضافة سريعة';
    }
    newBtn.addEventListener('click', function () {
      if (section.id === 'series' || section.id === 'seasons') {
        location.href = 'series-quick.html';
        return;
      }
      openDrawer(null);
    });

    selectTable(section.tables[0]);
  }

  function selectTable(tableCfg) {
    state.table = tableCfg;
    state.healthOnly = false;
    if (state.els.healthPanel) state.els.healthPanel.hidden = !hasLinkHealth(tableCfg);
    if ($('#healthDraftChoice')) $('#healthDraftChoice').hidden = !hasLinkHealth(tableCfg);
    if ($('#healthScanAll')) $('#healthScanAll').hidden = tableCfg.table === 'aseel_series';
    if ($('#healthScanNow')) $('#healthScanNow').textContent =
      tableCfg.table === 'aseel_series' ? 'فحص حلقات المسلسلات' : 'فحص 12 رابطًا الآن';
    var healthButton = $('#healthOnly');
    if (healthButton) { healthButton.textContent = 'عرض المعطوبة فقط'; healthButton.classList.remove('is-active'); }
    state.rows = [];
    state.query = '';
    state.statusFilter = '';
    state.selectedChannels = {};
    state.selectedMedia = {};
    state.selectedOther = {};
    state.filteredOther = [];
    if (state.els.bulkPanel) {
      var bulkAvailable = tableCfg.table === 'aseel_channels' || isMediaBulkTable(tableCfg) || isOtherBulkTable(tableCfg);
      state.els.bulkPanel.hidden = !bulkAvailable;
      if (tableCfg.table === 'aseel_channels') buildChannelBulkPanel();
      else if (isMediaBulkTable(tableCfg)) buildMediaBulkPanel(tableCfg);
      else if (isOtherBulkTable(tableCfg)) buildOtherBulkPanel(tableCfg);
      else state.els.bulkPanel.replaceChildren();
    }
    if (state.els.search) state.els.search.value = '';
    if (state.els.tabs) {
      $$('.seg-btn', state.els.tabs).forEach(function (btn) {
        var active = btn.dataset.table === tableCfg.table;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    if (state.els.newBtn) {
      var label = state.els.newBtn.querySelector('span:last-child');
      if (label) label.textContent = 'إضافة ' + tableCfg.singular;
    }
    if (state.els.note) {
      state.els.note.textContent = 'يعرض الجدول أحدث ' + cfg.pageLimit + ' سجل. البحث والتصفية يطبقان على الصفوف المحمّلة.';
    }
    renderHead(tableCfg);
    buildChips(tableCfg);
    loadTable(tableCfg);
  }

  function renderHead(tableCfg) {
    var row = state.els.thead;
    row.replaceChildren();
    if (tableCfg.table === 'aseel_channels' || isMediaBulkTable(tableCfg) || isOtherBulkTable(tableCfg)) {
      var cell = el('th', { scope: 'col', class: 'bulk-check-cell' });
      var box = el('input', { type: 'checkbox', 'aria-label': 'تحديد كل العناصر المعروضة في نتائج البحث' });
      box.addEventListener('change', function () {
        if (tableCfg.table === 'aseel_channels') selectFilteredChannels(box.checked);
        else if (isMediaBulkTable(tableCfg)) selectFilteredMedia(box.checked);
        else selectFilteredOther(box.checked);
      });
      cell.append(box);
      row.append(cell);
    }
    tableCfg.columns.forEach(function (col) {
      row.append(el('th', { scope: 'col' }, col.label || ''));
    });
    row.append(el('th', { scope: 'col', class: 'th-actions' }, 'الإجراءات'));
  }

  function buildChips(tableCfg) {
    var host = state.els.chips;
    host.replaceChildren();
    if (!tableCfg.statusFilter) { host.hidden = true; return; }
    host.hidden = false;
    tableCfg.statusFilter.options.forEach(function (entry) {
      var value = entry[0];
      var chip = el('button', { class: 'chip-btn', type: 'button' }, entry[1]);
      chip.dataset.value = value;
      chip.setAttribute('aria-pressed', value === state.statusFilter ? 'true' : 'false');
      chip.classList.toggle('is-active', value === state.statusFilter);
      chip.addEventListener('click', function () {
        state.statusFilter = value;
        $$('.chip-btn', host).forEach(function (btn) {
          var active = btn.dataset.value === value;
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        applyFilter();
      });
      host.append(chip);
    });
  }

  function setCount(shown, total) {
    if (!state.els.count) return;
    if (total === null || total === undefined) { state.els.count.textContent = ''; return; }
    state.els.count.textContent = shown === total ? formatNumber(total) + ' سجل' : formatNumber(shown) + ' من ' + formatNumber(total);
  }

  function showSkeleton(tableCfg) {
    var tbody = state.els.tbody;
    tbody.replaceChildren();
    for (var i = 0; i < 6; i++) {
      var tr = el('tr', { class: 'skeleton-row' });
      if (tableCfg.table === 'aseel_channels' || isMediaBulkTable(tableCfg) || isOtherBulkTable(tableCfg)) tr.append(el('td', null, el('span', { class: 'skeleton skeleton-text' })));
      tableCfg.columns.forEach(function (col) {
        var td = el('td');
        td.append(el('span', { class: 'skeleton skeleton-text' + (col.kind === 'poster' ? ' skeleton-poster' : '') }));
        tr.append(td);
      });
      tr.append(el('td', { class: 'cell-actions' }, el('span', { class: 'skeleton skeleton-text' })));
      tbody.append(tr);
    }
    setCount(null);
  }

  function loadTable(tableCfg) {
    if (!tableCfg) return Promise.resolve();
    var token = ++state.loadToken;
    var sources = neededSources(tableCfg);
    var optionsPromise = ensureOptions(sources);
    showSkeleton(tableCfg);

    var query = 'select=*&order=' + tableCfg.order + '&limit=' + cfg.pageLimit;
    var loadRows = tableCfg.table === 'aseel_channels' ? fetchAllChannels :
      isMediaBulkTable(tableCfg) ? function () { return fetchAllMedia(tableCfg); } : function () {
      return restList(tableCfg.table, query).catch(function (err) {
        if (err.status === 400 && tableCfg.fallbackOrder) {
          return restList(tableCfg.table, 'select=*&order=' + tableCfg.fallbackOrder + '&limit=' + cfg.pageLimit);
        }
        throw err;
      });
    };
    return loadRows().then(function (rows) {
      return optionsPromise.then(function () {
        if (token !== state.loadToken) return null;
        state.rows = Array.isArray(rows) ? rows : [];
        if (isOtherBulkTable(tableCfg)) {
          var keptOther = {};
          state.rows.forEach(function (row) { if (state.selectedOther[row.id]) keptOther[row.id] = true; });
          state.selectedOther = keptOther;
        }
        if (isMediaBulkTable(tableCfg)) {
          var kept = {};
          state.rows.forEach(function (row) { if (state.selectedMedia[row.id]) kept[row.id] = true; });
          state.selectedMedia = kept;
          if (state.els.note) state.els.note.textContent = 'جميع السجلات المحمّلة متاحة للتحديد الجماعي، مع حفظ مؤكد في قاعدة البيانات.';
        }
        if (tableCfg.table === 'aseel_channels') {
          var valid = {};
          state.rows.forEach(function (row) { if (state.selectedChannels[row.id]) valid[row.id] = true; });
          state.selectedChannels = valid;
          if (state.els.note) state.els.note.textContent = 'تم تحميل القنوات على دفعات؛ البحث والتحديد يشملان كل القنوات المحمّلة.';
        }
        setCount(state.rows.length, state.rows.length);
        applyFilter();
        return null;
      });
    }).catch(function (err) {
      if (token !== state.loadToken) return null;
      state.rows = [];
      renderTableError(tableCfg, err);
      return null;
    });
  }

  function renderTableError(tableCfg, err) {
    var tbody = state.els.tbody;
    tbody.replaceChildren();
    var tr = el('tr', { class: 'message-row' });
    var td = el('td', { colspan: tableCfg.columns.length + (tableCfg.table === 'aseel_channels' || isMediaBulkTable(tableCfg) || isOtherBulkTable(tableCfg) ? 2 : 1) });
    td.append(errorCard(describeError(err), function () { loadTable(state.table); }));
    tr.append(td);
    tbody.append(tr);
    setCount(0, 0);
  }

  function errorCard(message, retry) {
    var card = el('div', { class: 'error-card' });
    card.append(el('span', { class: 'error-icon', html: icon('alert', 22) }));
    var copy = el('div', { class: 'error-copy' });
    copy.append(el('strong', null, 'تعذر تحميل البيانات'));
    copy.append(el('p', null, message));
    card.append(copy);
    if (retry) {
      var button = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'إعادة المحاولة');
      button.addEventListener('click', retry);
      card.append(button);
    }
    return card;
  }

  function matchesStatus(row, tableCfg, value) {
    if (!value) return true;
    var raw = row[tableCfg.statusFilter.field];
    if (value === 'yes') return Boolean(raw);
    if (value === 'no') return !raw;
    if (value === 'published') return raw === 'published';
    if (value === 'draft') return raw !== 'published';
    return raw === value;
  }

  function applyFilter() {
    var tableCfg = state.table;
    if (!tableCfg || !state.els.tbody) return;
    var query = state.query;
    var keys = tableCfg.searchKeys && tableCfg.searchKeys.length ? tableCfg.searchKeys : null;
    var rows = state.rows.filter(function (row) {
      if (!matchesStatus(row, tableCfg, state.statusFilter)) return false;
      if (!query) return true;
      var searchKeys = keys || Object.keys(row);
      return searchKeys.some(function (key) {
        var value = row[key];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().indexOf(query) !== -1;
      });
    });
    if (tableCfg.table === 'aseel_channels') state.filteredChannels = rows;
    if (hasLinkHealth(tableCfg)) {
      var broken = state.rows.filter(function (row) { return row.link_health_status === 'broken'; }).length;
      var suspect = state.rows.filter(function (row) { return row.link_health_status === 'suspect'; }).length;
      var checked = state.rows.filter(function (row) { return row.link_health_checked_at; }).length;
      var summary = $('#healthSummary');
      if (summary) summary.textContent = '🔴 معطوب: ' + broken + ' · 🟠 قيد التحقق: ' + suspect +
        ' · تم فحص: ' + checked + ' من ' + state.rows.length;
      if (state.healthOnly) rows = rows.filter(function (row) { return row.link_health_status === 'broken'; });
    }
    if (isMediaBulkTable(tableCfg)) state.filteredMedia = rows;
    if (isOtherBulkTable(tableCfg)) state.filteredOther = rows;
    renderRows(tableCfg, rows);
    setCount(rows.length, state.rows.length);
    if (tableCfg.table === 'aseel_channels') syncChannelBulkPanel();
    if (isMediaBulkTable(tableCfg)) syncMediaBulkPanel();
    if (isOtherBulkTable(tableCfg)) syncOtherBulkPanel();
    syncBulkDeleteButton();
  }

  function renderRows(tableCfg, rows) {
    var tbody = state.els.tbody;
    tbody.replaceChildren();
    if (!rows.length) {
      var tr = el('tr', { class: 'message-row' });
      var td = el('td', { colspan: tableCfg.columns.length + (tableCfg.table === 'aseel_channels' || isMediaBulkTable(tableCfg) || isOtherBulkTable(tableCfg) ? 2 : 1) });
      var empty = el('div', { class: 'empty' });
      empty.append(el('span', { class: 'empty-icon', html: icon('inbox', 30) }));
      empty.append(el('strong', null, state.rows.length ? 'لا يوجد سجل مطابق' : 'لا يوجد محتوى بعد'));
      empty.append(el('p', null, state.rows.length ? 'جرّب كلمة بحث أخرى أو أزل تصفية الحالة.' : 'ابدأ بإضافة أول سجل إلى ' + tableCfg.label + '.'));
      if (!state.rows.length) {
        var add = el('button', { class: 'btn btn-gold btn-sm', type: 'button' }, 'إضافة ' + tableCfg.singular);
        add.addEventListener('click', function () {
          if (tableCfg.table === 'aseel_series' || tableCfg.table === 'aseel_seasons')
            location.href = 'series-quick.html';
          else openDrawer(null);
        });
        empty.append(add);
      }
      td.append(empty);
      tr.append(td);
      tbody.append(tr);
      return;
    }
    var fragment = document.createDocumentFragment();
    rows.forEach(function (row) {
      try { fragment.append(buildRow(tableCfg, row)); }
      catch (e) { /* keep the table usable if one row is malformed */ }
    });
    tbody.append(fragment);
  }

  function buildRow(tableCfg, row) {
    var tr = el('tr', { class: 'data-row' });
    if (hasLinkHealth(tableCfg) && row.link_health_status === 'broken') {
      tr.classList.add('health-row--broken');
      tr.title = 'مخفي عن المشاهدين: ' + (row.link_health_reason || 'تعطل الرابط بعد فحوص متكررة');
    } else if (hasLinkHealth(tableCfg) && row.link_health_status === 'suspect') {
      tr.classList.add('health-row--suspect');
    }
    if (tableCfg.table === 'aseel_channels') {
      var cell = el('td', { class: 'bulk-check-cell' });
      var checkbox = el('input', { type: 'checkbox', 'aria-label': 'تحديد قناة ' + (row.title_ar || '') });
      checkbox.checked = Boolean(state.selectedChannels[row.id]);
      checkbox.disabled = state.bulkBusy;
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) state.selectedChannels[row.id] = true;
        else delete state.selectedChannels[row.id];
        syncChannelBulkPanel();
        syncBulkDeleteButton();
      });
      cell.append(checkbox);
      tr.append(cell);
    }
    if (isOtherBulkTable(tableCfg)) {
      var otherCell = el('td', { class: 'bulk-check-cell' });
      var otherCheck = el('input', { type: 'checkbox', 'aria-label': 'تحديد ' + (row.title_ar || row.name_ar || row.title || row.id) });
      otherCheck.checked = Boolean(state.selectedOther[row.id]);
      otherCheck.disabled = state.bulkBusy;
      otherCheck.addEventListener('change', function () {
        if (otherCheck.checked) state.selectedOther[row.id] = true;
        else delete state.selectedOther[row.id];
        syncOtherBulkPanel();
        syncBulkDeleteButton();
      });
      otherCell.append(otherCheck);
      tr.append(otherCell);
    }
    if (isMediaBulkTable(tableCfg)) {
      var mediaCell = el('td', { class: 'bulk-check-cell' });
      var mediaCheck = el('input', { type: 'checkbox', 'aria-label': 'تحديد ' + (row.title_ar || '') });
      mediaCheck.checked = Boolean(state.selectedMedia[row.id]);
      mediaCheck.disabled = state.bulkBusy;
      mediaCheck.addEventListener('change', function () {
        if (mediaCheck.checked) state.selectedMedia[row.id] = true;
        else delete state.selectedMedia[row.id];
        syncMediaBulkPanel();
        syncBulkDeleteButton();
      });
      mediaCell.append(mediaCheck);
      tr.append(mediaCell);
    }
    tableCfg.columns.forEach(function (col) { tr.append(buildCell(col, row)); });
    tr.append(buildActions(tableCfg, row));
    return tr;
  }

  function buildCell(col, row) {
    var value = row[col.key];
    var td;

    if (col.kind === 'poster') {
      td = el('td', { class: 'cell-poster' });
      var wrap = el('div', { class: 'poster' });
      var fallback = el('span', { class: 'poster-fallback', 'aria-hidden': 'true' }, 'EZ');
      wrap.append(fallback);
      if (value && isHttps(value)) {
        var img = el('img', { alt: '', loading: 'lazy' });
        img.addEventListener('error', function () { img.hidden = true; });
        img.src = value;
        wrap.append(img);
      }
      td.append(wrap);
      return td;
    }

    if (col.kind === 'title') {
      td = el('td', { class: 'cell-title' });
      var title = row.title_ar || row.name_ar || row.title || '—';
      td.append(el('strong', null, String(title)));
      var sub = col.sub ? row[col.sub] : null;
      if (sub) td.append(el('small', null, String(sub)));
      if (row.link_health_status === 'broken') {
        td.append(el('span', { class: 'health-label health-label--broken' }, '● الرابط غير فعال — مخفي عن المشاهدين'));
        td.append(el('small', { class: 'health-reason' }, row.link_health_reason || 'تأكد فشل مصدر التشغيل'));
        if (row.link_health_checked_at) td.append(el('small', { class: 'health-date' }, 'آخر فحص: ' + fmtDate(row.link_health_checked_at)));
      } else if (row.link_health_status === 'suspect') {
        td.append(el('span', { class: 'health-label health-label--suspect' }, '● رابط يحتاج مراجعة'));
        if (row.link_health_reason) td.append(el('small', { class: 'health-reason' }, String(row.link_health_reason)));
      } else if (row.link_health_status === 'healthy') {
        td.append(el('span', { class: 'health-label health-label--healthy' }, '● استجاب للفحص'));
      }
      return td;
    }

    if (col.kind === 'status') {
      var rawStatus = value || 'draft';
      var labels = { published: 'منشور', draft: 'مسودة', hidden: 'مخفي' };
      var cls = labels[rawStatus] ? rawStatus : 'draft';
      td = el('td');
      td.append(el('span', { class: 'pill pill--' + cls }, labels[rawStatus] || String(rawStatus)));
      return td;
    }

    if (col.kind === 'flag') {
      var on = Boolean(value);
      td = el('td');
      td.append(el('span', { class: 'pill pill--' + (on ? 'published' : 'draft') }, on ? col.trueLabel : col.falseLabel));
      return td;
    }

    if (col.kind === 'chip') {
      td = el('td');
      if (value) td.append(el('span', { class: 'chip' }, String(value)));
      else td.append(document.createTextNode('—'));
      return td;
    }

    if (col.kind === 'lookup') {
      td = el('td', { class: 'cell-muted' }, optionLabel(col.source, value));
      return td;
    }

    if (col.kind === 'map') {
      td = el('td', { class: 'cell-muted' }, (col.map && col.map[value]) || (value ? String(value) : '—'));
      return td;
    }

    if (col.kind === 'content') {
      td = el('td', { class: 'cell-title' });
      var found = null;
      if (row.movie_id) found = { source: 'movies', value: row.movie_id, label: 'فيلم' };
      else if (row.series_id) found = { source: 'series', value: row.series_id, label: 'مسلسل' };
      else if (row.channel_id) found = { source: 'channels', value: row.channel_id, label: 'قناة' };
      else if (row.episode_id) found = { source: 'episodes', value: row.episode_id, label: 'حلقة' };
      if (found) {
        td.append(el('strong', null, optionLabel(found.source, found.value)));
        td.append(el('small', null, found.label));
      } else {
        td.append(el('span', { class: 'cell-muted' }, '— لا يوجد عنصر مرتبط —'));
      }
      return td;
    }

    if (col.kind === 'link') {
      td = el('td', { class: 'cell-link' });
      if (value && isHttps(value)) {
        var link = el('a', { href: value, target: '_blank', rel: 'noopener noreferrer' }, 'فتح الرابط');
        link.append(el('span', { class: 'link-icon', html: icon('external', 12) }));
        td.append(link);
      } else td.append(document.createTextNode('—'));
      return td;
    }

    if (col.kind === 'number') {
      td = el('td', { class: 'cell-number' });
      td.append(document.createTextNode(value === null || value === undefined || value === '' ? '—' : (col.prefix || '') + value));
      return td;
    }

    if (col.key === 'rights_expires_at') {
      td = el('td', { class: 'cell-muted' }, fmtDate(value));
      return td;
    }

    if (col.suffix) {
      td = el('td');
      td.append(document.createTextNode(value === null || value === undefined || value === '' ? '—' : String(value) + col.suffix));
      return td;
    }

    td = el('td');
    td.append(document.createTextNode(value === null || value === undefined || value === '' ? '—' : String(value)));
    return td;
  }

  function actionButton(iconName, label, handler, extraClass) {
    var button = el('button', {
      class: 'row-btn' + (extraClass ? ' ' + extraClass : ''),
      type: 'button',
      'aria-label': label,
      title: label,
      html: icon(iconName, 15)
    });
    button.addEventListener('click', handler);
    return button;
  }

  function buildActions(tableCfg, row) {
    var td = el('td', { class: 'cell-actions' });
    if (tableCfg.table === 'aseel_series' && row.id) {
      td.append(actionButton('refresh', 'فحص حلقات هذا المسلسل', function () {
        runSeriesHealthScan(row.id, String(row.title_ar || ''));
      }));
      td.append(actionButton('layers', 'إضافة حلقات سريعة', function () {
        location.href = 'series-quick.html?series=' + encodeURIComponent(row.id);
      }));
    }
    if (tableCfg.table === 'aseel_seasons' && row.series_id) {
      td.append(actionButton('plus', 'إضافة حلقات للمسلسل', function () {
        location.href = 'series-quick.html?series=' + encodeURIComponent(row.series_id);
      }));
    }
    td.append(actionButton('edit', 'تعديل', function () { openDrawer(row); }));

    if (tableCfg.statusFilter) {
      var field = tableCfg.statusFilter.field;
      var isPublished = field === 'status' ? row[field] === 'published' : Boolean(row[field]);
      var nextLabel = isPublished ? 'إخفاء' : 'نشر';
      var toggleBtn = actionButton(
        isPublished ? 'eyeOff' : 'eye',
        nextLabel,
        function () { togglePublish(tableCfg, row, toggleBtn); },
        isPublished ? 'row-btn--off' : 'row-btn--on'
      );
      td.append(toggleBtn);
    }

    td.append(actionButton('trash', 'حذف', function () { openDelete(tableCfg, row); }, 'row-btn--danger'));
    return td;
  }


  /* ---------- batch editing across movies, series, episodes and YouTube ---------- */
  function isMediaBulkTable(tableCfg) {
    return !!tableCfg && ['aseel_movies', 'aseel_series', 'aseel_episodes', 'aseel_youtube_videos']
      .indexOf(tableCfg.table) >= 0;
  }

  function fetchAllMedia(tableCfg) {
    var found = [];
    var name = tableCfg.table;
    function page(offset) {
      if (offset >= 10000) return Promise.reject(new Error('عدد العناصر يتجاوز حد التحديد الآمن (10000).'));
      return restList(name, 'select=*&order=created_at.desc,id.asc&limit=500&offset=' + offset).then(function (rows) {
        if (!Array.isArray(rows)) throw new Error('استجابة غير متوقعة عند تحميل ' + tableCfg.label);
        found = found.concat(rows);
        return rows.length === 500 ? page(offset + 500) : found;
      });
    }
    return page(0);
  }

  function canPublishMedia(row, tableName) {
    if (!row || row.link_health_status === 'broken') return false;
    if (tableName === 'aseel_youtube_videos') {
      try {
        var u = new URL(row.youtube_url || '');
        var h = u.hostname.toLowerCase();
        return u.protocol === 'https:' && ['www.youtube.com','youtube.com','m.youtube.com','youtu.be'].indexOf(h) !== -1;
      } catch (e) { return false; }
    }
    if (row.rights_status !== 'approved' || !String(row.license_reference || '').trim()) return false;
    if (row.rights_expires_at && !(new Date(row.rights_expires_at).getTime() > Date.now())) return false;
    if (tableName === 'aseel_series') return true; /* Episodes are independently guarded by RLS. */
    if (tableName === 'aseel_episodes') return isHttps(row.stream_url); /* Matches public episode policy. */
    return isHttps(row.stream_url) || isHttps(row.youtube_url);
  }

  function selectFilteredMedia(checked) {
    if (state.bulkBusy || !isMediaBulkTable(state.table)) return;
    state.filteredMedia.forEach(function (row) {
      if (checked) state.selectedMedia[row.id] = true;
      else delete state.selectedMedia[row.id];
    });
    applyFilter();
  }

  function buildMediaBulkPanel(tableCfg) {
    var host = state.els.bulkPanel;
    if (!host) return;
    host.replaceChildren();
    var isYoutube = tableCfg.table === 'aseel_youtube_videos';
    var header = el('div', { class: 'bulk-header' });
    header.append(el('strong', null, 'عمليات جماعية — ' + tableCfg.label),
      el('span', { class: 'bulk-count', id: 'mediaBulkSummary', role: 'status' }, '0 محدد'));
    host.append(header);
    var selection = el('div', { class: 'bulk-actions' });
    [
      ['تحديد نتائج البحث', function () { selectFilteredMedia(true); }],
      ['تحديد الكل', function () {
        state.rows.forEach(function (row) { state.selectedMedia[row.id] = true; }); applyFilter();
      }],
      ['إلغاء التحديد', function () { state.selectedMedia = {}; applyFilter(); }]
    ].forEach(function (entry) {
      var button = el('button', { class: 'btn btn-ghost btn-sm media-bulk-control', type: 'button' }, entry[0]);
      button.addEventListener('click', entry[1]);
      selection.append(button);
    });
    host.append(selection);
    if (!isYoutube) {
      var details = el('details', { class: 'bulk-license', open: false });
      details.append(el('summary', null, 'الترخيص والحقوق للمحتوى المحدد'));
      details.append(el('p', { class: 'bulk-hint' },
        'لا تعتمد ترخيصًا مشتركًا إلا إذا كانت وثيقته تغطي جميع العناصر المحددة. لا تمنح هذه الخطوة حقوق عرض جديدة.'));
      var fields = el('div', { class: 'bulk-fields' });
      var inputs = [];
      if (tableCfg.table !== 'aseel_episodes') {
        inputs.push(['صاحب الحقوق', 'mediaBulkHolder', 'الجهة التي تملك حقوق العرض', 'text']);
      }
      inputs.push(['مرجع الترخيص', 'mediaBulkLicense', 'وثيقة أو رابط يثبت الإذن لجميع العناصر', 'text']);
      inputs.push(['انتهاء الترخيص (اختياري)', 'mediaBulkExpiry', '', 'date']);
      inputs.forEach(function (item) {
        var field = el('label', { class: 'bulk-field' });
        field.append(el('span', null, item[0]),
          el('input', { id: item[1], type: item[3], autocomplete: 'off', placeholder: item[2],
            dir: item[3] === 'date' ? 'ltr' : 'auto' }));
        fields.append(field);
      });
      details.append(fields);
      var acknowledgement = el('label', { class: 'bulk-ack' });
      acknowledgement.append(el('input', { type: 'checkbox', id: 'mediaBulkAck' }),
        el('span', null, 'أؤكد أن لدي إذنًا صالحًا يغطّي كل المحتوى المحدد، بما يشمل حقوق إعادة العرض.'));
      details.append(acknowledgement);
      host.append(details);
    } else {
      host.append(el('p', { class: 'bulk-hint' },
        'يُسمح بنشر روابط يوتيوب الرسمية فقط. فيديوهات يوتيوب لا تحتوي حقول ترخيص جماعي في قاعدة البيانات؛ لا يتم إنشاء ترخيص افتراضي.'));
    }
    if (tableCfg.table === 'aseel_series') {
      var withEpisodes = el('label', { class: 'bulk-ack' });
      withEpisodes.append(el('input', { type: 'checkbox', id: 'mediaBulkIncludeEpisodes' }),
        el('span', null, 'شمل كل حلقات المسلسلات المحددة في نفس العملية (حقوقها ونشرها عند استيفاء الشروط).'));
      host.append(withEpisodes);
    }
    var operations = el('div', { class: 'bulk-actions' });
    var actions = isYoutube ? [['نشر المحدد دفعة واحدة', 'publish', 'btn-gold']] : [
      ['اعتماد الترخيص للمحدد', 'license', 'btn-ghost'],
      ['نشر المحتوى المؤهل', 'publish', 'btn-ghost'],
      ['اعتماد الحقوق والنشر دفعة واحدة', 'all', 'btn-gold']
    ];
    actions.forEach(function (entry) {
      var button = el('button', { type: 'button', class: 'btn btn-sm media-bulk-control ' + entry[2] }, entry[0]);
      button.addEventListener('click', function () { runMediaBulk(entry[1]); });
      operations.append(button);
    });
    host.append(operations);
    appendBulkDeleteAction(host);
    host.append(el('p', { class: 'bulk-status', id: 'mediaBulkReadiness', role: 'status' }, ''));
    host.append(el('p', { class: 'bulk-status', id: 'mediaBulkStatus', role: 'status', 'aria-live': 'polite' },
      'يتم الحفظ على دفعات مع إعادة قراءة البيانات للتأكد من تطبيق كل عملية. المحتوى المعطوب لا يعاد نشره حتى إصلاح الرابط.'));
    syncMediaBulkPanel();
  }

  function syncMediaBulkPanel() {
    if (!state.table || !isMediaBulkTable(state.table) || !state.els.bulkPanel) return;
    var total = Object.keys(state.selectedMedia).length;
    var selected = state.rows.filter(function (row) { return state.selectedMedia[row.id]; });
    var valid = selected.filter(function (row) { return canPublishMedia(row, state.table.table); }).length;
    var summary = $('#mediaBulkSummary');
    if (summary) summary.textContent = formatNumber(total) + ' محدد من ' + formatNumber(state.rows.length);
    var readiness = $('#mediaBulkReadiness');
    if (readiness) readiness.textContent = 'المؤهل للنشر حاليًا: ' + valid + ' / ' + selected.length +
      (state.table.table === 'aseel_series' ? ' — يجب اعتماد ونشر الحلقات التابعة من قسم الحلقات لظهورها للمشاهدين.' : '') +
      ' — المرفوض أو المعطوب يبقى دون نشر.';
    var master = $('.bulk-check-cell input', state.els.thead);
    if (master) {
      var filtered = state.filteredMedia || [];
      var marked = filtered.filter(function (row) { return state.selectedMedia[row.id]; }).length;
      master.checked = filtered.length > 0 && marked === filtered.length;
      master.indeterminate = marked > 0 && marked < filtered.length;
      master.disabled = state.bulkBusy;
    }
    Array.prototype.forEach.call(state.els.bulkPanel.querySelectorAll('.media-bulk-control'), function (button) { button.disabled = state.bulkBusy; });
  }

  function patchMediaBatch(tableName, selected, payload) {
    var report = { changed: 0, failures: 0, errors: [] };
    return bulkParts(selected, 35).reduce(function (chain, batch) {
      return chain.then(function () {
        var ids = batch.map(function (row) { return row.id; });
        var filter = 'id=in.(' + ids.join(',') + ')';
        return api(tableName + '?' + filter, {
          method: 'PATCH', body: payload, headers: { Prefer: 'return=representation' }
        }).then(function (returned) {
          if (!Array.isArray(returned) || returned.length !== batch.length) {
            throw new Error('عدد السجلات المحدثة لا يطابق الطلب: ' + tableName);
          }
          return restList(tableName, 'select=*&' + filter).then(function (confirmed) {
            var records = {};
            (confirmed || []).forEach(function (row) { records[row.id] = row; });
            batch.forEach(function (original) {
              var saved = records[original.id];
              if (saved && payloadMatchesRecord(saved, payload)) {
                Object.assign(original, saved);
                report.changed++;
              } else {
                report.failures++;
                report.errors.push('تعذر تأكيد حفظ ' + (original.title_ar || original.id));
              }
            });
          });
        }).catch(function (error) {
          report.failures += batch.length;
          report.errors.push(describeError(error));
        });
      });
    }, Promise.resolve()).then(function () { return report; });
  }

  function fetchSeriesEpisodes(seriesRows) {
    var seasons = [];
    return bulkParts(seriesRows, 30).reduce(function (chain, batch) {
      return chain.then(function () {
        var filter = 'series_id=in.(' + batch.map(function (s) { return s.id; }).join(',') + ')';
        return restList('aseel_seasons', 'select=id,series_id&' + filter + '&limit=1000').then(function (rows) {
          if (!Array.isArray(rows) || rows.length >= 1000) throw new Error('عدد المواسم يتجاوز حد الفحص الآمن.');
          seasons = seasons.concat(rows);
        });
      });
    }, Promise.resolve()).then(function () {
      if (!seasons.length) return [];
      var episodes = [];
      return bulkParts(seasons, 30).reduce(function (chain, batch) {
        return chain.then(function () {
          var filter = 'season_id=in.(' + batch.map(function (s) { return s.id; }).join(',') + ')';
          return restList('aseel_episodes', 'select=*&' + filter + '&limit=1000').then(function (rows) {
            if (!Array.isArray(rows) || rows.length >= 1000) throw new Error('عدد الحلقات يتجاوز حد الفحص الآمن.');
            episodes = episodes.concat(rows);
          });
        });
      }, Promise.resolve()).then(function () { return episodes; });
    });
  }

  function runMediaBulk(action) {
    if (!isMediaBulkTable(state.table) || state.bulkBusy || !state.adminVerified) {
      toast('يلزم حساب مسؤول معتمد لإجراء النشر الجماعي.', 'error');
      return;
    }
    var tableCfg = state.table, tableName = tableCfg.table;
    var selected = state.rows.filter(function (row) { return state.selectedMedia[row.id]; });
    if (!selected.length) { toast('حدد عنصرًا أو أكثر أولًا.', 'error'); return; }
    var isYoutube = tableName === 'aseel_youtube_videos';
    var includeEpisodes = tableName === 'aseel_series' && $('#mediaBulkIncludeEpisodes') && $('#mediaBulkIncludeEpisodes').checked;
    var holder = (($('#mediaBulkHolder') || {}).value || '').trim();
    var reference = (($('#mediaBulkLicense') || {}).value || '').trim();
    var expiry = (($('#mediaBulkExpiry') || {}).value || '').trim();
    var agreed = Boolean($('#mediaBulkAck') && $('#mediaBulkAck').checked);
    var license = !isYoutube && (action === 'license' || (action === 'all' && (holder || reference || expiry || agreed)));
    if (license) {
      if ((!holder && tableName !== 'aseel_episodes') || !reference || !agreed) {
        toast('أدخل صاحب الحقوق ومرجع الترخيص وأكد أن الإذن يشمل الجميع. للحلقات يكفي المرجع والتأكيد.', 'error');
        return;
      }
      if (holder.length > 250 || reference.length > 500 ||
          (expiry && !(new Date(expiry + 'T23:59:59').getTime() > Date.now()))) {
        toast('بيانات الترخيص طويلة أو منتهية الصلاحية.', 'error');
        return;
      }
    }
    if (!window.confirm('تأكيد تنفيذ ' + (action === 'all' ? 'الترخيص والنشر' : action === 'license' ? 'الترخيص' : 'النشر') +
      ' لـ ' + selected.length + ' عنصر في ' + tableCfg.label + '؟ سيتم تعديل قاعدة البيانات فعليًا.')) return;
    state.bulkBusy = true;
    syncMediaBulkPanel();
    var log = [], errors = [], childRows = [];
    var flow = includeEpisodes ? fetchSeriesEpisodes(selected).then(function (episodes) {
      childRows = episodes;
      log.push('حلقات المسلسلات المحددة: ' + childRows.length);
    }) : Promise.resolve();
    if (license) flow = flow.then(function () {
      var payload = { rights_status: 'approved', license_reference: reference };
      if (tableName !== 'aseel_episodes') payload.rights_holder = holder;
      if (expiry) payload.rights_expires_at = new Date(expiry + 'T23:59:59').toISOString();
      var progress = $('#mediaBulkStatus');
      if (progress) progress.textContent = 'جارٍ اعتماد وثيقة الحقوق في قاعدة البيانات...';
      return patchMediaBatch(tableName, selected, payload).then(function (result) {
        log.push('اعتماد الحقوق: ' + result.changed + ' / ' + selected.length + '، فشل: ' + result.failures);
        errors = errors.concat(result.errors);
        if (!includeEpisodes || !childRows.length) return null;
        var childLicense = { rights_status: 'approved', license_reference: reference };
        if (expiry) childLicense.rights_expires_at = payload.rights_expires_at;
        return patchMediaBatch('aseel_episodes', childRows, childLicense).then(function (sub) {
          log.push('اعتماد حقوق الحلقات: ' + sub.changed + ' / ' + childRows.length + '، فشل: ' + sub.failures);
          errors = errors.concat(sub.errors);
        });
      });
    });
    if (action === 'publish' || action === 'all') flow = flow.then(function () {
      var allowed = selected.filter(function (row) { return canPublishMedia(row, tableName); });
      var drafts = allowed.filter(function (row) { return row.status !== 'published'; });
      var progress = $('#mediaBulkStatus');
      if (progress) progress.textContent = 'جارٍ نشر العناصر المؤهلة والتحقق من كل دفعة…';
      return patchMediaBatch(tableName, drafts, { status: 'published' }).then(function (result) {
        log.push('نشر جديد: ' + result.changed + '، منشور مسبقًا: ' + (allowed.length - drafts.length) +
          '، غير مؤهل: ' + (selected.length - allowed.length) + '، فشل: ' + result.failures);
        errors = errors.concat(result.errors);
        if (!includeEpisodes || !childRows.length) return null;
        var eligibleParents = {};
        allowed.filter(function (row) { return row.status === 'published'; }).forEach(function (row) { eligibleParents[row.id] = true; });
        return restList('aseel_seasons', 'select=id,series_id&limit=1000').then(function (seasons) {
          var validSeasons = {};
          (seasons || []).forEach(function (season) { if (eligibleParents[season.series_id]) validSeasons[season.id] = true; });
          var eligible = childRows.filter(function (row) { return validSeasons[row.season_id] && canPublishMedia(row, 'aseel_episodes'); });
          var draftEpisodes = eligible.filter(function (row) { return row.status !== 'published'; });
          return patchMediaBatch('aseel_episodes', draftEpisodes, { status: 'published' }).then(function (sub) {
            log.push('نشر الحلقات: ' + sub.changed + ' جديد، ' +
              (eligible.length - draftEpisodes.length) + ' منشور مسبقًا، ' +
              (childRows.length - eligible.length) + ' غير مؤهل، ' + sub.failures + ' فشل');
            errors = errors.concat(sub.errors);
          });
        });
      });
    });
    flow.then(function () {
      var summary = log.join(' | ') + (errors.length ? ' | خطأ: ' + errors[0] : '');
      var progress = $('#mediaBulkStatus');
      if (progress) progress.textContent = summary;
      toast(errors.length ? 'اكتمل جزء من العملية؛ راجع النتائج.' : 'تم تأكيد الحفظ في Supabase.',
        errors.length ? 'error' : 'success');
    }).catch(function (error) {
      var progress = $('#mediaBulkStatus');
      if (progress) progress.textContent = 'توقفت العملية: ' + describeError(error);
      toast('فشل التنفيذ: ' + describeError(error), 'error');
    }).finally(function () {
      state.bulkBusy = false;
      if (state.table === tableCfg) {
        syncMediaBulkPanel();
        loadTable(tableCfg);
      }
    });
  }

  /* ---------- bulk channel licensing and live shelf management ---------- */
  function fetchAllChannels() {
    var collected = [];
    function page(offset) {
      if (offset >= 10000) throw new Error('وصل عدد القنوات إلى حد التحميل الآمن 10000.');
      return restList('aseel_channels', 'select=*&order=display_order.asc,id.asc&limit=500&offset=' + offset)
        .then(function (rows) {
          rows = Array.isArray(rows) ? rows : [];
          collected = collected.concat(rows);
          return rows.length === 500 ? page(offset + 500) : collected;
        });
    }
    return page(0);
  }

  function canPublishChannel(row) {
    return !!row && row.link_health_status !== 'broken' &&
      row.playback_mode === 'stream' && isHttps(row.stream_url) &&
      /\.(m3u8|mp4)(\?[^\s]*)?$/i.test(row.stream_url);
  }

  function selectFilteredChannels(checked) {
    if (state.bulkBusy) return;
    state.filteredChannels.forEach(function (row) {
      if (checked) state.selectedChannels[row.id] = true;
      else delete state.selectedChannels[row.id];
    });
    applyFilter();
  }

  function buildChannelBulkPanel() {
    var host = state.els.bulkPanel;
    if (!host) return;
    host.replaceChildren();
    var header = el('div', { class: 'bulk-header' });
    header.append(el('strong', null, 'عمليات القنوات الجماعية'));
    header.append(el('span', { id: 'bulkSelectionSummary', class: 'bulk-count', 'aria-live': 'polite' }, '0 قناة محددة'));
    host.append(header);
    var actions = el('div', { class: 'bulk-actions' });
    [
      ['تحديد نتائج البحث', function () { selectFilteredChannels(true); }],
      ['تحديد جميع القنوات', function () {
        state.rows.forEach(function (row) { state.selectedChannels[row.id] = true; }); applyFilter();
      }],
      ['إلغاء التحديد', function () { state.selectedChannels = {}; applyFilter(); }]
    ].forEach(function (item) {
      var button = el('button', { class: 'btn btn-ghost btn-sm bulk-control', type: 'button' }, item[0]);
      button.addEventListener('click', item[1]);
      actions.append(button);
    });
    host.append(actions);
    appendBulkDeleteAction(host);
    host.append(el('p', { class: 'bulk-status', id: 'bulkReadiness', role: 'status' }, ''));
    host.append(el('p', { class: 'bulk-status', id: 'bulkStatus', role: 'status', 'aria-live': 'polite' },
      'القنوات الجديدة تُحفظ كمنشورة تلقائيًا. يُظهر هذا القسم فحص الروابط دون بيانات التراخيص.'));
    syncChannelBulkPanel();
  }

  function syncChannelBulkPanel() {
    if (!state.els.bulkPanel || !state.table || state.table.table !== 'aseel_channels') return;
    var count = Object.keys(state.selectedChannels).length;
    var summary = $('#bulkSelectionSummary');
    if (summary) summary.textContent = formatNumber(count) + ' محددة من ' + formatNumber(state.rows.length);
    var readiness = $('#bulkReadiness');
    if (readiness) {
      var chosen = state.rows.filter(function (row) { return state.selectedChannels[row.id]; });
      var qualified = chosen.filter(canPublishChannel).length;
      readiness.textContent = chosen.length ? ('روابط تشغيل قابلة للفحص: ' + qualified + ' / ' + chosen.length +
        ' — روابط تحتاج تصحيحًا: ' + (chosen.length - qualified) + '.') :
        'القنوات الجديدة تنشر تلقائيًا؛ حدد القنوات لمراجعة روابطها.';
    }
    var master = $('.bulk-check-cell input', state.els.thead);
    if (master) {
      var total = state.filteredChannels.length;
      var checked = state.filteredChannels.filter(function (row) { return state.selectedChannels[row.id]; }).length;
      master.checked = total > 0 && total === checked;
      master.indeterminate = checked > 0 && checked < total;
      master.disabled = state.bulkBusy;
    }
    $$('.bulk-control', state.els.bulkPanel).forEach(function (button) { button.disabled = state.bulkBusy; });
  }

  function bulkStatus(message) {
    var target = $('#bulkStatus');
    if (target && state.table && state.table.table === 'aseel_channels') target.textContent = message;
  }

  function bulkParts(list, size) {
    var result = [];
    for (var i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
    return result;
  }

  function payloadMatchesRecord(row, payload) {
    return Object.keys(payload).every(function (key) {
      if (key === 'rights_expires_at') return new Date(row[key]).getTime() === new Date(payload[key]).getTime();
      return row[key] === payload[key];
    });
  }

  function patchChannelBatch(rows, payload) {
    var report = { changed: 0, failures: 0, errors: [] };
    return bulkParts(rows, 40).reduce(function (chain, batch) {
      return chain.then(function () {
        var ids = batch.map(function (row) { return row.id; });
        var path = 'aseel_channels?id=in.(' + ids.join(',') + ')';
        return api(path, {
          method: 'PATCH', body: payload, headers: { Prefer: 'return=representation' }
        }).then(function (returned) {
          // A successful HTTP status is not proof that all requested records changed.
          // Confirm persisted values with a fresh read before reporting success.
          if (!Array.isArray(returned) || returned.length !== batch.length) {
            throw new Error('لم يتم تحديث كل السجلات المطلوبة في هذه الدفعة.');
          }
          return restList('aseel_channels', 'select=*&id=in.(' + ids.join(',') + ')').then(function (verified) {
            verified = Array.isArray(verified) ? verified : [];
            var verifiedById = {};
            verified.forEach(function (row) { verifiedById[row.id] = row; });
            batch.forEach(function (original) {
              var confirmed = verifiedById[original.id];
              if (confirmed && payloadMatchesRecord(confirmed, payload)) {
                Object.assign(original, confirmed);
                report.changed++;
              } else {
                report.failures++;
                report.errors.push('تعذّر تأكيد حفظ القناة: ' + (original.title_ar || original.id));
              }
            });
          });
        }).catch(function (err) {
          report.failures += batch.length;
          report.errors.push(describeError(err));
        });
      });
    }, Promise.resolve()).then(function () { return report; });
  }

  function fetchLiveLinks(collectionId) {
    var all = [];
    function page(offset) {
      return restList('aseel_home_collection_items',
        'select=channel_id,display_order&collection_id=eq.' + encodeURIComponent(collectionId) + '&limit=500&offset=' + offset)
        .then(function (rows) {
          rows = Array.isArray(rows) ? rows : [];
          all = all.concat(rows);
          return rows.length === 500 ? page(offset + 500) : all;
        });
    }
    return page(0);
  }

  function addChannelsToLive(rows) {
    if (!rows.length) return Promise.resolve({ added: 0, existing: 0, failures: 0, errors: [] });
    return restList('aseel_home_collections', 'select=id&slug=eq.live-now&limit=1').then(function (collections) {
      if (!collections || !collections[0]) throw new Error('لم يتم العثور على صف «على الهواء الآن».');
      var collectionId = collections[0].id;
      return fetchLiveLinks(collectionId).then(function (existing) {
        var known = {}, lastOrder = 0;
        existing.forEach(function (item) {
          if (item.channel_id) known[item.channel_id] = true;
          lastOrder = Math.max(lastOrder, Number(item.display_order) || 0);
        });
        var pending = rows.filter(function (row) { return !known[row.id]; });
        var report = { added: 0, existing: rows.length - pending.length, failures: 0, errors: [] };
        var payload = pending.map(function (row, i) {
          return { collection_id: collectionId, channel_id: row.id, display_order: lastOrder + i + 1 };
        });
        return bulkParts(payload, 30).reduce(function (chain, batch) {
          return chain.then(function () {
            return restInsert('aseel_home_collection_items', batch).then(function (returned) {
              var count = Array.isArray(returned) ? returned.length : 0;
              report.added += count;
              report.failures += batch.length - count;
            }).catch(function (err) {
              report.failures += batch.length;
              report.errors.push(describeError(err));
            });
          });
        }, Promise.resolve()).then(function () {
          return fetchLiveLinks(collectionId).then(function (latest) {
            var linked = {};
            latest.forEach(function (item) { if (item.channel_id) linked[item.channel_id] = true; });
            var verifiedCount = pending.filter(function (row) { return linked[row.id]; }).length;
            if (verifiedCount !== report.added) {
              report.errors.push('بعض روابط القنوات لم تثبت في قاعدة البيانات بعد إعادة القراءة.');
            }
            report.failures = pending.length - verifiedCount;
            report.added = verifiedCount;
            return report;
          });
        });
      });
    });
  }

  function runChannelBulk(action) {
    if (state.bulkBusy || !state.adminVerified || !state.table || state.table.table !== 'aseel_channels') {
      toast('يلزم تسجيل دخول مسؤول نشط لتنفيذ العمليات.', 'error');
      return;
    }
    var selected = state.rows.filter(function (row) { return state.selectedChannels[row.id]; });
    if (!selected.length) { toast('حدد قناة أو أكثر أولًا.', 'error'); return; }
    var holder = ($('#bulkRightsHolder') || {}).value || '';
    var reference = ($('#bulkLicenseReference') || {}).value || '';
    var expires = ($('#bulkLicenseExpiry') || {}).value || '';
    var ack = $('#bulkLicenseAck') && $('#bulkLicenseAck').checked;
    holder = holder.trim();
    reference = reference.trim();
    var applyLicense = action === 'license' || (action === 'all' && (holder || reference || expires || ack));
    if (applyLicense) {
      if (!holder || !reference || !ack) {
        toast('أدخل صاحب الحقوق والمرجع ثم أكد صلاحية الترخيص لجميع القنوات المحددة.', 'error');
        return;
      }
      if (holder.length > 250 || reference.length > 500) {
        toast('تجاوز حقل الحقوق الحد الأقصى للطول.', 'error');
        return;
      }
      if (expires && !(new Date(expires + 'T23:59:59').getTime() > Date.now())) {
        toast('تاريخ انتهاء الترخيص غير صالح أو منتهٍ.', 'error');
        return;
      }
    }
    var labels = {
      license: 'اعتماد الترخيص', publish: 'النشر', live: 'إضافة القنوات للبث', all: 'الترخيص والنشر والإضافة'
    };
    if (!window.confirm('تأكيد ' + labels[action] + ' لـ ' + selected.length + ' قناة؟ ستتغير بيانات الإنتاج فعليًا.')) return;
    state.bulkBusy = true;
    syncChannelBulkPanel();
    var results = [];
    var hadFailures = false;
    var flow = Promise.resolve();
    if (applyLicense) {
      flow = flow.then(function () {
        bulkStatus('جارٍ تحديث مراجع الحقوق…');
        var payload = { rights_status: 'approved', rights_holder: holder, license_reference: reference };
        if (expires) payload.rights_expires_at = new Date(expires + 'T23:59:59').toISOString();
        return patchChannelBatch(selected, payload).then(function (report) {
          results.push('الترخيص المؤكد بالداتا: ' + report.changed + ' / ' + selected.length + '، فشل: ' + report.failures);
          if (report.failures || report.errors.length) hadFailures = true;
          if (report.errors.length) results.push(report.errors[0]);
        });
      });
    }
    if (action === 'all' || action === 'publish') {
      flow = flow.then(function () {
        bulkStatus('جارٍ نشر القنوات المستوفية للحقوق والروابط…');
        var allowed = selected.filter(canPublishChannel);
        var draft = allowed.filter(function (row) { return row.status !== 'published'; });
        return patchChannelBatch(draft, { status: 'published' }).then(function (report) {
          results.push('نشر جديد مؤكد: ' + report.changed + '، منشور سابقًا: ' + (allowed.length - draft.length) + '، غير مؤهل: ' + (selected.length - allowed.length) + '، فشل: ' + report.failures);
          if (report.failures || report.errors.length) hadFailures = true;
          if (report.errors.length) results.push(report.errors[0]);
        });
      });
    }
    if (action === 'all' || action === 'live') {
      flow = flow.then(function () {
        bulkStatus('جارٍ إضافة القنوات إلى «على الهواء الآن» دون تكرار…');
        var allowed = selected.filter(function (row) { return row.status === 'published' && canPublishChannel(row); });
        return addChannelsToLive(allowed).then(function (report) {
          results.push('ربط البث المؤكد بالداتا: ' + report.added + ' مضافة، ' + report.existing + ' موجودة، ' +
            (selected.length - allowed.length) + ' غير مؤهلة، ' + report.failures + ' فشل');
          if (report.failures || report.errors.length) hadFailures = true;
          if (report.errors.length) results.push(report.errors[0]);
        });
      });
    }
    flow.then(function () {
      bulkStatus(results.join(' | '));
      toast(hadFailures ? 'اكتمل جزء من العملية مع أخطاء. افتح تقرير النتائج.' : 'تم تأكيد حفظ التغييرات في Supabase.', hadFailures ? 'error' : 'success');
    }).catch(function (err) {
      bulkStatus('توقفت العملية: ' + results.concat([describeError(err)]).join(' | '));
      toast('توقف التنفيذ: ' + describeError(err), 'error');
    }).finally(function () {
      state.bulkBusy = false;
      if (state.table && state.table.table === 'aseel_channels') {
        syncChannelBulkPanel();
        loadTable(state.table);
      }
    });
  }

  function installChannelBulkStyles() {
    var tag = document.createElement('style');
    tag.textContent = [
      '.channel-bulk{margin:14px 0;padding:18px;border-radius:14px;border:1px solid var(--line-strong);background:var(--surface-2)}',
      '.channel-bulk[hidden]{display:none}',
      '.bulk-header,.bulk-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px}',
      '.bulk-header{justify-content:space-between;margin-bottom:12px}',
      '.bulk-header strong{font-size:16px;color:var(--text)}',
      '.bulk-count{font-size:12px;color:var(--gold)}',
      '.bulk-actions{margin:12px 0}',
      '.bulk-license{margin:16px 0;padding:12px;border:1px solid var(--line);border-radius:10px}',
      '.bulk-license summary{cursor:pointer;font-weight:700}',
      '.bulk-hint,.bulk-status{font-size:12px;line-height:1.8;color:var(--text-2)}',
      '.bulk-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px;margin:12px 0}',
      '.bulk-field{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-2)}',
      '.bulk-field input{width:100%;background:var(--surface-2);border:1px solid var(--line-strong);border-radius:8px;padding:10px;color:var(--text)}',
      '.bulk-ack{display:flex;gap:9px;align-items:flex-start;font-size:12px;line-height:1.6}',
      '.bulk-ack input{margin-top:3px;flex:none}',
      '.bulk-check-cell{width:35px;min-width:35px;text-align:center}',
      '.bulk-check-cell input{width:17px;height:17px;accent-color:var(--gold);cursor:pointer}'
    ].join('\n');
    document.head.append(tag);
  }

  /* ---------- publish toggle ---------- */
  function togglePublish(tableCfg, row, button) {
    var field = tableCfg.statusFilter.field;
    var payload = {};
    var next;
    if (field === 'status') {
      var publishing = row.status !== 'published';
      if (publishing && row.link_health_status === 'broken') {
        toast('الرابط معطوب ومخفي. أصلح رابط التشغيل أولًا ليُعاد فحصه قبل النشر.', 'error');
        return;
      }
      if (publishing && isMediaBulkTable(tableCfg) && !canPublishMedia(row, tableCfg.table)) {
        toast('لا يمكن نشر هذا المحتوى قبل استيفاء الرابط والترخيص المطلوبين.', 'error');
        return;
      }
      if (publishing && tableCfg.publishGuard) {
        if (row.rights_status !== 'approved') {
          toast('لا يمكن النشر قبل اعتماد الحقوق — افتح السجل وحدّث قسم الحقوق والتراخيص.', 'error');
          return;
        }
        if (!row.license_reference) {
          toast('مرجع الترخيص مطلوب قبل النشر — افتح السجل وأدخله.', 'error');
          return;
        }
      }
      next = publishing ? 'published' : 'draft';
      payload.status = next;
    } else {
      next = !row[field];
      payload[field] = next;
    }
    if (button) button.disabled = true;
    restUpdate(tableCfg.table, row.id, payload).then(function () {
      row[field] = next;
      toast(next ? 'تم النشر.' : 'تم الإخفاء كمسودة.', 'success');
      applyFilter();
    }).catch(function (err) {
      toast(describeError(err), 'error');
      if (button) button.disabled = false;
    });
  }

  /* ---------- drawer ---------- */
  function openDrawer(row) {
    var tableCfg = state.table;
    if (!tableCfg) return;
    ensureOptions(neededSources(tableCfg)).then(function () {
      showDrawer(tableCfg, row || null);
    });
  }

  function showDrawer(tableCfg, row) {
    if (state.table !== tableCfg) return;
    state.editing = row;
    state.lastFocus = document.activeElement;
    buildDrawerForm(tableCfg, row);

    var drawer = $('#drawer');
    var scrim = $('#drawerScrim');
    drawer.hidden = false;
    scrim.hidden = false;
    document.body.classList.add('is-drawer-open');
    requestAnimationFrame(function () {
      drawer.classList.add('is-open');
      scrim.classList.add('is-open');
    });
    setTimeout(function () {
      var first = drawer.querySelector('input:not([type="hidden"]), select, textarea');
      if (first) first.focus();
    }, 90);
  }

  function closeDrawer(force) {
    if (state.saving && !force) return;
    var drawer = $('#drawer');
    var scrim = $('#drawerScrim');
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('is-open');
    scrim.classList.remove('is-open');
    document.body.classList.remove('is-drawer-open');
    setTimeout(function () { drawer.hidden = true; scrim.hidden = true; }, 240);
    state.editing = null;
    var previous = state.lastFocus;
    state.lastFocus = null;
    if (previous && previous.focus) {
      try { previous.focus(); } catch (e) { /* element gone */ }
    }
  }

  function groupFields(tableCfg, group) {
    return tableCfg.fields.filter(function (f) { return f.group === group; });
  }

  function buildDrawerForm(tableCfg, row) {
    var quickMovie = tableCfg.table === 'aseel_movies' && !row;
    $('#drawerTitle').textContent = quickMovie ? 'إضافة فيلم بسرعة' : (row ? 'تعديل ' : 'إضافة ') + tableCfg.singular;
    $('#drawerKicker').textContent = tableCfg.label;
    $('#drawer').classList.toggle('drawer--quick-movie', quickMovie);
    var caption = $('#drawerSave .btn-label');
    if (caption) caption.textContent = quickMovie ? 'حفظ الفيلم' : 'حفظ';
    var note = $('.drawer-note');
    if (note) note.textContent = quickMovie
      ? 'يُحفظ الفيلم في قاعدة البيانات؛ لا يُعرض للجمهور قبل اعتماد الحقوق والنشر.'
      : 'يُحفظ السجل مباشرة في قاعدة البيانات.';
    $('#drawerError').hidden = true;
    $('#drawerError').textContent = '';

    var form = $('#drawerForm');
    form.replaceChildren();

    if (tableCfg.table === 'aseel_home_collection_items') {
      form.append(el('p', { class: 'form-hint' }, 'اختر الصف ثم عنصرًا واحدًا فقط: فيلم أو مسلسل أو قناة أو حلقة.'));
    }
    if (tableCfg.table === 'aseel_movies' && !row) {
      buildQuickMovieForm(tableCfg, form);
      updatePreview();
      return;
    }
    if (tableCfg.table === 'aseel_series') {
      form.append(el('p', { class: 'form-hint' }, 'يُصنَّف العمل تلقائيًا عند الحفظ، والحلقات ترث تصنيفات المسلسل. أضف رمز بلد الإنتاج الصحيح للحصول على القوائم التركية والأجنبية وغيرها.'));
    }

    cfg.fieldGroups.forEach(function (entry) {
      var group = entry[0];
      var title = entry[1];
      var fields = groupFields(tableCfg, group);
      if (!fields.length) return;

      var groupNode = el('fieldset', { class: 'form-group' });
      groupNode.append(el('legend', null, title));
      if (group === 'rights') {
        groupNode.append(el('p', { class: 'group-hint' }, 'لا يُسمح بالنشر قبل اعتماد الحقوق وإدخال مرجع الترخيص؛ وقد تُرفض الكتابة إذا كانت سياسات RLS تمنعها.'));
      }
      var grid = el('div', { class: 'form-grid' });
      fields.forEach(function (field) { grid.append(buildField(field, row)); });
      groupNode.append(grid);
      form.append(groupNode);
    });

    updatePreview();
  }


  /* New-movie form: one link works for native MP4/HLS or official YouTube. */
  function movieQuickLinkType(value) {
    try {
      var u = new URL(String(value || '').trim());
      if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return '';
      var host = u.hostname.toLowerCase();
      if (host === 'youtu.be' || host === 'youtube.com' || host === 'www.youtube.com' ||
          host === 'm.youtube.com' || host === 'www.youtube-nocookie.com') {
        var parts = u.pathname.split('/').filter(Boolean);
        var id = host === 'youtu.be' ? (parts.length === 1 ? parts[0] : '') :
          u.pathname === '/watch' ? u.searchParams.get('v') :
          ((parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'shorts') && parts.length === 2 ? parts[1] : '');
        return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? 'youtube' : '';
      }
      if ((host === 'hanerix.com' && /^\/e\/[a-z0-9_-]+\/?$/i.test(u.pathname)) ||
          (host === 'player.vimeo.com' && /^\/video\/[0-9]+\/?$/.test(u.pathname)) ||
          (host === 'www.dailymotion.com' && /^\/embed\/video\/[a-z0-9_-]+\/?$/i.test(u.pathname)))
        return 'embed';
      return /\.(?:mp4|m3u8)$/i.test(u.pathname) ? 'stream' : '';
    } catch (err) { return ''; }
  }

  function buildQuickMovieForm(tableCfg, form) {
    var simple = el('section', { class: 'movie-quick' });
    simple.append(el('p', { class: 'movie-quick-intro' }, 'اسم الفيلم + رابط المشاهدة. الباقي اختياري.'));
    var grid = el('div', { class: 'form-grid movie-quick-grid' });
    var primary = ['title_ar', 'poster_url', 'quality', 'country_code'];
    var fields = {};
    tableCfg.fields.forEach(function (field) { fields[field.key] = field; });

    grid.append(buildField(Object.assign({}, fields.title_ar, {
      label: 'اسم الفيلم', placeholder: 'اكتب اسم الفيلم', required: true, span: 2
    }), null));

    var linkWrap = el('div', { class: 'field field--wide movie-quick-link', dataset: { field: 'movie_quick_url' } });
    linkWrap.append(el('label', { for: 'movieQuickUrl' }, 'رابط تشغيل الفيلم'));
    var quickUrl = el('input', { id: 'movieQuickUrl', name: 'movie_quick_url', type: 'url',
      placeholder: 'https://example.com/movie.mp4', 'aria-label': 'رابط تشغيل الفيلم' });
    quickUrl.setAttribute('inputmode', 'url');
    linkWrap.append(quickUrl,
      el('p', { class: 'field-hint' }, 'MP4 أو M3U8 مباشر، أو Embed مدعوم، أو يوتيوب رسمي.'),
      el('p', { class: 'field-msg', id: 'e_movie_quick_url' }));
    grid.append(linkWrap);

    grid.append(buildField(Object.assign({}, fields.poster_url, {
      label: 'صورة الفيلم (اختياري)', hint: 'بدون صورة؟ يظهر شعار العز تلقائيًا.'
    }), null));
    grid.append(buildField(Object.assign({}, fields.quality, {
      label: 'الجودة', default: 'HD'
    }), null));
    grid.append(buildField(Object.assign({}, fields.country_code, {
      label: 'بلد الإنتاج (اختياري)', type: 'select', options: 'movieCountries',
      hint: 'لتصنيف العمل تركي أو أجنبي أو عربي حسب البلد.'
    }), null));

    simple.append(grid);
    simple.append(el('p', { class: 'movie-quick-tip' }, '✓ تصنيفات النوع تكتشف تلقائيًا من بيانات الفيلم.'));
    form.append(simple);

    var extras = el('details', { class: 'movie-quick-extra', id: 'movieQuickExtra' });
    extras.append(el('summary', null, 'خيارات إضافية: الوصف، التصنيف، الجودات، الحقوق والنشر'));
    extras.append(el('p', { class: 'movie-quick-extra-hint' },
      'استخدم الخيارات المتقدمة فقط عند الحاجة؛ النشر يتطلب حقوقًا معتمدة.'));
    cfg.fieldGroups.forEach(function (entry) {
      var fieldsInGroup = tableCfg.fields.filter(function (f) {
        return f.group === entry[0] && primary.indexOf(f.key) === -1;
      });
      if (!fieldsInGroup.length) return;
      var section = el('fieldset', { class: 'form-group' });
      section.append(el('legend', null, entry[1]));
      var items = el('div', { class: 'form-grid' });
      fieldsInGroup.forEach(function (field) { items.append(buildField(field, null)); });
      section.append(items);
      extras.append(section);
    });
    form.append(extras);
    quickUrl.addEventListener('input', function () {
      var link = quickUrl.value.trim(), type = movieQuickLinkType(link);
      var direct = form.elements.namedItem('stream_url'), youtube = form.elements.namedItem('youtube_url');
      if (direct) direct.value = (type === 'stream' || type === 'embed') ? link : '';
      if (youtube) youtube.value = type === 'youtube' ? link : '';
      linkWrap.classList.toggle('is-invalid', !!link && !type);
      var msg = $('#e_movie_quick_url');
      if (msg) msg.textContent = link && !type ? 'الرابط يجب أن يكون MP4 أو M3U8 أو Embed من مصدر معتمد أو يوتيوب.' : '';
    });
  }

  function initialValue(field, row) {
    if (row) {
      var current = row[field.key];
      return current === undefined ? null : current;
    }
    return field.default === undefined ? null : field.default;
  }

  function buildField(field, row) {
    var wrap = el('div', { class: 'field' + (field.span === 2 ? ' field--wide' : '') + (field.type === 'checkbox' ? ' field--check' : '') });
    wrap.dataset.field = field.key;
    var id = 'f_' + field.key;

    var control;
    var value = initialValue(field, row);

    if (field.type === 'checkbox') {
      control = el('input', { type: 'checkbox', id: id, name: field.key });
      control.checked = Boolean(value);
      var switchLabel = el('label', { class: 'switch', for: id });
      switchLabel.append(
        control,
        el('span', { class: 'switch-track', 'aria-hidden': 'true' }),
        el('span', { class: 'switch-text' }, field.label)
      );
      wrap.append(switchLabel);
      wrap.append(el('p', { class: 'field-msg', id: 'e_' + field.key }));
      return wrap;
    }

    var label = el('label', { for: id });
    label.append(document.createTextNode(field.label));
    if (field.required) label.append(el('span', { class: 'req', 'aria-hidden': 'true' }, ' *'));

    if (field.type === 'tags') {
      control = el('div', { class: 'genre-tag-picker', 'data-field': field.key });
      cfg.options.genres.forEach(function(entry) {
        var labelNode=el('label', { class: 'genre-tag-option' });
        var checkbox=el('input', { type: 'checkbox', value: entry[0], 'aria-label': entry[1] });
        checkbox.checked=Array.isArray(value)&&value.indexOf(entry[0])!==-1;
        labelNode.append(checkbox,el('span',null,entry[1]));
        control.append(labelNode);
      });
    } else if (field.type === 'variants') {
      control = buildVariantsEditor(field, value);
      wrap.dataset.field = field.key;
    } else if (field.type === 'select') {
      control = el('select', { id: id, name: field.key });
      var options = field.options ? cfg.options[field.options] : (state.options[field.source] || []).map(function (item) {
        return [item.value, item.label];
      });
      var emptyLabel = field.emptyLabel || (field.required ? 'اختر…' : 'بدون');
      control.append(el('option', { value: '' }, emptyLabel));
      (options || []).forEach(function (pair) {
        control.append(el('option', { value: pair[0] }, pair[1]));
      });
      control.value = value === null || value === undefined ? '' : String(value);
    } else if (field.type === 'textarea') {
      control = el('textarea', { id: id, name: field.key, rows: field.rows || 4 });
      control.value = value === null || value === undefined ? '' : String(value);
      if (field.max) control.maxLength = field.max;
    } else {
      var type = field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : field.type === 'date' ? 'date' : 'text';
      control = el('input', { id: id, name: field.key, type: type });
      if (field.type === 'number') {
        if (field.min !== undefined) control.min = field.min;
        if (field.max !== undefined) control.max = field.max;
      } else if (field.max) {
        control.maxLength = field.max;
      }
      if (field.placeholder) control.placeholder = field.placeholder;
      if (type === 'url') control.setAttribute('inputmode', 'url');
      if (value === null || value === undefined) control.value = '';
      else if (field.type === 'date') control.value = String(value).slice(0, 10);
      else control.value = String(value);
    }

    if (field.type === 'variants') {
      wrap.append(label, control);
    } else {
      wrap.append(label, control);
    }
    if (field.hint) wrap.append(el('p', { class: 'field-hint' }, field.hint));
    wrap.append(el('p', { class: 'field-msg', id: 'e_' + field.key }));
    return wrap;
  }

  function buildVariantsEditor(field, value) {
    var box = el('div', { class: 'variants' });
    box.dataset.field = field.key;
    var list = el('div', { class: 'variants-list' });
    var values = Array.isArray(value) ? value : [];
    if (!values.length && !field.required) values = [];
    values.forEach(function (item) {
      list.append(variantRow(item && item.label ? item.label : '', item && item.url ? item.url : ''));
    });
    var add = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '+ إضافة مصدر');
    add.addEventListener('click', function () {
      if ($$('.variant-row', list).length >= 8) { toast('الحد الأقصى 8 مصادر إضافية.', 'error'); return; }
      list.append(variantRow('', ''));
    });
    box.append(list, add);
    return box;
  }

  function variantRow(label, url) {
    var row = el('div', { class: 'variant-row' });
    var labelInput = el('input', { class: 'variant-label', type: 'text', placeholder: 'مثلاً: HLS 1080p / Embed احتياطي', maxlength: 24, 'aria-label': 'اسم الجودة' });
    labelInput.value = label || '';
    var urlInput = el('input', { class: 'variant-url', type: 'url', placeholder: 'https://…/master.m3u8 أو /e/…', 'aria-label': 'رابط المصدر' });
    urlInput.value = url || '';
    var remove = el('button', {
      class: 'row-btn row-btn--danger', type: 'button', 'aria-label': 'حذف الجودة', title: 'حذف الجودة', html: icon('trash', 14)
    });
    remove.addEventListener('click', function () { row.remove(); });
    row.append(labelInput, urlInput, remove);
    return row;
  }

  function updatePreview() {
    var form = $('#drawerForm');
    if (!form) return;
    var read = function (name) {
      var control = form.elements.namedItem(name);
      if (!control) return '';
      if (control.type === 'checkbox') return control.checked;
      return String(control.value || '').trim();
    };
    var title = read('title_ar') || read('name_ar') || read('title') || '—';
    var poster = read('poster_url');
    var image = $('#previewImage');
    if (image) {
      if (poster && isHttps(poster)) { image.src = poster; image.hidden = false; }
      else { image.hidden = true; image.removeAttribute('src'); }
    }
    $('#previewTitle').textContent = title;

    var parts = [];
    if (read('release_year')) parts.push(read('release_year'));
    if (read('quality')) parts.push(read('quality'));
    var age = read('age_rating');
    if (age && age !== 'all') parts.push(age);
    if (read('duration_minutes')) parts.push(read('duration_minutes') + ' د');
    $('#previewSub').textContent = parts.length ? parts.join(' • ') : 'أدخل بيانات العمل لمعاينة البطاقة';

    var status = state.table && state.table.table === 'aseel_channels' ? 'published' : read('status');
    var statusEl = $('#previewStatus');
    if (status) {
      statusEl.hidden = false;
      statusEl.textContent = status === 'published' ? 'منشور' : 'مسودة';
      statusEl.className = 'pill pill--' + (status === 'published' ? 'published' : 'draft');
    } else {
      statusEl.hidden = true;
    }

    var qualityEl = $('#previewQuality');
    var quality = read('quality');
    if (qualityEl) {
      if (quality) { qualityEl.hidden = false; qualityEl.textContent = quality; }
      else qualityEl.hidden = true;
    }
  }

  /* ---------- form validation + save ---------- */
  function collectPayload(tableCfg) {
    var payload = {};
    var errors = {};
    var form = $('#drawerForm');

    tableCfg.fields.forEach(function (field) {
      var control = form.elements.namedItem(field.key);
      var value = null;

      if (field.type === 'tags') {
        var picker=form.querySelector('.genre-tag-picker[data-field="' + field.key + '"]');
        value=picker ? Array.prototype.map.call(picker.querySelectorAll('input[type="checkbox"]:checked'), function(input){return input.value;}) : [];
      } else if (field.type === 'variants') {
        var box = form.querySelector('.variants[data-field="' + field.key + '"]');
        var rows = box ? $$('.variant-row', box) : [];
        var variants = [];
        rows.forEach(function (rowNode) {
          var labelInput = $('.variant-label', rowNode);
          var urlInput = $('.variant-url', rowNode);
          var label = labelInput ? labelInput.value.trim() : '';
          var url = urlInput ? urlInput.value.trim() : '';
          if (!label && !url) return;
          variants.push({ label: label, url: url });
        });
        value = variants;
        if (variants.length > 8) errors[field.key] = 'الحد الأقصى 8 جودات.';
        else if (variants.some(function (item) { return !item.label || item.label.length > 24 || !isHttps(item.url); })) {
          errors[field.key] = 'كل جودة تحتاج اسمًا (حتى 24 حرفًا) ورابط HTTPS صالحًا.';
        }
      } else if (field.type === 'checkbox') {
        value = control ? Boolean(control.checked) : false;
      } else if (control) {
        var raw = String(control.value || '').trim();
        if (raw === '') {
          value = field.type === 'number' ? (field.emptyZero ? 0 : null) : null;
        } else if (field.type === 'number') {
          var number = Number(raw);
          if (!isFinite(number)) errors[field.key] = 'أدخل رقمًا صحيحًا.';
          value = isFinite(number) ? number : null;
        } else {
          value = raw;
        }
      }

      if (field.required && (value === null || value === '' || (Array.isArray(value) && !value.length))) {
        errors[field.key] = 'هذا الحقل مطلوب.';
      } else if (!errors[field.key] && value !== null) {
        if (field.type === 'url' && !isHttps(value)) errors[field.key] = 'يجب أن يبدأ الرابط بـ https://';
        if (field.type === 'number' && typeof value === 'number') {
          if (field.min !== undefined && value < field.min) errors[field.key] = 'أصغر قيمة مسموحة ' + field.min + '.';
          else if (field.max !== undefined && value > field.max) errors[field.key] = 'أكبر قيمة مسموحة ' + field.max + '.';
        }
        if (field.max && typeof value === 'string' && value.length > field.max) errors[field.key] = 'الحد الأقصى ' + field.max + ' حرفًا.';
      }
      payload[field.key] = value;
    });

    if (tableCfg.table === 'aseel_movies' && !state.editing) {
      var quickUrlInput = $('#movieQuickUrl');
      if (quickUrlInput) {
        var link = quickUrlInput.value.trim();
        var type = movieQuickLinkType(link);
        if (!link && !payload.stream_url && !payload.youtube_url) {
          errors.movie_quick_url = 'أدخل رابط تشغيل الفيلم أولًا.';
        } else if (link && !type) {
          errors.movie_quick_url = 'استخدم رابط MP4 أو M3U8 أو Embed مدعومًا أو فيديو يوتيوب.';
        } else if (type === 'stream' || type === 'embed') {
          payload.stream_url = link;
          payload.youtube_url = null;
        } else if (type === 'youtube') {
          payload.youtube_url = link;
          payload.stream_url = null;
        }
      }
    }

    /* normalise a few well-known columns */
    if (payload.country_code && !/^[A-Za-z]{2}$/.test(payload.country_code)) {
      errors.country_code = 'رمز الدولة يجب أن يكون حرفين لاتينيين مثل SA أو TR.';
    } else if (payload.country_code) {
      payload.country_code = payload.country_code.toUpperCase();
    }
    if (payload.language_code && !/^[A-Za-z]{2,3}$/.test(payload.language_code)) {
      errors.language_code = 'رمز اللغة يجب أن يكون حرفين أو ثلاثة مثل ar أو en.';
    } else if (payload.language_code) {
      payload.language_code = payload.language_code.toLowerCase();
    }
    if (payload.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)) {
      errors.slug = 'استخدم حروفًا لاتينية صغيرة وأرقامًا وشرطات فقط.';
    }
    if (payload.rights_expires_at) {
      var expires = new Date(payload.rights_expires_at + 'T23:59:59');
      if (isNaN(expires.getTime())) errors.rights_expires_at = 'تاريخ غير صالح.';
      else payload.rights_expires_at = expires.toISOString();
    }
    if (tableCfg.table === 'aseel_channels') {
      payload.status = 'published';
      payload.playback_mode = 'stream';
      if (!/^https:\/\/[^\s]+\.(m3u8|mp4)(\?[^\s]*)?$/i.test(payload.stream_url || '')) {
        errors.stream_url = 'أدخل رابط بث HTTPS مباشر بصيغة HLS أو MP4.';
      }
    }
    if (tableCfg.table === 'aseel_home_collection_items') {
      var chosen = ['movie_id', 'series_id', 'channel_id', 'episode_id'].filter(function (key) { return payload[key]; });
      if (chosen.length !== 1) errors.movie_id = 'اختر عنصرًا واحدًا فقط: فيلم أو مسلسل أو قناة أو حلقة.';
      else if (payload.movie_id) { payload.series_id = null; payload.channel_id = null; payload.episode_id = null; }
      else if (payload.series_id) { payload.movie_id = null; payload.channel_id = null; payload.episode_id = null; }
      else if (payload.channel_id) { payload.movie_id = null; payload.series_id = null; payload.episode_id = null; }
      else if (payload.episode_id) { payload.movie_id = null; payload.series_id = null; payload.channel_id = null; }
    }

    /* publishing requires approved rights and a licence reference */
    if (tableCfg.publishGuard && payload.status === 'published') {
      if (payload.rights_status !== 'approved') errors.rights_status = 'لا يمكن النشر قبل اعتماد الحقوق.';
      if (!payload.license_reference) errors.license_reference = 'مرجع الترخيص مطلوب للنشر.';
      if (payload.rights_expires_at && new Date(payload.rights_expires_at) <= new Date()) {
        errors.rights_expires_at = 'انتهت صلاحية الترخيص — لا يمكن النشر.';
      }
    }

    return { payload: payload, errors: errors };
  }

  function clearFieldErrors() {
    var form = $('#drawerForm');
    $$('.field.is-invalid', form).forEach(function (field) { field.classList.remove('is-invalid'); });
    $$('.field-msg', form).forEach(function (msg) { msg.textContent = ''; });
  }

  function showFieldErrors(errors) {
    var form = $('#drawerForm');
    clearFieldErrors();
    var first = null;
    Object.keys(errors).forEach(function (key) {
      var field = form.querySelector('.field[data-field="' + key + '"]');
      if (!field) return;
      var disclosure = field.closest('details');
      if (disclosure) disclosure.open = true;
      field.classList.add('is-invalid');
      var msg = $('.field-msg', field);
      if (msg) msg.textContent = errors[key];
      if (!first) first = field;
    });
    if (first) {
      var control = first.querySelector('input, select, textarea, button');
      if (control) {
        control.focus();
        control.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  function setBtnLoading(button, loading, label) {
    if (!button) return;
    button.disabled = loading;
    var span = button.querySelector('.btn-label');
    if (!span) { span = button; }
    span.textContent = label;
    button.classList.toggle('is-loading', loading);
  }

  function saveDrawer() {
    if (state.saving) return;
    var tableCfg = state.table;
    if (!tableCfg) return;

    var result = collectPayload(tableCfg);
    var errorKeys = Object.keys(result.errors);
    showFieldErrors(result.errors);
    if (errorKeys.length) {
      $('#drawerError').hidden = false;
      $('#drawerError').textContent = 'تحقق من الحقول المميزة بالأحمر قبل الحفظ.';
      toast('تحقق من الحقول المميزة بالأحمر.', 'error');
      return;
    }
    $('#drawerError').hidden = true;

    var editing = state.editing;
    state.saving = true;
    setBtnLoading($('#drawerSave'), true, 'جارٍ الحفظ…');

    var request = editing && editing.id
      ? restUpdate(tableCfg.table, editing.id, result.payload)
      : restInsert(tableCfg.table, result.payload);

    request.then(function (saved) {
      if (!Array.isArray(saved) || !saved.length) {
        throw new Error('لم تؤكد القاعدة حفظ السجل — تحقّق من الصلاحيات وسياسات RLS.');
      }
      toast(editing ? 'تم تحديث السجل بنجاح.' : 'تم إنشاء السجل بنجاح.', 'success');
      state.saving = false;
      setBtnLoading($('#drawerSave'), false, 'حفظ');
      closeDrawer(true);
      if (['aseel_categories', 'aseel_series', 'aseel_seasons', 'aseel_home_collections', 'aseel_content_sources'].indexOf(tableCfg.table) !== -1) {
        clearOptions();
      }
      loadTable(tableCfg);
    }).catch(function (err) {
      state.saving = false;
      setBtnLoading($('#drawerSave'), false, 'حفظ');
      var message = describeError(err);
      $('#drawerError').hidden = false;
      $('#drawerError').textContent = message;
      toast(message, 'error');
    });
  }

  /* ---------- multi-select and deletion across all content tables ---------- */
  function isOtherBulkTable(tableCfg) {
    return !!tableCfg && /^aseel_[a-z_]+$/.test(tableCfg.table) &&
      tableCfg.table !== 'aseel_channels' && !isMediaBulkTable(tableCfg);
  }

  function selectedBulkRows(tableCfg) {
    if (!tableCfg) return [];
    var chosen = tableCfg.table === 'aseel_channels' ? state.selectedChannels :
      isMediaBulkTable(tableCfg) ? state.selectedMedia : state.selectedOther;
    return state.rows.filter(function (row) { return !!chosen[row.id]; });
  }

  function appendBulkDeleteAction(host) {
    var button = el('button', {
      type: 'button', class: 'btn btn-danger btn-sm bulk-delete-btn',
      'aria-label': 'حذف العناصر المحددة نهائيًا'
    }, 'حذف المحدد (0)');
    button.disabled = true;
    button.addEventListener('click', function () { openBulkDelete(state.table); });
    var actions = el('div', { class: 'bulk-actions' });
    actions.append(button);
    host.append(actions);
  }

  function syncBulkDeleteButton() {
    if (!state.table || !state.els.bulkPanel) return;
    var button = $('.bulk-delete-btn', state.els.bulkPanel);
    if (!button) return;
    var count = selectedBulkRows(state.table).length;
    button.textContent = 'حذف المحدد (' + formatNumber(count) + ')';
    button.disabled = state.bulkBusy || state.deleteBusy || !state.adminVerified || count < 1;
  }

  function selectFilteredOther(checked) {
    if (state.bulkBusy || !isOtherBulkTable(state.table)) return;
    state.filteredOther.forEach(function (row) {
      if (checked) state.selectedOther[row.id] = true;
      else delete state.selectedOther[row.id];
    });
    applyFilter();
  }

  function buildOtherBulkPanel(tableCfg) {
    var host = state.els.bulkPanel;
    if (!host) return;
    host.replaceChildren();
    var header = el('div', { class: 'bulk-header' });
    header.append(el('strong', null, 'عمليات جماعية — ' + tableCfg.label),
      el('span', { class: 'bulk-count', id: 'otherBulkSummary', role: 'status' }, '0 محدد'));
    host.append(header);
    var selection = el('div', { class: 'bulk-actions' });
    [
      ['تحديد نتائج البحث', function () { selectFilteredOther(true); }],
      ['تحديد كل العناصر المحمّلة', function () {
        if (state.bulkBusy) return;
        state.rows.forEach(function (row) { state.selectedOther[row.id] = true; });
        applyFilter();
      }],
      ['إلغاء التحديد', function () {
        if (state.bulkBusy) return;
        state.selectedOther = {};
        applyFilter();
      }]
    ].forEach(function (entry) {
      var button = el('button', { class: 'btn btn-ghost btn-sm other-bulk-control', type: 'button' }, entry[0]);
      button.addEventListener('click', entry[1]);
      selection.append(button);
    });
    host.append(selection);
    appendBulkDeleteAction(host);
    host.append(el('p', { class: 'bulk-status', id: 'otherBulkStatus', role: 'status', 'aria-live': 'polite' },
      'حدد العناصر المطلوبة، ثم اضغط حذف المحدد. قد يؤدي حذف المسلسلات أو المواسم إلى حذف الحلقات التابعة لها.'));
    syncOtherBulkPanel();
  }

  function syncOtherBulkPanel() {
    if (!state.table || !isOtherBulkTable(state.table) || !state.els.bulkPanel) return;
    var chosen = selectedBulkRows(state.table);
    var summary = $('#otherBulkSummary');
    if (summary) summary.textContent = formatNumber(chosen.length) + ' محدد من ' + formatNumber(state.rows.length);
    var filtered = state.filteredOther || [];
    var marked = filtered.filter(function (row) { return !!state.selectedOther[row.id]; }).length;
    var master = $('.bulk-check-cell input', state.els.thead);
    if (master) {
      master.checked = filtered.length > 0 && marked === filtered.length;
      master.indeterminate = marked > 0 && marked < filtered.length;
      master.disabled = state.bulkBusy;
    }
    $('.other-bulk-control', state.els.bulkPanel).forEach(function (button) {
      button.disabled = state.bulkBusy;
    });
    syncBulkDeleteButton();
  }

  function bulkDeleteWarning(tableName) {
    if (tableName === 'aseel_series') return 'حذف المسلسل يحذف مواسمه وحلقاته أيضًا تلقائيًا.';
    if (tableName === 'aseel_seasons') return 'حذف الموسم يحذف جميع حلقاته أيضًا.';
    if (tableName === 'aseel_channels' || tableName === 'aseel_movies' || tableName === 'aseel_episodes') {
      return 'قد تُحذف روابط هذه العناصر من صفوف الصفحة الرئيسية المرتبطة بها.';
    }
    if (tableName === 'aseel_home_collections') return 'حذف صف الرئيسية يزيل العناصر المرتبطة بذلك الصف.';
    return 'قد تتأثر العلاقات المرتبطة بالسجلات المحددة.';
  }

  function openBulkDelete(tableCfg) {
    if (!tableCfg || state.bulkBusy || !state.adminVerified) {
      toast('يلزم تسجيل الدخول بصلاحية المسؤول قبل الحذف.', 'error');
      return;
    }
    var selected = selectedBulkRows(tableCfg);
    if (!selected.length) { toast('حدد عنصرًا أو أكثر أولًا.', 'error'); return; }
    // Reuse the existing accessible confirmation dialog, with a count-specific phrase.
    openDelete(tableCfg, selected[0]);
    state.deleteTargets = selected.slice();
    state.deletePhrase = 'حذف ' + selected.length;
    $('#deleteText').textContent = 'سيتم حذف ' + formatNumber(selected.length) +
      ' من ' + tableCfg.label + ' نهائيًا من قاعدة البيانات. ' +
      bulkDeleteWarning(tableCfg.table) + ' لا يمكن التراجع عن العملية.';
    var label = $('#deleteConfirmLabel');
    if (label) label.textContent = 'اكتب «' + state.deletePhrase + '» لتأكيد حذف العناصر المحددة';
    $('#deleteConfirmInput').placeholder = state.deletePhrase;
    $('#deleteConfirmBtn').textContent = 'حذف ' + formatNumber(selected.length) + ' نهائيًا';
    $('#deleteConfirmBtn').disabled = true;
  }

  function deleteSelectedBatch(tableName, selected) {
    if (!/^aseel_[a-z_]+$/.test(tableName) || !Array.isArray(selected)) {
      return Promise.reject(new Error('جدول الحذف غير صالح.'));
    }
    var idsSeen = {};
    selected.forEach(function (row) {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(row.id)) {
        throw new Error('معرف محتوى غير صالح، تم إلغاء الحذف.');
      }
      if (idsSeen[row.id]) throw new Error('عناصر مكررة في التحديد.');
      idsSeen[row.id] = true;
    });
    var result = { requested: selected.length, deleted: 0, failed: 0, errors: [], deletedIds: [] };
    return bulkParts(selected, 25).reduce(function (chain, batch) {
      return chain.then(function () {
        var ids = batch.map(function (row) { return row.id; });
        var filter = 'id=in.(' + ids.join(',') + ')';
        return api(tableName + '?' + filter, {
          method: 'DELETE', headers: { Prefer: 'return=representation' }
        }).then(function (returned) {
          if (!Array.isArray(returned)) throw new Error('الخادم لم يؤكد السجلات المحذوفة.');
          var confirmedByDelete = {};
          returned.forEach(function (row) { if (idsSeen[row.id]) confirmedByDelete[row.id] = true; });
          // A 2xx alone does not mean deletion: verify the rows really disappeared.
          return restList(tableName, 'select=id&' + filter + '&limit=30').then(function (remaining) {
            if (!Array.isArray(remaining)) throw new Error('تعذر التحقق من حذف الدفعة.');
            var remainingById = {};
            remaining.forEach(function (row) { remainingById[row.id] = true; });
            ids.forEach(function (id) {
              if (confirmedByDelete[id] && !remainingById[id]) {
                result.deleted++;
                result.deletedIds.push(id);
              } else {
                result.failed++;
                if (result.errors.length < 5) result.errors.push('لم يؤكد حذف العنصر ' + id.slice(0, 8));
              }
            });
          });
        }).catch(function (error) {
          result.failed += ids.length;
          if (result.errors.length < 5) result.errors.push(describeError(error));
        });
      });
    }, Promise.resolve()).then(function () { return result; });
  }

  /* ---------- delete modal ---------- */
  function openDelete(tableCfg, row) {
    if (state.bulkBusy || state.deleteBusy) return;
    state.deleteTargets = null;
    state.deletePhrase = 'حذف';
    var labelNode = $('#deleteConfirmLabel');
    if (labelNode) labelNode.textContent = 'اكتب «حذف» للتأكيد';
    $('#deleteConfirmInput').placeholder = 'حذف';
    state.deleteTarget = row;
    state.deleteTable = tableCfg;
    state.lastFocus = document.activeElement;
    var label = row.title_ar || row.name_ar || row.title || ('#' + String(row.id).slice(0, 8));
    $('#deleteText').textContent = 'سيتم حذف «' + label + '» نهائيًا من ' + tableCfg.label + '. لا يمكن التراجع عن هذه العملية.';
    $('#deleteConfirmInput').value = '';
    $('#deleteConfirmBtn').disabled = true;
    $('#deleteConfirmBtn').textContent = 'حذف نهائي';
    $('#deleteError').hidden = true;
    $('#deleteModal').hidden = false;
    $('#modalScrim').hidden = false;
    requestAnimationFrame(function () {
      $('#deleteModal').classList.add('is-open');
      $('#modalScrim').classList.add('is-open');
    });
    setTimeout(function () { $('#deleteConfirmInput').focus(); }, 70);
  }

  function closeDeleteModal(force) {
    var modal = $('#deleteModal');
    if (!modal || modal.hidden) return;
    if (state.deleteBusy && !force) return;
    modal.classList.remove('is-open');
    $('#modalScrim').classList.remove('is-open');
    setTimeout(function () {
      modal.hidden = true;
      $('#modalScrim').hidden = true;
    }, 220);
    state.deleteTarget = null;
    state.deleteTargets = null;
    state.deletePhrase = 'حذف';
    state.deleteTable = null;
    var previous = state.lastFocus;
    state.lastFocus = null;
    if (previous && previous.focus) {
      try { previous.focus(); } catch (e) { /* element gone */ }
    }
  }

  function confirmDelete() {
    var row = state.deleteTarget;
    var tableCfg = state.deleteTable;
    if (!row || !tableCfg || state.deleteBusy) return;
    if ($('#deleteConfirmInput').value.trim() !== state.deletePhrase) return;
    var button = $('#deleteConfirmBtn');
    if (state.deleteTargets) {
      if (state.bulkBusy || !state.adminVerified) return;
      var selected = state.deleteTargets.slice();
      state.deleteBusy = true;
      state.bulkBusy = true;
      button.disabled = true;
      button.textContent = 'جارٍ الحذف والتحقق…';
      syncBulkDeleteButton();
      return deleteSelectedBatch(tableCfg.table, selected).then(function (report) {
        var selection = tableCfg.table === 'aseel_channels' ? state.selectedChannels :
          isMediaBulkTable(tableCfg) ? state.selectedMedia : state.selectedOther;
        report.deletedIds.forEach(function (id) { delete selection[id]; });
        var summary = 'تم حذف ' + report.deleted + ' من أصل ' + report.requested +
          '، تعذّر حذف ' + report.failed + '.';
        if (report.failed) summary += ' ' + report.errors.slice(0, 2).join('؛ ');
        var target = tableCfg.table === 'aseel_channels' ? $('#bulkStatus') :
          isMediaBulkTable(tableCfg) ? $('#mediaBulkStatus') : $('#otherBulkStatus');
        if (target) target.textContent = summary;
        if (report.deleted > 0) {
          state.deleteBusy = false;
          state.bulkBusy = false;
          closeDeleteModal(true);
          toast(summary, report.failed ? 'error' : 'success');
          if (state.table === tableCfg) loadTable(tableCfg);
        } else {
          $('#deleteError').hidden = false;
          $('#deleteError').textContent = summary;
          toast(summary, 'error');
          button.textContent = 'إعادة محاولة الحذف';
        }
      }).catch(function (err) {
        $('#deleteError').hidden = false;
        $('#deleteError').textContent = describeError(err);
        toast(describeError(err), 'error');
        button.textContent = 'إعادة محاولة الحذف';
      }).finally(function () {
        state.deleteBusy = false;
        state.bulkBusy = false;
        syncBulkDeleteButton();
        if (!$('#deleteModal').hidden) button.disabled = false;
      });
    }
    state.deleteBusy = true;
    button.disabled = true;
    button.textContent = 'جارٍ الحذف…';
    restDelete(tableCfg.table, row.id).then(function () {
      toast('تم حذف السجل.', 'success');
      state.deleteBusy = false;
      closeDeleteModal(true);
      loadTable(tableCfg);
    }).catch(function (err) {
      state.deleteBusy = false;
      var message = describeError(err);
      $('#deleteError').hidden = false;
      $('#deleteError').textContent = message;
      toast(message, 'error');
      button.textContent = 'حذف نهائي';
      button.disabled = $('#deleteConfirmInput').value.trim() !== 'حذف';
    });
  }

  /* ---------- dashboard ---------- */
  var DASH_DEFS = [
    { key: 'movies', table: 'aseel_movies', label: 'أفلام', icon: 'film', meta: true, type: 'فيلم' },
    { key: 'series', table: 'aseel_series', label: 'مسلسلات', icon: 'tv', meta: true, type: 'مسلسل' },
    { key: 'episodes', table: 'aseel_episodes', label: 'حلقات', icon: 'layers', meta: false, type: 'حلقة' },
    { key: 'channels', table: 'aseel_channels', label: 'قنوات', icon: 'radio', meta: false, type: 'قناة' }
  ];

  function fetchDashboardRows(table, withMeta) {
    var columns = withMeta ? 'id,title_ar,status,poster_url,created_at' : 'id,status,created_at';
    return restList(table, 'select=' + columns + '&order=created_at.desc&limit=500').catch(function (err) {
      if (err.status === 400 || err.status === 404) {
        var plain = withMeta ? 'id,title_ar,status,poster_url' : 'id,status';
        return restList(table, 'select=' + plain + '&limit=500');
      }
      throw err;
    });
  }

  function renderDashboard() {
    var view = $('#view');
    var token = ++state.loadToken;
    view.replaceChildren();

    var head = el('div', { class: 'view-head' });
    var headText = el('div', { class: 'view-head-text' });
    headText.append(el('p', { class: 'eyebrow' }, 'OVERVIEW'));
    headText.append(el('h2', { class: 'view-title' }, 'مركز التحكم بالمحتوى'));
    headText.append(el('p', { class: 'view-sub' }, 'إدارة الأفلام والمسلسلات والحلقات والقنوات من مكان واحد.'));
    var actions = el('div', { class: 'view-actions' });
    var refresh = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' });
    refresh.append(el('span', { class: 'btn-icon', html: icon('refresh', 15) }), el('span', null, 'تحديث المؤشرات'));
    refresh.addEventListener('click', renderDashboard);
    actions.append(refresh);
    head.append(headText, actions);
    view.append(head);

    var kpis = el('div', { class: 'kpis' });
    DASH_DEFS.forEach(function (def) {
      var card = el('article', { class: 'kpi', id: 'kpi-' + def.key });
      var top = el('div', { class: 'kpi-top' });
      top.append(el('span', { class: 'kpi-icon', html: icon(def.icon, 18) }), el('span', { class: 'kpi-label' }, def.label));
      card.append(top);
      card.append(el('strong', { class: 'kpi-value is-loading', id: 'kpiValue-' + def.key }, '—'));
      card.append(el('span', { class: 'kpi-foot', id: 'kpiFoot-' + def.key }, 'جارٍ التحميل…'));
      kpis.append(card);
    });
    view.append(kpis);

    var grid = el('div', { class: 'dash-grid' });

    var statusCard = el('section', { class: 'card' });
    var statusHead = el('header', { class: 'card-head' });
    statusHead.append(el('h3', null, 'حالة النشر'), el('span', { class: 'card-meta', id: 'dashTotal' }, ''));
    var statusBody = el('div', { class: 'status-body', id: 'statusBody' });
    statusBody.append(el('span', { class: 'skeleton skeleton-bar' }));
    statusCard.append(statusHead, statusBody);

    var latestCard = el('section', { class: 'card' });
    var latestHead = el('header', { class: 'card-head' });
    latestHead.append(el('h3', null, 'أحدث الإضافات'));
    var latestLink = el('a', { class: 'card-link', href: '#movies' }, 'كل الأفلام');
    latestLink.addEventListener('click', function (ev) { ev.preventDefault(); openSection('movies'); });
    latestHead.append(latestLink);
    var latestBody = el('div', { class: 'latest', id: 'latestBody' });
    latestBody.append(el('span', { class: 'skeleton skeleton-row' }));
    latestCard.append(latestHead, latestBody);

    grid.append(statusCard, latestCard);
    view.append(grid);
    view.append(el('p', { class: 'dash-note' }, 'المؤشرات تعكس السجلات المحمّلة في لوحة الإدارة، وليست تقريرًا تجميعيًا من قاعدة البيانات.'));

    Promise.all(DASH_DEFS.map(function (def) {
      return fetchDashboardRows(def.table, def.meta).then(function (rows) {
        return { def: def, rows: Array.isArray(rows) ? rows : [] };
      }).catch(function (err) {
        return { def: def, rows: [], error: err };
      });
    })).then(function (results) {
      if (token !== state.loadToken) return;
      paintDashboard(results);
    });
  }

  function paintDashboard(results) {
    var failures = results.filter(function (item) { return item.error; });
    var all = [];
    var totals = { total: 0, published: 0 };

    results.forEach(function (item) {
      var def = item.def;
      var valueEl = document.getElementById('kpiValue-' + def.key);
      var footEl = document.getElementById('kpiFoot-' + def.key);
      var rows = item.rows || [];

      if (item.error) {
        if (valueEl) { valueEl.textContent = '—'; valueEl.classList.remove('is-loading'); }
        if (footEl) footEl.textContent = 'تعذر التحميل';
        return;
      }

      var published = rows.filter(function (row) { return row.status === 'published'; }).length;
      if (valueEl) {
        valueEl.textContent = rows.length >= 500 ? '500+' : formatNumber(rows.length);
        valueEl.classList.remove('is-loading');
      }
      if (footEl) footEl.textContent = 'منشور ' + formatNumber(published) + ' · مسودة ' + formatNumber(rows.length - published);
      totals.total += rows.length;
      totals.published += published;

      rows.forEach(function (row) { all.push({ row: row, def: def }); });
    });

    var statusBody = $('#statusBody');
    if (failures.length === results.length) {
      if (statusBody) {
        statusBody.replaceChildren();
        statusBody.append(errorCard(describeError(failures[0].error), function () { renderDashboard(); }));
      }
      var latestBody = $('#latestBody');
      if (latestBody) {
        latestBody.replaceChildren();
        latestBody.append(errorCard(describeError(failures[0].error), function () { renderDashboard(); }));
      }
      return;
    }

    var totalEl = $('#dashTotal');
    if (totalEl) totalEl.textContent = formatNumber(totals.total) + ' سجل';

    if (statusBody) {
      statusBody.replaceChildren();
      var publishedCount = totals.published;
      var draftCount = Math.max(totals.total - publishedCount, 0);
      var bar = el('div', { class: 'status-bar', role: 'img', 'aria-label': 'نسبة المنشور إلى المسودة' });
      if (totals.total > 0) {
        bar.append(el('span', { class: 'status-seg status-seg--published', style: 'width:' + (publishedCount / totals.total * 100).toFixed(1) + '%' }));
        bar.append(el('span', { class: 'status-seg status-seg--draft', style: 'width:' + (draftCount / totals.total * 100).toFixed(1) + '%' }));
      } else {
        bar.append(el('span', { class: 'status-seg status-seg--draft', style: 'width:100%' }));
      }
      statusBody.append(bar);

      var legend = el('div', { class: 'status-legend' });
      [
        { cls: 'published', label: 'منشور', count: publishedCount },
        { cls: 'draft', label: 'مسودة', count: draftCount }
      ].forEach(function (item) {
        var row = el('div', { class: 'legend-row' });
        row.append(el('span', { class: 'legend-dot legend-dot--' + item.cls }));
        row.append(el('span', { class: 'legend-label' }, item.label));
        row.append(el('strong', { class: 'legend-value' }, formatNumber(item.count)));
        var percent = totals.total ? Math.round(item.count / totals.total * 100) : 0;
        row.append(el('span', { class: 'legend-pct' }, percent + '%'));
        legend.append(row);
      });
      statusBody.append(legend);
      statusBody.append(el('p', { class: 'status-note' }, 'قنوات البث المباشر الجديدة تُنشر تلقائيًا عند حفظ بياناتها وصحة رابطها.'));
    }

    var latestHost = $('#latestBody');
    if (latestHost) {
      latestHost.replaceChildren();
      var newest = all.filter(function (item) { return item.row.title_ar && item.row.created_at; })
        .sort(function (a, b) { return new Date(b.row.created_at) - new Date(a.row.created_at); })
        .slice(0, 6);
      if (!newest.length) {
        latestHost.append(el('p', { class: 'latest-empty' }, 'لا توجد إضافات حديثة لعرضها.'));
      } else {
        newest.forEach(function (item) {
          latestHost.append(latestRow(item.row, item.def));
        });
      }
    }
  }

  function latestRow(row, def) {
    var node = el('div', { class: 'latest-item' });
    var poster = el('div', { class: 'poster poster--sm' });
    poster.append(el('span', { class: 'poster-fallback', 'aria-hidden': 'true' }, 'EZ'));
    if (row.poster_url && isHttps(row.poster_url)) {
      var img = el('img', { alt: '', loading: 'lazy' });
      img.addEventListener('error', function () { img.hidden = true; });
      img.src = row.poster_url;
      poster.append(img);
    }
    var copy = el('div', { class: 'latest-copy' });
    copy.append(el('strong', null, row.title_ar));
    copy.append(el('small', null, def.type + ' · ' + fmtDate(row.created_at)));
    node.append(poster, copy);
    node.append(el('span', { class: 'pill pill--' + (row.status === 'published' ? 'published' : 'draft') }, row.status === 'published' ? 'منشور' : 'مسودة'));
    return node;
  }

  /* ---------- focus trap ---------- */
  function trapFocus(container, event) {
    var focusable = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
      .filter(function (node) { return node.getClientRects().length > 0; });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---------- login UI ---------- */
  function setLoginBusy(busy) {
    var button = $('#loginSubmit');
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle('is-loading', busy);
    var label = button.querySelector('.btn-label');
    if (label) label.textContent = busy ? 'جارٍ التحقق…' : 'تسجيل الدخول';
  }

  function showLoginError(message) {
    var box = $('#loginError');
    if (!box) return;
    box.hidden = false;
    box.textContent = message;
  }

  function handleLogin(event) {
    event.preventDefault();
    var email = $('#loginEmail').value.trim();
    var password = $('#loginPassword').value;
    var errorBox = $('#loginError');
    errorBox.hidden = true;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showLoginError('أدخل بريدًا إلكترونيًا صالحًا.');
      $('#loginEmail').focus();
      return;
    }
    if (!password) {
      showLoginError('أدخل كلمة المرور.');
      $('#loginPassword').focus();
      return;
    }

    setLoginBusy(true);
    signIn(email, password).then(function (data) {
      var user = data.user || {};
      var session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || '',
        expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
        email: user.email || email,
        user_id: user.id || ''
      };
      writeSession(session);
      $('#loginPassword').value = '';
      setLoginBusy(false);
      showApp();
      verifyAdmin();
      openSection('dashboard');
      toast('تم تسجيل الدخول بصلاحيات الإدارة.', 'success');
    }).catch(function (err) {
      setLoginBusy(false);
      showLoginError(describeError(err));
      $('#loginPassword').select();
    });
  }

  function logout() {
    var session = state.session;
    clearSession();
    state.adminVerified = false;
    state.rows = [];
    clearOptions();
    if (session && session.access_token) {
      fetch(cfg.supabaseUrl + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: cfg.publishableKey, Authorization: 'Bearer ' + session.access_token }
      }).catch(function () { /* logout is best-effort */ });
    }
    showLogin();
    toast('تم تسجيل الخروج.', 'info');
  }

  /* ---------- boot ---------- */
  function bindEvents() {
    $('#loginForm').addEventListener('submit', handleLogin);
    $('#logoutBtn').addEventListener('click', logout);
    $('#bannerClose').addEventListener('click', function () { $('#adminWarning').hidden = true; });

    var toggle = $('#togglePassword');
    toggle.addEventListener('click', function () {
      var input = $('#loginPassword');
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
      toggle.setAttribute('aria-label', showing ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
      input.focus();
    });

    $('#drawerClose').addEventListener('click', function () { closeDrawer(); });
    $('#drawerCancel').addEventListener('click', function () { closeDrawer(); });
    $('#drawerScrim').addEventListener('click', function () { closeDrawer(); });
    $('#drawerForm').addEventListener('submit', function (ev) { ev.preventDefault(); saveDrawer(); });
    $('#drawerForm').addEventListener('input', updatePreview);
    $('#drawerForm').addEventListener('change', updatePreview);
    $('#previewImage').addEventListener('error', function () { $('#previewImage').hidden = true; });

    $('#deleteCancelBtn').addEventListener('click', function () { closeDeleteModal(); });
    $('#modalScrim').addEventListener('click', function () { closeDeleteModal(); });
    $('#deleteConfirmBtn').addEventListener('click', confirmDelete);
    $('#deleteConfirmInput').addEventListener('input', function () {
      $('#deleteConfirmBtn').disabled = state.deleteBusy || this.value.trim() !== state.deletePhrase;
    });

    $('#globalSearch').addEventListener('input', function () {
      if (!state.els.search) return;
      state.els.search.value = this.value;
      state.query = this.value.trim().toLowerCase();
      applyFilter();
    });

    document.addEventListener('keydown', function (event) {
      var drawer = $('#drawer');
      var modal = $('#deleteModal');
      if (event.key === 'Escape') {
        if (modal && !modal.hidden) { closeDeleteModal(); return; }
        if (drawer && !drawer.hidden) { closeDrawer(); return; }
      }
      if (event.key === 'Tab') {
        if (modal && !modal.hidden) trapFocus(modal, event);
        else if (drawer && !drawer.hidden) trapFocus(drawer, event);
      }
    });

    window.addEventListener('hashchange', function () {
      if (!state.session) return;
      openSection(sectionFromHash(), { push: false });
    });
  }

  function boot() {
    installChannelBulkStyles();
    renderNav();
    bindEvents();

    var session = readSession();
    if (!session) {
      showLogin();
      return;
    }
    state.session = session;
    showApp();

    var needsRefresh = session.expires_at && Number(session.expires_at) < Date.now() + 30000;
    var ready = needsRefresh ? refreshSession().then(function (ok) { return ok; }) : Promise.resolve(true);

    ready.then(function (ok) {
      if (!ok) {
        showLogin();
        toast('انتهت الجلسة — سجّل الدخول من جديد.', 'error');
        return;
      }
      $('#accountEmail').textContent = state.session.email || '';
      verifyAdmin();
      openSection(sectionFromHash(), { push: false });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
