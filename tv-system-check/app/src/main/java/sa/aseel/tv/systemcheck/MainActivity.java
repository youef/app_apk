package sa.aseel.tv.systemcheck;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import java.io.BufferedReader;
import java.io.InputStreamReader;

public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(8,17,36);
    private static final int FG = Color.rgb(240,248,255);
    private TextView status;
    private TextView info;
    private String report = "";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout stack = new LinearLayout(this);
        stack.setPadding(dp(24),dp(14),dp(24),dp(24));
        stack.setOrientation(LinearLayout.VERTICAL);
        stack.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        scroll.addView(stack);
        setContentView(scroll);

        stack.addView(text("أسيل | ASEEL TV", 30,FG,true));
        stack.addView(text("فاحص النظام - مناسب لـ Android 4.4.4 / API 19",17,0xffa7c7d8,false));
        stack.addView(text("الأمان أولاً: لا يتم تثبيت روت، ولا تغيير أقسام النظام، ولا تفليش أي روم.",17,0xffffd18f,false));
        status = text("جاهز للفحص",18,0xff8eebbe,false);
        stack.addView(status);
        button(stack,"١. فحص مواصفات الشاشة",new View.OnClickListener() {
            @Override public void onClick(View v){refreshReport();}
        });
        button(stack,"٢. اختبار الروت الموجود (su)",new View.OnClickListener() {
            @Override public void onClick(View v){checkRoot();}
        });
        button(stack,"٣. فتح التحديث الرسمي",new View.OnClickListener() {
            @Override public void onClick(View v){openSystemUpdate();}
        });
        button(stack,"٤. نسخ تقرير الجهاز",new View.OnClickListener() {
            @Override public void onClick(View v){copyReport();}
        });
        info = text("",18,FG,false);
        info.setTextIsSelectable(true);
        info.setPadding(dp(14),dp(12),dp(14),dp(12));
        GradientDrawable panel = new GradientDrawable();
        panel.setColor(0xff17253b);
        panel.setCornerRadius(dp(12));
        panel.setStroke(dp(1),0xff456071);
        info.setBackgroundDrawable(panel);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(-1,-2);
        ip.topMargin=dp(12);
        stack.addView(info,ip);
        stack.addView(text("تطبيق تشخيص مستقل: لا يستبدل أسيل TV ولا يحتاج إنترنت أو أذونات إضافية.",15,0xffa7c7d8,false));
        refreshReport();
    }

    private int dp(int d){return (int)(d*getResources().getDisplayMetrics().density+0.5f);}
    private TextView text(String s,int size,int color,boolean bold){
        TextView v=new TextView(this);
        v.setText(s); v.setTextSize(size); v.setTextColor(color);
        v.setGravity(Gravity.RIGHT); v.setTextDirection(View.TEXT_DIRECTION_RTL);
        v.setPadding(0,dp(6),0,dp(6));
        if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        return v;
    }
    private GradientDrawable buttonBackground(boolean focused){
        GradientDrawable d=new GradientDrawable();
        d.setColor(focused?0xff9bf3d4:0xff213d58);
        d.setStroke(dp(2),focused?0xff10b992:0xff497591);
        d.setCornerRadius(dp(10));
        return d;
    }
    private void button(LinearLayout box,String title,View.OnClickListener listener){
        final Button b=new Button(this);
        b.setText(title);b.setTextSize(19);b.setTextColor(FG);b.setAllCaps(false);
        b.setFocusable(true);b.setGravity(Gravity.CENTER);
        b.setBackgroundDrawable(buttonBackground(false));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(56));
        p.bottomMargin=dp(9);box.addView(b,p);b.setOnClickListener(listener);
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            @Override public void onFocusChange(View v,boolean focused){
                b.setTextColor(focused?0xff072925:FG);
                b.setBackgroundDrawable(buttonBackground(focused));
            }
        });
    }
    private String prop(String key){
        java.lang.Process p=null;
        try{
            p=Runtime.getRuntime().exec(new String[]{"getprop",key});
            BufferedReader br=new BufferedReader(new InputStreamReader(p.getInputStream(),"UTF-8"));
            String s=br.readLine();br.close();p.waitFor();
            return s==null||s.trim().length()==0?"غير متوفر":s.trim();
        }catch(Exception e){return "غير متوفر";}
        finally{if(p!=null)p.destroy();}
    }
    private String deviceReport(){
        StringBuilder x=new StringBuilder();
        x.append("تقرير التوافق مع الروم\n\n");
        x.append("Android: ").append(Build.VERSION.RELEASE).append(" • API ").append(Build.VERSION.SDK_INT).append("\n");
        x.append("Manufacturer: ").append(Build.MANUFACTURER).append("\n");
        x.append("Brand: ").append(Build.BRAND).append("\n");
        x.append("Model: ").append(Build.MODEL).append("\n");
        x.append("Board: ").append(Build.BOARD).append("\n");
        x.append("Hardware: ").append(Build.HARDWARE).append("\n");
        x.append("Device: ").append(Build.DEVICE).append("\n");
        x.append("Product: ").append(Build.PRODUCT).append("\n");
        x.append("CPU ABI: ").append(Build.CPU_ABI).append("\n");
        x.append("Build: ").append(Build.DISPLAY).append("\n");
        x.append("Bootloader: ").append(Build.BOOTLOADER).append("\n");
        x.append("Tags: ").append(Build.TAGS).append("\n");
        x.append("Kernel: ").append(System.getProperty("os.version","غير متوفر")).append("\n");
        x.append("ro.board.platform: ").append(prop("ro.board.platform")).append("\n");
        x.append("ro.boot.hardware: ").append(prop("ro.boot.hardware")).append("\n");
        x.append("ro.build.version.incremental: ").append(prop("ro.build.version.incremental")).append("\n");
        x.append("Fingerprint: ").append(Build.FINGERPRINT).append("\n");
        try {
            ActivityManager a=(ActivityManager)getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo m=new ActivityManager.MemoryInfo();
            a.getMemoryInfo(m);
            x.append("System reported RAM: ").append(m.totalMem/1048576L).append(" MiB\n");
        } catch(Exception ignored){}
        x.append("\nتنبيه: test-keys ليست إثباتاً للروت. تشابه PC822 ليس إثباتاً لتوافق الروم.\n");
        return x.toString();
    }
    private void refreshReport(){
        report=deviceReport();
        info.setText(report);
        status.setText("تم الفحص دون تعديل الجهاز");
    }
    private void checkRoot(){
        status.setText("اختبار صلاحية su: يمكن رفض أي طلب إذن يظهر...");
        new Thread(new Runnable(){
            @Override public void run(){
                String result="صلاحيات الروت غير مؤكدة";
                java.lang.Process p=null;
                try {
                    p=Runtime.getRuntime().exec(new String[]{"su","-c","id"});
                    final java.lang.Process proc=p;
                    final int[] exit=new int[]{-1};
                    Thread waiter=new Thread(new Runnable(){
                        @Override public void run(){try{exit[0]=proc.waitFor();}catch(Exception ignored){}}
                    });
                    waiter.setDaemon(true);waiter.start();waiter.join(6500);
                    if(waiter.isAlive())result="انتهت مهلة فحص الروت بلا أي تعديل";
                    else{
                        BufferedReader reader=new BufferedReader(new InputStreamReader(p.getInputStream(),"UTF-8"));
                        String s=reader.readLine();reader.close();
                        if(exit[0]==0&&s!=null&&s.contains("uid=0"))
                            result="الروت موجود ومؤكد (uid=0) - لكنه لا يتيح الترقية دون روم مناسب";
                        else result="لم يتم تأكيد وجود الروت (su غير موجود أو الإذن مرفوض)";
                    }
                } catch(Exception e){result="لا توجد صلاحية روت متاحة لهذا التطبيق";}
                finally{if(p!=null)p.destroy();}
                final String finalResult=result;
                runOnUiThread(new Runnable(){
                    @Override public void run(){
                        status.setText(finalResult);
                        info.setText(report+"\nنتيجة الروت: "+finalResult);
                    }
                });
            }
        }).start();
    }
    private void openSystemUpdate(){
        String[] targets={"android.settings.SYSTEM_UPDATE_SETTINGS",
            "android.settings.DEVICE_INFO_SETTINGS","android.settings.SETTINGS"};
        for(String target:targets){
            try {
                startActivity(new Intent(target));
                status.setText("تم فتح إعدادات الشركة؛ استخدم تحديثها الرسمي فقط");
                return;
            }catch(Exception ignored){}
        }
        status.setText("لا يتوفر تطبيق تحديث رسمي ضمن هذا النظام");
    }
    private void copyReport(){
        try {
            ClipboardManager cm=(ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("Aseel TV device report",report));
            status.setText("تم نسخ تقرير الشاشة");
            Toast.makeText(this,"تم النسخ",Toast.LENGTH_SHORT).show();
        }catch(Exception e){status.setText("تعذر النسخ؛ التقرير ظاهر أسفل الأزرار");}
    }
}
