package com.hayna.smartupdater;
import android.app.*;
import android.os.*;
import android.provider.Settings;
import android.content.*;
import android.content.pm.*;
import android.graphics.*;
import android.graphics.drawable.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
public final class MainActivity extends Activity {
 final int dark=0xff091325, panel=0xff192941, white=0xffeef5ff, grey=0xffb0c6da, accent=0xff00a987;
 TextView info; String report="";
 int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+0.5f);}
 GradientDrawable bg(int c){GradientDrawable d=new GradientDrawable();d.setColor(c);d.setCornerRadius(dp(14));return d;}
 TextView text(String s,int sp,int col){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(col);t.setGravity(Gravity.RIGHT);t.setPadding(dp(4),dp(5),dp(4),dp(5));return t;}
 void put(LinearLayout l,View v,int margin){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(margin);l.addView(v,p);}
 Button btn(String s,int c,View.OnClickListener fn){Button b=new Button(this);b.setAllCaps(false);b.setText(s);b.setTextSize(19);b.setTextColor(white);b.setBackground(bg(c));b.setPadding(dp(15),dp(13),dp(15),dp(13));b.setFocusable(true);b.setOnClickListener(fn);return b;}
 @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);ScrollView sc=new ScrollView(this);sc.setBackgroundColor(dark);LinearLayout l=new LinearLayout(this);l.setOrientation(1);l.setPadding(dp(24),dp(20),dp(24),dp(32));sc.addView(l);setContentView(sc);
 put(l,text("SMART • UPDATER",14,accent),8);put(l,text("محدّث نظام الشاشة",28,white),4);
 put(l,text("فحص معلومات الجهاز والتحديث الرسمي للشاشات القديمة",15,grey),6);
 info=text("جارٍ فحص النظام...",17,white);info.setBackground(bg(panel));info.setPadding(dp(17),dp(16),dp(17),dp(16));put(l,info,22);
 put(l,btn("فحص وتحديث النظام",0xff006d61,v->update()),20);
 put(l,btn("إعادة فحص الجهاز",0xff31455f,v->scan()),10);
 put(l,btn("نسخ تقرير التوافق",0xff31455f,v->copy()),10);
 put(l,text("ملاحظة: لا يجري البرنامج تفليشًا أو حذفًا للملفات؛ تثبيت إصدار أحدث يتطلب رومًا أصليًا مطابقًا للوحة والبانل.",15,0xffffc77a),22);scan();}
 static String s(String x){return x==null||x.trim().isEmpty()?"غير معروف":x;}
 String root(){for(String p:new String[]{"/system/xbin/su","/system/bin/su","/sbin/su","/su/bin/su"})if(new File(p).exists())return "يوجد ملف روت محتمل";return "لا توجد مؤشرات روت شائعة (غير قاطع)";}
 String getp(String key){try{java.lang.Process p=new ProcessBuilder("getprop",key).start();BufferedReader r=new BufferedReader(new InputStreamReader(p.getInputStream()));String x=r.readLine();r.close();p.destroy();return s(x);}catch(Exception e){return "غير متاح";}}
 void scan(){String a=Build.BOARD,h=Build.HARDWARE,m=Build.MODEL;report="تقرير شاشة أندرويد\\n"+"الشركة: "+s(Build.MANUFACTURER)+"\\n"+"الموديل: "+s(m)+"\\n"+"اللوحة: "+s(a)+"\\n"+"الجهاز: "+s(Build.DEVICE)+"\\n"+"العتاد: "+s(h)+"\\n"+"المنتج: "+s(Build.PRODUCT)+"\\n"+"معالج: "+s(Build.CPU_ABI)+"\\n"+"SoC: "+getp("ro.board.platform")+"\\n"+"Android: "+s(Build.VERSION.RELEASE)+" / API "+Build.VERSION.SDK_INT+"\\n"+"Kernel: "+System.getProperty("os.version","غير معروف")+"\\n"+"Build: "+s(Build.DISPLAY)+"\\n"+"Fingerprint: "+s(Build.FINGERPRINT)+"\\n"+"الروت: "+root()+"\\n"+"Firmware مطابق: لم يتم التحقق من توفره";info.setText("الموديل: "+s(m)+"\\nAndroid: "+Build.VERSION.RELEASE+" (API "+Build.VERSION.SDK_INT+")\\nاللوحة: "+s(a)+"\\nالعتاد: "+s(h)+"\\nالمعالج: "+s(Build.CPU_ABI)+"\\nإصدار البناء: "+s(Build.DISPLAY)+"\\nالروت: "+root()+"\\n\\nالتحديث الأحدث: غير مؤكد توفره");}
 void copy(){ClipboardManager cb=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(cb!=null){cb.setPrimaryClip(ClipData.newPlainText("تقرير الجهاز",report));Toast.makeText(this,"تم نسخ التقرير",Toast.LENGTH_LONG).show();}}
 Intent updater(){Intent imp=new Intent("android.settings.SYSTEM_UPDATE_SETTINGS");List<ResolveInfo> apps=getPackageManager().queryIntentActivities(imp,0);for(ResolveInfo r:apps){if(r.activityInfo==null||r.activityInfo.applicationInfo==null)continue;int flags=r.activityInfo.applicationInfo.flags;if((flags&(ApplicationInfo.FLAG_SYSTEM|ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))!=0){Intent e=new Intent(imp);e.setClassName(r.activityInfo.packageName,r.activityInfo.name);return e;}}return null;}
 void update(){scan();final Intent i=updater();boolean supported=i!=null;new AlertDialog.Builder(this).setTitle("فحص التحديث الرسمي").setMessage(supported?"وجدت واجهة نظام للتحديث. سيتم فتح إعدادات تحديث الشركة، ولا يعني ذلك توفر نظام أحدث.":"لم تظهر واجهة تحديث أصلية معروفة. لا يمكن لبرنامج مثبت كـ APK عادي تفليش إصدار نظام جديد؛ يلزم ملف شركة مطابق وطريقة Recovery أو USB موثقة.").setNegativeButton("إغلاق",null).setPositiveButton(supported?"فتح تحديث الشركة":"معلومات الجهاز",(d,w)->{try{startActivity(supported?i:new Intent(Settings.ACTION_DEVICE_INFO_SETTINGS));}catch(Exception e){Toast.makeText(this,"تعذر فتح الإعدادات",Toast.LENGTH_LONG).show();}}).show();}
}