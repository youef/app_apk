package sa.aseel.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * JavaScript bridge exposed as window.AlezzNative. WebView calls arrive on a
 * background binder thread, so every Activity/UI action is posted to the UI
 * thread. All JSON reads use fallbacks so partially populated payloads are safe.
 */
public class NativeBridge {

    private final Activity activity;

    public NativeBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void playMedia(String json) {
        if (activity == null || activity.isFinishing()) {
            return;
        }
        try {
            JSONObject object = new JSONObject(json == null ? "{}" : json);
            final String stream = safe(object.optString("stream", ""));
            final String youtubeId = safe(object.optString("youtubeId", ""));
            final String title = safe(object.optString("title", ""));
            final String subtitle = safe(object.optString("subtitle", ""));
            final String key = safe(object.optString("key", ""));
            final boolean live = object.optBoolean("live", false);
            final int startAt = Math.max(0, intValue(object, "resumeAt", 0));

            if (stream.length() == 0 && youtubeId.length() == 0) {
                toastInternal(activity.getString(R.string.no_stream));
                return;
            }

            final Intent intent = new Intent(activity, PlayerActivity.class);
            intent.putExtra("url", stream);
            intent.putExtra("title", title);
            intent.putExtra("subtitle", subtitle);
            intent.putExtra("key", key);
            intent.putExtra("live", live);
            intent.putExtra("youtube", youtubeId);
            intent.putExtra("startAt", startAt);

            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (activity.isFinishing()) {
                        return;
                    }
                    try {
                        activity.startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(activity,
                                R.string.player_unavailable,
                                Toast.LENGTH_LONG).show();
                    }
                }
            });
        } catch (JSONException e) {
            toastInternal(activity.getString(R.string.no_stream));
        }
    }

    @JavascriptInterface
    public void openExternal(String url) {
        if (activity == null || activity.isFinishing()) {
            return;
        }
        final String clean = safe(url);
        String lower = clean.toLowerCase();
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (activity.isFinishing()) {
                    return;
                }
                try {
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(clean)));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(activity,
                            R.string.external_unavailable,
                            Toast.LENGTH_LONG).show();
                } catch (SecurityException e) {
                    Toast.makeText(activity,
                            R.string.external_unavailable,
                            Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    @JavascriptInterface
    public String getAppVersion() {
        if (activity == null) {
            return "10.0.0";
        }
        try {
            String version = activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0).versionName;
            return version == null ? "10.0.0" : version;
        } catch (Exception e) {
            return "10.0.0";
        }
    }

    @JavascriptInterface
    public void toast(String message) {
        String clean = safe(message);
        if (clean.length() > 0) {
            toastInternal(clean);
        }
    }

    private void toastInternal(final String message) {
        if (activity == null || activity.isFinishing()) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (!activity.isFinishing()) {
                    Toast.makeText(activity, message, Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static int intValue(JSONObject object, String name, int fallback) {
        Object value = object.opt(name);
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value instanceof String) {
            try {
                return (int) Double.parseDouble((String) value);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }
}
