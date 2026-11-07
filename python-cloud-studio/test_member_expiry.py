"""Customer subscription windows are inclusive on the Riyadh date selected by admin."""
import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from member_expiry import expiration_from_date, expiry_epoch, account_state, expiry_date, EXPIRES_KEY, plan_90_dates, subscription_summary

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

    def test_90_day_new_and_expired_start_today(self):
        from datetime import date
        today=date(2026,11,7)
        new,ending=plan_90_dates({},today=today)
        self.assertEqual(ending,"2027-02-04")
        self.assertEqual(expiry_date({EXPIRES_KEY:new}),ending)
        expired,day=plan_90_dates({EXPIRES_KEY:"2025-01-01T21:00:00Z"},today=today)
        self.assertEqual(day,ending)

    def test_90_day_active_renews_without_losing_remaining_days(self):
        from datetime import date
        today=date(2026,11,7)
        current=expiration_from_date("2026-11-20",today=today)
        extended,ending=plan_90_dates({EXPIRES_KEY:current},today=today)
        self.assertEqual(ending,"2027-02-18")
        self.assertEqual(expiry_date({EXPIRES_KEY:extended}),ending)

    def test_subscription_summary_warning_window(self):
        from datetime import date
        today=date(2026,11,7)
        tomorrow=expiration_from_date("2026-11-08",today=today)
        info=subscription_summary({"alezz_customer":"active",EXPIRES_KEY:tomorrow},
                                  today=today)
        self.assertEqual(info["remaining_days"],2)
        self.assertTrue(info["warning"])

    def test_date_validation_and_range(self):
        for invalid in ("", "2026-02-30", "2026-11-07extra", "2026-11-06", "2038-01-01"):
            with self.assertRaises(ValueError):
                expiration_from_date(invalid,today=date(2026,11,7))
        self.assertTrue(expiration_from_date("2026-11-08",today=date(2026,11,7)).endswith("Z"))

if __name__=="__main__":
    unittest.main()
