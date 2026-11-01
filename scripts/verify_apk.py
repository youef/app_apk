#!/usr/bin/env python3
"""Fail closed on Android 4.4 APK manifest, signature, ZIP, ABI or version defects."""
import hashlib, os, re, subprocess, sys, zipfile
from pathlib import Path

EXPECTED_PACKAGE="sa.alezz.tv.unified"
MIN_SDK=19
MIN_VERSION=11
REQUIRED_ABIS=("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
ELF_MACHINE={"armeabi-v7a": 40, "arm64-v8a": 183, "x86": 3, "x86_64": 62}
ELF_CLASS={"armeabi-v7a": 1, "arm64-v8a": 2, "x86": 1, "x86_64": 2}

def check(ok,msg):
    if not ok: raise RuntimeError(msg)
    print("PASS | "+msg,flush=True)

def command(args):
    result=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError("Failed: "+" ".join(map(str,args))+"\n"+result.stdout[-3000:])
    return result.stdout

def main():
    check(len(sys.argv)==2,"APK argument supplied")
    apk=Path(sys.argv[1])
    check(apk.is_file() and apk.stat().st_size>150000,"APK exists and is not truncated")
    check(zipfile.is_zipfile(apk),"ZIP format")
    with zipfile.ZipFile(apk) as archive:
        check(archive.testzip() is None,"ZIP CRC integrity")
        paths=archive.namelist()
        check(paths.count("AndroidManifest.xml")==1 and paths.count("classes.dex")==1,
              "Single complete install APK (no missing split)")
        check(not any(path.startswith("../") or path.startswith("/") for path in paths),
              "Archive paths safe")
        dex=archive.read("classes.dex")
        check(dex[:4]==b"dex\n" and dex[7]==0 and int(dex[4:7])<=35,
              "Android 4.4 compatible DEX 035 or below")
        native=[path for path in paths if path.startswith("lib/") and path.endswith(".so")]
        native_arches=set(path.split("/")[1] for path in native)
        check(native_arches==set(REQUIRED_ABIS),
              "Universal APK includes ARMv7, ARM64, x86 and x86_64 native libraries")
        for abi in REQUIRED_ABIS:
            matches=[p for p in native if p.startswith("lib/"+abi+"/") and "conscrypt" in p]
            check(bool(matches),abi+" Conscrypt TLS JNI bundled")
            for entry in matches:
                header=archive.read(entry)[:20]
                check(len(header)>=20 and header[:4]==bytes([0x7f])+b"ELF"
                      and header[4]==ELF_CLASS[abi]
                      and int.from_bytes(header[18:20],"little")==ELF_MACHINE[abi],
                      abi+" ELF architecture verified")
    sdk=Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or "")
    tools=sdk/"build-tools"/"33.0.2"
    aapt=str(tools/"aapt");align=str(tools/"zipalign");signer=str(tools/"apksigner")
    check(all((tools/x).is_file() for x in ("aapt","zipalign","apksigner")),
          "Android SDK validation tools available")
    command([align,"-c","-v","4",str(apk)])
    check(True,"ZIP alignment")
    badging=command([aapt,"dump","badging",str(apk)])
    check(f"package: name='{EXPECTED_PACKAGE}'" in badging,
          "Fresh package ID to bypass legacy signature conflicts")
    check(f"sdkVersion:'{MIN_SDK}'" in badging,"minSdkVersion API 19")
    check("targetSdkVersion:'28'" in badging,"Target SDK as declared")
    version=re.search(r"versionCode='(\d+)'",badging)
    check(version is not None and int(version.group(1))>=MIN_VERSION,"Minimum updated versionCode")
    check("android.permission.INTERNET" in badging,"Internet access included")
    check(not any(line.startswith("uses-feature:") and "android.hardware.touchscreen" in line
                  for line in badging.splitlines()),"No touchscreen requirement")
    if "native-code:" in badging:
        check(all(abi in badging for abi in REQUIRED_ABIS),
              "Android manifest declares all four native ABIs")
    tree=command([aapt,"dump","xmltree",str(apk),"AndroidManifest.xml"])
    check("android.intent.category.LAUNCHER" in tree and
          "android.intent.category.LEANBACK_LAUNCHER" in tree,"Standard and TV launcher")
    check("sa.aseel.tv.MainActivity" in tree and "sa.aseel.tv.PlayerActivity" in tree,
          "Both launcher and player fully qualified: no activity resolution conflict")
    signature=command([signer,"verify","--min-sdk-version","19","--verbose",
                       "--print-certs",str(apk)])
    check("Verified using v1 scheme (JAR signing): true" in signature,
          "V1 signature supported by Android KitKat")
    digest=re.search(r"Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})",signature)
    check(digest is not None,"Signing certificate fingerprint available")
    print("CERTIFICATE_SHA256="+digest.group(1))
    print("APK_SHA256="+hashlib.sha256(apk.read_bytes()).hexdigest())
    print("PACKAGE="+EXPECTED_PACKAGE)
    print("SUPPORTED_ABIS="+",".join(REQUIRED_ABIS))
    print("UNIVERSAL_APK=true")
    print("RESULT: STATIC INSTALL CHECKS PASSED — real-device installation not proven")

try:
    main()
except Exception as error:
    print("FAIL | "+str(error),file=sys.stderr)
    sys.exit(1)
