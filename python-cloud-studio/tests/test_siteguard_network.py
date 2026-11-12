"""Offline regression tests for public DNS/TLS metadata: no network requests."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from siteguard_network import _valid_ips, dns_lookup, _flatten_name

class PublicDNSLookupTests(unittest.TestCase):
    def test_disallow_private_ip_presentation(self):
        self.assertEqual(
            _valid_ips(["127.0.0.1", "10.0.0.2", "192.168.0.1", "1.1.1.1", "::1", "2606:4700:4700::1111"]),
            ["1.1.1.1", "2606:4700:4700::1111"])

    @patch("siteguard_network.public_addresses", return_value=["1.1.1.1"])
    @patch("siteguard_network._read_answer")
    def test_quick_dns_public_ip_not_origin(self, mock_read, mock_public):
        def values(_resolver, _host, kind, limit=12):
            return {"A": ["1.1.1.1", "127.0.0.1"], "AAAA": [], "CNAME": ["example.cloudflare.net"]}.get(kind, [])
        mock_read.side_effect = values
        output = dns_lookup("example.org", extended=False)
        self.assertEqual(output["public_ips"], ["1.1.1.1"])
        self.assertEqual(output["cdn_hint"], "Cloudflare")
        self.assertIsNone(output["origin_ip"])
        self.assertIn("الخادم الأصلي", output["origin_status"])

    def test_tls_subject_formatter(self):
        self.assertEqual(
            _flatten_name(((("commonName", "example.org"),), (("organizationName", "Example"),))),
            "example.org / Example")

if __name__ == "__main__":
    unittest.main()
