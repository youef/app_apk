"""Read-only discovery of openly declared media and episode links on public HTTPS pages.

This module never bypasses site access controls, clicks download ads, harvests
authenticated streams, or copies protected media. It returns candidate references
for independent authorization and media validation.
"""
from __future__ import annotations
import ipaddress, json, re, socket
from urllib.parse import urljoin, urlsplit, urldefrag
import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router=APIRouter()
MEDIA_EXT=re.compile(r"\.(?:mp4|m4v|webm|m3u8)(?:$|[?#])",re.I)
EPISODE=re.compile(r"(?:الحلقة|الحلقه|موسم|الموسم|episode|season|\bep\s*\d+|\bs\d+e\d+)",re.I)
MAX_HTML=1_500_000
MAX_RESULTS=60

class PageInput(BaseModel):
    page_url:str=Field(min_length=12,max_length=2048)

def validate_page(url):
    parts=urlsplit(url)
    host=(parts.hostname or "").lower().rstrip(".")
    if (parts.scheme!="https" or not host or "." not in host or
        parts.username or parts.password or parts.port not in (None,443) or
        len(url)>2048 or host=="localhost" or
        host.endswith((".local",".internal",".lan",".test",".invalid",".onion"))):
        raise ValueError("يُسمح فقط بصفحات HTTPS العامة")
    try:
        ipaddress.ip_address(host)
        raise ValueError("عناوين IP المباشرة مرفوضة")
    except ValueError as error:
        if str(error)=="عناوين IP المباشرة مرفوضة":
            raise
    addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("عنوان الشبكة ليس عامًا")
    return urldefrag(url).url

def discover_page(url):
    url=validate_page(url)
    result={"page_url":url,"status":"unavailable","title":"","media":[],"episodes":[],"embeds":[],"notes":[]}
    # Never automatically follow redirects: each destination must be validated.
    with requests.Session() as session:
        session.trust_env=False
        try:
            with session.get(url,timeout=(10,18),stream=True,allow_redirects=False,
                             headers={"Accept":"text/html,application/xhtml+xml"}) as response:
                result["http_status"]=response.status_code
                if response.status_code in (401,403):
                    result["notes"].append("الموقع رفض طلب Render. تشغيله على جوالك لا يضمن وصول الخادم.")
                    return result
                if response.status_code in (301,302,303,307,308):
                    target=urljoin(url,response.headers.get("Location",""))
                    try: target=validate_page(target)
                    except (ValueError,OSError): target=None
                    result["redirect_url"]=target
                    result["notes"].append("الموقع أعاد تحويلًا؛ لن يُتبع تلقائيًا.")
                    return result
                if response.status_code!=200:
                    result["notes"].append("خادم الصفحة أعاد HTTP "+str(response.status_code))
                    return result
                ct=response.headers.get("content-type","").lower()
                if "html" not in ct:
                    result["notes"].append("المصدر ليس صفحة HTML")
                    return result
                content=bytearray()
                for chunk in response.iter_content(32768):
                    content.extend(chunk)
                    if len(content)>MAX_HTML:
                        result["notes"].append("حجم الصفحة أكبر من الحد المسموح")
                        return result
        except requests.RequestException:
            result["notes"].append("تعذر اتصال Render بالصفحة")
            return result
    doc=BeautifulSoup(bytes(content),"html.parser")
    result["title"]=(doc.title.get_text(" ",strip=True) if doc.title else "")[:180]
    known=set()
    def add(url_value,label="فيديو"):
        value=urljoin(url,str(url_value or "").strip())
        if not MEDIA_EXT.search(value) or value in known or len(result["media"])>=MAX_RESULTS:
            return
        try:
            from private_film_import import safe_source
            safe_source(value)
        except (ValueError,OSError):
            return
        known.add(value)
        result["media"].append({"url":value,"label":str(label)[:140],"verified":False})
    for tag in doc.select("video[src],video source[src],source[src],a[href]"):
        value=tag.get("src") or tag.get("href")
        add(value,tag.get_text(" ",strip=True) or tag.get("title") or "ملف فيديو")
    for tag in doc.select('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"]'):
        add(tag.get("content"),"بيانات الفيديو")
    for tag in doc.select('script[type="application/ld+json"]')[:12]:
        if len(tag.get_text())>100000: continue
        try: data=json.loads(tag.get_text())
        except (ValueError,TypeError): continue
        def visit(node,depth=0):
            if depth>5:return
            if isinstance(node,dict):
                for k,v in node.items():
                    if k in ("contentUrl","encodingUrl") and isinstance(v,str):
                        add(v,"بيانات JSON-LD")
                    elif isinstance(v,(dict,list)):
                        visit(v,depth+1)
            elif isinstance(node,list):
                for v in node[:50]:visit(v,depth+1)
        visit(data)
    seen_episodes=set()
    for tag in doc.select("a[href]")[:1200]:
        label=tag.get_text(" ",strip=True)[:140]
        if not EPISODE.search(label):continue
        link=urljoin(url,tag.get("href",""))
        if link in seen_episodes or len(result["episodes"])>=MAX_RESULTS:continue
        try: validate_page(link)
        except (ValueError,OSError):continue
        seen_episodes.add(link)
        result["episodes"].append({"title":label,"page_url":link,"verified":False})
    for frame in doc.select("iframe[src]")[:20]:
        link=urljoin(url,frame.get("src",""))
        try: validate_page(link)
        except (ValueError,OSError):continue
        if link not in result["embeds"]:
            result["embeds"].append(link)
    result["status"]="parsed"
    if not result["media"]:
        result["notes"].append("لم تظهر روابط فيديو مباشرة في HTML العام؛ قد يكون المشغل ديناميكيًا أو مقيّدًا.")
    result["notes"].append("هذه روابط مرشّحة فقط. يجب التحقق من عمل الفيديو وحقوق إعادة الاستضافة قبل الاستيراد.")
    return result

def register(portal):
    @router.post("/api/private-film/discover")
    def discover(data:PageInput,request:Request):
        from private_film_import import owner
        owner(request,portal)
        if request.headers.get("origin")!=str(request.base_url).rstrip("/"):
            raise HTTPException(403,"Same-origin admin request required")
        try:return discover_page(data.page_url)
        except (OSError,ValueError) as error:
            return {"status":"error","media":[],"episodes":[],"embeds":[],
                    "notes":[str(error)[:200]]}
