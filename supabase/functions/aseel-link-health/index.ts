// Al Ezz TV — link health agent. GitHub OIDC or authenticated admin only.
// Never download entire media or accept private-network destinations.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const TRUSTED_ORIGIN = "https://youef.github.io";
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const cors = { "Access-Control-Allow-Origin": TRUSTED_ORIGIN, "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type", "Vary": "Origin" };
const reply = (data: unknown, status=200) => new Response(JSON.stringify(data), {status, headers:{...HEADERS,...cors}});
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
  {name:"aseel_channels",fields:"id,title_ar,stream_url,stream_variants,youtube_url,official_url,playback_mode,link_health_status,link_health_failures,link_health_checked_at,link_health_url",max:18},
  {name:"aseel_movies",fields:"id,title_ar,stream_url,stream_variants,youtube_url,link_health_status,link_health_failures,link_health_checked_at,link_health_url",max:8},
  {name:"aseel_episodes",fields:"id,title_ar,stream_url,stream_variants,youtube_url,link_health_status,link_health_failures,link_health_checked_at,link_health_url",max:8}
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
type Probe={kind:"healthy"|"definite"|"unknown",reason:string};
async function probe(raw:unknown,mode:"stream"|"official"|"youtube"):Promise<Probe> {
  if(mode==="youtube")return {kind:"unknown",reason:"مقاطع يوتيوب تحتاج تحققًا من المشغل ولا تُحجب بمجرد رفض الفحص الآلي"};
  let u=safeUrl(raw);
  if(!u)return {kind:"unknown",reason:"رابط غير آمن أو غير صالح للفحص التلقائي"};
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
      if(mode==="official")return {kind:"healthy",reason:"صفحة المصدر استجابت بنجاح"};
      if(isHls||isDash){
        const text=(await response.text()).slice(0,8000).trimStart();
        const valid=isHls ? text.startsWith("#EXTM3U") : /<MPD\b/i.test(text);
        if(valid)return {kind:"healthy",reason:"تم التحقق من ملف البث"};
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
function mediaList(row:Row){
  const mode=row.playback_mode==="official_link"?"official":"stream";
  if(mode==="official")return [{url:String(row.official_url||""),mode:"official" as const}];
  const urls=[row.stream_url,...(Array.isArray(row.stream_variants)?row.stream_variants.map((v:any)=>v&&v.url):[])].filter(Boolean);
  const distinct=[...new Set(urls.map(String))];
  if(distinct.length)return distinct.slice(0,4).map(url=>({url,mode:"stream" as const}));
  if(row.youtube_url)return [{url:String(row.youtube_url),mode:"youtube" as const}];
  return [];
}
async function checkRow(table:string,row:Row){
  const urls=mediaList(row);
  const fingerprint=JSON.stringify(urls);
  const probes=await Promise.all(urls.map(x=>probe(x.url,x.mode)));
  const healthy=probes.some(x=>x.kind==="healthy");
  const allDefinite=probes.length>0 && probes.every(x=>x.kind==="definite");
  const prior=Number(row.link_health_failures||0);
  const failed=allDefinite?(row.link_health_url===fingerprint?prior:0)+1:0;
  const status=healthy?"healthy":allDefinite?(failed>=3?"broken":"suspect") :
    row.link_health_status==="broken"&&row.link_health_url===fingerprint?"broken":"suspect";
  const reason=healthy?"تم تأكيد استجابة مصدر واحد على الأقل":allDefinite?
    (probes[0]?.reason||"تعذر تشغيل المصدر")+" — التحقق "+failed+" من 3":
    (probes[0]?.reason||"تعذر التحقق التلقائي؛ لا يُحجب المحتوى بسبب نتيجة غير حاسمة");
  // Re-read the source before writing; never apply stale probe after admin edits.
  const current=await rest(table,"select=stream_url,stream_variants,youtube_url"+
    (table==="aseel_channels"?",official_url,playback_mode":"")+
    "&id=eq."+encodeURIComponent(String(row.id))+"&limit=1");
  if(!Array.isArray(current)||!current.length||JSON.stringify(mediaList(current[0]))!==fingerprint)
    return {state:"skipped",title:row.title_ar};
  const payload={link_health_status:status,link_health_reason:reason.slice(0,300),
    link_health_failures:failed,link_health_checked_at:new Date().toISOString(),link_health_url:fingerprint};
  await rest(table,"id=eq."+encodeURIComponent(String(row.id)),{method:"PATCH",body:JSON.stringify(payload)});
  return {state:status,title:row.title_ar};
}
async function updateSeries(){
  const series=await rest("aseel_series","select=id,link_health_status&status=eq.published&limit=200");
  const seasons=await rest("aseel_seasons","select=id,series_id&limit=500");
  const episodes=await rest("aseel_episodes","select=season_id,status,link_health_status&limit=1000");
  for(const show of series||[]){
    const seasonIds=(seasons||[]).filter((x:Row)=>x.series_id===show.id).map((x:Row)=>x.id);
    const children=(episodes||[]).filter((x:Row)=>seasonIds.includes(x.season_id)&&x.status==="published");
    if(!children.length)continue;
    const result=children.every((x:Row)=>x.link_health_status==="broken")?"broken":
      children.some((x:Row)=>x.link_health_status==="healthy")?"healthy":"unchecked";
    if(show.link_health_status!==result)await rest("aseel_series","id=eq."+encodeURIComponent(String(show.id)),{
      method:"PATCH",body:JSON.stringify({link_health_status:result,link_health_checked_at:new Date().toISOString(),
        link_health_reason:result==="broken"?"جميع الحلقات المنشورة غير صالحة":result==="healthy"?"توجد حلقات قابلة للتشغيل":null})
    });
  }
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return reply({error:"POST only"},405);
  if(!SUPABASE_URL||!SERVICE)return reply({error:"خادم الفحص غير مهيأ"},503);
  const authorization=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const github=await verifyGithub(authorization);
  const admin=!github && await verifyAdmin(authorization);
  if(!github&&!admin)return reply({error:"غير مصرح: يتطلب تشغيل GitHub الموثق أو تسجيل مسؤول"},403);
  const body=await req.json().catch(()=>({}));
  const requested=Math.max(1,Math.min(12,Number(body.per_table)||10));
  const summary:Record<string,unknown>={authenticated:github?"github_oidc":"admin",scanned:0,healthy:0,suspect:0,broken:0,skipped:0,errors:[]};
  for(const tab of tables) {
    try {
      const rows=await rest(tab.name,"select="+tab.fields+"&status=eq.published&order=link_health_checked_at.asc.nullsfirst&limit="+Math.min(requested,tab.max));
      const results=await Promise.allSettled((rows||[]).map((row:Row)=>checkRow(tab.name,row)));
      for(const item of results){
        if(item.status==="rejected"){(summary.errors as string[]).push(tab.name+": "+String(item.reason).slice(0,110));continue;}
        summary.scanned=Number(summary.scanned)+1;
        const key=item.value.state;
        summary[key]=Number(summary[key]||0)+1;
      }
    }catch(e){(summary.errors as string[]).push(tab.name+": "+String(e).slice(0,170));}
  }
  try{await updateSeries()}catch(e){(summary.errors as string[]).push("series: "+String(e).slice(0,150));}
  return reply(summary,(summary.errors as string[]).length?207:200);
});
