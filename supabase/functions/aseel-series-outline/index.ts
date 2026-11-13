// AL EZZ TV — PUBLIC, READ-ONLY SERIES EPISODE OUTLINE.
// This endpoint NEVER returns stream URLs, licence tokens, source IDs or admin data.
// A public series must already be published and rights-approved; episode metadata
// may be listed as unavailable while the video / episode rights are pending.
const API=Deno.env.get("SUPABASE_URL")||"";
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const CORS={"Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"apikey,content-type,authorization,x-client-info",
 "Access-Control-Allow-Methods":"GET,OPTIONS",
 "Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"public, max-age=60"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:CORS});
function validId(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||""));}
async function table(name,query){
 const res=await fetch(API+"/rest/v1/"+name+"?"+query,{
  headers:{apikey:KEY,Authorization:"Bearer "+KEY,Accept:"application/json"},
  signal:AbortSignal.timeout(7500)});
 if(!res.ok)throw Error("DATA_UNAVAILABLE");
 return res.json();
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="GET")return json({error:"METHOD_NOT_ALLOWED"},405);
 if(!API||!KEY)return json({error:"UNAVAILABLE"},503);
 const seriesId=new URL(req.url).searchParams.get("series_id");
 if(!validId(seriesId))return json({error:"INVALID_SERIES"},400);
 try{
  const series=await table("aseel_series","select=id,title_ar&status=eq.published&id=eq."+encodeURIComponent(seriesId)+"&limit=1");
  if(!Array.isArray(series)||!series.length)return json({error:"NOT_FOUND"},404);
  const seasons=await table("aseel_seasons","select=id,number,title_ar&series_id=eq."+encodeURIComponent(seriesId)+"&order=number.asc&limit=40");
  if(!Array.isArray(seasons)||!seasons.length)return json({series_id:seriesId,seasons:[],total:0});
  const ids=seasons.filter(s=>validId(s.id)).map(s=>s.id);
  if(!ids.length)return json({series_id:seriesId,seasons:[],total:0});
  const episodes=await table("aseel_episodes","select=id,season_id,number,title_ar,description,poster_url,status,rights_status,stream_url,link_health_status"+
    "&status=eq.published&season_id=in.("+ids.map(encodeURIComponent).join(",")+")&order=number.asc&limit=240");
  const groups=seasons.map(season=>({
   number:season.number||1,title:String(season.title_ar||"الموسم "+season.number).slice(0,100),
   episodes:(Array.isArray(episodes)?episodes:[])
    .filter(e=>e.season_id===season.id)
    .sort((a,b)=>(a.number||0)-(b.number||0))
    .map(e=>({
      number:e.number||0,title:String(e.title_ar||"الحلقة "+e.number).slice(0,250),
      description:String(e.description||"").slice(0,500),
      // Posters are only exposed for episodes with approved usage rights.
      poster_url:/^https:\/\//i.test(e.poster_url||"")?e.poster_url:null,
      playback_available:e.link_health_status!=="broken"&&
        /^https:\/\/[^\s]+[.](?:mp4|m3u8)(?:[?#]|$)/i.test(e.stream_url||"")
     }))
  })).filter(s=>s.episodes.length);
  return json({series_id:seriesId,seasons:groups,total:groups.reduce((sum,s)=>sum+s.episodes.length,0)});
 }catch{return json({error:"TEMPORARILY_UNAVAILABLE"},503);}
});