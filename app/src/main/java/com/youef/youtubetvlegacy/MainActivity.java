package com.youef.youtubetvlegacy;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.regex.Pattern;

/**
 * YouTube TV Legacy: light Android TV browser shell for Android 4.4 (API 19).
 * Uses Google's own web/embed player and provides external-player fallback.
 * It cannot override the server-side support requirements of YouTube.
 */
public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(14, 17, 25);
    private static final int PANEL = Color.rgb(27, 32, 43);
    private static final int LIGHT = Color.rgb(238, 240, 245);
    private static final int MUTED = Color.rgb(170, 180, 195);
    private static final int RED = Color.rgb(241, 48, 58);
    private static final Pattern VIDEO_ID = Pattern.compile("[A-Za-z0-9_-]{11}");
    private static final String HOME_URL = "https://m.youtube.com/";
    private SharedPreferences prefs;
    private WebView webView;
    private FrameLayout contentFrame;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private FrameLayout fullScreenFrame;
    private TextView status;
    private TextView screenTitle;
    private String activeVideoUrl = "";
    private Button firstButton;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("yt_legacy", MODE_PRIVATE);
        buildInterface();
        showWelcome();
    }

    private int dp(float value) {
        return (int) (getResources().getDisplayMetrics().density * value + .5f);
    }

    private GradientDrawable rounded(int color, boolean focus) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(12));
        drawable.setStroke(dp(focus ? 3 : 1), focus ? Color.WHITE : Color.rgb(64, 72, 85));
        return drawable;
    }

    private TextView label(String value, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextColor(color);
        t.setTextSize(sp);
        t.setGravity(Gravity.CENTER_VERTICAL | Gravity.RIGHT);
        t.setPadding(dp(8), 0, dp(8), 0);
        return t;
    }

    private void buildInterface() {
        LinearLayout app = new LinearLayout(this);
        app.setOrientation(LinearLayout.VERTICAL);
        app.setBackgroundColor(BG);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(9), dp(18), dp(7));
        header.setBackgroundColor(PANEL);

        TextView logo = label("▶", 29, RED);
        header.addView(logo, new LinearLayout.LayoutParams(dp(44), dp(54)));
        LinearLayout titleColumn = new LinearLayout(this);
        titleColumn.setOrientation(LinearLayout.VERTICAL);
        TextView mainTitle = label("YouTube TV Legacy", 22, LIGHT);
        mainTitle.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
        titleColumn.addView(mainTitle);
        TextView subtitle = label("متوافق للتثبيت مع Android 4.4.4", 12, MUTED);
        subtitle.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
        titleColumn.addView(subtitle);
        header.addView(titleColumn, new LinearLayout.LayoutParams(0, dp(55), 1));
        status = label("جاهز", 12, MUTED);
        status.setGravity(Gravity.CENTER_VERTICAL | Gravity.RIGHT);
        header.addView(status, new LinearLayout.LayoutParams(dp(155), dp(48)));
        app.addView(header, new LinearLayout.LayoutParams(-1, dp(71)));

        HorizontalScrollView menuScroll = new HorizontalScrollView(this);
        menuScroll.setHorizontalScrollBarEnabled(false);
        menuScroll.setFillViewport(false);
        LinearLayout menu = new LinearLayout(this);
        menu.setOrientation(LinearLayout.HORIZONTAL);
        menu.setPadding(dp(12), dp(4), dp(12), dp(4));
        menu.setGravity(Gravity.CENTER_VERTICAL);
        addButton(menu, "الرئيسية", new View.OnClickListener() { public void onClick(View v) { showWelcome(); }});
        addButton(menu, "فتح يوتيوب", new View.OnClickListener() { public void onClick(View v) { browse(HOME_URL, "يوتيوب"); }});
        addButton(menu, "بحث", new View.OnClickListener() { public void onClick(View v) { promptSearch(); }});
        addButton(menu, "فتح رابط فيديو", new View.OnClickListener() { public void onClick(View v) { promptVideoUrl(); }});
        addButton(menu, "الرائج", new View.OnClickListener() { public void onClick(View v) { browse("https://m.youtube.com/feed/trending", "الرائج"); }});
        addButton(menu, "المفضلة", new View.OnClickListener() { public void onClick(View v) { openSaved("fav"); }});
        addButton(menu, "آخر فيديو", new View.OnClickListener() { public void onClick(View v) { openSaved("last"); }});
        addButton(menu, "متصفح خارجي", new View.OnClickListener() { public void onClick(View v) { openExternal(activeVideoUrl.length() > 0 ? activeVideoUrl : HOME_URL); }});
        addButton(menu, "مساعدة", new View.OnClickListener() { public void onClick(View v) { showHelp(); }});
        menuScroll.addView(menu);
        app.addView(menuScroll, new LinearLayout.LayoutParams(-1, dp(61)));

        screenTitle = label("الرئيسية", 14, MUTED);
        screenTitle.setPadding(dp(24), dp(4), dp(24), dp(4));
        app.addView(screenTitle, new LinearLayout.LayoutParams(-1, dp(35)));

        contentFrame = new FrameLayout(this);
        contentFrame.setBackgroundColor(BG);
        app.addView(contentFrame, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(app);
    }

    private void addButton(LinearLayout row, String text, View.OnClickListener click) {
        final Button btn = new Button(this);
        btn.setText(text);
        btn.setTextColor(LIGHT);
        btn.setTextSize(14);
        btn.setAllCaps(false);
        btn.setSingleLine(true);
        btn.setFocusable(true);
        btn.setFocusableInTouchMode(false);
        btn.setPadding(dp(16), 0, dp(16), 0);
        btn.setBackgroundDrawable(rounded(PANEL, false));
        btn.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            public void onFocusChange(View v, boolean focused) {
                btn.setBackgroundDrawable(rounded(focused ? RED : PANEL, focused));
                btn.setTextColor(Color.WHITE);
                if (focused) btn.bringToFront();
            }
        });
        btn.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, dp(47));
        lp.setMargins(dp(5), 0, dp(5), 0);
        row.addView(btn, lp);
        if (firstButton == null) firstButton = btn;
    }

    private void showWelcome() {
        removeWebView();
        activeVideoUrl = "";
        screenTitle.setText("الرئيسية");
        status.setText(online() ? "متصل" : "لا يوجد إنترنت");
        LinearLayout info = new LinearLayout(this);
        info.setPadding(dp(36), dp(18), dp(36), dp(24));
        info.setGravity(Gravity.CENTER);
        info.setOrientation(LinearLayout.VERTICAL);
        TextView heading = label("استمتع بيوتيوب على التلفزيون", 26, LIGHT);
        heading.setGravity(Gravity.CENTER);
        info.addView(heading, new LinearLayout.LayoutParams(-1, dp(67)));
        TextView desc = label("استخدم أزرار الريموت للتنقل ثم OK للاختيار. يمكنك البحث أو إدخال رابط فيديو أو فتح يوتيوب في المتصفح.", 18, MUTED);
        desc.setGravity(Gravity.CENTER);
        info.addView(desc, new LinearLayout.LayoutParams(-1, dp(100)));
        TextView note = label("تنبيه: مشغل يوتيوب الحديث قد لا يعمل على متصفح Android 4.4.4 القديم، حتى عند نجاح التثبيت. جرّب المتصفح الخارجي عند الحاجة.", 15, Color.rgb(255, 198, 112));
        note.setGravity(Gravity.CENTER);
        info.addView(note, new LinearLayout.LayoutParams(-1, dp(90)));
        contentFrame.addView(info, new FrameLayout.LayoutParams(-1, -1));
        firstButton.requestFocus();
    }

    private boolean online() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo net = manager != null ? manager.getActiveNetworkInfo() : null;
        return net != null && net.isConnected();
    }

    private void promptSearch() {
        final EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setTextColor(Color.BLACK);
        field.setHint("ابحث عن فيديو أو قناة");
        field.setInputType(InputType.TYPE_CLASS_TEXT);
        field.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("البحث في يوتيوب").setView(field)
            .setNegativeButton("إلغاء", null)
            .setPositiveButton("بحث", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int which) {
                    String q = field.getText().toString().trim();
                    if (q.length() != 0) browse("https://m.youtube.com/results?search_query=" + Uri.encode(q), "نتائج البحث: " + q);
                }
            }).show();
    }

    private void promptVideoUrl() {
        final EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setTextColor(Color.BLACK);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        field.setHint("https://youtu.be/XXXXXXXXXXX");
        new AlertDialog.Builder(this).setTitle("أدخل رابط فيديو يوتيوب")
            .setView(field).setNegativeButton("إلغاء", null)
            .setPositiveButton("تشغيل", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface dialog, int which) { playVideo(field.getText().toString().trim()); }
            }).show();
    }

    private static String getVideoId(String input) {
        if (input == null) return null;
        String url = input.trim();
        if (VIDEO_ID.matcher(url).matches()) return url;
        if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
        try {
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            if (host == null) return null;
            host = host.toLowerCase(java.util.Locale.US);
            String candidate = null;
            if (host.equals("youtu.be") || host.equals("www.youtu.be")) {
                candidate = uri.getLastPathSegment();
            } else if (host.equals("youtube.com") || host.equals("www.youtube.com") || host.equals("m.youtube.com") || host.equals("music.youtube.com")) {
                candidate = uri.getQueryParameter("v");
                if (candidate == null) {
                    java.util.List<String> parts = uri.getPathSegments();
                    if (parts.size() >= 2 && ("shorts".equals(parts.get(0)) || "live".equals(parts.get(0)) || "embed".equals(parts.get(0)))) candidate = parts.get(1);
                }
            }
            return candidate != null && VIDEO_ID.matcher(candidate).matches() ? candidate : null;
        } catch (RuntimeException e) { return null; }
    }

    private void playVideo(String input) {
        String id = getVideoId(input);
        if (id == null) {
            new AlertDialog.Builder(this).setTitle("رابط غير صالح")
                .setMessage("أدخل رابط فيديو من youtube.com أو youtu.be، أو مُعرّف فيديو صالح.")
                .setPositiveButton("موافق", null).show();
            return;
        }
        activeVideoUrl = "https://www.youtube.com/watch?v=" + id;
        prefs.edit().putString("last", activeVideoUrl).apply();
        browse("https://www.youtube.com/embed/" + id + "?playsinline=0&rel=0", "مشغل الفيديو - OK للتشغيل");
    }

    private void openSaved(String key) {
        String saved = prefs.getString(key, "");
        if (saved.length() == 0) {
            Toast.makeText(this, "لا يوجد فيديو محفوظ بعد", Toast.LENGTH_LONG).show();
            return;
        }
        playVideo(saved);
    }

    private void browse(String url, String title) {
        if (!online()) {
            new AlertDialog.Builder(this).setTitle("لا يوجد اتصال")
                .setMessage("تحقق من اتصال التلفزيون بالإنترنت ثم حاول مرة أخرى.")
                .setPositiveButton("حسنًا", null).show();
            return;
        }
        if (!isSafeUrl(url)) return;
        removeWebView();
        screenTitle.setText(title);
        status.setText("جارٍ التحميل...");
        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (isSafeUrl(url)) return false;
                if (url != null && url.startsWith("https://")) openExternal(url);
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (status != null) status.setText("جاهز - استخدم OK والريموت");
            }
            @SuppressWarnings("deprecation")
            @Override public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (status != null) status.setText("تعذر التحميل");
                Toast.makeText(MainActivity.this, "قد لا يدعم Android 4.4 موقع يوتيوب الحديث", Toast.LENGTH_LONG).show();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                if (status != null && progress < 100) status.setText("تحميل " + progress + "%");
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullScreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullScreenView = view;
                fullScreenCallback = callback;
                fullScreenFrame = new FrameLayout(MainActivity.this);
                fullScreenFrame.setBackgroundColor(Color.BLACK);
                fullScreenFrame.addView(view, new FrameLayout.LayoutParams(-1, -1));
                addContentView(fullScreenFrame, new ViewGroup.LayoutParams(-1, -1));
            }
            @Override public void onHideCustomView() { closeFullScreen(); }
        });
        contentFrame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        webView.loadUrl(url);
        webView.requestFocus();
    }

    private static boolean isSafeUrl(String url) {
        if (url == null || !url.startsWith("https://")) return false;
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) return false;
            host = host.toLowerCase(java.util.Locale.US);
            return host.equals("youtube.com") || host.endsWith(".youtube.com") ||
                host.equals("youtu.be") || host.equals("youtube-nocookie.com") ||
                host.endsWith(".youtube-nocookie.com");
        } catch (RuntimeException e) { return false; }
    }

    private void openExternal(String url) {
        if (url == null || !url.startsWith("https://")) url = HOME_URL;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "لا يوجد متصفح خارجي مثبت", Toast.LENGTH_LONG).show();
        }
    }

    private void showHelp() {
        final String current = activeVideoUrl;
        AlertDialog.Builder d = new AlertDialog.Builder(this)
            .setTitle("مساعدة - YouTube TV Legacy")
            .setMessage("التنقل: الأسهم للتحرك، OK للتحديد، رجوع للخروج من المشغل.\n\n" +
                "دعم تثبيت Android 4.4.4 متوفر، لكن تشغيل محتوى يوتيوب يعتمد على دعم Google لإصدار المتصفح القديم.\n\n" +
                "التطبيق ليس إصدارًا رسميًا من YouTube ولا يحتاج تسجيل الدخول.")
            .setPositiveButton("إغلاق", null)
            .setNeutralButton("حفظ الفيديو", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface dialog, int which) {
                    if (current.length() != 0) {
                        prefs.edit().putString("fav", current).apply();
                        Toast.makeText(MainActivity.this, "تم حفظ الفيديو في المفضلة", Toast.LENGTH_SHORT).show();
                    } else Toast.makeText(MainActivity.this, "افتح فيديو أولًا", Toast.LENGTH_SHORT).show();
                }
            });
        if (current.length() != 0) {
            d.setNegativeButton("فتح خارجيًا", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface dialog, int which) { openExternal(current); }
            });
        }
        d.show();
    }

    private void closeFullScreen() {
        if (fullScreenView == null) return;
        if (fullScreenFrame != null) {
            fullScreenFrame.removeAllViews();
            ((ViewGroup) fullScreenFrame.getParent()).removeView(fullScreenFrame);
        }
        fullScreenView = null;
        fullScreenFrame = null;
        if (fullScreenCallback != null) fullScreenCallback.onCustomViewHidden();
        fullScreenCallback = null;
    }

    private void removeWebView() {
        closeFullScreen();
        if (webView != null) {
            contentFrame.removeView(webView);
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        contentFrame.removeAllViews();
    }

    @Override public void onBackPressed() {
        if (fullScreenView != null) { closeFullScreen(); return; }
        if (webView != null && webView.canGoBack()) { webView.goBack(); return; }
        if (webView != null) { showWelcome(); return; }
        super.onBackPressed();
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) { showHelp(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override protected void onDestroy() {
        removeWebView();
        super.onDestroy();
    }
}
