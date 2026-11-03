/* AL EZZ TV — Quick Series Studio, administrator-authenticated atomic RPC. */
(function(){
"use strict";
var cfg=window.ALEZZ_ADMIN_CONFIG;
var $=function(id){return document.getElementById(id);};
var session=null, series=[], existingSeasons=[], existingEpisodeMax={}, groups=[], activeSeason=1, saving=false;
var savedEpisodes=[], savedSeriesId="", savedLoadVersion=0, checkingSaved=false, stopSavedChecking=false;
var urlPattern=/^https:\/\/[^\s]+\.(m3u8|mp4)(\?[^\s]*)?$/i;
var qualities=["AUTO","SD","HD","FHD","4K","480P","720P","1080P","2160P"];
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function message(text,error){
 var node=$("result");node.className="result"+(error?" error":"");node.textContent=text;
 if(error)node.scrollIntoView({behavior:"smooth",block:"center"});
}
function gateError(text){
 $("loading").classList.add("hidden");$("authError").classList.remove("hidden");
 $("authError").textContent=text+" — افتح لوحة الإدارة وسجّل الدخول ثم عُد لهذه الصفحة.";
}
function readSession(){
 try{var v=JSON.parse(localStorage.getItem(cfg.storagePrefix+"session")||"null");
 return v&&v.access_token&&v.refresh_token?v:null;}catch(e){return null;}
}
async function refresh(){
 if(!session||!session.refresh_token)return false;
 var res=await fetch(cfg.supabaseUrl+"/auth/v1/token?grant_type=refresh_token",{
 method:"POST",headers:{"apikey":cfg.publishableKey,"Content-Type":"application/json"},
 body:JSON.stringify({refresh_token:session.refresh_token})});
 if(!res.ok)return false;
 var data=await res.json();
 if(!data.access_token)return false;
 session=Object.assign({},session,{
 access_token:data.access_token,
 refresh_token:data.refresh_token||session.refresh_token,
 expires_at:Date.now()+(Number(data.expires_in)||3600)*1000
 });
 localStorage.setItem(cfg.storagePrefix+"session",JSON.stringify(session));
 return true;
}
async function rest(path,options,attempt){
 options=options||{};attempt=attempt||0;
 var res=await fetch(cfg.supabaseUrl+"/rest/v1/"+path,{
 method:options.method||"GET",
 cache:"no-store",
 headers:{"apikey":cfg.publishableKey,"Authorization":"Bearer "+session.access_token,
 "Content-Type":"application/json","Prefer":"return=representation"},
 body:options.body===undefined?undefined:JSON.stringify(options.body)});
 if(res.status===401&&attempt===0&&await refresh())return rest(path,options,1);
 var content=await res.text(),body=null;
 try{body=content?JSON.parse(content):null;}catch(e){body=content;}
 if(!res.ok)throw new Error((body&&body.message)||"HTTP "+res.status);
 return body;
}
async function verifyAdmin(){
 if(!session||!session.access_token)throw new Error("لم يتم العثور على جلسة");
 if(session.expires_at&&Date.now()>session.expires_at-60000 && !await refresh())
 throw new Error("انتهت الجلسة");
 var me=await fetch(cfg.supabaseUrl+"/auth/v1/user",{
 headers:{"apikey":cfg.publishableKey,"Authorization":"Bearer "+session.access_token}});
 if(!me.ok)throw new Error("سجّل الدخول من جديد");
 var user=await me.json();
 if(!user.id)throw new Error("حساب غير صالح");
 var list=await rest("aseel_admins?select=user_id,active&user_id=eq."+encodeURIComponent(user.id)+"&limit=1");
 if(!Array.isArray(list)||!list.some(function(a){return a.active&&a.user_id===user.id;}))
 throw new Error("الحساب لا يملك صلاحية الإدارة");
}
function findExistingSeries(title){
 var wanted=String(title||"").trim().toLowerCase();
 if(!wanted)return null;
 return series.filter(function(row){return String(row.title_ar||"").trim().toLowerCase()===wanted;})[0]||null;
}
function duplicateSuggestion(){
 var match=!$("seriesSelect").value&&findExistingSeries($("seriesTitle").value);
 var hint=$("duplicateHint");
 if(!hint)return match;
 hint.classList.toggle("hidden",!match);
 if(match)$("duplicateSeriesName").textContent=match.title_ar;
 return match;
}
function remapDrafts(drafts,knownMax){
 return drafts.map(function(g){
  var next=Number(knownMax[g.season])||0;
  var episodes=g.episodes.map(function(e){
   next++;
   if(next>300)throw new Error("الموسم "+g.season+" وصل إلى الحد الأقصى 300 حلقة. اختر موسمًا جديدًا أولًا.");
   return {number:next,url:e.url,quality:e.quality};
  });
  return {season:g.season,episodes:episodes};
 });
}

function groupBySeason(number){
 return groups.filter(function(g){return g.season===number;})[0]||null;
}
function nextEpisode(number){
 var g=groupBySeason(number),m=Number(existingEpisodeMax[number])||0;
 if(g)g.episodes.forEach(function(e){m=Math.max(m,e.number||0);});
 return m+1;
}
function startGroup(number){
 var g=groupBySeason(number);
 if(!g){
  g={season:number,episodes:[{number:nextEpisode(number),url:"",quality:"HD"}]};
  groups.push(g);
 }
 activeSeason=number;render();
}
function addEpisode(){
 var g=groupBySeason(activeSeason);
 if(!g){startGroup(activeSeason);return;}
 g.episodes.push({number:nextEpisode(activeSeason),url:"",quality:"HD"});render();
}
function addSeason(){
 var mx=0;
 groups.forEach(function(g){mx=Math.max(mx,g.season);});
 existingSeasons.forEach(function(se){mx=Math.max(mx,se.number);});
 if(mx>=50){message("الحد الأقصى 50 موسمًا.",true);return;}
 startGroup(mx+1);
}
function updateExistingSeasons(){
 var wrap=$("existingSeasonWrap"),list=$("existingSeasonSelect");
 if(!$("seriesSelect").value ||!existingSeasons.length){wrap.classList.add("hidden");return;}
 wrap.classList.remove("hidden");
 list.replaceChildren();
 existingSeasons.forEach(function(se){
 var opt=document.createElement("option");opt.value=String(se.number);
 opt.textContent="الموسم "+se.number+" — بعد الحلقة "+(existingEpisodeMax[se.number]||0);
 list.append(opt);
 });
 list.value=String(activeSeason);
}
function render(){
 var host=$("seasonGroups");host.replaceChildren();
 groups.sort(function(a,b){return a.season-b.season;});
 groups.forEach(function(g){
 var card=document.createElement("section");
 card.className="season";card.dataset.season=g.season;
 card.style.borderColor=g.season===activeSeason?"#e8c367":"#49516a";
 var rows=g.episodes.map(function(e,i){
 var qOptions=qualities.map(function(q){return '<option value="'+q+'"'+(e.quality===q?' selected':'')+'>'+esc(q)+'</option>';}).join("");
 return '<div class="episode" data-season="'+g.season+'" data-index="'+i+'">'+
 '<span class="episode-label">الحلقة '+e.number+'</span>'+
 '<label>رابط التشغيل<input data-field="url" type="url" value="'+esc(e.url)+'" placeholder="https://…/episode.m3u8" required></label>'+
 '<label>الجودة<select data-field="quality">'+qOptions+'</select></label>'+
 '<button class="danger" data-remove-episode="'+i+'" type="button" aria-label="حذف الحلقة '+e.number+'">حذف</button>'+
 '</div>';
 }).join("");
 card.innerHTML='<div class="season-head"><h3>الموسم '+g.season+'</h3>'+
 '<div class="actions"><button class="ghost" data-activate="'+g.season+'" type="button">'+
 (g.season===activeSeason?"الموسم الحالي":"إضافة حلقات هنا")+'</button>'+
 '<button class="danger" data-remove-season="'+g.season+'" type="button">إزالة من الدفعة</button></div></div>'+rows;
 host.append(card);
 });
 updateCounter();
 updateExistingSeasons();
}
function updateCounter(){
 var n=groups.reduce(function(total,g){return total+g.episodes.length;},0);
 $("counter").textContent=groups.length+" موسم في الدفعة • "+n+" حلقة";
}
async function loadSeries(){
 series=await rest("aseel_series?select=id,title_ar&order=title_ar.asc&limit=700");
 var select=$("seriesSelect"),selected=select.value;
 select.replaceChildren();
 var op=document.createElement("option");op.value="";op.textContent="+ مسلسل جديد";select.append(op);
 series.forEach(function(s){var o=document.createElement("option");o.value=s.id;o.textContent=s.title_ar;select.append(o);});
 select.value=selected&&series.some(function(s){return s.id===selected;})?selected:"";
 duplicateSuggestion();
}
async function loadExisting(preserveDraft){
 // Read the new season map before touching the form. A failed request must never lose pasted URLs.
 var drafts=preserveDraft?groups.map(function(g){
  return {season:g.season,episodes:g.episodes.filter(function(ep){return !!String(ep.url||"").trim();}).map(function(ep){
   return {url:ep.url,quality:ep.quality};
  })};
 }).filter(function(g){return g.episodes.length>0;}):[];
 var previousSeason=activeSeason;
 var id=$("seriesSelect").value;
 var loadedSeasons=[],loadedMax={};
 if(id){
  loadedSeasons=await rest("aseel_seasons?select=id,number&series_id=eq."+encodeURIComponent(id)+"&order=number.asc&limit=100");
  if(loadedSeasons.length){
   var ids=loadedSeasons.map(function(s){return s.id;});
   var episodes=await rest("aseel_episodes?select=season_id,number&season_id=in.("+ids.join(",")+")&limit=3000");
   loadedSeasons.forEach(function(se){loadedMax[se.number]=0;});
   episodes.forEach(function(ep){
    var season=loadedSeasons.filter(function(se){return se.id===ep.season_id;})[0];
    if(season)loadedMax[season.number]=Math.max(loadedMax[season.number]||0,Number(ep.number)||0);
   });
  }
 }
 // Explicitly append after existing numbers: never overwrite an existing episode by changing series.
 var shifted=drafts.length?remapDrafts(drafts,loadedMax):[];
 existingSeasons=loadedSeasons;existingEpisodeMax=loadedMax;groups=[];
 activeSeason=id&&loadedSeasons.length?loadedSeasons[loadedSeasons.length-1].number:1;
 if(shifted.length){
  groups=shifted;
  activeSeason=groupBySeason(previousSeason)?previousSeason:groups[0].season;
  render();
  message("تم اختيار المسلسل الموجود مع الاحتفاظ بـ "+shifted.reduce(function(n,g){return n+g.episodes.length;},0)+
   " رابط حلقة وإعادة ترقيمها بعد آخر حلقة محفوظة. راجع الأرقام ثم اضغط «حفظ ونشر الكل».");
 }else startGroup(activeSeason);
 $("seriesTitleWrap").classList.toggle("hidden",!!id);
 $("seriesTitle").disabled=!!id;
 $("seriesHint").textContent=id?
  "أضف إلى موسم موجود أو أنشئ موسمًا جديدًا. تُرقّم الحلقات الجديدة بعد الحلقات المحفوظة لحمايتها من الاستبدال.":
  "اكتب اسم مسلسل جديد، ثم ألصق روابط الحلقات. لا تحتاج إلى تعبئة وصف أو صور أو أرقام حلقات.";
 duplicateSuggestion();
 updateExistingSeasons();
 try{await loadSavedEpisodes(id);}catch(loadError){$("savedSummary").textContent="تعذر تحميل الحلقات المحفوظة: "+loadError.message;}
}

function savedById(id){
 return savedEpisodes.filter(function(e){return e.id===id;})[0]||null;
}
function savedSeasonNumber(seasonId){
 var found=existingSeasons.filter(function(se){return se.id===seasonId;})[0];
 return found?found.number:0;
}
function savedQuality(row){
 var variants=Array.isArray(row.stream_variants)?row.stream_variants:[];
 var match=variants.filter(function(v){return v&&v.url===row.stream_url;})[0];
 return match&&qualities.indexOf(String(match.label).toUpperCase())>=0?String(match.label).toUpperCase():"AUTO";
}
function hasSavedEdits(){
 return savedEpisodes.some(function(e){return JSON.stringify(e._draft)!==JSON.stringify(e._saved);});
}
function resetSavedMax(){
 existingSeasons.forEach(function(se){existingEpisodeMax[se.number]=0;});
 savedEpisodes.forEach(function(ep){
  var season=savedSeasonNumber(ep.season_id);
  if(season)existingEpisodeMax[season]=Math.max(existingEpisodeMax[season]||0,Number(ep._saved.number)||0);
 });
 updateExistingSeasons();
}
function editSavedField(ev){
 var input=ev.target,field=input.dataset.savedField;
 if(!field)return;
 var card=input.closest("[data-saved-id]"),episode=card&&savedById(card.dataset.savedId);
 if(!episode)return;
 if(field==="number")episode._draft.number=Number(input.value);
 else episode._draft[field]=input.value;
 card.classList.toggle("unsaved",JSON.stringify(episode._draft)!==JSON.stringify(episode._saved));
}
async function loadSavedEpisodes(id){
 var token=++savedLoadVersion,panel=$("savedEpisodesPanel");
 if(!id){
  savedEpisodes=[];savedSeriesId="";panel.classList.add("hidden");
  return;
 }
 panel.classList.remove("hidden");savedSeriesId=id;
 $("savedSummary").textContent="جارٍ تحميل جميع الحلقات المحفوظة…";
 var previousFilter=$("savedSeasonFilter").value;
 var previousSeries=panel.dataset.seriesId;
 var pages=[],offset=0;
 var ids=existingSeasons.map(function(se){return se.id;});
 if(ids.length){
  while(true){
   var part=await rest("aseel_episodes?select=id,season_id,number,title_ar,stream_url,status,stream_variants,link_health_status,link_health_reason,link_health_checked_at,link_health_failures&season_id=in.("+
    ids.join(",")+")&order=number.asc&limit=1000&offset="+offset);
   if(token!==savedLoadVersion || $("seriesSelect").value!==id)return;
   if(!Array.isArray(part))throw new Error("البيانات المسترجعة للحلقات غير صحيحة");
   pages=pages.concat(part);offset+=part.length;
   if(part.length<1000)break;
   if(offset>=15000)throw new Error("عدد الحلقات كبير جدًا؛ يلزم تقسيم الاستعلام");
  }
 }
 if(token!==savedLoadVersion || $("seriesSelect").value!==id)return;
 savedEpisodes=pages.map(function(e){
  var quality=savedQuality(e);
  e._saved={title_ar:e.title_ar||"",number:Number(e.number),stream_url:e.stream_url||"",status:e.status||"draft",quality:quality};
  e._draft=Object.assign({},e._saved);
  return e;
 }).sort(function(a,b){return savedSeasonNumber(a.season_id)-savedSeasonNumber(b.season_id)||a.number-b.number;});
 var filter=$("savedSeasonFilter");filter.replaceChildren();
 var all=document.createElement("option");all.value="";all.textContent="كل المواسم";filter.append(all);
 existingSeasons.forEach(function(se){
  var o=document.createElement("option");o.value=String(se.number);o.textContent="الموسم "+se.number;filter.append(o);
 });
 filter.value=previousSeries===id?previousFilter:"";
 panel.dataset.seriesId=id;
 if(previousSeries!==id)$("savedSearch").value="";
 resetSavedMax();renderSavedEpisodes();
}
function healthLabel(value){
 return {healthy:"يستجيب",suspect:"غير مؤكد",broken:"معطوب",unchecked:"لم يُفحص"}[value]||"لم يُفحص";
}
function renderSavedEpisodes(){
 var host=$("savedEpisodeList"),filter=Number($("savedSeasonFilter").value)||0;
 var search=$("savedSearch").value.trim().toLowerCase();
 var list=savedEpisodes.filter(function(ep){
  var se=savedSeasonNumber(ep.season_id);
  return (!filter||filter===se)&&(!search||String(ep._draft.number).includes(search)||
   String(ep._draft.title_ar).toLowerCase().includes(search)||String(se).includes(search));
 });
 var healthy=savedEpisodes.filter(function(e){return e.link_health_status==="healthy";}).length;
 var broken=savedEpisodes.filter(function(e){return e.link_health_status==="broken";}).length;
 var uncertain=savedEpisodes.filter(function(e){return e.link_health_status==="suspect";}).length;
 $("savedSummary").textContent="إجمالي "+savedEpisodes.length+" حلقة • المعروض "+list.length+
  " • يستجيب "+healthy+" • معطوب "+broken+" • غير مؤكد "+uncertain+
  " • لم يُفحص "+(savedEpisodes.length-healthy-broken-uncertain);
 if(!list.length){
  host.innerHTML='<p class="note">لا توجد حلقات محفوظة تطابق الاختيار. يمكنك إضافة الحلقات من القسم السابق.</p>';
  return;
 }
 host.innerHTML=list.map(function(ep){
  var number=savedSeasonNumber(ep.season_id),d=ep._draft;
  var condition=["healthy","broken","suspect"].indexOf(ep.link_health_status)>=0?ep.link_health_status:"unchecked";
  var options=qualities.map(function(q){return '<option value="'+q+'"'+(q===d.quality?' selected':'')+'>'+q+'</option>';}).join("");
  var statusOptions=[["published","منشورة"],["draft","مسودة"],["hidden","مخفية"]].map(function(pair){
   return '<option value="'+pair[0]+'"'+(d.status===pair[0]?' selected':'')+'>'+pair[1]+'</option>';
  }).join("");
  var modified=JSON.stringify(d)!==JSON.stringify(ep._saved);
  var checked=ep.link_health_checked_at?new Date(ep.link_health_checked_at).toLocaleString("ar-SA"):"لم يتم الفحص";
  return '<article class="saved-episode'+(modified?' unsaved':'')+'" data-saved-id="'+esc(ep.id)+'">'+
   '<div class="saved-episode-head"><strong>الموسم '+number+' — الحلقة '+esc(d.number)+'</strong>'+
   '<span class="health '+condition+'">'+healthLabel(condition)+'</span></div>'+
   '<div class="saved-fields">'+
   '<label>رقم الحلقة<input type="number" min="1" max="300" data-saved-field="number" value="'+esc(d.number)+'"></label>'+
   '<label>اسم الحلقة<input type="text" maxlength="250" data-saved-field="title_ar" value="'+esc(d.title_ar)+'"></label>'+
   '<label class="saved-url">رابط التشغيل<input type="url" dir="ltr" data-saved-field="stream_url" value="'+esc(d.stream_url)+'" placeholder="https://…/episode.m3u8"></label>'+
   '<label>الجودة<select data-saved-field="quality">'+options+'</select></label>'+
   '<label>الحالة<select data-saved-field="status">'+statusOptions+'</select></label></div>'+
   '<div class="saved-episode-bottom"><div class="actions">'+
   '<button type="button" class="primary" data-saved-action="save" data-id="'+esc(ep.id)+'">حفظ التعديل</button>'+
   '<button type="button" class="ghost" data-saved-action="check" data-id="'+esc(ep.id)+'">فحص الرابط</button>'+
   '<button type="button" class="danger" data-saved-action="delete" data-id="'+esc(ep.id)+'">حذف الحلقة</button>'+
   '</div><small class="health-detail">'+esc(ep._checkError||ep.link_health_reason||"حالة الرابط لم تُحسم بعد")+
   ' • '+esc(checked)+'</small></div></article>';
 }).join("");
}
function savedBusy(button,busy,label){
 if(!button)return;
 if(busy){button.dataset.oldText=button.textContent;button.disabled=true;button.textContent=label||"جارٍ التنفيذ…";}
 else {button.disabled=false;button.textContent=button.dataset.oldText||button.textContent;}
}
async function saveSavedEpisode(id,button){
 var ep=savedById(id);if(!ep)return;
 var d=ep._draft,previous=ep._saved,season=savedSeasonNumber(ep.season_id);
 if(!Number.isInteger(d.number)||d.number<1||d.number>300){message("رقم الحلقة يجب أن يكون بين 1 و300.",true);return;}
 if(!String(d.title_ar).trim()){message("اسم الحلقة لا يمكن أن يكون فارغًا.",true);return;}
 if(d.stream_url!==previous.stream_url&&!urlPattern.test(String(d.stream_url).trim())){
  message("أدخل رابط HTTPS مباشر بصيغة MP4 أو m3u8.",true);return;
 }
 if(savedEpisodes.some(function(e){return e.id!==id&&e.season_id===ep.season_id&&e._saved.number===d.number})){
  message("رقم الحلقة "+d.number+" موجود مسبقًا في الموسم "+season+".",true);return;
 }
 var payload={number:d.number,title_ar:String(d.title_ar).trim().slice(0,250),
  stream_url:String(d.stream_url).trim()||null,status:d.status};
 if(d.quality!==previous.quality||d.stream_url!==previous.stream_url){
  var oldVariants=Array.isArray(ep.stream_variants)?ep.stream_variants:[];
  var variants=oldVariants.map(function(v){return Object.assign({},v);});
  variants.forEach(function(v){if(v.url===previous.stream_url)v.url=d.stream_url;});
  if(d.quality!==previous.quality&&d.stream_url){
   var index=variants.findIndex(function(v){return v.url===d.stream_url;});
   if(index>=0)variants[index].label=d.quality;
   else if(variants.length<8)variants.unshift({label:d.quality,url:d.stream_url});
   else {message("يوجد 8 جودات بالفعل؛ احذف جودة بديلة من لوحة الإدارة أولًا.",true);return;}
  }
  if(variants.length<=8)payload.stream_variants=variants;
 }
 savedBusy(button,true,"جارٍ الحفظ…");
 try{
  var result=await rest("aseel_episodes?id=eq."+encodeURIComponent(ep.id)+"&season_id=eq."+encodeURIComponent(ep.season_id),{
   method:"PATCH",body:payload
  });
  if(!Array.isArray(result)||result.length!==1)throw new Error("لم يتم تأكيد تعديل الحلقة؛ تحقق من الصلاحيات.");
  var saved=result[0];
  ep.number=saved.number;ep.title_ar=saved.title_ar;ep.stream_url=saved.stream_url;ep.status=saved.status;
  ep.stream_variants=saved.stream_variants;
  ep.link_health_status=saved.link_health_status;
  ep.link_health_reason=saved.link_health_reason;
  ep.link_health_checked_at=saved.link_health_checked_at;
  ep._saved={title_ar:saved.title_ar||"",number:Number(saved.number),stream_url:saved.stream_url||"",status:saved.status,quality:savedQuality(saved)};
  ep._draft=Object.assign({},ep._saved);
  ep._checkError="";
  resetSavedMax();renderSavedEpisodes();
  message("تم حفظ تعديل الموسم "+season+" الحلقة "+saved.number+" بنجاح.");
 }catch(err){
  message(/duplicate|23505/i.test(err.message)?"رقم هذه الحلقة مستخدم بالفعل في الموسم.":err.message,true);
 }finally{savedBusy(button,false);}
}
async function deleteSavedEpisode(id,button){
 var ep=savedById(id);if(!ep)return;
 var season=savedSeasonNumber(ep.season_id);
 if(!confirm("حذف الحلقة "+ep._saved.number+" من الموسم "+season+" نهائيًا من قاعدة البيانات؟ لا يمكن التراجع."))return;
 savedBusy(button,true,"جارٍ الحذف…");
 try{
  var removed=await rest("aseel_episodes?id=eq."+encodeURIComponent(id)+"&season_id=eq."+encodeURIComponent(ep.season_id),{method:"DELETE"});
  if(!Array.isArray(removed)||removed.length!==1)throw new Error("لم يتم تأكيد الحذف.");
  savedEpisodes=savedEpisodes.filter(function(e){return e.id!==id;});
  resetSavedMax();renderSavedEpisodes();
  message("تم حذف الموسم "+season+" الحلقة "+ep._saved.number+" من قاعدة البيانات.");
 }catch(err){message("تعذّر حذف الحلقة: "+err.message,true);}
 finally{savedBusy(button,false);}
}
async function serverCheckSaved(ids,attempt){
 var response=await fetch(cfg.supabaseUrl+"/functions/v1/aseel-link-health",{
  method:"POST",cache:"no-store",
  headers:{"apikey":cfg.publishableKey,"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json"},
  body:JSON.stringify({mode:"episodes",episode_ids:ids})
 });
 if(response.status===401&&!attempt&&await refresh())return serverCheckSaved(ids,1);
 var data=await response.json().catch(function(){return {};});
 if(!response.ok)throw new Error(data.error||"فشل الاتصال بخادم فحص الروابط: HTTP "+response.status);
 if(!Array.isArray(data.results))throw new Error("لم يرجع الخادم نتائج فحص للحلقات.");
 data.results.forEach(function(update){
  var ep=savedById(update.id);if(!ep)return;
  ep.link_health_status=update.link_health_status;
  ep.link_health_reason=update.link_health_reason;
  ep.link_health_checked_at=update.link_health_checked_at;
  ep.link_health_failures=update.link_health_failures;
  ep._checkError=data.errors&&data.errors[update.id]||"";
 });
 if(data.errors)Object.keys(data.errors).forEach(function(id){
  var ep=savedById(id);if(ep)ep._checkError=data.errors[id];
 });
 return data;
}
async function checkOneSavedEpisode(id,button){
 var ep=savedById(id);if(!ep)return;
 if(ep._draft.stream_url!==ep._saved.stream_url){
  message("احفظ رابط الحلقة المعدّل أولًا حتى يتم فحص النسخة الصحيحة في قاعدة البيانات.",true);return;
 }
 savedBusy(button,true,"جارٍ الفحص…");
 try{await serverCheckSaved([id]);renderSavedEpisodes();
  message("انتهى فحص رابط الحلقة "+ep._saved.number+": "+healthLabel(ep.link_health_status)+". راجع السبب في بطاقتها.");
 }catch(err){message("تعذّر فحص الرابط: "+err.message,true);}
 finally{savedBusy(button,false);}
}
async function checkAllSavedEpisodes(){
 if(checkingSaved||!savedEpisodes.length)return;
 if(hasSavedEdits()&&!confirm("سيتم فحص الروابط المحفوظة حاليًا؛ هناك تعديلات لم تحفظ. متابعة؟"))return;
 checkingSaved=true;stopSavedChecking=false;
 var selected=savedSeriesId,ids=savedEpisodes.map(function(e){return e.id;}),completed=0,failed=0;
 var button=$("checkSavedAll");button.disabled=true;
 $("stopSavedCheck").classList.remove("hidden");
 try{
  for(var i=0;i<ids.length;i+=12){
   if(stopSavedChecking||savedSeriesId!==selected)break;
   var part=ids.slice(i,i+12);
   button.textContent="جارٍ فحص "+completed+" / "+ids.length;
   try{await serverCheckSaved(part);}catch(err){
    failed+=part.length;
    part.forEach(function(id){var ep=savedById(id);if(ep)ep._checkError=err.message;});
   }
   completed+=part.length;
   if(savedSeriesId===selected)renderSavedEpisodes();
  }
  if(savedSeriesId===selected)message("انتهى فحص "+completed+" من "+ids.length+" حلقة."+
   (failed?" تعذّر فحص "+failed+" حلقة؛ يمكن إعادة المحاولة.":"")+
   (stopSavedChecking?" تم إيقاف بقية الفحص.":""));
 }finally{
  checkingSaved=false;stopSavedChecking=false;button.disabled=false;button.textContent="فحص جميع الحلقات";
  $("stopSavedCheck").classList.add("hidden");
 }
}

function wire(){
 $("seriesSelect").addEventListener("change",function(){
  if(hasSavedEdits()&&!confirm("لديك تعديلات على الحلقات لم تحفظ. هل تريد الانتقال وإهمالها؟")){
   this.value=savedSeriesId;return;
  }
  loadExisting(true).catch(function(e){message(e.message,true);});
 });
 $("seriesTitle").addEventListener("input",duplicateSuggestion);
 $("useExistingSeries").addEventListener("click",function(){
  var match=findExistingSeries($("seriesTitle").value);
  if(!match){message("لم يعد هذا المسلسل في القائمة. أعد تحميل القائمة أو ابحث باسمه.",true);return;}
  $("seriesSelect").value=match.id;
  loadExisting(true).catch(function(e){message(e.message,true);});
 });
 $("existingSeasonSelect").addEventListener("change",function(){
  var n=Number(this.value);
  if(n>0)startGroup(n);
 });
 $("addSeason").addEventListener("click",addSeason);
 $("addEpisode").addEventListener("click",addEpisode);
 $("seasonGroups").addEventListener("input",function(ev){
  var row=ev.target.closest(".episode");if(!row)return;
  var g=groupBySeason(Number(row.dataset.season)),e=g&&g.episodes[Number(row.dataset.index)];
  if(e&&ev.target.dataset.field)e[ev.target.dataset.field]=ev.target.value;
 });
 $("seasonGroups").addEventListener("change",function(ev){
  var row=ev.target.closest(".episode");if(!row)return;
  var g=groupBySeason(Number(row.dataset.season)),e=g&&g.episodes[Number(row.dataset.index)];
  if(e&&ev.target.dataset.field)e[ev.target.dataset.field]=ev.target.value;
 });
 $("seasonGroups").addEventListener("click",function(ev){
  var btn=ev.target.closest("button");if(!btn)return;
  var n=btn.dataset.activate,rem=btn.dataset.removeSeason,idx=btn.dataset.removeEpisode;
  if(n){activeSeason=Number(n);render();return;}
  if(rem){groups=groups.filter(function(g){return g.season!==Number(rem);});
   if(!groups.length)startGroup(Number(rem));else{activeSeason=groups[groups.length-1].season;render();}
   return;
  }
  if(idx!==undefined){
   var card=btn.closest(".season"),g=groupBySeason(Number(card.dataset.season));
   if(g){g.episodes.splice(Number(idx),1);if(!g.episodes.length){g.episodes.push({number:nextEpisode(g.season),url:"",quality:"HD"});}
    render();}
  }
 });
 $("addBulk").addEventListener("click",function(){
  var input=$("bulkLinks").value.trim();
  if(!input){message("الصق روابط الحلقات أولًا.",true);return;}
  var lines=input.split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean);
  if(lines.length>150){message("الحد الأقصى 150 حلقة للدفعة.",true);return;}
  var group=groupBySeason(activeSeason);
  if(!group){startGroup(activeSeason);group=groupBySeason(activeSeason);}
  if(group.episodes.length===1&&!group.episodes[0].url)group.episodes=[];
  var standard=$("bulkQuality").value;
  for(var i=0;i<lines.length;i++){
   var pair=lines[i].split("|"),url=pair[0].trim(),qual=(pair[1]||standard).trim().toUpperCase();
   if(!urlPattern.test(url)||qualities.indexOf(qual)<0){message("السطر "+(i+1)+" يحتوي على رابط أو جودة غير صالحة.",true);return;}
   group.episodes.push({number:nextEpisode(activeSeason),url:url,quality:qual});
  }
  $("bulkLinks").value="";$("result").textContent="";render();
 });
 $("savedSeasonFilter").addEventListener("change",renderSavedEpisodes);
 $("savedSearch").addEventListener("input",renderSavedEpisodes);
 $("reloadSaved").addEventListener("click",function(){
  if(hasSavedEdits()&&!confirm("هناك تعديلات غير محفوظة على الحلقات. هل تريد إعادة التحميل وفقدها؟"))return;
  loadSavedEpisodes($("seriesSelect").value).catch(function(e){message(e.message,true);});
 });
 $("checkSavedAll").addEventListener("click",checkAllSavedEpisodes);
 $("stopSavedCheck").addEventListener("click",function(){stopSavedChecking=true;});
 $("savedEpisodeList").addEventListener("input",editSavedField);
 $("savedEpisodeList").addEventListener("change",editSavedField);
 $("savedEpisodeList").addEventListener("click",function(ev){
  var button=ev.target.closest("button[data-saved-action]");if(!button)return;
  var action=button.dataset.savedAction,id=button.dataset.id;
  if(action==="save")saveSavedEpisode(id,button);
  if(action==="delete")deleteSavedEpisode(id,button);
  if(action==="check")checkOneSavedEpisode(id,button);
 });
 $("save").addEventListener("click",saveAll);
}
async function saveAll(){
 if(saving)return;
 var selected=$("seriesSelect").value, title=$("seriesTitle").value.trim();
 if(!selected && title.length<2){message("اكتب اسم المسلسل (حرفان على الأقل).",true);return;}
 if(!selected && duplicateSuggestion()){
  message("هذا المسلسل موجود بالفعل في قاعدة البيانات. اضغط «استخدام المسلسل الموجود» بالأعلى؛ ستبقى كل الروابط وسيتم ترقيم الحلقات التالية تلقائيًا.",true);
  return;
 }
 var data=[],duplicates={};
 for(var i=0;i<groups.length;i++){
  var g=groups[i];
  for(var j=0;j<g.episodes.length;j++){
   var e=g.episodes[j],url=String(e.url||"").trim();
   if(!urlPattern.test(url)){message("أدخل رابط HTTPS بصيغة MP4 أو HLS للموسم "+g.season+" الحلقة "+e.number+".",true);return;}
   if(e.number<1||e.number>300||g.season<1||g.season>50){
    message("رقم الحلقة أو الموسم خارج المجال المسموح. الحد 300 حلقة لكل موسم.",true);return;
   }
   if(duplicates[g.season+":"+e.number]){message("هناك رقم حلقة مكرر في الموسم "+g.season+".",true);return;}
   duplicates[g.season+":"+e.number]=true;
   data.push({season:g.season,number:e.number,url:url,quality:e.quality});
  }
 }
 if(!data.length||data.length>150){message("أضف بين 1 و150 حلقة في الدفعة.",true);return;}
 saving=true;$("save").disabled=true;$("save").textContent="جارٍ حفظ الكل…";
 $("result").textContent="";
 try{
  var result=await rest("rpc/aseel_quick_publish_series",{method:"POST",body:{
   p_series_id:selected||null,p_title:selected?null:title,p_episodes:data,p_poster_url:null
  }});
  if(!result||!result.series_id)throw new Error("لم تصل نتيجة مؤكدة من قاعدة البيانات.");
  message("تم الحفظ والنشر: "+result.episodes_added+" حلقة جديدة، "+result.episodes_updated+
   " محدّثة، "+result.seasons_added+" مواسم جديدة. جميع العلاقات محفوظة.");
  await loadSeries();$("seriesSelect").value=result.series_id;
  $("seriesTitle").value="";$("bulkLinks").value="";
  await loadExisting();
 }catch(e){
  if(!selected && /SERIES_EXISTS_SELECT_FROM_LIST/.test(String(e.message||""))){
   try{await loadSeries();}catch(refreshError){}
   duplicateSuggestion();
   message("اسم المسلسل موجود مسبقًا. اختر «استخدام المسلسل الموجود» في أعلى الصفحة، ثم راجع الحلقات الجديدة واحفظها دون فقدان روابطك.",true);
  }else message(e.message||"تعذر الحفظ، لم تُعتمد الدفعة.",true);
 }
 finally{saving=false;$("save").disabled=false;$("save").textContent="حفظ ونشر الكل";}
}
async function boot(){
 session=readSession();
 if(!session){gateError("يجب تسجيل الدخول كمسؤول");return;}
 try{
  await verifyAdmin();
  await loadSeries();
  var id=new URLSearchParams(location.search).get("series");
  if(id&&series.some(function(s){return s.id===id;}))$("seriesSelect").value=id;
  wire();
  await loadExisting();
  $("loading").classList.add("hidden");$("studio").classList.remove("hidden");
 }catch(e){gateError(e.message||"فشل التحقق");}
}
boot();
})();