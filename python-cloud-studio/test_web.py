"""Offline integration tests for the Python website. No internet or DB required."""
import unittest
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
        with patch.dict(server.os.environ, {'ALEZZ_PUBLIC_MODE': '1', 'ALEZZ_BROWSER_CAPTURE': '1'}):
            with patch.object(server, 'collect_edge_network', return_value=2) as capture:
                result = self.post('edge-capture', {'seconds': 2, 'max_pages': 4})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()['detected'], 2)
                self.assertTrue(capture.call_args.kwargs['cloud'])

    def test_validation(self):
        self.assertEqual(self.post('discover', {'url':'http://localhost/secret','kind':'auto'}).status_code,400)
        self.post('demo',{})
        self.assertEqual(self.post('update', {'year':1700}).status_code,400)
        self.assertEqual(self.post('update', {'poster_url':'http://evil.org/pic.jpg'}).status_code,400)
        self.assertEqual(self.post('links', {'text':'S01E01|http://localhost/data.mp4'}).json()['updated'],0)
        self.assertEqual(self.post('verify', {'indices':[]}).status_code,400)

if __name__=='__main__':
    unittest.main()
