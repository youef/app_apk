"""Search Al Ezz's own titles and registered source feeds without touching extraction.

Read-only title discovery; requesting renewal only schedules the legacy
AutoSync worker. This module never downloads or resolves stream media.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import unquote, urljoin, urlsplit
from uuid import UUID

from alezz_fetchv_importer import SourceClient, public_url
from library_sync import canonical, extract_listing

TABLES = {"movie": "aseel_movies", "series": "aseel_series"}
PREFIXES = re.compile(r"^(?:(?:فيلم|مسلسل|movie|film|series|tv)\s+)+", re.I)


def normalized_title(value):
    value = unicodedata.normalize("NFKC", str(value or "")).casefold().strip()
    value = re.sub(r"[\u064b-\u065f\u0670]", "", value)
    value = value.translate(str.maketrans({"أ":"ا","إ":"ا","آ":"ا","ى":"ي","ـ":""}))
    value = re.sub(r"[^a-z0-9\u0600-\u06ff\s-]", " ", value)
    value = PREFIXES.sub("", " ".join(value.split()))
    return " ".join(value.split())


def search_term(value):
    raw = str(value or "").strip()
    if len(raw) > 120:
        raise ValueError("اسم الفيلم أو المسلسل طويل جدًا")
    cleaned = normalized_title(raw)
    if len(cleaned) < 2:
        raise ValueError("اكتب حرفين على الأقل من اسم الفيلم أو المسلسل")
    return cleaned


def relevance(needle, title):
    value = normalized_title(title)
    if not value:
        return 0
    if value == needle:
        return 100
    if value.startswith(needle):
        return 85
    if needle in value:
        return 70
    tokens = needle.split()
    if len(tokens) > 1 and all(token in value for token in tokens):
        return 58
    return 0


def _source_result(row, kind, score):
    source_url = row.get("source_page_url") or ""
    try:
        source_url = public_url(source_url) if source_url else ""
    except ValueError:
        source_url = ""
    return {
        "id": str(row["id"]), "kind": kind, "title": row.get("title_ar") or "",
        "original_title": row.get("title_original") or "",
        "source_url": source_url, "has_source": bool(source_url),
        "source": "library", "score": score,
    }


def _rows(db, table, field, term):
    # All characters except letters, digits, spaces and hyphens are stripped
    # above; the wildcard in these PostgREST filters is only server-authored.
    pattern = "ilike.*" + term.replace(" ", "*") + "*"
    return db.query(table, {
        "select": "id,title_ar,title_original,source_page_url",
        field: pattern, "limit": "35",
    })


def search_library(db, query, kind="auto"):
    needle = search_term(query)
    if kind not in ("auto", "movie", "series"):
        raise ValueError("نوع العمل غير معروف")
    kinds = [kind] if kind != "auto" else ["movie", "series"]
    results = {}
    for content_kind in kinds:
        table = TABLES[content_kind]
        # Search both Arabic and original titles. The two requests also allow
        # title-only lookup without fetching an entire private library.
        for field in ("title_ar", "title_original"):
            for row in _rows(db, table, field, needle):
                score = max(relevance(needle, row.get("title_ar")),
                            relevance(needle, row.get("title_original")))
                # Arabic hamza normalization may differ from the DB collation.
                if not score:
                    score = 45
                key = (content_kind, str(row["id"]))
                item = _source_result(row, content_kind, score)
                if key not in results or item["score"] > results[key]["score"]:
                    results[key] = item
    return sorted(results.values(), key=lambda r: (-r["score"], r["title"]))[:35]


def search_feeds(db, query, kind="auto", *, client_factory=SourceClient,
                 listing_parser=extract_listing):
    """Bounded on-demand lookup in already registered, enabled source listings.

    No arbitrary web search and no guessed episode links. Only original work
    page links whose visible listing text or URL matches the requested title.
    """
    needle = search_term(query)
    feeds = db.query("aseel_studio_discovery_feeds", {
        "select": "source_url,kind,enabled", "enabled": "eq.true", "limit": "4"
    })
    results = {}
    for feed in feeds[:4]:
        feed_kind = feed.get("kind") or "auto"
        if kind != "auto" and feed_kind not in ("auto", kind):
            continue
        try:
            root = canonical(public_url(feed["source_url"]))
            page, typ, html = client_factory(timeout=8).get(root)
            if "html" not in typ.lower() and "<html" not in html[:1000].lower():
                continue
            links, _ = listing_parser(html, page, root, feed_kind)
            host = urlsplit(root).hostname
            # Visible link labels are considered only for URLs already
            # recognized by the existing catalogue listing parser.
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, "html.parser")
            captions = {}
            for anchor in soup.select("a[href]")[:900]:
                raw = anchor.get("href")
                if not raw:
                    continue
                try:
                    address = canonical(urljoin(page, raw))
                    if urlsplit(address).hostname != host:
                        continue
                except (ValueError, TypeError):
                    continue
                label = (anchor.get("title") or "") + " " + anchor.get_text(" ", strip=True)
                if label.strip():
                    captions[address] = label[:250]
            for address in links[:120]:
                try:
                    address = canonical(public_url(address))
                except ValueError:
                    continue
                if urlsplit(address).hostname != host:
                    continue
                slug = unquote(urlsplit(address).path).replace("-", " ").replace("_", " ")
                label = captions.get(address) or slug
                score = max(relevance(needle, label), relevance(needle, slug))
                if score < 58:
                    continue
                path = urlsplit(address).path.lower()
                inferred = ("movie" if any(x in path for x in ("/movie", "/film", "/فيلم"))
                            else "series" if any(x in path for x in ("/series", "/show", "/مسلسل"))
                            else feed_kind)
                if inferred == "auto":
                    continue
                if kind != "auto" and inferred != kind:
                    continue
                results[address] = {
                    "id": "", "kind": inferred, "title": label.strip()[:250],
                    "original_title": "", "source_url": address,
                    "has_source": True, "source": "feed", "score": score,
                }
        except Exception:
            # A broken source does not hide working matches from other feeds.
            continue
    return sorted(results.values(), key=lambda r: (-r["score"], r["title"]))[:20]


def find_titles(db, query, kind="auto", include_feeds=False):
    matches = search_library(db, query, kind)
    if include_feeds:
        fresh = search_feeds(db, query, kind)
        known_pages = {row["source_url"] for row in matches if row["source_url"]}
        matches += [row for row in fresh if row["source_url"] not in known_pages]
    return {"results": matches[:50], "count": len(matches[:50]),
            "searched_feeds": bool(include_feeds)}


def queue_title_refresh(db, worker, table, identifier, max_episodes=900):
    """Schedule an existing work and its saved episodes for legacy extraction.

    No direct playback or media replacement happens in this request. The
    asynchronous AutoSync worker performs any subsequent source verification.
    """
    from auto_sync import target_key
    table, identifier = target_key(table, identifier)
    if table not in ("aseel_movies", "aseel_series"):
        raise ValueError("اختر فيلمًا أو مسلسلًا من نتائج البحث")
    UUID(identifier)
    # A series has no stream_url/stream_variants columns: only its
    # episodes store playback links. Keep the movie projection unchanged.
    fields = ("id,title_ar,source_page_url"
              if table == "aseel_series"
              else "id,title_ar,source_page_url,stream_url,stream_variants")
    item = db.single(table, {
        "select": fields,
        "id": "eq." + identifier,
    })
    if not item:
        raise ValueError("العمل غير موجود أو غير مسموح بالوصول إليه")
    source = item.get("source_page_url") or ""
    if source:
        source = public_url(source)
    else:
        existing = worker.queue.sources(table, identifier)
        if not any(x["kind"] == "original" for x in existing):
            raise ValueError("هذا العمل لا يحتوي صفحة مصدر أصلية. أضف الرابط من إدارة المصادر أولًا")
    worker.queue.ingest(table, item)
    if source:
        worker.queue.remember(table, identifier, {"url":source, "kind":"original"})

    targets = [(table, identifier)]
    existing_episodes = 0
    missing_pages = 0
    truncated = False
    if table == "aseel_series":
        seasons = []
        for offset in range(0, 400, 100):
            rows = db.query("aseel_seasons", {
                "select": "id", "series_id": "eq." + identifier,
                "limit": "100", "offset": str(offset),
            })
            seasons += rows
            if len(rows) < 100:
                break
        else:
            truncated = True
        for season in seasons:
            for offset in range(0, max_episodes, 100):
                if existing_episodes >= max_episodes:
                    truncated = True
                    break
                fetch_limit = min(100, max_episodes-existing_episodes)
                rows = db.query("aseel_episodes", {
                    "select": "id,title_ar,source_page_url,stream_url,stream_variants",
                    "season_id": "eq." + str(season["id"]),
                    "limit": str(fetch_limit),
                    "offset": str(offset),
                })
                for episode in rows:
                    if not episode.get("source_page_url"):
                        old_sources = worker.queue.sources("aseel_episodes", episode["id"])
                        if not any(x["kind"] == "original" for x in old_sources):
                            missing_pages += 1
                            continue
                    worker.queue.ingest("aseel_episodes", episode)
                    if episode.get("source_page_url"):
                        worker.queue.remember("aseel_episodes", episode["id"], {
                            "url":public_url(episode["source_page_url"]), "kind":"original"
                        })
                    targets.append(("aseel_episodes", str(episode["id"])))
                    existing_episodes += 1
                if len(rows) < fetch_limit:
                    break
            if existing_episodes >= max_episodes:
                truncated = True
                break

    # One SQLite transaction schedules the work as a batch; it cannot alter
    # publication rights, titles, or primary stream URLs.
    with worker.queue.db() as conn:
        conn.executemany(
            "update auto_jobs set next_check=0,next_refresh=0 "
            "where table_name=? and target_id=?", targets
        )
    worker.queue.event("title_refresh",
                       "تجديد عمل باسم: " + str(item.get("title_ar") or "عمل")[:90] +
                       "، وعدد الحلقات المجدولة: " + str(len(targets)-1),
                       table, identifier)
    worker.wake_event.set()
    return {
        "queued": len(targets), "episodes": len(targets)-1,
        "missing_episode_sources": missing_pages, "partial": truncated,
        "worker_enabled": bool(worker.enabled),
        "worker_connected": bool(worker.db is not None),
        "title": str(item.get("title_ar") or ""),
        "source_url": source,
    }
