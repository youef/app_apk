#!/usr/bin/env python3
"""Import reachable, unencrypted Arabic free-to-air IPTV HLS streams.

This does NOT grant distribution rights. Newly found channels remain drafts
with rights_status=pending until their owners' redistribution terms are checked.
Existing editor-managed channels are never overwritten or deleted.
"""
import concurrent.futures
import datetime as dt
import ipaddress
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

BASE = "https://iptv-org.github.io"
PROJECT_URL = os.getenv("SUPABASE_URL", "https://qyzmlwtvzzgooccqxglq.supabase.co").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
DRY_RUN = os.getenv("DRY_RUN", "").lower() in ("1", "true", "yes") or not SERVICE_KEY
ARAB_COUNTRIES = set("ae sa eg bh dz dj iq jo km kw lb ly ma mr om ps qa so sd sy tn ye".split())
CATEGORY_NAMES = {
    "movies": "قنوات عربية — أفلام",
    "series": "قنوات عربية — مسلسلات",
    "kids": "قنوات عربية — كرتون وأطفال",
    "news": "قنوات عربية — أخبار",
    "sports": "قنوات عربية — رياضة",
    "documentary": "قنوات عربية — وثائقيات",
    "religious": "قنوات عربية — دينية",
    "education": "قنوات عربية — تعليم",
    "music": "قنوات عربية — موسيقى",
    "cooking": "قنوات عربية — طبخ",
    "general": "قنوات عربية — منوعات",
}
MATCH_CATEGORY = [
    (r"movies?|cinema|aflam|films?|أفلام|سينما", "movies"),
    (r"drama|series|مسلسلات|دراما", "series"),
    (r"kids?|cartoon|animation|children|أطفال|كرتون", "kids"),
    (r"news|اخبار|أخبار|إخبارية", "news"),
    (r"sports?|soccer|رياضة|رياضي|كرة", "sports"),
    (r"documentary|documentaries|وثائق", "documentary"),
    (r"religious|quran|قرآن|إسلامية", "religious"),
    (r"education|تعليم", "education"),
    (r"music|موسيقى|أغاني", "music"),
    (r"cooking|food|طبخ", "cooking"),
]
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AlEzzTV-SourceHealth/1.0)", "Accept": "*/*"}
REPORT = {"dry_run": DRY_RUN, "source": "iptv-org", "candidates": 0,
          "verified": 0, "inserted": 0, "existing": 0, "failed": 0,
          "sample_verified": [], "errors": []}

def public_https(url):
    try:
        p = urllib.parse.urlsplit(url.strip())
        if p.scheme != "https" or not p.hostname or p.username or p.password:
            return False
        host = p.hostname.lower().rstrip(".")
        if host in ("localhost", "metadata.google.internal") or host.endswith((".local", ".internal")):
            return False
        try:
            if not ipaddress.ip_address(host).is_global:
                return False
        except ValueError:
            pass
        return True
    except Exception:
        return False

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not public_https(newurl):
            raise ValueError("Unsafe redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

HTTP = urllib.request.build_opener(SafeRedirect())

def read(url, limit=1024 * 1024, timeout=9, extra_headers=None):
    if not public_https(url):
        raise ValueError("Non-HTTPS or unsafe URL")
    req = urllib.request.Request(url, headers={**HEADERS, **(extra_headers or {})})
    with HTTP.open(req, timeout=timeout) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Response too large")
        return data

def json_get(url):
    return json.loads(read(url, 14 * 1024 * 1024, timeout=25))

def parse_m3u(data):
    result, item = [], {}
    for raw in data.decode("utf-8-sig", "replace").splitlines():
        line = raw.strip()
        if line.startswith("#EXTINF:"):
            item = dict(re.findall(r'([\w-]+)="([^"]*)"', line))
            item["title"] = line.rsplit(",", 1)[-1].strip()
        elif line.startswith("https://") and item:
            if public_https(line) and ".m3u8" in urllib.parse.urlsplit(line).path.lower():
                result.append((dict(item), line))
            item = {}
        elif line.startswith("http://") and item:
            item = {}
    return result

def stream_works(url):
    """Verify playlist plus a readable media segment; no DRM or transcoding."""
    try:
        for _ in range(3):
            payload = read(url, 250000, timeout=8).decode("utf-8-sig", "replace")
            if "#EXTM3U" not in payload[:200]:
                return False
            lines = [ln.strip() for ln in payload.splitlines() if ln.strip()]
            if any(ln.startswith("#EXT-X-KEY") and "METHOD=NONE" not in ln for ln in lines):
                return False
            if any("SAMPLE-AES" in ln or "skd://" in ln for ln in lines):
                return False
            variants = []
            for i, line in enumerate(lines[:-1]):
                if line.startswith("#EXT-X-STREAM-INF") and not lines[i+1].startswith("#"):
                    variants.append(lines[i+1])
            if variants:
                url = urllib.parse.urljoin(url, variants[-1])
                if not public_https(url):
                    return False
                continue
            segments = [ln for ln in lines if not ln.startswith("#") and ln]
            if not segments or not any(x.startswith("#EXTINF") or x.startswith("#EXT-X-PART") for x in lines):
                return False
            segment = urllib.parse.urljoin(url, segments[-1])
            if not public_https(segment):
                return False
            # Read only a small prefix; do not download or store protected media.
            req = urllib.request.Request(segment, headers={**HEADERS, "Range": "bytes=0-2047"})
            with HTTP.open(req, timeout=8) as response:
                return bool(response.read(256))
        return False
    except Exception:
        return False

def category_for(meta, title):
    tags = {str(x).lower() for x in meta.get("categories", [])}
    for group in ("movies", "series", "kids", "news", "sports",
                  "documentary", "religious", "education", "music", "cooking"):
        aliases = {"movies": {"movies", "movie"},
                   "sports": {"sports", "sport"},
                   "kids": {"kids", "animation", "family"},
                   "series": {"series", "drama"},
                   "documentary": {"documentary", "science", "nature"}}.get(group, {group})
        if tags & aliases:
            return group
    for expression, group in MATCH_CATEGORY:
        if re.search(expression, title, re.I):
            return group
    return "general"

def channel_uid(info):
    return re.sub(r"@[A-Za-z0-9_.+-]+$", "", info.get("tvg-id", "")).strip()

def norm(text):
    return re.sub(r"\s+", " ", re.sub(r"\s*\([^)]{1,25}\)\s*$", "", text)).strip().casefold()

def api(method, route, body=None):
    if not SERVICE_KEY:
        raise RuntimeError("Missing SUPABASE_SERVICE_ROLE_KEY GitHub Actions secret")
    url = PROJECT_URL + "/rest/v1/" + route
    headers = {"apikey": SERVICE_KEY, "Authorization": "Bearer " + SERVICE_KEY,
               "Content-Type": "application/json", "Accept": "application/json",
               "Prefer": "return=representation"}
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as rsp:
            response = rsp.read().decode("utf-8", "replace")
            return json.loads(response) if response else []
    except urllib.error.HTTPError as e:
        # Do not print auth headers or token.
        raise RuntimeError("Supabase API HTTP " + str(e.code) + ": " + e.read(500).decode("utf-8", "replace"))

def existing_channels():
    rows = []
    for offset in range(0, 10000, 500):
        page = api("GET", "aseel_channels?select=id,title_ar,stream_url,description,country_code,link_health_status,link_health_failures&limit=500&offset=" + str(offset))
        rows.extend(page)
        if len(page) < 500:
            break
    return rows


def refresh_managed_channels(rows):
    """Recheck only auto-imported channels; never demote editor-managed sources."""
    managed = [r for r in rows if (r.get("description") or "").startswith("IPTV-org source ID:")
               and r.get("stream_url") and public_https(r["stream_url"])]
    REPORT["rechecked"] = len(managed)
    REPORT["recovered"] = 0
    REPORT["became_suspect"] = 0
    REPORT["became_broken"] = 0
    if not managed or DRY_RUN:
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        outcomes = pool.map(lambda row: (row, stream_works(row["stream_url"])), managed)
        for row, works in outcomes:
            previous = row.get("link_health_status") or "unchecked"
            failures = 0 if works else int(row.get("link_health_failures") or 0) + 1
            status = "healthy" if works else ("broken" if failures >= 3 else "suspect")
            if previous == status and failures == 0:
                continue
            update = {"link_health_status": status, "link_health_failures": failures,
                      "link_health_checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                      "link_health_url": row["stream_url"]}
            api("PATCH", "aseel_channels?id=eq." + urllib.parse.quote(row["id"]), update)
            if status == "broken" and previous != "broken":
                REPORT["became_broken"] += 1
            elif status == "suspect" and previous != "suspect":
                REPORT["became_suspect"] += 1
            elif status == "healthy" and previous != "healthy":
                REPORT["recovered"] += 1

def main():
    print("Arabic IPTV source discovery; mode:", "DRY_RUN" if DRY_RUN else "WRITE")
    channels = json_get(BASE + "/api/channels.json")
    try:
        blocked = json_get(BASE + "/api/blocklist.json")
    except Exception:
        # If blocklist fails, fail closed instead of importing disputed entries.
        raise RuntimeError("IPTV-org blocklist unavailable; import halted")
    blocked_ids = {x.get("channel") for x in blocked if isinstance(x, dict)}
    metadata = {x.get("id"): x for x in channels if isinstance(x, dict) and x.get("id")}
    playlist = parse_m3u(read(BASE + "/iptv/index.m3u", 20 * 1024 * 1024, timeout=35))
    grouped = defaultdict(list)
    for info, url in playlist:
        uid = channel_uid(info)
        meta = metadata.get(uid)
        if not meta or uid in blocked_ids or meta.get("is_nsfw") or meta.get("closed"):
            continue
        country = (meta.get("country") or "").lower()
        languages = {str(x).lower() for x in meta.get("languages", [])}
        if country not in ARAB_COUNTRIES and not languages.intersection(("ara", "ar")):
            continue
        # No transient signed links or DRM services.
        if re.search(r"(?i)[?&](token|expires|signature|sig|auth|key)=", url):
            continue
        if url not in grouped[uid]:
            grouped[uid].append(url)
    REPORT["candidates"] = len(grouped)
    print("Distinct eligible channels:", len(grouped))
    if DRY_RUN and not SERVICE_KEY:
        print("No write credential. Stream checks continue and output a report.")
    db_rows = existing_channels() if SERVICE_KEY else []
    refresh_managed_channels(db_rows)
    urls = {r.get("stream_url") for r in db_rows if r.get("stream_url")}
    names = {(norm(r.get("title_ar") or ""), (r.get("country_code") or "").lower()) for r in db_rows}
    to_check = []
    for uid, links in grouped.items():
        meta = metadata[uid]
        name = str(meta.get("name") or uid).strip()[:200]
        country = (meta.get("country") or "").upper()
        if any(u in urls for u in links) or (norm(name), country.lower()) in names:
            REPORT["existing"] += 1
            continue
        to_check.append((uid, name, country, meta, links[:3]))
    max_channels = int(os.getenv("MAX_CHANNELS", "2000"))
    # Favor researched channels in our project watchlist without bypassing
    # either technical checks or license review.
    with open("data/arabic-channel-watchlist.json", encoding="utf-8") as watch_file:
        watchlist = json.load(watch_file).get("candidates", [])
    priority_ids = {row["id"] for row in watchlist if row.get("id")}
    to_check.sort(key=lambda x: (x[0] not in priority_ids, x[1].casefold()))
    REPORT["watchlist_total"] = len(priority_ids)
    REPORT["watchlist_found_in_source"] = len(priority_ids.intersection(set(grouped.keys())))
    REPORT["watchlist_new_to_check"] = sum(item[0] in priority_ids for item in to_check)
    to_check = to_check[:max_channels]
    print("New candidates requiring verification:", len(to_check))
    def verify(item):
        uid, name, country, meta, links = item
        for url in links:
            if stream_works(url):
                return item, url
        return item, None
    verified = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for item, url in pool.map(verify, to_check):
            if url:
                verified.append((item, url))
            else:
                REPORT["failed"] += 1
    REPORT["verified"] = len(verified)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    categories = {}
    if SERVICE_KEY:
        for row in api("GET", "aseel_categories?select=id,name_ar&limit=500"):
            categories[row["name_ar"]] = row["id"]
    payloads = []
    for (uid, name, country, meta, links), url in verified:
        category = category_for(meta, name)
        data = {
            "title_ar": name,
            "description": "IPTV-org source ID: " + uid + ". Link availability does not grant redistribution rights.",
            "stream_url": url,
            "category_id": categories.get(CATEGORY_NAMES[category]),
            "country_code": country or None,
            "language_code": "ar" if "ara" in (meta.get("languages") or []) else "und",
            "genre_tags": [category],
            "is_kids": category == "kids",
            "playback_mode": "stream",
            "status": "draft",
            "rights_status": "pending",
            "link_health_status": "healthy",
            "link_health_url": url,
            "link_health_checked_at": now,
            "link_health_failures": 0,
        }
        if not data["category_id"]:
            REPORT["errors"].append("Missing category: " + CATEGORY_NAMES[category])
            continue
        payloads.append(data)
        if len(REPORT["sample_verified"]) < 30:
            REPORT["sample_verified"].append({"name": name, "country": country, "category": category, "url": url})
    if not DRY_RUN:
        for start in range(0, len(payloads), 30):
            batch = payloads[start:start+30]
            try:
                result = api("POST", "aseel_channels", batch)
                REPORT["inserted"] += len(result)
            except Exception as exc:
                REPORT["errors"].append(str(exc))
                print("Batch failed:", str(exc))
    print(json.dumps({k: v for k, v in REPORT.items() if k != "sample_verified"}, ensure_ascii=False))
    with open("arabic-channels-report.json", "w", encoding="utf-8") as file:
        json.dump(REPORT, file, ensure_ascii=False, indent=2)
    if REPORT["errors"]:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        REPORT["errors"].append(str(exc))
        with open("arabic-channels-report.json", "w", encoding="utf-8") as file:
            json.dump(REPORT, file, ensure_ascii=False, indent=2)
        print("Importer failed:", str(exc), file=sys.stderr)
        sys.exit(1)
