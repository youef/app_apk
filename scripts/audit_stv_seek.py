#!/usr/bin/env python3
"""Verify actual late-frame playback, not just claimed metadata duration."""
import argparse,concurrent.futures,csv,datetime,json,os,re,subprocess
from urllib.parse import urlsplit
HOST=re.compile(r"^vid\d{1,2}\.(?:ujeklsj\.site|zvde-dsn-0[12]\.site|d-s-finsh847\.xyz|2026-ss\.xyz)$",re.I)
def audit(item):
    url=str(item.get("original_url") or "")
    r={k:item.get(k) for k in ("section","title","season","episode","duration_seconds")}
    r.update(url=url,status="unverified",seek_second=None,note="")
    try:
        u=urlsplit(url)
        if u.scheme!="https" or not HOST.fullmatch(u.hostname or "") or u.username or u.password or u.port not in (None,443):
            r.update(status="invalid_url",note="Unapproved host or URL");return r
        if not u.path.lower().endswith((".mp4",".m3u8",".mkv",".webm",".m4v",".mov",".mpd")):
            r.update(status="unsupported_path",note="Client cannot play this extension");return r
        dur=float(item.get("duration_seconds") or 0)
        if dur<=1500 or dur>=36000:
            r.update(status="unverified",note="Invalid declared duration");return r
        second=max(1510,min(int(dur*.82),int(dur-45)));r["seek_second"]=second
        cmd=["ffmpeg","-hide_banner","-nostdin","-loglevel","error","-rw_timeout","14000000",
             "-ss",str(second),"-i",url,"-map","0:v:0","-frames:v","1","-an","-sn","-f","null","-"]
        try:
            out=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,timeout=32)
            r["status"]="seek_verified" if out.returncode==0 else "seek_failed"
            r["note"]="Decoded a frame after minute 25" if out.returncode==0 else "Cannot decode a frame after minute 25"
        except subprocess.TimeoutExpired:
            r.update(status="seek_timeout",note="Late frame request timed out")
    except Exception as e:r.update(status="unverified",note=type(e).__name__)
    return r
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",default="stv-original/verified-only.json")
    p.add_argument("--out",default="stv-seek-audit")
    p.add_argument("--limit",type=int,default=0)
    a=p.parse_args()
    with open(a.input,encoding="utf-8") as f:rows=json.load(f)
    if a.limit:rows=rows[:a.limit]
    os.makedirs(a.out,exist_ok=True)
    result=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=14) as ex:
        for i,r in enumerate(ex.map(audit,rows),1):
            result.append(r)
            if i%25==0:print("AUDITED",i,"/",len(rows),flush=True)
    counts={k:sum(r["status"]==k for r in result) for k in ("seek_verified","seek_failed","seek_timeout","unsupported_path","invalid_url","unverified")}
    summary={"run":"43210059466","checked_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
             "total":len(result),"counts":counts,"method":"Decode one real frame after minute 25",
             "publication":"No database changes"}
    for name,obj in (("summary.json",summary),("results.json",result),("needs-review.json",[r for r in result if r["status"]!="seek_verified"])):
        with open(os.path.join(a.out,name),"w",encoding="utf-8") as f:json.dump(obj,f,ensure_ascii=False,indent=2)
    with open(os.path.join(a.out,"results.csv"),"w",newline="",encoding="utf-8-sig") as f:
        cols=("section","title","season","episode","status","seek_second","duration_seconds","url","note")
        w=csv.DictWriter(f,fieldnames=cols,extrasaction="ignore");w.writeheader();w.writerows(result)
    print(json.dumps(summary,ensure_ascii=False),flush=True)
if __name__=="__main__":main()
