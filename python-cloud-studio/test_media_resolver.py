"""Offline checks for candidate discovery, fallback, media probes, and SSRF."""
from datetime import datetime, timezone
import json
import unittest
from unittest.mock import Mock, patch

import requests
import alezz_fetchv_importer as importer
from media_resolver import (MediaResolver, confidence, extract_candidates,
                            merge_sources, safe_error, signed_expiry, supported_source_kind)

ROOT = 'https://source.example.org/episode/1'
OLD = 'https://cdn.example.org/old.m3u8?expires=1700000000&token=secret'
NEW = 'https://cdn.example.org/new.m3u8?expires=1900000000'


class FakeSite:
    def __init__(self, pages=None, healthy=()):
        self.pages = pages or {}
        self.healthy = set(healthy)
        self.requested = []
        self.checked = []

    def get(self, url, **kwargs):
        self.requested.append(url)
        if url not in self.pages: raise ValueError('HTTP 404')
        result = self.pages[url]
        if isinstance(result, tuple): return result
        return url, 'text/html', result

    def media_verified(self, url):
        self.checked.append(url)
        return (True, 'OK') if url in self.healthy else (False, 'HTTP 403 expired')


class ResolverTests(unittest.TestCase):
    def test_1vid_embed_format_and_nonvideo_probe(self):
        url = 'https://1vid.xyz/embed-cnpn8jvjzx9p.html'
        self.assertEqual(supported_source_kind(url), 'embed')
        self.assertEqual(supported_source_kind('https://www.1vid.xyz/embed-Xy_123.html'), 'embed')
        self.assertEqual(supported_source_kind('https://cdn.example.org/film.m3u8'), 'direct')
        for invalid in (
            'http://1vid.xyz/embed-cnpn8jvjzx9p.html',
            'https://1vid.xyz.evil.test/embed-cnpn8jvjzx9p.html',
            'https://1vid.xyz/watch/cnpn8jvjzx9p',
            'https://1vid.xyz:8443/embed-cnpn8jvjzx9p.html',
            'https://127.0.0.1/embed-cnpn8jvjzx9p.html',
        ):
            self.assertEqual(supported_source_kind(invalid), '', invalid)
        page = FakeSite({url: '<html><body>Player</body></html>'})
        result = self.resolver(page, mode='http').check(
            [{'url': url, 'kind': 'embed', 'label': '1vid'}])[0]
        self.assertTrue(result['reachable'])
        self.assertFalse(result['verified'])
        self.assertEqual(page.checked, [])

    def resolver(self, site, browser=None, mode='auto', **kwargs):
        return MediaResolver(mode=mode, client_factory=lambda timeout: site,
                             browser_capture=browser or Mock(return_value=[]), **kwargs)

    def test_html_json_iframe_and_literal_config(self):
        body = '''<video><source src="/main.mp4"></video>
          <iframe src="https://player.example.org/watch/4"></iframe>
          <script type="application/json">{"sources":[{"file":"https://cdn.example.org/720.m3u8","label":"720P"}]}</script>
          <script>player({file:"https:\\/\\/cdn.example.org/backup.mp4?x=1&amp;y=2"});</script>
          <a href="https://localhost/secret.mp4">bad</a>
          <iframe src="https://192.168.1.10/watch"></iframe>'''
        sources, pages = extract_candidates(body, ROOT, now=123)
        urls = {s['url'] for s in sources}
        self.assertIn('https://source.example.org/main.mp4', urls)
        self.assertIn('https://cdn.example.org/720.m3u8', urls)
        self.assertIn('https://cdn.example.org/backup.mp4?x=1&y=2', urls)
        self.assertEqual(pages, ['https://player.example.org/watch/4'])
        self.assertTrue(all(s['discovered_at'] == 123 and not s['verified'] for s in sources))
        self.assertTrue(all('localhost' not in u and '192.168.' not in u for u in urls))

    def test_json_response_and_extensionless_embed_are_kept(self):
        payload = json.dumps({'data': {'sources': [{'src': NEW, 'quality': '1080P'}]},
                              'embedUrl': 'https://player.example.org/embed/5'})
        sources, pages = extract_candidates(payload, ROOT)
        self.assertEqual(len(sources), 2)
        self.assertIn('https://player.example.org/embed/5', pages)
        self.assertEqual(next(s for s in sources if s['url'] == NEW)['label'], '1080P')

    def test_expired_candidate_triggers_headless_and_healthy_alternative(self):
        site = FakeSite({ROOT: f'<video src="{OLD}"></video>'}, healthy=[NEW])
        browser = Mock(return_value=[dict(url=NEW, kind='direct', page_url=ROOT)])
        sources, errors = self.resolver(site, browser).resolve([ROOT])
        browser.assert_called_once_with(ROOT)
        self.assertFalse(errors)
        self.assertEqual({s['url'] for s in sources}, {OLD, NEW})
        self.assertTrue(next(s for s in sources if s['url'] == NEW)['verified'])
        self.assertFalse(next(s for s in sources if s['url'] == OLD)['verified'])
        self.assertEqual(site.checked.count(OLD), 1)
        self.assertEqual(site.checked.count(NEW), 1)

    def test_http_success_skips_browser(self):
        site = FakeSite({ROOT: f'<video src="{NEW}"></video>'}, healthy=[NEW])
        browser = Mock(return_value=[])
        sources, _ = self.resolver(site, browser).resolve([ROOT])
        browser.assert_not_called()
        self.assertTrue(sources[0]['verified'])

    def test_http_mode_never_starts_browser_even_when_all_expired(self):
        site = FakeSite({ROOT: f'<video src="{OLD}"></video>'})
        browser = Mock(side_effect=AssertionError('browser must not start'))
        sources, _ = self.resolver(site, browser, mode='http').resolve([ROOT])
        browser.assert_not_called()
        self.assertEqual(sources[0]['url'], OLD)
        self.assertFalse(sources[0]['verified'])

    def test_html_embed_is_not_a_verified_video(self):
        embed = 'https://player.example.org/embed/5'
        site = FakeSite({ROOT: f'<iframe src="{embed}"></iframe>', embed: '<html><body>player</body></html>'})
        sources, _ = self.resolver(site, mode='http').resolve([ROOT])
        self.assertEqual(len(sources), 1)
        self.assertTrue(sources[0]['reachable'])
        self.assertFalse(sources[0]['verified'])

    def test_missing_source_does_not_invent_link(self):
        browser = Mock(return_value=[])
        sources, errors = self.resolver(FakeSite(), browser).resolve([])
        self.assertEqual((sources, errors), ([], []))
        browser.assert_not_called()

    def test_crawler_limits_recursive_pages(self):
        pages = {ROOT: '<iframe src="https://source.example.org/frame/0"></iframe>'}
        for n in range(15):
            pages[f'https://source.example.org/frame/{n}'] = f'<iframe src="https://source.example.org/frame/{n+1}"></iframe>'
        site = FakeSite(pages)
        self.resolver(site, mode='http', max_pages=2).extract([ROOT])
        self.assertEqual(len(site.requested), 2)

    def test_invalid_urls_never_reach_http_or_browser(self):
        site, browser = FakeSite(), Mock(return_value=[])
        result = self.resolver(site, browser).resolve(['https://localhost/a', 'https://10.1.2.3/',
                                                     'http://source.example.org/', 'https://host.internal/a'])
        self.assertEqual(result, ([], []))
        self.assertFalse(site.requested)
        browser.assert_not_called()

    def test_history_deduplicates_without_pruning_or_dropping_first_discovery(self):
        old = [dict(url=f'https://cdn.example.org/{n}.mp4', discovered_at=10, failures=1) for n in range(160)]
        latest = [dict(url=old[0]['url']+'#player', discovered_at=20, verified=True, successes=1)]
        merged = merge_sources(old, latest)
        self.assertEqual(len(merged), 160)
        row = next(x for x in merged if x['url'] == old[0]['url'])
        self.assertEqual(row['discovered_at'], 10)
        self.assertEqual(row['failures'], 1)
        self.assertTrue(row['verified'])
        self.assertEqual(len(merge_sources(merged, limit=8)), 8)

    def test_score_learns_from_actual_probe_history(self):
        self.assertGreater(confidence({'successes': 8, 'failures': 1}), confidence({'successes': 1, 'failures': 8}))
        site = FakeSite(healthy=[NEW])
        checked = self.resolver(site).check([dict(url=NEW, kind='direct', successes=2, failures=1)])
        self.assertEqual(checked[0]['successes'], 3)
        self.assertEqual(checked[0]['failures'], 1)

    def test_signed_expiry_uses_explicit_timestamp_and_preserves_signature(self):
        self.assertEqual(signed_expiry(NEW), 1900000000)
        self.assertEqual(signed_expiry('https://cdn.other.example/hls2/01/master.m3u8?t=fixture&s=1793775268&e=43200&v=1&i=0.0&sp=0'), 1793818468)
        self.assertEqual(signed_expiry('https://afast-store2-lmy.cdnz.quest/hls2/index.m3u8?t=fixture&s=1793775777&e=18000'), 1793793777)
        self.assertIsNone(signed_expiry('https://cdnz.quest.example.org/hls2/index.m3u8?t=fixture&s=1793775777&e=18000'))
        self.assertEqual(signed_expiry('https://store1-mvn.brqz.online/hls/master.m3u8?t=fixture&s=1793774501&e=43200'), 1793817701)
        self.assertIsNone(signed_expiry('https://example.org/master.m3u8?t=fixture&s=1793774501&e=43200'))
        self.assertEqual(signed_expiry('https://cdn.example.org/a.mp4?exp=1900000000000'), 1900000000)
        expected = datetime(2026, 11, 3, tzinfo=timezone.utc).timestamp()+3600
        self.assertEqual(signed_expiry('https://cdn.example.org/a.mp4?X-Amz-Date=20261103T000000Z&X-Amz-Expires=3600'), expected)
        self.assertIsNone(signed_expiry('https://cdn.example.org/a.mp4?exp=forever'))

    def test_error_logs_redact_signed_urls_and_tokens(self):
        result = safe_error(f'Failed {OLD} Authorization=secret password=hidden Bearer sensitive.jwt.value')
        self.assertNotIn('secret', result)
        self.assertNotIn('hidden', result)
        self.assertNotIn('cdn.example', result)
        self.assertNotIn('sensitive.jwt.value', result)

    def test_hash_routed_source_page_is_preserved_for_browser(self):
        root = ROOT+'#/watch/1'
        browser = Mock(return_value=[])
        self.resolver(FakeSite(), browser).resolve([root])
        browser.assert_called_once_with(root)


class MediaProbeTests(unittest.TestCase):
    def test_page_retry_recovers_after_connection_reset_and_truncated_body(self):
        client = importer.SourceClient()
        response = Mock(status_code=200, headers={'Content-Type':'text/html'}, encoding='utf-8')
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.iter_content.side_effect = [requests.exceptions.ChunkedEncodingError(), [b'<html>OK</html>']]
        client.session.get = Mock(side_effect=[ConnectionResetError(10054, 'remote reset'), response, response])
        with patch.object(importer,'check_dns') as dns, patch.object(importer.time,'sleep') as delay:
            self.assertEqual(client.get(ROOT),(ROOT,'text/html','<html>OK</html>'))
        self.assertEqual(dns.call_count,3)
        self.assertEqual(delay.call_count,2)

    def test_page_retry_is_bounded_and_reports_connection_error(self):
        client = importer.SourceClient()
        client.session.get = Mock(side_effect=requests.exceptions.ConnectionError('connection reset'))
        with patch.object(importer,'check_dns'), patch.object(importer.time,'sleep'):
            with self.assertRaises(importer.SourceConnectionError):
                client.get(ROOT)
        self.assertEqual(client.session.get.call_count,3)

    def client(self, samples):
        client = importer.SourceClient()
        client.sample = Mock(side_effect=lambda url, size=8192: samples[url])
        return client

    def test_200_html_is_rejected_even_with_video_mime(self):
        client = self.client({NEW: (NEW, 'video/mp4', b'<html>expired</html>')})
        self.assertFalse(client.media_verified(NEW)[0])

    def test_arbitrary_200_body_is_rejected(self):
        url = 'https://cdn.example.org/a.mp4'
        client = self.client({url: (url, 'application/octet-stream', b'not a video')})
        self.assertFalse(client.media_verified(url)[0])

    def test_mp4_header_is_accepted(self):
        url = 'https://cdn.example.org/a.mp4'
        client = self.client({url: (url, 'application/octet-stream', b'\x00\x00\x00\x18ftypisom\x00\x00\x00\x01')})
        self.assertTrue(client.media_verified(url)[0])

    def test_hls_checks_segment_not_only_manifest(self):
        segment = 'https://cdn.example.org/part.ts'
        client = self.client({NEW: (NEW, 'application/vnd.apple.mpegurl', b'#EXTM3U\n#EXTINF:5,\npart.ts\n'),
                              segment: (segment, 'video/mp2t', b'\x47'+b'\0'*187+b'\x47'+b'\0'*187)})
        self.assertTrue(client.media_verified(NEW)[0])
        self.assertEqual(client.sample.call_args_list[-1].args[0], segment)

    def test_hls_expired_segment_fails(self):
        client = importer.SourceClient()
        client.sample = Mock(side_effect=[(NEW, 'application/vnd.apple.mpegurl', b'#EXTM3U\n#EXTINF:5,\npart.ts\n'),
                                         requests.HTTPError('HTTP 403 expired')])
        self.assertFalse(client.media_verified(NEW)[0])

    def test_protected_hls_is_not_processed(self):
        client = self.client({NEW: (NEW, 'application/vnd.apple.mpegurl',
                                  b'#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\npart.ts\n')})
        self.assertFalse(client.media_verified(NEW)[0])
        self.assertEqual(client.sample.call_count, 1)

    def test_redirect_to_private_url_is_blocked_before_second_request(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.status_code = 302
        response.headers = {'Location': 'https://localhost/private.mp4'}
        client = importer.SourceClient()
        client.session.get = Mock(return_value=response)
        # Real public_url still runs in this DNS wrapper, without external DNS.
        with patch.object(importer, 'check_dns', side_effect=lambda url: importer.public_url(url)):
            with self.assertRaises(ValueError): client.sample('https://cdn.example.org/valid.mp4')
        self.assertEqual(client.session.get.call_count, 1)

    def test_private_dns_answers_are_rejected(self):
        with patch.object(importer.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(ValueError): importer.check_dns('https://source.example.org/a')


if __name__ == '__main__': unittest.main()
