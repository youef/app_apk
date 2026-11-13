(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const app = {csrf:'', catalogue:null, batch:[],currentIndex:0, authenticated:false, demo:false, busy:false, scanning:false, season:1, selected:new Set(), categoryList:[]};
  let studioRecovery=null;
  async function recoverStudioSession(){
    // A valid portal login survives Render deploys, while the in-memory
    // Studio CSRF can be lost. Only one request may renew the Studio cookie.
    if(studioRecovery)return studioRecovery;
    studioRecovery=(async()=>{
      const response=await fetch('/api/init',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{'Accept':'application/json'}
      });
      if(!response.ok)throw new Error('تعذّر استعادة جلسة الاستوديو. افتح /account/admin للتحقق من دخول المسؤول.');
      const snapshot=await response.json();
      if(!snapshot.csrf)throw new Error('فشل استعادة رمز حماية الجلسة.');
      app.csrf=snapshot.csrf;
      if(app.catalogue&&!snapshot.catalogue){
        activity('تم تجديد جلسة الاستوديو. قد تحتاج إعادة اكتشاف العمل بعد إعادة تشغيل الخادم.','info');
      }
      return snapshot;
    })();
    try{return await studioRecovery;}
    finally{studioRecovery=null;}
  }
  const API = async (route, data, retried=false) => {
    const request = data === undefined ? {method:'GET'} : {method:'POST',body:JSON.stringify(data)};
    const response = await fetch('/api/' + route, {credentials:'same-origin',cache:'no-store',...request,
      headers: data === undefined ? {'Accept':'application/json'} : {'Accept':'application/json','Content-Type':'application/json','X-CSRF-Token':app.csrf}});
    let result;
    try{result=await response.json();}
    catch(_){throw new Error('تعذّر قراءة استجابة خادم Python.');}
    if(!response.ok){
      const detail=typeof result.detail==='string'?result.detail:'حدث خطأ في الطلب: '+response.status;
      const lostSession=response.status===401 ||
        (response.status===403&&/رمز الحماية|csrf/i.test(detail));
      if(!retried&&route!=='init'&&lostSession){
        await recoverStudioSession();
        return API(route,data,true);
      }
      throw new Error(detail);
    }
    return result;
  };
  function toast(message, type='info'){
    const note = document.createElement('div'); note.className = 'toast ' + (type==='error'?'error':type==='success'?'success':'');
    note.textContent = message;
    $('toastArea').append(note);
    setTimeout(() => note.remove(), 6500);
  }
  function activity(message, type='info'){
    $('activity').className='activity ' + type;
    $('activityText').textContent=message;
    if(location.hash==='#tools' && type!=='loading')$('toolsStatus').textContent=message;
    if(type==='loading')$('activity').querySelector('.activity-ico').classList.add('spin');
    else $('activity').querySelector('.activity-ico').classList.remove('spin');
  }
  function busy(value){app.busy=value; for(const id of ['discoverBtn','discoverBatchBtn','scanListingBtn','saveBatchBtn','demoBtn','applyLinksBtn','updateBtn','verifyAllBtn','verifySelectedBtn','verifyMovieBtn','edgeCaptureBtn','saveBtn','addEpisodeBtn']){
    if($(id))$(id).disabled=value || (id==='saveBtn' && app.demo) || (id==='edgeCaptureBtn' && app.browserCaptureRunning) || (app.scanning && !['discoverBtn','discoverBatchBtn','scanListingBtn','demoBtn','updateBtn','saveBtn'].includes(id));
  }}
  function text(el, value){el.textContent = value==null?'':String(value);return el;}
  function make(tag, cls='', content){const el=document.createElement(tag);if(cls)el.className=cls;if(content!=null)text(el,content);return el;}
  function rowField(id, value){const el=$(id);if(el && document.activeElement!==el)el.value=value??'';}
  function fmtKind(kind){return kind==='series'?'مسلسل':'فيلم';}
  function okPlayerUrl(input){
    try {
      const u=new URL(String(input||'').trim());
      if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')
        || !['ok.ru','www.ok.ru'].includes(u.hostname.toLowerCase())||u.search||u.hash)return '';
      const match=u.pathname.match(/^\/video(?:embed)?\/([0-9]{1,20})\/?$/);
      return match?'https://ok.ru/videoembed/'+match[1]:'';
    }catch(_){return '';}
  }
  function normalizeMediaInput(value){return okPlayerUrl(value)||String(value||'').trim();}
  function mediaBadge(ep){
    if(ep.verified)return ['✓ فيديو مباشر مُتحقق','ok'];
    if(okPlayerUrl(ep.media_url))return ['◷ OK.ru — تحقق بالمعاينة على الجهاز','wait'];
    if((ep.sources||[]).some(s=>s.kind==='embed'&&s.reachable&&s.url===ep.media_url))
      return ['◷ صفحة Embed متاحة (التشغيل غير مثبت)','wait'];
    if(ep.error)return ['✕ غير متحقق','fail'];
    return [ep.media_url?'◷ يحتاج فحصًا':'— بلا رابط','wait'];
  }
  function updateStatus(payload){
    app.catalogue=payload.catalogue || null;app.authenticated=!!payload.authenticated;
    app.demo=!!payload.demo;
    app.batch=payload.batch||[];app.currentIndex=payload.current_index||0;
    renderBatch(payload.batch_errors||[]);
    $('accountText').textContent=app.authenticated?'مسؤول متصل':'تسجيل الدخول';
    $('syncAuth').textContent=app.authenticated?'● مسؤول معتمد':'○ غير مسجل';
    $('syncAuth').style.color=app.authenticated?'#72d5ad':'#c6a1a2';
    $('loginToggle').querySelector('.avatar').textContent=app.authenticated?'✓':'A';
    $('syncLogin').textContent=app.authenticated?'✓ تم تسجيل الدخول':'تسجيل دخول المسؤول';
    $('workspace').hidden=!app.catalogue;
    const cat=app.catalogue,n=cat?(cat.kind==='series'?cat.episodes.length:1):0;
    const verified=cat?(cat.kind==='series'?cat.episodes.filter(e=>e.verified).length:Number(cat.verified)):0;
    $('statWork').textContent=app.batch.length||Number(!!cat);$('statAll').textContent=n;
    $('statGood').textContent=verified;$('statPending').textContent=n-verified;
    $('exportBtn').disabled=!cat;$('demoBadge').hidden=!app.demo;
    $('saveBtn').disabled=app.demo||app.busy;
    if(cat)renderContent();
    if(payload.capture && payload.capture.catalogue_url===cat?.url)
      connectEpisodeBatch(payload.capture);
    else if(!app.browserCaptureRunning){
      closeEpisodeBatchConnection();
      episodeBatchJob=null;episodeBatchRevision=0;
      $('episodeBatchPanel').hidden=true;
      $('edgeCaptureBtn').textContent='⚡ اكتشاف روابط الحلقات تلقائيًا';
    }
    $('toolsLinksBtn').disabled=!cat||$('workspace').inert;
    document.dispatchEvent(new Event('studio:catalogue'));
  }
  function renderContent(){
    const cat=app.catalogue;
    if(!cat)return;
    rowField('metaTitle',cat.title);rowField('metaOriginal',cat.original_title);rowField('metaYear',cat.year);
    rowField('metaCountry',cat.country);rowField('metaLanguage',cat.language);
    rowField('metaGenres',(cat.genres||[]).join(', '));rowField('metaDescription',cat.description);
    rowField('metaPoster',cat.poster_url);rowField('metaBackdrop',cat.backdrop_url);
    $('previewTitle').textContent=cat.title;$('previewOriginal').textContent=cat.original_title||'عنوان أصلي غير متوفر';
    $('previewType').textContent=fmtKind(cat.kind);
    const pic=$('posterPreview');
    pic.hidden=!cat.poster_url;
    if(cat.poster_url){if(pic.getAttribute('src')!==cat.poster_url)pic.setAttribute('src',cat.poster_url);pic.onerror=()=>{pic.hidden=true;};}
    else pic.removeAttribute('src');
    const chips=$('previewChips');chips.replaceChildren();
    [cat.year?String(cat.year):null,cat.country||null,cat.language||null,...(cat.genres||[]).slice(0,5)].filter(Boolean).forEach(v=>chips.append(make('span','chip',v)));
    (cat.metadata_sources||[]).forEach(source=>chips.append(make('span','chip','بيانات: '+source)));
    $('episodeContainer').hidden=cat.kind==='movie';$('movieMedia').hidden=cat.kind!=='movie';
    $('addEpisodeBtn').hidden=cat.kind!=='series';
    if(cat.kind==='movie'){
      rowField('movieMediaUrl',cat.media_url);
      const [label,cls]=mediaBadge(cat);
      $('movieMediaStatus').textContent=label+ (cat.media_url?' · '+cat.media_url.slice(0,120):'');
      const moviePreview=$('movieOkPreview');
      if(moviePreview){const link=okPlayerUrl(cat.media_url);
        moviePreview.hidden=!link;moviePreview.onclick=()=>openOkPreview($('movieMediaUrl').value);}
      $('movieSources').replaceChildren(mediaSources(cat));
      $('seasonTabs').replaceChildren();
    } else renderSeasons();
  }
  function mediaSources(item){
    const container=make('details','media-sources');
    const sources=item.sources||[];
    const urls=[...new Set([item.page_url||item.url,...(item.source_pages||[])].filter(Boolean))];
    container.append(make('summary','',sources.length+' مشغّل أو رابط مكتشف'));
    for(const url of urls){
      container.append(make('small','','صفحة المصدر'),make('code','',url));
    }
    const list=make('ol');
    for(const source of sources){
      const row=make('li');
      const label=source.verified?'صالح للتشغيل':
        okPlayerUrl(source.url)?'OK.ru: نتيجة فحص الخادم غير حاسمة — جرّب المعاينة':
        source.reachable?'صفحة مشغّل متاحة':'لم يجتز الفحص';
      const copy=make('button','small-outline','نسخ الرابط');copy.type='button';
      copy.onclick=async()=>{
        try{await navigator.clipboard.writeText(source.url);toast('نُسخ الرابط.','success');}
        catch{toast('حدّد الرابط وانسخه يدويًا.','error');}
      };
      row.append(make('strong','',label+(source.label?' · '+source.label:'')),make('code','',source.url),copy);
      if(okPlayerUrl(source.url)){
        const preview=make('button','small-outline','معاينة OK.ru');
        preview.type='button';preview.onclick=()=>openOkPreview(source.url);
        row.append(preview);
      }
      list.append(row);
    }
    container.append(list);
    return container;
  }
  function renderSeasons(){
    const cat=app.catalogue, seasons=[...new Set(cat.episodes.map(e=>e.season))].sort((a,b)=>a-b);
    if(!seasons.includes(app.season))app.season=seasons[0]||1;
    const tabs=$('seasonTabs');tabs.replaceChildren();
    for(const season of seasons){
      const btn=make('button','season-tab'+(season===app.season?' active':''),'الموسم '+season);
      btn.type='button';btn.setAttribute('role','tab');btn.setAttribute('aria-selected',season===app.season?'true':'false');
      btn.onclick=()=>{app.season=season;renderSeasons();};tabs.append(btn);
    }
    renderEpisodes();
  }
  function renderEpisodes(){
    const cat=app.catalogue,list=$('episodeList'),q=$('episodeSearch').value.trim().toLowerCase();
    list.replaceChildren();
    const visible=cat.episodes.map((e,i)=>({...e,i})).filter(e=>e.season===app.season&&(!q||e.title.toLowerCase().includes(q)||String(e.number).includes(q)));
    if(!visible.length){list.append(make('div','empty-episodes','لا توجد حلقات مطابقة في هذا الموسم.'));return;}
    for(const ep of visible){
      const wrapper=make('article','episode-row');wrapper.dataset.index=ep.i;
      const check=make('input');check.type='checkbox';check.checked=app.selected.has(ep.i);check.setAttribute('aria-label','تحديد الحلقة '+ep.number);
      check.onchange=()=>check.checked?app.selected.add(ep.i):app.selected.delete(ep.i);
      const poster=make('div','episode-poster');
      if(ep.poster_url){const img=make('img');img.src=ep.poster_url;img.alt='';img.loading='lazy';img.onerror=()=>{poster.replaceChildren(text(make('span'),'▷'));};poster.append(img);} else poster.append(make('span','',String(ep.number)));
      const identity=make('div','episode-identity');const title=make('input');title.type='text';title.value=ep.title;title.maxLength=250;title.setAttribute('aria-label','اسم الحلقة '+ep.number);
      title.oninput=()=>{app.catalogue.episodes[ep.i].title=title.value;};
      identity.append(title,make('small','',`الموسم ${ep.season} · الحلقة ${ep.number}`));
      const url=make('input','episode-url');url.type='url';url.value=ep.media_url||'';url.placeholder='MP4 / HLS / OK.ru / Embed';url.dir='ltr';url.setAttribute('aria-label','رابط تشغيل الحلقة '+ep.number);
      url.onchange=()=>{const current=app.catalogue.episodes[ep.i];
        const value=normalizeMediaInput(url.value);url.value=value;
        if(current.media_url!==value){
          current.media_url=value;current.verified=false;current.error='';
          current.sources=[];redrawStats();
          badge.textContent=value?'◷ يحتاج فحصًا':'— بلا رابط';
          badge.className='media-badge wait';
        }
      };
      const [label,cls]=mediaBadge(ep);const badge=make('span','media-badge '+cls,label);
      const verifyOne=make('button','tiny-btn','فحص');verifyOne.type='button';verifyOne.title='فحص رابط الحلقة';
      verifyOne.onclick=()=>verifyRows([ep.i]);
      const preview=make('button','small-outline','معاينة');preview.type='button';
      preview.hidden=!okPlayerUrl(ep.media_url);
      preview.onclick=()=>openOkPreview(url.value);
      url.addEventListener('change',()=>{
        preview.hidden=!okPlayerUrl(url.value);
      });
      const expand=make('button','row-info','⋯');expand.type='button';expand.title='وصف الحلقة وصورتها';expand.setAttribute('aria-label','تفاصيل الحلقة '+ep.number);
      expand.onclick=()=>wrapper.classList.toggle('expanded');
      const details=make('div','episode-details');
      const dlabel=make('label','wide');dlabel.append(make('span','','وصف الحلقة'));const desc=make('textarea');desc.rows=2;desc.value=ep.description||'';desc.maxLength=1500;
      desc.oninput=()=>app.catalogue.episodes[ep.i].description=desc.value;dlabel.append(desc);
      const plabel=make('label','wide');plabel.append(make('span','','رابط صورة الحلقة'));const posterUrl=make('input');posterUrl.dir='ltr';posterUrl.value=ep.poster_url||'';posterUrl.type='url';
      posterUrl.onchange=()=>{app.catalogue.episodes[ep.i].poster_url=posterUrl.value.trim();};plabel.append(posterUrl);
      if(ep.error)details.append(make('small','',`نتيجة الفحص: ${ep.error}`));
      details.append(dlabel,plabel,mediaSources(ep));
      wrapper.append(check,poster,identity,url,badge,verifyOne,preview,expand,details);list.append(wrapper);
    }
  }
  function redrawStats(){
    const cat=app.catalogue,n=cat.kind==='series'?cat.episodes.length:1;
    const good=cat.kind==='series'?cat.episodes.filter(x=>x.verified).length:Number(cat.verified);
    $('statAll').textContent=n;$('statGood').textContent=good;$('statPending').textContent=n-good;
  }
  function getMetadata(){
    const cat=app.catalogue;
    if(!cat)return null;
    return {title:$('metaTitle').value.trim(),original_title:$('metaOriginal').value.trim(),
      year:$('metaYear').value?Number($('metaYear').value):null,
      country:$('metaCountry').value.trim(),language:$('metaLanguage').value.trim(),
      genres:$('metaGenres').value.split(/[,،]+/).map(x=>x.trim()).filter(Boolean),
      description:$('metaDescription').value.trim(),poster_url:$('metaPoster').value.trim(),backdrop_url:$('metaBackdrop').value.trim(),
      media_url:cat.kind==='movie'&&!app.scanning?normalizeMediaInput($('movieMediaUrl').value):undefined,
      episodes:cat.kind==='series'&&!app.scanning?cat.episodes.map(e=>({season:e.season,number:e.number,title:e.title,description:e.description,
        poster_url:e.poster_url,media_url:e.media_url})):undefined};
  }
  async function syncEdits({silent=false}={}){
    if(!app.catalogue)throw new Error('اكتشف محتوى أولًا');
    const result=await API('update',getMetadata());updateStatus(result);
    if(!silent)toast('تم حفظ تعديل البيانات داخل جلسة العمل.','success');
    return result;
  }
  async function action(fn){if(app.busy)return;busy(true);try{await fn();}catch(error){toast(error.message,'error');activity(error.message,'error');}finally{busy(false);}}
  function openModal(id){$(id).hidden=false;const first=$(id).querySelector('input:not([type=hidden]),textarea');if(first)setTimeout(()=>first.focus(),60);}
  function closeModal(id){
    if(id==='okPreviewModal')$('okPreviewFrame').removeAttribute('src');
    $(id).hidden=true;
  }
  function openOkPreview(value){
    const url=okPlayerUrl(value);
    if(!url){toast('رابط معاينة OK.ru غير صالح.','error');return;}
    // Explicit user gesture only. Never test playback by downloading signed media.
    $('okPreviewFrame').src=url;
    $('okPreviewOpen').href=url;
    openModal('okPreviewModal');
    $('okPreviewClose').focus();
  }
  function renderBatch(errors){
    const list=$('batchCards');list.replaceChildren();
    $('batchStatusText').textContent=app.batch.length?`تم اكتشاف ${app.batch.length} عملًا. اضغط أي بطاقة لعرض تفاصيلها.`:'اكتشاف متزامن من عدة مصادر عامة';
    list.hidden=app.batch.length===0;
    $('saveBatchBtn').hidden=app.batch.length<=1;
    $('exportBatchBtn').hidden=app.batch.length<=1;
    if(errors&&errors.length){
      $('batchErrorList').hidden=false;
      $('batchErrorList').textContent=errors.slice(0,5).map(x=>x.url+' — '+x.error).join(' | ');
    }else{$('batchErrorList').hidden=true;}
    app.batch.forEach(work=>{
      const btn=make('button','batch-card'+(work.index===app.currentIndex?' active':''));
      btn.type='button';btn.setAttribute('aria-label','عرض '+work.title);
      if(work.poster_url){const img=make('img');img.src=work.poster_url;img.alt='';img.onerror=()=>img.remove();btn.append(img);}
      const info=make('span','batch-info');info.append(make('strong','',work.title));
      if(work.original_title)info.append(make('small','batch-subtitle',work.original_title));
      info.append(make('small','',`${work.kind==='series'?'مسلسل · '+work.episodes+' حلقة':'فيلم'} · ${work.year||'السنة غير محددة'}`));
      btn.append(info);
      btn.onclick=()=>selectWork(work.index);
      list.append(btn);
    });
  }
  async function selectWork(index){
    await action(async()=>{
      if(app.catalogue)await syncEdits({silent:true});
      const result=await API('select-catalogue',{index});
      app.season=1;app.selected.clear();$('episodeSearch').value='';updateStatus(result);
      showDiscoveryProgress(result.scan);
      location.hash='library';
    });
  }
  async function scanListing(){
    await action(async()=>{
      const url=$('sourceUrl').value.trim();
      if(!url)throw new Error('ضع رابط صفحة قائمة المسلسلات في خانة رابط المصدر بالأعلى.');
      activity('قراءة قائمة الموقع والبحث عن روابط الأعمال...','loading');
      const response=await API('scan-listing',{url,kind:$('sourceKind').value==='auto'?'series':$('sourceKind').value});
      if(!response.links.length)throw new Error('لم تتضمن هذه الصفحة روابط مسلسلات واضحة. الصق الروابط يدويًا في القائمة.');
      const old=$('batchUrls').value.trim();
      $('batchUrls').value=Array.from(new Set([...(old?old.split(/\r?\n/):[]),...response.links])).slice(0,18).join('\n');
      activity(`وجدت ${response.count} رابطًا محتملًا. راجعها ثم اضغط اكتشف الأعمال والحلقات دفعة واحدة.`, 'success');
    });
  }

  async function importBatch(){
    await action(async()=>{
      const urls=$('batchUrls').value.trim();
      if(!urls)throw new Error('الصق رابط مسلسل أو فيلم في كل سطر.');
      activity('جارٍ تحليل الروابط المتعددة وجلب الصور والاسم الأصلي والمواسم بالتوازي...','loading');
      const result=await API('discover-batch',{urls,kind:$('sourceKind').value,
         deep:$('deepScan').checked,metadata:$('autoMetadata').checked});
      app.selected.clear();app.season=1;$('episodeSearch').value='';updateStatus(result);
      showDiscoveryProgress(result.scan);
      activity(`اكتُشف ${result.batch.length} عملًا مع ${result.batch.reduce((n,w)=>n+w.episodes,0)} حلقة. راجع الأعمال ثم احفظ الدفعة.`, 'success');
      if(result.batch_errors.length)toast(`${result.batch_errors.length} رابطًا لم يُكتشف؛ راجع النتائج.`, 'error');
    });
  }
  async function saveBatch(){
    await action(async()=>{
      if(!app.authenticated){openModal('loginModal');throw new Error('سجّل الدخول قبل الحفظ.');}
      if(app.demo)throw new Error('المعاينة التجريبية غير قابلة للنشر.');
      await syncEdits({silent:true});
      const publish=document.querySelector('input[name=publishMode]:checked').value==='publish';
      const rights_authorized=$('rightsAuthorized').checked;
      if(publish&&!rights_authorized)throw new Error('النشر العام يتطلب تصريحًا فعليًا لعرض المحتوى والصور. اختر المسودة لتخزين البيانات.');
      if(!confirm(`حفظ ${app.batch.length} عملًا وحلقاتها في Supabase دفعة واحدة؟`))return;
      activity('تُحفظ الأعمال والمواسم والحلقات بالتسلسل الآمن مع منع التكرار...','loading');
      const result=await API('save-batch',{publish,rights_authorized,
        auto_publish_episodes:publish&&$('autoPublishEpisodes').checked,
        rights_holder:$('rightsHolder').value.trim(),license_reference:$('licenseRef').value.trim()});
      const total=result.totals;
      const message=`✓ ${result.ok_count} عمل ناجح، ${result.error_count} أخطاء، ${total.works_new} جديد، ${total.works_updated} محدّث، ${total.episodes_new} حلقة جديدة، ${total.episodes_updated} محدّثة.`;
      $('saveResult').hidden=false;$('saveResult').textContent=message;
      activity(message,result.error_count?'error':'success');
      if(result.error_count){
        const fail=result.details.filter(x=>!x.ok).slice(0,3).map(x=>x.title+': '+x.error).join('؛ ');
        toast(fail,'error');
      }else toast('اكتملت مزامنة جميع الأعمال مع قاعدة البيانات.','success');
    });
  }

  let episodeBatchStream=null,episodeBatchTimer=null,episodeBatchJob=null,
      episodeBatchRevision=0,episodeBatchPolling=false,episodeBatchFallback=false;

  function closeEpisodeBatchConnection(){
    if(episodeBatchStream){episodeBatchStream.close();episodeBatchStream=null;}
    if(episodeBatchTimer){clearInterval(episodeBatchTimer);episodeBatchTimer=null;}
  }
  function episodeBatchProgress(job){
    if(!job || !app.catalogue)return;
    episodeBatchJob=job;
    const total=Number(job.total||0),done=Math.min(total,Number(job.done||0));
    const panel=$('episodeBatchPanel');panel.hidden=false;
    $('episodeBatchCount').textContent=done+' / '+total;
    $('episodeBatchCurrent').textContent=(job.batch_done||0)+' / '+(job.batch_total||0)+
      ' • الدفعة '+(job.batch_number||0);
    const elapsed=job.batch_started_at ? Math.max(0,Math.round(Date.now()/1000-job.batch_started_at)) : 0;
    $('episodeBatchElapsed').textContent=(job.running?Math.min(elapsed,45):job.last_batch_seconds||elapsed)+' / 45 ثانية';
    $('episodeBatchFound').textContent=String(job.candidates||0);
    $('episodeBatchStatus').textContent=job.message||
      ('الدفعة '+(job.batch_number||0)+' — جلب الحلقات تلقائيًا');
    $('episodeBatchProgress').max=Math.max(1,total);
    $('episodeBatchProgress').value=done;
    $('episodeBatchLive').classList.toggle('is-done',!job.running);
    $('episodeBatchLive').classList.toggle('is-off',!job.running);
    $('episodeBatchLive').textContent=job.running?'● LIVE · فحص الحلقات':'✓ النتائج متاحة';
    $('episodeBatchStop').disabled=!job.running;
    $('edgeCaptureBtn').disabled=job.running||app.busy;
    $('edgeCaptureBtn').textContent=job.running?'◷ اكتشاف الحلقات جارٍ…':
      (job.next_index>=total?'↻ إعادة اكتشاف روابط الحلقات':'⚡ استكمال اكتشاف روابط الحلقات');
    app.browserScanIndex=job.next_index||0;
    app.browserCaptureRunning=!!job.running;
    if(!job.running){
      closeEpisodeBatchConnection();
      if(job.error)activity(job.error,'error');
      else activity(job.message,job.phase==='cancelled'?'info':'success');
    }
  }
  function applyEpisodeBatchEvent(item){
    if(!item||!episodeBatchJob || item.revision<=episodeBatchRevision)return;
    episodeBatchRevision=item.revision;
    if(item.delta){
      updateDiscoveryDelta(item.delta);
      const ep=item.delta,title=app.catalogue?.kind==='movie'?app.catalogue.title:
        ('م'+(ep.season||1)+' ح'+(ep.number||'?')+' · '+(ep.title||'حلقة'));
      const sources=Array.isArray(ep.sources)?ep.sources:[];
      const count=sources.filter(x=>x.kind==='direct').length;
      const entry=make('div','episode-batch-item');
      entry.append(make('strong','',title),
        make('span','',ep.verified?'✓ صالح وقت الفحص':
          count?count+' مصدر مرشح':'لم يُعثر على رابط قابل للتحقق'));
      $('episodeBatchLog').prepend(entry);
      while($('episodeBatchLog').children.length>22)$('episodeBatchLog').lastElementChild.remove();
    }
    if(item.snapshot)episodeBatchProgress(item.snapshot);
  }
  async function pollEpisodeBatch(){
    if(episodeBatchPolling||!episodeBatchJob||!episodeBatchJob.running)return;
    episodeBatchPolling=true;
    try{
      const query='episode-capture-batches/status?job_id='+encodeURIComponent(episodeBatchJob.id)+
        '&after='+episodeBatchRevision;
      const data=await API(query);
      for(const event of data.events||[])applyEpisodeBatchEvent(event);
      if(data.job&&data.job.revision>=episodeBatchRevision)episodeBatchProgress(data.job);
    }catch(error){
      if(/انتهت الجلسة|401|403|404/.test(error.message)){
        closeEpisodeBatchConnection();
        toast('تعذر متابعة فحص الحلقات: '+error.message,'error');
      }
    }finally{episodeBatchPolling=false;}
  }
  function connectEpisodeBatch(job){
    if(!job)return;
    if(episodeBatchJob?.id===job.id && episodeBatchStream)return;
    closeEpisodeBatchConnection();
    if(episodeBatchJob?.id!==job.id){
      episodeBatchRevision=0;$('episodeBatchLog').replaceChildren();
    }
    episodeBatchJob=job;
    episodeBatchProgress(job);
    if(!job.running)return;
    if(typeof EventSource==='undefined'){
      episodeBatchFallback=true;
    }else{
      const stream=new EventSource('/api/episode-capture-batches/events?job_id='+encodeURIComponent(job.id));
      episodeBatchStream=stream;
      stream.addEventListener('snapshot',event=>{
        if(episodeBatchJob?.id!==job.id)return;
        try{applyEpisodeBatchEvent(JSON.parse(event.data));}
        catch(error){console.warn('Invalid episode batch event',error);}
      });
      stream.onerror=()=>{
        if(episodeBatchJob?.id!==job.id)return;
        episodeBatchFallback=true;
        if(episodeBatchStream){episodeBatchStream.close();episodeBatchStream=null;}
      };
    }
    // Poll acts as a fallback when Render buffers an SSE connection.
    episodeBatchTimer=setInterval(()=>{
      if(episodeBatchFallback||!episodeBatchStream)pollEpisodeBatch();
      if(episodeBatchJob?.running)episodeBatchProgress(episodeBatchJob);
    },1300);
    pollEpisodeBatch();
  }
  async function startEpisodeBatches(){
    if(!app.catalogue)throw new Error('اكتشف العمل أولًا.');
    if(episodeBatchJob?.running)return;
    const cloud=!['localhost','127.0.0.1'].includes(location.hostname);
    if(cloud&&!app.authenticated){
      $('loginToggle').click();
      throw new Error('سجّل دخول المسؤول لتفعيل فحص Chromium.');
    }
    await syncEdits({silent:true});
    const total=app.catalogue.kind==='series'?app.catalogue.episodes.length:1;
    if(!total)throw new Error('لم يتم اكتشاف حلقات بعد.');
    const key=app.catalogue.url+'|'+total;
    if(app.browserScanKey!==key){app.browserScanKey=key;app.browserScanIndex=0;}
    let start=app.browserScanIndex||0;
    if(start>=total)start=0;
    activity('بدء الفحص التلقائي: 10 حلقات لكل دفعة، حتى 45 ثانية للدفعة.','loading');
    const result=await API('episode-capture-batches/start',{start_index:start});
    connectEpisodeBatch(result.job);
    toast(result.already_running?'الفحص مستمر في الخلفية.':'بدأ فحص كل الحلقات بالتتابع دون الضغط المتكرر.','success');
  }
  async function stopEpisodeBatches(){
    if(!episodeBatchJob?.running)return;
    const result=await API('episode-capture-batches/stop',{});
    episodeBatchProgress(result.job);
    toast('طلب إيقاف الفحص؛ يمكن استكمال الدفعة لاحقًا.','info');
  }

  let discoveryTimer, discoveryId, discoveryDone=-1, discoveryStream=null,
      discoveryStreamFallbackId=null, discoveryEventTimer=null, lastTrackingMessage='';
  function closeDiscoveryStream(){
    if(discoveryStream){discoveryStream.close();discoveryStream=null;}
    if(discoveryEventTimer){clearTimeout(discoveryEventTimer);discoveryEventTimer=null;}
  }
  function studioPlayerRows(){
    if(!app.catalogue)return [];
    const entries=app.catalogue.kind==='series'?app.catalogue.episodes:[app.catalogue];
    const rows=[], seen=new Set();
    for(const entry of entries){
      const episode=app.catalogue.kind==='series'?'S'+entry.season+'E'+entry.number+' · '+entry.title:entry.title;
      const sources=[...(Array.isArray(entry.sources)?entry.sources:[])];
      if(entry.media_url&&!sources.some(x=>x.url===entry.media_url)){
        sources.push({url:entry.media_url,kind:'direct',verified:Boolean(entry.verified),page_url:entry.page_url});
      }
      for(const row of sources){
        if(typeof row.url!=='string'||!row.url.startsWith('https://'))continue;
        const key=episode+'|'+row.url;
        if(seen.has(key))continue;
        seen.add(key);
        rows.push({episode,url:row.url,kind:row.kind||'unknown',
          verified:Boolean(row.verified),page_url:row.page_url||entry.page_url||''});
      }
    }
    return rows;
  }
  function studioExportCsvField(value){
    let str=String(value??'');
    if(/^[\s]*[=+\-@]/.test(str))str="'"+str;
    return '"'+str.replace(/"/g,'""')+'"';
  }
  function exportStudioPlayers(format){
    const rows=studioPlayerRows();
    if(!rows.length){toast('لم تُكتشف أي روابط عامة للتصدير بعد.','info');return;}
    let output,type,extension;
    if(format==='csv'){
      const data=[['الحلقة','الرابط','النوع','التحقق','صفحة المصدر'],
        ...rows.map(x=>[x.episode,x.url,x.kind,x.verified?'اجتاز الفحص':'مرشح غير متحقق',x.page_url])];
      output='\uFEFF'+data.map(line=>line.map(studioExportCsvField).join(',')).join('\r\n');
      type='text/csv;charset=utf-8';extension='csv';
    }else{
      output=JSON.stringify({version:1,tool:'Al Ezz TV Main Studio',
        stage:app.scanning?'scanning':'review',exported_at:new Date().toISOString(),
        note:'لا يُعد الرابط صالحًا للتشغيل أو إعادة النشر حتى يجتاز الفحص ويُراجع الترخيص.',
        players:rows},null,2);
      type='application/json;charset=utf-8';extension='json';
    }
    const blob=new Blob([output],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='al-ezz-studio-players-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.'+extension;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('تم تصدير '+rows.length+' رابطًا متاحًا حتى اللحظة.','success');
  }
  async function copyStudioPlayerLinks(){
    const urls=[...new Set(studioPlayerRows().map(x=>x.url))];
    if(!urls.length)return toast('لا توجد روابط متاحة للنسخ بعد.','info');
    try{await navigator.clipboard.writeText(urls.join('\n'));toast('تم نسخ '+urls.length+' رابطًا.','success');}
    catch(_){toast('تعذّر النسخ؛ استخدم تصدير JSON أو CSV.','error');}
  }
  function updateStudioLiveCards(){
    const rows=studioPlayerRows(),container=$('liveMediaLinks');
    const direct=rows.filter(x=>x.kind==='direct'),verified=direct.filter(x=>x.verified);
    $('studioLiveCounts').textContent=direct.length+' فيديو مرشح · '+verified.length+' مجتاز · '+(rows.length-direct.length)+' صفحة/مشغل';
    for(const id of ['studioExportPlayersCsv','studioExportPlayersJson','studioCopyPlayers'])$(id).disabled=!rows.length;
    container.replaceChildren();
    for(const row of [...rows].sort((a,b)=>Number(b.verified)-Number(a.verified)).slice(0,18)){
      const panel=make('div','studio-fast-card');
      panel.append(make('strong','',row.episode),
        make('small','',row.kind==='direct'?(row.verified?'✓ اجتاز الفحص المبدئي':'◷ يحتاج اختبار التشغيل'):'◷ صفحة مشغّل مضمّنة'));
      try{const uri=new URL(row.url);panel.append(make('small','',uri.hostname+uri.pathname.slice(0,62)));}
      catch(_){panel.append(make('small','',row.url.slice(0,75)));}
      const copy=make('button','','نسخ الرابط');copy.type='button';
      copy.onclick=()=>navigator.clipboard.writeText(row.url).then(()=>toast('تم النسخ','success')).catch(()=>toast('تعذّر النسخ','error'));
      panel.append(copy);container.append(panel);
    }
  }
  function updateDiscoveryDelta(delta){
    if(!delta||!app.catalogue)return;
    const keys=['media_url','sources','source_pages','verified','error'];
    if(app.catalogue.kind==='series'){
      const entry=app.catalogue.episodes.find(ep=>ep.season===delta.season&&ep.number===delta.number);
      if(!entry)return;
      for(const key of keys)if(Object.hasOwn(delta,key))entry[key]=delta[key];
      if(entry.season===app.season)renderEpisodes();
    }else{
      for(const key of keys)if(Object.hasOwn(delta,key))app.catalogue[key]=delta[key];
      rowField('movieMediaUrl',app.catalogue.media_url);
      $('movieMediaStatus').textContent=mediaBadge(app.catalogue)[0];
      $('movieSources').replaceChildren(mediaSources(app.catalogue));
    }
    redrawStats();
  }
  function connectDiscoveryStream(id){
    if(!id||discoveryStream||discoveryStreamFallbackId===id||typeof EventSource==='undefined')return false;
    let received=false;
    const stream=new EventSource('/api/discovery-scan/events?scan_id='+encodeURIComponent(id));
    discoveryStream=stream;
    stream.addEventListener('snapshot',event=>{
      if(discoveryId!==id)return;
      received=true;
      try{
        const update=JSON.parse(event.data);
        if(update.delta)updateDiscoveryDelta(update.delta);
        if(update.tracking && !update.tracking.queued &&
           update.tracking.message && lastTrackingMessage!==update.tracking.message){
          lastTrackingMessage=update.tracking.message;
          toast(update.tracking.message,update.tracking.saved?'success':'error');
        }
        if(update.scan)showDiscoveryProgress(update.scan);
      }catch(error){console.warn('Studio live snapshot parse failed',error);}
    });
    stream.onerror=()=>{
      if(discoveryId!==id)return;
      discoveryStreamFallbackId=id;
      closeDiscoveryStream();
      clearTimeout(discoveryTimer);
      discoveryTimer=setTimeout(()=>pollDiscovery(id),1000);
    };
    discoveryEventTimer=setTimeout(()=>{
      if(discoveryId===id&&!received){
        discoveryStreamFallbackId=id;closeDiscoveryStream();
        discoveryTimer=setTimeout(()=>pollDiscovery(id),1000);
      }
    },4500);
    return true;
  }

  function updateDiscoveryMedia(payload){
    if(!payload?.catalogue || payload.catalogue.url!==app.catalogue?.url)return;
    const fresh=payload.catalogue;
    const fields=['media_url','sources','source_pages','verified','error'];
    const copy=(to,from)=>fields.forEach(key=>{to[key]=from[key];});
    if(fresh.kind==='series'){
      const rows=new Map(fresh.episodes.map(ep=>[ep.season+':'+ep.number,ep]));
      for(const ep of app.catalogue.episodes){const row=rows.get(ep.season+':'+ep.number);if(row)copy(ep,row);}
      renderSeasons();
    }else{
      copy(app.catalogue,fresh);
      rowField('movieMediaUrl',fresh.media_url);
      $('movieMediaStatus').textContent=mediaBadge(fresh)[0];
      $('movieSources').replaceChildren(mediaSources(fresh));
    }
    const good=fresh.kind==='series'?fresh.episodes.filter(ep=>ep.verified).length:Number(fresh.verified);
    $('statGood').textContent=good;
    $('statPending').textContent=payload.count-good;
  }
  function showDiscoveryProgress(scan){
    clearTimeout(discoveryTimer);
    if(discoveryId!==scan?.id){
      discoveryDone=-1;closeDiscoveryStream();discoveryStreamFallbackId=null;
    }
    discoveryId=scan?.id;
    app.scanning=!!scan?.running;
    $('workspace').inert=false;
    // Metadata can be reviewed while media is checked. Avoid racing link edits
    // and publishing with an unfinished probe.
    for(const control of document.querySelectorAll('#episodeList input,#episodeList textarea,#movieMediaUrl'))control.disabled=!!scan?.running;
    for(const id of ['toolsLinksBtn','verifyAllBtn','verifySelectedBtn','verifyMovieBtn','edgeCaptureBtn','saveBatchBtn','applyLinksBtn','addEpisodeBtn']){
      if($(id))$(id).disabled=app.busy||!!scan?.running||!app.catalogue||(id==='saveBtn'&&app.demo);
    }
    $('saveBtn').disabled=app.busy||!app.catalogue||app.demo;
    document.dispatchEvent(new Event('studio:catalogue'));
    $('discoveryProgress').hidden=!scan;
    if(!scan)return;
    const bar=$('discoveryProgressBar');
    bar.max=Math.max(1,scan.total);bar.value=scan.done;
    $('discoveryProgressLabel').textContent=scan.running?'⚡ فحص مباشر: تظهر المشغلات فور اكتشافها':'اكتمل فحص المصادر المتاحة';
    $('discoveryProgressCount').textContent=scan.done+' / '+scan.total+' مفحوصة · '+scan.verified+' فيديو متحقق · '+(scan.sources_found||0)+' مصدر محتمل';
    $('discoveryReview').hidden=false;
    const pill=$('studioLivePill');
    pill.classList.toggle('is-done',!scan.running);
    pill.classList.toggle('is-off',!scan.running && !scan.done);
    pill.textContent=scan.running?'● LIVE · فحص متوازٍ':'✓ نتائج الفحص متاحة';
    updateStudioLiveCards();
    if(scan.running){
      if(!connectDiscoveryStream(scan.id)&&!discoveryStream)
        discoveryTimer=setTimeout(()=>pollDiscovery(scan.id),1150);
    }else{
      closeDiscoveryStream();
      if(scan.error)activity(scan.error,'error');
    }
  }
  async function pollDiscovery(id){
    try {
      const result=await API('discovery-scan');
      if(discoveryId!==id)return;
      if(result.scan?.id!==id){
        closeDiscoveryStream();
        clearTimeout(discoveryTimer);
        discoveryId=null;
        app.scanning=false;
        activity('تمت استعادة جلسة الإدارة؛ أُعيد تشغيل الخادم أثناء الفحص. يمكنك إعادة الاكتشاف دون تسجيل دخول.','info');
        return;
      }
      if(result.summary && (result.scan.done!==discoveryDone || !result.scan.running)){
        updateDiscoveryMedia(result.summary);
        discoveryDone=result.scan.done;
      }
      showDiscoveryProgress(result.scan);
      if(result.summary && !result.scan.running){
        if(result.scan.error){activity(result.scan.error,'error');return;}
        activity(result.scan.verified?'اكتمل الفحص. راجع بيانات العمل والمشغلات ثم احفظه للمزامنة.':
          'اكتمل الفحص. لم يُعثر على رابط تشغيل صالح. يمكنك مراجعة المصادر وحفظ البيانات كمسودة.',
          result.scan.verified?'success':'info');
      }
    } catch(error) {
      if(discoveryId!==id)return;
      activity('تعذر تحديث التقدم. جارٍ إعادة المحاولة…','info');
      discoveryTimer=setTimeout(()=>pollDiscovery(id),3500);
    }
  }
  async function discoverWork(url, kind){
    activity('جارٍ اكتشاف البيانات والمواسم وصفحات الحلقات…','loading');
    const fast=$('studioFastMode').checked;
    const result=await API('discover',{url,kind,scan_media:true,auto_track:$('autoTrack').checked,
      deep:$('deepScan').checked,metadata:$('autoMetadata').checked,fast});
    app.selected.clear();app.season=1;$('episodeSearch').value='';
    discoveryDone=-1;lastTrackingMessage='';
    updateStatus(result);
    showDiscoveryProgress(result.scan);
    activity(result.scan?.running?'بدأ فحص المشغلات. يمكنك متابعة التقدم هنا.':'تم تحميل بيانات العمل، ولم تظهر حلقات قابلة للفحص.','info');
    if(result.tracking)toast(result.tracking.message,result.tracking.saved?'success':'info');
  }
  async function startDiscover(demo=false){
    await action(async()=>{
      if(demo){
        const result=await API('demo',{});
        app.selected.clear();app.season=1;
        updateStatus(result);showDiscoveryProgress(null);
        activity('تم تجهيز النموذج التجريبي.','success');
        location.hash='library';
        return;
      }
      const input=$('sourceUrl').value.trim(), kind=$('sourceKind').value;
      const results=$('titleResults');results.hidden=true;results.replaceChildren();
      if(!input)throw new Error('اكتب اسم العمل أو أدخل رابط صفحته.');
      if(/^https?:\/\//i.test(input)){
        await discoverWork(input,kind);
        return;
      }
      activity('جارٍ البحث في فهرس المصدر…','loading');
      const {results:matches}=await API('title-search',{query:input,kind});
      if(!matches.length){
        activity('لم يظهر عمل بهذا الاسم في فهرس البحث. جرّب اسمًا آخر أو أدخل رابط المصدر.','info');
        return;
      }
      const matchingName=value=>value.replace(/^(فيلم|مسلسل)\s+/,'').trim().toLocaleLowerCase();
      const exact=matches.filter(item=>matchingName(item.title)===matchingName(input));
      if(exact.length===1){
        await discoverWork(exact[0].url,exact[0].kind);
        return;
      }
      results.append(make('h3','', 'اختر العمل لبدء الفحص'));
      for(const item of matches){
        const button=make('button','title-result');
        button.type='button';
        button.append(make('strong','',item.title),make('span','',fmtKind(item.kind)+' ←'));
        button.onclick=()=>action(async()=>{
          await discoverWork(item.url,item.kind);
          results.hidden=true;
        });
        results.append(button);
      }
      results.hidden=false;
      activity('ظهرت '+matches.length+' نتيجة. اختر العمل الصحيح للمتابعة.','info');
    });
  }
  async function importLinks(){
    await action(async()=>{
      const value=$('linksInput').value.trim();if(!value)throw new Error('الصق روابط الفيديو أولًا.');
      activity('ربط روابط الفيديو بالحلقات...','loading');
      await syncEdits({silent:true});
      const result=await API('links',{text:value});
      updateStatus(result);closeModal('linksModal');
      activity(`تم ربط ${result.updated} رابط. ${result.problems.length?'بعض الأسطر تحتاج مراجعة.':'يمكنك فحصها الآن.'}`,'success');
      if(result.problems.length)toast(result.problems.slice(0,3).join('؛ '),'error');
      else toast('تم الربط. اضغط فحص الروابط للتأكد من صلاحيتها.','success');
    });
  }
  async function verifyRows(indices){
    await action(async()=>{
      await syncEdits({silent:true});
      const cat=app.catalogue;
      if(cat.kind==='series' && !indices.length)throw new Error('لا توجد حلقات للفحص.');
      const total=cat.kind==='movie'?1:indices.length;
      let finished=0;
      $('verifyProgressWrap').hidden=false;
      const chunks=cat.kind==='movie'?[[]]:Array.from({length:Math.ceil(indices.length/6)},(_,i)=>indices.slice(i*6,(i+1)*6));
      for(const chunk of chunks){
        $('verifyProgressText').textContent='يتم التحقق من طلبات الفيديو...';
        activity(`فحص التشغيل ${finished} / ${total} — قد تستغرق المواقع الخارجية وقتًا.`,'loading');
        const result=await API('verify',{indices:chunk});
        finished += cat.kind==='movie'?1:chunk.length;
        $('verifyProgressNum').textContent=Math.round(finished/total*100)+'%';
        $('verifyProgressBar').style.width=Math.round(finished/total*100)+'%';
        updateStatus(result);
      }
      $('verifyProgressWrap').hidden=true;
      const current=app.catalogue;
      const entries=current.kind==='movie'?[current]:current.episodes;
      const count=entries.filter(e=>e.verified).length;
      const embeds=entries.filter(e=>(e.sources||[]).some(src=>src.kind==='embed'&&src.reachable&&src.url===e.media_url)).length;
      activity(`انتهى الفحص: ${count} فيديو مباشر مُتحقق، ${embeds} صفحة Embed متاحة (تشغيلها غير مؤكد).`,'success');
      toast('اكتمل فحص الروابط وصفحات التضمين.','success');
    });
  }
  async function doLogin(event){
    event.preventDefault();
    await action(async()=>{
      activity('التحقق من حساب المسؤول في Supabase...','loading');
      const email=$('loginEmail').value.trim(),password=$('loginPassword').value,access_token=$('loginToken').value.trim();
      const result=await API('login',{email,password,access_token});
      if(!result.authenticated)throw new Error('رفض تسجيل الدخول');
      $('loginPassword').value='';$('loginToken').value='';app.authenticated=true;
      $('accountText').textContent='مسؤول متصل';$('syncAuth').textContent='● مسؤول معتمد';
      $('syncLogin').textContent='✓ تم تسجيل الدخول';closeModal('loginModal');
      activity('تم تأكيد اتصال حساب المسؤول. يمكنك حفظ الأعمال في قاعدة البيانات.','success');
      toast('تم تسجيل الدخول بنجاح.','success');
    });
    if(app.authenticated)await readBrowserCapture();
  }
  async function saveWork(){
    await action(async()=>{
      if(!app.authenticated){openModal('loginModal');throw new Error('سجّل دخول المسؤول قبل الحفظ.');}
      if(app.demo)throw new Error('اكتشف محتوى حقيقيًا أولًا. النموذج التجريبي غير قابل للنشر.');
      await syncEdits({silent:true});
      const publish=document.querySelector('input[name=publishMode]:checked').value==='publish';
      const authorized=$('rightsAuthorized').checked;
      if(publish&&!authorized)throw new Error('للنشر العام يجب تأكيد تصريح عرض المحتوى والصور. يمكنك الحفظ كمسودة بدونه.');
      if(!confirm('تأكيد حفظ '+app.catalogue.title+' في مكتبة العز TV؟ '+(publish?'سيُطلب نشر المحتوى للجمهور.':'سيُحفظ كمسودة.')))return;
      activity('جارٍ الاتصال بقاعدة البيانات وحفظ المواسم والحلقات...','loading');
      const result=await API('save',{publish,rights_authorized:authorized,
        auto_publish_episodes:publish&&$('autoPublishEpisodes').checked,
        rights_holder:$('rightsHolder').value.trim(),license_reference:$('licenseRef').value.trim()});
      const obj=result.result;
      const queued=(obj.bindings||[]).filter(row=>row.awaiting_playback).length;
      const sentence=`✓ تم حفظ العمل: ${obj.works_new} عمل جديد، ${obj.works_updated} محدّث، ${obj.episodes_new||0} حلقة جديدة، ${obj.episodes_updated||0} محدّثة.`+
        (queued?` ${queued} حلقة تنتظر التحقق من التشغيل قبل نشرها تلقائيًا.`:'');
      const panel=$('saveResult');panel.hidden=false;panel.textContent=sentence;
      activity(sentence,'success');toast('تمت مزامنة مكتبتك مع Supabase.','success');
    });
  }
  function showRights(){const publish=document.querySelector('input[name=publishMode]:checked').value==='publish';$('rightsFields').hidden=!publish;}
  function wire(){
    $('discoveryForm').onsubmit=event=>{event.preventDefault();startDiscover(false);};
    $('discoveryReview').onclick=()=>location.hash='library';$('demoBtn').onclick=()=>startDiscover(true);
    $('discoverBatchBtn').onclick=importBatch;$('scanListingBtn').onclick=scanListing;$('saveBatchBtn').onclick=saveBatch;
    $('studioExportPlayersCsv').onclick=()=>exportStudioPlayers('csv');
    $('studioExportPlayersJson').onclick=()=>exportStudioPlayers('json');
    $('studioCopyPlayers').onclick=copyStudioPlayerLinks;
    $('exportBatchBtn').onclick=()=>{window.location.href='/api/export-batch';};
    $('exportBtn').onclick=()=>{if(!app.catalogue)return;window.location.href='/api/export';};
    $('toastCenterBtn').onclick=()=>toast('يمكنك الاطلاع على حالة الاستيراد في الشريط أسفل قسم الاكتشاف.');
    $('updateBtn').onclick=()=>action(()=>syncEdits());
    $('linksToggle').onclick=$('toolsLinksBtn').onclick=()=>openModal('linksModal');$('applyLinksBtn').onclick=importLinks;
    $('pasteFetchVBtn').onclick=async()=>{
      const field=$('linksInput');
      try {
        const text=(await navigator.clipboard.readText()).trim();
        if(!text){toast('انسخ رابط الفيديو من FetchV أولًا.');return;}
        const start=field.selectionStart, end=field.selectionEnd;
        field.setRangeText(text,start,end,'end');
      } catch {
        toast('اضغط Ctrl+V للصق الرابط في الحقل.');
      }
      field.focus();
    };
    $('verifyAllBtn').onclick=()=>verifyRows(app.catalogue&&app.catalogue.kind==='series'?app.catalogue.episodes.map((e,i)=>i):[]);
    $('verifySelectedBtn').onclick=()=>verifyRows([...app.selected]);$('verifyMovieBtn').onclick=()=>verifyRows([]);
    $('movieMediaUrl').addEventListener('change',()=>{
      const input=$('movieMediaUrl');input.value=normalizeMediaInput(input.value);
      const button=$('movieOkPreview');if(button){button.hidden=!okPlayerUrl(input.value);}
    });
    $('edgeCaptureBtn').onclick=()=>action(startEpisodeBatches);
    $('episodeBatchStop').onclick=()=>action(stopEpisodeBatches);
    $('episodeSearch').oninput=()=>{if(app.catalogue?.kind==='series')renderEpisodes();};
    $('loginForm').onsubmit=doLogin;
    $('loginToggle').onclick=async()=>{
      if(!app.authenticated){openModal('loginModal');return;}
      if(!confirm('تسجيل خروج مسؤول العز TV من هذا الموقع المحلي؟'))return;
      try{await API('logout',{});const fresh=await API('status');updateStatus(fresh);toast('تم تسجيل الخروج.','success');}
      catch(e){toast(e.message,'error');}
    };
    $('syncLogin').onclick=()=>$('loginToggle').click();
    $('saveBtn').onclick=saveWork;
    document.querySelectorAll('input[name=publishMode]').forEach(el=>el.onchange=showRights);
    $('addEpisodeBtn').onclick=()=>{rowField('addSeason',app.season);rowField('addNumber',1+Math.max(0,...(app.catalogue.episodes||[]).filter(e=>e.season===app.season).map(e=>e.number)));openModal('episodeModal');};
    $('episodeAddForm').onsubmit=async e=>{e.preventDefault();await action(async()=>{
      await syncEdits({silent:true});
      const result=await API('episode-add',{season:Number($('addSeason').value),number:Number($('addNumber').value),title:$('addTitle').value.trim()});
      app.season=Number($('addSeason').value);updateStatus(result);closeModal('episodeModal');toast('أضيفت الحلقة.','success');
    });};
    document.querySelectorAll('[data-close]').forEach(btn=>btn.onclick=()=>closeModal(btn.getAttribute('data-close')));
    document.querySelectorAll('.modal-backdrop').forEach(backdrop=>backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeModal(backdrop.id);}));
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-backdrop:not([hidden])').forEach(m=>closeModal(m.id));});
    $('menuBtn').onclick=()=>$('sidebar').classList.toggle('open');
    document.querySelectorAll('.nav-link').forEach(a=>a.onclick=()=>$('sidebar').classList.remove('open'));
    $('posterPreview').onerror=()=>{$('posterPreview').hidden=true;};
    $('metaPoster').onchange=()=>{const v=$('metaPoster').value.trim();if(v.startsWith('https://')){$('posterPreview').hidden=false;$('posterPreview').src=v;}else $('posterPreview').hidden=true;};
  }
  async function readBrowserCapture(){
    if(!app.csrf || app.busy)return;
    const key='alezz:browser-capture', raw=sessionStorage.getItem(key);
    if(!raw)return;
    await action(async()=>{
      activity('جارٍ جلب بيانات العمل وفحص جميع الروابط المرسلة…','info');
      const result=await API('browser-capture',JSON.parse(raw));
      if(!result.capture.awaiting_login && sessionStorage.getItem(key)===raw)sessionStorage.removeItem(key);
      updateStatus(result);
      const target=result.catalogue.kind==='movie'?result.catalogue:result.catalogue.episodes[0];
      $('browserCaptureSummary').textContent=result.catalogue.title+' · '+result.capture.verified+
        ' روابط تشغيل سليمة من أصل '+result.capture.total+' نتيجة. '+
        (result.capture.saved?'حُفظت البيانات وأضيفت المصادر إلى المزامنة الذكية.':
          result.capture.awaiting_login?'سجّل دخول المسؤول لحفظ هذه الدفعة تلقائيًا.':'راجع البيانات ثم اختر الحفظ أو النشر.');
      const list=$('browserCaptureLinks');
      list.replaceChildren(...target.sources.map(source=>{
        const row=document.createElement('li');
        const label=document.createElement('strong');
        label.textContent=source.verified?'اجتاز الفحص':source.reachable?'صفحة مشغّل متاحة':'لم يجتز الفحص';
        const address=document.createElement('div');
        address.dir='ltr';
        address.style.overflowWrap='anywhere';
        address.textContent=source.url;
        const copy=document.createElement('button');
        copy.type='button';
        copy.className='small-outline';
        copy.textContent='نسخ الرابط';
        copy.onclick=()=>navigator.clipboard.writeText(source.url).then(()=>toast('نُسخ الرابط.','success')).catch(()=>toast('حدّد الرابط وانسخه يدويًا.','error'));
        row.append(label,address,copy);
        return row;
      }));
      $('browserCaptureSave').onclick=()=>{location.hash='publish';};
      $('browserCaptureResults').hidden=false;
      location.hash='tools';
      showDiscoveryProgress(null);
      activity('اكتمل فحص روابط الإضافة.','success');
    });
  }
  window.addEventListener('alezz-browser-capture',readBrowserCapture);
  async function init(){wire();try{const result=await API('init');app.csrf=result.csrf;updateStatus(result);showDiscoveryProgress(result.scan);await readBrowserCapture();if(!$('browserCaptureResults').hidden||result.scan)return;activity('الموقع جاهز. ابحث بالاسم أو أدخل رابط صفحة العمل.','success');}catch(error){activity(error.message,'error');toast(error.message,'error');}}
  init();
})();
