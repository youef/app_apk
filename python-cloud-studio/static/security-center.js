(()=>{"use strict";
const $=id=>document.getElementById(id),n=(tag,cl,t)=>{const e=document.createElement(tag);if(cl)e.className=cl;if(t!==undefined)e.textContent=String(t);return e;};
const b=(t,fn,cl)=>{const e=n("button",cl,t);e.type="button";e.onclick=fn;return e;};
let csrf="",sites=[],report=null,active="";
function toast(t,bad=false){const e=$("toast");e.textContent=t;e.hidden=false;e.classList.toggle("bad",bad);setTimeout(()=>e.hidden=true,6500)}
async function api(path,body){const method=body===undefined?"GET":"POST",r=await fetch(path,{method,credentials:"same-origin",headers:method==="GET"?{"accept":"application/json"}:{"content-type":"application/json","x-csrf-token":csrf},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});if(!(r.headers.get("content-type")||"").includes("json"))throw Error("انتهت جلسة الدخول؛ سجّل دخول المسؤول.");const d=await r.json();if(!r.ok)throw Error(d.detail||"تعذّر تنفيذ العملية");return d}
async function action(fn){try{await fn()}catch(e){toast(e.message||"حدث خطأ",true)}}
async function refresh(){sites=(await api("/api/security/sites")).sites;drawSites();}
function drawSites(){const root=$("sites");root.replaceChildren();$("totalSites").textContent=sites.length;$("verifiedSites").textContent=sites.length;$("scannedSites").textContent=sites.filter(s=>s.latest).length;const pick=$("importSite");const current=pick.value;pick.replaceChildren(n("option",null,"اختر موقعًا"));pick.firstChild.value="";sites.forEach(s=>{const o=n("option",null,s.host);o.value=s.id;pick.append(o)});if(sites.some(s=>s.id===current))pick.value=current;
if(!sites.length){root.append(n("div","empty","لم تضف أي موقع بعد."));return}
sites.forEach(s=>{const card=n("article","site-card"),head=n("div","site-top");head.append(n("strong",null,s.host),n("span","pill good","✓ جاهز للفحص"));card.append(head);
if(s.last_run)card.append(n("p","note","آخر فحص: "+s.last_run));if(s.job&&s.job.state==="running")card.append(n("p","note","جارٍ الفحص في الخلفية…"));if(s.job&&s.job.state==="failed")card.append(n("p","note","فشل الفحص: "+(s.job.error||"راجع الخدمة")));
const controls=n("div","site-actions");
controls.append(b("فحص الآن",()=>action(async()=>{await api("/api/security/scan",{site_id:s.id});toast("بدأ فحص الموقع");await refresh()}),"scan-btn"));
if(s.latest)controls.append(b("التقرير الأخير",()=>action(()=>showReport(s.id))));
const select=n("select");select.setAttribute("aria-label","جدولة الفحص");
[[0,"يدوي فقط"],[24,"يوميًا"],[168,"أسبوعيًا"]].forEach(pair=>{let o=n("option",null,pair[1]);o.value=pair[0];if(s.interval_hours===pair[0])o.selected=true;select.append(o)});
select.onchange=()=>action(async()=>{await api("/api/security/schedule",{site_id:s.id,interval_hours:Number(select.value)});toast("حُفظت الجدولة");await refresh()});controls.append(select);
controls.append(b("حذف",()=>action(async()=>{if(!confirm("حذف الموقع وتقاريره نهائيًا؟"))return;await api("/api/security/delete",{site_id:s.id});if(active===s.id)$("reportSection").hidden=true;await refresh()})));
card.append(controls);root.append(card)})}
const levels={critical:"حرجة",high:"عالية",medium:"متوسطة",low:"منخفضة",info:"معلومة"};
async function showReport(id){const r=await api("/api/security/report/"+encodeURIComponent(id));report=r.report;active=id;$("reportSection").hidden=false;$("reportMeta").textContent=report.host+" • "+r.created_at;
const overview=$("reportOverview");overview.replaceChildren();const row=n("div","report-summary");
[[report.indicator===null?"—":report.indicator,"مؤشر الإعدادات — ليس شهادة أمان"],...["critical","high","medium","low"].map(x=>[report.counts[x],levels[x]])].forEach(pair=>{const e=n("div","score");e.append(n("strong",null,pair[0]),n("span",null,pair[1]));row.append(e)});overview.append(row);
const list=$("findings");list.replaceChildren();if(!report.findings.length)list.append(n("p","empty","لا توجد مؤشرات ضمن الفحوصات المحدودة التي اكتملت."));
report.findings.forEach(f=>{const item=n("div","finding");item.dataset.level=f.severity;item.append(n("span","severity",levels[f.severity]||f.severity),n("h4",null,f.title),n("p",null,f.detail),n("p",null,"الإصلاح: "+f.fix));if(f.evidence)item.append(n("small",null,"الدليل: "+f.evidence));list.append(item)});
const manual=$("manualList");manual.replaceChildren();(report.manual_review||[]).forEach(s=>manual.append(n("div","manual-item",s)));$("reportSection").scrollIntoView({behavior:"smooth"})}
const catalog=[
["SQL Injection (SQLi) / Blind SQLi","manual","مراجعة استعلامات SQL ومراجعة كود الخادم"],
["NoSQL Injection / LDAP Injection","manual","تدقيق بناء الاستعلامات ومدخلاتها"],
["RCE / Command Injection / SSTI","manual","مراجعة الشيفرة والإضافات في بيئة اختبار"],
["Broken Access Control / IDOR / BOLA","manual","حسابان تجريبيان وصلاحيات الخادم"],
["Authentication Bypass / Privilege Escalation","manual","تدقيق المصادقة وتفويض الأدوار"],
["SSRF / XXE / RFI / LFI","manual","تدقيق جلب الموارد وملفات الإدخال"],
["Arbitrary File Upload","manual","مراجعة التحقق من نوع الملفات ومنع تنفيذ المرفقات"],
["Stored / Reflected / DOM XSS","manual","مراجعة الترميز وJavaScript وإدخالات المنتدى"],
["CSRF / Session Fixation / Hijacking","manual","مراجعة رموز النماذج وأمان الجلسات"],
["Unsafe Deserialization / Traversal","manual","مراجعة مسارات الملفات وفك التسلسل"],
["HTTP Request Smuggling / Host Injection","manual","اختبارات بنية معزولة ومراجعة إعدادات الوكيل"],
["Web Cache Poisoning / Deception","manual","تدقيق فصل المحتوى الخاص والعام في الكاش"],
["Open Redirect / Clickjacking","auto","فحص ترويسات منع التضمين، والتحويل يدوي"],
["CORS Misconfiguration","auto","استجابة الخادم لأصل غير موثوق دون تجاوز"],
["Weak Password Reset / Credential Stuffing","manual","تدقيق استرداد الحساب والحماية من المحاولات"],
["Mass Assignment / Business Logic / Race Condition","manual","اختبارات وظيفية بالبيانات التجريبية"],
["Sensitive Data Exposure / Information Disclosure","auto","ترويسات الخادم وبصمات ملف حساس"],
["Subdomain Takeover","manual","مراجعة سجلات DNS والموارد الخارجية"],
["Dependency Vulnerabilities / Supply Chain","manual","ربط مصدر الشيفرة وSBOM وتحديثات CVE"],
["Rate Limiting / DoS","manual","تدقيق التهيئة دون أي اختبار إغراق"],
["WordPress plugins / themes / versions","manual","مطابقة مع WPScan API أو SBOM"],
["WordPress REST API","auto","اكتشاف واجهة عامة، مراجعة صلاحيات API يدويًا"],
["WordPress xmlrpc / admin-ajax / cron","manual","مراجعة الوظائف وضوابط الاستعمال"],
["WordPress wp-config / .env / .git","auto","فحص بصمات مكشوفة دون تخزين أسرار"],
["WordPress Options Update / Backdoors","manual","تدقيق إضافات ومسارات الإدارة"],
["WordPress Multisite / Plugin Editor","manual","تدقيق الأدوار والتحرير والعزل"],
["XenForo / vBulletin / phpBB / MyBB","auto","استدلال اسم المنصة من الصفحة العامة"],
["Forums BBCode / Attachments / Private Messages","manual","مراجعة الرسائل والمرفقات والحسابات التجريبية"],
["Forums roles / unsafe import / extensions","manual","تدقيق الصلاحيات ومسار استيراد البيانات"],
["HTTPS / TLS","auto","التحقق من شهادة الاتصال الأساسية"],
["HSTS / CSP / X-Frame-Options","auto","فحص ترويسات الاستجابة"],
["Referrer / Permissions / Cookies","auto","فحص سياسات HTTP وسمات الكوكيز"],
["Robots.txt / security.txt","auto","فحص الملفات العامة"],
];
const integrations=[
["OWASP ZAP","فحص سلبي أو فحص نشط مقيد عبر عامل منفصل، غير مفعّل تلقائيًا"],
["WPScan","جرد WordPress ومطابقة الإصدارات عبر API بعد إعداد الترخيص"],
["Nuclei","قوالب غير مؤذية مختارة بعد إعداد عامل فحص خاص"],
["Semgrep","تحليل شفرة المصدر بعد ربط مستودعك"],
["Trivy","حزم النظام وSBOM وصور Docker في CI"],
["Nikto","تدقيق إضافي ضمن بيئة مصرح بها"],
["testssl.sh","فحص إعدادات TLS المتقدم عبر عامل منفصل"],
["Wazuh","مراقبة السجلات والأجهزة عبر وكيل تثبته على خادمك"]
];let filter="all";
function drawCatalog(){const root=$("coverage");root.replaceChildren();catalog.filter(r=>filter==="all"||r[1]===filter).forEach(([name,type,description])=>{const el=n("div","coverage-item");el.append(n("b",null,name),n("small",null,(type==="auto"?"تلقائي محدود • ":"يتطلب مراجعة يدوية • ")+description));root.append(el)})}
["All","Auto","Manual"].forEach(id=>{$("catalog"+id).onclick=()=>{filter=id.toLowerCase();["All","Auto","Manual"].forEach(t=>$("catalog"+t).classList.toggle("active",id===t));drawCatalog()}});
integrations.forEach(([name,description])=>{const item=n("div","tool-card");item.append(n("b",null,name),n("p",null,description));$("toolCards").append(item)});drawCatalog();
$("addForm").onsubmit=e=>{e.preventDefault();action(async()=>{$("addButton").disabled=true;try{let data=await api("/api/security/sites",{url:$("siteUrl").value.trim()});toast("أُضيف "+data.host+"، بدأ الفحص الآمن مباشرة");$("siteUrl").value="";await api("/api/security/scan",{site_id:data.id});await refresh()}finally{$("addButton").disabled=false}})};
$("refreshButton").onclick=()=>action(refresh);
$("importForm").onsubmit=e=>{e.preventDefault();action(async()=>{
  const file=$("importFile").files[0],site_id=$("importSite").value,tool=$("importTool").value;
  if(!site_id)throw Error("اختر موقعًا من قائمتك");
  if(!file)throw Error("اختر ملف تقرير JSON");
  if(file.size>900000)throw Error("الحد الأقصى للتقرير 900 كيلوبايت");
  const report_json=await file.text();
  const result=await api("/api/security/import",{site_id,tool,report_json});
  toast("تم استيراد "+result.count+" نتيجة من "+tool);
  $("importFile").value="";await refresh();await showReport(site_id);
})};

$("exportButton").onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));const a=n("a");a.href=url;a.download="alezz-security-"+report.host+"-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
action(async()=>{csrf=(await api("/api/security/session")).csrf;await refresh()});
setInterval(()=>{if(sites.some(s=>s.job?.state==="running"))action(refresh)},9000);
})();