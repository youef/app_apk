"""Enrich a user-provided public movie/series listing with *metadata only*.

TVmaze is used for an exact / high-confidence Latin show match (no key needed).
TMDB is optional via ALEZZ_TMDB_API_KEY; metadata services are never video hosts.
Never infer distribution rights or turn a catalogued episode into playable media.
"""
from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
import os
import re
from html import unescape
from typing import Callable

import requests

from alezz_fetchv_importer import Catalogue, Episode, clean, public_url
from title_cleaner import content_title

TMDB_API = 'https://api.themoviedb.org/3'
TVMAZE_API = 'https://api.tvmaze.com'
TMDB_IMAGE = 'https://image.tmdb.org/t/p/'
GENRES = {
    'action': 'action', 'adventure': 'adventure', 'animation': 'animation', 'anime':'anime',
    'comedy': 'comedy', 'crime': 'crime', 'drama':'drama', 'family':'family',
    'fantasy':'fantasy', 'history':'history', 'horror':'horror', 'mystery':'mystery',
    'romance':'romance', 'science-fiction':'scifi', 'science fiction':'scifi',
    'sci-fi & fantasy':'scifi', 'thriller':'thriller', 'war':'war',
    'documentary':'documentary', 'western':'western', 'kids':'kids',
    'reality':'reality', 'action & adventure':'action', 'soap':'drama',
    'أكشن':'action','دراما':'drama','كوميديا':'comedy','رومانسي':'romance','رومانسية':'romance',
}
LANGUAGES={'english':'en','turkish':'tr','arabic':'ar','korean':'ko','hindi':'hi',
           'japanese':'ja','spanish':'es','french':'fr','german':'de','chinese':'zh',
           'portuguese':'pt','italian':'it'}


def norm(s: str) -> str:
    s=unescape(str(s or '')).casefold()
    s=re.sub(r'\s*(?:\||[-–—])\s*(?:موقع\s*)?(?:قرمزي|qrmzi|مشاهدة|watch online|الحلقات كاملة).*$', '',s)
    s=re.sub(r'[^\w\u0600-\u06ff]+',' ',s,flags=re.UNICODE)
    s=re.sub(r'\b(?:مسلسل|فيلم|the|tv|series)\b',' ',s)
    return ' '.join(s.split())


def confidence(cat: Catalogue, names: list[str], year: int | None) -> float:
    queries=[norm(cat.title), norm(cat.original_title)]
    matched=max((SequenceMatcher(None,a,b).ratio() for a in queries for b in map(norm,names)
                 if a and b),default=0)
    if cat.year and year and abs(cat.year-year)>1:
        return matched*.45
    return matched


def get_json(base: str, path: str, params: dict | None=None,
             requester: Callable | None=None):
    """Only calls fixed, trusted metadata API hosts (not links returned by a site)."""
    session = requester or requests.get
    try:
        response=session(base+path,params=params or {},timeout=8,
                         headers={'User-Agent':'AlEzzTV-MetadataStudio/2.1','Accept':'application/json'})
        if response.status_code in (400,401,403,404,429):return None
        response.raise_for_status()
        if len(response.content)>2_000_000:return None
        return response.json()
    except (requests.RequestException,ValueError,TypeError):return None


def year_of(value) -> int|None:
    match=re.search(r'(?:19|20)\d{2}',str(value or ''))
    return int(match.group()) if match else None


def add_genres(cat, labels):
    x=list(cat.genres)
    for g in labels:
        if not isinstance(g,str):continue
        key=GENRES.get(g.strip().casefold(), g.strip().casefold().replace(' ','_'))
        if key and key not in x and re.fullmatch(r'[a-z_&-]{2,35}',key):x.append(key)
    cat.genres=x[:12]


def fill(cat: Catalogue, *, original='', year=None, country='', language='', poster='',
         backdrop='', description='', genres=()):
    if not cat.original_title and original and norm(original)!=norm(cat.title):cat.original_title=clean(original,250)
    if cat.year is None and isinstance(year,int) and 1880<=year<=2100:cat.year=year
    if not cat.country and re.fullmatch(r'[a-zA-Z]{2}',country or ''):cat.country=country.upper()
    if not cat.language and re.fullmatch(r'[a-zA-Z]{2,3}',language or ''):cat.language=language.lower()
    for attr,value in [('poster_url',poster),('backdrop_url',backdrop)]:
        placeholder = attr=='backdrop_url' and cat.backdrop_url==cat.poster_url
        if (not getattr(cat,attr) or placeholder) and value:
            try:setattr(cat,attr,public_url(value))
            except ValueError:pass
    if not cat.description and description:cat.description=clean(description,1800)
    add_genres(cat,genres)


def add_episodes_from_metadata(cat:Catalogue, episodes:list[dict], max_episodes=150):
    """Supplement missing episode entries; never invent a playable stream URL."""
    existing={(e.season,e.number):e for e in cat.episodes}
    for entry in episodes:
        try:
            sn, en=int(entry.get('season') or 0),int(entry.get('number') or 0)
        except (TypeError,ValueError):continue
        if not (1<=sn<=100 and 1<=en<=1000):continue
        key=(sn,en)
        title=clean(entry.get('title'),250)
        desc=clean(entry.get('description'),1400)
        pic=entry.get('poster') or ''
        if key in existing:
            ep=existing[key]
            if not ep.description and desc:ep.description=desc
            if not ep.poster_url and pic:
                try:ep.poster_url=public_url(pic)
                except ValueError:pass
            if (not ep.title or ep.title==f'الحلقة {en}') and title:ep.title=title
        elif len(cat.episodes)<max_episodes:
            # Entry is cataloguing metadata from a trusted provider, not a watch URL.
            ep=Episode(sn,en,title or f'الحلقة {en}',cat.url,description=desc)
            if pic:
                try:ep.poster_url=public_url(pic)
                except ValueError:pass
            cat.episodes.append(ep)
            existing[key]=ep
    cat.episodes.sort(key=lambda e:(e.season,e.number))


def tvmaze(cat:Catalogue,*, requester=None, episodes=True) -> str:
    if cat.kind!='series':return ''
    query=cat.original_title or cat.title
    # Transliteration guessed by machine is intentionally not used as a match.
    if not re.search(r'[a-zA-Z]{3}',query):return ''
    results=get_json(TVMAZE_API,'/search/shows',{'q':query},requester)
    if not isinstance(results,list):return ''
    ranked=[]
    for hit in results[:7]:
        show=hit.get('show') or {}
        score=confidence(cat,[show.get('name','')],year_of(show.get('premiered')))
        if score>=.88:ranked.append((score,show))
    if not ranked:return ''
    ranked.sort(key=lambda pair:pair[0],reverse=True)
    show=ranked[0][1]
    image=show.get('image') or {}
    network=show.get('network') or show.get('webChannel') or {}
    country=(network.get('country') or {}).get('code','')
    summary=re.sub(r'<[^>]+>',' ',show.get('summary') or '')
    fill(cat,original=show.get('name',''),year=year_of(show.get('premiered')),
         country=country,language=LANGUAGES.get((show.get('language') or '').lower(),''),
         poster=image.get('original') or image.get('medium') or '',description=summary,
         genres=show.get('genres') or [])
    if episodes and isinstance(show.get('id'),int):
        details=get_json(TVMAZE_API,f'/shows/{show["id"]}/episodes',requester=requester)
        if isinstance(details,list):
            rows=[]
            for ep in details[:600]:
                img=ep.get('image') or {}
                rows.append(dict(season=ep.get('season'),number=ep.get('number'),
                                 title=ep.get('name'),description=re.sub(r'<[^>]+>',' ',ep.get('summary') or ''),
                                 poster=img.get('original') or img.get('medium')))
            add_episodes_from_metadata(cat,rows)
    return 'TVmaze'


def tmdb(cat:Catalogue,*, requester=None,episodes=True,api_key='') -> str:
    api_key=api_key or os.getenv('ALEZZ_TMDB_API_KEY','').strip()
    if not api_key:return ''
    is_series=cat.kind=='series'
    kind='tv' if is_series else 'movie'
    search=get_json(TMDB_API,'/search/'+kind,
                    {'api_key':api_key,'query':cat.original_title or cat.title,'language':'ar-SA','include_adult':'false'},requester)
    if not isinstance(search,dict):return ''
    candidates=[]
    for work in (search.get('results') or [])[:12]:
        name=work.get('name') or work.get('title') or ''
        original=work.get('original_name') or work.get('original_title') or ''
        y=year_of(work.get('first_air_date') or work.get('release_date'))
        score=confidence(cat,[name,original],y)
        if score>=.87:candidates.append((score,work))
    if not candidates:return ''
    candidates.sort(key=lambda x:x[0],reverse=True)
    row=candidates[0][1]
    ident=row.get('id')
    if not isinstance(ident,int):return ''
    detail=get_json(TMDB_API,f'/{kind}/{ident}',{'api_key':api_key,'language':'ar-SA'},requester) or row
    poster=detail.get('poster_path') or row.get('poster_path')
    backdrop=detail.get('backdrop_path') or row.get('backdrop_path')
    original=detail.get('original_name') or detail.get('original_title') or ''
    dates=detail.get('first_air_date') or detail.get('release_date') or ''
    countries=detail.get('origin_country') or detail.get('production_countries') or []
    country=countries[0] if countries and isinstance(countries[0],str) else (countries[0].get('iso_3166_1','') if countries else '')
    fill(cat,original=original,year=year_of(dates),country=country,
         language=detail.get('original_language') or '',
         poster=TMDB_IMAGE+'w780'+poster if poster else '',
         backdrop=TMDB_IMAGE+'w1280'+backdrop if backdrop else '',
         description=detail.get('overview') or '',
         genres=[g.get('name','') for g in (detail.get('genres') or [])])
    if episodes and is_series:
        num_seasons=min(int(detail.get('number_of_seasons') or 0),35)
        seasons=[x.get('season_number') for x in detail.get('seasons') or []]
        if not seasons:seasons=list(range(1,num_seasons+1))
        rows=[]
        for sn in seasons[:20]:
            if not isinstance(sn,int) or sn<=0:continue
            season=get_json(TMDB_API,f'/tv/{ident}/season/{sn}',
                            {'api_key':api_key,'language':'ar-SA'},requester)
            for ep in (season or {}).get('episodes') or []:
                still=ep.get('still_path')
                rows.append(dict(season=sn,number=ep.get('episode_number'),title=ep.get('name'),
                                 description=ep.get('overview'),
                                 poster=TMDB_IMAGE+'w500'+still if still else ''))
                if len(rows)>=150:break
            if len(rows)>=150:break
        add_episodes_from_metadata(cat,rows)
    return 'TMDB'


def missing_metadata(cat):
    return (not cat.poster_url or not cat.backdrop_url or cat.backdrop_url==cat.poster_url or
            not cat.description or not cat.original_title or not cat.year or
            not cat.country or not cat.language or not cat.genres)


def google(cat:Catalogue, *, requester=None) -> str:
    """Optional existing Google CSE account; use matched result metadata only.

    CSE is closed to new customers and is scheduled to end January 1, 2027.
    No anonymous scraping or fabricated API key is used when it is unavailable.
    """
    key=os.getenv('ALEZZ_GOOGLE_API_KEY','').strip()
    engine=os.getenv('ALEZZ_GOOGLE_SEARCH_ENGINE_ID','').strip()
    if not key or not engine:return ''
    query=' '.join(filter(None,[cat.original_title or cat.title,str(cat.year or ''),
                               'مسلسل' if cat.kind=='series' else 'فيلم']))
    response=get_json('https://customsearch.googleapis.com','/customsearch/v1',
                      {'key':key,'cx':engine,'q':query,'num':5,'safe':'active'},requester)
    if not isinstance(response,dict):return ''
    candidates=[]
    for item in (response.get('items') or [])[:5]:
        if not isinstance(item,dict):continue
        pagemap=item.get('pagemap') or {}
        metadata=next(iter(pagemap.get('metatags') or []),{})
        works=pagemap.get('tvseries' if cat.kind=='series' else 'movie') or []
        work=next(iter(works),{})
        names=[work.get('name',''),metadata.get('og:title',''),item.get('title','')]
        names=[content_title(name,cat.url) for name in names if isinstance(name,str)]
        year=year_of(work.get('datepublished') or metadata.get('video:release_date'))
        score=confidence(cat,names,year)
        if score<.9:continue
        # Exclude trailers, episode pages and contradictory work types.
        kind=str(metadata.get('og:type','')).lower()
        if cat.kind=='movie' and ('episode' in kind or 'tv_show' in kind):continue
        if cat.kind=='series' and 'movie' in kind:continue
        try: public_url(item.get('link',''))
        except ValueError:continue
        candidates.append((score,item,work,metadata,year))
    if not candidates:return ''
    _,item,work,metadata,year=max(candidates,key=lambda row:row[0])
    fill(cat,original=work.get('alternatename') or metadata.get('original_title',''),year=year,
         poster=work.get('image') or metadata.get('og:image') or '',
         backdrop=metadata.get('og:image:secure_url') or '',
         description=work.get('description') or metadata.get('og:description') or metadata.get('description') or '',
         country=work.get('countryoforigin') or '',language=work.get('inlanguage') or '',
         genres=[work['genre']] if isinstance(work.get('genre'),str) else [])
    # Full-size image URLs only, with explicit dimensions. Never use Google's
    # tiny cached thumbnails as a poster or use an unrelated wide image.
    for attr,term,portrait in [('poster_url','poster',True),('backdrop_url','backdrop',False)]:
        if getattr(cat,attr) and not (attr=='backdrop_url' and cat.backdrop_url==cat.poster_url):continue
        images=get_json('https://customsearch.googleapis.com','/customsearch/v1',
                        {'key':key,'cx':engine,'q':query+' '+term,'exactTerms':cat.original_title or cat.title,
                         'searchType':'image','imgSize':'large','num':3,'safe':'active'},requester)
        if not isinstance(images,dict):continue
        for image in (images.get('items') or [])[:3]:
            size=image.get('image') or {}
            try:
                width,height=int(size.get('width') or 0),int(size.get('height') or 0)
                if min(width,height)<350 or (width<height)!=portrait:continue
                if confidence(cat,[image.get('title','')],None)<.75:continue
                setattr(cat,attr,public_url(image.get('link','')))
                break
            except (TypeError,ValueError):continue
    return 'Google Search: '+item['link']


def enrich(cat:Catalogue,*, requester=None, include_episodes=True) -> dict:
    """Enrichment is best effort; source data is retained on errors or ambiguous matches."""
    sources=[]
    try:
        name=tmdb(cat,requester=requester,episodes=include_episodes)
        if name:sources.append(name)
    except Exception:pass
    if cat.kind=='series' and (not cat.original_title or not cat.poster_url or not cat.episodes or
                              not cat.year or not cat.country or not cat.language or not cat.genres):
        try:
            name=tvmaze(cat,requester=requester,episodes=include_episodes)
            if name:sources.append(name)
        except Exception:pass
    if missing_metadata(cat):
        try:
            name=google(cat,requester=requester)
            if name:sources.append(name)
        except Exception:pass
    cat.metadata_sources=list(dict.fromkeys(cat.metadata_sources+sources))
    return {'sources':sources,'episodes':len(cat.episodes),'original_title':cat.original_title,
            'year':cat.year,'country':cat.country,'language':cat.language}
