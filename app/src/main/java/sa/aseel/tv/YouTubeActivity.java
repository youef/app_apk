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
        // Generate a small player locally: no GitHub Pages 404 or missing HTML asset.
        // Use an HTTPS origin so YouTube's official IFrame API can resolve correctly.
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
    /** In-memory first-party player: never fetch a missing GitHub Pages HTML route. */
    private void loadBundledPlayer(String id){
        // id is validated by YouTubeLink.videoId() before reaching this method.
        StringBuilder html=new StringBuilder(3700);
        html.append("<!doctype html><html lang='ar' dir='rtl'><head><meta charset='UTF-8'>");
        html.append("<meta name='viewport' content='width=device-width,initial-scale=1'>");
        html.append("<style>html,body{margin:0;height:100%;background:#09090c;color:white;font-family:Arial,sans-serif}");
        html.append("main{height:100%;display:flex;flex-direction:column}#player{flex:1;min-height:200px}");
        html.append("nav{display:flex;gap:12px;justify-content:center;background:#16161a;padding:10px}");
        html.append("button{color:#fff;background:#29292e;border:1px solid #555;padding:12px 19px;font-size:16px}");
        html.append("button:focus{background:#bb163b;outline:2px solid #fff}");
        html.append("#state{background:#16161a;color:#ccc;padding:7px;text-align:center;font-size:12px}</style></head>");
        html.append("<body><main><div id='player'></div><nav>");
        html.append("<button id='play'>▶ تشغيل</button><button id='pause'>⏸ إيقاف</button>");
        html.append("<button id='back'>−10 ثوانٍ</button><button id='forward'>+10 ثوانٍ</button></nav>");
        html.append("<div id='state'>يتم تحميل مشغّل YouTube الرسمي. استخدم الريموت.</div></main>");
        html.append("<script>(function(){var p=null,ready=false;");
        html.append("var note=function(t){document.getElementById('state').textContent=t;};");
        html.append("window.alEzzPlayer={playVideo:function(){if(ready)p.playVideo();},");
        html.append("pauseVideo:function(){if(ready)p.pauseVideo();},");
        html.append("toggleVideo:function(){if(ready){if(p.getPlayerState()==1)p.pauseVideo();else p.playVideo();}},");
        html.append("seek:function(s){if(ready)p.seekTo(Math.max(0,p.getCurrentTime()+s),true);}};");
        html.append("document.getElementById('play').onclick=window.alEzzPlayer.playVideo;");
        html.append("document.getElementById('pause').onclick=window.alEzzPlayer.pauseVideo;");
        html.append("document.getElementById('back').onclick=function(){window.alEzzPlayer.seek(-10);};");
        html.append("document.getElementById('forward').onclick=function(){window.alEzzPlayer.seek(10);};");
        html.append("window.onYouTubeIframeAPIReady=function(){try{p=new YT.Player('player',{");
        html.append("videoId:'").append(id).append("',width:'100%',height:'100%',");
        html.append("playerVars:{controls:1,playsinline:1,enablejsapi:1,origin:'https://youef.github.io'},");
        html.append("events:{onReady:function(){ready=true;note('المشغل جاهز. اضغط تشغيل.');},");
        html.append("onError:function(e){note('تعذر التضمين أو توافق الجهاز (رمز '+e.data+'). افتح YouTube الرسمي من الأعلى.');}}");
        html.append("});}catch(e){note('متصفح التلفزيون لا يدعم YouTube الحديث. استخدم التطبيق الرسمي.');}};");
        html.append("var script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';");
        html.append("script.onerror=function(){note('تعذر الاتصال بواجهة YouTube. استخدم التطبيق الرسمي.');};");
        html.append("document.head.appendChild(script);");
        html.append("setTimeout(function(){if(!ready)note('المشغل غير جاهز. قد يحتاج Android القديم تطبيق YouTube الرسمي.');},18000);");
        html.append("})();</script></body></html>");
        web.loadDataWithBaseURL("https://youef.github.io/app_apk/web/youtube-player.html?v="+id,
            html.toString(),"text/html","UTF-8",null);
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
