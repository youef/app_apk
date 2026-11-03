package sa.aseel.tv;

import android.content.Context;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.Closeable;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import javax.net.ssl.HttpsURLConnection;

/**
 * Device-local IPTV import. Never publishes third-party playlists to Supabase.
 * Bounded incremental read; only explicit HTTPS media URLs are accepted.
 * No Nimbus source code is copied into this implementation.
 */
public final class IPTVPlaylist {
    private static final int MAX_BYTES=12*1024*1024, MAX_CHANNELS=2500;
    private static final Pattern ATTRIBUTE=Pattern.compile(
        "([A-Za-z0-9_-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s]+))");
    private IPTVPlaylist(){}

    public static final class Download implements Closeable {
        public final InputStream stream;
        private final HttpsURLConnection connection;
        Download(HttpsURLConnection connection,InputStream body){
            this.connection=connection;stream=body;
        }
        @Override public void close() throws IOException {
            try { stream.close(); } finally { connection.disconnect(); }
        }
    }

    private static final class BoundedStream extends FilterInputStream {
        private final long limit;
        private long count;
        BoundedStream(InputStream input,long limit){super(input);this.limit=limit;}
        private void check(long amount) throws IOException {
            if(amount>0 && (count+=amount)>limit)throw new IOException("Playlist/EPG exceeds safe size limit");
        }
        @Override public int read() throws IOException {
            int b=super.read();if(b!=-1)check(1);return b;
        }
        @Override public int read(byte[] b,int off,int len) throws IOException {
            // FilterInputStream.read(byte[],off,len) may call read(); use the upstream directly.
            int n=in.read(b,off,len);if(n>0)check(n);return n;
        }
    }

    public static Download open(Context context,String address,int limit) throws Exception {
        if(address==null || address.length()>2048)throw new IOException("HTTPS URL required");
        URL current=new URL(address.trim());
        for(int redirects=0;redirects<=3;redirects++){
            if(!"https".equalsIgnoreCase(current.getProtocol()) || current.getUserInfo()!=null)
                throw new IOException("HTTPS URL without embedded credentials required");
            HttpsURLConnection conn=(HttpsURLConnection)current.openConnection();
            conn.setSSLSocketFactory(LegacyTls.factory(context.getApplicationContext()));
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Accept-Encoding","gzip,identity");
            conn.setRequestProperty("User-Agent","AlEzzTV/16 IPTV");
            int status;
            try { status=conn.getResponseCode(); }
            catch(IOException e){conn.disconnect();throw e;}
            if(status==301||status==302||status==303||status==307||status==308){
                String location=conn.getHeaderField("Location");conn.disconnect();
                if(location==null)throw new IOException("Redirect has no URL");
                current=new URL(current,location);
                continue;
            }
            if(status<200||status>=300){conn.disconnect();throw new IOException("IPTV source returned HTTP "+status);}
            try {
                InputStream stream=conn.getInputStream();
                if("gzip".equalsIgnoreCase(conn.getContentEncoding()))stream=new GZIPInputStream(stream);
                return new Download(conn,new BoundedStream(stream,limit));
            }catch(IOException e){conn.disconnect();throw e;}
        }
        throw new IOException("Too many HTTPS redirects");
    }

    private static String attribute(String text,String name){
        Matcher match=ATTRIBUTE.matcher(text);
        while(match.find())if(name.equalsIgnoreCase(match.group(1))){
            for(int i=2;i<=4;i++)if(match.group(i)!=null)return match.group(i).trim();
        }
        return "";
    }
    private static int commaOutsideQuotes(String value){
        char quote=0;
        for(int i=0;i<value.length();i++){
            char c=value.charAt(i);
            if((c=='"'||c=='\'') && (quote==0||quote==c))quote=(quote==0?c:0);
            if(c==','&&quote==0)return i;
        }
        return -1;
    }

    public static ArrayList<JSONObject> load(Context context,String url) throws Exception {
        Download source=open(context,url,MAX_BYTES);
        try{return parse(source.stream);}finally{source.close();}
    }

    /** Also independently testable with an in-memory InputStream. */
    public static ArrayList<JSONObject> parse(InputStream input) throws Exception {
        ArrayList<JSONObject> result=new ArrayList<JSONObject>();
        HashSet<String> urls=new HashSet<String>();
        BufferedReader reader=new BufferedReader(new InputStreamReader(input,Charset.forName("UTF-8")),32768);
        String line, name="",group="",logo="",tvgId="";
        boolean header=false;
        while((line=reader.readLine())!=null && result.size()<MAX_CHANNELS){
            line=line.trim();
            if(line.length()==0)continue;
            if(line.startsWith("\uFEFF"))line=line.substring(1);
            if(line.regionMatches(true,0,"#EXTM3U",0,7)){header=true;continue;}
            if(line.regionMatches(true,0,"#EXTINF",0,7)){
                String attrs=line.substring(7);
                int comma=commaOutsideQuotes(attrs);
                name=comma>=0?attrs.substring(comma+1).trim():"";
                group=attribute(attrs,"group-title");
                logo=attribute(attrs,"tvg-logo");
                tvgId=attribute(attrs,"tvg-id");
                if(name.isEmpty())name=attribute(attrs,"tvg-name");
                continue;
            }
            if(line.regionMatches(true,0,"#EXTGRP:",0,8)){
                if(group.isEmpty())group=line.substring(8).trim();
                continue;
            }
            if(line.startsWith("#"))continue;
            if(!header)throw new IOException("Not an extended M3U playlist");
            // Provider-specific header suffixes may contain credentials; never copy them into logs.
            String address=line.split("\\|",2)[0].trim();
            if(StreamQuality.isDirectUrl(address) && urls.add(address)){
                JSONObject channel=new JSONObject();
                String title=name.isEmpty()?"قناة "+(result.size()+1):name;
                if(title.length()>160)title=title.substring(0,160);
                channel.put("id",UUID.nameUUIDFromBytes(("al-ezz-local|"+address).getBytes("UTF-8")).toString());
                channel.put("title_ar",title);
                channel.put("stream_url",address);
                channel.put("playback_mode","stream");
                channel.put("category_name",group.isEmpty()?"قنوات محلية":group.substring(0,Math.min(40,group.length())));
                channel.put("poster_url",logo.startsWith("https://")?logo:"");
                channel.put("_kind","channel");
                channel.put("_local_iptv",true);
                channel.put("_epg_id",tvgId);
                channel.put("link_health_status","unverified");
                channel.put("stream_variants",new org.json.JSONArray());
                result.add(channel);
            }
            name="";group="";logo="";tvgId="";
        }
        if(!header)throw new IOException("Missing #EXTM3U");
        return result;
    }
}
