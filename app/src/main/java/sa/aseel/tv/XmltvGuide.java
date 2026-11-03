package sa.aseel.tv;

import android.content.Context;
import android.util.Xml;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.TimeZone;

/** Streaming XMLTV "now / next" reader, device-local, compatible with Android API 19. */
public final class XmltvGuide {
    private XmltvGuide(){}
    private static String key(String text){
        return text==null?"":text.trim().toLowerCase(Locale.ROOT);
    }
    private static long readTime(String raw){
        if(raw==null)return -1;
        String trimmed=raw.trim();
        String[] pieces=trimmed.split("\\s+");
        String digits=pieces.length>0?pieces[0]:"";
        if(digits.length()==12)digits+="00";
        if(!digits.matches("\\d{14}"))return -1;
        String zone=pieces.length>1 && pieces[1].matches("[+-]\\d{4}")?pieces[1]:"+0000";
        try{
            SimpleDateFormat fmt=new SimpleDateFormat("yyyyMMddHHmmss Z",Locale.US);
            fmt.setLenient(false);
            fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
            return fmt.parse(digits+" "+zone).getTime();
        }catch(Exception ignored){return -1;}
    }
    public static int apply(Context context,String epgUrl,ArrayList<JSONObject> channels) throws Exception {
        if(channels==null||channels.isEmpty())return 0;
        IPTVPlaylist.Download download=IPTVPlaylist.open(context,epgUrl,24*1024*1024);
        try{return parse(download.stream,channels,System.currentTimeMillis());}
        finally{download.close();}
    }
    /** Parse independently of Android network access, so test fixtures can validate guide matching. */
    public static int parse(InputStream body,ArrayList<JSONObject> channels,long nowMs) throws Exception {
        HashMap<String,JSONObject> byId=new HashMap<String,JSONObject>();
        HashMap<String,Long> nextStart=new HashMap<String,Long>();
        for(JSONObject c:channels){
            String id=key(c.optString("_epg_id",""));
            if(id.length()>0)byId.put(id,c);
            String title=key(c.optString("title_ar",""));
            if(title.length()>0 && !byId.containsKey(title))byId.put(title,c);
            c.remove("epg_now_title");c.remove("epg_next_title");
        }
        XmlPullParser parser=Xml.newPullParser();
        parser.setInput(body,"UTF-8");
        int attached=0,checked=0;
        for(int event=parser.getEventType();event!=XmlPullParser.END_DOCUMENT;event=parser.next()){
            if(event!=XmlPullParser.START_TAG || !"programme".equalsIgnoreCase(parser.getName()))continue;
            if(++checked>180000)break;
            String channelId=key(parser.getAttributeValue(null,"channel"));
            JSONObject channel=byId.get(channelId);
            String startRaw=parser.getAttributeValue(null,"start");
            String endRaw=parser.getAttributeValue(null,"stop");
            long start=readTime(startRaw),end=readTime(endRaw);
            if(channel==null||start<0||end<=start||end<nowMs||start>nowMs+2L*86400000L){
                skip(parser);continue;
            }
            String title="";
            int depth=parser.getDepth();
            while(true){
                int next=parser.next();
                if(next==XmlPullParser.END_DOCUMENT)break;
                if(next==XmlPullParser.END_TAG && parser.getDepth()==depth)break;
                if(next==XmlPullParser.START_TAG && parser.getDepth()==depth+1 &&
                   "title".equalsIgnoreCase(parser.getName())){
                    title=parser.nextText().trim();
                }
            }
            if(title.length()==0)continue;
            if(start<=nowMs && end>nowMs){
                channel.put("epg_now_title",title);
                attached++;
            }else if(start>nowMs){
                Long prior=nextStart.get(channelId);
                if(prior==null || start<prior.longValue()){
                    nextStart.put(channelId,start);
                    channel.put("epg_next_title",title);
                    attached++;
                }
            }
        }
        return attached;
    }
    private static void skip(XmlPullParser parser) throws Exception {
        int depth=1;
        while(depth>0){
            int event=parser.next();
            if(event==XmlPullParser.END_DOCUMENT)break;
            if(event==XmlPullParser.START_TAG)depth++;
            else if(event==XmlPullParser.END_TAG)depth--;
        }
    }
}
