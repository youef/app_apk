package sa.aseel.tv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.view.View;
import android.widget.ImageView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import javax.net.ssl.HttpsURLConnection;

/**
 * Full-cover cinema artwork for low-memory Android TV (API 19+).
 * Tries the licensed catalog artwork, then backdrop/official YouTube thumbnail.
 * The calling layout keeps the bundled Al Ezz logo visible while loading/failing.
 */
public final class PosterLoader {
    private static final int MAX_DOWNLOAD_BYTES=5*1024*1024;
    private static final ExecutorService work=new ThreadPoolExecutor(
        2,2,30L,TimeUnit.SECONDS,new LinkedBlockingDeque<Runnable>(24),
        new ThreadPoolExecutor.DiscardOldestPolicy());
    private static final Handler ui=new Handler(Looper.getMainLooper());
    private static final AtomicLong sequence=new AtomicLong();
    private static final LruCache<String,Bitmap> bitmaps=new LruCache<String,Bitmap>(4*1024*1024){
        @Override protected int sizeOf(String key,Bitmap value){return value.getByteCount();}
    };
    private PosterLoader(){}
    public static void releaseMemory(){bitmaps.evictAll();}

    /** Calls must originate on the UI thread. Never reveals a blank image over the logo. */
    public static void load(final ImageView target,final String... urls){
        final ArrayList<String> candidates=new ArrayList<String>();
        if(urls!=null){
            for(String raw:urls){
                if(raw==null)continue;
                String link=raw.trim();
                if(link.startsWith("https://")&&!candidates.contains(link)&&candidates.size()<3)
                    candidates.add(link);
            }
        }
        final String token="poster:"+sequence.incrementAndGet();
        target.setTag(token);
        target.setImageDrawable(null);
        target.setVisibility(View.INVISIBLE);
        if(candidates.isEmpty())return;
        for(String link:candidates){
            Bitmap cached=bitmaps.get(link);
            if(cached!=null&&!cached.isRecycled()){
                show(target,token,cached);
                return;
            }
        }
        final Context app=target.getContext().getApplicationContext();
        work.execute(new Runnable(){
            public void run(){
                for(String link:candidates){
                    if(!token.equals(target.getTag()))return;
                    Bitmap cached=bitmaps.get(link);
                    if(cached==null||cached.isRecycled())cached=fetch(app,link);
                    if(cached==null)continue;
                    bitmaps.put(link,cached);
                    final Bitmap result=cached;
                    ui.post(new Runnable(){public void run(){show(target,token,result);}});
                    return;
                }
                // All links failed. Leave the branded default background fully visible.
            }
        });
    }
    private static void show(ImageView target,String token,Bitmap bitmap){
        if(!token.equals(target.getTag())||bitmap==null||bitmap.isRecycled())return;
        target.setImageBitmap(bitmap);
        target.setAlpha(0f);
        target.setVisibility(View.VISIBLE);
        target.animate().alpha(1f).setDuration(180L).start();
    }
    private static Bitmap fetch(Context app,String uri){
        HttpsURLConnection connection=null;
        try{
            connection=(HttpsURLConnection)new URL(uri).openConnection();
            // Use system trust validation. Never disable certificate checks.
            // Old TVs may show the bundled logo if their CA store is outdated.
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(9000);
            connection.setRequestProperty("Accept","image/jpeg,image/png,image/webp,image/*;q=0.8");
            connection.setRequestProperty("User-Agent","AlEzzTV/10 AndroidTV");
            connection.setInstanceFollowRedirects(true);
            if(connection.getResponseCode()!=200)return null;
            if(!"https".equalsIgnoreCase(connection.getURL().getProtocol()))return null;
            String mime=connection.getContentType();
            if(mime!=null&&!mime.toLowerCase(java.util.Locale.US).startsWith("image/"))return null;
            int length=connection.getContentLength();
            if(length>MAX_DOWNLOAD_BYTES)return null;
            InputStream stream=connection.getInputStream();
            ByteArrayOutputStream output=new ByteArrayOutputStream(length>0?Math.min(length,65536):16384);
            try{
                byte[] buffer=new byte[8192];int n;
                while((n=stream.read(buffer))!=-1){
                    if(output.size()+n>MAX_DOWNLOAD_BYTES)return null;
                    output.write(buffer,0,n);
                }
            }finally{stream.close();}
            byte[] bytes=output.toByteArray();
            BitmapFactory.Options options=new BitmapFactory.Options();
            options.inJustDecodeBounds=true;
            BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
            if(options.outWidth<=0||options.outHeight<=0)return null;
            int sample=1;
            while(options.outWidth/sample>1000||options.outHeight/sample>1200)sample*=2;
            options.inJustDecodeBounds=false;
            options.inSampleSize=sample;
            options.inPreferredConfig=Bitmap.Config.RGB_565;
            return BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
        }catch(Exception ignored){
            return null;
        }finally{
            if(connection!=null)connection.disconnect();
        }
    }
}
