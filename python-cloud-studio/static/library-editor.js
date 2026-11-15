/* Al Ezz Library Manager — compact, admin-only media/season editor. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const modal=$('libraryEditorDialog'),body=$('libraryEditorBody');
  if(!modal||!body)return;
  let csrf='',active=null,backSeries='',detail=null,limits={},busy=false;
  const scans=new Map();
  const scanMonitor=$('scanMonitor');
  const labels={aseel_movies:'فيلم',aseel_series:'مسلسل',aseel_seasons:'موسم',aseel_episodes:'حلقة'};
  const fields={
    aseel_movies:[['title_ar','عنوان الفيلم','text'],['title_original','العنوان الأصلي','text'],
      ['description','القصة أو الوصف','textarea'],['release_year','سنة الإنتاج','number'],
      ['poster_url','رابط البوستر','url'],['backdrop_url','رابط الخلفية','url'],
      ['source_page_url','رابط صفحة الفيلم الأصلية','url'],['stream_url','رابط تشغيل مباشر (اختياري)','url']],
    aseel_series:[['title_ar','عنوان المسلسل','text'],['title_original','العنوان الأصلي','text'],
      ['description','قصة المسلسل','textarea'],['release_year','سنة الإنتاج','number'],
      ['poster_url','رابط البوستر','url'],['backdrop_url','رابط الخلفية','url'],
      ['source_page_url','رابط المسلسل الأصلي','url']],
    aseel_seasons:[['title_ar','عنوان الموسم','text'],['number','رقم الموسم','number']],
    aseel_episodes:[['title_ar','عنوان الحلقة','text'],['number','رقم الحلقة','number'],
      ['description','وصف الحلقة','textarea'],['poster_url','بوستر الحلقة','url'],
      ['source_page_url','رابط صفحة الحلقة','url'],['stream_url','رابط التشغيل المباشر (اختياري)','url']]
  };
  const prettyDate=v=>{
    if(!v)return 'لم يُجدول';
    const n=Number(v),d=new Date(n>1e12?n:n>1e9?n*1000:v);
    return isNaN(d.getTime())?'—':d.toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'});
  };
  async function request(path,payload){
    if(!csrf){
      const r=await fetch('/api/init',{credentials:'same-origin',cache:'no-store'});
      if(!r.ok)throw Error('سجل الدخول إلى الاستوديو أولًا');
      csrf=(await r.json()).csrf;
    }
    const options={credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}};
    if(payload!==undefined){
      options.method='POST';options.headers['Content-Type']='application/json';
      options.headers['X-CSRF-Token']=csrf;options.body=JSON.stringify(payload);
    }
    const response=await fetch(path,options);
    let data;try{data=await response.json();}catch(_){throw Error('تعذر قراءة استجابة الخادم');}
    if(!response.ok)throw Error(data.detail||('HTTP '+response.status));
    return data;
  }
  function feedback(message,isError){
    const host=$('toastHost');if(!host)return;
    const node=document.createElement('div');node.className='toast '+(isError?'error':'success');
    node.textContent=message;host.prepend(node);setTimeout(()=>node.remove(),5500);
  }
  function refreshGrid(){
    $('reloadLibrary')?.click();
    $('refreshNow')?.click();
  }
  function cover(row){
    const uri=String(row?.poster_url||'');
    if(!/^https:\/\/[^"<> ]+$/i.test(uri))return '<div class="editor-poster-placeholder">▦</div>';
    return '<img class="editor-poster" src="'+esc(uri)+'" loading="lazy" alt="">';
  }
  function inputField(name,label,type,value){
    const val=value??'',id='edit-'+name;
    if(type==='textarea')return '<label class="editor-field editor-wide" for="'+id+'"><span>'+esc(label)+'</span>'+
      '<textarea id="'+id+'" name="'+name+'" maxlength="3000" rows="3">'+esc(val)+'</textarea></label>';
    return '<label class="editor-field '+(type==='url'?'editor-wide':'')+'" for="'+id+'"><span>'+esc(label)+'</span>'+
      '<input id="'+id+'" name="'+name+'" '+(type==='number'?'min="1" step="1"':'maxlength="2048"')+
      ' type="'+type+'" dir="'+(type==='url'?'ltr':'auto')+'" value="'+esc(val)+'"'+
      (name==='title_ar'&&active.table!=='aseel_episodes'?' required':'')+'></label>';
  }
  function summary(item,table,meta){
    if(!item)return '';
    const schedule=meta?.schedule?.[table+':'+item.id]||{};
    const status=item.link_health_status||schedule.status||'unchecked';
    const poster=cover(item);
    return '<div class="editor-summary">'+poster+'<div><strong>'+esc(item.title_ar||labels[table])+'</strong>'+
      '<p>الحالة: '+esc(status==='healthy'?'سليم':status==='broken'?'متعطل':status==='suspect'?'يحتاج مراجعة':'لم يُفحص')+
      ' · '+esc(item.status==='published'?'منشور':'مسودة')+'</p>'+
      '<small>آخر فحص: '+prettyDate(schedule.last_check||item.link_health_checked_at)+'</small>'+
      '<small>الفحص القادم: '+prettyDate(schedule.next_check)+'</small>'+
      '<small>تجديد الرابط: '+(schedule.next_refresh&&schedule.next_refresh>Date.now()/1000+31536000?'عند التعطل فقط':prettyDate(schedule.next_refresh))+'</small></div></div>';
  }
  function fieldsHTML(item,table){
    return (fields[table]||[]).map(f=>inputField(f[0],f[1],f[2],item?.[f[0]])).join('');
  }
  function rowHTML(ep,seriesId){
    const label=ep.link_health_status==='healthy'?'سليم':
      ep.link_health_status==='broken'?'معطل':ep.stream_url?'لم يفحص':'بلا رابط';
    return '<div class="editor-episode-row">'+cover(ep)+
      '<div class="editor-episode-caption"><strong>حلقة '+esc(ep.number)+' · '+esc(ep.title_ar||'بدون اسم')+'</strong>'+
      '<small>'+esc(label)+' · '+esc(ep.status==='published'?'منشورة':'مسودة')+'</small></div>'+
      '<div class="editor-episode-actions">'+
      '<button type="button" data-library-action="check" data-table="aseel_episodes" data-id="'+esc(ep.id)+'">فحص</button>'+
      '<button type="button" data-library-action="open" data-table="aseel_episodes" data-id="'+esc(ep.id)+'" data-parent="'+esc(seriesId)+'">تعديل</button>'+
      '</div></div>';
  }
  function episodesHTML(season,seriesId){
    const limit=limits[season.id]||30;
    const count=season.episodes.length;
    return season.episodes.slice(0,limit).map(ep=>rowHTML(ep,seriesId)).join('')+
      (limit<count?'<button type="button" class="editor-show-more" data-library-action="more" data-id="'+
        esc(season.id)+'">عرض المزيد ('+esc(count-limit)+')</button>':'');
  }
  function seasonsHTML(data){
    const rows=data?.seasons||[],seriesId=data.item.id;
    return '<div class="editor-section-head"><h3>المواسم والحلقات <small>'+esc(rows.length)+' مواسم</small></h3>'+
      '<button type="button" data-library-action="create" data-table="aseel_seasons" data-parent="'+esc(seriesId)+'">+ موسم</button></div>'+
      (rows.length?rows.map(season=>'<details class="editor-season"><summary><b>'+esc(season.title_ar||('الموسم '+season.number))+
        '</b><span>'+esc(season.episodes.length)+' حلقة</span></summary>'+
        '<div class="editor-season-tools"><button type="button" data-library-action="create" data-table="aseel_episodes" data-parent="'+
        esc(seriesId)+'" data-season-number="'+esc(season.number)+'">+ حلقة</button>'+
        '<button type="button" data-library-action="open" data-table="aseel_seasons" data-id="'+esc(season.id)+
        '" data-parent="'+esc(seriesId)+'">تعديل الموسم</button></div>'+
        '<div data-season-list="'+esc(season.id)+'">'+episodesHTML(season,seriesId)+'</div></details>').join(''):
        '<p class="editor-empty">لا توجد مواسم بعد. يمكنك إضافتها أو فحص مصدر المسلسل لاكتشافها.</p>');
  }
  function render(){
    if(!active)return;
    const table=active.table,item=detail?.item||{},creating=active.mode==='create';
    $('libraryEditorTitle').textContent=(creating?'إضافة ':'تفاصيل ')+labels[table];
    const nav=backSeries&&table!=='aseel_series'?'<button class="editor-back" type="button" data-library-action="back">↩ رجوع للمسلسل</button>':'';
    const stage=creating?'<div class="editor-note">العنصر الجديد يُحفظ كمسودة، ويُجدول فحصه من المصدر بعد الحفظ.</div>':
      summary(item,table,detail);
    const form='<form id="libraryCrudForm"><div class="editor-fields">'+fieldsHTML(item,table)+'</div>'+
      '<div class="editor-form-buttons"><button type="submit" class="editor-save">حفظ'+(creating?' وإضافة':' التعديلات')+'</button>'+
      (!creating&&table!=='aseel_seasons'?'<button type="button" data-library-action="check" data-table="'+
      table+'" data-id="'+esc(item.id)+'">فحص الآن</button>':'')+
      (!creating?'<button type="button" data-library-action="delete" data-table="'+table+'" data-id="'+
      esc(item.id)+'">حذف</button>':'')+'</div></form>';
    const seasons=!creating&&table==='aseel_series'?seasonsHTML(detail):'';
    body.innerHTML=nav+'<div id="inlineScanProgress" aria-live="polite"></div>'+stage+form+seasons;
    updateInlineScan();
  }
  async function openItem(table,id,parent){
    if(busy)return;
    busy=true;
    try{
      if(parent)backSeries=parent;
      else if(table==='aseel_series')backSeries=id;
      active={mode:'edit',table,id};
      $('libraryEditorTitle').textContent='فتح '+labels[table];
      body.innerHTML='<div class="loading">جارٍ تحميل التفاصيل من المكتبة...</div>';
      if(!modal.open)modal.showModal();
      detail=await request('/api/control/item?table='+encodeURIComponent(table)+'&id='+encodeURIComponent(id));
      limits={};
      render();
      // A refresh of the page or reopening a title resumes the visible status.
      try {
        const previous=await request('/api/control/check-latest?table='+encodeURIComponent(table)+
          '&id='+encodeURIComponent(id));
        if(previous.scan&&previous.scan.status==='running')watch(previous.scan.run_id,table,id,previous.scan);
        else if(previous.scan) {
          scans.set(previous.scan.run_id,{table,id,data:previous.scan,notified:true});
          renderScanMonitor();
        }
      } catch(_) {}
    }catch(e){body.textContent=e.message;feedback(e.message,true);}
    finally{busy=false;}
  }
  function createItem(table,parent='',season=1){
    if(busy)return;
    if(!parent)backSeries='';
    else backSeries=parent;
    detail=null;limits={};
    active={mode:'create',table,parent,season:Number(season)||1};
    if(!modal.open)modal.showModal();
    render();
    $('edit-title_ar')?.focus();
  }
  const scanStatus=status=>({
    running:'جارٍ الفحص الآن',completed:'مكتمل وسليم',partial:'مكتمل مع ملاحظات',
    failed:'لم ينجح الفحص',interrupted:'توقف بسبب إعادة تشغيل الخادم'
  })[status]||'جارٍ الفحص';
  function scanCard(t,inline=false){
    const data=t.data||{},num=Math.max(0,Math.min(100,Number(data.progress)||0));
    const done=data.status&&data.status!=='running';
    const count=Number(data.total)||0,processed=Number(data.completed)||0;
    const summary='<div class="scan-stats">'+
      '<span>تم '+esc(processed)+' / '+esc(count||'…')+'</span>'+
      '<span>سليم '+esc(data.healthy||0)+'</span>'+
      '<span>تجدد '+esc(data.renewed||0)+'</span>'+
      '<span>نُشر '+esc(data.published||0)+'</span>'+
      '<span>خلل '+esc(data.failed||0)+'</span></div>';
    const detail=(data.errors||[]).length?'<details class="scan-errors"><summary>أسباب التعطل ('+
      esc(data.errors.length)+')</summary><ul>'+data.errors.slice(-12).map(err=>
      '<li>'+esc(err)+'</li>').join('')+'</ul></details>':'';
    const outcomes=(data.outcomes||[]).length?'<details class="scan-errors"><summary>تفاصيل الحلقات ('+
      esc(data.outcomes.length)+')</summary><ul>'+data.outcomes.slice(-18).map(row=>
      '<li>'+esc(row.label)+' — '+esc(row.message)+'</li>').join('')+'</ul></details>':'';
    return '<div class="scan-task '+esc(data.status||'running')+'">'+
      '<div class="scan-heading"><strong>'+esc(scanStatus(data.status))+'</strong>'+
      '<span>'+num+'%</span>'+(inline||!done?'':'<button type="button" aria-label="إخفاء" data-scan-action="dismiss" data-run-id="'+
      esc(data.run_id)+'">×</button>')+'</div>'+
      '<div class="scan-progress-track" role="progressbar" aria-label="تقدم الفحص" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+num+
      '"><span style="width:'+num+'%"></span></div>'+
      '<p>'+esc(data.message||'جارٍ بدء الفحص…')+'</p>'+summary+detail+outcomes+
      (!inline&&done?'<button type="button" class="scan-refresh-grid" data-scan-action="reload">تحديث المكتبة</button>':'')+
      '</div>';
  }
  function updateInlineScan(){
    const target=$('inlineScanProgress');
    if(!target||!active||active.mode!=='edit')return;
    const entries=[...scans.values()].filter(t=>t.table===active.table&&t.id===active.id);
    target.innerHTML=entries.length?scanCard(entries[entries.length-1],true):'';
  }
  function renderScanMonitor(){
    if(!scanMonitor)return;
    const tasks=[...scans.values()].slice(-4);
    scanMonitor.hidden=!tasks.length;
    scanMonitor.innerHTML=tasks.map(t=>'<div class="scan-monitor-title">'+
      esc(t.table==='aseel_series'?'مسلسل':t.table==='aseel_movies'?'فيلم':'حلقة')+
      ' · متابعة الفحص المباشر</div>'+scanCard(t)).join('');
    updateInlineScan();
  }
  async function updateScan(runId){
    const task=scans.get(runId);
    if(!task)return;
    try{
      const data=await request('/api/control/check-progress?run_id='+encodeURIComponent(runId));
      task.data=data;
      if(data.status!=='running'&&!task.notified){
        task.notified=true;
        feedback(data.message||scanStatus(data.status),data.status==='failed');
        refreshGrid();
      }
      renderScanMonitor();
    }catch(e){
      if(!task.errorShown){task.errorShown=true;feedback('تعذر الاتصال بحالة الفحص: '+e.message,true);}
    }
  }
  function watch(runId,table,id,data){
    let t=scans.get(runId);
    if(!t){
      t={table,id,data:data||{run_id:runId,status:'running',progress:2,message:'بدء الفحص المباشر'},notified:false};
      scans.set(runId,t);
    }else if(data)t.data=data;
    renderScanMonitor();
    updateScan(runId);
  }
  async function scan(table,id,force){
    try{
      const r=await request('/api/control/check',{table,id,force:true});
      watch(r.run_id,table,id);
      if(r.already_running)feedback('الفحص شغال بالفعل؛ يتم عرض تقدمه الحالي.');
      else feedback('بدأ فحص مباشر؛ ستظهر نتيجة كل رابط أمامك.','success');
    }catch(e){feedback(e.message,true);}
  }
  window.AlEzzInstantScan=scan;
  setInterval(()=>{
    if(document.visibilityState==='hidden')return;
    scans.forEach((task,id)=>{if(task.data?.status==='running')updateScan(id);});
  },1300);
  async function remove(table,id){
    if(busy)return;
    const name=detail?.item?.title_ar||labels[table];
    if(!confirm('حذف '+name+' نهائيًا من المكتبة؟' +
       (table==='aseel_series'||table==='aseel_seasons'?' ستُحذف المواسم والحلقات التابعة له أيضًا.':'')))return;
    if(prompt('للتأكيد النهائي اكتب كلمة: حذف')!=='حذف')return;
    busy=true;
    try{
      const result=await request('/api/control/item',{action:'delete',table,id,confirm:id,
        cascade:table==='aseel_series'||table==='aseel_seasons'});
      feedback('تم حذف '+result.deleted+' عنصر من المكتبة.');
      modal.close();detail=null;active=null;refreshGrid();
    }catch(e){feedback(e.message,true);}
    finally{busy=false;}
  }
  async function saveForm(event){
    event.preventDefault();
    if(busy||!active)return;
    const table=active.table,form=event.currentTarget,formData=new FormData(form),values={};
    fields[table].forEach(f=>{
      const val=String(formData.get(f[0])||'').trim();
      if(val)values[f[0]]=f[2]==='number'?Number(val):val;
      else if(active.mode==='edit'&&f[2]!=='number')values[f[0]]='';
    });
    if(active.mode==='create'&&table==='aseel_seasons'&&!values.number)values.number=active.season;
    busy=true;
    const save=form.querySelector('button[type=submit]');save.disabled=true;
    try{
      const result=await request('/api/control/item',{action:active.mode==='create'?'create':'update',
        table,id:active.mode==='edit'?active.id:'',
        series_id:active.parent||backSeries||'',
        season_number:active.season||1,fields:values});
      feedback('تم حفظ '+labels[table]+' بنجاح.');
      refreshGrid();
      const back=backSeries;
      busy=false;
      if(back&&table!=='aseel_series')await openItem('aseel_series',back);
      else await openItem(table,result.id);
    }catch(e){feedback(e.message,true);}
    finally{busy=false;save.disabled=false;}
  }
  document.addEventListener('submit',event=>{
    if(event.target?.id==='libraryCrudForm')saveForm(event);
  });
  document.addEventListener('click',event=>{
    const scanAction=event.target.closest('[data-scan-action]');
    if(scanAction){
      event.preventDefault();
      if(scanAction.dataset.scanAction==='dismiss')scans.delete(scanAction.dataset.runId);
      if(scanAction.dataset.scanAction==='reload')refreshGrid();
      renderScanMonitor();
      return;
    }
    const action=event.target.closest('[data-library-action]');
    if(!action)return;
    event.preventDefault();
    const task=action.dataset.libraryAction,table=action.dataset.table,id=action.dataset.id;
    if(task==='open')openItem(table,id,action.dataset.parent||'');
    if(task==='create')createItem(table,action.dataset.parent||'',action.dataset.seasonNumber||1);
    if(task==='check')scan(table,id,false);
    if(task==='delete')remove(table,id);
    if(task==='back'&&backSeries)openItem('aseel_series',backSeries);
    if(task==='more'){
      const season=detail?.seasons?.find(s=>s.id===id);
      if(!season)return;
      limits[id]=(limits[id]||30)+100;
      const list=body.querySelector('[data-season-list="'+id+'"]');
      if(list)list.innerHTML=episodesHTML(season,detail.item.id);
    }
  });
  $('addMovieBtn')?.addEventListener('click',()=>createItem('aseel_movies'));
  $('addSeriesBtn')?.addEventListener('click',()=>createItem('aseel_series'));
})();
