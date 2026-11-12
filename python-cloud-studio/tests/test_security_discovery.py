"""Offline regression tests for passive security discovery (no network calls)."""
import os
import unittest

os.environ["ALEZZ_SECURITY_BROWSER"] = "0"
from security_discovery import _path, _kind, discover, _html_entries


class SecurityDiscoveryTests(unittest.TestCase):
    def test_same_origin_https_and_secret_redaction(self):
        self.assertEqual(_path("https://www.example.org/admin?token=secret", "www.example.org"), "/admin")
        self.assertIsNone(_path("http://www.example.org/login", "www.example.org"))
        self.assertIsNone(_path("https://other.example.org/admin", "www.example.org"))
        self.assertIsNone(_path("https://www.example.org/api/session", "www.example.org"))
        self.assertIsNone(_path("https://www.example.org@127.0.0.1/admin", "www.example.org"))

    def test_login_admin_api_classification(self):
        self.assertEqual(_kind("/admin"), "admin")
        self.assertEqual(_kind("/wp-login.php"), "login")
        self.assertEqual(_kind("/api/v2/items"), "api")
        self.assertIsNone(_kind("/assets/app.js"))

    def test_static_discovery_without_browser(self):
        html = """
          <html><a href='/admin'>Admin</a>
          <form action='/login'><input type='password'></form>
          <script src='/assets/app.js'></script>
          <script>fetch('/api/v1/items')</script></html>
        """
        calls = []
        def fake_get(host, path, *, max_bytes=0):
            calls.append(path)
            if path == "/assets/app.js":
                return 200, {"Content-Type": "application/javascript"}, b'fetch("/api/v2/items")'
            if path in ("/login", "/admin"):
                return 200, {"Content-Type": "text/html"}, b"login"
            return 404, {"Content-Type": "text/html"}, b"not found"
        report = discover("www.example.org", html, fake_get, lambda host: ["93.184.215.14"])
        self.assertEqual(report["summary"]["admin"], 1)
        self.assertGreaterEqual(report["summary"]["login"], 1)
        self.assertGreaterEqual(report["summary"]["api"], 2)
        self.assertTrue(any(x["path"] == "/api/v2/items" for x in report["paths"]))
        self.assertEqual(report["network"], [])
        self.assertLessEqual(len(calls), 12)
        self.assertIn("معطل", report["browser_status"])

    def test_spa_catchall_not_mistaken_for_admin(self):
        page = b"<html><body>Welcome application shell</body></html>"
        def fake_get(host, path, *, max_bytes=0):
            return 200, {"Content-Type":"text/html"}, page
        report = discover("www.example.org", "<html><body>Welcome</body></html>",
                          fake_get, lambda host:["93.184.215.14"])
        self.assertFalse(any("bounded public GET" in x["sources"] for x in report["paths"]))
        self.assertEqual(report["summary"]["admin"], 0)
        self.assertIsNotNone(report["baseline_status"])

    def test_openapi_routes_are_documented_without_execution(self):
        from json import dumps
        spec = dumps({"openapi":"3.1.0","paths":{
            "/api/v2/catalog":{"get":{"summary":"list"}},
            "/api/v2/orders":{"post":{"summary":"create"}},
            "/api/private/token":{"get":{"summary":"should be redacted"}}}}).encode()
        calls = []
        def fake_get(host, path, *, max_bytes=0):
            calls.append(path)
            if path=="/openapi.json":
                return 200, {"Content-Type":"application/json"}, spec
            return 404, {"Content-Type":"text/html"}, b"missing"
        report = discover("www.example.org","<html></html>",
                          fake_get,lambda host:["93.184.215.14"])
        found = {row["path"]:row for row in report["paths"]}
        self.assertEqual(found["/api/v2/catalog"]["confidence"],"documented")
        self.assertEqual(found["/api/v2/orders"]["methods"],["POST"])
        self.assertNotIn("/api/private/token",found)
        self.assertNotIn("/api/v2/orders",calls)
        self.assertGreaterEqual(report["openapi"][0]["documented_routes"], 2)

    def test_explicit_html_route_kept_but_marked_uncertain_if_spa_fallback(self):
        page = b"<html><body>One application shell</body></html>"
        def fake_get(host,path,*,max_bytes=0):
            return 200, {"Content-Type":"text/html"}, page
        report=discover("www.example.org","<a href='/admin'>Administration</a>",
                        fake_get, lambda host:["93.184.215.14"])
        admin=[row for row in report["paths"] if row["path"]=="/admin"]
        self.assertEqual(len(admin),1)
        self.assertEqual(admin[0]["confidence"],"uncertain")

    def test_waf_returns_same_403_for_every_unknown_path(self):
        page=b"<html><body>Access blocked by edge policy</body></html>"
        def fake_get(host,path,*,max_bytes=0):
            return 403, {"content-type":"text/html"}, page
        report=discover("www.example.org","<html></html>",
                        fake_get,lambda host:["93.184.215.14"])
        self.assertFalse(any(x["path"]=="/admin" for x in report["paths"]))
        self.assertEqual(report["baseline_status"],403)

    def test_lowercase_content_type_and_restricted_response(self):
        def fake_get(host,path,*,max_bytes=0):
            if path=="/admin":
                return 403, {"content-type":"text/html"}, b"<p>Access denied</p>"
            return 404, {"content-type":"text/html"}, b"<p>Missing</p>"
        report=discover("www.example.org","<html></html>",
                        fake_get,lambda host:["93.184.215.14"])
        record=next(x for x in report["paths"] if x["path"]=="/admin")
        self.assertEqual(record["confidence"],"inferred")
        self.assertEqual(record["status"],403)


if __name__ == "__main__":
    unittest.main()
