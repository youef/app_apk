#!/usr/bin/env python3
"""Run a fresh-install, launch and DPAD smoke test on a blank Android TV emulator."""

import subprocess
import sys
import time
from pathlib import Path
from xml.etree import ElementTree


PACKAGE = "sa.alezz.tv.preview"
COMPONENT = PACKAGE + "/sa.aseel.tv.TVHomeActivity"
UI_PATH = "/sdcard/alezz-tv-qa.xml"


def adb(*args):
    return subprocess.check_output(["adb", *args], stderr=subprocess.STDOUT, timeout=35)


def ui():
    adb("shell", "uiautomator", "dump", UI_PATH)
    return adb("exec-out", "cat", UI_PATH)


def visible_nodes(xml):
    return [node.attrib for node in ElementTree.fromstring(xml).iter("node")
            if node.get("package") == PACKAGE]


def wait_for_login():
    for _ in range(6):
        snapshot = ui()
        fields = [node for node in visible_nodes(snapshot)
                  if node.get("class") == "android.widget.EditText"]
        if len(fields) >= 2:
            return snapshot, fields
        time.sleep(1)
    raise AssertionError("The app did not reach the two-field login form")


def run(apk, report):
    features = adb("shell", "pm", "list", "features").decode()
    assert "android.software.leanback" in features, "Expected an Android TV system image"
    sdk = adb("shell", "getprop", "ro.build.version.sdk").decode().strip()
    assert "Success" in adb("install", apk).decode()
    leanback = adb("shell", "cmd", "package", "resolve-activity", "--brief",
                   "-a", "android.intent.action.MAIN",
                   "-c", "android.intent.category.LEANBACK_LAUNCHER", PACKAGE).decode()
    assert COMPONENT in leanback, "Android TV launcher cannot resolve the installed activity"
    assert "Status: ok" in adb("shell", "am", "start", "-W", "-n", COMPONENT).decode()

    first, first_fields = wait_for_login()
    assert first_fields[0].get("focused") == "true", "Username did not receive initial TV focus"
    (report / "login-initial.xml").write_bytes(first)
    adb("shell", "input", "keyevent", "KEYCODE_DPAD_DOWN")
    after, after_fields = wait_for_login()
    assert after_fields[1].get("focused") == "true", "DPAD down did not focus the password field"
    (report / "login-dpad.xml").write_bytes(after)
    (report / "login-tv.png").write_bytes(adb("exec-out", "screencap", "-p"))

    adb("shell", "am", "force-stop", PACKAGE)
    assert "Status: ok" in adb("shell", "am", "start", "-W", "-n", COMPONENT).decode()
    wait_for_login()
    summary = (f"PASS | Android TV emulator API {sdk}, fresh APK install\n"
               "PASS | TV launcher resolved and app started\n"
               "PASS | DPAD moved focus from username to password\n"
               "PASS | Login UI reopened after force-stop\n"
               "Scope: emulator, logged-out UI, fresh install only.\n")
    (report / "android-tv-smoke.txt").write_text(summary, encoding="utf-8")
    print(summary, end="")


if __name__ == "__main__":
    report_directory = Path(sys.argv[2])
    try:
        run(sys.argv[1], report_directory)
    except Exception:
        (report_directory / "failure-logcat.txt").write_bytes(adb("logcat", "-d", "-t", "250"))
        raise
