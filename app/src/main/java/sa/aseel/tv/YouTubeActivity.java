package sa.aseel.tv;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
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
import android.util.Log;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;

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
        // The stock Android 4.4 WebView cannot reliably run modern YouTube iframe JavaScript.
        // When a native YouTube TV/phone app is installed, prefer the official player.
        if(Build.VERSION.SDK_INT<=19 && openOfficialVideo(id)){
            finish();
            return;
        }
        root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);
        LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);
        root.addView(body,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout toolbar=new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(20),dp(3),dp(20),dp(3));
        toolbar.setBackgroundColor(0xFF151518);
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
        Button external=new Button(this);
        external.setText("↗  YouTube الرسمي");external.setTextSize(13);external.setAllCaps(false);
        external.setTextColor(Color.WHITE);external.setBackgroundColor(0xFFB30B2F);
        LinearLayout.LayoutParams externalParams=new LinearLayout.LayoutParams(dp(190),dp(44));
        externalParams.setMargins(dp(8),0,0,0);
        toolbar.addView(external,externalParams);
        external.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            if(!openOfficialVideo(id)){
                status.setVisibility(View.VISIBLE);
                status.setText("لم نجد تطبيق YouTube أو متصفحًا متوافقًا. قد يلزم تحديث النظام أو تطبيق YouTube.");
            }
        }});
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
        status.setText("مشغل YouTube الرسمي. إذا كانت الشاشة قديمة ولم يعمل الفيديو، استخدم زر «YouTube الرسمي».");
        body.addView(status,new LinearLayout.LayoutParams(-1,dp(43)));
        setContentView(root);
        // Bundle the YouTube iframe page inside the APK: no GitHub Pages 404 or site dependency.
        // Use an HTTPS origin so the official YouTube IFrame API has a proper embed origin.
        loadBundledPlayer(id);
        back.requestFocus();
    }
    private boolean openOfficialVideo(String id){
        Uri target=Uri.parse("https://www.youtube.com/watch?v="+id);
        for(String pkg:new String[]{"com.google.android.youtube.tv","com.google.android.youtube"}){
            try{
                Intent external=new Intent(Intent.ACTION_VIEW,target);
                external.setPackage(pkg);
                if(external.resolveActivity(getPackageManager())!=null){
                    startActivity(external);
                    return true;
                }
            }catch(Exception ignored){}
        }
        try{
            Intent browser=new Intent(Intent.ACTION_VIEW,target);
            if(browser.resolveActivity(getPackageManager())!=null){
                startActivity(browser);
                return true;
            }
        }catch(Exception ignored){}
        return false;
    }
    private void loadBundledPlayer(String id){
        InputStream stream=null;
        try{
            stream=getAssets().open("youtube-player.html");
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            byte[] buffer=new byte[4096];
            int count;
            while((count=stream.read(buffer))!=-1){
                if(bytes.size()+count>128*1024)throw new java.io.IOException("Bundled player too large");
                bytes.write(buffer,0,count);
            }
            String html=new String(bytes.toByteArray(),"UTF-8");
            if(html.indexOf("<script>")<0)throw new java.io.IOException("Player script missing");
            // The ID was validated as exactly eleven safe YouTube identifier characters.
            html=html.replace("<script>","<script>window.AL_EZZ_VIDEO_ID='"+id+"';</script><script>");
            web.loadDataWithBaseURL("https://youef.github.io/app_apk/web/youtube-player.html?v="+id,
                html,"text/html","UTF-8",null);
        }catch(Exception error){
            Log.e("AlEzzYouTube","Bundled player missing",error);
            status.setText("تعذر تجهيز المشغل الداخلي. استخدم زر YouTube الرسمي بالأعلى.");
            status.setVisibility(View.VISIBLE);
            // No fallback to the old 404 GitHub Pages path.
        }finally{
            if(stream!=null)try{stream.close();}catch(Exception ignored){}
        }
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
