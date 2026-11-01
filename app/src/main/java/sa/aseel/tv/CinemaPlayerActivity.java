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
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
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
        if(live){
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
        HorizontalScrollView controlsScroll=new HorizontalScrollView(this);
        controlsScroll.setHorizontalScrollBarEnabled(false);
        controlsScroll.setFillViewport(true);
        footer=new LinearLayout(this);footer.setGravity(Gravity.CENTER_VERTICAL);
        controlsScroll.addView(footer,new HorizontalScrollView.LayoutParams(-2,-1));
        LinearLayout.LayoutParams fp=new LinearLayout.LayoutParams(-1,dp(55));
        fp.topMargin=dp(8);panel.addView(controlsScroll,fp);
        playButton=button("▶ تشغيل / إيقاف");
        footer.addView(playButton,new LinearLayout.LayoutParams(dp(138),-1));
        playButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            if(engine==null)return;
            if(engine.getPlaybackState()==Player.STATE_IDLE){attempted.clear();tries=0;playSource(index);}
            else if(engine.isPlaying())engine.pause();else engine.play();
        }});
        Button retryButton=button("↻ إعادة");
        footer.addView(retryButton,new LinearLayout.LayoutParams(dp(138),-1));
        retryButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            attempted.clear();tries=0;playSource(index);
        }});
        qualityButton=button("الجودة");
        footer.addView(qualityButton,new LinearLayout.LayoutParams(dp(138),-1));
        qualityButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showQualityMenu();}});
        externalButton=button("مشغل بديل");
        footer.addView(externalButton,new LinearLayout.LayoutParams(dp(138),-1));
        externalButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){external();}});
        Button guideButton=button(live?"☷ القنوات":"☷ المكتبة");
        footer.addView(guideButton,new LinearLayout.LayoutParams(dp(140),-1));
        guideButton.setEnabled((live && !tvChannels.isEmpty())||(!live&&!mediaPlaylist.isEmpty()));
        guideButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showContentGuide();}});
        Button audioButton=button("♫ صوت / ترجمة");
        footer.addView(audioButton,new LinearLayout.LayoutParams(dp(146),-1));
        audioButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showTrackMenu();}});
        Button screenButton=button("▣ الشاشة");
        footer.addView(screenButton,new LinearLayout.LayoutParams(dp(135),-1));
        screenButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){cycleAspectRatio();}});
        Button speedButton=button("⏩ السرعة");
        footer.addView(speedButton,new LinearLayout.LayoutParams(dp(135),-1));
        speedButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showSpeedMenu();}});
        backButton=button("رجوع");
        footer.addView(backButton,new LinearLayout.LayoutParams(dp(138),-1));
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
                    details.setText((live ? "● القناة "+(tvChannelIndex+1)+" / "+tvChannels.size()
                        : "سينما العز • جودة تلقائية")+"   |  "+sources.get(index).label);
                }else if(state==Player.STATE_ENDED){
                    if(!live && "episode".equals(mediaKind) &&
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
        if(engine!=null && itemId.length()>0 && engine.getDuration()>0){
            getSharedPreferences("alezz_v11_player",MODE_PRIVATE).edit()
                .putLong("position_"+itemId,Math.max(0,engine.getCurrentPosition())).apply();
        }
        mediaIndex=next;
        JSONObject selected=mediaPlaylist.get(mediaIndex);
        ArrayList<StreamQuality.Source> variants=StreamQuality.parse(
            selected.optString("url"),selected.optString("quality"),
            selected.optJSONArray("variants")==null?"[]":
                selected.optJSONArray("variants").toString());
        if(variants.isEmpty())return;
        itemId=selected.optString("id","");
        itemTitle=selected.optString("title","العز TV");
        sources=variants;index=StreamQuality.choose(sources,"auto",Build.VERSION.SDK_INT);
        if(index<0)index=0;
        attempted.clear();tries=0;requestToken++;
        title.setText("▶ "+itemTitle);
        details.setText(String.format(Locale.US,"%d / %d  •  %s",mediaIndex+1,
            mediaPlaylist.size(),"episode".equals(mediaKind)?"حلقات":"أفلام"));
        playSource(index);
    }
    private void showChannelGuide(){
        if(tvChannels.isEmpty()){status.setText("دليل القنوات غير متاح لهذا البث.");showControls(true);return;}
        String[] labels=new String[tvChannels.size()];
        for(int i=0;i<labels.length;i++)
            labels[i]=String.format(Locale.US,"%03d  •  %s",i+1,
                tvChannels.get(i).optString("title","قناة"));
        new android.app.AlertDialog.Builder(this).setTitle("دليل قنوات العز TV")
            .setSingleChoiceItems(labels,tvChannelIndex,new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface dialog,int which){
                    dialog.dismiss();switchChannel(which);
                }
            }).setNegativeButton("رجوع",null).show();
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
        sources=next;index=StreamQuality.choose(sources,"auto",Build.VERSION.SDK_INT);
        if(index<0)index=0;
        attempted.clear();tries=0;requestToken++;
        title.setText(String.format(Locale.US,"● CH %03d  •  %s",tvChannelIndex+1,itemTitle));
        details.setText("بث مباشر • CH± للتنقل • اضغط MENU للدليل");
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
                switchChannel(tvChannelIndex+1);return true;
            }
            if(code==KeyEvent.KEYCODE_CHANNEL_DOWN||code==KeyEvent.KEYCODE_MEDIA_PREVIOUS){
                switchChannel(tvChannelIndex-1);return true;
            }
            if(code==KeyEvent.KEYCODE_MENU||code==KeyEvent.KEYCODE_GUIDE){
                showContentGuide();return true;
            }
            int digit=code-KeyEvent.KEYCODE_0;
            if(digit>=0 && digit<=9){
                remoteNumber+=digit;
                if(remoteNumber.length()>3)remoteNumber=remoteNumber.substring(remoteNumber.length()-3);
                handler.removeCallbacks(commitRemoteNumber);
                status.setText("اختيار القناة "+remoteNumber+"...");
                showControls(false);
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
        handler.removeCallbacks(commitRemoteNumber);
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
