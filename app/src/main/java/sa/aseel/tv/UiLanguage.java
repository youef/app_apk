package sa.aseel.tv;

import android.content.Context;
import android.view.View;
import java.util.HashMap;
import java.util.Map;

/** Lightweight device-local bilingual UI labels for the TV's core screens. */
public final class UiLanguage {
    private static final Map<String,String> EN=new HashMap<String,String>();
    static {
        String[][] labels={
            {"العز TV","AL EZZ TV"},{"عالمك السينمائي","Your cinematic world"},
            {"اختر عالمك","Choose your world"},{"الرئيسية","Home"},
            {"القائمة الرئيسية","Home"},{"المسلسلات","Series"},{"الأفلام","Movies"},
            {"البث المباشر","Live TV"},{"القنوات المباشرة","Live channels"},
            {"الأطفال","Kids"},{"عالم الأطفال","Kids world"},{"قائمتي","My List"},
            {"مشاهداتي","My Watching"},{"البحث","Search"},{"الإعدادات","Settings"},
            {"حسابي","My Account"},{"حسابي واشتراكي","Account & Subscription"},
            {"الاشتراك","Subscription"},{"ملفات المشاهدة","Viewing Profiles"},
            {"بروفايلات المشاهدة","Viewing Profiles"},{"المزيد","More"},
            {"أكمل المشاهدة","Continue Watching"},{"أحدث الإضافات","New Arrivals"},
            {"مختارات لك","Recommended for You"},{"عرض الكل","View All"},
            {"اختر ما تريد مشاهدته — أقسام واضحة بالريموت","Choose what to watch with your remote"},
            {"المواسم والحلقات","Seasons & Episodes"},{"مكتبة السينما","Movie Library"},
            {"القنوات والبرامج","Channels & Programs"},{"العمل المميز","Featured"},
            {"شاهد الآن","Watch Now"},{"الإعدادات","Settings"},
            {"تفضيلات التطبيق","App Preferences"},{"إصدار التطبيق","App Version"},
            {"حساب المشاهدة","Viewing Account"},{"اشتراكي","My Subscription"},
            {"تسجيل الخروج من الحساب","Sign Out"},{"إدارة البروفايلات","Manage Profiles"},
            {"تشغيل الحلقة التالية تلقائيًا","Auto-play Next Episode"},
            {"تحديث الأفلام والمسلسلات والقنوات كل دقيقتين","Refresh Catalog Every Two Minutes"},
            {"فحص إصدار APK جديد وتحديث التطبيق","Check for App Updates"},
            {"إعدادات الأطفال","Kids Settings"},{"قنوات IPTV من جهازك","Local IPTV Playlists"},
            {"العربية","Arabic"},{"الإنجليزية","English"},
            {"اللغة","Language"},{"تنبيهات الحلقات الجديدة","New Episode Alerts"},
            {"فحص الحلقات الآن","Check Episodes Now"},
            {"إعادة فحص المصادر المتعطلة","Recheck Failed Sources"},
            {"لا توجد نتائج في هذا القسم","No results in this section"},
            {"اسم الفيلم أو المسلسل أو القناة","Movie, series or channel name"},
            {"لا توجد نتائج","No results"},{"اكتب كلمة للبحث","Enter a search term"},
            {"بحث","Search"},{"الموسم","Season"},{"الحلقة","Episode"},
            {"رجوع إلى القسم","Back to section"},{"عودة","Back"},
            {"جاري تحميل المكتبة...","Loading catalog..."},
            {"المكتبة لم تُحمّل","Catalog unavailable"},{"إعادة المحاولة","Retry"},
            {"لا توجد مشاهدات بعد","No watch history yet"},
            {"لا توجد حلقات جاهزة","No published episodes"},
            {"الحلقات القادمة","Upcoming Episodes"},{"متابعة المشاهدة","Resume"},
            {"● متصل","● Connected"},{"تحديث المكتبة","Refresh Library"},
            {"إضافة إلى قائمتي","Add to My List"},{"أضف إلى قائمتي","Add to My List"},
            {"إزالة من قائمتي","Remove from My List"},
            {"أكمل المشاهدة","Continue Watching"},{"الأعمال المتابعة","Followed Series"},
            {"فحص","Check"},{"الإشعارات","Notifications"},
            {"تصنيفات الأفلام","Movie Categories"},{"تصنيفات المسلسلات","Series Categories"},
            {"تصنيفات القنوات المباشرة","Live TV Categories"}
        };
        for(String[] entry:labels)EN.put(entry[0],entry[1]);
    }
    private UiLanguage(){}
    public static boolean english(Context context){
        return "en".equals(context.getSharedPreferences("alezz_ui_language",Context.MODE_PRIVATE)
            .getString("language","ar"));
    }
    public static void set(Context context,boolean english){
        context.getSharedPreferences("alezz_ui_language",Context.MODE_PRIVATE)
            .edit().putString("language",english?"en":"ar").apply();
    }
    public static int direction(Context context){
        return english(context)?View.LAYOUT_DIRECTION_LTR:View.LAYOUT_DIRECTION_RTL;
    }
    public static String label(Context context,String source){
        if(!english(context)||source==null)return source;
        String result=source;
        // Longest-first phrase replacement also covers icon-prefix labels and subtitles.
        java.util.ArrayList<String> keys=new java.util.ArrayList<String>(EN.keySet());
        java.util.Collections.sort(keys,new java.util.Comparator<String>(){
            public int compare(String a,String b){return b.length()-a.length();}
        });
        for(String key:keys)result=result.replace(key,EN.get(key));
        return result;
    }
}
