"""Durable, UUID-addressed media maintenance for a single persistent Render service.

The queue and history are committed before remote writes. Network failures use
backoff; a crash releases a short task lease. Verified replacements and confirmed
dead links change stream_url. Publication and rights are preserved.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import requests
from alezz_fetchv_importer import SourceClient, public_url, pull_html
from media_resolver import MediaResolver, safe_error, signed_expiry
from title_cleaner import content_title

TABLES = ('aseel_movies', 'aseel_episodes', 'aseel_series')
RETIRED_LINK = 'أُزيل من التشغيل بعد تأكيد تعطّله: '
GONE_RESPONSE = re.compile(r'^(?:HTTP (?:404|410)\b|(?:404|410) Client Error\b)', re.I)


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if value else None


def stamp(value):
    if not value: return 0.0
    if isinstance(value, (float, int)): return float(value)
    try: return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError): return 0.0


def target_key(table, identifier):
    if table not in TABLES: raise ValueError('نوع العنصر غير صحيح')
    return table, str(UUID(str(identifier)))


def expires_at(url):
    """Recognize explicit epoch/AWS expiry only; unknown signatures stay unknown."""
    return signed_expiry(url) or 0


class ServiceDB:
    """Server-only Data API client. Secrets never enter browser/session payloads."""
    def __init__(self, root, secret):
        public_url(root)
        if not secret or not (secret.startswith('sb_secret_') or secret.startswith('eyJ')):
            raise ValueError('يلزم مفتاح Supabase سري للخادم داخل إعدادات Render')
        self.root = root.rstrip('/')
        self.secret = secret
        self.local = threading.local()

    def req(self, method, table, params=None, payload=None, upsert=False):
        if table not in (*TABLES, 'aseel_seasons', 'aseel_media_sources'):
            raise ValueError('Unsupported maintenance table')
        if not hasattr(self.local, 'session'):
            session = self.local.session = requests.Session()
            session.trust_env = False
            session.headers.update(apikey=self.secret, Accept='application/json')
            if self.secret.startswith('eyJ'): session.headers['Authorization'] = 'Bearer '+self.secret
        prefer = 'return=representation'
        if upsert: prefer += ',resolution=merge-duplicates'
        response = self.local.session.request(method, self.root+'/rest/v1/'+table, params=params,
                                             json=payload, headers={'Prefer': prefer}, timeout=25,allow_redirects=False)
        if not response.ok:
            # Do not put returned SQL details, row contents, or signed URLs into logs.
            raise ValueError(f'Supabase {table}: HTTP {response.status_code}')
        return response.json() if response.content else []

    def query(self, table, params): return self.req('GET', table, params)
    def single(self, table, params):
        rows = self.query(table, {**params, 'limit': '1'})
        return rows[0] if rows else None
    def insert(self, table, payload): return self.req('POST', table, payload=payload)[0]
    def patch(self, table, identifier, payload):
        rows = self.req('PATCH', table, {'id': 'eq.'+identifier}, payload)
        if not rows: raise ValueError('العنصر حُذف أو لم يعد قابلًا للتحديث')
        return rows[0]
    def upsert_source(self, payload):
        return self.req('POST', 'aseel_media_sources',
                        {'on_conflict': 'target_table,target_id,source_key'}, payload, upsert=True)


class QueueDB:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript('''
            pragma journal_mode=WAL;
            create table if not exists auto_jobs(
              table_name text not null,target_id text not null,title text not null default '',
              page_url text not null default '',stream_url text not null default '',
              data text not null default '{}',next_check real not null default 0,
              last_check real not null default 0,next_refresh real not null default 0,
              last_refresh real not null default 0,failures integer not null default 0,
              status text not null default 'unchecked',error text not null default '',
              lease_until real not null default 0,dirty text not null default '',
              upload_at real not null default 0,checkpoint text not null default '{}',
              primary key(table_name,target_id));
            create index if not exists auto_jobs_due on auto_jobs(next_check,lease_until);
            create table if not exists auto_sources(
              table_name text not null,target_id text not null,source_key text not null,
              url text not null,kind text not null,label text not null default '',page_url text not null default '',
              first_seen_at real not null,last_seen_at real not null,last_checked_at real not null default 0,
              status text not null default 'unchecked',successes integer not null default 0,
              failures integer not null default 0,consecutive_failures integer not null default 0,
              confidence real not null default 0.5,expires_at real not null default 0,
              error text not null default '',synced integer not null default 0,
              primary key(table_name,target_id,source_key));
            create table if not exists auto_events(id integer primary key,at real not null,
              table_name text,target_id text,kind text not null,message text not null);
            create table if not exists auto_settings(key text primary key,value text not null);
            ''')

    @contextmanager
    def db(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            with conn: yield conn
        finally: conn.close()

    def get_setting(self, key, default=None):
        with self.db() as db:
            row = db.execute('select value from auto_settings where key=?', (key,)).fetchone()
            return json.loads(row[0]) if row else default

    def setting(self, key, value):
        with self.db() as db:
            db.execute('insert or replace into auto_settings values(?,?)', (key,json.dumps(value)))

    def event(self, kind, message, table=None, identifier=None):
        with self.db() as db:
            db.execute('insert into auto_events(at,table_name,target_id,kind,message) values(?,?,?,?,?)',
                       (time.time(),table,identifier,kind,safe_error(message)))

    def ingest(self, table, row):
        table, identifier = target_key(table, row['id'])
        now = time.time()
        page = row.get('source_page_url') or ''
        if page:
            try: public_url(page)
            except ValueError: page = ''
        with self.db() as db:
            old = db.execute('select * from auto_jobs where table_name=? and target_id=?', (table,identifier)).fetchone()
            if old:
                # An outbox write must not be overwritten by a slightly older remote snapshot.
                db.execute('update auto_jobs set title=?,page_url=case when ?!=\'\' then ? else page_url end,'
                           'data=?,stream_url=case when dirty=\'\' then ? else stream_url end '
                           'where table_name=? and target_id=?',
                           (row.get('title_ar') or '',page,page,json.dumps(row,ensure_ascii=False),
                            row.get('stream_url') or '',table,identifier))
            else:
                db.execute('insert into auto_jobs(table_name,target_id,title,page_url,stream_url,data) values(?,?,?,?,?,?)',
                           (table,identifier,row.get('title_ar') or '',page,row.get('stream_url') or '',json.dumps(row,ensure_ascii=False)))
        if page: self.remember(table,identifier,dict(url=page,kind='original'))
        if row.get('stream_url'): self.remember(table,identifier,dict(url=row['stream_url'],kind='direct'))
        for item in row.get('stream_variants') or []:
            if isinstance(item,dict): self.remember(table,identifier,item)

    def remember(self, table, identifier, source, restored=False):
        table, identifier = target_key(table, identifier)
        try: url = public_url(source.get('url') or source.get('source_url') or '')
        except ValueError: return
        kind = source.get('kind') or source.get('source_kind') or ('direct' if re.search(r'\.(m3u8|mp4|m4v|webm)(?:[?#]|$)',url,re.I) else 'embed')
        if kind not in ('original','direct','embed'): return
        key, now = hashlib.sha256(url.encode()).hexdigest(), time.time()
        page = source.get('page_url') or ''
        if page:
            try: public_url(page)
            except ValueError: page = ''
        with self.db() as db:
            old = db.execute('select * from auto_sources where table_name=? and target_id=? and source_key=?',
                             (table,identifier,key)).fetchone()
            if old:
                db.execute('update auto_sources set last_seen_at=?,page_url=case when ?!=\'\' then ? else page_url end,'
                           'kind=case when ?=\'original\' then ? else kind end,'
                           'label=case when ?!=\'\' then ? else label end,synced=0 '
                           'where table_name=? and target_id=? and source_key=?',
                           (max(now,old['last_seen_at']),page,page,kind,kind,str(source.get('label') or '')[:80],
                            str(source.get('label') or '')[:80],table,identifier,key))
                if restored:
                    first=min(old['first_seen_at'],stamp(source.get('first_seen_at')) or old['first_seen_at'])
                    db.execute('update auto_sources set first_seen_at=? where table_name=? and target_id=? and source_key=?',
                               (first,table,identifier,key))
                    checked=stamp(source.get('last_checked_at'))
                    if checked>old['last_checked_at']:
                        db.execute('update auto_sources set last_checked_at=?,status=?,successes=?,failures=?,consecutive_failures=?,'
                                   'confidence=?,expires_at=?,error=? where table_name=? and target_id=? and source_key=?',
                                   (checked,source.get('status','unchecked'),int(source.get('successes',0)),
                                    int(source.get('failures',0)),int(source.get('consecutive_failures',0)),
                                    float(source.get('confidence',0.5)),stamp(source.get('expires_at')),
                                    safe_error(source.get('error','')),table,identifier,key))
            else:
                db.execute('insert into auto_sources(table_name,target_id,source_key,url,kind,label,page_url,'
                           'first_seen_at,last_seen_at,expires_at,status,successes,failures,confidence,last_checked_at,synced,consecutive_failures,error) '
                           'values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (table,identifier,key,url,kind,str(source.get('label') or '')[:80],page,
                            stamp(source.get('first_seen_at')) or now,stamp(source.get('last_seen_at')) or now,
                            stamp(source.get('expires_at')) or expires_at(url),source.get('status','unchecked') if restored else 'unchecked',
                            int(source.get('successes',0)) if restored else 0,int(source.get('failures',0)) if restored else 0,
                            float(source.get('confidence',0.5)) if restored else 0.5,stamp(source.get('last_checked_at')) if restored else 0,
                            int(restored),int(source.get('consecutive_failures',0)) if restored else 0,
                            safe_error(source.get('error','')) if restored else ''))
        if page and page != url: self.remember(table,identifier,dict(url=page,kind='original'))

    def sources(self, table, identifier):
        table,identifier=target_key(table,identifier)
        with self.db() as db:
            return [dict(r) for r in db.execute('select * from auto_sources where table_name=? and target_id=? '
                    'order by confidence desc,last_seen_at desc', (table,identifier))]

    def claim(self, now=None):
        now = now or time.time()
        with self.db() as db:
            db.execute('begin immediate')
            row = db.execute('select * from auto_jobs where lease_until<=? and '
                             '(next_check<=? or next_refresh<=? or (dirty!=\'\' and upload_at<=?)) '
                             'order by min(next_check,next_refresh,case when dirty!=\'\' then upload_at else 1e20 end),'
                             'failures desc limit 1', (now,now,now,now)).fetchone()
            if not row: return None
            db.execute('update auto_jobs set lease_until=? where table_name=? and target_id=?',
                       (now+600,row['table_name'],row['target_id']))
            return dict(row)

    def update(self, table, identifier, **fields):
        allowed={'page_url','stream_url','next_check','last_check','next_refresh','last_refresh','failures',
                 'status','error','lease_until','dirty','upload_at','checkpoint'}
        if not set(fields)<=allowed: raise ValueError('Unexpected queue field')
        with self.db() as db:
            db.execute('update auto_jobs set '+','.join(k+'=?' for k in fields)+' where table_name=? and target_id=?',
                       (*fields.values(),table,identifier))

    def queue(self, table=None, identifier=None, refresh=False):
        where, args = '', []
        if table is not None:
            table,identifier=target_key(table,identifier)
            where=' where table_name=? and target_id=?';args=[table,identifier]
        with self.db() as db:
            db.execute('update auto_jobs set next_check=0'+(',next_refresh=0' if refresh else '')+where,args)

    def snapshot(self):
        now = time.time()
        with self.db() as db:
            counts = {r['status']:r['n'] for r in db.execute('select status,count(*) n from auto_jobs where table_name!=\'aseel_series\' group by status')}
            counts['total']=sum(counts.values())
            counts['missing_source']=db.execute('select count(*) from auto_jobs j where table_name!=\'aseel_series\' and '
                'not exists(select 1 from auto_sources s where s.table_name=j.table_name and s.target_id=j.target_id and s.kind=\'original\')').fetchone()[0]
            row=db.execute('select min(next_check),max(last_check),sum(dirty!=\'\') from auto_jobs').fetchone()
            pending = db.execute('select count(*) from auto_jobs where lease_until<=? and min(next_check,next_refresh)<=?',
                                 (now,now)).fetchone()[0]
            active = db.execute('select count(*) from auto_jobs where lease_until>?', (now,)).fetchone()[0]
            return dict(counts=counts,next_check=row[0],last_check=row[1],pending_uploads=row[2] or 0,
                        pending_checks=pending,active_checks=active)

    def targets(self, limit=50, offset=0, query='', table=''):
        with self.db() as db:
            return [dict(r) for r in db.execute('select j.*, '
                '(select count(*) from auto_sources s where s.table_name=j.table_name and s.target_id=j.target_id) source_count,'
                '(select count(*) from auto_sources s where s.table_name=j.table_name and s.target_id=j.target_id and s.status=\'healthy\' and s.kind=\'direct\') valid_sources '
                'from auto_jobs j where (?=\'\' or table_name=?) and (title like ? or target_id=?) order by failures desc,title,target_id limit ? offset ?',
                (table,table,'%'+query+'%',query,limit,offset))]


class ProcessLock:
    def __init__(self, path): self.path=path;self.file=None
    def acquire(self):
        self.file=open(self.path,'a+b')
        try:
            if os.name=='nt':
                import msvcrt
                self.file.seek(0);self.file.write(b'0');self.file.flush();self.file.seek(0)
                msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.file,fcntl.LOCK_EX|fcntl.LOCK_NB)
            return True
        except OSError: self.file.close();self.file=None;return False
    def close(self):
        if self.file: self.file.close();self.file=None


class AutoSync:
    def __init__(self, data_dir, db_factory=None, resolver_factory=None, clock=time.time):
        self.queue=QueueDB(Path(data_dir)/'autosync.sqlite3')
        self.clock=clock
        self.interval=max(1,float(os.getenv('ALEZZ_AUTOSYNC_INTERVAL_HOURS','24')))*3600
        self.check_interval=min(self.interval,max(5,float(os.getenv('ALEZZ_AUTOSYNC_CHECK_MINUTES','30')))*60)
        self.mode=os.getenv('ALEZZ_AUTOSYNC_MODE','auto')
        self.concurrency=max(1,min(4,int(os.getenv('ALEZZ_AUTOSYNC_CONCURRENCY','2'))))
        self.db_factory=db_factory or self._environment_db
        self.resolver_factory=resolver_factory or (lambda:MediaResolver(self.mode))
        self.stop_event=threading.Event();self.wake_event=threading.Event()
        self.thread=None;self.db=None;self.last_tick=0;self.last_import=0;self.last_error=''
        self.force_import=True
        self.import_retry_at=0
        self.import_error=''
        self.local_db=None
        self.using_local_session=False
        self.process_lock=ProcessLock(Path(data_dir)/'autosync.lock')

    def remember_saved(self,cat,result,*,capture=False):
        """Preserve all local discoveries, including sources beyond eight variants."""
        by_number={(ep.season,ep.number):ep for ep in cat.episodes}
        if cat.kind=='series' and result.get('work_id'):
            try:
                self.queue.ingest('aseel_series',dict(id=result['work_id'],title_ar=cat.title,source_page_url=cat.url))
                for page in cat.source_pages:self.queue.remember('aseel_series',result['work_id'],dict(url=page,kind='original'))
            except ValueError:pass
        for binding in result.get('bindings',[]):
            entry=cat if cat.kind=='movie' else by_number.get((binding['season'],binding['number']))
            if entry is None:continue
            try:
                table,identifier=target_key(binding['table'],binding['id'])
                page=cat.url if cat.kind=='movie' else entry.page_url
                self.queue.ingest(table,dict(id=identifier,title_ar=entry.title,source_page_url=page,
                                             stream_url=binding.get('stream_url',entry.media_url),stream_variants=[]))
                for source in entry.sources:self.queue.remember(table,identifier,source)
                for page in entry.source_pages:self.queue.remember(table,identifier,dict(url=page,kind='original'))
                if capture:self.queue.queue(table,identifier)
            except ValueError:pass
        if not capture:self.force_import=True
        self.wake_event.set()

    @property
    def enabled(self): return self.queue.get_setting('enabled',os.getenv('ALEZZ_AUTOSYNC_ENABLED','1')=='1')

    @staticmethod
    def desktop_mode():
        return os.getenv("ALEZZ_PUBLIC_MODE") != "1" and not os.getenv("RENDER")

    @staticmethod
    def has_server_key():
        return bool(os.getenv("ALEZZ_SUPABASE_SECRET_KEY") or os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY"))

    def bind_local_session(self, db, *, logout=False):
        if not self.desktop_mode() or self.has_server_key(): return
        if logout:
            if self.local_db is db: self.local_db=None
        else:
            self.local_db=db
        self.wake_event.set()

    def _environment_db(self):
        key=os.getenv('ALEZZ_SUPABASE_SECRET_KEY') or os.getenv('ALEZZ_SUPABASE_SERVICE_ROLE_KEY')
        if not key and self.desktop_mode():
            raise ValueError("سجّل دخول مسؤول Supabase من زر تسجيل الدخول لتشغيل المزامنة على جهازك")
        if not key: raise ValueError('العامل ينتظر مفتاح Supabase السري في إعدادات Render')
        return ServiceDB(os.getenv('ALEZZ_SUPABASE_URL','https://qyzmlwtvzzgooccqxglq.supabase.co'),key)

    def start(self):
        if self.thread and self.thread.is_alive(): return
        self.stop_event.clear()
        self.thread=threading.Thread(target=self._run,name='alezz-autosync',daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set();self.wake_event.set()
        if self.thread: self.thread.join(timeout=5)

    def _run(self):
        if not self.process_lock.acquire():
            self.last_error='توجد نسخة أخرى من العامل على التخزين نفسه';return
        try:
            # The process lock proves that previous local claims have no live owner.
            with self.queue.db() as conn: conn.execute('update auto_jobs set lease_until=0')
            while not self.stop_event.is_set():
                worked=False
                try:
                    self.last_tick=self.clock()
                    if self.enabled:
                        if self.desktop_mode() and not self.has_server_key() and (self.local_db is not None or self.using_local_session):
                            if self.db is not self.local_db:
                                self.db=self.local_db
                                self.force_import=True
                                self.last_import=0
                                self.import_retry_at=0
                            self.using_local_session=self.local_db is not None
                        if self.db is None:self.db=self.db_factory()
                        self.last_error=''
                        worked=self.tick()
                except Exception as exc:
                    error=safe_error(exc)
                    if error!=self.last_error:self.queue.event('worker_error',error)
                    self.last_error=error
                self.wake_event.wait(0.15 if worked else 15 if self.last_error else 2)
                self.wake_event.clear()
        finally:self.process_lock.close()

    def _rows(self,table,params):
        offset=0
        while not self.stop_event.is_set():
            rows=self.db.query(table,{**params,'limit':'200','offset':str(offset),'order':'id.asc'})
            for row in rows:yield row
            if len(rows)<200:break
            offset+=len(rows)

    def import_remote(self):
        for table in TABLES:
            for row in self._rows(table,{'select':'*'}):
                self.queue.ingest(table,row)
        # Restore every history row as well as the current eight public variants.
        for row in self._rows('aseel_media_sources',{'select':'*'}):
            self.queue.remember(row['target_table'],row['target_id'],row,restored=True)
        self.last_import=self.clock();self.force_import=False
        self.queue.setting('last_import',self.last_import)

    def tick(self):
        if self.clock()>=self.import_retry_at and (self.force_import or self.clock()-self.last_import>=900):
            try:
                self.import_remote()
                self.import_error=''
            except Exception as exc:
                error=safe_error(exc)
                if error!=self.import_error:self.queue.event('import_error',error)
                self.import_error=error
                self.import_retry_at=self.clock()+60
        jobs=[]
        for _ in range(self.concurrency):
            job=self.queue.claim(self.clock())
            if job:jobs.append(job)
        if jobs:
            with ThreadPoolExecutor(max_workers=self.concurrency) as pool:list(pool.map(self.process,jobs))
        return bool(jobs)

    def process(self,job):
        table,identifier=job['table_name'],job['target_id']
        try:
            if job['dirty']:
                # A replacement verified before an outage may already be expired
                # when delivery resumes. Re-probe before replaying stale media.
                stale=(table!='aseel_series' and self.clock()-job['last_check']>300)
                if stale:
                    self.check_target(job)
                    return
                if job['upload_at']<=self.clock():self.flush(job)
                # A pending remote failure does not suppress future health checks.
            if self.stop_event.is_set():return
            if table=='aseel_series':self.discover_series(job)
            elif min(job['next_check'],job['next_refresh'])<=self.clock():self.check_target(job)
        except Exception as exc:
            failures=job['failures']+1
            delay=min(3600,60*2**min(failures-1,6))
            self.queue.update(table,identifier,error=safe_error(exc),failures=failures,
                              next_check=self.clock()+delay,next_refresh=self.clock()+delay,upload_at=self.clock()+delay)
            self.queue.event('task_error',safe_error(exc),table,identifier)
        finally:self.queue.update(table,identifier,lease_until=0)

    def check_target(self,job):
        now=self.clock();table,identifier=job['table_name'],job['target_id']
        sources=self.queue.sources(table,identifier)
        pages=[r['url'] for r in sources if r['kind']=='original']
        saved=json.loads(job['data'])
        existing_variants=[item for item in saved.get('stream_variants') or []
                           if isinstance(item,dict) and isinstance(item.get('url'),str)]
        active_urls={job['stream_url'], *(item['url'] for item in existing_variants)}
        resolver=self.resolver_factory()
        candidates=[dict(url=r['url'],kind=r['kind'],label=r['label'],page_url=r['page_url'])
                    for r in sources if r['kind']!='original'
                    and (r['url'] in active_urls or not r['error'].startswith(RETIRED_LINK))]
        # Re-extraction happens daily even while current media still works.
        errors=[]
        extracted=False
        browser_requested=False
        if job['next_refresh']<=now and pages:
            fresh,errors=resolver.extract(pages)
            extracted=True
            browser_requested=self.mode=='headless' or self.mode=='auto' and not any(s.get('kind')=='direct' for s in fresh)
            for source in fresh:self.queue.remember(table,identifier,source)
            seen={s['url'] for s in fresh}
            candidates=fresh+[s for s in candidates if s['url'] not in seen]
        checked=resolver.check(candidates)
        good=[s for s in checked if s.get('verified') and s.get('kind','direct')=='direct']
        failed_active=any(not item.get('verified') and not item.get('reachable') and item['url'] in active_urls
                          for item in checked)
        if (not good or failed_active) and pages and not browser_requested:
            # Includes retry of expired HTTP discoveries with conditional headless fallback.
            fresh,extra=resolver.extract(pages,force_browser=self.mode!='http')
            extracted=True
            errors+=extra
            for source in fresh:self.queue.remember(table,identifier,source)
            checked_new=resolver.check(fresh)
            replace={s['url']:s for s in checked+checked_new}
            checked=list(replace.values())
            good=[s for s in checked if s.get('verified') and s.get('kind','direct')=='direct']
        for source in checked:self.record_check(table,identifier,source,now)
        history=self.queue.sources(table,identifier)
        by_url={s['url']:s for s in history}
        retired={s['url'] for s in history if s['error'].startswith(RETIRED_LINK)}
        good.sort(key=lambda s:by_url[s['url']]['confidence'],reverse=True)
        remove_primary=job['stream_url'] in retired or saved.get('stream_url') in retired
        fallback='' if remove_primary else job['stream_url']
        selected=next((s['url'] for s in good if s['url']==job['stream_url']),good[0]['url'] if good else fallback)
        expiry=expires_at(selected)
        if extracted and good and expiry and expiry <= now + 300:
            current=urlsplit(selected)
            renewed=[]
            for candidate in good:
                url=candidate['url']
                parts=urlsplit(url)
                if (parts.scheme,parts.netloc,parts.path)==(current.scheme,current.netloc,current.path):
                    if expires_at(url)>max(expiry,now):
                        renewed.append(url)
            if renewed:
                selected=max(renewed,key=expires_at)
        failures=0 if good else job['failures']+1
        status='healthy' if good else 'broken' if failures>=3 else 'suspect'
        error='' if good else ('المصدر الأصلي مفقود؛ أضف صفحة الفيلم أو الحلقة' if not pages else
                              'لا يوجد رابط مباشر اجتاز الفحص؛ '+('; '.join(errors) if errors else 'تعذرت الروابط المحفوظة'))
        next_check=now+self.check_interval if good else now+min(3600,60*2**min(failures-1,6))
        next_refresh=now+self.interval if extracted or not pages else job['next_refresh']
        if not good and pages:next_refresh=min(next_refresh,next_check)
        allowed={s['url'] for s in checked if s.get('verified') or s.get('kind')=='embed' and s.get('reachable')}
        variants=[]
        for source in sorted(history,key=lambda s:(s['kind']=='direct',s['confidence']),reverse=True):
            if source['url'] in allowed and source['url']!=selected:
                variants.append(dict(url=source['url'],label=source['label'] or urlsplit(source['url']).hostname,
                                     kind=source['kind'],page_url=source['page_url']))
        payload=dict(link_health_status=status,link_health_reason=error or None,
                     link_health_checked_at=iso(now),link_health_failures=failures,link_health_url=selected or None)
        if remove_primary or good:
            payload['stream_url']=selected or None
        if good:
            known={item['url'] for item in variants}|{selected}
            variants.extend(item for item in existing_variants if item['url'] not in retired and item['url'] not in known)
            payload['stream_variants']=variants[:8]
            active_links=[selected,*[variant['url'] for variant in payload['stream_variants']
                                     if variant['kind']=='direct']]
            expiries=[expiry for url in active_links if (expiry:=expires_at(url))>now]
            if expiries:
                deadline=max(now+60,min(expiries)-300)
                next_check=min(next_check,deadline)
                if pages: next_refresh=min(next_refresh,deadline)
        elif any(item['url'] in retired for item in existing_variants):
            payload['stream_variants']=[item for item in existing_variants if item['url'] not in retired]
        self.queue.update(table,identifier,last_check=now,next_check=next_check,last_refresh=now if extracted else job['last_refresh'],
                          next_refresh=next_refresh,stream_url=selected,status=status,error=error,failures=failures,
                          dirty=json.dumps(payload,ensure_ascii=False),upload_at=now)
        if selected and selected!=job['stream_url']:
            self.queue.event('replacement','تم تبديل الرابط الأساسي ببديل اجتاز الفحص',table,identifier)
        if retired & active_urls:
            self.queue.event('retired_links','أُزيلت روابط مؤكدة التعطّل من قائمة التشغيل',table,identifier)
        if not good and (job['status']=='healthy' or job['last_check']==0 and candidates):
            self.queue.event('all_links_failed','تنبيه: لم ينجح أي رابط لهذا العنصر',table,identifier)
        if not pages and job['last_check']==0:self.queue.event('missing_source','المصدر الأصلي مفقود؛ يمكن فحص الروابط الحالية فقط',table,identifier)
        with self.queue.db() as conn:
            updated=dict(conn.execute('select * from auto_jobs where table_name=? and target_id=?',(table,identifier)).fetchone())
        self.flush(updated)

    def record_check(self,table,identifier,source,now):
        self.queue.remember(table,identifier,source)
        good=bool(source.get('verified'))
        reachable=source.get('kind')=='embed' and source.get('reachable')
        key=hashlib.sha256(source['url'].encode()).hexdigest()
        with self.queue.db() as conn:
            row=conn.execute('select * from auto_sources where table_name=? and target_id=? and source_key=?',(table,identifier,key)).fetchone()
            if not row:return
            successes=row['successes']+int(good)
            failures=row['failures']+int(not good and not reachable)
            confidence=(successes+1)/(successes+failures+2)
            consecutive=0 if good or reachable else row['consecutive_failures']+1
            error=safe_error(source.get('error',''))
            expiry=expires_at(source['url'])
            confirmed=not good and not reachable and (
                row['error'].startswith(RETIRED_LINK) or
                bool(expiry and expiry<=now-300) or
                bool(GONE_RESPONSE.match(error) and GONE_RESPONSE.match(row['error'])
                     and now-row['last_checked_at']>=60))
            status='healthy' if good else 'suspect' if not confirmed and (reachable or consecutive<3) else 'broken'
            if confirmed: error=RETIRED_LINK+error
            conn.execute('update auto_sources set last_checked_at=?,status=?,successes=?,failures=?,consecutive_failures=?,'
                         'confidence=?,error=?,synced=0 where table_name=? and target_id=? and source_key=?',
                         (now,status,successes,failures,consecutive,confidence,error,table,identifier,key))

    def flush(self,job,db=None):
        db=db or self.db
        table,identifier=job['table_name'],job['target_id']
        # Upload source history before replacing current playback fields.
        for source in self.queue.sources(table,identifier):
            if source['synced']:continue
            payload=dict(target_table=table,target_id=identifier,source_url=source['url'],source_kind=source['kind'],
                         label=source['label'],page_url=source['page_url'] or None,first_seen_at=iso(source['first_seen_at']),
                         last_seen_at=iso(source['last_seen_at']),last_checked_at=iso(source['last_checked_at']),
                         status=source['status'],successes=source['successes'],failures=source['failures'],
                         consecutive_failures=source['consecutive_failures'],confidence=source['confidence'],
                         expires_at=iso(source['expires_at']),error=source['error'])
            db.upsert_source(payload)
            with self.queue.db() as conn:
                conn.execute('update auto_sources set synced=1 where table_name=? and target_id=? and source_key=? and last_seen_at=?',
                             (table,identifier,source['source_key'],source['last_seen_at']))
        if job['dirty']:
            payload=json.loads(job['dirty'])
            db.patch(table,identifier,payload)
            if table=='aseel_episodes' and payload.get('stream_url') and payload.get('link_health_status')=='healthy':
                self.publish_discovered_episode(db, identifier)
            with self.queue.db() as conn:
                conn.execute('update auto_jobs set dirty=\'\',upload_at=0,data=json_patch(data,?) '
                             'where table_name=? and target_id=? and dirty=?',
                             (job['dirty'],table,identifier,job['dirty']))

    def publish_discovered_episode(self, db, identifier):
        parent=self.queue.get_setting('discovered-episode:'+identifier)
        if not parent or not self.queue.get_setting('publish-series:'+parent,False):
            return
        series=db.single('aseel_series',{'id':'eq.'+parent,'select':'id,status,rights_status'})
        if not series or series.get('status')!='published' or series.get('rights_status')!='approved':
            return
        changed=db.req('PATCH','aseel_episodes',{'id':'eq.'+identifier,
                       'status':'eq.draft','rights_status':'eq.pending','link_health_status':'eq.healthy'},
                       {'status':'published','rights_status':'approved'})
        if changed:
            self.queue.setting('discovered-episode:'+identifier,None)
            self.queue.event('episode_published','نُشرت الحلقة الجديدة بعد التحقق من رابطها.', 'aseel_episodes',identifier)

    def discover_series(self,job):
        if min(job['next_refresh'],job['next_check'])>self.clock():return
        table,identifier=job['table_name'],job['target_id']
        pages=[s['url'] for s in self.queue.sources(table,identifier) if s['kind']=='original']
        if not pages:
            self.queue.update(table,identifier,next_check=self.clock()+self.interval,next_refresh=self.clock()+self.interval,
                              last_check=self.clock(),status='missing_source',
                              error='مصدر المسلسل الأصلي مفقود؛ فحص الحلقات المحفوظة مستمر')
            return
        found_episodes=False
        for page in pages:
            cat=pull_html(page,SourceClient(timeout=12),kind='series',max_pages=500,max_episodes=5000,
                resume_progress=json.loads(job['checkpoint']),progress_hook=lambda data:self.queue.update(table,identifier,checkpoint=json.dumps(data,ensure_ascii=False)))
            found_episodes=found_episodes or bool(cat.episodes)
            seasons={}
            for episode in cat.episodes:
                if self.stop_event.is_set():return
                if episode.season not in seasons:
                    season=self.db.single('aseel_seasons',{'series_id':'eq.'+identifier,'number':'eq.'+str(episode.season),'select':'id'})
                    if not season:season=self.db.insert('aseel_seasons',dict(series_id=identifier,number=episode.season,title_ar='الموسم '+str(episode.season)))
                    seasons[episode.season]=season['id']
                old=self.db.single('aseel_episodes',{'season_id':'eq.'+seasons[episode.season],'number':'eq.'+str(episode.number),'select':'*'})
                if not old:
                    old=self.db.insert('aseel_episodes',dict(season_id=seasons[episode.season],number=episode.number,
                        title_ar=content_title(episode.title,page,fallback='الحلقة '+str(episode.number)),
                        description=episode.description or None,poster_url=episode.poster_url or None,
                        source_page_url=episode.page_url if episode.page_url!=cat.url else None,status='draft',rights_status='pending'))
                    self.queue.setting('discovered-episode:'+old['id'],identifier)
                    self.queue.event('new_episode','تم اكتشاف حلقة جديدة وحفظها مسودة', 'aseel_episodes',old['id'])
                elif not old.get('source_page_url') and episode.page_url!=cat.url:
                    self.db.patch('aseel_episodes',old['id'],{'source_page_url':episode.page_url})
                    old['source_page_url']=episode.page_url
                self.queue.ingest('aseel_episodes',old)
                if episode.page_url!=cat.url:self.queue.remember('aseel_episodes',old['id'],dict(url=episode.page_url,kind='original'))
            for warning in cat.discovery_warnings:
                self.queue.event('episode_gap',warning,table,identifier)
        now=self.clock()
        self.queue.update(table,identifier,next_check=now+self.interval,next_refresh=now+self.interval,
                          last_check=now,last_refresh=now,failures=0,checkpoint='{}',
                          status='discovered' if found_episodes else 'suspect',
                          error='' if found_episodes else 'لم تظهر صفحات حلقات في المصدر.')
        self.flush(job)

    def control(self,action):
        if action in ('pause','resume'):self.queue.setting('enabled',action=='resume')
        elif action in ('check-all','refresh-all'):
            self.queue.queue(refresh=action=='refresh-all')
            self.force_import=True
            self.import_retry_at=0
        elif action=='import':
            self.force_import=True
            self.import_retry_at=0
        else:raise ValueError('أمر غير معروف')
        self.queue.event('control',{'pause':'تم إيقاف العامل مؤقتًا','resume':'تم استئناف العامل',
            'check-all':'أضيفت المكتبة إلى طابور الفحص','refresh-all':'أضيفت المكتبة إلى طابور إعادة الاستخراج',
            'import':'طُلب تحديث المكتبة من Supabase'}[action])
        self.wake_event.set()

    def status(self):
        return dict(running=bool(self.thread and self.thread.is_alive()),enabled=self.enabled,connected=self.db is not None,
                    mode=self.mode,local_mode=self.desktop_mode(),interval_hours=self.interval/3600,last_tick=self.last_tick,last_import=self.last_import,
                    last_error=self.last_error,import_error=self.import_error,**self.queue.snapshot())
