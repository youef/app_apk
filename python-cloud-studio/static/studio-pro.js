/* Al Ezz Studio 6 – progressive enhancement. The FastAPI v5 actions remain the source of truth. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STATES = new Set(['all','verified','missing','pending','failed']);
  let episodeFilter = 'all';
  let dirty = false;
  let lastKnownHealthy = null;
  let redrawScheduled = false;
  const workspaceReady = () => !!$('workspace') && !$('workspace').hidden;
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
  function filterLibrary(){
    const list=$('libraryWorkList');if(!list)return;
    const query=$('libraryWorkSearch')?.value.trim().toLocaleLowerCase()||'';
    const mode=$('libraryWorkFilter')?.value||'all';
    let shown=0;
    const cards=Array.from(list.querySelectorAll('.lib-work'));
    for(const card of cards){
      const state=card.classList.contains('failed')?'failed':card.classList.contains('done')?'done':'pending';
      const matches=(mode==='all'||state===mode) && (!query||card.textContent.toLocaleLowerCase().includes(query));
      card.hidden=!matches;if(matches)shown++;
    }
    if($('libraryWorkCount'))$('libraryWorkCount').textContent='عرض '+shown+' من '+cards.length+' عمل';
  }
  function switchTo(id,event){
    const target=$(id);
    if(!target || target.closest('[hidden]')){
      event.preventDefault();
      notify('لإدارة الحلقات أو النشر، افتح عملًا من الاستيراد أو المكتبات أولًا.');
      return;
    }
    event.preventDefault();
    history.replaceState(null,'','#'+id);
    target.scrollIntoView({behavior:'smooth',block:'start'});
    setCurrent(id);
  }
  function setCurrent(id){
    document.querySelectorAll('.mobile-dock a').forEach(anchor=>{
      if(anchor.hash==='#'+id)anchor.setAttribute('aria-current','page');
      else anchor.removeAttribute('aria-current');
    });
    const name={import:'الاستيراد الذكي',librarySync:'مزامنة المكتبات',episodes:'المواسم والحلقات',publish:'الحفظ والنشر'};
    const crumb=document.querySelector('.breadcrumbs strong');
    if(crumb)crumb.textContent=name[id]||name.import;
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
    if(!$('episodeList')||!$('libraryWorkList'))return;
    // The Edge network-capture implementation requires desktop Edge, not a remote iPhone.
    if(!['localhost','127.0.0.1'].includes(location.hostname) && $('edgeCaptureBtn'))$('edgeCaptureBtn').hidden=true;
    const health=document.createElement('span');
    health.id='studioMobileHealth';health.className='studio-mobile-health';health.textContent='فحص الخادم...';
    document.querySelector('.studio-command-bar .command-copy')?.appendChild(health);
    checkHealth();setInterval(()=>{if(document.visibilityState==='visible')checkHealth();},60000);
    window.addEventListener('online',checkHealth);window.addEventListener('offline',checkHealth);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkHealth();});
    const rowObserver=new MutationObserver(scheduleEpisodes);
    rowObserver.observe($('episodeList'),{childList:true});
    const libraryObserver=new MutationObserver(filterLibrary);
    libraryObserver.observe($('libraryWorkList'),{childList:true});
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
    $('libraryWorkSearch')?.addEventListener('input',filterLibrary);
    $('libraryWorkFilter')?.addEventListener('change',filterLibrary);
    document.querySelectorAll('.mobile-dock a').forEach(a=>a.addEventListener('click',event=>switchTo(a.hash.slice(1),event)));
    window.addEventListener('hashchange',()=>{
      const h=location.hash.slice(1);if(['import','librarySync','episodes','publish'].includes(h))setCurrent(h);
    });
    setCurrent(['import','librarySync','episodes','publish'].includes(location.hash.slice(1))?location.hash.slice(1):'import');
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
    // Link paste is opt-in and works with HTTPS clipboard permissions on modern Safari.
    const paste=document.createElement('button');
    paste.type='button';paste.className='secondary-btn studio-paste-btn';paste.textContent='▣ لصق الرابط من الآيفون';
    paste.addEventListener('click',async()=>{
      try{
        if(!navigator.clipboard?.readText)throw Error('not supported');
        const value=(await navigator.clipboard.readText()).trim();
        if(!/^https:\/\//i.test(value)){notify('المنسوخ ليس رابط HTTPS صحيحًا.');return;}
        $('sourceUrl').value=value;$('sourceUrl').dispatchEvent(new Event('input',{bubbles:true}));
        $('sourceUrl').focus();notify('تم لصق الرابط. اضغط «اكتشف المحتوى».');
      }catch(_){$('sourceUrl')?.focus();notify('اضغط مطولًا على حقل الرابط ثم اختر «لصق» من لوحة الآيفون.');}
    });
    $('discoverBtn')?.insertAdjacentElement('afterend',paste);
    applyEpisodes();filterLibrary();editStatus();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
