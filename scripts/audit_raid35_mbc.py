#!/usr/bin/env python3
"""Read-only MBC playlist availability audit: check playlist manifests, not videos.
No DRM handling, downloading segments, credentials, publication or database changes.
"""
import concurrent.futures
import datetime
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

SOURCE = "https://raw.githubusercontent.com/raid35/Arab/main/MBC.m3u"
AGENT = "Mozilla/5.0 (compatible; AlEzzTV-LinkAudit/1.0)"
HEADERS = {"User-Agent": AGENT, "Accept": "application/vnd.apple.mpegurl,application/dash+xml,*/*"}
TIMEOUT = 12

def get(url, limit=262144):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
        data = response.read(limit)
        return response.status, response.url, response.headers.get("Content-Type", ""), data

def parse_playlist(raw):
    title = ""
    group = ""
    items = []
    for line in raw.decode("utf-8-sig", "replace").splitlines():
        line = line.strip()
        if line.startswith("#EXTINF"):
            title = line.partition(",")[2].strip() or "بدون اسم"
            match = re.search(r'group-title="([^"]*)"', line)
            group = match.group(1) if match else ""
        elif line.startswith(("http://", "https://")):
            kind = "HLS" if re.search(r"\.m3u8(?:[?#]|$)",line,re.I) else ("DASH" if re.search(r"\.mpd(?:[?#]|$)",line,re.I) else "other")
            items.append({"name": title, "group": group, "url": line, "kind": kind})
            title = ""
            group = ""
    return items

def check(item):
    url = item["url"]
    out = {"name": item["name"], "type": item["kind"], "host": urllib.parse.urlparse(url).hostname,
           "protocol": urllib.parse.urlparse(url).scheme, "status": "unknown",
           "http": None, "manifest": False, "encrypted_or_drm": False}
    try:
        code, final_url, content_type, data = get(url)
        out["http"] = code
        out["mime"] = content_type
        out["final_host"] = urllib.parse.urlparse(final_url).hostname
        text = data.decode("utf-8-sig", "replace")
        if item["kind"] == "HLS":
            out["manifest"] = text.startswith("#EXTM3U") and bool(re.search(r"#EXT-X-(?:STREAM-INF|TARGETDURATION|MEDIA-SEQUENCE)",text))
            out["encrypted_or_drm"] = bool(re.search(r"#EXT-X-KEY:.*METHOD=(?!NONE)",text,re.I))
            if out["manifest"] and "#EXT-X-STREAM-INF" in text:
                links = [line.strip() for line in text.splitlines()
                         if line.strip() and not line.strip().startswith("#")]
                if links:
                    variant_url = urllib.parse.urljoin(final_url,links[0])
                    try:
                        code2, _, _, body2 = get(variant_url)
                        variant = body2.decode("utf-8-sig","replace")
                        out["variant_http"] = code2
                        out["variant_manifest"] = variant.startswith("#EXTM3U") and "#EXT-X-" in variant
                        out["encrypted_or_drm"] |= bool(re.search(r"#EXT-X-KEY:.*METHOD=(?!NONE)",variant,re.I))
                        if not out["variant_manifest"]:
                            out["manifest"] = False
                    except urllib.error.HTTPError as e:
                        out["variant_http"] = e.code
                        out["manifest"] = False
                    except Exception as e:
                        out["variant_error"] = type(e).__name__ + ": " + str(e)[:130]
                        out["manifest"] = False
        elif item["kind"] == "DASH":
            try:
                root = ET.fromstring(data)
                out["manifest"] = root.tag.rsplit("}",1)[-1] == "MPD"
                out["encrypted_or_drm"] = any(e.tag.rsplit("}",1)[-1] == "ContentProtection" for e in root.iter())
                out["has_media"] = any(e.tag.rsplit("}",1)[-1] == "Representation" for e in root.iter())
            except ET.ParseError:
                out["manifest"] = False
        out["status"] = "manifest_ok" if code==200 and out["manifest"] else "invalid_manifest"
        if out["status"] == "manifest_ok" and out["encrypted_or_drm"]:
            out["status"] = "manifest_drm_or_encrypted"
    except urllib.error.HTTPError as e:
        out["status"] = "http_error"
        out["http"] = e.code
    except Exception as e:
        out["status"] = "network_error"
        out["error"] = type(e).__name__ + ": " + str(e)[:150]
    return out

def main():
    try:
        _,_,_,content = get(SOURCE,512000)
        items = parse_playlist(content)
    except Exception as exc:
        print("SOURCE_FAILURE", type(exc).__name__,str(exc)[:200])
        raise SystemExit(1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        reports = list(pool.map(check, items))
    report={"utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "source":"raid35/Arab MBC.m3u",
            "note":"Manifest checks only. Not proof of playable segments, regional access or rebroadcast rights.",
            "total":len(items),"results":reports}
    with open("mbc-link-audit.json","w",encoding="utf-8") as f:
        json.dump(report,f,indent=2,ensure_ascii=False)
    for i,r in enumerate(reports,1):
        info=" ".join([str(i),r["name"],r["type"],r["status"],str(r["http"]),
                     "DRM="+str(r["encrypted_or_drm"])])
        if r.get("variant_http") is not None: info+=" variant="+str(r["variant_http"])
        if r.get("error"): info+=" "+r["error"]
        print(info,flush=True)
    for key in sorted({r["status"] for r in reports}):
        print("COUNT",key,sum(r["status"]==key for r in reports),flush=True)

if __name__ == "__main__":
    main()
