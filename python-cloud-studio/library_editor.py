"""Admin-only library detail, CRUD and on-demand maintenance for Al Ezz Studio.

Mutations use the signed-in Supabase admin session (RLS still applies).
No service-role credential or playback token is sent to a public client.
"""
from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from alezz_fetchv_importer import public_url
from auto_sync import target_key


WORK_TABLES = {"aseel_movies", "aseel_series", "aseel_episodes", "aseel_seasons"}
FIELDS = {
    "aseel_movies": {"title_ar", "description", "poster_url", "backdrop_url",
                     "source_page_url", "stream_url", "title_original", "release_year"},
    "aseel_series": {"title_ar", "description", "poster_url", "backdrop_url",
                     "source_page_url", "title_original", "release_year"},
    "aseel_seasons": {"title_ar", "number"},
    "aseel_episodes": {"title_ar", "description", "poster_url",
                       "source_page_url", "stream_url", "number"},
}
URL_FIELDS = {"poster_url", "backdrop_url", "source_page_url", "stream_url"}
READ_FIELDS = {
    "aseel_movies": "id,title_ar,description,poster_url,backdrop_url,source_page_url,stream_url,status,rights_status,link_health_status,link_health_checked_at",
    "aseel_series": "id,title_ar,description,poster_url,backdrop_url,source_page_url,status,rights_status",
    "aseel_seasons": "id,series_id,number,title_ar",
    "aseel_episodes": "id,season_id,number,title_ar,description,poster_url,source_page_url,stream_url,status,rights_status,link_health_status,link_health_checked_at",
}


def uid(value: str) -> str:
    return str(UUID(str(value)))


def normalized_fields(table: str, raw: dict) -> dict:
    if table not in WORK_TABLES:
        raise ValueError("نوع المحتوى غير مدعوم")
    if not isinstance(raw, dict):
        raise ValueError("حقول التعديل غير صالحة")
    unknown = set(raw) - FIELDS[table]
    if unknown:
        raise ValueError("حقول غير مسموح تعديلها: " + ", ".join(sorted(unknown)))
    out = {}
    for key, value in raw.items():
        if key in URL_FIELDS:
            value = str(value or "").strip()
            if value:
                public_url(value)
                if key == "stream_url" and not urlsplit(value).path.lower().endswith((".mp4",".m3u8",".m4v",".webm")):
                    raise ValueError("رابط التشغيل اليدوي يجب أن يكون MP4 أو HLS مباشرًا")
            out[key] = value or None
        elif key in {"number", "release_year"}:
            try:
                number = int(value)
            except (TypeError, ValueError):
                raise ValueError("رقم الموسم/الحلقة/السنة غير صالح") from None
            if key == "number" and not 1 <= number <= (200 if table == "aseel_seasons" else 10000):
                raise ValueError("رقم الموسم/الحلقة خارج النطاق")
            if key == "release_year" and not 1880 <= number <= 2100:
                raise ValueError("سنة الإصدار غير صالحة")
            out[key] = number
        else:
            value = str(value or "").strip()
            if len(value) > (3000 if key == "description" else 250):
                raise ValueError("النص طويل جدًا")
            if key == "title_ar" and not value:
                raise ValueError("العنوان مطلوب")
            out[key] = value or None
    return out


class EditBody(BaseModel):
    action: str = Field(max_length=12)
    table: str = Field(max_length=30)
    id: str = Field(default="", max_length=64)
    fields: dict[str, Any] = Field(default_factory=dict)
    series_id: str = Field(default="", max_length=64)
    season_id: str = Field(default="", max_length=64)
    season_number: int = Field(default=1, ge=1, le=200)
    cascade: bool = False
    confirm: str = Field(default="", max_length=64)


class ScanBody(BaseModel):
    table: str
    id: str
    force: bool = False


class LibraryEditor:
    def __init__(self, worker, control):
        self.worker = worker
        self.control = control

    def _fetch(self, db, table, identifier):
        return db.single(table, {"select": READ_FIELDS[table], "id": "eq." + uid(identifier)})

    def detail(self, db, table, identifier):
        if table not in WORK_TABLES:
            raise ValueError("نوع المحتوى غير معروف")
        identifier = uid(identifier)
        item = self._fetch(db, table, identifier)
        if not item:
            raise ValueError("العنصر غير موجود أو لم يُسمح بعرضه")
        details = {"item": item, "table": table, "seasons": []}
        if table == "aseel_series":
            seasons = db.query("aseel_seasons", {
                "select": READ_FIELDS["aseel_seasons"],
                "series_id": "eq." + identifier, "order": "number.asc", "limit": "200"})
            for season in seasons:
                season["episodes"] = db.query("aseel_episodes", {
                    "select": READ_FIELDS["aseel_episodes"],
                    "season_id": "eq." + season["id"],
                    "order": "number.asc", "limit": "10000"})
            details["seasons"] = seasons
        # Safe scheduling metadata only; the source history remains private.
        with self.worker.queue.db() as conn:
            targets = [("aseel_series",identifier)] if table == "aseel_series" else (
                [("aseel_episodes",ep["id"]) for season in details["seasons"]
                 for ep in season["episodes"]] if table == "aseel_series" else [(table,identifier)])
            if table == "aseel_series":
                targets += [("aseel_episodes",ep["id"]) for season in details["seasons"]
                            for ep in season["episodes"]]
            jobs = {}
            for t,i in targets:
                row = conn.execute("""select status,last_check,next_check,last_refresh,next_refresh,
                        failures,error from auto_jobs where table_name=? and target_id=?""",(t,i)).fetchone()
                if row: jobs[t+":"+i] = dict(row)
            details["schedule"] = jobs
        return details

    def _season(self, db, series_id, number, create=False):
        series_id = uid(series_id)
        if not self._fetch(db, "aseel_series", series_id):
            raise ValueError("المسلسل غير موجود")
        row = db.single("aseel_seasons",{"select":READ_FIELDS["aseel_seasons"],
                 "series_id":"eq."+series_id,"number":"eq."+str(number)})
        if not row and create:
            row = db.insert("aseel_seasons",{"series_id":series_id,"number":number,
                                            "title_ar":"الموسم "+str(number)})
        return row

    def _schedule_row(self, table, row, *, force=False):
        if table not in ("aseel_movies", "aseel_series", "aseel_episodes"):
            return
        self.worker.queue.ingest(table,row)
        if force:
            self.worker.queue.queue(table,row["id"],refresh=True)
        self.worker.wake_event.set()

    def _drop_queued(self, table, identifier):
        with self.worker.queue.db() as conn:
            conn.execute("delete from auto_jobs where table_name=? and target_id=?",(table,identifier))
            conn.execute("delete from auto_sources where table_name=? and target_id=?",(table,identifier))
            conn.execute("delete from smart_early_refresh where table_name=? and target_id=?",(table,identifier))

    def _delete_one(self, db, table, identifier):
        identifier = uid(identifier)
        if not self._fetch(db, table, identifier):
            raise ValueError("العنصر غير موجود")
        # Remove linked source history first; it must not resurrect stale URLs.
        if table in ("aseel_movies","aseel_series","aseel_episodes"):
            db.req("DELETE","aseel_media_sources",
                   {"target_table":"eq."+table,"target_id":"eq."+identifier})
        db.req("DELETE",table,{"id":"eq."+identifier})
        if self._fetch(db,table,identifier):
            raise ValueError("الحذف مرفوض من قاعدة البيانات أو صلاحيات RLS")
        if table in ("aseel_movies","aseel_series","aseel_episodes"):
            self._drop_queued(table,identifier)
        self.control.audit("delete",table,identifier,detail="حذف بواسطة المسؤول")

    def delete(self, db, body: EditBody):
        table, identifier = body.table, uid(body.id)
        if body.confirm != identifier:
            raise ValueError("يجب تأكيد الحذف بمعرّف العنصر")
        count = 0
        if table == "aseel_series":
            seasons = db.query("aseel_seasons",{"select":"id","series_id":"eq."+identifier})
            if seasons and not body.cascade:
                raise ValueError("لحذف مسلسل ومواسمه يجب تأكيد حذف جميع حلقاته")
            for season in seasons:
                episodes = db.query("aseel_episodes",{"select":"id","season_id":"eq."+season["id"]})
                for ep in episodes:
                    self._delete_one(db,"aseel_episodes",ep["id"])
                    count += 1
                self._delete_one(db,"aseel_seasons",season["id"])
                count += 1
        elif table == "aseel_seasons":
            episodes = db.query("aseel_episodes",{"select":"id","season_id":"eq."+identifier})
            if episodes and not body.cascade:
                raise ValueError("الموسم يحوي حلقات؛ يلزم تأكيد حذفها")
            for ep in episodes:
                self._delete_one(db,"aseel_episodes",ep["id"])
                count += 1
        self._delete_one(db,table,identifier)
        self.worker.force_import = True
        self.worker.wake_event.set()
        return {"ok": True, "deleted": count+1}

    def save(self, db, body: EditBody):
        table = body.table
        values = normalized_fields(table,body.fields)
        create = body.action == "create"
        if not create and body.action != "update":
            raise ValueError("أمر غير مدعوم")
        identifier = uid(body.id) if not create else ""
        existing = self._fetch(db,table,identifier) if not create else None
        if not create and not existing:
            raise ValueError("العنصر غير موجود")
        if create and table in ("aseel_movies","aseel_series") and not values.get("title_ar"):
            raise ValueError("اسم العمل مطلوب")
        if create and table == "aseel_seasons":
            existing_season = self._season(db,body.series_id,values.get("number") or body.season_number)
            if existing_season:
                raise ValueError("الموسم موجود مسبقًا")
            values["series_id"] = uid(body.series_id)
            values.setdefault("number",body.season_number)
            values.setdefault("title_ar","الموسم "+str(values["number"]))
        if create and table == "aseel_episodes":
            season_id = uid(body.season_id) if body.season_id else ""
            if season_id:
                season = self._fetch(db,"aseel_seasons",season_id)
                if not season:
                    raise ValueError("الموسم غير موجود")
                if body.series_id and season["series_id"] != uid(body.series_id):
                    raise ValueError("الموسم لا يتبع المسلسل المطلوب")
            else:
                if not body.series_id:
                    raise ValueError("حدد المسلسل والموسم")
                season = self._season(db,body.series_id,body.season_number,create=True)
                season_id = season["id"]
            number = values.get("number")
            if not number:
                raise ValueError("رقم الحلقة مطلوب")
            duplicate = db.single("aseel_episodes",{"select":"id","season_id":"eq."+season_id,
                                                     "number":"eq."+str(number)})
            if duplicate:
                raise ValueError("الحلقة موجودة مسبقًا في هذا الموسم")
            values["season_id"] = season_id
            values.setdefault("title_ar","الحلقة "+str(number))
        if not create and table in ("aseel_episodes","aseel_seasons") and "number" in values:
            key = "season_id" if table == "aseel_episodes" else "series_id"
            duplicate = db.single(table,{"select":"id",key:"eq."+existing[key],
                                         "number":"eq."+str(values["number"])})
            if duplicate and duplicate["id"] != identifier:
                raise ValueError("الرقم مستخدم مسبقًا")
        if not values:
            raise ValueError("لم تُرسل بيانات للتعديل")
        changed_stream = "stream_url" in values and (create or values["stream_url"]!=existing.get("stream_url"))
        changed_source = "source_page_url" in values and (create or values["source_page_url"]!=existing.get("source_page_url"))
        if changed_stream:
            values.update(link_health_status="unchecked",link_health_reason=None,
                          link_health_checked_at=None,link_health_failures=0,
                          link_health_url=values["stream_url"])
        if create and table in ("aseel_movies","aseel_series","aseel_episodes"):
            values.update(status="draft",rights_status="pending")
        row = db.insert(table,values) if create else db.patch(table,identifier,values)
        self._schedule_row(table,row,force=changed_stream or changed_source)
        self.control.audit("create" if create else "update",table,row["id"],
                           detail=str(row.get("title_ar") or ""))
        self.worker.force_import = True
        self.worker.wake_event.set()
        return {"ok":True,"id":row["id"],"created":create,"table":table}

    def scan(self, db, body: ScanBody):
        table=body.table
        if table not in ("aseel_movies","aseel_series","aseel_episodes"):
            raise ValueError("الفحص متاح للمسلسلات والأفلام والحلقات")
        identifier=uid(body.id)
        if not self._fetch(db,table,identifier):
            raise ValueError("العنصر غير موجود")
        targets=[(table,identifier)]
        if table=="aseel_series":
            seasons=db.query("aseel_seasons",{"select":"id","series_id":"eq."+identifier})
            for season in seasons:
                eps=db.query("aseel_episodes",{"select":"id","season_id":"eq."+season["id"]})
                targets += [("aseel_episodes",ep["id"]) for ep in eps]
        with self.worker.queue.db() as conn:
            available = {(r["table_name"],r["target_id"]) for r in conn.execute(
                "select table_name,target_id from auto_jobs where table_name in ('aseel_movies','aseel_episodes','aseel_series')")}
        queued = 0
        for t,i in targets:
            if (t,i) not in available:
                row=self._fetch(db,t,i)
                if row:self._schedule_row(t,row)
            self.worker.queue.queue(t,i,refresh=body.force)
            queued += 1
        self.worker.wake_event.set()
        self.control.audit("manual_refresh" if body.force else "manual_check",table,identifier,
                           detail="الحلقات التابعة ضمن الطابور: "+str(max(0,queued-1)))
        return {"ok":True,"queued":queued,"mode":"refresh" if body.force else "check"}

    def router(self,get_state,protected):
        router=APIRouter()
        editor=self

        def auth(request):
            _,state=get_state(request)
            if state.db is None:
                raise HTTPException(401,"سجّل الدخول بحساب المسؤول أولًا")
            return state.db

        @router.get("/api/control/item")
        async def get_item(request:Request,table:str,id:str):
            db=auth(request)
            try:
                result=await asyncio.to_thread(editor.detail,db,table,id)
            except (ValueError,TypeError) as exc:
                raise HTTPException(400,str(exc)) from None
            return JSONResponse(result,headers={"Cache-Control":"private, no-store"})

        @router.post("/api/control/item")
        async def edit_item(request:Request,body:EditBody):
            protected(request)
            db=auth(request)
            try:
                result=await asyncio.to_thread(editor.delete if body.action=="delete" else editor.save,db,body)
            except (ValueError,TypeError) as exc:
                raise HTTPException(400,str(exc)[:240]) from None
            return result

        @router.post("/api/control/check")
        async def check_item(request:Request,body:ScanBody):
            protected(request)
            db=auth(request)
            try:
                result=await asyncio.to_thread(editor.scan,db,body)
            except (ValueError,TypeError) as exc:
                raise HTTPException(400,str(exc)[:240]) from None
            return result

        return router
