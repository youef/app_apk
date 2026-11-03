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
from urllib.parse import urljoin, urlsplit
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError as exc:
    raise SystemExit("Install dependencies: python -m pip install -r requirements.txt") from exc

MEDIA_EXT = re.compile(r"\.(?:mp4|m4v|webm|m3u8)(?:[?#]|$)", re.I)
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


class SourceClient:
    def __init__(self, timeout: float = 15):
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers.update({"User-Agent": "AlEzzTV-MetadataImporter/1.0", "Accept": "text/html,application/json,*/*"})
        self.timeout = timeout

    def get(self, url: str, max_size: int = 1_500_000):
        for _ in range(5):
            check_dns(url)
            response = self.session.get(url, timeout=self.timeout, allow_redirects=False, stream=True)
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                response.close()
                if not location:
                    raise ValueError("Redirect missing Location")
                url = urljoin(url, location)
                continue
            response.raise_for_status()
            chunks, total = [], 0
            try:
                for chunk in response.iter_content(64 * 1024):
                    total += len(chunk)
                    if total > max_size:
                        raise ValueError("Page exceeds safe size limit")
                    chunks.append(chunk)
            finally:
                response.close()
            data = b"".join(chunks)
            return url, response.headers.get("Content-Type", ""), data.decode(response.encoding or "utf-8", errors="replace")
        raise ValueError("Too many redirects")

    def media_verified(self, url: str) -> tuple[bool, str]:
        if not MEDIA_EXT.search(url):
            return False, "Unsupported: media must be MP4/WebM/M4V/HLS"
        try:
            for _ in range(4):
                check_dns(url)
                response = self.session.get(url, headers={"Range": "bytes=0-8191", "Accept": "*/*"},
                                            timeout=self.timeout, allow_redirects=False, stream=True)
                if response.status_code in (301, 302, 303, 307, 308):
                    dest = response.headers.get("Location", "")
                    response.close()
                    url = urljoin(url, dest)
                    continue
                if not response.ok:
                    msg = "HTTP " + str(response.status_code)
                    response.close()
                    return False, msg
                ctype = response.headers.get("Content-Type", "").lower()
                sample = next(response.iter_content(8192), b"")
                response.close()
                if "html" in ctype or sample.lstrip().lower().startswith((b"<!doctype html", b"<html")):
                    return False, "Returned HTML, not a video stream"
                if ".m3u8" in url.lower() and not (b"#EXTM3U" in sample or "mpegurl" in ctype):
                    return False, "HLS manifest not detected"
                return True, "OK"
            return False, "Too many redirects"
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
    candidates += [n for n in nodes if n not in candidates]
    main = candidates[0] if candidates else {}
    def meta(name: str) -> str:
        t = soup.select_one(f'meta[property="{name}"],meta[name="{name}"]')
        return clean(t.get("content", "") if t else "")
    title = field_of(main, "name", "headline") or meta("og:title") or clean(soup.title.get_text() if soup.title else "", 250)
    description = field_of(main, "description") or meta("og:description") or meta("description")
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
        image=soup.select_one('[itemprop="image"], img.poster, .poster img, img[itemprop="thumbnailUrl"]')
        if image:
            poster=absolutize(final,image.get("src") or image.get("data-src") or image.get("data-original") or image.get("content") or "")
    out = Catalogue(kind=detected, title=title or "بدون عنوان",url=final,description=description,
                    poster_url=poster,backdrop_url=poster,year=year,original_title=original)
    out.backdrop_url=absolutize(final,meta("og:image:secure_url") or meta("twitter:image")) or poster
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
    seen_pages: set[str] = {final.rstrip('/')} | set(resume_progress.get('seen_pages',[])[:max_pages])
    queued: list[str] = list(resume_progress.get('queued',[])[:max_pages])
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
        if not link:return
        key=parsed
        if key not in episode_map:
            ep=Episode(parsed[0],parsed[1],clean(display_title or label,250),link)
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
        if len(seen_pages)+len(queued)+len(in_flight)<max_pages:queued.append(uri)
        else:skipped_pages+=1
    def scan_doc(s: BeautifulSoup, base: str):
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
                add_episode(urljoin(base,href),combined,display_title=label or f"الحلقة {episode_numbers(combined)[1]}")
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
            return worker.get(page)
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


def find_static_media(soup: BeautifulSoup,base: str,nodes: list[dict] | None=None) -> list[str]:
    links=[]
    for tag in soup.select('video[src],video source[src],source[src],a[href],meta[property="og:video"],meta[property="og:video:url"]'):
        value=tag.get("href") or tag.get("src") or tag.get("content") or ""
        if MEDIA_EXT.search(value):
            link=absolutize(base,value)
            if link and link not in links:links.append(link)
    for node in nodes or json_nodes(soup):
        for prop in ("contentUrl","url","embedUrl"):
            value=field_of(node,prop)
            if MEDIA_EXT.search(value):
                link=absolutize(base,value)
                if link and link not in links:links.append(link)
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


def collect_edge_network(out: Catalogue, seconds: int, max_pages: int = 8, cloud: bool = False) -> int:
    """Inspect standard public HTTPS media requests with a new browser session.

    On Render this uses cloud-side Chromium headless; on a local PC, headed Edge.
    The browser has no access to existing Safari/Edge cookies or extensions.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise ValueError("Playwright غير مثبت. أعد نشر نسخة Docker المحدثة على Render.") from exc

    targets = out.episodes if out.kind == "series" else [out]
    count = 0
    with sync_playwright() as p:
        try:
            browser = (
                p.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
                if cloud else p.chromium.launch(channel="msedge", headless=False)
            )
        except Exception as exc:
            mode = "Chromium السحابي" if cloud else "Microsoft Edge المحلي"
            raise ValueError(f"تعذر بدء {mode}: {clean(exc, 180)}") from None
        try:
            context = browser.new_context(accept_downloads=False, service_workers="block")
            context.set_default_timeout(8_000)
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

            # Best-effort guard for page and subresource URLs: no local/private hosts,
            # ports, IP-literals, non-HTTPS or service-worker controlled traffic.
            context.route("**/*", safe_route)
            try:
                for entry in targets[:min(max_pages, 8)]:
                    raw_url = entry.page_url if isinstance(entry, Episode) else out.url
                    if not raw_url:
                        continue
                    page_url = public_url(raw_url)
                    check_dns(page_url)
                    page = context.new_page()
                    found: list[str] = []

                    def listen(request):
                        uri = request.url
                        if WEB_MEDIA.search(uri) and uri.startswith("https://") and uri not in found:
                            try:
                                found.append(public_url(uri))
                            except (ValueError, TypeError):
                                pass
                    page.on("request", listen)
                    try:
                        page.goto(page_url, wait_until="domcontentloaded", timeout=18_000)
                        page.wait_for_timeout(seconds * 1000)
                        for selector in ("video", "button[aria-label*=play i]", "button[title*=play i]"):
                            try:
                                page.locator(selector).first.click(timeout=1200)
                                page.wait_for_timeout(1200)
                                break
                            except Exception:
                                pass
                        uri = next((u for u in found if MEDIA_EXT.search(u)), "")
                        if uri:
                            if isinstance(entry, Episode):
                                entry.media_url = uri
                                entry.verified = False
                            else:
                                out.media_url = uri
                                out.verified = False
                            count += 1
                    except Exception:
                        # A failed page should not stop the remaining episodes.
                        pass
                    finally:
                        page.close()
            finally:
                context.close()
        finally:
            browser.close()
    return count

class Supabase:
    def __init__(self,url: str,key: str,access_token: str="",email: str="",password: str=""):
        self.root=url.rstrip("/")
        self.session=requests.Session()
        self.session.trust_env=False
        self.session.headers.update({"apikey":key,"Accept":"application/json","Content-Type":"application/json"})
        if not access_token and email and password:
            reply=self.session.post(self.root+"/auth/v1/token?grant_type=password",json={"email":email,"password":password},timeout=20)
            if not reply.ok:raise ValueError("Failed to authenticate admin: "+str(reply.status_code))
            access_token=reply.json().get("access_token","")
        if not access_token:
            raise ValueError("Provide ALEZZ_ACCESS_TOKEN or ALEZZ_EMAIL and ALEZZ_PASSWORD")
        self.session.headers["Authorization"]="Bearer "+access_token
        user=self.session.get(self.root+"/auth/v1/user",timeout=15)
        if not user.ok:raise ValueError("Invalid or expired Supabase admin session")
        uid=user.json().get("id")
        admins=self.query("aseel_admins",{"select":"user_id,active","user_id":"eq."+str(uid),"limit":"1"})
        if not admins or not admins[0].get("active"):
            raise ValueError("Authenticated user is not an active Al Ezz TV administrator")

    def req(self, method:str, table:str,params:dict|None=None,payload:dict|None=None):
        url=self.root+"/rest/v1/"+table
        headers={"Prefer":"return=representation"}
        res=self.session.request(method,url,params=params,data=json.dumps(payload,ensure_ascii=False) if payload is not None else None,
                                 headers=headers,timeout=25)
        if not res.ok:
            details=""
            try:details=str(res.json().get("message",res.status_code))
            except ValueError:details="HTTP "+str(res.status_code)
            raise ValueError("Supabase "+table+": "+details[:300])
        try:return res.json()
        except ValueError:return []

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


def store(cat:Catalogue,db:Supabase,*,publish:bool,rights:bool,license_holder:str="",
          license_reference:str="",source_id:str="",category_id:str="") -> dict:
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
    result={"kind":cat.kind,"title":cat.title,"works_new":0,"works_updated":0,"seasons_new":0,"episodes_new":0,"episodes_updated":0,"media_verified":0,"metadata_only":0}
    fields=imported_fields(cat,category_id)
    if cat.kind=="movie":
        # Update existing match by page source to avoid a second copy of the work.
        movie=db.single("aseel_movies",{"select":"id,title_ar","source_page_url":"eq."+cat.url})
        if not movie and cat.original_title and cat.year:
            movie=db.single("aseel_movies",{"select":"id,title_ar","title_original":"eq."+cat.original_title,
                                           "release_year":"eq."+str(cat.year)})
        payload={**fields,"source_page_url":cat.url}
        if cat.verified and cat.media_url:
            payload["stream_url"]=cat.media_url
            payload["link_health_status"]="healthy"
            result["media_verified"]+=1
        else:result["metadata_only"]+=1
        if movie:
            db.patch("aseel_movies",movie["id"],{**payload,**({"status":"published","rights_status":"approved"} if publish and rights else {})})
            result["works_updated"]+=1
        else:
            db.insert("aseel_movies",{**payload,**work_rights})
            result["works_new"]+=1
        return result
    series=db.single("aseel_series",{"select":"id,title_ar","title_ar":"eq."+cat.title})
    if not series and cat.original_title and cat.year:
        series=db.single("aseel_series",{"select":"id,title_ar","title_original":"eq."+cat.original_title,
                                          "release_year":"eq."+str(cat.year)})
    if series:
        # Do not silently change existing rights or publication status on draft updates.
        patch={**fields,**(work_rights if publish else {})}
        db.patch("aseel_series",series["id"],patch)
        result["works_updated"]+=1
    else:
        series=db.insert("aseel_series",{**fields,**work_rights})
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
        old=db.single("aseel_episodes",{"select":"id,number","season_id":"eq."+season_id,"number":"eq."+str(ep.number)})
        payload={"title_ar":ep.title[:250] or "الحلقة "+str(ep.number),"description":ep.description or cat.description or None,
                 "poster_url":ep.poster_url or cat.poster_url or None}
        payload={k:v for k,v in payload.items() if v is not None}
        if ep.verified and ep.media_url:
            payload["stream_url"]=ep.media_url
            payload["link_health_status"]="healthy"
            result["media_verified"]+=1
        else:result["metadata_only"]+=1
        if old:
            db.patch("aseel_episodes",old["id"],{**payload,**({"status":"published","rights_status":"approved"} if publish and rights else {})})
            result["episodes_updated"]+=1
        else:
            db.insert("aseel_episodes",{"season_id":season_id,"number":ep.number,
                        **payload,**episode_rights})
            result["episodes_new"]+=1
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
