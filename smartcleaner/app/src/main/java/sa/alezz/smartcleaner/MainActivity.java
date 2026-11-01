package sa.alezz.smartcleaner;
import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.util.*;
public class MainActivity extends Activity {
  private TextView status, result;
  private Button cleanup;
  private final ArrayList<File> garbage = new ArrayList<File>();
  private long bytes=0;
  private boolean scanning=false;
  private int color=Color.rgb(11,20,37);
  private int dp(int a){return (int)(a*getResources().getDisplayMetrics().density+.5f);}
  private TextView txt(String x,int s){TextView t=new TextView(this);t.setText(x);t.setTextColor(-1);t.setTextSize(s);t.setPadding(dp(9),dp(9),dp(9),dp(9));return t;}
  private Button btn(LinearLayout c,String s,View.OnClickListener v){Button b=new Button(this);b.setText(s);b.setTextSize(18);b.setAllCaps(false);b.setFocusable(true);b.setTextColor(-1);b.setBackgroundColor(Color.rgb(33,68,98));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(58));lp.setMargins(0,dp(5),0,dp(5));c.addView(b,lp);b.setOnClickListener(v);return b;}
  private void alert(String title,String message){new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("حسنًا",null).show();}
  private String size(long n){return String.format(Locale.US,"%.1f MB",n/1048576.0);}
  @Override public void onCreate(Bundle b){super.onCreate(b);
    getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
    ScrollView sc=new ScrollView(this);sc.setFillViewport(true);sc.setBackgroundColor(color);
    LinearLayout col=new LinearLayout(this);col.setOrientation(1);col.setPadding(dp(25),dp(18),dp(25),dp(25));sc.addView(col);setContentView(sc);
    col.addView(txt("SMART Cleaner TV  •  منظف الشاشة",25));
    col.addView(txt("Android 4.4.4 • فحص الجهاز • تنظيف آمن • كشف الروت",15));
    status=txt("",16);col.addView(status);
    btn(col,"تحديث معلومات الشاشة",new View.OnClickListener(){public void onClick(View v){refresh();}});
    result=txt("لم يبدأ الفحص. لا يتم حذف أي ملف تلقائيًا.",16);col.addView(result);
    btn(col,"1 • فحص الملفات المؤقتة",new View.OnClickListener(){public void onClick(View v){scan();}});
    cleanup=btn(col,"2 • حذف الملفات بعد التأكيد",new View.OnClickListener(){public void onClick(View v){clean();}});
    cleanup.setEnabled(false);
    btn(col,"3 • كشف الروت وصلاحيات النظام",new View.OnClickListener(){public void onClick(View v){root();}});
    btn(col,"4 • إدارة التطبيقات",new View.OnClickListener(){public void onClick(View v){try{startActivity(new Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS));}catch(Exception e){alert("الإعدادات","غير مدعومة على هذه الشاشة");}}});
    col.addView(txt("الأزرار تدعم أسهم الريموت وزر OK. لا يحتاج التطبيق إلى الإنترنت أو إلى صلاحيات الروت.",13));
    refresh();
  }
  private void refresh(){
    ActivityManager am=(ActivityManager)getSystemService(ACTIVITY_SERVICE);
    ActivityManager.MemoryInfo mi=new ActivityManager.MemoryInfo();am.getMemoryInfo(mi);
    File storage=Environment.getExternalStorageDirectory();
    StatFs fs=new StatFs(storage.getAbsolutePath());
    long total=(long)fs.getBlockCount()*fs.getBlockSize(),free=(long)fs.getAvailableBlocks()*fs.getBlockSize();
    boolean unknown=Settings.Secure.getInt(getContentResolver(),Settings.Secure.INSTALL_NON_MARKET_APPS,0)==1;
    status.setText("الموديل: "+Build.MODEL+"   |   الشركة: "+Build.MANUFACTURER+"\n"+
        "Android: "+Build.VERSION.RELEASE+" (API "+Build.VERSION.SDK_INT+")\n"+
        "المعالج: "+Build.CPU_ABI+"   |   النواة: "+System.getProperty("os.version")+"\n"+
        "RAM الإجمالية: "+size(mi.totalMem)+"   |   المتاحة: "+size(mi.availMem)+"\n"+
        "التخزين: "+size(free)+" متاح من "+size(total)+"\n"+
        "تثبيت تطبيقات من خارج المتجر: "+(unknown?"مسموح":"غير مسموح أو غير محدد")+"\n"+
        "توافق APK: يحتاج اختبار التثبيت على جهازك.");
  }
  private void collect(File dir,int depth,long now){
    if(depth>5||garbage.size()>=2000||dir==null||!dir.exists())return;
    File[] children=dir.listFiles();if(children==null)return;
    for(File f:children){if(garbage.size()>=2000)break;
      if(f.isDirectory()){collect(f,depth+1,now);continue;}
      if(f.isFile()&&f.lastModified()>0&&now-f.lastModified()>600000){
        garbage.add(f);bytes+=f.length();
      }
    }
  }
  private void scan(){if(scanning)return;scanning=true;garbage.clear();bytes=0;
    result.setText("جارٍ فحص الملفات المؤقتة...");cleanup.setEnabled(false);
    new Thread(new Runnable(){public void run(){
      try{long now=System.currentTimeMillis();
        collect(getCacheDir(),0,now);
        File ext=getExternalCacheDir();if(ext!=null)collect(ext,0,now);
        File root=Environment.getExternalStorageDirectory();
        collect(new File(root,"DCIM/.thumbnails"),0,now);
        collect(new File(root,"Pictures/.thumbnails"),0,now);
        final int count=garbage.size();final long total=bytes;
        runOnUiThread(new Runnable(){public void run(){
          scanning=false;cleanup.setEnabled(count>0);
          result.setText("نتيجة الفحص:\nملفات مؤقتة: "+count+"\nالمساحة الممكن تحريرها: "+size(total)+"\nلن تُحذف الصور الأصلية أو ملفات النظام. اضغط تنظيف للموافقة.");
        }});
      }catch(final Exception ex){runOnUiThread(new Runnable(){public void run(){scanning=false;result.setText("تعذر الفحص: "+ex.getClass().getSimpleName());}});}
    }}).start();
  }
  private void clean(){if(scanning||garbage.isEmpty())return;
    final int n=garbage.size();final long b=bytes;
    new AlertDialog.Builder(this).setTitle("تأكيد التنظيف").setMessage("حذف "+n+" ملف مؤقت (حوالي "+size(b)+")؟\nقد يعيد النظام إنشاء الصور المصغّرة. لا يمكن استرجاع المحذوف.")
      .setNegativeButton("إلغاء",null).setPositiveButton("تنظيف",new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int w){
        scanning=true;cleanup.setEnabled(false);
        new Thread(new Runnable(){public void run(){
          int deleted=0;long freed=0;
          for(File f:new ArrayList<File>(garbage)){try{long length=f.length();if(f.isFile()&&f.delete()){deleted++;freed+=length;}}catch(Exception ignored){}}
          final int done=deleted;final long amount=freed;
          runOnUiThread(new Runnable(){public void run(){scanning=false;garbage.clear();bytes=0;result.setText("تم حذف "+done+" ملف مؤقت وتحرير "+size(amount)+".");refresh();}});
        }}).start();
      }}).show();
  }
  private void root(){
    result.setText("جارٍ اختبار الروت دون تغيير النظام...");
    new Thread(new Runnable(){public void run(){
      boolean mark=false,granted=false;
      String[] paths={"/system/bin/su","/system/xbin/su","/sbin/su","/su/bin/su"};
      for(String s:paths)if(new File(s).exists())mark=true;
      if(Build.TAGS!=null&&Build.TAGS.contains("test-keys"))mark=true;
      java.lang.Process p=null;
      try{p=new ProcessBuilder("su","-c","id").redirectErrorStream(true).start();
        long until=System.currentTimeMillis()+4500;
        while(System.currentTimeMillis()<until){try{int code=p.exitValue();
          BufferedReader r=new BufferedReader(new InputStreamReader(p.getInputStream()));String line=r.readLine();
          granted=code==0&&line!=null&&line.contains("uid=0");break;
        }catch(IllegalThreadStateException e){Thread.sleep(100);}}
      }catch(Exception ignored){}finally{if(p!=null)p.destroy();}
      final String msg=granted?"الروت موجود وتم منح صلاحيات المدير.":
        mark?"تم العثور على مؤشرات للروت لكن الصلاحية غير مؤكدة.":"لم تُكتشف صلاحيات روت فعالة.";
      runOnUiThread(new Runnable(){public void run(){result.setText(msg+"\nلا يمكن إثبات إمكانية عمل روت جديد أو تفليش النظام من هذا الاختبار. لن يغير التطبيق البوتلودر أو ملفات النظام.");}});
    }}).start();
  }
}