/* Durable worker dashboard. All requests stay behind the existing site gate. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('smart-sync')) return;
  const state = {offset:0, limit:50, csrf:'', selected:new Map(), target:null,
    busy:false, refreshing:false, signature:'', searchTimer:null, previousFocus:null,scheduleEditing:false};
  const labels = {healthy:'سليم',broken:'معطوب',suspect:'يحتاج مراجعة',unchecked:'لم يُفحص',
    missing_source:'يحتاج مصدرًا',pending:'بانتظار الفحص',reachable:'صفحة متاحة',
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
  function selectionCount() { $('autoCheckSelected').textContent = `فحص المحدد (${state.selected.size})`; $('autoRenewSelected').textContent = `تجديد المحدد (${state.selected.size})`; }
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
    for (const [id, value] of [['autoDue',data.due_count],['autoExpiring',data.expiring_soon],
      ['autoRetrying',data.retrying],['autoActive',data.in_progress]]) {
      $(id).textContent = Number(value || 0).toLocaleString('ar-SA');
    }
    if (!state.scheduleEditing) {
      const interval = String(Math.round(Number(data.interval_hours || 4)));
      const lead = String(Math.round(Number(data.expiry_lead_minutes || 5)));
      if ([...$('autoScheduleInterval').options].some(option=>option.value===interval)) $('autoScheduleInterval').value=interval;
      if ([...$('autoScheduleLead').options].some(option=>option.value===lead)) $('autoScheduleLead').value=lead;
    }
    const running = data.running && data.enabled;
    $('autoWorkerBadge').textContent = !data.connected ? 'ينتظر اتصال قاعدة البيانات' :
      !data.enabled ? 'متوقف مؤقتًا' : running ? 'العامل يعمل' : 'العامل غير نشط';
    $('autoWorkerBadge').className = 'auto-badge '+(!data.connected ? 'suspect' : running ? 'running' : 'paused');
    $('autoMode').textContent = {http:'طلبات مباشرة',auto:'تلقائي · متصفح عند الحاجة',headless:'متصفح مخفي'}[data.mode] || data.mode || '—';
    $('autoLastCheck').textContent = date(data.last_check);
    $('autoNextCheck').textContent = date(data.next_check);
    $('autoPendingUploads').textContent = data.pending_uploads || 0;
    if (data.last_error) notice(data.last_error, true);
    else if (!data.connected) notice('العامل يحتاج مفتاح Supabase السري في إعدادات الخادم ليعمل بصورة مستقلة.');
    else if (!data.enabled) notice('المزامنة متوقفة مؤقتًا. المصادر والمهام محفوظة ويمكن استئنافها.');
    else if (counts.missing_source) notice(`يوجد ${counts.missing_source} عنصرًا يحتاج صفحة مصدر أصلية. يمكن فحص روابطه الحالية، ويبدأ تجديدها بعد إضافة المصدر.`);
    else notice(`آخر نبضة للعامل: ${date(data.last_tick)} · تحديث المكتبة: ${date(data.last_import)}. الفحص كل ${Number(data.interval_hours||4)} ساعات وتجديد الروابط الموقعة قبل انتهاء صلاحيتها.`);
    const pause = document.querySelector('[data-auto-action="pause"]');
    const resume = document.querySelector('[data-auto-action="resume"]');
    pause.hidden = !data.enabled; resume.hidden = !!data.enabled;
  }
  function button(label, handler, cls='small-outline') {
    const node = el('button',cls,label); node.type = 'button'; node.onclick = handler; return node;
  }
  function renderTargets(data) {
    const targets = Array.isArray(data) ? data : data.targets || data.items || [];
    const signature = JSON.stringify([targets,data.total,state.offset,$('autoFilter').value]);
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
        el('span','',`الفحص التالي: ${date(target.next_check)}`),
        el('span','',`التجديد التالي: ${date(target.next_refresh)}`));
      if (target.primary_expires_at) {
        const remaining = Number(target.primary_expires_at) - Date.now()/1000;
        meta.append(el('span',remaining <= 0 ? 'auto-expires-critical' :
          remaining < 3600 ? 'auto-expires-soon' : '',
          (remaining <= 0 ? 'انتهت صلاحية الرابط: ' : 'انتهاء الرابط: ') + date(target.primary_expires_at)));
      }
      if (target.failures > 0) meta.append(el('span','','محاولات فاشلة: '+Number(target.failures)));
      info.append(meta);
      if (!target.page_url) info.append(el('p','auto-target-error','المصدر الأصلي مفقود؛ أضف صفحة الفيلم أو الحلقة من «المصادر».'));
      if (target.error) info.append(el('p','auto-target-error',target.error));
      const actions = el('div','auto-target-buttons'); actions.append(badge(target.status),
        button('المصادر',()=>showSources(target)),
        button('فحص',()=>action(async()=>{
          await api('target',{table:target.table_name,id:target.target_id,action:'check'});
          notice('أضيف العنصر إلى طابور الفحص.');
        })),
        button('تجديد',()=>action(async()=>{
          await api('target',{table:target.table_name,id:target.target_id,action:'refresh'});
          notice('أضيفت صفحة المصدر إلى طابور التجديد.');
        })));
      row.append(check,info,actions); container.append(row);
    });
    const total = data.total;
    $('autoPrev').disabled = state.offset === 0;
    $('autoNext').disabled = typeof total === 'number' ? state.offset+targets.length >= total : targets.length < state.limit;
    $('autoPageLabel').textContent = targets.length ? `${state.offset+1}–${state.offset+targets.length}${typeof total === 'number' ? ' من '+total : ''}` : 'لا توجد نتائج';
  }
  function renderFeeds(data) {
    const feeds = Array.isArray(data?.feeds) ? data.feeds : [];
    const host = $('autoFeedsList');
    if (!host) return;
    $('autoFeedCount').textContent = feeds.length.toLocaleString('ar-SA')+' مصادر';
    host.replaceChildren();
    if (!feeds.length) {
      host.append(el('p','auto-empty','لا توجد قوائم اكتشاف مسجلة. أضف رابط فهرس أفلام أو مسلسلات لتبدأ المزامنة التلقائية.'));
      return;
    }
    feeds.forEach(feed => {
      const row=el('article','auto-target auto-feed-row');
      const info=el('div','auto-feed-details');
      const heading=el('strong','',feed.kind==='movie'?'أفلام':feed.kind==='series'?'مسلسلات':'أفلام ومسلسلات');
      const url=el('p','auto-feed-link',feed.source_url);
      const stats=el('div','auto-target-meta');
      stats.append(
        el('span','',feed.enabled?'نشط':'متوقف'),
        el('span','',`كل ${Math.round(Number(feed.interval_minutes||240)/60)} ساعات`),
        el('span','',`آخر زيارة: ${date(feed.last_scan)}`),
        el('span','',`الموعد القادم: ${date(feed.next_scan)}`),
        el('span','',`آخر أعمال جديدة: ${Number(feed.last_created||0)}`));
      info.append(heading,url,stats);
      if(feed.last_error)info.append(el('p','auto-target-error',feed.last_error));
      const actions=el('div','auto-target-buttons');
      actions.append(button('افحص الآن',()=>action(async()=>{
        await api('feed',{action:'scan',id:feed.id});
        $('autoFeedNotice').textContent='أُضيف مصدر الاكتشاف إلى جدول الفحص.';
      })));
      actions.append(button(feed.enabled?'إيقاف':'استئناف',()=>action(async()=>{
        await api('feed',{action:feed.enabled?'pause':'resume',id:feed.id});
        $('autoFeedNotice').textContent='حُفظ وضع مصدر الاكتشاف.';
      })));
      row.append(info,actions);host.append(row);
    });
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
      const query = new URLSearchParams({limit:state.limit,offset:state.offset,q:$('autoSearch').value.trim(),filter:$('autoFilter').value});
      const results = await Promise.allSettled([api('status'),api('targets?'+query),api('events?limit=40'),api('feeds')]);
      if (results[0].status === 'fulfilled') renderStatus(results[0].value);
      else notice(results[0].reason.message, true);
      if (results[1].status === 'fulfilled') renderTargets(results[1].value);
      if (results[2].status === 'fulfilled') renderEvents(results[2].value);
      if (results[3].status === 'fulfilled') renderFeeds(results[3].value);
      else if($('autoFeedNotice')) $('autoFeedNotice').textContent = results[3].reason.message;
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
  $('autoFeedForm').onsubmit = event => {
    event.preventDefault();
    action(async()=>{
      const url=$('autoFeedUrl').value.trim();
      const kind=$('autoFeedKind').value;
      const interval_minutes=Number($('autoFeedInterval').value);
      await api('feed',{action:'add',url,kind,interval_minutes});
      $('autoFeedUrl').value='';
      $('autoFeedNotice').textContent='تم حفظ المصدر في Supabase؛ يبدأ الفحص التلقائي في الخلفية.';
    });
  };
  async function bulkSelected(mode) {
    if (!state.selected.size) throw new Error('حدّد فيلمًا أو حلقة أولًا.');
    if (state.selected.size > 60) throw new Error('الحد الأقصى 60 عنصرًا لكل دفعة.');
    const targets = [...state.selected.values()].map(item=>({table:item.table_name,id:item.target_id}));
    const result = await api('bulk',{action:mode,targets});
    state.selected.clear(); selectionCount();
    notice(`أضيف ${result.queued} عنصرًا إلى طابور ${mode==='refresh'?'التجديد':'الفحص'}.`);
  }
  $('autoCheckSelected').onclick = ()=>action(()=>bulkSelected('check'));
  $('autoRenewSelected').onclick = ()=>action(()=>bulkSelected('refresh'));
  $('autoScheduleForm').onsubmit = event => {
    event.preventDefault();
    action(async()=>{
      const interval_hours=Number($('autoScheduleInterval').value);
      const expiry_lead_minutes=Number($('autoScheduleLead').value);
      const result=await api('schedule',{interval_hours,expiry_lead_minutes});
      state.scheduleEditing=false;
      notice(`حُفظت الجدولة: فحص كل ${result.interval_hours} ساعة، وتجديد مبكر قبل ${result.expiry_lead_minutes} دقيقة.`);
    });
  };
  $('autoScheduleInterval').onchange = ()=>{state.scheduleEditing=true;};
  $('autoScheduleLead').onchange = ()=>{state.scheduleEditing=true;};
  $('autoFilter').onchange = ()=>{state.offset=0;state.signature='';refresh(true);};
  $('autoSearch').oninput = ()=>{
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(()=>{state.offset=0;state.signature='';refresh(true);},300);
  };
  $('autoPrev').onclick = ()=>{state.offset=Math.max(0,state.offset-state.limit);state.signature='';refresh(true);};
  $('autoNext').onclick = ()=>{state.offset+=state.limit;state.signature='';refresh(true);};
  $('autoRefreshView').onclick = ()=>refresh(true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  // Let the existing studio establish its session first to avoid racing cookies.
  setTimeout(()=>refresh(),1200);
  setInterval(()=>refresh(),12000);
})();
