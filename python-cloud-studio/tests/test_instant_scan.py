"""Offline verification of live scans, concurrent job IDs and safe auto-publishing."""
from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path
from uuid import uuid4

from auto_sync import AutoSync
from instant_scan import InstantScanManager

from test_studio_library_v2 import FakeCloud, FakeResolver


class Audit:
    def __init__(self):
        self.records=[]
    def audit(self,*args,**kwargs):
        self.records.append((args,kwargs))


class SlowResolver(FakeResolver):
    def __init__(self,pause=0.15):
        super().__init__()
        self.pause=pause
        self.started=threading.Event()
        self.lock=threading.Lock()
        self.active=0
        self.peak=0
    def check(self,sources):
        with self.lock:
            self.active+=1
            self.peak=max(self.peak,self.active)
            self.started.set()
        time.sleep(self.pause)
        try:return super().check(sources)
        finally:
            with self.lock:self.active-=1


class InstantScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=FakeCloud()
        self.audit=Audit()
        self.resolver=FakeResolver()
        self.worker=AutoSync(Path(self.tmp.name),db_factory=lambda:self.db,
            resolver_factory=lambda:self.resolver,clock=time.time)
        self.worker.db=self.db
        self.manager=InstantScanManager(self.worker,self.audit)

    def tearDown(self):
        self.tmp.cleanup()

    def movie(self,rights="approved",status="draft",index=1):
        ident=str(uuid4())
        self.db.rows[("aseel_movies",ident)]={
            "id":ident,"title_ar":"فيلم "+str(index),"rights_status":rights,
            "status":status,"source_page_url":"https://example.com/movie/"+str(index),
            "stream_url":"https://media.example.com/"+str(index)+".mp4",
            "link_health_status":"unchecked"}
        return ident

    def done(self,run_id,deadline=4):
        end=time.monotonic()+deadline
        while time.monotonic()<end:
            result=self.manager.status(run_id)
            if result["status"]!="running":return result
            time.sleep(0.025)
        self.fail("live scan did not reach terminal state")

    def test_immediate_scan_saves_verified_url_and_auto_publishes_approved_movie(self):
        ident=self.movie()
        r=self.manager.start(self.db,"aseel_movies",ident,True)
        final=self.done(r["run_id"])
        self.assertEqual(final["status"],"completed")
        self.assertEqual(final["progress"],100)
        self.assertEqual(final["healthy"],1)
        self.assertEqual(final["published"],1)
        self.assertEqual(self.db.rows[("aseel_movies",ident)]["status"],"published")
        self.assertIn("next_refresh",self.worker.queue.targets(query=ident)[0])
        self.assertGreater(self.resolver.checks,0)
        self.assertNotIn("stream_url",str(final["outcomes"]))

    def test_pending_rights_stays_draft_after_healthy_scan(self):
        ident=self.movie(rights="pending")
        r=self.manager.start(self.db,"aseel_movies",ident,True)
        final=self.done(r["run_id"])
        self.assertEqual(final["healthy"],1)
        self.assertEqual(final["published"],0)
        self.assertEqual(self.db.rows[("aseel_movies",ident)]["status"],"draft")

    def test_click_same_title_reuses_live_scan_id_and_does_not_double_check(self):
        self.resolver=SlowResolver(0.3)
        self.worker.resolver_factory=lambda:self.resolver
        ident=self.movie()
        first=self.manager.start(self.db,"aseel_movies",ident,True)
        second=self.manager.start(self.db,"aseel_movies",ident,True)
        self.assertEqual(first["run_id"],second["run_id"])
        self.assertTrue(second["already_running"])
        self.assertEqual(self.done(first["run_id"])["healthy"],1)

    def test_two_movie_scans_run_concurrently(self):
        self.resolver=SlowResolver(0.3)
        self.worker.resolver_factory=lambda:self.resolver
        one,two=self.movie(index=1),self.movie(index=2)
        a=self.manager.start(self.db,"aseel_movies",one,True)
        b=self.manager.start(self.db,"aseel_movies",two,True)
        self.assertEqual(self.done(a["run_id"])["status"],"completed")
        self.assertEqual(self.done(b["run_id"])["status"],"completed")
        self.assertGreaterEqual(self.resolver.peak,2)

    def test_series_scans_episodes_and_publishes_approved_children(self):
        sid=str(uuid4())
        season=str(uuid4())
        eps=[str(uuid4()),str(uuid4())]
        self.db.rows[("aseel_series",sid)]={"id":sid,"title_ar":"مسلسل الاختبار",
            "status":"draft","rights_status":"approved","source_page_url":""}
        self.db.rows[("aseel_seasons",season)]={"id":season,"number":1,
            "series_id":sid,"title_ar":"الموسم 1"}
        for number,eid in enumerate(eps,1):
            self.db.rows[("aseel_episodes",eid)]={
                "id":eid,"season_id":season,"number":number,
                "title_ar":"الحلقة "+str(number),"rights_status":"approved",
                "status":"draft","stream_url":"https://media.example.com/ep"+str(number)+".mp4",
                "link_health_status":"unchecked","source_page_url":""}
        started=self.manager.start(self.db,"aseel_series",sid)
        final=self.done(started["run_id"],deadline=6)
        self.assertEqual(final["status"],"completed")
        self.assertEqual(final["total"],2)
        self.assertEqual(final["completed"],2)
        self.assertEqual(final["healthy"],2)
        self.assertEqual(final["published"],3)
        self.assertEqual(self.db.rows[("aseel_series",sid)]["status"],"published")

    def test_invalid_run_id_fails(self):
        with self.assertRaises(ValueError):
            self.manager.status(str(uuid4()))


if __name__=="__main__":
    unittest.main()
