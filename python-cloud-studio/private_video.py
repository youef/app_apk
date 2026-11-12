"""Private video import and signed playback for the existing Al Ezz portal.
Requires a licensed, directly accessible HLS source. Does not bypass DRM or site restrictions.
All admin APIs are gated by Portal middleware; viewer routes verify active portal sessions.
"""
from __future__ import annotations
import json, os, re, secrets, shutil, socket, subprocess, tempfile, threading, time, uuid, ipaddress
from pathlib import Path
from urllib.parse import urlsplit
import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

router = APIRouter()
BASE = os.getenv("ALEZZ_SUPABASE_URL", "https://qyzmlwtvzzgooccqxglq.supabase.co").rstrip("/")
BUCKET = "aseel-private-videos"
JOBS = {}
LOCK = threading.Lock()
DEFAULT_URL = "https://hglamioz.com/stream/xH-homnpYwMwSCPtcv2N7w/kjhhiuahiuhgihdf/1794562257/69496958/master.m3u8"

def admin_headers():
    key = os.getenv("ALEZZ_SUPABASE_SECRET_KEY") or os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("Supabase server secret is not configured in Render")
    return {"apikey":key, "Authorization":"Bearer "+key}

def source_check(value):
    u = urlsplit(value)
    allowed = set(filter(None,(x.strip().lower() for x in os.getenv("ALEZZ_VIDEO_SOURCE_HOSTS","hglamioz.com").split(","))))
    if u.scheme != "https" or not u.hostname or u.hostname.lower() not in allowed or u.username or u.password or u.port not in (None,443) or len(value)>2048 or not u.path.endswith(".m3u8"):
        raise ValueError("Source must be a licensed HTTPS M3U8 on an approved hostname")
    addresses = socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(i[4][0]).is_global for i in addresses):
        raise ValueError("Untrusted source DNS")
    return value

def rest(method, path, **kwargs):
    h = {**admin_headers(), "Content-Type":"application/json"}
    response=requests.request(method,BASE+"/rest/v1/"+path,headers=h,timeout=25,**kwargs)
    response.raise_for_status()
    return response.json() if response.content else {}

def execute(cmd, timeout):
    proc=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout)
    if proc.returncode:
        raise RuntimeError((proc.stderr or "Media process failed")[-550:])
    return proc.stdout

class ImportInput(BaseModel):
    source_url: str = Field(default=DEFAULT_URL, max_length=2048)
    title: str = Field(min_length=2,max_length=180)
    min_minutes: int = Field(default=25,ge=1,le=600)
    grant_user_id: str | None = None

def set_job(job_id, **kwargs):
    with LOCK:
        JOBS[job_id]={**JOBS.get(job_id,{}),**kwargs}

def worker(job_id, payload):
    try:
        set_job(job_id,status="downloading")
        url=source_check(payload.source_url)
        with tempfile.TemporaryDirectory(prefix="alezz-private-") as td:
            output=Path(td)/"video.mp4"
            execute(["ffmpeg","-hide_banner","-loglevel","warning","-nostdin","-y",
                "-i",url,"-map","0:v:0?","-map","0:a:0?","-c","copy",
                "-movflags","+faststart",str(output)],7200)
            size=output.stat().st_size
            if size<4096:
                raise ValueError("Media is empty or invalid")
            meta=json.loads(execute(["ffprobe","-v","error","-show_entries","format=duration",
                "-of","json",str(output)],45))
            seconds=float(meta["format"]["duration"])
            if seconds<payload.min_minutes*60:
                raise ValueError("Duration is shorter than minimum minutes")
            set_job(job_id,status="uploading",duration_seconds=int(seconds),bytes=size)
            media_id=str(uuid.uuid4())
            path="library/"+media_id+".mp4"
            # Upload limit depends on the Supabase plan and project storage limit.
            with output.open("rb") as stream:
                response=requests.post(BASE+"/storage/v1/object/"+BUCKET+"/"+path,
                    headers={**admin_headers(),"Content-Type":"video/mp4","x-upsert":"false"},
                    data=stream,timeout=(20,3600),allow_redirects=False)
            if response.status_code not in (200,201):
                raise RuntimeError("Storage upload failed: "+response.text[:300])
            try:
                rest("POST","aseel_private_videos",json={
                    "id":media_id,"title":payload.title,"storage_bucket":BUCKET,
                    "storage_path":path,"source_url":url,
                    "duration_seconds":int(seconds),"status":"ready"})
                if payload.grant_user_id:
                    rest("POST","aseel_private_video_access",
                         json={"video_id":media_id,"user_id":str(uuid.UUID(payload.grant_user_id))})
            except Exception:
                try:
                    requests.delete(BASE+"/storage/v1/object/"+BUCKET+"/"+path,
                       headers=admin_headers(),timeout=15)
                except Exception: pass
                raise
            set_job(job_id,status="ready",video_id=media_id,
                    playback_path="/web/private-video/"+media_id)
    except Exception as ex:
        set_job(job_id,status="failed",error=str(ex)[:500])

@router.post("/api/private-video/import",status_code=202)
def import_video(data:ImportInput, request:Request):
    origin=request.headers.get("origin")
    if origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403,"Same-origin admin request required")
    if not os.getenv("ALEZZ_SUPABASE_SECRET_KEY") and not os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY"):
        raise HTTPException(503,"Configure Supabase server secret on Render first")
    try:
        source_check(data.source_url)
        if data.grant_user_id: uuid.UUID(data.grant_user_id)
    except (ValueError,OSError) as exc:
        raise HTTPException(422,str(exc)[:200])
    with LOCK:
        if any(j.get("status") in ("downloading","uploading") for j in JOBS.values()):
            raise HTTPException(429,"Another video import is running")
        job_id=secrets.token_urlsafe(18)
        JOBS[job_id]={"status":"queued","created_at":int(time.time())}
    threading.Thread(target=worker,args=(job_id,data),daemon=True).start()
    return {"job_id":job_id,"status":"queued","poll":"/api/private-video/jobs/"+job_id}

@router.get("/api/private-video/jobs/{job_id}")
def job_status(job_id:str):
    with LOCK:
        job=JOBS.get(job_id)
    if not job: raise HTTPException(404,"Unknown job (or Render instance restarted)")
    return job

def authorized_session(request, portal):
    token=request.cookies.get("alezz_member","")
    if not token: return None
    record=portal.member_sessions.get(token)
    if not record: return None
    session,_=record
    if session[1]!="customer" or session[2]<=time.monotonic():
        return None
    from member_devices import DEVICE_COOKIE
    if not portal.devices.matches(session[0],request.cookies.get(DEVICE_COOKIE,"")):
        return None
    return session[0]

def register_playback(portal):
    @router.get("/web/private-video/{video_id}")
    def play(video_id:uuid.UUID,request:Request):
        uid=authorized_session(request,portal)
        is_admin=False
        if not uid:
            token=request.cookies.get("alezz_member","")
            record=portal.admin_sessions.get(token) if token else None
            if record:
                session,_,_=record
                if session[1]=="admin" and session[2]>time.monotonic():
                    uid=session[0]
                    is_admin=True
        if not uid:
            raise HTTPException(401,"Active authorized account required")
        try:
            rows=rest("GET","aseel_private_videos",
                 params={"id":"eq."+str(video_id),"status":"eq.ready",
                         "select":"storage_bucket,storage_path,owner_user_id","limit":1})
            if not rows: raise HTTPException(404,"Video unavailable")
            v=rows[0]
            if not (is_admin and v.get("owner_user_id")==uid):
                rights=rest("GET","aseel_private_video_access",
                    params={"video_id":"eq."+str(video_id),"user_id":"eq."+uid,
                            "select":"video_id","limit":1})
                if not rights:
                    raise HTTPException(403,"Video not granted to this account")
            r=requests.post(BASE+"/storage/v1/object/sign/"+v["storage_bucket"]+"/"+v["storage_path"],
                  headers={**admin_headers(),"Content-Type":"application/json"},
                  json={"expiresIn":60},timeout=15)
            r.raise_for_status()
            signed=r.json()["signedURL"]
            url=(BASE+"/storage/v1"+signed) if signed.startswith("/") else signed
            return RedirectResponse(url,status_code=307,
                headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"})
        except requests.RequestException:
            raise HTTPException(502,"Private media service unavailable")
