"""Licensed direct MP4/HLS film ingest into private Supabase Storage and the Al Ezz movie catalog.
Operator-only: portal admin session + Origin check; owner-only playback.
"""
from __future__ import annotations

import base64
import ipaddress
import json
import os
import secrets
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from html import escape
from pydantic import BaseModel, Field
from private_video import BASE, BUCKET, LOCK, JOBS, admin_headers, rest, execute, set_job

router = APIRouter()
MAX_BYTES = int(os.getenv("ALEZZ_FILM_MAX_BYTES",str(4*1024*1024*1024)))
TUS_CHUNK = 6*1024*1024

class FilmInput(BaseModel):
    source_url: str = Field(min_length=15,max_length=2048)
    title: str = Field(min_length=2,max_length=180)
    description: str = Field(default="",max_length=1500)
    poster_url: str = Field(default="",max_length=2048)
    min_minutes: int = Field(default=25,ge=1,le=600)
    rights_holder: str = Field(default="",max_length=180)
    license_reference: str = Field(default="",max_length=300)

def safe_source(value):
    """Accept any public HTTPS host; never permit internal networks or credentials."""
    try:
        u=urlsplit(value)
        host=(u.hostname or "").lower().rstrip(".")
        if (u.scheme!="https" or not host or u.username or u.password or
                u.port not in (None,443) or len(value)>2048 or
                not u.path.lower().endswith((".mp4",".m3u8")) or
                host=="localhost" or "." not in host or
                host.endswith((".local",".internal",".lan",".test",".invalid",".onion"))):
            raise ValueError("أدخل رابط HTTPS مباشر بصيغة MP4 أو M3U8 على نطاق عام")
        try:
            ipaddress.ip_address(host)
            raise ValueError("روابط IP المباشرة غير مسموحة")
        except ValueError as e:
            if str(e)=="روابط IP المباشرة غير مسموحة":
                raise
        addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(x[4][0]).is_global for x in addresses):
            raise ValueError("تم رفض عنوان DNS غير عام أو محلي")
        return value
    except (TypeError,AttributeError) as exc:
        raise ValueError("رابط غير صالح") from exc



def source_preflight(url):
    """Classify upstream authorization errors before launching a long FFmpeg job."""
    safe_source(url)
    try:
        with requests.Session() as session:
            session.trust_env=False
            with session.get(url,headers={"Accept":"application/vnd.apple.mpegurl,application/x-mpegURL,video/mp4,*/*"},
                             timeout=(12,25),allow_redirects=False,stream=True) as response:
                status=response.status_code
                if status in (401,403):
                    raise ValueError(
                        "رفض خادم الفيديو الوصول (HTTP "+str(status)+"). "
                        "هذا ليس حظر نطاق من العز TV. احصل على رابط مباشر صالح "
                        "ومصرح للخادم بتنزيله، أو فعّل صلاحية Render من مزود المصدر."
                    )
                if status in (301,302,303,307,308):
                    raise ValueError(
                        "رابط المصدر يحوّل إلى عنوان آخر. لا يتم اتباع التحويل تلقائيًا "
                        "لمنع الوصول إلى خوادم غير مصرح بها."
                    )
                if status in (404,410):
                    raise ValueError("الفيديو غير موجود أو انتهت صلاحية رابط المصدر (HTTP "+str(status)+").")
                if status in (429,500,502,503,504):
                    raise ValueError("خادم المصدر غير متاح مؤقتًا (HTTP "+str(status)+").")
                if status not in (200,206):
                    raise ValueError("خادم الفيديو أعاد HTTP "+str(status)+".")
                sample=b""
                for chunk in response.iter_content(chunk_size=32768):
                    sample+=chunk
                    if len(sample)>=65536: break
                if not sample:
                    raise ValueError("المصدر لم يرجع بيانات فيديو")
                if sample.lstrip().lower().startswith((b"<!doctype",b"<html")):
                    raise ValueError("المصدر أعاد صفحة HTML بدل رابط فيديو مباشر")
                if urlsplit(url).path.lower().endswith(".m3u8"):
                    if not sample.lstrip().startswith(b"#EXTM3U"):
                        raise ValueError("المصدر لم يرجع ملف M3U8 صحيحًا")
                return {"status":status,"content_type":response.headers.get("Content-Type","")}
    except requests.RequestException as exc:
        raise ValueError("تعذر الاتصال بخادم الفيديو من Render. تحقق من DNS وتوفر المصدر.") from exc


def owner(request, portal):
    token=request.cookies.get("alezz_member","")
    if not token:
        raise HTTPException(401,"Admin login required")
    found=portal.admin_sessions.get(token)
    if not found:
        raise HTTPException(401,"Valid admin session required")
    sess,_,_=found
    if sess[1]!="admin" or sess[2]<=time.monotonic():
        raise HTTPException(403,"Administrator role required")
    # The portal middleware revalidates administrator privileges when needed.
    return sess[0]

def metadata_value(value):
    return base64.b64encode(value.encode("utf-8")).decode("ascii")

def tus_upload(file:Path, path:str,job_id:str):
    root = os.getenv("ALEZZ_SUPABASE_STORAGE_URL","").rstrip("/")
    if not root:
        u=urlsplit(BASE)
        root=f"{u.scheme}://{u.hostname.replace('.supabase.co','.storage.supabase.co')}"
    endpoint=root+"/storage/v1/upload/resumable"
    meta=",".join(f"{k} {metadata_value(v)}" for k,v in {
        "bucketName":BUCKET,"objectName":path,"contentType":"video/mp4","cacheControl":"0"
    }.items())
    headers={**admin_headers(),"Tus-Resumable":"1.0.0","Upload-Length":str(file.stat().st_size),
             "Upload-Metadata":meta,"Content-Length":"0"}
    response=requests.post(endpoint,headers=headers,timeout=30,allow_redirects=False)
    if response.status_code not in (201,204):
        raise RuntimeError("Resumable upload init failed: "+response.text[:280])
    target=urljoin(endpoint,response.headers.get("Location",""))
    # The upload location must remain on the exact trusted storage host.
    if urlsplit(target).scheme!="https" or urlsplit(target).netloc!=urlsplit(endpoint).netloc or not urlsplit(target).path.startswith("/storage/v1/upload/resumable/"):
        raise RuntimeError("Storage returned an untrusted upload location")
    sent=0
    size=file.stat().st_size
    with file.open("rb") as stream:
        while sent<size:
            payload=stream.read(TUS_CHUNK)
            if not payload: raise RuntimeError("Unexpected end of video file")
            for attempt in range(5):
                try:
                    r=requests.patch(target,headers={**admin_headers(),
                        "Tus-Resumable":"1.0.0","Upload-Offset":str(sent),
                        "Content-Type":"application/offset+octet-stream"},
                        data=payload,timeout=(20,120),allow_redirects=False)
                    if r.status_code==204:
                        offset=int(r.headers.get("Upload-Offset","-1"))
                        if offset!=sent+len(payload):
                            raise RuntimeError("Storage acknowledged incorrect offset")
                        sent=offset
                        set_job(job_id,uploaded_bytes=sent,upload_percent=round(100*sent/size,1))
                        break
                    if r.status_code in (409,423,429,500,502,503,504):
                        h=requests.head(target,headers={**admin_headers(),"Tus-Resumable":"1.0.0"},timeout=20,allow_redirects=False)
                        if h.ok:
                            current=int(h.headers.get("Upload-Offset","-1"))
                            if current==sent+len(payload):
                                sent=current
                                set_job(job_id,uploaded_bytes=sent,upload_percent=round(100*sent/size,1))
                                break
                            if current!=sent:
                                raise RuntimeError("Unexpected server offset")
                        time.sleep(min(2**attempt,8))
                        continue
                    raise RuntimeError("Storage chunk failed: "+r.text[:240])
                except requests.RequestException:
                    if attempt==4: raise
                    time.sleep(min(2**attempt,8))
            else:
                raise RuntimeError("Upload failed after retries")

def ingest(job_id:str, payload:FilmInput, uid:str):
    stored=False
    path=None
    movie_id=str(uuid.uuid4())
    media_id=str(uuid.uuid4())
    try:
        url=safe_source(payload.source_url)
        set_job(job_id,status="checking_source")
        source_preflight(url)
        set_job(job_id,status="downloading")
        with tempfile.TemporaryDirectory(prefix="alezz-film-") as d:
            output=Path(d)/"movie.mp4"
            # Source must be an unencrypted, authorized and directly accessible stream.
            execute(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-i",url,
                     "-map","0:v:0","-map","0:a:0?","-c","copy","-movflags","+faststart",str(output)],7200)
            if not output.is_file() or not 4096<output.stat().st_size<=MAX_BYTES:
                raise RuntimeError("Downloaded video empty or above configured size limit")
            probe=json.loads(execute(["ffprobe","-v","error","-show_entries",
                                      "format=duration:stream=codec_type",
                                      "-of","json",str(output)],45))
            duration=float(probe.get("format",{}).get("duration") or 0)
            if not any(s.get("codec_type")=="video" for s in probe.get("streams",[])):
                raise RuntimeError("No video track in downloaded file")
            if duration < payload.min_minutes*60:
                raise RuntimeError("Film is shorter than minimum duration")
            set_job(job_id,status="uploading",duration_seconds=int(duration),bytes=output.stat().st_size)
            path="films/"+movie_id+".mp4"
            tus_upload(output,path,job_id)
            stored=True
            # Keep catalog draft and rights pending: NOT published to viewers.
            rest("POST","aseel_movies",json={
                "id":movie_id,"title_ar":payload.title,
                "description":payload.description or None,
                "poster_url":payload.poster_url or None,
                "duration_minutes":round(duration/60),
                "stream_url":None,"status":"draft","rights_status":"pending",
                "rights_holder":payload.rights_holder or None,
                "license_reference":payload.license_reference or None,
                "link_health_status":"unchecked"})
            rest("POST","aseel_private_videos",json={
                "id":media_id,"title":payload.title,
                "storage_bucket":BUCKET,"storage_path":path,"source_url":url,
                "duration_seconds":int(duration),"status":"ready",
                "owner_user_id":uid,"movie_id":movie_id})
            # Owner can access the private media using the existing admin login.
            set_job(job_id,status="ready",video_id=media_id,movie_id=movie_id,
                    playback_path="/web/private-film/watch/"+media_id)
    except Exception as ex:
        set_job(job_id,status="failed",error=str(ex)[:450])
        if stored and path:
            # Avoid removing a successfully registered movie if a later step failed.
            try:
                found=rest("GET","aseel_private_videos",params={"storage_path":"eq."+path,"select":"id"})
                if not found:
                    requests.delete(BASE+"/storage/v1/object/"+BUCKET+"/"+path,
                        headers=admin_headers(),timeout=20)
            except Exception:
                pass

def register(router_app,portal):
    @router_app.post("/api/private-film/import",status_code=202)
    def start(payload:FilmInput,request:Request):
        uid=owner(request,portal)
        if request.headers.get("origin")!=str(request.base_url).rstrip("/"):
            raise HTTPException(403,"Same-origin form required")
        if not (os.getenv("ALEZZ_SUPABASE_SECRET_KEY") or os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY")):
            raise HTTPException(503,"Server-side Supabase key not configured")
        try:
            safe_source(payload.source_url)
        except (ValueError,OSError) as ex:
            raise HTTPException(422,str(ex)[:250])
        with LOCK:
            if any(j.get("status") in ("queued","checking_source","downloading","uploading") for j in JOBS.values()):
                raise HTTPException(429,"A private media import is already running")
            job_id=secrets.token_urlsafe(20)
            JOBS[job_id]={"status":"queued","created_at":int(time.time()),"owner_uid":uid}
        threading.Thread(target=ingest,args=(job_id,payload,uid),daemon=True).start()
        return {"job_id":job_id,"status":"queued","poll":"/api/private-film/job/"+job_id}


    @router_app.get("/api/private-film/mine")
    def mine(request:Request):
        uid=owner(request,portal)
        try:
            rows=rest("GET","aseel_private_videos",params={
                "owner_user_id":"eq."+uid,"status":"eq.ready",
                "select":"id,title,duration_seconds,movie_id,created_at",
                "order":"created_at.desc","limit":"50"})
            return [{"id":v["id"],"title":v["title"],
                     "duration_seconds":v["duration_seconds"],"movie_id":v["movie_id"],
                     "playback_path":"/web/private-film/watch/"+v["id"]} for v in rows]
        except requests.RequestException:
            raise HTTPException(502,"Storage catalog unavailable")

    @router_app.get("/web/private-film/watch/{video_id}",response_class=HTMLResponse)
    def watch(video_id:uuid.UUID,request:Request):
        uid=owner(request,portal)
        rows=rest("GET","aseel_private_videos",params={
            "id":"eq."+str(video_id),"owner_user_id":"eq."+uid,
            "status":"eq.ready","select":"id,title","limit":1})
        if not rows:
            raise HTTPException(404,"Film not found in your private library")
        name=escape(rows[0]["title"],quote=True)
        url="/web/private-video/"+str(video_id)
        return HTMLResponse(f'''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{name} | العز TV</title>
<style>body{{font-family:system-ui;background:#07090d;color:white;margin:0;padding:25px}}
main{{max-width:1000px;margin:auto}}a{{color:#fb6b83}}video{{width:100%;max-height:78vh;background:black;border-radius:15px}}</style>
<main><p><a href="/studio/private-videos">العودة إلى مكتبتي</a></p><h1>{name}</h1>
<video controls controlsList="nodownload" preload="metadata" playsinline src="{url}"></video>
<p>تشغيل خاص بالحساب الذي استورد الفيلم. يلزم اتصال بالإنترنت وجلسة دخول صالحة.</p></main></html>''',
headers={"Cache-Control":"private,no-store","X-Content-Type-Options":"nosniff",
"Referrer-Policy":"no-referrer","X-Frame-Options":"DENY"})


    @router_app.get("/api/private-film/job/{job_id}")
    def report(job_id:str,request:Request):
        uid=owner(request,portal)
        with LOCK:
            result=JOBS.get(job_id)
        if not result or result.get("owner_uid")!=uid:
            raise HTTPException(404,"Job not found")
        return {k:v for k,v in result.items() if k!="owner_uid"}
