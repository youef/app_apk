#!/usr/bin/env python3
"""Al Ezz TV FastAPI metadata-import studio, local or private cloud.

Cloud mode requires a protected login and persistent disk. The FetchV browser
extension is local-only; server can ingest URLs copied from it.
"""
from __future__ import annotations

import asyncio
from ipaddress import ip_address
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import secrets
import threading
import time
from typing import Any
from urllib.parse import unquote, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from alezz_fetchv_importer import (
    Catalogue, Episode, MEDIA_EXT, SourceClient, SourceConnectionError, Supabase, category_for_genres,
    hydrate_episode_metadata,
    collect_edge_network,
    clean, inspect_episodes, public_url, pull_html, store,
)

from metadata_enrichment import enrich
from library_sync import JobDB,collect_pages,collect_works
from auto_sync import AutoSync, target_key
from media_resolver import MediaResolver, read_public_html, safe_error, supported_source_kind
from title_cleaner import content_title
from launch import studio_revision
from member_portal import Portal

BASE = Path(__file__).resolve().parent
STUDIO_REVISION = studio_revision()
DATA_DIR = Path(os.getenv("ALEZZ_DATA_DIR", str(BASE))).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
LIBRARY = JobDB(DATA_DIR / "library_sync.sqlite3")
LIBRARY.recover()
AUTOSYNC = AutoSync(DATA_DIR)
_library_lock = threading.RLock()
_library_worker = None
DEFAULT_DB_URL = 'https://qyzmlwtvzzgooccqxglq.supabase.co'
DEFAULT_PUBLIC_KEY = 'sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES'
COOKIE = 'alezz_studio_session'
EXPIRY_SECONDS = 8 * 3600
MAX_STATES = 50

@asynccontextmanager
async def lifespan(app):
    AUTOSYNC.start()
    if any(LIBRARY.snapshot()['counts'][k].get('pending',0) for k in ('pages','works')):
        _start_library_worker()
    try: yield
    finally: AUTOSYNC.stop()


app = FastAPI(title='Al Ezz TV | Python Import Studio', docs_url=None, redoc_url=None,
              openapi_url=None, lifespan=lifespan)
app.mount('/static', StaticFiles(directory=str(BASE / 'static')), name='static')
portal = Portal(os.getenv('ALEZZ_PORTAL_DIR', str(BASE.parent)),
                os.getenv('ALEZZ_SUPABASE_URL', DEFAULT_DB_URL),
                os.getenv('ALEZZ_SUPABASE_PUBLISHABLE_KEY', DEFAULT_PUBLIC_KEY),
                secure=os.getenv('ALEZZ_PUBLIC_MODE') == '1')
app.middleware('http')(portal.middleware)
@app.api_route('/login',methods=['GET','POST'],include_in_schema=False)
async def legacy_login():
    return RedirectResponse('/account/admin',status_code=303)

@app.post('/logout-site',include_in_schema=False)
async def legacy_logout():
    return RedirectResponse('/account/admin',status_code=303)
async def worker_health():
    info=AUTOSYNC.status()
    return JSONResponse({'ok':True,'service':'al-ezz-tv-python-studio',
        'autosync':{k:info[k] for k in ('running','enabled','connected','last_tick')},
        'autosync_ready':bool(info['running'] and info['connected'] and info['last_import'] and not info['last_error']),
        'version':os.getenv('RENDER_GIT_COMMIT','autosync-v1')[:40],
        'member_portal':(portal.root/'web'/'index.view').is_file() and (portal.root/'admin'/'index.view').is_file(),
        'studio_revision':STUDIO_REVISION},headers={'Cache-Control':'no-store'})

app.add_api_route('/healthz', worker_health, methods=['GET'], include_in_schema=False)


@dataclass
class UserState:
    csrf: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    catalogue: Catalogue | None = None
    catalogues: list[Catalogue] = field(default_factory=list)
    batch_errors: list[dict] = field(default_factory=list)
    current_index: int = 0
    db: Supabase | None = None
    demo: bool = False
    scan: dict | None = None
    scan_catalogue: Catalogue | None = None
    last_used: float = field(default_factory=time.monotonic)
    lock: Any = field(default_factory=threading.RLock)


_states: dict[str, UserState] = {}
_states_lock = threading.RLock()


def find_state(request: Request, create: bool = False) -> tuple[str, UserState]:
    now = time.monotonic()
    with _states_lock:
        for sid, state in list(_states.items()):
            if now - state.last_used > EXPIRY_SECONDS:
                _states.pop(sid, None)
        sid = request.cookies.get(COOKIE, '')
        state = _states.get(sid)
        if state is None:
            if not create:
                raise HTTPException(401, 'انتهت الجلسة؛ حدّث الصفحة')
            if len(_states) >= MAX_STATES:
                raise HTTPException(503, 'الخادم مشغول بجلسات أخرى')
            sid = secrets.token_urlsafe(32)
            state = UserState()
            _states[sid] = state
        state.last_used = now
    return sid, state


def protected(request: Request) -> UserState:
    _, state = find_state(request)
    if request.headers.get('x-csrf-token', '') != state.csrf:
        raise HTTPException(403, 'طلب غير مصرح به: رمز الحماية غير صحيح')
    origin = request.headers.get('origin')
    if origin:
        from urllib.parse import urlsplit
        parsed = urlsplit(origin)
        if parsed.scheme not in ('http', 'https') or parsed.netloc != request.url.netloc:
            raise HTTPException(403, 'مصدر الطلب غير مسموح به')
    return state


def current_catalogue(state: UserState) -> Catalogue:
    if state.catalogue is None:
        raise HTTPException(409, 'اكتشف فيلمًا أو مسلسلًا أولًا')
    return state.catalogue


def scan_status(state: UserState) -> dict | None:
    return dict(state.scan) if state.scan_catalogue is state.catalogue and state.scan else None


def get_summary(state: UserState) -> dict:
    with state.lock:
        cat = state.catalogue
        n = len(cat.episodes) if cat and cat.kind == 'series' else (1 if cat else 0)
        good = (sum(x.verified for x in cat.episodes) if cat.kind == 'series' else int(cat.verified)) if cat else 0
        return dict(catalogue=asdict(cat) if cat else None, authenticated=state.db is not None,
                    demo=state.demo, count=n, verified=good, scan=scan_status(state),
                    batch=[dict(index=i,title=c.title,kind=c.kind,episodes=len(c.episodes),
                                year=c.year,poster_url=c.poster_url,original_title=c.original_title,
                                verified=sum(ep.verified for ep in c.episodes) if c.kind=='series' else int(c.verified))
                           for i,c in enumerate(state.catalogues)],
                    batch_errors=state.batch_errors[:25],current_index=state.current_index)


@app.get('/')
async def homepage():
    return FileResponse(BASE/'templates'/'landing.html',headers={'Cache-Control':'public, max-age=300'})

@app.get('/studio')
async def studio_short():
    return RedirectResponse('/studio/',status_code=303)

@app.get('/studio/')
async def studio_homepage():
    return FileResponse(BASE/'templates'/'index.html',headers={'Cache-Control':'private, no-store'})

@app.get('/studio/sources')
async def series_review_page():
    return FileResponse(BASE/'templates'/'series-review.html',headers={'Cache-Control':'private, no-store'})


@app.get('/api/init')
async def init(request: Request):
    sid, state = find_state(request, True)
    if any(LIBRARY.snapshot()["counts"][k].get("pending",0) for k in ("pages","works")):
        _start_library_worker()
    res = JSONResponse({'csrf': state.csrf, **get_summary(state)}, headers={'Cache-Control': 'no-store'})
    res.set_cookie(COOKIE, sid, httponly=True, samesite='strict', max_age=EXPIRY_SECONDS,
                   secure=os.getenv('ALEZZ_PUBLIC_MODE') == '1' or request.url.scheme == 'https', path='/')
    return res


@app.get('/api/status')
async def status(request: Request):
    _, state = find_state(request)
    return JSONResponse(get_summary(state), headers={'Cache-Control': 'no-store'})


class DiscoverySourceClient(SourceClient):
    def __init__(self, source):
        super().__init__(timeout=6)
        self.retries = 1
        self.source = source

    def get(self, url, max_size=1_500_000):
        try:
            return super().get(url,max_size)
        except SourceConnectionError:
            if url != self.source or AUTOSYNC.mode == 'http':
                raise
            try:
                return read_public_html(url,max_size)
            except Exception as exc:
                raise SourceConnectionError('انقطع اتصال المصدر، وتعذّرت قراءته بالمتصفح أيضًا: '+safe_error(exc)) from None


def discover_full(source: str, kind: str='auto', deep: bool=True, enrich_metadata: bool=True,
                  resume_progress:dict|None=None,progress_hook=None) -> Catalogue:
    source=public_url(source)
    client=DiscoverySourceClient(source)
    try:
        cat=pull_html(source,client,kind,max_seasons=500,
                      max_episodes=5000,max_pages=500,resume_progress=resume_progress,progress_hook=progress_hook)
    finally:
        client.session.close()
    if kind!='auto':cat.kind=kind
    cat.source_pages=list(dict.fromkeys([source,cat.url,*cat.source_pages]))
    if enrich_metadata:
        enrich(cat,include_episodes=True)
    if deep and cat.kind=='series' and cat.episodes:
        hydrate_episode_metadata(cat,max_pages=120,workers=6)
    return cat



# Durable metadata queue for library/category pages. It runs only when the local
# Python server is open. The queue survives restarts without retaining passwords.
def _run_library_sync():
    global _library_worker
    try:
        for _ in range(1050):
            scanned=collect_pages(LIBRARY,max_pages=8)
            discovered=collect_works(LIBRARY,lambda url,kind,progress,hook: discover_full(url,kind,deep=False,enrich_metadata=True,
                resume_progress=progress,progress_hook=hook),max_works=6)
            if not scanned and not discovered:break
    finally:
        with _library_lock:_library_worker=None


def _start_library_worker():
    global _library_worker
    with _library_lock:
        if _library_worker is not None and _library_worker.is_alive():return False
        _library_worker=threading.Thread(target=_run_library_sync,daemon=True,name='alezz-library-sync')
        _library_worker.start()
        return True



@app.on_event('startup')
async def resume_unfinished_cloud_sync():
    """Continue saved work after a process restart, even before the owner signs in."""
    snapshot = LIBRARY.snapshot(limit=1)
    if any(snapshot['counts'][table].get('pending', 0) for table in ('pages', 'works')):
        _start_library_worker()


class LibrarySourceForm(BaseModel):
    urls: str = Field(min_length=12,max_length=25000)
    kind: str = 'auto'


@app.post('/api/library-start')
async def library_start(request:Request,data:LibrarySourceForm):
    protected(request)
    if data.kind not in ('auto','series','movie'):raise HTTPException(400,'نوع المحتوى غير صحيح')
    urls=list(dict.fromkeys(x.strip() for x in data.urls.splitlines() if x.strip() and not x.lstrip().startswith('#')))
    if not 1<=len(urls)<=30:raise HTTPException(400,'يمكن إدخال 1 إلى 30 رابط قائمة في كل مرة')
    try:LIBRARY.add_sources(urls,data.kind)
    except ValueError as exc:raise HTTPException(400,clean(exc,120)) from None
    _start_library_worker()
    return {'ok':True,'status':LIBRARY.snapshot()}


@app.get('/api/library-status')
async def library_status(request:Request):
    find_state(request)
    return {'running':_library_worker is not None and _library_worker.is_alive(),**LIBRARY.snapshot()}


@app.post('/api/library-resume')
async def library_resume(request:Request):
    protected(request)
    LIBRARY.recover()
    _start_library_worker()
    return {'ok':True,'status':LIBRARY.snapshot()}


@app.post('/api/library-retry')
async def library_retry(request:Request):
    protected(request)
    LIBRARY.retry_failed()
    _start_library_worker()
    return {'ok':True,'status':LIBRARY.snapshot()}


class LibraryLoadForm(BaseModel):
    url:str=Field(min_length=12,max_length=2048)


@app.post('/api/library-load')
async def library_load(request:Request,body:LibraryLoadForm):
    state=protected(request)
    row=LIBRARY.get_work(body.url)
    if not row:raise HTTPException(404,'العمل لم يكتمل اكتشافه بعد')
    data=json.loads(row['payload'])
    eps=[Episode(**e) for e in data.pop('episodes',[])]
    cat=Catalogue(**data,episodes=eps)
    with state.lock:
        state.catalogue=cat
        state.catalogues=[cat]
        state.current_index=0
        state.demo=False
    return get_summary(state)


_discovery_scans = ThreadPoolExecutor(max_workers=2, thread_name_prefix='studio-scan')


class TitleSearchForm(BaseModel):
    query: str = Field(min_length=2, max_length=120)
    kind: str = 'auto'


def search_titles(query: str, kind: str) -> list[dict]:
    root = public_url(os.getenv('ALEZZ_TITLE_SEARCH_URL', 'https://v3.qrmzi.buzz/'))
    parts = urlsplit(root)
    address = urlunsplit((parts.scheme, parts.netloc, parts.path or '/', urlencode({'s': query}), ''))
    client = SourceClient(timeout=10)
    try:
        final, typ, html = client.get(address)
    finally:
        client.session.close()
    if 'html' not in typ.lower():
        raise ValueError('مصدر البحث لم يُرجع صفحة نتائج.')
    soup = BeautifulSoup(html, 'html.parser')
    results = {}
    for anchor in soup.select('a[href]'):
        target = urlsplit(urljoin(final, anchor['href']))
        if target.hostname != parts.hostname and target.hostname != urlsplit(final).hostname:
            continue
        path = target.path.strip('/').split('/')
        if len(path) != 2 or path[0] not in ('movies', 'series', 'tv-series', 'movie'):
            continue
        item_kind = 'movie' if path[0] in ('movies', 'movie') else 'series'
        if kind != 'auto' and kind != item_kind:
            continue
        try:
            url = public_url(urlunsplit((target.scheme, target.netloc, target.path, '', '')))
        except ValueError:
            continue
        key = (target.hostname, unquote(target.path).rstrip('/').casefold())
        if key in results:
            continue
        title = content_title(anchor.get('title') or anchor.get_text(' ', strip=True), url,
                              fallback=unquote(path[1]).replace('-', ' '))
        results[key] = {'url': url, 'title': title, 'kind': item_kind}
        if len(results) >= 40:
            break
    terms = query.casefold().split()
    matching = [item for item in results.values() if all(term in item['title'].casefold() for term in terms)]
    return matching[:18]


@app.post('/api/title-search')
async def title_search(request: Request, body: TitleSearchForm):
    protected(request)
    query = clean(body.query, 120)
    if len(query) < 2 or body.kind not in ('auto','movie','series'):
        raise HTTPException(400,'اكتب اسم العمل وحدد نوعًا صحيحًا.')
    try:
        results = await run_in_threadpool(search_titles, query, body.kind)
    except Exception as exc:
        raise HTTPException(502,'تعذر الوصول إلى مصدر البحث: '+safe_error(exc)) from None
    return {'results': results}


def _scan_media_entry(cat: Catalogue, entry):
    """Bounded, independent discovery worker. Only its own result is returned.

    Public HTTPS pages and media candidates are inspected. Embedded pages are
    checked for reachability but never treated as verified direct playback.
    """
    page = cat.url if cat.kind == 'movie' else entry.page_url
    candidates = list(entry.sources)
    if entry.media_url and not any(item.get('url') == entry.media_url for item in candidates):
        candidates.append({'url': entry.media_url,
                           'kind': supported_source_kind(entry.media_url) or 'direct',
                           'page_url': page})
    pages = list(dict.fromkeys(url for url in [page, *entry.source_pages]
                               if url and (cat.kind == 'movie' or url.rstrip('/') != cat.url.rstrip('/'))))
    checked, playable, error = candidates, None, ''
    try:
        # HTTP checks run concurrently. Browser extraction is a controlled
        # fallback and can take longer on source sites that throttle access.
        resolver = MediaResolver(mode=AUTOSYNC.mode, timeout=9, max_pages=5)
        if entry.media_url and supported_source_kind(entry.media_url) == 'embed':
            checked = resolver.check(candidates)
            errors = []
        else:
            checked, errors = resolver.resolve(pages, existing=candidates)
        playable = next((item for item in checked
                         if item.get('verified') and item.get('kind') == 'direct'), None)
        embedded = any(item.get('kind') == 'embed' and item.get('reachable')
                       and item.get('url') == entry.media_url for item in checked)
        if not playable and not embedded:
            error = '; '.join(errors[:2]) or 'لم يُعثر على رابط مباشر اجتاز الفحص.'
    except Exception as exc:
        error = safe_error(exc)
    return entry, checked, pages, playable, error


def scan_catalogue(state: UserState, cat: Catalogue, progress: dict):
    """Inspect episodes concurrently and surface each result as soon as it lands."""
    from concurrent.futures import as_completed

    targets = list(cat.episodes) if cat.kind == 'series' else [cat]
    if not targets:
        with state.lock:
            if state.scan is progress:
                progress['running'] = False
        return

    # Keep the pool bounded so multiple administrators cannot exhaust Render.
    workers = min(3, len(targets))
    progress['workers'] = workers
    try:
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix='studio-media') as executor:
            pending = {executor.submit(_scan_media_entry, cat, entry): entry for entry in targets}
            for future in as_completed(pending):
                with state.lock:
                    if state.catalogue is not cat or state.scan is not progress:
                        for outstanding in pending:
                            outstanding.cancel()
                        return
                try:
                    entry, checked, pages, playable, error = future.result()
                except Exception as exc:
                    entry = pending[future]
                    checked, pages, playable, error = list(entry.sources), [], None, safe_error(exc)
                with state.lock:
                    if state.catalogue is not cat or state.scan is not progress:
                        return
                    entry.sources = checked
                    if pages:
                        entry.source_pages = pages
                    if playable:
                        entry.media_url = playable['url']
                    entry.verified = playable is not None
                    entry.error = error
                    progress['done'] += 1
                    progress['verified'] += int(entry.verified)
                    progress['sources_found'] += sum(
                        item.get('kind') == 'direct' for item in checked)
                    if time.monotonic()-progress.get('persisted_at',0)>=2:
                        LIBRARY.remember_discovery(cat)
                        progress['persisted_at']=time.monotonic()
    except Exception as exc:
        with state.lock: progress['error']=safe_error(exc)
    finally:
        with state.lock:
            if state.scan is progress:
                try:
                    LIBRARY.remember_discovery(cat)
                except Exception as exc:
                    progress['error'] = safe_error(exc)
                finally:
                    progress['running'] = False


def start_catalogue_scan(state: UserState, cat: Catalogue):
    total = len(cat.episodes) if cat.kind == 'series' else 1
    progress = {'id':secrets.token_hex(8),'running':bool(total),'done':0,'total':total,'verified':0,'sources_found':0,'workers':0,'error':''}
    state.scan = progress
    state.scan_catalogue = cat
    if total: _discovery_scans.submit(scan_catalogue,state,cat,progress)


@app.get('/api/discovery-scan')
async def discovery_scan(request: Request):
    _, state = find_state(request)
    with state.lock:
        progress = scan_status(state)
        if progress:
            # Include incremental snapshots so the client shows verified links
            # and episode status while the concurrent workers are still running.
            return {'scan':dict(progress),'summary':get_summary(state)}
    return {'scan':None}


class DiscoverForm(BaseModel):
    url: str = Field(min_length=12, max_length=2048)
    kind: str = 'auto'
    deep: bool = True
    metadata: bool = True
    scan_media: bool = True
    force_refresh: bool = False


@app.post('/api/discover')
async def discover(request: Request, data: DiscoverForm):
    state = protected(request)
    if data.kind not in ('auto', 'movie', 'series'):
        raise HTTPException(400, 'نوع العمل غير مدعوم')
    try:
        source = public_url(data.url)
        cached = None if data.force_refresh else LIBRARY.cached_discovery(source)
        if cached and (data.kind=='auto' or data.kind==cached['kind']):
            cached=dict(cached)
            episodes=[Episode(**row) for row in cached.pop('episodes',[])]
            cat=Catalogue(**cached,episodes=episodes)
        else:
            cat = await run_in_threadpool(lambda: discover_full(source, data.kind, deep=data.deep, enrich_metadata=data.metadata))
        cat.source_pages=list(dict.fromkeys([source,cat.url,*cat.source_pages]))
        LIBRARY.remember_discovery(cat)
        with state.lock:
            state.catalogue, state.catalogues, state.batch_errors = cat, [cat], []
            state.current_index, state.demo = 0, False
            if data.scan_media: start_catalogue_scan(state,cat)
        return get_summary(state)
    except SourceConnectionError as exc:
        raise HTTPException(502, str(exc)) from None
    except Exception as exc:
        raise HTTPException(400, 'تعذر اكتشاف المصدر: ' + safe_error(exc)) from None


class ListingScanForm(BaseModel):
    url: str = Field(min_length=12,max_length=2048)
    kind: str = 'series'


@app.post('/api/scan-listing')
async def scan_listing(request:Request,data:ListingScanForm):
    state=protected(request)
    if data.kind not in ('series','movie','auto'):
        raise HTTPException(400,'نوع المحتوى غير مدعوم')
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin,urlsplit
    import re
    def task():
        root=public_url(data.url)
        final,typ,html=SourceClient(timeout=12).get(root)
        if 'html' not in typ.lower():raise ValueError('المصدر ليس صفحة HTML')
        soup=BeautifulSoup(html,'html.parser')
        host=urlsplit(final).hostname
        found=[]
        def add(value):
            try:
                link=public_url(urljoin(final,value))
                if urlsplit(link).hostname!=host:return
                if link.rstrip('/')==final.rstrip('/') or link in found:return
                if re.search(r'/episode[/_-]|/حلقة[/_-]|/الحلقة[/_-]',link,re.I):return
                found.append(link)
            except (ValueError,TypeError):pass
        # Structured series/movie links have priority over ambiguous category links.
        for node in soup.select('script[type="application/ld+json"]'):
            try:
                obj=json.loads(node.string or node.get_text())
                docs=obj if isinstance(obj,list) else [obj]
                if isinstance(obj,dict) and '@graph' in obj:docs+=obj['@graph']
                for doc in docs[:90]:
                    if not isinstance(doc,dict):continue
                    typ=str(doc.get('@type','')).lower()
                    if ('tvseries' in typ and data.kind!='movie') or ('movie' in typ and data.kind!='series'):
                        add(doc.get('url') or doc.get('@id') or '')
                    for child in (doc.get('itemListElement') or [])[:40]:
                        if isinstance(child,dict):
                            entry=child.get('item') or child
                            if isinstance(entry,dict):add(entry.get('url') or '')
            except (ValueError,TypeError,AttributeError):pass
        for a in soup.select('a[href]')[:2000]:
            if len(found)>=18:break
            href=a.get('href','')
            label=clean(a.get_text(' ',strip=True)+' '+(a.get('title') or ''),160)
            check=(href+' '+label).lower()
            if data.kind=='series':matched=bool(re.search(r'(?:series|tv-show|مسلسل|مسلسلات|حلقات)',check))
            elif data.kind=='movie':matched=bool(re.search(r'(?:movie|film|فيلم|أفلام|افلام)',check))
            else:matched=bool(re.search(r'(?:series|tv-show|movie|film|مسلسل|فيلم)',check))
            if matched and not re.search(r'(?:pagination|/page/|/category/|/genre/|/tag/|[?&]page=)',href,re.I):add(href)
        return found[:18]
    try:links=await run_in_threadpool(task)
    except Exception as exc:raise HTTPException(400,'فشل قراءة صفحة القائمة: '+clean(exc,160)) from None
    return {'links':links,'count':len(links), 'note':'تم جمع روابط محتملة من صفحة واحدة فقط؛ راجعها قبل الاكتشاف.'}


class DiscoverBatchForm(BaseModel):
    urls: str = Field(min_length=12, max_length=45000)
    kind: str = 'auto'
    deep: bool = False
    metadata: bool = True


@app.post('/api/discover-batch')
async def discover_batch(request: Request, data: DiscoverBatchForm):
    state=protected(request)
    if data.kind not in ('auto','movie','series'):
        raise HTTPException(400,'نوع العمل غير صالح')
    from concurrent.futures import ThreadPoolExecutor, as_completed
    rows=[x.strip() for x in data.urls.splitlines() if x.strip() and not x.strip().startswith('#')]
    unique=list(dict.fromkeys(rows))
    if not 1<=len(unique)<=18:
        raise HTTPException(400,'يمكن استيراد 1 إلى 18 رابطًا مختلفًا في كل دفعة')
    try:
        urls=[public_url(url) for url in unique]
    except ValueError as exc:
        raise HTTPException(400,'يُقبل رابط HTTPS عام لكل عمل: '+clean(exc,120)) from None
    def work():
        found,failed=[],[]
        with ThreadPoolExecutor(max_workers=min(3,len(urls))) as pool:
            futures={pool.submit(discover_full,url,data.kind,data.deep,data.metadata):url for url in urls}
            for future in as_completed(futures):
                url=futures[future]
                try:
                    item=future.result()
                    found.append((urls.index(url),item))
                except Exception as exc:
                    failed.append({'url':url,'error':clean(exc,170)})
        found.sort(key=lambda x:x[0])
        return [c for _,c in found],failed
    catalogues,errors=await run_in_threadpool(work)
    if not catalogues:
        raise HTTPException(400,'تعذر اكتشاف الروابط: '+('؛ '.join(x['error'] for x in errors[:2])))
    with state.lock:
        state.catalogues=catalogues
        state.catalogue=catalogues[0]
        state.current_index=0
        state.batch_errors=errors
        state.demo=False
    return get_summary(state)


class SelectCatalogueForm(BaseModel):
    index: int = Field(ge=0,le=17)


@app.post('/api/select-catalogue')
async def select_catalogue(request:Request,data:SelectCatalogueForm):
    state=protected(request)
    with state.lock:
        if data.index>=len(state.catalogues):
            raise HTTPException(404,'هذا العمل غير موجود ضمن الدفعة الحالية')
        state.current_index=data.index
        state.catalogue=state.catalogues[data.index]
    return get_summary(state)


@app.post('/api/demo')
async def demo(request: Request):
    state = protected(request)
    cat = Catalogue(kind='series', title='مسلسل تجريبي — عرض الواجهة',
                    url='https://example.org/sample-series',
                    original_title='Preview Series', year=2026,
                    country='TR', language='tr', genres=['drama', 'romance'],
                    description='نموذج توضيحي للواجهة فقط. استخدم رابط مصدر حقيقي لاستيراد البيانات.',
                    episodes=[Episode(i, j, f'الحلقة {j}', f'https://example.org/s{i}e{j}',
                                      description='وصف تجريبي للحلقة، قابل للتعديل من الواجهة.')
                              for i in (1, 2) for j in range(1, 5)])
    with state.lock:
        state.catalogue, state.catalogues, state.batch_errors = cat, [cat], []
        state.current_index, state.demo = 0, True
    return get_summary(state)


class LinkForm(BaseModel):
    text: str = Field(max_length=120000)


@app.post('/api/links')
async def links(request: Request, data: LinkForm):
    state = protected(request)
    cat = current_catalogue(state)
    count, problems = 0, []
    with state.lock:
        for no, line in enumerate(data.text.lstrip('\ufeff').splitlines(), 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if len(line) > 2200:
                problems.append(f'السطر {no}: طويل جدًا')
                continue
            try:
                if cat.kind == 'movie' and '|' not in line:
                    url = public_url(line)
                    if not supported_source_kind(url):
                        raise ValueError('الرابط يجب أن يكون MP4/HLS/WebM أو Embed 1vid')
                    cat.media_url, cat.verified = url, False
                    count += 1
                    continue
                if '|' not in line:
                    raise ValueError('المطلوب S01E01|https://...')
                label, url = line.split('|', 1)
                from alezz_fetchv_importer import episode_numbers
                numbers = episode_numbers(label.strip())
                url = public_url(url.strip())
                if not numbers or not supported_source_kind(url):
                    raise ValueError('الموسم/الحلقة أو صيغة الرابط غير صحيحة')
                ep = next((e for e in cat.episodes if (e.season, e.number) == numbers), None)
                if ep is None:
                    problems.append(f'السطر {no}: الحلقة غير موجودة في الاكتشاف')
                    continue
                ep.media_url, ep.verified, ep.error = url, False, ''
                count += 1
            except (ValueError, TypeError) as exc:
                problems.append(f'السطر {no}: {clean(exc, 100)}')
    return {'updated': count, 'problems': problems[:30], **get_summary(state)}


class UpdateForm(BaseModel):
    title: str | None = None
    original_title: str | None = None
    description: str | None = None
    poster_url: str | None = None
    backdrop_url: str | None = None
    year: int | None = None
    country: str | None = None
    language: str | None = None
    genres: list[str] | None = None
    episodes: list[dict[str, Any]] | None = None
    media_url: str | None = None


def optional_url(value: str) -> str:
    if not value:
        return ''
    try:
        return public_url(value)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, 'يُقبل رابط HTTPS عام فقط للصورة أو الفيديو') from exc


@app.post('/api/update')
async def update(request: Request, data: UpdateForm):
    state = protected(request)
    cat = current_catalogue(state)
    with state.lock:
        if data.title is not None:
            if len(data.title.strip()) < 2:
                raise HTTPException(400, 'العنوان قصير جدًا')
            cat.title = clean(data.title, 250)
        if data.original_title is not None:
            cat.original_title = clean(data.original_title, 250)
        if data.description is not None:
            cat.description = clean(data.description, 2000)
        if data.poster_url is not None:
            cat.poster_url = optional_url(data.poster_url)
        if data.backdrop_url is not None:
            cat.backdrop_url = optional_url(data.backdrop_url)
        if 'year' in data.model_fields_set:
            if data.year is not None and not 1880 <= data.year <= 2100:
                raise HTTPException(400, 'السنة خارج النطاق')
            cat.year = data.year
        if data.country is not None:
            value = data.country.strip().upper()
            if value and (len(value) != 2 or not value.isalpha()):
                raise HTTPException(400, 'رمز الدولة يجب أن يكون حرفين')
            cat.country = value
        if data.language is not None:
            value = data.language.strip().lower()
            if value and (not value.isalpha() or not 2 <= len(value) <= 3):
                raise HTTPException(400, 'رمز اللغة غير صالح')
            cat.language = value
        if data.genres is not None:
            cat.genres = list(dict.fromkeys(clean(x, 40).lower() for x in data.genres if x))[:12]
        if data.media_url is not None and cat.kind == 'movie':
            value = optional_url(data.media_url)
            if value and not supported_source_kind(value):
                raise HTTPException(400, 'رابط الفيلم يجب أن يكون MP4/HLS/WebM أو Embed 1vid')
            if value != cat.media_url:
                cat.media_url, cat.verified = value, False
        if data.episodes is not None and cat.kind == 'series':
            index = {(e.season, e.number): e for e in cat.episodes}
            for row in data.episodes[:150]:
                try:
                    pair = (int(row.get('season', -1)), int(row.get('number', -1)))
                except (ValueError, TypeError):
                    continue
                ep = index.get(pair)
                if ep is None:
                    continue
                if 'title' in row:
                    ep.title = clean(row['title'], 250) or f'الحلقة {ep.number}'
                if 'description' in row:
                    ep.description = clean(row['description'], 1500)
                if 'poster_url' in row:
                    ep.poster_url = optional_url(str(row['poster_url']))
                if 'media_url' in row:
                    value = optional_url(str(row['media_url']))
                    if value and not supported_source_kind(value):
                        raise HTTPException(400, f'صيغة رابط الموسم {ep.season} الحلقة {ep.number} غير مدعومة')
                    if value != ep.media_url:
                        ep.media_url, ep.verified, ep.error = value, False, ''
    return get_summary(state)


class EpisodeAdd(BaseModel):
    season: int = Field(ge=1, le=100)
    number: int = Field(ge=1, le=1000)
    title: str = Field(default='', max_length=250)


@app.post('/api/episode-add')
async def episode_add(request: Request, data: EpisodeAdd):
    state = protected(request)
    cat = current_catalogue(state)
    if cat.kind != 'series':
        raise HTTPException(400, 'هذه العملية للمسلسلات فقط')
    with state.lock:
        if len(cat.episodes) >= 150:
            raise HTTPException(400, 'الحد الأقصى 150 حلقة في العملية الواحدة')
        if any((ep.season, ep.number) == (data.season, data.number) for ep in cat.episodes):
            raise HTTPException(409, 'هذه الحلقة موجودة بالفعل')
        cat.episodes.append(Episode(data.season, data.number, clean(data.title, 250) or f'الحلقة {data.number}', cat.url))
        cat.episodes.sort(key=lambda ep: (ep.season, ep.number))
    return get_summary(state)


class VerifyForm(BaseModel):
    indices: list[int] = Field(default_factory=list, max_length=16)


def verify_entries(cat: Catalogue, indices: list[int]) -> int:
    def check_embed(item) -> bool:
        if supported_source_kind(item.media_url) != 'embed':
            return False
        # Probe the iframe document only. Its reachability is not video playback.
        checked = MediaResolver(mode='http').check([
            {'url': item.media_url, 'kind': 'embed', 'label': '1vid'}])
        item.sources = [s for s in item.sources if s.get('url') != item.media_url] + checked
        item.verified = False
        item.error = '' if checked and checked[0].get('reachable') else (
            checked[0].get('error', 'تعذّر الوصول إلى صفحة المشغّل') if checked
            else 'تعذّر الوصول إلى صفحة المشغّل')
        return True

    if cat.kind == 'movie':
        if not check_embed(cat):
            inspect_episodes(cat, SourceClient(timeout=12), delay=0)
        return int(cat.verified)
    targets = [(i, cat.episodes[i]) for i in dict.fromkeys(indices) if 0 <= i < len(cat.episodes)]
    def inspect(item: Episode):
        if check_embed(item):
            return False
        temp = Catalogue(kind='series', title=cat.title, url=cat.url, episodes=[item])
        inspect_episodes(temp, SourceClient(timeout=12), delay=0)
        return item.verified
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(inspect, [ep for _, ep in targets]))
    return sum(results)


@app.post('/api/verify')
async def verify(request: Request, data: VerifyForm):
    state = protected(request)
    cat = current_catalogue(state)
    indices = data.indices[:12] if cat.kind == 'series' else []
    if cat.kind == 'series' and not indices:
        raise HTTPException(400, 'اختر حلقات للفحص')
    def task():
        with state.lock:
            return verify_entries(cat, indices)
    try:
        count = await run_in_threadpool(task)
    except Exception as exc:
        raise HTTPException(400, clean(exc, 200)) from None
    return {'checked': count, **get_summary(state)}


class EdgeCaptureForm(BaseModel):
    seconds: int = Field(default=3, ge=1, le=8)
    max_pages: int = Field(default=4, ge=1, le=8)
    start_index: int = Field(default=0, ge=0, le=5000)


@app.post('/api/edge-capture')
async def edge_capture(request: Request, data: EdgeCaptureForm):
    state = protected(request)
    cloud = os.getenv('ALEZZ_PUBLIC_MODE') == '1' or bool(os.getenv('RENDER'))
    if cloud:
        if os.getenv('ALEZZ_BROWSER_CAPTURE') != '1':
            raise HTTPException(503, 'ميزة Chromium السحابي غير مفعلة؛ أعد نشر Docker المحدث أو اضبط ALEZZ_BROWSER_CAPTURE=1.')
        if state.db is None:
            raise HTTPException(401, 'سجّل دخول مسؤول Supabase قبل استخدام فحص Chromium السحابي.')
    if state.demo:
        raise HTTPException(400, 'اكتشف رابطًا حقيقيًا قبل فحص الشبكة')
    cat = current_catalogue(state)
    total = len(cat.episodes) if cat.kind == 'series' else 1
    if data.start_index >= total:
        return {'detected': 0, 'processed': 0, 'total': total, 'next_index': total,
                'has_more': False, **get_summary(state)}
    processed = min(data.max_pages, total - data.start_index)
    def task():
        with state.lock:
            return collect_edge_network(cat, seconds=data.seconds, max_pages=data.max_pages,
                                        cloud=cloud, start_index=data.start_index)
    try:
        count = await run_in_threadpool(task)
    except Exception as exc:
        raise HTTPException(400, 'تعذّر فحص الوسائط بالمتصفح: '+clean(exc,180)) from None
    next_index = data.start_index + processed
    return {'detected': count, 'processed': processed, 'total': total,
            'next_index': next_index, 'has_more': next_index < total, **get_summary(state)}


class LoginForm(BaseModel):
    email: str = Field(default='', max_length=200)
    password: str = Field(default='', max_length=250)
    access_token: str = Field(default='', max_length=6000)


def local_request(request: Request) -> bool:
    if not request.client or not AUTOSYNC.desktop_mode(): return False
    if request.url.hostname not in ("127.0.0.1", "localhost", "::1"): return False
    try: return ip_address(request.client.host).is_loopback
    except ValueError: return False


@app.post('/api/login')
async def login(request: Request, body: LoginForm):
    state = protected(request)
    if not body.access_token and (not body.email.strip() or not body.password):
        raise HTTPException(400, 'أدخل البريد وكلمة المرور أو رمز جلسة مسؤول صالحًا')
    def task():
        return Supabase(os.getenv('ALEZZ_SUPABASE_URL', DEFAULT_DB_URL),
                        os.getenv('ALEZZ_SUPABASE_PUBLISHABLE_KEY', DEFAULT_PUBLIC_KEY),
                        access_token=body.access_token.strip(),
                        email=body.email.strip(), password=body.password)
    try:
        db = await run_in_threadpool(task)
    except Exception as exc:
        raise HTTPException(401, 'تعذر تسجيل دخول المسؤول: ' + clean(exc, 200)) from None
    with state.lock:
        state.db = db
    if local_request(request): AUTOSYNC.bind_local_session(db)
    return {'ok': True, 'authenticated': True}


@app.post('/api/logout')
async def logout(request: Request):
    state = protected(request)
    with state.lock:
        db=state.db
        state.db = None
    if local_request(request): AUTOSYNC.bind_local_session(db, logout=True)
    return {'ok': True}


class CapturedSource(BaseModel):
    url: str = Field(max_length=2048)
    kind: str = Field(default='media', max_length=16)


class BrowserCaptureForm(BaseModel):
    page: str = Field(max_length=2048)
    series_url: str = Field(default='', max_length=2048)
    season: int | None = Field(default=None, ge=1, le=99)
    episode: int | None = Field(default=None, ge=1, le=999)
    links: list[CapturedSource] = Field(default_factory=list, max_length=150)
    auto_save: bool = False
    background: bool = False


_capture_write_lock = threading.Lock()


def prepare_browser_capture(body: BrowserCaptureForm):
    page = public_url(body.page)
    if body.series_url or body.season is not None or body.episode is not None:
        if not (body.series_url and body.season and body.episode):
            raise ValueError('أدخل رابط صفحة المسلسل ورقم الموسم والحلقة معًا.')
        series_url = public_url(body.series_url)
        if series_url.rstrip('/') == page.rstrip('/'):
            raise ValueError('افتح صفحة تشغيل الحلقة، وضع رابط المسلسل في الحقل المخصص.')
        cat = discover_full(series_url, 'series', deep=False)
        target = next((ep for ep in cat.episodes if (ep.season, ep.number)==(body.season, body.episode)), None)
        if target is None:
            target = Episode(body.season, body.episode, f'الحلقة {body.episode}', page)
        target.page_url = page
        cat.episodes = [target]
    else:
        cat = discover_full(page, deep=False)
        if cat.kind != 'movie':
            raise ValueError('هذه صفحة مسلسل. افتح الحلقة وأدخل رابط المسلسل ورقم الموسم والحلقة في الإضافة.')
        target = cat

    candidates = []
    for item in body.links:
        try:
            url = public_url(item.url)
        except ValueError:
            continue
        candidates.append({'url': url, 'kind': 'embed' if item.kind == 'embed' else 'direct',
                           'label': urlsplit(url).hostname or '', 'page_url': page})
    scan_mode = AUTOSYNC.mode if body.background else 'http' if AUTOSYNC.mode == 'http' else 'headless'
    checked, warnings = MediaResolver(mode=scan_mode).resolve([page], existing=candidates)
    target.sources = checked
    target.source_pages = list(dict.fromkeys([*target.source_pages, page]))
    playable = next((item for item in checked if item.get('verified') and item['kind']=='direct'), None)
    target.media_url = playable['url'] if playable else ''
    target.verified = playable is not None
    return cat, checked, warnings


@app.post('/api/browser-capture')
async def browser_capture(request: Request, body: BrowserCaptureForm):
    state = protected(request)
    if not local_request(request):
        raise HTTPException(403, 'الاستيراد من الإضافة مخصص للاستوديو المحلي.')
    if body.background and (not body.auto_save or state.db is None):
        raise HTTPException(401,'سجّل دخول المسؤول لتفعيل الربط التلقائي.')
    try:
        cat, checked, warnings = await run_in_threadpool(prepare_browser_capture, body)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, safe_error(exc)) from None
    except Exception as exc:
        raise HTTPException(502, safe_error(exc)) from None
    saved = False
    def persist():
        with _capture_write_lock, state.lock:
            if state.db is None:
                return False
            result = store(cat,state.db,publish=False,rights=False,capture_merge=True)
            AUTOSYNC.remember_saved(cat,result,capture=True)
            return True
    if body.auto_save:
        try:
            saved = await run_in_threadpool(persist)
        except Exception as exc:
            raise HTTPException(502,'تعذّر حفظ نتائج الإضافة: '+safe_error(exc)) from None
    capture = {'total':len(checked), 'verified':sum(bool(item.get('verified')) for item in checked),
               'warnings':warnings,'saved':saved,'awaiting_login':body.auto_save and not saved}
    if body.background:
        return {'capture':capture}
    with state.lock:
        state.catalogue = cat
        state.catalogues = [cat]
        state.current_index = 0
        state.demo = False
    return {**get_summary(state), 'capture':capture}


class SaveForm(BaseModel):
    publish: bool = False
    rights_authorized: bool = False
    rights_holder: str = Field(default='', max_length=250)
    license_reference: str = Field(default='', max_length=1000)
    category_id: str = Field(default='', max_length=80)


@app.post('/api/save')
async def save(request: Request, body: SaveForm):
    state = protected(request)
    if state.db is None:
        raise HTTPException(401, 'سجّل الدخول بحساب مسؤول العز TV أولًا')
    if state.demo:
        raise HTTPException(400, 'هذا نموذج تجريبي؛ اكتشف رابطًا حقيقيًا أولًا')
    if body.publish and not body.rights_authorized:
        raise HTTPException(400, 'يلزم تأكيد تصريح العرض قبل النشر العام')
    with state.lock:
        cat = current_catalogue(state)
        if (scan_status(state) or {}).get('running'):
            raise HTTPException(409, 'انتظر انتهاء فحص هذا العمل قبل حفظه.')
    def task():
        with state.lock:
            db = state.db
            category_id = body.category_id
            if not category_id and cat.genres:
                try:
                    cats = db.query('aseel_categories', {'select':'id,name_ar','published':'eq.true','limit':'250'})
                    category_id = category_for_genres(cats, cat.genres)
                except Exception:
                    pass
            result=store(cat, db, publish=body.publish, rights=body.rights_authorized,
                         license_holder=clean(body.rights_holder,250),
                         license_reference=clean(body.license_reference,1000), category_id=category_id)
            AUTOSYNC.remember_saved(cat,result)
            return result
    try:
        result = await run_in_threadpool(task)
    except Exception as exc:
        raise HTTPException(400, 'تعذر حفظ العمل: ' + clean(exc, 240)) from None
    return {'ok': True, 'result': result}


@app.post('/api/save-batch')
async def save_batch(request:Request,body:SaveForm):
    state=protected(request)
    if state.db is None:raise HTTPException(401,'سجّل الدخول بحساب مسؤول العز TV أولًا')
    if state.demo:raise HTTPException(400,'النموذج التجريبي ليس قابلًا للحفظ')
    if body.publish and not body.rights_authorized:
        raise HTTPException(400,'يلزم توثيق إذن العرض قبل النشر العام')
    def task():
        with state.lock:
            works=list(state.catalogues)
            db=state.db
            if not works:raise ValueError('لا توجد أعمال جاهزة للحفظ')
            try:
                categories=db.query('aseel_categories',{'select':'id,name_ar','published':'eq.true','limit':'250'})
            except Exception:categories=[]
            totals={'works_new':0,'works_updated':0,'seasons_new':0,'episodes_new':0,'episodes_updated':0,'media_verified':0,'metadata_only':0}
            details=[]
            for index,cat in enumerate(works):
                try:
                    category=body.category_id or category_for_genres(categories,cat.genres)
                    result=store(cat,db,publish=body.publish,rights=body.rights_authorized,
                                 license_holder=clean(body.rights_holder,250),
                                 license_reference=clean(body.license_reference,1000),category_id=category)
                    AUTOSYNC.remember_saved(cat,result)
                    details.append({'index':index,'title':cat.title,'ok':True,'result':result})
                    for key in totals:totals[key]+=int(result.get(key,0))
                except Exception as exc:
                    details.append({'index':index,'title':cat.title,'ok':False,'error':clean(exc,200)})
            return {'totals':totals,'details':details,'ok_count':sum(x['ok'] for x in details),
                    'error_count':sum(not x['ok'] for x in details)}
    result=await run_in_threadpool(task)
    return {'ok':result['ok_count']>0, **result}


@app.post('/api/library-save')
async def library_save(request:Request,body:SaveForm):
    state=protected(request)
    if not state.db:raise HTTPException(401,'سجّل دخول المسؤول أولًا')
    if body.publish and not body.rights_authorized:
        raise HTTPException(400,'النشر العام يحتاج إذن عرض؛ يمكن حفظ البيانات مسودات')
    def save_chunk():
        with state.lock:
            db=state.db
            try:categories=db.query('aseel_categories',{'select':'id,name_ar','published':'eq.true','limit':'250'})
            except Exception:categories=[]
            rows=LIBRARY.unsaved(limit=8)
            details=[]
            for row in rows:
                try:
                    raw=json.loads(row['payload'])
                    eps=[Episode(**e) for e in raw.pop('episodes',[])]
                    cat=Catalogue(**raw,episodes=eps)
                    category=body.category_id or category_for_genres(categories,cat.genres)
                    result=store(cat,db,publish=body.publish,rights=body.rights_authorized,
                                 license_holder=clean(body.rights_holder,250),
                                 license_reference=clean(body.license_reference,1000),category_id=category)
                    AUTOSYNC.remember_saved(cat,result)
                    LIBRARY.mark_saved(row['url'])
                    details.append({'url':row['url'],'ok':True,'result':result})
                except Exception as exc:
                    LIBRARY.mark_saved(row['url'],clean(exc,200))
                    details.append({'url':row['url'],'ok':False,'error':clean(exc,200)})
            return {'results':details,'attempted':len(details),'remaining':len(LIBRARY.unsaved(limit=1))>0}
    result=await run_in_threadpool(save_chunk)
    return {'ok':True,**result}


@app.get('/api/series-review')
async def series_review(request:Request,q:str=''):
    find_state(request)
    term=q.strip()[:100]
    saved=AUTOSYNC.queue.targets(150,0,term,'aseel_series')
    rows=[{'origin':'supabase','id':r['target_id'],'title':r['title'],
           'url':r['page_url'],'status':r['status'],'last_check':r['last_check'],
           'sources':r['source_count'],'verified':r['valid_sources'],
           'error':r['error']} for r in saved]
    return JSONResponse({'saved':rows,'imported':LIBRARY.series_items(150,term),
                         'running':bool(_library_worker and _library_worker.is_alive())},
                         headers={'Cache-Control':'private, no-store'})


class SeriesReviewAction(BaseModel):
    origin:str=Field(max_length=20)
    id:str=Field(min_length=1,max_length=2048)
    action:str=Field(default='refresh',max_length=20)
    start:int=Field(default=0,ge=0,le=5000)


@app.post('/api/series-review/recheck')
async def series_review_recheck(request:Request,body:SeriesReviewAction):
    protected(request)
    if body.origin=='supabase':
        table,identifier=target_key('aseel_series',body.id)
        with AUTOSYNC.queue.db() as conn:
            row=conn.execute('select 1 from auto_jobs where table_name=? and target_id=?',(table,identifier)).fetchone()
        if not row:raise HTTPException(404,'المسلسل غير مسجل في المزامنة.')
        AUTOSYNC.queue.queue(table,identifier,refresh=True)
        AUTOSYNC.wake_event.set()
        return {'ok':True,'message':'أُضيف المسلسل لطابور تجديد صفحات المصادر وروابط الفيديو.'}
    if body.origin=='library' and body.action=='refresh':
        try:exists=LIBRARY.retry_work(body.id)
        except ValueError:raise HTTPException(400,'رابط المصدر غير صحيح') from None
        if not exists:raise HTTPException(404,'العمل غير موجود في قائمة الاستيراد.')
        _start_library_worker()
        return {'ok':True,'message':'أُعيدت جدولة اكتشاف المواسم والحلقات من المصدر.'}
    if body.origin=='library' and body.action=='verify':
        try:row=LIBRARY.get_work(body.id)
        except ValueError:raise HTTPException(400,'رابط المصدر غير صحيح') from None
        if not row:raise HTTPException(409,'اكتشاف المسلسل لم ينته بعد.')
        try:
            data=json.loads(row['payload'])
            eps=[Episode(**e) for e in data.pop('episodes',[])]
            cat=Catalogue(**data,episodes=eps)
        except (ValueError,TypeError,KeyError):
            raise HTTPException(422,'بيانات المسلسل غير مكتملة.') from None
        if cat.kind!='series':raise HTTPException(400,'هذا العنصر ليس مسلسلًا.')
        subset=cat.episodes[body.start:body.start+4]
        if not subset:raise HTTPException(400,'لا توجد حلقات في هذا النطاق.')
        def work():
            client=SourceClient(timeout=12)
            try:
                inspect_episodes(Catalogue(kind='series',title=cat.title,url=cat.url,episodes=subset),client,delay=0)
            finally:
                client.session.close()
            LIBRARY.replace_work_payload(body.id,json.dumps(asdict(cat),ensure_ascii=False))
            return sum(bool(ep.verified) for ep in subset)
        try:good=await run_in_threadpool(work)
        except Exception as exc:raise HTTPException(502,'تعذر فحص الفيديو: '+safe_error(exc)) from None
        return {'ok':True,'checked':len(subset),'verified':good,
                'next_start':body.start+len(subset),'total':len(cat.episodes)}
    raise HTTPException(400,'طلب غير مدعوم.')


@app.get('/api/series-review/details')
async def series_review_details(request:Request,origin:str,id:str):
    find_state(request)
    if origin=='supabase':
        table,identifier=target_key('aseel_series',id)
        sources=AUTOSYNC.queue.sources(table,identifier)
        return {'sources':[{'url':s['url'],'kind':s['kind'],'status':s['status'],
                            'last_checked_at':s['last_checked_at'],'error':s['error']} for s in sources[:100]]}
    if origin=='library':
        try:row=LIBRARY.get_work(id)
        except ValueError:raise HTTPException(400,'رابط المصدر غير صحيح') from None
        if not row:raise HTTPException(404,'لم يكتمل استيراد هذا المسلسل.')
        eps=json.loads(row['payload']).get('episodes',[])
        return {'episodes':[{'season':e.get('season'),'number':e.get('number'),
            'title':e.get('title'),'verified':e.get('verified',False),
            'media_url':e.get('media_url') or '', 'error':e.get('error') or ''} for e in eps[:500]]}
    raise HTTPException(400,'مصدر غير معروف.')


@app.get('/api/categories')
async def categories(request: Request):
    _, state = find_state(request)
    if state.db is None:
        raise HTTPException(401, 'سجّل دخول المسؤول أولًا')
    try:
        result = await run_in_threadpool(lambda: state.db.query('aseel_categories',
                                      {'select': 'id,name_ar', 'published':'eq.true', 'limit':'250'}))
    except Exception as exc:
        raise HTTPException(400, clean(exc, 160)) from None
    return {'categories': result}


@app.get('/api/export')
async def export(request: Request):
    _, state = find_state(request)
    cat = current_catalogue(state)
    data = json.dumps(asdict(cat), ensure_ascii=False, indent=2).encode('utf-8')
    return Response(content=data, media_type='application/json; charset=utf-8',
                    headers={'Content-Disposition':'attachment; filename="alezz-preview.json"',
                             'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'})


@app.get('/api/export-batch')
async def export_batch(request:Request):
    _,state=find_state(request)
    with state.lock:
        values=[asdict(cat) for cat in state.catalogues]
    blob=json.dumps({'works':values},ensure_ascii=False,indent=2).encode('utf-8')
    return Response(content=blob,media_type='application/json; charset=utf-8',
                    headers={'Content-Disposition':'attachment; filename="alezz-all-works.json"',
                             'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})


@app.get('/api/health')
async def health():
    return {'ok':True, 'service':'Al Ezz TV Python Web Importer', 'time':datetime.now(timezone.utc).isoformat()}


@app.get('/api/autosync/status')
async def autosync_status(request:Request):
    _, state = find_state(request)
    return JSONResponse({**AUTOSYNC.status(),'session_authenticated':state.db is not None},
                        headers={'Cache-Control':'no-store'})


class AutoSyncControl(BaseModel):
    action:str=Field(max_length=30)

def bind_autosync_request(request: Request, state: UserState):
    if local_request(request) and not AUTOSYNC.has_server_key():
        with state.lock:
            if state.db is None:
                raise HTTPException(401,'سجّل دخول مسؤول Supabase في الاستوديو المحلي لتشغيل الفحص.')
            AUTOSYNC.bind_local_session(state.db)

@app.post('/api/autosync/control')
async def autosync_control(request:Request,body:AutoSyncControl):
    state = protected(request)
    bind_autosync_request(request,state)
    try: AUTOSYNC.control(body.action)
    except ValueError as exc: raise HTTPException(400,str(exc)) from None
    return {'ok':True,**AUTOSYNC.status()}


@app.get('/api/autosync/targets')
async def autosync_targets(request:Request,limit:int=50,offset:int=0,q:str='',scope:str=''):
    find_state(request)
    scopes={'':'','movies':'aseel_movies','series':'aseel_series','episodes':'aseel_episodes'}
    if scope not in scopes: raise HTTPException(400,'قسم غير معروف')
    rows=AUTOSYNC.queue.targets(max(1,min(limit,100)),max(0,offset),q[:250],scopes[scope])
    # Source metadata is returned separately; do not duplicate saved row payloads.
    fields=('table_name','target_id','title','page_url','status','last_check','next_check','error','source_count','valid_sources')
    targets=[{k:row[k] for k in fields} for row in rows]
    now = time.time()
    for item,row in zip(targets,rows):
        if min(row['next_check'],row['next_refresh'])<=now:
            item['scan_state']='checking' if row['lease_until']>now else 'pending'
        if item['table_name']=='aseel_series':
            item['auto_publish']=AUTOSYNC.queue.get_setting('publish-series:'+item['target_id'],False)
    return {'targets':targets}


@app.get('/api/autosync/sources')
async def autosync_sources(request:Request,table:str,id:str):
    find_state(request)
    try: rows=AUTOSYNC.queue.sources(*target_key(table,id))
    except ValueError as exc: raise HTTPException(400,str(exc)) from None
    return {'sources':rows}


@app.get('/api/autosync/events')
async def autosync_events(request:Request,limit:int=50):
    find_state(request)
    with AUTOSYNC.queue.db() as conn:
        events=[dict(r) for r in conn.execute('select * from auto_events order by id desc limit ?', (max(1,min(limit,200)),))]
    return {'events':events}


class AutoSyncTargetForm(BaseModel):
    table:str=Field(max_length=30)
    id:str=Field(max_length=36)
    action:str=Field(max_length=20)
    url:str=Field(default='',max_length=2048)
    rights_authorized: bool = False


@app.post('/api/autosync/target')
async def autosync_target(request:Request,body:AutoSyncTargetForm):
    state=protected(request)
    bind_autosync_request(request,state)
    try:
        table,identifier=target_key(body.table,body.id)
        with AUTOSYNC.queue.db() as conn:
            row=conn.execute('select * from auto_jobs where table_name=? and target_id=?',(table,identifier)).fetchone()
            if not row:raise HTTPException(404,'لم تتم مزامنة العنصر من Supabase بعد')
            job=dict(row)
        if body.action in ('publish-enable','publish-disable'):
            if table!='aseel_series': raise ValueError('النشر التلقائي للحلقات يضبط من المسلسل.')
            if state.db is None: raise HTTPException(401,'سجّل دخول مسؤول Supabase أولًا.')
            enable=body.action=='publish-enable'
            if enable:
                if not body.rights_authorized: raise ValueError('أكد تصريح نشر الحلقات الجديدة.')
                series=await run_in_threadpool(state.db.single,table,{'id':'eq.'+identifier,'select':'status,rights_status'})
                if not series or series.get('status')!='published' or series.get('rights_status')!='approved':
                    raise ValueError('انشر المسلسل ووافق على حقوق عرضه أولًا.')
            AUTOSYNC.queue.setting('publish-series:'+identifier,enable)
            AUTOSYNC.queue.event('auto_publish','تفعيل نشر الحلقات المفحوصة' if enable else 'إيقاف نشر الحلقات تلقائيًا',table,identifier)
        elif body.action=='sources':
            url=public_url(body.url.strip())
            AUTOSYNC.queue.remember(table,identifier,dict(url=url,kind='original'))
            # Save the first original page, keeping all additional pages in history.
            def persist():
                if local_request(request) and not AUTOSYNC.has_server_key():
                    db=state.db
                    if db is None: raise ValueError('سجّل دخول مسؤول Supabase أولًا')
                else:
                    db=AUTOSYNC.db or AUTOSYNC.db_factory()
                if not job['page_url']:
                    db.patch(table,identifier,{'source_page_url':url})
                    AUTOSYNC.queue.update(table,identifier,page_url=url)
                AUTOSYNC.flush(job, db=db)
            await run_in_threadpool(persist)
            AUTOSYNC.queue.event('source_added','حُفظ مصدر أصلي إضافي لهذا العنصر',table,identifier)
            AUTOSYNC.queue.queue(table,identifier,refresh=True)
        elif body.action in ('check','refresh'):
            AUTOSYNC.queue.queue(table,identifier,refresh=body.action=='refresh')
        else:raise ValueError('أمر غير معروف')
        AUTOSYNC.wake_event.set()
    except ValueError as exc:raise HTTPException(400,clean(exc,180)) from None
    return {'ok':True}


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=int(os.getenv('ALEZZ_PORT','8765')),
                log_level='warning', access_log=False, proxy_headers=False)
