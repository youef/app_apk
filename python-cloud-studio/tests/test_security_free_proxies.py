"""No-network regression tests for public GitHub proxy catalog and scoped usage."""
import os
import sys
import types
import unittest
from unittest.mock import patch

from security_proxy import Proxy, audit_proxy_context, settings, try_proxy_get
from security_free_proxies import parse_candidate, parse_sources, refresh, status, _CACHE


class FreeProxyTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ, {
            "ALEZZ_SECURITY_PROXY_ENABLED":"1",
            "ALEZZ_SECURITY_FREE_PROXY_ENABLED":"1",
            "ALEZZ_SECURITY_PROXY_ALLOWED_HOSTS":"",
            "ALEZZ_SECURITY_PROXY_URLS":"",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        with patch("security_free_proxies._LOCK"):
            _CACHE.update(checked_at=0.0, candidate_count=0, working=(),
                          source_count=0, tested=0, error="")

    def test_parse_public_http_only(self):
        self.assertEqual(parse_candidate("http://93.184.215.14:8080"),
                         Proxy("93.184.215.14",8080))
        self.assertEqual(parse_candidate("93.184.215.14:3128"),
                         Proxy("93.184.215.14",3128))
        for value in ("127.0.0.1:8080","10.0.0.2:3128","192.168.1.1:8080",
                      "169.254.169.254:80","1.1.1.1:22",
                      "alice:secret@93.184.215.14:3128",
                      "http://example.com:8080","ftp://93.184.215.14:8080"):
            self.assertIsNone(parse_candidate(value),value)

    def test_dedup_and_protocol_filter(self):
        result=parse_sources(b"93.184.215.14:8080\nhttp://93.184.215.14:8080\n"
                             b"socks5://93.184.215.14:1080\n10.0.0.4:8080\n")
        self.assertEqual(result,(Proxy("93.184.215.14",8080),))

    def test_default_free_mode_scoped_to_own_service(self):
        _, allowed=settings()
        self.assertEqual(allowed,frozenset(["app-apk-oquy.onrender.com"]))
        with audit_proxy_context("www.al2la.com") as context:
            with patch("security_proxy._connect_fetch") as fetch:
                self.assertIsNone(try_proxy_get(
                    "www.al2la.com","/",None,2048,"test",["93.184.215.14"]))
                fetch.assert_not_called()
            self.assertFalse(context.approved)

    def test_approved_hosts_split_preserves_letter_n(self):
        with patch.dict(os.environ, {
            "ALEZZ_SECURITY_PROXY_ALLOWED_HOSTS":"example.org;app-apk-oquy.onrender.com"
        }):
            _, allowed=settings()
            self.assertIn("app-apk-oquy.onrender.com",allowed)
            self.assertEqual(len(allowed),2)

    def test_global_proxy_disable_never_fetches_community_pool(self):
        with patch.dict(os.environ,{"ALEZZ_SECURITY_PROXY_ENABLED":"0"}):
            with patch("security_free_proxies.working_pool") as working:
                with audit_proxy_context("app-apk-oquy.onrender.com") as ctx:
                    working.assert_not_called()
                    self.assertIsNone(try_proxy_get(
                        "app-apk-oquy.onrender.com","/",None,1024,"test",
                        ["93.184.215.14"]))
                    self.assertFalse(ctx.free_source)

    def test_github_raw_http_206_parsed_without_using_user_urls(self):
        from security_free_proxies import _fetch_candidates
        payload=b"93.184.215.14:8080\n10.0.0.1:8080\n"
        calls=[]
        def fake_get(host,path,*,max_bytes=0):
            calls.append((host,path))
            return 206,{"Content-Type":"text/plain; charset=utf-8"},payload
        with patch.dict(sys.modules,{"site_security":types.SimpleNamespace(safe_get=fake_get)}):
            proxies,source_count=_fetch_candidates()
        self.assertEqual(source_count,2)
        self.assertEqual(proxies,(Proxy("93.184.215.14",8080),))
        self.assertEqual(len(calls),2)
        self.assertTrue(all(host=="raw.githubusercontent.com" for host,_ in calls))

    def test_only_tls_verified_candidates_enter_pool(self):
        valid=Proxy("93.184.215.14",8080)
        bad=Proxy("93.184.215.15",3128)
        fake_site=types.SimpleNamespace(public_addresses=lambda host:["93.184.215.14"])
        with patch.dict(sys.modules,{"site_security":fake_site}):
            with patch("security_free_proxies._fetch_candidates",
                       return_value=((valid,bad),2)):
                with patch("security_free_proxies._test_connect",
                           side_effect=lambda proxy,ip: proxy==valid) as verify:
                    result=refresh(force=True)
        self.assertEqual(verify.call_count,2)
        self.assertEqual(result["candidates"],2)
        self.assertEqual(result["working"],1)
        self.assertEqual(status()["working"],1)

    def test_no_rotation_on_403_even_with_community(self):
        with patch("security_free_proxies.working_pool",
                   return_value=(Proxy("93.184.215.14",3128),Proxy("93.184.215.15",8080))):
            with audit_proxy_context("app-apk-oquy.onrender.com") as context:
                with patch("security_proxy._connect_fetch",
                           return_value=(403,{"CF-Ray":"public"},b"")) as fetch:
                    result=try_proxy_get("app-apk-oquy.onrender.com",
                                         "/",None,1024,"test",["93.184.215.14"])
                    self.assertEqual(result[0],403)
                    fetch.assert_called_once()
                    self.assertTrue(context.free_source)
                    self.assertTrue(context.approved)

    def test_fallback_to_direct_when_free_pool_has_no_working(self):
        with patch("security_free_proxies.working_pool",return_value=()):
            with audit_proxy_context("app-apk-oquy.onrender.com") as context:
                self.assertTrue(context.free_source)
                self.assertIsNone(try_proxy_get(
                    "app-apk-oquy.onrender.com", "/",None,1024,"test",
                    ["93.184.215.14"]))
                self.assertEqual(context.summary()["mode"],"direct")


if __name__=="__main__":
    unittest.main()
