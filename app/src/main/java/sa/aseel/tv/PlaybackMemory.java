package sa.aseel.tv;
import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Map;

/** Private on-device playback history: no accounts, no cached media URLs. */
public final class PlaybackMemory {
    private static final String PREF="alezz_playback_v15";
    private static final long MAX_AGE=90L*24L*60L*60L*1000L;
    private PlaybackMemory(){}
    private static SharedPreferences prefs(Context context){
        return context.getApplicationContext().getSharedPreferences(PREF,Context.MODE_PRIVATE);
    }
    private static String safeProfile(String profile){
        return "kids".equals(profile)?"kids":"guest".equals(profile)?"guest":"family";
    }
    private static String safeId(String s){
        return s!=null&&s.matches("[A-Za-z0-9_-]{1,80}")?s:"";
    }
    private static String key(String profile,String id){
        return "watch."+safeProfile(profile)+"."+safeId(id);
    }
    public static String activeProfile(Context context){
        return safeProfile(prefs(context).getString("profile","family"));
    }
    public static String profileName(String profile){
        return "kids".equals(profile)?"الأطفال":"guest".equals(profile)?"الضيف":"العائلة";
    }
    public static void setProfile(Context context,String profile){
        if("family".equals(profile)||"kids".equals(profile)||"guest".equals(profile))
            prefs(context).edit().putString("profile",profile).apply();
    }
    public static void save(Context context,String profile,String id,String kind,String seriesId,
                            String title,long position,long duration,String quality){
        if(safeId(id).isEmpty()||"channel".equals(kind)||"live".equals(kind))return;
        if(duration>0&&position>=duration-15000){remove(context,profile,id);return;}
        try{
            JSONObject row=new JSONObject();
            row.put("id",id);row.put("kind",kind==null?"movie":kind);
            row.put("series_id",safeId(seriesId));
            row.put("title",title==null?"":title);
            row.put("position",Math.max(0L,position));
            row.put("duration",Math.max(0L,duration));
            row.put("quality",quality==null?"auto":quality);
            row.put("updated",System.currentTimeMillis());
            prefs(context).edit().putString(key(profile,id),row.toString()).apply();
        }catch(Exception ignored){}
    }
    public static JSONObject entry(Context context,String profile,String id){
        try{
            String raw=prefs(context).getString(key(profile,id),null);
            return raw==null?null:new JSONObject(raw);
        }catch(Exception ignored){return null;}
    }
    public static long position(Context context,String profile,String id){
        JSONObject row=entry(context,profile,id);
        return row==null?0L:row.optLong("position",0L);
    }
    public static ArrayList<JSONObject> recent(Context context,String profile){
        ArrayList<JSONObject> list=new ArrayList<JSONObject>();
        String prefix="watch."+safeProfile(profile)+".";
        long now=System.currentTimeMillis();
        for(Map.Entry<String,?> pair:prefs(context).getAll().entrySet()){
            if(!pair.getKey().startsWith(prefix)||!(pair.getValue() instanceof String))continue;
            try{
                JSONObject row=new JSONObject((String)pair.getValue());
                long updated=row.optLong("updated",0L);
                if(updated>0&&updated<=now&&now-updated<MAX_AGE
                    &&row.optLong("position",0L)>=5000L)list.add(row);
            }catch(Exception ignored){}
        }
        Collections.sort(list,new Comparator<JSONObject>(){
            public int compare(JSONObject a,JSONObject b){
                return Long.compare(b.optLong("updated"),a.optLong("updated"));
            }
        });
        while(list.size()>60)list.remove(list.size()-1);
        return list;
    }
    public static void remove(Context context,String profile,String id){
        if(!safeId(id).isEmpty())prefs(context).edit().remove(key(profile,id)).apply();
    }
    public static void removeSeries(Context context,String profile,String seriesId){
        for(JSONObject row:recent(context,profile))
            if(seriesId!=null&&seriesId.equals(row.optString("series_id","")))
                remove(context,profile,row.optString("id",""));
    }
    public static void lastChannel(Context context,String profile,String id){
        if(!safeId(id).isEmpty())prefs(context).edit()
            .putString("last.channel."+safeProfile(profile),id).apply();
    }
    public static String lastChannel(Context context,String profile){
        return prefs(context).getString("last.channel."+safeProfile(profile),"");
    }
    public static int seenEpisodeCount(Context context,String profile,String seriesId){
        return prefs(context).getInt("seen."+safeProfile(profile)+"."+safeId(seriesId),-1);
    }
    public static void markEpisodeCount(Context context,String profile,String seriesId,int count){
        if(!safeId(seriesId).isEmpty()&&count>=0)prefs(context).edit()
            .putInt("seen."+safeProfile(profile)+"."+safeId(seriesId),count).apply();
    }
    private static String segmentKey(String profile,String seriesId,String type,String edge){
        return "segment."+safeProfile(profile)+"."+safeId(seriesId)+"."+type+"."+edge;
    }
    public static long segmentStart(Context context,String profile,String seriesId,String type){
        return prefs(context).getLong(segmentKey(profile,seriesId,type,"start"),-1);
    }
    public static long segmentEnd(Context context,String profile,String seriesId,String type){
        return prefs(context).getLong(segmentKey(profile,seriesId,type,"end"),-1);
    }
    public static void setSegmentEdge(Context context,String profile,String seriesId,
                                      String type,String edge,long position){
        if(safeId(seriesId).isEmpty()||!("intro".equals(type)||"recap".equals(type)))return;
        if(!"start".equals(edge)&&!"end".equals(edge))return;
        prefs(context).edit().putLong(segmentKey(profile,seriesId,type,edge),
            Math.max(0L,position)).apply();
    }
    public static void clearSegment(Context context,String profile,String seriesId,String type){
        prefs(context).edit().remove(segmentKey(profile,seriesId,type,"start"))
            .remove(segmentKey(profile,seriesId,type,"end")).apply();
    }
    public static void prune(Context context){
        SharedPreferences sp=prefs(context);
        SharedPreferences.Editor editor=sp.edit();
        long now=System.currentTimeMillis();int changed=0;
        for(Map.Entry<String,?> pair:sp.getAll().entrySet()){
            if(!pair.getKey().startsWith("watch.")||!(pair.getValue() instanceof String))continue;
            try{
                JSONObject row=new JSONObject((String)pair.getValue());
                long updated=row.optLong("updated",0L);
                if(updated<=0||updated>now||now-updated>MAX_AGE){
                    editor.remove(pair.getKey());changed++;
                }
            }catch(Exception ignored){editor.remove(pair.getKey());changed++;}
        }
        if(changed>0)editor.apply();
    }
}
