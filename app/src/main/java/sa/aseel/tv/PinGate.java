package sa.aseel.tv;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;

/**
 * On-device PIN screen for family access on Android API 19.
 * This is an offline user-interface barrier, not a substitute for server-side authorization.
 * Do not place a plaintext PIN in this public repository.
 */
final class PinGate {
    private static final String SALT="e42695223c465d0af575de49db015021";
    private static final String CHECK="385035d1e0dbbf3941728251aa080e9180a218aeeaf510dbe6922bb64fb0d19f";
    private static final int WORK=12000,LENGTH=6;
    private static final int BG=0xFF080A10,SURFACE=0xFF151924,RED=0xFFFF415D,WHITE=0xFFF8F8FC;
    private final Activity activity;
    private final Runnable onSuccess;
    private final SharedPreferences storage;
    private final StringBuilder entry=new StringBuilder();
    private TextView dots,message;
    private Button[] digits=new Button[12];

    PinGate(Activity activity,Runnable onSuccess){
        this.activity=activity;this.onSuccess=onSuccess;
        storage=activity.getSharedPreferences("alezz_gate_limits_v1",Context.MODE_PRIVATE);
    }
    private int dp(int value){return Math.round(activity.getResources().getDisplayMetrics().density*value);}
    private GradientDrawable background(int fill,int border,int rad){
        GradientDrawable shape=new GradientDrawable();
        shape.setColor(fill);shape.setCornerRadius(dp(rad));
        if(border!=0)shape.setStroke(dp(1),border);
        return shape;
    }
    private TextView text(String label,int size,int color,boolean bold){
        TextView t=new TextView(activity);t.setText(label);t.setTextSize(size);t.setTextColor(color);
        t.setGravity(Gravity.CENTER);t.setTextDirection(View.TEXT_DIRECTION_RTL);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        return t;
    }
    private LinearLayout vertical(){
        LinearLayout l=new LinearLayout(activity);l.setOrientation(LinearLayout.VERTICAL);return l;
    }
    private byte[] decodeHex(String input){
        byte[] out=new byte[input.length()/2];
        for(int i=0;i<out.length;i++){
            int a=Character.digit(input.charAt(i*2),16),b=Character.digit(input.charAt(i*2+1),16);
            out[i]=(byte)((a<<4)|b);
        }
        return out;
    }
    private boolean matches(char[] typed){
        PBEKeySpec spec=new PBEKeySpec(typed,decodeHex(SALT),WORK,256);
        try {
            byte[] output=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded();
            return MessageDigest.isEqual(output,decodeHex(CHECK));
        }catch(Exception ignored){return false;}
        finally {spec.clearPassword();java.util.Arrays.fill(typed,'\0');}
    }
    private long remaining(){return Math.max(0,storage.getLong("until",0)-System.currentTimeMillis());}
    private void status(){
        if(dots!=null){
            StringBuilder masked=new StringBuilder();
            for(int i=0;i<LENGTH;i++)masked.append(i<entry.length()?"●  ":"○  ");
            dots.setText(masked.toString());
        }
    }
    private void type(String key){
        if(remaining()>0){message.setText("تم إيقاف المحاولات مؤقتًا. أعد المحاولة بعد "+Math.max(1,remaining()/1000)+" ثانية.");return;}
        if("back".equals(key)){
            if(entry.length()>0)entry.deleteCharAt(entry.length()-1);
            message.setText("أدخل الرمز باستخدام الريموت");status();return;
        }
        if("clear".equals(key)){entry.setLength(0);status();message.setText("أدخل الرمز باستخدام الريموت");return;}
        if("ok".equals(key)){submit();return;}
        if(key.length()==1&&Character.isDigit(key.charAt(0))&&entry.length()<LENGTH){
            entry.append(key);status();
            if(entry.length()==LENGTH)submit();
        }
    }
    private void submit(){
        if(remaining()>0){type("ok-blocked");return;}
        if(entry.length()!=LENGTH){message.setText("الرمز يتكوّن من ستة أرقام.");return;}
        char[] entered=new char[entry.length()];
        entry.getChars(0,entry.length(),entered,0);
        boolean correct=matches(entered);
        entry.setLength(0);status();
        if(correct){
            storage.edit().remove("failures").remove("until").apply();
            onSuccess.run();return;
        }
        int failures=storage.getInt("failures",0)+1;
        if(failures>=5){
            long seconds=Math.min(900L,30L<<(Math.min(5,(failures-5)/5)));
            storage.edit().putInt("failures",failures).putLong("until",System.currentTimeMillis()+seconds*1000L).apply();
            message.setText("رمز غير صحيح. توقف الدخول مؤقتًا لمدة "+seconds+" ثانية.");
        }else{
            storage.edit().putInt("failures",failures).apply();
            message.setText("رمز غير صحيح. المحاولات المتبقية: "+(5-failures));
        }
    }
    boolean keyEvent(KeyEvent event){
        if(event.getAction()!=KeyEvent.ACTION_DOWN)return false;
        int c=event.getKeyCode();
        if(c>=KeyEvent.KEYCODE_0&&c<=KeyEvent.KEYCODE_9){type(String.valueOf(c-KeyEvent.KEYCODE_0));return true;}
        if(c>=KeyEvent.KEYCODE_NUMPAD_0&&c<=KeyEvent.KEYCODE_NUMPAD_9){type(String.valueOf(c-KeyEvent.KEYCODE_NUMPAD_0));return true;}
        if(c==KeyEvent.KEYCODE_DEL){type("back");return true;}
        return false;
    }
    private Button key(final String label,final String value){
        final Button b=new Button(activity);
        b.setText(label);b.setTextSize(22);b.setTextColor(WHITE);b.setAllCaps(false);
        b.setFocusable(true);b.setBackgroundDrawable(background(SURFACE,0xFF454B5A,12));
        b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){type(value);}});
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){public void onFocusChange(View v,boolean selected){
            b.setBackgroundDrawable(background(selected?RED:SURFACE,selected?0xFFFF8796:0xFF454B5A,12));
            b.setScaleX(selected?1.08f:1f);b.setScaleY(selected?1.08f:1f);
        }});
        return b;
    }
    void show(){
        FrameLayout full=new FrameLayout(activity);full.setBackgroundColor(BG);
        full.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        LinearLayout shell=new LinearLayout(activity);shell.setOrientation(LinearLayout.HORIZONTAL);
        shell.setGravity(Gravity.CENTER);shell.setPadding(dp(20),dp(10),dp(20),dp(10));
        FrameLayout.LayoutParams outer=new FrameLayout.LayoutParams(-1,-1,Gravity.CENTER);
        full.addView(shell,outer);
        LinearLayout branding=vertical();branding.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(0,-1,1.15f);
        bp.setMargins(dp(15),0,dp(15),0);shell.addView(branding,bp);
        TextView brand=text("العز",67,WHITE,true);
        branding.addView(brand);
        TextView tv=text("T V     ·     S T R E A M I N G",17,RED,true);
        branding.addView(tv);
        TextView line=text("كل عالم الترفيه. على شاشة واحدة.",20,0xFFBCC0CD,false);
        LinearLayout.LayoutParams lineP=new LinearLayout.LayoutParams(-1,-2);lineP.setMargins(0,dp(16),0,0);
        branding.addView(line,lineP);
        TextView deco=text("▶  أفلام     ●  بث مباشر     ★  أطفال",15,0xFF868A9C,false);
        LinearLayout.LayoutParams decoP=new LinearLayout.LayoutParams(-1,-2);decoP.setMargins(0,dp(29),0,0);branding.addView(deco,decoP);

        LinearLayout card=vertical();card.setPadding(dp(26),dp(17),dp(26),dp(16));
        card.setGravity(Gravity.CENTER);
        card.setBackgroundDrawable(background(0xFF151720,0xFF363945,20));
        LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(0,-2,1f);
        cp.setMargins(dp(7),0,dp(8),0);shell.addView(card,cp);
        TextView lock=text("◈  الدخول إلى العز TV",23,WHITE,true);card.addView(lock);
        TextView sub=text("هذه الشاشة محمية برمز الدخول",13,0xFFC9CAD4,false);
        card.addView(sub);
        dots=text("○  ○  ○  ○  ○  ○",26,0xFFFF788B,true);
        LinearLayout.LayoutParams dotsP=new LinearLayout.LayoutParams(-1,dp(45));dotsP.setMargins(0,dp(7),0,dp(4));card.addView(dots,dotsP);
        message=text("أدخل الرمز باستخدام الريموت",12,0xFFB7BAC5,false);
        card.addView(message);
        final String[] keys={"1","2","3","4","5","6","7","8","9","مسح","0","تأكيد"};
        for(int row=0;row<4;row++){
            LinearLayout lineRow=new LinearLayout(activity);lineRow.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,dp(53));
            rp.setMargins(0,dp(6),0,0);card.addView(lineRow,rp);
            for(int col=0;col<3;col++){
                int index=row*3+col;
                String v=index==9?"back":index==11?"ok":keys[index];
                Button button=key(keys[index],v);
                LinearLayout.LayoutParams kp=new LinearLayout.LayoutParams(0,-1,1);
                kp.setMargins(dp(3),0,dp(3),0);lineRow.addView(button,kp);
                digits[index]=button;
            }
        }
        TextView hint=text("الأسهم للتنقل  •  OK للاختيار  •  أزرار الأرقام تعمل مباشرة",11,0xFF9396A5,false);
        LinearLayout.LayoutParams hp=new LinearLayout.LayoutParams(-1,-2);hp.setMargins(0,dp(14),0,0);
        card.addView(hint,hp);
        activity.setContentView(full);
        digits[0].requestFocus();
        status();
    }
}
