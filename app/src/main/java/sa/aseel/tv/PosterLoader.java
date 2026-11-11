package sa.aseel.tv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.ExecutorService;
import javax.net.ssl.HttpsURLConnection;

/** Bounded memory + disk poster caching for API19: 2MB RAM / 14MB disk / 7 days. */
public final class PosterLoader {
    private static final long MAX_DISK_BYTES=14L*1024L*1024L;
    private static final long MAX_AGE=7L*24L*3600L*1000L;
    private static final ExecutorService work=new java.util.concurrent.ThreadPoolExecutor(
        2,2,30L,java.util.concurrent.TimeUnit.SECONDS,
        new java.util.concurrent.LinkedBlockingDeque<Runnable>(28),
        new java.util.concurrent.ThreadPoolExecutor.DiscardOldestPolicy());
    private static final Handler ui=new Handler(Looper.getMainLooper());
    private static final LruCache<String,Bitmap> bitmaps=new LruCache<String,Bitmap>(2*1024*1024){
        @Override protected int sizeOf(String key,Bitmap value){return value.getByteCount();}
    };
    private PosterLoader(){}
    public static void releaseMemory(){bitmaps.evictAll();}
    /** Delete poster images only; never touch user profiles, favourites or playback history. */
    public static long cachedBytes(Context ctx){
        long size=0;
        File[] files=cacheDirectory(ctx).listFiles();
        if(files!=null)for(File file:files)if(file.isFile())size+=file.length();
        return size;
    }
    public static long clearPosterCache(Context ctx){
        long freed=0;
        File[] files=cacheDirectory(ctx).listFiles();
        if(files!=null)for(File file:files){
            if(!file.isFile())continue;
            long bytes=file.length();
            if(file.delete())freed+=bytes;
        }
        bitmaps.evictAll();
        return freed;
    }
    private static String digest(String source){
        try{
            byte[] data=MessageDigest.getInstance("SHA-256").digest(source.getBytes("UTF-8"));
            StringBuilder out=new StringBuilder();
            for(byte b:data)out.append(String.format(java.util.Locale.US,"%02x",b&255));
            return out.toString();
        }catch(Exception ignored){return Integer.toHexString(source.hashCode());}
    }
    private static File cacheDirectory(Context ctx){
        File dir=new File(ctx.getCacheDir(),"al_ezz_posters_v15");
        if(!dir.exists())dir.mkdirs();
        return dir;
    }
    private static File cachedPath(Context ctx,String url){
        return new File(cacheDirectory(ctx),digest(url)+".jpgcache");
    }
    private static void pruneDisk(Context ctx){
        File[] files=cacheDirectory(ctx).listFiles();
        if(files==null)return;
        long bytes=0,now=System.currentTimeMillis();
        for(File f:files){
            if(!f.isFile())continue;
            if(now-f.lastModified()>MAX_AGE||f.getName().endsWith(".partial"))f.delete();
            else bytes+=f.length();
        }
        files=cacheDirectory(ctx).listFiles();
        if(files==null||bytes<=MAX_DISK_BYTES)return;
        Arrays.sort(files,new Comparator<File>(){
            public int compare(File x,File y){return Long.compare(x.lastModified(),y.lastModified());}
        });
        for(File f:files){
            if(bytes<=MAX_DISK_BYTES)break;
            long size=f.length();if(f.delete())bytes-=size;
        }
    }
    private static Bitmap decode(byte[] data){
        if(data==null||data.length==0)return null;
        BitmapFactory.Options opt=new BitmapFactory.Options();
        opt.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(data,0,data.length,opt);
        if(opt.outWidth<=0||opt.outHeight<=0||opt.outWidth>8000||opt.outHeight>8000)return null;
        opt.inJustDecodeBounds=false;
        opt.inPreferredConfig=Bitmap.Config.RGB_565;
        int sample=1;
        while(opt.outWidth/sample>720||opt.outHeight/sample>500)sample*=2;
        opt.inSampleSize=sample;
        return BitmapFactory.decodeByteArray(data,0,data.length,opt);
    }
    private static byte[] read(File file)throws Exception{
        if(!file.isFile()||file.length()>1800000||file.length()<64)return null;
        FileInputStream stream=new FileInputStream(file);
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        try{
            byte[] buffer=new byte[4096];int n;
            while((n=stream.read(buffer))!=-1){
                if(output.size()+n>1800000)return null;
                output.write(buffer,0,n);
            }
            return output.toByteArray();
        }finally{stream.close();}
    }
    private static void write(Context ctx,String url,byte[] data){
        if(data==null||data.length<64||data.length>1800000)return;
        File dest=cachedPath(ctx,url),tmp=new File(dest.getAbsolutePath()+".partial");
        try{
            FileOutputStream out=new FileOutputStream(tmp);
            try{out.write(data);out.flush();}finally{out.close();}
            if(!tmp.renameTo(dest)){tmp.delete();return;}
            pruneDisk(ctx);
        }catch(Exception ignored){tmp.delete();}
    }
    public static void load(final ImageView target,final String url){
        if(url==null||!url.startsWith("https://")||url.length()>2048)return;
        target.setTag(url);
        Bitmap mem=bitmaps.get(url);
        if(mem!=null){target.setImageBitmap(mem);return;}
        work.execute(new Runnable(){public void run(){
            HttpsURLConnection connection=null;
            Context ctx=target.getContext().getApplicationContext();
            try{
                File disk=cachedPath(ctx,url);
                byte[] raw=null;
                long age=System.currentTimeMillis()-disk.lastModified();
                if(disk.exists()&&age>=0&&age<MAX_AGE)raw=read(disk);
                Bitmap image=decode(raw);
                if(image==null){
                    connection=(HttpsURLConnection)new URL(url).openConnection();
                    connection.setSSLSocketFactory(LegacyTls.factory(ctx));
                    connection.setConnectTimeout(7000);connection.setReadTimeout(9000);
                    if(connection.getResponseCode()!=200||
                       !"https".equalsIgnoreCase(connection.getURL().getProtocol()))return;
                    int size=connection.getContentLength();
                    if(size>1800000)return;
                    InputStream stream=connection.getInputStream();
                    ByteArrayOutputStream output=new ByteArrayOutputStream();
                    try{
                        byte[] buf=new byte[4096];int n;
                        while((n=stream.read(buf))!=-1){
                            if(output.size()+n>1800000)return;
                            output.write(buf,0,n);
                        }
                    }finally{stream.close();}
                    raw=output.toByteArray();
                    image=decode(raw);
                    if(image==null)return;
                    write(ctx,url,raw);
                }
                final Bitmap display=image;
                bitmaps.put(url,display);
                ui.post(new Runnable(){public void run(){
                    if(url.equals(target.getTag()))target.setImageBitmap(display);
                }});
            }catch(Exception ignored){
                // A bad poster never stops video navigation.
            }finally{if(connection!=null)connection.disconnect();}
        }});
    }
}
