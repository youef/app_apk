package sa.aseel.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import java.util.ArrayList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.content.Intent;
import android.os.Bundle;
import android.os.Build;
import android.util.Log;
import android.os.Handler;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.VideoView;

/** Native VideoView player: MP4/H.264/AAC preferred; HLS is device dependent. */
public final class PlayerActivity extends Activity {
    private VideoView video;
    private LinearLayout controlsPanel;
    private TextView title,error,clock,streamStatus;
    private Button qualityButton;
    private ArrayList<StreamQuality.Source> sources=new ArrayList<StreamQuality.Source>();
    private int sourceIndex=0,pendingSeekMs=0,retries=0,lastTickPosition=-1,stallTicks=0;
    private long bufferingStarted=0L;
    private boolean live=false,manualPause=false,changingSource=false;
    private ProgressBar progress;
    private final Handler handler=new Handler();
    private final Runnable hideOverlay=new Runnable(){public void run(){
        if(ready && video!=null && video.isPlaying() && controlsPanel!=null)
            controlsPanel.setVisibility(View.INVISIBLE);
    }};
    private void revealControls(){
        if(controlsPanel!=null)controlsPanel.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideOverlay);
        if(ready)handler.postDelayed(hideOverlay,9000);
    }
    private String id, nextUrl, nextId, nextTitle, currentUrl, officialUrl;
    private boolean ready=false;
    private LegacyStreamProxy mediaProxy;
    private String playerMode="native";
    private final Runnable tick=new Runnable(){
        public void run(){
            if(video!=null && ready){
                try{
                    int dur=video.getDuration(),pos=video.getCurrentPosition();
                    if(dur>0&&!live){progress.setMax(dur);progress.setProgress(pos);}
                    clock.setText(live?"● بث مباشر":format(pos)+" / "+format(dur));
                    if(!live)savePosition(pos);
                    if(!manualPause && !live && dur>0 && pos<dur-9000 && video.isPlaying()){
                        if(pos>0 && pos==lastTickPosition)stallTicks++;
                        else stallTicks=0;
                        lastTickPosition=pos;
                    } else {stallTicks=0;lastTickPosition=pos;}
                    if(!manualPause && ((bufferingStarted>0 && android.os.SystemClock.elapsedRealtime()-bufferingStarted>18000)
                        || stallTicks>=12))recover("تأخر البث أكثر من 18 ثانية");
                }catch(Exception ignored){}
            }
            handler.postDelayed(this,1500);
        }
    };
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        id=getIntent().getStringExtra("item_id");
        if(id==null)id="unknown";
        final String url=getIntent().getStringExtra("stream_url");
        currentUrl=url;
        live=getIntent().getBooleanExtra("is_live",false);
        sources=StreamQuality.parse(url,getIntent().getStringExtra("quality"),getIntent().getStringExtra("stream_variants"));
        String preferred=getSharedPreferences("aseel_user_v2",MODE_PRIVATE).getString("quality_item_"+id,
             getSharedPreferences("aseel_user_v2",MODE_PRIVATE).getString("quality_pref","auto"));
        int chosen=StreamQuality.choose(sources,preferred,Build.VERSION.SDK_INT);
        if(chosen>=0){sourceIndex=chosen;currentUrl=sources.get(chosen).url;}
        officialUrl=getIntent().getStringExtra("official_url");
        nextUrl=getIntent().getStringExtra("next_url");
        nextId=getIntent().getStringExtra("next_item_id");
        nextTitle=getIntent().getStringExtra("next_title");
        FrameLayout root=new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        video=new VideoView(this);
        root.addView(video,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout panel=new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.setPadding(dp(28),dp(12),dp(28),dp(12));
        panel.setBackgroundColor(Color.argb(205,8,18,34));
        FrameLayout.LayoutParams pp=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        root.addView(panel,pp);
        controlsPanel=panel;
        title=new TextView(this);
        title.setText(getIntent().getStringExtra("title"));
        title.setTextSize(22);title.setTextColor(0xFFF2D6A0);
        panel.addView(title);
        streamStatus=new TextView(this);
        streamStatus.setTextColor(0xFFACDCC6);
        streamStatus.setTextSize(13);
        streamStatus.setText("التحميل الآمن • "+(sources.size()>0?sources.get(sourceIndex).label:"المصدر الأصلي"));
        panel.addView(streamStatus);
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        panel.addView(progress,new LinearLayout.LayoutParams(-1,dp(6)));
        if(live)progress.setVisibility(View.GONE);
        clock=new TextView(this);clock.setText("00:00 / 00:00");
        clock.setTextColor(Color.WHITE);clock.setTextSize(14);
        panel.addView(clock);
        LinearLayout buttons=new LinearLayout(this);buttons.setOrientation(LinearLayout.HORIZONTAL);buttons.setGravity(Gravity.CENTER);
        panel.addView(buttons);
        Button rewind=action("−10 ثوانٍ",buttons);
        Button play=action("تشغيل / إيقاف",buttons);
        Button forward=action("+10 ثوانٍ",buttons);
        Button next=action("الحلقة التالية",buttons);
        qualityButton=action("الجودة",buttons);
        qualityButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){showQualityMenu();}});
        updateQualityButton();
        Button exit=action("رجوع",buttons);
        if(live){rewind.setEnabled(false);forward.setEnabled(false);}
        if(url!=null && url.toLowerCase(java.util.Locale.US).contains(".m3u8")){
            Button external=action("مشغل خارجي",buttons);
            external.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                try{
                    Intent open=new Intent(Intent.ACTION_VIEW);
                    open.setDataAndType(Uri.parse(currentUrl),"application/vnd.apple.mpegurl");
                    startActivity(open);
                }catch(Exception e){error.setText("يحتاج بث HLS على هذا الجهاز مشغلًا خارجيًا متوافقًا، مثل VLC إصدار يدعم Android 4.4.");}
            }});
        }
        if(officialUrl!=null && officialUrl.startsWith("https://")){
            Button official=action("الموقع الرسمي",buttons);
            official.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(officialUrl)));}
                catch(Exception e){error.setText("لا يوجد متصفح متوافق لعرض الموقع الرسمي للقناة");}
            }});
        }
        rewind.setOnClickListener(new View.OnClickListener(){public void onClick(View v){seek(-10000);}});
        forward.setOnClickListener(new View.OnClickListener(){public void onClick(View v){seek(10000);}});
        play.setOnClickListener(new View.OnClickListener(){public void onClick(View v){toggle();}});
        next.setEnabled(!live&&nextUrl!=null && nextUrl.startsWith("https://"));
        next.setOnClickListener(new View.OnClickListener(){public void onClick(View v){playNext();}});
        exit.setOnClickListener(new View.OnClickListener(){public void onClick(View v){finish();}});
        error=new TextView(this);
        error.setTextColor(0xFFFFD8C7);error.setTextSize(17);error.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams ep=new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER);
        root.addView(error,ep);
        setContentView(root);
        play.requestFocus();
        if(currentUrl==null||!currentUrl.startsWith("https://")){
            error.setText("لا يوجد رابط تشغيل HTTPS مصرح به");return;
        }
        video.setOnPreparedListener(new MediaPlayer.OnPreparedListener(){
            public void onPrepared(MediaPlayer media){
                ready=true;
                int saved=pendingSeekMs>0?pendingSeekMs:
                    getSharedPreferences("aseel_user_v2",MODE_PRIVATE).getInt("position_"+id,0);
                pendingSeekMs=0;
                if(!live && saved>0 && media.getDuration()>saved+15000)video.seekTo(saved);
                video.start();
                manualPause=false;
                bufferingStarted=0L;lastTickPosition=-1;stallTicks=0;
                error.setText("");
                streamStatus.setText("▶ تشغيل • "+qualityName());
                revealControls();
                handler.removeCallbacks(tick);handler.post(tick);
                media.setOnInfoListener(new MediaPlayer.OnInfoListener(){
                    public boolean onInfo(MediaPlayer p,int what,int extra){
                        if(what==MediaPlayer.MEDIA_INFO_BUFFERING_START){
                            bufferingStarted=android.os.SystemClock.elapsedRealtime();
                            streamStatus.setText("◌ جاري التخزين المؤقت • "+qualityName());
                            revealControls();
                        }else if(what==MediaPlayer.MEDIA_INFO_BUFFERING_END){
                            bufferingStarted=0L;
                            streamStatus.setText("▶ تشغيل • "+qualityName());
                        }
                        return false;
                    }
                });
                media.setOnBufferingUpdateListener(new MediaPlayer.OnBufferingUpdateListener(){
                    public void onBufferingUpdate(MediaPlayer p,int percent){
                        if(bufferingStarted>0)streamStatus.setText("◌ التخزين المؤقت "+percent+"% • "+qualityName());
                    }
                });
            }
        });
        video.setOnCompletionListener(new MediaPlayer.OnCompletionListener(){
            public void onCompletion(MediaPlayer media){
                android.content.SharedPreferences prefs=getSharedPreferences("aseel_user_v2",MODE_PRIVATE);
                android.content.SharedPreferences.Editor edit=prefs.edit().remove("position_"+id);
                if(id.equals(prefs.getString("resume_id",""))){
                    edit.remove("resume_id").remove("resume_title").remove("resume_url");
                }
                edit.apply();
                if(!live && nextUrl!=null && nextUrl.startsWith("https://"))playNext();
            }
        });
        video.setOnErrorListener(new MediaPlayer.OnErrorListener(){
            public boolean onError(MediaPlayer mp,int what,int extra){
                ready=false;
                revealControls();
                if(retries<2 && !changingSource){
                    recover("MediaPlayer "+what+"/"+extra);
                    return true;
                }
                String diagnostics=mediaProxy!=null?mediaProxy.getLastError():"";
                String code="Android API "+Build.VERSION.SDK_INT+" | "+playerMode+" | MediaPlayer "+what+"/"+extra;
                String details=diagnostics.length()>0?"\nالشبكة: "+diagnostics:"\nقد يكون السبب شهادة TLS أو تنسيق الفيديو أو قدرات المحاكي/الشاشة.";
                error.setText("تعذر تشغيل الفيديو.\n"+code+details);
                Log.e("AseelVideo","Playback failed: "+code+" "+diagnostics);
                return true;
            }
        });
        openStream(currentUrl);
    }

    private String qualityName(){
        return sources.size()>0&&sourceIndex<sources.size()?sources.get(sourceIndex).label:"المصدر الأصلي";
    }
    private void updateQualityButton(){
        if(qualityButton!=null)qualityButton.setText("الجودة: "+qualityName());
    }
    private void showQualityMenu(){
        if(sources.size()<2){
            new AlertDialog.Builder(this).setTitle("جودة المشاهدة")
               .setMessage("هذا العمل متاح حاليًا بمصدر واحد فقط ("+qualityName()+"). لا يمكن تغيير الدقة دون رابط مرخص آخر. بث HLS قد يغيّر الجودة تلقائيًا إذا دعمه المشغل.")
               .setPositiveButton("حسنًا",null).show();
            return;
        }
        final String[] labels=new String[sources.size()+1];
        labels[0]="تلقائي اقتصادي (مناسب لشاشتك)";
        for(int i=0;i<sources.size();i++)labels[i+1]=sources.get(i).label;
        new AlertDialog.Builder(this).setTitle("اختيار الجودة المتاحة")
         .setSingleChoiceItems(labels,sourceIndex+1,new DialogInterface.OnClickListener(){
            public void onClick(DialogInterface dialog,int choice){
                SharedPreferences prefs=getSharedPreferences("aseel_user_v2",MODE_PRIVATE);
                int next=choice==0?StreamQuality.choose(sources,"auto",Build.VERSION.SDK_INT):choice-1;
                prefs.edit().putString("quality_item_"+id,choice==0?"auto":sources.get(next).label).apply();
                dialog.dismiss();
                if(next!=sourceIndex)switchSource(next,true,"تغيير الجودة");
            }
         }).setNegativeButton("إلغاء",null).show();
    }
    private void recover(String cause){
        if(changingSource||retries>=2)return;
        int lower=StreamQuality.lower(sources,sourceIndex);
        retries++;
        int next=lower>=0?lower:sourceIndex;
        switchSource(next,false,"محاولة معالجة التقطيع ("+retries+"/2): "+cause);
    }
    private void switchSource(int next,boolean manual,String reason){
        if(next<0||next>=sources.size())return;
        changingSource=true;
        if(!live && ready){try{pendingSeekMs=video.getCurrentPosition();}catch(Exception ignored){}}
        handler.removeCallbacks(tick);
        ready=false;bufferingStarted=0L;stallTicks=0;lastTickPosition=-1;
        try{video.stopPlayback();}catch(Exception ignored){}
        sourceIndex=next;currentUrl=sources.get(next).url;
        if(manual)retries=0;
        updateQualityButton();
        streamStatus.setText(reason+" • "+qualityName());
        error.setText("جاري إعادة الاتصال... "+qualityName());
        final String target=currentUrl;
        handler.postDelayed(new Runnable(){public void run(){
            changingSource=false;
            if(isFinishing())return;
            openStream(target);
        }},1000);
    }
    private void playNext(){
        if(nextUrl==null||!nextUrl.startsWith("https://"))return;
        try{
            handler.removeCallbacks(tick);
            video.stopPlayback();
            ready=false;
            currentUrl=nextUrl;
            sources=StreamQuality.parse(currentUrl,"الحلقة التالية","[]");
            sourceIndex=0;retries=0;pendingSeekMs=0;live=false;
            updateQualityButton();
            nextUrl=null;
            id=(nextId==null||nextId.length()==0)?"next_episode":nextId;
            if(nextTitle!=null&&nextTitle.length()>0)title.setText(nextTitle);
            nextId=null;nextTitle=null;
            error.setText("جاري تحميل الحلقة التالية...");
            openStream(currentUrl);
        }catch(Exception ex){error.setText("تعذر تشغيل الحلقة التالية: "+ex.getClass().getSimpleName());}
    }
    /**
     * Android KitKat MediaPlayer uses system TLS, not the safe TLS 1.2 adapter
     * used for the catalog; for API 19 use the restricted loopback range
     * bridge. Android 5+ keeps native HTTPS playback.
     */
    private void openStream(String url){
        if(mediaProxy!=null){mediaProxy.close();mediaProxy=null;}
        ready=false;bufferingStarted=0L;
        if(url==null || !url.startsWith("https://")){
            error.setText("رابط الفيديو مفقود أو غير آمن (HTTPS مطلوب)");
            return;
        }
        try{
            String address=url;
            boolean isHls=url.toLowerCase(java.util.Locale.US).contains(".m3u8");
            if(Build.VERSION.SDK_INT<=19 && !isHls){
                mediaProxy=new LegacyStreamProxy(this,url);
                address=mediaProxy.start();
                playerMode="TLS 1.2 via localhost";
            }else{
                playerMode=isHls?"HLS native (may require external player on KitKat)":"HTTPS native";
            }
            error.setText("جاري تحميل الفيديو... ("+playerMode+")");
            video.setVideoURI(Uri.parse(address));
            video.requestFocus();
        }catch(Exception exception){
            String message=exception.getClass().getSimpleName()+": "+exception.getMessage();
            error.setText("تعذر فتح المشغل: "+message);
            Log.e("AseelVideo","Unable to start secure media stream",exception);
        }
    }
    private void savePosition(int position){
        if(position<1000 || currentUrl==null || !currentUrl.startsWith("https://"))return;
        getSharedPreferences("aseel_user_v2",MODE_PRIVATE).edit()
            .putInt("position_"+id,position)
            .putString("resume_id",id)
            .putString("resume_url",currentUrl)
            .putString("resume_title",title.getText().toString())
            .apply();
    }
    private String format(int ms){int sec=Math.max(ms,0)/1000;return String.format(java.util.Locale.US,"%02d:%02d",sec/60,sec%60);}
    private void seek(int amount){if(!ready)return;int d=video.getDuration();
        video.seekTo(Math.max(0,Math.min(d,video.getCurrentPosition()+amount)));}
    private void toggle(){
        if(!ready)return;
        if(video.isPlaying()){video.pause();manualPause=true;}
        else{video.start();manualPause=false;}
        revealControls();
    }
    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE){toggle();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY){if(ready&&!video.isPlaying()){video.start();manualPause=false;}revealControls();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_PAUSE){if(ready&&video.isPlaying()){video.pause();manualPause=true;}revealControls();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_REWIND){seek(-10000);revealControls();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_FAST_FORWARD){seek(10000);revealControls();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_STOP){finish();return true;}
        if(controlsPanel!=null && controlsPanel.getVisibility()!=View.VISIBLE){
            if(code==KeyEvent.KEYCODE_DPAD_LEFT){seek(-10000);revealControls();return true;}
            if(code==KeyEvent.KEYCODE_DPAD_RIGHT){seek(10000);revealControls();return true;}
            if(code==KeyEvent.KEYCODE_DPAD_UP || code==KeyEvent.KEYCODE_DPAD_DOWN ||
               code==KeyEvent.KEYCODE_DPAD_CENTER || code==KeyEvent.KEYCODE_ENTER){
                revealControls();return true;
            }
        }
        if(code==KeyEvent.KEYCODE_DPAD_LEFT || code==KeyEvent.KEYCODE_DPAD_RIGHT ||
           code==KeyEvent.KEYCODE_DPAD_UP || code==KeyEvent.KEYCODE_DPAD_DOWN ||
           code==KeyEvent.KEYCODE_DPAD_CENTER || code==KeyEvent.KEYCODE_ENTER)
            revealControls();
        return super.onKeyDown(code,event);
    }
    private Button action(String name,LinearLayout row){
        final Button b=new Button(this);b.setText(name);b.setTextSize(13);
        b.setTextColor(Color.WHITE);b.setAllCaps(false);
        b.setBackgroundColor(0xFF193856);
        b.setFocusable(true);
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                b.setBackgroundColor(focused?0xFFE5BF7D:0xFF193856);
                b.setTextColor(focused?0xFF081526:Color.WHITE);
            }
        });
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(50),1);p.setMargins(dp(4),0,dp(4),0);
        row.addView(b,p);return b;
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    @Override protected void onPause(){super.onPause();if(video!=null&&ready){video.pause();if(!live)savePosition(video.getCurrentPosition());}}
    @Override protected void onDestroy(){handler.removeCallbacks(hideOverlay);handler.removeCallbacks(tick);if(video!=null)video.stopPlayback();if(mediaProxy!=null)mediaProxy.close();super.onDestroy();}
}
