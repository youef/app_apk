"""No-network regression checks for Al Ezz Studio V5.

Run from repository root:
    python -m unittest discover -s python-cloud-studio/tests \
      -p 'test_studio_v5_integrity.py' -v

No production database changes or source downloads are performed.
"""
from __future__ import annotations

import ast
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / "python-cloud-studio"


class Markup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.append(attributes["id"])
        if tag in ("script", "link"):
            asset = attributes.get("src") or attributes.get("href")
            if asset and asset.startswith("/static/"):
                self.assets.append(asset.partition("?")[0])


def summarizer():
    """Isolate the pure metric function without importing external credentials."""
    tree = ast.parse((PYTHON / "studio_quality.py").read_text(encoding="utf-8"))
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_summarize")
    namespace = {}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[])), "<quality>", "exec"), namespace)
    return namespace["_summarize"]


class StudioV5IntegrityTests(unittest.TestCase):
    def test_python_files_parse(self):
        for file in ("server.py", "studio_quality.py", "member_portal.py",
                     "alezz_fetchv_importer.py", "private_deep_discovery.py"):
            with self.subTest(file=file):
                ast.parse((PYTHON / file).read_text(encoding="utf-8"), filename=file)

    def test_quality_metric_aggregation(self):
        calculate = summarizer()
        rows = [
            {"id": "1", "status": "published", "link_health_status": "broken",
             "poster_url": None, "duration_minutes": 0, "stream_url": None},
            {"id": "2", "status": "published", "link_health_status": "suspect",
             "poster_url": "https://example.org/poster.jpg",
             "duration_minutes": 32, "stream_url": "https://example.org/clip.mp4"},
            {"id": "3", "status": "draft", "link_health_status": "healthy",
             "poster_url": "", "duration_minutes": None, "stream_url": ""},
        ]
        result = calculate(rows, "movies")
        self.assertEqual(result["total"], 3)
        self.assertEqual(result["published"], 2)
        self.assertEqual(result["draft"], 1)
        self.assertEqual(result["published_broken"], 1)
        self.assertEqual(result["published_suspect"], 1)
        self.assertEqual(result["missing_poster"], 2)
        self.assertEqual(result["missing_duration"], 2)
        self.assertEqual(result["missing_primary_source"], 2)

    def test_quality_web_page_has_real_routes_and_assets(self):
        source = (PYTHON / "templates" / "index.html").read_text(encoding="utf-8")
        html = Markup()
        html.feed(source)
        self.assertEqual(len(html.ids), len(set(html.ids)), "duplicate HTML IDs")
        required = (
            "qualityDashboard", "qualityRefresh", "qualityWorks", "qualityBroken",
            "qualitySuspect", "qualityMissing", "qualityTableBody", "qualityStatus",
            "qualityIssueList",
        )
        for item in required:
            with self.subTest(element=item):
                self.assertIn(item, html.ids)
        for asset in html.assets:
            with self.subTest(asset=asset):
                self.assertTrue((PYTHON / asset.lstrip("/")).is_file(),
                                f"Missing Studio static asset {asset}")

    def test_quality_api_is_admin_only(self):
        source = (PYTHON / "studio_quality.py").read_text(encoding="utf-8")
        self.assertIn('owner(request,portal)', source)
        self.assertIn('"/api/studio/quality"', source)
        self.assertNotIn('stream_url":', source, "Do not include raw stream URLs in quality JSON")
        server = (PYTHON / "server.py").read_text(encoding="utf-8")
        self.assertIn("app.include_router(studio_quality_router)", server)

    def test_viewer_only_uses_healthy_content(self):
        content = (ROOT / "web" / "js" / "api.js").read_text(encoding="utf-8")
        self.assertIn(".filter(approvedMedia)", content)
        self.assertIn('season.poster = parent.poster || parent.backdrop || null', content)
        self.assertIn('poster: e.poster_url || season.poster || null', content)
        self.assertIn('series: playableSeries', content)
        self.assertIn('link_health_status === "broken"', content)
        self.assertIn('link_health_status === "suspect"', content)
        self.assertIn('row.rights_status !== "approved"', content)
        index = (ROOT / "web" / "index.view").read_text(encoding="utf-8")
        self.assertIn("health-guard-20261113-v5", index)

    def test_autosync_reduces_polling_after_unauthorized(self):
        source = (PYTHON / "static" / "autosync.js").read_text(encoding="utf-8")
        self.assertIn("state.authRequired = true", source)
        self.assertIn("if (state.authRequired && !force) return;", source)
        self.assertIn("now-state.lastRefreshAt", source)

    def test_portal_admin_login_bridge_is_server_only(self):
        server = (PYTHON / "server.py").read_text(encoding="utf-8")
        importer = (PYTHON / "alezz_fetchv_importer.py").read_text(encoding="utf-8")
        self.assertIn("_connect_portal_admin_studio", server)
        self.assertIn("portal.admin_active(uid)", server)
        self.assertIn("trusted_admin_uid=uid", server)
        self.assertIn("if trusted_admin_uid:", importer)
        self.assertIn('session.headers["Authorization"]', importer)


if __name__ == "__main__":
    unittest.main()
