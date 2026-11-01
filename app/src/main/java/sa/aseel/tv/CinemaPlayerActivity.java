package sa.aseel.tv;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.PlaybackException;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.source.DefaultMediaSourceFactory;
import com.google.android.exoplayer2.upstream.DefaultDataSource;
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource;
import com.google.android.exoplayer2.ui.PlayerView;

/** Leanback-style native player. HLS/MP4 use legacy ExoPlayer, never WebView. */
public final class CinemaPlayerActivity extends Activity {
    private static final int BG=0xFF090A0E, RED=0xFFF03252, WHITE=0xFFF7F7FA, MUTED=0xFFB0B4C0;
    private final Handler handler=new Handler();
    private final ExecutorService probeWorker=Executors.newSingleThreadExecutor();
    private final HashSet<Integer> attempted=new HashSet<Integer>();
    private int requestToken=0;
    private String lastSourceHint="";
    private ExoPlayer engine;
    private PlayerView surface;
    private TextView status,title,details;
    private Button playButton,qualityButton,backButton,externalButton;
    private LinearLayout footer,controlPanel;
    private static final long HIDE_DELAY=5500L;
    private final Runnable autoHide=new Runnable(){public void run(){
        if(!isFinishing()&&engine!=null&&engine.isPlaying())hideControls();
    }};
    private void hideControls(){
        handler.removeCallbacks(autoHide);
        if(controlPanel!=null)controlPanel.setVisibility(View.GONE);
        if(surface!=null)surface.requestFocus();
    }
    private void showControls(boolean focusButton){
        if(controlPanel==null)return;
        controlPanel.setVisibility(View.VISIBLE);
        handler.removeCallbacks(autoHide);
        if(focusButton&&playButton!=null)playButton.requestFocus();
        if(engine!=null&&engine.isPlaying())handler.postDelayed(autoHide,HIDE_DELAY);
    }
    private void toggleControls(){
        if(controlPanel!=null&&controlPanel.getVisibility()==View.VISIBLE)hideControls();
        else showControls(true);
    }
    private ArrayList<StreamQuality.Source> sources;
    private int index=-1,tries=0;
    private String itemId="",currentUrl="",itemTitle="";
    private boolean live=false,started=false;
    private final Runnable watchdog=new Runnable(){public void run(){
        if(isFinishing() || started || engine==null)return;
        if(tries<1){
            tries++;
            status.setText("البث بطيء، إعادة الاتصال بالمصدر...");
            try{engine.stop();engine.prepare();engine.play();}catch(Exception ignored){}
            handler.postDelayed(this,18000);
        }else{
            tryNextOrExplain("انتهت مهلة الاتصال دون تشغيل الفيديو. "+lastSourceHint);
        }
    }};
    private int dp(int px){return Math.round(px*getResources().getDisplayMetrics().density);}
    private GradientDrawable shape(int color,int border){
        GradientDrawable x=new GradientDrawable();x.setColor(color);x.setCornerRadius(dp(9));
        if(border!=0)x.setStroke(dp(1),border);return x;
    }
    private TextView txt(String value,int size,int color,boolean strong){
        TextView v=new TextView(this);v.setText(value);v.setTextColor(color);v.setTextSize(size);
        v.setGravity(Gravity.CENTER_VERTICAL);v.setSingleLine(false);
        if(strong)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return v;
    }
    private Button button(String name){
        final Button v=new Button(this);v.setText(name);v.setAllCaps(false);v.setTextSize(14);
        v.setTextColor(WHITE);v.setFocusable(true);v.setBackgroundDrawable(shape(0xFF2D222D,0xFF594350));
        v.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View w,boolean focused){
                v.setBackgroundDrawable(shape(focused?RED:0xFF2D222D,focused?0xFFFFC3CD:0xFF594350));
                v.setScaleX(focused?1.03f:1f);v.setScaleY(focused?1.03f:1f);
                if(focused&&controlPanel!=null&&controlPanel.getVisibility()==View.VISIBLE){
                    handler.removeCallbacks(autoHide);
                    if(engine!=null&&engine.isPlaying())handler.postDelayed(autoHide,HIDE_DELAY);
                }
            }
        });return v;
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        Intent intent=getIntent();
        itemId=intent.getStringExtra("item_id");if(itemId==null)itemId="";
        itemTitle=intent.getStringExtra("title");if(itemTitle==null)itemTitle="العز TV";
        live=intent.getBooleanExtra("is_live",false);
        String url=intent.getStringExtra("stream_url");
        sources=StreamQuality.parse(url,intent.getStringExtra("quality"),intent.getStringExtra("stream_variants"));
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        surface=new PlayerView(this);surface.setUseController(false);surface.setKeepScreenOn(true);
        surface.setFocusable(true);surface.setFocusableInTouchMode(true);
        surface.setOnTouchListener(new View.OnTouchListener(){
            public boolean onTouch(View view,MotionEvent event){
                if(event.getAction()==MotionEvent.ACTION_UP){
                    toggleControls();view.performClick();return true;
                }
                return true;
            }
        });
        root.addView(surface,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);
        controlPanel=panel;
        panel.setPadding(dp(22),dp(13),dp(22),dp(13));
        panel.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{0xE8111119,0xFA09090D}));
        FrameLayout.LayoutParams pp=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        root.addView(panel,pp);
        title=txt("▶ "+itemTitle,21,WHITE,true);panel.addView(title);
        details=txt(live?"● بث مباشر":"فيلم / حلقة",12,MUTED,false);panel.addView(details);
        status=txt("جاري تجهيز مشغّل الفيديو...",13,0xFFFFBCC6,false);
        LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,-2);
        sp.topMargin=dp(7);panel.addView(status,sp);
        footer=new LinearLayout(this);footer.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams fp=new LinearLayout.LayoutParams(-1,dp(55));
        fp.topMargin=dp(8);panel.addView(footer,fp);
        playButton=button("▶ تشغيل / إيقاف");
        footer.addView(playButton,new LinearLayout.LayoutParams(0,-1,1));
        playButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            if(engine==null)return;
            if(engine.getPlaybackState()==Player.STATE_IDLE){attempted.clear();tries=0;playSource(index);}
            else if(engine.isPlaying())engine.pause();else engine.play();
        }});
        Button retryButton=button("↻ إعادة");
        footer.addView(retryButton,new LinearLayout.LayoutParams(0,-1,1));
        retryButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            attempted.clear();tries=0;playSource(index);
        }});
        qualityButton=button("الجودة");
        footer.addView(qualityButton,new LinearLayout.LayoutParams(0,-1,1));
        qualityButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showQualityMenu();}});
        externalButton=button("مشغل بديل");
        footer.addView(externalButton,new LinearLayout.LayoutParams(0,-1,1));
        externalButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){external();}});
        backButton=button("رجوع");
        footer.addView(backButton,new LinearLayout.LayoutParams(0,-1,1));
        backButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){finish();}});
        if(sources.isEmpty()){
            status.setText("لا يوجد رابط MP4/HLS صالح لهذا العنوان. يرجى تحديثه في لوحة الإدارة.");
            showControls(true);
            externalButton.setEnabled(false);backButton.requestFocus();return;
        }
        String preferred=getSharedPreferences("alezz_v11_player",MODE_PRIVATE).getString("quality_"+itemId,"auto");
        index=StreamQuality.choose(sources,preferred,Build.VERSION.SDK_INT);
        if(index<0)index=0;
        initPlayer();playSource(index);
        showControls(true);
    }
    private void initPlayer(){
        try{
            // Keep normal X.509 and hostname verification; add trusted roots/TLS1.2 on KitKat.
            if(Build.VERSION.SDK_INT<=19){
                HttpsURLConnection.setDefaultSSLSocketFactory(LegacyTls.factory(this));
            }
        }catch(Exception problem){
            Log.w("AlezzV11","TLS provider setup failed: "+CatalogApi.describe(problem));
        }
        DefaultHttpDataSource.Factory http=new DefaultHttpDataSource.Factory()
            .setUserAgent("AlEzzTV/11 (Android TV)")
            .setConnectTimeoutMs(14000)
            .setReadTimeoutMs(18000)
            .setAllowCrossProtocolRedirects(false);
        DefaultDataSource.Factory data=new DefaultDataSource.Factory(this,http);
        engine=new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(data)).build();
        engine.addListener(new Player.Listener(){
            @Override public void onPlaybackStateChanged(int state){
                if(state==Player.STATE_BUFFERING){
                    status.setText("◌ جاري تحميل الفيديو... اضغط رجوع للخروج");started=false;
                    showControls(false);
                }else if(state==Player.STATE_READY){
                    handler.removeCallbacks(watchdog);started=true;tries=0;
                    status.setText(live?"● البث المباشر يعمل":"▶ الفيديو جاهز • OK أو اللمس لعرض القوائم");
                    handler.removeCallbacks(autoHide);
                    handler.postDelayed(autoHide,1200L);
                    details.setText((live?"مباشر":"MP4 / HLS")+"  |  "+sources.get(index).label);
                }else if(state==Player.STATE_ENDED){
                    status.setText("انتهى الفيديو. اختر رجوع أو جودة أخرى.");
                    showControls(true);
                }
            }
            @Override public void onPlayerError(PlaybackException error){
                handler.removeCallbacks(watchdog);started=false;
                String reason=error.getErrorCodeName();
                Log.w("AlezzV11","Player failed: "+reason,error);
                String explanation;
                if("ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED".equals(reason))
                    explanation="حاوية الفيديو غير مدعومة أو الخادم أعاد بيانات ليست فيديو. "+lastSourceHint;
                else if(reason.contains("DECODING")||reason.contains("DECODER"))
                    explanation="جهازك لا يدعم ترميز هذه الجودة. جرّب MP4 بجودة SD/H.264.";
                else if(reason.contains("NETWORK")||reason.contains("HTTP")||reason.contains("IO"))
                    explanation="تعذر الوصول للمصدر أو انتهت صلاحية الرابط. "+lastSourceHint;
                else explanation="تعذر قراءة المصدر ("+reason+"). "+lastSourceHint;
                tryNextOrExplain(explanation);
            }
        });
        surface.setPlayer(engine);
    }
    private void tryNextOrExplain(String explanation){
        handler.removeCallbacks(watchdog);
        for(int offset=1;offset<=sources.size();offset++){
            int next=(index+offset)%sources.size();
            if(!attempted.contains(next)){
                status.setText("فشل المصدر الحالي. تجربة جودة أخرى...");
                tries=0;playSource(next);return;
            }
        }
        status.setText(explanation+" — لا توجد جودات أخرى صالحة. استخدم المشغل البديل أو حدّث رابط الفيلم من الإدارة.");
        showControls(true);
        footer.setVisibility(View.VISIBLE);
        externalButton.requestFocus();
    }
    private void playSource(int which){
        if(which<0||which>=sources.size()||engine==null)return;
        index=which;currentUrl=sources.get(which).url;
        attempted.add(which);
        started=false;handler.removeCallbacks(watchdog);
        final int token=++requestToken;
        final String stream=currentUrl;
        qualityButton.setText("الجودة: "+sources.get(which).label);
        status.setText("◌ فحص رابط الفيديو قبل التشغيل...");
        showControls(false);
        probeWorker.execute(new Runnable(){public void run(){
            final StreamProbe.Result probe=StreamProbe.inspect(getApplicationContext(),stream);
            handler.post(new Runnable(){public void run(){
                if(isFinishing()||engine==null||token!=requestToken)return;
                lastSourceHint=probe.message;
                if(probe.rejected){
                    tryNextOrExplain(probe.message);return;
                }
                try{
                    status.setText("◌ "+probe.message+" جاري التشغيل...");
                    MediaItem.Builder item=new MediaItem.Builder().setUri(Uri.parse(stream));
                    if(probe.detectedMime!=null)item.setMimeType(probe.detectedMime);
                    engine.setMediaItem(item.build());
                    engine.prepare();
                    engine.play();
                    long saved=getSharedPreferences("alezz_v11_player",MODE_PRIVATE).getLong("position_"+itemId,0L);
                    if(!live&&saved>5000 && !getIntent().getBooleanExtra("no_resume",false))
                        engine.seekTo(saved);
                    handler.postDelayed(watchdog,22000);
                }catch(Exception ex){
                    Log.e("AlezzV11","Unable to prepare media source",ex);
                    tryNextOrExplain("فشل تهيئة الفيديو: "+ex.getClass().getSimpleName());
                }
            }});
        }});
    }
    private void showQualityMenu(){
        if(sources==null||sources.size()<2){
            status.setText("المصدر متاح بجودة واحدة. في HLS يختار المشغل الدقة تلقائيًا.");return;
        }
        String[] names=new String[sources.size()];
        for(int i=0;i<names.length;i++)names[i]=sources.get(i).label;
        new android.app.AlertDialog.Builder(this).setTitle("جودة المشاهدة")
            .setSingleChoiceItems(names,index,new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface dialog,int which){
                    getSharedPreferences("alezz_v11_player",MODE_PRIVATE).edit()
                        .putString("quality_"+itemId,sources.get(which).label).apply();
                    attempted.clear();tries=0;playSource(which);dialog.dismiss();
                }
            }).setNegativeButton("إلغاء",null).show();
    }
    private void external(){
        if(currentUrl==null||!StreamQuality.isDirectUrl(currentUrl))return;
        try{
            Intent external=new Intent(Intent.ACTION_VIEW);
            external.setDataAndType(Uri.parse(currentUrl),
                currentUrl.toLowerCase(Locale.US).contains(".m3u8")?
                "application/vnd.apple.mpegurl":"video/mp4");
            startActivity(external);
        }catch(Exception ex){
            status.setText("لا يوجد مشغل خارجي مثبت يدعم الرابط. جرّب جودة MP4 أو مصدرًا آخر.");
        }
    }
    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_BACK&&controlPanel!=null
           &&controlPanel.getVisibility()==View.VISIBLE){hideControls();return true;}
        if(code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_ENTER||
           code==KeyEvent.KEYCODE_DPAD_UP||code==KeyEvent.KEYCODE_DPAD_DOWN||
           code==KeyEvent.KEYCODE_DPAD_LEFT||code==KeyEvent.KEYCODE_DPAD_RIGHT){
            if(controlPanel!=null&&controlPanel.getVisibility()!=View.VISIBLE){
                showControls(true);return true;
            }
        }
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE||
            ((code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_ENTER)
               &&getCurrentFocus()==surface)){
            if(engine!=null){if(engine.isPlaying())engine.pause();else engine.play();}
            showControls(false);return true;
        }
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY){if(engine!=null)engine.play();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_PAUSE){if(engine!=null)engine.pause();return true;}
        if(!live&&engine!=null){
            if(code==KeyEvent.KEYCODE_MEDIA_REWIND){engine.seekTo(Math.max(0,engine.getCurrentPosition()-10000));return true;}
            if(code==KeyEvent.KEYCODE_MEDIA_FAST_FORWARD){engine.seekTo(engine.getCurrentPosition()+10000);return true;}
        }
        return super.onKeyDown(code,event);
    }
    @Override protected void onPause(){
        handler.removeCallbacks(autoHide);
        if(engine!=null){
            if(!live && itemId.length()>0){
                getSharedPreferences("alezz_v11_player",MODE_PRIVATE).edit()
                    .putLong("position_"+itemId,Math.max(0,engine.getCurrentPosition())).apply();
            }
            engine.pause();
        }
        super.onPause();
    }
    @Override protected void onDestroy(){
        requestToken++;probeWorker.shutdownNow();handler.removeCallbacksAndMessages(null);
        if(surface!=null)surface.setPlayer(null);
        if(engine!=null){engine.release();engine=null;}
        super.onDestroy();
    }
}
