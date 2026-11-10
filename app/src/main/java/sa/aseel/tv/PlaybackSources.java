package sa.aseel.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;

/**
 * Explicit rights-approved catalogue sources only. Selection never scrapes a player or
 * guesses a video URL from a website. Supports native MP4/HLS plus approved iframe hosts.
 */
public final class PlaybackSources {
    public static final class Source {
        public final String label, url, kind;
        Source(String label, String url, String kind) {
            this.label=label;
            this.url=url;
            this.kind=kind;
        }
    }
    private PlaybackSources() {}

    private static String youtubeId(String raw) {
        String id=YouTubeLink.videoId(raw);
        if(id!=null)return id;
        try{
            Uri u=Uri.parse(raw);
            if(!"https".equalsIgnoreCase(u.getScheme()) ||
                !"www.youtube-nocookie.com".equalsIgnoreCase(u.getHost()) ||
                (u.getPort()!=-1 && u.getPort()!=443) || u.getUserInfo()!=null)return null;
            String path=u.getPath();
            return path!=null && path.matches("/embed/[A-Za-z0-9_-]{11}/?")
                ? path.split("/")[2] : null;
        }catch(Exception ignored){return null;}
    }
    public static String type(String raw) {
        if(raw==null || raw.trim().isEmpty() || raw.length()>2048)return "";
        try{
            Uri uri=Uri.parse(raw.trim());
            if(!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo()!=null ||
               (uri.getPort()!=-1 && uri.getPort()!=443) || uri.getHost()==null)return "";
            if(youtubeId(raw)!=null)return "youtube";
            if(EmbedPlayerActivity.isAllowed(raw))return "embed";
            if(StreamQuality.isDirectUrl(raw)) {
                String path=uri.getPath()==null?"":uri.getPath().toLowerCase(Locale.US);
                if(path.endsWith(".m3u8"))return "hls";
                return "mp4";
            }
        }catch(Exception ignored){}
        return "";
    }
    public static String canonical(String raw) {
        String id=youtubeId(raw);
        return id!=null ? "https://www.youtube-nocookie.com/embed/"+id :
            (raw==null?"":raw.trim());
    }
    private static void append(ArrayList<Source> result, HashSet<String> seen,
                               String raw, String label, boolean kids) {
        String kind=type(raw);
        if(kind.isEmpty() || (kids && !"hls".equals(kind) && !"mp4".equals(kind)))return;
        String url=canonical(raw);
        if(!seen.add(url) || result.size()>=9)return;
        label=label==null?"":label.trim();
        if(label.length()>35)label=label.substring(0,35);
        if(label.isEmpty())label="مصدر "+(result.size()+1);
        result.add(new Source(label,url,kind));
    }
    public static ArrayList<Source> collect(String main, String quality,
                                            String variants, String youtube, boolean kids) {
        ArrayList<Source> result=new ArrayList<Source>();
        HashSet<String> seen=new HashSet<String>();
        append(result,seen,main,quality==null||quality.trim().isEmpty()?"الأساسي":quality,kids);
        try {
            JSONArray rows=new JSONArray(variants==null?"[]":variants);
            for(int i=0;i<rows.length() && i<8;i++) {
                JSONObject row=rows.optJSONObject(i);
                if(row!=null)append(result,seen,row.optString("url",row.optString("stream_url","")),
                    row.optString("label",row.optString("quality","")),kids);
            }
        }catch(Exception ignored){}
        append(result,seen,youtube,"YouTube",kids);
        return result;
    }
    public static int preferred(ArrayList<Source> sources) {
        if(sources.isEmpty())return -1;
        int fallback=-1;
        // The original signed HLS source may have expired since the catalogue
        // was loaded. Prefer the first still-valid source, including Embed.
        for(int i=0;i<sources.size();i++)
            if(!SignedStreamExpiry.expired(sources.get(i).url)) {
                fallback=i;break;
            }
        if(fallback<0)return 0; // No valid candidate; player reports the problem or retries.
        if(Build.VERSION.SDK_INT<=19)
            for(int i=0;i<sources.size();i++)
                if(!SignedStreamExpiry.expired(sources.get(i).url) &&
                    "mp4".equals(sources.get(i).kind) &&
                    sources.get(i).url.toLowerCase(Locale.US).split("[?#]",2)[0].endsWith(".mp4"))
                    return i;
        for(int i=0;i<sources.size();i++)
            if(!SignedStreamExpiry.expired(sources.get(i).url) &&
                ("hls".equals(sources.get(i).kind) || "mp4".equals(sources.get(i).kind)))
                return i;
        return fallback;
    }

    /** Offer a rights-approved embed as a last resort after direct media fails. */
    public static Source alternateEmbed(Activity activity) {
        if(activity==null || activity.getIntent().getBooleanExtra("kids_mode",false))return null;
        String failed=activity.getIntent().getStringExtra("stream_url");
        for(Source source:decode(activity.getIntent().getStringExtra("available_sources"))) {
            if(source.url.equals(failed) || SignedStreamExpiry.expired(source.url))continue;
            if("embed".equals(source.kind) || "youtube".equals(source.kind))return source;
        }
        return null;
    }
    public static String encode(ArrayList<Source> sources) {
        JSONArray result=new JSONArray();
        for(Source src:sources) {
            JSONObject object=new JSONObject();
            try {
                object.put("label",src.label);
                object.put("url",src.url);
                object.put("kind",src.kind);
                result.put(object);
            }catch(Exception ignored){}
        }
        return result.toString();
    }
    public static ArrayList<Source> decode(String raw) {
        ArrayList<Source> result=new ArrayList<Source>();
        HashSet<String> seen=new HashSet<String>();
        try{
            JSONArray list=new JSONArray(raw==null?"[]":raw);
            for(int i=0;i<list.length()&&i<9;i++){
                JSONObject entry=list.optJSONObject(i);
                if(entry==null)continue;
                append(result,seen,entry.optString("url"),entry.optString("label"),false);
            }
        }catch(Exception ignored){}
        return result;
    }
    public static void show(final Activity activity) {
        if(activity==null)return;
        final ArrayList<Source> list=decode(activity.getIntent().getStringExtra("available_sources"));
        if(list.size()<2)return;
        String[] labels=new String[list.size()];
        int selected=0;
        String current=activity.getIntent().getStringExtra("stream_url");
        for(int i=0;i<list.size();i++){
            Source source=list.get(i);
            String tag="hls".equals(source.kind)?"HLS":"mp4".equals(source.kind)?"MP4":
                "youtube".equals(source.kind)?"YouTube":"Embed";
            labels[i]=source.label+"  ·  "+tag;
            if(source.url.equals(current))selected=i;
        }
        final int active=selected;
        new AlertDialog.Builder(activity).setTitle("مصادر التشغيل")
            .setSingleChoiceItems(labels,selected,(dialog,index)->{
                dialog.dismiss();
                if(index!=active)open(activity,list.get(index));
            }).setNegativeButton("إلغاء",null).show();
    }
    public static boolean hasAlternatives(Activity activity) {
        return decode(activity.getIntent().getStringExtra("available_sources")).size()>1;
    }
    public static void open(Activity activity, Source chosen) {
        if(activity==null || chosen==null || type(chosen.url).isEmpty())return;
        boolean embed="embed".equals(chosen.kind) || "youtube".equals(chosen.kind);
        Class<?> target=embed?EmbedPlayerActivity.class:CinemaPlayerActivity.class;
        Intent intent=new Intent(activity,target);
        Bundle extras=activity.getIntent().getExtras();
        if(extras!=null)intent.putExtras(extras);
        intent.putExtra("stream_url",chosen.url);
        intent.putExtra("quality","default");
        intent.putExtra("selected_source",chosen.label);
        activity.startActivity(intent);
        activity.finish();
    }
}
