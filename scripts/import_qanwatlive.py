#!/usr/bin/env python3
"""Import public QanwatLive metadata into unpublished rights-review drafts only."""
import concurrent.futures as cf
from html.parser import HTMLParser
import html, re, json, os, time, datetime, ipaddress
from urllib import request, parse
import xml.etree.ElementTree as ET

SITE="https://www.qanwatlive.com"
DB=os.getenv("SUPABASE_URL","https://qyzmlwtvzzgooccqxglq.supabase.co").rstrip("/")
KEY=os.getenv("SUPABASE_SERVICE_ROLE_KEY","")
DRY=not KEY or os.getenv("DRY_RUN","").lower() in ("1","true")
MAX=min(450,max(1,int(os.getenv("MAX_POSTS","400"))))
NOW=datetime.datetime.now(datetime.timezone.utc).isoformat()
H={"User-Agent":"AlEzzTV-CatalogInspector/1.0","Accept":"*/*"}
LOG={"time":NOW,"source":SITE,"dry_run":DRY,"discovered":0,"inspected":0,
"with_image":0,"with_embed":0,"hls_verified":0,"existing":0,
"inserted_drafts":0,"errors":[],"channels":[]}

def okurl(u):
    try:
        p=parse.urlsplit(u)
        if p.scheme!="https" or not p.hostname or p.username or p.password or len(u)>2300:return False
        h=p.hostname.lower()
        if h in ("localhost","metadata.google.internal") or h.endswith((".local",".internal")):return False
        try:return ipaddress.ip_address(h).is_global
        except ValueError:return True
    except:return False

def fetch(url,limit=1200000,timeout=18,headers=None):
    if not okurl(url):raise ValueError("Unsafe URL")
    req=request.Request(url,headers={**H,**(headers or {})})
    with request.urlopen(req,timeout=timeout) as r:
        if not okurl(r.geturl()):raise ValueError("Unsafe redirect")
        b=r.read(limit+1)
        if len(b)>limit:raise ValueError("Oversized response")
        return b,r.geturl()

def read(url):return fetch(url)[0].decode("utf-8-sig","replace")

def canonical(u):
    try:
        p=parse.urlsplit(parse.urljoin(SITE+"/",html.unescape(u)))
        if p.scheme!="https" or p.hostname not in ("www.qanwatlive.com","qanwatlive.com"):return None
        if not re.search(r"/20\d{2}/\d{2}/[^/]+\.html$",p.path):return None
        return SITE+p.path
    except:return None

class Tags(HTMLParser):
    def __init__(self):
        super().__init__();self.hrefs=[];self.iframes=[];self.images=[];self.meta={}
    def handle_starttag(self,t,attrs):
        d=dict(attrs)
        if t=="a" and d.get("href"):self.hrefs.append(d["href"])
        if t=="iframe" and (d.get("src") or d.get("data-src")):self.iframes.append(d.get("data-src") or d.get("src"))
        if t=="img" and (d.get("src") or d.get("data-src")):self.images.append((d.get("data-src") or d.get("src"),d.get("alt","")))
        if t=="meta":
            k=d.get("property") or d.get("name")
            if k and d.get("content"):self.meta[k.lower()]=d["content"]

def tags(doc):
    p=Tags();p.feed(doc);return p

def discover():
    posts={}
    feed_complete=False
    for start in range(1,752,150):
        try:
            raw,_=fetch(SITE+"/feeds/posts/default?alt=json&max-results=150&start-index="+str(start),10000000,25)
            entries=(json.loads(raw).get("feed") or {}).get("entry") or []
            for e in entries:
                link=next((x.get("href","") for x in e.get("link",[]) if x.get("rel")=="alternate"),"")
                u=canonical(link)
                if u:posts[u]={"url":u,"name":e.get("title",{}).get("$t",""),
                              "labels":[x.get("term","") for x in e.get("category",[])],
                              "image":(e.get("media$thumbnail") or {}).get("url",""),
                              "body":e.get("content",{}).get("$t","")}
            if len(entries)<150:
                feed_complete=True
                break
            if len(posts)>=MAX:break
        except Exception as e:LOG["errors"].append("Feed: "+str(e)[:130]);break
    if feed_complete and posts:
        LOG["discovered"]=len(posts)
        return list(posts.values())[:MAX]
    for sitemap in ("/sitemap.xml","/sitemap-posts.xml"):
        try:
            b,_=fetch(SITE+sitemap,4000000,20)
            for el in ET.fromstring(b).iter():
                if el.tag.endswith("loc") and el.text:
                    u=canonical(el.text)
                    if u:posts.setdefault(u,{"url":u})
        except Exception as e:LOG["errors"].append("Sitemap: "+str(e)[:120])
    seen=set();queue=[SITE+"/"]
    while queue and len(seen)<100 and len(posts)<MAX:
        u=queue.pop(0)
        if u in seen:continue
        seen.add(u)
        try:
            p=tags(read(u))
            for href in p.hrefs:
                absolute=parse.urljoin(SITE,html.unescape(href))
                article=canonical(absolute)
                if article:posts.setdefault(article,{"url":article})
                elif "/search/label/" in absolute and okurl(absolute) and absolute not in seen and absolute not in queue and len(queue)<100:
                    queue.append(absolute)
        except Exception as e:LOG["errors"].append("Category "+u[:70]+": "+str(e)[:90])
        time.sleep(.15)
    LOG["discovered"]=len(posts)
    return list(posts.values())[:MAX]

def clean(s):
    s=html.unescape(re.sub(r"<[^>]*>"," ",s or ""))
    s=re.sub(r"\s+"," ",s).strip()
    s=re.sub(r"^(?:مشاهدة\s+)?قنوات?\s+","",s)
    s=re.sub(r"\s*(?:بث مباشر(?: الآن)?(?: 24 ساعة)?|مباشر(?: الآن)?)\s*$","",s)
    return s.strip(" -:|")[:180]

def norm(s):
    s=re.sub(r"\b(?:hd|4k|fhd|tv|live)\b"," ",clean(s).lower())
    return re.sub(r"\s+"," ",re.sub(r"[\W_]+"," ",s)).strip()

def tags_for(s):
    t=s.lower()
    network="mbc" if re.search(r"\bmbc\b|ام بي سي|إم بي سي",t) else "rotana" if "روتانا" in t or "rotana" in t else "on" if re.search(r"\bon\b|أون",t) else "other"
    for g,expr in [("sports","رياض|sport|ssc|bein"),("kids","أطفال|كرتون|kids|cartoon"),("movies","أفلام|سينما|movies|cinema"),("series","مسلسل|دراما|drama|series"),("news","أخبار|إخباري|news"),("documentary","وثائق|documentary"),("religious","ديني|قرآن|سنة|quran")]:
        if re.search(expr,t):return network,g
    return network,"general"

def sources(doc,p):
    raw=html.unescape(doc).replace("\\/","/")
    raw=re.sub(r"\\u0026","&",raw,flags=re.I)
    raw=re.sub(r"\\u003d","=",raw,flags=re.I)
    urls=[]
    for m in re.findall(r"https?://[^\s\"'<>\\]+",raw,re.I):
        m=m.rstrip(");,\\")
        if okurl(m) and re.search(r"\.(?:m3u8|mpd|mp4)(?:[?#]|$)",m,re.I) and not re.search(r"[?&](?:token|signature|auth|expires|jwt|hdnts|key)=",m,re.I) and m not in urls:urls.append(m)
    embeds=[]
    for x in p.iframes:
        x=parse.urljoin(SITE,x)
        if okurl(x) and x not in embeds:embeds.append(x)
    return urls[:14],embeds[:10]

def hls(url):
    try:
        for _ in range(3):
            b,real=fetch(url,200000,12)
            s=b.decode("utf-8-sig","replace")
            if not s.startswith("#EXTM3U") or "#EXT-X-KEY" in s or "SAMPLE-AES" in s:return False
            links=[x.strip() for x in s.splitlines() if x.strip() and not x.startswith("#")]
            if not links:return False
            u=parse.urljoin(real,links[0])
            if not okurl(u):return False
            if "#EXT-X-STREAM-INF" in s:url=u;continue
            if "#EXTINF" not in s:return False
            chunk,_=fetch(u,4096,12,{"Range":"bytes=0-4095"})
            return len(chunk)>188 and (chunk[0]==71 or any(x in chunk[:64] for x in (b"ftyp",b"styp",b"moof")))
        return False
    except:return False

def inspect(info):
    try:
        doc=info.get("body") or read(info["url"])
        p=tags(doc)
        name=clean(p.meta.get("og:title") or info.get("name",""))
        if not name:
            m=re.search(r"<title[^>]*>(.*?)</title>",doc,re.S|re.I)
            name=clean(m.group(1)) if m else ""
        if not name:return {"url":info["url"],"error":"No channel title"}
        image=p.meta.get("og:image") or info.get("image")
        if image and not okurl(image):image=None
        if not image:
            for u,alt in p.images:
                v=parse.urljoin(SITE,u)
                if alt and ("قناة" in alt or name in alt) and okurl(v):image=v;break
        links,embeds=sources(doc,p)
        verified=[x for x in links[:4] if parse.urlsplit(x).path.lower().endswith(".m3u8") and hls(x)]
        network,genre=tags_for(name+" "+" ".join(info.get("labels",[])))
        return {"url":info["url"],"name":name,"poster":image,"labels":info.get("labels",[]),
                "network":network,"genre":genre,"sources":links,"embedded_players":embeds,"verified_hls":verified}
    except Exception as e:return {"url":info["url"],"error":str(e)[:150]}

def db(method,path,body=None):
    b=None if body is None else json.dumps(body,ensure_ascii=False).encode()
    req=request.Request(DB+"/rest/v1/"+path,data=b,method=method,headers={"apikey":KEY,"Authorization":"Bearer "+KEY,"Content-Type":"application/json","Prefer":"return=representation"})
    with request.urlopen(req,timeout=30) as r:
        data=r.read(2000000);return json.loads(data) if data else []

CAT={"sports":"قنوات عربية — رياضة","kids":"قنوات عربية — كرتون وأطفال","movies":"قنوات عربية — أفلام","series":"قنوات عربية — مسلسلات","news":"قنوات عربية — أخبار","documentary":"قنوات عربية — وثائقيات","religious":"قنوات عربية — دينية","general":"قنوات عربية — منوعات"}
def stage(items):
    if DRY:return
    old=[]
    for off in range(0,10000,500):
        rows=db("GET","aseel_channels?select=title_ar,stream_url,description&limit=500&offset="+str(off))
        old.extend(rows)
        if len(rows)<500:break
    names={norm(x["title_ar"]) for x in old if x.get("title_ar")}
    urls={x["stream_url"] for x in old if x.get("stream_url")}
    pages={m.group(1) for x in old for m in re.finditer(r"QanwatLive source: (https://\S+)",x.get("description") or "")}
    cats={x["name_ar"]:x["id"] for x in db("GET","aseel_categories?select=id,name_ar&limit=500")}
    for item in items:
        if item.get("error") or not item.get("name"):continue
        title=norm(item["name"]);verified=item["verified_hls"]
        if title in names or item["url"] in pages or any(u in urls for u in verified):
            LOG["existing"]+=1;item["import_status"]="existing";continue
        category=cats.get("قنوات MBC" if item["network"]=="mbc" else CAT[item["genre"]])
        if not category:LOG["errors"].append("Missing category for "+item["name"]);continue
        row={"title_ar":item["name"],"description":"QanwatLive source: "+item["url"]+" — Content and rebroadcast rights pending review.",
             "poster_url":item["poster"],"stream_url":verified[0] if verified else None,
             "stream_variants":[{"label":"Verified backup","url":u} for u in verified[1:]],
             "category_id":category,"genre_tags":[item["genre"],"network:"+item["network"]],
             "status":"draft","rights_status":"pending","playback_mode":"stream","language_code":"ar",
             "link_health_status":"healthy" if verified else "unchecked",
             "link_health_checked_at":NOW if verified else None,
             "link_health_reason":"Actual media bytes verified" if verified else "No verified unencrypted direct HLS"}
        try:
            if db("POST","aseel_channels",row):
                LOG["inserted_drafts"]+=1;item["import_status"]="draft";names.add(title);pages.add(item["url"]);urls.update(verified)
        except Exception as e:LOG["errors"].append("Insert "+item["name"]+": "+str(e)[:130])
def main():
    try:
        discovered=discover()
        with cf.ThreadPoolExecutor(max_workers=5) as pool:found=list(pool.map(inspect,discovered))
        LOG["inspected"]=len(found)
        LOG["with_image"]=sum(bool(x.get("poster")) for x in found)
        LOG["with_embed"]=sum(bool(x.get("embedded_players")) for x in found)
        LOG["hls_verified"]=sum(bool(x.get("verified_hls")) for x in found)
        stage(found);LOG["channels"]=found
    finally:
        with open("qanwatlive-catalog-report.json","w",encoding="utf-8") as f:json.dump(LOG,f,ensure_ascii=False,indent=2)
        print(json.dumps({k:v for k,v in LOG.items() if k!="channels"},ensure_ascii=False),flush=True)
if __name__=="__main__":main()
