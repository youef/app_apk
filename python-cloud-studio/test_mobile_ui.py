"""Standalone tests for the Al Ezz Studio iPhone UI. Runs without dependencies."""
from __future__ import annotations
from html.parser import HTMLParser
import json
import pathlib
import unittest

BASE = pathlib.Path(__file__).resolve().parent
HTML = (BASE / "templates/index.html").read_text(encoding="utf-8")
JS = (BASE / "static/studio-pro.js").read_text(encoding="utf-8")
CSS = (BASE / "static/studio-pro.css").read_text(encoding="utf-8")

class Extract(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.links = []
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if data.get("id"):
            self.ids.append(data["id"])
        if tag in ("script", "link"):
            self.links.append(data.get("src") or data.get("href") or "")

class MobileStudioTests(unittest.TestCase):
    def test_unique_ids(self):
        parser = Extract()
        parser.feed(HTML)
        self.assertEqual(len(parser.ids), len(set(parser.ids)), "Duplicate HTML ids")
        for control in ["studioQuickSync", "episodeViewCount", "episodeSelectionInfo",
                        "selectVisibleBtn", "clearSelectionBtn", "smart-sync", "studioEditStatus",
                        "serverHealthText", "episodeList", "workspace"]:
            self.assertIn(control, parser.ids)
    def test_assets_are_linked(self):
        parser = Extract()
        parser.feed(HTML)
        for name in ["/static/studio-pro.css", "/static/studio-pro.js", "/static/manifest.webmanifest"]:
            self.assertTrue(any(name in link for link in parser.links), name)
    def test_mobile_controls_and_accessibility(self):
        for state in ["all", "verified", "missing", "pending", "failed"]:
            self.assertIn('data-episode-filter="'+state+'"', HTML)
        for target in ['#import', '#smart-sync', '#episodes', '#publish']:
            self.assertIn('href="'+target+'"', HTML)
        self.assertIn('aria-label="التنقل السريع للآيفون"', HTML)
        self.assertIn("env(safe-area-inset-bottom)", CSS)
        self.assertIn("font-size:16px!important", CSS)
        self.assertIn("MutationObserver", JS)
        self.assertNotIn('id="librarySync"', HTML)
        self.assertIn("confirm", (BASE / "static/app.js").read_text(encoding="utf-8"))
    def test_manifest_and_icon(self):
        manifest = json.loads((BASE / "static/manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual(manifest["dir"], "rtl")
        self.assertEqual(manifest["scope"], "/")
        self.assertTrue((BASE / "static" / pathlib.Path(manifest["icons"][0]["src"]).name).exists())
    def test_security(self):
        self.assertNotIn("ALEZZ_SITE_SECRET", HTML)
        self.assertNotIn("ALEZZ_SITE_PASSWORD", HTML)
        self.assertIn("credentials:'same-origin'", JS)
        self.assertNotIn("localStorage", JS)

if __name__ == "__main__":
    unittest.main()
