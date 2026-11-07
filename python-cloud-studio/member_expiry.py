"""Authoritative customer entitlement dates, set only by the administrator.

Expiry date is inclusive in Saudi Arabia (Asia/Riyadh): access ends at 00:00
on the NEXT calendar day, converted to UTC. Existing older accounts without an
expiry stay unchanged until an administrator assigns one.
"""
from __future__ import annotations
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

SAUDI_ZONE = ZoneInfo("Asia/Riyadh")
EXPIRES_KEY = "alezz_expires_at"
PLAN_DAYS = 90
PLAN_KEY = "alezz_plan_days"
DEVICE_REVOKED_KEY = "alezz_devices_revoked_at"


def expiration_from_date(text, *, today=None):
    if not isinstance(text, str) or len(text) != 10:
        raise ValueError("يجب تحديد تاريخ انتهاء الصلاحية.")
    try:
        chosen = date.fromisoformat(text)
    except ValueError:
        raise ValueError("تاريخ انتهاء الصلاحية غير صحيح.")
    current = today or datetime.now(SAUDI_ZONE).date()
    if chosen < current:
        raise ValueError("تاريخ الانتهاء لا يمكن أن يكون في الماضي.")
    if (chosen - current).days > 365 * 10:
        raise ValueError("الحد الأعلى للصلاحية عشر سنوات.")
    end_of_access = datetime.combine(chosen + timedelta(days=1), time.min, SAUDI_ZONE)
    return end_of_access.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def expiry_epoch(metadata):
    if not isinstance(metadata, dict):
        return 0
    raw = metadata.get(EXPIRES_KEY)
    if raw is None or raw == "":
        return 0  # Previously created accounts require an explicit admin date.
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return 1
        return int(parsed.timestamp())
    except (ValueError, TypeError, OverflowError):
        return 1  # Invalid entitlement means no access, fail closed.


def account_state(metadata, *, now=None):
    if not isinstance(metadata, dict) or metadata.get("alezz_customer") != "active":
        return "disabled"
    expiry = expiry_epoch(metadata)
    from time import time as epoch_now
    return "expired" if expiry and expiry <= (epoch_now() if now is None else now) else "active"


def expiry_date(metadata):
    expiry = expiry_epoch(metadata)
    if expiry == 0:
        return None
    if expiry == 1:
        return "invalid"
    return datetime.fromtimestamp(expiry - 1, SAUDI_ZONE).date().isoformat()


def plan_90_dates(metadata=None, *, today=None):
    """(UTC expiry timestamp, local inclusive expiry date) for a 90-day plan.

    A new/expired subscription includes today as day one. A live subscription
    extends 90 calendar days from its previous inclusive expiry date.
    """
    current = today or datetime.now(SAUDI_ZONE).date()
    old = expiry_date(metadata or {})
    if old and old != "invalid":
        try:
            old_day = date.fromisoformat(old)
        except ValueError:
            old_day = current - timedelta(days=1)
    else:
        old_day = current - timedelta(days=1)
    target = (old_day + timedelta(days=PLAN_DAYS)
              if old_day >= current
              else current + timedelta(days=PLAN_DAYS - 1))
    return expiration_from_date(target.isoformat(), today=current), target.isoformat()


def subscription_summary(metadata, *, today=None):
    """Small, safe, customer-visible summary; never includes credentials."""
    current = today or datetime.now(SAUDI_ZONE).date()
    state = account_state(metadata, now=datetime.combine(current, time.min, SAUDI_ZONE).timestamp()) if today else account_state(metadata)
    date_text = expiry_date(metadata)
    days_left = None
    if date_text and date_text != "invalid":
        days_left = max(0, (date.fromisoformat(date_text) - current).days + 1)
    return {
        "status": state,
        "expires_on": date_text if date_text != "invalid" else None,
        "remaining_days": days_left,
        "plan_days": metadata.get(PLAN_KEY) if isinstance(metadata, dict) and metadata.get(PLAN_KEY) == PLAN_DAYS else None,
        "warning": bool(state == "active" and days_left is not None and days_left <= 7),
    }
