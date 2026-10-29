package sa.aseel.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.net.HttpURLConnection;
import java.security.SecureRandom;
import java.util.Locale;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/** Network access with stock hostname verification and trusted CA chain. */
public final class CatalogApi {
    private static final String TAG = "AseelCatalog";
    private static final long MAX_OFFLINE_CACHE_AGE_MS = 15L * 60L * 1000L;
    private final SharedPreferences cache;
    private final Context context;
    private volatile String lastError = "";

    public CatalogApi(Context context) {
        this.context=context.getApplicationContext();
        cache=this.context.getSharedPreferences("aseel_catalog_cache_v1", Context.MODE_PRIVATE);
    }

    /** Recent cached catalog only: rights may be revoked after 15 minutes. */
    public JSONArray recentCache(String table,String query){
        String key=table+query;
        String json=cache.getString(key,null);
        long age=System.currentTimeMillis()-cache.getLong(key+"_cached_at",0L);
        if(json==null || age<0 || age>MAX_OFFLINE_CACHE_AGE_MS)return null;
        try{return new JSONArray(json);}catch(Exception ignored){return null;}
    }
    public JSONArray list(String table) throws Exception {
        return listQuery(table, "?select=*&order=created_at.desc&limit=" + AppConfig.MAX_ITEMS);
    }
    public JSONArray listQuery(String table, String query) throws Exception {
        if (!table.matches("aseel_[a-z_]+")) throw new IllegalArgumentException("Invalid resource");
        String key = table + query;
        try {
            String json = request(AppConfig.API_ROOT + table + query);
            JSONArray array = new JSONArray(json);
            cache.edit().putString(key,json).putLong(key+"_cached_at",System.currentTimeMillis()).apply();
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
                return new JSONArray(local);
            throw error;
        }
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
