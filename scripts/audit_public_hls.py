#!/usr/bin/env python3
"""Probe a small, curated set of unencrypted public HLS candidates.
HTTP reachability alone does NOT establish redistribution rights.
Never publish automatically. No credentials, DRM keys or user data.
"""
import json, urllib.request, urllib.parse, ssl, re
from datetime import datetime, timezone

CANDIDATES = [
 {"channel":"Ajman TV","country":"AE","url":"https://cdn1.logichost.in/ajmantv/live/playlist.m3u8","source":"iptv-org/iptv streams/ae.m3u","rights":"unverified"},
 {"channel":"CNBC Arabia","country":"AE","url":"https://cnbc-live.akamaized.net/cnbc/master.m3u8","source":"iptv-org/iptv streams/ae.m3u","rights":"unverified"},
 {"channel":"Fujairah TV","country":"AE","url":"https://live.kwikmotion.com/fujairahlive/fujairah.smil/playlist.m3u8","source":"iptv-org/iptv streams/ae.m3u","rights":"unverified"},
 {"channel":"Al Araby TV 2","country":"QA","url":"https://live.kwikmotion.com/alaraby2live/alaraby2.smil/playlist.m3u8","source":"iptv-org/iptv streams/qa.m3u","rights":"unverified"},
 {"channel":"Al Quran Al Kareem TV","country":"SA","url":"https://cdn-globecast.akamaized.net/live/eds/saudi_quran/hls_roku/index.m3u8","source":"iptv-org/iptv streams/sa.m3u","rights":"unverified"}
]

def probe(c):
    result={k:c[k] for k in ("channel","country","source","rights")}
    try:
        req=urllib.request.Request(c["url"],headers={"User-Agent":"AlEzzTV-StreamAudit/1.0","Accept":"application/vnd.apple.mpegurl,application/x-mpegURL,*/*"})
        with urllib.request.urlopen(req,timeout=9) as response:
            body=response.read(131072).decode("utf-8","replace")
            result["http_status"]=response.status
            result["final_host"]=urllib.parse.urlparse(response.url).hostname
        result["valid_hls"]=body.lstrip("\ufeff").startswith("#EXTM3U") and bool(re.search(r"#EXT-X-(STREAM-INF|TARGETDURATION|MEDIA-SEQUENCE)",body))
        result["drm_present"]=bool(re.search(r"#EXT-X-KEY:.*METHOD=(?!NONE)",body))
        result["status"]="manifest_ok" if result["valid_hls"] and not result["drm_present"] else "not_usable"
    except Exception as e:
        result["status"]="unreachable"
        result["error"]=str(e)[:200]
    return result

if __name__=="__main__":
    data={"checked_at":datetime.now(timezone.utc).isoformat(),"notice":"Manifest checks are not playback tests or evidence of redistribution rights. No automatic publishing.","results":[probe(c) for c in CANDIDATES]}
    with open("stream-audit.json","w",encoding="utf-8") as f:
        json.dump(data,f,indent=2,ensure_ascii=False)
    for row in data["results"]:
        print(row["channel"],row["status"])
