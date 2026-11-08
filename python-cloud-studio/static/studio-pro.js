/* Al Ezz Studio 6 – progressive enhancement. The FastAPI v5 actions remain the source of truth. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STATES = new Set(['all','verified','missing','pending','failed']);
  let episodeFilter = 'all';
  let dirty = false;
  let lastKnownHealthy = null;
  let redrawScheduled = false;
  const workspaceReady = () => !!$('workspace') && !$('workspace').hidden && !$('workspace').inert;
  function notify(message){
    const host=$('toastArea');if(!host)return;
    const item=document.createElement('div');item.className='toast';item.textContent=message;
    host.appendChild(item);setTimeout(()=>item.remove(),5500);
  }
  function editStatus(){
    const label=$('studioEditStatus'),btn=$('studioQuickSync');
    if(label){label.dataset.dirty=String(dirty);label.textContent=dirty?'تعديلات في انتظار حفظ الجلسة':'لا توجد تعديلات معلقة';}
    if(btn)btn.disabled=!workspaceReady()||!dirty;
  }
  function markDirty(event){
    if(!workspaceReady())return;
    if(event.target.matches('input[type=checkbox],input[type=search],input[type=radio],input[type=number][id^=add]'))return;
    dirty=true;editStatus();
  }
  function episodeState(row){
    const badge=row.querySelector('.media-badge'),url=row.querySelector('.episode-url');
    if(badge?.classList.contains('ok'))return 'verified';
    if(!url?.value.trim())return 'missing';
    if(badge?.classList.contains('fail'))return 'failed';
    return 'pending';
  }
  function scheduleEpisodes(){
    if(redrawScheduled)return;redrawScheduled=true;
    requestAnimationFrame(()=>{redrawScheduled=false;applyEpisodes();});
  }
  function applyEpisodes(){
    const list=$('episodeList');if(!list)return;
    const rows=Array.from(list.querySelectorAll('.episode-row'));
    let shown=0,selected=0;
    for(const row of rows){
      row.hidden=episodeFilter!=='all' && episodeState(row)!==episodeFilter;
      if(!row.hidden)shown++;
      if(row.querySelector('input[type=checkbox]:checked'))selected++;
    }
    if($('episodeViewCount'))$('episodeViewCount').textContent=shown+' من '+rows.length+' حلقة في الموسم';
    if($('episodeSelectionInfo'))$('episodeSelectionInfo').textContent=selected+' محددة في الموسم';
    document.querySelectorAll('[data-episode-filter]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.episodeFilter===episodeFilter));
    });
    if($('selectVisibleBtn'))$('selectVisibleBtn').disabled=shown===0;
    if($('clearSelectionBtn'))$('clearSelectionBtn').disabled=selected===0;
    let empty=$('episodeFilterEmpty');
    if(!shown && rows.length){
      if(!empty){empty=document.createElement('p');empty.id='episodeFilterEmpty';empty.className='empty-episodes';list.after(empty);}
      empty.hidden=false;empty.textContent='لا توجد نتائج بهذا الفلتر. اختر «كل الحلقات» لعرض الجميع.';
    }else if(empty)empty.hidden=true;
  }
  const studioPages = {
    import:'الاستيراد الذكي', library:'بيانات العمل', episodes:'المواسم والحلقات',
    publish:'الحفظ والنشر', 'smart-sync':'المزامنة الذكية', tools:'الإضافات والمميزات'
  };
  function showStudioPage(){
    const route=location.hash.slice(1);
    const id=Object.hasOwn(studioPages,route)?route:'import';
    document.querySelectorAll('[data-studio-page]').forEach(page=>{
      page.hidden=page.dataset.studioPage!==id;
    });
    const needsWork=['library','episodes','publish'].includes(id);
    $('studioEmptyPage').hidden=!needsWork||!$('workspace').hidden;
    $('studioEmptyTitle').textContent=studioPages[id];
    document.querySelector('.breadcrumbs strong').textContent=studioPages[id];
    document.querySelectorAll('.sidebar a[href^="#"], .mobile-dock a').forEach(anchor=>{
      const current=anchor.hash==='#'+id;
      anchor.classList.toggle('active',current);
      if(current)anchor.setAttribute('aria-current','page');
      else anchor.removeAttribute('aria-current');
    });
  }
  async function checkHealth(){
    const label=$('serverHealthText'),mobile=$('studioMobileHealth');
    let message='الخادم متصل',healthy=true;
    if(!navigator.onLine){message='الجهاز غير متصل بالإنترنت';healthy=false;}
    else{
      const ctrl=new AbortController();
      const timeout=setTimeout(()=>ctrl.abort(),7000);
      try{
        const res=await fetch('/healthz',{credentials:'same-origin',cache:'no-store',signal:ctrl.signal});
        if(!res.ok)throw Error('HTTP '+res.status);
        const result=await res.json();
        if(result.ok!==true)throw Error('unhealthy');
      }catch(e){healthy=false;message='الخادم لا يستجيب حاليًا';}
      finally{clearTimeout(timeout);}
    }
    for(const el of [label,mobile]){
      if(!el)continue;el.textContent=message;el.classList.toggle('is-bad',!healthy);
    }
    lastKnownHealthy=healthy;
  }
  function start(){
    if(!$('episodeList'))return;
    // Render runs the scan in headless Chromium; desktop installations use Edge.
    if($('edgeCaptureBtn'))$('edgeCaptureBtn').hidden=false;
    const health=document.createElement('span');
    health.id='studioMobileHealth';health.className='studio-mobile-health';health.textContent='فحص الخادم...';
    document.querySelector('.studio-command-bar .command-copy')?.appendChild(health);
    checkHealth();setInterval(()=>{if(document.visibilityState==='visible')checkHealth();},60000);
    window.addEventListener('online',checkHealth);window.addEventListener('offline',checkHealth);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkHealth();});
    const rowObserver=new MutationObserver(scheduleEpisodes);
    rowObserver.observe($('episodeList'),{childList:true});
    const workspaceObserver=new MutationObserver(editStatus);
    workspaceObserver.observe($('workspace'),{attributes:true,attributeFilter:['hidden']});
    $('episodeList').addEventListener('change',event=>{
      if(event.target.matches('input[type=checkbox],.episode-url'))scheduleEpisodes();
      if(event.target.matches('.episode-url'))markDirty(event);
    });
    $('episodeList').addEventListener('input',event=>{
      if(event.target.matches('.episode-identity input,.episode-details textarea,.episode-details input'))markDirty(event);
    });
    document.querySelector('.meta-form')?.addEventListener('input',markDirty);
    $('movieMediaUrl')?.addEventListener('input',markDirty);
    document.querySelectorAll('[data-episode-filter]').forEach(btn=>btn.addEventListener('click',()=>{
      if(!STATES.has(btn.dataset.episodeFilter))return;
      episodeFilter=btn.dataset.episodeFilter;applyEpisodes();
    }));
    $('selectVisibleBtn')?.addEventListener('click',()=>{
      for(const row of $('episodeList').querySelectorAll('.episode-row:not([hidden])')){
        const check=row.querySelector('input[type=checkbox]');
        if(check && !check.checked){check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));}
      }
      applyEpisodes();
    });
    $('clearSelectionBtn')?.addEventListener('click',()=>{
      for(const row of $('episodeList').querySelectorAll('.episode-row')){
        const check=row.querySelector('input[type=checkbox]');
        if(check?.checked){check.checked=false;check.dispatchEvent(new Event('change',{bubbles:true}));}
      }
      applyEpisodes();
    });
    $('clearSelectionBtn').textContent='إلغاء تحديد الموسم';
    window.addEventListener('hashchange',()=>{
      showStudioPage();
      window.scrollTo(0,0);
    });
    document.addEventListener('studio:catalogue',()=>{showStudioPage();editStatus();});
    showStudioPage();
    $('studioQuickSync')?.addEventListener('click',()=>{
      if(workspaceReady())$('updateBtn')?.click();
      else notify('اختر فيلمًا أو مسلسلًا قبل الحفظ.');
    });
    const toastObserver=new MutationObserver(records=>{
      for(const rec of records)for(const el of rec.addedNodes){
        if(el.nodeType!==1||!el.classList?.contains('toast'))continue;
        if(el.classList.contains('success')&&/تم حفظ تعديل البيانات|تمت مزامنة مكتبتك|اكتمل فحص الروابط/.test(el.textContent)){
          dirty=false;editStatus();
        }
      }
    });
    toastObserver.observe($('toastArea'),{childList:true});
    $('updateBtn')?.addEventListener('click',()=>{if(dirty)$('studioEditStatus').textContent='جارٍ حفظ تعديلات الجلسة...';});
    document.addEventListener('keydown',event=>{
      if((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='s'){
        event.preventDefault();
        if(workspaceReady())$('updateBtn')?.click();
      }
    });
    window.addEventListener('beforeunload',event=>{
      if(!dirty)return;event.preventDefault();event.returnValue='';
    });

    // The input stays passive while the user types; one scan begins after a
    // short idle delay. Ambiguous title matches still require selecting a work.
    const autoInput=$('sourceUrl'),autoType=$('sourceKind');
    let autoTimer=0,lastAutoQuery='';
    function scheduleAutomaticDiscovery(){
      clearTimeout(autoTimer);
      if(!autoInput)return;
      const value=autoInput.value.trim(),kind=autoType?.value||'auto';
      const label=$('autoDiscoveryStatus');
      if(value.length<3){
        if(label)label.textContent='اكتب اسمًا أو الصق رابط HTTPS؛ سيبدأ البحث تلقائيًا';
        return;
      }
      if(value.toLowerCase().startsWith('http://')){
        if(label)label.textContent='المصدر يجب أن يستخدم HTTPS الآمن';
        return;
      }
      if(label)label.textContent='جاري الاستعداد للبحث التلقائي بعد توقف الكتابة…';
      autoTimer=setTimeout(()=>{
        const signature=kind+'|'+value;
        if(autoInput.value.trim()!==value || signature===lastAutoQuery)return;
        if($('discoverBtn')?.disabled){
          autoTimer=setTimeout(scheduleAutomaticDiscovery,1200);
          return;
        }
        lastAutoQuery=signature;
        if(label)label.textContent='يبحث عن العمل ويجلب المصادر تلقائيًا…';
        const form=$('discoveryForm');
        if(form?.requestSubmit)form.requestSubmit();
        else form?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      },value.startsWith('https://')?900:1250);
    }
    autoInput?.addEventListener('input',scheduleAutomaticDiscovery);
    autoType?.addEventListener('change',scheduleAutomaticDiscovery);
    // Link paste is opt-in and works with HTTPS clipboard permissions on modern Safari.
    const paste=document.createElement('button');
    paste.type='button';paste.className='secondary-btn studio-paste-btn';paste.textContent='▣ لصق الرابط من الآيفون';
    paste.addEventListener('click',async()=>{
      try{
        if(!navigator.clipboard?.readText)throw Error('not supported');
        const value=(await navigator.clipboard.readText()).trim();
        if(!/^https:\/\//i.test(value)){notify('المنسوخ ليس رابط HTTPS صحيحًا.');return;}
        $('sourceUrl').value=value;$('sourceUrl').dispatchEvent(new Event('input',{bubbles:true}));
        $('sourceUrl').focus();notify('تم لصق الرابط؛ سيبدأ اكتشاف الفيديوهات تلقائيًا.');
      }catch(_){$('sourceUrl')?.focus();notify('اضغط مطولًا على حقل الرابط ثم اختر «لصق» من لوحة الآيفون.');}
    });
    $('discoverBtn')?.insertAdjacentElement('afterend',paste);
    applyEpisodes();editStatus();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
