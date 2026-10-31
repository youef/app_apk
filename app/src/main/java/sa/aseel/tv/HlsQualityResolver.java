package sa.aseel.tv;

import android.content.Context;
import android.os.Build;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URL;
import java.util.Locale;
import javax.net.ssl.HttpsURLConnection;

/** Discover actual HLS master playlist renditions without transcoding or invented quality options. */
public final class HlsQualityResolver {
    private HlsQualityResolver(){}
    public static JSONArray discover(Context context,String url) {
        JSONArray result=new JSONArray();
        if(url==null || !url.startsWith("https://") || !url.toLowerCase(Locale.US).contains(".m3u8"))return result;
        HttpsURLConnection connection=null;
        try {
            URL master=new URL(url);
            connection=(HttpsURLConnection)master.openConnection();
            connection.setSSLSocketFactory(LegacyTls.factory(context.getApplicationContext()));
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(9000);
            connection.setRequestProperty("Accept","application/vnd.apple.mpegurl,application/x-mpegURL,text/plain");
            connection.setRequestProperty("User-Agent","AseelTV/2.2 Android-KitKat");
            connection.setInstanceFollowRedirects(false);
            int status=connection.getResponseCode();
            if(status!=200)return result;
            BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),"UTF-8"));
            String line;
            boolean first=true;
            String pending=null;
            int count=0,totalBytes=0;
            while((line=reader.readLine())!=null && count++<450){
                totalBytes+=line.length();
                if(totalBytes>65000)break;
                String content=line.trim();
                if(first){
                    first=false;
                    if(!content.replace("\uFEFF","").equals("#EXTM3U"))break;
                }
                if(content.startsWith("#EXT-X-STREAM-INF:")) {
                    pending=content;
                    continue;
                }
                if(pending!=null && content.length()>0 && !content.startsWith("#")) {
                    URL rendition=new URL(master,content);
                    // No insecure downgrade or unrelated hostname from a playlist.
                    if("https".equalsIgnoreCase(rendition.getProtocol()) &&
                       rendition.getHost().equalsIgnoreCase(master.getHost())) {
                        String bandwidth=attribute(pending,"BANDWIDTH");
                        String resolution=attribute(pending,"RESOLUTION");
                        String label="";
                        if(resolution.contains("x")){
                            String[] segments=resolution.split("x");
                            if(segments.length==2 && segments[1].matches("[0-9]{3,4}"))
                                label=segments[1]+"p";
                        }
                        if(label.isEmpty()&&bandwidth.matches("[0-9]{3,8}"))
                            label=(Integer.parseInt(bandwidth)/1000)+"kbps";
                        if(label.isEmpty())label="HLS بديل";
                        JSONObject entry=new JSONObject();
                        entry.put("label",label);
                        entry.put("url",rendition.toExternalForm());
                        result.put(entry);
                        if(result.length()>=8)break;
                    }
                    pending=null;
                }
            }
            reader.close();
        }catch(Exception e) {
            Log.w("AseelHLS","Rendition detection unavailable: "+e.getClass().getSimpleName());
        }finally{if(connection!=null)connection.disconnect();}
        return result;
    }
    private static String attribute(String data,String key){
        java.util.regex.Matcher pattern=java.util.regex.Pattern.compile("(?:^|,|:)"+key+"=([^,]+)").matcher(data);
        if(pattern.find())return pattern.group(1).replace("\"","").trim();
        return "";
    }
}
