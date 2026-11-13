"""Bounded, admin-only public media discovery with sequential fallbacks.

Purpose: inspect accessible public page metadata, not bypass access controls,
authentication, DRM, geo rules, or third-party download restrictions.
"""
from __future__ import annotations

import asyncio
import copy
import json
import re
import secrets
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin, urlsplit
import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
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
FINISHED_STATES={"complete","failed"}
BROWSER_SLOTS=threading.BoundedSemaphore(2)
JOURNAL_POOL=ThreadPoolExecutor(max_workers=1, thread_name_prefix="alezz-deep-scan-journal")
MAX_SCAN_SECONDS=180
URL_IN_SCRIPT=re.compile(r'https:\\?/\\?/[^"' + "'"+r'\s<>\\]{6,900}?\.(?:mp4|m3u8|m4v|webm|mov|mkv)(?:\?[^"' + "'" +r'\s<>\\]*)?',re.I)

class DeepScanInput(BaseModel):
    page_url:str=Field(min_length=12,max_length=2048)
    max_episodes:int=Field(default=12,ge=1,le=12)

def snapshot(job_id,**fields):
    """Publish a consistent revision immediately; journal only from a worker.

    A slow Supabase write must never delay browser updates or source discovery.
    Signed URLs are kept in live memory and are not persisted in the job journal.
    """
    with LOCK:
        job=JOBS.get(job_id)
        if not job or job.get("status") in FINISHED_STATES:
            return
        for key,value in fields.items():
            job[key]=copy.deepcopy(value) if key in ("result","progress") else value
        job["revision"]=int(job.get("revision",0))+1
        job["updated_at"]=time.time()
        state={key:copy.deepcopy(value) for key,value in job.items()
               if key not in ("result",)}
        uid=job.get("owner_id")
    if uid:
        try:
            from studio_jobs import save as save_studio_job
            JOURNAL_POOL.submit(save_studio_job,job_id,uid,"deep_scan",state,
                                force=state.get("status") in FINISHED_STATES)
        except RuntimeError:
            pass


def view_job(job_id, uid):
    with LOCK:
        job=JOBS.get(job_id)
        if not job or job.get("owner_id")!=uid:
            return None
        record=copy.deepcopy(job)
    record.pop("owner_id",None)
    return record

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
    if not BROWSER_SLOTS.acquire(timeout=4):
        return {"state":"browser_busy","found":0}
    try:
        return _browser_metadata(page_url,result)
    finally:
        BROWSER_SLOTS.release()


def _browser_metadata(page_url,result):
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
    """Release each discovered candidate before other episodes finish.

    Two episode workers and one root-page worker run concurrently. Jobs are
    bounded and all outbound addresses retain existing public HTTPS/SSRF checks.
    Neither discovery nor streaming claims that an unverified link will play.
    """
    deadline=time.monotonic()+MAX_SCAN_SECONDS
    result={"media":[],"embeds":[],"episodes":[],"methods":[],"notes":[],"page_title":""}
    counters={"completed":0,"total":0}
    iframe_budget=threading.BoundedSemaphore(MAX_IFRAME_BROWSERS)

    def publish(stage,message,*,status="scanning"):
        with LOCK:
            snapshot(job_id,status=status,stage=stage,message=message,
                     result=result,progress={
                         "episodes_checked":counters["completed"],
                         "episodes_total":counters["total"],
                         "media_found":len(result["media"]),
                         "embeds_found":len(result["embeds"]),
                     })

    def publish_root(root,stage,text):
        with LOCK:
            result["methods"]=copy.deepcopy(root["methods"])
            for item in root["media"]:
                add_source(result,item.get("url"),item.get("engine","root"),
                           item.get("label","مصدر رئيسي"),url)
            publish(stage,text)

    def scan_root():
        root={"media":[],"methods":copy.deepcopy(result["methods"])}
        if time.monotonic()<deadline:
            state=attempt(inline_config,url,root)
            root["methods"].append({"engine":"inline_config",**state})
            publish_root(root,"root_script","تم تحليل إعدادات الصفحة العامة")
        if time.monotonic()<deadline and not root["media"]:
            state=attempt(yt_dlp_metadata,url,root)
            root["methods"].append({"engine":"yt_dlp",**state})
            publish_root(root,"root_extractor","اكتملت محاولة yt-dlp للصفحة")
        if time.monotonic()<deadline and not root["media"]:
            state=attempt(browser_metadata,url,root)
            root["methods"].append({"engine":"chromium",**state})
            publish_root(root,"root_browser","اكتمل فحص شبكة Chromium للصفحة")

    def publish_episode(index,ep,stage,*,finished=False):
        with LOCK:
            result["episodes"][index]=copy.deepcopy(ep)
            for item in ep.get("sources",[]):
                add_source(result,item["url"],item.get("engine","episode"),
                           ep["title"],ep["page_url"],item.get("verified",False))
            for embedded in ep.get("embeds",[]):
                if embedded not in result["embeds"] and len(result["embeds"])<MAX_EMBEDS:
                    result["embeds"].append(embedded)
            if finished:counters["completed"]+=1
            publish("episodes",f"حلقة {index+1}/{counters['total']}: {stage}")

    def scan_episode(index,base):
        ep=copy.deepcopy(base)
        scoped={"media":[]}

        def stage_publish(label):
            ep["sources"]=copy.deepcopy(scoped["media"][:MAX_MEDIA_PER_EPISODE])
            publish_episode(index,ep,label)

        try:
            if time.monotonic()>=deadline:
                ep["methods"].append({"engine":"deadline","state":"timeout"})
                stage_publish("انتهت المهلة")
                return
            page=ep["page_url"]
            item=discover_page(page)
            ep["embeds"]=list(dict.fromkeys(item.get("embeds",[])))[:8]
            for candidate in item.get("media",[])[:MAX_MEDIA_PER_EPISODE]:
                add_source(scoped,candidate.get("url"),"html",ep["title"],page)
            ep["methods"].append({"engine":"html","status":item.get("status","unavailable"),
                                  "found":len(scoped["media"])})
            stage_publish("قراءة صفحة الحلقة")
            if item.get("http_status") in (401,403):
                ep["methods"].append({"engine":"permission","state":"blocked"})
                return

            if time.monotonic()<deadline:
                state=attempt(inline_config,page,scoped)
                ep["methods"].append({"engine":"inline_config",**state})
                stage_publish("إعدادات JavaScript")

            if not scoped["media"] and time.monotonic()<deadline:
                state=attempt(yt_dlp_metadata,page,scoped)
                ep["methods"].append({"engine":"yt_dlp",**state})
                stage_publish("نتيجة yt-dlp")

            if not scoped["media"] and time.monotonic()<deadline:
                state=attempt(browser_metadata,page,scoped)
                ep["methods"].append({"engine":"chromium",**state})
                stage_publish("شبكة Chromium")

            for embed_url in ep["embeds"][:2]:
                if scoped["media"] or time.monotonic()>=deadline:break
                if embed_url==page:continue
                embedded=attempt(discover_page,embed_url)
                for candidate in embedded.get("media",[])[:MAX_MEDIA_PER_EPISODE]:
                    add_source(scoped,candidate.get("url"),"iframe_html",ep["title"],embed_url)
                ep["methods"].append({"engine":"iframe_html",
                                      "state":embedded.get("status","engine_failed"),
                                      "found":len(scoped["media"])})
                stage_publish("صفحة المشغل المضمّن")
                if embedded.get("http_status") in (401,403):continue
                if not scoped["media"] and time.monotonic()<deadline:
                    state=attempt(inline_config,embed_url,scoped)
                    ep["methods"].append({"engine":"iframe_script",**state})
                    stage_publish("إعدادات المشغل المضمّن")
                if (not scoped["media"] and time.monotonic()<deadline
                        and iframe_budget.acquire(blocking=False)):
                    state=attempt(browser_metadata,embed_url,scoped)
                    ep["methods"].append({"engine":"iframe_chromium",**state})
                    stage_publish("Chromium للمشغل المضمّن")
        except Exception as error:
            ep["methods"].append({"engine":"episode","state":"failed",
                                  "error":type(error).__name__})
        finally:
            stage_publish("اكتمل فحص الحلقة")
            publish_episode(index,ep,"اكتمل فحص الحلقة",finished=True)

    try:
        publish("html","اكتشاف حلقات العمل والمصادر المباشرة")
        public=discover_page(url)
        with LOCK:
            result["page_title"]=public.get("title","")
            result["embeds"]=list(dict.fromkeys(public.get("embeds",[])))[:MAX_EMBEDS]
            result["episodes"]=[
                {"title":x["title"],"page_url":x["page_url"],
                 "sources":[],"embeds":[],"methods":[]}
                for x in public.get("episodes",[])[:max_episodes]]
            counters["total"]=len(result["episodes"])
            for item in public.get("media",[]):
                add_source(result,item.get("url"),"html","مصدر ظاهر في HTML",url)
            result["methods"].append({
                "engine":"html","status":public.get("status"),
                "found":len(result["media"]),"episodes":counters["total"]})
            publish("html","تم اكتشاف "+str(counters["total"])+" حلقات؛ تظهر النتائج فور وصولها")
        if public.get("http_status") in (401,403):
            result["notes"].append("رفض خادم المصدر الوصول من Render؛ لم تتم محاولة تجاوز المنع.")
        else:
            with ThreadPoolExecutor(max_workers=3,thread_name_prefix="alezz-live-scan") as pool:
                futures=[pool.submit(scan_root)]
                for index,ep in enumerate(list(result["episodes"])):
                    futures.append(pool.submit(scan_episode,index,ep))
                for task in as_completed(futures):
                    try:task.result()
                    except Exception as exc:
                        with LOCK:
                            result["notes"].append("تعذر إتمام إحدى طرق الفحص: "+type(exc).__name__)
                            publish("episodes","تعذّر أحد المحركات، وتستمر النتائج المتاحة")
        if not result["media"]:
            result["notes"].append("لم تظهر ملفات فيديو عامة قابلة للوصول؛ بعض المواقع تتطلب تصريحًا من مزودها.")
        result["notes"].append("الروابط المرصودة مرشحة وغير مثبتة التشغيل؛ اختبرها قبل الاستيراد.")
        publish("complete","اكتمل الفحص، والروابط المكتشفة متاحة للتصدير",status="complete")
    except Exception as error:
        result["notes"].append("تعذّر إتمام الفحص: "+type(error).__name__)
        publish("failed","تعذّر إتمام الفحص؛ النتائج الجزئية محفوظة في الجلسة",status="failed")

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
        # Do not block the initial response on an external database request.
        # The scan worker journals progress asynchronously.
        threading.Thread(target=run_scan,args=(job_id,url,data.max_episodes),daemon=True,
                         name="alezz-live-scan").start()
        return {"job_id":job_id,"job_tracking":"async-journal",
                "poll":"/api/private-film/deep-scan/"+job_id,
                "events":"/api/private-film/deep-scan/"+job_id+"/events"}

    @router.get("/api/private-film/deep-scan/{job_id}")
    def status(job_id:str,request:Request):
        uid=owner(request,portal)
        job=view_job(job_id,uid)
        if job is None:
            from studio_jobs import restore as restore_studio_job
            job=restore_studio_job(job_id,uid,"deep_scan")
            if job is None:raise HTTPException(404,"فحص غير موجود")
        return job

    @router.get("/api/private-film/deep-scan/{job_id}/events")
    async def events(job_id:str,request:Request):
        """SSE: push the latest admin-only snapshot immediately on each revision."""
        uid=owner(request,portal)
        if view_job(job_id,uid) is None:
            raise HTTPException(404,"فحص غير موجود")

        async def generate():
            revision=-1
            while not await request.is_disconnected():
                record=view_job(job_id,uid)
                if record is None:break
                current=int(record.get("revision",0))
                if current!=revision:
                    revision=current
                    yield ("id: "+str(current)+"\nevent: snapshot\ndata: "+
                           json.dumps(record,ensure_ascii=False,separators=(",",":"))+"\n\n")
                if record.get("status") in FINISHED_STATES:break
                await asyncio.sleep(0.55)
        return StreamingResponse(generate(),media_type="text/event-stream",
                headers={"Cache-Control":"private, no-store, no-transform",
                         "X-Accel-Buffering":"no","X-Content-Type-Options":"nosniff"})
