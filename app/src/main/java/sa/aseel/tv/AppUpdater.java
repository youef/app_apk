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
import android.os.Handler;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.LinearLayout;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
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
    private final Activity activity;
    private final SharedPreferences preferences;
    private final Handler handler=new Handler();
    private final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
    private boolean checking,downloading,verifying,installAfterPermission;
    private boolean active,stopped,verified,installerOpened,prompting;
    private long downloadId=-1;
    private JSONObject selected;
    private AlertDialog progressDialog;
    private ProgressBar progressBar;
    private TextView progressText;
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
        if(!active||stopped||checking||downloading||verifying||prompting||installAfterPermission)return;
        if(downloadId>0){
            if(manual&&verified){installerOpened=false;showInstallPrompt();}
            return;
        }
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
                con.setInstanceFollowRedirects(false);
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
                if(stopped||!active||activity.isFinishing())return;
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
        String notes=selected.optString("notes","").trim();
        if(notes.length()>1600)notes=notes.substring(0,1600);
        prompting=true;
        AlertDialog dialog=new AlertDialog.Builder(activity)
            .setTitle("تحديث جديد للعز TV")
            .setMessage("الإصدار "+version+" متاح."+(notes.isEmpty()?"":"\n\n"+notes)+
                "\n\nسيتم التحقق من الحزمة قبل فتح مثبت Android.")
            .setPositiveButton("تنزيل وتحديث",new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface d,int w){beginDownload();}
            })
            .setNegativeButton("لاحقًا",new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface d,int w){
                    preferences.edit().putInt("snoozed_version",versionCode)
                        .putLong("snoozed_until",System.currentTimeMillis()+6L*60L*60L*1000L).apply();
                }
            }).create();
        dialog.setOnDismissListener(d->prompting=false);
        dialog.show();
    }
    /** DownloadManager survives process restarts; recover an approved pending release. */
    private void rememberDownload(){
        if(selected!=null && downloadId>0)
            preferences.edit().putLong("download_id",downloadId)
                .putString("release_json",selected.toString()).apply();
    }
    private void forgetDownload(){
        downloadId=-1;
        verified=false;
        installerOpened=false;
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
    private void showProgress(String message,int percent){
        if(activity.isFinishing()||!active)return;
        if(progressDialog==null){
            LinearLayout body=new LinearLayout(activity);
            body.setOrientation(LinearLayout.VERTICAL);
            int pad=(int)(20*activity.getResources().getDisplayMetrics().density);
            body.setPadding(pad,pad,pad,pad);
            progressText=new TextView(activity);
            progressText.setTextSize(16);
            body.addView(progressText);
            progressBar=new ProgressBar(activity,null,android.R.attr.progressBarStyleHorizontal);
            progressBar.setMax(100);
            body.addView(progressBar,new LinearLayout.LayoutParams(-1,-2));
            progressDialog=new AlertDialog.Builder(activity)
                .setTitle("تحديث العز TV")
                .setView(body)
                .setNegativeButton("إخفاء",null).create();
            progressDialog.setOnDismissListener(d->{progressDialog=null;progressBar=null;progressText=null;});
            progressDialog.show();
        }
        progressText.setText(message);
        progressBar.setIndeterminate(percent<0);
        if(percent>=0)progressBar.setProgress(Math.max(0,Math.min(100,percent)));
    }
    private static String downloadError(int reason){
        switch(reason){
            case DownloadManager.ERROR_INSUFFICIENT_SPACE:return "مساحة التخزين غير كافية";
            case DownloadManager.ERROR_DEVICE_NOT_FOUND:return "مساحة التنزيل غير متاحة على هذا التلفزيون";
            case DownloadManager.ERROR_CANNOT_RESUME:return "تعذر استكمال التنزيل؛ أعد المحاولة";
            case DownloadManager.ERROR_HTTP_DATA_ERROR:return "تعذر قراءة بيانات الخادم";
            case DownloadManager.ERROR_TOO_MANY_REDIRECTS:return "تحويلات تنزيل كثيرة";
            case DownloadManager.ERROR_UNHANDLED_HTTP_CODE:return "رفض خادم الإصدارات التنزيل";
            case DownloadManager.ERROR_FILE_ERROR:return "خطأ في حفظ ملف التحديث";
            default:return "رمز خطأ التنزيل: "+reason;
        }
    }
    private void beginDownload(){
        if(selected==null || downloading)return;
        try{
            DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if(manager==null)throw new java.io.IOException("مدير التنزيل غير متاح");
            // Let Android DownloadManager manage its own cache directory.
            // Android TV firmware may prohibit /Android/data even for the owning app.
            DownloadManager.Request request=new DownloadManager.Request(Uri.parse(selected.getString("download_url")));
            request.setTitle("العز TV — تحديث رسمي");
            request.setDescription(selected.optString("version_name","نسخة أحدث"));
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            downloadId=manager.enqueue(request);
            rememberDownload();
            downloading=true;
            handler.removeCallbacks(progress);
            handler.postDelayed(progress,1300L);
            showProgress("بدء تنزيل تحديث العز TV...",-1);
            say("بدأ تنزيل التحديث. ستبقى بياناتك محفوظة عند تثبيته على النسخة نفسها.");
        }catch(Exception e){downloadId=-1;downloading=false;forgetDownload();say("فشل بدء التنزيل: "+e.getMessage());}
    }
    private void pollDownload(){
        if(!active||!downloading||downloadId<0||activity.isFinishing())return;
        DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
        Cursor cursor=null;
        try{
            cursor=manager.query(new DownloadManager.Query().setFilterById(downloadId));
            if(cursor==null||!cursor.moveToFirst())throw new java.io.IOException("لم يعد التنزيل موجودًا");
            int state=cursor.getInt(cursor.getColumnIndex(DownloadManager.COLUMN_STATUS));
            long total=cursor.getLong(cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            long done=cursor.getLong(cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            int percent=total>0?(int)Math.min(100,done*100/total):-1;
            if(state==DownloadManager.STATUS_SUCCESSFUL){
                downloading=false;
                showProgress("اكتمل التنزيل • جارٍ التحقق من سلامة APK والتوقيع...",100);
                verifyAndInstall();
                return;
            }
            if(state==DownloadManager.STATUS_FAILED){
                int reason=cursor.getInt(cursor.getColumnIndex(DownloadManager.COLUMN_REASON));
                throw new java.io.IOException(downloadError(reason));
            }
            showProgress((state==DownloadManager.STATUS_PAUSED?"التنزيل متوقف مؤقتًا":"جارٍ تنزيل APK")+
                (percent<0?"...":" • "+percent+"٪"),percent);
        }catch(Exception e){downloading=false;forgetDownload();showProgress("فشل التنزيل: "+e.getMessage(),0);say("تعذر تنزيل التحديث: "+e.getMessage());return;}
        finally{if(cursor!=null)cursor.close();}
        handler.postDelayed(progress,2500L);
    }
    private void verifyAndInstall(){
        final JSONObject release=selected;
        verifying=true;
        worker.execute(new Runnable(){public void run(){
            boolean valid=false;String error="";
            try{
                DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
                if(manager==null||downloadId<=0)throw new java.io.IOException("التنزيل غير متاح");
                Uri downloaded=manager.getUriForDownloadedFile(downloadId);
                if(downloaded==null || !"content".equals(downloaded.getScheme()))
                    throw new java.io.IOException("لم يتم العثور على ملف APK المكتمل");
                // Copy to private cache solely for Android package signature verification.
                // Never rely on an /Android/data external directory.
                File apk=new File(activity.getCacheDir(),"al-ezz-verify-update.apk");
                MessageDigest digest=MessageDigest.getInstance("SHA-256");
                long length=0;
                try{
                    InputStream in=activity.getContentResolver().openInputStream(downloaded);
                    if(in==null)throw new java.io.IOException("تعذر قراءة الملف من مدير التنزيل");
                    try{
                        java.io.FileOutputStream out=new java.io.FileOutputStream(apk);
                        try{
                            byte[] bytes=new byte[32768];int n;
                            while((n=in.read(bytes))!=-1){
                                length+=n;
                                if(length>500L*1024L*1024L)throw new java.io.IOException("حجم التحديث غير صالح");
                                digest.update(bytes,0,n);
                                out.write(bytes,0,n);
                            }
                        }finally{out.close();}
                    }finally{in.close();}
                    if(length<1024)throw new java.io.IOException("APK غير مكتمل");
                    StringBuilder hex=new StringBuilder();
                    for(byte b:digest.digest())hex.append(String.format(java.util.Locale.US,"%02x",b&255));
                    if(!hex.toString().equalsIgnoreCase(release.optString("sha256","")))
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
                }finally{
                    if(apk.exists()&&!apk.delete())Log.w(TAG,"Could not delete temporary verification APK");
                }
            }catch(Exception e){error=e.getMessage()==null?"تعذر التحقق من APK":e.getMessage();Log.e(TAG,"APK verification rejected",e);}
            final boolean ok=valid;final String problem=error;
            handler.post(new Runnable(){public void run(){
                verifying=false;
                if(stopped||activity.isFinishing())return;
                verified=ok;
                if(ok){showProgress("✓ التحقق من بصمة الملف وشهادة التوقيع اكتمل",100);showInstallPrompt();}
                else {forgetDownload();showProgress("فشل التحقق: "+problem,0);say("تم رفض التحديث للحماية: "+problem);}
            }});
        }});
    }
    private void showInstallPrompt(){
        if(!active||!verified||prompting||installerOpened||installAfterPermission)return;
        prompting=true;
        AlertDialog dialog=new AlertDialog.Builder(activity)
            .setTitle("اكتمل تنزيل التحديث")
            .setMessage("تم التحقق من الملف. افتح مثبت Android لإكمال التحديث.")
            .setPositiveButton("فتح المثبت",(d,w)->requestInstall())
            .setNegativeButton("لاحقًا",(d,w)->installerOpened=true)
            .create();
        dialog.setOnCancelListener(d->installerOpened=true);
        dialog.setOnDismissListener(d->prompting=false);
        dialog.show();
    }
    private void requestInstall(){
        if(Build.VERSION.SDK_INT>=26&&!activity.getPackageManager().canRequestPackageInstalls()){
            new AlertDialog.Builder(activity)
                .setTitle("السماح بتثبيت تحديثات العز TV")
                .setMessage("فعّل «السماح من هذا المصدر» في إعدادات Android، ثم عد للتطبيق. يتطلب التثبيت موافقتك النهائية.")
                .setPositiveButton("فتح الإعدادات",new android.content.DialogInterface.OnClickListener(){
                    public void onClick(android.content.DialogInterface d,int w){
                        try{
                            installAfterPermission=true;
                            Intent intent=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:"+activity.getPackageName()));
                            activity.startActivity(intent);
                        }catch(Exception e){installAfterPermission=false;say("افتح إعدادات الجهاز واسمح بتثبيت التطبيقات من هذا المصدر.");}
                    }
                }).setNegativeButton("إلغاء",(d,w)->installerOpened=true).show();
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
            installerOpened=true;
        }catch(Exception e){say("لا يوجد مثبت APK متوافق على الجهاز: "+e.getMessage());}
    }
    public void onResume(){
        active=true;
        restoreDownload();
        if(installAfterPermission){
            installAfterPermission=false;
            if(Build.VERSION.SDK_INT<26||activity.getPackageManager().canRequestPackageInstalls())requestInstall();
            else installerOpened=true;
        }
        handler.removeCallbacks(progress);
        if(downloading)handler.postDelayed(progress,500L);
        else showInstallPrompt();
    }
    public void onPause(){active=false;handler.removeCallbacks(progress);}
    public void stop(){
        stopped=true;handler.removeCallbacksAndMessages(null);worker.shutdownNow();
        if(progressDialog!=null){progressDialog.dismiss();progressDialog=null;}
    }
}
