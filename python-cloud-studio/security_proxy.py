"""Trusted HTTP CONNECT proxy pool for the Al Ezz Security Center.

The pool is deliberately opt-in AND restricted to exact owner-configured hosts.
It pins the upstream CONNECT target to the already validated public IPv4/IPv6,
verifies TLS with the original hostname, and never changes egress on HTTP
403, 429, Cloudflare challenges, or other application-level responses.

Only network transport errors cause at most one alternate proxy attempt.
No proxy URLs, credentials, or authorization headers appear in audit JSON.
"""
from __future__ import annotations

import base64
import contextvars
from dataclasses import dataclass, field
from contextlib import contextmanager
import hashlib
import http.client
import ipaddress
import os
import re
import ssl
from urllib.parse import unquote, urlsplit


@dataclass(frozen=True)
class Proxy:
    host: str
    port: int
    username: str = ""
    password: str = ""


@dataclass
class AuditTransport:
    host: str
    pool: tuple[Proxy, ...]
    selected: int
    approved: bool
    active: int | None = None
    attempts: int = 0
    network_failures: int = 0
    used_proxy: bool = False

    def summary(self):
        return {
            "mode": ("proxy" if self.used_proxy else
                     "unavailable" if self.approved and self.pool and self.attempts else "direct"),
            "configured": len(self.pool),
            "approved": self.approved,
            "selected": ("Proxy " + str(self.active + 1)) if self.used_proxy and self.active is not None else None,
            "attempts": self.attempts,
            "network_failures": self.network_failures,
            "policy": "No fallback on HTTP 403/429/Cloudflare; Chromium and TLS certificate metadata use direct egress.",
        }


_CONTEXT = contextvars.ContextVar("alezz_security_proxy", default=None)
MAX_PROXIES = 6
MAX_ATTEMPTS = 2


def _parse_one(raw):
    p = urlsplit(raw.strip())
    if p.scheme != "http" or not p.hostname or not p.port or p.path not in ("", "/") or p.query or p.fragment:
        raise ValueError("Only http://proxy-host:port HTTP CONNECT URLs are accepted")
    host = p.hostname.lower().rstrip(".")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,251}", host):
        # Bracketed IPv6 literals are also allowed, but verified as public.
        ipaddress.ip_address(host)
    if any(ord(ch) < 32 for ch in raw):
        raise ValueError("Proxy URL contains control characters")
    if p.username is not None and not p.username:
        raise ValueError("Proxy username must not be blank")
    user = unquote(p.username or "")
    password = unquote(p.password or "")
    if len(user) > 96 or len(password) > 160:
        raise ValueError("Proxy credentials too long")
    return Proxy(host=host, port=p.port, username=user, password=password)


def settings():
    urls = os.environ.get("ALEZZ_SECURITY_PROXY_URLS", "")
    allow = os.environ.get("ALEZZ_SECURITY_PROXY_ALLOWED_HOSTS", "")
    entries = [line.strip() for line in re.split(r"[,;\n]+", urls) if line.strip()]
    hosts = frozenset(x.strip().lower().rstrip(".") for x in re.split(r"[,;\n]+", allow)
                      if x.strip())
    # Invalid records are not used. No credentials or URL text is logged.
    pool = []
    for entry in entries[:MAX_PROXIES]:
        try:
            pool.append(_parse_one(entry))
        except (ValueError, OverflowError, TypeError):
            continue
    enabled = os.environ.get("ALEZZ_SECURITY_PROXY_ENABLED", "1") == "1"
    return tuple(pool) if enabled else (), hosts


def safe_status():
    pool, allowed = settings()
    return {
        "configured": len(pool),
        "approved_host_count": len(allowed),
        "enabled": bool(pool and allowed),
        "note": "Set ALEZZ_SECURITY_PROXY_URLS and ALEZZ_SECURITY_PROXY_ALLOWED_HOSTS in Render secrets. Proxy credentials are never returned.",
    }


@contextmanager
def audit_proxy_context(host):
    pool, allowed = settings()
    approved = host.lower().rstrip(".") in allowed
    choice = int.from_bytes(hashlib.sha256(host.encode("utf-8")).digest()[:4], "big") % len(pool) if pool else 0
    context = AuditTransport(host, pool, choice, approved)
    token = _CONTEXT.set(context)
    try:
        yield context
    finally:
        _CONTEXT.reset(token)


def _public_addrs(host, port):
    """Return only globally routable addresses; reject mixed public/private DNS."""
    import socket
    entries = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses = list(dict.fromkeys(entry[4][0] for entry in entries))
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise OSError("Proxy DNS includes a non-public address")
    return addresses


def _connect_fetch(proxy, target_host, target_ip, path, origin, max_bytes, user_agent):
    # Connect to the validated proxy IP, avoiding proxy DNS re-resolution.
    addresses = _public_addrs(proxy.host, proxy.port)
    connection = None
    last_error = None
    for proxy_ip in addresses[:2]:
        try:
            connection = http.client.HTTPConnection(proxy_ip, proxy.port, timeout=7)
            authority = ("[" + target_ip + "]" if ":" in target_ip else target_ip) + ":443"
            tunnel_headers = {"Host": authority}
            if proxy.username:
                credential = (proxy.username + ":" + proxy.password).encode("utf-8")
                tunnel_headers["Proxy-Authorization"] = "Basic " + base64.b64encode(credential).decode("ascii")
            connection.set_tunnel(
                "[" + target_ip + "]" if ":" in target_ip else target_ip,
                port=443,
                headers=tunnel_headers,
            )
            connection.connect()
            # SSL validates the PUBLIC site hostname, not its pinned IP address.
            connection.sock = ssl.create_default_context().wrap_socket(
                connection.sock, server_hostname=target_host
            )
            headers = {
                "Host": target_host, "User-Agent": user_agent,
                "Accept": "text/html,text/plain,application/json,*/*;q=0.2",
                "Range": "bytes=0-" + str(max_bytes - 1),
                "Connection": "close",
            }
            if origin:
                headers["Origin"] = origin
            connection.request("GET", path, headers=headers)
            reply = connection.getresponse()
            try:
                return reply.status, dict(reply.getheaders()), reply.read(max_bytes)
            finally:
                reply.close()
        except (OSError, ValueError, ssl.SSLError, http.client.HTTPException) as exc:
            last_error = exc
            # Proxy's explicit CONNECT refusal is NOT a transport failure to rotate around.
            if "Tunnel connection failed" in str(exc):
                raise OSError("Proxy CONNECT refused the request") from None
        finally:
            if connection is not None:
                connection.close()
                connection = None
    raise OSError("Proxy network unavailable") from last_error


def try_proxy_get(host, path, origin, max_bytes, user_agent, target_addresses):
    """Return None for direct mode; otherwise one successful proxied response.

    When proxy transport is unreachable, try only one alternate proxy and
    then fail closed (never silently switch to a different unapproved path).
    """
    context = _CONTEXT.get()
    if context is None or context.host != host or not context.approved or not context.pool:
        return None

    public_ips = [ip for ip in target_addresses if ipaddress.ip_address(ip).is_global]
    if not public_ips or len(public_ips) != len(target_addresses):
        raise ValueError("Target DNS not fully public")

    indices = [context.active if context.active is not None else context.selected]
    if len(context.pool) > 1:
        candidate = (indices[0] + 1) % len(context.pool)
        if candidate not in indices:
            indices.append(candidate)

    last_error = None
    for idx in indices[:MAX_ATTEMPTS]:
        context.attempts += 1
        try:
            result = _connect_fetch(context.pool[idx], host, public_ips[0],
                                    path, origin, max_bytes, user_agent)
            context.active = idx
            context.used_proxy = True
            return result
        except OSError as exc:
            if str(exc) == "Proxy CONNECT refused the request":
                raise
            context.network_failures += 1
            last_error = exc
    raise OSError("Available configured proxy transports are unreachable") from last_error
