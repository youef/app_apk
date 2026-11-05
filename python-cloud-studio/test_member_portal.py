from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from member_portal import Portal


class PortalTests(unittest.TestCase):
    def setUp(self):
        folder=TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root=Path(folder.name)
        for section in ('web','admin'):
            (root/section).mkdir()
            (root/section/'index.view').write_text(section+' protected<script src="js/store.js?v=member-scope-1"></script>',encoding='utf-8')
        (root/'web'/'catalog.json').write_text('{}',encoding='utf-8')
        self.portal=Portal(root,'https://db.example.org','public',secure=True)
        app=FastAPI()
        app.middleware('http')(self.portal.middleware)
        self.client=TestClient(app,base_url='https://studio.example.org',follow_redirects=False)
        self.headers={'Origin':'https://studio.example.org'}

    def login(self, role):
        endpoint='/account/admin' if role=='admin' else '/account/login'
        username='admin@example.org' if role=='admin' else 'customer1'
        with patch.object(self.portal,'authenticate',return_value=('example-id',role)):
            result=self.client.post(endpoint,data={'username':username,'password':'example-password'},headers=self.headers)
        self.assertEqual(result.status_code,303)
        self.assertIn('HttpOnly',result.headers['Set-Cookie'])
        self.assertIn('Secure',result.headers['Set-Cookie'])
        return result

    def test_direct_pages_and_catalogue_require_session_and_role(self):
        for path in ('/web/','/web/index.html','/web/catalog.json','/admin/','/account/customers'):
            self.assertEqual(self.client.get(path).headers['location'], '/account/login' if path.startswith('/web/') else '/account/admin')
        self.assertEqual(self.login('customer').headers['location'],'/web/')
        self.assertIn('web protected',self.client.get('/web/index.html').text)
        self.assertEqual(self.client.get('/web/catalog.json').status_code,200)
        self.assertEqual(self.client.get('/admin/').status_code,403)
        self.assertEqual(self.client.get('/account/customers').status_code,403)
        self.assertEqual(self.client.get('/web/index.view').status_code,404)
        self.assertEqual(self.client.post('/account/logout',headers=self.headers).status_code,303)
        self.assertEqual(self.client.get('/web/').headers['location'],'/account/login')

    def test_private_viewer_scope_changes_by_member_and_is_not_cached(self):
        self.login('customer')
        page=self.client.get('/web/index.html')
        self.assertEqual(page.status_code,200)
        self.assertIn('no-store',page.headers.get('cache-control',''))
        self.assertIn('window.ALEZZ_MEMBER_CONTEXT',page.text)
        self.assertLess(page.text.index('window.ALEZZ_MEMBER_CONTEXT'),page.text.index('src="js/store.js'))
        import re
        a=re.search(r'"accountKey":"([0-9a-f]{32})"',page.text)
        self.assertIsNotNone(a)
        self.assertNotIn('example-id',page.text)
        logout=self.client.post('/account/logout',headers=self.headers)
        self.assertEqual(logout.status_code,303)
        self.assertNotIn('"storage"',logout.headers.get('clear-site-data',''))
        with patch.object(self.portal,'authenticate',return_value=('another-user','customer')):
            response=self.client.post('/account/login',data={'username':'another','password':'example-password'},headers=self.headers)
        self.assertEqual(response.status_code,303)
        other=self.client.get('/web/index.html')
        b=re.search(r'"accountKey":"([0-9a-f]{32})"',other.text)
        self.assertIsNotNone(b)
        self.assertNotEqual(a.group(1),b.group(1))
        self.assertEqual(self.client.post('/account/logout',headers=self.headers).status_code,303)
        self.login('customer')
        same=self.client.get('/web/index.html')
        self.assertIn(a.group(1),same.text)
        self.assertNotIn('window.ALEZZ_MEMBER_CONTEXT',self.client.get('/web/catalog.json').text)

    def test_customer_is_limited_to_one_registered_browser(self):
        self.login('customer')
        self.assertEqual(self.client.get('/web/').status_code,200)
        self.assertTrue(self.client.cookies.get('alezz_member_device'))
        other=TestClient(self.client.app,base_url='https://studio.example.org',follow_redirects=False)
        try:
            with patch.object(self.portal,'authenticate',return_value=('example-id','customer')):
                denied=other.post('/account/login',data={'username':'customer1',
                       'password':'example-password'},headers=self.headers)
            self.assertEqual(denied.status_code,200)
            self.assertIn('مرتبط بجهاز آخر',denied.text)
            self.assertEqual(other.get('/web/').headers['location'],'/account/login')
            self.assertEqual(self.client.get('/web/').status_code,200)
            self.portal.devices.reset('example-id')
            # Removing a device also terminates existing sessions on their next request.
            self.assertEqual(self.client.get('/web/').headers['location'],'/account/login')
            with patch.object(self.portal,'authenticate',return_value=('example-id','customer')):
                allowed=other.post('/account/login',data={'username':'customer1',
                        'password':'example-password'},headers=self.headers)
            self.assertEqual(allowed.status_code,303)
            self.assertEqual(other.get('/web/').status_code,200)
        finally:
            other.close()

    def test_admin_directory_shows_accounts_and_unlinks_device_with_csrf(self):
        self.login('admin')
        uid='12345678-1234-1234-1234-123456789abc'
        self.portal.devices.register(uid,'test-device-cookie-aaaaaaaaaaaaaaaaaaaa',
                                     'Mozilla/5.0 (iPhone)')
        user={'id':uid,'email':'customer1@members.alezz.invalid',
              'created_at':'2026-10-01T05:00:00Z','last_sign_in_at':'2026-11-05T06:00:00Z',
              'app_metadata':{'alezz_customer':'active'}}
        csrf=next(iter(self.portal.sessions.values()))[3]
        with patch.object(self.portal,'upstream',return_value={'users':[user]}):
            response=self.client.get('/account/customers')
            self.assertEqual(response.status_code,200)
            self.assertIn('customer1',response.text)
            self.assertIn('iPhone',response.text)
            self.assertIn('فك الجهاز',response.text)
            blocked=self.client.post('/account/customers',data={'username':'customer1',
                     'action':'reset-device'},headers=self.headers)
            self.assertEqual(blocked.status_code,403)
            done=self.client.post('/account/customers',data={'username':'customer1',
                     'action':'reset-device','csrf':csrf},headers=self.headers)
            self.assertEqual(done.status_code,200)
            self.assertIn('تم فك ارتباط الجهاز',done.text)
            self.assertNotIn(uid,self.portal.devices.details([uid]))

    def test_studio_and_api_are_isolated(self):
        for path in ('/studio/','/studio/sources','/static/app.js','/api/init'):
            response=self.client.get(path)
            self.assertEqual(response.status_code,401 if path.startswith('/api/') else 303)
        self.login('customer')
        for path in ('/studio/','/static/app.js','/api/init'):
            self.assertEqual(self.client.get(path).status_code,403)
        self.assertEqual(self.client.get('/account/admin').status_code,200)

    def test_admin_login_has_own_route(self):
        res=self.login('admin')
        self.assertEqual(res.headers['location'],'/studio/')
        self.assertEqual(self.client.get('/admin/').status_code,200)

    def test_admin_customer_creation_checks_csrf(self):
        self.login('admin')
        self.assertIn('admin protected',self.client.get('/admin/').text)
        csrf=next(iter(self.portal.sessions.values()))[3]
        with patch.object(self.portal,'upstream',return_value={}) as upstream:
            data={'username':'customer1','password':'new-password-123','action':'create'}
            self.assertEqual(self.client.post('/account/customers',data=data,headers=self.headers).status_code,403)
            self.assertEqual(self.client.post('/account/customers',data={**data,'csrf':csrf},headers=self.headers).status_code,200)
        self.assertTrue(upstream.call_args.kwargs['secret'])
        self.assertEqual(upstream.call_args.kwargs['json']['app_metadata'],{'alezz_customer':'active'})

    def test_authentication_checks_server_controlled_customer_metadata(self):
        uid='12345678-1234-1234-1234-123456789abc'
        user={'id':uid,'user_metadata':{'alezz_customer':'active'}}
        with patch.object(self.portal,'upstream',return_value={'user':user}):
            with self.assertRaises(ValueError):
                self.portal.authenticate('customer1','password')
            user['app_metadata']={'alezz_customer':'active'}
            self.assertEqual(self.portal.authenticate('customer1','password'),(uid,'customer'))
