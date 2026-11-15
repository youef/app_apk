"""Non-invasive management layer for the frozen, legacy Al Ezz Studio extractor.

This module only reads existing AutoSync tables, queues existing refresh work and
edits publication status with the authenticated admin client. It never imports
or invokes player extraction, browser automation or stream inspection itself.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import threading
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from auto_sync import target_key

ALLOWED_TABLES = {"aseel_movies", "aseel_series", "aseel_episodes"}
ALERT_TYPES = {
    "new_episode": ("حلقة جديدة", "success"),
    "all_links_failed": ("تعطل رابط تشغيل", "danger"),
    "replacement": ("تجديد رابط", "success"),
    "missing_source": ("مصدر أصلي مفقود", "warning"),
    "episode_gap": ("فجوة في الحلقات", "warning"),
    "task_error": ("خطأ أثناء الفحص", "danger"),
    "worker_error": ("توقف عامل المزامنة", "danger"),
}
MAX_BATCH = 60


def stamp_label(value):
    if not value:
        return None
    return datetime.fromtimestamp(float(value), timezone.utc).isoformat()


def path_label(value):
    """No signed playback query parameters or tokens in UI responses."""
    if not value:
        return ""
    parsed = urlsplit(str(value))
    return (parsed.hostname or "") + (parsed.path or "")[:180]


def analyze_seasons(seasons, episodes):
    """Pure, deterministic per-season duplicate/gap analysis for the dashboard."""
    output = []
    for season in seasons:
        members = [e for e in episodes if e.get("season_id") == season.get("id")]
        members.sort(key=lambda e: (int(e.get("number") or 0), e.get("id", "")))
        numbers = [int(e.get("number") or 0) for e in members if int(e.get("number") or 0) > 0]
        seen, duplicates = set(), []
        for number in numbers:
            if number in seen and number not in duplicates:
                duplicates.append(number)
            seen.add(number)
        gaps = sorted(set(range(1, min(max(numbers, default=0), 1000) + 1)) - seen)
        output.append({
            "id": season.get("id"), "number": season.get("number"),
            "title": season.get("title_ar") or "الموسم " + str(season.get("number") or ""),
            "episodes": members, "missing": gaps[:100], "duplicate": duplicates[:100],
            "missing_total": len(gaps), "duplicate_total": len(duplicates)
        })
    output.sort(key=lambda s: (int(s.get("number") or 0), str(s.get("id") or "")))
    return output


class BatchStatus(BaseModel):
    table: str
    ids: list[str] = Field(min_length=1, max_length=MAX_BATCH)
    status: str
    dry_run: bool = False


class RefreshTargets(BaseModel):
    targets: list[dict] = Field(min_length=1, max_length=60)


class AckBody(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=100)


class Control:
    def __init__(self, data_dir, autosync):
        self.path = str(Path(data_dir) / "studio_control.sqlite3")
        self.autosync = autosync
        self.lock = threading.RLock()
        self.stop_signal = threading.Event()
        self.thread = None
        with self.db() as db:
            db.executescript("""
            pragma journal_mode=WAL;
            create table if not exists control_alerts(
              id integer primary key, fingerprint text not null unique,
              created_at real not null, severity text not null,
              title text not null, message text not null,
              table_name text not null default '',target_id text not null default '',
              read_at real not null default 0
            );
            create index if not exists control_alerts_recent
                on control_alerts(created_at desc);
            create table if not exists control_audit(
              id integer primary key,created_at real not null,
              action text not null,table_name text not null,
              target_id text not null,old_status text not null default '',
              new_status text not null default '',detail text not null default ''
            );
            create table if not exists control_state(
              key text primary key,value text not null
            );
            """)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=12)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stop_signal.clear()
        self.thread = threading.Thread(target=self._loop, daemon=True, name="studio-control-monitor")
        self.thread.start()

    def stop(self):
        self.stop_signal.set()
        if self.thread:
            self.thread.join(timeout=3)

    def _loop(self):
        while not self.stop_signal.is_set():
            try:
                self.step()
            except Exception:
                # Existing AutoSync is independent; UI reports its own status.
                pass
            self.stop_signal.wait(60)

    def _alert(self, fingerprint, title, severity, message, table="", identifier=""):
        with self.db() as db:
            db.execute("""insert or ignore into control_alerts
              (fingerprint,created_at,severity,title,message,table_name,target_id)
              values(?,?,?,?,?,?,?)""",
              (str(fingerprint)[:160],time.time(),severity,title,str(message)[:320],
               str(table or "")[:40],str(identifier or "")[:40]))

    def audit(self, action, table, identifier, old="", new="", detail=""):
        with self.db() as db:
            db.execute("""insert into control_audit
             (created_at,action,table_name,target_id,old_status,new_status,detail)
             values(?,?,?,?,?,?,?)""",
             (time.time(),action,table,identifier,old,new,str(detail)[:300]))

    def step(self):
        """Read existing events, notify, and prequeue refresh without changing resolver."""
        with self.lock:
            with self.db() as db:
                state = db.execute("select value from control_state where key='last_event_id'").fetchone()
                cursor = int(state["value"]) if state else 0
            with self.autosync.queue.db() as queue:
                events = [dict(r) for r in queue.execute(
                    "select * from auto_events where id>? order by id asc limit 300", (cursor,))]
                expiring = [dict(r) for r in queue.execute("""
                    select s.table_name,s.target_id,s.source_key,s.expires_at,
                           j.title,j.page_url,j.next_refresh
                    from auto_sources s join auto_jobs j
                    on s.table_name=j.table_name and s.target_id=j.target_id
                    where s.kind='direct' and s.status='healthy'
                    and s.expires_at>? and s.expires_at<=?
                    order by s.expires_at asc limit 100
                """, (time.time(), time.time()+5400))]
            for event in events:
                kind = event["kind"]
                if kind in ALERT_TYPES:
                    title, severity = ALERT_TYPES[kind]
                    self._alert("event:"+str(event["id"]), title, severity,
                                event["message"],event.get("table_name"),event.get("target_id"))
            if events:
                with self.db() as db:
                    db.execute("""insert into control_state(key,value) values('last_event_id',?)
                        on conflict(key) do update set value=excluded.value""",(str(events[-1]["id"]),))
            for source in expiring:
                exp = float(source["expires_at"])
                fp = "expiry:%s:%s:%d" % (source["target_id"],source["source_key"],int(exp))
                self._alert(fp,"اقتراب انتهاء رابط","warning",
                            (source.get("title") or "مقطع") + " — ينتهي الرابط خلال أقل من 90 دقيقة",
                            source["table_name"],source["target_id"])
                if (not self.autosync.enabled or not source["page_url"]
                        or float(source["next_refresh"]) <= time.time()+90):
                    continue
                requested_key = "refresh:" + fp
                with self.db() as db:
                    previous = db.execute("select value from control_state where key=?",
                                          (requested_key,)).fetchone()
                    if previous:
                        continue
                    db.execute("insert into control_state(key,value) values(?,?)",
                               (requested_key,str(time.time())))
                self.autosync.queue.queue(source["table_name"],source["target_id"],refresh=True)
                self.autosync.wake_event.set()
                self.audit("scheduled_refresh",source["table_name"],source["target_id"],
                           detail="Queued ahead of signed source expiry")

    def overview(self):
        with self.autosync.queue.db() as db:
            summary = [dict(r) for r in db.execute(
                "select table_name,status,count(*) n from auto_jobs group by table_name,status")]
            expiring = db.execute("""select count(*) from auto_sources where kind='direct'
               and status='healthy' and expires_at>? and expires_at<=?""",
               (time.time(),time.time()+5400)).fetchone()[0]
            next_due = db.execute("select min(next_check) from auto_jobs where next_check>0").fetchone()[0]
            errors = db.execute("select count(*) from auto_jobs where error!=''").fetchone()[0]
        with self.db() as db:
            unread = db.execute("select count(*) from control_alerts where read_at=0").fetchone()[0]
            recent = [dict(r) for r in db.execute("""select id,created_at,severity,title,message,
                table_name,target_id,read_at from control_alerts order by id desc limit 8""")]
        count = {key:0 for key in ("movies","series","episodes","healthy","broken","suspect","unchecked")}
        for row in summary:
            category = {"aseel_movies":"movies","aseel_series":"series",
                        "aseel_episodes":"episodes"}.get(row["table_name"])
            if category: count[category] += row["n"]
            status = row["status"]
            if status in count: count[status] += row["n"]
        sync = self.autosync.status()
        return {
            "counts":count,"expiring":expiring,"errors":errors,"next_due":next_due,
            "alerts_unread":unread,"alerts":recent,
            "worker":{"running":bool(sync.get("running")),"enabled":bool(sync.get("enabled")),
                      "connected":bool(sync.get("connected")),
                      "last_tick":sync.get("last_tick"),"last_error":sync.get("last_error") or ""}
        }

    def library(self, db):
        """Fetch authoritative Supabase relationships; don't infer from URL title."""
        def pages(table, columns):
            result = []
            for offset in range(0,2000,250):
                chunk = db.query(table,{"select":columns,"limit":"250","offset":str(offset)})
                result += chunk
                if len(chunk)<250:
                    break
            return result
        movies = pages("aseel_movies","id,title_ar,status,rights_status,stream_url,source_page_url,link_health_status")
        series = pages("aseel_series","id,title_ar,status,rights_status,source_page_url")
        seasons = pages("aseel_seasons","id,series_id,number,title_ar")
        episodes = pages("aseel_episodes",
                         "id,season_id,number,title_ar,status,rights_status,stream_url,source_page_url,link_health_status")
        by_series = {}
        for season in seasons:
            by_series.setdefault(season.get("series_id"),[]).append(season)
        by_season = {}
        for episode in episodes:
            by_season.setdefault(episode.get("season_id"),[]).append(episode)
        all_series = []
        for entry in series:
            own_seasons = by_series.get(entry["id"], [])
            own_episodes = [episode for season in own_seasons
                            for episode in by_season.get(season["id"], [])]
            result = {**entry,"seasons":analyze_seasons(own_seasons, own_episodes)}
            result["episode_count"] = len(own_episodes)
            result["verified_count"] = sum(x.get("link_health_status")=="healthy" for x in own_episodes)
            all_series.append(result)
        return {
            "authenticated":True,"movies":movies,"series":all_series,
            "totals":{"movies":len(movies),"series":len(series),
                      "seasons":len(seasons),"episodes":len(episodes),
                      "drafts":sum(e.get("status")!="published" for e in episodes+movies),
                      "published":sum(e.get("status")=="published" for e in episodes+movies),
                      "missing_links":sum(not e.get("stream_url") for e in episodes+movies)}
        }

    def router(self, get_state, protected, base):
        router = APIRouter()
        control = self

        @router.get("/studio/control")
        async def dashboard_page(request: Request):
            get_state(request, create=True)
            return FileResponse(base/"templates"/"control.html",headers={"Cache-Control":"no-store"})

        @router.get("/api/control/overview")
        async def overview(request:Request):
            get_state(request)
            return JSONResponse(await asyncio.to_thread(control.overview),headers={"Cache-Control":"no-store"})

        @router.get("/api/control/library")
        async def library(request:Request):
            _,state = get_state(request)
            if not state.db:
                return {"authenticated":False,"movies":[],"series":[],"message":"سجّل حساب مسؤول Supabase داخل الاستوديو أولًا"}
            try:
                result = await asyncio.to_thread(control.library,state.db)
            except Exception as exc:
                raise HTTPException(502,"تعذر جلب المكتبة من Supabase: "+str(exc)[:160]) from None
            return JSONResponse(result,headers={"Cache-Control":"no-store"})

        @router.get("/api/control/alerts")
        async def alerts(request:Request,limit:int=50):
            get_state(request)
            with control.db() as db:
                rows = [dict(r) for r in db.execute("""select id,created_at,severity,title,message,
                        table_name,target_id,read_at from control_alerts order by id desc limit ?""",
                        (min(max(limit,1),100),))]
            return {"alerts":rows}

        @router.get("/api/control/audit")
        async def audits(request:Request,limit:int=75):
            get_state(request)
            with control.db() as db:
                rows = [dict(r) for r in db.execute("""select * from control_audit
                      order by id desc limit ?""",(min(max(limit,1),150),))]
            return {"audits":rows}

        @router.get("/api/control/sources")
        async def source_history(request:Request,table:str,id:str):
            get_state(request)
            try:
                table,identifier = target_key(table,id)
            except ValueError as exc:
                raise HTTPException(400,str(exc)) from None
            rows = control.autosync.queue.sources(table,identifier)[:200]
            return {"sources":[{"kind":r["kind"],"status":r["status"],
                "address":path_label(r["url"]),"first_seen_at":r["first_seen_at"],
                "last_seen_at":r["last_seen_at"],"expires_at":r["expires_at"],
                "successes":r["successes"],"failures":r["failures"]}
                for r in rows]}

        @router.post("/api/control/alerts/read")
        async def ack(request:Request, body:AckBody):
            protected(request)
            with control.db() as db:
                db.executemany("update control_alerts set read_at=? where id=? and read_at=0",
                               [(time.time(),i) for i in set(body.ids)])
            return {"ok":True}

        @router.post("/api/control/refresh")
        async def refresh(request:Request,body:RefreshTargets):
            protected(request)
            if not control.autosync.enabled:
                raise HTTPException(409,"المزامنة التلقائية متوقفة؛ شغّل العامل من الاستوديو")
            checked = []
            for item in body.targets:
                try:
                    table,identifier = target_key(str(item.get("table","")),str(item.get("id","")))
                except ValueError:
                    continue
                if table not in ALLOWED_TABLES or (table,identifier) in checked:
                    continue
                with control.autosync.queue.db() as db:
                    exists = db.execute("""select 1 from auto_jobs where table_name=?
                                        and target_id=?""",(table,identifier)).fetchone()
                if not exists:
                    continue
                checked.append((table,identifier))
                control.autosync.queue.queue(table,identifier,refresh=True)
                control.audit("manual_refresh",table,identifier,detail="Queued legacy AutoSync")
            if not checked:
                raise HTTPException(404,"لا توجد عناصر مرتبطة بالعامل لتجديدها")
            control.autosync.wake_event.set()
            return {"ok":True,"queued":len(checked)}

        @router.post("/api/control/bulk-status")
        async def bulk_status(request:Request,body:BatchStatus):
            state = protected(request)
            if not state.db:
                raise HTTPException(401,"سجّل الدخول بحساب مسؤول Supabase قبل إدارة النشر")
            if body.table not in ALLOWED_TABLES or body.status not in ("draft","published"):
                raise HTTPException(400,"نوع العمل أو حالة النشر غير صالحة")
            ids=[]
            for id in body.ids:
                try:
                    table,identifier = target_key(body.table,id)
                except ValueError:
                    continue
                if table==body.table and identifier not in ids:ids.append(identifier)
            if not ids:
                raise HTTPException(400,"لا توجد معرّفات صالحة")
            def work():
                succeeded, refused = [], []
                for identifier in ids:
                    try:
                        fields = "id,title_ar,status,rights_status"
                        if body.table!="aseel_series":
                            fields += ",stream_url,link_health_status"
                        row = state.db.single(body.table,{"select":fields,"id":"eq."+identifier})
                        if not row:
                            raise ValueError("العنصر غير موجود أو ليس لديك صلاحية")
                        if body.status=="published":
                            if row.get("rights_status")!="approved":
                                raise ValueError("النشر يتطلب حقوق عرض معتمدة مسبقًا")
                            if body.table!="aseel_series" and (
                                not str(row.get("stream_url") or "").startswith("https://")
                                or row.get("link_health_status")!="healthy"):
                                raise ValueError("الرابط المباشر لم يجتز التحقق")
                        if not body.dry_run and row.get("status")!=body.status:
                            state.db.patch(body.table,identifier,{"status":body.status})
                            control.audit("publish" if body.status=="published" else "draft",
                                         body.table,identifier,row.get("status") or "",body.status,
                                         row.get("title_ar") or "")
                        succeeded.append({"id":identifier,"title":row.get("title_ar") or ""})
                    except Exception as exc:
                        refused.append({"id":identifier,"reason":str(exc)[:160]})
                return {"ok":not refused,"updated":len(succeeded) if not body.dry_run else 0,
                        "ready":len(succeeded),"refused":refused,
                        "dry_run":body.dry_run,"status":body.status}
            return await asyncio.to_thread(work)

        return router
