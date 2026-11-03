"""Offline API checks: owner gate, CSRF, UUID validation, source persistence."""
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from auto_sync import AutoSync
from test_auto_sync import FakeDB, NOW, OLD, ROOT, uid
import cloud_auth
import server


class AutoSyncAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        connect = sqlite3.connect
        def fixture_connection(*args, **kwargs):
            conn = connect(*args, **kwargs)
            conn.execute('pragma synchronous=OFF')
            return conn
        patcher = patch('auto_sync.sqlite3.connect', side_effect=fixture_connection)
        patcher.start(); self.addCleanup(patcher.stop)
        self.db = FakeDB()
        self.worker = AutoSync(self.tmp.name,db_factory=lambda:self.db,clock=lambda:NOW)
        self.worker.db = self.db
        self.target = dict(id=uid('api-target'),title_ar='فيلم',source_page_url='',stream_url=OLD,
                           status='published',rights_status='approved',stream_variants=[])
        self.db.seed('aseel_movies',self.target)
        self.worker.queue.ingest('aseel_movies',self.target)
        worker_patch = patch.object(server,'AUTOSYNC',self.worker)
        worker_patch.start(); self.addCleanup(worker_patch.stop)
        gate_patch = patch.object(cloud_auth,'ENABLED',False)
        gate_patch.start(); self.addCleanup(gate_patch.stop)
        # Deliberately do not enter lifespan; API tests never start a network worker.
        self.client = TestClient(server.app)
        self.addCleanup(self.client.close)
        response = self.client.get('/api/init')
        self.assertEqual(response.status_code,200)
        self.headers = {'X-CSRF-Token':response.json()['csrf']}

    def post(self, route, body):
        return self.client.post('/api/autosync/'+route,json=body,headers=self.headers)

    def target_body(self, **extra):
        return dict(table='aseel_movies',id=self.target['id'],action='check',**extra)

    def test_csrf_and_origin_protect_control_and_target_mutations(self):
        self.assertEqual(self.client.post('/api/autosync/control',json={'action':'pause'}).status_code,403)
        self.assertEqual(self.client.post('/api/autosync/target',json=self.target_body()).status_code,403)
        response = self.client.post('/api/autosync/control',json={'action':'pause'},
                                    headers={**self.headers,'Origin':'https://other.example.org'})
        self.assertEqual(response.status_code,403)
        self.assertTrue(self.post('control',{'action':'pause'}).json()['ok'])
        self.assertFalse(self.worker.enabled)
        self.assertTrue(self.post('control',{'action':'resume'}).json()['ok'])
        self.assertTrue(self.worker.enabled)

    def test_public_mode_gate_blocks_autosync_api_without_owner_cookie(self):
        with patch.object(cloud_auth,'ENABLED',True):
            self.assertEqual(self.client.get('/api/autosync/status').status_code,401)
            self.assertEqual(self.post('control',{'action':'pause'}).status_code,401)
            self.assertEqual(self.client.get('/healthz').status_code,200)

    def test_invalid_uuid_unknown_target_and_nonpublic_source_are_rejected(self):
        bad = self.target_body(); bad['id']='not-a-uuid'
        self.assertEqual(self.post('target',bad).status_code,400)
        unknown=self.target_body();unknown['id']=uid('missing-target')
        self.assertEqual(self.post('target',unknown).status_code,404)
        source=self.target_body();source.update(action='sources',url='https://localhost/private')
        self.assertEqual(self.post('target',source).status_code,400)
        self.assertFalse(self.db.patches)

    def test_add_source_persists_first_url_and_preserves_additional_sources(self):
        body=self.target_body();body.update(action='sources',url=ROOT)
        self.assertEqual(self.post('target',body).status_code,200)
        body['url']=ROOT+'/backup'
        self.assertEqual(self.post('target',body).status_code,200)
        self.assertEqual(self.post('target',body).status_code,200)
        remote=self.db.rows['aseel_movies'][self.target['id']]
        self.assertEqual(remote['source_page_url'],ROOT)
        self.assertEqual(remote['status'],'published')
        self.assertEqual(remote['rights_status'],'approved')
        sources=self.worker.queue.sources('aseel_movies',self.target['id'])
        self.assertEqual({s['url'] for s in sources if s['kind']=='original'},{ROOT,ROOT+'/backup'})
        self.assertEqual(len(sources),3)
        self.assertEqual(self.worker.queue.snapshot()['counts']['missing_source'],0)
        self.assertEqual(len(self.db.patches),1)

    def test_existing_embed_can_be_explicitly_promoted_to_original_source(self):
        embed='https://player.example.org/embed/9'
        self.worker.queue.remember('aseel_movies',self.target['id'],dict(url=embed,kind='embed',label='player'))
        body=self.target_body();body.update(action='sources',url=embed)
        self.assertEqual(self.post('target',body).status_code,200)
        sources=self.worker.queue.sources('aseel_movies',self.target['id'])
        self.assertEqual(next(s for s in sources if s['url']==embed)['kind'],'original')
        self.assertEqual(self.worker.queue.snapshot()['counts']['missing_source'],0)

    def test_status_and_target_responses_exclude_saved_row_payloads(self):
        self.target['private_internal_value']='do not expose'
        self.worker.queue.ingest('aseel_movies',self.target)
        status=self.client.get('/api/autosync/status')
        self.assertEqual(status.status_code,200)
        self.assertNotIn('secret',status.text.lower())
        response=self.client.get('/api/autosync/targets?limit=5000')
        self.assertEqual(response.status_code,200)
        target=response.json()['targets'][0]
        self.assertEqual(target['target_id'],self.target['id'])
        self.assertNotIn('data',target)
        self.assertNotIn('private_internal_value',response.text)
        self.assertNotIn('dirty',target)

    def test_individual_refresh_queues_only_the_selected_uuid(self):
        second=dict(self.target,id=uid('second-api-target'))
        self.db.seed('aseel_movies',second)
        self.worker.queue.ingest('aseel_movies',second)
        for row in (self.target,second):
            self.worker.queue.update('aseel_movies',row['id'],next_check=NOW+300,next_refresh=NOW+600)
        body=self.target_body();body['action']='refresh'
        self.assertEqual(self.post('target',body).status_code,200)
        with self.worker.queue.db() as conn:
            selected=dict(conn.execute('select * from auto_jobs where target_id=?',(self.target['id'],)).fetchone())
            other=dict(conn.execute('select * from auto_jobs where target_id=?',(second['id'],)).fetchone())
        self.assertEqual(selected['next_check'],0)
        self.assertEqual(selected['next_refresh'],0)
        self.assertEqual(other['next_check'],NOW+300)
        self.assertEqual(other['next_refresh'],NOW+600)


if __name__ == '__main__': unittest.main()
