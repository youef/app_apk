"""Cloudflare R2 self-service setup from Al Ezz TV Studio.

This module uses only Cloudflare's fixed API host and already-validated account
and bucket identifiers. API tokens never leave server-side encrypted storage.
"""
from __future__ import annotations

import re
from urllib.parse import quote
import requests
import video_storage_settings as settings

API = "https://api.cloudflare.com/client/v4"
RULE_ID = "alezz-studio-multipart-upload"


class CloudflareProvisionError(ValueError):
    pass


def _invoke(token: str, method: str, path: str, body=None, *, missing_ok=False):
    try:
        response = requests.request(
            method, API + path, json=body, timeout=15,
            headers={
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise CloudflareProvisionError("فشل الاتصال بـ Cloudflare API. حاول مجددًا.") from exc
    if missing_ok and response.status_code == 404:
        return None
    try:
        result = response.json()
    except ValueError as exc:
        raise CloudflareProvisionError("أعادت Cloudflare ردًا غير متوقع؛ تأكد من صلاحية الحساب.") from exc
    if response.status_code >= 400 or not result.get("success"):
        codes = [str(x.get("code")) for x in (result.get("errors") or [])
                 if isinstance(x, dict)]
        if "10042" in codes:
            raise CloudflareProvisionError(
                "Cloudflare 10042: خدمة R2 غير مفعلة لهذا الحساب. "
                "افتح R2 في لوحة Cloudflare وأكمل التفعيل أولًا؛ مفاتيحك محفوظة.")
        if response.status_code in (401, 403):
            raise CloudflareProvisionError(
                "Cloudflare رفضت الصلاحيات (HTTP "
                + str(response.status_code)
                + "). أنشئ API Token يملك Workers R2 Storage Write لهذا الحساب.")
        raise CloudflareProvisionError(
            "فشلت عملية Cloudflare (HTTP " + str(response.status_code)
            + (", code " + ",".join(codes[:2]) if codes else "") + ").")
    return result.get("result") or {}


def _configuration(portal):
    row = settings.configuration(portal, "r2")
    if not row:
        raise CloudflareProvisionError("احفظ حساب R2 ومفاتيح S3 ورمز API أولًا.")
    if not row.get("encrypted_management_token"):
        raise CloudflareProvisionError(
            "أدخل Cloudflare API Token واحفظ الإعدادات أولًا لتفعيل التهيئة التلقائية.")
    account = row.get("account_id") or ""
    bucket = row.get("bucket") or ""
    if not re.fullmatch(r"[0-9a-f]{32}", account) or not settings.VALID_BUCKET.fullmatch(bucket):
        raise CloudflareProvisionError("معرّف الحساب أو اسم الحاوية غير صالح.")
    return row, settings.decrypt(row["encrypted_management_token"]), account, bucket


def token_status(portal):
    row, token, account, bucket = _configuration(portal)
    verify = _invoke(token, "GET", "/user/tokens/verify")
    return {
        "ok": verify.get("status") == "active",
        "status": "active" if verify.get("status") == "active" else "inactive",
        "message": (
            "رمز Cloudflare API صالح. اختبر كذلك صلاحيات إنشاء الحاوية، فهي منفصلة."
            if verify.get("status") == "active" else "الرمز غير نشط؛ أنشئ رمزًا جديدًا."),
    }


def configure(portal, origin: str, *, publish_dev: bool = False):
    """Create configured bucket if absent; configure browser multipart CORS.

    Publishing the public development r2.dev domain is a separate explicit
    opt-in because public video access is irreversible for any uploaded object
    until that domain is disabled, and this endpoint is rate-limited.
    """
    row, token, account, bucket = _configuration(portal)
    base = "/accounts/" + account + "/r2/buckets"
    encoded = quote(bucket, safe="")
    present = _invoke(token, "GET", base + "/" + encoded, missing_ok=True)
    created = False
    if present is None:
        _invoke(token, "POST", base, {"name": bucket})
        created = True

    # Cloudflare management API CORS shape differs from S3's native schema.
    rule = {
        "id": RULE_ID,
        "allowed": {
            "origins": [origin],
            "methods": ["GET", "HEAD", "PUT"],
            "headers": ["*"],
        },
        "exposeHeaders": ["ETag", "Content-Length"],
        "maxAgeSeconds": 3600,
    }
    old_cors = _invoke(token, "GET", base + "/" + encoded + "/cors", missing_ok=True)
    previous = (old_cors or {}).get("rules") or []
    rules = [x for x in previous if x.get("id") != RULE_ID]
    rules.append(rule)
    _invoke(token, "PUT", base + "/" + encoded + "/cors", {"rules": rules})

    public_url = row.get("public_base_url") or ""
    published_dev = False
    if publish_dev:
        domain = _invoke(token, "PUT", base + "/" + encoded + "/domains/managed",
                         {"enabled": True})
        value = domain.get("domain") or ""
        if (domain.get("enabled") is not True or
                not re.fullmatch(r"[a-zA-Z0-9.-]+\.r2\.dev", value)):
            raise CloudflareProvisionError(
                "تم تجهيز الحاوية لكن تعذر إرجاع عنوان r2.dev؛ اضبط نطاق القراءة العام يدويًا.")
        public_url = "https://" + value
        published_dev = True
        portal.upstream(
            "PATCH", settings.CONFIG_TABLE, secret=True,
            params={"provider_id": "eq.r2"}, prefer="return=minimal",
            json={"public_base_url": public_url,
                  "enabled": False, "health_status": "unchecked",
                  "health_message": "تم إعداد r2.dev للتجربة. افحص الاتصال قبل التفعيل."})

    return {
        "ok": True,
        "bucket_created": created,
        "public_dev_enabled": published_dev,
        "public_base_url": public_url,
        "message": ("تم إنشاء الحاوية. " if created else "الحاوية موجودة. ")
                   + "تم ضبط CORS للرفع المجزأ. "
                   + ("فُعّل رابط r2.dev التجريبي (غير مناسب لبث كثيف). "
                      if published_dev else
                      "لتشغيل الفيديوهات، أضف نطاق القراءة العام أو فعّل r2.dev للتجربة. ")
                   + "اضغط اختبار الاتصال، ثم التفعيل.",
    }
