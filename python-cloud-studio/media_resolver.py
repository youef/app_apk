"""Discover ordinary public media with bounded HTTP and conditional Chromium.

Discovered URLs remain candidates until a separate media probe succeeds. This
module never loads a user's browser profile, FetchV, DRM keys, or login cookies.
The caller persists source history; merging does not silently discard old URLs.
"""
from __future__ import annotations

from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import html as html_lib
import json
import os
import re
import time
import threading
from urllib.parse import parse_qs, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from alezz_fetchv_importer import MEDIA_EXT, SourceClient, check_dns, clean, find_static_media, public_url

MAX_CANDIDATES = 128
_BROWSER_SLOTS = threading.BoundedSemaphore(2)

# Reachability of an embed page is not evidence of playable media.
ONEVID_EMBED_PATH = re.compile(r'^/embed-[A-Za-z0-9_-]+\.html$', re.I)
OK_RU_VIDEO_PATH = re.compile(r'^/video(?:embed)?/([0-9]{1,20})/?$')


def official_ok_embed(value: str) -> str:
    """Canonical public OK.ru share/iframe URL; never use signed CDN URLs."""
    try:
        parts = urlsplit(value.strip())
        if (parts.scheme != 'https' or parts.username or parts.password or
                parts.port not in (None, 443) or
                (parts.hostname or '').lower() not in ('ok.ru', 'www.ok.ru') or
                parts.query or parts.fragment):
            return ''
        match = OK_RU_VIDEO_PATH.fullmatch(parts.path)
        return 'https://ok.ru/videoembed/' + match.group(1) if match else ''
    except (TypeError, AttributeError, ValueError):
        return ''



def supported_source_kind(value: str) -> str:
    """Classify a direct HTTPS media link or a supported 1vid iframe."""
    try:
        parts = urlsplit(value.strip())
        if (parts.scheme != 'https' or parts.username or parts.password or
                parts.port not in (None, 443) or not parts.hostname):
            return ''
        if MEDIA_EXT.search(parts.path):
            return 'direct'
        if official_ok_embed(value):
            return 'embed'
        if (parts.hostname.lower() in ('1vid.xyz', 'www.1vid.xyz') and
                ONEVID_EMBED_PATH.fullmatch(parts.path)):
            return 'embed'
    except (AttributeError, ValueError, TypeError):
        pass
    return ''



def safe_error(exc) -> str:
    """Do not put signed URLs, cookies, or authorization tokens in event logs."""
    value = re.sub(r'https?://[^\s\)\]"\']+', '[source]', str(exc))
    value = re.sub(r'(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*', 'Bearer [redacted]', value)
    value = re.sub(r'''(?i)(authorization|cookie|access_token|refresh_token|token|signature|password)["']?\s*[:=]\s*["']?[^\s,;"']+''',
                   r'\1=[redacted]', value)
    return clean(value, 180)


def normalized_source_url(value: str) -> str:
    """Drop browser fragments, preserving query order and signed query values."""
    value = public_url(value)
    if official := official_ok_embed(value):
        return official
    url = urlsplit(value)
    return urlunsplit((url.scheme, url.netloc.lower(), url.path, url.query, ''))


def signed_expiry(url: str) -> float | None:
    """Use explicit URL timestamps only; this is a hint, not a health result."""
    try:
        parts = urlsplit(url)
        query = {k.casefold(): v[0] for k, v in parse_qs(parts.query).items() if v}
        host = parts.hostname or ''
        signed_hls_host = any(host == domain or host.endswith('.' + domain)
                              for domain in ('brqz.online', 'cdnz.quest'))
        hls_path = parts.path.lower()
        shared_signature = '/hls2/' in hls_path and all(query.get(key) for key in ('v', 'i', 'sp'))
        if hls_path.endswith('.m3u8') and (signed_hls_host or shared_signature):
            start, duration = query.get('s', ''), query.get('e', '')
            if query.get('t') and re.fullmatch(r'\d{10}', start) and re.fullmatch(r'\d{1,6}', duration):
                if 946684800 <= int(start) <= 4102444800 and 0 < int(duration) <= 604800:
                    return int(start) + int(duration)
        for name in ('expires', 'expiry', 'exp', 'expire'):
            value = query.get(name, '')
            if re.fullmatch(r'\d{10}|\d{13}', value):
                stamp = int(value) / (1000 if len(value) == 13 else 1)
                if 946684800 <= stamp <= 4102444800: return stamp
        for prefix in ('x-amz-', 'x-goog-'):
            start, duration = query.get(prefix+'date'), query.get(prefix+'expires', '')
            if start and duration.isdecimal() and 0 <= int(duration) <= 604800:
                return datetime.strptime(start, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp() + int(duration)
    except (ValueError, TypeError, OverflowError): pass
    return None


def _count(value) -> int:
    try: return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError): return 0


def confidence(source: dict) -> float:
    """A transparent Beta-smoothed success score from actual probes."""
    successes = _count(source.get('successes'))
    failures = _count(source.get('failures'))
    return round(100 * (successes + 1) / (successes + failures + 2), 1)


def merge_sources(*groups, limit: int | None = None) -> list[dict]:
    """Deduplicate exact URLs while retaining history and the first discovery."""
    merged = {}
    for group in groups:
        for raw in group or []:
            if not isinstance(raw, dict): continue
            try: url = normalized_source_url(raw.get('url', ''))
            except (ValueError, TypeError): continue
            row = dict(raw, url=url)
            prior = merged.get(url, {})
            combined = {**prior, **row}
            dates = [stamp for stamp in (prior.get('discovered_at'), row.get('discovered_at'))
                     if isinstance(stamp, (int, float)) and stamp > 0]
            if dates: combined['discovered_at'] = min(dates)
            if 'successes' in prior: combined['successes'] = max(_count(prior.get('successes')), _count(row.get('successes')))
            if 'failures' in prior: combined['failures'] = max(_count(prior.get('failures')), _count(row.get('failures')))
            merged[url] = combined
    rows = list(merged.values())
    rows.sort(key=lambda x: (bool(x.get('verified')), confidence(x), x.get('checked_at') or 0), reverse=True)
    return rows if limit is None else rows[:max(0, limit)]


def extract_candidates(body: str, base: str, *, now: float | None = None) -> tuple[list[dict], list[str]]:
    """Read literal HTML/JSON player data; do not execute or deobfuscate scripts."""
    now = time.time() if now is None else now
    public_url(base)
    body = body[:1_500_000]
    soup = BeautifulSoup(body, 'html.parser')
    sources, pages = [], []

    def add(value, label='', embed=False):
        if not isinstance(value, str) or len(sources) >= MAX_CANDIDATES: return
        value = html_lib.unescape(value.strip())
        if not value or value.startswith(('#', 'javascript:', 'data:', 'blob:')): return
        try: url = normalized_source_url(urljoin(base, value))
        except (ValueError, TypeError): return
        kind = 'direct' if MEDIA_EXT.search(url) else 'embed'
        if kind == 'embed' and not embed and not official_ok_embed(url): return
        item = dict(url=url, label=clean(label, 80) or urlsplit(url).hostname,
                    kind=kind, page_url=base, verified=False,
                    discovered_at=now, last_seen_at=now)
        expiry = signed_expiry(url)
        if expiry is not None: item['expires_at'] = expiry
        sources.append(item)
        if kind == 'embed' and url not in pages: pages.append(url)

    def walk_json(raw):
        stack = [(raw, 0)]
        for _ in range(1200):
            if not stack: break
            node, depth = stack.pop()
            if depth > 12: continue
            if isinstance(node, list): stack.extend((x, depth+1) for x in node[:128]); continue
            if not isinstance(node, dict): continue
            label = node.get('label') or node.get('quality') or node.get('name') or ''
            for key, value in node.items():
                if key in ('contentUrl', 'file', 'src', 'url', 'source', 'hls', 'mp4'):
                    add(value, label)
                elif key in ('embedUrl', 'iframe', 'player_url'):
                    add(value, label, embed=True)
                if isinstance(value, (dict, list)): stack.append((value, depth+1))

    if body.lstrip().startswith(('{', '[')):
        try: walk_json(json.loads(body))
        except (ValueError, RecursionError): pass
    for url in find_static_media(soup, base): add(url)
    for tag in soup.select('iframe[src],iframe[data-src],embed[src],video[src],source[src],'
                           '[data-file],[data-src],[data-url],[data-embed],[data-player],a[href]')[:1600]:
        label = tag.get('title') or tag.get('data-label') or tag.get_text(' ', strip=True)[:80]
        marker = ' '.join(tag.get('class') or [])
        embed = tag.name in ('iframe', 'embed') or bool(re.search(r'player|server|مشغل|سيرفر|مشاهدة', marker+' '+label, re.I))
        for attr in ('src', 'data-src', 'data-file', 'data-url', 'data-embed', 'data-player', 'href'):
            if tag.get(attr): add(tag[attr], label, embed=embed)
    for script in soup.select('script')[:80]:
        text = (script.string or script.get_text())[:250000].replace('\\/', '/')
        if script.get('type') in ('application/ld+json', 'application/json'):
            try: walk_json(json.loads(text))
            except (ValueError, RecursionError): pass
        for match in re.finditer(r'''["']((?:https://|//|/)[^"'<>\s]+?\.(?:m3u8|mp4|m4v|webm)(?:\?[^"'<>\s]*)?)["']''', text, re.I):
            add(match.group(1).replace('\\u0026', '&'))
    return merge_sources(sources), pages[:12]


class MediaResolver:
    def __init__(self, mode='auto', client_factory=SourceClient, browser_capture=None,
                 max_pages=10, timeout=6, workers=4, max_seconds=45):
        if mode not in ('http', 'auto', 'headless'): raise ValueError('Invalid extraction mode')
        self.mode, self.client_factory = mode, client_factory
        self.browser_capture = browser_capture or capture_headless
        self.max_pages, self.timeout = max(1, min(max_pages, 30)), timeout
        self.workers = max(1, min(workers, 4))
        self.max_seconds = max(1, min(max_seconds, 90))

    def _client(self, deadline):
        client = self.client_factory(timeout=max(.1, min(self.timeout, deadline-time.monotonic())))
        # Each request has its own session. Retries belong to the durable queue,
        # rather than multiplying interactive latency on an unavailable host.
        if isinstance(client, SourceClient):
            client.deadline, client.retries = deadline, 1
        return client

    @staticmethod
    def _pages(pages):
        output = []
        for url in pages or []:
            try: value = public_url(url)
            except (ValueError, TypeError): continue
            if value not in output: output.append(value)
        return output

    def _browser(self, pages, *, deadline=None, known=()):
        deadline = deadline or time.monotonic()+self.max_seconds
        sources, errors = [], []
        for url in self._pages(pages)[:3]:
            if time.monotonic() >= deadline: break
            try:
                if self.browser_capture is capture_headless:
                    result = self.browser_capture(url, max_seconds=max(1, deadline-time.monotonic()))
                else:
                    result = self.browser_capture(url)
                sources = merge_sources(sources, result)
            except Exception as exc: errors.append(safe_error(exc))
            if any(row.get('kind') == 'direct' and row['url'] not in known for row in sources): break
        return sources, errors

    def _http(self, pages: list[str], *, deadline=None) -> tuple[list[dict], list[str]]:
        deadline = deadline or time.monotonic()+self.max_seconds
        roots = self._pages(pages)
        queue = [(url, 0) for url in roots]
        seen, sources, errors = set(), [], []

        def fetch(url):
            client = self._client(deadline)
            try:
                if time.monotonic() >= deadline: return [], [], 'انتهت مهلة قراءة المصادر'
                final, typ, body = client.get(url)
                public_url(final)
                if MEDIA_EXT.search(final):
                    return [dict(url=final,kind='direct',page_url=url,verified=False)], [], ''
                if 'html' in typ.lower() or 'json' in typ.lower() or body.lstrip().startswith(('{', '[')):
                    found, embeds = extract_candidates(body, final)
                    return found, embeds, ''
                return [], [], ''
            except Exception as exc: return [], [], safe_error(exc)
            finally:
                if hasattr(client, 'session'): client.session.close()

        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            while queue and len(seen) < self.max_pages and time.monotonic() < deadline:
                batch=[]
                while queue and len(batch)<self.workers and len(seen)<self.max_pages:
                    url, depth=queue.pop(0)
                    if url in seen: continue
                    seen.add(url)
                    batch.append((url, depth))
                for (_, depth), (found, embeds, error) in zip(batch, pool.map(fetch, [url for url,_ in batch])):
                    sources = merge_sources(sources, found)
                    if error: errors.append(error)
                    if depth < 2:
                        queue.extend((u, depth+1) for u in embeds if u not in seen and len(queue) < 36)
        return sources, errors[:6]

    def extract(self, pages: list[str], *, force_browser=False) -> tuple[list[dict], list[str]]:
        """Return candidates. Use resolve() to retry headless after expired URLs."""
        deadline = time.monotonic()+self.max_seconds
        sources, errors = self._http(pages, deadline=deadline)
        if self.mode == 'headless' or self.mode == 'auto' and (force_browser or not any(x.get('kind') == 'direct' for x in sources)):
            browser_sources, browser_errors = self._browser(pages, deadline=deadline)
            sources = merge_sources(sources, browser_sources)
            errors.extend(browser_errors)
        return sources, errors[:6]

    def check(self, sources: list[dict], *, deadline=None) -> list[dict]:
        """Probe all supplied candidates; an HTML embed is never a verified video."""
        deadline = deadline or time.monotonic()+self.max_seconds
        def probe(item):
            row = dict(item)
            try:
                row['url'] = normalized_source_url(row.get('url', ''))
            except (ValueError, TypeError, AttributeError):
                pass  # Invalid URLs are recorded as failed without network access.
            if supported_source_kind(row.get('url','')) == 'embed':
                row['kind'] = 'embed'
            if time.monotonic() >= deadline:
                row.update(verified=False,reachable=False,error='انتهت مهلة الفحص؛ سيُعاد تلقائيًا')
                return row
            client = self._client(deadline)
            try:
                row = dict(item)
                if supported_source_kind(row.get('url','')) == 'embed':
                    row['kind'] = 'embed'
                try:
                    public_url(row['url'])
                    if row.get('kind') == 'embed':
                        _, typ, body = client.get(row['url'], max_size=750000)
                        row.update(verified=False, reachable=bool(body) and 'html' in typ.lower(),
                                   error='صفحة مشغل متاحة؛ لم يتم إثبات تشغيل الفيديو')
                    else:
                        ok, error = client.media_verified(row['url'])
                        row.update(verified=bool(ok), error='' if ok else safe_error(error))
                except Exception as exc: row.update(verified=False, reachable=False, error=safe_error(exc))
                row['checked_at'] = time.time()
                if row.get('kind') != 'embed':
                    key = 'successes' if row.get('verified') else 'failures'
                    row[key] = _count(row.get(key)) + 1
                    row['confidence'] = confidence(row)
                expiry = signed_expiry(row['url'])
                if expiry is not None: row['expires_at'] = expiry
                return row
            finally:
                if hasattr(client, 'session'): client.session.close()
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            return list(pool.map(probe, merge_sources(sources)))

    def resolve(self, pages: list[str], existing=()) -> tuple[list[dict], list[str]]:
        """HTTP first; conditional browser fallback includes all-expired candidates."""
        deadline = time.monotonic()+self.max_seconds
        candidates, errors = self._http(pages, deadline=deadline)
        checked = self.check(merge_sources(existing, candidates), deadline=deadline)
        if self.mode == 'headless' or self.mode == 'auto' and not any(x.get('verified') for x in checked):
            # Leave time to verify captured candidates within the same budget.
            previous = {x['url'] for x in checked}
            browser_sources, browser_errors = self._browser(pages, deadline=deadline-min(10,self.max_seconds/3),
                                                           known=previous)
            errors.extend(browser_errors)
            new = [x for x in browser_sources if x.get('url') not in previous]
            checked = merge_sources(checked, self.check(new, deadline=deadline))
        return checked, errors[:6]


def read_public_html(url: str, max_size: int) -> tuple[str, str, str]:
    """Read a public document through Chromium when the HTTP client disconnects."""
    if not _BROWSER_SLOTS.acquire(timeout=15):
        raise TimeoutError('المتصفح مشغول؛ تعذرت قراءة المصدر ضمن المهلة')
    try:
        return _read_public_html(url, max_size)
    finally:
        _BROWSER_SLOTS.release()


def _read_public_html(url: str, max_size: int) -> tuple[str, str, str]:
    from playwright.sync_api import sync_playwright
    check_dns(url)
    with sync_playwright() as playwright:
        options = {'headless': True}
        if os.getenv('ALEZZ_BROWSER_CHANNEL'):
            options['channel'] = os.environ['ALEZZ_BROWSER_CHANNEL']
        browser = playwright.chromium.launch(**options)
        try:
            context = browser.new_context(java_script_enabled=False, service_workers='block', accept_downloads=False)
            page = context.new_page()
            devtools = context.new_cdp_session(page)
            main_frame = devtools.send('Page.getFrameTree')['frameTree']['frame']['id']
            navigations = 0
            def allow_document(event):
                nonlocal navigations
                request_id = event['requestId']
                try:
                    if event['resourceType'] != 'Document' or event['frameId'] != main_frame or navigations >= 5:
                        raise ValueError('Only the main document is allowed')
                    check_dns(event['request']['url'])
                    navigations += 1
                    devtools.send('Fetch.continueRequest', {'requestId':request_id})
                except Exception:
                    devtools.send('Fetch.failRequest', {'requestId':request_id,'errorReason':'BlockedByClient'})
            # Intercept each navigation hop, including redirects.
            devtools.on('Fetch.requestPaused', allow_document)
            devtools.send('Fetch.enable', {'patterns':[{'urlPattern':'*'}]})
            response = page.goto(url, wait_until='domcontentloaded', timeout=15000)
            if not response or not response.ok:
                raise ValueError('لم يفتح المتصفح صفحة المصدر.')
            check_dns(response.url)
            content_type = response.headers.get('content-type','')
            if 'html' not in content_type.lower():
                raise ValueError('صفحة المصدر لم تُرجع HTML.')
            html = page.evaluate('limit => document.documentElement.outerHTML.slice(0, limit + 1)', max_size)
            if len(html.encode('utf-8')) > max_size:
                raise ValueError('تجاوزت صفحة المصدر الحد المسموح.')
            return response.url, content_type, html
        finally:
            browser.close()


def capture_headless(url: str, *, max_seconds=35) -> list[dict]:
    """Limit Chromium memory use across interactive and maintenance workers."""
    started=time.monotonic()
    if not _BROWSER_SLOTS.acquire(timeout=max(0,max_seconds)):
        raise TimeoutError('المتصفح مشغول؛ سيُعاد الفحص تلقائيًا')
    try:
        remaining=max_seconds-(time.monotonic()-started)
        if remaining<=0: return []
        return _capture_headless(url,max_seconds=remaining)
    finally:
        _BROWSER_SLOTS.release()


def _capture_headless(url: str, *, max_seconds=35) -> list[dict]:
    """Fresh invisible Chromium with request, host, time, and response-size limits.

    URL/DNS checks are a best-effort application guard. Production should also
    prohibit private-network egress; Chromium does its own DNS resolution.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise ValueError('Chromium/Playwright غير مثبت؛ استخدم Docker المرفق أو وضع HTTP') from exc
    check_dns(url)
    found, hosts = [], set()
    started = time.monotonic()
    request_count = 0
    with sync_playwright() as p:
        options = dict(headless=True, args=['--disable-dev-shm-usage', '--disable-quic',
                                           '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
        if os.getenv('ALEZZ_BROWSER_CHANNEL'): options['channel'] = os.environ['ALEZZ_BROWSER_CHANNEL']
        browser = p.chromium.launch(**options)
        try:
            context = browser.new_context(service_workers='block', accept_downloads=False)
            context.set_default_timeout(1500)
            context.route_web_socket('**/*', lambda websocket: websocket.close())

            def observe(request):
                if len(found) >= MAX_CANDIDATES or not MEDIA_EXT.search(request.url): return
                try:
                    target = normalized_source_url(request.url)
                    found.append(dict(url=target, label=urlsplit(target).hostname, kind='direct',
                                      page_url=url, verified=False, discovered_at=time.time(), last_seen_at=time.time()))
                except (ValueError, TypeError): pass

            def route_request(route):
                nonlocal request_count
                request_count += 1
                try:
                    if request_count > 180 or time.monotonic()-started > max_seconds: raise ValueError('Resource limit')
                    target = public_url(route.request.url)
                    host = urlsplit(target).hostname
                    if host not in hosts:
                        if len(hosts) >= 24: raise ValueError('Host limit')
                        check_dns(target); hosts.add(host)
                    observe(route.request)
                    # Only the URL is needed; prevent browser media downloads.
                    if route.request.resource_type in ('image', 'font', 'media') or re.search(r'\.(?:ts|m4s)(?:[?#]|$)', target, re.I):
                        route.abort('blockedbyclient'); return
                    if route.request.is_navigation_request() and route.request.frame.page != page:
                        route.abort('blockedbyclient'); return
                    route.continue_()
                except Exception: route.abort('blockedbyclient')

            context.route('**/*', route_request)
            page = context.new_page()
            page.on('dialog', lambda dialog: dialog.dismiss())
            page.on('popup', lambda popup: popup.close())

            def observe_json(response):
                try:
                    if time.monotonic()-started > max_seconds or len(found) >= MAX_CANDIDATES: return
                    headers = response.headers
                    size = headers.get('content-length', '')
                    if 'json' not in headers.get('content-type', '').lower(): return
                    # Do not buffer unknown-size browser responses in server RAM.
                    if not size.isdecimal() or not 0 < int(size) <= 250000: return
                    public_url(response.url)
                    body = response.body()
                    if len(body) <= 250000:
                        found.extend(extract_candidates(body.decode('utf-8', errors='replace'), response.url)[0])
                except Exception: pass

            page.on('response', observe_json)
            try: page.goto(url, wait_until='domcontentloaded', timeout=max(1,min(18000,(max_seconds-(time.monotonic()-started))*1000)))
            except Exception:
                if page.is_closed(): return merge_sources(found)
            page.wait_for_timeout(max(0,min(1500,(max_seconds-(time.monotonic()-started))*1000)))
            for frame in page.frames[:8]:
                if time.monotonic()-started > max_seconds: break
                try:
                    check_dns(frame.url)
                    found.extend(extract_candidates(frame.content(), frame.url)[0])
                except Exception: continue
                for selector in ('video', 'button[aria-label*="play" i]', 'button[title*="play" i]',
                                 '[data-server]', '.server-item'):
                    if time.monotonic()-started > max_seconds: break
                    try:
                        controls = frame.locator(selector)
                        for index in range(min(controls.count(), 3)):
                            if time.monotonic()-started > max_seconds: break
                            controls.nth(index).click(timeout=1000)
                            page.wait_for_timeout(700)
                    except Exception: pass
            return merge_sources(found, limit=MAX_CANDIDATES)
        finally: browser.close()
