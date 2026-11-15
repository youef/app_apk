"""Offline smart-sync sidecar tests. Frozen extractor and network are not used."""
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import cloud_auth
import server
from auto_sync import AutoSync
from smart_sync_management import SmartSyncManagement, known_signed_expiry
from test_auto_sync import FakeDB, NOW, OLD, ROOT, uid


class SmartSyncManagementTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db=FakeDB()
        self.worker=AutoSync(self.tmp.name,db_factory=lambda:self.db,clock=lambda:NOW)
        self.worker.db=self.db
        self.manager=SmartSyncManagement(self.worker,clock=lambda:NOW)

    def row(self,name,stream=OLD):
        item=dict(id=uid(name),title_ar=name,source_page_url=ROOT,
                  stream_url=stream,stream_variants=[],status='published',
                  rights_status='approved')
        self.db.seed('aseel_movies',item)
        self.worker.queue.ingest('aseel_movies',item)
        return item

    def test_configure_persists_after_restart_and_keeps_video_engine(self):
        resolver_before=self.worker.resolver_factory
        settings=self.manager.configure(2,30)
        self.assertEqual(settings['interval_hours'],2)
        self.assertEqual(self.worker.interval,7200)
        self.assertIs(self.worker.resolver_factory,resolver_before)
        restarted=AutoSync(self.tmp.name,db_factory=lambda:self.db,clock=lambda:NOW)
        manager=SmartSyncManagement(restarted,clock=lambda:NOW)
        self.assertEqual(restarted.interval,7200)
        self.assertEqual(manager.expiry_lead_minutes,30)
        with self.assertRaises(ValueError):manager.configure(0,30)
        with self.assertRaises(ValueError):manager.configure(2,240)

    def test_hls_signature_time_and_one_time_priority(self):
        signed=(
            'https://store.example.org/hls/02/movie/master.m3u8?'
            't=token&s='+str(int(NOW-100))+'&e=1800')
        row=self.row('near-expiry',signed)
        self.worker.queue.update('aseel_movies',row['id'],
                                 next_refresh=NOW+10000,next_check=NOW+10000)
        self.assertEqual(known_signed_expiry(signed),NOW+1700)
        self.assertEqual(self.manager.hydrate_signed_expiries(),1)
        self.assertEqual(self.manager.prioritize_expiring(),1)
        with self.worker.queue.db() as conn:
            j=conn.execute('select * from auto_jobs where target_id=?',(row['id'],)).fetchone()
            self.assertEqual(j['next_refresh'],0)
            self.assertEqual(j['stream_url'],signed)
        # A 75-second background sweep cannot repeatedly queue the same token.
        self.worker.queue.update('aseel_movies',row['id'],next_refresh=NOW+10000)
        self.assertEqual(self.manager.prioritize_expiring(),0)

    def test_promote_only_verified_newer_same_video_token_without_rights_change(self):
        base='https://store.example.org/hls/02/movie/master.m3u8'
        old=base+'?t=old&s='+str(int(NOW-1200))+'&e=3600'
        fresh=base+'?t=fresh&s='+str(int(NOW))+'&e=43200'
        row=self.row('signed-rotation',old)
        self.worker.queue.remember('aseel_movies',row['id'],{
            'url':fresh,'kind':'direct','status':'healthy','last_checked_at':NOW
        },restored=True)
        self.manager.hydrate_signed_expiries()
        self.assertEqual(self.manager.promote_verified_signed(),1)
        with self.worker.queue.db() as conn:
            job=dict(conn.execute('select * from auto_jobs where target_id=?',(row['id'],)).fetchone())
        self.assertEqual(job['stream_url'],fresh)
        self.assertTrue(job['dirty'])
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'],old)
        self.worker.flush(job)
        remote=self.db.rows['aseel_movies'][row['id']]
        self.assertEqual(remote['stream_url'],fresh)
        self.assertEqual(remote['status'],'published')
        self.assertEqual(remote['rights_status'],'approved')
        self.assertEqual(self.manager.promote_verified_signed(),0)

    def test_never_promote_different_title_or_unverified_candidate(self):
        old='https://store.example.org/hls/02/movie/master.m3u8?t=old&s='+str(int(NOW-900))+'&e=3600'
        row=self.row('film',old)
        other='https://store.example.org/hls/02/other/master.m3u8?t=next&s='+str(int(NOW))+'&e=43200'
        self.worker.queue.remember('aseel_movies',row['id'],
            {'url':other,'kind':'direct','status':'healthy','last_checked_at':NOW},restored=True)
        candidate=old.split('?')[0]+'?t=unverified&s='+str(int(NOW))+'&e=43200'
        self.worker.queue.remember('aseel_movies',row['id'],
            {'url':candidate,'kind':'direct','status':'unchecked'},restored=True)
        self.manager.hydrate_signed_expiries()
        self.assertEqual(self.manager.promote_verified_signed(),0)

    def test_status_filter_total_and_queue_diagnostics(self):
        good=self.row('healthy film')
        bad=self.row('broken film')
        self.worker.queue.update('aseel_movies',good['id'],
             status='healthy',next_check=NOW+3600,next_refresh=NOW+3600)
        self.worker.queue.update('aseel_movies',bad['id'],
             status='broken',failures=2,next_check=NOW-1,next_refresh=NOW+3600)
        rows,total=self.manager.targets(1,0,'','broken')
        self.assertEqual(total,1)
        self.assertEqual(rows[0]['target_id'],bad['id'])
        self.assertEqual(self.manager.targets(1,0)[1],2)
        status=self.manager.status()
        self.assertGreaterEqual(status['due_count'],1)
        self.assertEqual(status['retrying'],1)
        with self.assertRaises(ValueError):self.manager.targets(1,0,'','unsafe')

    def test_csrf_bulk_atomic_and_schedule_api(self):
        patch_worker=patch.object(server,'AUTOSYNC',self.worker)
        patch_manager=patch.object(server,'SMART_SYNC',self.manager)
        patch_gate=patch.object(cloud_auth,'ENABLED',False)
        for patched in (patch_worker,patch_manager,patch_gate):
            patched.start()
            self.addCleanup(patched.stop)
        client=TestClient(server.app)
        self.addCleanup(client.close)
        csrf=client.get('/api/init').json()['csrf']
        headers={'X-CSRF-Token':csrf}
        first=self.row('one')
        second=self.row('two')
        for item in (first,second):
            self.worker.queue.update('aseel_movies',item['id'],
                  next_check=NOW+1800,next_refresh=NOW+1800)
        schedule={'interval_hours':4,'expiry_lead_minutes':60}
        self.assertEqual(client.post('/api/autosync/schedule',json=schedule).status_code,403)
        self.assertEqual(client.post('/api/autosync/schedule',json=schedule,headers=headers).status_code,200)
        response=client.get('/api/autosync/targets?filter=all&limit=1')
        self.assertEqual(response.status_code,200,response.text)
        self.assertGreaterEqual(response.json()['total'],2)
        self.assertNotIn('stream_url',response.text)
        payload={'action':'refresh','targets':[
           {'table':'aseel_movies','id':first['id']},
           {'table':'aseel_movies','id':second['id']},
           {'table':'aseel_movies','id':first['id']}]}
        result=client.post('/api/autosync/bulk',json=payload,headers=headers)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['queued'],2)
        self.worker.queue.update('aseel_movies',first['id'],next_check=NOW+100)
        bad={'action':'check','targets':[
          {'table':'aseel_movies','id':first['id']},
          {'table':'aseel_movies','id':uid('not-saved')}]}
        self.assertEqual(client.post('/api/autosync/bulk',json=bad,headers=headers).status_code,404)
        with self.worker.queue.db() as conn:
            check=conn.execute('select next_check from auto_jobs where target_id=?',
                               (first['id'],)).fetchone()[0]
        self.assertEqual(check,NOW+100)


if __name__=='__main__':unittest.main()
