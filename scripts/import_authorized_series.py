#!/usr/bin/env python3
"""Import a licensed JSON series catalog into Al Ezz TV as drafts only.

No web crawling, video discovery, DRM handling, rights validation, or publishing.
This accepts a manifest supplied by an authorized source.
"""
import argparse
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ALLOWED_COUNTRIES = {'SA','EG','SY','KW','AE','JO','LB','IQ','BH','OM','QA','MA','DZ','TN','TR','US','GB','IN','KR','JP','CN','FR','DE','ES'}

def https(value, field):
    if value in (None, ''): return None
    if not isinstance(value,str) or not value.startswith('https://') or any(x in value for x in '\r\n\t') or len(value)>2048:
        raise ValueError(f'{field}: HTTPS URL required (2048 chars maximum)')
    return value

def text(value, field, limit=2000, required=False):
    if value is None: value=''
    if not isinstance(value,str): raise ValueError(f'{field}: string required')
    value=value.strip()
    if required and not value: raise ValueError(f'{field}: cannot be empty')
    if len(value)>limit: raise ValueError(f'{field}: exceeds {limit} characters')
    return value

def positive(value, field, maximum=999):
    if type(value) is not int or value<1 or value>maximum:
        raise ValueError(f'{field}: integer in range 1..{maximum} required')
    return value

def validate(payload):
    series=payload.get('series') if isinstance(payload,dict) else payload
    if not isinstance(series,list) or not series: raise ValueError('Input must contain a nonempty series array')
    normalized=[];seen=set()
    for si,item in enumerate(series,1):
        if not isinstance(item,dict): raise ValueError(f'series[{si}] must be an object')
        title=text(item.get('title_ar'),f'series[{si}].title_ar',250,True)
        year=item.get('release_year')
        if year is not None and (type(year) is not int or year<1880 or year>2100):
            raise ValueError(f'{title}: invalid release_year')
        source=https(item.get('source_page_url'),f'{title}.source_page_url')
        key=(source or title.casefold(),year)
        if key in seen: raise ValueError(f'duplicate series in manifest: {title}')
        seen.add(key)
        country=text(item.get('country_code'),f'{title}.country_code',2).upper() or None
        if country and country not in ALLOWED_COUNTRIES: raise ValueError(f'{title}: unsupported country code {country}')
        tags=item.get('genre_tags',[])
        if not isinstance(tags,list) or len(tags)>12 or any(not isinstance(x,str) or not re.fullmatch(r'[a-z]{2,20}',x) for x in tags):
            raise ValueError(f'{title}: genre_tags must be up to 12 lowercase names')
        base={'title_ar':title,'release_year':year,'source_page_url':source,'country_code':country,
              'description':text(item.get('description'),f'{title}.description'),
              'poster_url':https(item.get('poster_url'),f'{title}.poster_url'),
              'backdrop_url':https(item.get('backdrop_url'),f'{title}.backdrop_url'),
              'genre_tags':list(dict.fromkeys(tags))}
        seasons=item.get('seasons',[])
        if not isinstance(seasons,list):raise ValueError(f'{title}: seasons must be an array')
        season_list=[];season_numbers=set()
        for season in seasons:
            if not isinstance(season,dict):raise ValueError(f'{title}: invalid season')
            sn=positive(season.get('number'),f'{title}.season.number',99)
            if sn in season_numbers:raise ValueError(f'{title}: duplicate season {sn}')
            season_numbers.add(sn)
            episodes=season.get('episodes',[])
            if not isinstance(episodes,list):raise ValueError(f'{title}: episodes must be an array')
            ep_numbers=set();ep_list=[]
            for episode in episodes:
                if not isinstance(episode,dict):raise ValueError(f'{title}: invalid episode')
                en=positive(episode.get('number'),f'{title}.episode.number',2000)
                if en in ep_numbers:raise ValueError(f'{title}: duplicate S{sn}E{en}')
                ep_numbers.add(en)
                ep_list.append({'number':en,
                   'title_ar':text(episode.get('title_ar') or f'الحلقة {en}',f'{title}.episode.title_ar',250,True),
                   'stream_url':https(episode.get('stream_url'),f'{title}.episode.stream_url'),
                   'source_page_url':https(episode.get('source_page_url'),f'{title}.episode.source_page_url'),
                   'poster_url':https(episode.get('poster_url'),f'{title}.episode.poster_url')})
            season_list.append({'number':sn,'title_ar':text(season.get('title_ar') or f'الموسم {sn}',f'{title}.season.title_ar',250),
                                'episodes':sorted(ep_list,key=lambda x:x['number'])})
        normalized.append({'series':base,'seasons':sorted(season_list,key=lambda x:x['number'])})
    return normalized

class REST:
    def __init__(self,url,key,token):
        self.base=url.rstrip('/')+'/rest/v1/'
        self.headers={'apikey':key,'Authorization':'Bearer '+token,'Content-Type':'application/json'}

    def call(self,table,*,filters=None,method='GET',data=None,prefer=None):
        url=self.base+table+('?' + urlencode(filters) if filters else '')
        headers=dict(self.headers)
        if prefer:headers['Prefer']=prefer
        body=json.dumps(data,ensure_ascii=False).encode('utf-8') if data is not None else None
        request=Request(url,data=body,headers=headers,method=method)
        try:
            with urlopen(request,timeout=25) as response:
                raw=response.read()
                return json.loads(raw) if raw else []
        except HTTPError as exc:
            message=exc.read().decode('utf-8','replace')[:500]
            raise RuntimeError(f'{method} {table}: HTTP {exc.code}: {message}') from exc
        except URLError as exc:
            raise RuntimeError(f'{method} {table}: connection error: {exc.reason}') from exc

    def match(self,table,filters):
        selections={'aseel_series':'id,title_ar,source_page_url,release_year',
                    'aseel_seasons':'id,series_id,number,title_ar',
                    'aseel_episodes':'id,number,title_ar,stream_url,source_page_url'}
        rows=self.call(table,filters={**filters,'select':selections[table],'limit':'3'})
        if len(rows)>1:raise RuntimeError(f'Ambiguous duplicate records in {table}: {filters}')
        return rows[0] if rows else None

    def insert(self,table,obj):
        rows=self.call(table,method='POST',data=obj,prefer='return=representation')
        if not rows or not rows[0].get('id'):raise RuntimeError(f'Could not confirm insert for {table}')
        return rows[0]

def apply(manifest,api):
    stats={'series_created':0,'seasons_created':0,'episodes_created':0,'episodes_untouched':0}
    for data in manifest:
        s=data['series'];src=s['source_page_url']
        old=api.match('aseel_series',{'source_page_url':'eq.'+src}) if src else None
        if not old:
            query={'title_ar':'eq.'+s['title_ar']}
            if s['release_year']:query['release_year']='eq.'+str(s['release_year'])
            old=api.match('aseel_series',query)
        if old:
            sid=old['id']
            # Protect existing metadata, published status, and watch-history references.
        else:
            props={key:value for key,value in s.items() if value not in (None,'',[])}
            sid=api.insert('aseel_series',{**props,'status':'draft','rights_status':'pending','quick_published':False})['id']
            stats['series_created']+=1
        for season in data['seasons']:
            oldseason=api.match('aseel_seasons',{'series_id':'eq.'+sid,'number':'eq.'+str(season['number'])})
            if oldseason:
                seasonid=oldseason['id']
            else:
                seasonid=api.insert('aseel_seasons',{'series_id':sid,'number':season['number'],'title_ar':season['title_ar']})['id']
                stats['seasons_created']+=1
            existing=api.call('aseel_episodes',filters={'season_id':'eq.'+seasonid,'select':'id,number','limit':'2000'})
            existing_numbers={x['number'] for x in existing}
            to_create=[]
            for ep in season['episodes']:
                if ep['number'] in existing_numbers:
                    stats['episodes_untouched']+=1
                    continue
                to_create.append({**{k:v for k,v in ep.items() if v is not None},
                       'season_id':seasonid,'status':'draft','rights_status':'pending',
                       'link_health_status':'unchecked'})
            for j in range(0,len(to_create),100):
                chunk=to_create[j:j+100]
                api.call('aseel_episodes',method='POST',data=chunk,prefer='return=minimal')
                stats['episodes_created']+=len(chunk)
        print(f'Imported: {s["title_ar"]} ({len(data["seasons"])} seasons)',file=sys.stderr)
    return stats

def main(argv=None):
    parser=argparse.ArgumentParser(description='Import licensed Al Ezz TV JSON catalog without crawling; drafts only')
    parser.add_argument('manifest',help='JSON manifest from the authorized content owner')
    parser.add_argument('--apply',action='store_true',help='Write valid manifest rows as drafts only')
    args=parser.parse_args(argv)
    with open(args.manifest,encoding='utf-8') as file:data=validate(json.load(file))
    counts={'series':len(data),'seasons':sum(len(x['seasons']) for x in data),
            'episodes':sum(len(s['episodes']) for x in data for s in x['seasons']),
            'stream_urls':sum(bool(e['stream_url']) for x in data for s in x['seasons'] for e in s['episodes'])}
    print(json.dumps({'mode':'apply' if args.apply else 'dry-run','catalog':counts},ensure_ascii=False))
    if not args.apply:
        print('Dry run: no writes. Add --apply only for an authorized source manifest.')
        return 0
    url=os.environ.get('SUPABASE_URL')
    key=os.environ.get('SUPABASE_PUBLISHABLE_KEY')
    token=os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not url or not key or not token or not url.startswith('https://'):
        raise ValueError('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_ACCESS_TOKEN for an admin session')
    stats=apply(data,REST(url,key,token))
    print(json.dumps({'result':stats,'note':'New records are drafts pending rights and playback review'},ensure_ascii=False))
    return 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,RuntimeError,OSError,json.JSONDecodeError) as exc:
        print(f'ERROR: {exc}',file=sys.stderr)
        raise SystemExit(1)
