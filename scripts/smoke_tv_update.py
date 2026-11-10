#!/usr/bin/env python3
"""Exercise the public preview feed and Android's own update confirmation."""

import os
import re
import sys
import time
from pathlib import Path
from xml.etree import ElementTree

from smoke_tv_install import COMPONENT, PACKAGE, adb, ui


def current_package():
    report = adb("shell", "dumpsys", "package", PACKAGE).decode()
    fields = {}
    for field in ("versionCode", "firstInstallTime", "userId"):
        match = re.search(rf"^\s*{field}=([^\r\n]+)", report, re.MULTILINE)
        if not match:
            raise AssertionError(f"Missing installed package field {field}")
        fields[field] = match.group(1).split()[0] if field == "versionCode" else match.group(1)
    return fields


def snapshot():
    content = ui()
    return content, [node.attrib for node in ElementTree.fromstring(content).iter("node")]


def wait_for_action(predicate, description, timeout=45):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        document, nodes = snapshot()
        for node in nodes:
            if predicate(node):
                return document, node
        time.sleep(1)
    raise AssertionError(f"Missing UI action: {description}")


def tap(node):
    left, top, right, bottom = map(int, re.findall(r"\d+", node["bounds"]))
    adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))


def app_action(label, timeout=45):
    return wait_for_action(
        lambda node: node.get("package") == PACKAGE and label in node.get("text", ""),
        label, timeout,
    )


def run(apk, report):
    assert "Success" in adb("install", apk).decode()
    before = current_package()
    assert before["versionCode"] == os.environ["BASE_CODE"]
    assert "Status: ok" in adb("shell", "am", "start", "-W", "-n", COMPONENT).decode()

    _, check = app_action("تحديثات التطبيق")
    tap(check)
    available, download = app_action("تنزيل وتحديث")
    (report / "update-available.xml").write_bytes(available)
    tap(download)
    verified, open_installer = app_action("فتح المثبت", 100)
    (report / "update-verified.xml").write_bytes(verified)
    tap(open_installer)

    _, open_settings = app_action("فتح الإعدادات")
    tap(open_settings)
    settings, allow = wait_for_action(
        lambda node: node.get("package") in {"com.android.tv.settings", "com.android.settings"}
        and ("allow from this source" in node.get("text", "").lower()
             or "app_source_switch" in node.get("resource-id", "")),
        "Android allow installs from this source",
    )
    (report / "android-source-permission.xml").write_bytes(settings)
    tap(allow)
    adb("shell", "input", "keyevent", "KEYCODE_BACK")

    installer, install = wait_for_action(
        lambda node: "packageinstaller" in node.get("package", "")
        and node.get("text", "").strip().lower() in {"install", "update"},
        "official Android install confirmation",
    )
    (report / "android-install-confirmation.xml").write_bytes(installer)
    (report / "android-install-confirmation.png").write_bytes(adb("exec-out", "screencap", "-p"))
    assert current_package()["versionCode"] == os.environ["BASE_CODE"]
    tap(install)
    for _ in range(30):
        after = current_package()
        if after["versionCode"] == os.environ["UPDATE_CODE"]:
            break
        time.sleep(1)
    else:
        raise AssertionError("Android did not install the newer version")
    assert before["firstInstallTime"] == after["firstInstallTime"]
    assert before["userId"] == after["userId"]
    assert "Status: ok" in adb("shell", "am", "start", "-W", "-n", COMPONENT).decode()
    app_action("تحديثات التطبيق")
    summary = (
        f"PASS | {PACKAGE} build {before['versionCode']} -> {after['versionCode']}\n"
        "PASS | Live preview feed discovered from the in-app update button\n"
        "PASS | Download completed and the app accepted checksum, package, version and signer\n"
        "PASS | Android source permission and official install confirmation completed through the UI\n"
        "PASS | Same Android user ID and original installation time after upgrade\n"
        "PASS | The updated app launched successfully\n"
        "Scope: Android TV emulator API 33, independent preview package, no customer account.\n"
    )
    (report / "in-app-update.txt").write_text(summary, encoding="utf-8")
    print(summary, end="")


if __name__ == "__main__":
    report_directory = Path(sys.argv[2])
    report_directory.mkdir(parents=True, exist_ok=True)
    try:
        run(sys.argv[1], report_directory)
    except Exception:
        (report_directory / "failure-logcat.txt").write_bytes(adb("logcat", "-d", "-t", "600"))
        try:
            (report_directory / "failure-ui.xml").write_bytes(ui())
            (report_directory / "failure-ui.png").write_bytes(adb("exec-out", "screencap", "-p"))
        except Exception:
            pass
        raise
