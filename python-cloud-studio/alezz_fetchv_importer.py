#!/usr/bin/env python3
"""Al Ezz TV: import series/movie metadata and verified HTTPS media into Supabase.

FetchV is a local browser extension with no publicly documented automation API.
This importer does not control the FetchV extension; it accepts manually exported
media links and can optionally detect standard media via a fresh Edge session.
It does not bypass DRM, paywalls, login screens or streaming site protections.
"""
from __future__ import annotations

import argparse
import getpass
from dataclasses import dataclass, asdict, field
import ipaddress
import json
import os
import re
import socket
import sys
import time
import threading
from urllib.parse import urljoin, urlsplit
from pathlib import Path
from title_cleaner import content_title

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError as exc:
    raise SystemExit("Install dependencies: python -m pip install -r requirements.txt") from exc

MEDIA_EXT = re.compile(r"\.(?:mp4|m4v|webm|m3u8|mpd)(?:[?#]|$)", re.I)
WEB_MEDIA = re.compile(r"\.(?:mp4|m4v|webm|m3u8|mpd)(?:[?#]|$)", re.I)
EP_RE = re.compile(r"(?:\bS(\d{1,2})[.\-_ ]?E(\d{1,3})\b|(?:الحلقة|الحلقه|episode|ep)[\s:_#-]*(\d{1,3}))", re.I)
SEASON_RE = re.compile(r"(?:الموسم|season)[\s:_#-]*(\d{1,2})", re.I)
GENRE_MAP = {"دراما":"drama", "درامي":"drama", "رومانسي":"romance", "رومانسية":"romance",
             "كوميديا":"comedy", "أكشن":"action", "اكشن":"action", "إثارة":"thriller",
             "تشويق":"thriller", "غموض":"mystery", "أنمي":"anime", "كرتون":"animation",
             "رعب":"horror", "جريمة":"crime", "وثائقي":"documentary", "عائلي":"family"}


@dataclass
class Episode:
    season: int
    number: int
    title: str
    page_url: str
    description: str = ""
    poster_url: str = ""
    media_url: str = ""
    verified: bool = False
    error: str = ""
    sources: list[dict] = field(default_factory=list)
    source_pages: list[str] = field(default_factory=list)


@dataclass
class Catalogue:
    kind: str
    title: str
    url: str
    description: str = ""
    poster_url: str = ""
    backdrop_url: str = ""
    original_title: str = ""
    year: int | None = None
    country: str = ""
    language: str = ""
    genres: list[str] = field(default_factory=list)
    metadata_sources: list[str] = field(default_factory=list)
    media_url: str = ""
    verified: bool = False
    episodes: list[Episode] = field(default_factory=list)
    discovery_warnings: list[str] = field(default_factory=list)
    error: str = ""
    sources: list[dict] = field(default_factory=list)
    source_pages: list[str] = field(default_factory=list)


def clean(v: object, limit: int = 2000) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:limit]


def public_url(value: str) -> str:
    """Basic SSRF guard on all crawler URLs (not a DNS-pinned HTTP client)."""
    try:
        u = urlsplit(value)
        host = (u.hostname or "").lower().strip(".")
        if (u.scheme != "https" or not host or u.username or u.password or u.port not in (None, 443)
                or len(value) > 2048 or host.endswith((".local", ".internal", ".lan", ".test", ".invalid", ".onion"))):
            raise ValueError("Use a public HTTPS hostname")
        if host == "localhost" or "." not in host:
            raise ValueError("Nonpublic hostname")
        try:
            ipaddress.ip_address(host)
            raise ValueError("IP-literal links are not accepted")
        except ValueError as exc:
            if "IP-literal" in str(exc):
                raise
        return value
    except (TypeError, AttributeError) as exc:
        raise ValueError("Invalid URL") from exc


def check_dns(url: str) -> None:
    host = urlsplit(public_url(url)).hostname
    try:
        addresses = {str(item[4][0]) for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    except OSError as exc:
        raise ValueError("Host did not resolve") from exc
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError("Private or nonpublic DNS address refused")


class SourceConnectionError(ConnectionError):
    """A source page could not be read after bounded retries."""


class SourceClient:
    def __init__(self, timeout: float = 15):
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers.update({"User-Agent": "AlEzzTV-MetadataImporter/1.0", "Accept": "text/html,application/json,*/*"})
        self.timeout = timeout
        self.deadline = None
        self.retries = 3

    def request_timeout(self):
        if self.deadline is None:
            return self.timeout
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('انتهت مهلة فحص المصدر؛ سيُعاد الفحص تلقائيًا')
        return min(self.timeout, remaining)

    def get(self, url: str, max_size: int = 1_500_000):
        for attempt in range(self.retries):
            try:
                return self._get_page(url, max_size)
            except requests.exceptions.SSLError:
                raise
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout,
                    requests.exceptions.ChunkedEncodingError, ConnectionResetError):
                if attempt == self.retries - 1:
                    raise SourceConnectionError(
                        'انقطع الاتصال بالموقع المصدر خلال مهلة الفحص.'
                    ) from None
                time.sleep(0.4 * 2**attempt)

    def _get_page(self, url: str, max_size: int):
        for _ in range(5):
            check_dns(url)
            with self.session.get(url, timeout=self.request_timeout(), allow_redirects=False, stream=True) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    if not location:
                        raise ValueError("Redirect missing Location")
                    url = urljoin(url, location)
                    continue
                response.raise_for_status()
                chunks, total = [], 0
                for chunk in response.iter_content(64 * 1024):
                    self.request_timeout()
                    total += len(chunk)
                    if total > max_size:
                        raise ValueError("Page exceeds safe size limit")
                    chunks.append(chunk)
                data = b"".join(chunks)
                return url, response.headers.get("Content-Type", ""), data.decode(response.encoding or "utf-8", errors="replace")
        raise ValueError("Too many redirects")

    def sample(self, url: str, size: int = 8192) -> tuple[str, str, bytes]:
        """Read a bounded prefix, validating every redirect before requesting it."""
        for _ in range(5):
            check_dns(url)
            with self.session.get(url, headers={"Range": f"bytes=0-{size-1}", "Accept": "*/*"},
                                  timeout=self.request_timeout(), allow_redirects=False, stream=True) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    if not location: raise ValueError("Redirect missing Location")
                    url = urljoin(url, location)
                    continue
                response.raise_for_status()
                data = bytearray()
                for chunk in response.iter_content(min(size, 8192)):
                    self.request_timeout()
                    data.extend(chunk[:size-len(data)])
                    if len(data) >= size: break
                return url, response.headers.get("Content-Type", "").lower(), bytes(data)
        raise ValueError("Too many redirects")

    def media_verified(self, url: str) -> tuple[bool, str]:
        # Signed video endpoints often have no filename extension. A public
        # HTTPS URL may be probed, but verification still requires actual
        # HLS playlist/segment bytes or MP4/WebM container magic.
        try:
            public_url(url)
        except (ValueError, TypeError, AttributeError):
            return False, "Unsupported or nonpublic video URL"
        try:
            # A 200 response or a MIME type alone is not proof of playable media.
            for depth in range(3):
                final, ctype, sample = self.sample(url, 65536)
                if not sample: return False, "Empty response"
                if "html" in ctype or sample.lstrip().lower().startswith((b"<!doctype html", b"<html")):
                    return False, "Returned HTML, not a video stream"
                if b"#EXTM3U" in sample[:100]:
                    manifest = sample.decode("utf-8-sig", errors="replace")
                    if re.search(r'METHOD=(?:SAMPLE-AES|SAMPLE-AES-CTR)|KEYFORMAT="(?!identity)', manifest):
                        return False, "Protected HLS is not supported"
                    links = [line.strip() for line in manifest.splitlines()
                             if line.strip() and not line.startswith('#')]
                    if not links: return False, "HLS has no playlist or segment"
                    url = urljoin(final, links[0])
                    if '#EXT-X-STREAM-INF' in manifest:
                        continue
                    _, segment_type, segment = self.sample(url)
                    valid = (len(segment)>188 and segment[0] == segment[188] == 0x47) or any(
                        marker in segment[:64] for marker in (b'ftyp',b'styp',b'moof',b'mdat'))
                    # fMP4 playlists can use EXT-X-MAP; check the init segment too.
                    if not valid and '#EXT-X-MAP:' in manifest:
                        init = re.search(r'#EXT-X-MAP:.*?URI="([^"]+)"', manifest)
                        if init:
                            _, _, header = self.sample(urljoin(final, init.group(1)))
                            valid = bool(segment) and b'ftyp' in header[:32] and any(
                                marker in segment[:64] for marker in (b'styp',b'moof',b'mdat')) and 'html' not in segment_type
                    return (True, "HLS playlist and segment respond") if valid else (False, "HLS segment is unavailable or invalid")
                if urlsplit(final).path.lower().endswith('.mpd'):
                    text = sample.decode('utf-8-sig', errors='replace')
                    if '<MPD' not in text:
                        return False, 'DASH MPD manifest not detected'
                    if '<ContentProtection' in text:
                        return False, 'DRM-protected DASH requires the official licensed player'
                    # Checking only the XML playlist is not proof of playable segments.
                    return False, 'DASH manifest responds; verify playback inside the device'
                if '.m3u8' in urlsplit(final).path.lower(): return False, "HLS manifest not detected"
                valid = b'ftyp' in sample[:32] or sample.startswith(b'\x1aE\xdf\xa3')
                return (True, "Media header responds") if valid else (False, "Video header not detected")
            return False, "HLS nesting limit exceeded"
        except (requests.RequestException, ValueError, OSError, StopIteration) as exc:
            return False, str(exc)[:120]


def json_nodes(soup: BeautifulSoup) -> list[dict]:
    result: list[dict] = []
    def walk(obj, depth=0):
        if depth > 8:
            return
        if isinstance(obj, list):
            for x in obj: walk(x, depth + 1)
        if isinstance(obj, dict):
            result.append(obj)
            for key in ("@graph", "hasPart", "episode", "episodes", "season", "containsSeason", "partOfSeries", "mainEntity"):
                if key in obj:
                    walk(obj[key], depth + 1)
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            walk(json.loads(tag.string or tag.get_text()))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    return result


def field_of(node: dict, *names: str) -> str:
    for name in names:
        x = node.get(name)
        if isinstance(x, str) and x.strip():
            return clean(x)
        if isinstance(x, dict):
            val = x.get("url") or x.get("contentUrl") or x.get("name")
            if isinstance(val, str): return clean(val)
        if isinstance(x, list):
            for el in x:
                if isinstance(el, str):return clean(el)
                if isinstance(el, dict) and isinstance(el.get("url"), str):return clean(el["url"])
    return ""


def absolutize(base: str, value: str) -> str:
    if not value:return ""
    u = urljoin(base, value)
    try:return public_url(u)
    except ValueError:return ""


def episode_numbers(value: str) -> tuple[int, int] | None:
    m = EP_RE.search(value)
    if not m:return None
    season = SEASON_RE.search(value)
    season_number = int(m.group(1) or (season.group(1) if season else 1))
    return season_number, int(m.group(2) or m.group(3))


def belongs_to_series_episode(series_url: str, candidate_url: str, label: str = "") -> bool:
    """Avoid importing unrelated 'recommended episode' cards into a series.

    On sites with a descriptive /series/<slug> path, the corresponding episode
    link normally contains the same distinctive title words in its URL or
    link text. Generic numeric series IDs and short titles remain compatible.
    """
    from urllib.parse import unquote
    source, target = urlsplit(series_url), urlsplit(candidate_url)
    if source.hostname != target.hostname or target.scheme != "https":
        return False
    source_path = unquote(source.path).strip("/")
    if not re.search(r"(?:^|/)(?:series|tv-series|shows|مسلسلات)(?:/|$)", source_path, re.I):
        return True
    slug = source_path.rsplit("/", 1)[-1]
    normalized = lambda value: re.sub(r"[^\w\u0600-\u06ff]+", " ", unquote(value).casefold())
    ignored = {"مسلسل", "مسلسلات", "series", "tv", "show", "season", "الموسم", "حلقة", "الحلقة"}
    title_words = [word for word in normalized(slug).split()
                   if len(word) >= 4 and word not in ignored and
                   not re.fullmatch(r"(?:19|20)\d{2}|\d+", word)]
    if not title_words:
        return True  # Generic ID/short title: existing discovery behavior.
    text = normalized(target.path + " " + label)
    return all(re.search(r"(?<!\w)" + re.escape(word) + r"(?!\w)", text)
               for word in title_words)


def pull_html(url: str, client: SourceClient, kind: str="auto", max_seasons: int=100,
              max_episodes: int=5000, max_pages: int=250,
              resume_progress: dict | None=None, progress_hook=None) -> Catalogue:
    final, typ, html = client.get(url)
    if "html" not in typ.lower() and "<html" not in html[:1000].lower():
        raise ValueError("Source must be a public HTML page")
    soup = BeautifulSoup(html, "html.parser")
    nodes = json_nodes(soup)
    candidates = [n for n in nodes if "tvseries" in str(n.get("@type", "")).lower()]
    candidates += [n for n in nodes if "movie" in str(n.get("@type", "")).lower()]
    main = candidates[0] if candidates else {}
    def meta(name: str) -> str:
        t = soup.select_one(f'meta[property="{name}"],meta[name="{name}"]')
        return clean(t.get("content", "") if t else "")
    site_name = meta('og:site_name')
    heading = soup.select_one('h1.entry-title,h1[itemprop="name"],h1')
    title = next((title for value in (field_of(main, 'name', 'headline'),
                 heading.get_text(' ', strip=True) if heading else '', meta('og:title'),
                 soup.title.get_text() if soup.title else '')
                 if (title := content_title(value, final, site_name))), '')
    description = field_of(main, "description") or meta("og:description") or meta("description")
    if not description:
        story=soup.select_one('[itemprop="description"], .story, .synopsis, .plot')
        if story:description=clean(story.get_text(' ',strip=True),2000)
    poster = absolutize(final, field_of(main, "image", "thumbnailUrl") or meta("og:image"))
    year_match = re.search(r"(?:19|20)\d{2}", field_of(main,"datePublished","startDate") or "")
    year = int(year_match.group()) if year_match else None
    if year is None:
        fallback = meta("video:release_date") or meta("datePublished")
        match = re.search(r"(?:19|20)\d{2}", fallback)
        year = int(match.group()) if match else None
    detected_series = bool(any("tvseries" in str(n.get("@type", "")).lower() for n in nodes))
    detected_movie = bool(any("movie" in str(n.get("@type", "")).lower() for n in nodes))
    has_episode_links = any(episode_numbers(clean(a.get_text(" ",strip=True)) + " " + (a.get("href") or ""))
                            for a in soup.select("a[href]")[:400])
    detected = "series" if detected_series or (not detected_movie and has_episode_links) else "movie" if detected_movie else kind if kind != "auto" else "movie"
    title = re.sub(r"\s*[-–—|]\s*(?:موقع\s*)?(?:قرمزي|qrmzi)\s*$", "", title or "").strip()
    original=(field_of(main,"alternateName","originalTitle","originalName") or
              meta("og:original_title") or meta("originalTitle") or meta("original_name") or "")
    if not original:
        original_tag=soup.select_one('[itemprop="alternateName"], [itemprop="originalTitle"], .original-title, .original_name')
        if original_tag: original=clean(original_tag.get("content") or original_tag.get_text(" ",strip=True),250)
    if not original:
        # Original-language titles are sometimes explicitly introduced beside a localized title.
        txt=clean(soup.get_text(" ",strip=True),3500)
        m=re.search(r'(?:الاسم الأصلي|العنوان الأصلي|original title|original name)\s*[:：-]\s*([^|\n،]{3,100})',txt,re.I)
        if m: original=clean(m.group(1),250)
    if not original and re.search(r'[\u0600-\u06ff]',title):
        # Recognize bilingual titles explicitly shown in parentheses, e.g. القبيحة (Çirkin).
        original_match=re.search(r'\(([A-Za-zÀ-ž][A-Za-zÀ-ž .,:\'-]{2,70})\)',title)
        if original_match:original=clean(original_match.group(1),250)
    if not original and re.search(r'[\u0600-\u06ff]',title):
        # In Arabic synopses, a well-scoped original-title phrase is safer than
        # guessing the first Latin word (which might be HD, Netflix, etc.).
        hint=description[:1200]
        original_match=re.search(r'(?:الاسم\s*بالتركي|العنوان\s*التركي|بعنوان\s*|المسلسل\s*التركي[^.،]{0,65}?)\s*([A-ZÀ-Ž][A-Za-zÀ-ž\s]{3,45})(?=[\s،.؛]|$)',hint)
        if original_match:
            guess=clean(original_match.group(1),250)
            if guess.lower() not in ('hd','full hd','netflix'):original=guess
    if not year:
        m=re.search(r'(?<!\d)(?:19|20)\d{2}(?!\d)',title)
        if m:year=int(m.group())
    if not year:
        m=re.search(r'(?:سنة\s*(?:الإنتاج|الانتاج|العرض)|release\s*year|تاريخ\s*الإنتاج)\s*[:：-]?\s*((?:19|20)\d{2})',soup.get_text(' ',strip=True)[:4500],re.I)
        if m:year=int(m.group(1))
    if not poster:
        image=soup.select_one('[itemprop="image"], img.poster, .poster img, .cover img, img[itemprop="thumbnailUrl"]')
        if image:
            # Lazy images expose a GIF placeholder in src. Keep the full image,
            # and stay inside the work's cover rather than related-work cards.
            poster=absolutize(final,image.get("data-original") or image.get("data-src") or image.get("content") or image.get("src") or "")
    out = Catalogue(kind=detected, title=title or "بدون عنوان",url=final,description=description,
                    poster_url=poster,backdrop_url=poster,year=year,original_title=original)
    out.backdrop_url=absolutize(final,meta("og:image:secure_url") or meta("twitter:image")) or poster
    out.source_pages=list(dict.fromkeys([url,final]))
    genre=main.get("genre", [])
    if isinstance(genre,str):genre=[genre]
    out.genres=[GENRE_MAP.get(str(x).lower(),str(x).lower().replace(" ","_")) for x in genre if isinstance(x,str)][:10]
    if not out.genres:
        searchable = out.title + " " + out.description
        out.genres = list(dict.fromkeys(tag for text,tag in GENRE_MAP.items() if text in searchable))[:10]
    original_country = field_of(main, "countryOfOrigin", "country")
    countries={"turkey":"TR","türkiye":"TR","تركيا":"TR","egypt":"EG","مصر":"EG",
               "saudi arabia":"SA","السعودية":"SA","usa":"US","united states":"US",
               "india":"IN","الهند":"IN","korea":"KR","south korea":"KR"}
    out.country = countries.get(original_country.lower(), original_country.upper() if len(original_country)==2 else "")
    if not out.country:
        searchable=(out.title+" "+out.description).lower()
        indicators=[("TR",r"(?:تركي|تركية|turkish)"),("KR",r"(?:كوري|كورية|korean)"),
                    ("EG",r"(?:مصري|مصرية|egyptian)"),("SA",r"(?:سعودي|سعودية|saudi)"),
                    ("IN",r"(?:هندي|هندية|indian)"),("US",r"(?:أمريكي|أمريكية|american)")]
        for code,pattern in indicators:
            if re.search(pattern,searchable,re.I):out.country=code;break
    language=field_of(main,"inLanguage","language","originalLanguage") or meta("video:language")
    lang_names={"turkish":"tr","türkçe":"tr","تركي":"tr","العربية":"ar","arabic":"ar",
                "english":"en","الإنجليزية":"en","korean":"ko","japanese":"ja","hindi":"hi"}
    if re.fullmatch(r"[a-zA-Z]{2,3}",language):out.language=language.lower()
    else:out.language=lang_names.get(language.casefold(),"")
    if not out.language and out.country=="TR" and re.search(r"(?:مسلسل|turkish|التركي)",out.title+" "+out.description,re.I):
        # A Turkish original can have an Arabic site UI; never assume Arabic is source language.
        out.language="tr"
    if out.kind=="movie":
        streams=find_static_media(soup,final,nodes)
        if streams:out.media_url=streams[0]
        return out

    from concurrent.futures import ThreadPoolExecutor, as_completed
    from urllib.parse import parse_qsl
    resume_progress=resume_progress or {}
    # A fast first pass might inspect only three pages. Keep unvisited page
    # links across batches so continuation does not silently discard season
    # pagination when max_pages is small.
    seen_pages: set[str] = {final.rstrip('/')} | set(resume_progress.get('seen_pages',[])[:5000])
    queued: list[str] = list(resume_progress.get('queued',[])[:1200])
    episode_map: dict[tuple[int,int],Episode] = {}
    in_flight: set[str] = set()
    skipped_pages=0
    for row in resume_progress.get('episodes',[])[:max_episodes]:
        try:
            ep=Episode(**row)
            episode_map[(ep.season,ep.number)]=ep
        except (ValueError,TypeError):continue
    def checkpoint():
        if progress_hook:
            progress_hook({'seen_pages':list(seen_pages), 'queued':list(in_flight)+queued[:],
                           'episodes':[asdict(e) for e in episode_map.values()]})
    root_host=urlsplit(final).hostname
    exploration_seeded=False
    def add_episode(link: str, label: str, data: dict | None=None, display_title: str=""):
        parsed=episode_numbers(label)
        if not parsed and data:
            try:
                number=int(data.get("episodeNumber",0))
                season=data.get("partOfSeason",{})
                if isinstance(season,dict):season=season.get("seasonNumber",1)
                parsed=(int(season or 1),number) if number>0 else None
            except (TypeError,ValueError):pass
        if not parsed or parsed[1]<1 or parsed[1]>10000 or parsed[0]<1 or parsed[0]>200:return
        link=absolutize(final,link)
        if not link or not belongs_to_series_episode(final,link,display_title or label):
            return
        key=parsed
        if key not in episode_map:
            ep=Episode(parsed[0],parsed[1],content_title(display_title or label, final, site_name,
                       fallback='الحلقة '+str(parsed[1])),link)
            if data:
                ep.description=field_of(data,"description")
                ep.poster_url=absolutize(final,field_of(data,"image","thumbnailUrl"))
                v=field_of(data,"contentUrl","embedUrl")
                ep.media_url=absolutize(final,v) if MEDIA_EXT.search(v) else ""
            episode_map[key]=ep
        else:
            prior=episode_map[key]
            if prior.page_url==final and link!=final:prior.page_url=link
            if data:
                if not prior.description:prior.description=field_of(data,"description")
                if not prior.poster_url:prior.poster_url=absolutize(final,field_of(data,"image","thumbnailUrl"))
    def queue_page(link,base):
        nonlocal skipped_pages
        uri=absolutize(base,link)
        if not uri or urlsplit(uri).hostname != root_host or uri.rstrip('/') in seen_pages or uri in queued or uri in in_flight:return
        # max_pages is a per-batch fetch budget, NOT the queue capacity.
        # Previously pages > the fast budget were dropped permanently.
        if len(queued)+len(in_flight)<1200:queued.append(uri)
        else:skipped_pages+=1
    def scan_doc(s: BeautifulSoup, base: str):
        nonlocal exploration_seeded
        for item in json_nodes(s):
            if "tvepisode" in str(item.get("@type", "")).lower():
                name=field_of(item,"name")
                uri=field_of(item,"url","@id")
                if uri:add_episode(urljoin(base,uri),name or uri,item)
        for a in s.select("a[href]"):
            href=a.get("href") or ""
            label=clean((a.get("title") or "")+" "+a.get_text(" ",strip=True),250)
            combined=" ".join((label,href))
            data_episode=a.get("data-episode") or ""
            data_season=a.get("data-season") or ""
            if data_episode.isdigit() and data_season.isdigit():
                combined=f"S{int(data_season):02}E{int(data_episode):02} {combined}"
            if episode_numbers(combined):
                candidate=urljoin(base,href)
                if not belongs_to_series_episode(final,candidate,label):
                    continue
                add_episode(candidate,combined,display_title=label or f"الحلقة {episode_numbers(combined)[1]}")
                # Some series indexes show only their newest episode. That
                # episode's own page links to the full season. Fetch just one
                # representative page, not every episode (fast + bounded).
                if not exploration_seeded and base.rstrip('/')==final.rstrip('/'):
                    queue_page(candidate,base)
                    exploration_seeded=True
                continue
            uri=absolutize(base,href)
            if not uri or urlsplit(uri).hostname != root_host:continue
            tagclass=' '.join(a.get('class') or [])+' '+str(a.parent.get('class') if a.parent else '')
            from urllib.parse import urlsplit as split
            here=split(base)
            target=split(uri)
            is_pagination=(
                bool(re.search(r'/page/\d+/?$|/paged/\d+/?$',target.path,re.I)) and
                target.path.startswith(re.sub(r'/page/\d+/?$|/paged/\d+/?$', '', here.path).rstrip('/')+'/')
                or target.path.rstrip('/')==here.path.rstrip('/') and
                any(k in dict(parse_qsl(target.query)) for k in ('page','paged','pg','pagenum'))
                or bool(re.search(r'pagination|page-numbers|next|older|الصفحة التالية',tagclass+' '+label,re.I))
                and target.path.rstrip('/')==here.path.rstrip('/')
            )
            season_link=bool(SEASON_RE.search(combined)) and len(seen_pages)+len(queued)<max_pages
            if is_pagination or season_link:queue_page(uri,base)
    scan_doc(soup,final)
    checkpoint()
    # Always continue after a failed page. Every pagination link is a separate
    # independent unit: one 404 never stops scanning later pages or seasons.
    count=0
    while queued and count<max_pages and len(episode_map)<max_episodes:
        slice_urls=[]
        while queued and len(slice_urls)<5:
            page=queued.pop(0)
            if page.rstrip('/') in seen_pages:continue
            slice_urls.append(page)
        if not slice_urls:continue
        in_flight=set(slice_urls)
        def fetch_page(page):
            worker=SourceClient(timeout=getattr(client,'timeout',11)) if isinstance(client,SourceClient) else client
            # Quick discovery has one shared deadline across its pagination
            # requests; never reset retries or timeout for each page.
            if worker is not client and isinstance(worker,SourceClient):
                worker.deadline=getattr(client,'deadline',None)
                worker.retries=getattr(client,'retries',3)
            try:
                return worker.get(page)
            finally:
                if worker is not client and hasattr(worker,'session'):
                    worker.session.close()
        with ThreadPoolExecutor(max_workers=len(slice_urls)) as executor:
            futures={executor.submit(fetch_page,page):page for page in slice_urls}
            for future in as_completed(futures):
                page=futures[future]
                count+=1
                try:
                    try:
                        u,t,doc=future.result()
                    except (requests.RequestException,ValueError,OSError):
                        try:
                            time.sleep(.15)
                            u,t,doc=fetch_page(page)
                        except (requests.RequestException,ValueError,OSError) as second:
                            out.discovery_warnings.append('تعذر قراءة '+page+' : '+clean(second,85))
                            continue
                    if 'html' in t.lower() or '<html' in doc[:1000].lower():
                        scan_doc(BeautifulSoup(doc,'html.parser'),u)
                    else:
                        out.discovery_warnings.append('صفحة ليست HTML: '+page)
                except (requests.RequestException,ValueError,OSError) as exc:
                    out.discovery_warnings.append('تعذر قراءة '+page+' : '+clean(exc,85))
                finally:
                    # Only completed pages are checkpointed as seen. Any remaining
                    # in-flight pages stay in 'queued' when the process stops.
                    in_flight.discard(page)
                    seen_pages.add(page.rstrip('/'))
                    checkpoint()
    if queued or skipped_pages:
        out.discovery_warnings.append('العمل يتجاوز حد الصفحات/الحلقات في هذه الجولة؛ توجد صفحات لم تُفحص بعد')
    checkpoint()
    out.episodes=sorted(episode_map.values(),key=lambda e:(e.season,e.number))[:max_episodes]
    if out.episodes:
        by_season={}
        for ep in out.episodes:by_season.setdefault(ep.season,set()).add(ep.number)
        for season,nums in by_season.items():
            gaps=[n for n in range(min(nums),min(max(nums),10000)+1) if n not in nums]
            if gaps:out.discovery_warnings.append(f'الموسم {season}: أرقام حلقات غير موجودة في المصادر: '+', '.join(map(str,gaps[:12])))
    return out


def find_static_media(soup: BeautifulSoup, base: str, nodes: list[dict] | None = None) -> list[str]:
    """Collect standard public video links from video tags, metadata and JS literals.

    This does not evaluate third-party scripts or expose blob/session-only media.
    """
    links: list[str] = []
    def add(value: str):
        if not value or not MEDIA_EXT.search(value):
            return
        url = absolutize(base, value.replace("\\/", "/").replace("\\u0026", "&"))
        if url and url not in links:
            links.append(url)

    for tag in soup.select(
        'video[src], video[data-src], source[src], source[data-src],'
        ' a[href], meta[property="og:video"], meta[property="og:video:url"],'
        ' meta[property="og:video:secure_url"], iframe[src],'
        ' [data-video], [data-video-src], [data-hls], [data-stream]'
    )[:500]:
        for attr in ("href", "src", "data-src", "data-video", "data-video-src",
                     "data-hls", "data-stream", "content"):
            add(tag.get(attr) or "")
    for node in nodes or json_nodes(soup):
        for prop in ("contentUrl", "url", "embedUrl"):
            add(field_of(node, prop))
    # Many standard players declare their HLS URL inside inline JS configuration
    # (including an escaped JSON string such as https:\/\/cdn/.../master.m3u8).
    pattern = re.compile(
        r'''(?:https?:)?(?:/|\\/){2}[^\s"'<>]{0,700}\.(?:m3u8|mp4|m4v|webm)(?:\?[^\s"'<>]{0,350})?''',
        re.I
    )
    for script in soup.select("script:not([src])")[:40]:
        body = (script.string or script.get_text() or "")[:100_000]
        body = body.replace("\\/", "/").replace("\\u0026", "&")
        for match in pattern.findall(body):
            add("https:" + match if match.startswith("//") else match)
            if len(links) >= 80:
                return links
    return links

def inspect_episodes(out: Catalogue, client: SourceClient, delay: float=.15):
    targets = out.episodes if out.kind=="series" else [out]
    for episode in targets:
        url=episode.page_url if isinstance(episode,Episode) else out.url
        current=episode.media_url
        if not current:
            try:
                final,typ,html=client.get(url)
                if "html" in typ.lower():
                    soup=BeautifulSoup(html,"html.parser")
                    candidates=find_static_media(soup,final)
                    current=candidates[0] if candidates else ""
                    if isinstance(episode,Episode):
                        if not episode.description:
                            d=soup.select_one('meta[property="og:description"],meta[name="description"]')
                            episode.description=clean(d.get("content")) if d else ""
                        if not episode.poster_url:
                            p=soup.select_one('meta[property="og:image"]')
                            episode.poster_url=absolutize(final,p.get("content")) if p else ""
            except (requests.RequestException,ValueError) as exc:
                episode.error=clean(exc,140) if isinstance(episode,Episode) else ""
        if current:
            verified,error=client.media_verified(current)
            if isinstance(episode,Episode):
                episode.verified,episode.media_url,episode.error=verified,current,error if not verified else ""
            else:out.verified,out.media_url=verified,current
        if delay:time.sleep(delay)


def hydrate_episode_metadata(cat: Catalogue, *, max_pages:int=150, workers:int=6) -> int:
    """Concurrent metadata-only episode lookups from public HTTPS pages; never unlock streams."""
    if cat.kind!="series":return 0
    from concurrent.futures import ThreadPoolExecutor, as_completed
    targets=[ep for ep in cat.episodes if ep.page_url!=cat.url and
             (not ep.description or not ep.poster_url or not ep.media_url)][:max_pages]
    if not targets:return 0
    def load(ep:Episode):
        try:
            client=SourceClient(timeout=8)
            url,typ,body=client.get(ep.page_url)
            if "html" not in typ.lower():return None
            soup=BeautifulSoup(body,"html.parser")
            def meta(name):
                node=soup.select_one(f'meta[property="{name}"],meta[name="{name}"]')
                return clean(node.get("content","")) if node else ""
            description=meta("og:description") or meta("description")
            poster=absolutize(url,meta("og:image") or meta("twitter:image"))
            media=find_static_media(soup,url)
            return ep,description,poster,(media[0] if media else "")
        except (OSError,ValueError,requests.RequestException):return None
    done=0
    with ThreadPoolExecutor(max_workers=max(1,min(workers,8))) as executor:
        for future in as_completed([executor.submit(load,ep) for ep in targets]):
            result=future.result()
            if result is None:continue
            ep,desc,poster,media=result
            if desc and not ep.description:ep.description=desc
            if poster and not ep.poster_url:ep.poster_url=poster
            if media and not ep.media_url:ep.media_url=media
            done+=1
    return done


def load_fetchv_links(path: Path, out: Catalogue) -> int:
    """Read manually exported FetchV links; 'S01E02|https://...' per line."""
    if not path.exists():raise ValueError("FetchV links file not found")
    count=0
    lines=path.read_text("utf-8-sig").splitlines()
    for line in lines:
        line=line.strip()
        if not line or line.startswith("#"):continue
        if "|" not in line:
            if out.kind=="movie":
                media=public_url(line)
                if MEDIA_EXT.search(media):out.media_url=media;count+=1
            continue
        key,link=line.split("|",1)
        parsed=episode_numbers(key)
        if parsed and MEDIA_EXT.search(link):
            for ep in out.episodes:
                if (ep.season,ep.number)==parsed:
                    ep.media_url=public_url(link.strip());ep.verified=False;count+=1;break
    return count


def collect_edge_network(
    out: Catalogue, seconds: int, max_pages: int = 8,
    cloud: bool = False, start_index: int = 0
) -> int:
    """Inspect public episode pages for standard HLS/MP4/WebM in browser traffic.

    FetchV is not required and cannot be controlled from this server. The scan
    uses an isolated Chromium (cloud) or Edge (desktop) session with no cookies,
    without bypassing login, DRM or site access restrictions.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise ValueError("Playwright غير مثبت؛ أعد نشر نسخة Docker المحدثة.") from exc

    targets = out.episodes if out.kind == "series" else [out]
    selected = targets[start_index:start_index + min(max_pages, 8)]
    if not selected:
        return 0
    count = 0
    failed = 0
    with sync_playwright() as p:
        try:
            browser = (
                p.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
                if cloud else p.chromium.launch(channel="msedge", headless=False)
            )
        except Exception as exc:
            name = "Chromium السحابي" if cloud else "Microsoft Edge المحلي"
            raise ValueError(f"تعذر بدء {name}: {clean(exc, 180)}") from None
        try:
            context = browser.new_context(accept_downloads=False, service_workers="block")
            context.set_default_timeout(6_000)
            checked_hosts: set[str] = set()

            def safe_route(route):
                try:
                    address = public_url(route.request.url)
                    host = (urlsplit(address).hostname or "").lower()
                    if host not in checked_hosts:
                        if len(checked_hosts) >= 35:
                            raise ValueError("Too many external hosts")
                        check_dns(address)
                        checked_hosts.add(host)
                    route.continue_()
                except (ValueError, OSError, TypeError):
                    route.abort("blockedbyclient")

            context.route("**/*", safe_route)
            try:
                for entry in selected:
                    raw_url = entry.page_url if isinstance(entry, Episode) else out.url
                    if not raw_url:
                        failed += 1
                        continue
                    try:
                        page_url = public_url(raw_url)
                        check_dns(page_url)
                    except ValueError:
                        failed += 1
                        continue
                    page = context.new_page()
                    found: list[str] = []

                    def observe(uri: str):
                        try:
                            url = public_url(uri)
                        except (ValueError, TypeError):
                            return
                        if MEDIA_EXT.search(url) and url not in found:
                            found.append(url)

                    def listen_request(request):
                        if WEB_MEDIA.search(request.url):
                            observe(request.url)

                    def listen_response(response):
                        kind = (response.headers.get("content-type") or "").lower()
                        if WEB_MEDIA.search(response.url) or any(
                            name in kind for name in ("application/vnd.apple.mpegurl",
                              "application/x-mpegurl", "video/mp4", "video/webm")
                        ):
                            observe(response.url)

                    page.on("request", listen_request)
                    page.on("response", listen_response)
                    try:
                        page.goto(page_url, wait_until="domcontentloaded", timeout=15_000)
                        page.wait_for_timeout(seconds * 500)
                        for frame in page.frames[:10]:
                            try:
                                markup = frame.content()
                                if len(markup) <= 1_000_000:
                                    for uri in find_static_media(BeautifulSoup(markup, "html.parser"), frame.url):
                                        observe(uri)
                                # Recognize dynamically assigned currentSrc that is not
                                # necessarily present in the rendered HTML attributes.
                                for uri in frame.eval_on_selector_all(
                                    "video, video source, source",
                                    "(nodes) => nodes.map(n=>n.currentSrc||n.src||n.getAttribute('data-src')||'').filter(Boolean)"
                                )[:25]:
                                    observe(uri)
                            except Exception:
                                pass
                        if not found:
                            selectors = ("video", ".vjs-big-play-button",
                                         ".plyr__control--overlaid", ".jw-icon-display",
                                         "button[aria-label*='play' i]", "button[title*='play' i]",
                                         "[data-testid='play-button']")
                            for frame in page.frames[:8]:
                                for selector in selectors:
                                    try:
                                        button = frame.locator(selector).first
                                        if button.count() and button.is_visible():
                                            button.click(timeout=1300)
                                            page.wait_for_timeout(seconds * 700)
                                            if found:
                                                break
                                    except Exception:
                                        pass
                                if found:
                                    break
                        # Check a second time after the player has started.
                        if not found:
                            page.wait_for_timeout(seconds * 500)
                            for frame in page.frames[:10]:
                                try:
                                    for uri in frame.eval_on_selector_all(
                                        "video, source",
                                        "(nodes) => nodes.map(n=>n.currentSrc||n.src||'').filter(Boolean)"
                                    )[:20]:
                                        observe(uri)
                                except Exception:
                                    pass
                        candidate = next((u for u in found if u.lower().split("?")[0].endswith(".m3u8")), "")
                        candidate = candidate or next((u for u in found if MEDIA_EXT.search(u)), "")
                        if candidate:
                            # Browser discovery is not the same as successful playback.
                            if isinstance(entry, Episode):
                                entry.media_url = candidate
                                entry.verified = False
                                entry.error = ""
                            else:
                                out.media_url = candidate
                                out.verified = False
                            count += 1
                    except Exception:
                        failed += 1
                    finally:
                        page.close()
            finally:
                context.close()
        finally:
            browser.close()
    if failed:
        out.discovery_warnings.append(
            f"تعذر فتح أو فحص {failed} صفحة من الدفعة؛ قد يمنع الموقع الوصول من Render أو يتطلب تشغيلًا يدويًا."
        )
        out.discovery_warnings = out.discovery_warnings[-25:]
    return count


class Supabase:
    def __init__(self,url: str,key: str,access_token: str="",email: str="",password: str="",
                 *, trusted_admin_uid: str=""):
        self.root=url.rstrip("/")
        self.session=requests.Session()
        self.session.trust_env=False
        self.session.headers.update({"apikey":key,"Accept":"application/json","Content-Type":"application/json"})
        self.refresh_token = ''
        self.expires_at = 0
        self.auth_lock = threading.RLock()
        self.trusted_admin_uid = trusted_admin_uid or ""
        # Only backend routes that have verified an active portal admin may use
        # this path. Never send an elevated key or token back to the browser.
        if trusted_admin_uid:
            secret=(os.getenv("ALEZZ_SUPABASE_SECRET_KEY") or
                    os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY") or "")
            if not secret or key != secret or access_token or email or password:
                raise ValueError("Trusted studio login requires server-side credentials")
            # Modern sb_secret keys are NOT JWTs. Legacy service_role JWTs still
            # require Authorization: Bearer; both use apikey.
            if not key.startswith("sb_secret_"):
                self.session.headers["Authorization"]="Bearer "+key
            admins=self.query("aseel_admins",{"select":"user_id,active",
                          "user_id":"eq."+trusted_admin_uid,"active":"eq.true","limit":"1"})
            if not admins:
                raise ValueError("Portal session administrator is not active")
            return
        if not access_token and email and password:
            reply=self.session.post(self.root+"/auth/v1/token?grant_type=password",json={"email":email,"password":password},timeout=20)
            if not reply.ok:raise ValueError("Failed to authenticate admin: "+str(reply.status_code))
            auth = reply.json()
            access_token=auth.get("access_token","")
            self.refresh_token = auth.get('refresh_token', '')
            self.expires_at = time.time() + auth.get('expires_in', 3600)
        if not access_token:
            raise ValueError("Provide ALEZZ_ACCESS_TOKEN or ALEZZ_EMAIL and ALEZZ_PASSWORD")
        self.session.headers["Authorization"]="Bearer "+access_token
        user=self.session.get(self.root+"/auth/v1/user",timeout=15)
        if not user.ok:raise ValueError("Invalid or expired Supabase admin session")
        uid=user.json().get("id")
        admins=self.query("aseel_admins",{"select":"user_id,active","user_id":"eq."+str(uid),"limit":"1"})
        if not admins or not admins[0].get("active"):
            raise ValueError("Authenticated user is not an active Al Ezz TV administrator")

    def req(self, method:str, table:str,params:dict|None=None,payload:dict|None=None, *, upsert=False):
        with self.auth_lock:
            if self.refresh_token and time.time() > self.expires_at - 60:
                self._refresh()
            return self._request(method, table, params, payload, upsert=upsert)

    def _refresh(self):
        reply = self.session.post(self.root+'/auth/v1/token?grant_type=refresh_token',
                                  json={'refresh_token': self.refresh_token}, timeout=20)
        if not reply.ok: raise ValueError('انتهت جلسة المسؤول؛ أعد تسجيل الدخول أو تحقق من حساب العامل')
        auth = reply.json()
        self.refresh_token = auth.get('refresh_token', '')
        self.expires_at = time.time() + auth.get('expires_in', 3600)
        self.session.headers['Authorization'] = 'Bearer ' + auth['access_token']

    def _request(self, method, table, params, payload, *, upsert=False):
        url=self.root+"/rest/v1/"+table
        headers={"Prefer":"return=representation"+(",resolution=merge-duplicates" if upsert else "")}
        res=self.session.request(method,url,params=params,data=json.dumps(payload,ensure_ascii=False) if payload is not None else None,
                                 headers=headers,timeout=25,allow_redirects=False)
        if not res.ok:
            details=""
            try:details=str(res.json().get("message",res.status_code))
            except ValueError:details="HTTP "+str(res.status_code)
            raise ValueError("Supabase "+table+": "+details[:300])
        try:return res.json()
        except ValueError:return []

    def upsert_source(self, payload):
        return self.req("POST", "aseel_media_sources", {"on_conflict":"target_table,target_id,source_key"}, payload, upsert=True)

    def query(self,table:str,params:dict):return self.req("GET",table,params)
    def single(self,table:str,params:dict):
        r=self.query(table,{**params,"limit":"1"})
        return r[0] if r else None
    def insert(self,table:str,payload:dict):return self.req("POST",table,payload=payload)[0]
    def patch(self,table:str,id:str,payload:dict):
        rows=self.req("PATCH",table,{"id":"eq."+id},payload)
        if not rows:raise ValueError("Row update denied or not found")
        return rows[0]


def imported_fields(cat:Catalogue,category_id:str="") -> dict:
    x={"title_ar":cat.title[:250],"description":cat.description or None,
       "title_original":cat.original_title or None,"release_year":cat.year,
       "poster_url":cat.poster_url or None,"backdrop_url":cat.backdrop_url or cat.poster_url or None,
       "country_code":cat.country or None,"language_code":cat.language or None,
       "genre_tags":cat.genres[:12]}
    if category_id:x["category_id"]=category_id
    return {k:v for k,v in x.items() if v not in (None,"",[])}


def category_for_genres(categories: list[dict], genres: list[str]) -> str:
    """Choose a pre-existing classification only; never create new categories."""
    names={
        "drama":["دراما"],"romance":["رومانسي","رومنسي"],"action":["أكشن","اكشن"],
        "comedy":["كوميديا"],"thriller":["إثارة","غموض وتشويق"],
        "crime":["جريمة"],"horror":["رعب"],"documentary":["أفلام وثائقية"],
        "anime":["أنيمي"],"family":["عائلي"],"animation":["الرسوم المتحركة","كرتون"],
        "history":["تاريخي"]}
    for genre in genres:
        for label in names.get(genre,[]):
            found=next((row.get("id","") for row in categories if row.get("name_ar")==label),"")
            if found:return found
    return ""


def playback_variants(entry, existing=None, *, primary=None) -> list[dict]:
    """The production player accepts at most eight {label,url} variants."""
    rows, seen = [], {entry.media_url if primary is None else primary}
    for source in entry.sources + (existing or []):
        if not isinstance(source, dict): continue
        url = source.get('url', '')
        if url in seen: continue
        try: public_url(url)
        except ValueError: continue
        from media_resolver import normalized_source_url
        url = normalized_source_url(url)
        if url in seen: continue
        seen.add(url)
        if source.get('error') and not source.get('verified') and not source.get('reachable'): continue
        rows.append({k: source[k] for k in ('url', 'label', 'kind', 'page_url') if k in source})
    return rows[:8]


def store(cat:Catalogue,db:Supabase,*,publish:bool,rights:bool,license_holder:str="",
          license_reference:str="",source_id:str="",category_id:str="",capture_merge=False,
          defer_unverified_episodes=False) -> dict:
    if publish and not rights:
        raise ValueError("For public publishing, declare that you are authorized to display the work using --rights-authorized")
    # Parent works have a rights_holder column, but aseel_episodes does not.
    # Never pass one table's column set to a different table in PostgREST.
    work_rights={"status":"published","rights_status":"approved","rights_holder":license_holder,
                 "license_reference":license_reference} if publish and rights else {"status":"draft","rights_status":"pending"}
    episode_rights={"status":"published","rights_status":"approved",
                    "license_reference":license_reference} if publish and rights else {"status":"draft","rights_status":"pending"}
    if source_id:
        work_rights["source_id"]=source_id
        episode_rights["source_id"]=source_id
    result={"kind":cat.kind,"title":cat.title,"works_new":0,"works_updated":0,"seasons_new":0,"episodes_new":0,"episodes_updated":0,"media_verified":0,"metadata_only":0,"embed_reachable":0,"bindings":[]}

    def approved_embed_page(entry) -> bool:
        # Store only an explicitly allowed and reachable iframe page as a
        # separately unverified source. Publication still requires rights.
        if not entry.media_url:
            return False
        from media_resolver import supported_source_kind, official_ok_embed
        if supported_source_kind(entry.media_url) != 'embed':
            return False
        # The first-party OK.ru iframe URL may play on client devices even when
        # the provider blocks our server IP. Save it as unverified/suspect, not
        # healthy; a separate verified licence is still required to publish.
        if official_ok_embed(entry.media_url):
            return True
        return any(src.get('kind') == 'embed' and src.get('reachable')
                   and src.get('url') == entry.media_url for src in entry.sources)
    fields=imported_fields(cat,category_id)
    def merge_capture(payload, old, entry):
        if not capture_merge or not old:
            return payload
        primary = old.get('stream_url')
        merged = {k:v for k,v in payload.items() if not old.get(k)}
        if primary:
            for key in ('stream_url','link_health_status'):
                merged.pop(key,None)
        if entry.sources:
            merged['stream_variants'] = playback_variants(entry, old.get('stream_variants'), primary=primary)
        return merged

    if cat.kind=="movie":
        # Update existing match by page source to avoid a second copy of the work.
        movie=db.single("aseel_movies",{"select":"*" if capture_merge else "id,title_ar,stream_variants","source_page_url":"eq."+cat.url})
        if not movie and not capture_merge and cat.original_title and cat.year:
            movie=db.single("aseel_movies",{"select":"id,title_ar","title_original":"eq."+cat.original_title,
                                           "release_year":"eq."+str(cat.year)})
        payload={**fields,"source_page_url":cat.url}
        if cat.sources: payload['stream_variants'] = playback_variants(cat, (movie or {}).get('stream_variants'))
        if cat.verified and cat.media_url or approved_embed_page(cat):
            payload["stream_url"]=cat.media_url
            payload["link_health_status"]="healthy" if cat.verified else "suspect"
            result["media_verified" if cat.verified else "embed_reachable"]+=1
        else:result["metadata_only"]+=1
        if movie:
            changes={**merge_capture(payload,movie,cat),**({"status":"published","rights_status":"approved"} if publish and rights else {})}
            # PostgREST PATCH {} is not a successful row update. If no metadata
            # changed, the existing record is already saved: do not issue it.
            if changes: db.patch("aseel_movies",movie["id"],changes)
            result["works_updated"]+=1
        else:
            movie=db.insert("aseel_movies",{**payload,**work_rights})
            result["works_new"]+=1
        result['work_id'] = movie['id']
        result['bindings'].append(dict(season=0,number=0,id=movie['id'],table='aseel_movies'))
        if capture_merge: result['bindings'][-1]['stream_url']=movie.get('stream_url') or cat.media_url
        return result
    series=db.single("aseel_series",{"select":"*" if capture_merge else "id,title_ar","source_page_url":"eq."+cat.url})
    if not series and not capture_merge: series=db.single("aseel_series",{"select":"id,title_ar","title_ar":"eq."+cat.title})
    if not series and not capture_merge and cat.original_title and cat.year:
        series=db.single("aseel_series",{"select":"id,title_ar","title_original":"eq."+cat.original_title,
                                          "release_year":"eq."+str(cat.year)})
    if series:
        # Do not silently change existing rights or publication status on draft updates.
        patch={**fields,'source_page_url':cat.url,**(work_rights if publish else {})}
        if capture_merge: patch={key:value for key,value in patch.items() if value and not series.get(key)}
        if patch: db.patch("aseel_series",series["id"],patch)
        result["works_updated"]+=1
    else:
        series=db.insert("aseel_series",{**fields,'source_page_url':cat.url,**work_rights})
        result["works_new"]+=1
    seasons={}
    for ep in cat.episodes:
        if ep.season not in seasons:
            season=db.single("aseel_seasons",{"select":"id","series_id":"eq."+series["id"],"number":"eq."+str(ep.season)})
            if not season:
                season=db.insert("aseel_seasons",{"series_id":series["id"],"number":ep.season,"title_ar":"الموسم "+str(ep.season)})
                result["seasons_new"]+=1
            seasons[ep.season]=season["id"]
        season_id=seasons[ep.season]
        old=db.single("aseel_episodes",{"select":"*" if capture_merge else "id,number,stream_variants","season_id":"eq."+season_id,"number":"eq."+str(ep.number)})
        episode_page = ep.page_url if ep.page_url.rstrip('/') != cat.url.rstrip('/') else None
        payload={"title_ar":ep.title[:250] or "الحلقة "+str(ep.number),"description":ep.description or cat.description or None,
                 "poster_url":ep.poster_url or cat.poster_url or None,'source_page_url':episode_page}
        if ep.sources: payload['stream_variants'] = playback_variants(ep, (old or {}).get('stream_variants'))
        payload={k:v for k,v in payload.items() if v is not None}
        if ep.verified and ep.media_url or approved_embed_page(ep):
            payload["stream_url"]=ep.media_url
            payload["link_health_status"]="healthy" if ep.verified else "suspect"
            result["media_verified" if ep.verified else "embed_reachable"]+=1
        else:result["metadata_only"]+=1
        awaiting_playback = defer_unverified_episodes and publish and not payload.get("stream_url")
        if old:
            changes={**merge_capture(payload,old,ep),**({"status":"published","rights_status":"approved"} if publish and rights and not awaiting_playback else {})}
            if changes: db.patch("aseel_episodes",old["id"],changes)
            result["episodes_updated"]+=1
        else:
            old=db.insert("aseel_episodes",{"season_id":season_id,"number":ep.number,
                        **payload,**({"status":"draft","rights_status":"pending"} if awaiting_playback else episode_rights)})
            result["episodes_new"]+=1
        result['bindings'].append(dict(season=ep.season,number=ep.number,id=old['id'],table='aseel_episodes'))
        if awaiting_playback:
            result['bindings'][-1]['awaiting_playback'] = True
        if capture_merge: result['bindings'][-1]['stream_url']=old.get('stream_url') or ep.media_url
    result['work_id'] = series['id']
    return result


def main():
    parser=argparse.ArgumentParser(description="Import authorized Al Ezz TV movies/series, poster, year, seasons and episodes")
    parser.add_argument("url",help="One public HTTPS movie/series page")
    parser.add_argument("--kind",choices=("auto","movie","series"),default="auto")
    parser.add_argument("--links",type=Path,help="FetchV link list: S01E01|https://.../video.m3u8")
    parser.add_argument("--browser",action="store_true",help="Observe standard media requests in a fresh Edge window (not FetchV)")
    parser.add_argument("--browser-seconds",type=int,default=4,help="Seconds per page (default 4)")
    parser.add_argument("--skip-verification",action="store_true",help="Skip network media probes; links will remain unverified")
    parser.add_argument("--apply",action="store_true",help="Write to the connected Supabase project")
    parser.add_argument("--publish",action="store_true",help="Publish authorized work to the public catalogue")
    parser.add_argument("--rights-authorized",action="store_true",help="Confirm you own/hold authorization to display the content and artwork")
    parser.add_argument("--rights-holder",default="",help="Real rights holder; never invent this")
    parser.add_argument("--license-reference",default="",help="Your rights evidence reference")
    parser.add_argument("--source-id",default="",help="Optional Supabase content source UUID")
    parser.add_argument("--category-id",default="",help="Optional existing Supabase category UUID")
    parser.add_argument("--title",help="Override title")
    parser.add_argument("--year",type=int,help="Override release year")
    parser.add_argument("--country",default="",help="Two-letter country code, e.g. TR")
    parser.add_argument("--language",default="",help="Language code e.g. ar, tr, en")
    parser.add_argument("--report",type=Path,default=Path("alezz_import_preview.json"))
    args=parser.parse_args()
    if args.publish and not args.apply:parser.error("--publish requires --apply")
    if args.publish and not args.rights_authorized:parser.error("--publish needs --rights-authorized")
    client=SourceClient()
    try:
        cat=pull_html(public_url(args.url),client,args.kind)
        if args.kind!="auto":cat.kind=args.kind
        if args.title:cat.title=clean(args.title,250)
        if args.year:cat.year=args.year
        if args.country:cat.country=args.country.upper()[:2]
        if args.language:cat.language=args.language.lower()[:3]
        if args.links:
            n=load_fetchv_links(args.links,cat)
            print("Linked",n,"manual FetchV URL(s)")
        if args.browser:
            n=collect_edge_network(cat,max(1,args.browser_seconds))
            print("Detected",n,"media request(s) in Edge (does not control FetchV)")
        if not args.skip_verification:inspect_episodes(cat,client)
        args.report.write_text(json.dumps(asdict(cat),ensure_ascii=False,indent=2),encoding="utf-8")
        try:args.report.chmod(0o600)
        except OSError:pass
        print("Preview:",args.report.resolve(),"\nType:",cat.kind,"\nTitle:",cat.title,
              "\nEpisodes:",len(cat.episodes),"\nVerified:",sum(e.verified for e in cat.episodes) if cat.kind=="series" else int(cat.verified))
        if not args.apply:
            print("Preview only. Add --apply to save as drafts, or --apply --publish --rights-authorized for content you are authorized to distribute.")
            return
        root=os.environ.get("ALEZZ_SUPABASE_URL","https://qyzmlwtvzzgooccqxglq.supabase.co")
        key=os.environ.get("ALEZZ_SUPABASE_PUBLISHABLE_KEY","sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES")
        access_token=os.environ.get("ALEZZ_ACCESS_TOKEN","")
        email=os.environ.get("ALEZZ_EMAIL","")
        password=os.environ.get("ALEZZ_PASSWORD","")
        if not access_token and (not email or not password) and sys.stdin.isatty():
            email=email or input("Al Ezz admin email / بريد المدير: ").strip()
            password=password or getpass.getpass("Al Ezz admin password / كلمة المرور: ")
        db=Supabase(root,key,access_token,email,password)
        category_id=args.category_id
        if not category_id and cat.genres:
            try:
                categories=db.query("aseel_categories",{"select":"id,name_ar","published":"eq.true","limit":"250"})
                category_id=category_for_genres(categories,cat.genres)
            except (ValueError,requests.RequestException):pass
        result=store(cat,db,publish=args.publish,rights=args.rights_authorized,license_holder=args.rights_holder,
                     license_reference=args.license_reference,source_id=args.source_id,category_id=category_id)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except (ValueError,requests.RequestException,OSError) as e:
        print("IMPORT FAILED:",e,file=sys.stderr)
        raise SystemExit(1) from None


if __name__=="__main__":main()
