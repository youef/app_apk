"""Unauthenticated, rate-limited owner website diagnostics under /siteguard/.
No login bypass of the Al Ezz member portal; no private-network access.
"""
from __future__ import annotations
from collections import deque
from concurrent.futures import ThreadPoolExecutor
import re
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from pydantic import BaseModel, Field

from site_security import audit as detailed_audit, finish, public_addresses, public_host, safe_get, iso, record

router = APIRouter()
HERE = Path(__file__).resolve().parent
LOCK = threading.RLock()
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="public-siteguard")
JOBS: dict[str, dict] = {}
CHALLENGES: dict[tuple[str, str], tuple[str, float]] = {}
VERIFIED: dict[tuple[str, str], float] = {}
LAST_HOST: dict[str, float] = {}
RECENT = deque()
COOKIE = "alezz_siteguard"
MAX_RUNS_PER_HOUR = 20

class Target(BaseModel):
    url: str = Field(min_length=4, max_length=700)
    mode: str = "quick"

def session_key(request: Request):
    sid = request.cookies.get(COOKIE, "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{30,90}", sid):
        raise HTTPException(403, "افتح صفحة الفحص أولًا لتأسيس جلسة المتصفح.")
    return sid

def api_request(request: Request):
    sid = session_key(request)
    if (not request.headers.get("content-type", "").lower().startswith("application/json") or
            request.headers.get("x-siteguard-client") != "dashboard"):
        raise HTTPException(403, "طلب غير معتمد من واجهة الفحص.")
    origin = request.headers.get("origin")
    if origin:
        parsed = urlsplit(origin)
        if (parsed.scheme not in ("http", "https") or parsed.netloc != request.url.netloc):
            raise HTTPException(403, "مصدر الطلب غير مسموح.")
    return sid

def host_from(raw):
    value = raw.strip()
    if "://" not in value:
        value = "https://" + value
    try:
        host = public_host(value)
        public_addresses(host)
        return host
    except (ValueError, OSError) as exc:
        raise HTTPException(400, "استخدم اسم نطاق HTTPS عامًا صحيحًا، وليس عنوانًا داخليًا.") from exc

def quick_audit(host):
    result = {
        "host": host, "url": "https://" + host, "started_at": iso(),
        "engine": "Al Ezz SiteGuard / limited safe website configuration audit",
        "checks": [], "platform": "غير محدد", "version": "غير معلن",
        "http_status": None
    }
    items = []
    try:
        status, headers, content = safe_get(host, "/", max_bytes=60000)
    except Exception as exc:
        items.append(record("high", "تعذر الاتصال بالخادم عبر HTTPS",
                            "تعذرت قراءة الاستجابة العامة للخادم.",
                            "راجع DNS والشهادة والجدار الناري وحالة الاستضافة.",
                            type(exc).__name__))
        return finish(result, items)
    result["http_status"] = status
    result["checks"].append("HTTPS with certificate verification / public IP only")
    if status >= 400:
        items.append(record("medium", "استجابة HTTP غير ناجحة",
                            "استجابة الصفحة الرئيسية: " + str(status),
                            "راجع إمكانية الوصول إلى الموقع.", "HTTP " + str(status)))
    h = {key.lower(): val for key, val in headers.items()}
    checks = (
        ("strict-transport-security", "medium", "غياب HSTS", "فعّل HSTS بعد التحقق من تغطية HTTPS."),
        ("content-security-policy", "medium", "غياب سياسة CSP", "أضف سياسة Content-Security-Policy مناسبة."),
        ("x-content-type-options", "low", "غياب X-Content-Type-Options", "اضبط nosniff."),
        ("referrer-policy", "low", "غياب Referrer-Policy", "حدد سياسة إرسال معلومات المصدر."),
    )
    for key, level, title, fix in checks:
        if not h.get(key):
            items.append(record(level, title,
                "ترويسة الحماية غير ظاهرة في الصفحة الرئيسية.", fix, key))
    if not h.get("x-frame-options") and "frame-ancestors" not in h.get("content-security-policy", ""):
        items.append(record("medium", "غياب حماية التضمين داخل iframe",
                            "لا يظهر X-Frame-Options أو frame-ancestors.",
                            "اضبط frame-ancestors في CSP أو X-Frame-Options."))
    if h.get("server"):
        result["server_header"] = h["server"][:90]
    if h.get("x-powered-by"):
        result["powered_by"] = h["x-powered-by"][:90]
    markup = content.decode("utf-8", "replace") if "html" in h.get("content-type", "").lower() else ""
    fingerprints = (
        ("WordPress", r"wp-content/|wp-includes/|wp-json"),
        ("XenForo", r"xenforo|data-xf-init|/js/xf/"),
        ("vBulletin", r"vbulletin|/clientscript/vbulletin"),
        ("phpBB", r"phpbb|prosilver"),
        ("MyBB", r"mybb|/jscripts/general\.js"),
        ("Drupal", r"drupalsettings|/sites/default/files/"),
        ("Joomla", r"joomla|/media/system/js/"),
        ("Laravel", r"laravel_session|laravel"),
    )
    for name, pattern in fingerprints:
        if re.search(pattern, markup, re.I):
            result["platform"] = name
            break
    meta = re.search(r'<meta\b[^>]*name\s*=\s*["\x27]generator["\x27][^>]*>', markup, re.I)
    if meta:
        tag = meta.group(0)
        match = re.search(r'(?:WordPress|Drupal|Joomla!?|XenForo|vBulletin|phpBB)\s*(?:v|version)?\s*(\d+(?:\.\d+){1,3})', tag, re.I)
        if match:
            result["version"] = match.group(1)
    result["checks"].extend(["HTTP response security headers", "Public HTML platform fingerprint"])
    return finish(result, items)

def run_job(job_id, host, mode):
    try:
        output = detailed_audit(host) if mode == "verified" else quick_audit(host)
        if mode == "verified":
            output["mode"] = "فحص موسع بعد إثبات ملكية النطاق"
            # Detailed checks never save the bodies of files containing secrets.
        else:
            output["mode"] = "فحص خارجي عام"
        with LOCK:
            JOBS[job_id]["state"] = "done"
            JOBS[job_id]["report"] = output
    except Exception as exc:
        with LOCK:
            JOBS[job_id]["state"] = "error"
            JOBS[job_id]["error"] = "تعذر إكمال الفحص: " + type(exc).__name__

@router.get("/siteguard", include_in_schema=False)
def siteguard_redirect():
    return RedirectResponse("/siteguard/", status_code=307)

@router.get("/siteguard/", include_in_schema=False)
def siteguard_page(request: Request):
    response = FileResponse(HERE / "static" / "siteguard-public.html", headers={
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    })
    sid = request.cookies.get(COOKIE, "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{30,90}", sid):
        response.set_cookie(COOKIE, secrets.token_urlsafe(32),
                            httponly=True, secure=request.url.scheme == "https",
                            samesite="strict", path="/siteguard", max_age=86400)
    return response

@router.get("/siteguard/healthz", include_in_schema=False)
def siteguard_health():
    return {"ok": True, "component": "Al Ezz SiteGuard"}

@router.post("/siteguard/api/challenge")
def challenge(request: Request, data: Target):
    sid = api_request(request)
    host = host_from(data.url)
    token = "alezz-siteguard=" + secrets.token_urlsafe(30)
    with LOCK:
        CHALLENGES[(sid, host)] = (token, time.monotonic() + 1800)
    return {
        "host": host, "path": "/.well-known/alezz-siteguard.txt",
        "token": token, "url": "https://" + host + "/.well-known/alezz-siteguard.txt"
    }

@router.post("/siteguard/api/verify")
def verify(request: Request, data: Target):
    sid = api_request(request)
    host = host_from(data.url)
    with LOCK:
        entry = CHALLENGES.get((sid, host))
    if not entry or entry[1] < time.monotonic():
        raise HTTPException(400, "اطلب ملف تحقق جديدًا.")
    try:
        code, _, data_bytes = safe_get(host, "/.well-known/alezz-siteguard.txt", max_bytes=250)
    except Exception:
        raise HTTPException(400, "تعذر قراءة ملف إثبات ملكية النطاق.") from None
    if code != 200 or not secrets.compare_digest(data_bytes.strip().decode("utf-8", "replace"), entry[0]):
        raise HTTPException(400, "ملف التحقق غير موجود أو محتواه غير مطابق.")
    with LOCK:
        VERIFIED[(sid, host)] = time.monotonic() + 12 * 3600
        CHALLENGES.pop((sid, host), None)
    return {"ok": True, "host": host, "valid_hours": 12}

@router.post("/siteguard/api/start")
def start_scan(request: Request, data: Target):
    sid = api_request(request)
    host = host_from(data.url)
    if data.mode not in ("quick", "verified"):
        raise HTTPException(400, "وضع فحص غير صالح.")
    now = time.monotonic()
    with LOCK:
        if data.mode == "verified" and VERIFIED.get((sid, host), 0) < now:
            raise HTTPException(403, "الفحص الموسع يتطلب إثبات ملكية النطاق أولًا.")
        while RECENT and now - RECENT[0] > 3600:
            RECENT.popleft()
        if len(RECENT) >= MAX_RUNS_PER_HOUR:
            raise HTTPException(429, "وصل المختبر إلى حد الفحوص خلال الساعة. حاول لاحقًا.")
        if now - LAST_HOST.get(host, -1e9) < 90:
            raise HTTPException(429, "انتظر 90 ثانية قبل إعادة فحص النطاق نفسه.")
        if any(j["state"] == "running" for j in JOBS.values()):
            raise HTTPException(429, "يوجد فحص جارٍ، أعد المحاولة بعد اكتماله.")
        job_id = secrets.token_urlsafe(24)
        JOBS[job_id] = {"state": "running", "owner": sid,
                        "host": host, "time": time.time(), "mode": data.mode}
        LAST_HOST[host] = now
        RECENT.append(now)
        for key in list(JOBS)[:-35]:
            if JOBS[key]["state"] != "running":
                JOBS.pop(key, None)
    EXECUTOR.submit(run_job, job_id, host, data.mode)
    return {"job_id": job_id, "state": "running"}

@router.get("/siteguard/api/status/{job_id}")
def scan_status(request: Request, job_id: str):
    sid = session_key(request)
    with LOCK:
        job = JOBS.get(job_id)
        if not job or job["owner"] != sid:
            raise HTTPException(404, "الفحص غير موجود لهذه الجلسة.")
        return {key: value for key, value in job.items() if key != "owner"}
