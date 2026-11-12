"""Bounded discovery of public entry points and browser Network metadata.

No credential use, no login attempts, no request/response bodies, no query strings,
no cookies, no brute force or private IPs. Chromium is DNS-pinned to a public IP.
"""
from __future__ import annotations

import ipaddress
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
    if re.search(r"(?:^|/)(?:api|graphql|wp-json|rest)(?:/|$)", lower):
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


def discover(host: str, html: str, safe_get, public_addresses) -> dict:
    """Read-only discovery: static public links + at most 2 scripts + 6 entrypoint GETs."""
    found: dict = {}
    scripts = _html_entries(host, html, found)
    for path in scripts[:2]:
        try:
            status, headers, blob = safe_get(host, path, max_bytes=32000)
            if status in (200, 206) and "javascript" in headers.get("Content-Type", "").lower():
                for literal in PATH_LITERAL.findall(blob.decode("utf-8", "replace"))[:90]:
                    _add(found, host, literal, "public JavaScript")
        except Exception:
            continue

    # Explicit read-only probes of a short fixed set; never submit forms or credentials.
    for path in COMMON_ENTRYPOINTS:
        try:
            code, headers, payload = safe_get(host, path, max_bytes=2048)
            if code in (200, 401, 403, 405):
                _add(found, host, path, "public GET")
                if path in found:
                    found[path]["status"] = code
        except Exception:
            pass

    network, browser_state = _chromium_network(host, public_addresses)
    for entry in network:
        if _kind(entry["path"]):
            _add(found, host, entry["path"], "Chromium Network")
            if entry["path"] in found:
                found[entry["path"]]["status"] = entry["status"]
    categories = {"admin": 0, "login": 0, "api": 0}
    for row in found.values():
        categories[row["kind"]] += 1
    return {
        "paths": list(found.values())[:MAX_PATHS],
        "network": network,
        "browser_status": browser_state,
        "summary": categories,
        "limits": PASSIVE_DISCLAIMER + " عرض المسارات فقط دون معاملات أو رموز جلسات أو أجسام استجابات.",
    }
