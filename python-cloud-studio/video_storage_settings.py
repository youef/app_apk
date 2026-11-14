"""Admin-only encrypted storage provider settings for Al Ezz TV.

Credentials are Fernet-encrypted before storage in a service-role-only Supabase
table. Neither API responses nor GitHub contain provider secrets.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

import requests
from cryptography.fernet import Fernet, InvalidToken
from botocore.exceptions import BotoCoreError, ClientError

VALID_PROVIDERS = ("r2", "b2", "oracle")
CONFIG_TABLE = "/rest/v1/aseel_storage_provider_configs"
MODE_TABLE = "/rest/v1/aseel_storage_distribution_settings"
VALID_BUCKET = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
VALID_REGION = re.compile(r"^[a-z][a-z0-9-]{1,50}$")
VALID_ID = re.compile(r"^[a-zA-Z0-9_+./=@:-]{8,256}$")
DEFAULT_QUOTA = {"r2": 10 * 1024**3, "b2": 10 * 1024**3, "oracle": 20 * 1024**3}
MAX_BYTES = 5 * 1024**4


def _cipher():
    seed = (os.getenv("ALEZZ_STORAGE_SETTINGS_KEY") or os.getenv("ALEZZ_SITE_SECRET")
            or os.getenv("ALEZZ_SUPABASE_SECRET_KEY")
            or os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY"))
    if not seed or len(seed) < 24:
        raise ValueError("يلزم مفتاح حماية قوي داخل إعدادات Render لتشفير مفاتيح مراكز التخزين")
    material = hashlib.sha256(b"alezz:storage-provider-keys:v1:" + seed.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(material))


def encrypt(value: str) -> str:
    return _cipher().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: str) -> str:
    try:
        return _cipher().decrypt(value.encode("ascii")).decode("utf-8")
    except (ValueError, InvalidToken) as exc:
        raise ValueError("تعذّر فك بيانات التخزين المشفرة؛ تحقق من مفتاح تشفير Render") from exc


def configs(portal) -> dict:
    rows = portal.upstream("GET", CONFIG_TABLE, secret=True,
                           params={"select": "*", "limit": "10"})
    return {row["provider_id"]: row for row in rows}


def configuration(portal, name: str):
    return configs(portal).get(name)


def distribution(portal):
    rows = portal.upstream("GET", MODE_TABLE, secret=True,
                           params={"id": "eq.main", "select": "mode,fallback_supabase", "limit": "1"})
    return rows[0] if rows else {"mode": "balanced", "fallback_supabase": True}


def save_distribution(portal, mode: str, fallback_supabase: bool):
    if mode not in ("balanced", "priority"):
        raise ValueError("استراتيجية توزيع غير معروفة")
    rows = portal.upstream("POST", MODE_TABLE, secret=True,
                          prefer="resolution=merge-duplicates,return=representation",
                          json={"id": "main", "mode": mode,
                                "fallback_supabase": fallback_supabase,
                                "updated_at": datetime.now(timezone.utc).isoformat()})
    return {"mode": rows[0]["mode"], "fallback_supabase": rows[0]["fallback_supabase"]}


def _https_url(value: str, *, public=False) -> str:
    value = (value or "").strip().rstrip("/")
    pieces = urlsplit(value)
    host = pieces.hostname or ""
    if (pieces.scheme != "https" or not host or pieces.username or pieces.password
            or pieces.query or pieces.fragment or pieces.port not in (None, 443)
            or " " in value or "\n" in value or "\r" in value
            or ".." in pieces.path or "%" in host):
        raise ValueError("عنوان المركز يجب أن يكون HTTPS عامًا بلا بيانات دخول أو متغيرات")
    if (host in ("localhost", "localhost.localdomain") or host.endswith(".local")
            or host.endswith(".internal") or host.endswith(".localhost")
            or "." not in host or host.replace(".", "").isdigit()
            or not re.fullmatch(r"[a-zA-Z0-9.-]{3,253}", host)):
        raise ValueError("اسم نطاق المركز غير صالح")
    if public:
        return value
    if pieces.path not in ("", "/"):
        raise ValueError("عنوان S3 لا يحتوي على مسار إضافي")
    return value


def canonical(name, *, account_id: str, region: str, endpoint: str):
    if name not in VALID_PROVIDERS:
        raise ValueError("مركز تخزين غير معروف")
    account_id = (account_id or "").strip().lower()
    region = (region or "").strip().lower()
    endpoint = (endpoint or "").strip()
    if name == "r2":
        if not re.fullmatch(r"[0-9a-f]{32}", account_id):
            raise ValueError("معرّف حساب R2 يجب أن يكون 32 حرفًا (Account ID)")
        return ("https://" + account_id + ".r2.cloudflarestorage.com", "auto", account_id)
    if not VALID_REGION.fullmatch(region):
        raise ValueError("أدخل المنطقة بالشكل الصحيح مثل us-west-004 أو me-jeddah-1")
    if name == "b2":
        if not re.fullmatch(r"[a-z]{2}-[a-z]+-[0-9]{3}", region):
            raise ValueError("منطقة B2 يجب أن تكون مثل us-west-004")
        return ("https://s3." + region + ".backblazeb2.com", region, "")
    endpoint = _https_url(endpoint)
    host = urlsplit(endpoint).hostname or ""
    if not ("compat.objectstorage." in host and
            (host.endswith(".oci.customer-oci.com") or
             host.endswith(".oraclecloud.com"))):
        raise ValueError("عنوان Oracle S3 Compatibility يجب أن يكون ضمن نطاق Oracle الرسمي")
    return (endpoint, region, "")


def validate_settings(name, values: dict):
    endpoint, region, account_id = canonical(name,
        account_id=values.get("account_id", ""), region=values.get("region", ""),
        endpoint=values.get("endpoint", ""))
    bucket = (values.get("bucket") or "").strip()
    if (not VALID_BUCKET.fullmatch(bucket) or ".." in bucket
            or ".-" in bucket or "-." in bucket):
        raise ValueError("اسم الحاوية Bucket غير صحيح")
    # R2 managed r2.dev domain may be provisioned after saving credentials;
    # only allow omission for R2. Other providers need a public read URL.
    value = (values.get("public_base_url") or "").strip()
    public_url = _https_url(value, public=True) if value else ""
    if name != "r2" and not public_url:
        raise ValueError("أدخل رابط القراءة العام للفيديوهات عبر HTTPS")
    quota_gb = float(values.get("quota_gb") or 0)
    limit_gb = float(values.get("max_file_gb") or 0)
    if not (0.1 <= quota_gb <= 100000 and 0.01 <= limit_gb <= 5120):
        raise ValueError("حدد سعة تقديرية وحدًا لحجم الملف ضمن القيم المدعومة")
    priority = int(values.get("priority", 50))
    if priority < 1 or priority > 100:
        raise ValueError("الأولوية يجب أن تكون من 1 إلى 100")
    access_key = (values.get("access_key_id") or "").strip()
    secret_key = (values.get("secret_access_key") or "").strip()
    if access_key and not VALID_ID.fullmatch(access_key):
        raise ValueError("معرّف مفتاح الوصول غير صالح")
    if secret_key and (len(secret_key) < 12 or len(secret_key) > 4096):
        raise ValueError("المفتاح السري غير صالح")
    return {
        "provider_id": name, "account_id": account_id,
        "endpoint": endpoint, "region": region, "bucket": bucket,
        "public_base_url": public_url, "quota_bytes": int(quota_gb * 1024**3),
        "max_file_bytes": min(MAX_BYTES, int(limit_gb * 1024**3)),
        "priority": priority,
    }


def save(portal, name: str, values: dict):
    row = validate_settings(name, values)
    current = configuration(portal, name)
    new_access = (values.get("access_key_id") or "").strip()
    new_secret = (values.get("secret_access_key") or "").strip()
    row["encrypted_access_key"] = (
        encrypt(new_access) if new_access else current.get("encrypted_access_key", "") if current else "")
    row["encrypted_secret_key"] = (
        encrypt(new_secret) if new_secret else current.get("encrypted_secret_key", "") if current else "")
    if not row["encrypted_access_key"] or not row["encrypted_secret_key"]:
        raise ValueError("أدخل مفتاح الوصول والمفتاح السري أول مرة")
    management_token = (values.get("management_token") or "").strip()
    if management_token:
        if name != "r2" or not re.fullmatch(r"[A-Za-z0-9_.-]{20,180}", management_token):
            raise ValueError("رمز Cloudflare API غير صالح")
        row["encrypted_management_token"] = encrypt(management_token)
    else:
        row["encrypted_management_token"] = (
            current.get("encrypted_management_token", "") if current else "")
    # Modified connection details invalidate prior test; a fresh positive
    # test is required before re-enabling.
    row.update({"enabled": False, "health_status": "unchecked",
                "health_message": "", "health_checked_at": None,
                "updated_at": datetime.now(timezone.utc).isoformat()})
    portal.upstream("POST", CONFIG_TABLE, secret=True,
        prefer="resolution=merge-duplicates,return=minimal", json=row)
    return public_config(row)


def public_config(row):
    return {
        "provider_id": row["provider_id"], "account_id": row.get("account_id") or "",
        "endpoint": row.get("endpoint") or "", "region": row.get("region") or "",
        "bucket": row.get("bucket") or "",
        "public_base_url": row.get("public_base_url") or "",
        "priority": int(row.get("priority") or 50),
        "quota_gb": round(int(row.get("quota_bytes") or DEFAULT_QUOTA.get(
            row["provider_id"], 10 * 1024**3)) / 1024**3, 2),
        "max_file_gb": round(int(row.get("max_file_bytes") or 50 * 1024**3) / 1024**3, 2),
        "enabled": bool(row.get("enabled", False)),
        "health_status": row.get("health_status") or "unchecked",
        "health_message": row.get("health_message") or "",
        "health_checked_at": row.get("health_checked_at"),
        "has_access_key": bool(row.get("encrypted_access_key")),
        "has_secret_key": bool(row.get("encrypted_secret_key")),
        "has_management_token": bool(row.get("encrypted_management_token")),
    }


def live_provider(row):
    from video_storage import StorageProvider, PROVIDER_INFO
    return StorageProvider(
        name=row["provider_id"], label=PROVIDER_INFO[row["provider_id"]][0],
        endpoint=row["endpoint"], region=row["region"], bucket=row["bucket"],
        access_id=decrypt(row["encrypted_access_key"]),
        secret=decrypt(row["encrypted_secret_key"]),
        public_base_url=row["public_base_url"],
        quota_bytes=int(row["quota_bytes"]),
        max_file_bytes=int(row["max_file_bytes"]),
    )


def _status(portal, name, status, message):
    portal.upstream("PATCH", CONFIG_TABLE, secret=True,
        params={"provider_id": "eq." + name},
        prefer="return=minimal", json={
            "health_status": status, "health_message": message[:220],
            "health_checked_at": datetime.now(timezone.utc).isoformat(),
        })


def _cors_rule(origin):
    return {"ID": "alezz-studio-multipart-upload", "AllowedOrigins": [origin],
            "AllowedMethods": ["PUT", "GET", "HEAD"],
            "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag", "Content-Length"],
            "MaxAgeSeconds": 3600}


def cors_json(origin):
    return [_cors_rule(origin)]


def cors_ready(rules, origin):
    for rule in rules:
        if (origin in rule.get("AllowedOrigins", [])
                and "PUT" in rule.get("AllowedMethods", [])
                and "ETag" in rule.get("ExposeHeaders", [])
                and ("*" in rule.get("AllowedHeaders", []) or
                     "Content-Type" in rule.get("AllowedHeaders", []))):
            return True
    return False


def test_connection(portal, name, origin):
    row = configuration(portal, name)
    if not row:
        raise ValueError("احفظ إعدادات هذا المركز أولًا")
    provider = live_provider(row)
    test_path = "__alezz_test__/" + uuid.uuid4().hex + ".mp4"
    upload_id = None
    try:
        client = provider.client()
        # Probe multipart write and abort permissions, without uploading user data.
        upload_id = client.create_multipart_upload(
            Bucket=provider.bucket, Key=test_path, ContentType="video/mp4")["UploadId"]
        client.abort_multipart_upload(
            Bucket=provider.bucket, Key=test_path, UploadId=upload_id)
        upload_id = None
        cors_ok = False
        try:
            rules = client.get_bucket_cors(Bucket=provider.bucket).get("CORSRules", [])
            cors_ok = cors_ready(rules, origin)
        except (ClientError, BotoCoreError):
            pass
        msg = ("الاتصال وصلاحيات الرفع سليمة. " +
               ("سياسة CORS للمتصفح جاهزة." if cors_ok else
                "سياسة CORS غير مؤكدة؛ استخدم زر تهيئة CORS ثم أعد الاختبار."))
        _status(portal, name, "healthy" if cors_ok else "unchecked", msg)
        return {"ok": True, "cors_ready": cors_ok, "message": msg}
    except (ClientError, BotoCoreError, ValueError) as exc:
        # Never leak credentials, endpoint details, or internal exception strings.
        _status(portal, name, "error", "فشل الاتصال أو صلاحيات الرفع. راجع المنطقة، الحاوية والمفاتيح.")
        return {"ok": False, "cors_ready": False,
                "message": "تعذّر الوصول للحاوية أو إنشاء رفع تجريبي. تحقق من صحة مفاتيح API وصلاحياتها."}
    finally:
        if upload_id is not None:
            try:
                provider.client().abort_multipart_upload(
                    Bucket=provider.bucket, Key=test_path, UploadId=upload_id)
            except (BotoCoreError, ClientError):
                pass


def configure_bucket_cors(portal, name, origin, *, create_bucket=False):
    row = configuration(portal, name)
    if not row:
        raise ValueError("احفظ إعدادات المركز أولًا")
    provider = live_provider(row)
    client = provider.client()
    created = False
    if create_bucket:
        try:
            client.head_bucket(Bucket=provider.bucket)
        except ClientError as err:
            if err.response.get("ResponseMetadata", {}).get("HTTPStatusCode") != 404:
                raise ValueError("لا يمكن التحقق من الحاوية الحالية. أنشئ الحاوية من لوحة الخدمة.") from err
            args = {"Bucket": provider.bucket}
            if name == "b2":
                args["CreateBucketConfiguration"] = {"LocationConstraint": provider.region}
            client.create_bucket(**args)
            created = True
    try:
        existing = client.get_bucket_cors(Bucket=provider.bucket).get("CORSRules", [])
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code not in ("NoSuchCORSConfiguration", "NoSuchCORS", "404"):
            raise ValueError("لا توجد صلاحية لقراءة CORS؛ افتح الحاوية من لوحة المزود.") from exc
        existing = []
    policy = [rule for rule in existing if rule.get("ID") != "alezz-studio-multipart-upload"]
    policy.append(_cors_rule(origin))
    client.put_bucket_cors(Bucket=provider.bucket, CORSConfiguration={"CORSRules": policy})
    return {"ok": True, "created_bucket": created,
            "message": "تم " + ("إنشاء الحاوية و" if created else "") +
                       "تفعيل CORS للرفع المباشر. افحص الاتصال الآن. "
                       "فعّل رابط القراءة العام/النطاق في لوحة المركز إن لم يكن مفعّلًا."}


def set_active(portal, name, enabled):
    row = configuration(portal, name)
    if not row:
        raise ValueError("احفظ بيانات المركز أولًا")
    if enabled and row.get("health_status") != "healthy":
        raise ValueError("افحص اتصال المركز وCORS بنجاح قبل تفعيله")
    portal.upstream("PATCH", CONFIG_TABLE, secret=True,
        params={"provider_id": "eq." + name}, prefer="return=minimal",
        json={"enabled": bool(enabled), "updated_at": datetime.now(timezone.utc).isoformat()})
    return {"ok": True, "enabled": bool(enabled)}


def remove(portal, name):
    # Do not delete cloud objects: disabling a provider is harmless to existing
    # content links; removing credentials only affects future uploads.
    portal.upstream("DELETE", CONFIG_TABLE, secret=True,
                    params={"provider_id": "eq." + name}, prefer="return=minimal")
    return {"ok": True}
