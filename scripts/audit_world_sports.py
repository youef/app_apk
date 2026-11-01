# -*- coding: utf-8 -*-
"""Strict sports check: a valid HLS manifest and reachable media sample."""
import audit_world_kids as audit

audit.PLAYLIST = "https://iptv-org.github.io/iptv/categories/sports.m3u"
audit.USER_AGENT = "AlEzzTV-SportsHealth/1.0 (+safe link checks)"
_base_probe = audit.probe

def probe(item):
    result = _base_probe(item)
    if result.get("status") == "manifest_ok" and result.get("media_sample") != "sample_reachable":
        result["status"] = "media_sample_failed"
    return result

audit.probe = probe

if __name__ == "__main__":
    audit.main()
