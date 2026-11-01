"use strict";
/* Al Ezz TV: authenticated browser importer. Uses existing Supabase Auth + RLS.
   No service-role credentials, no piracy bypass, no unapproved automatic publishing. */
(function(){
 const $=id=>document.getElementById(id);
 const cfg=window.ASEEL_CONFIG;
 let currentId=null,playbackOK=false,playbackUrl="",hls=null,found=[],saved=[],busy=false;
 const F={
  title_ar:"impTitle",title_original:"impOriginal",description:"impDescription",poster_url:"impPoster",
  backdrop_url:"impBackdrop",release_year:"impYear",duration_minutes:"impDuration",category_id:"impCategory",
  source_id:"impSource",age_rating:"impAge",quality:"impQuality",language_code:"impLanguage",
  country_code:"impCountry",display_order:"impOrder",is_kids:"impKids",featured:"impFeatured",
  stream_url:"impStream",youtube_url:"impYouTube",stream_variants:"impVariants",source_page_url:"impSourcePage",
  rights_status:"impRights",rights_holder:"impHolder",license_reference:"impLicense",rights_expires_at:"impExpires"
 };
 const vals=()=>Object.fromEntries(Object.entries(F).map(([key,id])=>[key,$(id).type==="checkbox"?$(id).checked:$(id).value.trim()]));
 const msg=(text,isError=false)=>{const el=$("impMessage");el.textContent=text;el.classList.toggle("error",isError)};
 const status=text=>$("impTestStatus").textContent=text;
 const val=(key,value)=>{const e=$(F[key]);if(!e)return;if(e.type==="checkbox")e.checked=Boolean(value);else e.value=value??"";};
 const urlOk=(value)=>{try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password;}catch{return false}};
 const direct=(url)=>{try{const u=new URL(url);return u.protocol==="https:"&&/\.(?:m3u8|mp4)$/i.test(u.pathname);}catch{return false}};
 const youtubeId=(value)=>{try{
   const u=new URL(value);if(u.protocol!=="https:"||!["youtube.com","www.youtube.com","m.youtube.com","youtu.be"].includes(u.hostname))return "";
   let id="";const p=u.pathname.split("/").filter(Boolean);
   if(u.hostname==="youtu.be"&&p.length===1)id=p[0];
   else if(u.pathname==="/watch")id=u.searchParams.get("v")||"";
   else if(["shorts","embed","live"].includes(p[0])&&p.length===2)id=p[1];
   return /^[A-Za-z0-9_-]{11}$/.test(id)?id:"";
  }catch{return ""}};
 const errorsFor=(payload)=>{
  const errors=[];
  if(!payload.title_ar)errors.push("العنوان العربي مطلوب");
  if(payload.country_code&&!/^[A-Z]{2}$/.test(payload.country_code))errors.push("رمز الدولة يجب أن يكون حرفين");
  if(payload.language_code&&!/^[a-z]{2,3}$/.test(payload.language_code))errors.push("رمز اللغة غير صحيح");
  for(const key of ["poster_url","backdrop_url","stream_url","youtube_url","source_page_url"])if(payload[key]&&!urlOk(payload[key]))errors.push("رابط HTTPS غير صالح: "+key);
  if(payload.stream_url&&!direct(payload.stream_url))errors.push("رابط التشغيل يجب أن يكون MP4 أو M3U8 مباشرًا");
  if(payload.youtube_url&&!youtubeId(payload.youtube_url))errors.push("رابط يوتيوب غير صالح");
  if(payload.stream_variants.length>8||payload.stream_variants.some(x=>!x||!x.label||typeof x.label!=="string"||x.label.length>24||!direct(x.url)))errors.push("الجودات الإضافية: حتى 8 عناصر MP4/HLS مع label وurl");

  return errors;
 };
 function payload(){
  const p=vals();
  p.title_ar=p.title_ar.slice(0,250);
  p.country_code=p.country_code?p.country_code.toUpperCase():null;
  p.language_code=p.language_code?p.language_code.toLowerCase():"ar";
  for(const k of ["source_id","category_id","poster_url","backdrop_url","stream_url","youtube_url","source_page_url","rights_holder","license_reference","title_original","description"])p[k]=p[k]||null;
  for(const k of ["release_year","duration_minutes"])p[k]=p[k]?Number(p[k]):null;
  p.display_order=p.display_order?Number(p.display_order):0;
  try{p.stream_variants=JSON.parse(p.stream_variants||"[]");}catch{throw Error("الجودات الإضافية JSON غير صالح");}
  if(!Array.isArray(p.stream_variants))throw Error("الجودات الإضافية يجب أن تكون مصفوفة");
  p.age_rating=p.age_rating||"all";p.quality=p.quality||"SD";
  if(p.youtube_url)p.youtube_url="https://www.youtube.com/watch?v="+youtubeId(p.youtube_url);
  p.rights_expires_at=p.rights_expires_at?new Date(p.rights_expires_at+"T23:59:59").toISOString():null;
  const errors=errorsFor(p);if(errors.length)throw Error(errors.join("، "));
  return p;
 }
 function apply(row){
   for(const [key,id] of Object.entries(F)){
     let value=row?.[key];
     if(key==="stream_variants")value=JSON.stringify(value||[],null,2);
     if(key==="rights_expires_at"&&value)value=String(value).slice(0,10);
     if(value===undefined||value===null)value=key==="language_code"?"ar":key==="age_rating"?"all":key==="quality"?"SD":key==="rights_status"?"pending":key==="display_order"?0:"";
     val(key,value);
   }
   currentId=row?.id||null;
   $("impEditing").textContent=currentId?"تعديل سجل محفوظ":"إضافة جديدة";
   $("impRightsConfirmed").checked=false;$("impPlaybackConfirmed").checked=false;
   clearPlayer();updatePreview();
 }
 function clearPlayer(){
   if(hls){try{hls.destroy()}catch{}hls=null}
   const player=$("impPlayer");const video=player.querySelector("video");if(video){try{video.pause()}catch{}}
   player.replaceChildren();const d=document.createElement("div");d.className="imp-player-placeholder";d.textContent="▶ اختبر التشغيل قبل النشر";player.append(d);
   playbackOK=false;playbackUrl="";status("لم يبدأ اختبار التشغيل.");
 }
 function updatePreview(){
   const v=vals();$("impPreviewTitle").textContent=v.title_ar||"عنوان الفيلم";
   $("impPreviewDescription").textContent=v.description||"سيظهر وصف الفيلم هنا عند إدخاله.";
   const p=$("impPreviewPoster");p.replaceChildren();
   if(v.poster_url&&urlOk(v.poster_url)){
     const img=document.createElement("img");img.src=v.poster_url;img.alt="معاينة البوستر";img.onerror=()=>{p.replaceChildren();const t=document.createElement("span");t.textContent="AL EZZ";p.append(t);};p.append(img);
   }else{const t=document.createElement("span");t.textContent="AL EZZ";p.append(t)}
   $("impPreviewMeta").textContent=[v.release_year||"السنة غير محددة",v.quality||"SD",v.age_rating==="all"?"للجميع":v.age_rating,v.is_kids?"أطفال":"",currentId?"تحرير محتوى":"معاينة غير منشورة"].filter(Boolean).join(" • ");
   if(playbackUrl && playbackUrl!==(v.stream_url||v.youtube_url))clearPlayer();
 }
 async function options(){
   const [c,so]=await Promise.all([
      request("aseel_categories?select=id,name_ar&order=sort_order.asc&limit=200"),
      request("aseel_content_sources?select=id,title,verified&order=title.asc&limit=200")
   ]);
   function fill(id,arr,placeholder,labelKey){
    const list=$(id),old=list.value;list.replaceChildren();
    const a=document.createElement("option");a.value="";a.textContent=placeholder;list.append(a);
    for(const row of arr||[]){const op=document.createElement("option");op.value=row.id;op.textContent=row[labelKey]+(id==="impSource"?(row.verified?" ✓":" · قيد المراجعة"):"");list.append(op)}
    if([...list.options].some(x=>x.value===old))list.value=old;
   }
   fill("impCategory",c,"بدون تصنيف","name_ar");fill("impSource",so,"غير محدد","title");
 }
 function mediaCandidates(html,url){
   const doc=new DOMParser().parseFromString(html,"text/html");
   const getMeta=(x)=>doc.querySelector('meta[property="'+x+'"],meta[name="'+x+'"]')?.getAttribute("content")||"";
   const abs=(v)=>{try{const x=new URL(v,url||location.href);return x.protocol==="https:"?x.href:""}catch{return ""}};
   const ret={
     title_ar:getMeta("og:title")||doc.title||"",
     description:getMeta("og:description")||getMeta("description")||"",
     poster_url:abs(getMeta("og:image")||getMeta("twitter:image")),
     backdrop_url:abs(getMeta("og:image")),source_page_url:url||null,
     links:[]
   };
   const seen=new Set();
   for(const n of doc.querySelectorAll("iframe[src],source[src],video[src],a[href]")){
     const link=abs(n.getAttribute("src")||n.getAttribute("href"));if(!link||seen.has(link))continue;
     const kind=n.tagName==="IFRAME"?"embed":/\.(mp4|m3u8|mpd)(?:$|[?#])/i.test(link)?"media":null;
     if(kind){ret.links.push({kind,url:link});seen.add(link)}
     if(ret.links.length>=35)break;
   }
   return ret;
 }
 function applyScan(data){
   for(const key of ["title_ar","title_original","description","poster_url","backdrop_url","release_year","duration_minutes","source_page_url"]){
     if(data[key]!==undefined&&data[key]!==null&&data[key]!=="")val(key,data[key]);
   }
   found=Array.isArray(data.links)?data.links.slice(0,40):[];
   const first=found.find(x=>x.kind==="media"&&direct(x.url));if(first&&!$("impStream").value)val("stream_url",first.url);
   renderLinks();updatePreview();
 }
 function renderLinks(){
   const box=$("impLinks");box.replaceChildren();
   if(!found.length){box.textContent="لم يُعثر على رابط فيديو مباشر ظاهر في HTML. يمكن إدخاله يدويًا، أو استعراض المشغّلات المتاحة.";return}
   const h=document.createElement("strong");h.textContent="الروابط المكتشفة ("+found.length+")";box.append(h);
   for(const item of found){
     const row=document.createElement("div");row.className="imp-link";
     const u=document.createElement("code");u.textContent=item.url;row.append(u);
     const b=document.createElement("button");b.type="button";b.textContent=direct(item.url)?"اختيار للتشغيل":"فحص الصفحة";b.onclick=()=>{
       if(direct(item.url)){val("stream_url",item.url);updatePreview();msg("تم تعيين رابط التشغيل. اختبره أولًا");}
       else{$("impUrl").value=item.url;msg("يتم فحص صفحة المشغّل المرتبطة...");scan();}
     };row.append(b);box.append(row);
   }
 }
 function setScanState(active,label){
   $("impScanProgress").hidden=!active;
   $("impScanStep").textContent=label||"جارٍ الفحص...";
   $("impScan").disabled=active;
   $("impHealth").disabled=active;
   $("impScan").textContent=active?"جارٍ جلب البيانات...":"فحص الصفحة";
 }
 function diagnostics(text,err=false){
   const node=$("impDiagnostics");node.textContent=text;
   node.classList.toggle("error",Boolean(err));
 }
 async function callInspector(data){
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),24000);
   try{
     const res=await fetch(cfg.url+"/functions/v1/aseel-inspect-media",{
       method:"POST",
       headers:{"Content-Type":"application/json","apikey":cfg.publishableKey,"Authorization":"Bearer "+jwt},
       body:JSON.stringify(data),signal:controller.signal,cache:"no-store"
     });
     const raw=await res.text();let result;
     try{result=JSON.parse(raw);}catch{throw Error("رد خادم غير صالح (HTTP "+res.status+").");}
     if(!res.ok){
       const error=new Error(result.error||"فشل الفحص (HTTP "+res.status+")");
       error.code=result.error_code||String(res.status);
       error.diagnostics=result.diagnostics;
       throw error;
     }
     return result;
   }catch(e){
     if(e.name==="AbortError")throw Error("انتهت مهلة الجلب خلال 24 ثانية. تأكد من أن المصدر يسمح بالاتصال الخارجي.");
     throw e;
   }finally{clearTimeout(timeout);}
 }
 async function health(){
   if(!jwt){msg("سجّل الدخول بصلاحيات الإدارة أولًا",true);return;}
   if(busy)return;busy=true;setScanState(true,"التحقق من صلاحية الحساب والخادم...");
   diagnostics("يتم اختبار Supabase Auth وصلاحية المسؤول وخدمة استخراج البيانات.");
   try{
     const r=await callInspector({mode:"selftest"});
     if(!r.data?.title_ar)throw Error("الخادم أعاد نتائج فارغة");
     diagnostics("✓ الاتصال يعمل — تحقق المسؤول ناجح — جلب JSON يعمل — تم تحليل صفحة تجريبية داخليًا.");
     msg("نجح اختبار اتصال الخادم. الآن الصق رابط فيلم واضغط «فحص الصفحة» لجلب بياناته الحقيقية.");
   }catch(e){diagnostics("✗ فشل اختبار الاتصال: "+e.message,true);msg(e.message,true);}
   finally{busy=false;setScanState(false);}
 }
 async function scan(){
   if(!jwt){msg("سجّل دخول المسؤول أولًا",true);return;}
   const url=$("impUrl").value.trim();
   if(!urlOk(url)){msg("ألصق رابط صفحة HTTPS صحيحًا أولًا",true);return;}
   if(busy)return;
   busy=true;setScanState(true,"جارٍ جلب صفحة المصدر...");
   diagnostics("الاتصال جارٍ: "+new URL(url).hostname+" — قد تمنع بعض المواقع الفحص الآلي.");
   $("impLinks").textContent="جارٍ فحص بيانات HTML والروابط الظاهرة...";
   msg("جارٍ جلب صفحة المصدر عبر خادم Supabase...");
   try{
     const data=await callInspector({url});
     applyScan(data.data||{});
     const d=data.diagnostics||{};
     const count=Array.isArray(data.data?.links)?data.data.links.length:0;
     diagnostics("✓ HTTP "+(d.http_status||200)+" — حجم HTML: "+(d.html_bytes||0)+" بايت — التحويلات: "+(d.redirects||0)+" — الروابط المكتشفة: "+count+".");
     msg("تم الجلب الحقيقي من الموقع. راجع البيانات، ثم اختر رابط فيديو مباشر واختبره قبل الحفظ.");
     if(!data.data?.title_ar&&count===0)msg("اتصلنا بالصفحة لكن لا توجد بيانات مرئية قابلة للاستخراج. قد يحمل المشغل بياناته عبر JavaScript.");
   }catch(e){
     diagnostics("✗ فشل الجلب — "+(e.code||"ERROR")+": "+e.message,true);
     msg("فشل جلب المصدر: "+e.message+" — يمكنك إدخال البيانات أو لصق HTML المسموح لك به.",true);
     $("impLinks").textContent="لا توجد نتائج جديدة. الفحص لم ينجح.";
   }finally{busy=false;setScanState(false);}
 }
 async function listSaved(){
   if(!jwt)return;
   const data=await request("aseel_movies?select=id,title_ar,status,rights_status,stream_url,youtube_url,source_page_url,updated_at&order=updated_at.desc&limit=200");
   saved=data||[];renderSaved();
 }
 function renderSaved(){
   const q=$("impSearch").value.trim().toLowerCase();
   const entries=saved.filter(x=>(x.title_ar+" "+(x.source_page_url||"")).toLowerCase().includes(q));
   const box=$("impSaved");box.replaceChildren();$("impCount").textContent=entries.length+" سجل";
   for(const row of entries){
    const div=document.createElement("div");div.className="imp-saved-row";
    const head=document.createElement("div");head.className="imp-saved-title";
    const title=document.createElement("strong");title.textContent=row.title_ar;
    const sub=document.createElement("small");sub.textContent=(row.status==="published"?"منشور":row.status==="hidden"?"مخفي":"مسودة")+" • "+(row.rights_status==="approved"?"حقوق معتمدة":"مراجعة الحقوق");
    head.append(title,sub);div.append(head);
    const edit=document.createElement("button");edit.type="button";edit.textContent="تعديل";edit.onclick=()=>loadSaved(row.id);
    div.append(edit);box.append(div);
   }
   if(!entries.length)box.textContent="لا يوجد فيلم مطابق.";
 }
 async function loadSaved(id){
   try{
     const rows=await request("aseel_movies?select=*&id=eq."+encodeURIComponent(id)+"&limit=1");
     if(!rows?.length)throw Error("الفيلم غير موجود أو لا تملك صلاحية قراءته");
     apply(rows[0]);msg("تم فتح السجل. يمكنك التعديل أو الإخفاء أو النشر.");$("importStudio").scrollIntoView({behavior:"smooth",block:"start"});
   }catch(e){msg(e.message,true)}
 }
 async function ensureHls(){
   if(window.Hls)return true;
   return new Promise(resolve=>{
     const script=document.createElement("script");
     script.src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
     let done=false;
     const finish=ok=>{if(done)return;done=true;resolve(ok);};
     script.onload=()=>finish(Boolean(window.Hls));script.onerror=()=>finish(false);
     document.head.append(script);
     setTimeout(()=>finish(Boolean(window.Hls)),10000);
   });
 }
 async function testPlayback(){
   clearPlayer();
   const stream=$("impStream").value.trim(),youtube=$("impYouTube").value.trim();
   const target=stream||youtube;playbackUrl=target;
   const box=$("impPlayer");box.replaceChildren();
   if(stream&&!direct(stream)){status("الرابط ليس ملف MP4 أو قائمة HLS ظاهرة.");return}
   if(!stream&&youtubeId(youtube)){
     const iframe=document.createElement("iframe");iframe.src="../web/youtube-player.html?v="+encodeURIComponent(youtubeId(youtube));
     iframe.allow="autoplay; encrypted-media; picture-in-picture";iframe.allowFullscreen=true;iframe.title="معاينة يوتيوب الرسمية";box.append(iframe);
     status("مشغّل يوتيوب مفتوح. تأكد من أن المقطع يعمل فعليًا؛ ظهور الإطار ليس إثباتًا للتشغيل. استخدم مربع التأكيد اليدوي للنشر.");return;
   }
   if(!stream){status("لم تُدخل رابط فيديو صالحًا.");return}
   const video=document.createElement("video");video.controls=true;video.playsInline=true;video.preload="metadata";box.append(video);
   const mark=()=>{playbackOK=true;status("نجح اختبار التشغيل الأولي داخل هذا المتصفح. قد يختلف دعم الأجهزة.");};
   video.addEventListener("canplay",mark,{once:true});
   video.addEventListener("error",()=>status("تعذر تشغيل الرابط في المتصفح الحالي؛ تحقق من الصلاحية أو النوع أو CORS."),{once:true});
   if(/\.m3u8(?:[?#]|$)/i.test(stream)){
     if(video.canPlayType("application/vnd.apple.mpegurl"))video.src=stream;
     else if((await ensureHls())&&window.Hls?.isSupported()){
       hls=new window.Hls({enableWorker:true});
       hls.loadSource(stream);hls.attachMedia(video);
       hls.on(window.Hls.Events.ERROR,(_,data)=>{if(data.fatal)status("فشل اختبار HLS: "+data.details);});
     }else status("تعذر تحميل مشغل HLS أو المتصفح لا يدعمه. جرب ملف MP4 أو متصفحًا آخر.");
   }else video.src=stream;
   video.load();
   const promise=video.play();if(promise?.catch)promise.catch(()=>{status("شغّل الفيديو من الزر داخل المشغّل للتحقق من التشغيل.");});
 }
 async function save(mode){
   if(!jwt)return msg("يجب تسجيل دخول مسؤول معتمد",true);
   if(busy)return;
   let p;try{p=payload();}catch(e){return msg(e.message,true);}
   if(mode==="published"){
      if(p.rights_status!=="approved"||!p.license_reference||!p.rights_holder)return msg("لنشر الفيلم: اعتمد الحقوق، وأدخل صاحب الحقوق ووثيقة الترخيص.",true);
      if(!$("impRightsConfirmed").checked)return msg("أكّد أن لديك حق عرض الفيلم قبل نشره.",true);
      if(!p.stream_url&&!p.youtube_url)return msg("يلزم رابط MP4/HLS أو يوتيوب رسمي قبل النشر.",true);
      if(p.rights_expires_at&&new Date(p.rights_expires_at)<=new Date())return msg("لا يمكن نشر فيلم انتهت رخصته. يمكن حفظه كمسودة أو إخفاؤه.",true);
      if(!playbackOK&&!$("impPlaybackConfirmed").checked)return msg("اختبر التشغيل أو أكّد الاختبار اليدوي قبل النشر.",true);
      if(!window.confirm("هل تؤكد نشر هذا الفيلم للجمهور بعد التحقق من الترخيص والتشغيل؟"))return;
   }
   p.status=mode;p.imported_at=new Date().toISOString();
   busy=true;$("impDraft").disabled=true;$("impPublish").disabled=true;
   try{
     // The existing database unique index also prevents duplicate source_page_url races.
     if(!currentId&&p.source_page_url){
       const existing=await request("aseel_movies?select=id,title_ar&source_page_url=eq."+encodeURIComponent(p.source_page_url)+"&limit=1");
       if(existing?.length){
         if(!confirm("هذا الرابط مستورد مسبقًا باسم «"+existing[0].title_ar+"». هل تريد تحديث السجل بدل إنشاء نسخة ثانية؟"))return;
         currentId=existing[0].id;
       }
     }
     const path="aseel_movies"+(currentId?"?id=eq."+encodeURIComponent(currentId):"");
     const result=await request(path,{method:currentId?"PATCH":"POST",headers:{"content-type":"application/json","Prefer":"return=representation"},body:JSON.stringify(p)});
     if(!Array.isArray(result)||result.length!==1)throw Error("لم تؤكد القاعدة حفظ سجل واحد. تحقق من الصلاحيات وأعد تحميل القائمة.");
     currentId=result[0].id;
     $("impEditing").textContent="تحرير سجل محفوظ";
     msg(mode==="published"?"تم النشر في Supabase. قد يظهر الفيلم بعد تحديث الموقع.":"تم حفظ الفيلم كمسودة في Supabase؛ لن يظهر للجمهور.");
     await listSaved();updatePreview();
   }catch(e){msg("فشل الحفظ: "+e.message,true)}
   finally{busy=false;$("impDraft").disabled=false;$("impPublish").disabled=false}
 }
 function reset(){apply(null);$("impUrl").value="";$("impHtml").value="";found=[];$("impLinks").replaceChildren();msg("نموذج جديد جاهز.")}
 function copy(){
    let data;try{data=payload();}catch(e){msg(e.message,true);return;}
    const s=JSON.stringify({...data,status:"draft"},null,2);
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(s).then(()=>msg("تم نسخ JSON إلى الحافظة.")).catch(()=>fallbackCopy(s));
    else fallbackCopy(s);
 }
 function fallbackCopy(s){const e=document.createElement("textarea");e.value=s;document.body.append(e);e.select();document.execCommand("copy");e.remove();msg("تم نسخ البيانات.");}
 function launch(){
   if(!jwt)return show("سجل الدخول بصلاحيات الإدارة أولًا",true);
   $("importStudio").hidden=false;$("impToggle").textContent="إخفاء الاستوديو";
   if(location.hash!=="#studio-import")history.replaceState(null,"",location.pathname+location.search+"#studio-import");
   options().then(listSaved).catch(e=>msg("تعذر تحميل بعض خيارات قاعدة البيانات: "+e.message,true));
   $("importStudio").scrollIntoView({behavior:"smooth",block:"start"});
 }
 function init(){
   $("impToggle").addEventListener("click",()=>{$("importStudio").hidden?launch():$("impClose").click();});
   $("impClose").onclick=()=>{$("importStudio").hidden=true;$("impToggle").textContent="فتح الاستوديو";clearPlayer();if(location.hash==="#studio-import")history.replaceState(null,"",location.pathname+location.search);};
   $("impForm").addEventListener("submit",e=>e.preventDefault());
   $("impForm").addEventListener("input",updatePreview);
   $("impScan").onclick=scan;
   $("impHealth").onclick=health;
   $("impDemo").onclick=()=>{
     reset();
     apply({title_ar:"زهرة — نموذج فيديو تجريبي",title_original:"Flower (CC0 Sample)",
       description:"فيديو قصير للتجربة والمعاينة قبل النشر. لا تتم إضافته إلى القاعدة تلقائيًا.",
       stream_url:"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
       language_code:"und",quality:"HD",rights_status:"pending",
       featured:false,is_kids:false,stream_variants:[],display_order:0
     });
     msg("نموذج تجريبي جاهز. اضغط اختبار التشغيل، ثم راجع المعاينة. لن ينشر أي شيء تلقائيًا.");
   };
   $("impParseHtml").onclick=()=>{const html=$("impHtml").value.trim();if(!html)return msg("ألصق مصدر HTML أولًا.",true);
     const url=$("impUrl").value.trim();applyScan(mediaCandidates(html,urlOk(url)?url:""));msg("استُخرجت البيانات من HTML الملصق. يجب مراجعتها يدويًا.");
   };
   $("impTest").onclick=testPlayback;$("impRefreshPreview").onclick=updatePreview;
   $("impDraft").onclick=()=>save("draft");$("impPublish").onclick=()=>save("published");
   $("impHide").onclick=()=>{if(!currentId)return msg("احفظ الفيلم أولًا ثم يمكنك إخفاؤه.",true);save("hidden")};
   $("impCopy").onclick=copy;$("impReload").onclick=()=>listSaved().catch(e=>msg(e.message,true));
   $("impSearch").oninput=renderSaved;
   $("impReset").onclick=reset;
   $("impDuplicate").onclick=()=>{currentId=null;val("source_page_url","");val("rights_status","pending");$("impRightsConfirmed").checked=false;$("impEditing").textContent="نسخة جديدة غير محفوظة";msg("نسخة جديدة جاهزة. اختر رابط مصدر مختلفًا لتجنب التكرار.");updatePreview();};
   $("impOpenStream").onclick=()=>{const v=vals();const link=v.stream_url||v.youtube_url||v.source_page_url;if(!link||!urlOk(link))return msg("لا يوجد رابط HTTPS لفتحه",true);window.open(link,"_blank","noopener,noreferrer")};
   document.getElementById("logout")?.addEventListener("click",()=>{$("importStudio").hidden=true;clearPlayer();saved=[];found=[];currentId=null;});
   apply(null);
   if(location.hash==="#studio-import"){
     const panel=$("panel");
     const maybeOpen=()=>{if(!panel.classList.contains("hidden")&&jwt){observer.disconnect();launch();}};
     const observer=new MutationObserver(maybeOpen);
     observer.observe(panel,{attributes:true,attributeFilter:["class"]});
     maybeOpen();
   }
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
