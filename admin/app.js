"use strict";
const cfg=window.ASEEL_CONFIG;
const api=cfg.url+"/rest/v1/";
const tables={
 aseel_movies:{label:"الأفلام",fields:["title_ar","title_original","description","poster_url","backdrop_url","release_year","category_id","duration_minutes","language_code","quality","stream_url","status","rights_status","rights_holder","license_reference","rights_expires_at","featured"]},
 aseel_series:{label:"المسلسلات",fields:["title_ar","title_original","description","poster_url","backdrop_url","release_year","category_id","language_code","quality","status","rights_status","rights_holder","license_reference","rights_expires_at","featured"]},
 aseel_seasons:{label:"المواسم",fields:["series_id","number","title_ar"]},
 aseel_episodes:{label:"الحلقات",fields:["season_id","number","title_ar","description","poster_url","duration_minutes","stream_url","status","rights_status","license_reference","rights_expires_at"]},
 aseel_channels:{label:"القنوات",fields:["title_ar","description","poster_url","stream_url","category_id","status","rights_status","rights_holder","license_reference","rights_expires_at"]},
 aseel_categories:{label:"التصنيفات",fields:["name_ar","sort_order","published"]},
 aseel_content_sources:{label:"مصادر الحقوق",fields:["title","source_url","rights_contact","license_reference","verified"]},
 aseel_settings:{label:"إعدادات التطبيق",fields:["key","value","is_public"]}
};
const names={title_ar:"العنوان العربي",title_original:"العنوان الأصلي",description:"الوصف",poster_url:"رابط البوستر HTTPS",backdrop_url:"رابط الخلفية",release_year:"سنة الإنتاج",category_id:"التصنيف",duration_minutes:"المدة بالدقائق",language_code:"اللغة",quality:"الجودة",stream_url:"رابط تشغيل HTTPS",status:"النشر",rights_status:"حالة الترخيص",rights_holder:"صاحب الحقوق",license_reference:"رابط أو رقم وثيقة الترخيص",rights_expires_at:"نهاية صلاحية الترخيص",featured:"مميز",series_id:"المسلسل",season_id:"الموسم",number:"الترتيب",name_ar:"اسم التصنيف",sort_order:"الترتيب",published:"منشور",title:"العنوان",source_url:"رابط المصدر",rights_contact:"التواصل مع صاحب الحقوق",verified:"تم التحقق",key:"مفتاح الإعداد",value:"قيمة الإعداد بصيغة JSON",is_public:"إعداد عام"};
const $=id=>document.getElementById(id);
let jwt="",userId="",table="aseel_movies",editing=null,rows=[],cats=[],shows=[],seasons=[];
let timeout;
function show(message,error=false){const n=$("status");n.textContent=message;n.className="visible"+(error?" error":"");clearTimeout(timeout);timeout=setTimeout(()=>{n.className="";},7000)}
function headers(extra={}){return Object.assign({"apikey":cfg.publishableKey,"Authorization":"Bearer "+jwt},extra)}
async function request(path,options={}){
 const response=await fetch(path.startsWith("https://")?path:api+path,Object.assign({},options,{headers:headers(options.headers||{})}));
 const body=await response.text();
 if(!response.ok){let error=body;try{const data=JSON.parse(body);error=data.message||data.error_description||error;}catch(_){}
   throw new Error(String(error).slice(0,350));}
 if(!body)return null;
 try{return JSON.parse(body)}catch(_){return body}
}
function safe(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setLogged(yes){
 $("auth").classList.toggle("hidden",yes);$("panel").classList.toggle("hidden",!yes);
 $("logout").classList.toggle("hidden",!yes);
 $("userLabel").textContent=yes?"مسؤول معتمد":"";
}
$("loginForm").addEventListener("submit",async ev=>{
 ev.preventDefault();
 const email=$("email").value.trim(),password=$("password").value;
 try {
  const res=await fetch(cfg.url+"/auth/v1/token?grant_type=password",{
    method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.publishableKey},
    body:JSON.stringify({email,password})
  });
  const result=await res.json();
  if(!res.ok||!result.access_token)throw Error(result.error_description||result.msg||"فشل تسجيل الدخول");
  jwt=result.access_token;userId=result.user?.id||"";
  if(!userId)throw Error("تعذر التحقق من هوية الحساب");
  const allowed=await request("aseel_admins?select=user_id,active&user_id=eq."+encodeURIComponent(userId));
  if(!allowed?.some(r=>r.user_id===userId&&r.active))throw Error("هذا الحساب لا يحمل صلاحية إدارة أسيل");
  $("password").value="";
  setLogged(true);await setup();
  show("تم تسجيل الدخول بصلاحيات الإدارة");
 }catch(error){jwt="";userId="";setLogged(false);show(error.message,true);}
});
$("logout").onclick=()=>{jwt="";userId="";editing=null;rows=[];setLogged(false);show("تم تسجيل الخروج")};
async function setup(){
 $("tabs").replaceChildren();
 for(const [name,definition] of Object.entries(tables)){
   const b=document.createElement("button");
   b.type="button";b.className="tab";b.textContent=definition.label;
   b.onclick=()=>selectTable(name);
   $("tabs").append(b);
 }
 await Promise.all([loadOptions(),selectTable(table)]);
}
async function loadOptions(){
 try{
  const [a,b,c]=await Promise.all([
   request("aseel_categories?select=id,name_ar&order=sort_order.asc"),
   request("aseel_series?select=id,title_ar&order=title_ar.asc"),
   request("aseel_seasons?select=id,number,series_id&order=number.asc")
  ]);cats=a||[];shows=b||[];seasons=c||[];
 }catch(e){show("تعذر تحميل بعض الخيارات: "+e.message,true)}
}
async function selectTable(name){
 table=name;editing=null;$("editor").classList.add("hidden");
 Array.from($("tabs").children).forEach((button,i)=>button.classList.toggle("active",Object.keys(tables)[i]===table));
 $("collectionName").textContent=tables[table].label;
 try{
  rows=await request(table+"?select=*&order="+(table==="aseel_categories"?"sort_order.asc":table==="aseel_settings"?"key.asc":"created_at.desc")+"&limit=100")||[];
  renderRows();
 }catch(e){rows=[];renderRows();show("تعذر جلب البيانات: "+e.message,true)}
}
function renderRows(){
 const target=$("rows");target.replaceChildren();
 if(rows.length===0){target.innerHTML='<tr><td colspan="4">لا يوجد محتوى في هذا القسم.</td></tr>';return}
 for(const row of rows){
  const tr=document.createElement("tr");
  const title=document.createElement("td");title.textContent=row.title_ar||row.name_ar||row.title||row.key||("رقم "+(row.number??"—"));
  const status=document.createElement("td");
  const tag=document.createElement("span");tag.className="tag"+(row.status==="published"?" ok":"");
  tag.textContent=row.status||((row.published||row.verified)?"معتمد":"—");status.append(tag);
  const rights=document.createElement("td");rights.textContent=row.rights_status||row.license_reference||"—";
  const act=document.createElement("td");act.className="row-actions";
  const edit=document.createElement("button");edit.textContent="تعديل";edit.onclick=()=>openEditor(row);
  const del=document.createElement("button");del.textContent="حذف";del.onclick=()=>remove(row);
  act.append(edit,del);tr.append(title,status,rights,act);target.append(tr);
 }
}
function optionList(key){
 if(key==="status")return [["draft","مسودة"],["published","منشور"],["hidden","مخفي"]];
 if(key==="rights_status")return [["pending","قيد المراجعة"],["approved","تم التحقق من الحقوق"],["rejected","مرفوض"]];
 if(key==="quality")return [["SD","SD"],["HD","HD"],["FHD","FHD"],["4K","4K"]];
 if(key==="category_id")return [["","بدون تصنيف"],...cats.map(x=>[x.id,x.name_ar])];
 if(key==="series_id")return [["","اختر مسلسلًا"],...shows.map(x=>[x.id,x.title_ar])];
 if(key==="season_id")return [["","اختر موسمًا"],...seasons.map(x=>[x.id,"الموسم "+x.number+" — "+(shows.find(s=>s.id===x.series_id)?.title_ar||"")])];
 return null;
}
function openEditor(row=null){
 editing=row;$("editor").classList.remove("hidden");
 $("editorTitle").textContent=(row?"تعديل ":"إضافة ")+tables[table].label;
 const target=$("fields");target.replaceChildren();
 for(const key of tables[table].fields){
  const label=document.createElement("label");label.textContent=names[key]||key;
  if(["description","value"].includes(key))label.className="wide";
  let control;
  const choices=optionList(key);
  if(choices){control=document.createElement("select");for(const [value,caption] of choices){const option=document.createElement("option");option.value=value;option.textContent=caption;control.append(option)}}
  else if(["description","value"].includes(key)){control=document.createElement("textarea");}
  else {control=document.createElement("input");control.type=["featured","published","verified","is_public"].includes(key)?"checkbox":
           ["release_year","duration_minutes","number","sort_order"].includes(key)?"number":
           ["rights_expires_at"].includes(key)?"datetime-local":"text";}
  control.name=key;
  if(control.type==="checkbox")control.checked=Boolean(row?row[key]:false);
  else {
    const initial=row?.[key];
    control.value=initial==null?("status"===key?"draft":"rights_status"===key?"pending":"") :
       key==="value"?JSON.stringify(initial,null,2):
       key==="rights_expires_at"?String(initial).slice(0,16):String(initial);
  }
  if(["poster_url","backdrop_url"].includes(key)){
   const upload=document.createElement("input");upload.type="file";upload.accept="image/png,image/jpeg,image/webp";
   upload.onchange=async()=>{
    if(!upload.files?.length)return;
    try{control.value=await uploadPoster(upload.files[0]);show("تم رفع الصورة بنجاح")}
    catch(e){show("تعذر رفع الصورة: "+e.message,true)}
   };label.append(control,upload);
  }else label.append(control);
  target.append(label);
 }
 $("editor").scrollIntoView({behavior:"smooth",block:"start"});
}
async function uploadPoster(file){
 if(file.size>3*1024*1024)throw Error("الصورة أكبر من 3 ميجابايت");
 if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw Error("صيغة الصورة غير مدعومة");
 const ext=file.type==="image/jpeg"?"jpg":file.type==="image/png"?"png":"webp";
 const fileName="poster-"+Date.now()+"-"+Math.random().toString(36).slice(2,9)+"."+ext;
 const path=cfg.bucket+"/"+fileName;
 const response=await fetch(cfg.url+"/storage/v1/object/"+path,{
   method:"POST",headers:headers({"Content-Type":file.type,"x-upsert":"false"}),body:file
 });
 if(!response.ok)throw Error(await response.text());
 return cfg.url+"/storage/v1/object/public/"+path;
}
$("new").onclick=()=>openEditor();
$("cancel").onclick=()=>$("editor").classList.add("hidden");
$("refresh").onclick=async()=>{await loadOptions();await selectTable(table);show("تم تحديث القائمة")};
$("editorForm").addEventListener("submit",async ev=>{
 ev.preventDefault();
 if(!jwt)return show("سجل الدخول مجددًا",true);
 const payload={};
 for(const key of tables[table].fields){
  const element=$("editorForm").elements.namedItem(key);
  if(!element)continue;
  let val=element.type==="checkbox"?element.checked:element.value.trim();
  if(["release_year","duration_minutes","number","sort_order"].includes(key))val=val===""?null:Number(val);
  else if(key==="value"){try{val=JSON.parse(val)}catch(_){return show("قيمة JSON غير صحيحة",true)}}
  else if(key==="rights_expires_at")val=val?new Date(val).toISOString():null;
  else if(["category_id","series_id","season_id"].includes(key))val=val||null;
  else val=val||null;
  payload[key]=val;
 }
 if(payload.status==="published"&&payload.rights_status!=="approved")
   return show("اعتمد الحقوق أولًا قبل النشر",true);
 if(payload.status==="published"&&!payload.license_reference)
   return show("وثيقة الترخيص مطلوبة للنشر",true);
 if(payload.stream_url&&!payload.stream_url.startsWith("https://"))
   return show("رابط التشغيل يجب أن يكون HTTPS",true);
 try{
  const id=editing?.id??editing?.key;
  const query=id?(table==="aseel_settings"?"key":"id")+"=eq."+encodeURIComponent(id):"";
  const path=table+(id?"?"+query:"");
  await request(path,{method:id?"PATCH":"POST",
      headers:{"Content-Type":"application/json","Prefer":"return=representation"},
      body:JSON.stringify(payload)});
  show("تم حفظ البيانات");
  await loadOptions();await selectTable(table);
 }catch(error){show("فشل الحفظ: "+error.message,true)}
});
async function remove(row){
 if(!confirm("هل تريد حذف هذا السجل نهائيًا؟ قد تتأثر الحلقات التابعة له."))return;
 try{
  const col=table==="aseel_settings"?"key":"id";
  await request(table+"?"+col+"=eq."+encodeURIComponent(row[col]),{method:"DELETE"});
  show("تم الحذف");await selectTable(table);
 }catch(error){show("تعذر الحذف: "+error.message,true)}
}
$("testLink").onclick=()=>{
 const url=$("editorForm").elements.namedItem("stream_url")?.value;
 if(!url||!url.startsWith("https://"))return show("أدخل رابط تشغيل HTTPS صالحًا أولًا",true);
 window.open(url,"_blank","noopener,noreferrer");
 show("فُتح الرابط للفحص اليدوي. فتح الرابط لا يثبت الحقوق أو توافق التلفزيون.");
};
