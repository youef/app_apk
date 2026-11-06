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
import android.widget.ImageView;
import android.widget.HorizontalScrollView;
import android.widget.ScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.Tracks;
import com.google.android.exoplayer2.Format;
import com.google.android.exoplayer2.ui.AspectRatioFrameLayout;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.PlaybackException;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.source.DefaultMediaSourceFactory;
import com.google.android.exoplayer2.upstream.DefaultDataSource;
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource;
import com.google.android.exoplayer2.ui.PlayerView;

/** Leanback-style native player. HLS/MP4 use legacy ExoPlayer, never WebView. */
public final class CinemaPlayerActivity extends Activity {
    private static final int BG=0xFF090B11, RED=0xFFEF3658, WHITE=0xFFF7F4F8, MUTED=0xFFA7A6B4;
    private final Handler handler=new Handler();
    // Keep probes bounded while the remote is rapidly changing stations.
    private final ExecutorService probeWorker=new ThreadPoolExecutor(2,2,30L,TimeUnit.SECONDS,
        new ArrayBlockingQueue<Runnable>(2),new ThreadPoolExecutor.DiscardOldestPolicy());
    private final HashSet<Integer> attempted=new HashSet<Integer>();
    private int requestToken=0;
    private String lastSourceHint="";
    private ExoPlayer engine;
    private boolean kidsPlayback=false;
    private int kidsAge=6,kidsMinutes=60;
    private final Runnable kidsClock=new Runnable(){public void run(){
        if(!kidsPlayback||isFinishing())return;
        if(engine!=null&&engine.isPlaying()){
            java.text.SimpleDateFormat fmt=new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.US);
            String today=fmt.format(new java.util.Date());
            String key="watched_"+kidsAge+"_"+today;
            android.content.SharedPreferences pref=getSharedPreferences("alezz_kids",MODE_PRIVATE);
            int seconds=pref.getInt(key,0)+1;
            pref.edit().putInt(key,seconds).apply();
            if(seconds>=kidsMinutes*60){
                engine.pause();
                if(status!=null)status.setText("انتهى وقت المشاهدة اليوم. يمكنك العودة غدًا.");
                finish();return;
            }
        }
        handler.postDelayed(this,1000L);
    }};
    private PlayerView surface;
    private TextView status,title,details;
    private Button playButton,qualityButton,backButton,externalButton,liveFavoriteButton,liveMuteButton;
    private boolean liveMuted=false;
    private LinearLayout footer,controlPanel,leftRail,rightRail;
    private FrameLayout rootFrame;
    private Button skipIntroButton;
    private ScrollView channelsScroll;
    private TextView liveHud;
    private final Runnable hideLiveHud=new Runnable(){public void run(){
        if(liveHud!=null)liveHud.setVisibility(View.GONE);
    }};
    private void showLiveHud(String message){
        if(!live||liveHud==null)return;
        liveHud.setText(message);
        liveHud.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideLiveHud);
        handler.postDelayed(hideLiveHud,3800L);
    }
    private String profile="family",seriesId="",activeGroup="الكل";
    private Button guideSelectedButton,guideFirstButton;
    private long lastRapidZap=0L;
    private boolean matchesGroup(JSONObject channel){
        return "الكل".equals(activeGroup) ||
            ("المفضلة".equals(activeGroup) && channel.optBoolean("favorite",false)) ||
            activeGroup.equals(groupFor(channel));
    }
    private void stepChannel(int direction){
        if(tvChannels.isEmpty())return;
        int size=tvChannels.size(),at=tvChannelIndex;
        for(int i=0;i<size;i++){
            at=(at+direction+size)%size;
            if(matchesGroup(tvChannels.get(at))){
                switchChannel(at);return;
            }
        }
        showLiveHud("لا توجد قنوات متاحة ضمن التصنيف "+activeGroup);
    }
    private void rapidZap(int direction,KeyEvent event){
        long now=android.os.SystemClock.uptimeMillis();
        if(event.getRepeatCount()>0 && now-lastRapidZap<135L)return;
        lastRapidZap=now;
        stepChannel(direction);
    }
    private void showLiveOptions(){
        if(controlPanel!=null)controlPanel.setVisibility(View.GONE);
        if(leftRail!=null)leftRail.setVisibility(View.GONE);
        if(rightRail!=null){
            rightRail.setVisibility(View.VISIBLE);
            if(rightRail.getChildCount()>1)rightRail.getChildAt(1).requestFocus();
        }
        handler.removeCallbacks(autoHide);
        railVisible=true;
    }
    private boolean railVisible=false;
    private final Runnable progressTick=new Runnable(){public void run(){
        if(isFinishing())return;
        if(engine!=null&&engine.isPlaying()&&!live)saveProgress();
        updateSkipButton();
        handler.postDelayed(this,9000L);
    }};
    private static final long HIDE_DELAY=5500L;
    private final Runnable autoHide=new Runnable(){public void run(){
        if(isFinishing()||engine==null||!engine.isPlaying())return;
        if((leftRail!=null&&leftRail.hasFocus())||(rightRail!=null&&rightRail.hasFocus())){
            handler.postDelayed(this,HIDE_DELAY);return;
        }
        hideControls();
    }};
    private void hideControls(){
        handler.removeCallbacks(autoHide);
        if(controlPanel!=null)controlPanel.setVisibility(View.GONE);
        if(leftRail!=null)leftRail.setVisibility(View.GONE);
        if(rightRail!=null)rightRail.setVisibility(View.GONE);
        railVisible=false;
        if(surface!=null)surface.requestFocus();
    }
    private void showControls(boolean focusButton){
        if(controlPanel==null)return;
        controlPanel.setVisibility(View.VISIBLE);
        // Keep broadcast picture unobstructed; open TV guide/options only on demand.
        setRailsVisible(!live);
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
    private final ArrayList<JSONObject> tvChannels=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> mediaPlaylist=new ArrayList<JSONObject>();
    private int mediaIndex=-1;
    private String mediaKind="movie";
    private int tvChannelIndex=-1,aspectMode=0;
    private String remoteNumber="";
    private final Runnable commitRemoteNumber=new Runnable(){public void run(){
        try{
            int requested=Integer.parseInt(remoteNumber);
            if(requested>=1 && requested<=tvChannels.size())switchChannel(requested-1);
            else showControls(true);
        }catch(Exception ignored){}
        remoteNumber="";
    }};
    private boolean live=false,started=false;
    private long lastLivePlayhead=-1;
    private int frozenTicks=0,liveRestarts=0;
    private final Runnable liveHealth=new Runnable(){public void run(){
        if(isFinishing()||engine==null)return;
        if(live && engine.getPlaybackState()==Player.STATE_READY && engine.isPlaying()){
            long position=engine.getCurrentPosition();
            if(position>0 && lastLivePlayhead>0 && position<=lastLivePlayhead+50)frozenTicks++;
            else frozenTicks=0;
            lastLivePlayhead=position;
            if(frozenTicks>=4){
                frozenTicks=0;
                if(liveRestarts<2){
                    liveRestarts++;
                    status.setText("توقف تقدم البث • استعادة الاتصال "+liveRestarts+"/2");
                    playSource(index);
                }else{
                    tryNextOrExplain("الصورة متوقفة رغم الاتصال؛ يرجى تجربة مصدر آخر.");
                }
            }
        }else{frozenTicks=0;lastLivePlayhead=-1;}
        handler.postDelayed(this,5000L);
    }};
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
        return GlassSurface.panel(color,border,dp(10));
    }
    private TextView txt(String value,int size,int color,boolean strong){
        TextView v=new TextView(this);v.setText(value);v.setTextColor(color);v.setTextSize(size);
        v.setGravity(Gravity.CENTER_VERTICAL);v.setSingleLine(false);
        if(strong)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return v;
    }
    /** Icon-only live tools retain an accessible label and announce it on remote focus. */
    private Button tvTool(String symbol,final String label){
        final Button control=button(symbol);
        control.setTextSize(23);
        control.setGravity(Gravity.CENTER);
        control.setPadding(0,0,0,0);
        control.setContentDescription(label);
        if(Build.VERSION.SDK_INT>=26)control.setTooltipText(label);
        control.setBackgroundDrawable(shape(0xFF19263B,0x877A90B2));
        control.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View view,boolean focused){
                control.setBackgroundDrawable(shape(focused?0xFF66512A:0xFF19263B,
                    focused?0xFFEBC47D:0x877A90B2));
                control.setScaleX(focused?1.08f:1f);
                control.setScaleY(focused?1.08f:1f);
                if(focused)showLiveHud(label);
                handler.removeCallbacks(autoHide);
                if(engine!=null&&engine.isPlaying()&&!focused)handler.postDelayed(autoHide,HIDE_DELAY);
            }
        });
        return control;
    }
    private boolean isChannelFavorite(){
        if(itemId==null||itemId.isEmpty())return false;
        SharedPreferences prefs=getSharedPreferences("alizz_v11_favorites."+MemberAuth.userId(this),MODE_PRIVATE);
        String key="channel:"+itemId,scoped=profile+"."+key;
        if(prefs.contains(scoped))return prefs.getBoolean(scoped,false);
        return "family".equals(profile)&&prefs.getBoolean(key,false);
    }
    private void updateLiveFavorite(){
        if(liveFavoriteButton==null)return;
        boolean selected=isChannelFavorite();
        liveFavoriteButton.setText(selected?"★":"☆");
        liveFavoriteButton.setContentDescription(selected?"إزالة القناة من المفضلة":"إضافة القناة للمفضلة");
        if(Build.VERSION.SDK_INT>=26)liveFavoriteButton.setTooltipText(
            selected?"إزالة القناة من المفضلة":"إضافة القناة للمفضلة");
    }
    private void toggleLiveFavorite(){
        if(itemId==null||itemId.isEmpty())return;
        boolean selected=!isChannelFavorite();
        getSharedPreferences("alizz_v11_favorites."+MemberAuth.userId(this),MODE_PRIVATE).edit()
            .putBoolean(profile+".channel:"+itemId,selected).apply();
        for(JSONObject channel:tvChannels)
            if(itemId.equals(channel.optString("id",""))){
                try{channel.put("favorite",selected);}catch(Exception ignored){}
            }
        updateLiveFavorite();
        showLiveHud(selected?"★ تم حفظ القناة في المفضلة":"☆ تمت إزالة القناة من المفضلة");
        // Rebuild only when the viewer has intentionally opened the guide.
        if(leftRail!=null&&leftRail.getVisibility()==View.VISIBLE)updateChannelRail();
    }
    private void updateLiveMute(){
        if(liveMuteButton==null)return;
        liveMuteButton.setText(liveMuted?"◀":"♫");
        liveMuteButton.setContentDescription(liveMuted?"تشغيل الصوت":"كتم الصوت");
        if(Build.VERSION.SDK_INT>=26)liveMuteButton.setTooltipText(liveMuted?"تشغيل الصوت":"كتم الصوت");
    }
    private void toggleLiveMute(){
        liveMuted=!liveMuted;
        if(engine!=null)engine.setVolume(liveMuted?0f:1f);
        getSharedPreferences("alezz_v11_player",MODE_PRIVATE).edit()
            .putBoolean("live_mute_"+profile,liveMuted).apply();
        updateLiveMute();
        showLiveHud(liveMuted?"تم كتم الصوت":"تم تشغيل الصوت");
    }
    private Button button(String name){
        final Button v=new Button(this);v.setText(name);v.setAllCaps(false);v.setTextSize(14);
        v.setTextColor(WHITE);v.setFocusable(true);v.setBackgroundDrawable(shape(0xFF24334C,0x886B7F9E));
        v.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View w,boolean focused){
                v.setBackgroundDrawable(shape(focused?0xFF745335:0xFF24334C,
                    focused?0xFFF2D39B:0x886B7F9E));
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
        profile=intent.getStringExtra("profile");if(profile==null)profile=PlaybackMemory.activeProfile(this);
        seriesId=intent.getStringExtra("series_id");if(seriesId==null)seriesId="";
        live=intent.getBooleanExtra("is_live",false);
        kidsPlayback=intent.getBooleanExtra("kids_mode",false);
        kidsAge=intent.getIntExtra("kids_age",6);
        kidsMinutes=intent.getIntExtra("kids_minutes",60);
        if(live)liveMuted=getSharedPreferences("alezz_v11_player",MODE_PRIVATE)
            .getBoolean("live_mute_"+profile,false);
        if(live){
            String chosen=intent.getStringExtra("channel_group");
            if(chosen!=null&&!chosen.trim().isEmpty())activeGroup=chosen;
            try{
                JSONArray list=new JSONArray(intent.getStringExtra("channel_playlist")==null
                    ? "[]" : intent.getStringExtra("channel_playlist"));
                for(int i=0;i<list.length() && i<160;i++){
                    JSONObject channel=list.optJSONObject(i);
                    if(channel!=null && !StreamQuality.parse(channel.optString("url"),
                        channel.optString("quality"),channel.optJSONArray("variants")==null
                            ? "[]" : channel.optJSONArray("variants").toString()).isEmpty())
                        tvChannels.add(channel);
                }
                tvChannelIndex=Math.max(0,Math.min(tvChannels.size()-1,
                    intent.getIntExtra("channel_start",0)));
            }catch(Exception error){Log.w("AlEzzTV","TV guide unavailable",error);}
        }
        if(!live){
            mediaKind=intent.getStringExtra("media_kind")==null?"movie":intent.getStringExtra("media_kind");
            try{
                JSONArray items=new JSONArray(intent.getStringExtra("media_playlist")==null
                    ?"[]" : intent.getStringExtra("media_playlist"));
                for(int i=0;i<items.length() && i<100;i++){
                    JSONObject candidate=items.optJSONObject(i);
                    if(candidate!=null && !StreamQuality.parse(candidate.optString("url"),
                        candidate.optString("quality"),candidate.optJSONArray("variants")==null
                        ?"[]" : candidate.optJSONArray("variants").toString()).isEmpty())
                        mediaPlaylist.add(candidate);
                }
                if(!mediaPlaylist.isEmpty())mediaIndex=Math.max(0,Math.min(
                    mediaPlaylist.size()-1,intent.getIntExtra("media_start",0)));
            }catch(Exception error){Log.w("AlEzzTV","Unable to load media playlist",error);}
        }
        String url=intent.getStringExtra("stream_url");
        sources=StreamQuality.parse(url,intent.getStringExtra("quality"),intent.getStringExtra("stream_variants"));
        FrameLayout root=new FrameLayout(this);rootFrame=root;root.setBackgroundColor(Color.BLACK);
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
        if(live){
            liveHud=txt("● LIVE  •  العز TV",18,WHITE,true);
            liveHud.setPadding(dp(19),dp(11),dp(19),dp(11));
            liveHud.setBackgroundDrawable(GlassSurface.overlay(0xC7E5C78D,dp(12)));
            liveHud.setMaxWidth(Math.max(dp(260),getResources().getDisplayMetrics().widthPixels*62/100));
            liveHud.setVisibility(View.GONE);
            FrameLayout.LayoutParams hudParams=new FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.RIGHT);
            hudParams.topMargin=dp(26);hudParams.rightMargin=dp(26);
            root.addView(liveHud,hudParams);
        }
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);
        controlPanel=panel;
        panel.setPadding(dp(22),dp(13),dp(22),dp(13));
        panel.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{0xD6334055,0xE9111929}));
        FrameLayout.LayoutParams pp=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        root.addView(panel,pp);
        title=txt("▶ "+itemTitle,21,WHITE,true);panel.addView(title);
        details=txt(live?"● بث مباشر":"فيلم / حلقة",12,MUTED,false);panel.addView(details);
        status=txt("جاري تجهيز مشغّل الفيديو...",13,0xFFFFBCC6,false);
        LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,-2);
        sp.topMargin=dp(7);panel.addView(status,sp);
        HorizontalScrollView controlsScroll=new HorizontalScrollView(this);
        controlsScroll.setHorizontalScrollBarEnabled(false);
        controlsScroll.setFillViewport(true);
        footer=new LinearLayout(this);footer.setGravity(Gravity.CENTER_VERTICAL);
        controlsScroll.addView(footer,new HorizontalScrollView.LayoutParams(-2,-1));
        LinearLayout.LayoutParams fp=new LinearLayout.LayoutParams(-1,dp(55));
        fp.topMargin=dp(8);panel.addView(controlsScroll,fp);
        playButton=live?tvTool("⏯","تشغيل أو إيقاف مؤقت"):button("▶ تشغيل / إيقاف");
        footer.addView(playButton,new LinearLayout.LayoutParams(dp(live?69:138),-1));
        playButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            if(engine==null)return;
            if(engine.getPlaybackState()==Player.STATE_IDLE){attempted.clear();tries=0;playSource(index);}
            else if(engine.isPlaying())engine.pause();else engine.play();
        }});
        Button retryButton=live?tvTool("↻","إعادة الاتصال"):button("↻ إعادة");
        footer.addView(retryButton,new LinearLayout.LayoutParams(dp(live?69:138),-1));
        retryButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            attempted.clear();tries=0;playSource(index);
        }});
        qualityButton=live?tvTool("⚙","جودة البث"):button("الجودة");
        footer.addView(qualityButton,new LinearLayout.LayoutParams(dp(live?69:138),-1));
        qualityButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showQualityMenu();}});
        externalButton=button("مشغل بديل");
        if(!live)footer.addView(externalButton,new LinearLayout.LayoutParams(dp(138),-1));
        externalButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){external();}});
        Button guideButton=live?tvTool("☷","دليل القنوات"):button("☷ المكتبة");
        footer.addView(guideButton,new LinearLayout.LayoutParams(dp(live?69:140),-1));
        guideButton.setEnabled((live && !tvChannels.isEmpty())||(!live&&!mediaPlaylist.isEmpty()));
        guideButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showContentGuide();}});
        if(live){
            liveFavoriteButton=tvTool("☆","إضافة القناة للمفضلة");
            footer.addView(liveFavoriteButton,new LinearLayout.LayoutParams(dp(69),-1));
            liveFavoriteButton.setOnClickListener(new View.OnClickListener(){
                public void onClick(View v){toggleLiveFavorite();}
            });
            updateLiveFavorite();
            liveMuteButton=tvTool("♫","كتم الصوت");
            footer.addView(liveMuteButton,new LinearLayout.LayoutParams(dp(69),-1));
            liveMuteButton.setOnClickListener(new View.OnClickListener(){
                public void onClick(View v){toggleLiveMute();}
            });
            updateLiveMute();
            Button options=tvTool("⋮","المزيد من خيارات التلفزيون");
            footer.addView(options,new LinearLayout.LayoutParams(dp(69),-1));
            options.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showLiveOptions();}});
        }
        Button audioButton=live?tvTool("≋","الصوت والترجمة"):button("♫ صوت / ترجمة");
        footer.addView(audioButton,new LinearLayout.LayoutParams(dp(live?69:146),-1));
        audioButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showTrackMenu();}});
        Button screenButton=live?tvTool("⛶","أبعاد الشاشة"):button("▣ الشاشة");
        footer.addView(screenButton,new LinearLayout.LayoutParams(dp(live?69:135),-1));
        screenButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){cycleAspectRatio();}});
        Button speedButton=button("⏩ السرعة");
        if(!live)footer.addView(speedButton,new LinearLayout.LayoutParams(dp(135),-1));
        speedButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showSpeedMenu();}});
        backButton=live?tvTool("✕","العودة للقائمة الرئيسية"):button("رجوع");
        footer.addView(backButton,new LinearLayout.LayoutParams(dp(live?69:138),-1));
        backButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){finish();}});
        buildSideRails(root);
        if(live)showLiveHud("● البث المباشر  •  "+itemTitle+"\nOK: التحكم    MENU: دليل القنوات    CH±: تغيير");
        handler.postDelayed(progressTick,9000L);
        if(sources.isEmpty()){
            status.setText("لا يوجد رابط MP4/HLS صالح لهذا العنوان. يرجى تحديثه في لوحة الإدارة.");
            showControls(true);
            externalButton.setEnabled(false);backButton.requestFocus();return;
        }
        JSONObject previous=PlaybackMemory.entry(this,profile,itemId);
        String preferred=previous==null
            ?("family".equals(profile)?
                getSharedPreferences("alezz_v11_player",MODE_PRIVATE).getString("quality_"+itemId,"auto"):"auto")
            :previous.optString("quality","auto");
        index=StreamQuality.choose(sources,preferred,Build.VERSION.SDK_INT);
        if(index<0)index=0;
        initPlayer();playSource(index);
        if(live)hideControls();else showControls(true);
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
        // A conservative buffer profile for low-memory Android 4.4 TVs, larger on newer devices.
        boolean kitkat=Build.VERSION.SDK_INT<=19;
        com.google.android.exoplayer2.DefaultLoadControl loadControl=
            new com.google.android.exoplayer2.DefaultLoadControl.Builder()
            .setBufferDurationsMs(kitkat?12000:22000,kitkat?35000:70000,
                1200,kitkat?3500:5000)
            .build();
        engine=new ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(data)).build();
        if(live)engine.setVolume(liveMuted?0f:1f);
        handler.removeCallbacks(liveHealth);
        handler.postDelayed(liveHealth,5000L);
        engine.addListener(new Player.Listener(){
            @Override public void onPlaybackStateChanged(int state){
                if(state==Player.STATE_BUFFERING){
                    status.setText("◌ جاري تحميل الفيديو... اضغط رجوع للخروج");started=false;
                    handler.removeCallbacks(watchdog);
                    handler.postDelayed(watchdog,22000L);
                    if(live)hideControls();else showControls(false);
                }else if(state==Player.STATE_READY){
                    handler.removeCallbacks(watchdog);started=true;tries=0;
                    if(live)PlaybackMemory.lastChannel(CinemaPlayerActivity.this,profile,itemId);
                    updateSkipButton();
                    status.setText(live?"● البث المباشر يعمل":"▶ الفيديو جاهز • OK أو اللمس لعرض القوائم");
                    handler.removeCallbacks(autoHide);
                    handler.postDelayed(autoHide,1200L);
                    details.setText((live ? "● القناة "+(tvChannelIndex+1)+" / "+tvChannels.size()
                        : "سينما العز • جودة تلقائية")+"   |  "+sources.get(index).label);
                }else if(state==Player.STATE_ENDED){
                    if(!live){
                        PlaybackMemory.remove(CinemaPlayerActivity.this,profile,itemId);
                        getSharedPreferences("alezz_v11_player",MODE_PRIVATE)
                            .edit().remove("position_"+itemId).apply();
                    }
                    if(!live && "episode".equals(mediaKind) &&
                       getSharedPreferences("alezz_tv_settings_v14",MODE_PRIVATE).getBoolean("auto_next",true) &&
                       mediaIndex>=0 && mediaIndex+1<mediaPlaylist.size()){
                        switchMedia(mediaIndex+1);
                    }else{
                        status.setText("انتهى الفيديو. اختر رجوع أو جودة أخرى.");
                        showControls(true);
                    }
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
                if((reason.contains("NETWORK")||reason.contains("HTTP")||reason.contains("IO"))
                    &&tries==0){
                    tries=1;
                    status.setText("فقد الاتصال بالمصدر. محاولة ثانية ثم خفض الجودة إن لزم...");
                    final int oldIndex=index;
                    handler.postDelayed(new Runnable(){public void run(){
                        if(!isFinishing()&&engine!=null)playSource(oldIndex);
                    }},1800L);
                }else tryNextOrExplain(explanation);
            }
        });
        surface.setPlayer(engine);
    }
    private void tryNextOrExplain(String explanation){
        handler.removeCallbacks(watchdog);
        int lower=StreamQuality.lower(sources,index);
        if(lower>=0&&!attempted.contains(lower)){
            status.setText("تعذر تشغيل الجودة الحالية؛ تجربة جودة أقل...");
            tries=0;playSource(lower);return;
        }
        for(int offset=1;offset<=sources.size();offset++){
            int next=(index+offset)%sources.size();
            if(!attempted.contains(next)){
                status.setText("تجربة رابط أو جودة بديلة معتمدة...");
                tries=0;playSource(next);return;
            }
        }
        status.setText("رمز العطل: "+explanation+" — انتهت المحاولات والجودات المتاحة. راجع الرابط من لوحة الإدارة.");
        showControls(true);
        footer.setVisibility(View.VISIBLE);
        externalButton.requestFocus();
    }
    private void playSource(int which){
        if(which<0||which>=sources.size()||engine==null)return;
        index=which;currentUrl=sources.get(which).url;
        frozenTicks=0;lastLivePlayhead=-1;
        attempted.add(which);
        started=false;handler.removeCallbacks(watchdog);
        final int token=++requestToken;
        final String stream=currentUrl;
        if(live){
            qualityButton.setText("⚙");
            qualityButton.setContentDescription("جودة البث: "+sources.get(which).label);
        }else qualityButton.setText("الجودة: "+sources.get(which).label);
        status.setText("◌ فحص رابط الفيديو قبل التشغيل...");
        if(live)hideControls();else showControls(false);
        // The live catalog already restricts sources to rights-approved direct HTTPS media.
        // Don't block every remote-arrow change on a separate HTTP preflight request.
        // ExoPlayer validates the response and preserves the existing error/fallback path.
        if(live && StreamQuality.isDirectUrl(stream)){
            try{
                String path=stream.split("[?#]",2)[0].toLowerCase(Locale.US);
                MediaItem.Builder item=new MediaItem.Builder().setUri(Uri.parse(stream));
                if(path.endsWith(".m3u8"))item.setMimeType("application/x-mpegURL");
                else if(path.endsWith(".mpd"))item.setMimeType("application/dash+xml");
                else if(path.endsWith(".ts"))item.setMimeType("video/mp2t");
                lastSourceHint="البث المباشر: جارٍ التحقق من اتصال القناة";
                status.setText("◌ جارٍ فتح القناة مباشرة…");
                engine.setMediaItem(item.build());
                engine.prepare();
                engine.play();
                handler.postDelayed(watchdog,22000L);
            }catch(Exception immediateError){
                Log.w("AlEzzTV","Unable to tune direct live source",immediateError);
                tryNextOrExplain("تعذرت تهيئة القناة مباشرة.");
            }
            return;
        }
        probeWorker.execute(new Runnable(){public void run(){
            if(token!=requestToken||Thread.currentThread().isInterrupted())return;
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
                    long saved=PlaybackMemory.position(CinemaPlayerActivity.this,profile,itemId);
                    if(saved<=0&&"family".equals(profile))
                        saved=getSharedPreferences("alezz_v11_player",MODE_PRIVATE).getLong("position_"+itemId,0L);
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

    private void saveProgress(){
        if(engine==null||live||itemId==null||itemId.isEmpty())return;
        try{
            long position=Math.max(0L,engine.getCurrentPosition());
            long duration=Math.max(0L,engine.getDuration());
            String quality=(sources!=null&&index>=0&&index<sources.size())?sources.get(index).label:"auto";
            PlaybackMemory.save(this,profile,itemId,mediaKind,seriesId,itemTitle,position,duration,quality);
        }catch(Exception ignored){}
    }
    private void setRailsVisible(boolean visible){
        railVisible=visible;
        if(leftRail!=null)leftRail.setVisibility(visible&&live?View.VISIBLE:View.GONE);
        if(rightRail!=null)rightRail.setVisibility(visible?View.VISIBLE:View.GONE);
    }
    /** Left channels: category filter and EPG. Right controls: next, fullscreen, intro, tracks. */
    private void buildSideRails(FrameLayout root){
        final int screen=getResources().getDisplayMetrics().widthPixels;
        int leftWidth=Math.min(dp(340),Math.max(dp(200),screen*31/100));
        int rightWidth=Math.min(dp(215),Math.max(dp(140),screen*20/100));
        leftRail=new LinearLayout(this);leftRail.setOrientation(LinearLayout.VERTICAL);
        leftRail.setPadding(dp(9),dp(15),dp(9),dp(8));
        leftRail.setBackgroundDrawable(new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,new int[]{0xEB0A111F,0xD737435C}));
        root.addView(leftRail,new FrameLayout.LayoutParams(leftWidth,-1,Gravity.LEFT));
        rightRail=new LinearLayout(this);rightRail.setOrientation(LinearLayout.VERTICAL);
        rightRail.setPadding(dp(7),dp(14),dp(7),dp(10));
        rightRail.setBackgroundDrawable(new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,new int[]{0xD737435C,0xEB0A111F}));
        root.addView(rightRail,new FrameLayout.LayoutParams(rightWidth,-1,Gravity.RIGHT));
        TextView heading=txt("العز TV  •  تحكم",17,WHITE,true);
        heading.setGravity(Gravity.CENTER);
        rightRail.addView(heading,new LinearLayout.LayoutParams(-1,dp(58)));
        Button fullscreen=button("⛶ عرض كامل");
        rightRail.addView(fullscreen,new LinearLayout.LayoutParams(-1,dp(53)));
        fullscreen.setOnClickListener(new View.OnClickListener(){public void onClick(View v){hideControls();}});
        if(!live){
            Button next=button("⏭ الحلقة التالية");
            next.setEnabled("episode".equals(mediaKind)&&mediaIndex>=0&&mediaIndex+1<mediaPlaylist.size());
            rightRail.addView(next,new LinearLayout.LayoutParams(-1,dp(54)));
            next.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                saveProgress();switchMedia(mediaIndex+1);showControls(false);
            }});
            skipIntroButton=button("⏭ تخطي المقدمة");
            rightRail.addView(skipIntroButton,new LinearLayout.LayoutParams(-1,dp(52)));
            skipIntroButton.setVisibility(View.GONE);
            skipIntroButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                skipMarkedSegment();
            }});
            Button edit=button("✎ المقدمة / الملخص");
            edit.setEnabled("episode".equals(mediaKind));
            rightRail.addView(edit,new LinearLayout.LayoutParams(-1,dp(53)));
            edit.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                configureSegments();
            }});
        }else{
            Button channelUp=button("▲ القناة التالية");
            rightRail.addView(channelUp,new LinearLayout.LayoutParams(-1,dp(54)));
            channelUp.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                stepChannel(1);
            }});
            Button channelDown=button("▼ القناة السابقة");
            rightRail.addView(channelDown,new LinearLayout.LayoutParams(-1,dp(54)));
            channelDown.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                stepChannel(-1);
            }});
            Button guide=button("☷ قائمة القنوات");
            rightRail.addView(guide,new LinearLayout.LayoutParams(-1,dp(54)));
            guide.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                showChannelGuide();
            }});
        }
        Button quality=button("⚙ الجودة");
        rightRail.addView(quality,new LinearLayout.LayoutParams(-1,dp(52)));
        quality.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showQualityMenu();}});
        Button tracks=button("♫ صوت وترجمة");
        rightRail.addView(tracks,new LinearLayout.LayoutParams(-1,dp(52)));
        tracks.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showTrackMenu();}});
        Button close=button("✕ إخفاء القوائم");
        rightRail.addView(close,new LinearLayout.LayoutParams(-1,dp(52)));
        close.setOnClickListener(new View.OnClickListener(){public void onClick(View v){hideControls();}});
        // Build the guide only after the user requests it; start live video first.
        setRailsVisible(false);
    }
    private String groupFor(JSONObject row){
        return ChannelGuideCategory.from(row);
    }
    private void focusGuideChannel(){
        Button next=guideSelectedButton!=null?guideSelectedButton:guideFirstButton;
        if(next!=null)next.requestFocus();
    }
    /** Accessible categorized channel drawer, rebuilt only when it is opened or filtered. */
    private void updateChannelRail(){
        if(!live||leftRail==null)return;
        leftRail.removeAllViews();
        guideSelectedButton=null;guideFirstButton=null;
        TextView title=txt("☷  دليل قنوات العز TV",19,WHITE,true);
        title.setGravity(Gravity.CENTER);
        leftRail.addView(title,new LinearLayout.LayoutParams(-1,dp(46)));
        final java.util.LinkedHashMap<String,Integer> counts=new java.util.LinkedHashMap<String,Integer>();
        for(String name:new String[]{"أخبار","رياضة","أفلام","مسلسلات","أطفال",
                "وثائقيات","دينية","موسيقى","تعليمية","طبخ","منوعات","عامة"})
            counts.put(name,0);
        int favorites=0;
        for(JSONObject c:tvChannels){
            String group=groupFor(c);
            counts.put(group,counts.containsKey(group)?counts.get(group)+1:1);
            if(c.optBoolean("favorite",false))favorites++;
        }
        java.util.LinkedHashSet<String> groups=new java.util.LinkedHashSet<String>();
        groups.add("الكل");
        if(favorites>0)groups.add("المفضلة");
        for(java.util.Map.Entry<String,Integer> item:counts.entrySet())
            if(item.getValue()>0)groups.add(item.getKey());
        if(!groups.contains(activeGroup))activeGroup="الكل";
        HorizontalScrollView types=new HorizontalScrollView(this);
        types.setHorizontalScrollBarEnabled(false);
        leftRail.addView(types,new LinearLayout.LayoutParams(-1,dp(51)));
        LinearLayout horizontal=new LinearLayout(this);
        horizontal.setOrientation(LinearLayout.HORIZONTAL);types.addView(horizontal);
        for(final String group:groups){
            int groupSize="الكل".equals(group)?tvChannels.size():
                "المفضلة".equals(group)?favorites:counts.get(group);
            Button filter=button((group.equals(activeGroup)?"● ":"")+group+"  "+groupSize);
            filter.setTextSize(12);
            filter.setContentDescription("تصنيف "+group+"، "+groupSize+" قناة");
            horizontal.addView(filter,new LinearLayout.LayoutParams(dp(127),dp(46)));
            filter.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                activeGroup=group;
                updateChannelRail();
                if(leftRail!=null)leftRail.setVisibility(View.VISIBLE);
                focusGuideChannel();
            }});
        }
        int shown=0;
        for(JSONObject row:tvChannels)if(matchesGroup(row))shown++;
        TextView subtitle=txt(activeGroup+"  •  "+shown+" قناة    |    ↑↓ اختيار    OK مشاهدة",12,MUTED,false);
        subtitle.setPadding(dp(9),dp(5),dp(9),dp(9));
        leftRail.addView(subtitle,new LinearLayout.LayoutParams(-1,dp(39)));
        channelsScroll=new ScrollView(this);
        channelsScroll.setVerticalScrollBarEnabled(false);
        leftRail.addView(channelsScroll,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);
        channelsScroll.addView(list);
        for(int i=0;i<tvChannels.size();i++){
            JSONObject item=tvChannels.get(i);
            if(!matchesGroup(item))continue;
            final int position=i;
            String name=item.optString("title","قناة");
            String now=item.optString("epg_now_title","");
            String next=item.optString("epg_next_title","");
            String line=String.format(Locale.US,"%03d  •  %s",i+1,name);
            if(!now.isEmpty())line+="\nالآن: "+now;
            else line+="\n"+groupFor(item);
            if(!next.isEmpty())line+="    التالي: "+next;
            final int height=now.isEmpty()&&next.isEmpty()?68:86;
            LinearLayout card=new LinearLayout(this);
            card.setOrientation(LinearLayout.HORIZONTAL);
            card.setGravity(Gravity.CENTER_VERTICAL);
            card.setPadding(dp(6),dp(3),dp(6),dp(3));
            ImageView logo=new ImageView(this);
            logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
            logo.setBackgroundDrawable(shape(0xFF212A38,0));
            String poster=item.optString("poster_url","");
            if(poster.startsWith("https://"))PosterLoader.load(logo,poster);
            card.addView(logo,new LinearLayout.LayoutParams(dp(53),dp(48)));
            Button channel=button((i==tvChannelIndex?"▶ ":"")+line);
            channel.setAllCaps(false);
            channel.setTextSize(13);
            channel.setGravity(Gravity.CENTER_VERTICAL|Gravity.RIGHT);
            channel.setPadding(dp(12),0,dp(12),0);
            if(i==tvChannelIndex)channel.setBackgroundDrawable(shape(0xFF4A3B26,0xFFE6BE77));
            card.addView(channel,new LinearLayout.LayoutParams(0,dp(height-7),1));
            list.addView(card,new LinearLayout.LayoutParams(-1,dp(height)));
            if(guideFirstButton==null)guideFirstButton=channel;
            if(i==tvChannelIndex)guideSelectedButton=channel;
            channel.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                switchChannel(position);
                hideControls();
            }});
        }
        if(shown==0)list.addView(txt("لا توجد قنوات في هذا التصنيف",14,MUTED,false));
    }
    private void updateSkipButton(){
        if(skipIntroButton==null)return;
        if(engine==null||seriesId.isEmpty()||!"episode".equals(mediaKind)){
            skipIntroButton.setVisibility(View.GONE);return;
        }
        long pos=engine.getCurrentPosition();
        for(String type:new String[]{"intro","recap"}){
            long start=PlaybackMemory.segmentStart(this,profile,seriesId,type);
            long end=PlaybackMemory.segmentEnd(this,profile,seriesId,type);
            if(start>=0&&end>start&&pos>=start&&pos<end){
                skipIntroButton.setText("⏭ تخطي "+("intro".equals(type)?"المقدمة":"الملخص"));
                skipIntroButton.setVisibility(View.VISIBLE);return;
            }
        }
        skipIntroButton.setVisibility(View.GONE);
    }
    private void skipMarkedSegment(){
        if(engine==null)return;
        long pos=engine.getCurrentPosition();
        for(String type:new String[]{"intro","recap"}){
            long start=PlaybackMemory.segmentStart(this,profile,seriesId,type);
            long end=PlaybackMemory.segmentEnd(this,profile,seriesId,type);
            if(start>=0&&end>start&&pos>=start&&pos<end){
                engine.seekTo(end);updateSkipButton();return;
            }
        }
    }
    private void configureSegments(){
        if(engine==null||seriesId.isEmpty()){
            status.setText("حفظ المقدمة والملخص متاح لحلقات المسلسلات فقط.");return;
        }
        final String[] options={
            "حفظ بداية المقدمة عند هذه الدقيقة","حفظ نهاية المقدمة عند هذه الدقيقة",
            "حفظ بداية الملخص عند هذه الدقيقة","حفظ نهاية الملخص عند هذه الدقيقة",
            "مسح توقيت المقدمة","مسح توقيت الملخص"
        };
        new android.app.AlertDialog.Builder(this).setTitle("تحديد وقت المقدمة / الملخص محليًا")
            .setItems(options,new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface dialog,int which){
                    String type=which<2||which==4?"intro":"recap";
                    if(which<4){
                        PlaybackMemory.setSegmentEdge(CinemaPlayerActivity.this,
                            profile,seriesId,type,which%2==0?"start":"end",
                            engine.getCurrentPosition());
                    }else PlaybackMemory.clearSegment(CinemaPlayerActivity.this,profile,seriesId,type);
                    status.setText("تم حفظ أوقات "+("intro".equals(type)?"المقدمة":"الملخص")+" محليًا.");
                    updateSkipButton();showControls(false);
                }
            }).setNegativeButton("إلغاء",null).show();
    }
    private void showContentGuide(){
        if(live){showChannelGuide();return;}
        if(mediaPlaylist.isEmpty()){status.setText("قائمة التشغيل غير متاحة.");return;}
        String[] names=new String[mediaPlaylist.size()];
        for(int i=0;i<names.length;i++)
            names[i]=String.format(Locale.US,"%02d  •  %s",i+1,
                mediaPlaylist.get(i).optString("title","عنوان"));
        new android.app.AlertDialog.Builder(this).setTitle(
            "episode".equals(mediaKind)?"الحلقات":"الأفلام")
            .setSingleChoiceItems(names,mediaIndex,new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface dialog,int which){
                    dialog.dismiss();switchMedia(which);
                }
            }).setNegativeButton("إغلاق",null).show();
    }
    private void switchMedia(int next){
        if(next<0||next>=mediaPlaylist.size())return;
        saveProgress();
        mediaIndex=next;
        JSONObject selected=mediaPlaylist.get(mediaIndex);
        ArrayList<StreamQuality.Source> variants=StreamQuality.parse(
            selected.optString("url"),selected.optString("quality"),
            selected.optJSONArray("variants")==null?"[]":
                selected.optJSONArray("variants").toString());
        if(variants.isEmpty())return;
        itemId=selected.optString("id","");
        seriesId=selected.optString("series_id",seriesId);
        itemTitle=selected.optString("title","العز TV");
        sources=variants;
        JSONObject savedItem=PlaybackMemory.entry(this,profile,itemId);
        String quality=savedItem==null?"auto":savedItem.optString("quality","auto");
        index=StreamQuality.choose(sources,quality,Build.VERSION.SDK_INT);
        if(index<0)index=0;
        attempted.clear();tries=0;requestToken++;liveRestarts=0;frozenTicks=0;lastLivePlayhead=-1;
        title.setText("▶ "+itemTitle);
        updateSkipButton();
        details.setText(String.format(Locale.US,"%d / %d  •  %s",mediaIndex+1,
            mediaPlaylist.size(),"episode".equals(mediaKind)?"حلقات":"أفلام"));
        playSource(index);
    }
    private void showChannelGuide(){
        if(tvChannels.isEmpty()){status.setText("دليل القنوات غير متاح.");showControls(true);return;}
        updateChannelRail();
        handler.removeCallbacks(autoHide);
        if(controlPanel!=null)controlPanel.setVisibility(View.GONE);
        if(rightRail!=null)rightRail.setVisibility(View.GONE);
        if(leftRail!=null)leftRail.setVisibility(View.VISIBLE);
        railVisible=true;
        focusGuideChannel();
    }
    private void switchChannel(int position){
        if(tvChannels.isEmpty())return;
        tvChannelIndex=(position+tvChannels.size())%tvChannels.size();
        JSONObject selected=tvChannels.get(tvChannelIndex);
        ArrayList<StreamQuality.Source> next=StreamQuality.parse(selected.optString("url"),
            selected.optString("quality"),selected.optJSONArray("variants")==null?
                "[]" : selected.optJSONArray("variants").toString());
        if(next.isEmpty()){
            status.setText("القناة المختارة لا تملك رابط بث صالحًا.");showControls(true);return;
        }
        itemId=selected.optString("id","");
        itemTitle=selected.optString("title","قناة تلفزيونية");
        sources=next;
        String preferred=getSharedPreferences("alezz_v11_player",MODE_PRIVATE)
            .getString("quality_"+itemId,"auto");
        index=StreamQuality.choose(sources,preferred,Build.VERSION.SDK_INT);
        if(index<0)index=0;
        attempted.clear();tries=0;requestToken++;liveRestarts=0;frozenTicks=0;lastLivePlayhead=-1;
        title.setText(String.format(Locale.US,"● CH %03d  •  %s",tvChannelIndex+1,itemTitle));
        updateLiveFavorite();
        PlaybackMemory.lastChannel(this,profile,itemId);
        details.setText("بث مباشر • CH± للتنقل • اضغط MENU للدليل");
        String now=selected.optString("epg_now_title","");
        String nextTitle=selected.optString("epg_next_title","");
        showLiveHud(String.format(Locale.US,"● LIVE  •  CH %03d\n%s%s%s",tvChannelIndex+1,
            itemTitle,now.isEmpty()?"":"\nالآن: "+now,
            nextTitle.isEmpty()?"":"\nالتالي: "+nextTitle));
        if(leftRail!=null&&leftRail.getVisibility()==View.VISIBLE)updateChannelRail();
        playSource(index);
    }
    private void cycleAspectRatio(){
        if(surface==null)return;
        aspectMode=(aspectMode+1)%3;
        int mode=aspectMode==0?AspectRatioFrameLayout.RESIZE_MODE_FIT:
            aspectMode==1?AspectRatioFrameLayout.RESIZE_MODE_ZOOM:
                AspectRatioFrameLayout.RESIZE_MODE_FILL;
        surface.setResizeMode(mode);
        status.setText(aspectMode==0?"قياس الصورة: ملائم":aspectMode==1?
            "قياس الصورة: تكبير":"قياس الصورة: ملء الشاشة");
        showControls(true);
    }
    private ArrayList<String> trackLanguages(int type){
        LinkedHashSet<String> found=new LinkedHashSet<String>();
        if(engine==null)return new ArrayList<String>();
        Tracks tracks=engine.getCurrentTracks();
        for(Tracks.Group group:tracks.getGroups()){
            if(group.getType()!=type)continue;
            for(int i=0;i<group.length;i++){
                Format format=group.getTrackFormat(i);
                if(format.language!=null&&format.language.length()>0&&
                    !"und".equals(format.language))found.add(format.language);
            }
        }
        return new ArrayList<String>(found);
    }
    private void showTrackMenu(){
        if(engine==null)return;
        final ArrayList<String> audio=trackLanguages(C.TRACK_TYPE_AUDIO);
        final ArrayList<String> text=trackLanguages(C.TRACK_TYPE_TEXT);
        ArrayList<String> entries=new ArrayList<String>();
        entries.add("الصوت: تلقائي");
        for(String language:audio)entries.add("الصوت: "+language);
        entries.add("الترجمة: إيقاف");
        entries.add("الترجمة: تلقائي");
        for(String language:text)entries.add("الترجمة: "+language);
        final String[] labels=entries.toArray(new String[0]);
        final int audioCount=audio.size();
        new android.app.AlertDialog.Builder(this).setTitle("الصوت والترجمة • المسارات المتوفرة")
            .setItems(labels,new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface dialog,int which){
                    com.google.android.exoplayer2.trackselection.TrackSelectionParameters.Builder options=
                        engine.getTrackSelectionParameters().buildUpon();
                    if(which==0)options.setPreferredAudioLanguage(null);
                    else if(which<=audioCount)options.setPreferredAudioLanguage(audio.get(which-1));
                    else if(which==audioCount+1)options.setTrackTypeDisabled(C.TRACK_TYPE_TEXT,true);
                    else if(which==audioCount+2)
                        options.setTrackTypeDisabled(C.TRACK_TYPE_TEXT,false)
                            .setPreferredTextLanguage(null);
                    else options.setTrackTypeDisabled(C.TRACK_TYPE_TEXT,false)
                            .setPreferredTextLanguage(text.get(which-audioCount-3));
                    engine.setTrackSelectionParameters(options.build());
                    status.setText("تم تطبيق اختيار الصوت أو الترجمة إذا كان المصدر يوفّره.");
                    showControls(false);
                }
            }).setNegativeButton("إلغاء",null).show();
    }
    private void showSpeedMenu(){
        if(engine==null||live){status.setText("سرعة التشغيل متاحة للأفلام والحلقات فقط.");return;}
        final float[] rates={0.75f,1f,1.25f,1.5f,2f};
        String[] labels={"0.75×","1× عادي","1.25×","1.5×","2×"};
        new android.app.AlertDialog.Builder(this).setTitle("سرعة المشاهدة")
            .setItems(labels,new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface dialog,int which){
                    engine.setPlaybackSpeed(rates[which]);
                    status.setText("السرعة "+rates[which]+"×");
                    showControls(false);
                }
            }).show();
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
        if(live && !tvChannels.isEmpty()){
            if(code==KeyEvent.KEYCODE_CHANNEL_UP||code==KeyEvent.KEYCODE_MEDIA_NEXT){
                rapidZap(1,event);return true;
            }
            if(code==KeyEvent.KEYCODE_CHANNEL_DOWN||code==KeyEvent.KEYCODE_MEDIA_PREVIOUS){
                rapidZap(-1,event);return true;
            }
            if(code==KeyEvent.KEYCODE_MENU||code==KeyEvent.KEYCODE_GUIDE){
                if(leftRail!=null&&leftRail.getVisibility()==View.VISIBLE)hideControls();
                else showContentGuide();
                return true;
            }
            // Up/down always zap while watching, even during the short bottom HUD.
            // A visible guide or options rail keeps normal directional focus navigation.
            if((leftRail==null||leftRail.getVisibility()!=View.VISIBLE)&&
               (rightRail==null||rightRail.getVisibility()!=View.VISIBLE)){
                if(code==KeyEvent.KEYCODE_DPAD_UP){rapidZap(1,event);return true;}
                if(code==KeyEvent.KEYCODE_DPAD_DOWN){rapidZap(-1,event);return true;}
                if(controlPanel!=null&&controlPanel.getVisibility()!=View.VISIBLE){
                    if(code==KeyEvent.KEYCODE_DPAD_LEFT){showChannelGuide();return true;}
                    if(code==KeyEvent.KEYCODE_DPAD_RIGHT){showLiveOptions();return true;}
                }
            }
            int digit=code-KeyEvent.KEYCODE_0;
            if(digit>=0 && digit<=9){
                remoteNumber+=digit;
                if(remoteNumber.length()>3)remoteNumber=remoteNumber.substring(remoteNumber.length()-3);
                handler.removeCallbacks(commitRemoteNumber);
                status.setText("اختيار القناة "+remoteNumber+"...");
                showLiveHud("● اختيار رقم القناة  "+remoteNumber+"  …");
                handler.postDelayed(commitRemoteNumber,1250L);
                return true;
            }
            if((code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_ENTER)
                &&remoteNumber.length()>0){
                handler.removeCallbacks(commitRemoteNumber);commitRemoteNumber.run();return true;
            }
        }
        if(!live && !mediaPlaylist.isEmpty()){
            if(code==KeyEvent.KEYCODE_MEDIA_NEXT){
                switchMedia((mediaIndex+1)%mediaPlaylist.size());return true;
            }
            if(code==KeyEvent.KEYCODE_MEDIA_PREVIOUS){
                switchMedia((mediaIndex-1+mediaPlaylist.size())%mediaPlaylist.size());return true;
            }
            if(code==KeyEvent.KEYCODE_MENU||code==KeyEvent.KEYCODE_GUIDE){
                showContentGuide();return true;
            }
        }
        if(code==KeyEvent.KEYCODE_CAPTIONS){showTrackMenu();return true;}
        if(code==KeyEvent.KEYCODE_BACK && live &&
            ((leftRail!=null&&leftRail.getVisibility()==View.VISIBLE)||
             (rightRail!=null&&rightRail.getVisibility()==View.VISIBLE))){
            hideControls();return true;
        }
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
    @Override protected void onResume(){
        super.onResume();
        if(kidsPlayback){handler.removeCallbacks(kidsClock);handler.postDelayed(kidsClock,1000L);}
    }
    @Override protected void onPause(){
        handler.removeCallbacks(kidsClock);
        handler.removeCallbacks(autoHide);
        handler.removeCallbacks(hideLiveHud);
        handler.removeCallbacks(commitRemoteNumber);
        if(engine!=null){
            if(!live && itemId.length()>0)saveProgress();
            engine.pause();
        }
        super.onPause();
    }
    @Override protected void onDestroy(){
        handler.removeCallbacks(liveHealth);
        saveProgress();requestToken++;probeWorker.shutdownNow();handler.removeCallbacksAndMessages(null);
        if(surface!=null)surface.setPlayer(null);
        if(engine!=null){engine.release();engine=null;}
        super.onDestroy();
    }
}
