#!/usr/bin/env python3
"""Inspect all saved live channels, renew from the exact IPTV broadcaster ID,
and request protected cleanup only after repeated conclusive failures.
Uses GitHub OIDC with Supabase Edge; no long-lived database key in Actions.
"""
import concurrent.futures
import datetime as dt
import json
import os
import re
import urllib.parse
import urllib.request

from arabic_iptv_import import BASE, channel_uid, json_get, parse_m3u, read, stream_works, public_https

ENDPOINT = "https://qyzmlwtvzzgooccqxglq.supabase.co/functions/v1/aseel-link-health"
REPORT = {"checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
          "total": 0, "checked": 0, "working": 0, "replacements_sent": 0,
          "renewed": 0, "deleted": 0, "unconfirmed": 0, "errors": [],
          "catalog_available": False, "changes": []}

def get_oidc():
    target = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=al-ezz-media-link-health"
    req = urllib.request.Request(target, headers={
        "Authorization": "bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
    })
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)["value"]

def edge(token, payload):
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=165) as response:
        return json.load(response)

def parse_id(row):
    desc = row.get("description") or ""
    result = re.search(r"IPTV(?:-org)?(?: source)? ID:\s*([A-Za-z0-9_.+-]+(?:@[A-Za-z0-9_.+-]+)?)", desc, re.I)
    return result.group(1).split("@")[0] if result else ""

def get_sources(row):
    urls = [row.get("stream_url")]
    for item in row.get("stream_variants") or []:
        if isinstance(item, dict): urls.append(item.get("url"))
    return [str(x) for x in dict.fromkeys(urls) if isinstance(x, str) and x.strip() and public_https(x)]

def analyze(row, grouped, catalog_available):
    if row.get("playback_mode") == "official_link" or row.get("official_url") or row.get("youtube_url"):
        return "skip", None
    urls = get_sources(row)
    for url in urls:
        if stream_works(url):
            if url == row.get("stream_url"): return "healthy", None
            return "replace", {"id": row["id"], "new_url": url, "existing_variant": True}
    identity = parse_id(row)
    if identity and catalog_available:
        for url in grouped.get(identity, [])[:5]:
            if url not in urls and public_https(url) and stream_works(url):
                return "replace", {"id": row["id"], "new_url": url, "iptv_id": identity}
    return "unconfirmed", {"id": row["id"], "alternatives_checked": catalog_available}

def main():
    token = get_oidc()
    inventory = edge(token, {"mode": "channel_inventory"})
    rows = inventory.get("channels", [])
    REPORT["total"] = len(rows)
    grouped, available = {}, False
    try:
        blocked = {x.get("channel") for x in json_get(BASE + "/api/blocklist.json") if isinstance(x, dict)}
        playlist = parse_m3u(read(BASE + "/iptv/index.m3u", limit=24*1024*1024, timeout=40))
        for info, url in playlist:
            identity = channel_uid(info)
            if identity and identity not in blocked:
                grouped.setdefault(identity, [])
                if url not in grouped[identity]: grouped[identity].append(url)
        available = True
    except Exception as exc:
        REPORT["errors"].append("Source catalog unavailable; no destructive cleanup: " + str(exc)[:140])
    REPORT["catalog_available"] = available
    pending = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(analyze, row, grouped, available): row for row in rows}
        for future in concurrent.futures.as_completed(futures):
            row = futures[future]
            try:
                outcome, action = future.result()
                REPORT["checked"] += 1
                if outcome == "healthy": REPORT["working"] += 1
                elif outcome == "unconfirmed": REPORT["unconfirmed"] += 1
                if action: pending.append(action)
            except Exception as exc:
                REPORT["errors"].append(str(row.get("title_ar"))[:65] + ": " + str(exc)[:120])
    REPORT["replacements_sent"] = len([a for a in pending if a.get("new_url")])
    for i in range(0, len(pending), 12):
        result = edge(token, {"mode": "channel_repair", "actions": pending[i:i+12]})
        REPORT["renewed"] += int(result.get("renewed", 0))
        REPORT["deleted"] += int(result.get("deleted", 0))
        REPORT["changes"].extend(result.get("changes", []))
        REPORT["errors"].extend(result.get("errors", []))
    print(json.dumps({k: v for k,v in REPORT.items() if k != "changes"}, ensure_ascii=False))
    if REPORT["errors"]:
        raise RuntimeError(str(len(REPORT["errors"])) + " source checking errors; inspect report")

if __name__ == "__main__":
    try:
        main()
    finally:
        with open("live-channel-maintenance-report.json", "w", encoding="utf-8") as handle:
            json.dump(REPORT, handle, ensure_ascii=False, indent=2)
