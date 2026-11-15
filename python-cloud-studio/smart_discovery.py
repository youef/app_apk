"""Server-side scheduled discovery of new movie/series metadata.

This adapter only calls the original frozen catalogue parser. It never alters
the existing media extraction engine, rights state, or published catalogue.
All feeds and schedules live in Supabase so Render restarts cannot erase them.
"""
from __future__ import annotations

import os
import time
from urllib.parse import urlsplit
from uuid import UUID

from alezz_fetchv_importer import SourceClient, public_url, pull_html, store
from library_sync import canonical, extract_listing
from media_resolver import safe_error
from title_cleaner import content_title

FEED_TABLE = "aseel_studio_discovery_feeds"
KINDS = ("auto", "movie", "series")


def _instant(timestamp):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(float(timestamp), timezone.utc).isoformat()


def _normalize(url):
    url = canonical(public_url(str(url or "").strip()))
    # A feed is a catalogue page, not a signed HLS or local API endpoint.
    path = urlsplit(url).path.lower()
    if path.endswith((".m3u8", ".mp4", ".mpd", ".webm")):
        raise ValueError("اختر صفحة فهرس أفلام أو مسلسلات، وليس رابط تشغيل فيديو")
    return url


def _feed_id(value):
    return str(UUID(str(value)))


class SmartDiscovery:
    def __init__(self, worker, *, clock=time.time, source_client=SourceClient,
                 parse_listing=extract_listing, parse_work=pull_html, save_work=store):
        self.worker = worker
        self.clock = clock
        self.source_client = source_client
        self.parse_listing = parse_listing
        self.parse_work = parse_work
        self.save_work = save_work
        self.max_pages = max(1, min(6, int(os.getenv("ALEZZ_DISCOVERY_MAX_PAGES", "3"))))
        self.max_new = max(1, min(12, int(os.getenv("ALEZZ_DISCOVERY_MAX_NEW", "6"))))
        self.max_links = max(10, min(150, int(os.getenv("ALEZZ_DISCOVERY_MAX_LINKS", "75"))))
        self.last_tick = 0
        self.last_error = ""
        self.last_success = 0

    @property
    def db(self):
        if self.worker.db is None:
            raise RuntimeError("المزامنة الذكية تنتظر اتصال Supabase السري على الخادم")
        return self.worker.db

    def feeds(self):
        rows = self.db.query(FEED_TABLE, {"select":"id,source_url,kind,enabled,interval_minutes,"
                       "next_scan,last_scan,last_discovered,last_created,failures,last_error,"
                       "created_at", "order":"created_at.desc", "limit":"100"})
        return rows

    def add(self, url, kind="auto", interval_minutes=240):
        url = _normalize(url)
        if kind not in KINDS:
            raise ValueError("نوع المصدر غير صالح")
        minutes = int(interval_minutes)
        if not 60 <= minutes <= 10080:
            raise ValueError("مدة الفحص بين ساعة وأسبوع")
        prior = self.db.single(FEED_TABLE, {"source_url":"eq."+url, "select":"id"})
        if prior:
            row = self.db.patch(FEED_TABLE, prior["id"], {
                "kind":kind, "enabled":True, "interval_minutes":minutes,
                "next_scan":_instant(self.clock()), "last_error":""
            })
        else:
            row = self.db.insert(FEED_TABLE, {
                "source_url":url, "kind":kind, "enabled":True,
                "interval_minutes":minutes, "next_scan":_instant(self.clock())
            })
        self.worker.wake_event.set()
        return row

    def action(self, identifier, action):
        identifier = _feed_id(identifier)
        if action == "scan":
            patch = {"enabled":True,"next_scan":_instant(self.clock())}
        elif action == "pause":
            patch = {"enabled":False}
        elif action == "resume":
            patch = {"enabled":True,"next_scan":_instant(self.clock())}
        else:
            raise ValueError("أمر المصدر غير معروف")
        row = self.db.patch(FEED_TABLE, identifier, patch)
        self.worker.wake_event.set()
        return row

    def process_due(self):
        self.last_tick = self.clock()
        feeds = self.db.query(FEED_TABLE, {
            "select":"*","enabled":"eq.true","next_scan":"lte."+_instant(self.last_tick),
            "order":"next_scan.asc","limit":"1"
        })
        if not feeds:
            return False
        self.scan(feeds[0])
        return True

    def scan(self, feed):
        now = self.clock()
        identifier = _feed_id(feed["id"])
        interval = max(60,int(feed.get("interval_minutes") or 240))*60
        found,created,failed = 0,0,0
        try:
            origin = _normalize(feed["source_url"])
            pages = [origin]
            visited,seen_works = set(),set()
            works = []
            client = self.source_client(timeout=12)
            while pages and len(visited)<self.max_pages:
                if self.worker.stop_event.is_set():
                    return
                page = pages.pop(0)
                if page in visited:
                    continue
                visited.add(page)
                final,typ,html = client.get(page)
                if "html" not in typ.lower() and "<html" not in html[:1000].lower():
                    raise ValueError("مصدر الاكتشاف لا يعرض صفحة HTML")
                # The legacy listing parser limits to the source host.
                discovered,additional = self.parse_listing(html,final,origin,feed["kind"])
                for candidate in discovered:
                    try:
                        candidate = _normalize(candidate)
                    except ValueError:
                        continue
                    if urlsplit(candidate).hostname != urlsplit(origin).hostname:
                        continue
                    if candidate not in seen_works and len(works)<self.max_links:
                        seen_works.add(candidate)
                        works.append(candidate)
                for candidate in additional:
                    try:
                        candidate = _normalize(candidate)
                    except ValueError:
                        continue
                    if urlsplit(candidate).hostname == urlsplit(origin).hostname and candidate not in visited and candidate not in pages:
                        pages.append(candidate)
            found = len(works)
            for page in works:
                if self.worker.stop_event.is_set() or created>=self.max_new:
                    break
                # Skip existing content (including published work), never rewrite rights.
                if self.db.single("aseel_movies", {"select":"id", "source_page_url":"eq."+page}):
                    continue
                if self.db.single("aseel_series", {"select":"id", "source_page_url":"eq."+page}):
                    continue
                try:
                    cat = self.parse_work(page,client,kind=feed["kind"],max_seasons=3,
                                          max_episodes=30,max_pages=16)
                    if cat.kind not in ("movie","series") or (
                        feed["kind"]!="auto" and cat.kind!=feed["kind"]
                    ):
                        continue
                    # Reject a listing accidentally returned as a "work".
                    if not cat.title or urlsplit(cat.url).hostname != urlsplit(origin).hostname:
                        continue
                    table = "aseel_movies" if cat.kind=="movie" else "aseel_series"
                    if self.db.single(table, {"select":"id","source_page_url":"eq."+cat.url}):
                        continue
                    normalized_title=content_title(cat.title,cat.url,fallback="") or cat.title
                    if self.db.single(table, {"select":"id","title_ar":"eq."+normalized_title}):
                        continue
                    # The frozen importer creates draft/pending-rights records only.
                    result = self.save_work(cat,self.db,publish=False,rights=False)
                    self.worker.remember_saved(cat,result)
                    created += 1
                    self.worker.queue.event("new_work",
                        "اكتُشف عمل جديد وحُفظ كمسودة للمراجعة", table, result.get("work_id"))
                except Exception:
                    failed += 1
                    # One malformed listing item must not stop the remaining items.
                    continue
            self.db.patch(FEED_TABLE,identifier,{
                "last_scan":_instant(now),"next_scan":_instant(now+interval),
                "last_discovered":found,"last_created":created,
                "failures":0,"last_error":("" if not failed else
                         f"تعذّر تحليل {failed} عنصرًا؛ استمرت بقية أعمال الفهرسة"),
                "updated_at":_instant(now)
            })
            self.last_success=now
            self.last_error=""
            self.worker.queue.event("feed_scanned",
                f"فحص قائمة محتوى: {found} مرشح، {created} عمل جديد محفوظ كمسودة")
        except Exception as exc:
            count=int(feed.get("failures") or 0)+1
            backoff=min(interval,max(300,60*(2**min(count,7))))
            message=safe_error(exc)
            self.db.patch(FEED_TABLE,identifier,{
                "next_scan":_instant(now+backoff),"failures":count,
                "last_error":message[:220],"updated_at":_instant(now)
            })
            self.last_error=message
            self.worker.queue.event("feed_error","تعذّر فحص قائمة المحتوى: "+message[:160])
        return {"discovered":found,"created":created,"failed":failed}
