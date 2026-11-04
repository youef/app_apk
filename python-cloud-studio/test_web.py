"""Offline integration tests for the Python website. No internet or DB required."""
import unittest
import time
from unittest.mock import patch
from fastapi.testclient import TestClient

from alezz_fetchv_importer import Catalogue, Episode
import server


class DummyDB:
    def __init__(self, *args, **kwargs):
        self.rows = {name: [] for name in ('aseel_movies', 'aseel_series', 'aseel_seasons', 'aseel_episodes')}
    def query(self, table, params):
        if table == 'aseel_categories':return [{'id':'drama','name_ar':'دراما'}]
        if table == 'aseel_admins':return [{'active':True}]
        return self.rows[table]
    def single(self, table, params):
        for row in self.rows[table]:
            if all(str(row.get(k)) == value[3:] for k, value in params.items()
                   if k not in ('select', 'limit') and isinstance(value, str) and value.startswith('eq.')):
                return row
        return None
    def insert(self, table, payload):
        row = {'id': str(len(self.rows[table])+1), **payload}
        self.rows[table].append(row)
        return row
    def patch(self, table, identifier, payload):
        for row in self.rows[table]:
            if row['id'] == identifier:
                row.update(payload)
                return row
        raise ValueError('not found')


class DemoTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        init = self.client.get('/api/init')
        self.assertEqual(init.status_code, 200)
        self.headers = {'X-CSRF-Token':init.json()['csrf']}

    def post(self, path, payload):
        return self.client.post('/api/'+path, json=payload, headers=self.headers)

    def test_title_search_filters_wrong_types_and_duplicate_pages(self):
        html = b'''<a href="/movies/example/">Example Film</a>
            <a href="/movies/example/?x=1">Duplicate</a>
            <a href="/series/example/">Example Show</a>
            <a href="https://other.example.org/movies/example/">Example Other</a>'''
        with patch.object(server.SourceClient, 'get', return_value=('https://v3.qrmzi.buzz/search/example/', 'text/html', html)):
            result = self.post('title-search', {'query':'Example', 'kind':'movie'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['results'], [
            {'kind':'movie', 'title':'Example Film', 'url':'https://v3.qrmzi.buzz/movies/example/'}
        ])

    def test_background_scan_verifies_each_episode_independently(self):
        root = 'https://source.example.org/series/example/'
        episode_page = 'https://source.example.org/episodes/example-1/'
        cat = Catalogue('series', 'Example Show', root,
                        episodes=[Episode(1, 1, 'One', episode_page), Episode(1, 2, 'Two', root)])
        stream = {'kind':'direct','url':'https://cdn.example.org/live.m3u8','verified':True}
        def resolve(pages, existing):
            return ([stream], []) if pages == [episode_page] else ([], [])
        with patch.object(server, 'discover_full', return_value=cat), \
             patch.object(server.MediaResolver, 'resolve', side_effect=resolve) as resolver:
            self.assertEqual(self.post('discover', {'url':root, 'scan_media':True}).status_code, 200)
            for _ in range(100):
                result = self.client.get('/api/discovery-scan').json()
                if not result['scan']['running']:
                    break
                time.sleep(.01)
        self.assertEqual(result['scan']['verified'], 1)
        self.assertEqual(resolver.call_count, 2)
        first, second = result['summary']['catalogue']['episodes']
        self.assertEqual(first['media_url'], stream['url'])
        self.assertEqual(first['source_pages'], [episode_page])
        self.assertFalse(second['verified'])
        self.assertFalse(second['media_url'])

    def test_local_worker_reuses_admin_login_and_releases_it_on_logout(self):
        db = DummyDB()
        with patch.object(server, 'local_request', return_value=True), \
             patch.object(server, 'Supabase', return_value=db), \
             patch.object(server.AUTOSYNC, 'desktop_mode', return_value=True), \
             patch.object(server.AUTOSYNC, 'has_server_key', return_value=False), \
             patch.object(server.AUTOSYNC, 'local_db', None):
            self.assertEqual(self.post('login', {'email':'admin@example.org','password':'test-password'}).status_code, 200)
            self.assertIs(server.AUTOSYNC.local_db, db)
            self.assertEqual(self.post('logout', {}).status_code, 200)
            self.assertIsNone(server.AUTOSYNC.local_db)

    def test_extension_auto_saves_and_merges_without_overwriting_published_work(self):
        db = DummyDB()
        page = 'https://source.example.org/movies/example/'
        stream = 'https://cdn.example.org/new.m3u8'
        cat = Catalogue('movie','Captured title',page,media_url=stream,verified=True,
                        sources=[{'url':stream,'kind':'direct','verified':True}])
        with patch.object(server,'local_request',return_value=True), \
             patch.object(server,'Supabase',return_value=db), \
             patch.object(server,'prepare_browser_capture',return_value=(cat,cat.sources,[])), \
             patch.object(server.AUTOSYNC,'bind_local_session'), \
             patch.object(server.AUTOSYNC,'remember_saved') as remember:
            body = {'page':page,'auto_save':True}
            self.assertTrue(self.post('browser-capture',body).json()['capture']['awaiting_login'])
            self.assertEqual(self.post('browser-capture',{**body,'background':True}).status_code,401)
            self.assertEqual(self.post('login',{'email':'admin@example.org','password':'example'}).status_code,200)
            self.assertTrue(self.post('browser-capture',body).json()['capture']['saved'])
            row, = db.rows['aseel_movies']
            self.assertEqual(row['status'],'draft')
            row.update(title_ar='Edited title',status='published',rights_status='approved',
                       stream_url='https://cdn.example.org/old.mp4')
            response = self.post('browser-capture',{**body,'background':True})
            self.assertTrue(response.json()['capture']['saved'])
            updated, = db.rows['aseel_movies']
            self.assertEqual(updated['title_ar'],'Edited title')
            self.assertEqual(updated['status'],'published')
            self.assertEqual(updated['rights_status'],'approved')
            self.assertEqual(updated['stream_url'],'https://cdn.example.org/old.mp4')
            self.assertEqual(updated['stream_variants'][0]['url'],stream)
            self.assertEqual(remember.call_count,2)

    def test_local_scan_rebinds_authenticated_session_before_queueing(self):
        db = DummyDB()
        with patch.object(server, 'local_request', return_value=True), \
             patch.object(server, 'Supabase', return_value=db), \
             patch.object(server.AUTOSYNC, 'has_server_key', return_value=False), \
             patch.object(server.AUTOSYNC, 'desktop_mode', return_value=True), \
             patch.object(server.AUTOSYNC, 'local_db', None), \
             patch.object(server.AUTOSYNC, 'control') as control:
            self.assertEqual(self.post('autosync/control', {'action':'check-all'}).status_code, 401)
            self.assertEqual(self.post('login', {'email':'admin@example.org','password':'test-password'}).status_code, 200)
            server.AUTOSYNC.local_db = None
            self.assertEqual(self.post('autosync/control', {'action':'check-all'}).status_code, 200)
            self.assertIs(server.AUTOSYNC.local_db, db)
            control.assert_called_once_with('check-all')

    def test_public_pages_and_cookies(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/static/style.css').status_code, 200)
        self.assertEqual(self.client.get('/static/app.js').status_code, 200)
        self.assertEqual(self.client.get('/api/health').json()['ok'], True)
        cookie=self.client.cookies.get(server.COOKIE)
        self.assertIsNotNone(cookie)
        response=self.client.post('/api/demo', json={})
        self.assertEqual(response.status_code,403)

    def test_demo_update_episode_and_links(self):
        result=self.post('demo',{}).json()
        self.assertEqual(result['count'], 8)
        self.assertTrue(result['demo'])
        self.assertEqual(result['catalogue']['year'],2026)
        update=self.post('update',{'title':'مسلسل جميل','year':2025,
                                   'genres':['drama','romance'],
                                   'episodes':[{'season':1,'number':1,'title':'الحلقة الأولى'}]})
        self.assertEqual(update.status_code,200)
        self.assertEqual(update.json()['catalogue']['episodes'][0]['title'],'الحلقة الأولى')
        links=self.post('links', {'text':'S01E01|https://media.example.org/one.m3u8\nS02E02|https://media.example.org/two.mp4'})
        self.assertEqual(links.status_code,200)
        self.assertEqual(links.json()['updated'],2)
        self.assertFalse(links.json()['catalogue']['episodes'][0]['verified'])
        new=self.post('episode-add', {'season':2,'number':6,'title':'حلقة إضافية'})
        self.assertEqual(new.status_code,200)
        self.assertEqual(new.json()['count'],9)
        self.assertEqual(self.post('episode-add', {'season':2,'number':6}).status_code,409)
        self.assertEqual(self.post('save',{}).status_code,401)
        self.assertEqual(self.client.get('/api/export').status_code,200)

    def test_discover_save_and_reuse(self):
        movie=Catalogue(kind='series',url='https://public.example.org/show',title='اختبار مصرح',
                        description='مسلسل قصير',genres=['drama'],
                        episodes=[Episode(1,1,'الحلقة الأولى','https://public.example.org/ep1')])
        fake_db=DummyDB()
        with patch.object(server,'pull_html',return_value=movie),patch.object(server,'Supabase',return_value=fake_db):
            response=self.post('discover', {'url':movie.url,'kind':'series'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['count'],1)
            login=self.post('login', {'email':'test@example.org','password':'samplepassword'})
            self.assertEqual(login.status_code,200)
            r=self.post('save', {'publish':False})
            self.assertEqual(r.status_code,200, r.text)
            self.assertEqual(r.json()['result']['episodes_new'],1)
            self.assertEqual(fake_db.rows['aseel_series'][0]['status'],'draft')
            self.assertEqual(self.post('save', {'publish':True,'rights_authorized':False}).status_code,400)
            again=self.post('save', {'publish':False})
            self.assertEqual(again.json()['result']['episodes_updated'],1)
            self.assertEqual(len(fake_db.rows['aseel_series']),1)
            self.assertEqual(len(fake_db.rows['aseel_episodes']),1)

    def test_cloud_browser_requires_admin_and_opt_in(self):
        self.post('demo', {})
        with patch.dict(server.os.environ, {'ALEZZ_PUBLIC_MODE': '1', 'ALEZZ_BROWSER_CAPTURE': '1'}):
            self.assertEqual(self.post('edge-capture', {}).status_code, 401)
        with patch.dict(server.os.environ, {'ALEZZ_PUBLIC_MODE': '1', 'ALEZZ_BROWSER_CAPTURE': '0'}):
            self.assertEqual(self.post('edge-capture', {}).status_code, 503)

    def test_cloud_browser_uses_headless_mode_after_admin_login(self):
        self.post('demo', {})
        sid = self.client.cookies.get(server.COOKIE)
        state = server._states[sid]
        state.db = DummyDB()
        state.demo = False
        state.catalogue = Catalogue(kind='movie', title='فيلم اختبار', url='https://example.org/film')
        with patch.dict(server.os.environ, {'ALEZZ_PUBLIC_MODE': '1', 'ALEZZ_BROWSER_CAPTURE': '1'}):
            with patch.object(server, 'collect_edge_network', return_value=2) as capture:
                result = self.post('edge-capture', {'seconds': 2, 'max_pages': 4})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()['detected'], 2)
                self.assertTrue(capture.call_args.kwargs['cloud'])
                self.assertEqual(capture.call_args.kwargs['start_index'], 0)
                self.assertEqual(result.json()['total'], 1)
                self.assertEqual(result.json()['next_index'], 1)

    def test_validation(self):
        self.assertEqual(self.post('discover', {'url':'http://localhost/secret','kind':'auto'}).status_code,400)
        self.post('demo',{})
        self.assertEqual(self.post('update', {'year':1700}).status_code,400)
        self.assertEqual(self.post('update', {'poster_url':'http://evil.org/pic.jpg'}).status_code,400)
        self.assertEqual(self.post('links', {'text':'S01E01|http://localhost/data.mp4'}).json()['updated'],0)
        self.assertEqual(self.post('verify', {'indices':[]}).status_code,400)

if __name__=='__main__':
    unittest.main()
