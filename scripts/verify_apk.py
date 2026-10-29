#!/usr/bin/env python3
"""Fail CI if the APK does not meet Phase 1 Android 4.4.4 constraints."""
import hashlib
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

def check(condition, message):
    if not condition:
        raise RuntimeError(message)
    print("PASS | " + message)

def run(args):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError("Command failed (" + str(result.returncode) + "): "
                           + " ".join(map(str, args)) + "\n" + result.stdout)
    return result.stdout

def main():
    check(len(sys.argv) == 2, "APK path supplied")
    apk = Path(sys.argv[1])
    check(apk.is_file(), "APK exists")
    check(zipfile.is_zipfile(apk), "APK is a ZIP archive")
    with zipfile.ZipFile(apk) as z:
        bad = z.testzip()
        check(bad is None, "ZIP CRC integrity")
        names = z.namelist()
        check("AndroidManifest.xml" in names, "AndroidManifest.xml exists")
        check("classes.dex" in names, "classes.dex exists")
        header = z.read("classes.dex")[:8]
        check(header.startswith(bytes([100, 101, 120, 10])) and header[7] == 0,
              "DEX magic header")
        dex_version = int(header[4:7])
        check(dex_version <= 35, "DEX version " + str(dex_version) + " supports Android API 19")
        native = [n for n in names if n.startswith("lib/") and n.endswith(".so")]
        check(not native, "No ABI-dependent native libraries")

    sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    check(bool(sdk_root), "ANDROID_HOME is set")
    tools = Path(sdk_root) / "build-tools" / "33.0.2"
    aapt = str(tools / "aapt")
    apksigner = str(tools / "apksigner")
    for binary in (aapt, apksigner):
        check(Path(binary).is_file(), Path(binary).name + " installed")

    badging = run([aapt, "dump", "badging", str(apk)])
    check("package: name='sa.aseel.tv'" in badging, "Stable package sa.aseel.tv")
    check("sdkVersion:'19'" in badging, "minSdkVersion 19")
    check("targetSdkVersion:'28'" in badging, "targetSdkVersion 28")
    check("android.intent.category.LEANBACK_LAUNCHER" in badging
          or "android.intent.category.LAUNCHER" in badging,
          "App has a launcher intent")
    if "uses-permission: name='android.permission.INTERNET'" in badging:
        raise RuntimeError("Offline Phase 1 must not request INTERNET")
    check(True, "No INTERNET permission")
    if any(line.startswith("uses-feature:") and "android.hardware.touchscreen" in line for line in badging.splitlines()):
        raise RuntimeError("Touchscreen must not be required")
    check(True, "Touchscreen not required")

    signed = run([apksigner, "verify", "--min-sdk-version", "19",
                  "--verbose", "--print-certs", str(apk)])
    check("Verified using v1 scheme (JAR signing): true" in signed,
          "Android 4.4 compatible V1 signature")
    print(signed)
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    print("APK size: " + str(apk.stat().st_size) + " bytes")
    print("SHA-256: " + digest)
    print("STATIC CHECKS PASSED. Physical TV install/run NOT TESTED.")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL | " + str(exc), file=sys.stderr)
        sys.exit(1)
