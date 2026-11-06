"""Regression tests for persistent, hashed, revocable customer sessions."""
import hashlib
import sqlite3
import time
import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from member_sessions import MemberSessions, CUSTOMER_SESSION_SECONDS


class MemberSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.registry = MemberSessions(self.tmp.name)
        self.token = 'u8rBy5xTSjL3v6AaPQ_n8vpMVbYo7yCAwEMu3ZyB9tQ'

    def test_survives_restart_and_hides_raw_token(self):
        self.registry.create(self.token, 'member-one', 'csrf-one')
        reopened = MemberSessions(self.tmp.name)
        entry = reopened.get(self.token)
        self.assertIsNotNone(entry)
        session, renewed = entry
        self.assertEqual(session[0], 'member-one')
        self.assertEqual(session[1], 'customer')
        self.assertEqual(session[3], 'csrf-one')
        self.assertFalse(renewed)
        raw = Path(reopened.path).read_bytes()
        self.assertNotIn(self.token.encode(), raw)
        self.assertIn(hashlib.sha256(self.token.encode()).hexdigest().encode(), raw)
        self.assertIsNone(reopened.get('not-a-valid-token'))
        self.assertIsNone(reopened.get(self.token[:-1] + 'X'))

    def test_signout_and_admin_revoke(self):
        self.registry.create(self.token, 'member-one', 'csrf-one')
        self.registry.delete(self.token)
        self.assertIsNone(self.registry.get(self.token))
        self.registry.create(self.token, 'member-one', 'csrf-two')
        self.registry.revoke_user('member-one')
        self.assertIsNone(self.registry.get(self.token))

    def test_sliding_expiry_renews_after_activity(self):
        self.registry.create(self.token, 'member-one', 'csrf-three')
        digest = hashlib.sha256(self.token.encode()).hexdigest()
        with sqlite3.connect(str(self.registry.path)) as db:
            db.execute('UPDATE member_sessions SET expires_at=? WHERE token_hash=?',
                       (int(time.time()) + 3600, digest))
        restored, renewed = self.registry.get(self.token)
        self.assertTrue(renewed)
        self.assertEqual(restored[0], 'member-one')
        self.assertGreater(restored[2], time.monotonic() + CUSTOMER_SESSION_SECONDS - 10)
        with sqlite3.connect(str(self.registry.path)) as db:
            expiry = db.execute('SELECT expires_at FROM member_sessions WHERE token_hash=?', (digest,)).fetchone()[0]
        self.assertGreater(expiry, int(time.time()) + CUSTOMER_SESSION_SECONDS - 10)

    def test_cookie_format_validation_never_raises(self):
        for token in (None, '', '🍿' * 50, '\x00' * 40, 'a' * 900):
            self.assertIsNone(self.registry.get(token))


if __name__ == '__main__':
    unittest.main()
