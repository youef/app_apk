package sa.aseel.tv;

import android.app.Activity;
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
    private TextView title,error,clock;
    private ProgressBar progress;
    private final Handler handler=new Handler();
    private String id, nextUrl, nextId, nextTitle, currentUrl, officialUrl;
    private boolean ready=false;
    private LegacyStreamProxy mediaProxy;
    private String playerMode="native";
    private final Runnable tick=new Runnable(){
        public void run(){
            if(video!=null&&ready){
                try{
                    int dur=video.getDuration(),pos=video.getCurrentPosition();
                    if(dur>0){progress.setMax(dur);progress.setProgress(pos);}
                    clock.setText(format(pos)+" / "+format(dur));
                    savePosition(pos);
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
        title=new TextView(this);
        title.setText(getIntent().getStringExtra("title"));
        title.setTextSize(21);title.setTextColor(0xFFF2D6A0);
        panel.addView(title);
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        panel.addView(progress,new LinearLayout.LayoutParams(-1,dp(7)));
        clock=new TextView(this);clock.setText("00:00 / 00:00");
        clock.setTextColor(Color.WHITE);clock.setTextSize(14);
        panel.addView(clock);
        LinearLayout buttons=new LinearLayout(this);buttons.setOrientation(LinearLayout.HORIZONTAL);buttons.setGravity(Gravity.CENTER);
        panel.addView(buttons);
        Button rewind=action("−10 ثوانٍ",buttons);
        Button play=action("تشغيل / إيقاف",buttons);
        Button forward=action("+10 ثوانٍ",buttons);
        Button next=action("الحلقة التالية",buttons);
        Button exit=action("رجوع",buttons);
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
        next.setEnabled(nextUrl!=null && nextUrl.startsWith("https://"));
        next.setOnClickListener(new View.OnClickListener(){public void onClick(View v){playNext();}});
        exit.setOnClickListener(new View.OnClickListener(){public void onClick(View v){finish();}});
        error=new TextView(this);
        error.setTextColor(0xFFFFD8C7);error.setTextSize(17);error.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams ep=new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER);
        root.addView(error,ep);
        setContentView(root);
        play.requestFocus();
        if(url==null||!url.startsWith("https://")){
            error.setText("لا يوجد رابط تشغيل HTTPS مصرح به");return;
        }
        video.setOnPreparedListener(new MediaPlayer.OnPreparedListener(){
            public void onPrepared(MediaPlayer media){
                ready=true;
                int saved=getSharedPreferences("aseel_user_v2",MODE_PRIVATE).getInt("position_"+id,0);
                if(saved>0 && saved < media.getDuration()-15000)video.seekTo(saved);
                video.start();
                error.setText("");
                handler.post(tick);
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
                if(nextUrl!=null && nextUrl.startsWith("https://"))playNext();
            }
        });
        video.setOnErrorListener(new MediaPlayer.OnErrorListener(){
            public boolean onError(MediaPlayer mp,int what,int extra){
                ready=false;
                String diagnostics=mediaProxy!=null?mediaProxy.getLastError():"";
                String code="Android API "+Build.VERSION.SDK_INT+" | "+playerMode+" | MediaPlayer "+what+"/"+extra;
                String details=diagnostics.length()>0?"\nالشبكة: "+diagnostics:"\nقد يكون السبب شهادة TLS أو تنسيق الفيديو أو قدرات المحاكي/الشاشة.";
                error.setText("تعذر تشغيل الفيديو.\n"+code+details);
                Log.e("AseelVideo","Playback failed: "+code+" "+diagnostics);
                return true;
            }
        });
        openStream(url);
    }
    private void playNext(){
        if(nextUrl==null||!nextUrl.startsWith("https://"))return;
        try{
            handler.removeCallbacks(tick);
            video.stopPlayback();
            ready=false;
            currentUrl=nextUrl;
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
        ready=false;
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
    private void toggle(){if(!ready)return;if(video.isPlaying())video.pause();else video.start();}
    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE){toggle();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_REWIND){seek(-10000);return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_FAST_FORWARD){seek(10000);return true;}
        return super.onKeyDown(code,event);
    }
    private Button action(String name,LinearLayout row){
        final Button b=new Button(this);b.setText(name);b.setTextSize(13);
        b.setTextColor(Color.WHITE);b.setAllCaps(false);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(50),1);p.setMargins(dp(4),0,dp(4),0);
        row.addView(b,p);return b;
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    @Override protected void onPause(){super.onPause();if(video!=null&&ready){video.pause();savePosition(video.getCurrentPosition());}}
    @Override protected void onDestroy(){handler.removeCallbacks(tick);if(video!=null)video.stopPlayback();if(mediaProxy!=null)mediaProxy.close();super.onDestroy();}
}
