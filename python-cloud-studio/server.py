#!/usr/bin/env python3
"""Al Ezz TV FastAPI metadata-import studio, local or private cloud.

Cloud mode requires a protected login and persistent disk. The FetchV browser
extension is local-only; server can ingest URLs copied from it.
"""
from __future__ import annotations

import asyncio
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
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from alezz_fetchv_importer import (
    Catalogue, Episode, MEDIA_EXT, SourceClient, Supabase, category_for_genres,
    hydrate_episode_metadata,
    collect_edge_network,
    clean, inspect_episodes, public_url, pull_html, store,
)

from metadata_enrichment import enrich
from library_sync import JobDB,collect_pages,collect_works
from cloud_auth import site_auth_middleware, site_login, site_logout, site_health

BASE = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("ALEZZ_DATA_DIR", str(BASE))).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
LIBRARY = JobDB(DATA_DIR / "library_sync.sqlite3")
LIBRARY.recover()
_library_lock = threading.RLock()
_library_worker = None
DEFAULT_DB_URL = 'https://qyzmlwtvzzgooccqxglq.supabase.co'
DEFAULT_PUBLIC_KEY = 'sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES'
COOKIE = 'alezz_studio_session'
EXPIRY_SECONDS = 8 * 3600
MAX_STATES = 50

app = FastAPI(title='Al Ezz TV | Python Import Studio', docs_url=None, redoc_url=None,
              openapi_url=None)
app.mount('/static', StaticFiles(directory=str(BASE / 'static')), name='static')
app.middleware('http')(site_auth_middleware)
app.add_api_route('/login', site_login, methods=['GET', 'POST'], include_in_schema=False)
app.add_api_route('/logout-site', site_logout, methods=['POST'], include_in_schema=False)
app.add_api_route('/healthz', site_health, methods=['GET'], include_in_schema=False)


@dataclass
class UserState:
    csrf: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    catalogue: Catalogue | None = None
    catalogues: list[Catalogue] = field(default_factory=list)
    batch_errors: list[dict] = field(default_factory=list)
    current_index: int = 0
    db: Supabase | None = None
    demo: bool = False
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


def get_summary(state: UserState) -> dict:
    with state.lock:
        cat = state.catalogue
        n = len(cat.episodes) if cat and cat.kind == 'series' else (1 if cat else 0)
        good = (sum(x.verified for x in cat.episodes) if cat.kind == 'series' else int(cat.verified)) if cat else 0
        return dict(catalogue=asdict(cat) if cat else None, authenticated=state.db is not None,
                    demo=state.demo, count=n, verified=good,
                    batch=[dict(index=i,title=c.title,kind=c.kind,episodes=len(c.episodes),
                                year=c.year,poster_url=c.poster_url,original_title=c.original_title,
                                verified=sum(ep.verified for ep in c.episodes) if c.kind=='series' else int(c.verified))
                           for i,c in enumerate(state.catalogues)],
                    batch_errors=state.batch_errors[:25],current_index=state.current_index)


@app.get('/')
async def homepage():
    return FileResponse(BASE / 'templates' / 'index.html', headers={'Cache-Control': 'no-store'})


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


def discover_full(source: str, kind: str='auto', deep: bool=True, enrich_metadata: bool=True,
                  resume_progress:dict|None=None,progress_hook=None) -> Catalogue:
    cat=pull_html(public_url(source),SourceClient(timeout=11),kind,max_seasons=500,
                  max_episodes=5000,max_pages=500,resume_progress=resume_progress,progress_hook=progress_hook)
    if kind!='auto':cat.kind=kind
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


class DiscoverForm(BaseModel):
    url: str = Field(min_length=12, max_length=2048)
    kind: str = 'auto'
    deep: bool = True
    metadata: bool = True


@app.post('/api/discover')
async def discover(request: Request, data: DiscoverForm):
    state = protected(request)
    if data.kind not in ('auto', 'movie', 'series'):
        raise HTTPException(400, 'نوع العمل غير مدعوم')
    try:
        source = public_url(data.url)
        cat = await run_in_threadpool(lambda: discover_full(source, data.kind, deep=data.deep, enrich_metadata=data.metadata))
        with state.lock:
            state.catalogue, state.catalogues, state.batch_errors = cat, [cat], []
            state.current_index, state.demo = 0, False
        return get_summary(state)
    except Exception as exc:
        raise HTTPException(400, 'تعذر اكتشاف المصدر: ' + clean(exc, 180)) from None


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
                    if not MEDIA_EXT.search(url):
                        raise ValueError('رابط الفيديو ليس MP4/HLS/WebM')
                    cat.media_url, cat.verified = url, False
                    count += 1
                    continue
                if '|' not in line:
                    raise ValueError('المطلوب S01E01|https://...')
                label, url = line.split('|', 1)
                from alezz_fetchv_importer import episode_numbers
                numbers = episode_numbers(label.strip())
                url = public_url(url.strip())
                if not numbers or not MEDIA_EXT.search(url):
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
            if value and not MEDIA_EXT.search(value):
                raise HTTPException(400, 'رابط الفيلم يجب أن يكون MP4 أو HLS أو WebM')
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
                    if value and not MEDIA_EXT.search(value):
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
    if cat.kind == 'movie':
        inspect_episodes(cat, SourceClient(timeout=12), delay=0)
        return int(cat.verified)
    targets = [(i, cat.episodes[i]) for i in dict.fromkeys(indices) if 0 <= i < len(cat.episodes)]
    def inspect(item: Episode):
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
    max_pages: int = Field(default=8, ge=1, le=12)


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
    def task():
        with state.lock:
            return collect_edge_network(cat, seconds=data.seconds, max_pages=data.max_pages, cloud=cloud)
    try:
        count = await run_in_threadpool(task)
    except Exception as exc:
        raise HTTPException(400, 'تعذّر فحص الوسائط بالمتصفح: '+clean(exc,180)) from None
    return {'detected':count, **get_summary(state)}


class LoginForm(BaseModel):
    email: str = Field(default='', max_length=200)
    password: str = Field(default='', max_length=250)
    access_token: str = Field(default='', max_length=6000)


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
    return {'ok': True, 'authenticated': True}


@app.post('/api/logout')
async def logout(request: Request):
    state = protected(request)
    with state.lock:
        state.db = None
    return {'ok': True}


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
    cat = current_catalogue(state)
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
            return store(cat, db, publish=body.publish, rights=body.rights_authorized,
                         license_holder=clean(body.rights_holder,250),
                         license_reference=clean(body.license_reference,1000), category_id=category_id)
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
                    LIBRARY.mark_saved(row['url'])
                    details.append({'url':row['url'],'ok':True,'result':result})
                except Exception as exc:
                    LIBRARY.mark_saved(row['url'],clean(exc,200))
                    details.append({'url':row['url'],'ok':False,'error':clean(exc,200)})
            return {'results':details,'attempted':len(details),'remaining':len(LIBRARY.unsaved(limit=1))>0}
    result=await run_in_threadpool(save_chunk)
    return {'ok':True,**result}


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


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=int(os.getenv('ALEZZ_PORT','8765')),
                log_level='warning', access_log=False)
