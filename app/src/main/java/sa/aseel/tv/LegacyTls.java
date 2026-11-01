package sa.aseel.tv;

import android.content.Context;
import android.os.Build;
import android.util.Log;
import java.io.InputStream;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Provider;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/** Modern TLS 1.2/1.3 and SHA256-verified trust anchors on KitKat. */
public final class LegacyTls {
    private static final String TAG="AseelTLS";
    private static SSLSocketFactory cached;
    private static String providerName="Not initialized";
    private LegacyTls(){}

    public static synchronized SSLSocketFactory factory(Context context)throws Exception{
        if(cached!=null)return cached;
        X509TrustManager manager=new CombinedTrust(systemTrust(),extraTrust(context.getApplicationContext()));
        SSLContext ssl;
        try{
            Provider provider=org.conscrypt.Conscrypt.newProvider();
            ssl=SSLContext.getInstance("TLS",provider);
            ssl.init(null,new TrustManager[]{manager},new SecureRandom());
            providerName="Conscrypt "+provider.getVersion();
        }catch(Exception error){
            Log.w(TAG,"Conscrypt unavailable",error);
            ssl=fallback(manager);
            providerName="Android TLS 1.2 fallback: "+error.getClass().getSimpleName();
        }catch(LinkageError error){
            Log.w(TAG,"Conscrypt native unsupported",error);
            ssl=fallback(manager);
            providerName="Android TLS 1.2 fallback: native unsupported";
        }
        cached=Build.VERSION.SDK_INT<=19
            ? new CatalogApi.Tls12Factory(ssl.getSocketFactory())
            : ssl.getSocketFactory();
        return cached;
    }
    public static synchronized String provider(){return providerName;}
    private static SSLContext fallback(X509TrustManager manager)throws Exception{
        SSLContext ssl=SSLContext.getInstance("TLSv1.2");
        ssl.init(null,new TrustManager[]{manager},new SecureRandom());
        return ssl;
    }
    private static X509TrustManager systemTrust()throws Exception{
        TrustManagerFactory tmf=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init((KeyStore)null);
        return extract(tmf.getTrustManagers());
    }
    private static X509TrustManager extraTrust(Context app)throws Exception{
        KeyStore roots=KeyStore.getInstance(KeyStore.getDefaultType());
        roots.load(null,null);
        append(roots,app,"tls/isrg_root_x1.pem","isrg-root-x1",
          "96BCEC06264976F37460779ACF28C5A7CFE8A3C0AAE11A8FFCEE05C0BDDF08C6");
        append(roots,app,"tls/gts_root_r1.pem","gts-root-r1",
          "D947432ABDE7B7FA90FC2E6B59101B1280E0E1C7E4E40FA3C6887FFF57A7F4CF");
        TrustManagerFactory tmf=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(roots);
        return extract(tmf.getTrustManagers());
    }
    private static void append(KeyStore store,Context app,String filename,String alias,String expected)throws Exception{
        InputStream stream=app.getAssets().open(filename);
        try{
            X509Certificate ca=(X509Certificate)CertificateFactory.getInstance("X.509").generateCertificate(stream);
            byte[] hash=MessageDigest.getInstance("SHA-256").digest(ca.getEncoded());
            StringBuilder fingerprint=new StringBuilder();
            char[] hex="0123456789ABCDEF".toCharArray();
            for(byte part:hash){
                int n=part & 0xff;
                fingerprint.append(hex[n>>>4]).append(hex[n&15]);
            }
            if(!expected.equals(fingerprint.toString()))throw new SecurityException("Invalid CA fingerprint: "+alias);
            ca.checkValidity();
            store.setCertificateEntry(alias,ca);
        }finally{stream.close();}
    }
    private static X509TrustManager extract(TrustManager[] managers)throws Exception{
        for(TrustManager item:managers)if(item instanceof X509TrustManager)return (X509TrustManager)item;
        throw new CertificateException("No X509 trust manager");
    }
    private static final class CombinedTrust implements X509TrustManager{
        private final X509TrustManager system,extra;
        CombinedTrust(X509TrustManager system,X509TrustManager extra){this.system=system;this.extra=extra;}
        public void checkServerTrusted(X509Certificate[] chain,String authType)throws CertificateException{
            try{system.checkServerTrusted(chain,authType);}
            catch(CertificateException error){extra.checkServerTrusted(chain,authType);}
        }
        public void checkClientTrusted(X509Certificate[] chain,String authType)throws CertificateException{
            system.checkClientTrusted(chain,authType);
        }
        public X509Certificate[] getAcceptedIssuers(){
            X509Certificate[] a=system.getAcceptedIssuers(),b=extra.getAcceptedIssuers();
            X509Certificate[] result=new X509Certificate[a.length+b.length];
            System.arraycopy(a,0,result,0,a.length);
            System.arraycopy(b,0,result,a.length,b.length);
            return result;
        }
    }
}
