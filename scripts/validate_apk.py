#!/usr/bin/env python3
"""Phase 1 / Android API 19 APK integrity and signature gate."""
import os
import pathlib
import re
import subprocess
import sys
import zipfile

apk = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "app/build/outputs/apk/debug/app-debug.apk")
sdk = pathlib.Path(os.environ["ANDROID_HOME"])
tools = sdk / "build-tools" / "33.0.2"

def run(command):
    result = subprocess.run([str(p) for p in command], stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, check=True)
    print(result.stdout)
    return result.stdout

def check(condition, msg):
    if not condition:
        raise AssertionError(msg)
    print("PASS:", msg)

check(apk.is_file() and apk.stat().st_size > 0, "APK exists and is non-empty")
badging = run([tools / "aapt", "dump", "badging", apk])
check("package: name='com.aseel.tv.preview'" in badging, "independent preview package id")
check("package: name='com.aseel.tv'" not in badging, "does not overwrite the original application")
check("sdkVersion:'19'" in badging, "minSdkVersion = 19")
check("targetSdkVersion:'28'" in badging, "targetSdkVersion = 28")
check("versionCode='2'" in badging, "preview versionCode = 2")
check("uses-feature: name='android.hardware.touchscreen'" not in badging, "touchscreen not required")
with zipfile.ZipFile(apk, "r") as archive:
    check(archive.testzip() is None, "ZIP CRC integrity")
    names = archive.namelist()
    check("classes.dex" in names, "classes.dex present")
    check(archive.read("classes.dex").startswith(b"dex\n035\x00"), "DEX 035 supported on Android API 19")
    check(not [n for n in names if n.startswith("lib/") and n.endswith(".so")], "no ABI-dependent native .so libraries")
manifest_permissions = run([tools / "aapt", "dump", "permissions", apk])
check("android.permission.INTERNET" not in manifest_permissions, "offline: no INTERNET permission")
signature = run([tools / "apksigner", "verify", "--verbose", "--min-sdk-version", "19", "--max-sdk-version", "19", apk])
check(re.search(r"Verified using v1 scheme .*:\s*true", signature) is not None, "Android API 19 V1/JAR signature valid")
print("\nPHASE 1 STATIC VALIDATION PASSED. Real TV installation NOT verified.")
