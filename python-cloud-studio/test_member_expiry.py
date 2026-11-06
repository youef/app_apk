"""Customer subscription windows are inclusive on the Riyadh date selected by admin."""
import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from member_expiry import expiration_from_date, expiry_epoch, account_state, expiry_date, EXPIRES_KEY

class CustomerExpiryTests(unittest.TestCase):
    def test_end_of_selected_day_in_riyadh(self):
        value=expiration_from_date("2026-11-07",today=date(2026,11,7))
        self.assertEqual(value,"2026-11-07T21:00:00Z")
        meta={"alezz_customer":"active",EXPIRES_KEY:value}
        self.assertEqual(expiry_date(meta),"2026-11-07")
        deadline=expiry_epoch(meta)
        self.assertEqual(account_state(meta,now=deadline-1),"active")
        self.assertEqual(account_state(meta,now=deadline),"expired")

    def test_metadata_fail_closed_and_disabled_takes_precedence(self):
        self.assertEqual(account_state({"alezz_customer":"active"}),"active")  # legacy
        self.assertEqual(account_state({"alezz_customer":"active",EXPIRES_KEY:"bad"}),"expired")
        self.assertEqual(account_state({"alezz_customer":"disabled"}),"disabled")
        self.assertEqual(account_state({"alezz_customer":"disabled",EXPIRES_KEY:"bad"}),"disabled")
        self.assertEqual(account_state({"alezz_customer":"active",EXPIRES_KEY:None}),"active")

    def test_date_validation_and_range(self):
        for invalid in ("", "2026-02-30", "2026-11-07extra", "2026-11-06", "2038-01-01"):
            with self.assertRaises(ValueError):
                expiration_from_date(invalid,today=date(2026,11,7))
        self.assertTrue(expiration_from_date("2026-11-08",today=date(2026,11,7)).endswith("Z"))

if __name__=="__main__":
    unittest.main()
