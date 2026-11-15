"""Server-only durable mirror for the optional Al Ezz Studio control plane.

Uses its own REST client. NEVER modifies the frozen extraction or AutoSync clients.
Returns no secret, token, or signed playback URL to the browser.
"""
from __future__ import annotations
from datetime import datetime, timezone
import os
import requests

ALERT_TABLE = "aseel_studio_control_alerts"
AUDIT_TABLE = "aseel_studio_control_audit"


def as_epoch(value):
    if not value:
        return 0.
    try:
        if isinstance(value,(int,float)):
            return float(value)
        return datetime.fromisoformat(str(value).replace('Z','+00:00')).timestamp()
    except (TypeError,ValueError,OverflowError):
        return 0.


def as_iso(value):
    return datetime.fromtimestamp(float(value),timezone.utc).isoformat() if value else None


class ControlCloud:
    def __init__(self):
        self.root = os.getenv("ALEZZ_SUPABASE_URL","https://qyzmlwtvzzgooccqxglq.supabase.co").rstrip("/")
        self.secret = (os.getenv("ALEZZ_SUPABASE_SECRET_KEY") or
                       os.getenv("ALEZZ_SUPABASE_SERVICE_ROLE_KEY") or "")
        self.ready = bool(self.secret and (self.secret.startswith("sb_secret_")
                                          or self.secret.startswith("eyJ"))
                          and self.root.startswith("https://"))

    def request(self, method, table, params=None, body=None, *, ignore_duplicates=False):
        if not self.ready or table not in (ALERT_TABLE,AUDIT_TABLE):
            raise ValueError("Persistent operations storage is not configured")
        headers={"apikey":self.secret,"Accept":"application/json","Content-Type":"application/json"}
        if self.secret.startswith("eyJ"):
            headers["Authorization"]="Bearer "+self.secret
        if ignore_duplicates:
            headers["Prefer"]="resolution=ignore-duplicates,return=minimal"
        elif method in ("POST","PATCH"):
            headers["Prefer"]="return=minimal"
        # No redirects to untrusted domains and no token-bearing URLs.
        response=requests.request(method,self.root+"/rest/v1/"+table,headers=headers,
                                  params=params,json=body,timeout=12,allow_redirects=False)
        if not response.ok:
            raise ValueError("Supabase control store: HTTP "+str(response.status_code))
        return response.json() if response.content and method=="GET" else []

    def read(self, table, limit=500):
        return self.request("GET",table,params={"select":"*","order":"id.desc","limit":str(limit)})

    def insert_once(self, table, rows):
        if not rows:
            return
        return self.request("POST",table,params={"on_conflict":"fingerprint"},body=rows,
                            ignore_duplicates=True)

    def mark_read(self, fingerprints, when):
        for fp in fingerprints:
            self.request("PATCH",ALERT_TABLE,
                         params={"fingerprint":"eq."+fp},body={"read_at":as_iso(when)})
