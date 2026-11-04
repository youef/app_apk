"""Resumable public-HTML catalogue metadata crawler; never downloads playable media.

Work and page queues persist in SQLite so one inaccessible page/episode does not
stop subsequent items. An admin may separately save discovered metadata to Supabase.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
import json
from contextlib import contextmanager
import re
import sqlite3
import threading
import time

from bs4 import BeautifulSoup
from alezz_fetchv_importer import public_url, SourceClient, clean

DB_NAME = 'library_sync.sqlite3'
BAD_PATH = re.compile(r'(?:/episode(?:s)?[/_-]|/watch/|/player/|/tag/|/wp-admin/|/feed(?:/|$)|/attachment/)', re.I)
PAGE_PATH = re.compile(r'/page/\d+/?$|/pagina/\d+/?$|/paged/\d+/?$', re.I)
SERIES_WORDS = re.compile(r'(?:مسلسل|مسلسلات|series|serial|tv-show|season|drama)',re.I)
MOVIE_WORDS = re.compile(r'(?:فيلم|أفلام|افلام|movie|movies|film|cinema)',re.I)
PAGE_WORDS = re.compile(r'(?:التالي|الصفحة\s*التالية|next|older|more\s*posts|السابق|previous|\b\d+\b)',re.I)


def canonical(value: str) -> str:
    value = public_url(value)
    u=urlsplit(value)
    qs=[(k,v) for k,v in parse_qsl(u.query,keep_blank_values=True) if k.lower() not in
        ('utm_source','utm_medium','utm_campaign','utm_content','fbclid','gclid','ref')]
    path=re.sub(r'/+','/',u.path) or '/'
    if path!='/' and not re.search(r'\.[A-Za-z0-9]{2,5}$',path):path=path.rstrip('/')+'/'
    return urlunsplit((u.scheme,u.netloc.lower(),path,urlencode(qs),''))


def pagination(candidate: str, label: str, cls: str, root: str) -> bool:
    a,b=urlsplit(candidate),urlsplit(root)
    if a.hostname != b.hostname or a.path==b.path and a.query==b.query:return False
    if PAGE_PATH.search(a.path):
        prefix=PAGE_PATH.sub('',a.path).rstrip('/')
        return prefix==b.path.rstrip('/') or prefix.startswith(b.path.rstrip('/')+'/')
    query=dict(parse_qsl(a.query))
    origin=dict(parse_qsl(b.query))
    if a.path.rstrip('/')==b.path.rstrip('/') and any(k in query and query[k]!=origin.get(k) for k in ('paged','page','pagenum','pg')):return True
    if re.search(r'(?:pagination|nav-links|page-numbers|wp-pagenavi|next|prev)',cls,re.I):
        return a.path.rstrip('/')==b.path.rstrip('/') or bool(PAGE_PATH.search(a.path))
    if re.search(r'(?:التالي|Next|Older)',label,re.I):return a.path.rstrip('/')==b.path.rstrip('/') or bool(PAGE_PATH.search(a.path))
    return False


def extract_listing(html: str, url: str, root: str, kind: str) -> tuple[list[str],list[str]]:
    soup=BeautifulSoup(html,'html.parser')
    root_host=urlsplit(root).hostname
    works, pages=[],[]
    def append(target, out):
        try:
            link=canonical(urljoin(url,target))
            if urlsplit(link).hostname!=root_host or link in out or link==canonical(root):return
            out.append(link)
        except (ValueError,TypeError):pass
    for node in soup.select('script[type="application/ld+json"]'):
        try:raw=json.loads(node.string or node.get_text())
        except (ValueError,TypeError):continue
        stack=[raw]
        while stack:
            item=stack.pop()
            if isinstance(item,list):stack.extend(item[:500]);continue
            if not isinstance(item,dict):continue
            type_text=str(item.get('@type','')).lower()
            if 'movie' in type_text and kind!='series' or 'tvseries' in type_text and kind!='movie':
                val=item.get('url') or item.get('@id')
                if isinstance(val,str):append(val,works)
            for key in ('@graph','itemListElement','item','hasPart'):
                if key in item:stack.append(item[key])
            if 'listitem' in type_text and isinstance(item.get('url'),str):
                append(item['url'],works)
    for tag in soup.select('a[href]')[:6000]:
        href=tag.get('href','').strip()
        if not href or href.startswith(('#','javascript:','mailto:')):continue
        try:target=canonical(urljoin(url,href))
        except (ValueError,TypeError):continue
        if urlsplit(target).hostname!=root_host:continue
        text=clean((tag.get('title') or '')+' '+tag.get_text(' ',strip=True),250)
        marker=' '.join(str(x) for x in (tag.get('class') or []))+' '+str(tag.parent.get('class') if tag.parent else '')
        if pagination(target,text,marker,root):append(target,pages);continue
        if BAD_PATH.search(target) or PAGE_PATH.search(target):continue
        if any(segment in urlsplit(target).path.lower() for segment in ('/category/','/genres/','/genre/','/all-turkish-')):continue
        if target==canonical(url):continue
        near=tag.find_parent(['article','li'],class_=re.compile(r'(?:post|item|card|movie|serie|film)',re.I))
        ctx=(target+' '+text+' '+clean(near.get_text(' ',strip=True),100) if near else target+' '+text)
        matched=SERIES_WORDS.search(ctx) if kind=='series' else MOVIE_WORDS.search(ctx) if kind=='movie' else SERIES_WORDS.search(ctx) or MOVIE_WORDS.search(ctx)
        if matched:
            append(target,works)
    return list(dict.fromkeys(works)),list(dict.fromkeys(pages))


class JobDB:
    def __init__(self, path: str | Path):
        self.path=str(path)
        self.lock=threading.RLock()
        with self._db() as db:
            db.executescript('''
            create table if not exists sources (url text primary key,kind text not null, added_at real);
            create table if not exists pages (url text primary key,source_url text not null,kind text not null,status text not null default 'pending',attempts integer not null default 0,error text not null default '');
            create table if not exists works (url text primary key,source_url text not null,kind text not null,status text not null default 'pending',attempts integer not null default 0,error text not null default '',payload text not null default '',checkpoint text not null default '',saved integer not null default 0,save_error text not null default '');
            ''')
            if 'checkpoint' not in [r[1] for r in db.execute('pragma table_info(works)')]:
                db.execute("alter table works add column checkpoint text not null default ''")
    @contextmanager
    def _db(self):
        conn=sqlite3.connect(self.path,timeout=30)
        conn.row_factory=sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()
    def add_sources(self, urls: list[str],kind='auto'):
        with self.lock,self._db() as db:
            for raw in urls:
                url=canonical(raw)
                k=kind if kind!='auto' else ('movie' if MOVIE_WORDS.search(url) else 'series' if SERIES_WORDS.search(url) else 'auto')
                db.execute('insert or ignore into sources values (?,?,?)',(url,k,time.time()))
                db.execute('insert or ignore into pages(url,source_url,kind) values(?,?,?)',(url,url,k))
                # Readding a library is a fresh sync. No duplicate rows are created;
                # previously discovered works are rechecked for NEW episodes.
                db.execute("update pages set status='pending',attempts=0,error='' where source_url=?",(url,))
                db.execute("update works set status='pending',attempts=0,error='',saved=0,save_error='' where source_url=?",(url,))
    def append_works(self,source,kind,urls):
        with self.lock,self._db() as db:
            total=db.execute('select count(*) from works where source_url=?',(source,)).fetchone()[0]
            for url in urls:
                if total>=5000:break
                exists=db.execute('select 1 from works where url=?',(url,)).fetchone()
                if not exists:total+=1
                db.execute('insert or ignore into works(url,source_url,kind) values(?,?,?)',(url,source,kind))
    def append_pages(self,source,kind,urls):
        with self.lock,self._db() as db:
            total=db.execute('select count(*) from pages where source_url=?',(source,)).fetchone()[0]
            for url in urls:
                if total>=600:break
                exists=db.execute('select 1 from pages where url=?',(url,)).fetchone()
                if not exists:total+=1
                db.execute('insert or ignore into pages(url,source_url,kind) values(?,?,?)',(url,source,kind))
    def take(self,table,max_attempts=3):
        assert table in ('pages','works')
        with self.lock,self._db() as db:
            row=db.execute(f"select * from {table} where status='pending' and attempts<? order by rowid limit 1",(max_attempts,)).fetchone()
            if not row:return None
            db.execute(f"update {table} set status='processing',attempts=attempts+1 where url=?",(row['url'],))
            return dict(row)
    def checkpoint(self,url,data):
        with self.lock,self._db() as db:
            db.execute('update works set checkpoint=? where url=?',
                       (json.dumps(data,ensure_ascii=False),url))

    def done(self,table,url,payload=''):
        assert table in ('pages','works')
        with self.lock,self._db() as db:
            if table=='works':db.execute("update works set status='done',payload=?,checkpoint='',error='' where url=?",(payload,url))
            else:db.execute("update pages set status='done',error='' where url=?",(url,))
    def fail(self,table,url,error,max_attempts=3):
        assert table in ('pages','works')
        with self.lock,self._db() as db:
            row=db.execute(f'select attempts from {table} where url=?',(url,)).fetchone()
            db.execute(f'update {table} set status=?,error=? where url=?',('failed' if row['attempts']>=max_attempts else 'pending',clean(error,220),url))
    def recover(self):
        with self.lock,self._db() as db:
            for table in ('pages','works'):
                db.execute(f"update {table} set status='pending' where status='processing'")
    def retry_failed(self):
        with self.lock,self._db() as db:
            for table in ('pages','works'):
                db.execute(f"update {table} set status='pending',attempts=0 where status='failed'")
            db.execute("update works set save_error='' where saved=0")
    def snapshot(self,limit=100):
        with self.lock,self._db() as db:
            counts={}
            for table in ('pages','works'):
                counts[table]={r['status']:r['n'] for r in db.execute(f'select status,count(*) n from {table} group by status')}
            rows=[dict(r) for r in db.execute("select url,kind,status,attempts,error,saved,save_error,coalesce(case when status='done' then json_array_length(json_extract(payload,'$.discovery_warnings')) else 0 end,0) warnings,coalesce(case when checkpoint!='' then json_array_length(json_extract(checkpoint,'$.episodes')) else 0 end,0) episode_progress from works order by rowid desc limit ?", (limit,))]
            return {'counts':counts,'works':rows,'sources':[dict(r) for r in db.execute('select url,kind from sources order by added_at desc limit 30')]}
    def series_items(self,limit=150,query=''):
        term=query.strip().lower()
        with self.lock,self._db() as db:
            rows=[dict(r) for r in db.execute(
                "select url,source_url,kind,status,error,saved,save_error,payload,attempts from works where kind!='movie' order by rowid desc limit 250")]
        items=[]
        for row in rows:
            try:payload=json.loads(row['payload'] or '{}')
            except (ValueError,TypeError):payload={}
            if payload.get('kind')=='movie':continue
            title=payload.get('title') or row['url'].rstrip('/').split('/')[-1].replace('-',' ') or 'مسلسل مستورد'
            if term and term not in (title+' '+row['url']).lower():continue
            eps=payload.get('episodes') or []
            if not isinstance(eps,list):eps=[]
            items.append({'origin':'library','id':row['url'],'title':title,'url':row['url'],
               'source_url':row['source_url'],'status':row['status'],'saved':bool(row['saved']),
               'error':row['error'] or row['save_error'],'episodes':len(eps),
               'verified':sum(bool(e.get('verified')) for e in eps if isinstance(e,dict)),
               'direct':sum(bool(e.get('media_url')) for e in eps if isinstance(e,dict)),
               'attempts':row['attempts']})
            if len(items)>=limit:break
        return items

    def retry_work(self,url):
        url=canonical(url)
        with self.lock,self._db() as db:
            exists=db.execute('select 1 from works where url=?',(url,)).fetchone()
            if not exists:return False
            db.execute("update works set status='pending',attempts=0,error='',checkpoint='' where url=?",(url,))
            return True

    def replace_work_payload(self,url,payload):
        url=canonical(url)
        with self.lock,self._db() as db:
            result=db.execute("update works set payload=? where url=? and status='done'",(payload,url))
            if result.rowcount!=1:raise ValueError('Work is not ready')
            return True

    def get_work(self,url):
        with self.lock,self._db() as db:
            row=db.execute('select * from works where url=? and status=?',(canonical(url),'done')).fetchone()
            return dict(row) if row else None

    def unsaved(self,limit=10):
        with self.lock,self._db() as db:
            return [dict(r) for r in db.execute("select * from works where status='done' and saved=0 and save_error='' order by rowid limit ?",(limit,))]
    def mark_saved(self,url,error=''):
        with self.lock,self._db() as db:
            db.execute('update works set saved=?,save_error=? where url=?',(0 if error else 1,clean(error,240),url))


def collect_pages(job:JobDB,client_factory=SourceClient,max_pages=200):
    processed=0
    while processed<max_pages:
        row=job.take('pages')
        if not row:break
        processed+=1
        try:
            final,typ,html=client_factory(timeout=12).get(row['url'])
            if 'html' not in typ.lower() and '<html' not in html[:1000].lower():raise ValueError('Not HTML')
            works,pages=extract_listing(html,final,row['source_url'],row['kind'])
            job.append_works(row['source_url'],row['kind'],works)
            job.append_pages(row['source_url'],row['kind'],pages)
            job.done('pages',row['url'])
        except Exception as exc:job.fail('pages',row['url'],exc)
    return processed


def collect_works(job:JobDB, discover, max_works=200):
    processed=0
    while processed<max_works:
        row=job.take('works')
        if not row:break
        processed+=1
        try:
            progress=json.loads(row.get('checkpoint') or '{}')
            work=discover(row['url'],row['kind'],progress,lambda data:job.checkpoint(row['url'],data))
            job.done('works',row['url'],json.dumps(asdict(work),ensure_ascii=False))
        except Exception as exc:job.fail('works',row['url'],exc)
    return processed
