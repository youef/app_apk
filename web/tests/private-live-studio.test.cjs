'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','..','python-cloud-studio','templates','private-videos.html'),'utf8');
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';
const markup=html.split('<script>')[0];
function idsInMarkup(){return [...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);}

test('live stream client JavaScript compiles and references real elements',()=>{
  assert.ok(js.length>5000);
  assert.doesNotThrow(()=>new vm.Script(js,{filename:'private-videos.html.js'}));
  const ids=idsInMarkup();
  assert.equal(ids.length,new Set(ids).size,'HTML contains duplicate IDs');
  const used=[...js.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
  for(const id of used)assert.ok(ids.includes(id),'Unknown element: '+id);
});

test('SSE pushes snapshots and fallback still works on older deployments',()=>{
  assert.match(js,/new EventSource\(/);
  assert.match(js,/addEventListener\("snapshot"/);
  assert.match(js,/applyLiveSnapshot\(/);
  assert.match(js,/setInterval\(pollDeepScan,1400\)/);
  assert.match(js,/sessionStorage\.setItem\("alezz-live-scan"/);
});

test('CSV and JSON exports stay available while the scan is active',()=>{
  for(const id of ['deep-live-feed','deep-export-csv','deep-export-json','deep-copy-links','deep-progressbar'])
    assert.ok(idsInMarkup().includes(id),'Missing live control '+id);
  assert.match(js,/function exportDeepReport\(format\)/);
  assert.match(js,/new Blob\(/);
  assert.match(js,/format==="csv"/);
  assert.match(js,/function csvSafe\(value\)/);
  assert.match(js,/deepScanState\.result=data\.result/);
  assert.match(js,/function copyLiveLinks\(/);
});
