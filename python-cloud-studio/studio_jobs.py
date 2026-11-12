"""Durable, server-only Al Ezz Studio job status journal.

The source URL, signed tokens, cookie values and raw extraction results are
NEVER written to this table. Executing jobs are not automatically resumed after
a Render restart; the UI reports an interrupted job and allows retry.
"""
from __future__ import annotations
import os
import re
import threading
import time
from urllib.parse import urlsplit
import requests

_LOCK=threading.RLock()
_LAST={}

ALLOWED_FIELDS=("duration_seconds","bytes","uploaded_bytes","upload_percent",
                "video_id","movie_id","created_at","message","error",
                "page_title","episodes_checked","episodes_total","media_found")

def _safe_text(value,limit=220):
    raw=str(value or "")
    raw=re.sub(r"https?://[^\s]+","[source-url]",raw)
    return raw[:limit]

def _endpoint():
    key=os.getenv("ALEZZ_SUPABASE_SECRET_KEY") or os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY")
    root=os.getenv("ALEZZ_SUPABASE_URL","https://qyzmlwtvzzgooccqxglq.supabase.co").rstrip("/")
    if not key or urlsplit(root).scheme!="https" or not urlsplit(root).hostname:
        return None
    headers={"apikey":key,"Content-Type":"application/json","Accept":"application/json"}
    if not key.startswith("sb_secret_"):headers["Authorization"]="Bearer "+key
    return root+"/rest/v1/aseel_studio_job_history",headers

def _summary(data):
    info={}
    for key in ALLOWED_FIELDS:
        value=data.get(key)
        if value is None:continue
        if key in ("message","error","page_title"):
            info[key]=_safe_text(value,230)
        elif isinstance(value,(int,float)) and not isinstance(value,bool):
            info[key]=value
        elif key in ("video_id","movie_id") and isinstance(value,str):
            info[key]=value[:60]
    progress=data.get("progress")
    if isinstance(progress,dict):
        for key in ("episodes_checked","episodes_total","media_found"):
            value=progress.get(key)
            if type(value) is int:info[key]=value
    return info

def save(job_id:str,uid:str,kind:str,state:dict,*,force=False):
    if kind not in ("film_import","deep_scan") or not uid:
        return False
    status=str(state.get("status") or "queued")[:40]
    stage=str(state.get("stage") or status)[:60]
    now=time.monotonic()
    with _LOCK:
        old=_LAST.get(job_id)
        if not force and old and old[0]==status and old[1]==stage and now-old[2]<8:
            return True
        _LAST[job_id]=(status,stage,now)
    endpoint=_endpoint()
    if not endpoint:return False
    url,headers=endpoint
    body={"job_id":job_id,"owner_id":uid,"job_kind":kind,
          "status":status,"stage":stage,"details":_summary(state),
          "progress":{k:v for k,v in _summary(state).items()
                      if k in ("episodes_checked","episodes_total","media_found","upload_percent")}}
    try:
        with requests.Session() as client:
            client.trust_env=False
            r=client.post(url,params={"on_conflict":"job_id"},json=body,
                          headers={**headers,"Prefer":"resolution=merge-duplicates,return=minimal"},
                          timeout=(4,12),allow_redirects=False)
            r.raise_for_status()
        return True
    except requests.RequestException:
        return False

def restore(job_id:str,uid:str,kind:str):
    if not uid or kind not in ("film_import","deep_scan"):
        return None
    endpoint=_endpoint()
    if not endpoint:return None
    url,headers=endpoint
    try:
        with requests.Session() as client:
            client.trust_env=False
            r=client.get(url,params={"job_id":"eq."+str(job_id)[:128],
                        "owner_id":"eq."+str(uid),"job_kind":"eq."+kind,
                        "select":"status,stage,progress,details","limit":"1"},
                         headers=headers,timeout=(4,10),allow_redirects=False)
            r.raise_for_status()
            rows=r.json()
        if not isinstance(rows,list) or not rows:return None
        item=rows[0]
        details=item.get("details") if isinstance(item.get("details"),dict) else {}
        result={**details,"status":item.get("status"),
                "stage":item.get("stage"),"progress":item.get("progress") or {},
                "recovered_from_storage":True}
        if kind=="film_import" and result["status"]=="ready" and result.get("video_id"):
            result["playback_path"]="/studio/private-film/watch/"+str(result["video_id"])
        elif kind=="deep_scan" and result["status"]=="complete":
            result.update(status="failed",message="نتائج الفحص السابق انتهت مع إعادة تشغيل الخادم؛ أعد الفحص لعرض المصادر.")
        elif result["status"] not in ("ready","failed"):
            result.update(status="failed",error="انقطعت المهمة بعد إعادة تشغيل Render. لم تتم إضافة المحتوى تلقائيًا؛ أعد الفحص أو الاستيراد.")
        return result
    except (ValueError,requests.RequestException):
        return None
