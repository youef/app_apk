"""Cloud website and persistent crawler smoke tests. No real database writes."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOME = str(Path(__file__).resolve().parent)


class CloudHostingTests(unittest.TestCase):
    def subprocess(self, script, secure=True):
        with tempfile.TemporaryDirectory() as d:
            env = os.environ.copy()
            env.update(ALEZZ_PUBLIC_MODE='1',
                       ALEZZ_SITE_PASSWORD='f3R@m3r_Pw!VeryStrong',
                       ALEZZ_SITE_SECRET='c98b7c2b8799d471ad5c2fe718b3fc15c11dc9d30108ff5ea79eb051f4859fb4',
                       ALEZZ_DATA_DIR=d)
            return subprocess.run([sys.executable, '-c', script], cwd=HOME, env=env,
                                  text=True, capture_output=True, timeout=25)

    def test_public_landing_and_separate_admin_access(self):
        script = """
from fastapi.testclient import TestClient
from unittest.mock import patch
from server import app,portal
with TestClient(app,base_url='https://studio.example.test') as c:
    assert c.get('/healthz').json()['ok']
    assert c.get('/').status_code==200
    assert 'العز' in c.get('/').text
    assert c.get('/api/init').status_code==401
    assert c.get('/studio/',follow_redirects=False).headers['location']=='/account/admin'
    with patch.object(portal,'authenticate',return_value=('admin-id','admin')):
        login=c.post('/account/admin',data={'username':'admin@example.com','password':'safe-password'},
            headers={'origin':'https://studio.example.test'},follow_redirects=False)
    assert login.headers['location']=='/studio/'
    assert c.get('/studio/').status_code==200
    assert c.get('/studio/sources').status_code==200
    j=c.get('/api/init').json()
    assert j['csrf'] and 'catalogue' in j
    assert c.get('/api/series-review').status_code==200
    assert c.get('/api/library-status').status_code==200
    assert c.post('/api/library-start',json={'urls':'https://example.org/library','kind':'series'}).status_code==403
print('Portal smoke passed')
"""
        result=self.subprocess(script)
        self.assertEqual(result.returncode,0,result.stdout+'\\n'+result.stderr)

    def test_rejects_public_site_without_strong_secrets(self):
        env=os.environ.copy()
        env.update(ALEZZ_PUBLIC_MODE='1',ALEZZ_SITE_PASSWORD='123',ALEZZ_SITE_SECRET='notlong')
        result=subprocess.run([sys.executable,'-c','import cloud_auth'],cwd=HOME,env=env,
                              text=True,capture_output=True,timeout=12)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('ALEZZ_SITE_PASSWORD',result.stderr)

    def test_cloud_mode_rejects_remote_edge_capture(self):
        script = """
from fastapi.testclient import TestClient
from unittest.mock import patch
from server import app,portal
with TestClient(app,base_url='https://studio.example.test') as c:
    with patch.object(portal,'authenticate',return_value=('admin-id','admin')):
        c.post('/account/admin',data={'username':'admin@example.com','password':'safe-password'},
            headers={'origin':'https://studio.example.test'})
    csrf=c.get('/api/init').json()['csrf']
    response=c.post('/api/edge-capture',json={'seconds':3},
       headers={'x-csrf-token':csrf,'origin':'https://studio.example.test'})
    assert response.status_code==503,(response.status_code,response.text)
print('Edge capture access verified')
"""
        result=self.subprocess(script)
        self.assertEqual(result.returncode,0,result.stdout+'\\n'+result.stderr)


if __name__=='__main__':unittest.main()
