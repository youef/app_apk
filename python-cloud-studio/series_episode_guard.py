"""Scope series metadata/episode discovery to the requested work.

Independent from FetchV, Chromium, HLS parsing and media verification.
In particular, ignore the unrelated/recent posts tabs on episode pages.
"""
from __future__ import annotations

import html
import re
import unicodedata
from urllib.parse import unquote, urlsplit

from title_cleaner import content_description, content_title


EP_END = re.compile(
    r"(?:\b(?:الحلقة|الحلقه|episode|ep)\s*[-:#]?\s*[\d٠-٩]+"
    r"|\bS\d{1,3}\s*E\d{1,4})", re.I,
)
SERIES_MARKER = re.compile(r"(?:^|\s)(?:مسلسل|series|tv\s*series)\s+", re.I)
NAME_BEFORE_EP = re.compile(
    r"(?:^|\s)(?:مسلسل|series|tv\s*series)\s+(.+?)\s+"
    r"(?:الحلقة|الحلقه|episode|ep)\s*[-:#]?\s*[\d٠-٩]+", re.I,
)
NAME_BEFORE_SEASON = re.compile(
    r"(?:^|\s)(?:مسلسل|series|tv\s*series)\s+(.+?)\s+"
    r"(?:الموسم|season)\s*[-:#]?\s*[\d٠-٩]+", re.I,
)


def _text(value: str) -> str:
    value = html.unescape(str(value or ""))
    for _ in range(2):
        value = unquote(value)
    value = value.replace("_", " ").replace("-", " ").replace("/", " ")
    return " ".join(value.split())


def _key(value: str) -> str:
    value = unicodedata.normalize("NFKC", _text(value)).casefold()
    value = re.sub(r"[\u064b-\u065f\u0670\u0640]", "", value)
    value = value.translate(str.maketrans({
        "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه",
        "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5",
        "٦":"6","٧":"7","٨":"8","٩":"9",
    }))
    value = re.sub(r"[^a-z0-9\u0600-\u06ff ]", " ", value)
    value = re.sub(r"^(?:مسلسل|series|tv series)\s+", "", value).strip()
    value = re.sub(r"\b(?:مترجم|مدبلج|كامل|كامله|hd|fhd)\b", "", value).strip()
    return " ".join(value.split())


def _explicit_name(value: str) -> str:
    """Identify a named work in a full episode/season link, if available."""
    value = _text(value)
    for matcher in (NAME_BEFORE_EP, NAME_BEFORE_SEASON):
        result = matcher.search(value)
        if result:
            return _key(result.group(1))
    # A plain 'مسلسل العمل' link is a series identity too, but avoid
    # treating verbose unrelated link text as an identity.
    if SERIES_MARKER.match(value) and not EP_END.search(value):
        match = SERIES_MARKER.match(value)
        if match:
            return _key(value[match.end():])
    return ""


def _url_name(url: str) -> str:
    """Read the work's identity from an episode slug, never from site navigation."""
    path = urlsplit(str(url)).path
    slug = path.rstrip("/").split("/")[-1]
    named = _explicit_name(slug)
    if named:
        return named
    # Some sites omit "مسلسل" in their episode permalinks. Only a URL in
    # the episode namespace may supply an unprefixed work title.
    if not re.search(r"/episodes?/", path, re.I):
        return ""
    stem = _text(slug)
    if not EP_END.search(stem):
        return ""
    prefix = re.split(EP_END, stem, maxsplit=1)[0].strip()
    key = _key(prefix)
    return key if len(key) >= 4 and key not in ("episode", "ep", "الحلقه") else ""


def _series_title_from_episode(value: str, url: str, site_name: str) -> str:
    clean = content_title(value, url, site_name)
    clean = re.split(EP_END, clean, maxsplit=1)[0]
    clean = re.sub(r"\s*(?:الموسم|season)\s*[\d٠-٩]+\s*$", "", clean, flags=re.I)
    return clean.strip(" -|:")


class SeriesEpisodeGuard:
    def __init__(self, source_url: str, title: str, soup, site_name: str = ""):
        self.source_url = source_url
        self.host = urlsplit(source_url).hostname
        self.is_episode_page = "/episode/" in urlsplit(source_url).path.lower() or bool(EP_END.search(_text(source_url)))
        self.site_name = site_name
        parts = urlsplit(source_url).path.strip("/").split("/")
        # A series detail route has its own namespace; generic "episode-2"
        # children must stay beneath it, not another show's directory.
        self.series_root_path = (
            "/" + "/".join(parts[:2]) + "/"
            if not self.is_episode_page and len(parts) >= 2
            and parts[0].lower() in ("series", "serial", "shows", "show", "tvseries")
            else ""
        )
        self.series_title = title
        self.series_story = ""
        # The requested URL is authoritative when its slug explicitly names
        # a series. Never let an unrelated JSON-LD card or sidebar replace it.
        source_key = _url_name(source_url) if self.is_episode_page else ""
        link = soup.select_one(
            ".singleSeries .info h2 a[href*='/series/'],"
            ".singleSeries h2 a[href*='/series/']"
        )
        linked_title = content_title(link.get_text(" ", strip=True), source_url, site_name) if link else ""
        linked_is_same = bool(linked_title and (not source_key or _key(linked_title) == source_key))
        if linked_is_same:
            self.series_title = linked_title
        elif self.is_episode_page:
            candidate = _series_title_from_episode(title, source_url, site_name)
            if source_key and _key(candidate) != source_key:
                slug = _text(urlsplit(source_url).path.rstrip("/").split("/")[-1])
                candidate = _series_title_from_episode(slug, source_url, site_name)
            if candidate:
                self.series_title = candidate
        self.key = source_key or _key(self.series_title)
        if self.key in ("مسلسل", "series", "tv series") and self.series_root_path:
            self.key = _key(parts[1])
        if self.is_episode_page:
            story = soup.select_one(".singleSeries .series-story")
            if story:
                self.series_story = content_description(story.get_text(" ", strip=True), source_url, site_name)

    def matches(self, url: str, label: str, *, episode_group: bool = False, data: dict | None = None) -> bool:
        """No mixed series, no cross-site episode pages, no unscoped suggestions."""
        if urlsplit(url).hostname != self.host or not self.key:
            return False
        if not (urlsplit(url).path.lower().find("episode") >= 0
                or EP_END.search(_text(url))
                or EP_END.search(_text(label))
                or (data and data.get("episodeNumber"))):
            return False
        if data:
            parent = data.get("partOfSeries") or data.get("isPartOf")
            if isinstance(parent, dict):
                parent_name = _key(parent.get("name") or parent.get("headline") or "")
                if parent_name and parent_name != self.key:
                    return False
        names = [_url_name(url), _explicit_name(label)]
        if any(name and name != self.key for name in names):
            return False
        if any(name == self.key for name in names):
            return True
        if url.rstrip("/") == self.source_url.rstrip("/"):
            return True
        # Ambiguous /episode-2 links are not proof of association, even when
        # found inside an "episodes" tab (a tab can contain recommendations).
        # Only a child of a series-specific route can be accepted unnamed.
        return bool(self.series_root_path and
                    urlsplit(url).path.startswith(self.series_root_path))

    def matches_page(self, url: str) -> bool:
        if urlsplit(url).hostname != self.host:
            return False
        named = _url_name(url)
        if named:
            return named == self.key
        if self.series_root_path and urlsplit(url).path.startswith(self.series_root_path):
            return True
        # A pagination request must remain under this work's own detail URL.
        # Do not crawl unrelated /page/2 or generic category/season pages.
        original = urlsplit(self.source_url).path.rstrip("/")
        target = urlsplit(url).path.rstrip("/")
        return (target == original or
                bool(re.fullmatch(re.escape(original) + r"/(?:page|paged)/\d+", target, re.I)))

    def candidate_links(self, soup):
        panel = soup.select_one("#episodes-tab")
        if panel:
            # qrmzi and similar sites render recommendations in sibling tabs,
            # not in this panel; the old full-page scan mixed their episodes.
            return panel.select("a[href]"), True
        return soup.select("a[href]"), False

    def can_crawl_season(self, url: str, label: str, *, episode_group: bool) -> bool:
        if not self.matches_page(url):
            return False
        described = _explicit_name(label)
        if described and described != self.key:
            return False
        return bool(episode_group or not self.is_episode_page)
