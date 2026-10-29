#!/usr/bin/env python3
"""Decode-level test for public movie source CODECS on the CI runner.
This cannot verify real Android 4.4 hardware decoding, but detects non-H264 files.
"""
import json,subprocess,concurrent.futures,shutil,time,os
def inspect(c):
    cmd=["ffprobe","-v","error","-rw_timeout","10000000","-probesize","250000",
         "-analyzeduration","500000","-show_entries",
         "stream=codec_name,codec_type,width,height,profile:format=duration",
         "-of","json",c["url"]]
    try:
        r=subprocess.run(cmd,text=True,capture_output=True,timeout=25)
        if r.returncode:
            return {"name":c["name"],"ok":False,"error":r.stderr[-220:]}
        result=json.loads(r.stdout or "{}")
        videos=[v for v in result.get("streams",[]) if v.get("codec_type")=="video"]
        audios=[v for v in result.get("streams",[]) if v.get("codec_type")=="audio"]
        codec=videos[0].get("codec_name") if videos else None
        return {"name":c["name"],"url":c["url"],"ok":bool(videos),
                "codec":codec,"device_friendly":codec=="h264",
                "width":videos[0].get("width") if videos else None,
                "height":videos[0].get("height") if videos else None,
                "audio_codecs":[x.get("codec_name") for x in audios],
                "duration":result.get("format",{}).get("duration")}
    except Exception as e:
        return {"name":c["name"],"ok":False,"error":str(e)[:220]}
def main():
    with open("scripts/media-candidates.json",encoding="utf-8") as f:
        c=[x for x in json.load(f)["candidates"] if x["url"].lower().endswith(".mp4")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        r=list(pool.map(inspect,c))
    for x in r:print(("PASS " if x["ok"] else "FAIL ")+json.dumps(x,ensure_ascii=False),flush=True)
    with open("codec-audit.json","w") as f:json.dump({"checked_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"results":r},f,indent=2)
    print("H264 COUNT",sum(x.get("device_friendly",False) for x in r),"of",len(r))
if __name__=="__main__":main()
