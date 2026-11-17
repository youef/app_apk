#!/usr/bin/env python3
"""Way2Allah kids collection: source-scoped episode inventory.

Read-only. Fetches the source group pages, optional site-hosted AJAX players,
and writes a reviewable catalog JSON with real episode page URLs. Never
publishes, grants rights, bypasses access controls, or invents stream URLs.
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import math
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

HOST = "https://way2allah.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AlEzzCatalogAudit/1.1)",
    "Accept-Language": "ar,en;q=0.8",
}
ITEM = re.compile(r"^https://way2allah\.com/var-item-(\d+)\.htm$")
MEDIA = re.compile(r"\.(?:mp4|m3u8|webm)(?:$|[?#])", re.I)
NUMBER = re.compile(r"(?:الحلق[ةه]\s*(?:رقم\s*)?|episode\s*|ep\s*)([0-9٠-٩]+)", re.I)
GROUP_SIZE = 24


def client():
    instance = requests.Session()
    instance.headers.update(HEADERS)
    return instance


def read_cards(s, group_id, page):
    url = f"{HOST}/var-group-{group_id}.htm"
    if page > 1:
        url += f"?page={page}"
    response = s.get(url, timeout=22)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    cards = []
    for node in soup.select("a.w2a-media-item-card[href*='var-item-']"):
        href = urljoin(HOST, node.get("href", "")).split("#", 1)[0]
        if not ITEM.fullmatch(href):
            continue
        title = " ".join(
            (node.get("data-title") or
             (node.select_one(".w2a-media-item-title") or node).get_text(" ", strip=True))
            .split()
        )
        picture = node.select_one("img[src]")
        poster = urljoin(HOST, picture["src"]) if picture else None
        if poster and urlsplit(poster).scheme != "https":
            poster = None
        cards.append({"page_id": int(ITEM.fullmatch(href)[1]), "source_page_url": href,
                      "title_ar": title[:230] or "مقطع بدون عنوان", "poster_url": poster})
    return cards


def player_links(fragment):
    soup = BeautifulSoup(fragment, "html.parser")
    links = []
    for tag in soup.select("video[src],video source[src],audio[src],audio source[src],iframe[src],a[href]"):
        raw = tag.get("src") or tag.get("href") or ""
        url = urljoin(HOST, raw.strip())
        if urlsplit(url).scheme == "https" and MEDIA.search(urlsplit(url).path):
            if url not in links:
                links.append(url)
    for raw in re.findall(r"https?://[^\s\"'<>\\]+?\.(?:mp4|m3u8|webm)(?:\?[^\"'<>\\\s]*)?", fragment, re.I):
        raw = raw.replace("&amp;", "&")
        if urlsplit(raw).scheme == "https" and raw not in links:
            links.append(raw)
    return links[:12]


def verified_video(s, url):
    """Never fetch the whole video, and never change a URL to guess a file."""
    if urlsplit(url).scheme != "https":
        return None
    try:
        with s.get(url, headers={"Range": "bytes=0-255"},
                   stream=True, timeout=18, allow_redirects=True) as resp:
            final = urlsplit(resp.url)
            content_type = resp.headers.get("Content-Type", "").lower()
            if resp.status_code not in (200, 206) or final.scheme != "https":
                return None
            if not any(t in content_type for t in ("video/", "application/vnd.apple.mpegurl",
                                                   "application/x-mpegurl", "application/octet-stream")):
                return None
            if not next(resp.iter_content(chunk_size=256), b""):
                return None
            return resp.url
    except requests.RequestException:
        return None


def probe_player(item):
    result = dict(item)
    result["stream_url"] = None
    result["observed_sources"] = []
    try:
        with client() as s:
            page = s.get(item["source_page_url"], timeout=22)
            page.raise_for_status()
            soup = BeautifulSoup(page.text, "html.parser")
            meta = soup.select_one('meta[name="csrf-token"]')
            if not meta or not meta.get("content"):
                result["link_note"] = "Player token missing"
                return result
            for media_type in ("cartoon", "anasheed", "video"):
                try:
                    response = s.post(f"{HOST}/media-player",
                        data={"id": item["page_id"], "type": media_type,
                              "_token": meta["content"]},
                        headers={"Referer": item["source_page_url"], "Origin": HOST,
                                 "X-Requested-With": "XMLHttpRequest"},
                        timeout=22)
                    if response.status_code != 200:
                        continue
                    links = player_links(response.text)
                    for link in links:
                        result["observed_sources"].append(link)
                        verified = verified_video(s, link)
                        if verified and not result["stream_url"]:
                            result["stream_url"] = verified
                    if links:
                        result["player_type"] = media_type
                        break
                except requests.RequestException:
                    continue
            if not result["stream_url"]:
                result["link_note"] = "No verified direct HTTPS media from original player"
    except requests.RequestException as error:
        result["link_note"] = str(error)[:160]
    return result


def episode_number(title):
    m = NUMBER.search(title)
    if not m:
        return None
    return int(m[1].translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")))


def process_group(group, probe=False, max_pages=15, player_workers=2):
    group_id = int(group["group_id"])
    expected = max(0, int(group.get("listed_clip_count") or 0))
    # A small buffer covers inaccurate totals in the source site's old index.
    target_pages = min(max_pages, max(2, math.ceil(expected / GROUP_SIZE) + 3))
    cards = {}
    notes = []
    with client() as s:
        for page in range(1, target_pages + 1):
            try:
                items = read_cards(s, group_id, page)
            except requests.RequestException as error:
                notes.append(f"page {page}: {str(error)[:110]}")
                break
            added = 0
            for item in items:
                if item["page_id"] not in cards:
                    cards[item["page_id"]] = item
                    added += 1
            if not items or (page > 1 and not added):
                break
            if len(items) < GROUP_SIZE and page > 1:
                break
    ordered = sorted(cards.values(), key=lambda x: x["page_id"])
    used = set()
    # Preserve genuine episode numbers; duplicates become issues, not conflated episodes.
    for item in ordered:
        n = episode_number(item["title_ar"])
        if n is not None and n > 0 and n not in used:
            item["number"] = n
            used.add(n)
        elif n is not None:
            notes.append(f"duplicate or invalid explicit episode number: {n} in {item['source_page_url']}")
    cursor = 1
    for item in ordered:
        if "number" not in item:
            while cursor in used:
                cursor += 1
            item["number"] = cursor
            used.add(cursor)
    if probe and ordered:
        with futures.ThreadPoolExecutor(max_workers=max(1, min(player_workers, 3))) as pool:
            ordered = list(pool.map(probe_player, ordered))
    else:
        for item in ordered:
            item["stream_url"] = None
    episodes = []
    verified = 0
    for item in sorted(ordered, key=lambda x: (x["number"], x["page_id"])):
        verified += bool(item["stream_url"])
        episodes.append({
            "number": item["number"], "title_ar": item["title_ar"],
            "source_page_url": item["source_page_url"], "poster_url": item["poster_url"],
            "stream_url": item["stream_url"],
        })
    title = str(group["title_ar"]).strip()
    entry = {
        "title_ar": title, "source_page_url": group["source_page_url"],
        "poster_url": group.get("poster_url"), "genre_tags": ["kids", "animation"],
        "description": f"محتوى {title} ضمن فهرس الكارتون الإسلامي. الحلقات من صفحات المصدر.",
        "seasons": [{"number": 1, "episodes": episodes}],
    }
    report = {
        "group_id": group_id, "title": title, "listed_count": expected,
        "discovered_episode_pages": len(episodes), "verified_direct_streams": verified,
        "notes": notes,
    }
    return entry, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", default="data/way2allah_kids_57_index.json")
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--shards", type=int, default=12)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--player-workers", type=int, default=2)
    parser.add_argument("--max-pages", type=int, default=15)
    parser.add_argument("--max-groups", type=int, default=0)
    parser.add_argument("--probe-players", action="store_true")
    parser.add_argument("--out-dir", default="data/way2allah-audit")
    args = parser.parse_args()
    if args.shards < 1 or not 0 <= args.shard < args.shards:
        parser.error("shard must be between zero and shards minus one")
    entries = json.loads(Path(args.index).read_text(encoding="utf-8"))["groups"]
    selected = [x for x in entries if int(x.get("listed_clip_count") or 0) > 0
                and int(x["group_id"]) % args.shards == args.shard]
    if args.max_groups:
        selected = selected[:args.max_groups]
    entries_out, reports = [], []
    started = time.time()
    with futures.ThreadPoolExecutor(max_workers=max(1, min(6, args.workers))) as pool:
        tasks = {pool.submit(process_group, g, args.probe_players,
                             args.max_pages, args.player_workers): g for g in selected}
        for future in futures.as_completed(tasks):
            group = tasks[future]
            try:
                entry, report = future.result()
                entries_out.append(entry)
                reports.append(report)
                print(json.dumps({"group": group["group_id"], "episodes": report["discovered_episode_pages"],
                                  "verified": report["verified_direct_streams"]}, ensure_ascii=False), flush=True)
            except Exception as error:
                reports.append({"group_id": group["group_id"], "title": group["title_ar"],
                                "error": str(error)[:300]})
    entries_out.sort(key=lambda e: e["source_page_url"])
    reports.sort(key=lambda e: e["group_id"])
    base = Path(args.out_dir)
    base.mkdir(parents=True, exist_ok=True)
    slug = f"shard-{args.shard:02d}-of-{args.shards:02d}"
    manifest = base / f"{slug}-manifest.json"
    audit = base / f"{slug}-report.json"
    manifest.write_text(json.dumps({"series": entries_out, "movies": []}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    audit.write_text(json.dumps({"source": "way2allah-kids-57", "shard": args.shard,
        "shards": args.shards, "elapsed_seconds": round(time.time() - started, 1),
        "groups": reports}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"groups": len(entries_out),
        "episode_pages": sum(len(x["seasons"][0]["episodes"]) for x in entries_out),
        "verified_streams": sum(x.get("verified_direct_streams", 0) for x in reports),
        "failed_groups": sum(bool(x.get("error")) for x in reports),
        "manifest": str(manifest), "report": str(audit)}, ensure_ascii=False))
    return 0 if not any(x.get("error") for x in reports) else 1


if __name__ == "__main__":
    raise SystemExit(main())
