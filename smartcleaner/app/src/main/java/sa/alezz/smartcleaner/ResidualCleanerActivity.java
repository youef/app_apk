package sa.alezz.smartcleaner;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Environment;
import android.os.StatFs;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * API 19. Non-root, explicit consent. Only pre-authorized external-storage locations.
 * Never touches /system, /data/data, PackageManager database, or installed-app folders.
 */
public class ResidualCleanerActivity extends Activity {
    private final ArrayList<Candidate> candidates = new ArrayList<Candidate>();
    private TextView info;
    private Button scanButton, reviewButton;
    private volatile boolean busy = false;
    private File sd;
    private static final int MAX_ITEMS = 100;
    private static final int MAX_NODES = 18000;
    private static final int MAX_APKS = 40;
    private static class Candidate {
        File file; String kind, packageName, reason; long bytes; int files;
        Candidate(File f,String k,String p,String why,long b,int count) {
            file=f;kind=k;packageName=p;reason=why;bytes=b;files=count;
        }
    }
    private static class Measure { long bytes; int files; boolean clipped; }
    private static class Deletion { long bytes; int files; int failures; }
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        sd = Environment.getExternalStorageDirectory();
        ScrollView sc = new ScrollView(this);
        sc.setFillViewport(true);
        sc.setBackgroundColor(Color.rgb(9,19,34));
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(22),dp(16),dp(22),dp(20));
        sc.addView(layout);
        setContentView(sc);
        label(layout,"منظف آثار التطبيقات المحذوفة",24);
        label(layout,"النسخة 2 • Android 4.4.4 • تعمل بالريموت • بدون روت",15);
        info=label(layout,"لم يبدأ الفحص. لن تُحذف أي ملفات دون اختيارها وتأكيد الحذف.",17);
        scanButton=button(layout,"1 • فحص البقايا وملفات APK القديمة",new View.OnClickListener() {
            @Override public void onClick(View v){scan();}
        });
        reviewButton=button(layout,"2 • مراجعة الملفات واختيار ما يُحذف",new View.OnClickListener() {
            @Override public void onClick(View v){review();}
        });
        reviewButton.setEnabled(false);
        button(layout,"3 • شرح التعارض ومعلومات الحماية",new View.OnClickListener() {
            @Override public void onClick(View v){explain();}
        });
        button(layout,"العودة لفحص الذاكرة والروت",new View.OnClickListener() {
            @Override public void onClick(View v){finish();}
        });
        label(layout,"⚠ لا يزيل معرّفات التطبيقات من النظام ولا يمسح بيانات التطبيقات الحالية. لن تُحذف أي بيانات دون موافقتك.",13);
        scanButton.requestFocus();
    }
    private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+0.5f);}
    private TextView label(LinearLayout l,String s,int size){
        TextView t=new TextView(this);
        t.setText(s);t.setTextColor(-1);t.setTextSize(size);t.setGravity(Gravity.RIGHT);
        t.setPadding(dp(9),dp(11),dp(9),dp(11));l.addView(t);return t;
    }
    private Button button(LinearLayout l,String name,View.OnClickListener cb){
        Button b=new Button(this);b.setText(name);b.setTextSize(19);b.setAllCaps(false);
        b.setFocusable(true);b.setTextColor(-1);b.setBackgroundColor(Color.rgb(37,67,110));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(61));
        p.topMargin=dp(5);p.bottomMargin=dp(5);l.addView(b,p);b.setOnClickListener(cb);return b;
    }
    private void dialog(String title,String text){
        new AlertDialog.Builder(this).setTitle(title).setMessage(text).setPositiveButton("حسنًا",null).show();
    }
    private static String human(long v){
        if(v<1024)return v+" B";
        double z=v;int k=0;String[] units={"B","KB","MB","GB"};
        while(z>=1024 && k<3){z/=1024.0;k++;}
        return String.format(Locale.US,"%.1f %s",z,units[k]);
    }
    private boolean storageReady(){return Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState());}
    private Set<String> installed(){
        HashSet<String> names=new HashSet<String>();
        List<PackageInfo> list=getPackageManager().getInstalledPackages(0);
        if(list!=null)for(PackageInfo p:list)if(p.packageName!=null)names.add(p.packageName);
        return names;
    }
    private static String canonical(File f){
        try{return f.getCanonicalPath();}catch(IOException e){return "";}
    }
    private boolean strictlyInside(File file,File base){
        String f=canonical(file),b=canonical(base);
        return b.length()>4 && f.startsWith(b+File.separator) && !file.isHidden();
    }
    private boolean safeCandidate(Candidate c,Set<String> active) {
        if(c==null||!storageReady()||!c.file.exists()||!c.file.canRead())return false;
        File root;
        if("بقايا تطبيق".equals(c.kind)){
            if(c.packageName==null||active.contains(c.packageName))return false;
            if(!c.packageName.matches("[A-Za-z_][A-Za-z0-9_]*([.][A-Za-z_][A-Za-z0-9_]*)+"))return false;
            File data=new File(sd,"Android/data"),obb=new File(sd,"Android/obb");
            String parent=canonical(c.file.getParentFile());
            if(!(parent.equals(canonical(data))||parent.equals(canonical(obb))))return false;
            if(!c.file.getName().equals(c.packageName)||!c.file.isDirectory())return false;
            root=parent.equals(canonical(data))?data:obb;
        }else if("APK قديم".equals(c.kind)||"ملف مؤقت".equals(c.kind)){
            root=downloadRootFor(c.file);
            if(root==null||!c.file.isFile())return false;
            String n=c.file.getName().toLowerCase(Locale.US);
            if("APK قديم".equals(c.kind)&&!n.endsWith(".apk"))return false;
            if("ملف مؤقت".equals(c.kind)&&!(n.endsWith(".tmp")||n.endsWith(".part")||n.endsWith(".crdownload")||n.endsWith(".log")||n.endsWith(".bak")))return false;
        }else return false;
        return strictlyInside(c.file,root);
    }
    private File downloadRootFor(File f){
        File[] roots={new File(sd,"Download"),new File(sd,"Downloads"),new File(sd,"APK"),new File(sd,"APKs")};
        for(File root:roots)if(strictlyInside(f,root))return root;
        return null;
    }
    private Measure measure(File start){
        Measure m=new Measure();ArrayDeque<File> stack=new ArrayDeque<File>();stack.add(start);
        int nodes=0;
        String base=canonical(start);
        while(!stack.isEmpty()&&nodes<MAX_NODES){
            File f=stack.removeLast();nodes++;
            String p=canonical(f);
            if(!p.equals(base)&&!p.startsWith(base+File.separator))continue;
            if(f.isDirectory()){
                File[] arr=f.listFiles();
                if(arr!=null)for(File child:arr)if(nodes+stack.size()<MAX_NODES)stack.add(child);
            }else if(f.isFile()){
                m.bytes+=Math.max(0,f.length());m.files++;
            }
        }
        m.clipped=!stack.isEmpty();return m;
    }
    private void add(ArrayList<Candidate> found,File file,String kind,String pkg,String why){
        if(found.size()>=MAX_ITEMS||!file.exists())return;
        Measure s=measure(file);
        Candidate c=new Candidate(file,kind,pkg,why,s.bytes,s.files);
        if(s.clipped)c.reason+=" • الحجم تقديري";
        found.add(c);
    }
    private void scanOrphanFolder(ArrayList<Candidate> found,Set<String> active,File parent) {
        File[] children=parent.listFiles();if(children==null)return;
        for(File d:children){
            if(found.size()>=MAX_ITEMS)break;
            String n=d.getName();
            if(!d.isDirectory()||!n.matches("[A-Za-z_][A-Za-z0-9_]*([.][A-Za-z_][A-Za-z0-9_]*)+"))continue;
            if(active.contains(n)||n.equals(getPackageName()))continue;
            Candidate check=new Candidate(d,"بقايا تطبيق",n,"مجلد لحزمة غير مثبتة حاليًا",0,0);
            if(!safeCandidate(check,active))continue;
            add(found,d,"بقايا تطبيق",n,"حزمة غير موجودة بقائمة التطبيقات المثبتة؛ قد تحتوي بيانات مهمة");
        }
    }
    private void scanDownloads(ArrayList<Candidate> found,File dir,int depth,int[] foundApk){
        if(depth>2||found.size()>=MAX_ITEMS||foundApk[0]>=MAX_APKS)return;
        File[] files=dir.listFiles();if(files==null)return;
        for(File f:files){
            if(found.size()>=MAX_ITEMS)break;
            if(!strictlyInside(f,dir) && depth==0)continue;
            if(f.isDirectory()){
                if(depth<2)scanDownloads(found,f,depth+1,foundApk);
                continue;
            }
            if(!f.isFile())continue;
            String name=f.getName().toLowerCase(Locale.US);
            if(name.endsWith(".apk") && foundApk[0]<MAX_APKS){
                String why="مثبّت APK محفوظ؛ قد تحتاجه لإعادة التثبيت";
                try{
                    PackageInfo pi=getPackageManager().getPackageArchiveInfo(f.getAbsolutePath(),0);
                    if(pi!=null)why+=" • "+pi.packageName;
                    else why+=" • تعذر قراءته بهذا الإصدار (ليس دليلًا على التلف)";
                }catch(Exception ignored){}
                add(found,f,"APK قديم",null,why);foundApk[0]++;
            }else if(name.endsWith(".tmp")||name.endsWith(".part")||name.endsWith(".crdownload")||name.endsWith(".log")||name.endsWith(".bak")){
                // Files may be user backups. Never selected by default.
                add(found,f,"ملف مؤقت",null,"ملف غير ضروري محتمل؛ افحصه قبل الحذف");
            }
        }
    }
    private void scan(){
        if(busy)return;
        if(!storageReady()){
            dialog("التخزين غير جاهز","وصل وحدة التخزين وانتظر حتى تصبح قابلة للكتابة.");return;
        }
        busy=true;scanButton.setEnabled(false);reviewButton.setEnabled(false);
        info.setText("جارٍ فحص المجلدات الخارجية ومقارنتها بالتطبيقات المثبتة...");
        new Thread(new Runnable(){@Override public void run(){
            final ArrayList<Candidate> found=new ArrayList<Candidate>();
            String fail=null;int installedCount=0;
            try{
                Set<String> active=installed();
                installedCount=active.size();
                if(active.isEmpty())throw new IOException("لا يمكن قراءة حزم النظام؛ أُلغي فحص البقايا.");
                scanOrphanFolder(found,active,new File(sd,"Android/data"));
                scanOrphanFolder(found,active,new File(sd,"Android/obb"));
                int[] apks={0};
                scanDownloads(found,new File(sd,"Download"),0,apks);
                scanDownloads(found,new File(sd,"Downloads"),0,apks);
                scanDownloads(found,new File(sd,"APK"),0,apks);
                scanDownloads(found,new File(sd,"APKs"),0,apks);
                Collections.sort(found,new Comparator<Candidate>(){
                    public int compare(Candidate a,Candidate b){
                        return a.kind.compareTo(b.kind);
                    }
                });
            }catch(Exception ex){fail=ex.getMessage()==null?ex.getClass().getSimpleName():ex.getMessage();}
            final String error=fail;final int apps=installedCount;
            runOnUiThread(new Runnable(){@Override public void run(){
                busy=false;scanButton.setEnabled(true);candidates.clear();
                if(error!=null){info.setText("تعذر إكمال الفحص: "+error);return;}
                candidates.addAll(found);
                int orphan=0,apk=0,tmp=0;long bytes=0;
                for(Candidate c:found){
                    if("بقايا تطبيق".equals(c.kind))orphan++;
                    else if("APK قديم".equals(c.kind))apk++;
                    else tmp++;
                    bytes+=c.bytes;
                }
                reviewButton.setEnabled(!found.isEmpty());
                info.setText("نتيجة الفحص:\nالتطبيقات المثبتة: "+apps+
                    "\nمجلدات حزم غير مثبتة: "+orphan+
                    "\nملفات APK محفوظة: "+apk+
                    "\nملفات تحميل مؤقتة: "+tmp+
                    "\nالحجم المرصود تقريبًا: "+human(bytes)+
                    "\nلا شيء محدد للحذف تلقائيًا. افحص العناصر واختر بنفسك."+
                    (found.size()>=MAX_ITEMS?"\nبلغت حد الفحص الآمن 100 عنصر.":""));
            }});
        }}).start();
    }
    private void review(){
        if(busy||candidates.isEmpty())return;
        final String[] labels=new String[candidates.size()];
        final boolean[] marked=new boolean[candidates.size()];
        for(int i=0;i<candidates.size();i++){
            Candidate c=candidates.get(i);
            labels[i]=c.kind+" • "+human(c.bytes)+"\n"+c.file.getAbsolutePath()+
                "\n"+c.reason;
        }
        new AlertDialog.Builder(this)
            .setTitle("اختر البقايا المراد حذفها — كلها غير محددة")
            .setMultiChoiceItems(labels,marked,new DialogInterface.OnMultiChoiceClickListener(){
                @Override public void onClick(DialogInterface d,int which,boolean checked){marked[which]=checked;}
            })
            .setNegativeButton("إلغاء",null)
            .setPositiveButton("مراجعة المحدد",new DialogInterface.OnClickListener(){
                @Override public void onClick(DialogInterface d,int w){
                    final ArrayList<Candidate> selected=new ArrayList<Candidate>();
                    long bytes=0;
                    for(int i=0;i<marked.length;i++)if(marked[i]){
                        selected.add(candidates.get(i));bytes+=candidates.get(i).bytes;
                    }
                    if(selected.isEmpty()){dialog("لم تحدد عناصر","اختر عناصر محددة تريد التخلص منها.");return;}
                    final String summary="ستحذف "+selected.size()+" عنصرًا (حوالي "+human(bytes)+
                        ").\nقد تحتوي مجلدات التطبيقات المحذوفة على تنزيلات أو إعدادات قابلة للاستعادة.\n"+
                        "لا يمكن التراجع عن الحذف. لن يُستخدم الروت.";
                    new AlertDialog.Builder(ResidualCleanerActivity.this)
                        .setTitle("تأكيد الحذف النهائي").setMessage(summary)
                        .setNegativeButton("تراجع",null)
                        .setPositiveButton("حذف المحدد",new DialogInterface.OnClickListener(){
                            @Override public void onClick(DialogInterface dlg,int which){deleteSelected(selected);}
                        }).show();
                }
            }).show();
    }
    private boolean deleteRecursive(File f,File base,Deletion counter,int depth){
        if(depth>35){counter.failures++;return false;}
        String path=canonical(f),root=canonical(base);
        if(!path.equals(root)&&!path.startsWith(root+File.separator)){
            counter.failures++;return false;
        }
        boolean all=true;
        if(f.isDirectory()){
            File[] children=f.listFiles();
            if(children==null){counter.failures++;return false;}
            for(File x:children)if(!deleteRecursive(x,base,counter,depth+1))all=false;
        }else if(f.isFile()){
            long length=f.length();
            if(f.delete()){counter.files++;counter.bytes+=Math.max(0,length);return true;}
            counter.failures++;return false;
        }
        if(all && f.delete())return true;
        counter.failures++;return false;
    }
    private void deleteSelected(final ArrayList<Candidate> selected){
        if(busy)return;
        busy=true;scanButton.setEnabled(false);reviewButton.setEnabled(false);
        info.setText("جارٍ حذف العناصر المحددة فقط...");
        new Thread(new Runnable(){@Override public void run(){
            Deletion result=new Deletion();
            try{
                Set<String> active=installed();
                if(active.isEmpty())throw new IOException("تعذر التحقق من التطبيقات المثبتة.");
                for(Candidate c:selected){
                    if(!safeCandidate(c,active)){result.failures++;continue;}
                    // Re-validate package status immediately before deleting each directory.
                    if(c.packageName!=null){
                        try{getPackageManager().getPackageInfo(c.packageName,0);result.failures++;continue;}
                        catch(PackageManager.NameNotFoundException uninstalled){}
                    }
                    deleteRecursive(c.file,c.file,result,0);
                }
            }catch(Exception ex){result.failures++;}
            final Deletion done=result;
            runOnUiThread(new Runnable(){@Override public void run(){
                busy=false;scanButton.setEnabled(true);candidates.clear();
                reviewButton.setEnabled(false);
                info.setText("انتهى التنظيف:\nملفات محذوفة: "+done.files+
                    "\nالمساحة المحررة تقريبًا: "+human(done.bytes)+
                    "\nعناصر تعذر حذفها أو تم تجاهلها: "+done.failures+
                    "\nأعد الفحص للتأكد من الباقي. لم تُمس ملفات النظام.");
            }});
        }}).start();
    }
    private void explain(){
        dialog("ما الذي يمكن تنظيفه؟",
            "1) Android/data و Android/obb: عرض مجلدات حزم لا تظهر ضمن التطبيقات المثبتة.\n"+
            "2) Download: عرض APK قديم وملفات تحميل مؤقتة.\n"+
            "3) الملفات من نوع .so و .dex و .jar قد توجد داخل المجلدات المتروكة. "+
            "لا يمكن الجزم بأنها تالفة من الامتداد وحده.\n\n"+
            "تعذر تثبيت APK قد ينتج عن اختلاف التوقيع أو تكرار معرف الحزمة أو نقص المساحة "+
            "أو إصدار أندرويد غير مدعوم. حذف مجلدات التخزين لن يصلح قاعدة بيانات الحزم "+
            "أو توقيع التطبيق.\n\n"+
            "بدون روت: لا وصول إلى /data/data أو /system/lib أو ملفات تثبيت النظام.");
    }
}
