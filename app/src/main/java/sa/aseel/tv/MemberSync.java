package sa.aseel.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.util.HashSet;
import java.util.Map;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/**
 * RLS-scoped Supabase cloud sync. Works on API19 without a modern Kotlin SDK.
 * Device-local changes remain in the private outbox until the network accepts
 * them; the server always enforces ownership via the authenticated JWT.
 * Family history is synced now. Kids and guest keep independent local history.
 */
public final class MemberSync {
    private static final ExecutorService WORK=Executors.newSingleThreadExecutor();
    private static final String PREFIX="alezz_member_outbox_";
    private static final String TAG="AlezzMemberSync";
    private static long lastProgressFlush=0L;
    private MemberSync(){}

    private static SharedPreferences pending(Context context){
        return context.getApplicationContext().getSharedPreferences(PREFIX+MemberAuth.userId(context),Context.MODE_PRIVATE);
    }
    private static boolean uuid(String value){
        return value!=null&&value.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }
    private static boolean kind(String value){
        return "movie".equals(value)||"series".equals(value)||
            "episode".equals(value)||"channel".equals(value);
    }
    private static String read(InputStream stream)throws Exception{
        try{
            ByteArrayOutputStream out=new ByteArrayOutputStream();
            byte[] block=new byte[4096];int n;
            while((n=stream.read(block))!=-1){
                if(out.size()+n>256*1024)throw new SecurityException("Sync response too large");
                out.write(block,0,n);
            }
            return out.toString("UTF-8");
        }finally{stream.close();}
    }
    private static String request(Context context,String method,String url,JSONObject record,
                                  boolean merge)throws Exception{
        MemberAuth.ensureFresh(context);
        if(!url.startsWith(AppConfig.API_ROOT))throw new SecurityException("Invalid cloud URL");
        HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection();
        connection.setSSLSocketFactory(LegacyTls.factory(context));
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000);connection.setReadTimeout(12000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("apikey",AppConfig.PUBLISHABLE_KEY);
        connection.setRequestProperty("Authorization","Bearer "+MemberAuth.accessToken(context));
        connection.setRequestProperty("Accept","application/json");
        if(merge)connection.setRequestProperty("Prefer","resolution=merge-duplicates,return=minimal");
        if(record!=null){
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
            connection.setDoOutput(true);
        }
        try{
            if(record!=null){
                byte[] data=record.toString().getBytes("UTF-8");
                OutputStream out=connection.getOutputStream();
                try{out.write(data);}finally{out.close();}
            }
            int code=connection.getResponseCode();
            if(code<200||code>=300)throw new java.io.IOException("Cloud sync HTTP "+code);
            InputStream in=connection.getInputStream();
            return in==null?"":read(in);
        }finally{connection.disconnect();}
    }
    private static String table(String kind){
        return "favorite".equals(kind)?"aseel_favorites":"aseel_watch_progress";
    }
    private static String encoded(String id){return id.replace("-","%2D");}
    private static String root(String name){return AppConfig.API_ROOT+name;}
    private static String filter(String user,String type,String id){
        return "?user_id=eq."+encoded(user)+"&item_type=eq."+type+"&item_id=eq."+encoded(id);
    }
    public static void begin(final Context context){
        if(!MemberAuth.hasSession(context))return;
        WORK.execute(new Runnable(){public void run(){
            try{
                flush(context);
                pull(context);
            }catch(Exception error){Log.w(TAG,"Cloud temporarily unavailable",error);}
        }});
    }
    public static void favorite(Context context,String type,String id,boolean selected){
        if(!kind(type)||!uuid(id)||!MemberAuth.hasSession(context))return;
        pending(context).edit().putString("favorite:"+type+":"+id,selected?"add":"remove").apply();
        final Context app=context.getApplicationContext();
        WORK.execute(new Runnable(){public void run(){try{flush(app);}catch(Exception ignored){}}});
    }
    public static void progress(Context context,String profile,String type,String id,long position,long duration){
        if(!"family".equals(profile)||!kind(type)||!uuid(id)||
           duration<=0||duration>14L*86400000L||position<0||!MemberAuth.hasSession(context))return;
        JSONObject row=new JSONObject();
        try{
            row.put("position_ms",Math.max(0L,Math.min(position,duration)));
            row.put("duration_ms",duration);
            row.put("remove",position>=duration-15000);
        }catch(Exception ignored){return;}
        pending(context).edit().putString("progress:"+type+":"+id,row.toString()).apply();
        long now=android.os.SystemClock.elapsedRealtime();
        if(now-lastProgressFlush<45000L)return;
        lastProgressFlush=now;
        final Context app=context.getApplicationContext();
        WORK.execute(new Runnable(){public void run(){try{flush(app);}catch(Exception ignored){}}});
    }
    private static void flush(Context context)throws Exception{
        String owner=MemberAuth.userId(context);
        if(!uuid(owner))return;
        SharedPreferences queue=pending(context);
        for(Map.Entry<String,?> entry:queue.getAll().entrySet()){
            String key=entry.getKey(),value=entry.getValue() instanceof String?(String)entry.getValue():"";
            String[] parts=key.split(":");
            if(parts.length!=3||!kind(parts[1])||!uuid(parts[2]))continue;
            String t=parts[0],resource=table(t);
            String url=root(resource),where=filter(owner,parts[1],parts[2]);
            JSONObject record=new JSONObject();
            if("favorite".equals(t)){
                if("remove".equals(value))request(context,"DELETE",url+where,null,false);
                else{
                    record.put("user_id",owner);record.put("item_type",parts[1]);record.put("item_id",parts[2]);
                    request(context,"POST",url+"?on_conflict=user_id,item_type,item_id",record,true);
                }
            }else if("progress".equals(t)){
                JSONObject details;
                try{details=new JSONObject(value);}catch(Exception ignored){queue.edit().remove(key).apply();continue;}
                if(details.optBoolean("remove",false)){
                    request(context,"DELETE",url+where,null,false);
                }else{
                    record.put("user_id",owner);record.put("item_type",parts[1]);record.put("item_id",parts[2]);
                    record.put("position_ms",details.optLong("position_ms",0L));
                    record.put("duration_ms",details.optLong("duration_ms",0L));
                    request(context,"POST",url+"?on_conflict=user_id,item_type,item_id",record,true);
                }
            }else continue;
            // Do not discard a newer offline edit for this same item.
            if(value.equals(queue.getString(key,"")))queue.edit().remove(key).apply();
        }
    }
    private static JSONArray load(Context context,String owner,String table)throws Exception{
        String json=request(context,"GET",root(table)+"?user_id=eq."+encoded(owner)+
            "&select=*&limit=300",null,false);
        return new JSONArray(json);
    }
    private static void pull(Context context)throws Exception{
        String owner=MemberAuth.userId(context);
        if(!uuid(owner))return;
        JSONArray favorites=load(context,owner,"aseel_favorites");
        if(!owner.equals(MemberAuth.userId(context)))return;
        HashSet<String> cloud=new HashSet<String>();
        for(int i=0;i<favorites.length();i++){
            JSONObject x=favorites.optJSONObject(i);
            if(x==null)continue;
            String type=x.optString("item_type"),id=x.optString("item_id");
            if(kind(type)&&uuid(id))cloud.add("family."+type+":"+id);
        }
        SharedPreferences preferences=context.getSharedPreferences(
            "alizz_v11_favorites."+owner,Context.MODE_PRIVATE);
        SharedPreferences.Editor editor=preferences.edit();
        for(Map.Entry<String,?> local:preferences.getAll().entrySet()){
            String key=local.getKey();
            if(key.startsWith("family.")&&local.getValue() instanceof Boolean &&
               !cloud.contains(key)&&!pending(context).contains("favorite:"+key.substring(7)))
                editor.remove(key);
        }
        for(String key:cloud)
            if(!pending(context).contains("favorite:"+key.substring(7)))editor.putBoolean(key,true);
        editor.apply();
        JSONArray progress=load(context,owner,"aseel_watch_progress");
        if(!owner.equals(MemberAuth.userId(context)))return;
        for(int i=0;i<progress.length();i++){
            JSONObject row=progress.optJSONObject(i);
            if(row==null)continue;
            String type=row.optString("item_type"),id=row.optString("item_id");
            if(!kind(type)||!uuid(id))continue;
            long time=row.optLong("position_ms",0),duration=row.optLong("duration_ms",0);
            if(time<5000||duration<=0||time>=duration-15000)continue;
            JSONObject existing=PlaybackMemory.entry(context,"family",id);
            // Do not let an older remote timestamp overwrite an offline local save.
            long remoteTime=timestamp(row.optString("updated_at",""));
            if(existing!=null&&existing.optLong("updated",0)>remoteTime) {
                progress(context,"family",type,id,existing.optLong("position",0),existing.optLong("duration",0));
                continue;
            }
            PlaybackMemory.save(context,"family",id,type,"",
                existing==null?"متابعة المشاهدة":existing.optString("title","متابعة"),
                time,duration,existing==null?"auto":existing.optString("quality","auto"));
        }
    }
    private static long timestamp(String value){
        try{
            java.text.SimpleDateFormat date=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss",Locale.US);
            date.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return date.parse(value).getTime();
        }catch(Exception ignored){return 0;}
    }
}
