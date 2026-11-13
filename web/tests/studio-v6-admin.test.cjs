'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const js=fs.readFileSync(path.join(root,'python-cloud-studio/static/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'python-cloud-studio/templates/index.html'),'utf8');
const server=fs.readFileSync(path.join(root,'python-cloud-studio/server.py'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);

test('V6 admin controls are wired and JS parses',()=>{
 assert.doesNotThrow(()=>new vm.Script(js,{filename:'app.js'}));
 assert.equal(new Set(ids).size,ids.length,'Duplicate IDs');
 for(const id of [
   'studioScanHistory','studioScanHistoryEntries','studioScanHistoryBtn',
   'studioResumeScan','studioStopScan','studioRetryFailed',
   'studioPlayerFilter','studioShowAllSources','studioCheckpointStatus','studioScanTimer'
 ])assert.ok(ids.includes(id),'Missing admin control '+id);
 for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g))
   assert.ok(ids.includes(id),'JS references absent HTML ID '+id);
});

test('SSE uses event cursor and handles out-of-order reconnects',()=>{
 assert.match(js,/function applyStudioStreamPacket\(packet\)/);
 assert.match(js,/seq<=discoveryLastSeq/);
 assert.match(js,/packet.kind==='resync'/);
 assert.match(js,/packet.kind==='episodes_added'/);
 assert.match(js,/packet.kind==='episode'/);
 assert.match(js,/after='\+discoveryLastSeq/);
 assert.match(server,/if cursor==0 or missed/);
 assert.match(server,/events\[0\]\["seq"\]-1/);
});

test('failed episode retry, stop and scan checkpoint restore are admin operations',()=>{
 for(const name of ['recoverAdminScan','resumeAdminScan','retryFailedAdminScan',
                   'stopAdminScan','retryOneEpisode','listAdminScanHistory'])
   assert.ok(js.includes('function '+name+'('),'Missing admin action '+name);
 for(const route of ['resume','recover','stop','retry-failed','retry-episode','history'])
   assert.ok(js.includes('discovery-scan/'+route),'Missing API usage '+route);
 assert.match(js,/sessionStorage\.setItem\('alezz:main-scan'/);
 assert.match(js,/sessionStorage\.getItem\('alezz:main-scan'/);
 assert.match(server,/def _portal_scan_uid\(/);
});

test('exported source URLs remain unverified unless independently checked',()=>{
 assert.match(js,/function exportStudioPlayers\(format\)/);
 assert.match(js,/function studioExportCsvField\(value\)/);
 assert.match(js,/row\.verified\?'اجتاز الفحص'/);
 assert.match(js,/لم تُكتشف أي روابط عامة للتصدير بعد/);
});
