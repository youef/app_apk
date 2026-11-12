"""Al Ezz Security Center: bounded, read-only checks of verified public websites.

No exploits, credential stuffing, brute force, port scans, form submission,
redirect following, file downloading, or private-network requests.
This is a diagnostic audit, not a guarantee that a site is secure.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from requests.adapters import HTTPAdapter
from urllib3 import PoolManager
from urllib3.connection import HTTPSConnection
from urllib3.connectionpool import HTTPSConnectionPool
from urllib3.exceptions import NewConnectionError
from urllib3.util.connection import create_connection

router = APIRouter()
BASE = Path(__file__).resolve().parent
ROOT = Path(os.getenv("ALEZZ_DATA_DIR", str(BASE))).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
DB = ROOT / "security_center.sqlite3"
VERIFY_PATH = "/.well-known/alezz-security-verification.txt"
AGENT = "AlEzzSecurityCenter/1.0 (authorized read-only website audit)"
POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="alezz-security")
RUNNING: dict[str, dict] = {}
RUN_LOCK = threading.RLock()
STOP = threading.Event()
MAX_BYTES = 128 * 1024
TIMEOUT = (4, 8)


def iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def public_host(raw):
    try:
        parsed = urlsplit(raw.strip())
        host = (parsed.hostname or "").rstrip(".").lower().encode("idna").decode("ascii")
        if (parsed.scheme != "https" or parsed.username or parsed.password or
                parsed.port not in (None, 443) or not host or len(raw) > 2048 or
                not re.fullmatch(r"[a-z0-9][a-z0-9.-]{2,250}", host) or
                "." not in host or ".." in host or
                host.endswith((".localhost", ".local", ".lan", ".internal",
                               ".test", ".invalid", ".onion", ".home.arpa")) or
                host == "localhost"):
            raise ValueError("أدخل نطاق موقع عامًا يبدأ بـ https:// بدون منفذ خاص.")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError("روابط IP غير مقبولة في الفحص السحابي.")
        return host
    except (ValueError, TypeError, UnicodeError) as exc:
        raise ValueError(str(exc) if isinstance(exc, ValueError) else "رابط غير صحيح.") from None


def public_addresses(host, port=443):
    try:
        found = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError("تعذر حل اسم النطاق عبر DNS.") from exc
    if not found:
        raise ValueError("لا توجد عناوين DNS للموقع.")
    addresses = list(dict.fromkeys(entry[4][0] for entry in found))
    if any(not ipaddress.ip_address(addr).is_global for addr in addresses):
        raise ValueError("تم رفض نطاق يشير إلى شبكة خاصة أو داخلية.")
    return addresses


class PublicHTTPSConnection(HTTPSConnection):
    """Pin each TCP connection to a freshly validated public DNS address.

    TLS hostname verification still uses the original domain. No proxy is used.
    This closes the validate-then-re-resolve DNS rebinding gap.
    """
    def _new_conn(self):
        host = self._dns_host
        port = self.port or 443
        try:
            addresses = public_addresses(host, port)
        except ValueError as exc:
            raise NewConnectionError(self, str(exc)) from exc
        last_error = None
        for addr in addresses:
            try:
                return create_connection(
                    (addr, port), timeout=self.timeout,
                    source_address=self.source_address,
                    socket_options=self.socket_options,
                )
            except OSError as exc:
                last_error = exc
        raise NewConnectionError(self, "Public HTTPS connection failed") from last_error


class PublicHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = PublicHTTPSConnection


class PublicPoolManager(PoolManager):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pool_classes_by_scheme = {"https": PublicHTTPSPool}


class PublicAdapter(HTTPAdapter):
    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        self.poolmanager = PublicPoolManager(
            num_pools=connections, maxsize=maxsize, block=block, **pool_kwargs
        )


def safe_get(host, path="/", *, origin=None, max_bytes=MAX_BYTES):
    if not path.startswith("/") or path.startswith("//") or any(c in path for c in "\r\n"):
        raise ValueError("مسار غير صالح")
    public_addresses(host)
    with requests.Session() as client:
        client.trust_env = False
        client.mount("https://", PublicAdapter(pool_connections=1, pool_maxsize=1))
        headers = {"User-Agent": AGENT, "Accept": "text/html,text/plain,application/json,*/*;q=0.2",
                   "Range": f"bytes=0-{max_bytes - 1}"}
        if origin:
            headers["Origin"] = origin
        with client.get("https://" + host + path, headers=headers, timeout=TIMEOUT,
                        stream=True, allow_redirects=False, verify=True) as response:
            data = bytearray()
            for chunk in response.iter_content(chunk_size=8192):
                data.extend(chunk[:max(0, max_bytes - len(data))])
                if len(data) >= max_bytes:
                    break
            return response.status_code, dict(response.headers), bytes(data)


def database():
    db = sqlite3.connect(DB, timeout=12)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=12000")
    return db


def init_db():
    with database() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS sites (
          id TEXT PRIMARY KEY, uid TEXT NOT NULL, host TEXT NOT NULL, token TEXT NOT NULL,
          created_at TEXT NOT NULL, verified_at TEXT, interval_hours INTEGER NOT NULL DEFAULT 0,
          last_run TEXT, next_run REAL NOT NULL DEFAULT 0,
          UNIQUE(uid, host))""")
        db.execute("""CREATE TABLE IF NOT EXISTS audits (
          id TEXT PRIMARY KEY, site_id TEXT NOT NULL, created_at TEXT NOT NULL,
          payload TEXT NOT NULL, FOREIGN KEY(site_id) REFERENCES sites(id))""")
        db.execute("CREATE INDEX IF NOT EXISTS idx_audits_site ON audits(site_id, created_at DESC)")


init_db()


def record(severity, title, detail, fix, evidence=""):
    return {"severity": severity, "title": title, "detail": detail,
            "fix": fix, "evidence": evidence[:240]}


def audit(host):
    """15 or fewer bounded GET requests, all HTTPS, same verified hostname."""
    public_addresses(host)
    results = []
    meta = {"host": host, "url": "https://" + host, "started_at": iso(),
            "engine": "Al Ezz passive + read-only web checks",
            "checks": [], "platform": "غير محدد", "http_status": None}

    def add(level, title, detail, fix, evidence=""):
        results.append(record(level, title, detail, fix, evidence))

    try:
        status, headers, body = safe_get(host, "/")
    except (ValueError, requests.RequestException, OSError) as exc:
        add("high", "تعذّر الاتصال الآمن بالموقع",
            "تعذّر إتمام طلب HTTPS موثوق من خادم Render.",
            "تحقق من DNS، شهادة TLS، إعدادات الجدار الناري وتوفر الموقع.",
            type(exc).__name__)
        return finish(meta, results)
    meta["http_status"] = status
    meta["checks"].append("HTTPS / TLS / HTTP status")
    if 300 <= status < 400:
        add("medium", "تحويل من الصفحة الرئيسية",
            "عاد الموقع بتحويل HTTP ولم يُتبع التحويل إلى نطاق آخر.",
            "أضف النطاق النهائي نفسه للمركز وأثبت ملكيته.",
            "HTTP " + str(status))
    elif status >= 400:
        add("medium", "الصفحة الرئيسية تعيد خطأ HTTP",
            "قد يكون هناك منع وصول من Render أو خطأ في الخادم.",
            "راجع سجلات الخادم وقواعد WAF.",
            "HTTP " + str(status))

    h = {k.lower(): v for k, v in headers.items()}
    is_html = "html" in h.get("content-type", "").lower()
    html = body.decode("utf-8", "replace") if is_html else ""
    if not h.get("strict-transport-security"):
        add("medium", "غياب HSTS", "لا يطلب الموقع من المتصفحات تذكر اتصال HTTPS.",
            "فعّل Strict-Transport-Security بعد التأكد من دعم HTTPS لجميع النطاقات الفرعية.")
    elif "max-age" not in h["strict-transport-security"].lower():
        add("low", "صيغة HSTS غير مكتملة", "لم يظهر max-age ضمن سياسة HSTS.",
            "استخدم صيغة HSTS صحيحة.", h["strict-transport-security"][:120])
    if not h.get("content-security-policy"):
        add("medium", "غياب Content-Security-Policy",
            "لا توجد سياسة CSP لتقييد مصادر المحتوى في الاستجابة.",
            "ابدأ بسياسة CSP بوضع Report-Only ثم اضبط القيود بشكل تدريجي.")
    if not h.get("x-content-type-options", "").lower().startswith("nosniff"):
        add("low", "غياب X-Content-Type-Options",
            "قد يحاول المتصفح تخمين أنواع الملفات.",
            "أضف X-Content-Type-Options: nosniff.")
    if not (h.get("x-frame-options") or
            "frame-ancestors" in h.get("content-security-policy", "").lower()):
        add("medium", "غياب منع التضمين داخل iframe",
            "لم يظهر X-Frame-Options أو CSP frame-ancestors.",
            "أضف frame-ancestors ملائمًا أو X-Frame-Options: DENY/SAMEORIGIN.")
    if not h.get("referrer-policy"):
        add("low", "غياب Referrer-Policy",
            "لم يُحدد مستوى مشاركة عنوان الصفحة مع المواقع الأخرى.",
            "أضف Referrer-Policy: strict-origin-when-cross-origin.")
    if not h.get("permissions-policy"):
        add("info", "سياسة أذونات المتصفح غير محددة",
            "لم يظهر Permissions-Policy؛ قد يكون ذلك مقبولًا حسب الموقع.",
            "حدد صلاحيات الكاميرا والميكروفون والموقع حسب الحاجة.")
    if re.search(r"(?:php/|apache/|nginx/)[\d.]+", " ".join(
            [h.get("server", ""), h.get("x-powered-by", "")]), re.I):
        add("low", "إظهار إصدار تقنية الخادم",
            "ترويسات الاستجابة تكشف إصدار برنامج أو إطار تشغيل.",
            "قلّل معلومات Server و X-Powered-By.")
    cookies = headers.get("Set-Cookie", "")
    if cookies:
        cookie_name = cookies.split("=", 1)[0].strip()[:48]
        attrs = cookies.lower()
        for flag in ("secure", "httponly", "samesite"):
            if not re.search(r"(?:^|;)\s*" + flag + r"(?:\s*[=;]|$)", attrs):
                add("medium" if flag == "secure" else "low",
                    "خاصية Cookie غير مفعلة: " + flag,
                    "أول ملف تعريف ارتباط في الاستجابة لا يعلن هذه الخاصية.",
                    "حدّث إعدادات الكوكيز الحساسة لدى الخادم.",
                    "Cookie: " + cookie_name)
    meta["checks"].append("Security headers and cookie flags")

    if re.search(r"wp-content/|wp-includes/|wordpress", html, re.I):
        meta["platform"] = "WordPress"
    elif re.search(r"phpbb|phpBB", html, re.I):
        meta["platform"] = "phpBB"
    elif re.search(r"xenforo", html, re.I):
        meta["platform"] = "XenForo"
    elif re.search(r"vbulletin", html, re.I):
        meta["platform"] = "vBulletin"
    elif re.search(r"mybb|mybb_credits", html, re.I):
        meta["platform"] = "MyBB"
    elif re.search(r"discourse", html, re.I):
        meta["platform"] = "Discourse"
    elif re.search(r"drupal", html, re.I):
        meta["platform"] = "Drupal"
    elif re.search(r"joomla", html, re.I):
        meta["platform"] = "Joomla"
    elif re.search(r"laravel", html, re.I) or "laravel_session=" in headers.get("Set-Cookie","").lower():
        meta["platform"] = "Laravel"
    meta["checks"].append("Platform fingerprint (non-exploit)")

    try:
        s, ch, _ = safe_get(host, "/", origin="https://alezz-security-check.invalid", max_bytes=1024)
        cors = {k.lower(): v for k, v in ch.items()}
        reflected = cors.get("access-control-allow-origin", "") == "https://alezz-security-check.invalid"
        credentialed = cors.get("access-control-allow-credentials", "").lower() == "true"
        if reflected and credentialed:
            add("high", "CORS يعكس مصدرًا عشوائيًا مع بيانات الاعتماد",
                "قد تسمح السياسة لمواقع أخرى بقراءة استجابات مستخدمين مسجلين.",
                "طبّق قائمة محددة وموثوقة من Origins ولا تعكس أصل الطلب دون تحقق.")
        elif cors.get("access-control-allow-origin") == "*":
            add("info", "CORS يسمح بالأصول العامة",
                "ترويسة Access-Control-Allow-Origin تستخدم النجمة.",
                "تحقق من أن الموارد المعروضة عامة فعلًا، ولا تسمح بالاعتماد مع النجمة.")
        meta["checks"].append("CORS response-policy probe")
    except (ValueError, requests.RequestException, OSError):
        meta["checks"].append("CORS probe unavailable")

    if meta["platform"] == "WordPress":
        try:
            s, ch, data = safe_get(host, "/wp-json/", max_bytes=4096)
            if s == 200 and b'"namespaces"' in data:
                meta["checks"].append("WordPress REST API detected")
                add("info", "واجهة WordPress REST API متاحة",
                    "إتاحة REST API ليست ثغرة بحد ذاتها.",
                    "راجع صلاحيات واجهات REST والإضافات دون تعطيل ما يحتاجه الموقع.")
        except (ValueError, requests.RequestException, OSError):
            pass

    checks = (
        ("/.git/HEAD", b"ref: refs/", "كشف مرجع مستودع Git",
         "منع تقديم مجلد .git عبر الخادم فورًا."),
        ("/.env", b"APP_KEY=", "ملف إعدادات بيئة مكشوف",
         "امنع الوصول إلى .env، غيّر الأسرار التي قد تكون تعرضت، وراجع السجلات."),
        ("/wp-config.php.bak", b"DB_NAME", "نسخة إعدادات WordPress مكشوفة",
         "احذف النسخة المكشوفة من مجلد الويب، ودوّر بيانات قاعدة البيانات."),
        ("/phpinfo.php", b"phpinfo()", "صفحة phpinfo متاحة",
         "احذف صفحة phpinfo من الخادم الإنتاجي."),
    )
    for path, marker, title, fix in checks:
        try:
            code, response_headers, data = safe_get(host, path, max_bytes=4096)
            if code in (200, 206) and marker.lower() in data.lower():
                add("critical", title,
                    "أظهر فحص قراءة محدود بصمة متوافقة مع ملف حساس؛ لم تُحفظ محتوياته.",
                    fix, path)
        except (ValueError, requests.RequestException, OSError):
            pass
    meta["checks"].append("4 common public exposure paths (no secrets stored)")

    for path, name in (("/robots.txt", "robots.txt"),
                       ("/.well-known/security.txt", "security.txt")):
        try:
            code, _, _ = safe_get(host, path, max_bytes=2048)
            if code in (200, 206):
                meta["checks"].append(name + " present")
            elif name == "security.txt":
                add("info", "ملف security.txt غير متوفر",
                    "لم يُعثر على معلومات الإفصاح المسؤول بالمسار القياسي.",
                    "أضف security.txt يحدد وسيلة اتصال وتاريخ انتهاء الصلاحية.")
        except (ValueError, requests.RequestException, OSError):
            meta["checks"].append(name + " unavailable")
    meta["checks"].append("Certificate verified by TLS client")
    return finish(meta, results)


def finish(meta, findings):
    weights = {"critical": 30, "high": 18, "medium": 7, "low": 2, "info": 0}
    counts = {s: sum(x["severity"] == s for x in findings)
              for s in ("critical", "high", "medium", "low", "info")}
    return {**meta, "finished_at": iso(), "findings": findings, "counts": counts,
            "indicator": max(0, 100 - sum(weights[x["severity"]] for x in findings)),
            "disclaimer": "مؤشر إعدادات تقريبي، وليس نسبة أمان أو اختبار اختراق شامل.",
            "manual_review": [
                "اختبر تسجيل الدخول وتحديد المحاولات وMFA على حسابات تجريبية.",
                "راجع الصلاحيات ومنع IDOR بين حسابات اختبار مختلفة.",
                "راجع XSS وSQL injection وCSRF عبر مراجعة الكود وبيئة اختبار مرخصة.",
                "افحص رفع الملفات وتخزينها وعزلها عن التنفيذ.",
                "حدّث WordPress والمنتدى والقوالب والإضافات وافحص ثغرات إصداراتها.",
                "راجع النسخ الاحتياطية ومراقبة السجلات والأسرار وصلاحيات الخادم.",
                "اختبر أمان واجهات API وقيود المعدلات بالتنسيق مع مالك الخدمة.",
            ]}


def verify(host, token):
    code, _, data = safe_get(host, VERIFY_PATH, max_bytes=512)
    return code == 200 and data.decode("utf-8", "replace").strip() == token


def require_admin(request, portal, write=False):
    from private_film_import import owner
    uid = owner(request, portal)
    if write:
        expected = str(request.base_url).rstrip("/")
        token = request.cookies.get("alezz_member", "")
        found = portal.admin_sessions.get(token)
        if (request.headers.get("origin") != expected or not found or
                not secrets.compare_digest(request.headers.get("x-csrf-token", ""), found[0][3])):
            raise HTTPException(403, "أصل الطلب أو رمز CSRF غير صحيح.")
    return uid


REMOTE_PORTAL = None

def _has_cloud():
    return bool(REMOTE_PORTAL and (
        os.getenv("ALEZZ_SUPABASE_SECRET_KEY") or
        os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY")))

def _cloud(method, table, params=None, payload=None):
    if not _has_cloud():
        return None
    options = {}
    if params is not None:
        options["params"] = params
    if payload is not None:
        options["json"] = payload
    if method in ("POST", "PATCH"):
        options["prefer"] = "return=minimal"
    return REMOTE_PORTAL.upstream(
        method, "/rest/v1/" + table, secret=True, **options)

def _restore_cloud():
    if not _has_cloud():
        return
    sites = _cloud("GET", "aseel_security_sites", params={
        "select": "id,owner_uid,host,verification_token,created_at,verified_at,interval_hours,last_run,next_run",
        "limit": 1000})
    with database() as db:
        for row in sites or []:
            db.execute("""INSERT INTO sites
                (id,uid,host,token,created_at,verified_at,interval_hours,last_run,next_run)
                VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                 verified_at=excluded.verified_at,
                 interval_hours=excluded.interval_hours,
                 last_run=excluded.last_run,
                 next_run=excluded.next_run""",
                (row["id"],row["owner_uid"],row["host"],row["verification_token"],
                 row["created_at"],row["verified_at"],row["interval_hours"],
                 row["last_run"],row["next_run"]))
    history = _cloud("GET", "aseel_security_audits", params={
        "select":"id,site_id,created_at,payload",
        "order":"created_at.desc", "limit": 1000})
    with database() as db:
        for item in history or []:
            db.execute("INSERT OR IGNORE INTO audits(id,site_id,created_at,payload) VALUES(?,?,?,?)",
                (item["id"],item["site_id"],item["created_at"],
                 json.dumps(item["payload"],ensure_ascii=False)))

def target(db, uid, site_id):
    row = db.execute("SELECT * FROM sites WHERE id=? AND uid=?", (site_id, uid)).fetchone()
    if not row:
        raise HTTPException(404, "الموقع غير موجود في حسابك.")
    return row


def run_site(site_id, uid, background=False):
    try:
        with database() as db:
            site = target(db, uid, site_id)
            if not site["verified_at"]:
                raise ValueError("أثبت ملكية النطاق أولًا.")
            host, token = site["host"], site["token"]
        if not verify(host, token):
            _cloud("PATCH", "aseel_security_sites",
                   params={"id":"eq." + site_id},
                   payload={"verified_at":None})
            with database() as db:
                db.execute("UPDATE sites SET verified_at=NULL WHERE id=?", (site_id,))
            raise ValueError("تم إيقاف الفحص لأن ملف إثبات الملكية غير موجود أو تغير.")
        report = audit(host)
        report_id = secrets.token_hex(12)
        with database() as db:
            db.execute("INSERT INTO audits(id,site_id,created_at,payload) VALUES(?,?,?,?)",
                       (report_id, site_id, iso(), json.dumps(report, ensure_ascii=False)))
            row = db.execute("SELECT interval_hours FROM sites WHERE id=?", (site_id,)).fetchone()
            interval = (row["interval_hours"] if row else 0)
            db.execute("UPDATE sites SET last_run=?,next_run=? WHERE id=?",
                       (iso(), time.time() + interval * 3600 if interval else 0, site_id))
            db.execute("""DELETE FROM audits WHERE site_id=? AND id NOT IN
              (SELECT id FROM audits WHERE site_id=? ORDER BY created_at DESC LIMIT 25)""",
                       (site_id, site_id))
        _cloud("POST", "aseel_security_audits", payload={
            "id":report_id,"site_id":site_id,"created_at":iso(),"payload":report})
        _cloud("PATCH", "aseel_security_sites",
               params={"id":"eq."+site_id},
               payload={"last_run":iso(),"next_run":time.time()+interval*3600 if interval else 0})
        with RUN_LOCK:
            RUNNING[site_id] = {"state": "done", "report_id": report_id}
    except Exception as exc:
        with RUN_LOCK:
            RUNNING[site_id] = {"state": "failed", "error": str(exc)[:160]}


def start_run(site_id, uid):
    with RUN_LOCK:
        previous = RUNNING.get(site_id, {})
        if previous.get("state") == "running":
            return {"state": "running"}
        RUNNING[site_id] = {"state": "running", "started_at": iso()}
        POOL.submit(run_site, site_id, uid)
    return {"state": "running"}


def scheduler():
    while not STOP.wait(600):
        try:
            now = time.time()
            with database() as db:
                rows = db.execute("""SELECT id,uid FROM sites WHERE verified_at IS NOT NULL
                   AND interval_hours>0 AND next_run>0 AND next_run<=? LIMIT 4""", (now,)).fetchall()
            for site in rows:
                start_run(site["id"], site["uid"])
        except Exception:
            pass


class AddSite(BaseModel):
    url: str = Field(min_length=10, max_length=2048)


class TargetId(BaseModel):
    site_id: str = Field(min_length=16, max_length=80)


class Schedule(TargetId):
    interval_hours: int = Field(default=0)


def register(portal):
    global REMOTE_PORTAL
    REMOTE_PORTAL = portal
    try:
        _restore_cloud()
    except (ValueError, requests.RequestException, OSError):
        pass
    @router.get("/studio/security", include_in_schema=False)
    def page(request: Request):
        require_admin(request, portal)
        return FileResponse(BASE / "static" / "security-center.html",
                            headers={"Cache-Control": "no-store",
                                     "X-Frame-Options": "DENY",
                                     "X-Content-Type-Options": "nosniff",
                                     "Content-Security-Policy":
                                     "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"})

    @router.get("/api/security/session")
    def session(request: Request):
        require_admin(request, portal)
        cookie = request.cookies.get("alezz_member", "")
        data = portal.admin_sessions.get(cookie)
        return {"csrf": data[0][3], "verification_path": VERIFY_PATH}

    @router.get("/api/security/sites")
    def sites(request: Request):
        uid = require_admin(request, portal)
        with database() as db:
            rows = db.execute("""SELECT id,host,token,created_at,verified_at,interval_hours,last_run
                                 FROM sites WHERE uid=? ORDER BY created_at DESC LIMIT 20""",
                              (uid,)).fetchall()
            output = []
            for site in rows:
                item = dict(site)
                last = db.execute("""SELECT id,created_at,payload FROM audits
                     WHERE site_id=? ORDER BY created_at DESC LIMIT 1""", (site["id"],)).fetchone()
                item["latest"] = ({"id": last["id"], "created_at": last["created_at"],
                                   "summary": json.loads(last["payload"])["counts"]}
                                  if last else None)
                with RUN_LOCK:
                    item["job"] = dict(RUNNING.get(site["id"], {"state": "idle"}))
                output.append(item)
        return {"sites":output, "storage":"persistent" if _has_cloud() else
                "تخزين Render مؤقت؛ أضف مفتاح خدمة Supabase على الخادم لحفظ التاريخ."}

    @router.post("/api/security/sites")
    def add_site(request: Request, data: AddSite):
        uid = require_admin(request, portal, write=True)
        try:
            host = public_host(data.url)
            public_addresses(host)
        except (ValueError, OSError) as exc:
            raise HTTPException(400, str(exc)[:180]) from None
        with database() as db:
            old = db.execute("SELECT id FROM sites WHERE uid=? AND host=?", (uid, host)).fetchone()
            if old:
                raise HTTPException(409, "هذا النطاق موجود بالفعل.")
            count = db.execute("SELECT COUNT(*) FROM sites WHERE uid=?", (uid,)).fetchone()[0]
            if count >= 12:
                raise HTTPException(429, "الحد الأقصى 12 نطاقًا لكل مسؤول.")
            site_id = secrets.token_hex(12)
            token = "alezz-verify-" + secrets.token_urlsafe(26)
            _cloud("POST", "aseel_security_sites", payload={
                "id":site_id,"owner_uid":uid,"host":host,
                "verification_token":token,"created_at":iso()})
            db.execute("INSERT INTO sites(id,uid,host,token,created_at) VALUES(?,?,?,?,?)",
                       (site_id, uid, host, token, iso()))
        return {"id": site_id, "host": host, "token": token,
                "proof_url": "https://" + host + VERIFY_PATH}

    @router.post("/api/security/verify")
    def verify_site(request: Request, data: TargetId):
        uid = require_admin(request, portal, write=True)
        with database() as db:
            site = target(db, uid, data.site_id)
            host, token = site["host"], site["token"]
        try:
            ok = verify(host, token)
        except (ValueError, OSError, requests.RequestException):
            ok = False
        if not ok:
            raise HTTPException(409, "فشل التحقق؛ ارفع الملف النصي في المسار المحدد وتأكد من HTTPS.")
        _cloud("PATCH", "aseel_security_sites",
               params={"id":"eq."+data.site_id},payload={"verified_at":iso()})
        with database() as db:
            db.execute("UPDATE sites SET verified_at=? WHERE id=?", (iso(), data.site_id))
        return {"ok": True}

    @router.post("/api/security/scan")
    def scan(request: Request, data: TargetId):
        uid = require_admin(request, portal, write=True)
        with database() as db:
            site = target(db, uid, data.site_id)
            if not site["verified_at"]:
                raise HTTPException(403, "يجب إثبات الملكية أولًا.")
            if site["last_run"]:
                try:
                    last_ts = datetime.fromisoformat(site["last_run"]).timestamp()
                    if time.time() - last_ts < 120:
                        raise HTTPException(429, "انتظر دقيقتين قبل إعادة فحص النطاق نفسه.")
                except ValueError:
                    pass
        return start_run(data.site_id, uid)

    @router.get("/api/security/report/{site_id}")
    def report(request: Request, site_id: str):
        uid = require_admin(request, portal)
        with database() as db:
            target(db, uid, site_id)
            row = db.execute("""SELECT payload,created_at FROM audits WHERE site_id=?
                         ORDER BY created_at DESC LIMIT 1""", (site_id,)).fetchone()
            if not row:
                raise HTTPException(404, "لم يُنشأ تقرير بعد.")
            return {"created_at": row["created_at"], "report": json.loads(row["payload"])}

    @router.post("/api/security/schedule")
    def schedule(request: Request, data: Schedule):
        uid = require_admin(request, portal, write=True)
        if data.interval_hours not in (0, 24, 168):
            raise HTTPException(400, "المتاح: إيقاف، يوميًا، أسبوعيًا.")
        with database() as db:
            site = target(db, uid, data.site_id)
            if data.interval_hours and not site["verified_at"]:
                raise HTTPException(403, "أثبت الملكية أولًا.")
            next_run = time.time() + data.interval_hours * 3600 if data.interval_hours else 0
            _cloud("PATCH", "aseel_security_sites",
                   params={"id":"eq."+data.site_id},
                   payload={"interval_hours":data.interval_hours,"next_run":next_run})
            db.execute("UPDATE sites SET interval_hours=?,next_run=? WHERE id=?",
                       (data.interval_hours,next_run,data.site_id))
        return {"ok": True, "interval_hours": data.interval_hours,
                "note": "الجدولة تعمل طالما خادم Render مستيقظ؛ التنفيذ المضمون يحتاج Cron خارجيًا."}

    @router.post("/api/security/delete")
    def remove_site(request: Request, data: TargetId):
        uid = require_admin(request, portal, write=True)
        with database() as db:
            target(db, uid, data.site_id)
            _cloud("DELETE", "aseel_security_sites",
                   params={"id":"eq."+data.site_id,"owner_uid":"eq."+uid})
            db.execute("DELETE FROM audits WHERE site_id=?", (data.site_id,))
            db.execute("DELETE FROM sites WHERE id=? AND uid=?", (data.site_id, uid))
        return {"ok": True}


if os.getenv("ALEZZ_SECURITY_SCHEDULER", "1") == "1":
    threading.Thread(target=scheduler, name="alezz-security-scheduler", daemon=True).start()
