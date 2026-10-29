#!/usr/bin/env python3
"""Aseel TV full beta gate — static Android 4.4 package validations."""
import hashlib, os, re, subprocess, sys, zipfile
from pathlib import Path

def check(ok,msg):
    if not ok: raise RuntimeError(msg)
    print("PASS | "+msg)

def run(args):
    out=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if out.returncode: raise RuntimeError("Command failed: "+" ".join(map(str,args))+"\n"+out.stdout)
    return out.stdout

try:
    check(len(sys.argv)==2,"APK path supplied")
    apk=Path(sys.argv[1]);check(apk.is_file(),"APK exists")
    check(zipfile.is_zipfile(apk),"APK is a ZIP archive")
    with zipfile.ZipFile(apk) as z:
        check(z.testzip() is None,"ZIP CRC integrity")
        names=z.namelist()
        check("AndroidManifest.xml" in names,"Manifest exists")
        check("classes.dex" in names,"classes.dex exists")
        h=z.read("classes.dex")[:8]
        check(h.startswith(bytes([100,101,120,10])) and h[7]==0,"Valid DEX header")
        check(int(h[4:7])<=35,"DEX version <=035 (Android 4.4)")
        check(not any(x.startswith("lib/") and x.endswith(".so") for x in names),"No ABI-dependent native libraries")
    sdk=Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or "")
    aapt=str(sdk/"build-tools/33.0.2/aapt")
    signer=str(sdk/"build-tools/33.0.2/apksigner")
    check(Path(aapt).is_file() and Path(signer).is_file(),"aapt and apksigner available")
    badging=run([aapt,"dump","badging",str(apk)])
    check("package: name='sa.aseel.tv.full'" in badging,"Expected application ID")
    check("sdkVersion:'19'" in badging,"minSdkVersion=19")
    check("targetSdkVersion:'28'" in badging,"targetSdkVersion=28")
    check("android.permission.INTERNET" in badging,"INTERNET permission present for dynamic catalog")
    check(not any(line.startswith("uses-feature:") and "android.hardware.touchscreen" in line for line in badging.splitlines()),"Touchscreen not required")
    tree=run([aapt,"dump","xmltree",str(apk),"AndroidManifest.xml"])
    check("android.intent.category.LAUNCHER" in tree and "android.intent.category.LEANBACK_LAUNCHER" in tree,"TV and standard launcher intents")
    check(".PlayerActivity" in tree or "sa.aseel.tv.PlayerActivity" in tree,"Media player registered")
    signature=run([signer,"verify","--min-sdk-version","19","--verbose","--print-certs",str(apk)])
    check("Verified using v1 scheme (JAR signing): true" in signature,"APK V1 signature compatible with KitKat")
    print(signature)
    print("APK bytes:",apk.stat().st_size)
    print("SHA-256:",hashlib.sha256(apk.read_bytes()).hexdigest())
    print("STATIC TESTS PASSED; real TV install, codecs and TLS still require hardware verification")
except Exception as exc:
    print("FAIL | "+str(exc),file=sys.stderr);sys.exit(1)
