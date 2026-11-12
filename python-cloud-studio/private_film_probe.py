"""Admin-only HLS/MP4 diagnostics using Playwright browser network context and FFmpeg.
This only tests public, authorized direct media; it cannot remove DRM/website restrictions.
"""
from __future__ import annotations
import os, re, json, subprocess, time, ipaddress, socket
from urllib.parse import urljoin, urlsplit
from playwright.sync_api import sync_playwright
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router=APIRouter()
class ProbeInput(BaseModel):
    source_url:str=Field(min_length=15,max_length=2048)

def valid_public(url):
    p=urlsplit(url)
    if p.scheme!="https" or not p.hostname or p.username or p.password or p.port not in (None,443):
        raise ValueError("Only public HTTPS media URLs are supported")
    host=p.hostname.lower().rstrip(".")
    if host=="localhost" or "." not in host or host.endswith((".local",".internal",".lan",".test",".invalid",".onion")):
        raise ValueError("Non-public source hostname refused")
    try:
        ipaddress.ip_address(host)
        raise ValueError("Direct IP host refused")
    except ValueError as err:
        if str(err)=="Direct IP host refused":
            raise
    dns=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
    if not dns or any(not ipaddress.ip_address(a[4][0]).is_global for a in dns):
        raise ValueError("Nonpublic source DNS refused")
    return url

def inspect(url):
    from private_film_import import safe_source
    url=safe_source(url)
    out={"url":url,"http_ok":False,"browser_check":"not_checked","media_check":"not_checked","duration_seconds":None}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox"])
        try:
            context=browser.new_context(ignore_https_errors=False,user_agent="AlEzzTV-AuthorizedMediaChecker/1.0")
            response=context.request.get(url,timeout=20000,max_redirects=0)
            out["http_status"]=response.status
            if response.status in (301,302,303,307,308):
                raise ValueError("Source redirects instead of serving the media")
            if response.status!=200 and response.status!=206:
                raise ValueError("Source returned HTTP "+str(response.status))
            content=response.body()
            if len(content)>2_000_000:
                raise ValueError("Manifest exceeds safe size")
            mime=response.headers.get("content-type","")
            out["content_type"]=mime
            if urlsplit(url).path.lower().endswith(".m3u8"):
                if not content.lstrip().startswith(b"#EXTM3U"):
                    raise ValueError("Not an HLS manifest; source may have expired or returned HTML")
                manifest=content.decode("utf-8-sig",errors="replace")
                if re.search(r'#EXT-X-KEY:|#EXT-X-SESSION-KEY:',manifest):
                    raise ValueError("Encrypted HLS requires separate playback authorization and is not imported")
                items=[line.strip() for line in manifest.splitlines() if line.strip() and not line.startswith("#")]
                if not items:
                    raise ValueError("Empty HLS playlist")
                child=urljoin(url,items[0])
                valid_public(child)
                small=context.request.get(child,timeout=16000,max_redirects=0)
                if small.status not in (200,206):
                    raise ValueError("First playlist/segment returned HTTP "+str(small.status))
                sample=small.body()
                if sample.lstrip().lower().startswith((b"<html",b"<!doctype")):
                    raise ValueError("Media segment returned HTML instead of video")
                out["manifest_entries"]=len(items)
                out["first_child_status"]=small.status
            else:
                if content.lstrip().lower().startswith((b"<html",b"<!doctype")):
                    raise ValueError("Source returned HTML instead of MP4")
                if b"ftyp" not in content[:64] and b"moof" not in content[:64]:
                    raise ValueError("MP4 file header missing")
            out["http_ok"]=True
            out["browser_check"]="passed"
        finally:
            browser.close()
    # FFprobe confirms a readable video track; browser network success alone is NOT proof of native browser HLS playback.
    try:
        result=subprocess.run(["ffprobe","-v","error","-show_entries",
            "format=duration:stream=codec_type,codec_name","-of","json",url],
            capture_output=True,text=True,timeout=40)
        if result.returncode:
            out["media_check"]="ffprobe_failed"
            out["media_error"]=(result.stderr or "Unable to decode media")[-350:]
        else:
            value=json.loads(result.stdout)
            out["video_stream"]=any(s.get("codec_type")=="video" for s in value.get("streams",[]))
            out["duration_seconds"]=float(value.get("format",{}).get("duration") or 0)
            out["media_check"]="passed" if out["video_stream"] else "no_video_track"
    except subprocess.TimeoutExpired:
        out["media_check"]="probe_timeout"
    return out

def register(portal):
    @router.post("/api/private-film/check")
    def check(data:ProbeInput,request:Request):
        from private_film_import import owner
        owner(request,portal)
        if request.headers.get("origin")!=str(request.base_url).rstrip("/"):
            raise HTTPException(403,"Same-origin admin request required")
        try:
            return inspect(data.source_url)
        except (ValueError, OSError) as exc:
            return {"http_ok":False,"browser_check":"failed","media_check":"not_checked","error":str(exc)[:350]}
