'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'../..');
const app=fs.readFileSync(path.join(root,'python-cloud-studio/static/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'python-cloud-studio/templates/index.html'),'utf8');
const server=fs.readFileSync(path.join(root,'python-cloud-studio/server.py'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);

test('episode capture interface and scripts compile',()=>{
  assert.doesNotThrow(()=>new vm.Script(app));
  assert.equal(ids.length,new Set(ids).size);
  for(const id of ['edgeCaptureBtn','episodeBatchPanel','episodeBatchStatus',
    'episodeBatchProgress','episodeBatchCount','episodeBatchCurrent',
    'episodeBatchElapsed','episodeBatchFound','episodeBatchStop',
    'episodeBatchLog','episodeBatchLive']){
      assert.ok(ids.includes(id),'Missing button or panel: '+id);
    }
});

test('button starts background 10/45 batch and progresses without repeated clicks',()=>{
  assert.match(app,/API\('episode-capture-batches\/start'/);
  assert.match(app,/API\('episode-capture-batches\/stop'/);
  assert.match(app,/new EventSource\('\/api\/episode-capture-batches\/events\?/);
  assert.match(app,/setInterval\(\(\)=>\{/);
  assert.match(app,/updateDiscoveryDelta\(item\.delta\)/);
  assert.match(server,/_EPISODE_BATCH_SIZE = 10/);
  assert.match(server,/_EPISODE_BATCH_SECONDS = 45/);
  assert.match(server,/job\['next_index'\]=start if interrupted else stop/);
  assert.doesNotMatch(app,/processed<32/);
});

test('browser results are candidates, not automatically published or verified',()=>{
  assert.match(app,/count\+' مصدر مرشح'/);
  assert.match(app,/episodeBatchProgress\(job\)/);
  assert.match(server,/item\.verified=playable is not None/);
});
