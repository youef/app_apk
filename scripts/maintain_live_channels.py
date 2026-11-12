#!/usr/bin/env python3
"""Audit every Al Ezz TV live channel and replace failed streams from the
same broadcaster's IPTV-org ID only. Never guess a channel by display name.
Broken streams are never deleted; confirmed failures temporarily hide a channel
while its identity and sources remain available for automatic recovery. Network/geo failures are inconclusive.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
from collections import defaultdict

from arabic_iptv_import import (
    BASE, api, channel_uid, json_get, parse_m3u, public_https, read, stream_works
)

REPORT = {
    "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    "total": 0, "healthy": 0, "renewed": 0, "suspect": 0,
    "broken": 0, "deleted": 0, "unchanged": 0,
    "catalog_available": False, "changes": [], "errors": []
}

def candidates_for(playlist):
    grouped = defaultdict(list)
    for meta, url in playlist:
        identity = channel_uid(meta)
        if identity and url not in grouped[identity]:
            grouped[identity].append(url)
    return grouped

def external_id(row):
    note = str(row.get("description") or "")
    match = re.search(r"IPTV(?:-org)?(?: source)? ID:\s*([A-Za-z0-9_.+-]+(?:@[A-Za-z0-9_.+-]+)?)", note, re.I)
    return match.group(1).split("@")[0] if match else None

def stream_entries(row):
    entries = []
    if row.get("stream_url"):
        entries.append(str(row["stream_url"]).strip())
    variants = row.get("stream_variants")
    if isinstance(variants, list):
        for variant in variants[:8]:
            if isinstance(variant, dict) and isinstance(variant.get("url"), str):
                entries.append(variant["url"].strip())
    return list(dict.fromkeys(x for x in entries if x))

def probe(url):
    """healthy if a playable HLS segment is readable; gone only on HTTP 404/410.
    Other failures may reflect geoblocking, ephemeral token expiry, bad TLS,
    temporary upstream outage or an incompatible player: never delete on them.
    """
    if not public_https(url):
        return "uncertain"
    try:
        payload = read(url, limit=300000, timeout=10)
    except urllib.error.HTTPError as exc:
        return "gone" if exc.code in (404, 410) else "uncertain"
    except Exception:
        return "uncertain"
    if not payload.lstrip(b"\xef\xbb\xbf").startswith(b"#EXTM3U"):
        return "uncertain"
    return "healthy" if stream_works(url) else "uncertain"

def inspect(row, grouped, catalog_ok, blocked):
    old = stream_entries(row)
    # External or official players may be intentionally configured without HLS.
    alternate_mode = row.get("playback_mode") == "official_link" or bool(row.get("official_url") or row.get("youtube_url"))
    original = {url: probe(url) for url in old}
    good = next((url for url, state in original.items() if state == "healthy"), None)
    identity = external_id(row)
    replacements = []
    if not good and catalog_ok and identity and identity not in blocked:
        for url in grouped.get(identity, [])[:6]:
            if url not in original and public_https(url):
                replacements.append(url)
    if not good:
        for url in replacements:
            if probe(url) == "healthy":
                good = url
                break
    statuses = list(original.values())
    all_gone = bool(old) and all(status == "gone" for status in statuses)
    no_url = not old and not alternate_mode
    permanent = not alternate_mode and (no_url or (all_gone and catalog_ok and not good))
    return {"row": row, "good": good, "old": old,
            "original": original, "permanent": permanent,
            "no_url": no_url, "alternate_mode": alternate_mode}

def update(row, changes):
    if not changes:
        REPORT["unchanged"] += 1
        return
    api("PATCH", "aseel_channels?id=eq." + urllib.parse.quote(row["id"]), changes)

def process(result):
    row = result["row"]
    rid = row["id"]
    title = row.get("title_ar") or "(untitled)"
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    old_status = row.get("link_health_status") or "unchecked"
    failures = int(row.get("link_health_failures") or 0)
    found = result["good"]
    previous = row.get("stream_url")
    if found:
        changes = {
            "link_health_status": "healthy", "link_health_failures": 0,
            "link_health_reason": "Confirmed readable HLS media segment",
            "link_health_checked_at": now
        }
        if found != previous:
            changes["stream_url"] = found
            # Retain only verified backups; never keep a known 404/410 link.
            new_backups = []
            for candidate in result["old"]:
                if candidate != found and result["original"].get(candidate) == "healthy":
                    new_backups.append({"label": "Backup", "url": candidate})
            changes["stream_variants"] = new_backups[:8]
            REPORT["renewed"] += 1
            REPORT["changes"].append({"name": title, "action": "renewed"})
        REPORT["healthy"] += 1
        update(row, changes)
        return
    if result["alternate_mode"]:
        REPORT["unchanged"] += 1
        return
    if result["permanent"]:
        # Never delete channels from the database. Their existing links and
        # provider metadata are needed for automatic recovery later.
        failures += 1
        status = "broken" if failures >= 3 else "suspect"
        update(row, {
            "link_health_status": status, "link_health_failures": failures,
            "link_health_reason": "All saved media sources are definitively unavailable; kept for automatic retry",
            "link_health_checked_at": now
        })
        REPORT[status] += 1
        REPORT["changes"].append({"name": title, "action": "temporarily_hidden" if status == "broken" else "suspect",
                                  "reason": "confirmed source failure; original channel preserved"})
        return
    # Geoblocking, missing authentication, DNS or transient network failures.
    # Keep existing broken state until a successful recovery verifies playback.
    status = "broken" if old_status == "broken" else "suspect"
    update(row, {
        "link_health_status": status, "link_health_failures": failures,
        "link_health_reason": "Inconclusive stream check; no automatic deletion",
        "link_health_checked_at": now
    })
    REPORT[status] += 1

def main():
    if not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY GitHub secret is missing")
    rows = []
    for offset in range(0, 10000, 500):
        page = api("GET", "aseel_channels?select=id,title_ar,description,stream_url,stream_variants,"
                   "official_url,youtube_url,playback_mode,status,link_health_status,link_health_failures"
                   "&order=id.asc&limit=500&offset=" + str(offset))
        rows.extend(page)
        if len(page) < 500:
            break
    REPORT["total"] = len(rows)
    grouped, blocked, catalog_ok = {}, set(), False
    try:
        blocklist = json_get(BASE + "/api/blocklist.json")
        blocked = {item.get("channel") for item in blocklist if isinstance(item, dict)}
        data = read(BASE + "/iptv/index.m3u", limit=24 * 1024 * 1024, timeout=35)
        grouped = candidates_for(parse_m3u(data))
        catalog_ok = True
    except Exception as exc:
        REPORT["errors"].append("IPTV catalog unavailable; no 404-only deletion: " + str(exc)[:140])
    REPORT["catalog_available"] = catalog_ok
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as workers:
        futures = {workers.submit(inspect, row, grouped, catalog_ok, blocked): row for row in rows}
        for future in concurrent.futures.as_completed(futures):
            row = futures[future]
            try:
                outcome = future.result()
                process(outcome)
            except Exception as exc:
                REPORT["errors"].append(str(row.get("title_ar"))[:70] + ": " + str(exc)[:180])
    print(json.dumps({key: value for key, value in REPORT.items() if key != "changes"}, ensure_ascii=False))
    if REPORT["errors"]:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    finally:
        with open("live-channel-maintenance-report.json", "w", encoding="utf-8") as file:
            json.dump(REPORT, file, ensure_ascii=False, indent=2)
