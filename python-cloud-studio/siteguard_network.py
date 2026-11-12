"""Bounded public DNS/nslookup and TLS metadata for the Al Ezz SiteGuard.

No origin-IP discovery by bypassing CDN, no private-network probes, no port scans,
and no HTTP redirects followed. Only public records and a verified TLS connection.
"""
from __future__ import annotations
from datetime import datetime, timezone
import ipaddress
import socket
import ssl

import dns.exception
import dns.resolver
from site_security import public_addresses

DNS_TYPES = ("A", "AAAA", "CNAME", "NS", "MX", "CAA", "SOA")
MAX_VALUES = 12

def _valid_ips(values):
    clean = []
    for value in values:
        try:
            address = ipaddress.ip_address(str(value))
            if address.is_global and str(address) not in clean:
                clean.append(str(address))
        except ValueError:
            continue
    return clean[:12]

def _read_answer(resolver, name, rdtype, limit=MAX_VALUES):
    try:
        answer = resolver.resolve(name, rdtype, lifetime=2.2, search=False)
        records = []
        for rdata in answer:
            if rdtype in ("A", "AAAA"):
                value = str(rdata.address)
            elif rdtype == "MX":
                value = f"{rdata.preference} {str(rdata.exchange).rstrip('.')}"
            elif rdtype in ("NS", "CNAME"):
                value = str(rdata.target).rstrip(".")
            elif rdtype == "SOA":
                value = f"{str(rdata.mname).rstrip('.')} • serial {rdata.serial}"
            elif rdtype == "CAA":
                value = f'{rdata.flags} {rdata.tag.decode("ascii", "replace")} "{rdata.value.decode("ascii", "replace")}"'
            else:
                value = rdata.to_text()
            records.append(value[:240])
            if len(records) >= limit:
                break
        return records
    except (dns.exception.DNSException, OSError, ValueError, UnicodeError):
        return []

def _txt_security(resolver, hostname):
    # Avoid exposing arbitrary DNS TXT records or ownership-verification tokens.
    result = {}
    for name, kind, prefix in (
        (hostname, "SPF", "v=spf1"),
        ("_dmarc." + hostname, "DMARC", "v=dmarc1"),
    ):
        try:
            answer = resolver.resolve(name, "TXT", lifetime=2.2, search=False)
            values = []
            for record in answer:
                text = b"".join(record.strings).decode("utf-8", "replace")
                if text.strip().lower().startswith(prefix):
                    values.append(text[:500])
                if len(values) >= 2:
                    break
            if values:
                result[kind] = values
        except (dns.exception.DNSException, ValueError, OSError):
            pass
    return result

def dns_lookup(host, extended=False):
    """Read only public records of the supplied hostname, with bounded timeouts."""
    # First enforce the same public-IP policy used for outgoing HTTPS.
    verified = _valid_ips(public_addresses(host))
    if not verified:
        raise ValueError("لا توجد عناوين IP عامة لهذا النطاق.")
    resolver = dns.resolver.Resolver(configure=True)
    resolver.timeout = 1.4
    resolver.lifetime = 2.2
    records = {}
    kinds = DNS_TYPES if extended else ("A", "AAAA", "CNAME")
    for kind in kinds:
        values = _read_answer(resolver, host, kind)
        if kind in ("A", "AAAA"):
            values = _valid_ips(values)
        if values:
            records[kind] = values
    ip_addresses = _valid_ips(
        records.get("A", []) + records.get("AAAA", []) + verified
    )
    reverse_dns = []
    if extended:
        # Reverse DNS is descriptive, not proof of ownership or origin.
        for ip in ip_addresses[:2]:
            try:
                answer = resolver.resolve_address(ip, lifetime=2.0)
                for entry in answer:
                    reverse_dns.append({"ip": ip, "ptr": str(entry.target).rstrip(".")[:200]})
                    break
            except (dns.exception.DNSException, OSError, ValueError):
                pass
        records.update(_txt_security(resolver, host))

    aliases = " ".join(records.get("CNAME", [])).lower()
    # These are weak public indicators only, never an origin identification.
    hints = (
        ("Cloudflare", ("cloudflare", "cdn.cloudflare", "workers.dev")),
        ("Amazon CloudFront", ("cloudfront.net",)),
        ("Akamai", ("akamai", "edgesuite.net", "edgekey.net")),
        ("Fastly", ("fastly", "fastly.net")),
        ("Vercel", ("vercel-dns.com", "vercel.app")),
        ("Azure Front Door", ("azurefd.net",)),
        ("Bunny CDN", ("b-cdn.net", "bunnycdn")),
    )
    cdn = next((name for name, terms in hints if any(t in aliases for t in terms)), None)
    return {
        "records": records, "public_ips": ip_addresses, "reverse_dns": reverse_dns,
        "cdn_hint": cdn or "غير مؤكد من CNAME",
        "ip_classification": "عناوين DNS عامة؛ قد تكون وسيط CDN وليست الخادم الأصلي",
        "origin_ip": None,
        "origin_status": "لا يمكن تأكيد IP الخادم الأصلي من السجلات العامة؛ تحقق منه من لوحة الاستضافة أو إعدادات DNS الخاصة."
    }

def _flatten_name(pairs):
    parts = []
    for group in pairs or []:
        for key, value in group:
            if key in ("commonName", "organizationName", "countryName"):
                parts.append(str(value)[:100])
    return " / ".join(parts)[:250]

def tls_metadata(host):
    """Connect only to already-validated public IP with SNI and certificate validation."""
    addresses = _valid_ips(public_addresses(host))
    errors = []
    ctx = ssl.create_default_context()
    for ip in addresses[:3]:
        try:
            # Connecting directly to the checked IP prevents DNS re-resolution into private networks.
            with socket.create_connection((ip, 443), timeout=4) as sock:
                with ctx.wrap_socket(sock, server_hostname=host) as secure_sock:
                    secure_sock.settimeout(4)
                    cert = secure_sock.getpeercert()
                    expiry = cert.get("notAfter", "")
                    days = None
                    if expiry:
                        expires_at = datetime.fromtimestamp(ssl.cert_time_to_seconds(expiry), tz=timezone.utc)
                        days = (expires_at - datetime.now(timezone.utc)).days
                    return {
                        "verified": True,
                        "tls_version": secure_sock.version() or "غير محدد",
                        "cipher": (secure_sock.cipher() or ("غير محدد",))[0],
                        "issuer": _flatten_name(cert.get("issuer", ())),
                        "subject": _flatten_name(cert.get("subject", ())),
                        "expires_at": expiry,
                        "days_remaining": days,
                        "san_count": min(len(cert.get("subjectAltName", ())), 10000),
                        "connected_public_ip": ip,
                        "note": "IP وجهة اتصال HTTPS العامة، وليس دليلًا على عنوان الخادم الأصلي"
                    }
        except (OSError, ssl.SSLError, ValueError) as exc:
            errors.append(type(exc).__name__)
    return {
        "verified": False, "error": "تعذر التحقق من شهادة TLS عبر الاتصال العام.",
        "error_types": list(dict.fromkeys(errors))[:3],
        "note": "قد تكون هناك مشكلة شهادة أو شبكة أو جدار ناري"
    }

def inspect_network(host, extended=False):
    output = {"dns": None, "tls": None}
    try:
        output["dns"] = dns_lookup(host, extended=extended)
    except (ValueError, OSError, dns.exception.DNSException):
        output["dns"] = {
            "records": {}, "public_ips": [], "reverse_dns": [],
            "cdn_hint": "غير متوفر", "origin_ip": None,
            "origin_status": "تعذر استرجاع السجلات العامة"
        }
    try:
        output["tls"] = tls_metadata(host)
    except (ValueError, OSError, ssl.SSLError):
        output["tls"] = {"verified": False, "error": "تعذر الاتصال الآمن"}
    return output
