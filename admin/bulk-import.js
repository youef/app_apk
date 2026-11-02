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
 
 function previewBatch(){
  const panel=$("batchOverview");if(!panel)return;
  panel.hidden=!batch;if(!batch)return;
  const poster=$("batchPoster"),src=batch.poster_url||"";
  poster.hidden=!(src.indexOf("https://")===0);
  if(!poster.hidden)poster.src=src;else poster.removeAttribute("src");
  $("batchPreviewTitle").textContent=batch.title||"مسلسل بلا عنوان";
  $("batchPreviewDescription").textContent=batch.description||"لا يوجد وصف في الصفحة؛ يمكن إضافته من لوحة الإدارة.";
  const count=new Set(items.map(item=>item.season||1)).size;
  $("batchPreviewMeta").textContent=(batch.title_original?batch.title_original+" · ":"")+
    (batch.release_year?batch.release_year+" · ":"")+count+" موسم · "+items.length+" حلقة";
 }
 const status=()=>{previewBatch();const tested=items.filter(x=>x.result).length;$("countAll").textContent=items.length;$("countGood").textContent=items.filter(x=>x.result?.ok).length;$("countBad").textContent=items.filter(x=>x.result&&!x.result.ok).length;$("countSaved").textContent=saved;$("batchProgress").style.width=(items.length?Math.round(100*tested/items.length):0)+"%";$("batchDiscover").disabled=busy||!authenticated;$("batchVerify").disabled=busy||!items.length;$("batchCancel").disabled=!busy;$("batchSave").disabled=busy||!items.some(x=>x.result?.ok&&!x.saved);$("batchExport").disabled=!items.length;
  const tbody=$("batchRows");tbody.replaceChildren();
  if(!items.length){const t=document.createElement("tr"),c=document.createElement("td");c.colSpan=6;c.textContent="لم يتم اكتشاف عناصر";t.append(c);tbody.append(t);}
  for(const [i,x] of items.entries()){
   const tr=document.createElement("tr");if(x.result&&!x.result.ok)tr.className="failed";
   const td=document.createElement("td"),cb=document.createElement("input");cb.type="checkbox";cb.checked=x.checked!==false;cb.disabled=!x.result?.ok||x.saved;cb.onchange=()=>x.checked=cb.checked;td.append(cb);tr.append(td);
   const t=document.createElement("td");t.textContent=x.result?.title||x.title||batch?.title||"غير معنون";tr.append(t);
   const s=document.createElement("td");s.textContent=batch?.type==="series"?"الموسم "+x.season+"، الحلقة "+x.number:"فيلم";tr.append(s);
   const l=document.createElement("td"),a=document.createElement("a");a.href=x.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="فتح الرابط";l.append(a);tr.append(l);
   const uCell=document.createElement("td"),u=document.createElement("input");
   u.type="url";u.className="batch-media-url";u.placeholder="https://…/episode.m3u8";
   u.setAttribute("aria-label","رابط تشغيل الحلقة "+(x.number||""));u.value=x.media_url||"";
   u.disabled=busy||x.saved;
   u.addEventListener("change",()=>{x.media_url=u.value.trim()||undefined;x.result=null;
     status();msg("تغير الرابط؛ اضغط «افحص روابط التشغيل» للتأكد من صلاحيته.");});
   uCell.append(u);tr.append(uCell);
   const c=document.createElement("td");c.textContent=x.saved?"✓ محفوظ":!x.result?"بانتظار الفحص":x.result.ok?"✓ مؤكد: "+(x.result.checks?.find(v=>v.ok)?.format||"صالح"):"✗ "+(x.result.reason||x.result.error||"رابط غير صالح");tr.append(c);tbody.append(tr);
  }
 };
 async function discover(){
  if(busy||!authenticated)return;
  let url;try{url=new URL($("batchUrl").value.trim());if(url.protocol!=="https:")throw Error();}catch{return msg("أدخل رابط HTTPS صحيحًا","error");}
  busy=true;batch=null;items=[];saved=0;status();msg("يتم اكتشاف مواسم المسلسل وحلقاته...");
  try{batch=await edge({action:"discover",url:url.href,kind:$("batchKind").value});items=(batch.items||[]).map(x=>({...x,checked:true,saved:false}));$("batchTitle").value=batch.title||"";
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
 async function save(){
  if(busy||!batch)return;
  const todo=items.filter(x=>x.checked!==false&&x.result?.ok&&!x.saved);if(!todo.length)return msg("لا يوجد محتوى سليم ومحدد للحفظ","error");
  const publish=$("batchPublish").checked,agreed=$("batchRights").checked,holder=$("batchHolder").value.trim(),license=$("batchLicense").value.trim(),source=$("batchSource").value;
  if(publish&&(!agreed||!holder||!license||!source))return msg("للنشر: أكد حق العرض وأدخل صاحب الحقوق، وثيقة الترخيص ومصدرًا معتمدًا","error");
  if(!window.confirm("اعتماد حفظ "+todo.length+" ملفًا تم فحصه؟"))return;
  busy=true;status();let created=0,duplicates=0,errors=[],parent=null;const seasons=new Map(),title=($("batchTitle").value.trim()||batch.title||"عمل جديد").slice(0,250);
  const fields={status:publish?"published":"draft",rights_status:publish?"approved":"pending",license_reference:license||null};
  try{
   if(batch.type==="series"){
    parent=await first("aseel_series","select=id&title_ar="+eq(title));
    if(!parent)parent=await insert("aseel_series",{title_ar:title,description:batch.description||null,poster_url:batch.poster_url||null,backdrop_url:batch.poster_url||null,rights_holder:holder||null,source_id:source||null,...fields});
   }
   for(const it of todo){
    try{
     const x=it.result;
     if(batch.type==="movie"){
      if(await first("aseel_movies","select=id&source_page_url="+eq(it.url))){duplicates++;it.saved=true;continue;}
      await insert("aseel_movies",{title_ar:(x.title||title).slice(0,250),description:x.description||batch.description||null,poster_url:x.poster_url||batch.poster_url||null,backdrop_url:x.poster_url||batch.poster_url||null,stream_url:x.stream_url,stream_variants:x.variants||[],source_page_url:it.url,source_id:source||null,rights_holder:holder||null,...fields});
     }else{
      let season=seasons.get(it.season);if(!season){season=await first("aseel_seasons","select=id&series_id="+eq(parent.id)+"&number=eq."+Number(it.season));if(!season)season=await insert("aseel_seasons",{series_id:parent.id,number:Number(it.season),title_ar:"الموسم "+it.season});seasons.set(it.season,season);}
      if(await first("aseel_episodes","select=id&season_id="+eq(season.id)+"&number=eq."+Number(it.number))){duplicates++;it.saved=true;continue;}
      await insert("aseel_episodes",{season_id:season.id,number:Number(it.number),title_ar:(it.title||x.title||"الحلقة "+it.number).slice(0,250),description:it.description||x.description||null,poster_url:it.poster_url||x.poster_url||batch.poster_url||null,stream_url:x.stream_url,stream_variants:x.variants||[],source_id:source||null,...fields});
     }
     saved++;created++;it.saved=true;status();
    }catch(e){errors.push(String(e.message||e).slice(0,170));}
   }
  }catch(e){errors.push("سجل المسلسل: "+e.message);}
  busy=false;status();msg("حُفظ "+created+"، مكرر "+duplicates+"، أخطاء "+errors.length+(errors.length?": "+errors.slice(0,2).join("؛ "):""),errors.length?"error":"success");
 }
 function csv(){const quote=x=>'"'+String(x??"").replace(/"/g,'""')+'"';const lines=[["title","season","episode","source_page","stream","working","saved","error"].map(quote).join(",")];for(const x of items)lines.push([x.result?.title||x.title,x.season,x.number,x.url,x.result?.stream_url||"",!!x.result?.ok,!!x.saved,x.result?.reason||""].map(quote).join(","));const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="al-ezz-import-check.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $("batchDiscover").onclick=discover;$("batchVerify").onclick=verify;$("batchSave").onclick=save;$("batchExport").onclick=csv;$("batchCancel").onclick=()=>{stopped=true;msg("سيُوقف الفحص بعد إكمال الطلبات الجارية.");};
 (async()=>{try{const sess=savedSession();if(!sess?.user_id)throw Error("سجل الدخول أولًا من صفحة الإدارة");const rs=await rest("aseel_admins","select=active&user_id="+eq(sess.user_id));if(!rs?.some(x=>x.active))throw Error("ليس لديك صلاحية إدارة نشطة");authenticated=true;const data=await rest("aseel_content_sources","select=id,title,verified,license_reference&verified=eq.true&limit=200");for(const source of data||[]){if(!source.license_reference)continue;const opt=document.createElement("option");opt.value=source.id;opt.textContent=source.title;$("batchSource").append(opt);}msg("تم التحقق من دخول المسؤول. الصق رابطًا للبدء.","success");}catch(e){msg("فشل فتح الاستيراد: "+e.message,"error");}status();})();
})();