"""Small optional discovery of unauthenticated public HTTP CONNECT proxies.

Sources are fixed public GitHub RAW files, never an arbitrary user URL. Candidates
from untrusted lists are *not* trusted: globally routable IPs and conventional
HTTP proxy ports only; each candidate must perform a TLS-verified GET to the
public example.com diagnostic page before becoming eligible. No status-based
rotation, Cloudflare bypass, credentials, cookies or sensitive API requests.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
import ipaddress
import os
import re
import threading
import time

SOURCE_HOST = "raw.githubusercontent.com"
SOURCES = (
    ("monosans/proxy-list",
     "/monosans/proxy-list/main/proxies/http.txt"),
    ("proxifly/free-proxy-list",
     "/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt"),
)
VALID_PORTS = frozenset((80, 443, 1080, 3128, 8000, 8001, 8080, 8081, 8118, 8888, 9000))
TTL_SECONDS = 1800
MAX_SOURCE_BYTES = 49000
MAX_CANDIDATES = 45
MAX_TESTS = 6
MAX_WORKING = 3

_LOCK = threading.RLock()
_CACHE = {
    "checked_at": 0.0, "candidate_count": 0, "working": (),
    "source_count": 0, "tested": 0, "error": "",
}


def parse_candidate(line: str):
    """Reject DNS hostnames, private IPs, credentials and unusual ports."""
    from security_proxy import Proxy
    line = line.strip()
    if len(line) > 90 or not line or line.startswith("#"):
        return None
    if line.lower().startswith("http://"):
        line = line[7:]
    if not re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}", line):
        return None
    ip, port_text = line.rsplit(":", 1)
    try:
        addr = ipaddress.IPv4Address(ip)
        port = int(port_text)
        if not addr.is_global or port not in VALID_PORTS:
            return None
    except (ValueError, OverflowError):
        return None
    return Proxy(str(addr), port)


def parse_sources(payload: bytes):
    try:
        text = payload.decode("ascii", "ignore")
    except (TypeError, AttributeError):
        return ()
    proxies = {}
    for line in text.splitlines()[:4000]:
        candidate = parse_candidate(line)
        if candidate:
            proxies[(candidate.host, candidate.port)] = candidate
        if len(proxies) >= MAX_CANDIDATES:
            break
    return tuple(proxies.values())


def _fetch_candidates():
    from site_security import safe_get
    candidates = {}
    sources_ok = 0
    for _, path in SOURCES:
        try:
            status, headers, blob = safe_get(SOURCE_HOST, path, max_bytes=MAX_SOURCE_BYTES)
            if status != 200:
                continue
            ct = next((str(value).lower() for key, value in headers.items()
                       if key.lower() == "content-type"), "")
            if not ("text/" in ct or "octet-stream" in ct):
                continue
            sources_ok += 1
            for candidate in parse_sources(blob):
                candidates[(candidate.host, candidate.port)] = candidate
                if len(candidates) >= MAX_CANDIDATES:
                    break
        except Exception:
            # GitHub/network outage must not crash owner scanning.
            continue
    return tuple(candidates.values()), sources_ok


def _test_connect(proxy, destination_ip):
    from security_proxy import _connect_fetch
    try:
        status, _, data = _connect_fetch(
            proxy, "example.com", destination_ip, "/", None, 2200,
            "AlEzzSecurityProxyHealth/1.0", timeout=3)
        return status in (200, 206) and b"example domain" in data.lower()
    except Exception:
        return False


def refresh(force=False):
    """Fetch and verify a few public candidates. Bounded, cached, fail-closed.

    The caller must require an authenticated administrator if invoked over HTTP.
    """
    now = time.monotonic()
    with _LOCK:
        if not force and _CACHE["checked_at"] and now - _CACHE["checked_at"] < TTL_SECONDS:
            return status()
        if force and _CACHE["checked_at"] and now - _CACHE["checked_at"] < 180:
            return status()
        # Do not let simultaneous requests issue repeated community proxy checks.
        _CACHE["checked_at"] = now
        proxies, sources_ok = _fetch_candidates()
        approved = []
        tested = 0
        if proxies:
            try:
                from site_security import public_addresses
                import ipaddress as ip
                ips = public_addresses("example.com")
                target_ip = next((a for a in ips if ip.ip_address(a).version == 4), None)
            except (ValueError, OSError):
                target_ip = None
            if target_ip:
                # Do not rely on public list's "working" label: test TLS ourselves.
                with ThreadPoolExecutor(max_workers=3, thread_name_prefix="alezz-free-proxy") as pool:
                    futures = {pool.submit(_test_connect, p, target_ip): p
                               for p in proxies[:MAX_TESTS]}
                    for future in as_completed(futures):
                        tested += 1
                        if future.result():
                            approved.append(futures[future])
        _CACHE.update(candidate_count=len(proxies), working=tuple(approved[:MAX_WORKING]),
                      source_count=sources_ok, tested=tested,
                      error="" if sources_ok else "لا يمكن الوصول إلى قوائم GitHub الآن.")
        return status()


def working_pool():
    with _LOCK:
        if not _CACHE["checked_at"] or time.monotonic() - _CACHE["checked_at"] >= TTL_SECONDS:
            refresh()
        return tuple(_CACHE["working"])


def status():
    with _LOCK:
        age = (int(time.monotonic() - _CACHE["checked_at"])
               if _CACHE["checked_at"] else None)
        return {
            "sources": len(SOURCES), "sources_reachable": _CACHE["source_count"],
            "candidates": _CACHE["candidate_count"],
            "tested": _CACHE["tested"], "working": len(_CACHE["working"]),
            "cache_age_seconds": age,
            "last_error": _CACHE["error"],
            "note": "Public proxies are untrusted and may log destinations. Only TLS-verified public probes are used; the service never rotates on HTTP 403/429 or challenges.",
        }
