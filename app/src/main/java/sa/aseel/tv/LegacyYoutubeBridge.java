package sa.aseel.tv;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

/** Legal YouTube playback dispatch for old Android TV; never extracts media streams. */
public final class LegacyYoutubeBridge {
    private static final String TAG="AlEzzYouTube";
    private LegacyYoutubeBridge(){}
    public static String open(Activity activity,String id,boolean browserOnly){
        if(id==null||!id.matches("[A-Za-z0-9_-]{11}"))return "invalid";
        String watch="https://www.youtube.com/watch?v="+id;
        if(!browserOnly){
            String[] packages={"com.google.android.youtube.tv","com.google.android.youtube"};
            String[] links={watch,"vnd.youtube:"+id};
            for(String pkg:packages)for(String link:links){
                try{
                    Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(link));
                    intent.setPackage(pkg);
                    if(intent.resolveActivity(activity.getPackageManager())==null)continue;
                    activity.startActivity(intent);
                    return "app";
                }catch(Exception error){Log.w(TAG,"YouTube app did not accept this video",error);}
            }
        }
        Uri mobile=Uri.parse("https://m.youtube.com/watch?v="+id);
        String[] browsers={"com.android.browser","com.android.chrome","org.mozilla.firefox",
            "com.opera.browser","com.sec.android.app.sbrowser"};
        for(String pkg:browsers){
            try{
                Intent intent=new Intent(Intent.ACTION_VIEW,mobile);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setPackage(pkg);
                if(intent.resolveActivity(activity.getPackageManager())==null)continue;
                activity.startActivity(intent);
                return "browser";
            }catch(Exception error){Log.w(TAG,"Browser is not compatible",error);}
        }
        try{
            Intent intent=new Intent(Intent.ACTION_VIEW,mobile);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            if(intent.resolveActivity(activity.getPackageManager())!=null){
                activity.startActivity(intent);
                return "browser";
            }
        }catch(Exception error){Log.w(TAG,"No YouTube browser handler",error);}
        return "unsupported";
    }
}
