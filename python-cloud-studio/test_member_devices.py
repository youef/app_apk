"""Offline regression tests for single-device customer enrolment."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from member_devices import DeviceRegistry, friendly_device


class MemberDeviceTests(unittest.TestCase):
    def test_one_registered_browser_survives_database_reopen(self):
        with TemporaryDirectory() as tmp:
            secret='test-secret-for-device-binding-123456789'
            registry=DeviceRegistry(tmp, secret)
            self.assertTrue(registry.register('user-1', 'browser-token-aaaaaaaaaaaaaaaaaaaa', 'Mozilla/5.0 (iPhone)'))
            self.assertTrue(registry.register('user-1', 'browser-token-aaaaaaaaaaaaaaaaaaaa', 'Mozilla/5.0 (iPhone)'))
            self.assertFalse(registry.register('user-1', 'browser-token-bbbbbbbbbbbbbbbbbbbb', 'Android'))
            self.assertTrue(registry.register('user-2', 'browser-token-bbbbbbbbbbbbbbbbbbbb', 'Android'))
            self.assertTrue(registry.matches('user-1', 'browser-token-aaaaaaaaaaaaaaaaaaaa'))
            self.assertFalse(registry.matches('user-1', 'browser-token-bbbbbbbbbbbbbbbbbbbb'))
            # The database may contain an opaque digest but never the original cookie.
            db_text=Path(tmp,'alezz_member_devices.sqlite3').read_bytes()
            self.assertNotIn(b'browser-token-aaaaaaaa', db_text)
            reopened=DeviceRegistry(tmp,secret)
            self.assertTrue(reopened.matches('user-1','browser-token-aaaaaaaaaaaaaaaaaaaa'))
            self.assertEqual(reopened.details(['user-1'])['user-1']['device_name'],'iPhone')
            self.assertEqual(len(reopened.details(['user-1'])['user-1']['device_id']),10)

    def test_admin_reset_invalidates_old_device_and_allows_new(self):
        with TemporaryDirectory() as tmp:
            registry=DeviceRegistry(tmp,'test-secret-for-device-binding-123456789')
            self.assertTrue(registry.register('user-1','old-browser-token-aaaaaaaaaaaaaa','Windows NT'))
            registry.reset('user-1')
            self.assertFalse(registry.matches('user-1','old-browser-token-aaaaaaaaaaaaaa'))
            self.assertTrue(registry.register('user-1','new-browser-token-bbbbbbbbbbbb','Android TV'))
            self.assertFalse(registry.matches('user-1','old-browser-token-aaaaaaaaaaaaaa'))
            self.assertEqual(registry.details(['user-1'])['user-1']['device_name'],'Android TV')

    def test_display_is_a_hardware_label_not_a_mac_address(self):
        self.assertEqual(friendly_device('Mozilla/5.0 (Macintosh; Intel Mac OS X)'),'Mac')
        self.assertEqual(friendly_device('Mozilla/5.0 (Windows NT 10.0)'),'Windows')
        self.assertEqual(friendly_device('Mozilla/5.0 (iPad; CPU OS)'),'iPad')
        self.assertEqual(friendly_device('Mozilla/5.0 (Linux; Android 11; Android TV)'),'Android TV')


if __name__=='__main__':
    unittest.main()
