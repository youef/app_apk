"use strict";
const scan=document.getElementById("scan"),copy=document.getElementById("copy"),box=document.getElementById("result");
let report=null;
const cleanHost=url=>{try{return new URL(url).hostname}catch{return ""}};
function diagnostic(){
  const cleanHost=url=>{try{return new URL(url).hostname}catch{return ""}};
  const resources=performance.getEntriesByType("resource").slice(0,500);
  const resourceTypes={};
  const publicMediaKinds={};
  const videoNodes=[...document.querySelectorAll("video")].slice(0,30);
  const videos=[];
  for(const node of videoNodes){
    let target=node.currentSrc||node.src||"";
    if(!target)target=node.querySelector("source")?.src||"";
    const host=cleanHost(target);
    videos.push({host,tag:"video",has_src:!!target,
      ready_state:node.readyState,duration_known:Number.isFinite(node.duration)});
  }
  let cacheEstimate=0;
  let count=0;
  for(const entry of resources){
    const kind=entry.initiatorType||"other";
    resourceTypes[kind]=(resourceTypes[kind]||0)+1;
    const name=entry.name||"";
    const pathname=(()=>{try{return new URL(name).pathname.toLowerCase()}catch{return ""}})();
    const ext=pathname.match(/\.(m3u8|mp4|webm|m4v|mov|mkv)$/)?.[1];
    if(ext){
      publicMediaKinds[ext]=(publicMediaKinds[ext]||0)+1;
    }
    if(cleanHost(name)===location.hostname&&entry.transferSize===0&&entry.decodedBodySize>0){
      cacheEstimate++;
    }
    count++;
  }
  return {
    version:1,
    source:"Al Ezz TV Local Chrome Inspector",
    host:location.hostname,
    page_title:document.title.slice(0,150),
    resources_total:count,
    resourceTypes,
    media_types:publicMediaKinds,
    video_elements:videos.length,
    video_summary:videos,
    possible_cached_same_origin:cacheEstimate,
    cache_storage_count:null,
    service_worker_active:Boolean(navigator.serviceWorker?.controller),
    cookie_values_read:false,
    note:"ResourceTiming only. 0 transferSize may mean cache or unavailable timing; no HAR, credentials or cookie data included."
  };
}
scan.addEventListener("click",async()=>{
  scan.disabled=true;copy.disabled=true;box.textContent="جارٍ فحص التبويب المفتوح محليًا...";
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id)throw Error("لم يتم العثور على تبويب Chrome");
    if(!tab.url?.startsWith("https://"))throw Error("افتح موقع HTTPS عامًا ثم شغّل الإضافة");
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:diagnostic});
    report=result;
    // Optional active-tab CacheStorage names COUNT only, never cache keys or contents.
    try{
      const [{result:count}]=await chrome.scripting.executeScript({
        target:{tabId:tab.id},
        func:async()=>{try{return (await caches.keys()).length}catch{return null}}
      });
      report.cache_storage_count=count;
    }catch{}
    box.textContent=[
      "النطاق: "+report.host,
      "الموارد المرصودة: "+report.resources_total,
      "وسوم الفيديو: "+report.video_elements,
      "مؤشرات الكاش لنفس النطاق: "+report.possible_cached_same_origin,
      "مخازن CacheStorage: "+(report.cache_storage_count??"غير متاح"),
      "أنواع المصادر: "+Object.entries(report.media_types).map(([k,v])=>k+": "+v).join("، "),
      "الكوكيز: لم تُقرأ، ولا يتم نقلها."
    ].join("\n");
    copy.disabled=false;
  }catch(error){box.textContent="تعذر الفحص: "+error.message;report=null}
  finally{scan.disabled=false}
});
copy.addEventListener("click",async()=>{
  if(!report)return;
  try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));box.textContent+="\nتم نسخ التقرير الآمن إلى الحافظة."}
  catch{box.textContent+="\nتعذر النسخ الآلي؛ اسمح باستخدام الحافظة."}
});
