"""Bounded discovery of public entry points and browser Network metadata.

No credential use, no login attempts, no request/response bodies, no query strings,
no cookies, no brute force or private IPs. Chromium is DNS-pinned to a public IP.
"""
from __future__ import annotations

import difflib
import ipaddress
import json
import secrets
import time
import os
import re
import threading
from urllib.parse import urljoin, urlsplit, unquote

from bs4 import BeautifulSoup

BROWSER_GATE = threading.BoundedSemaphore(1)
MAX_PATHS = 65
MAX_NETWORK = 40
COMMON_ENTRYPOINTS = (
    "/login", "/admin", "/wp-login.php", "/wp-admin/",
    "/user/login", "/admin/login",
)
PATH_LITERAL = re.compile(
    r"""["'\\` ](\/(?:api|rest|graphql|wp-json|login|signin|sign-in|auth|admin|dashboard|wp-admin|wp-login\.php|user\/login|account\/login|moderator|acp)(?:\/[a-zA-Z0-9_./-]{0,110})?)""",
    re.I,
)
SENSITIVE = re.compile(r"(?i)(?:token|session|key|secret|password|nonce|code|credential|bearer|jwt|oauth|callback)")
PASSIVE_DISCLAIMER = "مسارات عامة مستدل عليها، لا تثبت وجود ثغرة أو صلاحية دخول."


def _path(url: str, host: str) -> str | None:
    try:
        p = urlsplit(urljoin("https://" + host + "/", url))
        if p.scheme != "https" or p.hostname != host or p.port not in (None, 443):
            return None
        path = unquote(p.path)
        if not path.startswith("/") or path.startswith("//") or len(path) > 150:
            return None
        if any(ord(c) < 32 for c in path) or ".." in path or "\\" in path:
            return None
        if SENSITIVE.search(path):
            return None
        return p.path or "/"
    except (ValueError, TypeError):
        return None


def _kind(path: str) -> str | None:
    lower = path.lower().rstrip("/") or "/"
    if re.search(r"(?:^|/)(?:api|graphql|wp-json|rest|openapi.json|swagger.json|swagger-ui|api-docs)(?:/|$)", lower):
        return "api"
    if re.search(r"(?:^|/)(?:admin|dashboard|wp-admin|moderator|acp|manage|backend)(?:/|$)", lower):
        return "admin"
    if re.search(r"(?:^|/)(?:login|signin|sign-in|wp-login\.php|auth|register|sign-up|sso)(?:/|$)", lower):
        return "login"
    return None


def _add(found: dict, host: str, url: str, source: str, forced_kind: str | None = None):
    path = _path(url, host)
    if not path:
        return
    kind = forced_kind or _kind(path)
    if not kind or len(found) >= MAX_PATHS:
        return
    item = found.setdefault(path, {"path": path, "kind": kind, "sources": [], "status": None})
    if source not in item["sources"] and len(item["sources"]) < 3:
        item["sources"].append(source)


def _html_entries(host, html, found):
    soup = BeautifulSoup(html[:128000], "html.parser")
    scripts = []
    for elem in soup.select("a[href], form[action], link[href], script[src]")[:240]:
        attr = "action" if elem.name == "form" else ("src" if elem.name == "script" else "href")
        url = elem.get(attr, "")
        _add(found, host, url, "HTML " + elem.name)
        if elem.name == "script" and len(scripts) < 3:
            src = _path(url, host)
            if src and src.lower().endswith(".js"):
                scripts.append(src)
    for literal in PATH_LITERAL.findall(html[:128000])[:80]:
        _add(found, host, literal, "HTML string")
    if soup.select_one("input[type=password]"):
        form = soup.select_one("form[action]")
        _add(found, host, form.get("action") if form else "/", "password form", "login")
    return scripts


def _chromium_network(host: str, public_addresses):
    if os.getenv("ALEZZ_SECURITY_BROWSER", "1") != "1":
        return [], "معطل من الإعدادات"
    if not BROWSER_GATE.acquire(blocking=False):
        return [], "المتصفح مشغول بفحص آخر"
    events = {}
    try:
        from playwright.sync_api import sync_playwright
        addresses = public_addresses(host)
        public_ipv4 = next((a for a in addresses if ipaddress.ip_address(a).version == 4), None)
        if not public_ipv4:
            return [], "لا يوجد IPv4 عام مناسب للمتصفح"
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                timeout=9000,
                args=[
                    "--disable-background-networking", "--no-first-run",
                    "--disable-extensions",
                    "--host-resolver-rules=MAP " + host + " " + public_ipv4,
                ],
            )
            try:
                context = browser.new_context(
                    ignore_https_errors=False, service_workers="block",
                    accept_downloads=False, java_script_enabled=True,
                )
                context.set_default_timeout(6000)

                request_budget = {"used": 0}
                def allow(route):
                    req = route.request
                    dest = urlsplit(req.url)
                    request_budget["used"] += 1
                    if (request_budget["used"] > 55 or
                            dest.scheme != "https" or dest.hostname != host
                            or dest.port not in (None, 443)
                            or req.method not in ("GET", "HEAD")
                            or req.resource_type in ("image", "media", "font")
                            or re.search(r"(?i)(?:^|/)(?:logout|delete|destroy|reset|remove|reboot)(?:/|$)", dest.path)):
                        route.abort()
                        return
                    try:
                        # Re-check public DNS even though Chromium's address is pinned.
                        if not public_addresses(host):
                            route.abort()
                            return
                    except (ValueError, OSError):
                        route.abort()
                        return
                    route.continue_()

                context.route("**/*", allow)
                try:
                    context.route_web_socket("**/*", lambda ws: ws.close())
                except AttributeError:
                    pass
                page = context.new_page()
                cdp = context.new_cdp_session(page)
                def seen(event):
                    if len(events) >= MAX_NETWORK:
                        return
                    res = event.get("response") or {}
                    path = _path(res.get("url", ""), host)
                    if not path:
                        return
                    typ = str(event.get("type", ""))[:32]
                    if typ not in ("XHR", "Fetch", "Document", "Script"):
                        return
                    key = (path, typ)
                    events[key] = {
                        "path": path,
                        "type": typ,
                        "status": int(res.get("status", 0)),
                        "mime": str(res.get("mimeType", ""))[:80],
                    }
                cdp.on("Network.responseReceived", seen)
                cdp.send("Network.enable")
                try:
                    page.goto("https://" + host + "/", wait_until="domcontentloaded", timeout=12000)
                    page.wait_for_timeout(2200)
                except Exception:
                    pass
                finally:
                    context.close()
            finally:
                browser.close()
        return list(events.values())[:MAX_NETWORK], "اكتمل"
    except Exception as exc:
        return [], "تعذّر تشغيل Chromium: " + type(exc).__name__
    finally:
        BROWSER_GATE.release()



def _soft_missing(reference, candidate):
    """Conservatively identify SPA catch-all / soft-404 HTML responses."""
    if not reference or not candidate:
        return False
    status_a, headers_a, body_a = reference
    status_b, headers_b, body_b = candidate
    if not (200 <= status_a < 300 and 200 <= status_b < 300):
        return False
    if "html" not in headers_a.get("Content-Type", "").lower() or "html" not in headers_b.get("Content-Type", "").lower():
        return False
    try:
        def normalized(payload):
            soup = BeautifulSoup(payload.decode("utf-8", "replace"), "html.parser")
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
            text = " ".join(soup.stripped_strings).lower()
            return re.sub(r"(?i)\b[0-9a-f]{10,}\b|\b\d{5,}\b", "#", text)[:1600]
        a, b = normalized(body_a), normalized(body_b)
        return bool(a and b and difflib.SequenceMatcher(None, a, b, autojunk=False).ratio() >= .92)
    except (ValueError, TypeError):
        return False


def _apply_evidence(row):
    sources = row.get("sources") or []
    state = row.get("validation")
    if state == "network":
        confidence = "observed"
        note = "ظهر في Network أثناء زيارة عامة؛ ليس دليلًا على صلاحيات الوصول."
    elif state == "matched":
        confidence = "observed"
        note = "استجاب المسار بتميّز عن صفحة غير موجودة؛ لا يثبت أنه نقطة دخول فعالة."
    elif state == "fallback":
        confidence = "uncertain"
        note = "عاد مثل صفحة غير موجودة؛ قد يكون مجرد توجيه SPA عام."
    elif state == "unavailable":
        confidence = "uncertain"
        note = "المسار مذكور علنًا لكنه غير متاح عند التحقق."
    elif any("OpenAPI" in src for src in sources):
        confidence = "documented"
        note = "موثق في مواصفة عامة، ولم يُجرّب الإجراء."
    elif any(src.startswith("HTML") for src in sources):
        confidence = "documented"
        note = "مذكور في HTML العام ولم يؤكد تسجيل الدخول أو الصلاحية."
    else:
        confidence = "inferred"
        note = "مستنتج من JavaScript أو مسار عام ولا يعني وجوده فعليًا."
    row["confidence"] = confidence
    row["note"] = note
    return row


def _spec_entries(host, safe_get, found, calls):
    """Enumerate a public OpenAPI schema's route names, not its request bodies."""
    specs = []
    for path in ("/openapi.json", "/swagger.json"):
        if len(found) >= MAX_PATHS:
            break
        calls.append(path)
        try:
            status, headers, raw = safe_get(host, path, max_bytes=64000)
            if status != 200 or "json" not in headers.get("Content-Type", "").lower():
                continue
            parsed = json.loads(raw.decode("utf-8", "replace"))
            if not isinstance(parsed, dict) or not (parsed.get("openapi") or parsed.get("swagger")):
                continue
            endpoints = parsed.get("paths")
            if not isinstance(endpoints, dict):
                continue
            count = 0
            for name, verbs in list(endpoints.items())[:35]:
                if not isinstance(name, str) or not isinstance(verbs, dict):
                    continue
                endpoint = _path(name, host)
                if not endpoint:
                    continue
                _add(found, host, name, "OpenAPI public specification", forced_kind="api")
                if endpoint in found:
                    found[endpoint]["methods"] = [
                        method.upper() for method in ("get", "post", "put", "patch", "delete", "head")
                        if method in verbs
                    ][:6]
                count += 1
                if len(found) >= MAX_PATHS:
                    break
            specs.append({"path": path, "documented_routes": count})
        except (ValueError, UnicodeError, json.JSONDecodeError, OSError):
            pass
        except Exception:
            # A malformed or unavailable public spec should not break the scan.
            pass
    return specs


def discover(host: str, html: str, safe_get, public_addresses) -> dict:
    """Small read-only public endpoint inventory with soft-404 calibration."""
    started = time.monotonic()
    found: dict = {}
    requests_made = []
    scripts = _html_entries(host, html, found)
    for path in scripts[:2]:
        requests_made.append(path)
        try:
            status, headers, blob = safe_get(host, path, max_bytes=32000)
            if status in (200, 206) and "javascript" in headers.get("Content-Type", "").lower():
                for literal in PATH_LITERAL.findall(blob.decode("utf-8", "replace"))[:90]:
                    _add(found, host, literal, "public JavaScript")
        except Exception:
            continue

    specs = _spec_entries(host, safe_get, found, requests_made)

    # A randomly named path provides a soft-404 baseline for SPA fallback pages.
    baseline = None
    baseline_path = "/__alezz_notfound_" + secrets.token_hex(8)
    try:
        requests_made.append(baseline_path)
        baseline = safe_get(host, baseline_path, max_bytes=3072)
    except Exception:
        pass

    # Only a short fixed path list and four discovered links are checked via GET.
    linked = [
        row["path"] for row in found.values()
        if row["kind"] in ("login", "admin") and row["path"] not in COMMON_ENTRYPOINTS
        and row["path"] != "/" and not re.search(r"(?i)(?:logout|delete|reset|remove)", row["path"])
    ][:4]
    paths_to_probe = list(dict.fromkeys(COMMON_ENTRYPOINTS + tuple(linked)))
    for path in paths_to_probe:
        requests_made.append(path)
        try:
            status, headers, body = safe_get(host, path, max_bytes=3072)
            if status in (200, 206, 401, 403, 405):
                fallback = _soft_missing(baseline, (status, headers, body))
                if path in found:
                    found[path]["status"] = status
                    found[path]["validation"] = "fallback" if fallback else "matched"
                elif not fallback:
                    _add(found, host, path, "bounded public GET")
                    if path in found:
                        found[path]["status"] = status
                        found[path]["validation"] = "matched"
            elif path in found:
                found[path]["status"] = status
                found[path]["validation"] = "unavailable"
        except Exception:
            if path in found:
                found[path]["validation"] = "unavailable"

    network, browser_state = _chromium_network(host, public_addresses)
    for entry in network:
        category = _kind(entry["path"])
        if category is None and entry["type"] in ("XHR", "Fetch") and "json" in entry.get("mime", "").lower():
            category = "api"
        if category:
            _add(found, host, entry["path"], "Chromium Network", forced_kind=category)
            if entry["path"] in found:
                found[entry["path"]]["status"] = entry["status"]
                found[entry["path"]]["validation"] = "network"

    rows = [_apply_evidence(row) for row in found.values()]
    rows.sort(key=lambda row: (
        {"observed": 0, "documented": 1, "inferred": 2, "uncertain": 3}.get(row["confidence"], 4),
        {"admin": 0, "login": 1, "api": 2}.get(row["kind"], 3),
        row["path"],
    ))
    categories = {"admin": 0, "login": 0, "api": 0}
    confidence = {"observed": 0, "documented": 0, "inferred": 0, "uncertain": 0}
    for row in rows:
        categories[row["kind"]] += 1
        confidence[row["confidence"]] += 1
    return {
        "version": 3,
        "paths": rows[:MAX_PATHS],
        "network": network,
        "browser_status": browser_state,
        "summary": categories,
        "confidence_summary": confidence,
        "openapi": specs,
        "requests": len(requests_made),
        "duration_seconds": round(time.monotonic() - started, 2),
        "baseline_status": baseline[0] if baseline else None,
        "limits": PASSIVE_DISCLAIMER +
                  " تم مقارنة استجابات المسارات بصفحة عشوائية لتقليل نتائج SPA الوهمية؛ " +
                  "لا تخزن معاملات URL أو أجسام API أو بيانات الحسابات.",
    }
