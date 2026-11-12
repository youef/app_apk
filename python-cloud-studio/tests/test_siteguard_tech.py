"""Offline tests for public SiteGuard version metadata; no network requests."""
import unittest
from siteguard_tech import analyze

class PublicVersionTests(unittest.TestCase):
    def test_disclosed_versions(self):
        markup = """<!doctype html><html><head>
        <meta name="generator" content="WordPress 6.6.2">
        <script src="/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>
        </head></html>"""
        data = analyze(
            {"X-Powered-By": "PHP/8.2.13", "Server": "nginx/1.25.4",
             "X-Database-Version": "PostgreSQL/15.5"}, markup)
        self.assertEqual(data["php"]["version"], "8.2.13")
        self.assertEqual(data["database"]["type"], "PostgreSQL")
        self.assertEqual(data["database"]["version"], "15.5")
        self.assertEqual(data["cms"]["name"], "WordPress")
        self.assertEqual(data["cms"]["version"], "6.6.2")
        self.assertIn("HTML", [x["name"] for x in data["languages"]])
        self.assertTrue(any(x["name"] == "jQuery" and x["version"] == "3.7.1"
                            for x in data["libraries"]))

    def test_hidden_versions_stay_unknown(self):
        data = analyze({"Server": "cloudflare"}, "<!doctype html><html></html>")
        self.assertEqual(data["php"]["version"], "غير معلن")
        self.assertEqual(data["database"]["version"], "غير معلن")
        self.assertEqual(data["cms"]["name"], "غير محدد")

    def test_inferred_php_from_public_wordpress_signature(self):
        data = analyze({}, '<html><a href="/wp-content/themes/demo/style.css">Page</a></html>')
        self.assertEqual(data["cms"]["name"], "WordPress")
        self.assertIn("PHP", data["php"]["type"])
        self.assertEqual(data["php"]["version"], "غير معلن")
        self.assertEqual(data["database"]["version"], "غير معلن")

if __name__ == "__main__":
    unittest.main()
