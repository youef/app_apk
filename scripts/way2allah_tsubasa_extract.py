#!/usr/bin/env python3
"""Extract Way2Allah Captain Tsubasa episodes from each site's own player.

Read-only collector. It does not publish, bypass protections, or change a DB.
Outputs an authorized-series importer manifest and an audit report.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://way2allah.com"
GROUP = BASE + "/var-group-1235.htm"
EXPECTED = set(range(1, 53))
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AlEzzCatalogAudit/1.0)",
           "Accept-Language": "ar,en;q=0.8"}
MEDIA_RE = re.compile(r"\.(?:mp4|m3u8|webm)(?:$|[?#])", re.I)


def session():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def collect_index():
    """Use the exact episode links from all three group pages, not ID guesses."""
    found = {}
    with session() as s:
        for page in range(1, 4):
            url = GROUP if page == 1 else f"{GROUP}?page={page}"
            resp = s.get(url, timeout=25)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            for a in soup.select("a.w2a-media-item-card[href*='var-item-']"):
                name = a.get("data-title") or a.get_text(" ", strip=True)
                number = re.search(r"الحلقة\s*(\d+)", name)
                href = urljoin(BASE, a.get("href", ""))
                if not number or not re.fullmatch(
                    r"https://way2allah\.com/var-item-\d+\.htm", href
                ):
                    continue
                n = int(number.group(1))
                if n in found and found[n] != href:
                    raise ValueError(f"Conflicting source pages for episode {n}")
                found[n] = href
    if set(found) != EXPECTED:
        missing = sorted(EXPECTED - set(found))
        extra = sorted(set(found) - EXPECTED)
        raise ValueError(f"Incomplete group index: {len(found)} / 52; missing={missing}; extra={extra}")
    return found


def parse_player_html(fragment):
    soup = BeautifulSoup(fragment, "html.parser")
    links = []
    for el in soup.select("video[src],video source[src],audio[src],audio source[src],iframe[src],a[href]"):
        value = el.get("src") or el.get("href") or ""
        candidate = urljoin(BASE, value.strip())
        parsed = urlparse(candidate)
        if parsed.scheme in ("http", "https") and MEDIA_RE.search(parsed.path):
            if candidate not in links:
                links.append(candidate)
    return links


def probe_https(s, url):
    """Read only the first bytes; never download a full episode."""
    parsed = urlparse(url)
    candidate = parsed._replace(scheme="https").geturl()
    if parsed.hostname != "vars.way2allah.com":
        return None
    try:
        with s.get(candidate, headers={"Range": "bytes=0-255"}, stream=True,
                   allow_redirects=True, timeout=18) as resp:
            final = urlparse(resp.url)
            if resp.status_code not in (200, 206) or final.scheme != "https":
                return None
            typ = resp.headers.get("Content-Type", "").lower()
            if not any(x in typ for x in ("video/", "application/octet-stream", "mpegurl")):
                return None
            chunk = next(resp.iter_content(chunk_size=256), b"")
            if not chunk:
                return None
            if "mp4" in final.path.lower() and b"ftyp" not in chunk[:32] and typ != "video/mp4":
                return None
            return resp.url
    except requests.RequestException:
        return None


def collect_episode(number, page_url):
    """Keep page GET and CSRF-protected AJAX POST on one cookie session."""
    result = {"number": number, "source_page_url": page_url,
              "page_id": int(re.search(r"var-item-(\d+)", page_url).group(1)),
              "observed_sources": [], "stream_url": None, "error": None}
    try:
        with session() as s:
            page = s.get(page_url, timeout=25)
            page.raise_for_status()
            meta = BeautifulSoup(page.text, "html.parser").select_one('meta[name="csrf-token"]')
            if not meta or not meta.get("content"):
                raise ValueError("Missing player CSRF token")
            sources = []
            for media_type in ("anasheed", "cartoon", "video"):
                response = s.post(
                    BASE + "/media-player",
                    data={"id": result["page_id"], "type": media_type,
                          "_token": meta["content"]},
                    headers={"Referer": page_url, "Origin": BASE,
                             "X-Requested-With": "XMLHttpRequest"},
                    timeout=25,
                )
                response.raise_for_status()
                sources = parse_player_html(response.text)
                if sources:
                    result["player_type"] = media_type
                    break
            for source in sources:
                secure = probe_https(s, source)
                result["observed_sources"].append(
                    {"player_url": source, "verified_https_url": secure})
                if secure and not result["stream_url"]:
                    result["stream_url"] = secure
            if not sources:
                result["error"] = "No media source found in AJAX player response"
            elif not result["stream_url"]:
                result["error"] = "Media found but HTTPS playback not verified"
    except (requests.RequestException, ValueError, AttributeError) as exc:
        result["error"] = str(exc)[:300]
    return result


def build_manifest(results):
    episodes = []
    for row in sorted(results, key=lambda x: x["number"]):
        episodes.append({
            "number": row["number"],
            "title_ar": f"الحلقة {row['number']}",
            "source_page_url": row["source_page_url"],
            "stream_url": row["stream_url"],
            "poster_url": f"https://way2allah.com/media/anasheed/frame/15/{row['page_id']}.jpg",
        })
    return {"series": [{
        "title_ar": "كابتن تسوباسا",
        "title_original": "Captain Tsubasa",
        "source_page_url": GROUP,
        "country_code": "JP",
        "description": "رحلة تسوباسا أوزورا في عالم كرة القدم مع زملائه ومنافسيه لتحقيق حلمه.",
        "genre_tags": ["kids", "sports", "anime"],
        "seasons": [{"number": 1, "title_ar": "الموسم الأول", "episodes": episodes}],
    }]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default="data/tsubasa-52-manifest.json")
    parser.add_argument("--report", default="data/tsubasa-52-report.json")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    index = collect_index()
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(8, args.workers))) as pool:
        tasks = {pool.submit(collect_episode, number, url): number
                 for number, url in index.items()}
        results = [future.result() for future in concurrent.futures.as_completed(tasks)]
    results.sort(key=lambda row: row["number"])
    manifest = build_manifest(results)
    for path, payload in ((args.manifest, manifest), (args.report, {"episodes": results})):
        dest = Path(path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    total = sum(bool(item["stream_url"]) for item in results)
    print(json.dumps({"episodes": len(results), "verified_https_videos": total,
                      "unresolved": [x["number"] for x in results if not x["stream_url"]],
                      "report": args.report, "manifest": args.manifest},
                     ensure_ascii=False))
    if len(results) != 52:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
