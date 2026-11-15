"""Offline integration tests for bulk discover and external metadata enrichment."""
import json
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

import metadata_enrichment as m
import server
from alezz_fetchv_importer import Catalogue,Episode
from test_web import DummyDB


class FakeResponse:
    def __init__(self, content):
        self.content=json.dumps(content).encode('utf-8')
        self.status_code=200
        self.data=content
    def raise_for_status(self):return None
    def json(self):return self.data


class MetadataTests(unittest.TestCase):
    def test_tvmaze_enrichment_and_episodes(self):
        cat=Catalogue('series','Test Hero','https://public.example.com/test',original_title='Test Hero')
        def api(url,**kw):
            if url.endswith('/search/shows'):
                return FakeResponse([{'show':{'id':100,'name':'Test Hero','premiered':'2022-03-20',
                    'language':'Turkish','network':{'country':{'code':'TR'}},
                    'genres':['Drama','Romance'],
                    'summary':'<p>Official story</p>',
                    'image':{'original':'https://static.tvmaze.com/photo.jpg'}}}])
            return FakeResponse([{'season':1,'number':1,'name':'Pilot','summary':'<p>Episode one</p>',
                                  'image':{'original':'https://static.tvmaze.com/ep1.jpg'}},
                                 {'season':1,'number':2,'name':'Second'}])
        result=m.enrich(cat,requester=api)
        self.assertEqual(result['sources'],['TVmaze'])
        self.assertEqual(cat.year,2022)
        self.assertEqual(cat.country,'TR')
        self.assertEqual(cat.language,'tr')
        self.assertEqual(cat.genres,['drama','romance'])
        self.assertEqual(len(cat.episodes),2)
        self.assertFalse(cat.episodes[0].media_url)
        self.assertEqual(cat.episodes[0].description,'Episode one')
        # Repeated enrichment must not duplicate episodes.
        m.enrich(cat,requester=api)
        self.assertEqual(len(cat.episodes),2)

    def test_reject_ambiguous_name_and_incorrect_year(self):
        cat=Catalogue('series','Test Hero','https://public.example.com/test',year=2026,original_title='Test Hero')
        def api(url,**kw):
            return FakeResponse([{'show':{'id':1,'name':'Test Hero','premiered':'1985-01-01'}}])
        self.assertEqual(m.tvmaze(cat,requester=api),'')
        self.assertEqual(cat.year,2026)
        self.assertEqual(cat.episodes,[])

    def test_optional_tmdb_enrichment(self):
        cat=Catalogue('movie','فيلم رحلات','https://public.example.com/movie')
        def api(url,**kw):
            if '/search/movie' in url:
                return FakeResponse({'results':[{'id':7,'title':'فيلم رحلات',
                                                  'original_title':'Journey Film','release_date':'2024-05-01'}]})
            return FakeResponse({'id':7,'title':'فيلم رحلات','original_title':'Journey Film',
                                 'release_date':'2024-05-01','original_language':'en',
                                 'production_countries':[{'iso_3166_1':'US'}],
                                 'poster_path':'/poster.jpg','backdrop_path':'/background.jpg',
                                 'genres':[{'name':'Drama'}], 'overview':'A cinematic voyage'})
        self.assertEqual(m.tmdb(cat,requester=api,api_key='fake-key'),'TMDB')
        self.assertEqual(cat.original_title,'Journey Film')
        self.assertEqual(cat.year,2024)
        self.assertEqual(cat.language,'en')
        self.assertEqual(cat.country,'US')
        self.assertEqual(cat.poster_url,'https://image.tmdb.org/t/p/w780/poster.jpg')
        self.assertIn('drama',cat.genres)


class BatchAPITests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(server.app)
        self.headers={'x-csrf-token':self.client.get('/api/init').json()['csrf']}
    def post(self,name,value):return self.client.post('/api/'+name,headers=self.headers,json=value)

    def test_batch_import_select_save_and_export(self):
        def fake_discover(url,kind='auto',deep=True,enrich_metadata=True):
            stem=url.split('/')[-1]
            return Catalogue('series',stem,url,original_title='Original '+stem,year=2026,
                episodes=[Episode(1,1,'الحلقة الأولى',url+'/ep1'),Episode(1,2,'الحلقة الثانية',url+'/ep2')])
        db=DummyDB()
        with patch.object(server,'discover_full',side_effect=fake_discover),patch.object(server,'Supabase',return_value=db):
            request={'urls':'https://series.example.com/a\nhttps://series.example.com/b\nhttps://series.example.com/a',
                     'kind':'auto','deep':True,'metadata':True}
            response=self.post('discover-batch',request)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(len(response.json()['batch']),2)
            self.assertEqual(response.json()['batch'][0]['original_title'],'Original a')
            response=self.post('select-catalogue',{'index':1})
            self.assertEqual(response.json()['catalogue']['title'],'b')
            login=self.post('login',{'email':'admin@sample.org','password':'example'})
            self.assertEqual(login.status_code,200)
            saved=self.post('save-batch',{'publish':False})
            self.assertEqual(saved.status_code,200,saved.text)
            self.assertEqual(saved.json()['ok_count'],2)
            self.assertEqual(saved.json()['totals']['episodes_new'],4)
            self.assertEqual(len(db.rows['aseel_series']),2)
            again=self.post('save-batch',{'publish':False})
            self.assertEqual(again.json()['totals']['episodes_new'],0)
            self.assertEqual(again.json()['totals']['episodes_updated'],4)
            export=self.client.get('/api/export-batch')
            self.assertEqual(export.status_code,200)
            self.assertEqual(len(export.json()['works']),2)

    def test_listing_scan_same_host_and_filters_episode_links(self):
        html="""<html><body><a href="/series/show-one">مسلسل الأول</a><a href="/series/show-two">مسلسل الثاني</a><a href="/episode/part1">الحلقة 1</a><a href="https://other.example.com/series/bad">مسلسل خارجي</a></body></html>"""
        class FakeSource:
            def __init__(self,*args,**kwargs):pass
            def get(self,url):return url,'text/html',html
        with patch.object(server,'SourceClient',FakeSource):
            res=self.post('scan-listing',{'url':'https://series.example.com/category/series','kind':'series'})
            self.assertEqual(res.status_code,200,res.text)
            self.assertEqual(res.json()['links'],[
              'https://series.example.com/series/show-one',
              'https://series.example.com/series/show-two'])

    def test_batch_restrictions(self):
        response=self.post('discover-batch',{'urls':'https://localhost/internal'})
        self.assertEqual(response.status_code,400)
        response=self.post('discover-batch',{'urls':'\n'.join('https://foo.example.org/'+str(x) for x in range(19))})
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.client.post('/api/save-batch',json={}).status_code,403)

if __name__=='__main__':unittest.main()
