#!/usr/bin/env python3
"""Check the MBC 5 HLS manifest, media playlist and actual media bytes.

Read-only: never modify channel rights or publication status. A failed probe
may be caused by regional restrictions or a temporary CDN outage.
"""
from __future__ import annotations

import datetime as dt
import json
import sys

from check_hls_segments import fetch

CHANNEL_ID = "36c7326b-1074-49fe-8fcd-bcb2d1bbd0ba"
CHANNEL_NAME = "MBC 5"
STREAM_URL = "https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-5/ee6b000cee0629411b666ab26cb13e9b/index.m3u8"
REPORT_FILE = "mbc5-stream-health-report.json"


def main() -> int:
    # The existing segment probe checks real media bytes, not just HTTP 200.
    outcome = fetch(STREAM_URL)
    report = {
        "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "channel_id": CHANNEL_ID,
        "channel": CHANNEL_NAME,
        "status": "segment_verified" if outcome.get("ok") else "unverified",
        "note": (
            "Remote runner verification only. Regional restrictions, temporary CDN "
            "failures, and device/player compatibility require separate checks. "
            "Do not treat a failed probe as permission to delete the channel."
        ),
        "probe": outcome,
    }
    with open(REPORT_FILE, "w", encoding="utf-8") as file:
        json.dump(report, file, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False))
    if not outcome.get("ok"):
        print("MBC 5 live segment could not be verified from this runner.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
