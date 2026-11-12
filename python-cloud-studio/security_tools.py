"""Normalize offline authorized scanner reports into Al Ezz's private audit history.

Never executes external scanners or fetches links inside imported data.
Only a signed-in administrator of a previously verified domain may import JSON.
"""
from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()
TOOLS = frozenset({"zap","wpscan","nuclei","semgrep","trivy","nikto","testssl","wazuh"})
SEVERITY = {
    "0":"info","1":"low","2":"medium","3":"high","4":"critical",
    "informational":"info","info":"info","low":"low","medium":"medium",
    "moderate":"medium","warning":"medium","high":"high","critical":"critical",
    "error":"medium","pass":"info"
}

class ImportForm(BaseModel):
    site_id: str = Field(min_length=16,max_length=80)
    tool: str = Field(min_length=2,max_length=20)
    report_json: str = Field(min_length=2,max_length=900000)


def compact(value, maximum=260):
    return re.sub(r"[\x00-\x1f\x7f]+"," ",str(value or "")).strip()[:maximum]


def severity(value):
    if isinstance(value,(int,float)):
        if value >= 9:return "critical"
        if value >= 7:return "high"
        if value >= 4:return "medium"
        if value > 0:return "low"
        return "info"
    return SEVERITY.get(str(value or "info").lower(), "medium")


def extract(tool, data):
    """Use only named finding metadata; do not copy raw requests, tokens or responses."""
    findings=[]
    def push(title,rank,description="",recommendation=""):
        if len(findings)>=200:return
        if not title:return
        findings.append({
            "title":compact(title,180),
            "severity":severity(rank),
            "detail":compact(description,330),
            "fix":compact(recommendation,330) or "راجع نتيجة الماسح في التقرير الأصلي ثم أعد الاختبار بعد الإصلاح.",
            "evidence":tool.upper()+" / imported"})
    if tool=="zap":
        for site in (data.get("site",[]) if isinstance(data,dict) else []):
            for alert in site.get("alerts",[]):
                push(alert.get("alert") or alert.get("name"),alert.get("riskcode","2"),
                     alert.get("description"),alert.get("solution"))
    elif tool=="wpscan":
        if isinstance(data,dict):
            for group in ("version","main_theme","plugins","themes"):
                entries = data.get(group,{})
                if group in ("version","main_theme"):
                    entries={group:entries}
                for key,item in (entries or {}).items():
                    if not isinstance(item,dict):continue
                    for vuln in item.get("vulnerabilities",[]) or []:
                        push(vuln.get("title") or key,vuln.get("severity","high"),
                             "WordPress component: "+compact(key,120),
                             "حدث المكون المعرّض وتحقق من التحذير المنشور.")
    elif tool=="nuclei":
        for item in (data if isinstance(data,list) else
                     data.get("results",[]) if isinstance(data,dict) else []):
            info=item.get("info",{}) if isinstance(item,dict) else {}
            push(info.get("name") or item.get("template-id"),info.get("severity","medium"),
                 info.get("description"),info.get("remediation"))
    elif tool=="semgrep":
        for item in data.get("results",[]):
            extra=item.get("extra",{}) or {}
            push(item.get("check_id"),extra.get("severity","medium"),
                 extra.get("message"),"راجع الشيفرة والموضع المسجل في تقرير Semgrep.")
    elif tool=="trivy":
        for target in data.get("Results",[]):
            for v in target.get("Vulnerabilities",[]) or []:
                push(v.get("VulnerabilityID") or v.get("Title"),
                     v.get("Severity","medium"),v.get("Title") or v.get("PkgName"),
                     "حدّث الاعتمادية إلى إصدار مصحح.")
            for m in target.get("Misconfigurations",[]) or []:
                push(m.get("ID") or m.get("Title"),
                     m.get("Severity","medium"),m.get("Title"),m.get("Resolution"))
    elif tool=="nikto":
        for v in data.get("vulnerabilities",[]):
            push(v.get("id") or v.get("msg") or v.get("name"),"medium",
                 v.get("msg"),"راجع تهيئة الخادم ومسار الكشف.")
    elif tool=="testssl":
        for v in (data if isinstance(data,list) else
                  data.get("results",[]) if isinstance(data,dict) else []):
            if isinstance(v,dict) and str(v.get("severity","")).upper()!="OK":
                push(v.get("id"),v.get("severity","medium"),
                     v.get("finding"),"حدث إعدادات TLS والشهادات وفق سياسة مؤسستك.")
    elif tool=="wazuh":
        alerts=data if isinstance(data,list) else data.get("data",{}).get("affected_items",[])
        for item in alerts:
            rule=item.get("rule",{}) if isinstance(item,dict) else {}
            push(rule.get("description") or item.get("title"),
                 "high" if int(rule.get("level",0) or 0)>=12 else "medium",
                 "Wazuh event ID "+compact(rule.get("id"),40),
                 "راجع السجل الأصلي وتأكد من الاحتواء قبل إغلاق البلاغ.")
    return findings


def register(portal):
    @router.post("/api/security/import")
    def import_report(request: Request, body: ImportForm):
        from site_security import (require_admin,target,database,_cloud,finish,iso)
        uid=require_admin(request,portal,write=True)
        if body.tool not in TOOLS:
            raise HTTPException(400,"أداة غير مدعومة.")
        with database() as db:
            site=target(db,uid,body.site_id)
            if not site["verified_at"]:
                raise HTTPException(403,"أثبت ملكية النطاق أولًا.")
            host=site["host"]
        try:
            source=json.loads(body.report_json)
            if not isinstance(source,(dict,list)):
                raise ValueError()
            detected=extract(body.tool,source)
        except (ValueError,TypeError,AttributeError,OverflowError,RecursionError):
            raise HTTPException(400,"صيغة تقرير الأداة غير صحيحة.") from None
        if not detected:
            raise HTTPException(422,"لم يتم العثور على نتائج مفهومة في التقرير.")
        counts={s:sum(f["severity"]==s for f in detected)
                for s in ("critical","high","medium","low","info")}
        report={"host":host,"url":"https://"+host,"started_at":iso(),"finished_at":iso(),
                "engine":"External "+body.tool+" report (admin imported, not scanned by Render)",
                "platform":"imported","checks":["validated external scanner report"],
                "http_status":None,"findings":detected,"counts":counts,
                "indicator":None,
                "disclaimer":"نتائج مستوردة من أداة خارجية؛ لم يؤكد خادم العز الاستغلال أو صحة الأدلة.",
                "manual_review":["راجع التقرير الأصلي لتأكيد النتائج واستبعاد الإيجابيات الكاذبة.",
                                 "أصلح الأسباب في بيئة اختبار ثم أعد الفحص بصورة مصرح بها."]}
        report_id=secrets.token_hex(12)
        _cloud("POST","aseel_security_audits",
               payload={"id":report_id,"site_id":body.site_id,
                        "created_at":iso(),"payload":report})
        with database() as db:
            db.execute("INSERT INTO audits(id,site_id,created_at,payload) VALUES(?,?,?,?)",
                       (report_id,body.site_id,iso(),json.dumps(report,ensure_ascii=False)))
        return {"ok":True,"count":len(detected),"report_id":report_id,"tool":body.tool}
