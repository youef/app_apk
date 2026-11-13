"""Offline integration test for the live episode scan's progressive snapshots.

No requests to external websites, credentials, Supabase or Render are made.
"""
import ast
import copy
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import sys
import threading
import time
import types
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1] / "private_deep_discovery.py"


class Journal:
    def __init__(self):
        self.states=[]
    def submit(self,callback,*args,**kwargs):
        self.states.append((args,kwargs))
        return None


class LiveScanTests(unittest.TestCase):
    def test_python_ast_and_push_events_are_authenticated(self):
        source=SOURCE.read_text(encoding="utf-8")
        ast.parse(source,filename=str(SOURCE))
        self.assertIn('"/api/private-film/deep-scan/{job_id}/events"',source)
        self.assertIn("uid=owner(request,portal)",source)
        self.assertIn("StreamingResponse(generate()",source)
        self.assertIn('event: snapshot',source)
        self.assertIn('revision',source)
        self.assertIn('JOURNAL_POOL.submit',source)

    def test_parallel_episode_candidates_arrive_before_final_status(self):
        source=SOURCE.read_text(encoding="utf-8")
        parsed=ast.parse(source,filename=str(SOURCE))
        used={"snapshot","view_job","add_source","run_scan"}
        functions=[n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name in used]
        journal=Journal()
        globals_={
            "JOBS":{"testjob":{"owner_id":"test-admin","status":"queued","revision":0}},
            "LOCK":threading.RLock(),"FINISHED_STATES":{"complete","failed"},
            "JOURNAL_POOL":journal,
            "time":time,"copy":copy,
            "ThreadPoolExecutor":ThreadPoolExecutor,"as_completed":as_completed,
            "MAX_SCAN_SECONDS":25,"MAX_EMBEDS":48,"MAX_IFRAME_BROWSERS":4,
            "MAX_MEDIA_PER_EPISODE":12,"MAX_GLOBAL_MEDIA":90,
            "threading":threading,
            "admissible":lambda url:url if url.startswith("https://") else None,
        }
        root="https://example.org/series"
        ep1="https://example.org/episode-1"
        ep2="https://example.org/episode-2"
        iframe="https://example.org/player"
        video1="https://cdn.example.org/ep1.mp4"
        video2="https://cdn.example.org/ep2.m3u8"
        def discover(url):
            if url==root:
                return {"status":"parsed","title":"Test","http_status":200,
                        "episodes":[{"title":"Episode One","page_url":ep1},
                                    {"title":"Episode Two","page_url":ep2}],
                        "media":[],"embeds":[]}
            if url==ep1:
                return {"status":"parsed","http_status":200,"media":[{"url":video1}],
                        "embeds":[]}
            if url==ep2:
                return {"status":"parsed","http_status":200,"media":[],"embeds":[iframe]}
            if url==iframe:
                return {"status":"parsed","http_status":200,"media":[{"url":video2}],
                        "embeds":[]}
            raise ValueError("unexpected URL")
        def attempt(f,*args):
            try:return f(*args)
            except Exception as e:return {"state":"failed","error":type(e).__name__}
        def no_media(_url,_result):return {"state":"not_supported","found":0}
        globals_.update({"discover_page":discover,
                         "inline_config":no_media,"yt_dlp_metadata":no_media,
                         "browser_metadata":no_media,"attempt":attempt})
        code=compile(ast.fix_missing_locations(
            ast.Module(body=functions,type_ignores=[])),"<live-scan>","exec")
        exec(code,globals_)
        updates=[]
        original=globals_["snapshot"]
        def track(job_id,**kwargs):
            original(job_id,**kwargs)
            state=globals_["view_job"](job_id,"test-admin")
            updates.append((state.get("status"),state.get("progress",{}).get("media_found",0)))
        globals_["snapshot"]=track
        with patch.dict(sys.modules,{"studio_jobs":types.SimpleNamespace(save=lambda *_a,**_k:True)}):
            globals_["run_scan"]("testjob",root,2)
        state=globals_["view_job"]("testjob","test-admin")
        self.assertEqual(state["status"],"complete")
        self.assertEqual(state["progress"]["episodes_checked"],2)
        self.assertEqual(state["progress"]["episodes_total"],2)
        self.assertEqual({source["url"] for source in state["result"]["media"]},
                         {video1,video2})
        self.assertIn(iframe,state["result"]["embeds"])
        self.assertGreater(state["revision"],5)
        self.assertTrue(any(status=="scanning" and count>0 for status,count in updates),
                        "results must be published during the scan, not only at the end")
        self.assertIsNone(globals_["view_job"]("testjob","another-admin"))


if __name__=="__main__":
    unittest.main()
