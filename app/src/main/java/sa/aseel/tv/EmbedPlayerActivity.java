package sa.aseel.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.KeyEvent;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Approved third-party HTTPS embed playback (Android API 19+).
 * Do not extract videos, inject scripts into provider pages, or bypass
 * restrictions from the player host. MP4/HLS continue through native players.
 */
public final class EmbedPlayerActivity extends Activity {
    private FrameLayout root;
    private WebView web;
    private LinearLayout toolbar;
    private TextView notice;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private String sourceUrl;
    private final Handler chromeHandler=new Handler();
    private final Runnable hideChrome=new Runnable(){
        @Override public void run(){
            if(fullscreenView==null){
                if(toolbar!=null)toolbar.setVisibility(View.GONE);
                if(notice!=null)notice.setVisibility(View.GONE);
            }
        }
    };
    private void revealChrome(){
        chromeHandler.removeCallbacks(hideChrome);
        if(toolbar!=null)toolbar.setVisibility(View.VISIBLE);
        if(notice!=null)notice.setVisibility(View.VISIBLE);
        chromeHandler.postDelayed(hideChrome,6500L);
    }

    public static boolean isAllowed(String value) {
        if (value == null || value.length() > 2048) return false;
        try {
            Uri uri = Uri.parse(value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) ||
                uri.getUserInfo() != null ||
                (uri.getPort() != -1 && uri.getPort() != 443)) return false;
            String host = uri.getHost();
            String path = uri.getPath();
            if (host == null || path == null) return false;
            host = host.toLowerCase(java.util.Locale.US);
            return (host.equals("hanerix.com") && path.matches("(?i)^/e/[a-z0-9_-]+/?$")) ||
                ((host.equals("1vid.xyz") || host.equals("www.1vid.xyz")) && path.matches("(?i)^/embed-[a-z0-9_-]+\\.html$")) ||
                (host.equals("player.vimeo.com") && path.matches("^/video/[0-9]+/?$")) ||
                (host.equals("www.dailymotion.com") && path.matches("(?i)^/embed/video/[a-z0-9_-]+/?$")) ||
                (host.equals("www.youtube-nocookie.com") && path.matches("(?i)^/embed/[a-z0-9_-]{11}/?$"));
        } catch (Exception ignored) { return false; }
    }

    private static boolean approvedNavigation(String value) {
        if (value == null || !value.startsWith("https://")) return false;
        try {
            Uri uri = Uri.parse(value);
            if (uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443))
                return false;
            String host = uri.getHost();
            return host != null && (host.equalsIgnoreCase("hanerix.com") ||
                host.equalsIgnoreCase("1vid.xyz") || host.equalsIgnoreCase("www.1vid.xyz") ||
                host.equalsIgnoreCase("player.vimeo.com") ||
                host.equalsIgnoreCase("www.dailymotion.com") ||
                host.equalsIgnoreCase("www.youtube-nocookie.com"));
        } catch (Exception ignored) { return false; }
    }

    private int dp(int px) { return Math.round(getResources().getDisplayMetrics().density * px); }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setFocusable(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFF27232A);
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), 0xFF66535D);
        button.setBackgroundDrawable(bg);
        return button;
    }

    private void message(String text) { if (notice != null) notice.setText(text); }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!MemberAuth.hasSession(this) || MemberAuth.isExpiredLocally(this) ||
            getIntent().getBooleanExtra("kids_mode", false)) {
            finish();
            return;
        }
        sourceUrl = getIntent().getStringExtra("stream_url");
        if (!isAllowed(sourceUrl)) { finish(); return; }

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 19) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        if (Build.VERSION.SDK_INT >= 21)
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Block popups, external redirects and unapproved navigation.
                return !approvedNavigation(url);
            }
            @Override public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                if (sourceUrl.equals(failingUrl))
                    message("تعذّر تحميل صفحة المشغل؛ جرّب إعادة المحاولة أو فتح المصدر.");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                message("شهادة أمان المصدر غير صالحة. تم منع الاتصال.");
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (sourceUrl.equals(url))
                    message("اضغط تشغيل داخل الفيديو. MENU أو ↑ لإظهار أدوات العز TV.");
                revealChrome();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) { callback.onCustomViewHidden(); return; }
                fullscreenView = view;
                fullscreenCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                web.setVisibility(View.INVISIBLE);
                toolbar.setVisibility(View.GONE);
            }
            @Override public void onHideCustomView() { hideFullscreen(); }
        });

        toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(8), dp(4), dp(8), dp(4));
        toolbar.setBackgroundColor(0xD9131419);
        FrameLayout.LayoutParams top = new FrameLayout.LayoutParams(-1, dp(60), Gravity.TOP);
        root.addView(toolbar, top);

        Button back = button("✕ رجوع");
        toolbar.addView(back, new LinearLayout.LayoutParams(dp(94), -1));
        back.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { finish(); }
        });

        TextView title = new TextView(this);
        String label = getIntent().getStringExtra("title");
        title.setText(label == null ? "العز TV — Embed" : label);
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        title.setGravity(Gravity.CENTER_VERTICAL | Gravity.RIGHT);
        title.setPadding(dp(12), 0, dp(12), 0);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, -1, 1));

        Button reload = button("↻ إعادة");
        toolbar.addView(reload, new LinearLayout.LayoutParams(dp(100), -1));
        reload.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { message("إعادة تحميل المشغل…"); web.reload(); }
        });

        if(PlaybackSources.hasAlternatives(this)){
            Button sources=button("☷ المصادر");
            toolbar.addView(sources,new LinearLayout.LayoutParams(dp(120),-1));
            sources.setContentDescription("اختيار مشغل أو جودة أخرى");
            sources.setOnClickListener(new View.OnClickListener(){
                @Override public void onClick(View view){PlaybackSources.show(EmbedPlayerActivity.this);}
            });
        }
        Button external = button("↗ المصدر");
        toolbar.addView(external, new LinearLayout.LayoutParams(dp(115), -1));
        external.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                try {
                    Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(sourceUrl));
                    startActivity(browser);
                } catch (ActivityNotFoundException e) {
                    message("لا يوجد متصفح خارجي على الجهاز.");
                }
            }
        });

        notice = new TextView(this);
        notice.setTextColor(0xFFE5E0E1);
        notice.setTextSize(12);
        notice.setGravity(Gravity.CENTER);
        notice.setPadding(dp(12), dp(8), dp(12), dp(8));
        notice.setBackgroundColor(0xC9151419);
        FrameLayout.LayoutParams noticeParams =
            new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        root.addView(notice, noticeParams);
        message("جاري فتح مشغل Embed الآمن...");
        web.loadUrl(sourceUrl);
        back.requestFocus();
        revealChrome();
    }

    private void hideFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        if (web != null) web.setVisibility(View.VISIBLE);
        if (toolbar != null) toolbar.setVisibility(View.VISIBLE);
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event){
        if(event.getAction()==KeyEvent.ACTION_DOWN){
            int code=event.getKeyCode();
            if(code==KeyEvent.KEYCODE_MENU || code==KeyEvent.KEYCODE_INFO ||
                (code==KeyEvent.KEYCODE_DPAD_UP && toolbar!=null &&
                 toolbar.getVisibility()!=View.VISIBLE)){
                revealChrome();
                if(toolbar!=null && toolbar.getChildCount()>0)toolbar.getChildAt(0).requestFocus();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
    @Override public void onBackPressed() {
        if (fullscreenView != null) { hideFullscreen(); return; }
        super.onBackPressed();
    }
    @Override protected void onPause() {
        chromeHandler.removeCallbacks(hideChrome);
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }
    @Override protected void onDestroy() {
        chromeHandler.removeCallbacks(hideChrome);
        hideFullscreen();
        if (web != null) {
            web.stopLoading();
            web.loadUrl("about:blank");
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
