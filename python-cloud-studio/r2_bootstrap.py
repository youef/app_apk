"""One-shot Cloudflare R2 account bootstrap; activated only via Render env flag.

Creates a dedicated upload bucket, configures browser CORS, enables an r2.dev
*development* read URL, verifies a test video, and registers encrypted
credentials in the admin-only settings table. Never logs any secrets.
"""
from __future__ import annotations

import logging
import os
import re
import time
import uuid
from urllib.parse import quote

import boto3
import requests
from botocore.config import Config

import video_storage_settings as settings

log = logging.getLogger("alezz.r2.setup")
CF_API = "https://api.cloudflare.com/client/v4"
APP_ORIGIN = "https://app-apk-oquy.onrender.com"


def _api(token: str, method: str, path: str, payload=None, *, allow_missing=False):
    response = requests.request(
        method, CF_API + path,
        headers={"Authorization": "Bearer " + token,
                 "Accept": "application/json",
                 "Content-Type": "application/json"},
        json=payload, timeout=14)
    if allow_missing and response.status_code == 404:
        return None
    try:
        data = response.json()
    except (ValueError, TypeError):
        raise RuntimeError("Cloudflare API response invalid status=" + str(response.status_code))
    if response.status_code >= 400 or not data.get("success"):
        err_codes = [str(e.get("code")) for e in data.get("errors", []) if isinstance(e, dict)]
        raise RuntimeError("Cloudflare API denied status=" + str(response.status_code)
                           + " codes=" + ",".join(err_codes[:3]))
    return data.get("result")


def bootstrap(portal):
    if os.getenv("ALEZZ_R2_BOOTSTRAP") != "1":
        return
    step = "environment"
    try:
        account = os.getenv("ALEZZ_R2_ACCOUNT_ID", "").strip()
        access = os.getenv("ALEZZ_R2_ACCESS_KEY_ID", "").strip()
        secret = os.getenv("ALEZZ_R2_SECRET_ACCESS_KEY", "").strip()
        api_token = os.getenv("ALEZZ_CF_API_TOKEN", "").strip()
        bucket = os.getenv("ALEZZ_R2_BUCKET", "alezz-tv-videos").strip()
        if (not re.fullmatch(r"[0-9a-f]{32}", account)
                or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket)
                or len(access) < 16 or len(secret) < 30 or not api_token.startswith("cfat_")):
            raise ValueError("Missing/invalid Cloudflare bootstrap environment")

        existing = settings.configuration(portal, "r2")
        if existing and existing.get("enabled") and existing.get("health_status") == "healthy":
            log.warning("ALEZZ_R2_SETUP status=ALREADY_ACTIVE bucket=%s", bucket)
            return

        # Persist all provided S3 credentials encrypted before testing the
        # Cloudflare subscription. This lets the owner finish account
        # activation later without pasting secret keys into chat again.
        step = "pending_credentials"
        staged = {
            "provider_id": "r2",
            "account_id": account,
            "endpoint": "https://" + account + ".r2.cloudflarestorage.com",
            "region": "auto", "bucket": bucket,
            "public_base_url": (existing or {}).get("public_base_url") or "",
            "encrypted_access_key": settings.encrypt(access),
            "encrypted_secret_key": settings.encrypt(secret),
            "enabled": False, "priority": 1,
            "quota_bytes": 10 * 1024**3,
            "max_file_bytes": 50 * 1024**3,
            "health_status": "unchecked",
            "health_message": "المفاتيح محفوظة مشفرة؛ بانتظار تفعيل R2 وإنشاء الحاوية والرابط العام.",
        }
        portal.upstream("POST", "/rest/v1/aseel_storage_provider_configs",
                        secret=True,
                        prefer="resolution=merge-duplicates,return=minimal",
                        json=staged)
        log.warning("ALEZZ_R2_SETUP credentials=ENCRYPTED_STAGED")

        path = "/accounts/" + account + "/r2/buckets"
        step = "bucket"
        current = _api(api_token, "GET", path + "/" + quote(bucket, safe=""), allow_missing=True)
        if current is None:
            _api(api_token, "POST", path, {"name": bucket, "storage_class": "Standard"})
            log.warning("ALEZZ_R2_SETUP bucket=CREATED")
        else:
            log.warning("ALEZZ_R2_SETUP bucket=EXISTING")

        step = "managed_domain"
        result = _api(api_token, "PUT", path + "/" + quote(bucket, safe="") +
                      "/domains/managed", {"enabled": True})
        domain = str((result or {}).get("domain") or "")
        if not (re.fullmatch(r"[a-z0-9-]{3,110}[.]r2[.]dev", domain)
                and (result or {}).get("enabled") is True):
            raise ValueError("Cloudflare didn't provide an enabled managed domain")
        public_base = "https://" + domain
        log.warning("ALEZZ_R2_SETUP domain=ENABLED")

        step = "credentials_save"
        provider_settings = {
            "account_id": account, "region": "auto",
            "endpoint": "https://" + account + ".r2.cloudflarestorage.com",
            "bucket": bucket, "public_base_url": public_base,
            "access_key_id": access, "secret_access_key": secret,
            "quota_gb": 10, "max_file_gb": 50, "priority": 1,
        }
        settings.save(portal, "r2", provider_settings)
        log.warning("ALEZZ_R2_SETUP credentials=ENCRYPTED_AND_SAVED")

        step = "cors"
        # Work with the S3-compatible API; CORS uses the signed S3 credentials.
        settings.configure_bucket_cors(portal, "r2", APP_ORIGIN)
        log.warning("ALEZZ_R2_SETUP cors=CONFIGURED")

        step = "s3_test"
        test = settings.test_connection(portal, "r2", APP_ORIGIN)
        if not (test.get("ok") and test.get("cors_ready")):
            raise RuntimeError("S3 multipart/CORS verification failed")
        log.warning("ALEZZ_R2_SETUP multipart=VERIFIED")

        step = "public_read_test"
        s3 = boto3.client(
            "s3", endpoint_url=provider_settings["endpoint"],
            region_name="auto", aws_access_key_id=access,
            aws_secret_access_key=secret,
            config=Config(signature_version="s3v4",
                          s3={"addressing_style": "path"}))
        key = "__alezz_test__/" + uuid.uuid4().hex + ".mp4"
        # Small ISO-BMFF sample to verify public read and HTTP Range.
        sample = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isommp41"
        try:
            s3.put_object(Bucket=bucket, Key=key, Body=sample,
                          ContentType="video/mp4")
            url = public_base + "/" + key
            served = False
            for attempt in range(4):
                resp = requests.get(url, headers={
                    "Origin": APP_ORIGIN, "Range": "bytes=0-23"}, timeout=14)
                if (resp.status_code in (200, 206) and resp.content == sample
                        and resp.headers.get("Access-Control-Allow-Origin") == APP_ORIGIN):
                    served = True
                    break
                time.sleep(1.3)
            if not served:
                raise RuntimeError("Public read/CORS test did not pass")
        finally:
            try:
                s3.delete_object(Bucket=bucket, Key=key)
            except Exception:
                log.warning("ALEZZ_R2_SETUP test_object_cleanup=FAILED")
        log.warning("ALEZZ_R2_SETUP public_video=VERIFIED")

        step = "enable"
        settings.set_active(portal, "r2", True)
        log.warning("ALEZZ_R2_SETUP status=ACTIVE_READY provider=r2 bucket=%s",
                    bucket)
    except Exception as exc:
        # Never print the access key, secret, bearer token, raw HTTP body,
        # request headers or traceback; only safe step/type markers.
        safe = str(exc) if (isinstance(exc, RuntimeError)
                            and str(exc).startswith("Cloudflare API ")) else "-"
        if "status=403" in safe and "10042" in safe:
            try:
                settings._status(
                    portal, "r2", "error",
                    "Cloudflare 10042: يلزم تفعيل اشتراك R2 من لوحة Cloudflare "
                    "ثم إنشاء حاوية الفيديو وتفعيل نطاق القراءة العام. المفاتيح محفوظة مشفرة.")
            except Exception:
                pass
        log.error("ALEZZ_R2_SETUP status=INCOMPLETE stage=%s error_type=%s safe_error=%s",
                  step, type(exc).__name__, safe)
