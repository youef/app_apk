package sa.aseel.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;

/** Only actual URLs supplied by rights-approved catalog records may be played. */
public final class StreamQuality {
    public static final class Source {
        public final String label, url;
        public final int rank;
        Source(String label, String url) {
            this.label=label; this.url=url; this.rank=rankOf(label);
        }
    }
    private StreamQuality(){}
    /** Only HTTPS MP4 or HLS manifests can enter the player, never HTML pages. */
    public static boolean isDirectUrl(String url) {
        if(url==null || !url.startsWith("https://") || url.length()>2048)return false;
        String path=url.split("[?#]",2)[0].toLowerCase(Locale.US);
        return path.endsWith(".mp4") || path.endsWith(".m3u8");
    }
    public static ArrayList<Source> parse(String mainUrl,String mainQuality,String rawJson) {
        ArrayList<Source> results=new ArrayList<Source>();
        HashSet<String> seen=new HashSet<String>();
        add(results,seen,mainQuality,mainUrl);
        try {
            JSONArray entries=new JSONArray(rawJson==null?"[]":rawJson);
            for(int i=0;i<entries.length() && i<8;i++){
                JSONObject entry=entries.optJSONObject(i);
                if(entry!=null)add(results,seen,entry.optString("label"),entry.optString("url"));
            }
        }catch(Exception ignored){}
        return results;
    }
    private static void add(ArrayList<Source> out,HashSet<String> seen,String label,String url) {
        if(!isDirectUrl(url) || seen.contains(url))return;
        if(label==null || label.length()>24)label="المصدر";
        label=label.trim();
        if(label.isEmpty())label="المصدر";
        seen.add(url);out.add(new Source(label,url));
    }
    public static int choose(ArrayList<Source> items,String preference,int api){
        if(items.isEmpty())return -1;
        if("default".equals(preference))return 0;
        if("highest".equals(preference)||"lowest".equals(preference)||"auto".equals(preference)){
            boolean low="lowest".equals(preference)||("auto".equals(preference)&&api<=19);
            int best=0;
            for(int i=1;i<items.size();i++)
                if(low?items.get(i).rank<items.get(best).rank:items.get(i).rank>items.get(best).rank)best=i;
            return best;
        }
        for(int i=0;i<items.size();i++)if(preference.equals(items.get(i).label))return i;
        return 0;
    }
    public static int lower(ArrayList<Source> items,int current){
        if(current<0||current>=items.size())return -1;
        int next=-1;
        for(int i=0;i<items.size();i++){
            if(items.get(i).rank<items.get(current).rank &&
                (next<0 || items.get(i).rank>items.get(next).rank))next=i;
        }
        return next;
    }
    private static int rankOf(String text){
        if(text==null)return 500;
        String value=text.trim().toLowerCase(Locale.US);
        try{
            java.util.regex.Matcher matcher=java.util.regex.Pattern.compile("(\\d{3,4})p").matcher(value);
            if(matcher.find())return Integer.parseInt(matcher.group(1));
        }catch(Exception ignored){}
        if(value.contains("4k")||value.contains("uhd"))return 2160;
        if(value.contains("fhd")||value.contains("1080"))return 1080;
        if(value.contains("hd")||value.contains("720"))return 720;
        if(value.contains("sd")||value.contains("480"))return 480;
        if(value.contains("low")||value.contains("360"))return 360;
        return 500;
    }
}
