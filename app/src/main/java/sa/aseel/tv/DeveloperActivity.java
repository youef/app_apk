package sa.aseel.tv;
import android.app.Activity;
import android.os.Bundle;
import android.content.Context;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
/** Developer contact page, never exported to third-party apps. */
public final class DeveloperActivity extends Activity {
    private int dp(int px){return Math.round(px*getResources().getDisplayMetrics().density);}
    private TextView label(String value,int size,int color,boolean strong){
        TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);
        t.setGravity(Gravity.CENTER);t.setTextDirection(View.TEXT_DIRECTION_RTL);
        if(strong)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;
    }
    private void add(LinearLayout parent,View child,int height){
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(height));
        p.setMargins(dp(5),dp(5),dp(5),dp(5));parent.addView(child,p);
    }
    private Button action(String title,final boolean primary){
        final Button b=new Button(this);b.setText(title);b.setTextSize(17);
        b.setAllCaps(false);b.setFocusable(true);b.setTextColor(Color.WHITE);
        b.setBackgroundDrawable(new CinemaGlassButtonDrawable(primary,false,
            primary?0xFF82132B:0xFF342334));
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                b.setBackgroundDrawable(new CinemaGlassButtonDrawable(primary,false,
                    focused?0xFFAB2445:primary?0xFF82132B:0xFF342334));
                b.setScaleX(focused?1.025f:1f);b.setScaleY(focused?1.025f:1f);
            }
        });return b;
    }
    private void open(String url){
        try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}
        catch(Exception ex){copy("رابط التواصل",url);}
    }
    private void copy(String title,String value){
        ClipboardManager manager=(ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);
        if(manager!=null){
            manager.setPrimaryClip(ClipData.newPlainText(title,value));
            Toast.makeText(this,"تم نسخ "+title,Toast.LENGTH_LONG).show();
        }
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);
        scroll.setBackgroundDrawable(new CinemaBackdropDrawable());
        LinearLayout host=new LinearLayout(this);host.setOrientation(LinearLayout.VERTICAL);
        host.setGravity(Gravity.CENTER);host.setPadding(dp(24),dp(12),dp(24),dp(12));
        scroll.addView(host,new ScrollView.LayoutParams(-1,-1));
        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);card.setPadding(dp(22),dp(20),dp(22),dp(20));
        card.setBackgroundDrawable(new CinemaNeonDrawable(0xFF332230,dp(26),false));
        LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-1,-2);
        cp.width=Math.min(dp(685),getResources().getDisplayMetrics().widthPixels-dp(36));
        host.addView(card,cp);
        add(card,label("AL EZZ TV  ·  OFFICIAL DEVELOPER",13,0xFFFF8298,true),30);
        add(card,label("يوسف الحازمي",32,Color.WHITE,true),58);
        add(card,label("مطور ومبرمج تطبيق العز TV",19,0xFFFFCAD3,true),42);
        add(card,label("للتواصل والاستفسارات التقنية ومقترحات التطوير",15,0xFFC2BECD,false),47);
        Button whatsapp=action("واتساب  •  0538243481",true);add(card,whatsapp,57);
        whatsapp.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            open("https://wa.me/966538243481");
        }});
        Button snapchat=action("سناب شات  •  f.0x0",false);add(card,snapchat,55);
        snapchat.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            open("https://www.snapchat.com/add/f.0x0");
        }});
        Button copy=action("نسخ بيانات التواصل",false);add(card,copy,51);
        copy.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            copy("بيانات المطور","يوسف الحازمي | واتساب: 0538243481 | سناب: f.0x0");
        }});
        Button back=action("رجوع إلى العز TV",false);add(card,back,49);
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){finish();}});
        setContentView(scroll);whatsapp.requestFocus();
    }
}
