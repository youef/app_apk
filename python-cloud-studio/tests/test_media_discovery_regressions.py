"""Offline source-recovery regressions for Al Ezz Studio.

Tests exercise isolated pure functions without HTTP requests, Playwright,
Supabase credentials or installation of optional dependencies in CI.
"""
from __future__ import annotations

import ast
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import time
import types
import unittest
from urllib.parse import urlsplit

BASE = Path(__file__).resolve().parents[1]
RESOLVER = BASE / "media_resolver.py"
IMPORTER = BASE / "alezz_fetchv_importer.py"
SERVER = BASE / "server.py"


def isolated_method(path, classname, methodname, namespace):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    klass = next(x for x in tree.body if isinstance(x, ast.ClassDef) and x.name == classname)
    fn = next(x for x in klass.body if isinstance(x, ast.FunctionDef) and x.name == methodname)
    module = ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[]))
    exec(compile(module, str(path), "exec"), namespace)
    return namespace[methodname]


class StudioMediaRecoveryTests(unittest.TestCase):
    def test_critical_python_sources_parse(self):
        for file in (RESOLVER, IMPORTER, SERVER):
            with self.subTest(file=file.name):
                ast.parse(file.read_text(encoding="utf-8"), filename=str(file))

    def test_direct_mp4_source_is_not_downloaded_as_html(self):
        calls = []
        class FakeClient:
            def get(self, url):
                calls.append(url)
                raise AssertionError("A direct MP4 must not be downloaded as HTML")
            def __init__(self):
                self.session = types.SimpleNamespace(close=lambda: None)

        pattern = re.compile(r"\.(?:mp4|m4v|webm|m3u8|mpd)(?:[?#]|$)", re.I)
        namespace = {
            "time": time, "ThreadPoolExecutor": ThreadPoolExecutor,
            "urlsplit": urlsplit, "MEDIA_EXT": pattern,
            "public_url": lambda url: url,
            "extract_candidates": lambda *_: ([], []),
            "merge_sources": lambda *groups: [x for group in groups for x in group],
            "safe_error": lambda error: str(error),
        }
        http = isolated_method(RESOLVER, "MediaResolver", "_http", namespace)
        client = FakeClient()
        obj = types.SimpleNamespace(
            max_seconds=12, max_pages=5, workers=2,
            _pages=lambda pages: pages,
            _client=lambda deadline: client
        )
        direct = "https://cdn.example.com/video/movie.mp4?sig=abc123"
        found, errors = http(obj, [direct])
        self.assertEqual(errors, [])
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["url"], direct)
        self.assertEqual(found[0]["kind"], "direct")
        self.assertEqual(calls, [])

    def test_signed_extensionless_video_is_verified_by_container_bytes(self):
        namespace = {
            "public_url": lambda url: url if url.startswith("https://") else
                (_ for _ in ()).throw(ValueError("not public")),
            "urlsplit": urlsplit, "re": re,
        }
        verify = isolated_method(IMPORTER, "SourceClient", "media_verified", namespace)
        class FakeClient:
            calls = 0
            def sample(self, url, size=8192):
                self.calls += 1
                return url, "video/mp4", b"\x00\x00\x00\x18ftypisom" + b"\0" * 64
        client = FakeClient()
        valid, msg = verify(client, "https://cdn.example.org/stream?id=123&token=xyz")
        self.assertTrue(valid, msg)
        self.assertEqual(client.calls, 1)

    def test_auto_browser_gets_reserved_budget_for_js_players(self):
        namespace = {
            "time": time,
            "merge_sources": lambda *groups: [x for group in groups for x in group],
        }
        resolve = isolated_method(RESOLVER, "MediaResolver", "resolve", namespace)
        seen = {}
        def read_html(pages, *, deadline):
            seen["html_deadline"] = deadline
            return [], []
        def read_browser(pages, *, deadline, known):
            seen["browser_deadline"] = deadline
            return [{"url":"https://cdn.example.org/stream?token=abc",
                     "kind":"direct","verified":False}], []
        def check(sources, *, deadline):
            if not sources:return []
            return [dict(x, verified=True) for x in sources]
        obj = types.SimpleNamespace(
            mode="auto", max_seconds=18,
            _http=read_html, _browser=read_browser, check=check
        )
        found, errors = resolve(obj, ["https://media.example.org/episode"])
        self.assertFalse(errors)
        self.assertEqual(found[0]["kind"], "direct")
        self.assertTrue(found[0]["verified"])
        self.assertGreater(seen["browser_deadline"]-seen["html_deadline"], 7)

    def test_preverification_candidates_are_emitted_to_client(self):
        namespace = {"time": time,
                     "merge_sources": lambda *groups: [x for group in groups for x in group]}
        resolve = isolated_method(RESOLVER, "MediaResolver", "resolve", namespace)
        provisional = {"url": "https://cdn.example.com/player.m3u8",
                       "kind": "direct", "verified": False}
        browser_candidate = {"url": "https://cdn.example.com/stream?sig=xyz",
                             "kind": "direct", "verified": False}
        observed = []
        obj = types.SimpleNamespace(
            mode="auto", max_seconds=18,
            _http=lambda pages, *, deadline: ([provisional], []),
            _browser=lambda pages, *, deadline, known: ([browser_candidate], []),
            check=lambda sources, *, deadline: [dict(row, verified=False) for row in sources],
        )
        resolved, errors = resolve(obj, ["https://public.example.com/episode"],
            on_candidates=lambda rows, phase: observed.append((phase, [x["url"] for x in rows])))
        self.assertFalse(errors)
        self.assertEqual([event[0] for event in observed], ["http", "chromium"])
        self.assertIn(provisional["url"], observed[0][1])
        self.assertIn(browser_candidate["url"], observed[1][1])
        self.assertGreaterEqual(len(resolved), 2)

    def test_unverified_players_are_kept_as_episode_candidates_not_playback_proof(self):
        tree=ast.parse(SERVER.read_text(encoding="utf-8"))
        function=next(node for node in tree.body if isinstance(node,ast.FunctionDef)
                      and node.name=="_provisional_player_url")
        env={"time":time,
             "supported_source_kind":lambda url:'direct' if '.m3u8' in url or '.mp4' in url else '',
             "signed_expiry":lambda url:time.time()-60 if "expired" in url else None}
        module=ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[]))
        exec(compile(module,str(SERVER),"exec"),env)
        choose=env["_provisional_player_url"]
        failed={"kind":"direct","url":"https://cdn.example.com/video.m3u8",
                "verified":False,"error":"403 during external probe"}
        expired={"kind":"direct","url":"https://cdn.example.com/expired.m3u8",
                 "verified":False}
        unrelated={"kind":"embed","url":"https://elsewhere.example.com/embed",
                   "verified":False}
        self.assertEqual(choose([expired,unrelated,failed]),failed["url"])
        self.assertEqual(choose([expired,unrelated]),"")
        server=SERVER.read_text(encoding="utf-8")
        self.assertIn("entry.media_url=_provisional_player_url(entry.sources)",server)
        self.assertIn("item.media_url=_provisional_player_url(checked)",server)
        self.assertIn("item.verified=playable is not None",server)

    def test_studio_counts_direct_and_embedded_candidates_separately(self):
        text = SERVER.read_text(encoding="utf-8")
        self.assertIn('progress["players_found"]=len(all_sources)', text)
        self.assertIn('progress["embeds_found"]=sum(', text)
        self.assertIn('progress["sources_found"]=sum(', text)
        self.assertIn("max_pages=5", text)
        self.assertIn("ALEZZ_STUDIO_SCAN_SECONDS", text)
        self.assertIn('_emit_scan_event(state,progress,"episode_candidates"', text)
        self.assertIn('on_candidates=on_candidates', text)
        client = (BASE / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("packet.kind==='episode_candidates'", client)

    def test_inline_player_hints_and_network_media_are_observed(self):
        text = RESOLVER.read_text(encoding="utf-8")
        self.assertIn("direct_hint=True", text)
        self.assertIn("request.resource_type!='media'", text)
        self.assertIn("ctype.startswith(('video/'", text)
        self.assertIn("if MEDIA_EXT.search(urlsplit(url).path):", text)


if __name__ == "__main__":
    unittest.main()
