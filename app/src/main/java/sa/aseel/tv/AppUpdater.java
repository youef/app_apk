package sa.aseel.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import javax.net.ssl.HttpsURLConnection;

/**
 * Consent-based, in-place updater for the permanently signed Al Ezz TV package.
 *
 * The manifest is published only after a signed release has passed verification.
 * Never install an experimental or differently signed APK. Android's package
 * installer is always shown; the app cannot silently bypass user consent.
 */
public final class AppUpdater {
    private static final String TAG="AlezzUpdater";
    private static final String FEED="https://raw.githubusercontent.com/youef/app_apk/main/data/android-update.json";
    private static final String PACKAGE="sa.alezz.tv";
    private static final long CHECK_EVERY_MS=30L*60L*1000L;
    private static final String FILENAME="al-ezz-tv-stable-update.apk";
    private final Activity activity;
    private final SharedPreferences preferences;
    private final Handler handler=new Handler();
    private final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
    private boolean checking=false,downloading=false,installAfterPermission=false;
    private long downloadId=-1;
    private JSONObject selected;
    private final Runnable progress=new Runnable(){public void run(){pollDownload();}};

    public AppUpdater(Activity activity){
        this.activity=activity;
        this.preferences=activity.getSharedPreferences("alezz_stable_updates_v1",Context.MODE_PRIVATE);
    }
    private void say(final String message){
        if(activity.isFinishing())return;
        Toast.makeText(activity,message,Toast.LENGTH_LONG).show();
    }
    private static boolean trustedUrl(String url){
        try{
            Uri uri=Uri.parse(url);
            return "https".equals(uri.getScheme()) && "github.com".equals(uri.getHost()) &&
                uri.getPath()!=null && uri.getPath().startsWith("/youef/app_apk/releases/download/") &&
                uri.getPath().endsWith(".apk") && uri.getQuery()==null && uri.getFragment()==null;
        }catch(Exception e){return false;}
    }
    private int installedVersionCode(){
        try{return activity.getPackageManager().getPackageInfo(activity.getPackageName(),0).versionCode;}
        catch(Exception e){return 0;}
    }
    private String installedVersionName(){
        try{return activity.getPackageManager().getPackageInfo(activity.getPackageName(),0).versionName;}
        catch(Exception e){return "غير معروف";}
    }
    /** Automatic checks are throttled. The settings action always checks afresh. */
    public void check(final boolean manual){
        if(checking||downloading)return;
        if(!PACKAGE.equals(activity.getPackageName())){
            if(manual)say("هذه نسخة تجريبية بمعرّف مختلف؛ التحديث المباشر يتطلب النسخة الثابتة.");
            return;
        }
        if(!manual && System.currentTimeMillis()-preferences.getLong("last_check",0L)<CHECK_EVERY_MS)return;
        checking=true;
        if(manual)say("جارٍ فحص آخر إصدار رسمي...");
        worker.execute(new Runnable(){public void run(){
            JSONObject feed=null;String error="";
            try{
                URL url=new URL(FEED+"?v="+System.currentTimeMillis());
                HttpsURLConnection con=(HttpsURLConnection)url.openConnection();
                con.setSSLSocketFactory(LegacyTls.factory(activity.getApplicationContext()));
                con.setConnectTimeout(10000);con.setReadTimeout(12000);
                con.setUseCaches(false);
                con.setRequestProperty("Accept","application/json");
                con.setRequestProperty("User-Agent","AlEzzTV-StableUpdater");
                try{
                    if(con.getResponseCode()!=200)throw new java.io.IOException("HTTP "+con.getResponseCode());
                    if(!"raw.githubusercontent.com".equals(con.getURL().getHost()) ||
                        !"https".equals(con.getURL().getProtocol()))throw new SecurityException("Update feed host changed");
                    InputStream in=con.getInputStream();
                    try{
                        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] bytes=new byte[2048];int n;
                        while((n=in.read(bytes))!=-1){
                            if(out.size()+n>16384)throw new java.io.IOException("Manifest too large");
                            out.write(bytes,0,n);
                        }
                        feed=new JSONObject(out.toString("UTF-8"));
                    }finally{in.close();}
                }finally{con.disconnect();}
                if(!"stable".equals(feed.optString("channel")) ||
                    !PACKAGE.equals(feed.optString("package_name")))throw new SecurityException("Wrong update channel/package");
                final int version=feed.optInt("version_code",0);
                final String apk=feed.optString("download_url","");
                final String hash=feed.optString("sha256","").toLowerCase(java.util.Locale.US);
                if(version<0 || (version>0 && (!trustedUrl(apk) || !hash.matches("[0-9a-f]{64}"))))
                    throw new SecurityException("Invalid signed release manifest");
                preferences.edit().putLong("last_check",System.currentTimeMillis()).apply();
            }catch(Exception e){error=e.getMessage()==null?"تعذر الاتصال بخادم الإصدارات":e.getMessage();Log.w(TAG,"Update check failed",e);}
            final JSONObject release=feed;final String problem=error;
            handler.post(new Runnable(){public void run(){
                checking=false;
                if(activity.isFinishing())return;
                if(!problem.isEmpty()){
                    if(manual)say("تعذر فحص التحديث: "+problem);
                    return;
                }
                if(release.optInt("version_code",0)==0){
                    if(manual)say("لم يصدر تحديث ثابت جديد بعد. سيظهر هنا بعد اكتمال بناء النسخة وتوقيعها.");
                }else if(release.optInt("version_code",0)>installedVersionCode()){
                    selected=release;
                    showAvailable(manual);
                }else if(manual){
                    say("نسختك محدّثة بالفعل: "+installedVersionName());
                }
            }});
        }});
    }
    private void showAvailable(boolean manual){
        if(activity.isFinishing() || selected==null || downloading)return;
        final int versionCode=selected.optInt("version_code",0);
        if(!manual && preferences.getInt("snoozed_version",-1)==versionCode &&
            System.currentTimeMillis()<preferences.getLong("snoozed_until",0L))return;
        final String version=selected.optString("version_name","جديد");
        new AlertDialog.Builder(activity)
            .setTitle("تحديث جديد للعز TV")
            .setMessage("الإصدار "+version+" متاح. سيتم تنزيل حزمة APK الموقّعة والتحقق من سلامتها، ثم سيطلب Android موافقتك على تثبيتها. لا تحتاج إلى حذف النسخة الحالية.")
            .setPositiveButton("تنزيل وتحديث",new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface d,int w){beginDownload();}
            })
            .setNegativeButton("لاحقًا",new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface d,int w){
                    preferences.edit().putInt("snoozed_version",versionCode)
                        .putLong("snoozed_until",System.currentTimeMillis()+6L*60L*60L*1000L).apply();
                }
            }).show();
    }
    /** DownloadManager survives process restarts; recover an approved pending release. */
    private void rememberDownload(){
        if(selected!=null && downloadId>0)
            preferences.edit().putLong("download_id",downloadId)
                .putString("release_json",selected.toString()).apply();
    }
    private void forgetDownload(){
        preferences.edit().remove("download_id").remove("release_json").apply();
    }
    private void restoreDownload(){
        if(downloadId>0 || downloading || installAfterPermission)return;
        long id=preferences.getLong("download_id",-1L);
        if(id<=0)return;
        try{
            JSONObject saved=new JSONObject(preferences.getString("release_json","{}"));
            if(!PACKAGE.equals(saved.optString("package_name","")) ||
                !"stable".equals(saved.optString("channel","")) ||
                saved.optInt("version_code",0)<=installedVersionCode() ||
                !trustedUrl(saved.optString("download_url","")) ||
                !saved.optString("sha256","").matches("[0-9a-fA-F]{64}"))
                throw new SecurityException("Stored update manifest is no longer valid");
            selected=saved;
            downloadId=id;downloading=true;
            handler.removeCallbacks(progress);
            handler.postDelayed(progress,500L);
        }catch(Exception invalid){forgetDownload();}
    }
    private File outputFile(){
        File dir=activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return dir==null?null:new File(dir,FILENAME);
    }
    private void beginDownload(){
        if(selected==null || downloading)return;
        File target=outputFile();
        if(target==null){say("تعذّر الوصول إلى مساحة تنزيل التحديث");return;}
        try{
            DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if(manager==null)throw new java.io.IOException("مدير التنزيل غير متاح");
            // Only app-owned update files, never user media or other downloaded APKs.
            if(target.exists()&&!target.delete())throw new java.io.IOException("تعذر استبدال ملف التحديث المؤقت");
            DownloadManager.Request request=new DownloadManager.Request(Uri.parse(selected.getString("download_url")));
            request.setTitle("العز TV — تحديث رسمي");
            request.setDescription(selected.optString("version_name","نسخة أحدث"));
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(activity,Environment.DIRECTORY_DOWNLOADS,FILENAME);
            downloadId=manager.enqueue(request);
            rememberDownload();
            downloading=true;
            handler.removeCallbacks(progress);
            handler.postDelayed(progress,1300L);
            say("بدأ تنزيل التحديث. ستبقى بياناتك محفوظة عند تثبيته على النسخة نفسها.");
        }catch(Exception e){downloadId=-1;downloading=false;forgetDownload();say("فشل بدء التنزيل: "+e.getMessage());}
    }
    private void pollDownload(){
        if(!downloading||downloadId<0||activity.isFinishing())return;
        DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
        Cursor cursor=null;
        try{
            cursor=manager.query(new DownloadManager.Query().setFilterById(downloadId));
            if(cursor==null||!cursor.moveToFirst())throw new java.io.IOException("لم يعد التنزيل موجودًا");
            int state=cursor.getInt(cursor.getColumnIndex(DownloadManager.COLUMN_STATUS));
            if(state==DownloadManager.STATUS_SUCCESSFUL){
                downloading=false;
                verifyAndInstall();
                return;
            }
            if(state==DownloadManager.STATUS_FAILED)throw new java.io.IOException("رفض مدير التنزيل الملف");
        }catch(Exception e){downloading=false;forgetDownload();say("تعذر تنزيل التحديث: "+e.getMessage());return;}
        finally{if(cursor!=null)cursor.close();}
        handler.postDelayed(progress,2500L);
    }
    private void verifyAndInstall(){
        final JSONObject release=selected;
        worker.execute(new Runnable(){public void run(){
            boolean valid=false;String error="";
            try{
                File apk=outputFile();
                if(apk==null||!apk.isFile()||apk.length()<1024)throw new java.io.IOException("APK غير مكتمل");
                MessageDigest digest=MessageDigest.getInstance("SHA-256");
                InputStream in=new FileInputStream(apk);
                try{
                    byte[] bytes=new byte[32768];int n;
                    while((n=in.read(bytes))!=-1)digest.update(bytes,0,n);
                }finally{in.close();}
                StringBuilder hex=new StringBuilder();
                for(byte b:digest.digest())hex.append(String.format(java.util.Locale.US,"%02x",b&255));
                if(!hex.toString().equals(release.optString("sha256","")))
                    throw new SecurityException("بصمة الملف لا تطابق الإصدار الرسمي");
                PackageManager pm=activity.getPackageManager();
                PackageInfo candidate=pm.getPackageArchiveInfo(apk.getAbsolutePath(),PackageManager.GET_SIGNATURES);
                PackageInfo installed=pm.getPackageInfo(activity.getPackageName(),PackageManager.GET_SIGNATURES);
                if(candidate==null||!PACKAGE.equals(candidate.packageName)||
                    candidate.versionCode!=release.optInt("version_code")||
                    candidate.versionCode<=installed.versionCode)
                    throw new SecurityException("حزمة التحديث أو رقم إصدارها غير مطابق");
                if(candidate.signatures==null||candidate.signatures.length!=1||
                    installed.signatures==null||installed.signatures.length!=1||
                    !MessageDigest.isEqual(candidate.signatures[0].toByteArray(),installed.signatures[0].toByteArray()))
                    throw new SecurityException("شهادة توقيع APK مختلفة عن التطبيق المثبت");
                valid=true;
            }catch(Exception e){error=e.getMessage()==null?"تعذر التحقق من APK":e.getMessage();Log.e(TAG,"APK verification rejected",e);}
            final boolean ok=valid;final String problem=error;
            handler.post(new Runnable(){public void run(){
                if(activity.isFinishing())return;
                if(ok)requestInstall(); else {forgetDownload();say("تم رفض التحديث للحماية: "+problem);}
            }});
        }});
    }
    private void requestInstall(){
        if(Build.VERSION.SDK_INT>=26&&!activity.getPackageManager().canRequestPackageInstalls()){
            installAfterPermission=true;
            new AlertDialog.Builder(activity)
                .setTitle("السماح بتثبيت تحديثات العز TV")
                .setMessage("فعّل «السماح من هذا المصدر» في إعدادات Android، ثم عد للتطبيق. يتطلب التثبيت موافقتك النهائية.")
                .setPositiveButton("فتح الإعدادات",new android.content.DialogInterface.OnClickListener(){
                    public void onClick(android.content.DialogInterface d,int w){
                        try{
                            Intent intent=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:"+activity.getPackageName()));
                            activity.startActivity(intent);
                        }catch(Exception e){say("افتح إعدادات الجهاز واسمح بتثبيت التطبيقات من هذا المصدر.");}
                    }
                }).setNegativeButton("إلغاء",null).show();
            return;
        }
        installAfterPermission=false;
        DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
        Uri uri=manager==null?null:manager.getUriForDownloadedFile(downloadId);
        if(uri==null || !"content".equals(uri.getScheme())){
            say("تعذر تسليم الملف لمثبت Android. أعد محاولة التحديث من الإعدادات.");
            return;
        }
        try{
            Intent installer=new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(uri,"application/vnd.android.package-archive");
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(installer);
            forgetDownload();
        }catch(Exception e){say("لا يوجد مثبت APK متوافق على الجهاز: "+e.getMessage());}
    }
    public void onResume(){
        restoreDownload();
        if(installAfterPermission && (Build.VERSION.SDK_INT<26||
            activity.getPackageManager().canRequestPackageInstalls()))requestInstall();
        if(downloading)handler.postDelayed(progress,500L);
    }
    public void stop(){handler.removeCallbacks(progress);worker.shutdownNow();}
}
