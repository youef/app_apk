"""Focused compatibility tests for optional control plane, no network required."""
import tempfile
import threading
import time
from pathlib import Path
from uuid import uuid4
import unittest

from auto_sync import QueueDB
from studio_control import Control, analyze_seasons, path_label


class StandaloneSync:
    def __init__(self, folder):
        self.queue = QueueDB(Path(folder) / "autosync.sqlite3")
        self.enabled = True
        self.wake_event = threading.Event()
    def status(self):
        return {"running":True,"enabled":True,"connected":True,"last_tick":time.time(),"last_error":""}


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.sync = StandaloneSync(self.temp.name)
        self.control = Control(self.temp.name, self.sync)

    def test_season_gaps_and_duplicates_are_deterministic(self):
        seasons = [{"id":"s1","number":1,"title_ar":"الموسم الأول"},
                   {"id":"s2","number":2,"title_ar":"الموسم الثاني"}]
        episodes = [{"id":"a","season_id":"s1","number":1,"title_ar":"1"},
                    {"id":"b","season_id":"s1","number":3,"title_ar":"3"},
                    {"id":"c","season_id":"s1","number":3,"title_ar":"3 duplicate"},
                    {"id":"d","season_id":"s2","number":1,"title_ar":"1"}]
        result = analyze_seasons(seasons, episodes)
        self.assertEqual(result[0]["missing"], [2])
        self.assertEqual(result[0]["duplicate"], [3])
        self.assertEqual(result[1]["missing"], [])
        self.assertEqual(result[1]["duplicate"], [])

    def test_signed_urls_are_not_exposed_by_history(self):
        url = "https://store.example.org/hls/master.m3u8?t=PRIVATE&v=123"
        self.assertEqual(path_label(url), "store.example.org/hls/master.m3u8")
        self.assertNotIn("PRIVATE",path_label(url))

    def test_monitor_persists_notifications_and_prequeues_legacy_refresh_once(self):
        identifier=str(uuid4())
        now=time.time()
        with self.sync.queue.db() as db:
            db.execute("""insert into auto_jobs
                 (table_name,target_id,title,page_url,next_check,next_refresh)
                 values(?,?,?,?,?,?)""",
                 ("aseel_episodes",identifier,"الحلقة 1","https://example.org/episode/1",now+3600,now+20000))
            db.execute("""insert into auto_sources
                 (table_name,target_id,source_key,url,kind,first_seen_at,
                  last_seen_at,status,expires_at)
                 values(?,?,?,?,?,?,?,?,?)""",
                 ("aseel_episodes",identifier,"test-source",
                  "https://store.example.org/video.m3u8?t=SECRET","direct",now,now,
                  "healthy",now+2100))
        self.sync.queue.event("new_episode","حلقة جديدة","aseel_episodes",identifier)
        self.control.step()
        status=self.control.overview()
        self.assertEqual(status["expiring"],1)
        self.assertEqual(status["alerts_unread"],2)
        with self.sync.queue.db() as db:
            job=db.execute("select next_refresh from auto_jobs where target_id=?",(identifier,)).fetchone()
        self.assertEqual(job["next_refresh"],0)
        self.assertTrue(self.sync.wake_event.is_set())
        self.control.step()
        self.assertEqual(self.control.overview()["alerts_unread"],2)
        with self.control.db() as db:
            audit=db.execute("select count(*) from control_audit where action='scheduled_refresh'").fetchone()[0]
        self.assertEqual(audit,1)

    def test_empty_dashboard_is_safe_without_database_connection(self):
        overview=self.control.overview()
        self.assertEqual(overview["counts"]["episodes"],0)
        self.assertEqual(overview["alerts_unread"],0)


if __name__=="__main__":
    unittest.main()
