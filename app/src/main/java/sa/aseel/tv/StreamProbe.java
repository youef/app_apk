package sa.aseel.tv;

import android.content.Context;
import android.util.Log;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.util.Locale;
import javax.net.ssl.HttpsURLConnection;

/**
 * A short, bounded HTTPS probe: identify HTML/error responses masquerading as
 * MP4/HLS. Never disables TLS verification, downloads movies or follows HTTP
 * redirects. This is a diagnostic only, not a media conversion/DRM bypass.
 */
public final class StreamProbe {
    public static final class Result {
        public final String message;
        public final String detectedMime;
        public final boolean rejected;
        private Result(String message,String detectedMime,boolean rejected){
            this.message=message;this.detectedMime=detectedMime;this.rejected=rejected;
        }
    }
    private StreamProbe(){}
    public static Result inspect(Context context,String input){
        if(input==null || !StreamQuality.isDirectUrl(input))
            return new Result("رابط الفيديو ليس MP4/HLS مباشرًا ومصرحًا.",null,true);
        HttpsURLConnection connection=null;
        try {
            URL url=new URL(input);
            int redirects=0;
            while(redirects<=3){
                if(!"https".equalsIgnoreCase(url.getProtocol()))
                    return new Result("محاولة تحويل رابط HTTPS إلى HTTP غير آمن.",null,true);
                connection=(HttpsURLConnection)url.openConnection();
                connection.setSSLSocketFactory(LegacyTls.factory(context.getApplicationContext()));
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(9000);
                connection.setRequestProperty("Range","bytes=0-1023");
                connection.setRequestProperty("Accept","video/mp4,application/vnd.apple.mpegurl,application/x-mpegURL,*/*");
                connection.setRequestProperty("Accept-Encoding","identity");
                connection.setRequestProperty("User-Agent","AlEzzTV/11 Android-TV");
                int code=connection.getResponseCode();
                if(code==301||code==302||code==303||code==307||code==308){
                    String location=connection.getHeaderField("Location");
                    if(location==null)return new Result("تحويل المصدر لا يحتوي على رابط صالح.",null,true);
                    URL next=new URL(url,location);
                    if(!"https".equalsIgnoreCase(next.getProtocol()))
                        return new Result("المصدر يحاول التحويل إلى HTTP غير آمن.",null,true);
                    connection.disconnect();connection=null;url=next;redirects++;continue;
                }
                if(code==401||code==403)
                    return new Result("المصدر يرفض الوصول (HTTP "+code+"). راجع ترخيص الرابط أو انتهاء صلاحيته.",null,true);
                if(code==404||code==410)
                    return new Result("رابط الفيديو مفقود أو انتهت صلاحيته (HTTP "+code+").",null,true);
                if(code<200||code>=300)
                    return new Result("المصدر أعاد HTTP "+code+" بدل الفيديو.",null,true);
                String contentType=connection.getContentType();
                if(contentType==null)contentType="";
                contentType=contentType.toLowerCase(Locale.US);
                InputStream inputStream=connection.getInputStream();
                byte[] first=new byte[1024];
                int bytes=0;
                try{
                    while(bytes<first.length){
                        int n=inputStream.read(first,bytes,first.length-bytes);
                        if(n<=0)break;
                        bytes+=n;
                    }
                }finally{inputStream.close();}
                String prefix=new String(first,0,Math.min(bytes,256),"UTF-8").trim().toLowerCase(Locale.US);
                boolean playlist=prefix.startsWith("#extm3u");
                boolean mp4=bytes>=8 && first[4]=='f' && first[5]=='t' && first[6]=='y' && first[7]=='p';
                if(contentType.contains("text/html")||contentType.contains("application/json")
                   ||prefix.startsWith("<!doctype")||prefix.startsWith("<html")
                   ||prefix.startsWith("{\"error\"")||prefix.startsWith("<head"))
                    return new Result("الرابط أعاد صفحة ويب أو استجابة خطأ وليس ملف فيديو. استبدل المصدر من لوحة الإدارة.",null,true);
                if(playlist)return new Result("تم التحقق من قائمة تشغيل HLS.","application/x-mpegURL",false);
                if(mp4)return new Result("تم التحقق من حاوية MP4.","video/mp4",false);
                if(contentType.contains("mpegurl")||contentType.contains("m3u8"))
                    return new Result("المصدر يعلن HLS لكن يجب التحقق من قائمة التشغيل.","application/x-mpegURL",false);
                if(contentType.contains("mp4")||contentType.contains("octet-stream"))
                    return new Result("المصدر يعلن ملف فيديو؛ التوافق مع ترميز الجهاز غير مؤكد.",null,false);
                if(bytes==0)return new Result("المصدر لم يرسل بيانات فيديو.",null,true);
                return new Result("صيغة الاستجابة غير معروفة؛ سيتم تجربة المشغل.",null,false);
            }
            return new Result("المصدر يحوّل الرابط مرات كثيرة.",null,true);
        }catch(Exception ex){
            Log.w("AlezzProbe","Source header probe unavailable: "+ex.getClass().getSimpleName());
            // Network probe can fail independently of the player; do not block playback.
            return new Result("تعذّر فحص المصدر مبدئيًا ("+ex.getClass().getSimpleName()+")، سنجرّب التشغيل.",null,false);
        }finally{if(connection!=null)connection.disconnect();}
    }
}
