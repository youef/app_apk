#!/usr/bin/env python3
"""Merge Way2Allah kids catalogue shard manifests into one reviewable file.

No database writes, no rights approvals, no playback URLs invented.
"""
from __future__ import annotations
import argparse
import glob
import json
from pathlib import Path


def merge(files):
    works = {}
    problems = []
    for path in files:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        for group in payload.get("series", []):
            page = group.get("source_page_url")
            if not page or "/var-group-" not in page:
                problems.append(f"invalid source page in {path}")
                continue
            if page in works:
                problems.append(f"duplicate group {page}")
                continue
            episodes_seen = set()
            urls_seen = set()
            episodes = []
            for season in group.get("seasons", []):
                for ep in season.get("episodes", []):
                    number = ep.get("number")
                    ep_page = ep.get("source_page_url", "")
                    if (not isinstance(number, int) or number < 1 or number in episodes_seen
                        or not ep_page.startswith("https://way2allah.com/var-item-")
                        or ep_page in urls_seen):
                        problems.append(f"episode collision in {page} number {number}: {ep_page}")
                        continue
                    episodes_seen.add(number)
                    urls_seen.add(ep_page)
                    episodes.append(ep)
            group["seasons"] = [{"number": 1, "episodes": sorted(episodes, key=lambda x: x["number"])}]
            works[page] = group
    return {"series": [works[k] for k in sorted(works)], "movies": []}, problems


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="*", help="all *-manifest.json shard files")
    parser.add_argument("--out", default="data/way2allah_kids_57_complete_manifest.json")
    parser.add_argument("--report", default="data/way2allah_kids_57_merge_report.json")
    args = parser.parse_args()
    inputs = args.inputs or sorted(glob.glob("data/way2allah-artifacts/**/*-manifest.json", recursive=True))
    if not inputs:
        parser.error("No shard manifest files found")
    merged, problems = merge(inputs)
    report = {
        "shard_files": len(inputs),
        "groups": len(merged["series"]),
        "episode_page_links": sum(len(g["seasons"][0]["episodes"]) for g in merged["series"]),
        "verified_direct_streams": sum(bool(ep.get("stream_url")) for g in merged["series"]
                                         for ep in g["seasons"][0]["episodes"]),
        "warnings": problems,
        "note": "Metadata/links only; publishing or streaming requires rights review and playback verification.",
    }
    out = Path(args.out)
    audit = Path(args.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    audit.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    audit.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0 if len(inputs) == 12 and not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
