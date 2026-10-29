#!/usr/bin/env python3
"""Verify live media URLs with a real byte-range request (no browser simulation).
Exit 0 even when individual sources fail so a report is always uploaded.
Never treats mere HTTP 200 on a webpage as a playable movie.
"""
import concurrent.futures, json, ssl, urllib.error, urllib.request, time, sys
SOURCES={
"MDN Flower CC0":"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
"Blender Bunny old":"https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4",
"Blender Sintel trailer":"https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4",
"Blender Elephants webseed":"https://video.blender.org/static/webseed/cccc3e60-0291-4ecc-aa56-39b2e2c7d0d5-720.mp4",
"Blender Agent 327 webseed":"https://video.blender.org/static/webseed/264ff760-803e-430e-8d81-15648e904183-720.mp4",
"Blender Coffee Run webseed":"https://video.blender.org/static/webseed/ff8fe61b-026f-4f07-b66b-2a790d6f6ab1-720.mp4",
"Blender Spring webseed":"https://video.blender.org/static/webseed/3d95fb3d-c866-42c8-9db1-fe82f48ccb95-720.mp4",
"Blender Sintel full webseed":"https://video.blender.org/static/webseed/0eb052d0-fd51-43e6-aa33-ecdbf77a5d40-720.mp4",
"Blender Tears webseed":"https://video.blender.org/static/webseed/8533ea43-4271-4a57-9694-e9d0b35e1aa1-720.mp4",
"Blender Glass webseed":"https://video.blender.org/static/webseed/64222c8a-c4c7-4b3b-9850-7fb2078edcf6-720.mp4",
"Blender Sprite Fright webseed":"https://video.blender.org/download/videos/a69d68a5-a0e0-4a80-9d66-49f093c97aaf-720.mp4",
"Blender Caminandes gran":"https://video.blender.org/static/webseed/fb70d459-48d2-4db5-adba-813c84f9200a-720.mp4",
"Blender Caminandes llamigos":"https://video.blender.org/static/webseed/23f3ef79-15dc-44c5-aa45-cf92e78a4509-720.mp4",
"Blender Cosmos Laundromat":"https://video.blender.org/static/webseed/f507dfdc-e73e-45a4-9778-d758cbe1ce96-720.mp4",
"Google Bunny sample":"https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
"Google Elephants sample":"https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
"Google Sintel sample":"https://storage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
"Google Tears sample":"https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
"Blender official Bunny sample":"https://download.blender.org/demo/movies/BBB/bbb_sunflower_360p_30fps_normal.mp4",
}
def check(entry):
    name,url=entry
    start=time.monotonic()
    try:
        req=urllib.request.Request(url, headers={
            "User-Agent":"AseelTV-Media-Availability/1.0",
            "Range":"bytes=0-16383","Accept":"video/mp4,application/octet-stream,*/*"})
        with urllib.request.urlopen(req, timeout=18, context=ssl.create_default_context()) as response:
            code=response.status
            ctype=response.headers.get("Content-Type","")
            cr=response.headers.get("Content-Range","")
            size=response.headers.get("Content-Length","")
            final=response.url
            payload=response.read(16384)
            # At least MP4 boxes ftyp near header, or HLS EXTM3U.
            mp4=b"ftyp" in payload[:96] or b"moov" in payload[:96]
            hls=payload.startswith(b"#EXTM3U")
            is_file=mp4 or hls
            return {"name":name,"url":url,"http":code,"content_type":ctype,"content_range":cr,
                    "length":size,"bytes_read":len(payload),"mp4_signature":mp4,"hls_signature":hls,
                    "valid":code in (200,206) and is_file,"final_url":final,
                    "seconds":round(time.monotonic()-start,1)}
    except Exception as err:
        return {"name":name,"url":url,"valid":False,"error":str(err)[:200],
                "seconds":round(time.monotonic()-start,1)}
def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        results=list(pool.map(check,SOURCES.items()))
    for r in results:
        print(("PASS " if r["valid"] else "FAIL ")+json.dumps(r,ensure_ascii=False),flush=True)
    with open("media-check-results.json","w") as file:
        json.dump({"checked_at_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"results":results},
                  file,indent=2,ensure_ascii=False)
    good=sum(1 for r in results if r["valid"])
    print(f"SUMMARY {good}/{len(results)} MP4/HLS signatures verified from GitHub runner",flush=True)
if __name__=="__main__": main()
