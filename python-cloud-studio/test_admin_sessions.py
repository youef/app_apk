"""Focused regression tests for restart-safe administrator logins."""
import hashlib
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import member_sessions as sessions


class AdminSessionTests(unittest.TestCase):
    def test_survives_recreation_without_storing_cookie_plaintext(self):
        with tempfile.TemporaryDirectory() as directory:
            token = 'A' * 43
            store = sessions.AdminSessions(directory)
            store.create(token, 'admin-uid', 'csrf-secret')
            restored = sessions.AdminSessions(directory)
            result = restored.get(token)
            self.assertIsNotNone(result)
            self.assertEqual(result[0][0:2], ('admin-uid', 'admin'))
            self.assertFalse(result[1])
            self.assertFalse(result[2])
            database = pathlib.Path(directory, 'alezz_member_sessions.sqlite3').read_bytes()
            self.assertNotIn(token.encode(), database)
            self.assertIn(hashlib.sha256(token.encode()).hexdigest().encode(), database)
            self.assertIsNone(restored.get('invalid-cookie'))

    def test_refreshes_before_expiry_and_enforces_absolute_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            base = 1_800_000_000
            store = sessions.AdminSessions(directory)
            with patch.object(sessions.time, 'time', return_value=base):
                store.create('B' * 43, 'uid', 'csrf')
            with patch.object(sessions.time, 'time', return_value=base + 24 * 86400):
                result = store.get('B' * 43)
            self.assertTrue(result[1])
            # Rolling admin sessions renew near the 30-day idle deadline,
            # but must never outlive the 180-day absolute authentication cap.
            for day in (48, 72, 96, 120, 144, 168, 179):
                with patch.object(sessions.time, 'time', return_value=base + day * 86400):
                    self.assertIsNotNone(store.get('B' * 43), 'Session expired prematurely on day ' + str(day))
            with patch.object(sessions.time, 'time', return_value=base + 180 * 86400):
                self.assertIsNone(store.get('B' * 43))

    def test_periodic_role_recheck_and_explicit_revocation(self):
        with tempfile.TemporaryDirectory() as directory:
            base = 1_800_000_000
            store = sessions.AdminSessions(directory)
            with patch.object(sessions.time, 'time', return_value=base):
                store.create('C' * 43, 'uid', 'csrf')
            with patch.object(sessions.time, 'time', return_value=base + sessions.ADMIN_ROLE_RECHECK_SECONDS + 1):
                self.assertTrue(store.get('C' * 43)[2])
                store.mark_verified('C' * 43)
                self.assertFalse(store.get('C' * 43)[2])
            store.revoke_user('uid')
            self.assertIsNone(store.get('C' * 43))


if __name__ == '__main__':
    unittest.main()
