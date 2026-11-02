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

    def test_web_login_flow_and_state(self):
        script = '''
import os
from pathlib import Path
from fastapi.testclient import TestClient
from server import app
with TestClient(app,base_url='https://studio.example.test') as c:
    assert c.get('/healthz').json()['ok']
    assert c.get('/',follow_redirects=False).status_code==303
    assert c.get('/api/init').status_code==401
    assert 'دخول' in c.get('/login').text
    assert 'غير صحيحة' in c.post('/login',data={'password':'bad'}).text
    login=c.post('/login',data={'password':os.environ['ALEZZ_SITE_PASSWORD']},follow_redirects=False)
    assert login.status_code==303,login.status_code
    assert 'secure' in login.headers['set-cookie'].lower()
    assert c.get('/').status_code==200
    j=c.get('/api/init').json()
    assert j['csrf'] and 'catalogue' in j
    assert c.get('/api/library-status').status_code==200
    assert c.post('/api/library-start',json={'urls':'https://example.org/library','kind':'series'}).status_code==403
    assert Path(os.environ['ALEZZ_DATA_DIR'],'library_sync.sqlite3').exists()
    logout=c.post('/logout-site',follow_redirects=False)
    assert logout.status_code==303
    assert c.get('/api/init').status_code==401
print('Cloud auth test passed')
'''
        result = self.subprocess(script)
        self.assertEqual(result.returncode, 0, result.stdout+'\n'+result.stderr)

    def test_rejects_public_site_without_strong_secrets(self):
        env=os.environ.copy()
        env.update(ALEZZ_PUBLIC_MODE='1',ALEZZ_SITE_PASSWORD='123',ALEZZ_SITE_SECRET='notlong')
        result=subprocess.run([sys.executable,'-c','import cloud_auth'],cwd=HOME,env=env,
                              text=True,capture_output=True,timeout=12)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('ALEZZ_SITE_PASSWORD',result.stderr)

    def test_cloud_mode_rejects_remote_edge_capture(self):
        script='''
from fastapi.testclient import TestClient
from server import app
import os
with TestClient(app,base_url='https://studio.example.test') as c:
    c.post('/login',data={'password':os.environ['ALEZZ_SITE_PASSWORD']})
    csrf=c.get('/api/init').json()['csrf']
    r=c.post('/api/edge-capture',json={'seconds':3},headers={'x-csrf-token':csrf, 'origin':'https://studio.example.test'})
    assert r.status_code==400, (r.status_code,r.text)
    assert 'Edge' in r.text
print('Edge disable test passed')
'''
        result=self.subprocess(script)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)


if __name__=='__main__':unittest.main()
