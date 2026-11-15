"""Offline production-path checks for intelligent refresh and library mutations."""
from __future__ import annotations

import copy
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

from auto_sync import AutoSync, expires_at
from library_editor import EditBody, LibraryEditor, normalized_fields


class FakeCloud:
    def __init__(self):
        self.rows = {}
        self.changes = []
        self.sources = []

    def patch(self, table, ident, payload):
        self.changes.append((table, ident, copy.deepcopy(payload)))
        row = self.rows.get((table, ident), {"id": ident})
        row.update(payload)
        self.rows[(table, ident)] = row
        return row

    def upsert_source(self, payload):
        self.sources.append(payload)
        return payload

    def single(self, table, params):
        for (t, ident), row in self.rows.items():
            if t != table:
                continue
            if "id" in params and params["id"] != "eq." + ident:
                continue
            if "number" in params and params["number"] != "eq." + str(row.get("number")):
                continue
            if "series_id" in params and params["series_id"] != "eq." + str(row.get("series_id")):
                continue
            if "season_id" in params and params["season_id"] != "eq." + str(row.get("season_id")):
                continue
            return dict(row)
        return None

    def query(self, table, params):
        rows = []
        for (t, ident), row in self.rows.items():
            if t != table:
                continue
            if "series_id" in params and params["series_id"] != "eq." + str(row.get("series_id")):
                continue
            if "season_id" in params and params["season_id"] != "eq." + str(row.get("season_id")):
                continue
            rows.append(dict(row))
        return rows[int(params.get("offset",0)):int(params.get("offset",0))+int(params.get("limit",500))]

    def insert(self,table,payload):
        ident=str(uuid4())
        row={"id":ident,**payload}
        self.rows[(table,ident)]=row
        return dict(row)

    def req(self,method,table,params=None,payload=None):
        if method!="DELETE": raise ValueError("unsupported")
        if table=="aseel_media_sources":return []
        ident=(params or {}).get("id","").removeprefix("eq.")
        self.rows.pop((table,ident),None)
        return []


class FakeResolver:
    def __init__(self, refreshed="", valid=None):
        self.refreshed=refreshed
        self.valid=valid
        self.extracts=0
        self.checks=0

    def extract(self,pages,force_browser=False):
        self.extracts+=1
        return ([dict(url=self.refreshed,kind="direct",label="new")] if self.refreshed else []),[]

    def check(self,candidates):
        self.checks+=1
        return [{**x,"verified":self.valid(x["url"]) if self.valid else True}
                for x in candidates if x.get("kind")!="original"]


class Control:
    def audit(self,*args,**kwargs):pass


class StudioV2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.cloud=FakeCloud()
        self.now=time.time()
        self.resolver=FakeResolver()
        self.worker=AutoSync(Path(self.tmp.name),db_factory=lambda:self.cloud,
            resolver_factory=lambda:self.resolver,clock=lambda:self.now)
        self.worker.db=self.cloud
        self.ident=str(uuid4())

    def tearDown(self):
        self.tmp.cleanup()

    def add_movie(self,stream,source="https://example.com/movie/example"):
        self.cloud.rows[("aseel_movies",self.ident)]=dict(id=self.ident,title_ar="فيلم الاختبار",
            stream_url=stream,source_page_url=source,poster_url="")
        self.worker.queue.ingest("aseel_movies",self.cloud.rows[("aseel_movies",self.ident)])
        self.worker.queue.update("aseel_movies",self.ident,status="healthy",next_check=0,
                                 next_refresh=self.now-100)
        return self.worker.queue.targets(query=self.ident)[0]

    def test_valid_permanent_url_is_checked_in_48h_without_reextract(self):
        self.add_movie("https://media.example.com/watch/video.mp4")
        self.worker.check_target(self.worker.queue.targets(query=self.ident)[0])
        self.assertEqual(self.resolver.extracts,0)
        row=self.worker.queue.targets(query=self.ident)[0]
        self.assertAlmostEqual(row["next_check"]-self.now,48*3600,delta=2)
        self.assertGreater(row["next_refresh"]-self.now,365*86400)
        self.assertEqual(row["status"],"healthy")

    def test_broken_permanent_url_is_reextracted_from_original_page(self):
        old="https://media.example.com/watch/broken.mp4"
        new="https://media.example.com/watch/restored.mp4"
        self.add_movie(old)
        self.resolver.refreshed=new
        self.resolver.valid=lambda url:url==new
        self.worker.check_target(self.worker.queue.targets(query=self.ident)[0])
        row=self.worker.queue.targets(query=self.ident)[0]
        self.assertGreaterEqual(self.resolver.extracts,1)
        self.assertEqual(row["stream_url"],new)
        self.assertEqual(row["status"],"healthy")

    def test_signed_expiring_url_gets_verified_newer_token(self):
        stamp=int(self.now)
        old=f"https://media.example.com/hls/master.m3u8?t=old&s={stamp-1300}&e=2000"
        new=f"https://media.example.com/hls/master.m3u8?t=new&s={stamp}&e=14400"
        self.assertGreater(expires_at(new),expires_at(old))
        self.add_movie(old)
        self.resolver.refreshed=new
        self.worker.check_target(self.worker.queue.targets(query=self.ident)[0])
        row=self.worker.queue.targets(query=self.ident)[0]
        self.assertEqual(row["stream_url"],new)
        self.assertGreater(row["next_refresh"],self.now+3000)

    def test_field_whitelist_and_url_validation(self):
        with self.assertRaises(ValueError):
            normalized_fields("aseel_movies",{"rights_status":"approved"})
        with self.assertRaises(ValueError):
            normalized_fields("aseel_movies",{"poster_url":"http://127.0.0.1/test"})
        self.assertEqual(normalized_fields("aseel_seasons",{"number":3})["number"],3)

    def test_movie_create_edit_delete_removes_queue(self):
        editor=LibraryEditor(self.worker,Control())
        created=editor.save(self.cloud,EditBody(action="create",table="aseel_movies",
            fields={"title_ar":"الاختبار","source_page_url":"https://example.com/movies/a",
                    "poster_url":"https://example.com/images/a.jpg"}))
        self.assertTrue(created["created"])
        ident=created["id"]
        self.assertTrue(self.worker.queue.targets(query=ident))
        editor.save(self.cloud,EditBody(action="update",table="aseel_movies",id=ident,
            fields={"title_ar":"عنوان جديد"}))
        self.assertEqual(self.cloud.rows[("aseel_movies",ident)]["title_ar"],"عنوان جديد")
        result=editor.delete(self.cloud,EditBody(action="delete",table="aseel_movies",
                                            id=ident,confirm=ident))
        self.assertEqual(result["deleted"],1)
        self.assertEqual(self.worker.queue.targets(query=ident),[])

    def test_series_scan_queues_all_known_seasons_and_episodes(self):
        editor=LibraryEditor(self.worker,Control())
        sid=str(uuid4())
        season_id=str(uuid4())
        eid=str(uuid4())
        self.cloud.rows[("aseel_series",sid)]={
            "id":sid,"title_ar":"مسلسل","source_page_url":"https://example.com/series/a"}
        self.cloud.rows[("aseel_seasons",season_id)]={
            "id":season_id,"series_id":sid,"number":1,"title_ar":"الموسم 1"}
        self.cloud.rows[("aseel_episodes",eid)]={
            "id":eid,"season_id":season_id,"number":1,
            "title_ar":"الحلقة 1","source_page_url":"https://example.com/episode/a-1"}
        result=editor.scan(self.cloud, type("Scan",(),dict(table="aseel_series",id=sid,force=False))())
        self.assertEqual(result["queued"],2)
        self.assertEqual(len(self.worker.queue.targets(query="")),2)


if __name__=="__main__":
    unittest.main()
