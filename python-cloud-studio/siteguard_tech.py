"""Public-only technology fingerprints for Al Ezz SiteGuard.
Only information explicitly exposed in HTTP headers and public HTML is used.
No probing of private assets or login endpoints.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit, parse_qs

UNKNOWN = "غير معلن"
VERSION = re.compile(r"(?<!\d)(\d{1,3}\.\d{1,3}(?:\.\d{1,4}){0,2})(?!\d)")

def limit(value, n=120):
    return str(value or "").strip()[:n]

def add(items, name, version=UNKNOWN, source="", confidence="مستنتج"):
    if not name:
        return
    key = name.lower()
    if any(x["name"].lower() == key for x in items):
        for row in items:
            if row["name"].lower() == key and row["version"] == UNKNOWN and version != UNKNOWN:
                row.update(version=version, evidence=limit(source, 170), confidence=confidence)
        return
    if len(items) < 35:
        items.append(dict(name=name, version=limit(version, 40), evidence=limit(source, 170), confidence=confidence))

def disclosed_version(value, product):
    if not value:
        return UNKNOWN
    match = re.search(r"(?i)\b" + re.escape(product) + r"\s*(?:/|:|\s)\s*v?(\d+(?:\.\d+){1,3})", value)
    return match.group(1) if match else UNKNOWN

def src_version(url, names):
    try:
        parsed = urlsplit(url.replace("&amp;", "&"))
        path = parsed.path.lower()
        for name in names:
            needle = re.escape(name.lower())
            m = re.search(r"(?:^|[-/.])" + needle + r"[-/.](\d+(?:\.\d+){1,3})(?=[-/.]|$)", path)
            if m:
                return m.group(1)
        qs = parse_qs(parsed.query, keep_blank_values=False)
        for key in ("ver", "version", "v"):
            for value in qs.get(key, []):
                if re.fullmatch(r"\d+(?:\.\d+){1,3}", value):
                    return value
    except ValueError:
        pass
    return UNKNOWN

def analyze(headers, markup):
    h = {str(k).lower(): str(v)[:400] for k, v in (headers or {}).items()}
    html = (markup or "")[:120000]
    lower = html.lower()
    server = h.get("server", "")
    power = h.get("x-powered-by", "")
    result = {
        "php": {"type": "غير معروف", "version": UNKNOWN, "evidence": "لم تظهر بصمة PHP صريحة"},
        "database": {"type": "غير معروف", "version": UNKNOWN,
                     "evidence": "إصدار قاعدة البيانات لا يكون مرئيًا عادةً عبر HTTP"},
        "languages": [],
        "libraries": [],
        "infrastructure": [],
        "cms": {"name": "غير محدد", "version": UNKNOWN, "evidence": ""},
        "version_limitations": "الإصدارات المعروضة مبنية على البيانات المنشورة فقط؛ لا يمكن تأكيد PHP أو قاعدة البيانات المخفيين دون وصول مشروع للخادم."
    }
    languages, libraries, infra = result["languages"], result["libraries"], result["infrastructure"]
    if "php/" in power.lower() or "php/" in server.lower():
        ver = disclosed_version(power + " " + server, "PHP")
        result["php"] = {"type": "PHP", "version": ver,
                         "evidence": "X-Powered-By / Server"}
        add(languages, "PHP", ver, "ترويسة HTTP", "معلن")
    elif re.search(r"(?:wp-content/|wp-includes/|wordpress|laravel_session|phpbb|mybb|xenforo|vbulletin)", lower):
        result["php"] = {"type": "PHP (مستنتج)", "version": UNKNOWN,
                         "evidence": "بصمة نظام مبني عادةً باستخدام PHP"}
        add(languages, "PHP", UNKNOWN, "بصمة CMS/Framework", "مستنتج")
    if re.search(r"<script\b|javascript|\.js(?:[?\"'\s]|$)", html, re.I):
        add(languages, "JavaScript", UNKNOWN, "عناصر JavaScript في HTML", "معلن")
    if re.search(r"<style\b|\.css(?:[?\"'\s]|$)", html, re.I):
        add(languages, "CSS", UNKNOWN, "CSS في HTML", "معلن")
    if html:
        add(languages, "HTML", "HTML5" if re.search(r"(?i)<!doctype\s+html>", html[:500]) else UNKNOWN,
            "HTML response", "معلن")

    for name in ("nginx", "Apache", "LiteSpeed", "Caddy", "Microsoft-IIS", "openresty"):
        if re.search(r"(?i)(?<!\w)" + re.escape(name) + r"(?:/|\b)", server):
            add(infra, name, disclosed_version(server, name), "Server: " + limit(server, 100), "معلن")
    if h.get("cf-ray") or "cloudflare" in server.lower():
        add(infra, "Cloudflare", UNKNOWN, "CF-Ray / Server", "معلن")
    if h.get("x-vercel-id") or "vercel" in server.lower():
        add(infra, "Vercel", UNKNOWN, "X-Vercel-ID / Server", "معلن")
    if h.get("x-amz-cf-id"):
        add(infra, "AWS CloudFront", UNKNOWN, "X-Amz-Cf-Id", "معلن")
    if h.get("x-aspnet-version"):
        add(languages, "ASP.NET", limit(h["x-aspnet-version"], 40), "X-AspNet-Version", "معلن")
    elif "asp.net" in power.lower():
        add(languages, "ASP.NET", disclosed_version(power, "ASP.NET"), "X-Powered-By", "معلن")
    if "express" in power.lower():
        add(libraries, "Express", disclosed_version(power, "Express"), "X-Powered-By", "معلن")
        add(languages, "JavaScript (Node.js محتمل)", UNKNOWN, "Express header", "مستنتج")

    generators = re.findall(
        r'(?is)<meta\b[^>]{0,1000}?\bname\s*=\s*["\x27]generator["\x27][^>]{0,1000}>', html[:60000])
    for tag in generators[:3]:
        content = re.search(r'(?i)\bcontent\s*=\s*["\x27]([^"\x27]{1,120})', tag)
        if not content:
            continue
        val = content.group(1)
        for name in ("WordPress", "Drupal", "Joomla", "XenForo", "vBulletin", "phpBB", "MyBB"):
            if name.lower() in val.lower():
                version = disclosed_version(val, name)
                result["cms"] = {"name": name, "version": version, "evidence": "meta generator"}
                break
        if result["cms"]["name"] != "غير محدد":
            break
    cms_signatures = (
        ("WordPress", r"wp-content/|wp-includes/|wp-json"),
        ("XenForo", r"xenforo|data-xf-init|/js/xf/"),
        ("vBulletin", r"vbulletin|/clientscript/vbulletin"),
        ("phpBB", r"\bphpbb\b|prosilver"),
        ("MyBB", r"\bmybb\b|/jscripts/general\.js"),
        ("Drupal", r"drupalsettings|/sites/default/files/"),
        ("Joomla", r"joomla|/media/system/js/"),
        ("Laravel", r"laravel_session"),
        ("Discourse", r"discourse\.|discourse-application"),
    )
    if result["cms"]["name"] == "غير محدد":
        for name, signature in cms_signatures:
            if re.search(signature, html, re.I):
                result["cms"] = {"name": name, "version": UNKNOWN, "evidence": "بصمة HTML عامة"}
                break
    if result["cms"]["name"] in ("WordPress", "Drupal", "Joomla", "XenForo", "vBulletin", "phpBB", "MyBB") and result["php"]["type"] == "غير معروف":
        result["php"] = {"type": "PHP (مستنتج)", "version": UNKNOWN,
                         "evidence": "نظام محتوى مبني على PHP"}
        add(languages, "PHP", UNKNOWN, "بصمة CMS", "مستنتج")

    frontend = (
        ("jQuery", r"(?:jquery(?:\.min)?\.js|jquery[-.]\d|jquery\.min\.js)", ("jquery",)),
        ("Bootstrap", r"bootstrap(?:\.min)?\.(?:css|js)|bootstrap[-.]\d", ("bootstrap",)),
        ("React", r"react(?:\.production)?(?:\.min)?\.js|data-reactroot|__reactcontainer|react-dom", ("react",)),
        ("Vue.js", r"vue(?:\.runtime)?(?:\.global)?(?:\.min)?\.js|data-v-[\da-f]{6,}|__vue__", ("vue",)),
        ("Angular", r"ng-version=|angular(?:\.min)?\.js|ng-app=", ("angular",)),
        ("Next.js", r"/_next/|__next_data__|__next_f", ("next",)),
        ("Nuxt", r"/_nuxt/|__nuxt__", ("nuxt",)),
        ("Svelte", r"__svelte|svelte(?:\.min)?\.js", ("svelte",)),
        ("Alpine.js", r"alpine(?:\.min)?\.js|x-data=", ("alpine",)),
        ("HTMX", r"htmx(?:\.min)?\.js|hx-get=|hx-post=", ("htmx",)),
    )
    sources = re.findall(r'(?i)(?:src|href)\s*=\s*["\x27]([^"\x27]{1,350})["\x27]', html[:80000])
    for name, signature, aliases in frontend:
        if re.search(signature, html, re.I):
            version = UNKNOWN
            evidence = "بصمة HTML/asset"
            for src in sources[:150]:
                if any(alias in src.lower() for alias in aliases):
                    version = src_version(src, aliases)
                    evidence = "ملف ظاهر في HTML"
                    if version != UNKNOWN:
                        break
            if name == "Angular":
                m = re.search(r'ng-version\s*=\s*["\x27]([\d.]+)', html, re.I)
                if m:
                    version = m.group(1)
                    evidence = "ng-version"
            add(libraries, name, version, evidence, "معلن" if version != UNKNOWN else "مستنتج")
    if result["cms"]["name"] == "WordPress":
        for src in sources[:150]:
            if "wp-includes" in src.lower():
                result["cms"]["evidence"] = "wp-includes / HTML"
                break
    # Only infer a vendor from public code references; do not infer database version.
    if re.search(r"(?i)https?://[a-z0-9-]+\.supabase\.co|@supabase/supabase-js", html):
        result["database"] = {"type": "PostgreSQL (احتمال عبر Supabase)", "version": UNKNOWN,
                              "evidence": "مرجع Supabase عام؛ قد لا يكون قاعدة البيانات الرئيسية"}
    for name, pattern, language in (
        ("Django", r"(?i)\bdjango(?:/|\s)\d|\bdjango\b", "Python"),
        ("Ruby on Rails", r"(?i)\bruby on rails\b|\brails\b", "Ruby"),
        ("Node.js", r"(?i)\bnode\.js/|\bnodejs/", "JavaScript"),
        ("Uvicorn", r"(?i)\buvicorn(?:/|\s)", "Python"),
        ("Gunicorn", r"(?i)\bgunicorn(?:/|\s)", "Python"),
        ("Kestrel", r"(?i)\bkestrel\b", "C# / .NET"),
    ):
        if re.search(pattern, power + " " + server):
            add(infra, name, disclosed_version(power + " " + server, name),
                "Server / X-Powered-By", "معلن")
            add(languages, language, UNKNOWN, "بصمة خادم / إطار عمل", "مستنتج")

    # Explicit, publicly returned DB headers only. Do not connect to the DB.
    db_text = " ".join(
        h.get(key, "") for key in ("x-database", "x-dbms", "x-db-type", "x-database-type"))
    version_text = " ".join(
        h.get(key, "") for key in ("x-database-version", "x-db-version", "x-postgresql-version",
                                   "x-mysql-version", "x-mariadb-version", "x-mongodb-version"))
    db_engine = "غير معروف"
    for name, aliases in (
        ("PostgreSQL", ("postgresql", "postgres")),
        ("MariaDB", ("mariadb",)),
        ("MySQL", ("mysql",)),
        ("SQLite", ("sqlite",)),
        ("MongoDB", ("mongodb",)),
        ("Microsoft SQL Server", ("mssql", "sql server")),
    ):
        if any(alias in (db_text + " " + version_text).lower() for alias in aliases):
            db_engine = name
            break
    if db_engine == "غير معروف":
        for header, engine in (
            ("x-postgresql-version", "PostgreSQL"),
            ("x-mysql-version", "MySQL"),
            ("x-mariadb-version", "MariaDB"),
            ("x-mongodb-version", "MongoDB"),
        ):
            if h.get(header):
                db_engine = engine
                break
    match = VERSION.search(version_text)
    if db_engine != "غير معروف" or match:
        result["database"] = {
            "type": db_engine,
            "version": match.group(1) if match else UNKNOWN,
            "evidence": "نسخة أو نوع معلن في ترويسة HTTP (غير موثّق من الخادم الداخلي)"
        }
    # Intentionally no probing of DB ports, SQL syntax, .env, backups or phpinfo.
    return result
