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
