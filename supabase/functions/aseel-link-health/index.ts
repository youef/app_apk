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
  if(/^\\d{10}$/.test(start) && /^\\d{1,6}$/.test(ttl) && url.searchParams.has("t")) {
    const s=Number(start), e=Number(ttl);
    if(s>=1500000000 && s<4000000000 && e>0 && e<=604800)return s+e;
  }
  if(/^\\d{10}$/.test(ttl) && Number(ttl)>=1500000000)return Number(ttl);
  for(const name of ["expires","exp","expiry"]) {
    const value=url.searchParams.get(name)||"";
    if(/^\\d{10}$/.test(value) && Number(value)>=1500000000)return Number(value);
  }
  return 0;
}
function approvedEmbedShape(url:URL):boolean {
  const host=url.hostname.toLowerCase(), path=url.pathname;
  return (host==="fushaar.world" && /^\\/embed\\/v-[a-z0-9]+\\/?$/i.test(path)) ||
    (host==="liiivideo.com" && /^\\/embed-[a-z0-9]+\\.html$/i.test(path)) ||
    (host==="hanerix.com" && /^\\/e\\/[a-z0-9_-]+\\/?$/i.test(path)) ||
    ((host==="1vid.xyz"||host==="www.1vid.xyz") && /^\\/embed-[a-z0-9_-]+\\.html$/i.test(path));
}
type Probe={kind:"healthy"|"definite"|"unknown",reason:string};
async function probe(raw:unknown,mode:"stream"|"official"|"youtube"):Promise<Probe> {
  let u=safeUrl(raw);
  if(!u)return {kind:"unknown",reason:"رابط غير آمن أو غير صالح للفحص التلقائي"};
  if(mode==="stream") {
    const exp=signedExpiry(u);
    if(exp && exp<=Math.floor(Date.now()/1000)+30)
      return {kind:"definite",reason:"انتهت صلاحية رابط تشغيل موقّع؛ يلزم تجديد موثّق من مزود الخدمة"};
    if(approvedEmbedShape(u))
      return {kind:"unknown",reason:"مشغل Embed: استجابة الصفحة لا تثبت أن الفيديو يعمل. اختبار تشغيل مطلوب"};
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
  if(body.mode==="channel_inventory"){
    try{
      const channels=await restAll("aseel_channels",
        "select=id,title_ar,description,status,stream_url,stream_variants,official_url,youtube_url,playback_mode,link_health_status,link_health_failures,link_health_url");
      return reply({channels,count:channels.length});
    }catch(e){return reply({error:"Live inventory error: "+String(e).slice(0,150)},500);}
  }
  // Replace only an already verified stream of the SAME channel, or remove a
  // channel after repeated definitive broken results and a fresh full audit.
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
        if(entry?.alternatives_checked!==true){unchanged++;continue;}
        const sources=mediaList(row,true);
        if(sources.some(s=>s.mode!=="stream")){unchanged++;continue;}
        if(!sources.length){
          await rest("aseel_channels","id=eq."+encodeURIComponent(id),{method:"DELETE"});
          deleted++;changes.push({id,name:row.title_ar,action:"deleted",reason:"No media sources"});continue;
        }
        // For permanent deletion all existing sources must be definitively
        // 404/410 or invalid HTML; the saved 3-strike result must still match.
        if(row.link_health_status!=="broken"||Number(row.link_health_failures||0)<3 ||
          row.link_health_url!==JSON.stringify(sources)){unchanged++;continue;}
        const checks=await Promise.all(sources.map(s=>probe(s.url,"stream")));
        if(!checks.every(p=>p.kind==="definite")){unchanged++;continue;}
        const latest=await rest("aseel_channels",
          "select=stream_url,link_health_status,link_health_failures,link_health_url&id=eq."+encodeURIComponent(id)+"&limit=1");
        if(!Array.isArray(latest)||!latest.length||
          latest[0].stream_url!==row.stream_url||latest[0].link_health_status!=="broken"||
          Number(latest[0].link_health_failures||0)<3||
          latest[0].link_health_url!==row.link_health_url){unchanged++;continue;}
        await rest("aseel_channels","id=eq."+encodeURIComponent(id),{method:"DELETE"});
        deleted++;changes.push({id,name:row.title_ar,action:"deleted",reason:"Three-strike confirmed dead sources"});
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
