/* Al Ezz Library Manager — compact, admin-only media/season editor. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const modal=$('libraryEditorDialog'),body=$('libraryEditorBody');
  if(!modal||!body)return;
  let csrf='',active=null,backSeries='',detail=null,limits={},busy=false;
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
    body.innerHTML=nav+stage+form+seasons;
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
  async function scan(table,id,force){
    if(busy)return;busy=true;
    try{
      const r=await request('/api/control/check',{table,id,force:!!force});
      feedback('أضيف '+r.queued+' عنصر للفحص. تُجدد الروابط غير السليمة تلقائيًا. لن تحتاج لإعادة الاستكشاف.');refreshGrid();
    }catch(e){feedback(e.message,true);}
    finally{busy=false;}
  }
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
