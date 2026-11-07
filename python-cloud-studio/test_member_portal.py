from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
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

    def test_session_persists_after_server_restart_until_explicit_logout(self):
        self.login('customer')
        # No in-memory customer token is needed: the private SQLite database
        # restores the authorized session after a Render worker restart.
        restarted = Portal(self.portal.root, self.portal.db_url,
                           self.portal.public_key, secure=True)
        app = FastAPI()
        app.middleware('http')(restarted.middleware)
        again = TestClient(app, base_url='https://studio.example.org',
                           follow_redirects=False)
        try:
            again.cookies.update(self.client.cookies)
            page = again.get('/web/index.html')
            self.assertEqual(page.status_code, 200)
            self.assertIn('window.ALEZZ_MEMBER_CONTEXT', page.text)
            response = again.post('/account/logout', headers=self.headers)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(again.get('/web/').headers['location'], '/account/login')
            self.assertEqual(self.client.get('/web/').headers['location'], '/account/login')
        finally:
            again.close()

    def test_cloud_sync_requires_customer_csrf_and_ignores_untrusted_user_id(self):
        self.login('customer')
        self.assertEqual(self.client.post('/account/sync',
                         json={'kind':'favorites_reset','action':'clear'}).status_code,403)
        self.assertEqual(self.client.post('/account/sync',
                         json={'kind':'favorites_reset','action':'clear'},
                         headers=self.headers).status_code,403)
        token=self.client.cookies.get('alezz_member')
        csrf=self.portal.member_sessions.get(token)[0][3]
        media_id='12345678-1234-1234-1234-123456789abc'
        with patch.object(self.portal,'upstream',return_value=[]) as upstream:
            read=self.client.get('/account/sync')
            self.assertEqual(read.status_code,200)
            self.assertEqual(read.json(),{'favorites':[],'progress':[]})
            result=self.client.post('/account/sync',
                    json={'kind':'favorite','action':'save','item_type':'movie',
                          'item_id':media_id,'user_id':'forged-other-user'},
                    headers={**self.headers,'X-CSRF-Token':csrf})
            self.assertEqual(result.status_code,200)
            self.assertTrue(upstream.called)
            record=[c for c in upstream.call_args_list if c.args[0]=='POST'][-1]
            self.assertEqual(record.kwargs['json']['user_id'],'example-id')
            self.assertNotIn('forged-other-user',str(record.kwargs))
        self.assertEqual(self.client.post('/account/sync',
                         json={'kind':'favorite','action':'save','item_type':'movie',
                               'item_id':'bad-id'},
                         headers={**self.headers,'X-CSRF-Token':csrf}).status_code,400)

    def test_customer_session_status_gates_expired_active_player(self):
        import time
        self.assertEqual(self.client.get('/account/status').status_code,401)
        self.login('customer')
        self.assertTrue(self.client.get('/account/status').json()['active'])
        # A session may still be within its 180-day cookie lifetime.
        self.portal.member_sessions.set_user_expiry('example-id',int(time.time())-1)
        expired=self.client.get('/account/status')
        self.assertEqual(expired.status_code,401)
        self.assertFalse(expired.json()['active'])
        landing=self.client.get('/account/login?expired=1')
        self.assertIn('انتهت صلاحية حسابك',landing.text)

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
            end=(datetime.now(ZoneInfo('Asia/Riyadh')).date()+timedelta(days=40)).isoformat()
            data={'username':'customer1','password':'new-password-123','action':'create','expires_on':end}
            self.assertEqual(self.client.post('/account/customers',data=data,headers=self.headers).status_code,403)
            self.assertEqual(self.client.post('/account/customers',data={**data,'csrf':csrf},headers=self.headers).status_code,200)
        created=[call for call in upstream.call_args_list
                 if call.args[:2]==('POST','/auth/v1/admin/users')]
        self.assertEqual(len(created),1)
        self.assertTrue(created[0].kwargs['secret'])
        self.assertEqual(created[0].kwargs['json']['app_metadata']['alezz_customer'],'active')
        self.assertTrue(created[0].kwargs['json']['app_metadata']['alezz_expires_at'].endswith('Z'))

    def test_default_create_is_90_days_with_no_manual_expiry(self):
        from member_expiry import expiry_date
        self.login('admin')
        csrf=next(iter(self.portal.sessions.values()))[3]
        with patch.object(self.portal,'upstream',return_value={}) as upstream:
            result=self.client.post('/account/customers',data={
                'username':'plan90','password':'a-strong-customer-password',
                'action':'create','csrf':csrf},headers=self.headers)
        self.assertEqual(result.status_code,200)
        created=[x for x in upstream.call_args_list if x.args[:2]==('POST','/auth/v1/admin/users')]
        self.assertEqual(len(created),1)
        metadata=created[0].kwargs['json']['app_metadata']
        self.assertEqual(metadata['alezz_plan_days'],90)
        expected=(datetime.now(ZoneInfo('Asia/Riyadh')).date()+timedelta(days=89)).isoformat()
        self.assertEqual(expiry_date(metadata),expected)

    def test_renew_90_extends_existing_expiry_and_preserves_disabled_status(self):
        from member_expiry import expiration_from_date, expiry_date
        today=datetime.now(ZoneInfo('Asia/Riyadh')).date()
        current=(today+timedelta(days=14)).isoformat()
        metadata={'alezz_customer':'disabled',
                  'alezz_expires_at':expiration_from_date(current),
                  'example_config':'keep'}
        user={'id':'12345678-1234-1234-1234-123456789abc',
              'email':'sub90@members.alezz.invalid','app_metadata':metadata}
        with patch.object(self.portal,'upstream',return_value={'users':[user]}) as upstream:
            result=self.portal.manage({'action':'renew-90','username':'sub90'})
        self.assertEqual(result,user['id'])
        changed=[x.kwargs['json']['app_metadata'] for x in upstream.call_args_list if x.args[0]=='PUT']
        self.assertEqual(len(changed),1)
        self.assertEqual(changed[0]['alezz_plan_days'],90)
        self.assertEqual(changed[0]['alezz_customer'],'disabled')
        self.assertEqual(changed[0]['example_config'],'keep')
        self.assertEqual(expiry_date(changed[0]),(today+timedelta(days=104)).isoformat())

    def test_warning_at_seven_days_and_expired_screen(self):
        from member_expiry import expiration_from_date, expiry_epoch
        self.login('customer')
        today=datetime.now(ZoneInfo('Asia/Riyadh')).date()
        expiry=expiration_from_date((today+timedelta(days=6)).isoformat())
        self.portal.member_sessions.set_user_expiry('example-id',expiry_epoch({'alezz_expires_at':expiry}))
        summary=self.client.get('/account/status')
        self.assertEqual(summary.status_code,200)
        self.assertEqual(summary.json()['remaining_days'],7)
        self.assertTrue(summary.json()['warning'])
        screen=self.client.get('/account/login?expired=1')
        self.assertIn('انتهت صلاحية اشتراكك',screen.text)
        self.assertIn('تسجيل الدخول بعد التجديد',screen.text)

    def test_device_reset_updates_authoritative_cutoff(self):
        self.login('customer')
        username='customer1'
        record={'id':'12345678-1234-1234-1234-123456789abc',
                'email':username+'@members.alezz.invalid',
                'app_metadata':{'alezz_customer':'active',
                                'other_setting':'keep'}}
        with patch.object(self.portal,'upstream',return_value={'users':[record]}) as upstream:
            self.portal.manage({'action':'reset-device','username':username})
        changes=[x.kwargs['json']['app_metadata'] for x in upstream.call_args_list if x.args[0]=='PUT']
        self.assertEqual(changes[0]['other_setting'],'keep')
        self.assertIn('alezz_devices_revoked_at',changes[0])
        self.assertTrue(changes[0]['alezz_devices_revoked_at'].endswith('Z'))

    def test_expired_customer_cannot_log_in_even_with_valid_password(self):
        from member_expiry import expiration_from_date
        now=datetime.now(ZoneInfo('Asia/Riyadh'))
        expired=(now.date()-timedelta(days=2)).isoformat()
        user={'id':'12345678-1234-1234-1234-123456789abc',
              'app_metadata':{'alezz_customer':'active',
                              'alezz_expires_at':expired+'T00:00:00Z'}}
        with patch.object(self.portal,'upstream',return_value={'user':user}):
            with self.assertRaisesRegex(ValueError,'expired'):
                self.portal.authenticate('customer1','correct-password')
            response=self.client.post('/account/login',headers=self.headers,
                        data={'username':'customer1','password':'correct-password'})
            self.assertEqual(response.status_code,200)
            self.assertIn('انتهت صلاحية اشتراكك',response.text)

    def test_admin_updates_date_and_invalidates_expired_browser_sessions(self):
        from member_expiry import expiration_from_date, expiry_epoch
        end=(datetime.now(ZoneInfo('Asia/Riyadh')).date()+timedelta(days=30)).isoformat()
        old='2025-01-02T21:00:00Z'
        uid='12345678-1234-1234-1234-123456789abc'
        self.login('customer')
        self.portal.member_sessions.set_user_expiry('example-id',int(datetime(2025,1,1).timestamp()))
        self.assertEqual(self.client.get('/web/').headers['location'],'/account/login')
        self.login('admin')
        record={'id':uid,'email':'customer1@members.alezz.invalid',
                'app_metadata':{'alezz_customer':'active','alezz_expires_at':old,
                                'other_attribute':'preserved'}}
        with patch.object(self.portal,'upstream',return_value={'users':[record]}) as upstream:
            updated=self.portal.manage({'action':'set-expiry','username':'customer1',
                                        'expires_on':end})
            self.assertEqual(updated,uid)
            update=[c for c in upstream.call_args_list if c.args[0]=='PUT'][-1]
            meta=update.kwargs['json']['app_metadata']
            self.assertEqual(meta['alezz_expires_at'],expiration_from_date(end))
            self.assertEqual(meta['other_attribute'],'preserved')
            self.assertEqual(meta['alezz_customer'],'active')
        with self.assertRaises(ValueError):
            self.portal.manage({'action':'create','username':'newcustomer',
                               'password':'new-password-123','expires_on':'2020-01-01'})

    def test_expiration_is_visible_on_customer_directory(self):
        self.login('admin')
        uid='12345678-1234-1234-1234-123456789abc'
        user={'id':uid,'email':'customer1@members.alezz.invalid',
              'created_at':'2026-10-01T05:00:00Z',
              'app_metadata':{'alezz_customer':'active','alezz_expires_at':'2025-01-02T21:00:00Z'}}
        with patch.object(self.portal,'upstream',return_value={'users':[user]}):
            page=self.client.get('/account/customers')
            self.assertEqual(page.status_code,200)
            self.assertIn('منتهي الصلاحية',page.text)
            self.assertIn('set-expiry',page.text)
            self.assertIn('2025-01-02',page.text)

    def test_authentication_checks_server_controlled_customer_metadata(self):
        uid='12345678-1234-1234-1234-123456789abc'
        user={'id':uid,'user_metadata':{'alezz_customer':'active'}}
        with patch.object(self.portal,'upstream',return_value={'user':user}):
            with self.assertRaises(ValueError):
                self.portal.authenticate('customer1','password')
            user['app_metadata']={'alezz_customer':'active'}
            self.assertEqual(self.portal.authenticate('customer1','password'),(uid,'customer',0))
