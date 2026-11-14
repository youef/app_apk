"""Offline regressions for the main Studio's sequential ten-episode capture.

No internet, credentials, uploads, or Supabase changes.
Run: python -m unittest discover -s python-cloud-studio/tests -p 'test_episode_capture_batches.py' -v
"""
import ast
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from pathlib import Path
from threading import RLock
from types import SimpleNamespace
import time
import unittest

SOURCE=Path(__file__).resolve().parents[1]/"server.py"

@dataclass
class Ep:
    season:int
    number:int
    title:str
    page_url:str
    sources:list=field(default_factory=list)
    source_pages:list=field(default_factory=list)
    media_url:str=""
    verified:bool=False
    error:str=""


class CaptureBatchTests(unittest.TestCase):
    def test_routes_are_authenticated_and_match_contract(self):
        src=SOURCE.read_text(encoding="utf-8")
        ast.parse(src,filename=str(SOURCE))
        for route in (
            "/api/episode-capture-batches/start",
            "/api/episode-capture-batches/status",
            "/api/episode-capture-batches/events",
            "/api/episode-capture-batches/stop"
        ):
            self.assertIn(route,src)
        self.assertIn("_EPISODE_BATCH_SIZE = 10",src)
        self.assertIn("_EPISODE_BATCH_SECONDS = 45",src)
        self.assertIn("state=protected(request)",src)
        self.assertIn("StreamingResponse(events()",src)

    def test_21_episodes_run_in_10_10_1_batches_and_emit_deltas(self):
        tree=ast.parse(SOURCE.read_text(encoding="utf-8"))
        names={"_capture_summary","_capture_event","_run_episode_capture_batches"}
        nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
        events=[]
        class Store:
            def remember_discovery(self,cat):
                events.append(len(cat.episodes))
        def scan(cat,ep):
            time.sleep(.005)
            media={"kind":"direct","url":f"https://example.org/{ep.number}.m3u8",
                   "verified":True}
            return ep,[media],[ep.page_url],media,""
        cat=SimpleNamespace(kind="series",url="https://example.org/series",
                            episodes=[Ep(1,i,f"Episode {i}",f"https://example.org/e/{i}")
                                      for i in range(1,22)])
        job={
            "id":"test-job","total":21,"done":0,"next_index":0,
            "batch_number":0,"batch_size":10,"batch_done":0,"batch_total":0,
            "candidates":0,"verified":0,"failed":0,"timed_out":0,
            "revision":0,"running":True,"events":[],"cancel":False,
            "message":"","error":""
        }
        state=SimpleNamespace(lock=RLock(),catalogue=cat,capture=job)
        pool=ThreadPoolExecutor(max_workers=4)
        globals_={
            "wait":wait,"FIRST_COMPLETED":FIRST_COMPLETED,"asdict":asdict,
            "deepcopy":deepcopy,"time":time,"_EPISODE_BATCH_SIZE":10,
            "_EPISODE_BATCH_SECONDS":45,"_episode_capture_pool":pool,
            "LIBRARY":Store(),"_scan_media_entry":scan,
            "safe_error":lambda e:type(e).__name__
        }
        exec(compile(ast.fix_missing_locations(
            ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *nodes],type_ignores=[])),"<capture>","exec"),globals_)
        try:
            globals_["_run_episode_capture_batches"](state,cat,job)
        finally:
            pool.shutdown(wait=True)
        self.assertEqual(job["done"],21)
        self.assertEqual(job["next_index"],21)
        self.assertEqual(job["batch_number"],3)
        self.assertEqual(job["verified"],21)
        self.assertEqual(job["phase"],"complete")
        self.assertEqual(job["timed_out"],0)
        self.assertFalse(job["running"])
        self.assertEqual(len([x for x in job["events"] if x["phase"]=="episode"]),21)
        self.assertEqual(events,[21,21,21])
        self.assertTrue(all(ep.verified for ep in cat.episodes))
        self.assertGreater(job["revision"],21)


if __name__=="__main__":
    unittest.main()
