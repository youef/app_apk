"""Private Supabase snapshots for resumable main Studio media scans.

The table has RLS on and only the server service-role can read/write it. Each
record is bound to a portal administrator UUID, expires in 24h, and is never
available through publishable/anon credentials. Never persist cookies, browser
headers, media bytes or authentication tokens outside authorized source URLs.
"""
from __future__ import annotations
import base64
import json
import os
import re
import time
import zlib
from urllib.parse import urlsplit
import requests

TABLE="aseel_studio_scan_checkpoints"
_SCAN_ID=re.compile(r"^[0-9a-f]{16}$")
_UID=re.compile(r"^[0-9a-fA-F-]{36}$")
MAX_SNAPSHOT_BYTES=2_000_000
MAX_UNPACKED_BYTES=10_000_000

def _pack_catalogue(data):
    """Compact large series scans without truncating individual episodes."""
    raw=json.dumps(data,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    if len(raw)<350_000:
        return data
    compressed=zlib.compress(raw,level=6)
    return {"_codec":"zlib-json-v1",
            "data":base64.b64encode(compressed).decode("ascii"),
            "original_bytes":len(raw)}

def _unpack_catalogue(data):
    if not isinstance(data,dict):
        return None
    if data.get("_codec")!="zlib-json-v1":
        return data
    try:
        compressed=base64.b64decode(data.get("data",""),validate=True)
        if len(compressed)>MAX_SNAPSHOT_BYTES:
            return None
        stream=zlib.decompressobj()
        output=stream.decompress(compressed,MAX_UNPACKED_BYTES+1)
        if len(output)>MAX_UNPACKED_BYTES or not stream.eof:
            return None
        result=json.loads(output)
        return result if isinstance(result,dict) else None
    except (ValueError,TypeError,zlib.error):
        return None


def _connection():
    key=os.getenv("ALEZZ_SUPABASE_SECRET_KEY") or os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY")
    root=os.getenv("ALEZZ_SUPABASE_URL","https://qyzmlwtvzzgooccqxglq.supabase.co").rstrip("/")
    p=urlsplit(root)
    if not key or p.scheme!="https" or not p.hostname or p.username or p.password:
        return None
    headers={"apikey":key,"Accept":"application/json","Content-Type":"application/json"}
    if not key.startswith("sb_secret_"):
        headers["Authorization"]="Bearer "+key
    return root+"/rest/v1/"+TABLE,headers

def available():
    return _connection() is not None

def save(scan_id,owner_id,source_url,catalogue,progress,completed,*,status="scanning"):
    if not _SCAN_ID.fullmatch(str(scan_id)) or not _UID.fullmatch(str(owner_id)):
        return False
    if status not in ("scanning","completed","interrupted","cancelled","failed"):
        return False
    target=_connection()
    if not target:return False
    payload={"scan_id":scan_id,"owner_id":owner_id,
             "source_url":source_url,"payload":_pack_catalogue(catalogue),"progress":progress,
             "completed":list(completed),"scan_status":status,
             "updated_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
             "expires_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(time.time()+86400))}
    raw=json.dumps(payload,ensure_ascii=False,separators=(",",":"))
    if len(raw.encode("utf-8"))>MAX_SNAPSHOT_BYTES:
        return False
    url,headers=target
    try:
        with requests.Session() as session:
            session.trust_env=False
            response=session.post(url,params={"on_conflict":"scan_id"},data=raw.encode("utf-8"),
                headers={**headers,"Prefer":"resolution=merge-duplicates,return=minimal"},
                timeout=(4,12),allow_redirects=False)
            return response.status_code in (200,201,204)
    except requests.RequestException:
        return False

def load(scan_id,owner_id):
    if not _SCAN_ID.fullmatch(str(scan_id)) or not _UID.fullmatch(str(owner_id)):
        return None
    target=_connection()
    if not target:return None
    url,headers=target
    try:
        with requests.Session() as session:
            session.trust_env=False
            response=session.get(url,params={
                "select":"scan_id,source_url,payload,progress,completed,scan_status,updated_at",
                "scan_id":"eq."+scan_id,
                "owner_id":"eq."+owner_id,
                "expires_at":"gt."+time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
                "limit":"1"},headers=headers,timeout=(4,9),allow_redirects=False)
            if response.status_code!=200:return None
            rows=response.json()
        if not isinstance(rows,list) or not rows:return None
        row=rows[0]
        payload=_unpack_catalogue(row.get("payload"))
        if payload is None or not isinstance(row.get("progress"),dict):
            return None
        row["payload"]=payload
        if not isinstance(row.get("completed"),list):row["completed"]=[]
        return row
    except (ValueError,requests.RequestException):
        return None


def recent(owner_id,limit=15):
    """Only rows belonging to the verified active portal administrator."""
    if not _UID.fullmatch(str(owner_id)):return []
    target=_connection()
    if not target:return []
    url,headers=target
    try:
        with requests.Session() as session:
            session.trust_env=False
            response=session.get(url,params={
                "owner_id":"eq."+owner_id,
                "expires_at":"gt."+time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
                "select":"scan_id,source_url,scan_status,progress,created_at,updated_at",
                "order":"updated_at.desc","limit":str(max(1,min(int(limit),25)))
            },headers=headers,timeout=(4,9),allow_redirects=False)
            if response.status_code!=200:return []
            rows=response.json()
        if not isinstance(rows,list):return []
        result=[]
        for row in rows:
            if not isinstance(row,dict):continue
            progress=row.get("progress") or {}
            row["progress"]={k:progress.get(k) for k in
                ("done","total","verified","sources_found","seq") if k in progress}
            result.append(row)
        return result
    except (ValueError,requests.RequestException):
        return []
