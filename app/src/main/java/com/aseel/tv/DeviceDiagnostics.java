package com.aseel.tv;

import android.content.Context;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;
import android.util.DisplayMetrics;

/** On-device capability hints only. No network or video playback attempted. */
public final class DeviceDiagnostics {
    private DeviceDiagnostics() {}

    private static boolean hasDecoder(String mime) {
        try {
            for (int i = 0; i < MediaCodecList.getCodecCount(); i++) {
                MediaCodecInfo info = MediaCodecList.getCodecInfoAt(i);
                if (info.isEncoder()) continue;
                String[] types = info.getSupportedTypes();
                for (int j = 0; j < types.length; j++) {
                    if (mime.equalsIgnoreCase(types[j])) return true;
                }
            }
        } catch (Throwable error) {
            // Vendor-specific Android 4.4 codec implementations may fail to enumerate.
        }
        return false;
    }

    public static String getReport(Context context) {
        DisplayMetrics d = context.getResources().getDisplayMetrics();
        String model = Build.MANUFACTURER + " " + Build.MODEL;
        String api = Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")";
        String h264 = hasDecoder("video/avc") ? "ظاهر في قائمة النظام" : "لم يظهر في قائمة النظام";
        String aac = hasDecoder("audio/mp4a-latm") ? "ظاهر في قائمة النظام" : "لم يظهر في قائمة النظام";
        return "الجهاز: " + model
            + "\nنظام Android: " + api
            + "\nدقة الشاشة المتاحة: " + d.widthPixels + " × " + d.heightPixels
            + "\nكثافة الشاشة: " + d.densityDpi + " dpi"
            + "\nمفكك ترميز H.264: " + h264
            + "\nمفكك ترميز AAC: " + aac
            + "\nالإنترنت: غير مطلوب في نسخة الاختبار";
    }
}
