"""Read-only Chromium diagnostics for public, openly available media pages.

No cookies, captcha bypass, stealth plugins, download actions, DRM decryption, or
retention of protected media. Every outgoing browser request is checked to prevent
requests into internal networks (SSRF).
"""
from __future__ import annotations
import ipaddress
import re
import socket
from urllib.parse import urlsplit, urldefrag
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

router = APIRouter()
MEDIA_EXT = re.compile(r"\.(?:mp4|m4v|webm|m3u8)(?:$|[?#])", re.I)
MAX_EVENTS = 65

class BrowserDiagnosticsInput(BaseModel):
    page_url: str = Field(min_length=12, max_length=2048)

def safe_public_https(url: str) -> str:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if (parsed.scheme != "https" or not host or "." not in host or
            parsed.username or parsed.password or parsed.port not in (None,443) or
            len(url)>2048 or host=="localhost" or
            host.endswith((".local",".internal",".lan",".test",".invalid",".onion"))):
        raise ValueError("الطلب لا يستخدم نطاق HTTPS عامًا وآمنًا")
    try:
        ipaddress.ip_address(host)
        raise ValueError("روابط IP المباشرة مرفوضة")
    except ValueError as exc:
        if str(exc)=="روابط IP المباشرة مرفوضة":
            raise
    addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("أحد النطاقات يشير إلى عنوان شبكة غير عام")
    return urldefrag(url).url

def diagnose(url):
    url = safe_public_https(url)
    output = {"page_url":url, "engine":"Chromium / Playwright", "state":"started",
              "http_status":None,"page_title":"","video_elements":0,
              "candidate_media":[],"dom_media":[],"responses":[],"blocked_requests":0,"notes":[],
              "devtools":{"enabled":False,"requests":[],"console_errors":0,
                          "failed_requests":0,"cache_hits":0,"cache_policies":[],
                          "cookies":{"count":0,"http_only":0,"secure":0,"same_site_none":0},
                          "note":"جلسة Chromium جديدة بدون كوكيز مستوردة أو ذاكرة تخزين سابقة."}}
    observed=set()
    allowed_cache=set()
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            context=browser.new_context(ignore_https_errors=False,service_workers="block",
                accept_downloads=False, java_script_enabled=True)
            page=context.new_page()
            # Read-only CDP Network domain, equivalent to DevTools Network panel.
            # Request/response headers and cookie values are never collected.
            dev=output["devtools"]
            cdp=None
            try:
                cdp=context.new_cdp_session(page)
                cdp.send("Network.enable",{"maxTotalBufferSize":65536})
                dev["enabled"]=True
                def cdp_response(event):
                    if len(dev["requests"])>=90:return
                    response=event.get("response",{})
                    raw_url=response.get("url","")
                    parsed=urlsplit(raw_url)
                    if parsed.scheme not in ("https","http"):return
                    headers={str(k).lower():str(v) for k,v in response.get("headers",{}).items()}
                    cache_control=headers.get("cache-control","")[:100]
                    record={
                        "host":(parsed.hostname or "")[:120],
                        "type":str(event.get("type","Other"))[:30],
                        "status":int(response.get("status",0)),
                        "mime":str(response.get("mimeType",""))[:75],
                        "from_disk_cache":bool(response.get("fromDiskCache")),
                        "from_service_worker":bool(response.get("fromServiceWorker")),
                        "cache_control":cache_control,
                        "age":headers.get("age","")[:15],
                    }
                    dev["requests"].append(record)
                    if record["from_disk_cache"]:dev["cache_hits"]+=1
                    if cache_control and cache_control not in dev["cache_policies"] and len(dev["cache_policies"])<10:
                        dev["cache_policies"].append(cache_control)
                cdp.on("Network.responseReceived",cdp_response)
                cdp.on("Network.requestServedFromCache",
                       lambda _event:dev.__setitem__("cache_hits",dev["cache_hits"]+1))
            except Exception:
                dev["enabled"]=False
                output["notes"].append("تعذّر تمكين بروتوكول DevTools؛ سيُستخدم فحص Playwright المعتاد.")
            page.on("requestfailed",lambda _request:dev.__setitem__(
                "failed_requests",dev["failed_requests"]+1))
            page.on("pageerror",lambda _error:dev.__setitem__(
                "console_errors",dev["console_errors"]+1))
            def route_handler(route):
                target=route.request.url
                try:
                    if target.startswith(("data:","blob:")):
                        return route.continue_()
                    if target not in allowed_cache:
                        safe_public_https(target)
                        allowed_cache.add(target)
                    return route.continue_()
                except (OSError,ValueError):
                    output["blocked_requests"]+=1
                    return route.abort()
            page.route("**/*",route_handler)
            def collect(response):
                if len(output["responses"])>=MAX_EVENTS:
                    return
                target=response.url
                if target in observed:
                    return
                observed.add(target)
                ctype=response.headers.get("content-type","").split(";")[0][:90]
                kind=("media" if MEDIA_EXT.search(target) or ctype.startswith("video/") or
                    "mpegurl" in ctype else "resource")
                if kind!="media" and response.status<400:
                    return
                record={"status":response.status,"type":kind,
                        "mime":ctype,"host":urlsplit(target).hostname or ""}
                # URL may include private signed tokens. Never return them from failed requests.
                if kind=="media" and response.status in (200,206):
                    record["url"]=target
                    if len(output["candidate_media"])<20:
                        output["candidate_media"].append({"url":target,"verified":False})
                output["responses"].append(record)
            page.on("response",collect)
            try:
                first=page.goto(url,wait_until="domcontentloaded",timeout=20000)
                output["http_status"]=first.status if first else None
                page.wait_for_timeout(1400)
                # Normal muted playback of already-present public <video> elements
                # may expose the first network media request without clicking ads.
                try:
                    page.evaluate("""() => {
                      for (const v of Array.from(document.querySelectorAll('video')).slice(0,2)) {
                        v.muted = true;
                        const promise = v.play();
                        if (promise && promise.catch) promise.catch(() => {});
                      }
                    }""")
                    page.wait_for_timeout(1000)
                except Exception:
                    pass
                output["page_title"]=page.title()[:180]
                output["video_elements"]=page.locator("video").count()
                # Media tags created by public JavaScript can expose URLs absent from the HTML.
                dom_urls=page.eval_on_selector_all("video, video source, source",
                    "nodes => nodes.map(n => n.currentSrc || n.src || n.getAttribute('src')).filter(Boolean).slice(0,35)")
                for candidate in dom_urls:
                    try:
                        target=safe_public_https(candidate)
                        if MEDIA_EXT.search(target) and not any(m["url"]==target for m in output["dom_media"]):
                            output["dom_media"].append({"url":target,"verified":False})
                    except (ValueError,OSError):
                        continue
                # Only summary flags from the isolated in-memory browsing session:
                # never expose cookies, localStorage, auth tokens or values.
                try:
                    cookies=context.cookies([url])
                    dev["cookies"]={
                        "count":len(cookies),
                        "http_only":sum(bool(c.get("httpOnly")) for c in cookies),
                        "secure":sum(bool(c.get("secure")) for c in cookies),
                        "same_site_none":sum(c.get("sameSite")=="None" for c in cookies)
                    }
                except Exception:
                    pass
                output["state"]="inspected"
            except PlaywrightTimeout:
                output["state"]="timeout"
                output["notes"].append("انتهت مهلة تحميل الصفحة. عُرضت الاستجابات المرصودة فقط.")
            except Exception as exc:
                output["state"]="failed"
                output["notes"].append("تعذر فتح الصفحة عبر Chromium: "+type(exc).__name__)
            finally:
                context.close()
        finally:
            browser.close()
    if output["http_status"] in (401,403):
        output["notes"].append("خادم الموقع رفض زيارة Render، ولا يمكن معالجة ذلك بتغيير User-Agent وحده.")
    if not output["candidate_media"]:
        output["notes"].append("لم تظهر استجابة فيديو عامة قابلة للفحص، ولا يعني ذلك عدم وجود مشغل محمي داخل الموقع.")
    output["notes"].append("تم جمع ملخصات Network وسياسات الكاش فقط. لا تُستخدم كوكيز الحسابات الخارجية أو ملفات المتصفح الشخصية.")
    output["notes"].append("هذه أداة تشخيص وليست إذنًا بالتحميل أو إعادة استضافة الأفلام.")
    return output

def register(portal):
    @router.post("/api/private-film/browser-diagnose")
    def browser_diagnose(data: BrowserDiagnosticsInput, request: Request):
        from private_film_import import owner
        owner(request,portal)
        if request.headers.get("origin") != str(request.base_url).rstrip("/"):
            raise HTTPException(403,"Same-origin admin request required")
        try:
            return diagnose(data.page_url)
        except (ValueError,OSError) as exc:
            return {"state":"failed", "notes":[str(exc)[:230]],"candidate_media":[],"responses":[]}
