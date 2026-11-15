"""Non-invasive smart scheduler and operator metrics for the frozen Al Ezz worker.

The November 3 auto_sync.py and media extraction files remain byte-for-byte
unchanged. This optional sidecar only updates due timestamps and settings in
the existing durable job queue; the legacy worker does all stream resolution.
"""
from __future__ import annotations

import hashlib
import os
import threading
import time


class SmartSyncManagement:
    def __init__(self, worker, clock=time.time):
        self.worker=worker
        self.clock=clock
        self.stop_event=threading.Event()
        self.thread=None
        self.last_error=''
        self.lock=threading.RLock()
        with self.worker.queue.db() as conn:
            conn.execute("""create table if not exists smart_early_refresh(
                table_name text not null,
                target_id text not null,
                url_hash text not null,
                expiry real not null,
                queued_at real not null,
                primary key(table_name,target_id))""")
        default_hours=max(1,min(48,float(self.worker.interval/3600)))
        saved=self.worker.queue.get_setting('smart_interval_hours',default_hours)
        self.worker.interval=max(1,min(48,float(saved)))*3600
        self.expiry_lead_minutes=max(5,min(180,int(
            self.worker.queue.get_setting('smart_expiry_lead_minutes',60))))

    def configure(self, interval_hours, expiry_lead_minutes):
        if type(interval_hours) is not int or not 1<=interval_hours<=48:
            raise ValueError('الفاصل الزمني يجب أن يكون من ساعة إلى 48 ساعة')
        if type(expiry_lead_minutes) is not int or not 5<=expiry_lead_minutes<=180:
            raise ValueError('التجديد المسبق يجب أن يكون من 5 إلى 180 دقيقة')
        with self.lock:
            self.worker.queue.setting('smart_interval_hours',interval_hours)
            self.worker.queue.setting('smart_expiry_lead_minutes',expiry_lead_minutes)
            self.worker.interval=interval_hours*3600
            self.expiry_lead_minutes=expiry_lead_minutes
            # A shortened interval should take effect for pending health checks.
            with self.worker.queue.db() as conn:
                due=self.clock()+interval_hours*3600
                conn.execute('update auto_jobs set next_check=min(next_check,?) where next_check>? and lease_until<=?',
                             (due,due,self.clock()))
            self.worker.queue.event('schedule','تم تحديث الجدولة: فحص كل '+str(interval_hours)+
                                    ' ساعة، وتجديد مسبق قبل '+str(expiry_lead_minutes)+' دقيقة')
            self.worker.wake_event.set()
        return dict(interval_hours=interval_hours,expiry_lead_minutes=expiry_lead_minutes)

    def start(self):
        if self.thread and self.thread.is_alive():return
        self.stop_event.clear()
        self.thread=threading.Thread(target=self._run,name='alezz-smart-sync-scheduler',daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:self.thread.join(timeout=3)

    def _run(self):
        while not self.stop_event.is_set():
            if self.worker.enabled:
                try:
                    self.prioritize_expiring()
                    self.last_error=''
                except Exception as exc:
                    # Exceptions never print signed URLs or provider token strings.
                    self.last_error=type(exc).__name__
            self.stop_event.wait(75)

    def prioritize_expiring(self):
        """Queue each near-expiry signed resource at most once per URL token.

        Skip the last five minutes because the frozen worker already handles
        those tokens. Only its next_refresh is updated; its resolution logic,
        verified URL choice and publication rights remain untouched.
        """
        now=self.clock()
        horizon=now+self.expiry_lead_minutes*60
        if horizon<=now+300:return 0
        queued=0
        with self.worker.queue.db() as conn:
            conn.execute('begin immediate')
            rows=conn.execute("""
                select j.table_name,j.target_id,j.stream_url,s.expires_at expiry,
                       m.url_hash old_hash,m.expiry old_expiry
                from auto_jobs j
                join auto_sources s on s.table_name=j.table_name
                    and s.target_id=j.target_id and s.url=j.stream_url
                left join smart_early_refresh m on m.table_name=j.table_name
                    and m.target_id=j.target_id
                where j.table_name!='aseel_series'
                    and s.kind='direct'
                    and s.expires_at>? and s.expires_at<=?
                    and j.next_refresh>? and j.lease_until<=?
                order by s.expires_at asc limit 150
                """,(now+300,horizon,now,now)).fetchall()
            for row in rows:
                url_hash=hashlib.sha256(row['stream_url'].encode()).hexdigest()
                if row['old_hash']==url_hash and row['old_expiry']==row['expiry']:
                    continue
                conn.execute('update auto_jobs set next_refresh=0 where table_name=? and target_id=?',
                             (row['table_name'],row['target_id']))
                conn.execute("""insert into smart_early_refresh(
                    table_name,target_id,url_hash,expiry,queued_at) values(?,?,?,?,?)
                    on conflict(table_name,target_id) do update set
                    url_hash=excluded.url_hash,expiry=excluded.expiry,
                    queued_at=excluded.queued_at""",
                    (row['table_name'],row['target_id'],url_hash,row['expiry'],now))
                queued+=1
        if queued:
            self.worker.queue.event('early_refresh',
                                    'جدولة تجديد مسبق لـ '+str(queued)+' رابط موقع')
            self.worker.wake_event.set()
        return queued

    @staticmethod
    def _where(query, filter_status, now):
        if filter_status not in ('all','healthy','suspect','broken','unchecked',
                                 'due','expiring','missing_source'):
            raise ValueError('فلتر المزامنة غير معروف')
        where=" where (j.title like ? or j.target_id=?)"
        args=['%'+query+'%',query]
        if filter_status in ('healthy','suspect','broken','unchecked'):
            where+=' and j.status=?'
            args.append(filter_status)
        elif filter_status=='due':
            where+=(" and j.lease_until<=? and (j.next_check<=? or j.next_refresh<=? "
                    "or (j.dirty!='' and j.upload_at<=?))")
            args.extend((now,now,now,now))
        elif filter_status=='expiring':
            where+=(""" and j.table_name!='aseel_series' and exists(
                select 1 from auto_sources s where s.table_name=j.table_name
                and s.target_id=j.target_id and s.url=j.stream_url
                and s.expires_at>0 and s.expires_at<=?)""")
            args.append(now+3600)
        elif filter_status=='missing_source':
            where+=(""" and j.table_name!='aseel_series' and not exists(
                select 1 from auto_sources s where s.table_name=j.table_name
                and s.target_id=j.target_id and s.kind='original')""")
        return where,args

    def targets(self,limit=50,offset=0,query='',filter_status='all'):
        now=self.clock()
        where,args=self._where(query,filter_status,now)
        with self.worker.queue.db() as conn:
            rows=[dict(row) for row in conn.execute("""select j.*,
                (select count(*) from auto_sources s where s.table_name=j.table_name
                    and s.target_id=j.target_id) source_count,
                (select count(*) from auto_sources s where s.table_name=j.table_name
                    and s.target_id=j.target_id and s.status='healthy'
                    and s.kind='direct') valid_sources,
                (select max(s.expires_at) from auto_sources s where
                    s.table_name=j.table_name and s.target_id=j.target_id
                    and s.url=j.stream_url) primary_expires_at
                from auto_jobs j """+where+"""
                order by case when j.next_check<=? or j.next_refresh<=? then 0 else 1 end,
                    j.failures desc,j.next_check limit ? offset ?""",
                (*args,now,now,limit,offset))]
            total=conn.execute('select count(*) from auto_jobs j'+where,args).fetchone()[0]
        return rows,int(total)

    def monitor(self):
        now=self.clock()
        with self.worker.queue.db() as conn:
            due=conn.execute("select count(*) from auto_jobs where lease_until<=? and "
                "(next_check<=? or next_refresh<=? or (dirty!='' and upload_at<=?))",
                (now,now,now,now)).fetchone()[0]
            active=conn.execute('select count(*) from auto_jobs where lease_until>?',(now,)).fetchone()[0]
            expiring=conn.execute("""
                select count(*) from auto_jobs j where j.table_name!='aseel_series'
                and exists(select 1 from auto_sources s where
                    s.table_name=j.table_name and s.target_id=j.target_id
                    and s.url=j.stream_url and s.expires_at>0
                    and s.expires_at<=?)""",(now+3600,)).fetchone()[0]
            retrying=conn.execute("select count(*) from auto_jobs where "
                "status in ('suspect','broken') and failures>0").fetchone()[0]
            pending=conn.execute("select count(*) from auto_sources where synced=0").fetchone()[0]
        return dict(due_count=due,in_progress=active,expiring_soon=expiring,
                    retrying=retrying,pending_sources=pending)

    def status(self):
        base=self.worker.status()
        base.update(self.monitor())
        base.update(interval_hours=self.worker.interval/3600,
                    expiry_lead_minutes=self.expiry_lead_minutes,
                    smart_scheduler_running=bool(self.thread and self.thread.is_alive()),
                    smart_scheduler_error=self.last_error)
        return base
