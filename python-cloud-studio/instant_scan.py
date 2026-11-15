"""Real-time, concurrent, operator-triggered scans (not the scheduled queue).

Progress is persisted locally in the same SQLite database as AutoSync.
Only already approved/licensed verified media are auto-published. Every
link still passes through AutoSync's existing MediaResolver checks.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import threading
import time
from uuid import uuid4, UUID

from auto_sync import target_key
from media_resolver import safe_error


SCAN_TABLES = frozenset(("aseel_movies", "aseel_series", "aseel_episodes"))
FINISHED = frozenset(("completed", "partial", "failed", "interrupted"))
MAX_CONCURRENT_SCANS = 4
MAX_EPISODE_WORKERS = 4


class ScanBusy(Exception):
    pass


class InstantScanManager:
    def __init__(self, worker, control, clock=time.time):
        self.worker = worker
        self.control = control
        self.clock = clock
        self.lock = threading.RLock()
        self.slots = threading.BoundedSemaphore(MAX_CONCURRENT_SCANS)
        self.active = {}
        with self.worker.queue.db() as con:
            con.executescript("""
            create table if not exists instant_scans(
              run_id text primary key,table_name text not null,target_id text not null,
              status text not null,stage text not null,message text not null,
              progress integer not null default 0,total integer not null default 0,
              completed integer not null default 0,healthy integer not null default 0,
              renewed integer not null default 0,published integer not null default 0,
              failed integer not null default 0,errors text not null default '[]',
              outcomes text not null default '[]',created_at real not null,
              updated_at real not null,finished_at real not null default 0);
            create index if not exists instant_scans_target
              on instant_scans(table_name,target_id,created_at desc);
            """)
            con.execute("""update instant_scans set status='interrupted',stage='interrupted',
                message='انقطع الفحص بسبب إعادة تشغيل الخادم',finished_at=?,updated_at=?
                where status='running'""",(self.clock(),self.clock()))
            con.execute("delete from instant_scans where created_at<?",
                        (self.clock()-7*86400,))

    def _save(self,run_id,**fields):
        fields["updated_at"] = self.clock()
        with self.worker.queue.db() as con:
            con.execute("update instant_scans set "+",".join(k+"=?" for k in fields)+
                        " where run_id=?",(*fields.values(),run_id))

    def _status(self,run_id):
        with self.worker.queue.db() as con:
            row=con.execute("select * from instant_scans where run_id=?",(str(UUID(str(run_id))),)).fetchone()
        if not row:return None
        value=dict(row)
        value["errors"]=json.loads(value["errors"] or "[]")
        value["outcomes"]=json.loads(value["outcomes"] or "[]")
        return value

    def status(self,run_id):
        result=self._status(run_id)
        if not result:raise ValueError("عملية الفحص غير موجودة")
        return result

    def latest(self,table,identifier):
        table,identifier=target_key(table,identifier)
        with self.worker.queue.db() as con:
            row=con.execute("""select run_id from instant_scans where table_name=?
                and target_id=? order by created_at desc limit 1""",(table,identifier)).fetchone()
        return self._status(row["run_id"]) if row else None

    def start(self,db,table,identifier,force=True):
        table,identifier=target_key(table,identifier)
        if table not in SCAN_TABLES:raise ValueError("الفحص الفوري متاح للأفلام والمسلسلات والحلقات فقط")
        # Verify the signed-in administrator's actual RLS visibility first.
        item=db.single(table,{"select":"id,title_ar","id":"eq."+identifier})
        if not item:raise ValueError("العنصر غير موجود أو لا تملك صلاحية فحصه")
        key=(table,identifier)
        with self.lock:
            previous=self.active.get(key)
            if previous:return {"ok":True,"run_id":previous,"already_running":True}
            if not self.slots.acquire(blocking=False):
                raise ScanBusy("يوجد أربعة فحوص فورية تعمل الآن؛ أعد المحاولة بعد انتهائها")
            run_id=str(uuid4())
            now=self.clock()
            try:
                with self.worker.queue.db() as con:
                    con.execute("""insert into instant_scans(run_id,table_name,target_id,status,
                        stage,message,progress,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)""",
                        (run_id,table,identifier,"running","starting",
                         "بدء الفحص المباشر",2,now,now))
            except Exception:
                self.slots.release()
                raise
            self.active[key]=run_id
            try:
                thread=threading.Thread(target=self._run,args=(db,table,identifier,run_id,bool(force)),
                                        name="alezz-immediate-scan-"+run_id[:8],daemon=True)
                thread.start()
            except Exception:
                self.active.pop(key,None)
                self.slots.release()
                self._save(run_id,status="failed",stage="failed",message="تعذر بدء فحص الخادم",
                           finished_at=self.clock())
                raise
        return {"ok":True,"run_id":run_id,"already_running":False}

    def _reserve(self,db,table,identifier,force):
        # The existing autonomous worker sees the same lease and skips this
        # target until the immediate scan is finished. Never replace a live lease.
        with self.worker.queue.db() as con:
            con.execute("begin immediate")
            row=con.execute("""select * from auto_jobs where table_name=?
                and target_id=?""",(table,identifier)).fetchone()
        if not row:
            remote=db.single(table,{"select":"*","id":"eq."+identifier})
            if not remote:raise ValueError("العنصر لم يعد موجودًا في المكتبة")
            self.worker.queue.ingest(table,remote)
        with self.worker.queue.db() as con:
            con.execute("begin immediate")
            now=self.clock()
            row=con.execute("""select * from auto_jobs where table_name=?
                and target_id=?""",(table,identifier)).fetchone()
            if not row:raise ValueError("تعذر تحميل بيانات العنصر للفحص")
            if row["lease_until"]>now:
                raise ScanBusy("هذا العنصر يخضع الآن لفحص آخر")
            con.execute("""update auto_jobs set lease_until=?,next_check=0,
                next_refresh=case when ? then 0 else next_refresh end
                where table_name=? and target_id=?""",
                (now+3600,int(force),table,identifier))
            row=con.execute("""select * from auto_jobs where table_name=?
                and target_id=?""",(table,identifier)).fetchone()
            return dict(row)

    def _release(self,table,identifier):
        self.worker.queue.update(table,identifier,lease_until=0)

    def _approved_publish(self,db,table,identifier):
        if table=="aseel_series":return False
        row=db.single(table,{"select":"id,status,rights_status,stream_url,link_health_status",
                            "id":"eq."+identifier})
        if not row or row.get("rights_status")!="approved":
            return False
        if row.get("link_health_status")!="healthy" or not str(row.get("stream_url") or "").startswith("https://"):
            return False
        if row.get("status")=="published":return False
        db.patch(table,identifier,{"status":"published"})
        self.control.audit("auto_publish",table,identifier,
                           detail="نشر بعد فحص التشغيل وتأكيد الحقوق المعتمدة")
        return True

    def _check_one(self,db,table,identifier,force,progress):
        leased=False
        try:
            job=self._reserve(db,table,identifier,force)
            leased=True
            result=self.worker.check_target(job,remote_db=db,progress_hook=progress)
            if not result:
                raise ValueError("لم ينتج الفحص نتيجة")
            published=self._approved_publish(db,table,identifier) if result["status"]=="healthy" else False
            result["published"]=published
            result.pop("stream_url",None)  # never expose a signed URL to progress storage
            return result
        finally:
            if leased:self._release(table,identifier)

    def _episodes(self,db,identifier):
        seasons=[]
        for offset in range(0,1000,250):
            part=db.query("aseel_seasons",{"select":"id,number","series_id":"eq."+identifier,
                     "order":"number.asc","limit":"250","offset":str(offset)})
            seasons.extend(part)
            if len(part)<250:break
        episodes=[]
        for season in seasons:
            for offset in range(0,20000,500):
                part=db.query("aseel_episodes",{
                    "select":"id,title_ar,number","season_id":"eq."+season["id"],
                    "order":"number.asc","limit":"500","offset":str(offset)})
                episodes.extend((row["id"],"م"+str(season["number"])+" ح"+str(row["number"]),
                                 row.get("title_ar") or "") for row in part)
                if len(part)<500:break
        return episodes

    def _series_publish(self,db,identifier,approved_children):
        if not approved_children:return False
        row=db.single("aseel_series",{"select":"id,rights_status,status",
                                      "id":"eq."+identifier})
        if not row or row.get("rights_status")!="approved" or row.get("status")=="published":
            return False
        db.patch("aseel_series",identifier,{"status":"published"})
        self.control.audit("auto_publish","aseel_series",identifier,
                           detail="تأكيد صلاحية بث الحلقات المعتمدة")
        return True

    def _run(self,db,table,identifier,run_id,force):
        counters={"completed":0,"healthy":0,"renewed":0,"published":0,"failed":0}
        errors=[]
        outcomes=[]
        fractions={}
        fraction_lock=threading.RLock()
        total=1
        def report(stage,message,amount):
            amount=max(0.0,min(1.0,float(amount)))
            percent=int(5+90*amount) if table!="aseel_series" else int(2+18*amount)
            self._save(run_id,stage=stage,message=message[:180],progress=percent)
        try:
            if table=="aseel_series":
                leased=False
                try:
                    job=self._reserve(db,table,identifier,True)
                    leased=True
                    self.worker.discover_series(job,remote_db=db,progress_hook=report)
                except ScanBusy as exc:
                    errors.append(safe_error(exc))
                    self._save(run_id,stage="discover",message="يجري فحص المسلسل تلقائيًا؛ متابعة الحلقات المحفوظة",progress=18)
                except Exception as exc:
                    errors.append("تعذر تحديث قائمة المواسم: "+safe_error(exc))
                    self._save(run_id,stage="discover",message="تعذر اكتشاف مواسم جديدة، يجري فحص الحلقات المحفوظة",progress=18)
                finally:
                    if leased:self._release(table,identifier)
                episodes=self._episodes(db,identifier)
                total=len(episodes)
                self._save(run_id,stage="episodes",message="فحص مشغلات الحلقات بالتوازي",
                           total=total,progress=20)
                if not total:
                    errors.append("لا توجد حلقات مسجلة؛ تحقق من رابط مصدر المسلسل")
                else:
                    # Real concurrent network probes; the scheduled queue is
                    # neither used nor waited on for individual episodes.
                    def check_episode(ep):
                        eid,label,title=ep
                        def episode_progress(stage,message,amount):
                            with fraction_lock:
                                fractions[eid]=max(fractions.get(eid,0.0),amount)
                                percent=20+int(74*sum(fractions.values())/total)
                            self._save(run_id,stage=stage,message="فحص "+label+" · "+message,
                                       progress=max(20,min(94,percent)))
                        return ep,self._check_one(db,"aseel_episodes",eid,force,episode_progress)
                    with ThreadPoolExecutor(max_workers=min(MAX_EPISODE_WORKERS,total)) as pool:
                        futures={pool.submit(check_episode,ep):ep for ep in episodes}
                        for task in as_completed(futures):
                            ep=futures[task]
                            eid,label,title=ep
                            try:
                                _,result=task.result()
                                success=result["status"]=="healthy"
                                counters["healthy"]+=int(success)
                                counters["renewed"]+=int(result["renewed"])
                                counters["published"]+=int(result["published"])
                                counters["failed"]+=int(not success)
                                status="healthy" if success else "broken"
                                note=result.get("error") or ("تم التحقق والتجديد" if result["renewed"] else "المشغل سليم")
                                if not success:errors.append(label+" · "+safe_error(note))
                            except Exception as exc:
                                counters["failed"]+=1
                                status="failed"
                                note=safe_error(exc)
                                errors.append(label+" · "+note)
                            with fraction_lock:
                                fractions[eid]=1.0
                                progress=20+int(74*sum(fractions.values())/total)
                            counters["completed"]+=1
                            outcomes.append({"label":label,"status":status,"message":safe_error(note)})
                            self._save(run_id,stage="episodes",message="اكتمل "+label+" · "+str(counters["completed"])+
                                       " من "+str(total),progress=min(94,progress),
                                       **counters,errors=json.dumps(errors[-20:],ensure_ascii=False),
                                       outcomes=json.dumps(outcomes[-30:],ensure_ascii=False))
                    try:
                        if self._series_publish(db,identifier,counters["published"]):
                            counters["published"]+=1
                    except Exception as exc:
                        errors.append("تعذر تحديث حالة نشر المسلسل: "+safe_error(exc))
            else:
                self._save(run_id,total=1,progress=5)
                try:
                    result=self._check_one(db,table,identifier,force,report)
                    ok=result["status"]=="healthy"
                    counters.update(completed=1,healthy=int(ok),failed=int(not ok),
                                    renewed=int(result["renewed"]),published=int(result["published"]))
                    note=result.get("error") or ("تم التجديد والتحقق" if result["renewed"] else "الرابط سليم")
                    if not ok:errors.append(safe_error(note))
                    outcomes.append({"label":"الفيلم" if table=="aseel_movies" else "الحلقة",
                                     "status":result["status"],"message":safe_error(note)})
                except Exception as exc:
                    counters.update(completed=1,failed=1)
                    errors.append(safe_error(exc))
            stage="completed" if counters["failed"]==0 and counters["healthy"]>0 and not errors else (
                "partial" if counters["healthy"] else "failed")
            if counters["healthy"] and counters["renewed"]:
                message="تم التحقق من التشغيل وتجديد الروابط وحفظ مواعيد الانتهاء"
            elif counters["healthy"]:
                message="تم التحقق من روابط التشغيل وحفظ مواعيد الفحص القادمة"
            else:
                message="لم يجتز أي رابط الفحص؛ راجع الأسباب والمصادر الأصلية"
            if stage=="partial":message="اكتمل الفحص جزئيًا؛ توجد حلقات أو روابط تحتاج معالجة"
            self._save(run_id,status=stage,stage=stage,message=message,progress=100,
                       finished_at=self.clock(),**counters,
                       errors=json.dumps(errors[-20:],ensure_ascii=False),
                       outcomes=json.dumps(outcomes[-30:],ensure_ascii=False))
            self.control.audit("immediate_scan",table,identifier,
                               detail="سليم: "+str(counters["healthy"])+
                                      "، مجدد: "+str(counters["renewed"])+
                                      "، معطل: "+str(counters["failed"]))
        except Exception as exc:
            message=safe_error(exc)
            self._save(run_id,status="failed",stage="failed",message=message,progress=100,
                       finished_at=self.clock(),**counters,
                       errors=json.dumps((errors+[message])[-20:],ensure_ascii=False))
        finally:
            with self.lock:
                self.active.pop((table,identifier),None)
                self.slots.release()
