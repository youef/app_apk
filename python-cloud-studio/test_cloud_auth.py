"""Cloud administrator login regression checks; never use real credentials or DB."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOME = str(Path(__file__).resolve().parent)


class CloudHostingTests(unittest.TestCase):
    def subprocess(self, script, overrides=None):
        with tempfile.TemporaryDirectory() as d:
            env = os.environ.copy()
            env.update(ALEZZ_PUBLIC_MODE='1',
                       ALEZZ_SITE_SECRET='c98b7c2b8799d471ad5c2fe718b3fc15c11dc9d30108ff5ea79eb051f4859fb4',
                       ALEZZ_DATA_DIR=d)
            env.pop('ALEZZ_SITE_PASSWORD', None)
            env.update(overrides or {})
            return subprocess.run([sys.executable, '-c', script], cwd=HOME, env=env,
                                  text=True, capture_output=True, timeout=25)

    def test_single_email_login_authorizes_existing_studio_without_second_login(self):
        script = '''
from fastapi.testclient import TestClient
from unittest.mock import patch
from server import app
import cloud_auth
class FakeAdmin:
    refresh_token = 'offline-test-refresh-token'
    def query(self, *args, **kwargs): return []
with TestClient(app, base_url='https://studio.example.test') as c:
    assert c.get('/healthz').json()['ok']
    assert c.get('/', follow_redirects=False).status_code == 303
    assert c.get('/api/init').status_code == 401
    page = c.get('/login').text
    assert 'البريد الإلكتروني' in page and 'name="email"' in page
    assert 'كلمة مرور الموقع' not in page
    with patch.object(cloud_auth, '_verify_admin', side_effect=ValueError('invalid credentials')):
        assert 'غير صحيحة' in c.post('/login', data={'email':'bad@example.com','password':'bad'}).text
    with patch.object(cloud_auth, '_verify_admin', return_value=FakeAdmin()) as verify:
        login = c.post('/login', data={'email':'admin@example.com', 'password':'good'},
                       follow_redirects=False)
        verify.assert_called_once_with('admin@example.com', 'good')
    assert login.status_code == 303, login.status_code
    assert 'secure' in login.headers['set-cookie'].lower()
    assert 'httponly' in login.headers['set-cookie'].lower()
    assert c.get('/').status_code == 200
    j = c.get('/api/init').json()
    assert j['csrf'] and j['authenticated'] is True
    assert c.get('/api/library-status').status_code == 200
    assert c.post('/api/library-start',json={'urls':'https://example.org/library',
                 'kind':'series'}).status_code == 403
    logout = c.post('/logout-site', follow_redirects=False)
    assert logout.status_code == 303
    assert c.get('/api/init').status_code == 401
print('Unified email login test passed')
'''
        result = self.subprocess(script)
        self.assertEqual(result.returncode, 0, result.stdout+'\n'+result.stderr)

    def test_public_requires_session_secret_not_old_site_password(self):
        bad = self.subprocess('import cloud_auth', {'ALEZZ_SITE_SECRET':'too-short'})
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn('ALEZZ_SITE_SECRET', bad.stderr)
        good = self.subprocess('import cloud_auth; assert cloud_auth.ENABLED')
        self.assertEqual(good.returncode, 0, good.stderr)

    def test_invalid_supabase_admin_does_not_create_session(self):
        script = '''
from fastapi.testclient import TestClient
from unittest.mock import patch
import cloud_auth
from server import app
with TestClient(app, base_url='https://studio.example.test') as c:
    with patch.object(cloud_auth, '_verify_admin', side_effect=ValueError('inactive admin')):
        bad = c.post('/login', data={'email':'viewer@example.com','password':'pass'})
    assert bad.status_code == 401
    assert c.get('/api/init').status_code == 401
print('Inactive administrator rejected')
'''
        result = self.subprocess(script)
        self.assertEqual(result.returncode, 0, result.stdout+'\n'+result.stderr)


    def test_session_restores_after_process_restart_and_rotates_cookie(self):
        script = '''
from fastapi.testclient import TestClient
from unittest.mock import patch
import cloud_auth
from server import app

class FakeAdmin:
    def __init__(self, token): self.refresh_token = token
    def query(self, *args, **kwargs): return []

with TestClient(app,base_url='https://studio.example.test') as c:
    with patch.object(cloud_auth,'_verify_admin',return_value=FakeAdmin('initial-refresh-token')):
        login=c.post('/login',data={'email':'admin@example.com','password':'pass'},follow_redirects=False)
    assert login.status_code==303
    old_cookie=c.cookies.get(cloud_auth.COOKIE)
    assert cloud_auth._decode(old_cookie)=='initial-refresh-token'
    assert len(old_cookie)>80 and 'initial-refresh-token' not in old_cookie
    cloud_auth._SESSIONS.clear()  # Simulates a new Render process
    with patch.object(cloud_auth,'_restore_admin',return_value=FakeAdmin('rotated-refresh-token')) as restored:
        init=c.get('/api/init')
        restored.assert_called_once_with('initial-refresh-token')
    assert init.status_code==200 and init.json()['authenticated']
    fresh_cookie=c.cookies.get(cloud_auth.COOKIE)
    assert fresh_cookie!=old_cookie
    assert cloud_auth._decode(fresh_cookie)=='rotated-refresh-token'
    assert c.get('/login',follow_redirects=False).status_code==303
    csrf=init.json()['csrf']
    out=c.post('/api/logout',json={},headers={'X-CSRF-Token':csrf})
    assert out.status_code==200
    assert not c.cookies.get(cloud_auth.COOKIE)
    assert c.get('/api/init').status_code==401
print('Persistent admin cookie rotation and logout passed')
'''
        result=self.subprocess(script)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)

    def test_tampered_or_expired_encrypted_cookie_does_not_authenticate(self):
        script = '''
from fastapi.testclient import TestClient
from server import app
import cloud_auth
with TestClient(app,base_url='https://studio.example.test') as c:
    candidate=cloud_auth._token('offline-rotatable-refresh-token')
    assert cloud_auth._valid(candidate)
    modified=('A' if candidate[0]!='A' else 'B')+candidate[1:]
    assert not cloud_auth._valid(modified)
    c.cookies.set(cloud_auth.COOKIE,modified)
    assert c.get('/api/init').status_code==401
print('Tampered auth cookie rejected')
'''
        result=self.subprocess(script)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)


    def test_redeploy_uses_valid_encrypted_access_without_spending_refresh(self):
        script = '''
from fastapi.testclient import TestClient
from unittest.mock import patch
import time
import cloud_auth
import alezz_fetchv_importer
from server import app

class FakeAdmin:
    def __init__(self):
        self.refresh_token = ''
        self.expires_at = 0
        self.session = type('Session',(),{'headers':{'Authorization':'Bearer valid-jwt-for-test'}})()
    def query(self,*args,**kwargs): return []

with TestClient(app,base_url='https://studio.example.test') as c:
    sealed = cloud_auth._token('saved-refresh-token','valid-jwt-for-test',time.time()+1800)
    c.cookies.set(cloud_auth.COOKIE,sealed)
    assert cloud_auth._session_data(sealed)['access']=='valid-jwt-for-test'
    cloud_auth._SESSIONS.clear()  # Simulate Render restart.
    with patch.object(alezz_fetchv_importer,'Supabase',return_value=FakeAdmin()) as verify:
        with patch.object(cloud_auth,'_restore_admin',side_effect=AssertionError('unexpected refresh')):
            first=c.get('/api/init')
        verify.assert_called_once()
    assert first.status_code==200 and first.json()['authenticated']
    assert c.get('/',follow_redirects=False).status_code==200
    assert c.cookies.get(cloud_auth.COOKIE)
print('Redeploy retained live access without rotating refresh')
'''
        result=self.subprocess(script)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)

    def test_transient_auth_failure_preserves_cookie_and_does_not_demand_login(self):
        script = '''
from fastapi.testclient import TestClient
from unittest.mock import patch
import cloud_auth
from server import app
with TestClient(app,base_url='https://studio.example.test') as c:
    sealed=cloud_auth._token('saved-refresh-token')
    c.cookies.set(cloud_auth.COOKIE,sealed)
    cloud_auth._SESSIONS.clear()
    with patch.object(cloud_auth,'_restore_saved_session',
                      side_effect=cloud_auth.TemporaryAuthError('network temporarily down')):
        page=c.get('/',follow_redirects=False)
    assert page.status_code==503, (page.status_code,page.text)
    assert c.cookies.get(cloud_auth.COOKIE)==sealed
    assert 'جلسة المسؤول محفوظة' in page.text
print('Transient downtime does not force password reentry')
'''
        result=self.subprocess(script)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)

    def test_cloud_mode_rejects_remote_edge_capture(self):
        script = '''
from fastapi.testclient import TestClient
from unittest.mock import patch
from server import app
import cloud_auth
class FakeAdmin:
    refresh_token = 'offline-test-refresh-token'
with TestClient(app,base_url='https://studio.example.test') as c:
    with patch.object(cloud_auth, '_verify_admin', return_value=FakeAdmin()):
        assert c.post('/login',data={'email':'admin@example.com','password':'pass'}).status_code == 200
    csrf=c.get('/api/init').json()['csrf']
    r=c.post('/api/edge-capture',json={'seconds':3},headers={
        'x-csrf-token':csrf,'origin':'https://studio.example.test'})
    assert r.status_code == 503, (r.status_code,r.text)
    assert 'Chromium' in r.text
print('Edge disable test passed')
'''
        # TestClient follows the redirect to '/', so login returns 200.
        result = self.subprocess(script)
        self.assertEqual(result.returncode, 0, result.stdout+'\n'+result.stderr)


if __name__=='__main__': unittest.main()
