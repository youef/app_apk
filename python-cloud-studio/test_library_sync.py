import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from library_sync import JobDB,extract_listing,collect_pages,collect_works
from alezz_fetchv_importer import pull_html,Catalogue,Episode

ROOT='https://example.org/all-turkish-series/'
MROOT='https://example.org/all-turkish-movies/'

class Site:
    def __init__(self,urls):self.urls=urls;self.requested=[]
    def get(self,url):
        self.requested.append(url)
        if url not in self.urls:raise ValueError('HTTP 404')
        return url,'text/html; charset=utf-8',self.urls[url]

class LibraryCrawlerTests(unittest.TestCase):
    def test_three_list_pages_and_skip_a_failed_work(self):
        url1='https://example.org/series/first/'
        url2='https://example.org/series/second/'
        url3='https://example.org/series/third/'
        pages={ROOT: f'<article class="post"><a href="{url1}">مسلسل الأول</a></article><a class="next page-numbers" href="/all-turkish-series/page/2/">التالي</a>',
          'https://example.org/all-turkish-series/page/2/':f'<article class="post"><a href="{url2}">مسلسل الثاني</a></article><a class="next" href="/all-turkish-series/page/3/">التالي</a>',
          'https://example.org/all-turkish-series/page/3/':f'<article class="post"><a href="{url3}">مسلسل الثالث</a></article>'}
        with tempfile.TemporaryDirectory() as tmp:
            db=JobDB(Path(tmp)/'jobs.sqlite');db.add_sources([ROOT],'series');site=Site(pages)
            self.assertEqual(collect_pages(db,client_factory=lambda timeout:site),3)
            self.assertEqual(db.snapshot()['counts']['works']['pending'],3)
            processed=[]
            def discover(url,kind,progress,hook):
                processed.append(url)
                if url==url2:raise ValueError('HTTP 503')
                hook({'episodes':[],'queued':[],'seen_pages':[]})
                return Catalogue(kind='series',title=url.rsplit('/',2)[-2],url=url)
            self.assertEqual(collect_works(db,discover,max_works=20),5)
            self.assertIn(url3,processed)
            self.assertEqual(db.snapshot()['counts']['works']['done'],2)
            self.assertEqual(db.snapshot()['counts']['works']['failed'],1)
            restarted=JobDB(Path(tmp)/'jobs.sqlite')
            self.assertEqual(restarted.snapshot()['counts']['works']['done'],2)
            restarted.retry_failed()
            self.assertEqual(restarted.snapshot()['counts']['works']['pending'],1)

    def test_resync_existing_library_without_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=JobDB(Path(tmp)/'sync.sqlite3')
            db.add_sources([ROOT],'series')
            url='https://example.org/series/first/'
            db.append_works(ROOT,'series',[url])
            row=db.take('works')
            db.done('works',url,json.dumps({'kind':'series','episodes':[]}))
            db.mark_saved(url)
            db.add_sources([ROOT],'series')
            state=db.snapshot()
            self.assertEqual(state['counts']['works']['pending'],1)
            self.assertEqual(len(state['works']),1)
            self.assertEqual(state['works'][0]['saved'],0)
            self.assertEqual(state['counts']['pages']['pending'],1)

    def test_parallel_episode_pages_kept_on_interruption(self):
        root='https://example.org/series/concurrent/'
        p2=root+'page/2/'
        p3=root+'page/3/'
        pages={root:'<html><title>مسلسل</title><a href="/series/concurrent/episode-1/">الحلقة 1</a><a class="page-numbers" href="page/2/">2</a><a class="page-numbers" href="page/3/">3</a></html>',
               p2:'<html><a href="/series/concurrent/episode-2/">الحلقة 2</a></html>',
               p3:'<html><a href="/series/concurrent/episode-3/">الحلقة 3</a></html>'}
        saved={}
        def hook(data):
            saved.update(data)
            if len(data['seen_pages'])>1:raise RuntimeError('Interrupted')
        with self.assertRaises(RuntimeError):pull_html(root,Site(pages),kind='series',progress_hook=hook)
        cat=pull_html(root,Site(pages),kind='series',resume_progress=saved)
        self.assertEqual([x.number for x in cat.episodes],[1,2,3])

    def test_multiple_listing_sources_and_navigation_excluded(self):
        html='<a href="/all-turkish-series/page/2/">2</a><a href="/episode/5/">الحلقة 5</a><div class="card"><a href="/series/legit/">مسلسل حقيقي</a></div>'
        works,pages=extract_listing(html,ROOT,ROOT,'series')
        self.assertEqual(len(works),1)
        self.assertEqual(len(pages),1)
        self.assertNotIn('/episode/',works[0])
        movies, _=extract_listing('<article class="movie"><a href="/movies/film-a/">فيلم عربي</a></article>',MROOT,MROOT,'movie')
        self.assertEqual(movies,['https://example.org/movies/film-a/'])

    def test_episodes_beyond_150_and_continue_after_missing_page(self):
        root='https://example.org/series/a/'
        links=''.join(f'<a href="/series/a/episode-{i}/">الحلقة {i}</a>' for i in range(1,161))
        first=f'<html><title>مسلسل طويل</title>{links}<a class="next" href="/series/a/page/2/">التالي</a><a href="/series/a/page/3/" class="page-numbers">3</a></html>'
        pages={root:first,'https://example.org/series/a/page/3/':'<html><a href="/series/a/episode-162/">الحلقة 162</a></html>'}
        cat=pull_html(root,Site(pages),kind='series',max_episodes=5000)
        self.assertEqual(len(cat.episodes),161)
        self.assertEqual(cat.episodes[-1].number,162)
        self.assertTrue(any('page/2' in s for s in cat.discovery_warnings))

    def test_checkpoint_resume_does_not_reopen_completed_episode_page(self):
        root='https://example.org/series/resume/'
        p2=root+'page/2/'
        p3=root+'page/3/'
        pages={root:'<html><title>مسلسل</title><a href="/series/resume/episode-1/">الحلقة 1</a><a class="next" href="page/2/">التالي</a></html>',
               p2:'<html><a href="/series/resume/episode-2/">الحلقة 2</a><a class="next" href="/series/resume/page/3/">التالي</a></html>',
               p3:'<html><a href="/series/resume/episode-3/">الحلقة 3</a></html>'}
        stored={}
        def hook(data):
            stored.update(data)
            if any(ep['number']==2 for ep in data['episodes']):raise RuntimeError('App abruptly stopped')
        with self.assertRaises(RuntimeError):pull_html(root,Site(pages),kind='series',progress_hook=hook)
        site=Site(pages)
        cat=pull_html(root,site,kind='series',resume_progress=stored)
        self.assertEqual([x.number for x in cat.episodes],[1,2,3])
        self.assertNotIn(p2,site.requested)

    def test_routes_require_csrf(self):
        import server
        with TestClient(server.app) as client:
            init=client.get('/api/init').json()
            bad=client.post('/api/library-start',json={'urls':ROOT})
            self.assertEqual(bad.status_code,403)
            status=client.get('/api/library-status')
            self.assertEqual(status.status_code,200)
            self.assertIn('counts',status.json())

if __name__=='__main__':unittest.main()
