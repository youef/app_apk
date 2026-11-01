// Al Ezz TV metadata inspector. Authorized admins only, no media downloading.
const PROJECT=Deno.env.get("SUPABASE_URL")||"";
const KEY=Deno.env.get("SUPABASE_ANON_KEY")||"";
const ALLOWED=["qrmzi.buzz","qrmzi.tv","archive.org","blender.org","supersimple.com","youtube.com","youtu.be","vimeo.com","anaplayer.online","mdn.github.io","developer.mozilla.org"];
const origin="https://youef.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Vary":"Origin"};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store",...cors}});
function safeUrl(input){
 try{
  const u=new URL(String(input||""));
  if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443"||u.hostname.length>190)return null;
  if(!ALLOWED.some(domain=>u.hostname===domain||u.hostname.endsWith("."+domain)))return null;
  return u;
 }catch{return null;}
}
function decode(str){
 return String(str||"").replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);/gi,(_,m)=>{
 if(m[0]==="#"){try{return String.fromCodePoint(m[1].toLowerCase()==="x"?parseInt(m.slice(2),16):parseInt(m.slice(1),10));}catch{return "";}}
 return {amp:"&",quot:'"',apos:"'",lt:"<",gt:">",nbsp:" "}[m.toLowerCase()]||"";
 }).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
}
function attributes(tag){
 const x={};
 for(const m of tag.matchAll(/([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))x[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);
 return x;
}
function resolved(v,base){
 try{const u=new URL(v,base);return u.protocol==="https:"&&!u.username&&!u.password?u.href:"";}catch{return "";}
}
function validVideo(url){try{return /\.(mp4|m3u8|mpd)(?:$|[?#])/i.test(new URL(url).pathname);}catch{return false;}}
function parsePage(html,base){
 const meta={};for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const a=attributes(m[0]);const k=(a.property||a.name||a.itemprop||"").toLowerCase();if(k&&a.content&&!meta[k])meta[k]=a.content;}
 const t=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
 let title=decode(meta["og:title"]||meta["twitter:title"]||t?.[1]||"");
 let description=decode(meta["og:description"]||meta.description||"");
 const poster=resolved(meta["og:image"]||meta["twitter:image"]||"",base);
 let year=null, duration=null, original="";
 for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
   try{
     const raw=JSON.parse(m[1]);const nodes=Array.isArray(raw)?raw:raw["@graph"]||[raw];
     for(const obj of nodes){if(!obj||typeof obj!=="object")continue;
       const typ=Array.isArray(obj["@type"])?obj["@type"].join(","):obj["@type"]||"";
       if(!/Movie|VideoObject|TVEpisode|CreativeWork/i.test(typ))continue;
       if(!title)title=decode(obj.name||"");
       if(!description)description=decode(obj.description||"");
       if(!original)original=decode(obj.alternateName||"");
       const date=String(obj.datePublished||obj.uploadDate||"").match(/\b(?:19|20)\d{2}\b/);if(date)year=Number(date[0]);
       const iso=String(obj.duration||"").match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);if(iso)duration=(Number(iso[1]||0)*60+Number(iso[2]||0))||null;
     }
   }catch{}
 }
 if(!year){const match=String(title+" "+meta["article:published_time"]).match(/\b(19\d{2}|20\d{2})\b/);year=match?Number(match[1]):null;}
 const links=[], seen=new Set();
 function add(value,kind){const url=resolved(decode(value),base);if(!url||seen.has(url)||url.length>2000||links.length>=40)return;seen.add(url);links.push({url,kind});}
 for(const match of html.matchAll(/<(?:iframe|video|source|a)\b[^>]*>/gi)){
   const attr=attributes(match[0]);const kind=/^<iframe/i.test(match[0])?"embed":/^<a\b/i.test(match[0])?"page":"media";
   const candidate=attr.src||attr["data-src"]||attr.href;
   if(!candidate)continue;
   if(kind==="embed"||validVideo(resolved(candidate,base)))add(candidate,kind);
 }
 for(const m of html.matchAll(/https?:\\?\/\\?\/[^\s"'<>\\]{8,350}?\.(?:mp4|m3u8|mpd)(?:\?[^\s"'<>\\]{0,120})?/gi)){
   const value=m[0].replace(/\\\//g,"/").replace(/&amp;/g,"&");add(value,"media");
 }
 return {title_ar:title.slice(0,250),title_original:original.slice(0,250),description:description.slice(0,1600),poster_url:poster||null,backdrop_url:poster||null,release_year:year,duration_minutes:duration,source_page_url:base,links};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return response({error:"طريقة طلب غير مدعومة"},405);
 const auth=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S+$/i.test(auth))return response({error:"سجّل دخول المسؤول أولًا"},401);
 if(!PROJECT||!KEY)return response({error:"إعدادات خادم الفحص غير مكتملة"},500);
 try{
  const current=await fetch(PROJECT+"/auth/v1/user",{headers:{apikey:KEY,authorization:auth},signal:AbortSignal.timeout(5000)});
  if(!current.ok)return response({error:"جلسة المستخدم غير صالحة"},401);
  const user=await current.json();
  if(!user.id)return response({error:"تعذر التحقق من الهوية"},401);
  const role=await fetch(PROJECT+"/rest/v1/aseel_admins?select=user_id,active&user_id=eq."+encodeURIComponent(user.id)+"&active=eq.true",{headers:{apikey:KEY,authorization:auth},signal:AbortSignal.timeout(5000)});
  if(!role.ok||!(await role.json()).length)return response({error:"الحساب ليس مسؤولًا معتمدًا"},403);
  const body=await req.json();
  // End-to-end diagnostic that validates login, admin permission, CORS and JSON parsing without an external host.
  if(body.mode==="selftest"){
    const fixture='<html><head><title>اختبار جلب بيانات العز</title><meta property="og:image" content="https://archive.org/poster.jpg"><meta name="description" content="نجح الاتصال بالخادم"></head><body><video src="https://archive.org/download/sample.mp4"></video></body></html>';
    return response({data:parsePage(fixture,"https://archive.org/details/sample"),diagnostics:{service:"online",authenticated:true,admin:true,externalFetch:false}});
  }
  const url=safeUrl(body.url);
  if(!url)return response({error:"مصدر الرابط ليس ضمن المواقع المسموح بفحصها آليًا. استخدم HTML اليدوي أو مصدرًا معتمدًا.",error_code:"UNSUPPORTED_HOST"},400);
  let address=url;let fetched=null;let redirects=0;
  // Follow at most 3 redirects; EVERY destination must pass the HTTPS hostname allowlist, avoiding SSRF.
  for(let step=0;step<4;step++){
    fetched=await fetch(address.href,{method:"GET",redirect:"manual",headers:{"User-Agent":"Mozilla/5.0 (compatible; AlEzzTVMeta/2.0)","Accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"},signal:AbortSignal.timeout(12000)});
    if(fetched.status>=300&&fetched.status<400){
      const location=fetched.headers.get("location")||"";
      const target=location?safeUrl(new URL(location,address).href):null;
      if(!target)return response({error:"الموقع حوّل الطلب إلى رابط غير مسموح. افتح الصفحة مباشرة واستخرج رابطها النهائي.",error_code:"REDIRECT_BLOCKED"},422);
      address=target;redirects++;continue;
    }
    break;
  }
  if(!fetched || fetched.status>=300&&fetched.status<400)return response({error:"عدد تحويلات الصفحة أكبر من الحد. ضع الرابط النهائي مباشرة.",error_code:"REDIRECT_LIMIT"},422);
  if(!fetched.ok){
    let error="فشل جلب الصفحة من المصدر (HTTP "+fetched.status+").";
    if(fetched.status===403||fetched.status===429)error+=" الموقع يمنع القراءة الآلية؛ افتحه من متصفحك واستخدم لصق HTML.";
    else if(fetched.status>=500)error+=" خادم الموقع لا يستجيب بشكل صحيح؛ جرّب لاحقًا أو أدخل البيانات يدويًا.";
    return response({error,error_code:"REMOTE_HTTP_"+fetched.status,diagnostics:{http_status:fetched.status,redirects}},422);
  }
  const type=fetched.headers.get("content-type")||"";
  if(!/text\/html|application\/xhtml\+xml/i.test(type))return response({error:"الصفحة ليست HTML ("+type.slice(0,70)+"). أدخل رابط صفحة الفيلم وليس رابط المشغّل.",error_code:"NOT_HTML"},422);
  if(Number(fetched.headers.get("content-length")||0)>1100000)return response({error:"حجم الصفحة أكبر من الحد"},413);
  const reader=fetched.body?.getReader();if(!reader)return response({error:"تعذر قراءة محتوى الصفحة"},422);
  const chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1100000)break;chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  if(size>1100000)return response({error:"حجم الصفحة أكبر من الحد"},413);
  const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  const html=new TextDecoder().decode(buffer);
  const data=parsePage(html,address.href);
  return response({data,diagnostics:{http_status:fetched.status,redirects,html_bytes:size,found_links:data.links.length},note:"الفحص يقرأ HTML الظاهر فقط، وليس الفيديو المشفر أو المشغل الديناميكي. لا يثبت حقوق البث."});
 }catch(e){return response({error:e instanceof Error&&e.name==="TimeoutError"?"انتهت مهلة فحص المصدر":"تعذر فحص الصفحة آليًا؛ جرّب إدخال البيانات يدويًا."},422);}
});
