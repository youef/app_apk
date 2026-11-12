// Al Ezz TV — link health agent. GitHub OIDC or authenticated admin only.
// Never download entire media or accept private-network destinations.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
// Keep browser access restricted to first-party hosts. Requests still require
// verified Supabase administrator JWTs or signed GitHub Actions OIDC tokens.
const TRUSTED_ORIGINS = new Set([
  "https://youef.github.io",
  "https://app-apk-oquy.onrender.com"
]);
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
function corsFor(req: Request) {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string,string> = {
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,apikey,content-type",
    "Vary": "Origin"
  };
  if (TRUSTED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
const b64 = (part: string) => {
  const text = atob(part.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(part.length/4)*4,"="));
  return Uint8Array.from(text,c=>c.charCodeAt(0));
};
async function verifyGithub(token: string): Promise<boolean> {
  try {
    if (!token || token.length>12000) return false;
    const parts=token.split(".");
    if(parts.length!==3)return false;
    const header=JSON.parse(new TextDecoder().decode(b64(parts[0])));
    const claims=JSON.parse(new TextDecoder().decode(b64(parts[1])));
    const now=Math.floor(Date.now()/1000);
    if(header.alg!=="RS256" || !header.kid || claims.iss!=="https://token.actions.githubusercontent.com"
       || claims.aud!=="al-ezz-media-link-health"
       || claims.repository!=="youef/app_apk" || claims.ref!=="refs/heads/main"
       || claims.workflow_ref!=="youef/app_apk/.github/workflows/link-health-agent.yml@refs/heads/main"
       || !["schedule","workflow_dispatch","push"].includes(claims.event_name)
       || !claims.exp || claims.exp<now || claims.iat>now+60 || now-claims.iat>600)return false;
    const jwksResp=await fetch("https://token.actions.githubusercontent.com/.well-known/jwks", {signal:AbortSignal.timeout(6000)});
    if(!jwksResp.ok)return false;
    const jwks=await jwksResp.json();
    const jwk=jwks.keys?.find((k:Record<string,string>)=>k.kid===header.kid && k.kty==="RSA" && k.use==="sig");
    if(!jwk)return false;
    const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    return crypto.subtle.verify({name:"RSASSA-PKCS1-v1_5"},key,b64(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
  }catch{return false;}
}
async function verifyAdmin(token:string):Promise<boolean> {
  if(!token || !SUPABASE_URL || !ANON) return false;
  const h={apikey:ANON,Authorization:"Bearer "+token};
  try {
    const auth=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:h,signal:AbortSignal.timeout(6000)});
    if(!auth.ok)return false;
    const user=await auth.json();
    if(!user.id)return false;
    const role=await fetch(SUPABASE_URL+"/rest/v1/aseel_admins?select=user_id&active=eq.true&user_id=eq."+encodeURIComponent(user.id),{headers:h,signal:AbortSignal.timeout(6000)});
    const rows=role.ok?await role.json():[];
    return Array.isArray(rows)&&rows.length>0;
  }catch{return false;}
}
const tables=[
  {name:"aseel_channels",fields:"id,title_ar,stream_url,stream_variants,youtube_url,official_url,playback_mode,link_health_status,link_health_failures,link_health_checked_at,link_health_url",max:24},
  {name:"aseel_movies",fields:"id,title_ar,stream_url,stream_variants,youtube_url,link_health_status,link_health_failures,link_health_checked_at,link_health_url",max:24},
  {name:"aseel_episodes",fields:"id,title_ar,stream_url,stream_variants,youtube_url,link_health_status,link_health_failures,link_health_checked_at,link_health_url",max:24},
  {name:"aseel_youtube_videos",fields:"id,title_ar,youtube_url,link_health_status,link_health_failures,link_health_checked_at,link_health_url",max:24}
];
type Row=Record<string,unknown>;
async function rest(table:string, query:string, opts:RequestInit={}) {
  const u=SUPABASE_URL+"/rest/v1/"+table+(query?"?"+query:"");
  const response=await fetch(u,{...opts,headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE,
    "Content-Type":"application/json",Accept:"application/json",...opts.headers},signal:AbortSignal.timeout(13000)});
  const payload=await response.text();
  if(!response.ok)throw new Error(table+" API "+response.status+": "+payload.slice(0,180));
  return payload?JSON.parse(payload):null;
}
// Page through the entire catalogue. A fixed REST limit silently truncates
// aggregate results when the number of episodes grows beyond 1000.
async function restAll(table:string,filter:string):Promise<Row[]> {
  const rows:Row[]=[];
  const pageSize=400;
  for(let offset=0;offset<10000;offset+=pageSize){
    const part=await rest(table,filter+"&order=id.asc&limit="+pageSize+"&offset="+offset);
    if(!Array.isArray(part))throw new Error("Unexpected catalogue response: "+table);
    rows.push(...part);
    if(part.length<pageSize)return rows;
  }
  throw new Error("Catalogue exceeds the safe full-scan limit; narrow the scope.");
}
function safeUrl(raw:unknown):URL|null {
  try {
    const url=new URL(String(raw||""));
    const host=url.hostname.toLowerCase();
    if(url.protocol!=="https:" || url.username || url.password || (url.port && url.port!=="443")
      || url.href.length>2048 || host.length>253 || host==="localhost" || host.endsWith(".localhost")
      || /\.(local|internal|test|invalid|arpa)$/i.test(host) || host.indexOf(".")<1
      || /[\[\]:]/.test(host) || /^\d+(\.\d+){3}$/.test(host) || /^0x|^0\d/.test(host))return null;
    return url;
  }catch{return null;}
}
function privateIp(ip:string):boolean {
  if(ip.indexOf(":")>=0) return true; // Restrict IPv6 to avoid SSRF edge cases.
  const v=ip.split(".").map(Number);
  if(v.length!==4||v.some(x=>!Number.isInteger(x)||x<0||x>255))return true;
  return v[0]===0||v[0]===10||v[0]===127||v[0]>=224||v[0]===169&&v[1]===254||
    v[0]===172&&v[1]>=16&&v[1]<=31||v[0]===192&&v[1]===168||
    v[0]===100&&v[1]>=64&&v[1]<=127||v[0]===192&&v[1]===0||
    v[0]===198&&(v[1]===18||v[1]===19)||v[0]===192&&v[1]===0&&v[2]===2||
    v[0]===198&&v[1]===51&&v[2]===100||v[0]===203&&v[1]===0&&v[2]===113;
}
async function publicHost(url:URL) {
  try {
    if(typeof Deno.resolveDns!=="function")return false;
    const a=await Deno.resolveDns(url.hostname,"A");
    if(!a.length||a.some(privateIp))return false;
    const aaaa=await Deno.resolveDns(url.hostname,"AAAA").catch(()=>[] as string[]);
    if(aaaa.some((ip:string)=>!(/^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:0?db8:/i.test(ip))))return false;
    return true;
  }catch{return false;}
}
// Signed video URLs can become unusable even while the content is available
// on another approved source. Expiry is metadata, never a signing mechanism.
function signedExpiry(url:URL):number {
  const start=url.searchParams.get("s")||"", ttl=url.searchParams.get("e")||"";
  if(/^\d{10}$/.test(start) && /^\d{1,6}$/.test(ttl) && url.searchParams.has("t")) {
    const s=Number(start), e=Number(ttl);
    if(s>=1500000000 && s<4000000000 && e>0 && e<=604800)return s+e;
  }
  if(/^\d{10}$/.test(ttl) && Number(ttl)>=1500000000)return Number(ttl);
  for(const name of ["expires","exp","expiry"]) {
    const value=url.searchParams.get(name)||"";
    if(/^\d{10}$/.test(value) && Number(value)>=1500000000)return Number(value);
  }
  return 0;
}
function approvedEmbedShape(url:URL):boolean {
  const host=url.hostname.toLowerCase(), path=url.pathname;
  return ((host==="ok.ru"||host==="www.ok.ru") &&
      /^\/video(?:embed)?\/[0-9]{1,20}\/?$/.test(path) && !url.search && !url.hash) ||
    (host==="fushaar.world" && /^\/embed\/v-[a-z0-9]+\/?$/i.test(path)) ||
    (host==="liiivideo.com" && /^\/embed-[a-z0-9]+\.html$/i.test(path)) ||
    (host==="hanerix.com" && /^\/e\/[a-z0-9_-]+\/?$/i.test(path)) ||
    ((host==="1vid.xyz"||host==="www.1vid.xyz") && /^\/embed-[a-z0-9_-]+\.html$/i.test(path));
}
type Probe={kind:"healthy"|"definite"|"unknown",reason:string};

async function sampleHlsMedia(playlistUrl:URL, contents:string):Promise<Probe>{
  let parent=playlistUrl;
  let body=contents;
  // Handle a single HLS master variant, then inspect a real segment.
  for(let depth=0;depth<2;depth++){
    const lines=body.split(String.fromCharCode(10)).map(x=>x.trim());
    const master=lines.some(x=>x.startsWith("#EXT-X-STREAM-INF:"));
    let target="";
    if(master){
      const at=lines.findIndex(x=>x.startsWith("#EXT-X-STREAM-INF:"));
      target=lines.slice(at+1).find(x=>!!x&&!x.startsWith("#"))||"";
      if(!target)return {kind:"unknown",reason:"تعذر استخراج جودة من قائمة HLS"};
    }else{
      let at=-1;
      for(let n=0;n<lines.length;n++)if(lines[n].startsWith("#EXTINF:"))at=n;
      if(at<0)return {kind:"unknown",reason:"قائمة HLS لا تحتوي مقاطع بث قابلة للفحص"};
      target=lines.slice(at+1).find(x=>!!x&&!x.startsWith("#"))||"";
      if(!target)return {kind:"unknown",reason:"لا يوجد مقطع HLS قابل للتحميل"};
    }
    let url:URL|null=null;
    try{url=safeUrl(new URL(target,parent).href);}catch{return {kind:"unknown",reason:"رابط مقطع غير صالح"};}
    if(!url)return {kind:"unknown",reason:"رابط مقطع غير آمن"};
    for(let redirect=0;redirect<3;redirect++){
      if(!(await publicHost(url)))return {kind:"unknown",reason:"تعذر التحقق من نطاق مقطع HLS"};
      try{
        const response=await fetch(url.href,{method:"GET",redirect:"manual",
          headers:{"Range":"bytes=0-4095","User-Agent":"AlEzzTV-HealthAgent/1.0"},
          signal:AbortSignal.timeout(9000)});
        if(response.status>=300&&response.status<400){
          const next=response.headers.get("location");
          url=next?safeUrl(new URL(next,url).href):null;
          if(!url)return {kind:"unknown",reason:"تحويل مقطع HLS غير آمن"};
          continue;
        }
        if(response.status===404||response.status===410)
          return {kind:master?"unknown":"definite",reason:"مقطع HLS مفقود (HTTP "+response.status+")"};
        if(!response.ok)return {kind:"unknown",reason:"مقطع HLS غير متاح من نقطة الفحص (HTTP "+response.status+")"};
        const reader=response.body?.getReader();
        if(!reader)return {kind:"unknown",reason:"المقطع بدون بيانات"};
        const first=await reader.read();
        try{await reader.cancel();}catch{}
        const chunk=first.value;
        if(!chunk||chunk.length<16)return {kind:"unknown",reason:"مقطع بث فارغ أو قصير"};
        const contentType=(response.headers.get("content-type")||"").toLowerCase();
        const prefix=new TextDecoder().decode(chunk.slice(0,80)).trimStart().toLowerCase();
        if(contentType.includes("text/html")||contentType.includes("application/json")||
          prefix.startsWith("<html")||prefix.startsWith("<!doctype")||prefix.startsWith('{"error"'))
          return {kind:"definite",reason:"رابط مقطع HLS أعاد HTML/JSON بدل الفيديو"};
        if(master){
          body=new TextDecoder().decode(chunk);
          parent=url;
          if(!body.trimStart().startsWith("#EXTM3U"))return {kind:"unknown",reason:"جودة HLS لا تعرض قائمة تشغيل"};
          break;
        }
        return {kind:"healthy",reason:"تم تحميل بيانات مقطع فيديو فعلي من قائمة HLS"};
      }catch{return {kind:"unknown",reason:"تعذر قراءة مقطع HLS؛ قد يكون المصدر محجوبًا جغرافيًا"};}
    }
    if(!master)break;
  }
  return {kind:"unknown",reason:"لم يثبت وجود مقطع قابل للتشغيل"};
}
async function probe(raw:unknown,mode:"stream"|"official"|"youtube"):Promise<Probe> {
  let u=safeUrl(raw);
  if(!u)return {kind:"unknown",reason:"رابط غير آمن أو غير صالح للفحص التلقائي"};
  if(mode==="stream") {
    const exp=signedExpiry(u);
    if(exp && exp<=Math.floor(Date.now()/1000)+30)
      return {kind:"definite",reason:"انتهت صلاحية رابط تشغيل موقّع؛ يلزم تجديد موثّق من مزود الخدمة"};
    if(approvedEmbedShape(u)) {
      // An embed returning HTTP 200 proves only that the page exists.
      // Only a definitive 404/410 is eligible for the 3-strike hide rule.
      if(!(await publicHost(u)))
        return {kind:"unknown",reason:"تعذر التحقق الآمن من مضيف التضمين"};
      try {
        const response=await fetch(u.href,{method:"HEAD",redirect:"manual",signal:AbortSignal.timeout(7000)});
        if(response.status===404||response.status===410)
          return {kind:"definite",reason:"صفحة التضمين غير موجودة (HTTP "+response.status+")"};
        return {kind:"unknown",reason:"صفحة التضمين لا تثبت توفر الفيديو؛ يتطلب فحص تشغيل"};
      }catch{return {kind:"unknown",reason:"تعذر الوصول إلى صفحة التضمين؛ لا يعد إثباتًا لتعطلها"};}
    }
  }
  if(mode==="youtube"){
    const host=u.hostname.toLowerCase();
    if(!["youtube.com","www.youtube.com","m.youtube.com","youtu.be","www.youtube-nocookie.com"].includes(host))
      return {kind:"unknown",reason:"رابط يوتيوب لا يطابق النطاق الرسمي"};
    const id=host==="youtu.be"?u.pathname.split("/")[1]:
      u.searchParams.get("v")||u.pathname.match(/\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]+)/)?.[1]||"";
    if(!/^[a-zA-Z0-9_-]{11}$/.test(id))return {kind:"unknown",reason:"معرف الفيديو غير صالح"};
    u=new URL("https://www.youtube.com/oembed?url="+encodeURIComponent("https://www.youtube.com/watch?v="+id)+"&format=json");
  }
  for(let redirect=0;redirect<3;redirect++){
    if(!(await publicHost(u)))return {kind:"unknown",reason:"تعذر التحقق الآمن من نطاق المصدر"};
    try {
      const response=await fetch(u.href,{method:"GET",redirect:"manual",headers:{
        "Range":"bytes=0-8191","User-Agent":"AlEzzTV-HealthAgent/1.0 (+https://youef.github.io/app_apk/)"
      },signal:AbortSignal.timeout(9000)});
      if(response.status>=300&&response.status<400){
        const next=response.headers.get("location");
        const target=next?safeUrl(new URL(next,u).href):null;
        if(!target)return {kind:"unknown",reason:"إعادة توجيه غير موثوقة"};
        u=target;continue;
      }
      if(response.status===404||response.status===410)return {kind:"definite",reason:"الخادم أعاد HTTP "+response.status};
      if(response.status===401||response.status===403||response.status===429||response.status>=500)
        return {kind:"unknown",reason:"المصدر يقيّد الفحص أو متوقف مؤقتًا (HTTP "+response.status+")"};
      if(!response.ok)return {kind:"unknown",reason:"حالة HTTP غير حاسمة: "+response.status};
      const type=response.headers.get("content-type")||"";
      const path=u.pathname.toLowerCase();
      const isHls=/\.m3u8$/.test(path),isDash=/\.mpd$/.test(path);
      if(mode==="official"||mode==="youtube")return {kind:"healthy",reason:mode==="youtube"?"فيديو متاح عبر معلومات يوتيوب الرسمية":"صفحة المصدر استجابت بنجاح"};
      if(isHls||isDash){
        const text=(await response.text()).slice(0,8000).trimStart();
        const valid=isHls ? text.startsWith("#EXTM3U") : /<MPD\b/i.test(text);
        if(valid)return isHls ? await sampleHlsMedia(u,text) :
          {kind:"healthy",reason:"تم التحقق من قائمة DASH"};
        if(/text\/html/i.test(type))return {kind:"definite",reason:"المصدر يعيد صفحة HTML بدل ملف البث"};
        return {kind:"unknown",reason:"تعذر قراءة صيغة قائمة البث من هذا المصدر"};
      }
      if(/text\/html/i.test(type))return {kind:"definite",reason:"المصدر يعيد صفحة ويب بدل ملف فيديو"};
      return {kind:"healthy",reason:"الخادم أعاد استجابة فيديو صالحة"};
    }catch{
      return {kind:"unknown",reason:"فشل اتصال أو مهلة من نقطة الفحص؛ لا يعني أن البث معطوب"};
    }
  }
  return {kind:"unknown",reason:"تحويلات كثيرة تمنع التحقق"};
}

function mediaList(row:Row, allSources=false){
  const mode=row.playback_mode==="official_link"?"official":"stream";
  if(mode==="official")return [{url:String(row.official_url||""),mode:"official" as const,label:"الرابط الرسمي",role:"primary"}];
  const entries:{url:string,mode:"stream",label:string,role:string}[]=[];
  if(row.stream_url)entries.push({url:String(row.stream_url),mode:"stream",label:"الرابط الأساسي",role:"primary"});
  if(Array.isArray(row.stream_variants)){
    row.stream_variants.forEach((v:any,index:number)=>{
      if(!v||typeof v.url!=="string"||!v.url.trim())return;
      entries.push({url:v.url.trim(),mode:"stream",label:String(v.label||"الجودة "+(index+1)).slice(0,70),role:"variant"});
    });
  }
  if(entries.length)return entries.slice(0,allSources?9:4);
  if(row.youtube_url)return [{url:String(row.youtube_url),mode:"youtube" as const,label:"يوتيوب رسمي",role:"primary"}];
  return [];
}
async function checkRow(table:string,row:Row,allSources=false){
  const urls=mediaList(row,allSources);
  const fingerprint=JSON.stringify(urls);
  // The same stream can be listed as both the primary and a quality variant.
  // Report it in both places but make only one network request.
  const pending=new Map<string,Promise<Probe>>();
  const probes=await Promise.all(urls.map(x=>{
    const key=x.mode+":"+x.url;
    if(!pending.has(key))pending.set(key,probe(x.url,x.mode));
    return pending.get(key)!;
  }));
  const healthy=probes.some(x=>x.kind==="healthy");
  const allDefinite=probes.length===0 || probes.every(x=>x.kind==="definite");
  const prior=Number(row.link_health_failures||0);
  const failed=allDefinite?(row.link_health_url===fingerprint?prior:0)+1:0;
  const status=healthy?"healthy":allDefinite?(failed>=3?"broken":"suspect") :
    row.link_health_status==="broken"&&row.link_health_url===fingerprint?"broken":"suspect";
  const reason=healthy?"تم تأكيد استجابة مصدر واحد على الأقل":allDefinite?
    (probes[0]?.reason||"لا يوجد أي رابط تشغيل مباشر أو بديل")+" — التحقق "+failed+" من 3":
    (probes[0]?.reason||"تعذر التحقق التلقائي؛ لا يُحجب المحتوى بسبب نتيجة غير حاسمة");
  const current=await rest(table,"select="+(table==="aseel_youtube_videos"?"youtube_url":"stream_url,stream_variants,youtube_url"+
    (table==="aseel_channels"?",official_url,playback_mode":""))+
    "&id=eq."+encodeURIComponent(String(row.id))+"&limit=1");
  if(!Array.isArray(current)||!current.length||JSON.stringify(mediaList(current[0],allSources))!==fingerprint)
    return {state:"skipped",title:row.title_ar};
  const payload={link_health_status:status,link_health_reason:reason.slice(0,300),
    link_health_failures:failed,link_health_checked_at:new Date().toISOString(),link_health_url:fingerprint};
  await rest(table,"id=eq."+encodeURIComponent(String(row.id)),{method:"PATCH",body:JSON.stringify(payload)});
  const sources=allSources?urls.map((x,index)=>{
    const result=probes[index];
    return {index,role:x.role,label:x.label,url:x.url,
      state:result.kind==="healthy"?"healthy":result.kind==="definite"?"broken":"suspect",
      reason:result.reason};
  }):undefined;
  return {state:status,title:row.title_ar,newlyHidden:status==="broken"&&row.link_health_status!=="broken",recovered:status==="healthy"&&row.link_health_status==="broken",sources};
}
async function updateSeries(){
  const series=await restAll("aseel_series","select=id,link_health_status&status=eq.published");
  const seasons=await restAll("aseel_seasons","select=id,series_id");
  const episodes=await restAll("aseel_episodes","select=id,season_id,status,link_health_status");
  for(const show of series||[]){
    const seasonIds=(seasons||[]).filter((x:Row)=>x.series_id===show.id).map((x:Row)=>x.id);
    const children=(episodes||[]).filter((x:Row)=>seasonIds.includes(x.season_id)&&x.status==="published");
    // Never call a series broken just because its episodes are still drafts.
    const result=!children.length?"unchecked":
      children.some((x:Row)=>x.link_health_status==="healthy")?"healthy":
      children.every((x:Row)=>x.link_health_status==="broken")?"broken":
      children.some((x:Row)=>x.link_health_status==="suspect")?"suspect":"unchecked";
    if(show.link_health_status!==result)await rest("aseel_series","id=eq."+encodeURIComponent(String(show.id)),{
      method:"PATCH",body:JSON.stringify({link_health_status:result,link_health_checked_at:new Date().toISOString(),
        link_health_reason:result==="broken"?"جميع الحلقات المنشورة معطوبة بعد الفحص":
          result==="healthy"?"توجد حلقات استجابت للفحص":
          result==="suspect"?"نتائج الفحص غير حاسمة؛ راجع الحلقات":
          children.length?"الحلقات المنشورة لم تفحص بعد":"لا توجد حلقات منشورة بعد"})
    });
  }
}

// Curated official-publisher discovery. Creative Commons is not inferred from a
// free-to-watch page. Only the official Blender Foundation PeerTube instance,
// exact known open-movie titles, and explicit redistributable licenses qualify.
const BLENDER_OPEN_MOVIES=[
  {title:"Big Buck Bunny",ar:"الأرنب الكبير باك",year:2008,min:10,genre:["رسوم متحركة","كوميديا"],rating:"all"},
  {title:"Sintel",ar:"سينتل",year:2010,min:15,genre:["رسوم متحركة","مغامرة","فانتازيا"],rating:"13+"},
  {title:"Tears of Steel",ar:"دموع من فولاذ",year:2012,min:12,genre:["خيال علمي","دراما"],rating:"13+"},
  {title:"Spring",ar:"الربيع",year:2019,min:8,genre:["رسوم متحركة","فانتازيا"],rating:"all"},
  {title:"Sprite Fright",ar:"رعب الغابة",year:2021,min:10,genre:["رعب","كوميديا","رسوم متحركة"],rating:"13+"},
  {title:"Charge",ar:"الشحنة",year:2022,min:4,genre:["خيال علمي","أكشن"],rating:"13+"},
  {title:"Wing It!",ar:"حلّق بها",year:2023,min:4,genre:["رسوم متحركة","كوميديا"],rating:"all"},
  {title:"Singularity",ar:"التفرّد",year:2026,min:7,genre:["خيال علمي","رسوم متحركة"],rating:"all"}
];
function normalizedName(s:string) {
  return String(s||"").toLocaleLowerCase("en").replace(/[^a-z0-9]+/g," ").trim();
}
function officialBlender(url:unknown) {
  const u=safeUrl(url);
  return u && (u.hostname==="video.blender.org" || u.hostname==="download.blender.org")?u:null;
}
async function blenderJson(url:string) {
  const u=officialBlender(url);
  if(!u||u.hostname!=="video.blender.org")throw Error("Publisher endpoint rejected");
  const response=await fetch(u.href,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error("Blender publisher API: "+response.status);
  return response.json();
}
function licenseAllowed(video:any):string {
  const label=String(video.licence?.label||video.license?.label||"").trim();
  if(!label||/(non.?commercial|no.?derivatives|all rights reserved|standard|copyright)/i.test(label))return "";
  if(/(?:CC[\s-]*BY|attribution)/i.test(label))return label.slice(0,100);
  return "";
}
function mediaCandidates(video:any) {
  const result:{url:string,label:string,rank:number}[]=[];
  for(const f of Array.isArray(video.files)?video.files:[]) {
    const url=String(f.fileUrl||"");
    if(!officialBlender(url)||!/\.(?:mp4|m4v)(?:[?#]|$)/i.test(url))continue;
    const height=Number(f.resolution?.id||0);
    result.push({url,label:height>0?height+"p":"MP4",rank:height||400});
  }
  for(const f of Array.isArray(video.streamingPlaylists)?video.streamingPlaylists:[]) {
    const url=String(f.playlistUrl||"");
    if(officialBlender(url)&&/\.m3u8(?:[?#]|$)/i.test(url))
      result.push({url,label:"HLS",rank:550});
  }
  return result.sort((a,b)=>Math.abs(a.rank-720)-Math.abs(b.rank-720)).slice(0,7);
}
async function discoverOpenMovies() {
  const summary:any={provider:"Blender Foundation official open movies",scanned:0,published:0,refreshed:0,skipped:[],errors:[]};
  // Bounded daily scan: two titles each run to avoid heavy public-service
  // requests, and continuously revisit the complete curated catalog.
  const cycle=Math.floor(Date.now()/43200000);
  for(let offset=0;offset<2;offset++){
    const spec=BLENDER_OPEN_MOVIES[(cycle*2+offset)%BLENDER_OPEN_MOVIES.length];
    summary.scanned++;
    try {
      const query="https://video.blender.org/api/v1/search/videos?search="+encodeURIComponent(spec.title)+"&count=20&isLocal=true";
      const list=await blenderJson(query);
      const rows=Array.isArray(list.data)?list.data:[];
      let matched=false;
      for(const entry of rows) {
        const title=normalizedName(entry.name);
        const expected=normalizedName(spec.title);
        if(!(title===expected||title===expected+" the movie"||title===expected+" full movie"||title===expected+" official film"))continue;
        if(Number(entry.duration||0)<spec.min*60*0.70)continue; // no trailers
        const id=entry.uuid;
        if(!/^[0-9a-f-]{36}$/i.test(String(id||"")))continue;
        const url="https://video.blender.org/videos/watch/"+id;
        const video=await blenderJson("https://video.blender.org/api/v1/videos/"+id);
        if(!video || video.isLocal===false || !licenseAllowed(video))continue;
        if(Number(video.duration||0)<spec.min*60*0.70)continue;
        const license=licenseAllowed(video);
        const options=mediaCandidates(video);
        let main="";
        for(const candidate of options) {
          const result=await probe(candidate.url,"stream");
          if(result.kind==="healthy"){main=candidate.url;break;}
        }
        if(!main){summary.skipped.push(spec.title+": no verified playable direct video");continue;}
        const poster=officialBlender("https://video.blender.org"+String(video.thumbnailPath||""));
        const backdrop=officialBlender("https://video.blender.org"+String(video.previewPath||""));
        const existing=await rest("aseel_movies","select=id,source_page_url,stream_url,license_reference,status,rights_status"+
          "&title_original=ilike."+encodeURIComponent(spec.title)+"&limit=4");
        if(Array.isArray(existing)&&existing.length) {
          const owned=existing.find((x:any)=>x.source_page_url===url && String(x.license_reference||"").includes("Blender Foundation official"));
          if(!owned){summary.skipped.push(spec.title+": existing title is managed manually");matched=true;break;}
          if(owned.stream_url!==main){
            await rest("aseel_movies","id=eq."+encodeURIComponent(String(owned.id)),{
              method:"PATCH",body:JSON.stringify({stream_url:main,link_health_status:"healthy",
                link_health_reason:"Fresh publisher source verified",link_health_failures:0,
                link_health_checked_at:new Date().toISOString(),updated_at:new Date().toISOString()})
            });
            summary.refreshed++;
          }else summary.skipped.push(spec.title+": already current");
          matched=true;break;
        }
        // Official publisher's explicit CC licence + stream reachability are
        // required; derived images are from the same publisher host.
        const record={
          title_ar:spec.ar,title_original:spec.title,release_year:spec.year,
          description: String(video.description||spec.title).replace(/<[^>]*>/g," ").slice(0,1000)+
            "\nالحقوق: Blender Foundation / Blender Studio — "+license+"؛ تُحفظ شارة الناشر وحقوق العمل.",
          poster_url:poster?.href||null,backdrop_url:backdrop?.href||null,
          category_id:"5bb35c4b-2757-4f56-9f1e-fa96d88c7314",
          duration_minutes:Math.max(1,Math.round(Number(video.duration)/60)),language_code:"en",
          country_code:"NL",quality:"Auto",stream_url:main,source_page_url:url,
          stream_variants:[],genre_tags:spec.genre,is_kids:false,age_rating:spec.rating,
          status:"published",rights_status:"approved",rights_holder:"Blender Foundation / Blender Studio",
          license_reference:"Blender Foundation official; "+license+"; "+url+
            "; https://studio.blender.org/remixing/",
          link_health_status:"healthy",link_health_reason:"Verified official publisher media and license",
          link_health_checked_at:new Date().toISOString(),imported_at:new Date().toISOString()
        };
        await rest("aseel_movies","",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify(record)});
        summary.published++;matched=true;break;
      }
      if(!matched)summary.skipped.push(spec.title+": exact full film and explicit license not found");
    }catch(e){summary.errors.push(spec.title+": "+String(e).slice(0,150));}
  }
  return summary;
}


const CAMINANDES_EPISODES=[
  {name:"Llama Drama",number:1,min:2,year:2013,ar:"دراما اللاما"},
  {name:"Gran Dillama",number:2,min:2,year:2013,ar:"جران ديلاما"},
  {name:"Llamigos",number:3,min:3,year:2016,ar:"لاميغوس"}
];
async function discoverLicensedCaminandes() {
  const output:any={series:"Caminandes",scanned:0,added:0,refreshed:0,skipped:[],errors:[]};
  const prepared:any[]=[];
  // Per-episode license can vary (CC BY / BY-SA); never assume the parent
  // series' general CC license grants more than the episode's own metadata.
  for(const episode of CAMINANDES_EPISODES) {
    output.scanned++;
    try {
      const list=await blenderJson("https://video.blender.org/api/v1/search/videos?search="+
        encodeURIComponent("Caminandes "+episode.name)+"&count=20&isLocal=true");
      for(const entry of Array.isArray(list.data)?list.data:[]) {
        const n=normalizedName(entry.name);
        if(!n.includes("caminandes") || !n.includes(normalizedName(episode.name)) ||
           /(trailer|teaser|behind|making|production)/i.test(n) ||
           Number(entry.duration||0)<episode.min*60*0.6)continue;
        if(!/^[0-9a-f-]{36}$/i.test(String(entry.uuid||"")))continue;
        const v=await blenderJson("https://video.blender.org/api/v1/videos/"+entry.uuid);
        const license=licenseAllowed(v);
        if(!license || v.isLocal===false || Number(v.duration||0)<episode.min*60*0.6)continue;
        let valid="";
        for(const opt of mediaCandidates(v)) {
          const checked=await probe(opt.url,"stream");
          if(checked.kind==="healthy"){valid=opt.url;break;}
        }
        if(!valid)continue;
        prepared.push({...episode,url:"https://video.blender.org/videos/watch/"+entry.uuid,
          stream:valid,license,description:String(v.description||"").replace(/<[^>]*>/g," ").slice(0,800),
          poster:officialBlender("https://video.blender.org"+String(v.thumbnailPath||""))?.href||null});
        break;
      }
      if(!prepared.find(x=>x.number===episode.number))
        output.skipped.push(episode.name+": no license-verified complete episode");
    }catch(e){output.errors.push(episode.name+": "+String(e).slice(0,120));}
  }
  if(!prepared.length)return output;
  const seriesRows=await rest("aseel_series",
    "select=id,license_reference&title_original=ilike.Caminandes&limit=3");
  let seriesId=String(seriesRows?.[0]?.id||"");
  if(seriesId&&!String(seriesRows[0].license_reference||"").includes("Blender Foundation official")){
    output.skipped.push("Caminandes is already owned/edited by an administrator");return output;
  }
  if(!seriesId) {
    const series=await rest("aseel_series","",{
      method:"POST",headers:{"Prefer":"return=representation"},
      body:JSON.stringify({title_ar:"كاميناندس",title_original:"Caminandes",
        description:"سلسلة أفلام رسوم متحركة قصيرة من Blender Studio عن مغامرات اللاما. كل حلقة تحت ترخيصها المسجل مع شارة الناشر الأصلي.",
        release_year:2013,category_id:"632885b8-3a5f-4f5f-b756-c23655b3d1b8",
        poster_url:prepared[0].poster,backdrop_url:prepared[0].poster,
        status:"published",rights_status:"approved",rights_holder:"Blender Foundation / Blender Studio",
        license_reference:"Blender Foundation official; episode-specific Creative Commons Attribution licenses; https://studio.blender.org/remixing/",
        country_code:"NL",language_code:"en",is_kids:false,age_rating:"all",
        genre_tags:["رسوم متحركة","كوميديا","مغامرة"],source_page_url:"https://studio.blender.org/films/"})
    });
    seriesId=String(series?.[0]?.id||"");
  }
  if(!seriesId)throw Error("Could not create verified Caminandes series");
  let seasons=await rest("aseel_seasons","select=id&series_id=eq."+seriesId+"&number=eq.1&limit=1");
  let seasonId=String(seasons?.[0]?.id||"");
  if(!seasonId) {
    seasons=await rest("aseel_seasons","",{
      method:"POST",headers:{"Prefer":"return=representation"},
      body:JSON.stringify({series_id:seriesId,number:1,title_ar:"الموسم الأول"})
    });
    seasonId=String(seasons?.[0]?.id||"");
  }
  if(!seasonId)throw Error("Could not create verified episode season");
  for(const ep of prepared) {
    const existing=await rest("aseel_episodes","select=id,source_page_url,stream_url,license_reference,status"+
      "&season_id=eq."+seasonId+"&number=eq."+ep.number+"&limit=1");
    if(existing?.length) {
      if(existing[0].source_page_url!==ep.url ||
        !String(existing[0].license_reference||"").includes("Blender Foundation official")) {
        output.skipped.push(ep.name+": manually controlled entry remains unchanged");continue;
      }
      if(existing[0].stream_url!==ep.stream){
        await rest("aseel_episodes","id=eq."+existing[0].id,{
          method:"PATCH",body:JSON.stringify({stream_url:ep.stream,
            link_health_status:"healthy",link_health_failures:0,
            link_health_reason:"Verified updated official publisher video",link_health_checked_at:new Date().toISOString()})
        });
        output.refreshed++;
      }
      continue;
    }
    await rest("aseel_episodes","",{
      method:"POST",headers:{"Prefer":"return=representation"},
      body:JSON.stringify({season_id:seasonId,number:ep.number,title_ar:ep.ar,
        description:ep.description+"\nBlender Foundation / Blender Studio — "+ep.license,
        poster_url:ep.poster,duration_minutes:ep.min,stream_url:ep.stream,
        stream_variants:[],rights_status:"approved",status:"published",
        license_reference:"Blender Foundation official; "+ep.license+"; "+ep.url,
        source_page_url:ep.url,genre_tags:["رسوم متحركة","كوميديا"],
        link_health_status:"healthy",link_health_reason:"Verified CC-licensed official publisher episode",
        link_health_checked_at:new Date().toISOString()})
    });
    output.added++;
  }
  return output;
}

Deno.serve(async(req:Request)=>{
  const cors = corsFor(req);
  const reply = (data: unknown, status=200) => new Response(JSON.stringify(data),
    {status, headers:{...HEADERS,...cors}});
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return reply({error:"POST only"},405);
  if(!SUPABASE_URL||!SERVICE)return reply({error:"خادم الفحص غير مهيأ"},503);
  const authorization=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const github=await verifyGithub(authorization);
  const admin=!github && await verifyAdmin(authorization);
  if(!github&&!admin)return reply({error:"غير مصرح: يتطلب تشغيل GitHub الموثق أو تسجيل مسؤول"},403);
  const body=await req.json().catch(()=>({}));
  // Authenticated GitHub Actions may read live-channel inventory for exact-ID
  // matching. This never exposes the catalogue or write operations publicly.
  if(body.mode==="licensed_discovery") {
    try{
      const movies=await discoverOpenMovies();
      const series=await discoverLicensedCaminandes().catch(e=>({errors:[String(e)],added:0,refreshed:0,scanned:0}));
      const errors=[...(movies.errors||[]),...(series.errors||[])];
      return reply({mode:"licensed_discovery",provider:"Blender Foundation official open media",movies,series,
        scanned:Number(movies.scanned||0)+Number(series.scanned||0),
        published:Number(movies.published||0)+Number(series.added||0),
        refreshed:Number(movies.refreshed||0)+Number(series.refreshed||0),errors},
        errors.length?207:200);
    }catch(e){return reply({error:"Licensed discovery failed: "+String(e).slice(0,160)},500);}
  }
  if(body.mode==="channel_inventory"){
    try{
      const channels=await restAll("aseel_channels",
        "select=id,title_ar,description,status,stream_url,stream_variants,official_url,youtube_url,playback_mode,link_health_status,link_health_failures,link_health_url");
      return reply({channels,count:channels.length});
    }catch(e){return reply({error:"Live inventory error: "+String(e).slice(0,150)},500);}
  }
  // Replace only a verified stream of the SAME channel. Never delete channels.
  // The hourly monitor hides confirmed broken media via health state/RLS.
  // A timeout, HTTP 403, regional block or rate limit is NEVER proof of death.
  if(body.mode==="channel_repair"){
    const raw=Array.isArray(body.actions)?body.actions:[];
    if(!raw.length||raw.length>12)return reply({error:"1..12 channel actions required"},400);
    const changes:Record<string,unknown>[]=[];
    const errors:string[]=[];
    let renewed=0,deleted=0,unchanged=0;
    const seen=new Set<string>();
    for(const entry of raw){
      const id=String(entry?.id||"");
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||seen.has(id)){
        errors.push("Invalid or repeated ID");continue;
      }
      seen.add(id);
      try{
        const rows=await rest("aseel_channels",
          "select=id,title_ar,description,status,stream_url,stream_variants,official_url,youtube_url,playback_mode,link_health_status,link_health_failures,link_health_url&id=eq."+encodeURIComponent(id)+"&limit=1");
        if(!Array.isArray(rows)||!rows.length){unchanged++;continue;}
        const row=rows[0] as Row;
        if(row.playback_mode==="official_link"||row.official_url||row.youtube_url){
          unchanged++;continue;
        }
        const before=String(row.stream_url||"");
        const newUrl=String(entry?.new_url||"");
        if(newUrl){
          const candidate=safeUrl(newUrl);
          if(!candidate){errors.push(id+": URL rejected");continue;}
          const variants=Array.isArray(row.stream_variants)?row.stream_variants:[];
          const wasSaved=variants.some((v:any)=>v?.url===newUrl);
          if(!wasSaved){
            const match=String(row.description||"").match(/IPTV(?:-org)?(?: source)? ID:\s*([A-Za-z0-9_.+-]+(?:@[A-Za-z0-9_.+-]+)?)/i);
            const expected=match?.[1]?.split("@")[0]||"";
            if(!expected||String(entry?.iptv_id||"")!==expected){
              errors.push(id+": IPTV source identity mismatch");continue;
            }
          }
          const checked=await probe(newUrl,"stream");
          if(checked.kind!=="healthy"){
            unchanged++;continue;
          }
          const latest=await rest("aseel_channels","select=stream_url&id=eq."+encodeURIComponent(id)+"&limit=1");
          if(!Array.isArray(latest)||latest[0]?.stream_url!==row.stream_url){
            errors.push(id+": source changed during verification");continue;
          }
          if(newUrl!==before){
            await rest("aseel_channels","id=eq."+encodeURIComponent(id),{
              method:"PATCH",body:JSON.stringify({stream_url:newUrl,link_health_status:"healthy",
                link_health_reason:"Verified replacement from exact IPTV broadcaster identity",
                link_health_failures:0,link_health_checked_at:new Date().toISOString(),
                link_health_url:JSON.stringify([{url:newUrl,mode:"stream",label:"الرابط الأساسي",role:"primary"}])})
            });
            renewed++;changes.push({id,name:row.title_ar,action:"renewed"});
          }else{unchanged++;}
          continue;
        }
        // No more hard deletion: a temporarily broken channel must retain
        // its title, poster, stream URLs and provider ID for automatic recovery.
        // The hourly 3-strike probe marks it "broken"; RLS then hides it from
        // viewers, and a later healthy probe exposes it again.
        unchanged++;
      }catch(e){errors.push(id+": "+String(e).slice(0,120));}
    }
    return reply({mode:"channel_repair",renewed,deleted,unchanged,changes,errors},
      errors.length?207:200);
  }
  // On-demand administrator-only checks for the exact saved episodes selected in Studio.
  // No automatic deletion; results are recorded using the existing 3-strike health policy.
  if(body.mode==="episodes"){
    if(!admin)return reply({error:"تسجيل دخول المسؤول مطلوب لفحص الحلقات المحددة"},403);
    const raw=Array.isArray(body.episode_ids)?body.episode_ids:[];
    const ids=[...new Set(raw.map((id:unknown)=>String(id)))];
    if(!ids.length||ids.length>12||ids.some((id:string)=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
      return reply({error:"اختر من حلقة واحدة إلى 12 حلقة صحيحة في الفحص الواحد"},400);
    try{
      const query="&id=in.("+ids.join(",")+")&limit="+ids.length;
      const rows=await rest("aseel_episodes","select=id,title_ar,stream_url,stream_variants,youtube_url,link_health_status,link_health_failures,link_health_checked_at,link_health_url"+query);
      const attempts=await Promise.allSettled(rows.map((row:Row)=>checkRow("aseel_episodes",row,true)));
      const latest=await rest("aseel_episodes","select=id,link_health_status,link_health_reason,link_health_checked_at,link_health_failures"+query);
      const errors:Record<string,string>={};
      const sources:Record<string,unknown[]>={};
      rows.forEach((row:Row,index:number)=>{
        const result=attempts[index];
        if(result.status==="rejected")errors[String(row.id)]=String(result.reason).slice(0,180);
        else {
          if(result.value.state==="skipped")errors[String(row.id)]="تغير رابط الحلقة أثناء الفحص؛ أعد الاختبار";
          else sources[String(row.id)]=result.value.sources||[];
        }
      });
      return reply({mode:"episodes",results:latest,sources,errors,requested:ids.length,found:rows.length},Object.keys(errors).length?207:200);
    }catch(e){
      return reply({error:"تعذر فحص الحلقات: "+String(e).slice(0,160)},500);
    }
  }
  // On-demand complete-section scanning: browser pages through its own accessible
  // catalogue; the Edge worker checks only exact administrator-selected IDs.
  if(body.mode==="items"){
    if(!admin)return reply({error:"تسجيل دخول مسؤول مطلوب للفحص الشامل"},403);
    const selected=String(body.table||"");
    const target=tables.find(t=>t.name===selected);
    if(!target)return reply({error:"نوع المكتبة غير معروف"},400);
    const raw=Array.isArray(body.item_ids)?body.item_ids:[];
    const ids=[...new Set(raw.map((id:unknown)=>String(id)))];
    if(!ids.length||ids.length>12||ids.some((id:string)=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
      return reply({error:"اختر من 1 إلى 12 معرف محتوى صالحًا"},400);
    try {
      const query="id=in.("+ids.join(",")+")&limit="+ids.length;
      const rows=await rest(target.name,"select="+target.fields+"&"+query);
      const attempts=await Promise.allSettled(rows.map((row:Row)=>checkRow(target.name,row,true)));
      const latest=await rest(target.name,"select=id,link_health_status,link_health_reason,link_health_checked_at,link_health_failures&"+query);
      const errors:Record<string,string>={};
      const sources:Record<string,unknown[]>={};
      rows.forEach((row:Row,index:number)=>{
        const value=attempts[index];
        if(value.status==="rejected") errors[String(row.id)]=String(value.reason).slice(0,160);
        else if(value.value.state==="skipped")errors[String(row.id)]="تغيرت الروابط أثناء الفحص؛ أعد المحاولة";
        else sources[String(row.id)]=value.value.sources||[];
      });
      return reply({mode:"items",table:target.name,results:latest,sources,errors,
        requested:ids.length,found:rows.length},Object.keys(errors).length?207:200);
    }catch(e){return reply({error:"تعذّر الفحص الشامل: "+String(e).slice(0,160)},500);}
  }
  // Draft sources imported by the November 5 playlist are probed without publication.
  // This changes health metadata only; publisher approval and accurate channel identity
  // remain separate explicit requirements.
  if(body.mode==="imported"){
    const before=typeof body.before==="string"?body.before:"";
    if(before && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(before)||isNaN(Date.parse(before))))
      return reply({error:"Invalid before timestamp"},400);
    const limit=Math.max(1,Math.min(24,Number(body.per_table)||24));
    const timeFilter=before?"&or=(link_health_checked_at.is.null,link_health_checked_at.lt."+encodeURIComponent(before)+")":"";
    try{
      const query="select="+tables[0].fields+"&status=eq.draft&description=like."+
        encodeURIComponent("IMPORT_2026_11_05_M3U_REVIEW*")+timeFilter+
        "&order=link_health_checked_at.asc.nullsfirst&limit="+limit;
      const rows=await rest("aseel_channels",query);
      const outcomes=await Promise.allSettled((rows||[]).map((row:Row)=>checkRow("aseel_channels",row,true)));
      const summary:Record<string,unknown>={authenticated:github?"github_oidc":"admin",mode:"imported",
        scanned:0,healthy:0,suspect:0,broken:0,skipped:0,newlyHidden:0,recovered:0,errors:[]};
      for(const item of outcomes){
        if(item.status==="rejected") {
          (summary.errors as string[]).push(String(item.reason).slice(0,160));continue;
        }
        summary.scanned=Number(summary.scanned)+1;
        summary[item.value.state]=Number(summary[item.value.state]||0)+1;
      }
      return reply(summary,(summary.errors as string[]).length?207:200);
    }catch(e){return reply({error:"Imported draft scan failed: "+String(e).slice(0,160)},500);}
  }
  if(body.mode==="series"){
    try{
      await updateSeries();
      return reply({authenticated:github?"github_oidc":"admin",mode:"series",ok:true,errors:[]});
    }catch(e){return reply({error:"Series aggregation failed: "+String(e).slice(0,150)},500);}
  }
  const selected=String(body.table||"");
  if(selected&&!tables.some(t=>t.name===selected))return reply({error:"Unknown table"},400);
  const before=typeof body.before==="string" ? body.before : "";
  if(before && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(before)||isNaN(Date.parse(before))))
    return reply({error:"Invalid before timestamp"},400);
  const requested=Math.max(1,Math.min(24,Number(body.per_table)||24));
  const summary:Record<string,unknown>={authenticated:github?"github_oidc":"admin",scanned:0,healthy:0,suspect:0,broken:0,skipped:0,newlyHidden:0,recovered:0,errors:[]};
  for(const tab of tables) {
    if(selected&&tab.name!==selected)continue;
    try {
      const timeFilter=before?"&or=(link_health_checked_at.is.null,link_health_checked_at.lt."+encodeURIComponent(before)+")":"";
      const rows=await rest(tab.name,"select="+tab.fields+"&status=eq.published"+timeFilter+"&order=link_health_checked_at.asc.nullsfirst&limit="+Math.min(requested,tab.max));
      const results=await Promise.allSettled((rows||[]).map((row:Row)=>checkRow(tab.name,row,true)));
      for(const item of results){
        if(item.status==="rejected"){(summary.errors as string[]).push(tab.name+": "+String(item.reason).slice(0,110));continue;}
        summary.scanned=Number(summary.scanned)+1;
        const key=item.value.state;
        summary[key]=Number(summary[key]||0)+1;
        if(item.value.newlyHidden) summary.newlyHidden=Number(summary.newlyHidden)+1;
        if(item.value.recovered) summary.recovered=Number(summary.recovered)+1;
      }
    }catch(e){(summary.errors as string[]).push(tab.name+": "+String(e).slice(0,170));}
  }
  if(!selected)try{await updateSeries()}catch(e){(summary.errors as string[]).push("series: "+String(e).slice(0,150));}
  return reply(summary,(summary.errors as string[]).length?207:200);
});
