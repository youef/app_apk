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
    private final SharedPreferences cache;

    public CatalogApi(Context context) {
        cache = context.getApplicationContext().getSharedPreferences("aseel_catalog_cache_v1", Context.MODE_PRIVATE);
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
            cache.edit().putString(key,json).apply();
            return array;
        } catch (Exception error) {
            Log.w(TAG,"Public catalog unavailable; checking cached data",error);
            String local = cache.getString(key,null);
            if (local != null) return new JSONArray(local);
            throw error;
        }
    }
    private String request(String uri) throws Exception {
        URL url = new URL(uri);
        if (!"https".equalsIgnoreCase(url.getProtocol()))
            throw new SecurityException("HTTPS is required");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        if (Build.VERSION.SDK_INT <= 19) {
            SSLContext tls = SSLContext.getInstance("TLSv1.2");
            tls.init(null,null,new SecureRandom()); // Default trusted certificates; no trust-all.
            connection.setSSLSocketFactory(new Tls12Factory(tls.getSocketFactory()));
        }
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(18000);
        connection.setRequestProperty("apikey",AppConfig.PUBLISHABLE_KEY);
        connection.setRequestProperty("Accept","application/json");
        connection.setRequestProperty("User-Agent","AseelTV/1.0 Android");
        connection.setUseCaches(false);
        try {
            int status=connection.getResponseCode();
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
