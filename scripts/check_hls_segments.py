#!/usr/bin/env python3
"""Try playing the *actual bytes* of an HLS media segment from each public live channel.
This is a network transport check, not proof of broadcaster redistribution rights
or proof of device decoding; never suppress errors in the report.
"""
import concurrent.futures,json,urllib.request,urllib.parse,time,os
def read(url,max_bytes=65536):
    request=urllib.request.Request(url,headers={"User-Agent":"AseelTV-Check/1.0","Accept":"*/*","Range":"bytes=0-65535"})
    with urllib.request.urlopen(request,timeout=15) as r:
        data=r.read(max_bytes)
        return r.status,r.headers.get("Content-Type",""),data,r.geturl()
def fetch(url):
    out={"url":url,"ok":False}
    try:
        for level in range(3):
            code,typ,data,real=read(url)
            if not data.lstrip(b"\xef\xbb\xbf").startswith(b"#EXTM3U"):
                out["error"]="Invalid HLS manifest";return out
            raw=data.decode("utf-8","replace")
            items=[line.strip() for line in raw.splitlines() if line.strip() and not line.startswith("#")]
            if not items:
                out["error"]="HLS playlist missing any URI";return out
            if "#EXT-X-STREAM-INF" in raw:
                # Work from the first variant; test that the real media is reachable.
                url=urllib.parse.urljoin(real,items[0]);continue
            if "#EXT-X-KEY" in raw:
                out["error"]="Encrypted stream, not unconditionally playable";return out
            if "#EXTINF" in raw or "#EXT-X-MAP" in raw:
                import re
                m=re.search(r'#EXT-X-MAP:URI="([^"]+)"',raw)
                media=urllib.parse.urljoin(real,m.group(1)) if m else urllib.parse.urljoin(real,items[0])
                sc,st,chunk,final=read(media,4096)
                is_ts=len(chunk)>=188 and chunk[0]==0x47
                is_mp4=b"ftyp" in chunk[:64] or b"styp" in chunk[:64] or b"moof" in chunk[:64]
                if sc in (200,206) and (is_ts or is_mp4):
                    out.update({"ok":True,"segment_http":sc,"media_bytes":len(chunk),"format":"TS" if is_ts else "fMP4","media_url":final.split("?")[0]})
                else:
                    out.update({"error":"Invalid media segment bytes","segment_http":sc,"format":st,"prefix":chunk[:12].hex()})
                return out
            out["error"]="Unrecognized media playlist";return out
        out["error"]="Too many nested variants";return out
    except Exception as e:
        out["error"]=str(e)[:180];return out
def main():
    with open("scripts/media-candidates.json",encoding="utf-8") as f:
        items=json.load(f)["candidates"]
    try:
        with open("scripts/free-tv-candidates.json",encoding="utf-8") as fd:
            extra=json.load(fd).get("candidates",[])
        existing={x["url"] for x in items}
        items += [x for x in extra if x.get("url","").startswith("https://") and x["url"] not in existing]
    except (OSError,ValueError,KeyError) as ex:
        print("Free-TV candidates not loaded",str(ex),flush=True)
    streams=[x for x in items if ".m3u8" in x["url"]]
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        checked=list(pool.map(lambda x: dict({"name":x["name"]},**fetch(x["url"])),streams))
    for x in checked:
        print(("PASS " if x["ok"] else "FAIL ")+json.dumps(x,ensure_ascii=False),flush=True)
    with open("hls-segment-audit.json","w",encoding="utf-8") as f:
        json.dump({"when":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"results":checked},f,ensure_ascii=False,indent=2)
    print("SUMMARY segments reachable",sum(x["ok"] for x in checked),"of",len(checked),flush=True)
if __name__=="__main__":main()
