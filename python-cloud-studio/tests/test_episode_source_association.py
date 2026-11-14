"""Offline regressions for the studio episode-to-player association flow."""
from __future__ import annotations

import ast
from pathlib import Path
import re
import time
import unittest
from types import SimpleNamespace
from urllib.parse import urlsplit

BASE = Path(__file__).resolve().parents[1]
SERVER = BASE / "server.py"
UI = BASE / "templates" / "index.html"
CLIENT = BASE / "static" / "app.js"


def function_only(name: str, namespace: dict):
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    node = next(node for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name == name)
    future = ast.ImportFrom(module="__future__",
                            names=[ast.alias(name="annotations")], level=0)
    unit = ast.fix_missing_locations(ast.Module(body=[future, node], type_ignores=[]))
    exec(compile(unit, str(SERVER), "exec"), namespace)
    return namespace[name]


def normalize(value):
    if not value.startswith("https://"):
        raise ValueError("HTTPS only")
    return value.split("#", 1)[0]


def merge_sources(*groups, limit=128):
    merged = {}
    for group in groups:
        for source in group:
            merged[source["url"]] = dict(merged.get(source["url"], {}), **source)
    return list(merged.values())[:limit]


class EpisodeSourceAssociationTests(unittest.TestCase):
    def setUp(self):
        self.ns = {
            "public_url": normalize,
            "normalized_source_url": normalize,
            "supported_source_kind": lambda u: "direct" if re.search(r"\.(mp4|m3u8)(?:\?|$)", u) else "",
            "signed_expiry": lambda u: 1794658905 if "master.m3u8" in u else None,
            "merge_sources": merge_sources,
            "urlsplit": urlsplit,
            "time": time,
        }

    def test_manual_hls_binds_to_episode_without_claiming_playback(self):
        bind = function_only("_bind_player_source", self.ns)
        page = "https://media.example.com/episode/series-episode-1/"
        old_url = "https://cdn.example.com/old.m3u8"
        new_url = "https://cdn.example.com/hls/master.m3u8?sig=xyz"
        episode = SimpleNamespace(page_url=page, media_url=old_url,
                                  verified=False, error="unavailable",
                                  sources=[{"url": old_url, "kind": "direct"}],
                                  source_pages=[])
        bind(episode, new_url, page)
        self.assertEqual(episode.media_url, new_url)
        self.assertFalse(episode.verified)
        self.assertEqual(episode.error, "")
        self.assertIn(page, episode.source_pages)
        self.assertEqual({src["url"] for src in episode.sources}, {old_url, new_url})
        item = next(src for src in episode.sources if src["url"] == new_url)
        self.assertEqual(item["expires_at"], 1794658905)
        self.assertFalse(item["verified"])
        self.assertEqual(item["page_url"], page)

    def test_reassigning_an_already_verified_url_preserves_verified_state(self):
        bind = function_only("_bind_player_source", self.ns)
        url = "https://cdn.example.com/video.mp4"
        episode = SimpleNamespace(page_url="https://media.example.com/e1",
                                  media_url=url, verified=True, error="",
                                  sources=[{"url": url, "verified": True}],
                                  source_pages=[])
        bind(episode, url, episode.page_url)
        self.assertTrue(episode.verified)
        self.assertEqual(len(episode.sources), 1)
        self.assertTrue(episode.sources[0]["verified"])

    def test_episode_link_is_matched_to_page_before_number_fallback(self):
        self.ns["episode_numbers"] = lambda label: (
            (1, int(re.search(r"الحلقة-(\d+)", label).group(1)))
            if re.search(r"الحلقة-(\d+)", label) else None
        )
        match = function_only("_match_episode_by_page", self.ns)
        ep1 = SimpleNamespace(season=1, number=1, page_url="https://source.example/ep-one")
        ep2 = SimpleNamespace(season=1, number=2, page_url="https://source.example/ep-two")
        cat = SimpleNamespace(episodes=[ep1, ep2])
        self.assertIs(match(cat, ep2.page_url + "/"), ep2)
        self.assertIs(match(cat, "https://source.example/episode/مسلسل-الكرامة-الحلقة-1/"), ep1)
        self.assertIsNone(match(cat, "https://source.example/other"))

    def test_entire_series_discovery_requires_no_manual_player_binding(self):
        html = UI.read_text(encoding="utf-8")
        js = CLIENT.read_text(encoding="utf-8")
        server = SERVER.read_text(encoding="utf-8")
        resolver = (BASE / "media_resolver.py").read_text(encoding="utf-8")
        self.assertNotIn('id="episodeLinkForm"', html)
        self.assertIn('id="edgeCaptureBtn"', html)
        self.assertIn('id="autoTrack" checked', html)
        self.assertIn("scan_media:true", js)
        self.assertIn("auto_track:$('autoTrack').checked", js)
        self.assertIn("def _persist_autodiscovered_players", server)
        self.assertIn("_persist_autodiscovered_players(state, cat, progress)", server)
        self.assertIn("'database_synced'", server)
        self.assertIn("browser_pages = list(dict.fromkeys([*player_pages[:3], *pages]))", resolver)
        self.assertIn("self._http_player_pages", resolver)


if __name__ == "__main__":
    unittest.main()
