"""Bounded, admin-only public media discovery with sequential fallbacks.

Purpose: inspect accessible public page metadata, not bypass access controls,
authentication, DRM, geo rules, or third-party download restrictions.
"""
from __future__ import annotations

import json
import re
import secrets
import subprocess
import sys
import threading
import time
from urllib.parse import urljoin, urlsplit
import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from private_page_discovery import discover_page, validate_page
from private_film_import import safe_source, owner
from private_browser_diagnostics import diagnose

router=APIRouter()
JOBS={}
LOCK=threading.RLock()
MAX_EPISODES=12
MAX_MEDIA_PER_EPISODE=12
MAX_GLOBAL_MEDIA=90
MAX_EMBEDS=48
MAX_IFRAME_BROWSERS=4
ACTIVE_STATES={"queued","scanning"}
URL_IN_SCRIPT=re.compile(r'https:\\?/\\?/[^"' + "'"+r'\s<>\\]{6,900}?\.(?:mp4|m3u8|m4v|webm|mov|mkv)(?:\?[^"' + "'" +r'\s<>\\]*)?',re.I)

class DeepScanInput(BaseModel):
    page_url:str=Field(min_length=12,max_length=2048)
    max_episodes:int=Field(default=12,ge=1,le=12)

def snapshot(job_id,**fields):
    with LOCK:
        if job_id not in JOBS:
            return
        JOBS[job_id].update(fields)
        snapshot_data=dict(JOBS[job_id])
    uid=snapshot_data.get("owner_id")
    if uid:
        try:
            from studio_jobs import save as save_studio_job
            save_studio_job(job_id,uid,"deep_scan",snapshot_data,
                            force=snapshot_data.get("status") in ("complete","failed"))
        except Exception:
            pass

def admissible(url):
    try:
        value=safe_source(url)
        return value
    except (ValueError,OSError,TypeError):
        return None

def add_source(result,url,engine,label="",origin="",verified=False):
    url=admissible(url)
    if not url or len(result["media"])>=MAX_GLOBAL_MEDIA:
        return False
    if any(x["url"]==url for x in result["media"]):
        return False
    result["media"].append({
        "url":url,"engine":engine,"label":str(label or "مصدر فيديو")[:150],
        "page_url":str(origin)[:2048],"verified":bool(verified)
    })
    return True

def inline_config(page_url, result):
    """Inspect limited, already-public inline JSON and script literals."""
    try:
        validate_page(page_url)
        with requests.Session() as session:
            session.trust_env=False
            with session.get(page_url,timeout=(10,16),allow_redirects=False,stream=True,
                             headers={"Accept":"text/html"}) as r:
                if r.status_code != 200 or "html" not in r.headers.get("content-type","").lower():
                    return {"state":"not_accessible","http_status":r.status_code}
                body=bytearray()
                for chunk in r.iter_content(16384):
                    body.extend(chunk)
                    if len(body)>1_200_000:return {"state":"too_large"}
        doc=BeautifulSoup(bytes(body),"html.parser")
        found=0
        for tag in doc.find_all("script",limit=45):
            if tag.get("src"):continue
            data=tag.string or tag.get_text()
            if not data or len(data)>180_000:continue
            for match in URL_IN_SCRIPT.finditer(data):
                value=match.group(0).replace("\\/","/")
                if add_source(result,value,"inline_config","رابط ظاهر في إعدادات الصفحة",page_url):
                    found+=1
        return {"state":"ok","found":found}
    except (requests.RequestException,OSError,ValueError):
        return {"state":"connection_failed"}

def yt_dlp_metadata(page_url,result):
    """Metadata only: no download, cookies, credentials, proxies or DRM bypass."""
    page_url=validate_page(page_url)
    command=[sys.executable,"-m","yt_dlp","--ignore-config","--skip-download",
             "--no-playlist","--no-warnings","--socket-timeout","8",
             "--retries","0","--extractor-retries","0","--dump-single-json",page_url]
    try:
        run=subprocess.run(command,capture_output=True,text=True,timeout=28)
    except subprocess.TimeoutExpired:
        return {"state":"timeout"}
    if run.returncode or not run.stdout.strip():
        error=(run.stderr or "")[-300:].lower()
        if any(x in error for x in ("403","401","forbidden","login","sign in","drm","unsupported url")):
            return {"state":"restricted_or_unsupported"}
        return {"state":"not_supported"}
    try:
        info=json.loads(run.stdout[:1_500_000])
    except (ValueError,TypeError):
        return {"state":"invalid_metadata"}
    found=0
    entries=[info]
    if isinstance(info,dict) and isinstance(info.get("entries"),list):
        entries=[x for x in info["entries"][:8] if isinstance(x,dict)]
    for entry in entries:
        if not isinstance(entry,dict) or entry.get("is_live") or entry.get("_type") in ("url","url_transparent"):
            continue
        candidates=[entry.get("url")]
        candidates += [x.get("url") for x in entry.get("formats",[])[:35] if isinstance(x,dict)
                       and x.get("vcodec") not in ("none",None)]
        for candidate in candidates[:36]:
            if candidate and add_source(result,candidate,"yt_dlp","مصدر معلن في بيانات المشغل",page_url):
                found+=1
    return {"state":"ok","found":found}

def browser_metadata(page_url,result):
    try:
        report=diagnose(page_url)
        found=0
        for candidate in report.get("candidate_media",[])[:30]:
            if add_source(result,candidate.get("url"),"chromium_network","استجابة شبكة Chromium",page_url):
                found+=1
        for candidate in report.get("dom_media",[])[:20]:
            if add_source(result,candidate.get("url"),"chromium_dom","مصدر فيديو في DOM",page_url):
                found+=1
        return {"state":report.get("state","unknown"),
                "http_status":report.get("http_status"),
                "found":found,"blocked":report.get("blocked_requests",0)}
    except (OSError,ValueError) as error:
        return {"state":"failed","detail":type(error).__name__}

def attempt(func,*args):
    """A failed extraction engine must never prevent trying the next engine."""
    try:
        return func(*args)
    except Exception as error:
        return {"state":"engine_failed","error":type(error).__name__}


def run_scan(job_id,url,max_episodes):
    result={"media":[],"embeds":[],"episodes":[],"methods":[],"notes":[],"page_title":""}
    iframe_browser_count=0
    try:
        steps=["html","inline_config","yt_dlp","chromium","episodes"]
        def update(stage,text):
            snapshot(job_id,status="scanning",stage=stage,message=text)
        update("html","قراءة صفحة العمل وقائمة الحلقات")
        public=discover_page(url)
        result["page_title"]=public.get("title","")
        result["embeds"]=list(dict.fromkeys(public.get("embeds",[])))[:MAX_EMBEDS]
        result["episodes"]=[{"title":x["title"],"page_url":x["page_url"],
                             "sources":[],"embeds":[],"methods":[]} for x in public.get("episodes",[])[:max_episodes]]
        for src in public.get("media",[]):
            add_source(result,src.get("url"),"html","مصدر ظاهر في HTML",url)
        result["methods"].append({"engine":"html","status":public.get("status"),
                                  "found":len(result["media"]),"episodes":len(result["episodes"])})
        if public.get("http_status") in (401,403):
            result["notes"].append("خادم المصدر رفض الوصول؛ لم تُستخدم وسائل لتجاوز المنع.")
            snapshot(job_id,status="complete",stage="complete",result=result)
            return
        update("inline_config","فحص إعدادات JavaScript العامة")
        status=attempt(inline_config,url,result)
        result["methods"].append({"engine":"inline_config",**status})
        update("yt_dlp","استخراج بيانات المصدر العامة بواسطة yt-dlp")
        status=attempt(yt_dlp_metadata,url,result)
        result["methods"].append({"engine":"yt_dlp",**status})
        update("chromium","تشغيل Chromium ورصد ملفات الفيديو")
        status=attempt(browser_metadata,url,result)
        result["methods"].append({"engine":"chromium",**status})
        # Episode sources are distinct from main show page. Scan every public episode.
        for index,ep in enumerate(result["episodes"]):
            update("episodes",f"فحص الحلقة {index+1} من {len(result['episodes'])}")
            scoped={"media":[]}
            try:
                item=discover_page(ep["page_url"])
                ep["embeds"]=list(dict.fromkeys(item.get("embeds",[])))[:8]
                for iframe_url in ep["embeds"]:
                    if iframe_url not in result["embeds"] and len(result["embeds"])<MAX_EMBEDS:
                        result["embeds"].append(iframe_url)
                for source in item.get("media",[])[:MAX_MEDIA_PER_EPISODE]:
                    add_source(scoped,source.get("url"),"html",ep["title"],ep["page_url"])
                ep["methods"].append({"engine":"html","status":item.get("status","unavailable"),
                                       "found":len(scoped["media"])})
                # Do not probe further if the source page explicitly refused access.
                if item.get("http_status") not in (401,403):
                    status=attempt(inline_config,ep["page_url"],scoped)
                    ep["methods"].append({"engine":"inline_config",**status})
                    if not scoped["media"]:
                        status=attempt(yt_dlp_metadata,ep["page_url"],scoped)
                        ep["methods"].append({"engine":"yt_dlp",**status})
                    if not scoped["media"]:
                        status=attempt(browser_metadata,ep["page_url"],scoped)
                        ep["methods"].append({"engine":"chromium",**status})
                    # Some pages only declare public iframe players. The
                    # previous implementation ignored these URLs entirely,
                    # so a series could show episodes while showing 0 players.
                    # Read only two public iframe documents per episode, and
                    # run up to four extra Chromium checks for the entire job.
                    for embed_url in ep["embeds"][:2]:
                        if scoped["media"]:break
                        if embed_url == ep["page_url"]:continue
                        embedded=attempt(discover_page,embed_url)
                        for candidate in embedded.get("media",[])[:MAX_MEDIA_PER_EPISODE]:
                            add_source(scoped,candidate.get("url"),"iframe_html",ep["title"],embed_url)
                        ep["methods"].append({"engine":"iframe_html",
                            "status":embedded.get("status","engine_failed"),
                            "found":len(scoped["media"])})
                        if embedded.get("http_status") in (401,403):continue
                        if not scoped["media"]:
                            status=attempt(inline_config,embed_url,scoped)
                            ep["methods"].append({"engine":"iframe_script",**status})
                        if not scoped["media"] and iframe_browser_count<MAX_IFRAME_BROWSERS:
                            iframe_browser_count+=1
                            status=attempt(browser_metadata,embed_url,scoped)
                            ep["methods"].append({"engine":"iframe_chromium",**status})
                ep["sources"]=scoped["media"][:MAX_MEDIA_PER_EPISODE]
                for src in ep["sources"]:
                    add_source(result,src["url"],src["engine"],ep["title"],ep["page_url"],src["verified"])
            except (OSError,ValueError) as error:
                ep["methods"].append({"engine":"episode","status":"failed","error":type(error).__name__})
            snapshot(job_id,progress={"episodes_checked":index+1,
                                      "episodes_total":len(result["episodes"]),
                                      "media_found":len(result["media"])})
        if not result["media"]:
            result["notes"].append("لم تكشف الأدوات مصدر فيديو عامًا؛ الروابط قد تكون ديناميكية أو محمية أو غير متاحة لـ Render.")
        result["notes"].append("المصادر المكتشفة مرشّحة ولم تثبت قابليتها للتنزيل. يجب فحصها والترخيص قبل الاستيراد.")
        snapshot(job_id,status="complete",stage="complete",result=result,message="اكتمل الفحص")
    except Exception as error:
        snapshot(job_id,status="failed",stage="error",
                 error=type(error).__name__,message="تعذر إتمام الفحص. راجع المراحل المسجلة.")

def register(portal):
    @router.post("/api/private-film/deep-scan",status_code=202)
    def start(data:DeepScanInput,request:Request):
        uid=owner(request,portal)
        if request.headers.get("origin")!=str(request.base_url).rstrip("/"):
            raise HTTPException(403,"Same-origin admin request required")
        try:url=validate_page(data.page_url)
        except (ValueError,OSError) as error:
            raise HTTPException(422,str(error)[:180])
        with LOCK:
            if any(j.get("status") in ACTIVE_STATES for j in JOBS.values()):
                raise HTTPException(429,"يوجد فحص متعدد المحركات قيد التنفيذ بالفعل")
            if len(JOBS)>=40:
                for key in sorted(JOBS,key=lambda x:JOBS[x]["created_at"])[:15]:
                    if JOBS[key]["status"] not in ACTIVE_STATES:
                        del JOBS[key]
            job_id=secrets.token_urlsafe(18)
            JOBS[job_id]={"status":"queued","stage":"queued","created_at":int(time.time()),
                         "owner_id":uid,"progress":{"episodes_checked":0,"episodes_total":0,
                                                   "media_found":0}}
        from studio_jobs import save as save_studio_job
        durable=save_studio_job(job_id,uid,"deep_scan",dict(JOBS[job_id]),force=True)
        threading.Thread(target=run_scan,args=(job_id,url,data.max_episodes),daemon=True).start()
        return {"job_id":job_id,"job_tracking":"persistent" if durable else "memory-only",
                "poll":"/api/private-film/deep-scan/"+job_id}

    @router.get("/api/private-film/deep-scan/{job_id}")
    def status(job_id:str,request:Request):
        uid=owner(request,portal)
        with LOCK:
            job=dict(JOBS.get(job_id) or {})
        if not job:
            from studio_jobs import restore as restore_studio_job
            job=restore_studio_job(job_id,uid,"deep_scan")
            if not job:raise HTTPException(404,"فحص غير موجود")
            return job
        if job.get("owner_id")!=uid:raise HTTPException(404,"فحص غير موجود")
        job.pop("owner_id",None)
        return job
