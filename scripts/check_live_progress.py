#!/usr/bin/env python3
"""Check a free-to-air HLS stream is actually advancing as live video.
Reads the first variant playlist twice, 16 seconds apart. Does NOT infer
copyright/retransmission permission. Checks do not replace device playback.
"""
import concurrent.futures,urllib.request,urllib.parse,json,time,re,datetime
def fetch(url):
    r=urllib.request.Request(url,headers={"User-Agent":"AseelTV-Stream-Audit/1.0","Accept-Encoding":"identity"})
    with urllib.request.urlopen(r,timeout=13) as result:
        data=result.read(200000)
        return result.geturl(),data.decode("utf-8-sig","replace")
def playlist(url):
    for _ in range(3):
        real,body=fetch(url)
        if not body.startswith("#EXTM3U"):raise ValueError("Not HLS media")
        if "METHOD=AES-128" in body or "METHOD=SAMPLE-AES" in body:raise ValueError("Encrypted HLS")
        if "#EXT-X-STREAM-INF" not in body:
            if "#EXT-X-ENDLIST" in body:raise ValueError("Static VOD not live")
            seq=re.search(r"#EXT-X-MEDIA-SEQUENCE:(\d+)",body)
            ts=re.search(r"#EXT-X-TARGETDURATION:(\d+)",body)
            media=[q.strip() for q in body.splitlines() if q.strip() and not q.startswith("#")]
            if not media:raise ValueError("Empty HLS media playlist")
            return {"sequence":int(seq.group(1)) if seq else None,
                    "last":media[-1],"target_duration":int(ts.group(1)) if ts else None}
        lines=[q.strip() for q in body.splitlines() if q.strip()]
        idx=next((i for i,v in enumerate(lines) if v.startswith("#EXT-X-STREAM-INF")),None)
        if idx is None or idx+1>=len(lines):raise ValueError("No playable HLS variant")
        url=urllib.parse.urljoin(real,lines[idx+1])
    raise ValueError("Too many variant redirects")
def probe(item):
    try:
        a=playlist(item["url"])
        time.sleep(16)
        b=playlist(item["url"])
        advance=((a["sequence"] is not None and b["sequence"] is not None and
                  b["sequence"]>a["sequence"]) or a["last"]!=b["last"])
        return {"name":item["name"],"url":item["url"],"advancing":advance,
                "first":a,"second":b,"reason":None if advance else "Live playlist did not advance within 16 seconds"}
    except Exception as exc:
        return {"name":item["name"],"url":item["url"],"advancing":False,"reason":str(exc)[:250]}
def main():
    with open("scripts/free-tv-passed.json",encoding="utf-8") as f:
        channels=json.load(f)["candidates"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        results=list(pool.map(probe,channels))
    for r in results:print(("PASS " if r["advancing"] else "FAIL ")+json.dumps(r,ensure_ascii=False),flush=True)
    with open("free-tv-live-progress.json","w",encoding="utf-8") as f:
        json.dump({"checked_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "results":results},f,ensure_ascii=False,indent=2)
    print("LIVE PROGRESSION",sum(x["advancing"] for x in results),"of",len(results),flush=True)
if __name__=="__main__":main()
