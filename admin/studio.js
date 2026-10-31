"use strict";
(function(){
 const $=id=>document.getElementById(id);
 const sections=[["▣ مكتبة العز",["aseel_movies","aseel_series","aseel_channels"]],["▤ مواسم وحلقات",["aseel_seasons","aseel_episodes"]],["✦ إدارة الرئيسية",["aseel_home_collections","aseel_home_collection_items","aseel_categories"]],["◈ الحقوق",["aseel_content_sources"]],["⚙ إعدادات النظام",["aseel_settings"]]];
 // Extend existing generic editor (without replacing Supabase Auth or RLS).
 for(const t of ["aseel_movies","aseel_series","aseel_channels"]){
  const fields=tables[t].fields;for(const [i,k] of ["source_id","age_rating","display_order"].entries())if(!fields.includes(k))fields.splice(fields.indexOf("category_id")+1+i,0,k);
 }
 if(!tables.aseel_episodes.fields.includes("source_id"))tables.aseel_episodes.fields.splice(1,0,"source_id");
 tables.aseel_home_collections={label:"صفوف الرئيسية",fields:["title_ar","slug","description","display_order","is_active"]};
 tables.aseel_home_collection_items={label:"محتويات الصفوف",fields:["collection_id","movie_id","series_id","channel_id","episode_id","display_order"]};
 Object.assign(names,{source_id:"مصدر الحقوق المرتبط",age_rating:"الفئة العمرية",display_order:"ترتيب الظهور",slug:"معرف الصف الإنجليزي",is_active:"تفعيل الصف",collection_id:"صف الرئيسية",movie_id:"الفيلم",series_id:"المسلسل",channel_id:"القناة",episode_id:"الحلقة"});
 let sources=[],collections=[],movies=[],channels=[],episodes=[];
 const oldLoad=loadOptions;
 loadOptions=async function(){
  await oldLoad();
  try{const data=await Promise.all([
   request("aseel_content_sources?select=id,title,verified&limit=500"),
   request("aseel_home_collections?select=id,title_ar&limit=100"),
   request("aseel_movies?select=id,title_ar&limit=500"),
   request("aseel_channels?select=id,title_ar&limit=500"),
   request("aseel_episodes?select=id,title_ar&limit=500")]);
   [sources,collections,movies,channels,episodes]=data.map(x=>x||[]);
  }catch(e){show("تعذر تحميل بعض خيارات العلاقات: "+e.message,true)}
 };
 const originalOption=optionList;
 optionList=function(key){
   const opt=items=>[["","— اختر —"],...items.map(x=>[x.id,x.title_ar||x.title])];
   if(key==="source_id")return opt(sources);
   if(key==="age_rating")return [["all","مناسب للجميع"],["7+","7+"],["13+","13+"],["16+","16+"],["18+","18+"]];
   if(key==="collection_id")return opt(collections);
   if(key==="movie_id")return opt(movies);
   if(key==="channel_id")return opt(channels);
   if(key==="episode_id")return opt(episodes);
   return originalOption(key);
 };
 async function dashboard(){
  if(!jwt)return;
  const reports=await Promise.allSettled(["aseel_movies","aseel_series","aseel_channels","aseel_episodes","aseel_home_collections"].map(t=>request(t+"?select=*&limit=1000")));
  let total=0,published=0,pending=0,kids=0,shelves=0;
  reports.forEach((r,i)=>{if(r.status!=="fulfilled")return;const list=r.value||[];
   if(i===4){shelves=list.filter(x=>x.is_active).length;return}
   total+=list.length;published+=list.filter(x=>x.status==="published"&&x.rights_status==="approved").length;
   pending+=list.filter(x=>x.rights_status==="pending").length;kids+=list.filter(x=>x.is_kids).length;
  });
  const target=$("dashboardKpis");target.replaceChildren();
  for(const [name,count,icon] of [["كل المحتوى",total,"▣"],["منشور ومعتمد",published,"✓"],["قيد مراجعة الحقوق",pending,"◈"],["الأطفال",kids,"★"],["صفوف نشطة",shelves,"✦"]]){
   const card=document.createElement("article");card.className="kpi-card";const label=document.createElement("span");label.textContent=icon+" "+name;
   const number=document.createElement("strong");number.textContent=String(count);card.append(label,number);target.append(card);
  }
 }
 function filter(){
  const q=$("tableSearch").value.toLowerCase().trim(),state=$("tableStatus").value;let n=0;
  $("rows").querySelectorAll("tr").forEach(row=>{const match=(!q||row.textContent.toLowerCase().includes(q))&&(!state||row.textContent.includes(state));row.hidden=!match;if(match)n++});
  $("tableCount").textContent=n+" سجل";
  document.querySelectorAll(".sidebar-link").forEach(b=>b.classList.toggle("active",b.dataset.table===table));
 }
 function init(){
  const aside=$("adminGroups");
  sections.forEach(([name,keys])=>{const heading=document.createElement("h3");heading.textContent=name;aside.append(heading);
   keys.forEach(key=>{const b=document.createElement("button");b.type="button";b.className="sidebar-link";b.dataset.table=key;b.textContent=tables[key].label;b.onclick=()=>selectTable(key);aside.append(b)});
  });
  document.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>{selectTable(b.dataset.jump);openEditor()});
  $("tableSearch").oninput=filter;$("tableStatus").onchange=filter;
  $("dashboardRefresh").onclick=()=>dashboard().catch(e=>show(e.message,true));
  new MutationObserver(()=>{if(!$("panel").classList.contains("hidden"))dashboard().catch(()=>{})}).observe($("panel"),{attributes:true,attributeFilter:["class"]});
  new MutationObserver(filter).observe($("rows"),{childList:true});
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
