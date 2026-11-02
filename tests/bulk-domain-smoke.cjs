"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"../supabase/functions/aseel-batch-discover/index.ts"),"utf8");
let handler=null;
const visited=[];
const responses=(data,status=200,type="application/json")=>new Response(typeof data==="string"||data instanceof Uint8Array?data:JSON.stringify(data),{status,headers:{"content-type":type}});
const page='<html><head><title>مسلسل تجريبي</title><meta property="og:title" content="مسلسل تجريبي"></head><body><video src="https://cdn.sample.org/episode-1.mp4"></video></body></html>';
const seriesPage='<html><head><script type="application/ld+json">'+JSON.stringify({
"@type":"TVSeries","name":"مسلسل مرخّص للتجربة","description":"وصف المسلسل","image":"https://cdn.sample.org/poster.jpg",
"containsSeason":[{"@type":"TVSeason","seasonNumber":2,"episode":[
{"@type":"TVEpisode","seasonNumber":2,"episodeNumber":1,"name":"الحلقة الأولى","url":"https://public.example.net/s2e1","image":"https://cdn.sample.org/ep1.jpg"},
{"@type":"TVEpisode","seasonNumber":2,"episodeNumber":2,"name":"الحلقة الثانية","url":"https://public.example.net/s2e2","contentUrl":"https://cdn.sample.org/s2e2.mp4"}]}]
})+'</script></head><body></body></html>';
const fetchMock=async (input)=>{
 const url=String(input),u=new URL(url);
 visited.push(url);
 if(u.pathname==="/auth/v1/user")return responses({id:"11111111-1111-4111-8111-111111111111"});
 if(u.pathname==="/rest/v1/aseel_admins")return responses([{user_id:"11111111-1111-4111-8111-111111111111"}]);
 if(u.pathname==="/rest/v1/aseel_content_sources")return responses([]);
 if(u.hostname==="dns.google"){
  const privateIP=u.searchParams.get("name")==="private.attack.net";
  return responses({Status:0,Answer:u.searchParams.get("type")==="A"?[{type:1,data:privateIP?"127.0.0.1":"1.1.1.1"}]:[]});
 }
 if(u.hostname==="public.example.net"&&u.pathname==="/movie")return responses(page,200,"text/html");
 if(u.hostname==="public.example.net"&&u.pathname==="/show")return responses(seriesPage,200,"text/html");
 if(u.hostname==="public.example.net"&&u.pathname==="/redirect")return new Response(null,{status:302,headers:{location:"http://127.0.0.1/secret"}});
 if(u.hostname==="cdn.sample.org")return responses(new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109]),206,"video/mp4");
 throw Error("Unexpected outbound URL: "+url);
};
const Deno={env:{get(k){return k==="SUPABASE_URL"?"https://supabase.mock":k==="SUPABASE_ANON_KEY"?"public-test-key":"";}},serve(f){handler=f;}};
vm.runInNewContext(source,{Deno,URL,Request,Response,TextDecoder,AbortSignal,fetch:fetchMock,console,Map,Set,Date,Error,Uint8Array,Number,String,Object,Array,RegExp,Promise,encodeURIComponent,decodeURIComponent},{timeout:2500});
assert.equal(typeof handler,"function");
async function run(action,url,extra={}){
 const req=new Request("https://supabase.mock/functions/v1/aseel-batch-discover",{method:"POST",headers:{authorization:"Bearer dummy-test-token","content-type":"application/json"},body:JSON.stringify({action,url,...extra})});
 const res=await handler(req);return {status:res.status,data:await res.json()};
}
(async()=>{
 const disc=await run("discover","https://public.example.net/movie");
 assert.equal(disc.status,200,JSON.stringify(disc.data));
 assert.equal(disc.data.items.length,1);
 assert.equal(disc.data.title,"مسلسل تجريبي");
 const structured=await run("discover","https://public.example.net/show",{kind:"series"});
 assert.equal(structured.status,200,JSON.stringify(structured.data));
 assert.equal(structured.data.type,"series");
 assert.equal(structured.data.items.length,2);
 assert.equal(structured.data.description,"وصف المسلسل");
 assert.equal(structured.data.poster_url,"https://cdn.sample.org/poster.jpg");
 assert.equal(structured.data.items[0].season,2);
 assert.equal(structured.data.items[0].number,1);
 assert.equal(structured.data.items[1].media_url,"https://cdn.sample.org/s2e2.mp4");
  const check=await run("inspect","https://public.example.net/movie");
 assert.equal(check.status,200,JSON.stringify(check.data));
 assert.equal(check.data.ok,true,JSON.stringify(check.data));
 assert.equal(check.data.stream_url,"https://cdn.sample.org/episode-1.mp4");
 const priv=await run("discover","https://private.attack.net/page");
 assert.equal(priv.status,422,JSON.stringify(priv.data));
 assert.equal(priv.data.error,"DNS_PRIVATE_ADDRESS_BLOCKED");
 const forbidden=await run("discover","https://localhost.local/secret");
 assert.equal(forbidden.status,400,JSON.stringify(forbidden.data));
 assert.equal(forbidden.data.error,"UNSAFE_HTTPS_URL");
 const redirect=await run("discover","https://public.example.net/redirect");
 assert.equal(redirect.status,422,JSON.stringify(redirect.data));
 assert.equal(redirect.data.error,"UNSAFE_HTTPS_URL");
 assert.equal(visited.some(v=>v.includes("127.0.0.1")),false,"must not fetch localhost");
 console.log("PASS: unrestricted safe HTTPS discovery, CDN MP4, DNS private rejection, redirect protection.");
})().catch(error=>{console.error(error);process.exitCode=1;});