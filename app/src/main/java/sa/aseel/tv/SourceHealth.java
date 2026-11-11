package sa.aseel.tv;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URI;
import java.security.MessageDigest;

/** Temporary, device-local cooldown for failed playback URLs; never permanently deletes media. */
public final class SourceHealth {
    private static final long COOLDOWN=30L*60L*1000L;
    private static final long MAX_COOLDOWN=6L*60L*60L*1000L;
    private SourceHealth(){}
    private static SharedPreferences prefs(Context context){
        return context.getApplicationContext().getSharedPreferences("alezz_source_health_v1",Context.MODE_PRIVATE);
    }
    private static String key(String url){
        try{
            // Key is a hash: do not store playback tokens or query strings in SharedPreferences.
            URI uri=new URI(url);
            String identity=uri.getScheme()+"://"+uri.getHost()+uri.getPath();
            byte[] hash=MessageDigest.getInstance("SHA-256").digest(identity.getBytes("UTF-8"));
            StringBuilder result=new StringBuilder("source.");
            for(int i=0;i<12;i++)result.append(String.format(java.util.Locale.US,"%02x",hash[i]&255));
            return result.toString();
        }catch(Exception e){return "";}
    }
    public static boolean blocked(Context context,String url){
        String key=key(url);if(key.isEmpty())return false;
        return System.currentTimeMillis()<prefs(context).getLong(key+".until",0L);
    }
    public static void failed(Context context,String url){
        String key=key(url);if(key.isEmpty())return;
        SharedPreferences p=prefs(context);
        int count=Math.min(5,p.getInt(key+".failures",0)+1);
        long delay=Math.min(MAX_COOLDOWN,COOLDOWN*(1L<<Math.min(count-1,4)));
        p.edit().putInt(key+".failures",count)
            .putLong(key+".until",System.currentTimeMillis()+delay).apply();
    }
    public static void recovered(Context context,String url){
        String key=key(url);if(!key.isEmpty())
            prefs(context).edit().remove(key+".failures").remove(key+".until").apply();
    }
    public static void reset(Context context){prefs(context).edit().clear().apply();}
}
