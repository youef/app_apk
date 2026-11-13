"""S3-compatible storage providers for browser-direct multipart MP4 uploads.

Secrets live only in Render environment variables.  No provider key is ever
returned to a browser or stored in GitHub/Supabase.  The browser receives only
short-lived per-part presigned PUT URLs scoped to a random object path.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import quote, urlsplit
from typing import Optional

import boto3
from botocore.config import Config

GIB = 1024 ** 3
PART_BYTES = 24 * 1024 * 1024
PROVIDER_INFO = {
    "r2": ("Cloudflare R2", "https://dash.cloudflare.com/"),
    "b2": ("Backblaze B2", "https://secure.backblaze.com/b2_buckets.htm"),
    "oracle": ("Oracle Object Storage", "https://cloud.oracle.com/object-storage"),
}
VALID_IDS = frozenset(PROVIDER_INFO)


@dataclass(frozen=True)
class StorageProvider:
    name: str
    label: str
    endpoint: str
    region: str
    bucket: str
    access_id: str
    secret: str
    public_base_url: str
    quota_bytes: int
    max_file_bytes: int

    @property
    def ready(self):
        return (
            bool(self.endpoint and self.bucket and self.access_id and
                 self.secret and self.public_base_url and self.quota_bytes > 0)
            and self.endpoint.startswith("https://")
            and self.public_base_url.startswith("https://")
            and not urlsplit(self.public_base_url).query
            and not urlsplit(self.public_base_url).fragment
        )

    def public_url(self, path):
        return self.public_base_url.rstrip("/") + "/" + quote(path, safe="/")

    def client(self):
        if not self.ready:
            raise ValueError("Provider is not configured")
        return boto3.client(
            "s3", endpoint_url=self.endpoint, region_name=self.region,
            aws_access_key_id=self.access_id, aws_secret_access_key=self.secret,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                          retries={"max_attempts": 3, "mode": "standard"}),
        )


def _positive_int(value, default):
    try:
        result = int(value)
        return result if result > 0 else default
    except (ValueError, TypeError):
        return default


def _env(name, suffix, default=""):
    return os.getenv("ALEZZ_" + name.upper() + "_" + suffix, default).strip()


def providers() -> dict[str, StorageProvider]:
    configs = {}
    for name in VALID_IDS:
        region = _env(name, "REGION", "auto" if name == "r2" else "")
        if name == "r2":
            account = _env(name, "ACCOUNT_ID")
            endpoint = _env(name, "ENDPOINT", "https://" + account + ".r2.cloudflarestorage.com" if account else "")
        elif name == "b2":
            endpoint = _env(name, "ENDPOINT", "https://s3." + region + ".backblazeb2.com" if region else "")
        else:
            # OCI endpoint differs with cloud realm; require explicit endpoint.
            endpoint = _env(name, "ENDPOINT")
        label = PROVIDER_INFO[name][0]
        configs[name] = StorageProvider(
            name=name, label=label, endpoint=endpoint, region=region or "us-east-1",
            bucket=_env(name, "BUCKET"), access_id=_env(name, "ACCESS_KEY_ID"),
            secret=_env(name, "SECRET_ACCESS_KEY"),
            public_base_url=_env(name, "PUBLIC_BASE_URL"),
            quota_bytes=_positive_int(_env(name, "QUOTA_BYTES"),
                                      (20 if name == "oracle" else 10) * GIB),
            max_file_bytes=_positive_int(_env(name, "MAX_FILE_BYTES"), 50 * GIB),
        )
    return configs


def provider_usage(portal):
    # Service-role-only view is used to avoid fetching tens of thousands of rows.
    rows = portal.upstream("GET", "/rest/v1/aseel_storage_provider_usage",
                           secret=True, params={"select": "storage_provider,file_count,used_bytes"})
    return {row["storage_provider"]: {
        "file_count": int(row.get("file_count") or 0),
        "used_bytes": int(row.get("used_bytes") or 0)}
        for row in rows}


def summary(portal):
    usage = provider_usage(portal)
    entries = [{
        "id": "supabase", "label": "Supabase Storage", "ready": True,
        "max_file_bytes": int(os.getenv("ALEZZ_STORAGE_MAX_FILE_BYTES", str(50 * 1024 * 1024))),
        "quota_bytes": _positive_int(os.getenv("ALEZZ_SUPABASE_VIDEO_QUOTA_BYTES"), 500 * 1024 * 1024),
        "used_bytes": usage.get("supabase", {}).get("used_bytes", 0),
        "file_count": usage.get("supabase", {}).get("file_count", 0),
        "details": "ملفات صغيرة فقط؛ الباقة المجانية ترفض الملف الأكبر من 50 MB",
    }]
    for name, provider in providers().items():
        entries.append({
            "id": name, "label": provider.label, "ready": provider.ready,
            "max_file_bytes": provider.max_file_bytes,
            "quota_bytes": provider.quota_bytes, "used_bytes": usage.get(name, {}).get("used_bytes", 0),
            "file_count": usage.get(name, {}).get("file_count", 0),
            "details": "جاهز للاستخدام" if provider.ready else "بانتظار إنشاء الحساب وربط مفاتيح الوصول",
            "signup_url": PROVIDER_INFO[name][1],
        })
    return entries


def choose(portal, size_bytes: int, preference: str = "auto"):
    summaries = summary(portal)
    candidates = [
        p for p in summaries if p["ready"] and p["max_file_bytes"] >= size_bytes
        and p["quota_bytes"] >= p["used_bytes"] + size_bytes
    ]
    if preference != "auto":
        selected = next((x for x in candidates if x["id"] == preference), None)
        if not selected:
            raise ValueError(
                "مركز التخزين المحدد غير مفعّل أو لا يدعم حجم الملف أو تجاوز حصته. "
                "اربط حسابه أو اختر التوزيع التلقائي.")
        return selected["id"]
    external = [p for p in candidates if p["id"] != "supabase"]
    if external:
        # Evenly spread across connected services by utilization, while
        # preferring R2 at equal utilization, then B2, then Oracle.
        rank = {"r2": 0, "b2": 1, "oracle": 2}
        return min(external, key=lambda p: (
            (p["used_bytes"] + size_bytes) / max(1, p["quota_bytes"]),
            rank.get(p["id"], 10),
        ))["id"]
    fallback = next((p for p in candidates if p["id"] == "supabase"), None)
    if fallback:
        return "supabase"
    raise ValueError(
        "لا يتوفر مركز تخزين مفعّل بمساحة كافية لهذا الفيديو. "
        "Supabase المجاني يقبل حتى 50 MB للملف؛ "
        "اربط R2 أو B2 أو Oracle من إعدادات Render لمواصلة رفع الملفات الكبيرة.")


def start_multipart(provider: StorageProvider, path: str):
    result = provider.client().create_multipart_upload(
        Bucket=provider.bucket, Key=path,
        ContentType="video/mp4", CacheControl="public,max-age=3600")
    return result["UploadId"]


def presign_part(provider: StorageProvider, path: str, upload_id: str, part_number: int):
    return provider.client().generate_presigned_url(
        ClientMethod="upload_part", Params={
            "Bucket": provider.bucket, "Key": path,
            "UploadId": upload_id, "PartNumber": part_number,
        }, ExpiresIn=600, HttpMethod="PUT")


def finish_multipart(provider: StorageProvider, path: str, upload_id: str, parts: list[dict]):
    client = provider.client()
    return client.complete_multipart_upload(
        Bucket=provider.bucket, Key=path, UploadId=upload_id,
        MultipartUpload={"Parts": parts})


def head_object(provider: StorageProvider, path: str):
    return provider.client().head_object(Bucket=provider.bucket, Key=path)


def abort_multipart(provider: StorageProvider, path: str, upload_id: str):
    return provider.client().abort_multipart_upload(
        Bucket=provider.bucket, Key=path, UploadId=upload_id)
