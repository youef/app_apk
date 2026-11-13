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

    def test_studio_counts_direct_and_embedded_candidates_separately(self):
        text = SERVER.read_text(encoding="utf-8")
        self.assertIn('progress["players_found"]=len(all_sources)', text)
        self.assertIn('progress["embeds_found"]=sum(', text)
        self.assertIn('progress["sources_found"]=sum(', text)
        self.assertIn("max_pages=5", text)
        self.assertIn("ALEZZ_STUDIO_SCAN_SECONDS", text)

    def test_inline_player_hints_and_network_media_are_observed(self):
        text = RESOLVER.read_text(encoding="utf-8")
        self.assertIn("direct_hint=True", text)
        self.assertIn("request.resource_type!='media'", text)
        self.assertIn("ctype.startswith(('video/'", text)
        self.assertIn("if MEDIA_EXT.search(urlsplit(url).path):", text)


if __name__ == "__main__":
    unittest.main()
