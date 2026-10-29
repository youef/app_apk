package sa.aseel.tv;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
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
    private String id, nextUrl;
    private boolean ready=false;
    private final Runnable tick=new Runnable(){
        public void run(){
            if(video!=null&&ready){
                try{
                    int dur=video.getDuration(),pos=video.getCurrentPosition();
                    if(dur>0){progress.setMax(dur);progress.setProgress(pos);}
                    clock.setText(format(pos)+" / "+format(dur));
                    getSharedPreferences("aseel_user_v2",MODE_PRIVATE).edit().putInt("position_"+id,Math.max(0,pos)).apply();
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
        nextUrl=getIntent().getStringExtra("next_url");
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
                getSharedPreferences("aseel_user_v2",MODE_PRIVATE).edit().remove("position_"+id).apply();
                if(nextUrl!=null && nextUrl.startsWith("https://"))playNext();
            }
        });
        video.setOnErrorListener(new MediaPlayer.OnErrorListener(){
            public boolean onError(MediaPlayer mp,int what,int extra){
                ready=false;
                error.setText("تعذر تشغيل الفيديو. قد لا يدعم التلفزيون الصيغة أو الشهادة أو بروتوكول الاتصال. رمز الخطأ: "+what+"/"+extra);
                return true;
            }
        });
        try{video.setVideoURI(Uri.parse(url));video.requestFocus();}catch(Exception exception){
            error.setText("تعذر إعداد المشغل: "+exception.getClass().getSimpleName());
        }
    }
    private void playNext(){
        if(nextUrl==null||!nextUrl.startsWith("https://"))return;
        try{video.stopPlayback();ready=false;id=getIntent().getStringExtra("next_item_id");if(id==null)id="next_episode";nextUrl=null;
            video.setVideoURI(Uri.parse(getIntent().getStringExtra("next_url"))); video.start();
        }catch(Exception ex){error.setText("تعذر تشغيل الحلقة التالية");}
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
    @Override protected void onPause(){super.onPause();if(video!=null&&ready){video.pause();getSharedPreferences("aseel_user_v2",MODE_PRIVATE).edit().putInt("position_"+id,video.getCurrentPosition()).apply();}}
    @Override protected void onDestroy(){handler.removeCallbacks(tick);if(video!=null)video.stopPlayback();super.onDestroy();}
}
