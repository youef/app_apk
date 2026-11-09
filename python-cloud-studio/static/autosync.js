/* Durable worker dashboard. All requests stay behind the existing site gate. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('smart-sync')) return;
  const state = {offset:0, limit:50, csrf:'', selected:new Map(), target:null,
    busy:false, refreshing:false, signature:'', searchTimer:null, previousFocus:null};
  const labels = {healthy:'سليم',broken:'معطوب',suspect:'يحتاج مراجعة',unchecked:'لم يُفحص',
    missing_source:'يحتاج مصدرًا',pending:'بانتظار الفحص',checking:'جارٍ الفحص',discovered:'تم اكتشاف الحلقات',reachable:'صفحة متاحة',
    direct:'فيديو مباشر',embed:'صفحة مشغل',page:'صفحة المصدر',source:'صفحة المصدر',original:'صفحة المصدر'};
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = String(text ?? '');
    return node;
  };
  const date = value => {
    if (!value) return '—';
    const timestamp = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : value;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('ar-SA-u-ca-gregory', {dateStyle:'short',timeStyle:'short'});
  };
  const key = target => `${target.table_name}:${target.target_id}`;
  const badge = value => el('span', 'auto-badge '+(Object.hasOwn(labels,value) ? value : ''), labels[value] || value || '—');
  async function api(route, body) {
    if (body !== undefined && !state.csrf) {
      const response = await fetch('/api/init', {credentials:'same-origin',cache:'no-store'});
      let init;
      try { init = await response.json(); }
      catch (_) { throw new Error('انتهت جلسة الإدارة؛ حدّث الصفحة وسجّل الدخول.'); }
      if (!response.ok || !init.csrf) throw new Error('انتهت جلسة الإدارة؛ حدّث الصفحة وسجّل الدخول.');
      state.csrf = init.csrf;
    }
    const response = await fetch('/api/autosync/'+route, {credentials:'same-origin',cache:'no-store',
      method:body === undefined ? 'GET' : 'POST',
      headers:body === undefined ? {'Accept':'application/json'} :
        {'Accept':'application/json','Content-Type':'application/json','X-CSRF-Token':state.csrf},
      body:body === undefined ? undefined : JSON.stringify(body)});
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('تعذّر الاتصال بعامل المزامنة.'); }
    if (!response.ok) {
      if (response.status === 403) state.csrf = '';
      throw new Error(typeof result.detail === 'string' ? result.detail : 'تعذّر إكمال طلب المزامنة.');
    }
    return result;
  }
  function notice(message, error=false) {
    $('autoNotice').textContent = message;
    $('autoNotice').dataset.error = String(error);
  }
  function selectionCount() { $('autoCheckSelected').textContent = `فحص المحدد (${state.selected.size})`; }
  async function action(task) {
    if (state.busy) return;
    state.busy = true;
    const buttons = [...$('smart-sync').querySelectorAll('button'),...$('autoSourcesModal').querySelectorAll('button[type=submit]')];
    buttons.forEach(button => button.disabled = true);
    let failure = '';
    try { await task(); state.signature = ''; }
    catch (error) { failure = error.message; }
    finally {
      state.busy = false; buttons.forEach(button => button.disabled = false);
      state.signature = ''; await refresh(true);
      if (failure) {
        notice(failure, true);
        if (!$('autoSourcesModal').hidden) $('autoSourceNotice').textContent = failure;
      }
    }
  }
  function renderStatus(data) {
    const counts = data.counts || {};
    for (const [id, value] of [['autoTotal',counts.total],['autoHealthy',counts.healthy],
      ['autoBroken',(counts.broken||0)+(counts.suspect||0)],['autoMissing',counts.missing_source]]) {
      $(id).textContent = Number(value || 0).toLocaleString('ar-SA');
    }
    const running = data.running && data.enabled;
    $('autoWorkerBadge').textContent = !data.enabled ? 'متوقف مؤقتًا' :
      !data.connected ? 'ينتظر اتصال قاعدة البيانات' : running ? 'العامل يعمل' : 'العامل غير نشط';
    $('autoWorkerBadge').className = 'auto-badge '+(!data.connected ? 'suspect' : running ? 'running' : 'paused');
    $('autoMode').textContent = {http:'طلبات مباشرة',auto:'تلقائي · متصفح عند الحاجة',headless:'متصفح مخفي'}[data.mode] || data.mode || '—';
    $('autoLastCheck').textContent = date(data.last_check);
    $('autoNextCheck').textContent = date(data.next_check);
    $('autoPendingUploads').textContent = data.pending_uploads || 0;
    if (!data.enabled) notice('المزامنة متوقفة مؤقتًا. المصادر والمهام محفوظة ويمكن استئنافها.');
    else if (!data.connected && data.local_mode && data.session_authenticated) notice('تسجيل دخول المسؤول مؤكد. جارٍ ربط جلسة الاستوديو بعامل المزامنة.');
    else if (data.last_error) notice(data.last_error, true);
    else if (!data.connected) notice(data.local_mode ? 'سجّل دخول مسؤول Supabase من زر تسجيل الدخول لتشغيل المزامنة على جهازك.' : 'العامل يحتاج مفتاح Supabase السري في إعدادات الخادم ليعمل بصورة مستقلة.');
    else if (data.import_error) notice('تعذر تحديث بيانات المكتبة. يستمر فحص العناصر المسجلة. '+data.import_error,true);
    else if (!data.last_import && !data.active_checks) notice(`جارٍ قراءة المكتبة ومصادرها من Supabase · ${data.pending_checks || 0} عنصر بانتظار الفحص.`);
    else if (data.active_checks || data.pending_checks) notice(`جارٍ العمل على ${data.active_checks} عنصر · ${data.pending_checks} بانتظار الفحص.`);
    else if (counts.missing_source) notice(`يوجد ${counts.missing_source} عنصرًا يحتاج صفحة مصدر أصلية. يمكن فحص روابطه الحالية، ويبدأ تجديدها بعد إضافة المصدر.`);
    else notice(`آخر نبضة للعامل: ${date(data.last_tick)} · آخر تحديث للمكتبة: ${date(data.last_import)}. الفحص مجدول كل 24 ساعة مع إعادة محاولة المتعثر.`);
    const pause = document.querySelector('[data-auto-action="pause"]');
    const resume = document.querySelector('[data-auto-action="resume"]');
    pause.hidden = !data.enabled; resume.hidden = !!data.enabled;
  }
  function button(label, handler, cls='small-outline') {
    const node = el('button',cls,label); node.type = 'button'; node.onclick = handler; return node;
  }
  function renderTargets(data) {
    const targets = Array.isArray(data) ? data : data.targets || data.items || [];
    const signature = JSON.stringify([targets,state.offset]);
    if (signature === state.signature) return;
    state.signature = signature;
    const container = $('autoTargets'); container.replaceChildren();
    if (!targets.length) container.append(el('p','auto-empty','لا توجد عناصر مطابقة. استخدم «تحديث المكتبة من Supabase» لجلب العناصر الموجودة.'));
    targets.forEach(target => {
      const row = el('article','auto-target');
      const check = el('input','auto-target-check'); check.type = 'checkbox';
      check.checked = state.selected.has(key(target));
      check.setAttribute('aria-label','تحديد '+target.title);
      check.onchange = () => {
        if (check.checked) state.selected.set(key(target),target); else state.selected.delete(key(target));
        selectionCount();
      };
      const info = el('div'); info.append(el('div','auto-target-title',target.title || 'عنصر بلا عنوان'));
      const meta = el('div','auto-target-meta');
      meta.append(el('span','',target.table_name === 'aseel_movies' ? 'فيلم' : target.table_name === 'aseel_series' ? 'مسلسل' : 'حلقة'),
        el('span','',`مصادر: ${target.source_count||0} · صالحة: ${target.valid_sources||0}`),
        el('span','',`آخر فحص: ${date(target.last_check)}`),
        el('span','',`الفحص القادم: ${date(target.next_check)}`),
        el('span','',`التجديد القادم: ${date(target.next_refresh)}`));
      info.append(meta);
      if (!target.page_url) info.append(el('p','auto-target-error','المصدر الأصلي مفقود؛ أضف صفحة الفيلم أو الحلقة من «المصادر».'));
      if (target.error) info.append(el('p','auto-target-error',target.error));
      const actions = el('div','auto-target-buttons'); actions.append(badge(target.scan_state || target.status),
        button('المصادر',()=>showSources(target)),
        button('فحص',()=>action(async()=>{
          await api('target',{table:target.table_name,id:target.target_id,action:'check'});
          notice('أضيف العنصر إلى طابور الفحص.');
        })),
        button('تجديد',()=>action(async()=>{
          await api('target',{table:target.table_name,id:target.target_id,action:'refresh'});
          notice('أضيفت صفحة المصدر إلى طابور التجديد.');
        })));
      if (target.table_name==='aseel_series') {
        actions.append(button(target.auto_publish?'إيقاف النشر التلقائي':'تفعيل نشر الحلقات تلقائيًا',()=>action(async()=>{
          if (!target.auto_publish && !confirm('أؤكد أن لدي تصريحًا لنشر الحلقات الجديدة من هذا المسلسل بعد التحقق من روابطها.')) return;
          await api('target',{table:target.table_name,id:target.target_id,
            action:target.auto_publish?'publish-disable':'publish-enable',rights_authorized:!target.auto_publish});
          await refresh(true);
        })));
      }
      row.append(check,info,actions); container.append(row);
    });
    const total = data.total;
    $('autoPrev').disabled = state.offset === 0;
    $('autoNext').disabled = typeof total === 'number' ? state.offset+targets.length >= total : targets.length < state.limit;
    $('autoPageLabel').textContent = targets.length ? `${state.offset+1}–${state.offset+targets.length}${typeof total === 'number' ? ' من '+total : ''}` : 'لا توجد نتائج';
  }
  function renderEvents(data) {
    const events = Array.isArray(data) ? data : data.events || data.items || [];
    const host = $('autoEvents'); host.replaceChildren();
    if (!events.length) host.append(el('p','auto-empty','لا توجد تغييرات مسجلة بعد.'));
    events.forEach(event => {
      const row = el('div','auto-event');
      row.append(el('time','',date(event.created_at || event.at || event.timestamp)),
        el('span','',event.message || event.detail || event.error || event.kind || event.action || 'تحديث'));
      host.append(row);
    });
  }
  async function refresh(force=false) {
    if (state.refreshing || document.hidden && !force) return;
    state.refreshing = true;
    try {
      const query = new URLSearchParams({limit:state.limit,offset:state.offset,q:$('autoSearch').value.trim(),scope:$('autoScope').value});
      const results = await Promise.allSettled([api('status'),api('targets?'+query),api('events?limit=40')]);
      if (results[0].status === 'fulfilled') renderStatus(results[0].value);
      else notice(results[0].reason.message, true);
      if (results[1].status === 'fulfilled') renderTargets(results[1].value);
      if (results[2].status === 'fulfilled') renderEvents(results[2].value);
    } finally { state.refreshing = false; }
  }
  async function loadSources() {
    const target = state.target;
    if (!target) return;
    const host = $('autoSourcesList'); host.replaceChildren(el('p','auto-empty','جارٍ تحميل المصادر…'));
    try {
      const query = new URLSearchParams({table:target.table_name,id:target.target_id});
      const data = await api('sources?'+query);
      if (state.target !== target) return;
      const sources = Array.isArray(data) ? data : data.sources || data.items || [];
      host.replaceChildren();
      if (!sources.length) host.append(el('p','auto-empty','لا توجد مصادر محفوظة بعد. أضف صفحة المصدر الأصلية لهذا العنصر.'));
      sources.forEach(source => {
        const card = el('article','auto-source');
        const heading = el('div','auto-source-heading');
        heading.append(el('strong','',source.label || labels[source.kind] || 'مصدر'),badge(source.status || (source.verified ? 'healthy' : 'unchecked')));
        card.append(heading);
        let url;
        try { url = new URL(source.url); } catch (_) { url = null; }
        if (url?.protocol === 'https:' && !url.username && !url.password) {
          const link = el('a','',source.url); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
        } else card.append(el('p','',source.url || '—'));
        const confidence = Number(source.confidence || 0);
        const metrics = el('div','auto-source-metrics');
        metrics.append(el('span','',labels[source.kind] || source.kind || 'مصدر'),
          el('span','',`الثقة: ${Math.round(confidence <= 1 ? confidence*100 : confidence)}٪`),
          el('span','',`اكتُشف: ${date(source.first_seen_at)}`),
          el('span','',`آخر فحص: ${date(source.last_checked_at)}`));
        if (source.expires_at) metrics.append(el('span','',`انتهاء متوقع: ${date(source.expires_at)}`));
        card.append(metrics);
        if (source.error) card.append(el('small','',source.error));
        host.append(card);
      });
    } catch (error) { host.replaceChildren(el('p','auto-empty',error.message)); }
  }
  async function showSources(target) {
    state.target = target; state.previousFocus = document.activeElement;
    $('autoSourcesTitle').textContent = 'مصادر '+(target.title || 'العنصر');
    $('autoSourceIdentity').textContent = `${target.table_name} · ${target.target_id}`;
    $('autoSourceUrl').value = ''; $('autoSourceNotice').textContent = '';
    $('autoSourcesModal').hidden = false; $('autoSourcesClose').focus();
    await loadSources();
  }
  function closeSources() {
    $('autoSourcesModal').hidden = true; state.target = null;
    state.previousFocus?.focus();
  }
  $('autoSourcesClose').onclick = closeSources;
  $('autoSourcesModal').onclick = event => { if (event.target === $('autoSourcesModal')) closeSources(); };
  document.addEventListener('keydown',event=>{
    if ($('autoSourcesModal').hidden) return;
    if (event.key === 'Escape') closeSources();
    if (event.key === 'Tab') {
      const focusable = [...$('autoSourcesModal').querySelectorAll('button,input,a[href]')].filter(node=>!node.disabled);
      const first = focusable[0], last = focusable[focusable.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  $('autoSourceForm').onsubmit = event => {
    event.preventDefault();
    if (!state.target) return;
    const target = state.target;
    action(async()=>{
      const url = new URL($('autoSourceUrl').value.trim());
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('استخدم رابط HTTPS عامًا لصفحة المصدر.');
      await api('target',{table:target.table_name,id:target.target_id,action:'sources',url:url.href});
      $('autoSourceNotice').textContent = 'حُفظ المصدر وأضيف إلى طابور الاستخراج.';
      $('autoSourceUrl').value = ''; await loadSources();
    });
  };
  document.querySelectorAll('[data-auto-action]').forEach(control=>control.onclick=()=>action(async()=>{
    await api('control',{action:control.dataset.autoAction});
    notice({'pause':'أُوقفت المزامنة مؤقتًا.','resume':'استؤنفت المزامنة.','check-all':'أضيفت المكتبة إلى طابور الفحص.',
      'refresh-all':'أضيفت المصادر إلى طابور التجديد.','import':'بدأ تحديث المكتبة من Supabase.'}[control.dataset.autoAction]);
  }));
  $('autoCheckSelected').onclick = ()=>action(async()=>{
    if (!state.selected.size) throw new Error('حدّد فيلمًا أو حلقة أولًا.');
    const targets = [...state.selected.values()];
    for (const target of targets) await api('target',{table:target.table_name,id:target.target_id,action:'check'});
    state.selected.clear(); selectionCount(); notice(`أضيف ${targets.length} عنصرًا إلى طابور الفحص.`);
  });
  $('autoScope').onchange = ()=>{
    state.offset=0; state.signature=''; state.selected.clear(); selectionCount(); refresh(true);
  };
  $('autoSearch').oninput = ()=>{
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(()=>{state.offset=0;state.signature='';refresh(true);},300);
  };
  $('autoPrev').onclick = ()=>{state.offset=Math.max(0,state.offset-state.limit);state.signature='';refresh(true);};
  $('autoNext').onclick = ()=>{state.offset+=state.limit;state.signature='';refresh(true);};
  $('autoRefreshView').onclick = ()=>refresh(true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('hashchange',()=>{if(location.hash==='#smart-sync')refresh(true);});
  // Let the existing studio establish its session first to avoid racing cookies.
  setTimeout(()=>refresh(),1200);
  setInterval(()=>{if(location.hash==='#smart-sync')refresh();},3000);
})();
