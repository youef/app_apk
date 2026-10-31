package sa.aseel.tv;

import android.net.Uri;
/** Validate official individual YouTube video addresses, never resolve or download media. */
public final class YouTubeLink {
    private YouTubeLink(){}
    private static boolean valid(String id){
        return id!=null&&id.matches("[A-Za-z0-9_-]{11}");
    }
    public static String videoId(String value){
        if(value==null||value.length()>600)return null;
        try {
            Uri uri=Uri.parse(value.trim());
            if(!"https".equalsIgnoreCase(uri.getScheme()))return null;
            if(uri.getPort()!=-1 && uri.getPort()!=443)return null;
            String host=uri.getHost();
            if(host==null)return null;
            host=host.toLowerCase(java.util.Locale.US);
            String path=uri.getPath();
            if(path==null)return null;
            String candidate=null;
            if("youtu.be".equals(host)){
                if(path.matches("/[A-Za-z0-9_-]{11}/?"))candidate=path.replace("/","");
            }else if("youtube.com".equals(host)||"www.youtube.com".equals(host)||"m.youtube.com".equals(host)){
                if("/watch".equals(path))candidate=uri.getQueryParameter("v");
                else if(path.matches("/(shorts|live|embed)/[A-Za-z0-9_-]{11}/?")){
                    String[] split=path.split("/");if(split.length>=3)candidate=split[2];
                }
            }
            return valid(candidate)?candidate:null;
        }catch(Exception e){return null;}
    }
    public static boolean usable(String url){return videoId(url)!=null;}
}
