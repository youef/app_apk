(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const app = {csrf:'', catalogue:null, batch:[],currentIndex:0, authenticated:false, demo:false, busy:false, season:1, selected:new Set(), categoryList:[]};
  const API = async (route, data) => {
    const request = data === undefined ? {method:'GET'} : {method:'POST',body:JSON.stringify(data)};
    const response = await fetch('/api/' + route, {credentials:'same-origin',cache:'no-store',...request,
      headers: data === undefined ? {'Accept':'application/json'} : {'Accept':'application/json','Content-Type':'application/json','X-CSRF-Token':app.csrf}});
    let result;
    try{result = await response.json();} catch(_){throw new Error('تعذّر قراءة استجابة خادم Python.');}
    if(!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'حدث خطأ في الطلب: ' + response.status);
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
    if(type==='loading')$('activity').querySelector('.activity-ico').classList.add('spin');
    else $('activity').querySelector('.activity-ico').classList.remove('spin');
  }
  function busy(value){app.busy=value; for(const id of ['discoverBtn','discoverBatchBtn','scanListingBtn','saveBatchBtn','demoBtn','applyLinksBtn','updateBtn','verifyAllBtn','verifySelectedBtn','verifyMovieBtn','edgeCaptureBtn','saveBtn','addEpisodeBtn']){
    if($(id))$(id).disabled=value || (id==='saveBtn' && app.demo);
  }}
  function text(el, value){el.textContent = value==null?'':String(value);return el;}
  function make(tag, cls='', content){const el=document.createElement(tag);if(cls)el.className=cls;if(content!=null)text(el,content);return el;}
  function rowField(id, value){const el=$(id);if(el && document.activeElement!==el)el.value=value??'';}
  function fmtKind(kind){return kind==='series'?'مسلسل':'فيلم';}
  function mediaBadge(ep){if(ep.verified)return ['✓ صالح','ok'];if(ep.error)return ['✕ غير متحقق','fail'];return [ep.media_url?'◷ يحتاج فحصًا':'— بلا رابط','wait'];}
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
      $('seasonTabs').replaceChildren();
    } else renderSeasons();
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
      const url=make('input','episode-url');url.type='url';url.value=ep.media_url||'';url.placeholder='رابط MP4 / HLS (اختياري)';url.dir='ltr';url.setAttribute('aria-label','رابط تشغيل الحلقة '+ep.number);
      url.onchange=()=>{const current=app.catalogue.episodes[ep.i];if(current.media_url!==url.value.trim()){
        current.media_url=url.value.trim();current.verified=false;current.error='';
        redrawStats();
      }};
      const [label,cls]=mediaBadge(ep);const badge=make('span','media-badge '+cls,label);
      const expand=make('button','row-info','⋯');expand.type='button';expand.title='وصف الحلقة وصورتها';expand.setAttribute('aria-label','تفاصيل الحلقة '+ep.number);
      expand.onclick=()=>wrapper.classList.toggle('expanded');
      const details=make('div','episode-details');
      const dlabel=make('label','wide');dlabel.append(make('span','','وصف الحلقة'));const desc=make('textarea');desc.rows=2;desc.value=ep.description||'';desc.maxLength=1500;
      desc.oninput=()=>app.catalogue.episodes[ep.i].description=desc.value;dlabel.append(desc);
      const plabel=make('label','wide');plabel.append(make('span','','رابط صورة الحلقة'));const posterUrl=make('input');posterUrl.dir='ltr';posterUrl.value=ep.poster_url||'';posterUrl.type='url';
      posterUrl.onchange=()=>{app.catalogue.episodes[ep.i].poster_url=posterUrl.value.trim();};plabel.append(posterUrl);
      if(ep.error)details.append(make('small','',`نتيجة الفحص: ${ep.error}`));
      details.append(dlabel,plabel);
      wrapper.append(check,poster,identity,url,badge,expand,details);list.append(wrapper);
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
      media_url:cat.kind==='movie'?$('movieMediaUrl').value.trim():undefined,
      episodes:cat.kind==='series'?cat.episodes.map(e=>({season:e.season,number:e.number,title:e.title,description:e.description,
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
  function closeModal(id){$(id).hidden=true;}
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
      $('workspace').scrollIntoView({behavior:'smooth',block:'start'});
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

  async function startDiscover(demo=false){
    await action(async()=>{
      if(!demo){const url=$('sourceUrl').value.trim();if(!url)throw new Error('اكتب رابط الفيلم أو المسلسل أولًا.');}
      activity(demo?'إعداد النموذج التجريبي...':'يتم تحليل صفحة المصدر واكتشاف المواسم والحلقات...','loading');
      const result=demo?await API('demo',{}):await API('discover',{url:$('sourceUrl').value.trim(),kind:$('sourceKind').value,
        deep:$('deepScan').checked,metadata:$('autoMetadata').checked});
      app.selected.clear();app.season=1;$('episodeSearch').value='';
      updateStatus(result);
      activity(demo?'تم تجهيز نموذج واجهة تجريبي — لا يمكن رفعه إلى Supabase.':
        `تم اكتشاف ${result.catalogue.kind==='series' ? result.catalogue.episodes.length+' حلقة' : 'الفيلم'}، ويمكنك الآن تعديل البيانات وفحص الروابط.`,'success');
      $('workspace').scrollIntoView({behavior:'smooth',block:'start'});
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
      const count=current.kind==='movie'?Number(current.verified):current.episodes.filter(e=>e.verified).length;
      activity(`انتهى الفحص. تم التحقق من ${count} رابط، والبقية محفوظة كبيانات للمراجعة.`,'success');
      toast('اكتمل فحص الروابط الحالية.','success');
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
        rights_holder:$('rightsHolder').value.trim(),license_reference:$('licenseRef').value.trim()});
      const obj=result.result;
      const sentence=`✓ تم حفظ العمل: ${obj.works_new} عمل جديد، ${obj.works_updated} محدّث، ${obj.episodes_new||0} حلقة جديدة، ${obj.episodes_updated||0} محدّثة.`;
      const panel=$('saveResult');panel.hidden=false;panel.textContent=sentence;
      activity(sentence,'success');toast('تمت مزامنة مكتبتك مع Supabase.','success');
    });
  }
  function showRights(){const publish=document.querySelector('input[name=publishMode]:checked').value==='publish';$('rightsFields').hidden=!publish;}
  async function refreshLibrary(){
    if(!app.csrf)return;
    try{
      const data=await API('library-status');
      const p=data.counts?.pages||{}, w=data.counts?.works||{};
      $('libPagesDone').textContent=p.done||0;
      $('libWorksDone').textContent=w.done||0;
      $('libPending').textContent=(p.pending||0)+(p.processing||0)+(w.pending||0)+(w.processing||0);
      $('libFailed').textContent=(p.failed||0)+(w.failed||0);
      $('libraryProgress').textContent=data.running?
        `المزامنة جارية: تمت فهرسة ${p.done||0} صفحة وتحليل ${w.done||0} عمل. تستمر المهام التالية حتى عند تعطل إحدى الصفحات.`:
        `الفهرسة متوقفة أو مكتملة. الأعمال المحللة: ${w.done||0}. اضغط «استكمال» لمتابعة المتبقي.`;
      const host=$('libraryWorkList');host.replaceChildren();
      (data.works||[]).slice(0,36).forEach(item=>{
        const card=make('div','lib-work '+(item.status==='done'?'done':item.status==='failed'?'failed':''));
        card.append(make('strong','',item.url));
        card.append(make('small','',item.status==='done'?(item.saved?'✓ محفوظ في Supabase':'✓ البيانات جاهزة للحفظ'):
          item.status==='failed'?'تعذر الاستيراد — يمكن إعادة المحاولة':item.status==='processing'?`جارٍ الاكتشاف · ${item.episode_progress||0} حلقة محفوظة في نقطة الاستكمال`:'في قائمة الانتظار'));
        if(item.warnings)card.append(make('small','',`${item.warnings} صفحة حلقة تعذّر فحصها؛ راجع العمل وأعد مزامنته`));
        if(item.error||item.save_error)card.append(make('small','',item.error||item.save_error));
        if(item.status==='done'){
          const btn=make('button','small-outline','فتح تفاصيل العمل');
          btn.onclick=()=>action(async()=>{
            const result=await API('library-load',{url:item.url});
            app.season=1;app.selected.clear();updateStatus(result);
            $('workspace').scrollIntoView({behavior:'smooth',block:'start'});
          });
          card.append(btn);
        }
        host.append(card);
      });
    }catch(_){/* Page may be reloading or session may have expired. */}
  }
  async function startLibrary(){
    await action(async()=>{
      const urls=$('libraryUrls').value.trim();
      if(!urls)throw new Error('ضع رابط صفحة مكتبة واحدة أو أكثر، كل رابط في سطر.');
      const r=await API('library-start',{urls,kind:$('libraryKind').value});
      activity('بدأت فهرسة صفحات المكتبات وحلقاتها، مع حفظ نقطة التوقف على الجهاز.','success');
      toast('تمت إضافة المكتبات إلى طابور الفهرسة.','success');
      await refreshLibrary();
    });
  }
  async function resumeLibrary(retry=false){
    await action(async()=>{
      await API(retry?'library-retry':'library-resume',{});
      toast(retry?'أُعيدت المهام المتعثرة إلى الطابور.':'تم استكمال الطابور المحفوظ.','success');
      await refreshLibrary();
    });
  }
  async function saveLibrary(){
    await action(async()=>{
      if(!app.authenticated){openModal('loginModal');throw new Error('يلزم تسجيل دخول مسؤول العز TV قبل الحفظ.');}
      const publish=document.querySelector('input[name=publishMode]:checked').value==='publish';
      const rights_authorized=$('rightsAuthorized').checked;
      if(publish&&!rights_authorized)throw new Error('النشر العام يحتاج إذن عرض. اختر حفظ المسودات بدلًا من ذلك.');
      if(!confirm('بدء حفظ الأعمال المُكتشفة إلى قاعدة العز TV؟ (تُستبعد روابط الفيديو غير المتحقق منها)'))return;
      let saved=0,failed=0,more=true,batches=0;
      while(more&&batches<100){
        const result=await API('library-save',{publish,rights_authorized,
          rights_holder:$('rightsHolder').value.trim(),license_reference:$('licenseRef').value.trim()});
        batches++;
        saved+=(result.results||[]).filter(x=>x.ok).length;
        failed+=(result.results||[]).filter(x=>!x.ok).length;
        more=result.remaining;
        activity(`حفظ ${saved} عمل، أخطاء ${failed}، دفعات ${batches}...`,'loading');
        if(!result.attempted)break;
      }
      await refreshLibrary();
      activity(`اكتمل حفظ ${saved} عملًا، وتعذر حفظ ${failed}. ${more?'يمكن استكمال بقية الأعمال بالنقر مجددًا.':''}`,failed?'error':'success');
      toast(`الحفظ: ${saved} ناجح و${failed} يحتاج مراجعة.`,failed?'error':'success');
    });
  }
  function wire(){
    $('libraryStart').onclick=startLibrary;$('libraryResume').onclick=()=>resumeLibrary(false);
    $('libraryRetry').onclick=()=>resumeLibrary(true);$('librarySave').onclick=saveLibrary;
    $('discoverBtn').onclick=()=>startDiscover(false);$('demoBtn').onclick=()=>startDiscover(true);
    $('discoverBatchBtn').onclick=importBatch;$('scanListingBtn').onclick=scanListing;$('saveBatchBtn').onclick=saveBatch;
    $('exportBatchBtn').onclick=()=>{window.location.href='/api/export-batch';};
    $('exportBtn').onclick=()=>{if(!app.catalogue)return;window.location.href='/api/export';};
    $('toastCenterBtn').onclick=()=>toast('يمكنك الاطلاع على حالة الاستيراد في الشريط أسفل قسم الاكتشاف.');
    $('updateBtn').onclick=()=>action(()=>syncEdits());
    $('linksToggle').onclick=()=>openModal('linksModal');$('applyLinksBtn').onclick=importLinks;
    $('verifyAllBtn').onclick=()=>verifyRows(app.catalogue&&app.catalogue.kind==='series'?app.catalogue.episodes.map((e,i)=>i):[]);
    $('verifySelectedBtn').onclick=()=>verifyRows([...app.selected]);$('verifyMovieBtn').onclick=()=>verifyRows([]);
    $('edgeCaptureBtn').onclick=()=>action(async()=>{
      if(!app.catalogue)throw new Error('اكتشف العمل أولًا.');
      const cloud=!['localhost','127.0.0.1'].includes(location.hostname);
      if(cloud&&!app.authenticated){$('loginToggle').click();throw new Error('سجّل دخول مسؤول Supabase أولًا لتفعيل فحص Chromium على Render.');}
      const message=cloud?'سيعمل متصفح Chromium على خادم Render لفحص روابط HTTPS العامة فقط. لا يتحكم في Safari ولا في الإضافات. متابعة؟':'سيُفتح Microsoft Edge محليًا في نافذة جديدة لفحص طلبات الوسائط العامة. متابعة؟';
      if(!confirm(message))return;
      await syncEdits({silent:true});
      const total=app.catalogue.kind==='series'?app.catalogue.episodes.length:1;
      if(!total)throw new Error('لم يتم اكتشاف حلقات بعد؛ استورد قائمة الحلقات أولًا.');
      const key=app.catalogue.url+'|'+total;
      if(app.browserScanKey!==key){app.browserScanKey=key;app.browserScanIndex=0;}
      let index=app.browserScanIndex||0;
      if(index>=total)index=0;
      let found=0,processed=0;
      while(index<total&&processed<32){
        activity(`فحص الصفحات عبر Chromium: ${index} من ${total}. روابط مكتشفة في الجولة: ${found}.`,'loading');
        const result=await API('edge-capture',{seconds:2,max_pages:4,start_index:index});
        found+=result.detected;
        processed+=result.processed;
        index=result.next_index;
        app.browserScanIndex=index;
        updateStatus(result);
        if(!result.processed)break;
      }
      const more=index<total;
      const note=`انتهى فحص ${processed} صفحة؛ اكتُشف ${found} رابط. ${more?'اضغط الزر مجددًا لاستكمال بقية الحلقات.':'انتهت جميع الصفحات.'} افحص صلاحية الروابط قبل حفظها.`;
      activity(note,found?'success':'info');
      toast(note,found?'success':'info');
    });
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
  async function init(){wire();try{const result=await API('init');app.csrf=result.csrf;updateStatus(result);refreshLibrary();setInterval(()=>{if(document.visibilityState==='visible')refreshLibrary();},8000);activity('الموقع جاهز. الصق رابط فيلم أو مسلسل لبدء الاكتشاف.','success');}catch(error){activity(error.message,'error');toast(error.message,'error');}}
  init();
})();
