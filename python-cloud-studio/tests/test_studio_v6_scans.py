"""Offline V6 scan regressions: replay ordering, privacy and resume boundaries."""
from __future__ import annotations

import ast
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
SERVER=ROOT/"server.py"
CHECKPOINT=ROOT/"studio_scan_checkpoints.py"

def load_pure(*names):
    parsed=ast.parse(SERVER.read_text(encoding="utf-8"))
    selected=[node for node in parsed.body
              if isinstance(node,ast.FunctionDef) and node.name in names]
    assert len(selected)==len(names)
    scope={"SCAN_EVENTS_LIMIT":400}
    module=ast.fix_missing_locations(ast.Module(body=selected,type_ignores=[]))
    exec(compile(module,str(SERVER),"exec"),scope)
    return scope

class V6ScanTests(unittest.TestCase):
    def test_server_and_checkpoint_python_parse(self):
        ast.parse(SERVER.read_text(encoding="utf-8"))
        ast.parse(CHECKPOINT.read_text(encoding="utf-8"))

    def test_replay_preserves_400_events_in_order_and_monotonic_ids(self):
        scope=load_pure("_emit_scan_event","_scan_public")
        state=object()
        progress={"id":"0123456789abcdef","seq":0,"revision":0,"events":[],
                  "owner_id":"secret-admin","completed_keys":[]}
        for i in range(450):
            scope["_emit_scan_event"](state,progress,"episode",{"number":i+1})
        self.assertEqual(progress["seq"],450)
        self.assertEqual(progress["revision"],450)
        self.assertEqual(len(progress["events"]),400)
        self.assertEqual([x["seq"] for x in progress["events"]],list(range(51,451)))
        self.assertEqual(progress["events"][0]["delta"]["number"],51)
        self.assertEqual(progress["events"][-1]["delta"]["number"],450)

    def test_public_scan_excludes_private_metadata_and_tokens(self):
        scope=load_pure("_scan_public")
        data={"id":"0123456789abcdef","seq":2,"revision":2,
              "owner_id":"private-user","events":[{"seq":1}],
              "crawl_checkpoint":{"queued":["https://secret.example/path?token=private"]},
              "last_result":{"url":"https://secret.example/?token=private"},
              "completed_keys":["1:1"],"running":True,"done":1}
        result=scope["_scan_public"](data)
        for private in ("owner_id","events","crawl_checkpoint","last_result","completed_keys"):
            self.assertNotIn(private,result)
        self.assertEqual(result["seq"],2)
        self.assertEqual(result["done"],1)

    def test_server_routes_require_admin_identity_or_csrf(self):
        text=SERVER.read_text(encoding="utf-8")
        for url in ("/api/discovery-scan/history","/api/discovery-scan/recover",
                    "/api/discovery-scan/resume","/api/discovery-scan/stop",
                    "/api/discovery-scan/retry-failed","/api/discovery-scan/retry-episode"):
            self.assertIn(url,text)
        self.assertIn("uid=_portal_scan_uid(request)",text)
        self.assertIn("state=protected(request)",text)
        self.assertIn("save_scan_checkpoint",text)
        self.assertIn("load_scan_checkpoint",text)
        self.assertIn("cursor<events[0]",text)
        self.assertIn('packet={"seq":latest,"kind":"resync"',text)

    def test_checkpoint_owner_filter_and_secret_client_only(self):
        text=CHECKPOINT.read_text(encoding="utf-8")
        self.assertIn('"owner_id":"eq."+owner_id',text)
        self.assertIn('os.getenv("ALEZZ_SUPABASE_SECRET_KEY")',text)
        self.assertNotIn("sb_publishable_",text)
        self.assertIn("MAX_SNAPSHOT_BYTES",text)
        self.assertIn("expires_at",text)

    def test_parallel_crawl_and_single_episode_retry_are_bounded(self):
        text=SERVER.read_text(encoding="utf-8")
        self.assertIn("max_workers=5",text)
        self.assertIn("max_pages=42",text)
        self.assertIn("client.deadline=time.monotonic()+85",text)
        self.assertIn("retry-episode",text)
        self.assertIn("stop_requested",text)

if __name__=="__main__":
    unittest.main()
