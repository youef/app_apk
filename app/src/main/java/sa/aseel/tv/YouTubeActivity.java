package sa.aseel.tv;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;

/**
 * Al Ezz in-app clips viewer for Android API19+.
 * All audiovisual playback uses the official YouTube IFrame API.
 * Never extract direct streams, remove player controls/attribution, or cover the player.
 */
public final class YouTubeActivity extends Activity {
    private static final int WHITE=0xFFF9F9FA, MUTED=0xFFBBB7C1, ACCENT=0xFFE52B4E;
    private final ArrayList<JSONObject> queue=new ArrayList<JSONObject>();
    private WebView web;
    private FrameLayout videoArea,root;
    private LinearLayout recommendations,body;
    private TextView title,status,queueStatus;
    private Button recommendButton,backButton,officialButton;
    private final Handler readinessHandler=new Handler();
    private final Runnable readinessTimeout=new Runnable(){public void run(){
        if(!isFinishing()&&!playerReady){
            status.setText("تعذّر تشغيل YouTube داخل متصفح الشاشة القديم. جرّب المشغل الرسمي أو أعد المحاولة.");
            if(officialButton!=null)officialButton.requestFocus();
        }
    }};
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private int current=0;
    private boolean recommendationsOpen=false, playerReady=false;
    private float touchX=0,touchY=0;

    private int dp(int i){return Math.round(getResources().getDisplayMetrics().density*i);}
    private String field(JSONObject x,String key){return x==null?"":x.optString(key,"");}
    private String currentId(){return field(queue.get(current),"video_id");}
    private TextView text(String value,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(value);t.setTextColor(color);t.setTextSize(size);
        t.setGravity(Gravity.CENTER_VERTICAL);t.setSingleLine(true);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        return t;
    }
    private GradientDrawable bg(int color,int border){
        GradientDrawable g=new GradientDrawable();g.setColor(color);
        g.setCornerRadius(dp(12));if(border!=0)g.setStroke(dp(1),border);
        return g;
    }
    private Button action(String label){
        Button b=new Button(this);b.setText(label);b.setTextSize(14);
        b.setTextColor(WHITE);b.setAllCaps(false);
        b.setBackgroundDrawable(bg(0xFF30232D,0xFF604657));b.setFocusable(true);
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                v.setBackgroundDrawable(bg(focused?0xFFB7193C:0xFF30232D,
                    focused?0xFFFFB2C2:0xFF604657));
                v.setScaleX(focused?1.035f:1f);v.setScaleY(focused?1.035f:1f);
            }
        });
        return b;
    }
    private void parseQueue(Bundle extras){
        String value=extras==null?"":extras.getString("playlist_json","[]");
        HashSet<String> seen=new HashSet<String>();
        try{
            JSONArray entries=new JSONArray(value);
            for(int i=0;i<entries.length()&&queue.size()<120;i++){
                JSONObject x=entries.optJSONObject(i);
                if(x==null)continue;
                String id=x.optString("video_id","");
                if(!id.matches("[A-Za-z0-9_-]{11}")||!seen.add(id))continue;
                queue.add(x);
            }
        }catch(Exception ignored){}
        String start=extras==null?"":extras.getString("start_video_id","");
        if(!start.matches("[A-Za-z0-9_-]{11}"))
            start=YouTubeLink.videoId(getIntent().getStringExtra("youtube_url"));
        if(start!=null&&start.matches("[A-Za-z0-9_-]{11}")){
            boolean found=false;
            for(int i=0;i<queue.size();i++)if(start.equals(field(queue.get(i),"video_id"))){
                current=i;found=true;break;
            }
            if(!found){
                JSONObject one=new JSONObject();
                try{
                    one.put("video_id",start);
                    one.put("title",getIntent().getStringExtra("title"));
                    one.put("channel","العز TV");
                    one.put("topic","other");
                    queue.add(0,one);
                }catch(Exception ignored){}
                current=0;
            }
        }
    }
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        parseQueue(getIntent().getExtras());
        if(queue.isEmpty()){finish();return;}
        root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);
        body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);
        body.setBackgroundColor(0xFF09090C);
        root.addView(body,new FrameLayout.LayoutParams(-1,-1));

        LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(13),0,dp(13),0);header.setBackgroundColor(0xFF171318);
        body.addView(header,new LinearLayout.LayoutParams(-1,dp(54)));
        backButton=action("رجوع  ❯");
        header.addView(backButton,new LinearLayout.LayoutParams(dp(103),dp(44)));
        backButton.setOnClickListener(new View.OnClickListener(){
            public void onClick(View v){finish();}
        });
        title=text("",18,WHITE,true);title.setGravity(Gravity.CENTER_VERTICAL|Gravity.RIGHT);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        title.setPadding(dp(15),0,dp(12),0);
        header.addView(title,new LinearLayout.LayoutParams(0,-1,1));
        TextView brand=text("◈  العز TV",15,ACCENT,true);
        header.addView(brand,new LinearLayout.LayoutParams(-2,-1));

        videoArea=new FrameLayout(this);
        body.addView(videoArea,new LinearLayout.LayoutParams(-1,0,1));
        web=new WebView(this);web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);web.setFocusableInTouchMode(true);
        videoArea.addView(web,new FrameLayout.LayoutParams(-1,-1));
        WebSettings settings=web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        web.setOnTouchListener(new View.OnTouchListener(){
            public boolean onTouch(View v,MotionEvent e){
                if(e.getAction()==MotionEvent.ACTION_DOWN){
                    touchX=e.getX();touchY=e.getY();
                }else if(e.getAction()==MotionEvent.ACTION_UP){
                    float dy=e.getY()-touchY, dx=Math.abs(e.getX()-touchX);
                    if(dy < -dp(70) && -dy > dx*1.3f){
                        showRecommendations();return true;
                    }
                }
                return false;
            }
        });
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){
                if(url==null)return false;
                if(url.startsWith("alezzvideo://ready")){
                    playerReady=true;
                    readinessHandler.removeCallbacks(readinessTimeout);
                    status.setText("المشغل جاهز. إذا بقيت الشاشة سوداء جرّب زر المشغل الرسمي.");
                    return true;
                }
                if(url.startsWith("alezzvideo://ended")){
                    runOnUiThread(new Runnable(){public void run(){nextVideo();}});
                    return true;
                }
                if(url.startsWith("alezzvideo://blocked")){
                    status.setText("اضغط تشغيل داخل الفيديو. قد يمنع الجهاز التشغيل التلقائي.");
                    return true;
                }
                if(url.startsWith("alezzvideo://error")){
                    readinessHandler.removeCallbacks(readinessTimeout);
                    status.setText("فشل تضمين هذا الفيديو. جرّب زر المشغل الرسمي.");
                    return true;
                }
                if(url.startsWith("https://www.youtube.com/embed/")||
                    url.startsWith("https://www.youtube-nocookie.com/embed/")||
                    url.startsWith("about:blank"))return false;
                // User-selected links inside the official player retain their ordinary behavior.
                if(url.startsWith("https://www.youtube.com/")||
                   url.startsWith("https://m.youtube.com/")||
                   url.startsWith("https://youtu.be/")){
                    try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}
                    catch(Exception e){status.setText("تعذر فتح رابط الفيديو على هذا الجهاز.");}
                    return true;
                }
                return true;
            }
            @Override public void onReceivedError(WebView view,int errorCode,String description,String url){
                readinessHandler.removeCallbacks(readinessTimeout);
                status.setText("فشل تحميل YouTube. تأكد من وقت الجهاز والاتصال، أو استخدم المشغل الرسمي.");
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onShowCustomView(View v,CustomViewCallback callback){
                if(fullScreenView!=null){callback.onCustomViewHidden();return;}
                hideRecommendations();
                fullScreenView=v;fullScreenCallback=callback;
                videoArea.addView(v,new FrameLayout.LayoutParams(-1,-1));
                web.setVisibility(View.INVISIBLE);
            }
            @Override public void onHideCustomView(){hideFullScreen();}
        });
        LinearLayout controlBar=new LinearLayout(this);
        controlBar.setGravity(Gravity.CENTER_VERTICAL);
        controlBar.setPadding(dp(16),dp(4),dp(16),dp(4));
        controlBar.setBackgroundColor(0xFF171318);
        body.addView(controlBar,new LinearLayout.LayoutParams(-1,dp(58)));
        recommendButton=action("↑  المقاطع المقترحة");
        controlBar.addView(recommendButton,new LinearLayout.LayoutParams(dp(198),dp(49)));
        recommendButton.setOnClickListener(new View.OnClickListener(){
            public void onClick(View v){if(recommendationsOpen)hideRecommendations();else showRecommendations();}
        });
        Button next=action("التالي  ▶");
        LinearLayout.LayoutParams np=new LinearLayout.LayoutParams(dp(135),dp(49));
        np.setMargins(dp(10),0,0,0);controlBar.addView(next,np);
        next.setOnClickListener(new View.OnClickListener(){public void onClick(View v){nextVideo();}});
        queueStatus=text("",13,MUTED,false);queueStatus.setGravity(Gravity.CENTER_VERTICAL);
        queueStatus.setPadding(dp(12),0,0,0);
        controlBar.addView(queueStatus,new LinearLayout.LayoutParams(0,-1,1));
        officialButton=action("▶ المشغل الرسمي");
        controlBar.addView(officialButton,new LinearLayout.LayoutParams(dp(165),dp(49)));
        officialButton.setOnClickListener(new View.OnClickListener(){
            public void onClick(View v){openOfficialPlayer();}
        });
        Button retry=action("↻ إعادة");
        controlBar.addView(retry,new LinearLayout.LayoutParams(dp(100),dp(49)));
        retry.setOnClickListener(new View.OnClickListener(){
            public void onClick(View v){loadInternalPlayer(currentId());}
        });

        recommendations=new LinearLayout(this);
        recommendations.setOrientation(LinearLayout.VERTICAL);
        recommendations.setBackgroundColor(0xFF141418);
        recommendations.setVisibility(View.GONE);
        body.addView(recommendations,new LinearLayout.LayoutParams(-1,dp(110)));
        status=text("",12,0xFFE6BBC7,false);
        status.setGravity(Gravity.CENTER);
        status.setBackgroundColor(0xFF251B25);
        status.setSingleLine(false);
        body.addView(status,new LinearLayout.LayoutParams(-1,dp(56)));
        setContentView(root);
        updateCurrentUi();
        loadInternalPlayer(currentId());
        backButton.requestFocus();
    }
    private void updateCurrentUi(){
        JSONObject item=queue.get(current);
        String label=field(item,"title");
        title.setText(label.length()>0?label:"مقطع من العز TV");
        queueStatus.setText((current+1)+" / "+queue.size()+"   •   التالي تلقائيًا");
        status.setText("جاري تحميل YouTube. إذا بقيت الشاشة سوداء استخدم زر المشغل الرسمي.");
    }
    private void playAt(int index){
        if(queue.isEmpty())return;
        current=(index+queue.size())%queue.size();
        updateCurrentUi();
        hideRecommendations();
        String id=currentId();
        if(web!=null && playerReady){
            web.loadUrl("javascript:window.alEzzPlayer&&window.alEzzPlayer.loadVideo('"+id+"')");
        }else{
            loadInternalPlayer(id);
        }
    }
    private void openOfficialPlayer(){
        String id=currentId();
        if(!id.matches("[A-Za-z0-9_-]{11}"))return;
        try{
            Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse("https://www.youtube.com/watch?v="+id));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
            status.setText("سيتم عرض الفيديو عبر التطبيق أو المتصفح الرسمي، ثم العودة إلى العز TV.");
        }catch(Exception e){
            status.setText("تعذر العثور على مشغل YouTube متوافق. قد لا يدعم الجهاز هذا الفيديو.");
            Log.w("AlezzYT","Official player unavailable",e);
        }
    }
    private void nextVideo(){
        if(queue.size()>1)playAt((current+1)%queue.size());
        else status.setText("هذا آخر مقطع متاح.");
    }
    private void showRecommendations(){
        if(recommendationsOpen||queue.size()<2)return;
        recommendationsOpen=true;
        recommendations.setVisibility(View.VISIBLE);
        recommendButton.setText("↓  إخفاء المقترحات");
        buildRecommendations();
    }
    private void hideRecommendations(){
        if(!recommendationsOpen)return;
        recommendationsOpen=false;
        recommendations.setVisibility(View.GONE);
        recommendButton.setText("↑  المقاطع المقترحة");
    }
    private void buildRecommendations(){
        recommendations.removeAllViews();
        TextView heading=text("مقاطع مقترحة لك  •  اضغط OK للتشغيل",15,WHITE,true);
        heading.setPadding(dp(20),dp(6),dp(20),dp(3));
        recommendations.addView(heading,new LinearLayout.LayoutParams(-1,dp(36)));
        ScrollView scroll=new ScrollView(this);
        scroll.setFillViewport(false);
        recommendations.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout items=new LinearLayout(this);items.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(items);
        final String currentTopic=field(queue.get(current),"topic");
        ArrayList<Integer> order=new ArrayList<Integer>();
        for(int i=0;i<queue.size();i++)if(i!=current && currentTopic.equals(field(queue.get(i),"topic")))order.add(i);
        for(int i=0;i<queue.size();i++)if(i!=current&&!order.contains(i))order.add(i);
        for(int p=0;p<order.size() && p<30;p++){
            final int index=order.get(p);
            JSONObject item=queue.get(index);
            LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(10),dp(5),dp(12),dp(5));
            row.setBackgroundDrawable(bg(0xFF1D1B20,0xFF3A343B));
            LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,dp(78));
            rp.setMargins(dp(12),dp(3),dp(12),dp(3));items.addView(row,rp);
            ImageView poster=new ImageView(this);poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
            row.addView(poster,new LinearLayout.LayoutParams(dp(118),dp(68)));
            PosterLoader.load(poster,"https://i.ytimg.com/vi/"+field(item,"video_id")+"/hqdefault.jpg");
            LinearLayout details=new LinearLayout(this);details.setOrientation(LinearLayout.VERTICAL);
            details.setPadding(dp(15),0,dp(6),0);
            row.addView(details,new LinearLayout.LayoutParams(0,-2,1));
            String label=field(item,"title");
            TextView name=text(label.length()>0?label:"مقطع",16,WHITE,true);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            details.addView(name);
            TextView by=text(field(item,"channel"),12,MUTED,false);
            details.addView(by);
            Button play=action("▶  تشغيل");
            row.addView(play,new LinearLayout.LayoutParams(dp(118),dp(48)));
            play.setOnClickListener(new View.OnClickListener(){
                public void onClick(View v){playAt(index);}
            });
        }
    }
    /** First-party wrapper around the *official* YouTube IFrame Player API.
      * It does not proxy, extract, restream or hide official playback controls. */
    private void loadInternalPlayer(String id){
        playerReady=false;
        readinessHandler.removeCallbacks(readinessTimeout);
        readinessHandler.postDelayed(readinessTimeout,15000);
        if(status!=null)status.setText(Build.VERSION.SDK_INT<=19
            ? "Android 4.4: قد يتعذّر عرض YouTube داخل WebView. زر المشغل الرسمي متاح."
            : "جاري تهيئة مشغل YouTube داخل العز TV...");
        StringBuilder h=new StringBuilder(3000);
        h.append("<!doctype html><html><head><meta charset='utf-8'>");
        h.append("<meta name='viewport' content='width=device-width,initial-scale=1'>");
        h.append("<style>html,body,#player{margin:0;width:100%;height:100%;background:#000;overflow:hidden}</style>");
        h.append("</head><body><div id='player'></div><script>(function(){var p=null,requestedId=null;");
        h.append("window.alEzzPlayer={loadVideo:function(id){if(/^[A-Za-z0-9_-]{11}$/.test(id)){if(p)p.loadVideoById(id);else requestedId=id;}},");
        h.append("playVideo:function(){if(p)p.playVideo();},pauseVideo:function(){if(p)p.pauseVideo();},");
        h.append("toggleVideo:function(){if(p){if(p.getPlayerState()===1)p.pauseVideo();else p.playVideo();}},");
        h.append("seek:function(t){if(p)p.seekTo(Math.max(0,p.getCurrentTime()+t),true);}};");
        h.append("window.onYouTubeIframeAPIReady=function(){try{p=new YT.Player('player',{width:'100%',height:'100%',");
        h.append("videoId:'").append(id).append("',playerVars:{autoplay:1,controls:1,playsinline:1,");
        h.append("enablejsapi:1,origin:'https://youef.github.io'},events:{");
        h.append("onReady:function(e){location.href=\'alezzvideo://ready\';if(requestedId)e.target.loadVideoById(requestedId);else e.target.playVideo();},");
        h.append("onStateChange:function(e){if(e.data===0)location.href='alezzvideo://ended';},");
        h.append("onError:function(e){location.href='alezzvideo://error/'+e.data;},");
        h.append("onAutoplayBlocked:function(){location.href='alezzvideo://blocked';}");
        h.append("}});}catch(e){location.href='alezzvideo://error/init';}};");
        h.append("var j=document.createElement('script');j.src='https://www.youtube.com/iframe_api';");
        h.append("j.onerror=function(){location.href='alezzvideo://error/load';};");
        h.append("document.head.appendChild(j);})();</script></body></html>");
        web.loadDataWithBaseURL("https://youef.github.io/app_apk/web/youtube-player.html",
            h.toString(),"text/html","UTF-8",null);
    }
    private void hideFullScreen(){
        if(fullScreenView!=null){
            videoArea.removeView(fullScreenView);fullScreenView=null;
            web.setVisibility(View.VISIBLE);
            if(fullScreenCallback!=null){fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;}
        }
    }
    @Override public boolean dispatchKeyEvent(KeyEvent e){
        if(e.getAction()==KeyEvent.ACTION_DOWN){
            if(e.getKeyCode()==KeyEvent.KEYCODE_DPAD_UP&&!recommendationsOpen){
                showRecommendations();return true;
            }
            if(e.getKeyCode()==KeyEvent.KEYCODE_BACK&&recommendationsOpen){
                hideRecommendations();return true;
            }
            if(e.getKeyCode()==KeyEvent.KEYCODE_MEDIA_NEXT){
                nextVideo();return true;
            }
            if(e.getKeyCode()==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE||
               e.getKeyCode()==KeyEvent.KEYCODE_MEDIA_PLAY||
               e.getKeyCode()==KeyEvent.KEYCODE_MEDIA_PAUSE){
                if(web!=null){
                    String cmd=e.getKeyCode()==KeyEvent.KEYCODE_MEDIA_PLAY?"playVideo":
                        e.getKeyCode()==KeyEvent.KEYCODE_MEDIA_PAUSE?"pauseVideo":"toggleVideo";
                    web.loadUrl("javascript:window.alEzzPlayer&&window.alEzzPlayer."+cmd+"()");
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(e);
    }
    @Override protected void onPause(){
        if(web!=null){web.loadUrl("javascript:window.alEzzPlayer&&window.alEzzPlayer.pauseVideo()");web.onPause();}
        super.onPause();
    }
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){
        readinessHandler.removeCallbacks(readinessTimeout);
        hideFullScreen();
        if(web!=null){web.loadUrl("about:blank");web.stopLoading();videoArea.removeView(web);web.destroy();web=null;}
        super.onDestroy();
    }
}