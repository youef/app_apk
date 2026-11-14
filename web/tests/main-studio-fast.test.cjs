'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'../..');
const script=fs.readFileSync(path.join(root,'python-cloud-studio/static/app.js'),'utf8');
const page=fs.readFileSync(path.join(root,'python-cloud-studio/templates/index.html'),'utf8');
const server=fs.readFileSync(path.join(root,'python-cloud-studio/server.py'),'utf8');

test('main studio fast-scan bundle compiles and all live controls exist',()=>{
 assert.doesNotThrow(()=>new vm.Script(script));
 const ids=[...page.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(ids.length,new Set(ids).size,'Duplicate HTML IDs');
 for(const id of ['studioFastMode','studioLivePill','studioExportPlayersCsv',
                    'studioExportPlayersJson','studioCopyPlayers','studioLiveCounts',
                    'discoveryProgress','liveMediaLinks']){
   assert.ok(ids.includes(id),'Missing control '+id);
 }
 for(const [,id] of script.matchAll(/\$\('([^']+)'\)/g)){
   assert.ok(ids.includes(id),'Missing main Studio element '+id);
 }
});

test('main studio opens live SSE stream and falls back to short polling',()=>{
 assert.match(script,/new EventSource\(address\)/);
 assert.match(script,/addEventListener\('snapshot'/);
 assert.match(script,/applyStudioStreamPacket\(JSON.parse\(event.data\)\)/);
 assert.match(script,/setTimeout\(\(\)=>pollDiscovery\(id\),1000\)/);
 assert.match(script,/if\(packet.scan\)showDiscoveryProgress\(packet.scan\)/);
 assert.match(server,/async def discovery_scan_events\(/);
 assert.match(server,/StreamingResponse\(generate\(\)/);
});

test('fast scan has bounded first pass and keeps separate comprehensive mode',()=>{
 assert.match(script,/,fast\}/);
 assert.match(server,/fast:\s*bool = False/);
 assert.match(server,/max_pages=3 if fast else 500/);
 assert.match(server,/ALEZZ_STUDIO_SCAN_SECONDS/);
 assert.match(server,/max_seconds=budget/);
 assert.match(server,/max_episodes=5000/);
 assert.match(page,/استكشاف صفحات جميع المواسم/);
});

test('partial exports support CSV and JSON without saving unpublished media',()=>{
 assert.match(script,/function studioPlayerRows\(\)/);
 assert.match(script,/function exportStudioPlayers\(format\)/);
 assert.match(script,/new Blob\(\[output\]/);
 assert.match(script,/function studioExportCsvField\(value\)/);
 assert.match(script,/app\.scanning\?'scanning':'review'/);
 assert.match(script,/function copyStudioPlayerLinks\(\)/);
 assert.match(script,/مرشح غير متحقق/);
});
