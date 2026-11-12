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
        self.assertLessEqual(len(calls), 9)
        self.assertIn("معطل", report["browser_status"])


if __name__ == "__main__":
    unittest.main()
