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

function validVideo(url){try{return /\.(?:mp4|m3u8|mpd|webm|mov)$/i.test(new URL(url).pathname);}catch{return false;}}
function asUrl(value,base){try{
 const input=decode(String(value||"").trim().replace(/\\\//g,"/").replace(/\\u0026/gi,"&").replace(/\\u003d/gi,"=").replace(/\\u002f/gi,"/"));
 if(!input||/^(?:data|blob|javascript):/i.test(input))return "";
 const u=new URL(input,base);
 return u.protocol==="https:"&&!u.username&&!u.password&&u.href.length<2048?u.href:"";
}catch{return "";}}
function attrList(raw){return attributes(raw||"");}
function parsePage(html,base){
 const meta={};
 for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const a=attrList(m[0]);const k=String(a.property||a.name||a.itemprop||"").toLowerCase();
  if(k&&a.content&&!meta[k])meta[k]=a.content;
 }
 const docTitle=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"";
 let title=decode(meta["og:title"]||meta["twitter:title"]||meta["title"]||docTitle).slice(0,250);
 let description=decode(meta["og:description"]||meta["twitter:description"]||meta["description"]||"").slice(0,1600);
 let original="",release_year=null,duration_minutes=null;
 const images=[],links=[],seenImages=new Set(),seenLinks=new Set(),variants=[];
 const addImage=(value,weight,source)=>{
  let v=value;
  if(Array.isArray(v))v=v[0];
  if(v&&typeof v==="object")v=v.url||v.contentUrl||v["@id"]||v.src||"";
  const url=asUrl(v,base);if(!url||seenImages.has(url)||/\/(?:favicon|logo|sprite|avatar)[^/]*\.(?:png|svg|jpg|webp)/i.test(url))return;
  seenImages.add(url);images.push({url,weight,source});
 };
 const addLink=(value,kind,origin="html",label="")=>{
  let v=value;
  if(Array.isArray(v))v=v[0];
  if(v&&typeof v==="object")v=v.url||v.contentUrl||v.embedUrl||v["@id"]||"";
  const url=asUrl(v,base);if(!url||seenLinks.has(url)||links.length>=75)return;
  if(kind==="media"&&!validVideo(url))return;
  seenLinks.add(url);links.push({url,kind,origin,label:String(label||"").slice(0,24)});
  if(kind==="media"&&label&&variants.length<8)variants.push({label:String(label).slice(0,24),url});
 };
 addImage(meta["og:image:secure_url"],130,"open-graph");
 addImage(meta["og:image"],125,"open-graph");
 addImage(meta["twitter:image"],110,"twitter");
 addImage(meta["thumbnail"],98,"metadata");
 addImage(meta["image"],90,"metadata");
 addImage(meta["poster"],90,"metadata");
 addLink(meta["og:video:secure_url"]||meta["og:video:url"]||meta["og:video"],"media","open-graph");
 for(const m of html.matchAll(/<link\b[^>]*>/gi)){
  const a=attrList(m[0]);
  if(/(?:image_src|preload)/i.test(a.rel||"")&&a.as!=="script")addImage(a.href,95,"link");
 }
 function walkJSON(node,depth=0){
  if(depth>5||!node||typeof node!=="object")return;
  if(Array.isArray(node)){for(const part of node.slice(0,35))walkJSON(part,depth+1);return;}
  if(!original)original=decode(node.alternateName||node.originalTitle||"").slice(0,250);
  if(!title)title=decode(node.name||node.headline||"").slice(0,250);
  if(!description)description=decode(node.description||"").slice(0,1600);
  addImage(node.image,116,"json-ld");addImage(node.thumbnailUrl,114,"json-ld");
  addLink(node.contentUrl||node.videoUrl,"media","json-ld");
  addLink(node.embedUrl,"embed","json-ld");
  if(!release_year){
   const date=String(node.datePublished||node.uploadDate||node.dateCreated||"").match(/\b(?:19|20)\d{2}\b/);
   if(date)release_year=Number(date[0]);
  }
  if(!duration_minutes){
   const t=String(node.duration||"").match(/P(?:T)?(?:(\d+)H)?(?:(\d+)M)?/i);
   if(t&&(t[1]||t[2]))duration_minutes=Number(t[1]||0)*60+Number(t[2]||0);
  }
  for(const key of ["@graph","video","mainEntity","subjectOf","hasPart","itemListElement","associatedMedia"])if(node[key])walkJSON(node[key],depth+1);
 }
 for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walkJSON(JSON.parse(m[1]));}catch{}}
 for(const m of html.matchAll(/<(?:img|video|source|iframe|a)\b[^>]*>/gi)){
  const tag=m[0],a=attrList(tag);
  if(/^<img\b/i.test(tag)){
   const src=a["data-original"]||a["data-lazy-src"]||a["data-src"]||a["data-image"]||a.src||a.srcset?.split(/[,\s]/)[0];
   const bonus=/poster|cover|backdrop|thumb|movie|film|banner/i.test(tag)?20:0;
   addImage(src,50+bonus,"html-image");
  }else if(/^<video\b/i.test(tag)){
   addImage(a.poster||a["data-poster"],105,"video-poster");
   addLink(a.src||a["data-src"]||a["data-video"],"media","video");
  }else if(/^<source\b/i.test(tag)){
   addLink(a.src||a["data-src"],"media","video-source",a.label||a.res||a["data-quality"]||"");
  }else if(/^<iframe\b/i.test(tag)){
   addLink(a.src||a["data-src"]||a["data-lazy-src"],"embed","iframe");
  }else {
   const href=a.href||a["data-href"]||"";
   if(validVideo(asUrl(href,base)))addLink(href,"media","anchor",a.download||"");
  }
 }
 for(const m of html.matchAll(/(?:data-(?:poster|background|thumbnail|cover|image)|poster)\s*=\s*["']([^"']{8,800})["']/gi))addImage(m[1],84,"data-image");
 for(const m of html.matchAll(/background-image\s*:\s*url\(\s*["']?([^"')\s]{8,800})/gi))addImage(m[1],55,"css-background");
 // JSON payloads and JS initialization configs often include explicit media file URLs.
 const normalized=html.replace(/\\\//g,"/").replace(/\\u0026/gi,"&").replace(/&amp;/gi,"&");
 for(const match of normalized.matchAll(/https:\/\/[^\s"'<>\\]{5,1000}\.(?:mp4|m3u8|mpd|webm)(?:\?[^\s"'<>\\]{0,300})?/gi)){
  addLink(match[0].replace(/[),;]+$/g,""),"media","source-text");
 }
 for(const m of normalized.matchAll(/(?:["'](?:file|src|source|video_url|videoUrl|contentUrl|hls|url)["']|(?:file|source|videoUrl))\s*:\s*["']([^"'<>]{4,950}\.(?:mp4|m3u8|mpd|webm)(?:\?[^"'<>]{0,200})?)["']/gi)){
  addLink(m[1],"media","player-config");
 }
 const ytitle=String(title+" "+meta["article:published_time"]||"").match(/\b(19\d{2}|20\d{2})\b/);
 if(!release_year&&ytitle)release_year=Number(ytitle[1]);
 images.sort((a,b)=>b.weight-a.weight);
 const poster=images[0]?.url||null;
 let backdrop=images.find(x=>x.url!==poster&&/backdrop|banner|background/i.test(x.source+" "+x.url))?.url||null;
 if(!backdrop)backdrop=images.find(x=>x.url!==poster&&x.weight>=75)?.url||null;
 const media=links.filter(x=>x.kind==="media"),embeds=links.filter(x=>x.kind==="embed");
 return {
  title_ar:title,title_original:original,description,poster_url:poster,backdrop_url:backdrop||poster, image_candidates:images.slice(0,12),
  release_year,duration_minutes,source_page_url:base,links,stream_url:media.find(x=>/\.m3u8(?:[?#]|$)/i.test(x.url))?.url||media[0]?.url||null,
  stream_variants:variants,diagnostics:{images_found:images.length,video_links_found:media.length,embed_links_found:embeds.length}
 };
}
async function fetchPage(url){
 const response=await fetch(url,{redirect:"manual",headers:{"User-Agent":"Mozilla/5.0 (compatible; AlEzzTV/3.0)","Accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.4"},signal:AbortSignal.timeout(12000)});
 if(response.status>=300&&response.status<400)return {redirect:response.headers.get("location")||"",status:response.status};
 if(!response.ok)return {status:response.status,error:response.status===403||response.status===429?"الموقع يمنع الوصول الآلي":"رفض المصدر تحميل الصفحة"};
 const ct=response.headers.get("content-type")||"";
 if(!/text\/html|application\/xhtml\+xml/i.test(ct))return {status:response.status,error:"الرابط ليس صفحة HTML"};
 if(Number(response.headers.get("content-length")||0)>1100000)return {status:413,error:"حجم الصفحة أكبر من الحد"};
 const reader=response.body?.getReader();if(!reader)return {status:422,error:"تعذر قراءة محتوى الصفحة"};
 const chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1100000)break;chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 if(size>1100000)return {status:413,error:"الصفحة أكبر من الحد"};
 const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength}
 return {status:response.status,html:new TextDecoder().decode(buffer),html_bytes:size};
}
async function scanPage(source){
 let current=source;let nRedirects=0;
 for(let i=0;i<4;i++){
  const p=await fetchPage(current.href);
  if(p.redirect){
   const final=safeUrl(new URL(p.redirect,current).href);
   if(!final)return {error:"تحويل غير آمن أو خارج المصادر المسموحة",status:422};
   current=final;nRedirects++;continue;
  }
  return {...p,url:current.href,redirects:nRedirects};
 }
 return {status:422,error:"عدد تحويلات الصفحة تجاوز الحد"};
}
async function enrichArchive(data,source){
 const u=new URL(source);
 if(u.hostname!=="archive.org"||!u.pathname.startsWith("/details/"))return {data,details:null};
 const id=u.pathname.split("/")[2];
 if(!id||!/^[a-zA-Z0-9_.-]{1,120}$/.test(id))return {data,details:null};
 try{
  const url="https://archive.org/metadata/"+encodeURIComponent(id);
  const resp=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(8000)});
  if(!resp.ok||Number(resp.headers.get("content-length")||0)>800000)return {data,details:null};
  const text=await resp.text();if(text.length>800000)return {data,details:null};
  const body=JSON.parse(text),metadata=body.metadata||{},files=Array.isArray(body.files)?body.files:[];
  if(!data.title_ar)data.title_ar=decode(metadata.title||"");
  if(!data.description)data.description=decode(String(metadata.description||"").slice(0,1500));
  const videoFiles=files.filter(f=>typeof f.name==="string"&&/\.(?:mp4|m3u8|webm)$/i.test(f.name)&&!/(?:_thumb|_preview)/i.test(f.name)).slice(0,12);
  const picture=files.find(f=>/\.(?:jpg|png|jpeg|webp)$/i.test(f.name)&&/(?:thumb|poster|cover|preview)/i.test(f.name))||files.find(f=>/\.(?:jpg|png|webp)$/i.test(f.name));
  const fileUrl=f=>"https://archive.org/download/"+encodeURIComponent(id)+"/"+f.name.split("/").map(encodeURIComponent).join("/");
  if(!data.poster_url&&picture)data.poster_url=fileUrl(picture);
  if(!data.poster_url)data.poster_url="https://archive.org/services/img/"+encodeURIComponent(id);
  if(!data.backdrop_url&&data.poster_url)data.backdrop_url=data.poster_url;
  if(!data.image_candidates?.length)data.image_candidates=[{url:data.poster_url,source:"archive-metadata",weight:85}];
  const added=new Set(data.links.map(x=>x.url));
  for(const f of videoFiles){
   const url=fileUrl(f);if(added.has(url))continue;added.add(url);
   data.links.push({url,kind:"media",origin:"archive-metadata",label:f.name.slice(0,24)});
  }
  if(!data.stream_url)data.stream_url=data.links.find(x=>x.kind==="media"&&/\.mp4(?:$|\?)/i.test(x.url))?.url||null;
  data.diagnostics.video_links_found=data.links.filter(x=>x.kind==="media").length;
  return {data,details:{archive_files:videoFiles.length,archive_metadata:true}};
 }catch{return {data,details:null}}
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
  let data=parsePage(html,address.href);
  const scanned=[address.href];
  const iframeCandidates=data.links.filter(x=>x.kind==="embed").slice(0,4);
  for(const embedded of iframeCandidates){
   if(scanned.length>=3)break;
   const candidate=safeUrl(embedded.url);
   if(!candidate||scanned.includes(candidate.href))continue;
   try{
    const extra=await scanPage(candidate);
    if(!extra.html)continue;
    scanned.push(extra.url);
    const nested=parsePage(extra.html,extra.url);
    const seen=new Set(data.links.map(x=>x.url));
    for(const link of nested.links){if(!seen.has(link.url)&&data.links.length<100){data.links.push({...link,origin:"embedded-page"});seen.add(link.url)}}
    if(!data.poster_url)data.poster_url=nested.poster_url;
    if(!data.backdrop_url)data.backdrop_url=nested.backdrop_url;
    if(!data.stream_url)data.stream_url=nested.stream_url;
    if(!data.stream_variants.length)data.stream_variants=nested.stream_variants;
   }catch{}
  }
  const enriched=await enrichArchive(data,address.href);data=enriched.data;
  const streams=data.links.filter(x=>x.kind==="media");
  data.diagnostics.video_links_found=streams.length;
  data.diagnostics.embed_links_found=data.links.filter(x=>x.kind==="embed").length;
  if(!data.stream_url)data.stream_url=streams.find(x=>/\.m3u8(?:[?#]|$)/i.test(x.url))?.url||streams.find(x=>/\.mp4(?:[?#]|$)/i.test(x.url))?.url||null;
  if(!data.backdrop_url&&data.poster_url)data.backdrop_url=data.poster_url;
  return response({data,diagnostics:{http_status:fetched.status,redirects,html_bytes:size,pages_scanned:scanned.length,found_links:data.links.length,images_found:data.diagnostics.images_found,media_found:streams.length,archive_metadata:Boolean(enriched.details?.archive_metadata)},note:streams.length?"تم استخراج روابط وسائط ظاهرة؛ اختبرها وتحقق من حقوق عرضها.":"لم يظهر رابط MP4/HLS في HTML. قد يحمّل المشغل الفيديو بجافاسكربت أو يحميه؛ لا يمكن استنتاج الرابط من الصفحة وحدها."});
 }catch(e){return response({error:e instanceof Error&&e.name==="TimeoutError"?"انتهت مهلة فحص المصدر":"تعذر فحص الصفحة آليًا؛ جرّب إدخال البيانات يدويًا."},422);}
});
