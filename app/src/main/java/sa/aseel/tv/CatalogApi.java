package sa.aseel.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.net.HttpURLConnection;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.HashSet;
import java.util.UUID;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/** Network access with stock hostname verification and trusted CA chain. */
public final class CatalogApi {
    private static final String TAG = "AseelCatalog";
    private static final long MAX_OFFLINE_CACHE_AGE_MS = 15L * 60L * 1000L;
    private static final int MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;
    private final SharedPreferences cache;
    private final Context context;
    private volatile String lastError = "";

    public CatalogApi(Context context) {
        this.context=context.getApplicationContext();
        cache=this.context.getSharedPreferences("aseel_catalog_cache_v1", Context.MODE_PRIVATE);
    }

    /** Publication controls visibility; source health controls playback only.
     * Missing/expired links must not erase published catalogue cards. */
    private static JSONArray directMediaOnly(String table,JSONArray input) {
        if(!("aseel_movies".equals(table)||"aseel_series".equals(table)||
             "aseel_episodes".equals(table)||"aseel_channels".equals(table)))return input;
        JSONArray result=new JSONArray();
        for(int i=0;i<input.length();i++){
            JSONObject item=input.optJSONObject(i);
            if(item!=null && "published".equals(item.optString("status","")))result.put(item);
        }
        return result;
    }
    static boolean officialChannelLink(String external){
        return external.startsWith("https://www.qanwatlive.com/")
            || external.startsWith("https://qanwatlive.com/")
            || external.startsWith("https://roya.tv/")
            || external.startsWith("https://rotana.net/")
            || external.startsWith("https://www.rotana.net/")
            || external.equals("https://shahid.mbc.net/ar/livestream")
            || external.startsWith("https://shahid.mbc.net/ar/livestream/")
            || external.startsWith("https://aloula.sba.sa/ar/live/")
            || external.startsWith("https://radioplus.sba.sa/ar/live/")
            || external.startsWith("https://www.alarabiya.net/live-stream")
            || external.startsWith("https://www.alhadath.net/live-stream");
    }

    /** Recent cached catalog only: rights may be revoked after 15 minutes. */
    public JSONArray recentCache(String table,String query){
        String key=table+query;
        String json=cache.getString(key,null);
        long age=System.currentTimeMillis()-cache.getLong(key+"_cached_at",0L);
        if(json==null || age<0 || age>MAX_OFFLINE_CACHE_AGE_MS)return null;
        try{return directMediaOnly(table,new JSONArray(json));}catch(Exception ignored){return null;}
    }
    public JSONArray list(String table) throws Exception {
        return listQuery(table, "?select=*&order=created_at.desc&limit=" + AppConfig.MAX_ITEMS);
    }
    public JSONArray listQuery(String table, String query) throws Exception {
        if (!table.matches("aseel_[a-z_]+")) throw new IllegalArgumentException("Invalid resource");
        String key = table + query;
        try {
            String json = request(AppConfig.API_ROOT + table + query);
            JSONArray array = directMediaOnly(table,new JSONArray(json));
            cache.edit().putString(key,array.toString()).putLong(key+"_cached_at",System.currentTimeMillis()).apply();
            lastError="";
            return array;
        } catch (Exception error) {
            lastError=describe(error);
            Log.w(TAG,"Catalog request failed: "+lastError,error);
            String local = cache.getString(key,null);
            long cachedAt=cache.getLong(key+"_cached_at",0L);
            long age=System.currentTimeMillis()-cachedAt;
            // Never replay an old catalog indefinitely after content/rights are revoked.
            if (local != null && age>=0 && age<=MAX_OFFLINE_CACHE_AGE_MS)
                return directMediaOnly(table,new JSONArray(local));
            throw error;
        }
    }
    /**
     * Loads every published item in small pages so the UI is driven by live
     * Supabase metadata, not by the limited first 80 rows shipped in old APKs.
     * Cache a complete snapshot so a network failure cannot mix two catalog versions.
     */
    public JSONArray listPaged(String table,String queryPrefix) throws Exception {
        if (!table.matches("aseel_[a-z_]+") || !queryPrefix.startsWith("?") || queryPrefix.contains("limit=") ||
            queryPrefix.contains("offset="))throw new IllegalArgumentException("Invalid pagination");
        String key=UUID.nameUUIDFromBytes((table+queryPrefix).getBytes("UTF-8")).toString();
        AtomicFile snapshot=new AtomicFile(new File(context.getCacheDir(),"catalog-"+key+".json"));
        try{
            JSONArray rows=fetchPages(table,queryPrefix);
            try{writeSnapshot(snapshot,rows);}
            catch(Exception failure){Log.w(TAG,"Catalog snapshot could not be saved",failure);}
            return rows;
        }catch(Exception failure){
            JSONArray cached=readSnapshot(snapshot);
            if(cached!=null)return directMediaOnly(table,cached);
            throw failure;
        }
    }
    private JSONArray fetchPages(String table,String queryPrefix) throws Exception {
        final int pageSize=150;
        JSONArray all=new JSONArray();
        HashSet<String> ids=new HashSet<String>();
        for(int offset=0;offset<AppConfig.MAX_ITEMS;offset+=pageSize){
            int size=Math.min(pageSize,AppConfig.MAX_ITEMS-offset);
            String query=queryPrefix+"&limit="+size+"&offset="+offset;
            JSONArray raw=new JSONArray(request(AppConfig.API_ROOT+table+query));
            JSONArray permitted=directMediaOnly(table,raw);
            for(int i=0;i<permitted.length();i++){
                JSONObject item=permitted.optJSONObject(i);
                if(item==null)continue;
                String id=item.optString("id","");
                if(!id.isEmpty()&&ids.add(id))all.put(item);
            }
            // Use raw row count: filtering rejected/invalid streams must NOT truncate
            // the subsequent published pages in a larger catalogue.
            if(raw.length()<size)break;
        }
        return all;
    }
    private void writeSnapshot(AtomicFile snapshot,JSONArray rows) throws Exception {
        byte[] data=new JSONObject().put("saved_at",System.currentTimeMillis())
            .put("rows",rows).toString().getBytes("UTF-8");
        if(data.length>MAX_SNAPSHOT_BYTES){snapshot.delete();return;}
        FileOutputStream out=snapshot.startWrite();
        try{
            out.write(data);
            snapshot.finishWrite(out);
        }catch(Exception failure){
            snapshot.failWrite(out);
            throw failure;
        }
    }
    private JSONArray readSnapshot(AtomicFile snapshot){
        try(FileInputStream in=snapshot.openRead()){
            long size=in.getChannel().size();
            if(size<=0||size>MAX_SNAPSHOT_BYTES)return null;
            ByteArrayOutputStream out=new ByteArrayOutputStream((int)size);
            byte[] buffer=new byte[4096];
            int count;
            while((count=in.read(buffer))!=-1){
                if(out.size()+count>MAX_SNAPSHOT_BYTES)return null;
                out.write(buffer,0,count);
            }
            JSONObject document=new JSONObject(out.toString("UTF-8"));
            long age=System.currentTimeMillis()-document.getLong("saved_at");
            return age>=0&&age<=MAX_OFFLINE_CACHE_AGE_MS?document.getJSONArray("rows"):null;
        }catch(Exception ignored){return null;}
    }
    private String request(String uri) throws Exception {
        URL url = new URL(uri);
        if (!"https".equalsIgnoreCase(url.getProtocol()))
            throw new SecurityException("HTTPS is required");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setSSLSocketFactory(LegacyTls.factory(context));
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(18000);
        connection.setRequestProperty("apikey",AppConfig.PUBLISHABLE_KEY);
        connection.setRequestProperty("Accept","application/json");
        connection.setRequestProperty("User-Agent","AseelTV/1.0 Android");
        connection.setUseCaches(false);
        try {
            int status=connection.getResponseCode();
            if(!"https".equalsIgnoreCase(connection.getURL().getProtocol()))
                throw new SecurityException("Redirected to an insecure endpoint");
            if(status<200 || status>=300) throw new java.io.IOException("HTTP "+status);
            InputStream stream=connection.getInputStream();
            try{
                ByteArrayOutputStream out=new ByteArrayOutputStream();
                byte[] buffer=new byte[4096]; int read;
                while((read=stream.read(buffer))!=-1) {
                    if(out.size()+read > 1024*1024) throw new java.io.IOException("Catalog exceeds 1 MB");
                    out.write(buffer,0,read);
                }
                return out.toString("UTF-8");
            } finally {stream.close();}
        } finally {connection.disconnect();}
    }

    public String lastError(){return lastError;}
    public static String describe(Throwable error){
        StringBuilder summary=new StringBuilder();
        for(Throwable cause=error;cause!=null && summary.length()<400;cause=cause.getCause()){
            if(summary.length()>0)summary.append(" -> ");
            summary.append(cause.getClass().getSimpleName());
            String message=cause.getMessage();
            if(message!=null && message.length()>0)
                summary.append(": ").append(message.length()>140?message.substring(0,140):message);
        }
        return summary.toString();
    }
    static final class Tls12Factory extends SSLSocketFactory {
        private final SSLSocketFactory delegate;
        Tls12Factory(SSLSocketFactory delegate) {this.delegate=delegate;}
        private java.net.Socket secure(java.net.Socket socket) {
            if(socket instanceof SSLSocket){
                SSLSocket s=(SSLSocket)socket;
                for(String protocol:s.getSupportedProtocols())
                    if("TLSv1.2".equals(protocol)) {s.setEnabledProtocols(new String[]{"TLSv1.2"});break;}
            }
            return socket;
        }
        public String[] getDefaultCipherSuites(){return delegate.getDefaultCipherSuites();}
        public String[] getSupportedCipherSuites(){return delegate.getSupportedCipherSuites();}
        public java.net.Socket createSocket(java.net.Socket s,String host,int port,boolean autoClose) throws java.io.IOException {
            return secure(delegate.createSocket(s,host,port,autoClose));
        }
        public java.net.Socket createSocket(String host,int port) throws java.io.IOException {
            return secure(delegate.createSocket(host,port));
        }
        public java.net.Socket createSocket(String host,int port,java.net.InetAddress local,int localPort) throws java.io.IOException {
            return secure(delegate.createSocket(host,port,local,localPort));
        }
        public java.net.Socket createSocket(java.net.InetAddress host,int port) throws java.io.IOException {
            return secure(delegate.createSocket(host,port));
        }
        public java.net.Socket createSocket(java.net.InetAddress host,int port,java.net.InetAddress local,int localPort) throws java.io.IOException {
            return secure(delegate.createSocket(host,port,local,localPort));
        }
    }
}
