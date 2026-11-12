"""Read-only, authenticated catalogue quality summaries for Al Ezz TV.

Only the backend service key accesses Supabase. Never return stream URLs or
private account records. Issue counts describe stored metadata, not a live
video playback test.
"""
from __future__ import annotations

import threading
import time

from fastapi import APIRouter, HTTPException, Request

from private_film_import import owner

router=APIRouter()
_LOCK=threading.RLock()
_CACHE={"expires":0.0,"result":None}
_PAGE_SIZE=800
_MAX_ROWS=12000
_FIELDS={
    "movies":"id,status,link_health_status,poster_url,duration_minutes,stream_url",
    "episodes":"id,status,link_health_status,poster_url,duration_minutes,stream_url",
    "series":"id,status,poster_url",
    "channels":"id,status,link_health_status,poster_url,stream_url,official_url,playback_mode",
}

def _rows(portal,table,select):
    rows=[]
    for offset in range(0,_MAX_ROWS,_PAGE_SIZE):
        page=portal.upstream("GET","/rest/v1/aseel_"+table,secret=True,params={
            "select":select,"limit":str(_PAGE_SIZE),"offset":str(offset),"order":"id.asc"
        })
        if not isinstance(page,list):
            raise RuntimeError("Invalid database response")
        rows.extend(page)
        if len(page)<_PAGE_SIZE:
            return rows
    raise RuntimeError("Catalogue quality result exceeds safe pagination limit")

def _summarize(rows,kind):
    result={
        "total":len(rows),"published":0,"draft":0,"hidden":0,
        "published_broken":0,"published_suspect":0,"published_unchecked":0,
        "all_broken":0,"all_suspect":0,
        "missing_poster":0,"missing_duration":0,"missing_primary_source":0
    }
    for row in rows:
        status=str(row.get("status") or "").lower()
        health=str(row.get("link_health_status") or "").lower()
        if status=="published":result["published"]+=1
        elif status=="draft":result["draft"]+=1
        elif status=="hidden":result["hidden"]+=1
        if health=="broken":result["all_broken"]+=1
        if health=="suspect":result["all_suspect"]+=1
        if status=="published":
            if health=="broken":result["published_broken"]+=1
            elif health=="suspect":result["published_suspect"]+=1
            elif health=="unchecked":result["published_unchecked"]+=1
        if not str(row.get("poster_url") or "").strip():
            result["missing_poster"]+=1
        if kind in ("movies","episodes"):
            value=row.get("duration_minutes")
            try: duration=float(value) if value is not None else 0.0
            except (TypeError,ValueError):duration=0.0
            if duration<2:result["missing_duration"]+=1
        if kind in ("movies","episodes","channels"):
            if not str(row.get("stream_url") or "").strip():
                if kind!="channels" or row.get("playback_mode")!="official_link":
                    result["missing_primary_source"]+=1
    return result

def _snapshot(portal):
    results={}
    for kind,select in _FIELDS.items():
        results[kind]=_summarize(_rows(portal,kind,select),kind)
    items=results
    return {
        "version":"quality-v1","updated_at":int(time.time()),"source":"supabase_metadata",
        "scope":"stored_status_not_live_playback",
        "content":items,
        "totals":{
            "works":items["movies"]["total"]+items["series"]["total"],
            "episodes":items["episodes"]["total"],
            "channels":items["channels"]["total"],
            "published_broken":sum(v["published_broken"] for v in items.values()),
            "published_suspect":sum(v["published_suspect"] for v in items.values()),
            "missing_poster":sum(v["missing_poster"] for v in items.values()),
            "missing_duration":items["movies"]["missing_duration"]+items["episodes"]["missing_duration"]
        },
        "notes":[
            "هذه حالات محفوظة في قاعدة البيانات وليست اختبار بث مباشر.",
            "المصادر المشتبه بها أو المعطلة لا تُحذف عند ظهورها في لوحة الجودة.",
            "المحتوى المنشور غير السليم يُراجع أولًا قبل اعتماد إصلاحه."
        ]
    }

def register(portal):
    @router.get("/api/studio/quality")
    def dashboard(request:Request):
        owner(request,portal)
        with _LOCK:
            if _CACHE["result"] is not None and time.monotonic()<_CACHE["expires"]:
                return _CACHE["result"]
            try:
                result=_snapshot(portal)
            except Exception as exc:
                raise HTTPException(503,"تعذّر قراءة ملخص الجودة من Supabase: "+type(exc).__name__) from None
            _CACHE["result"]=result
            _CACHE["expires"]=time.monotonic()+90
            return result
