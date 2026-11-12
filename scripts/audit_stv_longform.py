#!/usr/bin/env python3
"""Audit public STV index; no publication or file downloads. 25min strictly exceeded."""
import argparse, concurrent.futures, csv, datetime, json, math, os, re, subprocess, sys, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path

BASE="https://raw.githubusercontent.com/SUPERTV18/series-stv/main/"
FILES=("series-arabic.json","series-foreign.json","series-turkish.json","series-korean.json","movies-arabic.json")
UA="AlEzzTV-Metadata-Audit/1.0"
COLUMNS=("section","kind","title","year","title_id","season","episode","episode_title","hidden","original_url","final_url","redirects","http","content_type","media_kind","duration_seconds","status","reason","poster","referer")
class Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self): self.chain=[]
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.chain.append({"status":code,"url":newurl[:1800]})
        return super().redirect_request(req,fp,code,msg,headers,newurl)
def request(url, ref="", ua="", cap=350000, timeout=12):
    # Follow legitimate redirects, including CDN URL rewrites. Never rely on HEAD alone.
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!="https" or not parsed.hostname or parsed.hostname.lower() in {"localhost"}:
        raise ValueError("invalid HTTPS source")
    handler=Redirects()
    opener=urllib.request.build_opener(handler)
    headers={"User-Agent":ua or UA,"Range":"bytes=0-262143","Accept":"*/*"}
    if ref:headers["Referer"]=ref
    req=urllib.request.Request(url,headers=headers)
    with opener.open(req,timeout=timeout) as r:
        final=r.geturl();code=r.status;ctype=r.headers.get("Content-Type","").lower()
        if urllib.parse.urlsplit(final).scheme!="https":raise ValueError("redirected to non-HTTPS URL")
        data=r.read(cap)
    return {"body":data,"final":final,"redirects":handler.chain,"http":code,"ctype":ctype}
def hls(url, body, ref, ua):
    lines=body.decode("utf-8-sig","replace").splitlines()
    if not lines or lines[0].strip()!="#EXTM3U":return None
    if "#EXT-X-STREAM-INF" in body.decode("utf-8","replace"):
        opts=[]
        for i,line in enumerate(lines[:-1]):
            if line.startswith("#EXT-X-STREAM-INF:"):
                m=re.search(r"BANDWIDTH=(\d+)",line)
                nxt=next((x.strip() for x in lines[i+1:] if x.strip() and not x.startswith("#")),None)
                if nxt:opts.append((int(m.group(1)) if m else 0,urllib.parse.urljoin(url,nxt)))
        if not opts:return None
        child=sorted(opts,reverse=True)[0][1]
        result=request(child,ref,ua,cap=2_000_000)
        return hls(result["final"],result["body"],ref,ua)
    if not any(line.strip()=="#EXT-X-ENDLIST" for line in lines):return None
    durations=[]
    for line in lines:
        if line.startswith("#EXTINF:"):
            try:durations.append(float(line.split(":",1)[1].split(",",1)[0]))
            except ValueError:pass
    if not durations:return None
    return sum(durations)
def probe(url, ref, ua):
    cmd=["ffprobe","-v","error","-rw_timeout","12000000","-probesize","1000000","-analyzeduration","1500000"]
    if ua:cmd+=["-user_agent",ua]
    if ref:cmd+=["-headers","Referer: "+ref+"\r\n"]
    cmd+=["-show_entries","format=duration:stream=duration,codec_type","-of","json",url]
    out=subprocess.run(cmd,capture_output=True,text=True,timeout=22)
    if out.returncode:return None
    obj=json.loads(out.stdout)
    if not any(x.get("codec_type")=="video" for x in obj.get("streams",[])):return None
    ds=[obj.get("format",{}).get("duration")]+[x.get("duration") for x in obj.get("streams",[])]
    values=[float(x) for x in ds if x and str(x).replace(".","",1).isdigit() and math.isfinite(float(x))]
    return max(values) if values else None
def check(item):
    url=item["original_url"]
    entry={**item,"final_url":"","redirects":0,"http":None,"content_type":"","media_kind":"","duration_seconds":None,"status":"unverified","reason":""}
    if not url.startswith("https://"):
        entry.update(status="failed",reason="missing/invalid URL");return entry
    try:
        r=request(url,item.get("referer",""),item.get("user_agent",""))
        entry.update(final_url=r["final"],redirects=len(r["redirects"]),http=r["http"],content_type=r["ctype"])
        payload=r["body"]
        is_hls=payload.lstrip().startswith(b"#EXTM3U")
        is_mp4=b"ftyp" in payload[:80] or b"moov" in payload[:80]
        if not (is_hls or is_mp4):
            entry.update(status="failed",reason="not a recognized HLS/MP4 response");return entry
        entry["media_kind"]="HLS" if is_hls else "MP4"
        duration=hls(r["final"],payload,item.get("referer",""),item.get("user_agent","")) if is_hls else None
        if duration is None:duration=probe(url,item.get("referer",""),item.get("user_agent",""))
        if duration is not None and math.isfinite(duration):
            entry["duration_seconds"]=round(duration,2)
            if duration>1500:
                entry.update(status="verified",reason="media signature and duration >25min")
            else:entry.update(status="too_short",reason="verified duration is 25min or less")
        else:entry.update(status="unverified",reason="duration could not be proven")
    except (Exception) as exc:
        entry.update(status="unverified",reason=(type(exc).__name__+": "+str(exc))[:220])
    return entry
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",default="stv-audit")
    ap.add_argument("--limit",type=int,default=0)
    args=ap.parse_args()
    out=Path(args.out);out.mkdir(exist_ok=True,parents=True)
    works=[];sources=[];rows=[]
    for source in FILES:
        try:
            data=json.loads(request(BASE+source,cap=12_000_000,timeout=22)["body"].decode("utf-8-sig"))
            if not isinstance(data,list):raise ValueError("not a JSON array")
            sources.append({"file":source,"status":"ok","titles":len(data)})
            for title in data:
                typ="movie" if source.startswith("movies") else "series"
                ss=title.get("ss") or []
                for si,season in enumerate(ss,1):
                    if not isinstance(season,list):continue
                    for ei,ep in enumerate(season,1):
                        if not isinstance(ep,dict):continue
                        rows.append({"section":source,"kind":typ,"title":title.get("t",""),"year":title.get("y",""),
                          "title_id":title.get("k",""),"season":si,"episode":ei,"episode_title":ep.get("t",""),
                          "hidden":bool(title.get("hide")),"original_url":ep.get("u",""),
                          "poster":title.get("img",""),"referer":ep.get("ref",""),"user_agent":ep.get("ua","")})
        except Exception as exc:
            sources.append({"file":source,"status":"error","error":str(exc)[:200]})
    if args.limit:rows=rows[:args.limit]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for n,x in enumerate(pool.map(check,rows),1):
            works.append(x)
            if n%25==0:print("Checked",n,"/",len(rows),flush=True)
    counts={k:sum(x["status"]==k for x in works) for k in ("verified","too_short","failed","unverified")}
    summary={"checked_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":"SUPERTV18/series-stv",
      "minimum_duration_seconds_exclusive":1500,"sources":sources,"entries":len(works),"counts":counts,
      "titles_with_verified_sources":len(set(x["title_id"] for x in works if x["status"]=="verified" and not x["hidden"])),
      "note":"Neither HTTP redirects nor recorded runtimes alone imply playback. No media files downloaded. Rights not assessed."}
    (out/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    (out/"entries.json").write_text(json.dumps(works,ensure_ascii=False,indent=2),encoding="utf-8")
    with (out/"entries.csv").open("w",newline="",encoding="utf-8-sig") as fd:
        w=csv.DictWriter(fd,fieldnames=COLUMNS,extrasaction="ignore");w.writeheader();w.writerows(works)
    (out/"verified-only.json").write_text(json.dumps([x for x in works if x["status"]=="verified" and not x["hidden"]],ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(summary,ensure_ascii=False),flush=True)
if __name__=="__main__":main()
