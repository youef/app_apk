"use strict";
(function(){
 const cfg=window.ALEZZ_ADMIN_CONFIG,$=id=>document.getElementById(id);
 let batch=null,items=[],busy=false,stopped=false,saved=0,authenticated=false;
 function msg(v,type){const e=$("batchMessage");e.textContent=v;e.className="batch-message "+(type||"");}
 const savedSession=()=>{try{return JSON.parse(localStorage.getItem(cfg.storagePrefix+"session")||"null");}catch{return null;}};
 async function call(url,init={}){
  const session=savedSession();if(!session?.access_token)throw Error("يرجى تسجيل الدخول في لوحة الإدارة");
  const r=await fetch(url,{method:init.method||"GET",headers:{"apikey":cfg.publishableKey,"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json",...(init.headers||{})},body:init.body,cache:"no-store"});
  const raw=await r.text();let data;try{data=raw?JSON.parse(raw):null;}catch{data={error:raw.slice(0,100)}}
  if(!r.ok){
   const code=String(data?.error||data?.message||"HTTP "+r.status);
   const friendly={
    UNSAFE_HTTPS_URL:"الرابط غير آمن: استخدم رابط HTTPS عامًا باسم نطاق صالح.",
    DNS_PRIVATE_ADDRESS_BLOCKED:"تم رفض المصدر لأنه يشير إلى شبكة داخلية أو خاصة.",
    DNS_VALIDATION_UNAVAILABLE:"تعذّر تأكيد عنوان الموقع عبر DNS الآمن. جرّب مصدرًا آخر أو أعد المحاولة.",
    DNS_HAS_NO_PUBLIC_ADDRESS:"تعذّر العثور على عنوان إنترنت عام لهذا الموقع.",
    NOT_HTML:"الرابط ليس صفحة HTML قابلة للفحص؛ جرّب الرابط المباشر للفيديو.",
    PAGE_TOO_LARGE:"حجم الصفحة أكبر من حد الفحص الآمن.",
    HTTP_403:"الموقع يمنع فحصه من الخادم (403).",
    HTTP_429:"الموقع يحدّ من الطلبات المتكررة (429)."
   };
   throw Error(friendly[code]||data?.note||code);
  }return data;
 }
 const edge=body=>call(cfg.supabaseUrl+"/functions/v1/aseel-batch-discover",{method:"POST",body:JSON.stringify(body)});
 const rest=(table,qs="",init={})=>call(cfg.supabaseUrl+"/rest/v1/"+table+(qs?"?"+qs:""),init);
 const eq=v=>"eq."+encodeURIComponent(v);
 

 const allowedGenres=["action","adventure","animation","anime","biography","comedy","crime","documentary","drama","education","family","fantasy","history","horror","kids","mystery","nature","romance","scifi","science","short","sports","thriller","war","western","music","classic"];
 let sourceIds=new Set(),categoryOptions=[];
 const text=id=>($(id)?.value||"").trim();
 function https(input){try{const u=new URL(String(input||"").trim());return u.protocol==="https:"?u.href:"";}catch{return "";}}
 function guessGenres(haystack){
   const s=String(haystack||"").toLowerCase(),out=[];
   const tests=[["drama",/دراما|درامي|\bdrama\b/],["romance",/رومانسي|رومانسية|عشق|حب|\bromance\b/],
     ["action",/أكشن|اكشن|\baction\b/],["thriller",/تشويق|إثارة|\bthriller\b/],
     ["crime",/جريمة|جرائم|\bcrime\b/],["comedy",/كوميديا|كوميدي|\bcomedy\b/],
     ["horror",/رعب|\bhorror\b/],["anime",/أنمي|انمي|\banime\b/],
     ["animation",/كرتون|الرسوم المتحركة|\banimation\b/],["documentary",/وثائقي|\bdocumentary\b/],
     ["history",/تاريخي|\bhistorical\b/],["family",/عائلي|\bfamily\b/],
     ["scifi",/خيال علمي|\bsci.?fi\b/]];
   tests.forEach(x=>{if(x[1].test(s))out.push(x[0]);});return out;
 }
 function parseGenres(){
   return [...new Set(text("batchGenres").toLowerCase().split(/[,\s،]+/).filter(x=>allowedGenres.includes(x)))].slice(0,12);
 }
 function bestCategory(genres){
   const preferred={"drama":["دراما"],"romance":["رومانسي"],"comedy":["كوميديا"],"anime":["أنيمي"],"action":["أكشن"],"crime":["جريمة"],"documentary":["أفلام وثائقية"],"horror":["رعب"],"family":["عائلي"],"thriller":["إثارة"]};
   for(const genre of genres)for(const name of preferred[genre]||[]){
     const item=categoryOptions.find(c=>c.name_ar===name);if(item)return item.id;
   }return "";
 }
 function tidyTitle(value){
   return String(value||"").replace(/\s*[-–—|]\s*(?:موقع\s*)?(?:قرمزي|qrmzi)\s*$/i,"")
     .replace(/\s+/g," ").trim();
 }
 async function discoverExisting(){
   if(!batch||batch.type!=="series")return;
   const target=tidyTitle(text("batchTitle"));
   const all=await rest("aseel_series","select=id,title_ar,title_original,release_year,description,poster_url,backdrop_url,country_code,language_code,category_id,genre_tags,auto_tags,status,rights_status&limit=700");
   const matches=(all||[]).filter(x=>tidyTitle(x.title_ar).toLowerCase()===target.toLowerCase());
   if(matches.length!==1)return;
   const found=matches[0];batch.existingId=found.id;
   $("batchTitle").value=found.title_ar;
   if(!text("batchOriginal"))$("batchOriginal").value=found.title_original||"";
   if(!text("batchYear"))$("batchYear").value=found.release_year||"";
   if(!text("batchDescription"))$("batchDescription").value=found.description||"";
   if(!text("batchPosterUrl"))$("batchPosterUrl").value=found.poster_url||"";
   if(!text("batchBackdropUrl"))$("batchBackdropUrl").value=found.backdrop_url||"";
   if(!text("batchCountry"))$("batchCountry").value=found.country_code||"";
   if(!text("batchLanguage"))$("batchLanguage").value=found.language_code||"";
   if(found.category_id)$("batchCategory").value=found.category_id;
   if(!text("batchGenres"))$("batchGenres").value=(found.genre_tags||found.auto_tags||[]).join(", ");
   msg("المسلسل موجود بالفعل في المكتبة: ستُحدَّث بياناته وحلقاته دون إنشاء نسخة جديدة.","success");
 }
 function populateWork(){
   if(!batch)return;
   $("batchTitle").value=tidyTitle(batch.title)||"";
   $("batchOriginal").value=batch.title_original||"";
   $("batchYear").value=batch.release_year&&batch.release_year>=1880&&batch.release_year<=2100?batch.release_year:"";
   const description=batch.description||"";
   $("batchDescription").value=description;
   $("batchPosterUrl").value=https(batch.poster_url)||"";
   $("batchBackdropUrl").value=https(batch.backdrop_url||batch.poster_url)||"";
   let country=String(batch.country_code||"").toUpperCase();
   if(!country&&/(?:التركي|التركية|turkish|türk|çirkin)/i.test((batch.title||"")+" "+description))country="TR";
   $("batchCountry").value=country;
   $("batchLanguage").value=batch.language_code||"";
   const genres=(batch.genre_tags||[]).length?batch.genre_tags:guessGenres((batch.title||"")+" "+description);
   $("batchGenres").value=genres.join(", ");
   $("batchCategory").value=bestCategory(genres);
 }
 function metadata(){
   const year=Number(text("batchYear")),poster=text("batchPosterUrl"),backdrop=text("batchBackdropUrl");
   if(poster&&!https(poster))throw Error("رابط البوستر يجب أن يبدأ بـ HTTPS");
   if(backdrop&&!https(backdrop))throw Error("رابط الخلفية يجب أن يبدأ بـ HTTPS");
   if(text("batchYear")&&(!Number.isInteger(year)||year<1880||year>2100))throw Error("سنة الإصدار غير صحيحة");
   const genres=parseGenres(),title=(text("batchTitle")||batch?.title||"").slice(0,250);
   if(!title)throw Error("اسم المسلسل أو الفيلم مطلوب");
   return {title_ar:title,title_original:text("batchOriginal").slice(0,250)||null,
     description:text("batchDescription").slice(0,2000)||null,
     release_year:text("batchYear")?year:null,
     poster_url:https(poster)||null,backdrop_url:https(backdrop)||https(poster)||null,
     country_code:text("batchCountry")||null,language_code:text("batchLanguage")||null,
     category_id:text("batchCategory")||null,genre_tags:genres};
 }
 function previewBatch(){
  const panel=$("batchOverview");if(!panel)return;
  panel.hidden=!batch;if(!batch)return;
  const poster=$("batchPoster"),src=https(text("batchPosterUrl")||batch.poster_url||"");
  poster.hidden=!src;
  if(src&&poster.src!==src)poster.src=src;else if(!src)poster.removeAttribute("src");
  $("batchPreviewTitle").textContent=text("batchTitle")||batch.title||"عمل بلا عنوان";
  $("batchPreviewDescription").textContent=text("batchDescription")||batch.description||
     "لم يوفر المصدر وصفًا؛ يمكن إدخاله يدويًا.";
  const count=new Set(items.map(item=>item.season||1)).size;
  $("batchPreviewMeta").textContent=(text("batchOriginal")?text("batchOriginal")+" · ":"")+
     (text("batchYear")?text("batchYear")+" · ":"")+
     (text("batchCountry")?text("batchCountry")+" · ":"")+
     count+" موسم · "+items.length+" حلقة";
 }
 const status=()=>{previewBatch();const tested=items.filter(x=>x.result).length;$("countAll").textContent=items.length;$("countGood").textContent=items.filter(x=>x.result?.ok).length;$("countBad").textContent=items.filter(x=>x.result&&!x.result.ok).length;$("countSaved").textContent=saved;$("batchProgress").style.width=(items.length?Math.round(100*tested/items.length):0)+"%";$("batchDiscover").disabled=busy||!authenticated;$("batchVerify").disabled=busy||!items.length;$("batchCancel").disabled=!busy;$("batchSave").disabled=busy||!batch||!items.some(x=>x.checked!==false&&!x.saved&&(x.result?.ok||$("batchIncludeUnverified").checked));$("batchExport").disabled=!items.length;
  const tbody=$("batchRows");tbody.replaceChildren();
  if(!items.length){const t=document.createElement("tr"),c=document.createElement("td");c.colSpan=6;c.textContent="لم يتم اكتشاف عناصر";t.append(c);tbody.append(t);}
  for(const [i,x] of items.entries()){
   const tr=document.createElement("tr");if(x.result&&!x.result.ok)tr.className="failed";
   const td=document.createElement("td"),cb=document.createElement("input");cb.type="checkbox";cb.checked=x.checked!==false;cb.disabled=x.saved;cb.onchange=()=>x.checked=cb.checked;td.append(cb);tr.append(td);
   const t=document.createElement("td"),name=document.createElement("input");name.type="text";name.maxLength=250;name.className="batch-edit-title";
   name.setAttribute("aria-label","عنوان الحلقة "+(x.number||""));name.value=x.title||x.result?.title||"الحلقة "+(x.number||"");
   name.disabled=x.saved;name.addEventListener("change",()=>{x.title=name.value.trim();});t.append(name);tr.append(t);
   const s=document.createElement("td");s.textContent=batch?.type==="series"?"الموسم "+x.season+"، الحلقة "+x.number:"فيلم";tr.append(s);
   const l=document.createElement("td"),a=document.createElement("a");a.href=x.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="فتح الرابط";l.append(a);tr.append(l);
   const uCell=document.createElement("td"),u=document.createElement("input");
   u.type="url";u.className="batch-media-url";u.placeholder="https://…/episode.m3u8";
   u.setAttribute("aria-label","رابط تشغيل الحلقة "+(x.number||""));u.value=x.media_url||"";
   u.disabled=busy||x.saved;
   u.addEventListener("change",()=>{x.media_url=u.value.trim()||undefined;x.result=null;
     status();msg("تغير الرابط؛ اضغط «افحص روابط التشغيل» للتأكد من صلاحيته.");});
   uCell.append(u);tr.append(uCell);
   const c=document.createElement("td");
   c.textContent=x.saved?(x.savedMode==="published"?"✓ منشور":"✓ محفوظ كمسودة"):
     !x.result?"بانتظار الفحص":x.result.ok?"✓ جاهز: "+(x.result.checks?.find(v=>v.ok)?.format||"فيديو"):
     "معلومات فقط — "+(x.result.reason||x.result.error||"رابط غير متحقق");
   if(x.result&&!x.result.ok)tr.classList.add("is-metadata");
   tr.append(c);tbody.append(tr);
  }
 };
 async function discover(){
  if(busy||!authenticated)return;
  let url;try{url=new URL($("batchUrl").value.trim());if(url.protocol!=="https:")throw Error();}catch{return msg("أدخل رابط HTTPS صحيحًا","error");}
  busy=true;batch=null;items=[];saved=0;status();msg("يتم اكتشاف مواسم المسلسل وحلقاته...");
  try{batch=await edge({action:"discover",url:url.href,kind:$("batchKind").value});items=(batch.items||[]).map(x=>({...x,title:tidyTitle(x.title)||x.title,checked:true,saved:false}));populateWork();
     try{await discoverExisting();}catch(e){msg("تعذر مراجعة السجلات الموجودة: "+e.message,"error");}
     busy=false;status();msg("تم جلب بيانات المسلسل و"+items.length+" حلقة. يتم فحص التشغيل تلقائيًا...","success");
     if(items.length)await verify();else msg("تم جلب البيانات ولكن الصفحة لا تُظهر حلقات قابلة للاكتشاف؛ جرّب رابط المواسم أو مصدرًا آخر.","error");}
  catch(e){msg("فشل الاكتشاف: "+e.message,"error");}finally{busy=false;status();}
 }
 async function verify(){
  if(busy||!items.length)return;busy=true;stopped=false;status();msg("يتم فحص الاستجابة الفعلية لكل رابط...");
  let next=0;
  async function worker(){while(!stopped){const i=next++;if(i>=items.length)break;const it=items[i];if(it.result)continue;try{it.result=await edge({action:"inspect",url:it.url,media_url:it.media_url,title:it.title});}catch(e){it.result={ok:false,reason:e.message};}status();}}
  await Promise.all([worker(),worker(),worker()]);busy=false;status();msg("الفحص انتهى: "+items.filter(x=>x.result?.ok).length+" رابطًا سليمًا من أصل "+items.length+".",items.some(x=>x.result?.ok)?"success":"error");
 }
 async function first(table,qs){const x=await rest(table,qs+"&limit=1");return Array.isArray(x)?x[0]:null;}
 async function insert(table,data){const x=await rest(table,"",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(data)});if(!x?.[0]?.id)throw Error("لم يؤكد Supabase عملية الحفظ");return x[0];}
 async function patch(table,id,data){
  const result=await rest(table,"id="+eq(id),{method:"PATCH",
    headers:{Prefer:"return=representation"},body:JSON.stringify(data)});
  if(!Array.isArray(result)||!result.length)throw Error("لم يؤكّد Supabase تحديث السجل؛ تحقق من الصلاحيات");
  return result[0];
 }
 async function save(){
  if(busy||!batch)return;
  const includeDrafts=$("batchIncludeUnverified").checked;
  const todo=items.filter(x=>x.checked!==false&&!x.saved&&(x.result?.ok||includeDrafts));
  if(!todo.length)return msg("اختر حلقات للحفظ أو فعّل خيار حفظ بيانات الحلقات غير المؤكدة.","error");
  let meta;try{meta=metadata();}catch(e){return msg(e.message,"error");}
  const requested=$("batchPublish").checked,agreed=$("batchRights").checked;
  const holder=text("batchHolder"),license=text("batchLicense"),source=text("batchSource");
  const licenced=requested&&agreed&&holder.length>=3&&license.length>=4&&
    !/^(?:0+|1234|none|test|unknown|غير معروف|بدون)$/i.test(holder)&&
    !/^(?:0+|1234|none|test|unknown|غير معروف|بدون)$/i.test(license)&&sourceIds.has(source);
  if(requested&&!licenced)
   return msg("النشر يتطلب إذن عرض فعليًا وإثبات ترخيص صالحًا ومصدرًا معتمدًا؛ يمكنك إلغاء «النشر» وحفظ جميع البيانات كمسودات.","error");
  const verified=todo.filter(it=>it.result?.ok).length,unknown=todo.length-verified;
  const confirmText="حفظ "+todo.length+" عنصرًا: "+verified+" رابطًا متحققًا و"+unknown+
    " عنصر بيانات بلا تشغيل مؤكد. "+(licenced?"سيُنشر العمل والحلقات الصالحة؛ البقية مسودات.":"ستُحفظ العناصر الجديدة كمسودات دون نشر.")+
    " سيتم تحديث السجلات المطابقة دون تكرار. هل تتابع؟";
  if(!window.confirm(confirmText))return;
  busy=true;status();
  const publication=licenced?{status:"published",rights_status:"approved",rights_holder:holder,license_reference:license,source_id:source}:null;
  let created=0,updated=0,errors=[],series=null,duplicate=0,published=0,draftCount=0;
  const seasons=new Map();
  // Metadata is saved even if the source has not exposed a valid media URL.
  const metadataFields={title_ar:meta.title_ar,...meta};
  const safeMeta={...metadataFields};
  for(const key of Object.keys(safeMeta))if(safeMeta[key]===null||safeMeta[key]===""||(Array.isArray(safeMeta[key])&&!safeMeta[key].length))delete safeMeta[key];
  try{
   if(batch.type==="series"){
    series=batch.existingId?await first("aseel_series","select=id,title_ar,status,rights_status&id="+eq(batch.existingId)):
      await first("aseel_series","select=id,title_ar,status,rights_status&title_ar="+eq(meta.title_ar));
    if(series){
      await patch("aseel_series",series.id,{...safeMeta,...(publication||{})});updated++;
    }else{
      series=await insert("aseel_series",{...safeMeta,...(publication||{status:"draft",rights_status:"pending"}),
        ...(!publication&&source?{source_id:source}:{})});created++;
    }
   }
   for(const item of todo){
    if(stopped)break;
    try{
     const check=item.result?.ok?item.result:null;
     const url=check?https(check.stream_url):"";
     const playable=!!url;
     const itemStatus=publication&&playable?"published":"draft";
     const itemRights=publication&&playable?"approved":"pending";
     const itemDescription=(item.description||check?.description||meta.description||"").slice(0,1800);
     const itemPoster=https(item.poster_url||check?.poster_url||meta.poster_url)||null;
     const itemTitle=(item.title||check?.title||"الحلقة "+item.number).slice(0,250);
     if(batch.type==="movie"){
       const existing=await first("aseel_movies","select=id,status,rights_status&source_page_url="+eq(item.url));
       const data={...safeMeta,title_ar:(item.title||meta.title_ar).slice(0,250),
         source_page_url:item.url,...(url?{stream_url:url,stream_variants:check?.variants||[]}:{}),
         ...(!existing?{status:itemStatus,rights_status:itemRights}:{}),
         ...(publication&&playable?publication:{})};
       if(existing){await patch("aseel_movies",existing.id,data);updated++;}
       else{await insert("aseel_movies",data);created++;}
     }else{
       let season=seasons.get(Number(item.season));
       if(!season){
         season=await first("aseel_seasons","select=id&series_id="+eq(series.id)+"&number=eq."+Number(item.season));
         if(!season)season=await insert("aseel_seasons",{series_id:series.id,number:Number(item.season),title_ar:"الموسم "+Number(item.season)});
         seasons.set(Number(item.season),season);
       }
       const existing=await first("aseel_episodes","select=id,status,rights_status&season_id="+eq(season.id)+"&number=eq."+Number(item.number));
       const data={title_ar:itemTitle,...(itemDescription?{description:itemDescription}:{}),
         ...(itemPoster?{poster_url:itemPoster}:{}),
         ...(url?{stream_url:url,stream_variants:check?.variants||[]}:{}),
         ...(source?{source_id:source}:{})};
       if(existing){
         if(publication&&playable)Object.assign(data,{status:"published",rights_status:"approved",license_reference:license});
         await patch("aseel_episodes",existing.id,data);updated++;duplicate++;
       }else{
         await insert("aseel_episodes",{season_id:season.id,number:Number(item.number),...data,
           status:itemStatus,rights_status:itemRights,...(publication&&playable?{license_reference:license}:{})});
         created++;
       }
     }
     if(itemStatus==="published"){published++;item.savedMode="published";}
     else{draftCount++;item.savedMode="draft";}
     item.saved=true;saved++;status();
    }catch(e){errors.push("الحلقة "+item.number+": "+String(e.message||e).slice(0,160));}
   }
  }catch(e){errors.push("المسلسل: "+String(e.message||e).slice(0,170));}
  busy=false;status();
  msg("تم الحفظ: "+created+" جديد و"+updated+" محدّث (منها "+duplicate+" حلقة موجودة). "+
    "جاهز للنشر: "+published+"، محفوظ دون تشغيل مؤكد: "+draftCount+"، أخطاء: "+errors.length+
    (errors.length?" — "+errors.slice(0,2).join("؛ "):"")+
    (licenced?"":" · النشر العام لم يُفعّل بسبب عدم اعتماد الحقوق."),
    errors.length?"error":"success");
 }

 function csv(){const quote=x=>'"'+String(x??"").replace(/"/g,'""')+'"';const lines=[["title","season","episode","source_page","stream","working","saved","error"].map(quote).join(",")];for(const x of items)lines.push([x.result?.title||x.title,x.season,x.number,x.url,x.result?.stream_url||"",!!x.result?.ok,!!x.saved,x.result?.reason||""].map(quote).join(","));const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="al-ezz-import-check.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 ["batchTitle","batchOriginal","batchYear","batchCountry","batchDescription","batchPosterUrl","batchGenres"].forEach(id=>{
   $(id).addEventListener("input",previewBatch);
  });
  $("batchIncludeUnverified").addEventListener("change",status);
  $("batchGenres").addEventListener("change",()=>{if(!text("batchCategory"))$("batchCategory").value=bestCategory(parseGenres());});
  $("batchDiscover").onclick=discover;$("batchVerify").onclick=verify;$("batchSave").onclick=save;$("batchExport").onclick=csv;$("batchCancel").onclick=()=>{stopped=true;msg("سيُوقف الفحص بعد إكمال الطلبات الجارية.");};
 (async()=>{try{const sess=savedSession();if(!sess?.user_id)throw Error("سجل الدخول أولًا من صفحة الإدارة");const rs=await rest("aseel_admins","select=active&user_id="+eq(sess.user_id));if(!rs?.some(x=>x.active))throw Error("ليس لديك صلاحية إدارة نشطة");authenticated=true;const data=await rest("aseel_content_sources","select=id,title,verified,license_reference&verified=eq.true&limit=200");
    for(const source of data||[]){if(!source.license_reference)continue;sourceIds.add(source.id);
      const opt=document.createElement("option");opt.value=source.id;opt.textContent=source.title;$("batchSource").append(opt);}
    categoryOptions=await rest("aseel_categories","select=id,name_ar&published=eq.true&limit=500");
    for(const cat of categoryOptions||[]){const opt=document.createElement("option");opt.value=cat.id;opt.textContent=cat.name_ar;$("batchCategory").append(opt);}
    msg("تم التحقق من دخول المسؤول. الصق رابطًا للبدء.","success");}catch(e){msg("فشل فتح الاستيراد: "+e.message,"error");}status();})();
})();