/* Al Ezz Studio V5: admin-only catalogue quality, no destructive actions. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (!$("qualityDashboard")) return;
  const nf = new Intl.NumberFormat("ar-SA");
  let loading=false, lastFetched=0;
  const num=(value)=>nf.format(Number(value)||0);
  const reportStatus=(text,bad=false)=>{
    const node=$("qualityStatus");
    node.textContent=text;
    node.dataset.error=String(bad);
  };
  const row=(cells,badIndexes=[])=>{
    const tr=document.createElement("tr");
    cells.forEach((value,index)=>{
      const td=document.createElement("td");
      td.textContent=value;
      if(badIndexes.includes(index) && String(value)!==num(0))td.className="danger";
      tr.appendChild(td);
    });
    return tr;
  };
  function render(data) {
    const t=data.totals||{}, content=data.content||{};
    for (const [id,value] of [
      ["qualityWorks",t.works],["qualityBroken",t.published_broken],
      ["qualitySuspect",t.published_suspect],["qualityMissing",t.missing_duration]
    ]) $(id).textContent=num(value);
    const names={movies:"الأفلام",series:"المسلسلات",episodes:"الحلقات",channels:"القنوات"};
    const tbody=$("qualityTableBody");tbody.replaceChildren();
    for(const key of ["movies","series","episodes","channels"]){
      const info=content[key]||{};
      tbody.appendChild(row([
        names[key],num(info.total),num(info.published),
        num(info.published_broken),num(info.published_suspect),
        num(info.missing_poster)
      ],[3,4]));
    }
    const issues=$("qualityIssueList");issues.replaceChildren();
    const items=[
      ["مصادر معطّلة لكنها منشورة",
       num(t.published_broken)+" عنصرًا حالته Broken. يلزم فحص وتحديث المصدر أو إخفاؤه مؤقتًا دون حذف البيانات."],
      ["مصادر مشكوك في صحتها",
       num(t.published_suspect)+" عنصرًا يتطلب التأكد من التشغيل. الواجهة العامة لا تعرض مشغلات Broken/Suspect."],
      ["مدد ناقصة أو غير منطقية",
       num(t.missing_duration)+" فيلمًا أو حلقة مدتها أقل من دقيقتين أو غير مسجلة؛ افحص مدة الملف الحقيقي باستخدام FFprobe."],
      ["ملصقات الأعمال",
       num(t.missing_poster)+" عنصرًا يفتقد ملصقًا خاصًا. استخدم صورة المسلسل بشكل احتياطي للحلقات."]
    ];
    for(const [title,description] of items){
      const li=document.createElement("li"),head=document.createElement("strong");
      head.textContent=title;li.append(head,document.createTextNode(description));issues.append(li);
    }
    const updated=data.updated_at ? new Date(data.updated_at*1000) : new Date();
    reportStatus("تم التحديث من Supabase: "+updated.toLocaleString("ar-SA")+" • بيانات وصفية، وليست نتيجة اختبار بث لحظي.");
  }
  async function refresh(force=false){
    if(loading || (document.hidden && !force) || (!force&&Date.now()-lastFetched<90000))return;
    if(!force&&location.hash!=="#quality")return;
    loading=true;
    $("qualityRefresh").disabled=true;
    reportStatus("جارٍ جمع بيانات الجودة من قاعدة العز TV…");
    const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),18000);
    try{
      const res=await fetch("/api/studio/quality",{credentials:"same-origin",cache:"no-store",
        signal:ctrl.signal,headers:{"Accept":"application/json"}});
      if(res.status===401){
        reportStatus("جلسة الإدارة غير متاحة. افتح بوابة المسؤول وسجّل الدخول، ثم أعد المحاولة.",true);
        return;
      }
      if(!res.ok)throw new Error("HTTP "+res.status);
      const json=await res.json();
      if(json.source!=="supabase_metadata")throw new Error("استجابة غير معروفة");
      render(json);lastFetched=Date.now();
    }catch(error){reportStatus("تعذر قراءة الجودة من Supabase: "+error.message,true)}
    finally{clearTimeout(timer);loading=false;$("qualityRefresh").disabled=false}
  }
  $("qualityRefresh").addEventListener("click",()=>refresh(true));
  window.addEventListener("hashchange",()=>refresh(false));
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh(false)});
  setInterval(()=>refresh(false),60000);
  if(location.hash==="#quality")refresh(true);
})();
