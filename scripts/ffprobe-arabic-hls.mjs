#!/usr/bin/env node
/** Stream codec diagnostics: bounded ffprobe, zero media files stored, no redistribution. */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const name='arabic-hls-audit.json';
const report=JSON.parse(readFileSync(name,'utf8'));
const available=spawnSync('ffprobe',['-version'],{encoding:'utf8',timeout:3500}).status===0;
for(const source of report.sources){
  if(!source.ok) {
    source.codecProbe={ok:false, reason:'Manifest fetch failed'};
    continue;
  }
  if(!available){
    source.codecProbe={ok:false,reason:'ffprobe missing on runner'};
    continue;
  }
  const started=Date.now();
  const args=[
    '-v','error',
    '-rw_timeout','9000000',
    '-analyzeduration','1500000',
    '-probesize','131072',
    '-show_entries','stream=codec_type,codec_name,width,height',
    '-of','json',
    source.url
  ];
  const output=spawnSync('ffprobe',args,{encoding:'utf8',timeout:18000,maxBuffer:512000});
  let tracks=[];
  try {tracks=JSON.parse(output.stdout||'{}').streams||[];}catch {}
  source.codecProbe={
    ok:output.status===0&&tracks.some(t=>t.codec_type==='video'||t.codec_type==='audio'),
    status:output.status,
    elapsedMs:Date.now()-started,
    tracks:tracks.map(t=>({kind:t.codec_type,codec:t.codec_name,width:t.width,height:t.height})),
    reason:(output.error?.message||output.stderr||'').trim().slice(0,150)
  };
  console.log((source.codecProbe.ok?'PLAYABLE-CODEC':'INCONCLUSIVE')+
    ' | '+source.name+' | '+source.codecProbe.tracks.map(x=>x.kind+':'+x.codec).join(',')+
    (source.codecProbe.reason?' | '+source.codecProbe.reason:''));
}
report.testType+='; optional codec probe with ffprobe (not a TV-device playback test)';
writeFileSync(name,JSON.stringify(report,null,2)+'\n');
const rows=report.sources.map(s=>'| '+s.name+' | '+(s.ok?'M3U8 OK':'Manifest failed')+' | '+
  (s.codecProbe?.ok?s.codecProbe.tracks.map(t=>t.kind+':'+t.codec).join(', '):'inconclusive')+' | '+
  ((s.codecProbe?.reason||'-').replace(/\|/g,'/').replace(/\s+/g,' ').slice(0,100))+' |');
const markdown=[
 '# Arabic HLS diagnostic run', '', 'Checked: '+report.checkedAt, '',
 '**Technical health only: no rights to transmit or redistribute inferred.**', '',
 '| Channel | Manifest | Codec probe | Note |', '|---|---|---|---|',
 ...rows, '',
 'Codec probing reads only enough stream data to recognize a codec; it is not proof of continuous playback, regional access or licensed retransmission.'
].join('\n');
writeFileSync('arabic-hls-audit.md',markdown+'\n');
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n'+markdown+'\n');
