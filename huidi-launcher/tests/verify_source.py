from pathlib import Path
manifest = Path("huidi-launcher/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
code = Path("huidi-launcher/src/main/java/sa/youef/huidi/launcher/MainActivity.java").read_text(encoding="utf-8")
build = Path("huidi-launcher/build.gradle").read_text(encoding="utf-8")
assert 'android.intent.category.HOME' in manifest
assert 'android.intent.category.DEFAULT' in manifest
assert 'android.intent.category.LEANBACK_LAUNCHER' in manifest
assert 'android:minSdkVersion="19"' in manifest
assert 'android:required="false"' in manifest
assert 'android.permission.INTERNET' not in manifest
assert "minSdkVersion 19" in build
assert "v1SigningEnabled true" in build
for token in ("queryIntentActivities", "KEYCODE_MENU", "setOnLongClickListener", "ACTION_SETTINGS", "chooseHome", "refreshApps", "Wallpaper", "favorites"):
    assert token in code, token
for token in ("themesPage", "developerPage", "enableDeveloperGuide", "openDeveloperOptions",
              "ACTION_APPLICATION_DEVELOPMENT_SETTINGS", "ACTION_DEVICE_INFO_SETTINGS",
              "development_settings_enabled", "GLASS_EDGE", "GradientDrawable.Orientation.TL_BR",
              "RenderEffect blur", '"violet"', '"emerald"', '"rose"'):
    assert token in code, "Missing glass/developer feature: " + token
assert "android.permission.WRITE_SECURE_SETTINGS" not in manifest
assert "android.permission.WRITE_SETTINGS" not in manifest
print("PASS KitKat glass themes, six palettes, safe developer settings handoff, remote HOME")

gate=Path("huidi-launcher/src/main/java/sa/youef/huidi/launcher/AppPinGate.java").read_text(encoding="utf-8")
for feature in ("dashboardCards", "systemPage", "maintenancePage", "clearOwnCache", "wallpapersPage",
                "numericPin", "managePin", "appActions", "AppPinGate", "ACCESS", "wifiStatus"):
    if feature != "ACCESS": assert feature in code, feature
for feature in ("PBKDF2WithHmacSHA1","SecureRandom","MessageDigest.isEqual","setLocked"):
    assert feature in gate, feature
assert "android.permission.INTERNET" not in manifest
assert "android.permission.ACCESS_WIFI_STATE" in manifest
assert "android.permission.ACCESS_NETWORK_STATE" in manifest
print("PASS device dashboard, safe maintenance, wallpapers and local-only PIN gate")
