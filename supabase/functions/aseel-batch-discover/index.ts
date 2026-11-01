// Al Ezz TV: admin-only bulk discovery and playable media verification.
const API=Deno.env.get("SUPABASE_URL")||"",KEY=Deno.env.get("SUPABASE_ANON_KEY")||"";
const CORS={"Access-Control-Allow-Origin":"https://youef.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json; charset=utf-8"};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:CORS});
const defaultHosts=["archive.org","blender.org","mdn.github.io","developer.mozilla.org","media.w3.org"];
function safe(input,hosts){
 try{const u=new URL(String(input||"")),h=u.hostname.toLowerCase();
 if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443")||u.href.length>2048||h.includes(":")||/^[0-9.]+$/.test(h)||["localhost","metadata.google.internal"].includes(h)||/\.(local|internal|localhost|test|invalid|onion)$/.test(h))return null;
 return hosts.some(x=>h===x||h.endsWith("."+x))?u:null;}catch{return null;}
}
const clean=x=>String(x||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
const att=(s,k)=>{const m=s.match(new RegExp("(?:\\s|^)"+k+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i"));return clean(m?.[1]||m?.[2]||m?.[3]||"");};
function joined(value,base,hosts){try{return safe(new URL(value,base).href,hosts)?.href||""}catch{return "";}}
function seq(s){
 let a=String(s||"").match(/\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i);if(a)return [Number(a[1]),Number(a[2])];
 a=String(s||"").match(/(?:الموسم|season)\D{0,5}(\d{1,2})[\s\S]{0,80}(?:الحلقة|episode|ep)\D{0,5}(\d{1,3})/i);if(a)return [Number(a[1]),Number(a[2])];
 a=String(s||"").match(/(?:الحلقة|الحلقه|episode|ep)[\s._\/#-]*(\d{1,3})/i);return a?[1,Number(a[1])]:null;
}
function media(s){return /\.(mp4|m4v|mov|webm|m3u8|mpd)(?:[?#]|$)/i.test(s);}
async function bytes(res,max){
 const reader=res.body?.getReader();if(!reader)throw Error("EMPTY_BODY");
 let size=0,parts=[];try{while(size<=max){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max)throw Error("TOO_LARGE");parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const out=new Uint8Array(size);let j=0;for(const p of parts){out.set(p,j);j+=p.length;}return out;
}
async function request(input,hosts,max=550000){
 let u=safe(input,hosts);if(!u)throw Error("HOST_NOT_VERIFIED");
 for(let i=0;i<4;i++){
  const r=await fetch(u.href,{redirect:"manual",headers:{"User-Agent":"AlEzzTV-LinkInspector/1.0","Accept":"*/*",...(max<10000?{"Range":"bytes=0-2047"}:{})},signal:AbortSignal.timeout(8500)});
  if(r.status>=300&&r.status<400){const loc=r.headers.get("location");const next=loc?safe(new URL(loc,u).href,hosts):null;await r.body?.cancel().catch(()=>{});if(!next)throw Error("REDIRECT_HOST_NOT_VERIFIED");u=next;continue;}
  if(!r.ok)throw Error("HTTP_"+r.status);
  if(Number(r.headers.get("content-length")||0)>max&&max>=10000)throw Error("PAGE_TOO_LARGE");
  return {url:u.href,type:r.headers.get("content-type")||"",data:await bytes(r,max)};
 }
 throw Error("REDIRECT_LIMIT");
}
const decode=r=>new TextDecoder().decode(r.data);
function inspectPage(text,url,hosts){
 const metas={};for(const m of text.matchAll(/<meta\b[^>]*>/gi)){const t=m[0],k=att(t,"property")||att(t,"name");if(k)metas[k.toLowerCase()]=att(t,"content");}
 const title=clean(metas["og:title"]||text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"").slice(0,250);
 const description=clean(metas["og:description"]||metas["description"]||"").slice(0,1400);
 const poster=joined(metas["og:image"]||metas["twitter:image"]||"",url,hosts);
 const streams=new Set(),pages=[];
 const add=s=>{const v=joined(s,url,hosts);if(v&&media(v))streams.add(v);};
 for(const t of text.match(/<(?:video|source|iframe|a)\b[^>]*>/gi)||[])add(att(t,"src")||att(t,"data-src")||att(t,"href"));
 for(const x of text.matchAll(/https:\/\/[^\s"'<>\\]{3,700}\.(?:mp4|m3u8|webm|mpd)(?:\?[^\s"'<>\\]{0,180})?/gi))add(x[0]);
 for(const m of text.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)){
  const tag=m[0],url2=joined(att(tag.match(/^<a\b[^>]*>/i)?.[0]||"","href"),url,hosts);
  const n=seq(clean(tag)+" "+url2);if(url2&&n&&url2!==url&&!media(url2))pages.push({url:url2,title:clean(tag).slice(0,180),season:n[0],number:n[1]});
 }
 // JSON-LD's contentUrl usually names an explicit, public direct media file.
 for(const m of text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{const walk=(v,n=0)=>{if(!v||typeof v!=="object"||n>4)return;if(Array.isArray(v)){v.slice(0,100).forEach(x=>walk(x,n+1));return;}if(v.contentUrl)add(v.contentUrl);if(v.video)walk(v.video,n+1);for(const k of ["@graph","episode","hasPart","itemListElement"])if(v[k])walk(v[k],n+1);};walk(JSON.parse(m[1]));}catch{}
 }
 return {title,description,poster,streams:[...streams].slice(0,8),pages:[...new Map(pages.map(x=>[x.url,x])).values()].slice(0,120)};
}
async function archiveList(target,hosts){
 const u=new URL(target),match=u.pathname.match(/^\/details\/([^/]+)/);if(!u.hostname.endsWith("archive.org")||!match)return [];
 try{
 const r=await request("https://archive.org/metadata/"+encodeURIComponent(match[1]),hosts,1300000);
 const j=JSON.parse(decode(r)),files=Array.isArray(j.files)?j.files:[];
 return files.filter(f=>typeof f.name==="string"&&media(f.name)&&!/_preview|_thumb/i.test(f.name)).slice(0,120).map((f,i)=>{
  const n=seq(f.name);return {url:"https://archive.org/download/"+encodeURIComponent(match[1])+"/"+f.name.split("/").map(encodeURIComponent).join("/"),title:clean(f.name.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ")).slice(0,180),season:n?.[0]||1,number:n?.[1]||i+1,media_url:"https://archive.org/download/"+encodeURIComponent(match[1])+"/"+f.name.split("/").map(encodeURIComponent).join("/")};
 });}catch{return [];}
}
async function check(link,hosts){
 try{
  if(!media(link))throw Error("NOT_DIRECT_MEDIA");
  const r=await request(link,hosts,4096),txt=decode(r),p=new URL(r.url).pathname.toLowerCase();
  if(/text\/html/i.test(r.type)||/^\s*(?:<!doctype|<html|<script)/i.test(txt))throw Error("HTML_NOT_MEDIA");
  if(p.endsWith(".m3u8")){
   if(!txt.trimStart().startsWith("#EXTM3U")||!/#EXTINF|#EXT-X-STREAM-INF|#EXT-X-TARGETDURATION/.test(txt))throw Error("INVALID_HLS");
   const line=txt.split(/\r?\n/).map(s=>s.trim()).find(s=>s&&!s.startsWith("#"));
   if(line&&/\.m3u8(?:[?#]|$)/.test(line)){const child=joined(line,r.url,hosts);if(!child||!decode(await request(child,hosts,4096)).trimStart().startsWith("#EXTM3U"))throw Error("INVALID_HLS_VARIANT");}
  }else if(p.endsWith(".mpd")){if(!/<MPD[\s>]/i.test(txt))throw Error("INVALID_DASH");}
  else if(/\.(mp4|m4v|mov)$/.test(p)){if(new TextDecoder().decode(r.data.slice(4,8))!=="ftyp"&&!/video\/(mp4|quicktime)/i.test(r.type))throw Error("INVALID_MP4");}
  else if(p.endsWith(".webm")){if(!(r.data[0]===26&&r.data[1]===69&&r.data[2]===223&&r.data[3]===163)&&!/video\/webm/i.test(r.type))throw Error("INVALID_WEBM");}
  return {ok:true,url:r.url,format:p.split(".").pop()?.toUpperCase()||"VIDEO"};
 }catch(e){return {ok:false,url:link,reason:String(e instanceof Error?e.message:e).slice(0,100)};}
}
async function allowed(auth){
 const r=await fetch(API+"/rest/v1/aseel_content_sources?select=source_url,license_reference&verified=eq.true&limit=200",{headers:{apikey:KEY,authorization:auth},signal:AbortSignal.timeout(6000)});
 const list=r.ok?await r.json():[];
 const extra=(Array.isArray(list)?list:[]).filter(x=>x.license_reference).map(x=>{try{return new URL(x.source_url).hostname.toLowerCase()}catch{return ""}}).filter(Boolean);
 return [...new Set([...defaultHosts,...extra])];
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
 const auth=req.headers.get("authorization")||"";if(!/^Bearer\s+\S+$/i.test(auth))return json({error:"LOGIN_REQUIRED"},401);
 if(!API||!KEY)return json({error:"SERVER_CONFIGURATION_MISSING"},500);
 try{
  const u=await fetch(API+"/auth/v1/user",{headers:{apikey:KEY,authorization:auth},signal:AbortSignal.timeout(6000)});
  if(!u.ok)return json({error:"SESSION_INVALID"},401);
  const user=await u.json();if(!user?.id)return json({error:"SESSION_INVALID"},401);
  const a=await fetch(API+"/rest/v1/aseel_admins?select=user_id&active=eq.true&user_id=eq."+encodeURIComponent(user.id),{headers:{apikey:KEY,authorization:auth},signal:AbortSignal.timeout(6000)});
  if(!a.ok||!(await a.json()).length)return json({error:"ADMIN_ONLY"},403);
  const b=await req.json(),hosts=await allowed(auth),target=safe(b.url,hosts);
  if(!target)return json({error:"SOURCE_NOT_APPROVED",note:"يجب أن ينتمي الرابط لمصدر HTTPS موثّق في مصادر الحقوق."},400);
  if(b.action==="discover"){
   let page={title:"",description:"",poster:"",streams:[],pages:[]};
   if(!media(target.href)){const r=await request(target.href,hosts);if(!/text\/html|application\/xhtml/i.test(r.type))return json({error:"NOT_HTML"},422);page=inspectPage(decode(r),r.url,hosts);}
   const archived=await archiveList(target.href,hosts),listing=archived.length?archived:page.pages;
   const type=b.kind==="series"||(b.kind!=="movie"&&listing.length>1)?"series":"movie";
   const items=type==="series"?listing.length?listing:[{url:target.href,title:page.title,season:1,number:1}]:[{url:target.href,title:page.title||"فيلم جديد",season:1,number:1,media_url:media(target.href)?target.href:undefined}];
   return json({type,title:page.title||"عمل جديد",description:page.description,poster_url:page.poster,items:items.slice(0,120),discovered:items.length});
  }
  if(b.action!=="inspect")return json({error:"ACTION_INVALID"},400);
  const direct=b.media_url?safe(b.media_url,hosts):null;let meta={title:"",description:"",poster:"",streams:[]};
  const links=[];if(direct&&media(direct.href))links.push(direct.href);
  if(media(target.href))links.push(target.href);
  else{const r=await request(target.href,hosts);if(!/text\/html|application\/xhtml/i.test(r.type))return json({ok:false,reason:"NOT_HTML"});meta=inspectPage(decode(r),r.url,hosts);links.push(...meta.streams);}
  const tests=[];
  for(const link of [...new Set(links)].slice(0,8)){const v=await check(link,hosts);tests.push(v);if(tests.filter(x=>x.ok).length>=4)break;}
  const good=tests.filter(x=>x.ok);
  return json({ok:!!good.length,url:target.href,title:meta.title||String(b.title||"").slice(0,250),description:meta.description,poster_url:meta.poster,stream_url:good[0]?.url||"",variants:good.slice(1).map(x=>({label:x.format,url:x.url})),checks:tests,reason:good.length?"":"NO_VERIFIED_VIDEO",checked_at:new Date().toISOString()});
 }catch(e){return json({error:String(e instanceof Error?e.message:e).slice(0,160)},422);}
});