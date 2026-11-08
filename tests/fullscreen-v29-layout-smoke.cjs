#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const screen=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const manifest=read("app/src/main/AndroidManifest.xml");
const backdrop=read("app/src/main/java/sa/aseel/tv/CinemaBackdropDrawable.java");
const method=screen.slice(screen.indexOf("private void applyCinemaImmersiveLayout(){"),
    screen.indexOf("@Override public void onCreate(Bundle state)"));
for(const flag of ["SYSTEM_UI_FLAG_FULLSCREEN","SYSTEM_UI_FLAG_HIDE_NAVIGATION",
    "SYSTEM_UI_FLAG_IMMERSIVE_STICKY","SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN",
    "SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION","SYSTEM_UI_FLAG_LAYOUT_STABLE"]){
    assert(method.includes("View."+flag),"Missing immersive system flag: "+flag);
}
assert(method.includes("android.os.Build.VERSION.SDK_INT>=28") &&
    method.includes("LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES"),
    "Only Android P and later may opt into landscape cutout width");
assert(screen.includes("if(hasFocus)applyCinemaImmersiveLayout()") &&
    screen.includes("super.onWindowFocusChanged(hasFocus)"),
    "Reapply immersive mode when resuming from system UI, settings or keyboard");
assert(screen.includes("applyCinemaImmersiveLayout();\n        catalog=new CatalogApi(this);"),
    "Apply fullscreen before creating the video app shell");
assert(screen.includes("root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL)") &&
    screen.includes("root.setBackgroundDrawable(new CinemaBackdropDrawable())") &&
    screen.includes("setContentView(root)") &&
    screen.includes("root.addView(top,new LinearLayout.LayoutParams(-1,dp(79)))"),
    "RTL/remote-first shell remains full width");
assert(backdrop.includes("canvas.scale(r.width()/1920f,r.height()/1080f)"),
    "Cinematic wallpaper should resize to the full window bounds");
assert(manifest.includes('android:minSdkVersion="19"') &&
    manifest.includes('android:screenOrientation="landscape"'),
    "Full landscape display keeps Android 4.4 support");
console.log("PASS | Al Ezz V29 full-width landscape screen and no left OS inset");
