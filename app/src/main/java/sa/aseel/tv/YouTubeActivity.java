package sa.aseel.tv;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Gravity;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.os.Build;

/**
 * First-party HTTPS hosted YouTube iframe page. Remains inside the application;
 * uses the official player and does not extract audiovisual streams.
 * Stock KitKat WebView may be incompatible with modern YouTube HTML5.
 */
public final class YouTubeActivity extends Activity {
    private WebView web;
    private FrameLayout root,videoArea;
    private TextView status;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private int dp(int i){return Math.round(getResources().getDisplayMetrics().density*i);}
    @Override public void onCreate(Bundle savedInstanceState){
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        String id=YouTubeLink.videoId(getIntent().getStringExtra("youtube_url"));
        if(id==null){finish();return;}
        root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);
        LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);
        root.addView(body,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout toolbar=new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(20),dp(3),dp(20),dp(3));
        toolbar.setBackgroundColor(0xFF12151E);
        body.addView(toolbar,new LinearLayout.LayoutParams(-1,dp(53)));
        Button back=new Button(this);back.setText("رجوع ❯");back.setTextSize(14);back.setAllCaps(false);
        back.setTextColor(Color.WHITE);back.setBackgroundColor(0xFF3A2736);
        toolbar.addView(back,new LinearLayout.LayoutParams(dp(105),dp(44)));
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){finish();}});
        TextView title=new TextView(this);title.setText(getIntent().getStringExtra("title"));
        title.setTextColor(0xFFF5F6FC);title.setTextSize(18);title.setSingleLine(true);
        title.setGravity(Gravity.CENTER_VERTICAL|Gravity.RIGHT);title.setPadding(dp(12),0,dp(8),0);
        toolbar.addView(title,new LinearLayout.LayoutParams(0,-1,1));
        TextView badge=new TextView(this);badge.setText("YouTube  ▶");
        badge.setTextColor(0xFFFF6172);badge.setTextSize(14);badge.setGravity(Gravity.CENTER);
        toolbar.addView(badge,new LinearLayout.LayoutParams(dp(118),-1));
        videoArea=new FrameLayout(this);
        body.addView(videoArea,new LinearLayout.LayoutParams(-1,0,1));
        web=new WebView(this);web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);web.setFocusableInTouchMode(true);
        videoArea.addView(web,new FrameLayout.LayoutParams(-1,-1));
        WebSettings settings=web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){
                // Only the first-party embedded watch page and official YouTube embed may navigate.
                if(url.startsWith("https://youef.github.io/app_apk/youtube-player.html")||
                   url.startsWith("https://www.youtube.com/embed/")||
                   url.startsWith("https://www.youtube-nocookie.com/embed/"))return false;
                status.setText("تم منع الانتقال إلى صفحة خارج المشغّل. اضغط رجوع للعودة إلى العز TV.");
                status.setVisibility(View.VISIBLE);
                return true;
            }
            @Override public void onReceivedError(WebView view,int errorCode,String description,String url){
                if(url.startsWith("https://youef.github.io/")){
                    status.setText("تعذر تحميل مشغل YouTube: تحقق من HTTPS والإنترنت وساعة الشاشة.");
                    status.setVisibility(View.VISIBLE);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onShowCustomView(View view,CustomViewCallback callback){
                if(fullScreenView!=null){callback.onCustomViewHidden();return;}
                fullScreenView=view;fullScreenCallback=callback;
                videoArea.addView(view,new FrameLayout.LayoutParams(-1,-1));
                web.setVisibility(View.INVISIBLE);
            }
            @Override public void onHideCustomView(){hideFullScreen();}
        });
        status=new TextView(this);status.setTextColor(0xFFFFD0D3);status.setTextSize(13);
        status.setGravity(Gravity.CENTER);status.setPadding(dp(15),dp(7),dp(15),dp(7));
        status.setBackgroundColor(0xFF241A24);
        status.setText("إذا لم يعمل الفيديو، فقد لا يدعم WebView في Android 4.4.4 مشغّل YouTube الحديث.");
        body.addView(status,new LinearLayout.LayoutParams(-1,dp(43)));
        setContentView(root);
        final String page="https://youef.github.io/app_apk/youtube-player.html?v="+id;
        web.loadUrl(page);
        back.requestFocus();
    }
    private void hideFullScreen(){
        if(fullScreenView!=null){
            videoArea.removeView(fullScreenView);fullScreenView=null;
            web.setVisibility(View.VISIBLE);
            if(fullScreenCallback!=null){fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;}
        }
    }
    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_BACK&&fullScreenView!=null){hideFullScreen();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE||code==KeyEvent.KEYCODE_MEDIA_PLAY||
           code==KeyEvent.KEYCODE_MEDIA_PAUSE){
            if(web!=null){
                final String action=code==KeyEvent.KEYCODE_MEDIA_PLAY?"playVideo":
                    code==KeyEvent.KEYCODE_MEDIA_PAUSE?"pauseVideo":"toggleVideo";
                web.loadUrl("javascript:window.alEzzPlayer&&window.alEzzPlayer."+action+"()");
                return true;
            }
        }
        return super.onKeyDown(code,event);
    }
    @Override protected void onPause(){if(web!=null)web.onPause();super.onPause();}
    @Override protected void onStop(){
        super.onStop();
        // A background/recents return must re-enter the PIN gate in MainActivity.
        if(!isFinishing()&&!isChangingConfigurations())finish();
    }
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){
        hideFullScreen();
        if(web!=null){
            web.loadUrl("about:blank");
            web.stopLoading();
            videoArea.removeView(web);
            web.destroy();web=null;
        }
        super.onDestroy();
    }
}
