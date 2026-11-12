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
    private boolean requiredUpdate=false,launchedInstaller=false;
    private long downloadId=-1;
    private long pausedSinceMs=0L;
    private JSONObject selected;
    private AlertDialog mandatoryDialog;
    private AlertDialog availableDialog;
    private AlertDialog progressDialog;
    private ProgressBar progressBar;
    private TextView progressText;
    private final Runnable progress=new Runnable(){public void run(){pollDownload();}};

    public AppUpdater(Activity activity){
        this.activity=activity;
        this.preferences=activity.getSharedPreferences("alezz_stable_updates_v1",Context.MODE_PRIVATE);
    }
    /** Viewer choice is independent from media/catalog synchronization. */
    public String updateMode(){
        String mode=preferences.getString("update_mode","");
        if("off".equals(mode)||"manual".equals(mode)||"automatic".equals(mode))return mode;
        return preferences.getBoolean("automatic_checks",false)?"automatic":"manual";
    }
    /** Old installations automatically migrate from the original checkbox. */
    public boolean automaticChecksEnabled(){
        return "automatic".equals(updateMode()) && preferences.getBoolean("automatic_checks",false);
    }
    public void setAutomaticChecksEnabled(boolean enabled){
        setUpdateMode(enabled?"automatic":"manual");
    }
    public void setUpdateMode(String mode){
        if(!"off".equals(mode)&&!"manual".equals(mode)&&!"automatic".equals(mode))
            throw new IllegalArgumentException("Unsupported APK update preference");
        preferences.edit().putString("update_mode",mode)
            .putBoolean("automatic_checks","automatic".equals(mode)).apply();
        if(!"automatic".equals(mode)){
            if(availableDialog!=null){availableDialog.dismiss();availableDialog=null;}
            if(mandatoryDialog!=null){mandatoryDialog.dismiss();mandatoryDialog=null;}
            if(hasPendingDownload())cancelPendingDownload();
            requiredUpdate=false;
        }
    }
    public boolean hasPendingDownload(){
        return downloadId>0 || preferences.getLong("download_id",-1L)>0;
    }
    /** Cancels only a download created by this updater; never affects installed data. */
    public void cancelPendingDownload(){
        if(verifying){say("جارٍ فحص سلامة الملف؛ لا يمكن إلغاء العملية أثناء التحقق.");return;}
        handler.removeCallbacks(progress);
        long id=downloadId>0?downloadId:preferences.getLong("download_id",-1L);
        if(id>0){
            try{
                DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
                if(manager!=null)manager.remove(id);
            }catch(Exception e){Log.w(TAG,"Failed to cancel updater-owned download",e);}
        }
        downloading=false;pausedSinceMs=0L;verified=false;
        installAfterPermission=false;launchedInstaller=false;requiredUpdate=false;
        selected=null;
        forgetDownload();
        cleanupTemporaryApks();
        if(progressDialog!=null){progressDialog.dismiss();progressDialog=null;}
        say("تم إيقاف تنزيل التحديث. يمكنك الفحص والتحديث يدويًا من الإعدادات.");
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
    private boolean isRequired(JSONObject feed){
        return feed!=null && (feed.optBoolean("required",false) ||
            feed.optInt("min_supported_version_code",0)>installedVersionCode());
    }
    /** Automatic checks are throttled. The settings action always checks afresh. */
    public void check(final boolean manual){
        if("off".equals(updateMode())){
            if(manual)say("تحديثات APK متوقفة. اختر «يدوي» من الإعدادات أولًا.");
            return;
        }
        if(!manual && !automaticChecksEnabled())return;
        if(!active||stopped||checking||downloading||verifying||prompting||installAfterPermission)return;
        if(downloadId>0){
            if(manual&&verified){installerOpened=false;requestInstall();}
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
                if(stopped||!active||activity.isFinishing() || "off".equals(updateMode()) ||
                    (!manual && !automaticChecksEnabled()))return;
                if(!problem.isEmpty()){
                    if(manual)say("تعذر فحص التحديث: "+problem);
                    return;
                }
                if(release.optInt("version_code",0)==0){
                    if(manual)say("لم يصدر تحديث ثابت جديد بعد. سيظهر هنا بعد اكتمال بناء النسخة وتوقيعها.");
                }else if(release.optInt("version_code",0)>installedVersionCode()){
                    selected=release;
                    // Remote "required" flags must not override a viewer's update preference.
                    requiredUpdate=false;
                    showAvailable(manual);
                }else if(manual){
                    say("نسختك محدّثة بالفعل: "+installedVersionName());
                }
            }});
        }});
    }
    private void showAvailable(boolean manual){
        if(activity.isFinishing() || selected==null || downloading ||
           "off".equals(updateMode()) || (!manual && !automaticChecksEnabled()))return;
        final long now=System.currentTimeMillis();
        final int versionCode=selected.optInt("version_code",0);
        if(!manual && (now-preferences.getLong("last_auto_prompt_at",0L)<7L*24L*60L*60L*1000L ||
           (preferences.getInt("snoozed_version",-1)==versionCode &&
           now<preferences.getLong("snoozed_until",0L))))return;
        final String version=selected.optString("version_name","جديد");
        String notes=selected.optString("notes","").trim();
        if(notes.length()>1600)notes=notes.substring(0,1600);
        prompting=true;
        AlertDialog.Builder builder=new AlertDialog.Builder(activity)
            .setTitle("تحديث اختياري للعز TV")
            .setMessage("الإصدار "+version+" متاح."+(notes.isEmpty()?"":"\n\n"+notes)+
                "\n\nسيُفتح رابط APK الرسمي في متصفح التلفزيون، ثم تفتح ملفه من التنزيلات وتوافق على التثبيت. لا يُنزّل العز TV الملف داخليًا.")
            .setPositiveButton("فتح APK في المتصفح",(d,w)->{
                prompting=false;
                openBrowserDownload();
            })
            .setNegativeButton("لاحقًا",(d,w)->{
                preferences.edit().putInt("snoozed_version",versionCode)
                    .putLong("snoozed_until",System.currentTimeMillis()+7L*24L*60L*60L*1000L).apply();
            });
        AlertDialog dialog=builder.create();
        availableDialog=dialog;
        dialog.setCancelable(true);
        dialog.setOnDismissListener(d->{
            prompting=false;
            if(availableDialog==dialog)availableDialog=null;
        });
        if(!manual)preferences.edit().putLong("last_auto_prompt_at",now).apply();
        dialog.show();
    }
    /** Browser owns the download; Android owns the installer. No DownloadManager pause loop. */
    private void openBrowserDownload(){
        if(selected==null)return;
        final String url=selected.optString("download_url","");
        if(!trustedUrl(url)){
            say("رابط الإصدار غير موثوق؛ لم يُفتح التنزيل.");
            return;
        }
        try{
            Intent browser=new Intent(Intent.ACTION_VIEW,Uri.parse(url));
            browser.addCategory(Intent.CATEGORY_BROWSABLE);
            browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(browser);
            say("نزّل APK في المتصفح، ثم افتح الملف من التنزيلات واختر «تحديث». قد يلزم السماح بالتثبيت من المتصفح.");
        }catch(Exception e){
            Log.w(TAG,"No compatible TV browser for APK download",e);
            new AlertDialog.Builder(activity).setTitle("لا يوجد متصفح متوافق")
                .setMessage("ثبّت متصفحًا على التلفزيون، أو نزّل APK الرسمي من GitHub على جوالك وانقله إلى التلفزيون. لا يمكن تثبيت ملف بدون موافقة Android.")
                .setPositiveButton("حسنًا",null).show();
        }
    }
    /**
     * DownloadManager queries here only return downloads made by our package.
     * Restrict deletion further to signed Al Ezz APK release URLs. Never touch
     * other apps' Downloads, unrelated URLs, installed apps, or user preferences.
     */
    private void cleanupManagedDownloads(long keepId){
        DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
        if(manager==null)return;
        Cursor cursor=null;
        try{
            cursor=manager.query(new DownloadManager.Query());
            if(cursor==null)return;
            int idColumn=cursor.getColumnIndex(DownloadManager.COLUMN_ID);
            int urlColumn=cursor.getColumnIndex(DownloadManager.COLUMN_URI);
            if(idColumn<0||urlColumn<0)return;
            java.util.ArrayList<Long> removed=new java.util.ArrayList<Long>();
            while(cursor.moveToNext()){
                long id=cursor.getLong(idColumn);
                if(id==keepId)continue;
                String url=cursor.getString(urlColumn);
                if(trustedUrl(url))removed.add(id);
            }
            for(Long id:removed){
                try{manager.remove(id.longValue());}
                catch(Exception issue){Log.w(TAG,"Could not purge old update download "+id,issue);}
            }
        }catch(Exception issue){Log.w(TAG,"Could not inspect app-owned updates",issue);}
        finally{if(cursor!=null)cursor.close();}
    }
    /** Remove only the exact temporary files used by previous updater versions. */
    private void cleanupTemporaryApks(){
        File privateCopy=new File(activity.getCacheDir(),"al-ezz-verify-update.apk");
        if(privateCopy.isFile()&&!privateCopy.delete())Log.w(TAG,"Unable to remove cached verification APK");
        File external=activity.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
        if(external!=null){
            File old=new File(external,"al-ezz-tv-stable-update.apk");
            if(old.isFile()&&!old.delete())Log.w(TAG,"Unable to remove legacy updater APK");
        }
    }
    /** DownloadManager survives process restarts; recover an approved pending release. */
    private void rememberDownload(){
        if(selected!=null && downloadId>0)
            preferences.edit().putLong("download_id",downloadId)
                .putString("release_json",selected.toString()).apply();
    }
    private void forgetDownload(){
        downloadId=-1;
        pausedSinceMs=0L;
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
            requiredUpdate=false;
            downloadId=id;downloading=true;
            handler.removeCallbacks(progress);
            handler.postDelayed(progress,500L);
        }catch(Exception invalid){
            // The saved APK cannot update the installed build. Safely purge only
            // app-created update downloads; do not keep obsolete installers.
            cleanupManagedDownloads(-1L);
            cleanupTemporaryApks();
            forgetDownload();
        }
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
                .setNegativeButton("إلغاء التنزيل",(d,w)->cancelPendingDownload()).create();
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
    private static String pausedReason(int reason){
        switch(reason){
            case DownloadManager.PAUSED_WAITING_TO_RETRY:
                return "خادم التنزيل لا يستجيب الآن؛ سيعيد Android المحاولة";
            case DownloadManager.PAUSED_WAITING_FOR_NETWORK:
                return "التنزيل ينتظر اتصال الإنترنت";
            case DownloadManager.PAUSED_QUEUED_FOR_WIFI:
                return "الجهاز ينتظر شبكة Wi-Fi مناسبة";
            default:
                return "أوقف Android مدير التنزيل مؤقتًا";
        }
    }
    private void beginDownload(){
        if(selected==null || downloading)return;
        try{
            DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if(manager==null)throw new java.io.IOException("مدير التنزيل غير متاح");
            // Free storage before fetching a new release; keep no stale installers.
            cleanupManagedDownloads(-1L);
            cleanupTemporaryApks();
            // Let Android DownloadManager manage its own cache directory.
            // Android TV firmware may prohibit /Android/data even for the owning app.
            DownloadManager.Request request=new DownloadManager.Request(Uri.parse(selected.getString("download_url")));
            request.setTitle("العز TV — تحديث رسمي");
            request.setDescription(selected.optString("version_name","نسخة أحدث"));
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            downloadId=manager.enqueue(request);
            pausedSinceMs=0L;
            rememberDownload();
            downloading=true;
            handler.removeCallbacks(progress);
            handler.postDelayed(progress,1300L);
            showProgress("بدء تنزيل تحديث العز TV...",-1);
            say("بدأ تنزيل التحديث. ستبقى بياناتك محفوظة عند تثبيته على النسخة نفسها.");
        }catch(Exception e){
            downloadId=-1;downloading=false;forgetDownload();
            say("فشل بدء التنزيل: "+e.getMessage());
            if(requiredUpdate)handler.postDelayed(()->showAvailable(true),900L);
        }
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
            if(state==DownloadManager.STATUS_PAUSED){
                int reason=cursor.getInt(cursor.getColumnIndex(DownloadManager.COLUMN_REASON));
                if(pausedSinceMs==0L)pausedSinceMs=System.currentTimeMillis();
                String explanation=pausedReason(reason);
                showProgress("متوقف مؤقتًا • "+explanation+(percent<0?"":" • "+percent+"٪"),percent);
                if(System.currentTimeMillis()-pausedSinceMs>60000L){
                    // Firmware DownloadManager sometimes never resumes GitHub redirects.
                    // Cancel only this app's attempt; do not keep a stuck system notification.
                    long id=downloadId;
                    downloading=false;
                    if(id>0)manager.remove(id);
                    forgetDownload();
                    showProgress("تعذر استكمال التنزيل عبر نظام التلفزيون. أعد المحاولة يدويًا من الإعدادات أو نزّل APK الرسمي من GitHub.",0);
                    say("توقف تنزيل التحديث. ألغينا التنزيل العالق؛ التحديث يدوي الآن.");
                    return;
                }
            }else{
                pausedSinceMs=0L;
                showProgress("جارٍ تنزيل APK"+(percent<0?"...":" • "+percent+"٪"),percent);
            }
        }catch(Exception e){
            downloading=false;
            cleanupManagedDownloads(-1L);
            forgetDownload();
            showProgress("فشل التنزيل: "+e.getMessage(),0);
            say("تعذر تنزيل التحديث: "+e.getMessage());
            return;
        }
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
                if(ok){
                    showProgress("✓ تم التحقق من التوقيع • فتح مثبت Android الآن...",100);
                    if(progressDialog!=null){progressDialog.dismiss();progressDialog=null;}
        if(mandatoryDialog!=null){mandatoryDialog.dismiss();mandatoryDialog=null;}
                    // Android must present its own installation confirmation; do not claim silent installation.
                    requestInstall();
                }
                else {
                    cleanupManagedDownloads(-1L);
                    cleanupTemporaryApks();
                    forgetDownload();
                    showProgress("فشل التحقق: "+problem,0);
                    say("تم رفض التحديث للحماية: "+problem);
                }
            }});
        }});
    }
    private void showInstallPrompt(){
        if(!active||!verified||prompting||installerOpened||installAfterPermission)return;
        if(requiredUpdate){requestInstall();return;}
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
                        }catch(Exception e){installAfterPermission=false;
                            say("افتح إعدادات الجهاز واسمح بتثبيت التطبيقات من هذا المصدر: "+e.getMessage());}
                    }
                }).setNegativeButton("رجوع للتطبيق",(d,w)->{
                    installerOpened=false;
                    if(requiredUpdate)handler.postDelayed(()->showInstallPrompt(),700L);
                }).show();
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
            Intent installer=new Intent(Intent.ACTION_INSTALL_PACKAGE);
            installer.setData(uri);
            installer.setClipData(android.content.ClipData.newUri(
                activity.getContentResolver(),"Al Ezz signed APK",uri));
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // Do not use an external downloader: explicitly invoke Android's installer.
            activity.startActivityForResult(installer,2107);
            installerOpened=true;
            launchedInstaller=true;
        }catch(Exception e){
            installerOpened=false;
            say("تعذر فتح مثبت Android: "+e.getMessage());
            // Some legacy Android TV installers handle VIEW instead of INSTALL_PACKAGE.
            try{
                Intent fallback=new Intent(Intent.ACTION_VIEW);
                fallback.setDataAndType(uri,"application/vnd.android.package-archive");
                fallback.setClipData(android.content.ClipData.newUri(activity.getContentResolver(),"Al Ezz APK",uri));
                fallback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivityForResult(fallback,2107);
                installerOpened=true;launchedInstaller=true;
            }catch(Exception failure){say("تعذر تثبيت التحديث على هذا الجهاز: "+failure.getMessage());}
        }
    }
    public void onResume(){
        active=true;
        // When the user returns from the Android installer, only a successfully
        // installed version change permits deletion of the active APK.
        long savedId=preferences.getLong("download_id",-1L);
        if(savedId>0){
            try{
                JSONObject pending=new JSONObject(preferences.getString("release_json","{}"));
                if(installedVersionCode()>=pending.optInt("version_code",Integer.MAX_VALUE)){
                    cleanupManagedDownloads(-1L);
                    cleanupTemporaryApks();
                    forgetDownload();
                    downloading=false;verifying=false;
                    selected=null;requiredUpdate=false;launchedInstaller=false;
                    if(progressDialog!=null){progressDialog.dismiss();progressDialog=null;}
                    say("تم تحديث العز TV وحذف ملفات التحديث القديمة تلقائيًا");
                }
            }catch(Exception ignored){}
        }else{
            cleanupManagedDownloads(-1L);
            cleanupTemporaryApks();
        }
        // New versions use the browser. Clear any abandoned DownloadManager task
        // created by older builds, without changing accounts or media preferences.
        if(hasPendingDownload() && !verifying)cancelPendingDownload();
        if(installAfterPermission){
            installAfterPermission=false;
            if(Build.VERSION.SDK_INT<26||activity.getPackageManager().canRequestPackageInstalls())requestInstall();
            else {
                installerOpened=false;
                if(requiredUpdate)showInstallPrompt();
            }
        }
        if(launchedInstaller&&selected!=null&&installedVersionCode()<selected.optInt("version_code")){
            launchedInstaller=false;
            installerOpened=false;
            verified=true;
            if(requiredUpdate)handler.postDelayed(()->showInstallPrompt(),850L);
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
