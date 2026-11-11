package sa.aseel.tv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Checks published episodes of followed series while the app is active.
 * Baselines counts on first check so users don't get alerts for old episodes.
 * Device notifications are best-effort and respect Android notification permission.
 */
public final class EpisodeAlerts {
    private static final long INTERVAL=2L*60L*60L*1000L;
    private static final String CHANNEL="alezz_new_episodes";
    private final Context context;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private final SharedPreferences prefs;
    public interface Listener {void onResult(String message);}
    public EpisodeAlerts(Context context){
        this.context=context.getApplicationContext();
        prefs=this.context.getSharedPreferences("alezz_episode_alerts_v1",Context.MODE_PRIVATE);
    }
    public void check(final ArrayList<JSONObject> followed,final String profile,final boolean manual,final Listener listener){
        if(!prefs.getBoolean("enabled",true)){
            if(listener!=null)listener.onResult("تنبيهات الحلقات متوقفة");return;
        }
        long now=System.currentTimeMillis();
        if(!manual && now-prefs.getLong("checked_"+profile,0L)<INTERVAL)return;
        if(followed.isEmpty()){
            if(manual&&listener!=null)listener.onResult("تابع مسلسلًا من قائمتي لتصلك حلقاته الجديدة");
            return;
        }
        executor.execute(new Runnable(){public void run(){
            int updates=0;
            StringBuilder message=new StringBuilder();
            CatalogApi api=new CatalogApi(context);
            boolean complete=true;
            int inspected=0;
            for(JSONObject show:followed){
                if(inspected++>=12)break;
                String seriesId=show.optString("id","");
                if(!seriesId.matches("[a-fA-F0-9-]{36}"))continue;
                try{
                    JSONArray seasons=api.listQuery("aseel_seasons",
                        "?select=id&series_id=eq."+seriesId+"&limit=40");
                    int count=0;
                    for(int i=0;i<seasons.length();i++){
                        JSONObject season=seasons.optJSONObject(i);
                        String id=season==null?"":season.optString("id","");
                        if(!id.matches("[a-fA-F0-9-]{36}"))continue;
                        JSONArray episodes=api.listPaged("aseel_episodes",
                            "?select=*&season_id=eq."+id+
                            "&status=eq.published&rights_status=eq.approved&order=number.asc");
                        count+=episodes.length();
                    }
                    String key="count_"+profile+"_"+seriesId;
                    int previous=prefs.getInt(key,-1);
                    // Do not treat cache/temporary empty responses as confirmed removals.
                    if(previous>=0&&count>previous){
                        int added=count-previous;
                        updates+=added;
                        if(message.length()>0)message.append("، ");
                        message.append(show.optString("title_ar",show.optString("title","مسلسل")))
                            .append(" (+").append(added).append(")");
                    }
                    if(count>0)prefs.edit().putInt(key,Math.max(previous,count)).apply();
                }catch(Exception failed){complete=false;}
            }
            if(complete)prefs.edit().putLong("checked_"+profile,System.currentTimeMillis()).apply();
            final String result=updates>0?"حلقات جديدة: "+message:
                complete?"لا توجد حلقات جديدة في الأعمال المتابعة":"تعذّر فحص بعض المسلسلات؛ ستُعاد المحاولة";
            if(updates>0)notifyUser(result);
            if(listener!=null)new android.os.Handler(android.os.Looper.getMainLooper()).post(new Runnable(){
                public void run(){listener.onResult(result);}
            });
        }});
    }
    private void notifyUser(String message){
        try{
            NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
            if(manager==null)return;
            if(Build.VERSION.SDK_INT>=26){
                NotificationChannel channel=new NotificationChannel(CHANNEL,"حلقات جديدة",NotificationManager.IMPORTANCE_DEFAULT);
                manager.createNotificationChannel(channel);
            }
            Notification.Builder builder=Build.VERSION.SDK_INT>=26?
                new Notification.Builder(context,CHANNEL):new Notification.Builder(context);
            builder.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("العز TV — حلقات جديدة")
                .setContentText(message).setStyle(new Notification.BigTextStyle().bigText(message))
                .setAutoCancel(true);
            manager.notify(22001,builder.build());
        }catch(Exception ignored){/* No permission/TV notification UI: in-app result remains available. */}
    }
    public boolean enabled(){return prefs.getBoolean("enabled",true);}
    public void setEnabled(boolean enabled){prefs.edit().putBoolean("enabled",enabled).apply();}
    public void shutdown(){executor.shutdownNow();}
}
