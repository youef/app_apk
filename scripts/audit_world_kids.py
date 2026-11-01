#!/usr/bin/env python3
"""Read-only inventory and HLS health check of worldwide kids TV streams.
Does not infer or approve rebroadcast rights; never publishes streams.
Only log safe, HTTPS, non-credentialed candidate URLs, and only when a real
HLS manifest is fetched. Do not download, decode or save video segments.
"""
import concurrent.futures
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone

PLAYLIST = "https://iptv-org.github.io/iptv/categories/kids.m3u"
META_URL = "https://iptv-org.github.io/api/channels.json"
TIMEOUT = 7
USER_AGENT = "AlEzzTV-ChildrenSourceHealth/1.0 (+manifest checks only)"
SENSITIVE = re.compile(r"(?i)(token|session|auth|secret|password|passwd|signature|sig|hdnea|hdnts|key=|user=)")
CREDENTIAL_PATH = re.compile(r"(?i)/live/[^/]+/[^/]+/|/get\.php|/player_api\.php")
TITLE_RE = re.compile(r'([a-zA-Z-]+)="([^"]*)"')

def request_bytes(url, cap):
    req=urllib.request.Request(url,headers={
      "User-Agent":USER_AGENT,
      "Accept":"application/vnd.apple.mpegurl,application/x-mpegURL,*/*"
    })
    with urllib.request.urlopen(req,timeout=TIMEOUT) as rsp:
        return rsp.status, rsp.url, rsp.read(cap)

def parse_m3u(data):
    items=[]; attributes={};title=""
    for raw in data.decode("utf-8-sig","replace").splitlines():
        line=raw.strip()
        if line.startswith("#EXTINF:"):
            attributes=dict(TITLE_RE.findall(line))
            title=line.partition(",")[2].strip()
        elif line.startswith(("https://","http://")):
            if title: items.append({"title":title,"id":attributes.get("tvg-id",""),
                "url":line,"logo":attributes.get("tvg-logo",""),"group":attributes.get("group-title","")})
            attributes={};title=""
    return items

def permitted_candidate(item):
    url=item["url"]
    try:
        p=urllib.parse.urlsplit(url)
        if p.scheme!="https" or not p.hostname or p.username or p.password:return False,"non_https_or_credentials"
        if len(url)>550 or not re.search(r"\.m3u8(?:[?#]|$)",p.path,re.I):return False,"not_plain_https_hls"
        if p.query or SENSITIVE.search(url) or CREDENTIAL_PATH.search(p.path):return False,"token_or_credential_risk"
        if p.port and p.port not in (443,8443,1936):return False,"unusual_port"
        return True,"eligible"
    except Exception:return False,"invalid_url"

def probe(item):
    result={"title":item["title"],"id":item["id"],"group":item["group"],"url":item["url"],"status":"unknown"}
    try:
        code,final,body=request_bytes(item["url"],131072)
        text=body.decode("utf-8-sig","replace")
        ok=text.startswith("#EXTM3U") and bool(re.search(r"#EXT-X-(?:STREAM-INF|TARGETDURATION|MEDIA-SEQUENCE)",text))
        encrypted=bool(re.search(r"#EXT-X-KEY:.*METHOD=(?!NONE)",text,re.I))
        if ok and not encrypted and "#EXT-X-STREAM-INF" in text:
            variants=[s.strip() for s in text.splitlines() if s.strip() and not s.startswith("#")]
            if variants:
                sub=urllib.parse.urljoin(final,variants[0])
                # Only follow safe https variant URLs; no segments
                p=urllib.parse.urlsplit(sub)
                if p.scheme=="https" and not SENSITIVE.search(sub):
                    code2,_,data2=request_bytes(sub,131072)
                    t2=data2.decode("utf-8-sig","replace")
                    ok=code2==200 and t2.startswith("#EXTM3U") and "#EXT-X-" in t2
                    encrypted=encrypted or bool(re.search(r"#EXT-X-KEY:.*METHOD=(?!NONE)",t2,re.I))
                else:ok=False
        result["status"]="manifest_ok" if code==200 and ok and not encrypted else ("encrypted" if encrypted else "invalid_manifest")
    except urllib.error.HTTPError as e:
        result["status"]="http_"+str(e.code)
    except Exception:
        result["status"]="unreachable"
    return result

def main():
    code,_,data=request_bytes(PLAYLIST,1024*1024)
    if code!=200:raise SystemExit("Kids playlist unavailable")
    raw=parse_m3u(data)
    unique={};filtered=Counter()
    for item in raw:
        safe,why=permitted_candidate(item)
        if not safe:filtered[why]+=1;continue
        # A stream may appear with several names; keep first
        unique.setdefault(item["url"],item)
    meta={}
    try:
        _,_,b=request_bytes(META_URL,30000000)
        channels=json.loads(b)
        if isinstance(channels,list):
            meta={x.get("id"):x for x in channels if isinstance(x,dict) and x.get("id")}
    except Exception:
        pass
    items=list(unique.values())
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        results=list(pool.map(probe,items))
    status=Counter(r["status"] for r in results)
    approved=[r for r in results if r["status"]=="manifest_ok"]
    output=[]
    for r in approved:
        m=meta.get(r["id"],{})
        c=(m.get("country") or "").upper()
        if not re.fullmatch(r"[A-Z]{2}",c):
            tail=re.search(r"\.([a-z]{2})$",r["id"],re.I)
            c=tail.group(1).upper() if tail else ""
        languages=m.get("languages") or []
        lang=str(languages[0]).lower() if languages else ""
        if not re.fullmatch(r"[a-z]{2,3}",lang):lang="und"
        row={"name":r["title"][:190],"url":r["url"],"channel_id":r["id"][:120],
             "country":c,"lang":lang,"group":r["group"][:80],"status":"manifest_ok"}
        output.append(row)
        print("KIDS_OK_JSON "+json.dumps(row,ensure_ascii=False,separators=(",",":")),flush=True)
    report={"checked_at":datetime.now(timezone.utc).isoformat(),"source":PLAYLIST,
            "warning":"Manifest reachability is not video playback or legal permission to redistribute",
            "source_entries":len(raw),"eligible_unique_https_hls":len(items),
            "statuses":dict(status),"skipped":dict(filtered),"manifest_ok":len(output),"results":results}
    with open("kids-global-audit.json","w",encoding="utf-8") as f:json.dump(report,f,ensure_ascii=False,indent=2)
    print("KIDS_SUMMARY_JSON "+json.dumps({k:report[k] for k in
          ("source_entries","eligible_unique_https_hls","statuses","skipped","manifest_ok")},ensure_ascii=False),flush=True)

if __name__=="__main__":
    main()
