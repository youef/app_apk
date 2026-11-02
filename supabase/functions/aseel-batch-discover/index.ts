// Al Ezz TV: admin-only bulk discovery and playable media verification.
const API=Deno.env.get("SUPABASE_URL")||"",KEY=Deno.env.get("SUPABASE_ANON_KEY")||"";
const CORS={"Access-Control-Allow-Origin":"https://youef.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json; charset=utf-8"};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:CORS});
const defaultHosts=["archive.org","blender.org","mdn.github.io","developer.mozilla.org","media.w3.org"];
function safe(input,hosts){
 try{const u=new URL(String(input||"")),h=u.hostname.toLowerCase();
 if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443")||u.href.length>2048||h.includes(":")||/^[0-9.]+$/.test(h))return null;
 // Only ordinary public DNS hostnames; no IP-literals, internal zones or credentials.
 if(!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h))return null;
 if(/\.(?:local|localdomain|internal|localhost|test|invalid|onion|arpa|lan|home|corp|intranet|example)$/.test(h))return null;
 return u;}catch{return null;}
}
const clean=x=>String(x||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
const att=(s,k)=>{const m=s.match(new RegExp("(?:\\s|^)"+k+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i"));return clean(m?.[1]||m?.[2]||m?.[3]||"");};
function joined(value,base,hosts){if(!value||!String(value).trim())return "";try{return safe(new URL(value,base).href,hosts)?.href||""}catch{return "";}}
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
 let u=await approveDestination(input,hosts);
 for(let i=0;i<4;i++){
  const r=await fetch(u.href,{redirect:"manual",headers:{"User-Agent":"AlEzzTV-LinkInspector/1.0","Accept":"*/*",...(max<10000?{"Range":"bytes=0-2047"}:{})},signal:AbortSignal.timeout(8500)});
  if(r.status>=300&&r.status<400){const loc=r.headers.get("location");const next=loc?new URL(loc,u).href:"";await r.body?.cancel().catch(()=>{});u=await approveDestination(next,hosts);continue;}
  if(!r.ok)throw Error("HTTP_"+r.status);
  if(Number(r.headers.get("content-length")||0)>max&&max>=10000)throw Error("PAGE_TOO_LARGE");
  return {url:u.href,type:r.headers.get("content-type")||"",data:await bytes(r,max)};
 }
 throw Error("REDIRECT_LIMIT");
}
// Public-host discovery is allowed for authenticated admins. It is NOT a rights approval.
// An unverified host must resolve exclusively to globally routable addresses. Reject
// DNS rebindings toward private services and re-check every redirect destination.
const dnsCache=new Map();
function publicAddress(value){
 const ip=String(value||"").toLowerCase();
 if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)){
  const p=ip.split(".").map(Number),[a,b,c]=p;
  if(p.some(x=>x<0||x>255))return false;
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113||a===100&&b>=64&&b<=127);
 }
 if(ip.includes(":"))return /^[23][0-9a-f:]+$/.test(ip)&&!/^2001:db8:/i.test(ip)&&!/^2001:0{0,3}10:/i.test(ip);
 return false;
}
async function resolvePublic(host){
 const now=Date.now(),cached=dnsCache.get(host);
 if(cached&&cached.until>now)return cached.promise;
 const promise=(async()=>{
  const result=await Promise.all(["A","AAAA"].map(async type=>{
   try{
    const url="https://dns.google/resolve?name="+encodeURIComponent(host)+"&type="+type;
    const resp=await fetch(url,{redirect:"error",headers:{Accept:"application/dns-json"},signal:AbortSignal.timeout(5000)});
    if(!resp.ok)throw Error("DNS_HTTP_"+resp.status);
    const doc=await resp.json();
    if(doc.Status!==0&&doc.Status!==3)throw Error("DNS_LOOKUP_FAILED");
    return (Array.isArray(doc.Answer)?doc.Answer:[]).filter(a=>a.type===(type==="A"?1:28)).map(a=>a.data);
   }catch{return null;}
  }));
  if(result.every(x=>x===null))throw Error("DNS_VALIDATION_UNAVAILABLE");
  const addresses=result.flatMap(x=>x||[]);
  if(!addresses.length)throw Error("DNS_HAS_NO_PUBLIC_ADDRESS");
  if(addresses.some(ip=>!publicAddress(ip)))throw Error("DNS_PRIVATE_ADDRESS_BLOCKED");
  return true;
 })();
 dnsCache.set(host,{promise,until:now+15000});
 try{return await promise;}catch(e){dnsCache.delete(host);throw e;}
}
async function approveDestination(url,hosts){
 const u=safe(url,hosts);if(!u)throw Error("UNSAFE_HTTPS_URL");
 const h=u.hostname.toLowerCase();
 if(!hosts.some(known=>h===known||h.endsWith("."+known)))await resolvePublic(h);
 return u;
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
 // Parse full Schema.org TVSeries / TVSeason / TVEpisode trees without
 // executing scripts or guessing playback URLs that the publisher did not expose.
 let structuredTitle="",structuredPoster="",structuredDescription="",original="",year=null;
 const structuredEpisodes=new Map();
 const validNum=n=>{const v=Number(n);return Number.isInteger(v)&&v>0&&v<10000?v:0;};
 const objectUrl=x=>typeof x==="string"?x:typeof x==="object"?(x?.url||x?.["@id"]||""):"";
 const img=x=>joined(objectUrl(x),url,hosts);
 function walk(node,depth=0,season=1){
  if(!node||typeof node!=="object"||depth>9)return;
  if(Array.isArray(node)){node.slice(0,160).forEach(x=>walk(x,depth+1,season));return;}
  const kind=Array.isArray(node["@type"])?node["@type"].join(" "):String(node["@type"]||"");
  const se=validNum(node.seasonNumber)||season;
  const label=clean(node.name||node.headline||node.title||"").slice(0,250);
  if(/TVSeries/i.test(kind)){
   if(!structuredTitle)structuredTitle=label;
   if(!structuredDescription)structuredDescription=clean(node.description||"").slice(0,1400);
   if(!structuredPoster)structuredPoster=img(node.image||node.thumbnailUrl);
   if(!original)original=clean(node.alternateName||"").slice(0,250);
   if(!year)year=Number(String(node.datePublished||"").slice(0,4))||null;
  }
  if(node.contentUrl)add(node.contentUrl);
  if(/TVEpisode/i.test(kind)||node.episodeNumber){
   const link=joined(objectUrl(node.url||node.mainEntityOfPage||node.contentUrl),url,hosts);
   const direct=joined(objectUrl(node.contentUrl||node.video?.contentUrl),url,hosts);
   const ep=validNum(node.episodeNumber||node.position)||seq(label+" "+link)?.[1]||0;
   const seasonNumber=validNum(node.partOfSeason?.seasonNumber||node.isPartOf?.seasonNumber)||se||1;
   if(direct&&media(direct))add(direct);
   if(ep&&(link||direct)&&(link||direct)!==url){
    const key=seasonNumber+":"+ep;
    structuredEpisodes.set(key,{url:link||direct,title:label||"الحلقة "+ep,season:seasonNumber,number:ep,
      description:clean(node.description||"").slice(0,1400),poster_url:img(node.image||node.thumbnailUrl)||"",
      media_url:direct&&media(direct)?direct:media(link)?link:undefined});
   }
  }
  for(const field of ["@graph","episode","episodes","containsSeason","season","hasPart","itemListElement","item","mainEntity"]){
   if(node[field]&&typeof node[field]==="object")walk(node[field],depth+1,se);
  }
  if(node.video&&typeof node.video==="object")walk(node.video,depth+1,se);
 }
 for(const m of text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{walk(JSON.parse(m[1]));}catch{}
 }
 // CMS episode cards often carry season / episode numbers in data attributes.
 for(const m of text.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)){
  const opening=m[0].match(/^<a\b[^>]*>/i)?.[0]||"";
  const link=joined(att(opening,"href")||att(opening,"data-href"),url,hosts);
  const label=clean(m[0]).slice(0,180),parsed=seq(label+" "+link);
  const ep=validNum(att(opening,"data-episode")||att(opening,"data-episode-number"))||parsed?.[1]||0;
  const se=validNum(att(opening,"data-season")||att(opening,"data-season-number"))||parsed?.[0]||1;
  if(!ep||!link||link===url)continue;
  const key=se+":"+ep;
  if(!structuredEpisodes.has(key))structuredEpisodes.set(key,{url:link,title:label||"الحلقة "+ep,season:se,number:ep,
    media_url:media(link)?link:undefined,poster_url:joined(att(opening,"data-poster"),url,hosts)||""});
 }
 // Follow a small set of explicitly linked season pages at the same host.
 // This is HTML discovery only — no headless login, playback interception or DRM.
 const seasonPages=[];
 for(const m of text.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)){
  const open=m[0].match(/^<a\b[^>]*>/i)?.[0]||"",label=clean(m[0]);
  const link=joined(att(open,"href")||att(open,"data-href"),url,hosts);
  if(!link||link===url||media(link)||new URL(link).hostname!==new URL(url).hostname)continue;
  const labelAndUrl=label+" "+link;
  if(/(?:الموسم|season)[\s/:_.-]*(?:\d{1,2}|الأول|الثاني|الثالث|الرابع|الخامس)/i.test(labelAndUrl) &&
     !/(?:الحلقة|episode|ep)[\s/:_.-]*\d{1,3}/i.test(labelAndUrl) && !seasonPages.includes(link)){
    seasonPages.push(link);
  }
 }
 const found=new Map();
 for(const item of pages.concat([...structuredEpisodes.values()])){
  const key=item.season+":"+item.number;
  if(!found.has(key)||(!found.get(key).media_url&&item.media_url))found.set(key,item);
 }
 return {title:title||structuredTitle,description:description||structuredDescription,poster:poster||structuredPoster,
  original,year,seasonPages:seasonPages.slice(0,8),streams:[...streams].slice(0,8),
  pages:[...found.values()].sort((a,b)=>a.season-b.season||a.number-b.number).slice(0,120)};

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
  if(!target)return json({error:"UNSAFE_HTTPS_URL",note:"أدخل رابطًا عامًا يبدأ بـ HTTPS، وليس عنوان شبكة محلية أو IP.",status:"blocked"},400);
  if(b.action==="discover"){await approveDestination(target.href,hosts);
   let page={title:"",description:"",poster:"",streams:[],pages:[]};
   if(!media(target.href)){const r=await request(target.href,hosts);if(!/text\/html|application\/xhtml/i.test(r.type))return json({error:"NOT_HTML"},422);page=inspectPage(decode(r),r.url,hosts);}
    if(b.kind!=="movie"&&page.seasonPages?.length){
      const host=new URL(target.href).hostname,more=await Promise.allSettled(page.seasonPages.slice(0,8).map(async link=>{
        if(new URL(link).hostname!==host)return [];
        const response=await request(link,hosts,550000);
        if(!/text\/html|application\/xhtml/i.test(response.type))return [];
        return inspectPage(decode(response),response.url,hosts).pages;
      }));
      const seen=new Map();
      for(const item of page.pages.concat(...more.filter(x=>x.status==="fulfilled").map(x=>x.value))){
        const key=item.season+":"+item.number;
        if(!seen.has(key)||(!seen.get(key).media_url&&item.media_url))seen.set(key,item);
      }
      page.pages=[...seen.values()].sort((a,b)=>a.season-b.season||a.number-b.number).slice(0,120);
    }
    const archived=await archiveList(target.href,hosts);
    const derived=page.pages.length?page.pages:page.streams.map(link=>{
      const parts=seq(link);return parts?{url:link,media_url:link,title:"الحلقة "+parts[1],season:parts[0],number:parts[1]}:null;
    }).filter(Boolean);
    const listing=archived.length?archived:derived;
   const type=b.kind==="series"||(b.kind!=="movie"&&listing.length>1)?"series":"movie";
   const items=type==="series"?listing:[{url:target.href,title:page.title||"فيلم جديد",season:1,number:1,media_url:media(target.href)?target.href:undefined}];
    return json({type,title:page.title||"عمل جديد",description:page.description,poster_url:page.poster,
      title_original:page.original,release_year:page.year,items:items.slice(0,120),discovered:items.length});
  }
  if(b.action!=="inspect")return json({error:"ACTION_INVALID"},400);
  await approveDestination(target.href,hosts);
  const direct=b.media_url?safe(b.media_url,hosts):null;let meta={title:"",description:"",poster:"",streams:[]};
  const links=[];if(direct&&media(direct.href))links.push(direct.href);
  if(media(target.href))links.push(target.href);
   else{try{const r=await request(target.href,hosts);if(!/text\/html|application\/xhtml/i.test(r.type))return json({ok:false,reason:"NOT_HTML"});meta=inspectPage(decode(r),r.url,hosts);links.push(...meta.streams);}catch(e){if(!links.length)throw e;}}
  const tests=[];
  for(const link of [...new Set(links)].slice(0,8)){const v=await check(link,hosts);tests.push(v);if(tests.filter(x=>x.ok).length>=4)break;}
  const good=tests.filter(x=>x.ok);
  return json({ok:!!good.length,url:target.href,title:meta.title||String(b.title||"").slice(0,250),description:meta.description,poster_url:meta.poster,stream_url:good[0]?.url||"",variants:good.slice(1).map(x=>({label:x.format,url:x.url})),checks:tests,reason:good.length?"":"NO_VERIFIED_VIDEO",checked_at:new Date().toISOString()});
 }catch(e){return json({error:String(e instanceof Error?e.message:e).slice(0,160)},422);}
});