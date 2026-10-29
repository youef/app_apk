package sa.aseel.tv;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import java.security.SecureRandom;
import android.os.Build;

/** Two background workers and a small in-memory bitmap cache for low-RAM TVs. */
public final class PosterLoader {
    private static final ExecutorService work=new java.util.concurrent.ThreadPoolExecutor(
        1,1,30L,java.util.concurrent.TimeUnit.SECONDS,
        new java.util.concurrent.LinkedBlockingDeque<Runnable>(12),
        new java.util.concurrent.ThreadPoolExecutor.DiscardOldestPolicy());
    private static final Handler ui=new Handler(Looper.getMainLooper());
    private static final LruCache<String,Bitmap> bitmaps=new LruCache<String,Bitmap>(2*1024*1024){
        @Override protected int sizeOf(String key,Bitmap value){return value.getByteCount();}
    };
    private PosterLoader(){}
    public static void releaseMemory(){bitmaps.evictAll();}
    public static void load(final ImageView target,final String url){
        if(url==null||!url.startsWith("https://"))return;
        target.setTag(url);
        Bitmap image=bitmaps.get(url);
        if(image!=null){target.setImageBitmap(image);return;}
        work.execute(new Runnable(){
            public void run(){
                HttpsURLConnection conn=null;
                try{
                    conn=(HttpsURLConnection)new URL(url).openConnection();
                    conn.setSSLSocketFactory(LegacyTls.factory(target.getContext().getApplicationContext()));
                    conn.setConnectTimeout(7000);conn.setReadTimeout(9000);
                    if(conn.getResponseCode()!=200)return;
                    int size=conn.getContentLength();
                    if(size>850000)return;
                    InputStream stream=conn.getInputStream();
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                    try {
                        byte[] data=new byte[4096];int r;
                        while((r=stream.read(data))!=-1){
                            if(bytes.size()+r>850000)return;
                            bytes.write(data,0,r);
                        }
                    } finally {stream.close();}
                    byte[] data=bytes.toByteArray();
                    BitmapFactory.Options opt=new BitmapFactory.Options();
                    opt.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(data,0,data.length,opt);
                    opt.inJustDecodeBounds=false;
                    int sample=1;
                    while(opt.outWidth/sample>260 || opt.outHeight/sample>390)sample*=2;
                    opt.inPreferredConfig=Bitmap.Config.RGB_565;
                    opt.inSampleSize=sample;
                    final Bitmap img=BitmapFactory.decodeByteArray(data,0,data.length,opt);
                    if(img==null)return;
                    bitmaps.put(url,img);
                    ui.post(new Runnable(){public void run(){
                        if(url.equals(target.getTag()))target.setImageBitmap(img);
                    }});
                }catch(Exception ignored){
                    // Poster failure must never crash navigation.
                }finally{if(conn!=null)conn.disconnect();}
            }
        });
    }
}
