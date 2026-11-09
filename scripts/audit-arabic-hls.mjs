#!/usr/bin/env node
/**
 * Diagnostic-only health probe for eight user-supplied Arabic IPTV HLS feeds.
 * Never grants broadcasting rights, changes publication state or copies media.
 * A valid playlist does NOT imply decoded video works or redistribution is allowed.
 */
import { writeFileSync } from 'node:fs';

const sources = [
  { name: 'قناة القرآن الكريم السعودية', url: 'https://cdn-globecast.akamaized.net/live/eds/saudi_quran/hls_roku/index.m3u8' },
  { name: 'قناة السنة النبوية', url: 'https://cdn-globecast.akamaized.net/live/eds/saudi_sunnah/hls_roku/index.m3u8' },
  { name: 'القناة السعودية الأولى', url: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-saudi-tv/2ad66056b51fd8c1b624854623112e43/index.m3u8' },
  { name: 'قناة العربية', url: 'https://live.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8' },
  { name: 'قناة الحدث', url: 'https://av.alarabiya.net/alarabiapublish/alhadath.smil/playlist.m3u8' },
  { name: 'الشرق الوثائقية', url: 'https://svs.itworkscdn.net/asharqdocumentarylive/asharqdocumentary.smil/playlist_dvr.m3u8' },
  { name: 'TRT عربي', url: 'https://tv-trtarabi.medya.trt.com.tr/master.m3u8' },
  { name: 'رؤيا TV', url: 'https://live.kwikmotion.com/royatvpublic/royatv.smil/playlist.m3u8' }
];

async function fetchPlaylist(url) {
  const started = Date.now();
  const response = await fetch(url, {
    headers: { 'User-Agent': 'AlEzzTV-HLS-Audit/1.0', 'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, */*' },
    signal: AbortSignal.timeout(11000),
    redirect: 'follow'
  });
  if (!response.ok) return { ok: false, status: response.status, reason: 'HTTP ' + response.status, ms: Date.now() - started };
  const length = Number(response.headers.get('content-length') || '0');
  if (length > 512000) return { ok:false, status: response.status, reason:'Playlist too large', ms:Date.now()-started };
  const body = await response.text();
  if (body.length > 512000 || !/^\uFEFF?\s*#EXTM3U\b/m.test(body)) {
    return { ok: false, status: response.status, reason: 'Response was not a valid M3U8 playlist', ms: Date.now()-started };
  }
  const lines = body.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const variants = lines.filter(l=>l.startsWith('#EXT-X-STREAM-INF')).length;
  const segments = lines.filter(l=>l && !l.startsWith('#')).length;
  return { ok: true, status: response.status, contentType: response.headers.get('content-type'), ms:Date.now()-started,
    variants, segments, master: variants > 0, hlsHeaders: lines.filter(l=>l.startsWith('#EXT-X-')).slice(0,12) };
}

const results=[];
for (const source of sources) {
  try {
    results.push({name: source.name, url: source.url, ...(await fetchPlaylist(source.url))});
  } catch (error) {
    results.push({name: source.name, url: source.url, ok:false, status:null, reason:String(error?.message||error).slice(0,150)});
  }
  const last = results[results.length-1];
  console.log((last.ok?'PASS':'FAIL')+' | '+last.name+' | '+(last.status??'network error')+' | '+(last.reason||'M3U8 parsed'));
}
const report={ checkedAt:new Date().toISOString(), testType:'HLS manifest read only; no media decoded, rights unverified', sources:results };
writeFileSync('arabic-hls-audit.json',JSON.stringify(report,null,2)+'\n');
const rows=results.map(x=>'| '+x.name+' | '+(x.ok?'Manifest parsed':'Unverified')+' | '+(x.status??'-')+' | '+(x.reason||'-').replace(/\|/g,'/')+' |');
const markdown=['# Arabic HLS diagnostic run','','Checked: '+report.checkedAt,'','**No copyright permission is inferred. No stream was published or rebroadcast by this test.**','','| Channel | Result | HTTP | Details |','|---|---|---:|---|',...rows,'','The runner country/IP may affect geoblocked or protected manifests. Stream playback, audio/video codec and individual segments need real-device tests.'].join('\n');
writeFileSync('arabic-hls-audit.md',markdown+'\n');
if(process.env.GITHUB_STEP_SUMMARY){ const fs=await import('node:fs'); fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown+'\n');}
