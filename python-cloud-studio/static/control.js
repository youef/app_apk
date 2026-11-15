/* Isolated dashboard: never calls or patches media discovery. */
(function(){
  'use strict';
  const $ = function(id){return document.getElementById(id);};
  const state = {csrf:'',view:'overview',kind:'series',filter:'all',query:'',library:null,
    overview:null,selected:new Map(),alerts:[],audit:[],authenticated:false,loading:false};
  const esc = function(v){return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });};
  const date = function(v){if (!v) return '—';let num=Number(v);
    const d = new Date(num>10000000000?num:(num>1000000000?num*1000:v));
    return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('ar-SA',{dateStyle:'short',timeStyle:'short'}).format(d);
  };
  function toast(msg,kind){let el=document.createElement('div');el.className='toast '+(kind||'');el.textContent=msg;
    $('toastHost').prepend(el);setTimeout(function(){el.remove();},5500);}
  function error(msg){$('globalError').hidden=!msg;$('globalError').textContent=msg||'';}
  async function api(path,body){
    const opts={credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
    if(body!==undefined){opts.method='POST';opts.body=JSON.stringify(body);
      opts.headers['Content-Type']='application/json';opts.headers['X-CSRF-Token']=state.csrf;}
    const response=await fetch(path,opts);
    let payload={};try{payload=await response.json();}catch(e){throw Error('استجابة الخادم غير صالحة');}
    if(!response.ok)throw Error(typeof payload.detail==='string'?payload.detail:('HTTP '+response.status));
    return payload;
  }
  function metric(label,value,icon,caption){
    return '<article class="metric"><div><span class="metric-label">'+esc(label)+'</span><span class="metric-icon">'+esc(icon)+'</span></div><strong class="metric-value">'+esc(value)+'</strong><span class="metric-note">'+esc(caption)+'</span></article>';
  }
  function labelStatus(value){return ({healthy:'سليم',broken:'معطل',suspect:'يحتاج مراجعة',
    published:'منشور',draft:'مسودة',unchecked:'لم يُفحص',missing:'بدون رابط'})[value]||'قيد المراجعة';}
  function tag(value){return '<span class="tag '+esc(value)+'">'+esc(labelStatus(value))+'</span>';}
  function alertView(a){
    return '<div class="alert-row '+(!a.read_at?'unread':'')+'"><span class="alert-mark '+esc(a.severity)+'">'+
      (a.severity==='danger'?'!':a.severity==='warning'?'◷':'✓')+'</span><div class="alert-content"><b>'+esc(a.title)+
      '</b><p>'+esc(a.message)+'</p><time>'+date(a.created_at)+'</time></div></div>';
  }
  function showOverview(){
    const o=state.overview;if(!o)return;
    const c=o.counts||{};const total=(c.movies||0)+(c.episodes||0);
    $('metricGrid').innerHTML=metric('الأفلام المسجلة',c.movies||0,'▷','من قاعدة المزامنة')+
      metric('المسلسلات المسجلة',c.series||0,'▦','إجمالي الأعمال المسجلة')+
      metric('الحلقات المسجلة',c.episodes||0,'◫','في المكتبة')+
      metric('روابط قريبة الانتهاء',o.expiring||0,'◷','خلال 90 دقيقة');
    const rate=total?Math.round(100*(c.healthy||0)/total):0;
    $('libraryPercent').textContent=rate+'%';
    $('healthProgress').setAttribute('aria-valuenow',rate);
    $('healthProgress').querySelector('span').style.width=rate+'%';
    $('healthLegend').innerHTML='<span>✓ سليم <b>'+esc(c.healthy||0)+'</b></span><span>◷ مراجعة <b>'+esc((c.suspect||0)+(c.unchecked||0))+
      '</b></span><span>✕ متعطل <b>'+esc(c.broken||0)+'</b></span><span>أخطاء مهام <b>'+esc(o.errors||0)+'</b></span>';
    const w=o.worker||{};
    $('workerBadge').classList.toggle('bad',!w.running||!w.connected);
    $('workerBadge').innerHTML='<span class="dot"></span>'+(w.running&&w.connected?'المزامنة متصلة':'المزامنة غير متصلة');
    $('sideSignal').style.background=w.running&&w.connected?'var(--green)':'var(--red)';
    $('workerSummary').textContent=(w.running?'العامل يعمل':'العامل متوقف')+' · '+
      (w.enabled?'المزامنة مفعلة':'المزامنة معطلة')+' · آخر نبضة '+date(w.last_tick)+
      ' · الفحص القادم '+date(o.next_due)+(o.storage&&o.storage.durable?' · سجل التنبيهات محفوظ في Supabase':' · تخزين السجل المحلي فقط')+(o.storage&&o.storage.error?' · '+o.storage.error:'')+(w.last_error?' · '+w.last_error:'');
    $('recentAlerts').innerHTML=(o.alerts&&o.alerts.length?o.alerts.map(alertView).join(''):
       '<div class="empty">لا توجد تنبيهات حتى الآن.</div>');
    $('sideAlertCount').textContent=o.alerts_unread||0;
    $('sideAlertCount').hidden=!o.alerts_unread;
    $('lastUpdated').textContent='آخر تحديث '+new Intl.DateTimeFormat('ar-SA',{timeStyle:'short'}).format(new Date());
  }
  async function loadOverview(quiet){
    try{const result=await api('/api/control/overview');state.overview=result;showOverview();if(!quiet)error('');}
    catch(e){if(!quiet)error(e.message);}
  }
  async function loadLibrary(quiet){
    if(state.loading)return;state.loading=true;
    if(!quiet)$('libraryList').innerHTML='<div class="loading">جارٍ قراءة بيانات Supabase…</div>';
    try{
      const lib=await api('/api/control/library');state.library=lib;state.authenticated=!!lib.authenticated;
      $('authButton').textContent=lib.authenticated?'✓ مسؤول متصل':'دخول المسؤول';
      if(!lib.authenticated){
        $('libraryList').innerHTML='<div class="empty">سجّل الدخول بحساب مسؤول Supabase لعرض العلاقات بين المسلسلات والمواسم والحلقات.<br>اضغط «دخول المسؤول» بالأعلى.</div>';
      }else{renderLibrary();}
      if(!quiet)error('');
    }catch(e){if(!quiet)error(e.message);$('libraryList').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
    finally{state.loading=false;}
  }
  function isMatch(row,search){return (String(row.title_ar||'')+' '+String(row.number||'')).toLocaleLowerCase('ar').includes(search);}
  function passes(row){
    if(state.filter==='all')return true;
    if(state.filter==='published')return row.status==='published';
    if(state.filter==='draft')return row.status!=='published';
    if(state.filter==='healthy')return row.link_health_status==='healthy';
    if(state.filter==='missing')return !row.stream_url;
    return true;
  }
  function selection(key){return state.selected.has(key)?' checked':'';}
  function checkbox(table,id){
    const key=table+':'+id;
    return '<input type="checkbox" aria-label="تحديد للنشر أو التجديد" data-select-table="'+esc(table)+
      '" data-select-id="'+esc(id)+'"'+selection(key)+'>';
  }
  function movieCard(movie){
    let table='aseel_movies',ready=movie.link_health_status==='healthy',status=movie.status||'draft';
    return '<article class="content-card"><div class="card-heading">'+checkbox(table,movie.id)+
      '<span class="poster-dot">▷</span><div class="title-wrap"><h3>'+esc(movie.title_ar||'فيلم بدون عنوان')+
      '</h3><p>'+(movie.stream_url?'يوجد رابط تشغيل':'لا يوجد رابط تشغيل')+' · '+(movie.rights_status==='approved'?'حقوق معتمدة':'الحقوق قيد المراجعة')+
      '</p></div>'+tag(status)+tag(ready?'healthy':'missing')+
      '<div class="card-actions"><button data-action="history" data-table="'+table+'" data-id="'+esc(movie.id)+
      '" data-title="'+esc(movie.title_ar)+'">مصادر التشغيل</button><button data-action="refresh" data-table="'+table+
      '" data-id="'+esc(movie.id)+'">⟳ جدولة فحص</button></div></div></article>';
  }
  function episodeRow(ep){
    const table='aseel_episodes',status=ep.status||'draft';
    return '<div class="episode-item">'+checkbox(table,ep.id)+'<span class="ep-no">'+esc(ep.number||'—')+
      '</span><div class="ep-copy"><strong>'+esc(ep.title_ar||('الحلقة '+ep.number))+
      '</strong><small>'+(ep.stream_url?'يوجد رابط':'الرابط مفقود')+' · '+(status==='published'?'منشور':'مسودة')+
      '</small></div>'+tag(ep.link_health_status==='healthy'?'healthy':'missing')+
      '<button data-action="history" data-table="'+table+'" data-id="'+esc(ep.id)+
      '" data-title="'+esc(ep.title_ar)+'" title="سجل مصادر الحلقة">≡</button>'+
      '<button data-action="refresh" data-table="'+table+'" data-id="'+esc(ep.id)+'" title="جدولة تحديث الحلقة">⟳</button></div>';
  }
  function seriesCard(series){
    const search=state.query.toLocaleLowerCase('ar'), matches=isMatch(series,search);
    const sections=(series.seasons||[]).map(function(season){
      let eps=season.episodes||[];
      if(search&&!matches)eps=eps.filter(function(e){return isMatch(e,search);});
      if(state.filter==='duplicates'&&!season.duplicate_total)return '';
      if(state.filter==='gaps'&&!season.missing_total)return '';
      if(!['gaps','duplicates'].includes(state.filter))eps=eps.filter(passes);
      if(!eps.length&&state.filter!=='gaps'&&state.filter!=='duplicates')return '';
      let warning='';
      if(season.missing_total)warning+='<div class="warning-line">◷ حلقات ناقصة: '+esc(season.missing.join('، '))+(season.missing_total>100?' …':'')+'</div>';
      if(season.duplicate_total)warning+='<div class="warning-line">⚠ أرقام حلقات مكررة: '+esc(season.duplicate.join('، '))+'</div>';
      return '<details class="season-block"'+(search||state.filter!=='all'?' open':'')+'><summary>'+esc(season.title)+' <small>'+
        esc(season.episodes.length)+' حلقة'+(season.missing_total?' · '+season.missing_total+' ناقصة':'')+
        (season.duplicate_total?' · '+season.duplicate_total+' مكررة':'')+'</small></summary>'+warning+
        '<div class="episode-stack">'+(eps.length?eps.map(episodeRow).join(''):'<div class="empty">لا توجد حلقات تطابق البحث.</div>')+'</div></details>';
    }).filter(Boolean).join('');
    if(!matches&&!sections)return '';
    if(state.filter==='duplicates'&&!sections||state.filter==='gaps'&&!sections)return '';
    return '<article class="content-card"><div class="card-heading">'+checkbox('aseel_series',series.id)+
      '<span class="poster-dot">▦</span><div class="title-wrap"><h3>'+esc(series.title_ar||'مسلسل بدون عنوان')+
      '</h3><p>'+esc(series.episode_count)+' حلقة · '+esc(series.verified_count)+' رابط سليم · '+
      esc((series.seasons||[]).length)+' مواسم</p></div>'+tag(series.status||'draft')+
      '<div class="card-actions"><button data-action="refresh" data-table="aseel_series" data-id="'+esc(series.id)+
      '">⟳ فحص المواسم</button></div></div>'+sections+'</article>';
  }
  function renderLibrary(){
    const lib=state.library;if(!lib||!lib.authenticated)return;
    const totals=lib.totals||{};
    $('librarySummary').textContent=totals.series+' مسلسل · '+totals.movies+' فيلم';
    $('libraryStats').innerHTML='<span>الحلقات <b>'+esc(totals.episodes||0)+'</b></span><span>المنشور <b>'+
      esc(totals.published||0)+'</b></span><span>المسودات <b>'+esc(totals.drafts||0)+'</b></span><span>بدون رابط <b>'+
      esc(totals.missing_links||0)+'</b></span>';
    let result;
    if(state.kind==='movies'){
      result=(lib.movies||[]).filter(function(e){return passes(e)&&(!state.query||isMatch(e,state.query.toLocaleLowerCase('ar')));})
        .map(movieCard).join('');
    }else{result=(lib.series||[]).map(seriesCard).filter(Boolean).join('');}
    $('libraryList').innerHTML=result||'<div class="empty">لا توجد نتائج تطابق البحث أو الفلتر.</div>';
    showSelection();
  }
  function showSelection(){
    $('selectedCount').textContent=state.selected.size;
    ['bulkPublish','bulkDraft','bulkRefresh','clearSelection'].forEach(function(id){$(id).disabled=!state.selected.size;});
  }
  function changeView(view){
    if(!['overview','library','alerts','history'].includes(view))return;
    state.view=view;
    const names={overview:'نظرة عامة',library:'إدارة المكتبة',alerts:'مركز التنبيهات',history:'سجل العمليات'};
    $('pageCrumb').textContent=names[view];
    document.querySelectorAll('[data-panel]').forEach(function(el){el.hidden=el.dataset.panel!==view;});
    document.querySelectorAll('[data-view]').forEach(function(el){el.classList.toggle('active',el.dataset.view===view);});
    if(view==='library')loadLibrary(true);
    if(view==='alerts')loadAlerts();
    if(view==='history')loadHistory();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  async function loadAlerts(){
    try{const r=await api('/api/control/alerts?limit=100');state.alerts=r.alerts||[];
      $('allAlertList').innerHTML=state.alerts.length?state.alerts.map(alertView).join(''):
        '<div class="empty">لا توجد تنبيهات بعد. تبقى التنبيهات محفوظة أثناء إغلاق الصفحة.</div>';
    }catch(e){toast(e.message,'error');}
  }
  async function loadHistory(){
    try{const r=await api('/api/control/audit?limit=120');state.audit=r.audits||[];
      $('auditList').innerHTML=state.audit.length?state.audit.map(function(a){
        const verbs={publish:'نشر محتوى',draft:'إعادة لمسودة',manual_refresh:'طلب تجديد',scheduled_refresh:'جدولة تجديد تلقائي'};
        return '<div class="audit-item"><span class="audit-icon">≡</span><div><strong>'+
          esc(verbs[a.action]||a.action)+'</strong><p>'+esc(a.detail||a.target_id)+' · '+
          esc(a.new_status||a.table_name)+'</p><time>'+date(a.created_at)+'</time></div></div>';
      }).join(''):'<div class="empty">لم تحدث عمليات إدارة بعد.</div>';
    }catch(e){toast(e.message,'error');}
  }
  async function showSource(table,id,title){
    $('detailTitle').textContent=title||'تاريخ مصادر التشغيل';
    $('detailContent').innerHTML='<div class="loading">جارٍ تحميل التاريخ...</div>';
    $('detailDialog').showModal();
    try{
      const data=await api('/api/control/sources?table='+encodeURIComponent(table)+'&id='+encodeURIComponent(id));
      $('detailContent').innerHTML=(data.sources&&data.sources.length?data.sources.map(function(s){
        return '<div class="source-row"><b>'+esc(s.kind==='original'?'صفحة المصدر':s.kind==='direct'?'رابط فيديو مباشر':'مشغل مضمّن')+
          ' · '+esc(labelStatus(s.status))+'</b><code>'+esc(s.address)+'</code><small>ظهر: '+date(s.first_seen_at)+
          ' · آخر فحص: '+date(s.last_seen_at)+'<br>الصلاحية: '+date(s.expires_at)+
          ' · نجاح: '+esc(s.successes)+' / فشل: '+esc(s.failures)+'</small></div>';
      }).join(''):'<div class="empty">لم تُسجّل روابط بعد. يلزم حفظ العمل أولًا.</div>');
    }catch(e){$('detailContent').textContent=e.message;}
  }
  async function refreshTargets(items){
    if(!items.length)return;
    try{let r=await api('/api/control/refresh',{targets:items});
      toast('تمت جدولة فحص '+r.queued+' عنصر عبر محرك المزامنة الأصلي.','success');
      await Promise.all([loadHistory(),loadOverview(true)]);
    }catch(e){toast(e.message,'error');}
  }
  function selectedByTable(){
    const grouped={};state.selected.forEach(function(item){if(!grouped[item.table])grouped[item.table]=[];grouped[item.table].push(item.id);});
    return grouped;
  }
  async function bulkStatus(status){
    const grouped=selectedByTable();if(!Object.keys(grouped).length)return;
    if(!state.authenticated){toast('سجّل دخول المسؤول أولًا','error');$('authDialog').showModal();return;}
    if(!window.confirm(status==='published'?'هل تريد نشر المحدد الذي يملك حقوقًا معتمدة وروابط سليمة؟':'هل تريد تحويل العناصر المحددة إلى مسودات؟'))return;
    let successes=0,refused=[];
    try{
      for(const table of Object.keys(grouped)){
        const result=await api('/api/control/bulk-status',{table:table,ids:grouped[table],status:status});
        successes+=result.updated||0;refused=refused.concat(result.refused||[]);
      }
      toast('تم تحديث '+successes+' عنصر'+(refused.length?'، وتعذّر تحديث '+refused.length:''),
            refused.length?'error':'success');
      if(refused.length)error('عناصر لم تُعتمد: '+refused.slice(0,3).map(function(x){return x.reason;}).join(' · '));
      else error('');
      state.selected.clear();showSelection();await Promise.all([loadLibrary(true),loadHistory()]);
    }catch(e){toast(e.message,'error');}
  }
  async function init(){
    try{
      const session=await api('/api/init');
      state.csrf=session.csrf;
      state.authenticated=!!session.authenticated;
      $('authButton').textContent=state.authenticated?'✓ مسؤول متصل':'دخول المسؤول';
      await Promise.all([loadOverview(),loadAlerts()]);
      if(state.authenticated)loadLibrary(true);
    }catch(e){error('تعذر بدء جلسة الاستوديو: '+e.message);}
  }
  document.addEventListener('click',function(event){
    const navigation=event.target.closest('[data-view]');
    if(navigation){changeView(navigation.dataset.view);return;}
    const action=event.target.closest('[data-action]');
    if(action){
      const table=action.dataset.table,id=action.dataset.id;
      if(action.dataset.action==='history')showSource(table,id,action.dataset.title);
      if(action.dataset.action==='refresh')refreshTargets([{table:table,id:id}]);
    }
  });
  document.addEventListener('change',function(e){
    if(e.target.matches('[data-select-table]')){
      const el=e.target,key=el.dataset.selectTable+':'+el.dataset.selectId;
      if(el.checked)state.selected.set(key,{table:el.dataset.selectTable,id:el.dataset.selectId});
      else state.selected.delete(key);
      showSelection();
    }
  });
  document.querySelectorAll('[data-kind]').forEach(function(btn){
    btn.addEventListener('click',function(){
      state.kind=btn.dataset.kind;
      document.querySelectorAll('[data-kind]').forEach(function(el){el.classList.toggle('active',el===btn);});
      renderLibrary();
    });
  });
  $('librarySearch').addEventListener('input',function(e){state.query=e.target.value.trim();renderLibrary();});
  $('libraryFilter').addEventListener('change',function(e){state.filter=e.target.value;renderLibrary();});
  $('goLibrary').addEventListener('click',function(){changeView('library');});
  ['openAlerts','allAlerts'].forEach(function(id){$(id).addEventListener('click',function(){changeView('alerts');});});
  $('refreshNow').addEventListener('click',function(){loadOverview();if(state.view==='library')loadLibrary();if(state.view==='alerts')loadAlerts();});
  $('reloadLibrary').addEventListener('click',function(){loadLibrary();});
  $('reloadHistory').addEventListener('click',loadHistory);
  $('scanAll').addEventListener('click',function(){changeView('library');toast('اختر الحلقات أو الأفلام ثم اضغط «تجديد المحدد».');});
  $('bulkRefresh').addEventListener('click',function(){refreshTargets(Array.from(state.selected.values()));});
  $('bulkDraft').addEventListener('click',function(){bulkStatus('draft');});
  $('bulkPublish').addEventListener('click',function(){bulkStatus('published');});
  $('clearSelection').addEventListener('click',function(){state.selected.clear();document.querySelectorAll('[data-select-table]').forEach(function(e){e.checked=false;});showSelection();});
  $('markRead').addEventListener('click',async function(){
    try{
      const ids=state.alerts.filter(function(a){return !a.read_at;}).map(function(a){return a.id;});
      if(!ids.length){toast('كل التنبيهات مقروءة.');return;}
      await api('/api/control/alerts/read',{ids:ids.slice(0,100)});
      await Promise.all([loadAlerts(),loadOverview(true)]);
      toast('تم تحديث حالة التنبيهات','success');
    }catch(e){toast(e.message,'error');}
  });
  $('authButton').addEventListener('click',function(){if(!state.authenticated)$('authDialog').showModal();else toast('تم تسجيل دخول مسؤول Supabase');});
  $('authForm').addEventListener('submit',async function(e){
    e.preventDefault();
    const form=e.currentTarget,values=new FormData(form),btn=form.querySelector('button[type=submit]');
    btn.disabled=true;
    try{
      await api('/api/login',{email:String(values.get('email')||''),password:String(values.get('password')||'')});
      state.authenticated=true;$('authDialog').close();form.reset();
      toast('تم تسجيل دخول المسؤول بنجاح','success');
      await loadLibrary(true);
      if(state.view==='library')renderLibrary();
    }catch(err){toast(err.message,'error');}
    finally{btn.disabled=false;}
  });
  const theme=localStorage.getItem('alezz-control-theme')==='light'?'light':'dark';
  document.documentElement.dataset.theme=theme;
  $('themeToggle').addEventListener('click',function(){
    const next=document.documentElement.dataset.theme==='light'?'dark':'light';
    document.documentElement.dataset.theme=next;localStorage.setItem('alezz-control-theme',next);
  });
  showSelection();
  init();
  setInterval(function(){if(document.visibilityState==='visible'){loadOverview(true);if(state.view==='alerts')loadAlerts();}},30000);
})();
