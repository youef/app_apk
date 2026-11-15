"""Offline tests for independent feed scheduling. No real website or Supabase calls."""
import tempfile
import threading
import time
import unittest
from copy import deepcopy
from dataclasses import dataclass

from alezz_fetchv_importer import Catalogue
from smart_discovery import FEED_TABLE, SmartDiscovery

ROOT="https://media.example.org/movies/"
PAGES=(ROOT+"movie-a/", ROOT+"movie-b/")


class MemoryDatabase:
    def __init__(self):
        self.tables={name:{} for name in (FEED_TABLE,"aseel_movies","aseel_series")}
        self.patches=[]
        self.created=0

    def query(self,table,params):
        rows=list(self.tables[table].values())
        for key,val in params.items():
            if key in ("select","order","limit"):continue
            if isinstance(val,str) and val.startswith("eq."):
                rows=[row for row in rows if str(row.get(key)).lower()==val[3:].lower()]
            if isinstance(val,str) and val.startswith("lte."):
                rows=[row for row in rows if str(row.get(key) or "")<=val[4:]]
        if params.get("order")=="next_scan.asc":
            rows=sorted(rows,key=lambda row:row["next_scan"])
        return deepcopy(rows[:int(params.get("limit",1000))])

    def single(self,table,params):
        rows=self.query(table,{**params,"limit":1})
        return rows[0] if rows else None

    def insert(self,table,payload):
        self.created+=1
        row={"id":f"00000000-0000-4000-8000-{self.created:012d}",**payload}
        self.tables[table][row["id"]]=deepcopy(row)
        return deepcopy(row)

    def patch(self,table,identifier,payload):
        row=self.tables[table][identifier]
        row.update(deepcopy(payload))
        self.patches.append((table,identifier,deepcopy(payload)))
        return deepcopy(row)


class FakeWorker:
    def __init__(self):
        self.db=MemoryDatabase()
        self.wake_event=threading.Event()
        self.stop_event=threading.Event()
        self.saved=[]
        self.events=[]
        class Queue:
            def __init__(self, outer):self.outer=outer
            def event(self,*args):self.outer.events.append(args)
        self.queue=Queue(self)

    def remember_saved(self,cat,result):
        self.saved.append((cat.kind,result))


class FakeSourceClient:
    def __init__(self,timeout=12):pass
    def get(self,url):
        return url,"text/html","<html><body>Movies</body></html>"


def parsed_work(url,client,**kwargs):
    return Catalogue(kind="movie",title="Film "+url.rsplit("/",2)[-2],
                     url=url,description="Metadata only")


class SmartDiscoveryTests(unittest.TestCase):
    def make(self):
        worker=FakeWorker()
        def listing(html,url,root,kind):
            return list(PAGES),[]
        def save(cat,db,*,publish,rights):
            assert not publish and not rights
            row=db.insert("aseel_movies",{
                "title_ar":cat.title,"source_page_url":cat.url,
                "status":"draft","rights_status":"pending"
            })
            return {"work_id":row["id"],"bindings":[
                {"id":row["id"],"table":"aseel_movies","season":0,"number":0}
            ]}
        manager=SmartDiscovery(worker,clock=lambda:1900000000,
                        source_client=FakeSourceClient,parse_listing=listing,
                        parse_work=parsed_work,save_work=save)
        return worker,manager

    def test_new_movies_are_drafts_and_deduplicated_after_repeat_scan(self):
        worker,manager=self.make()
        feed=manager.add(ROOT,kind="movie",interval_minutes=240)
        assert manager.process_due()
        self.assertEqual(len(worker.db.tables["aseel_movies"]),2)
        self.assertEqual(len(worker.saved),2)
        self.assertTrue(all(r["status"]=="draft" and r["rights_status"]=="pending"
                        for r in worker.db.tables["aseel_movies"].values()))
        self.assertEqual(manager.feeds()[0]["last_created"],2)
        manager.action(feed["id"],"scan")
        assert manager.process_due()
        self.assertEqual(len(worker.db.tables["aseel_movies"]),2)
        self.assertEqual(manager.feeds()[0]["last_created"],0)

    def test_pause_resume_and_due_schedule_are_remote(self):
        _,manager=self.make()
        feed=manager.add(ROOT)
        manager.action(feed["id"],"pause")
        self.assertFalse(manager.process_due())
        manager.action(feed["id"],"resume")
        self.assertTrue(manager.process_due())
        self.assertFalse(manager.process_due())

    def test_bad_feed_kind_and_video_are_rejected(self):
        _,manager=self.make()
        with self.assertRaises(ValueError):manager.add(ROOT,kind="live")
        with self.assertRaises(ValueError):manager.add(ROOT+"master.m3u8")
        with self.assertRaises(ValueError):manager.add("https://127.0.0.1/private")

    def test_existing_works_not_overwritten_and_one_bad_item_is_isolated(self):
        worker,manager=self.make()
        worker.db.insert("aseel_movies",{
            "source_page_url":PAGES[0],"title_ar":"Existing",
            "status":"published","rights_status":"approved"
        })
        def broken_first(url,client,**kwargs):
            if url==PAGES[1]:raise ValueError("bad page")
            return parsed_work(url,client,**kwargs)
        manager.parse_work=broken_first
        feed=manager.add(ROOT)
        self.assertTrue(manager.process_due())
        rows=list(worker.db.tables["aseel_movies"].values())
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["status"],"published")
        self.assertEqual(manager.feeds()[0]["last_created"],0)
        self.assertIn("1",manager.feeds()[0]["last_error"])

    def test_failed_listing_backoff_survives_in_supabase(self):
        worker,manager=self.make()
        class Unreachable(FakeSourceClient):
            def get(self,url):raise ValueError("unavailable")
        manager.source_client=Unreachable
        feed=manager.add(ROOT)
        assert manager.process_due()
        stored=worker.db.tables[FEED_TABLE][feed["id"]]
        self.assertEqual(stored["failures"],1)
        self.assertIn("unavailable",stored["last_error"])
        self.assertFalse(manager.process_due())


if __name__=="__main__": unittest.main()
