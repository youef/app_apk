"""Offline V6 safety regressions for fast pagination and durable scans.

These tests never open a website, contact Supabase, or publish media.
"""
from __future__ import annotations

import ast
import base64
import copy
from dataclasses import asdict, dataclass
import json
from pathlib import Path
from types import SimpleNamespace
import threading
import time
import unittest
import zlib

ROOT=Path(__file__).resolve().parents[1]
SERVER=ROOT/"server.py"
IMPORTER=ROOT/"alezz_fetchv_importer.py"
PERSISTENCE=ROOT/"studio_scan_checkpoints.py"

def isolate_functions(path,*names,initial=None):
    tree=ast.parse(path.read_text(encoding="utf-8"),filename=str(path))
    items=[f for f in tree.body if isinstance(f,ast.FunctionDef) and f.name in names]
    if len(items)!=len(names):
        raise AssertionError(f"Missing test target in {path}: {names}")
    scope=dict(initial or {})
    exec(compile(ast.fix_missing_locations(ast.Module(body=items,type_ignores=[])),
                 str(path),"exec"),scope)
    return scope

class ImmediateQueue:
    def __init__(self):self.pending=[]
    def submit(self,fn):self.pending.append(fn)

@dataclass
class Catalogue:
    url:str
    episodes:list

class ContinuationTests(unittest.TestCase):
    def test_all_updated_python_modules_parse(self):
        for path in (SERVER,IMPORTER,PERSISTENCE):
            with self.subTest(path=path.name):
                ast.parse(path.read_text(encoding="utf-8"),filename=str(path))

    def test_oversized_catalogue_and_progress_roundtrip_lossless(self):
        scope=isolate_functions(PERSISTENCE,"_pack_catalogue","_unpack_catalogue",initial={
            "json":json,"zlib":zlib,"base64":base64,
            "MAX_SNAPSHOT_BYTES":2_000_000,"MAX_UNPACKED_BYTES":10_000_000})
        data={"kind":"series","title":"Test",
              "episodes":[{"season":1,"number":index,"title":"Episode "+str(index),
                            "description":"sample metadata "*25,
                            "media_url":"https://example.org/"+str(index)}
                          for index in range(2300)]}
        packed=scope["_pack_catalogue"](data)
        self.assertEqual(packed.get("_codec"),"zlib-json-v1")
        self.assertEqual(scope["_unpack_catalogue"](packed),data)
        self.assertIsNone(scope["_unpack_catalogue"](
            {"_codec":"zlib-json-v1","data":"invalid-base64"}))

    def test_checkpoint_saves_are_coalesced_during_rapid_episode_updates(self):
        queue=ImmediateQueue()
        writes=[]
        scope=isolate_functions(SERVER,"_scan_public","_emit_scan_event",
            "_schedule_scan_checkpoint",initial={
                "time":time,"deepcopy":copy.deepcopy,"asdict":asdict,
                "scan_checkpoint_available":lambda:True,"SCAN_SAVERS":queue,
                "save_scan_checkpoint":lambda *args,**kwargs:writes.append(args) or True,
                "SCAN_EVENTS_LIMIT":400,
            })
        cat=Catalogue(url="https://example.org/show",episodes=[])
        progress={"id":"0123456789abcdef","owner_id":"77777777-7777-4777-8777-777777777777",
                  "running":True,"events":[],"seq":0,"revision":0,
                  "completed_keys":[],"crawl_checkpoint":{}}
        state=SimpleNamespace(scan=progress,scan_catalogue=cat,lock=threading.RLock())
        scope["_schedule_scan_checkpoint"](state,cat,progress,force=True)
        for index in range(12):
            cat.episodes.append({"number":index+1})
            progress["completed_keys"].append("1:"+str(index+1))
            scope["_schedule_scan_checkpoint"](state,cat,progress)
        self.assertEqual(len(queue.pending),1,
                         "never schedule 12 overlapping Supabase writes")
        queue.pending.pop(0)()
        self.assertGreaterEqual(len(writes),1)
        self.assertLessEqual(len(writes),3)
        self.assertEqual(len(writes[-1][3]["episodes"]),12)
        self.assertEqual(len(writes[-1][5]),12)
        self.assertFalse(progress["checkpoint_inflight"])

    def test_fast_scan_retains_pagination_queue_and_paused_resume(self):
        importer=IMPORTER.read_text(encoding="utf-8")
        server=SERVER.read_text(encoding="utf-8")
        self.assertIn('resume_progress.get(\'queued\',[])[:1200]',importer)
        self.assertIn('if len(queued)+len(in_flight)<1200:queued.append(uri)',importer)
        self.assertNotIn('if len(seen_pages)+len(queued)+len(in_flight)<max_pages',importer)
        self.assertIn('while chunks<6',server)
        self.assertIn('progress["crawl_paused"]',server)
        self.assertIn('progress["remaining_pages"]=pending',server)
        self.assertIn('saved_crawl.get("queued")',server)

    def test_source_status_and_auto_restore_ui_present(self):
        js=(ROOT/"static"/"app.js").read_text(encoding="utf-8")
        html=(ROOT/"templates"/"index.html").read_text(encoding="utf-8")
        for tag in ('value="hls"','value="mp4"','value="blocked"',
                    'value="expired"','value="missing"'):
            self.assertIn(tag,html)
        self.assertIn("function studioSourceDiagnostics(row)",js)
        self.assertIn("sessionStorage.setItem(marker,'tried')",js)
        self.assertIn("await resumeAdminScan();",js)

if __name__=="__main__":
    unittest.main()
