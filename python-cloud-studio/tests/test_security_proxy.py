"""Offline regression tests for bounded admin-configured proxy failover.

No external IPs are contacted. These tests verify allowlist enforcement,
no WAF/status-based rotation, DNS fail-closed, and secret redaction.
"""
import os
import socket
import unittest
from unittest.mock import patch, MagicMock
from security_proxy import audit_proxy_context, safe_status, try_proxy_get, _parse_one, _public_addrs, _connect_fetch, Proxy


class ProxyPoolTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.dict(os.environ, {
            "ALEZZ_SECURITY_PROXY_ENABLED": "1",
            "ALEZZ_SECURITY_PROXY_URLS": (
                "http://alice:SECRET01@edge1.example.net:3128,"
                "http://bob:SECRET02@edge2.example.net:3128"
            ),
            "ALEZZ_SECURITY_PROXY_ALLOWED_HOSTS": "example.org,www.example.org",
        })
        self.config.start()
        self.addCleanup(self.config.stop)

    def test_configured_but_unapproved_hosts_use_direct(self):
        with audit_proxy_context("other.example.org") as ctx:
            with patch("security_proxy._connect_fetch") as get:
                self.assertIsNone(try_proxy_get(
                    "other.example.org", "/", None, 100, "agent", ["93.184.215.14"]))
                get.assert_not_called()
            self.assertEqual(ctx.summary()["mode"], "direct")
            self.assertFalse(ctx.summary()["approved"])

    def test_approved_hostname_uses_stable_proxy_without_rotation_on_403(self):
        with audit_proxy_context("example.org") as ctx:
            with patch("security_proxy._connect_fetch", return_value=(403, {"CF-Ray":"x"}, b"")) as get:
                result = try_proxy_get("example.org", "/", None, 100, "agent", ["93.184.215.14"])
                self.assertEqual(result[0], 403)
                self.assertEqual(ctx.summary()["mode"], "proxy")
                get.assert_called_once()
                self.assertNotIn("SECRET", str(ctx.summary()))
                self.assertEqual(ctx.attempts, 1)

    def test_one_failover_on_connection_error_only(self):
        with audit_proxy_context("example.org") as ctx:
            with patch("security_proxy._connect_fetch",
                       side_effect=[OSError("timeout"), (200, {"Content-Type":"text/html"}, b"ok")]) as get:
                result = try_proxy_get("example.org", "/", None, 100, "agent", ["93.184.215.14"])
                self.assertEqual(result[0], 200)
                self.assertEqual(get.call_count, 2)
                self.assertEqual(ctx.network_failures, 1)
                self.assertEqual(ctx.summary()["attempts"], 2)

    def test_proxy_connect_refusal_stops_immediately(self):
        with audit_proxy_context("example.org"):
            with patch("security_proxy._connect_fetch",
                       side_effect=OSError("Proxy CONNECT refused the request")) as get:
                with self.assertRaisesRegex(OSError, "refused"):
                    try_proxy_get("example.org", "/", None, 100, "agent", ["93.184.215.14"])
                get.assert_called_once()

    def test_reject_mixed_public_private_target_ips(self):
        with audit_proxy_context("example.org"):
            with patch("security_proxy._connect_fetch") as get:
                with self.assertRaises(ValueError):
                    try_proxy_get("example.org", "/", None, 100, "agent",
                                  ["93.184.215.14", "127.0.0.1"])
                get.assert_not_called()

    def test_reject_proxy_dns_with_private_ip(self):
        entries = [(socket.AF_INET,socket.SOCK_STREAM,6,"",("93.184.215.14",3128)),
                   (socket.AF_INET,socket.SOCK_STREAM,6,"",("10.1.2.3",3128))]
        with patch("socket.getaddrinfo", return_value=entries):
            with self.assertRaises(OSError):
                _public_addrs("edge1.example.net",3128)

    def test_proxy_config_never_exposes_creds(self):
        summary=safe_status()
        self.assertTrue(summary["enabled"])
        self.assertEqual(summary["configured"],2)
        self.assertEqual(summary["approved_host_count"],2)
        self.assertNotIn("alice",str(summary))
        self.assertNotIn("SECRET",str(summary))

    def test_connect_pins_public_target_ip_and_tls_to_hostname(self):
        proxy=Proxy(host="proxy.example.net",port=3128,username="user",password="pass")
        with patch("security_proxy._public_addrs", return_value=["93.184.215.14"]):
            with patch("security_proxy.http.client.HTTPConnection") as http:
                with patch("security_proxy.ssl.create_default_context") as sslcontext:
                    connection=http.return_value
                    reply=connection.getresponse.return_value
                    reply.status=200
                    reply.getheaders.return_value=[("Content-Type","text/html")]
                    reply.read.return_value=b"<html>public</html>"
                    result=_connect_fetch(proxy, "example.org", "198.51.100.3",
                                          "/about", None, 1024, "test-agent")
                    self.assertEqual(result[0],200)
                    http.assert_called_once_with("93.184.215.14",3128,timeout=7)
                    tunnel=connection.set_tunnel.call_args
                    self.assertEqual(tunnel.args[0],"198.51.100.3")
                    self.assertEqual(tunnel.kwargs["port"],443)
                    self.assertIn("Proxy-Authorization",tunnel.kwargs["headers"])
                    sslcontext.return_value.wrap_socket.assert_called_once()
                    self.assertEqual(sslcontext.return_value.wrap_socket.call_args.kwargs["server_hostname"],"example.org")
                    req=connection.request.call_args
                    self.assertEqual(req.args,("GET","/about"))
                    self.assertNotIn("Proxy-Authorization",req.kwargs["headers"])

    def test_http_connect_validation(self):
        self.assertEqual(_parse_one("http://user:pass@example.org:8080").port, 8080)
        with self.assertRaises(ValueError):
            _parse_one("socks5://example.org:1080")
        with self.assertRaises(ValueError):
            _parse_one("https://example.org:443")


if __name__ == "__main__":
    unittest.main()
