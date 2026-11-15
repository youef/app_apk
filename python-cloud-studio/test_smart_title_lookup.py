"""Offline title-first discovery tests. No external network or extraction changes."""
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid5, NAMESPACE_DNS

from fastapi.testclient import TestClient

import cloud_auth
import server
from auto_sync import AutoSync
from smart_title_lookup import (find_titles, normalized_title, queue_title_refresh,
                                search_feeds, search_library)
from smart_sync_management import SmartSyncManagement


def uid(value):
    return str(uuid5(NAMESPACE_DNS, "alezz-title-" + value))


class MemoryDB:
    def __init__(self):
        self.tables = {name: [] for name in (
            "aseel_movies", "aseel_series", "aseel_seasons", "aseel_episodes",
            "aseel_studio_discovery_feeds"
        )}

    def query(self, table, filters):
        rows = self.tables[table]
        output = []
        for row in rows:
            allowed = True
            for field, value in filters.items():
                if field in ("select", "limit", "offset"):
                    continue
                if value.startswith("eq."):
                    allowed &= str(row.get(field)) == value[3:]
                elif value.startswith("ilike.*"):
                    text = value[len("ilike.*"):].rstrip("*").replace("*", " ")
                    allowed &= normalized_title(text) in normalized_title(row.get(field, ""))
            if allowed:
                output.append(dict(row))
        offset = int(filters.get("offset") or 0)
        limit = int(filters.get("limit") or 100)
        return output[offset:offset + limit]

    def single(self, table, filters):
        rows = self.query(table, filters)
        return rows[0] if rows else None


class TitleLookupTests(unittest.TestCase):
    def setUp(self):
        self.db = MemoryDB()
        self.movie = dict(id=uid("movie"), title_ar="فيلم لا يعقل",
            title_original="Unbelievable", source_page_url="https://source.example/movies/la-yuqal",
            stream_url="https://cdn.example/master.m3u8",stream_variants=[])
        self.series = dict(id=uid("series"), title_ar="مسلسل حيث تشرق الشمس",
            title_original="Sunrise", source_page_url="https://source.example/series/sun",
            stream_url="",stream_variants=[])
        self.episode = dict(id=uid("episode"), title_ar="الحلقة 1",
            source_page_url="https://source.example/episode/1",
            stream_url="https://cdn.example/1.m3u8",stream_variants=[])
        self.season = dict(id=uid("season"), series_id=self.series["id"], number=1)
        for table, row in (("aseel_movies",self.movie),("aseel_series",self.series),
                           ("aseel_episodes",self.episode),("aseel_seasons",self.season)):
            self.db.tables[table].append(row)
        self.episode["season_id"] = self.season["id"]
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.worker = AutoSync(self.tmp.name,db_factory=lambda:self.db)

    def test_search_movies_and_series_by_partial_arabic_or_original_title(self):
        self.assertEqual(search_library(self.db,"لا يعقل")[0]["id"],self.movie["id"])
        self.assertEqual(search_library(self.db,"حيث تشرق",kind="series")[0]["id"],self.series["id"])
        self.assertEqual(search_library(self.db,"unbelievable")[0]["kind"],"movie")
        self.assertEqual(find_titles(self.db,"مسلسل حيث تشرق")["count"],1)
        self.assertNotIn("stream_url",str(search_library(self.db,"لا يعقل")))
        with self.assertRaises(ValueError):search_library(self.db,"a")
        with self.assertRaises(ValueError):search_library(self.db,"  ",kind="series")

    def test_refresh_queues_legacy_worker_without_changing_media_or_rights(self):
        before=self.movie["stream_url"]
        result=queue_title_refresh(self.db,self.worker,"aseel_movies",self.movie["id"])
        self.assertEqual(result["queued"],1)
        self.assertEqual(self.movie["stream_url"],before)
        with self.worker.queue.db() as conn:
            job=conn.execute("select * from auto_jobs where target_id=?",(self.movie["id"],)).fetchone()
            self.assertEqual(job["next_refresh"],0)
            self.assertEqual(job["next_check"],0)
        self.assertEqual(self.worker.queue.sources("aseel_movies",self.movie["id"])[0]["kind"],"original")

    def test_series_refresh_includes_existing_episodes_and_new_discovery_parent(self):
        result=queue_title_refresh(self.db,self.worker,"aseel_series",self.series["id"])
        self.assertEqual(result["queued"],2)
        self.assertEqual(result["episodes"],1)
        with self.worker.queue.db() as conn:
            jobs=[dict(x) for x in conn.execute("select * from auto_jobs")]
        self.assertEqual({x["table_name"] for x in jobs},{"aseel_series","aseel_episodes"})
        self.assertTrue(all(x["next_refresh"]==0 for x in jobs))

    def test_rejects_missing_page_or_wrong_table(self):
        self.movie["source_page_url"] = ""
        with self.assertRaisesRegex(ValueError,"مصدر"):queue_title_refresh(
            self.db,self.worker,"aseel_movies",self.movie["id"])
        with self.assertRaises(ValueError):queue_title_refresh(
            self.db,self.worker,"aseel_episodes",self.episode["id"])
        with self.assertRaises(ValueError):queue_title_refresh(
            self.db,self.worker,"aseel_series","not-a-uuid")

    def test_registered_feed_lookup_uses_bounded_source_listing(self):
        self.db.tables["aseel_studio_discovery_feeds"].append(dict(
            source_url="https://source.example/catalog",kind="movie",enabled=True))
        listing = '<html><article class="movie"><a href="/movies/فيلم-لا-يعقل/">فيلم لا يعقل</a></article></html>'
        class FakeClient:
            def __init__(self, timeout):self.timeout=timeout
            def get(self, url):return url, "text/html", listing
        result=search_feeds(self.db,"لا يعقل",kind="movie",client_factory=FakeClient)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]["source"],"feed")
        self.assertIn("/movies/",result[0]["source_url"])

    def test_legacy_feed_worker_is_wired_but_not_run_by_search(self):
        class Recorder:
            def __init__(self):self.calls=0
            def process_due(self):
                self.calls+=1
                manager.stop_event.set()
        discovery=Recorder()
        manager=SmartSyncManagement(self.worker,discovery=discovery)
        self.worker.db=self.db
        self.worker.queue.setting("enabled",True)
        manager._run_feeds()
        self.assertEqual(discovery.calls,1)

    def test_http_endpoints_require_admin_and_csrf(self):
        with patch.object(cloud_auth,"ENABLED",False), patch.object(server,"AUTOSYNC",self.worker):
            client=TestClient(server.app)
            self.addCleanup(client.close)
            init=client.get("/api/init")
            token=init.json()["csrf"]
            sid=client.cookies.get(server.COOKIE)
            server._states[sid].db=self.db
            result=client.get("/api/title-search",params={"q":"لا يعقل"})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()["results"][0]["id"],self.movie["id"])
            payload={"table":"aseel_movies","id":self.movie["id"]}
            self.assertEqual(client.post("/api/title-refresh",json=payload).status_code,403)
            ok=client.post("/api/title-refresh",json=payload,headers={"X-CSRF-Token":token})
            self.assertEqual(ok.status_code,200,ok.text)
            self.assertEqual(ok.json()["queued"],1)


if __name__=="__main__":unittest.main()
