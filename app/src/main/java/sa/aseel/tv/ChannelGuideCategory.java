package sa.aseel.tv;

import java.util.Locale;
import org.json.JSONObject;

/** Deterministic TV channel genres; never fabricates a channel or changes its stream. */
public final class ChannelGuideCategory {
    private ChannelGuideCategory(){}

    private static boolean has(String source,String... keywords){
        for(String word:keywords)if(source.contains(word))return true;
        return false;
    }

    public static String classify(String category,String title,boolean isKids){
        if(isKids)return "أطفال";
        String text=(category==null?"":category).trim().toLowerCase(Locale.US);
        // The category assigned by the publisher takes precedence over title inference.
        if(text.length()==0 || has(text,"قنوات mbc","غير مصنف","uncategorized","general","عام","other","misc")){
            text=(title==null?"":title).trim().toLowerCase(Locale.US);
        }
        if(has(text,"أخبار","الاخبار","اخبار","news","حدث","الحدث","سياسة","politic"))return "أخبار";
        if(has(text,"رياض","sport","football","soccer","bein","كورة","كرة","ملاعب"))return "رياضة";
        if(has(text,"اطفال","أطفال","kids","cartoon","كرتون","spacetoon","baby","junior"))return "أطفال";
        if(has(text,"وثائ","document","nature","wildlife","history","تاريخ","علوم","science","explore"))return "وثائقيات";
        if(has(text,"مسلسل","series","drama","دراما"))return "مسلسلات";
        if(has(text,"أفلام","افلام","cinema","movie","film","أكشن","action","روتانا سينما"))return "أفلام";
        if(has(text,"دين","quran","قرآن","قران","islam","relig","سنة","الحرمين","مكة","السنة"))return "دينية";
        if(has(text,"موسي","music","أغاني","اغاني","song","طرب","rotana clip"))return "موسيقى";
        if(has(text,"تعليم","education","learn","school"))return "تعليمية";
        if(has(text,"طبخ","cook","food","مطبخ"))return "طبخ";
        if(has(text,"ترفيه","entertain","منوعات","variety","comedy","كوميديا"))return "منوعات";
        return "عامة";
    }

    /** Channel provider/network is independent from content genre and never authorizes a stream. */
    public static String broadcaster(JSONObject channel){
        if(channel==null)return "أخرى";
        String title=channel.optString("title_ar",channel.optString("title",""))
            .trim().toLowerCase(Locale.US);
        String category=channel.optString("category_name","").toLowerCase(Locale.US);
        if(title.matches("^mbc(?:(?:\\s|\\+|\\d).*)?$") ||
            title.startsWith("ام بي سي") || category.contains("قنوات mbc"))return "MBC";
        if(title.startsWith("bein")||title.startsWith("بي إن"))return "beIN SPORTS";
        if(title.startsWith("rotana")||title.startsWith("روتانا"))return "روتانا";
        if(title.startsWith("osn"))return "OSN";
        if(title.startsWith("al jazeera")||title.startsWith("al-jazeera")||
            title.startsWith("الجزيرة"))return "الجزيرة";
        if(title.startsWith("al arabiya")||title.startsWith("al-arabiya")||
            title.startsWith("العربية"))return "العربية";
        if(title.startsWith("asharq")||title.startsWith("الشرق"))return "الشرق";
        if(title.startsWith("saudi")||title.startsWith("al saud")||
            title.startsWith("السعودية")||title.startsWith("الإخبارية")||
            title.startsWith("sbc")||title.startsWith("ksa"))return "القنوات السعودية";
        if(title.startsWith("dubai")||title.startsWith("دبي")||
            title.startsWith("سما دبي"))return "قنوات دبي";
        if(title.startsWith("abu dhabi")||title.startsWith("أبوظبي")||
            title.startsWith("ابوظبي"))return "قنوات أبوظبي";
        if(title.startsWith("alkass")||title.startsWith("al kass")||
            title.startsWith("الكأس"))return "الكأس";
        if(title.startsWith("bbc"))return "BBC";
        if(title.startsWith("trt"))return "TRT";
        if(title.startsWith("france 24"))return "France 24";
        if(title.startsWith("sky"))return "Sky";
        return "أخرى";
    }

    public static String from(JSONObject channel){
        if(channel==null)return "عامة";
        String[] fields={"category_name","category_label","group_title","genre","category"};
        String category="";
        for(String field:fields){
            category=channel.optString(field,"");
            if(!category.isEmpty())break;
        }
        String title=channel.optString("title_ar",channel.optString("title",""));
        org.json.JSONArray tags=channel.optJSONArray("genre_tags");
        if(tags!=null){
            for(int i=0;i<tags.length();i++){
                String tag=tags.optString(i,"").toLowerCase(Locale.US);
                if(has(tag,"sport","football","soccer"))return "رياضة";
                if(has(tag,"news","politic"))return "أخبار";
                if(has(tag,"series","drama"))return "مسلسلات";
                if(has(tag,"movie","film","cinema"))return "أفلام";
                if(has(tag,"kids","cartoon","children"))return "أطفال";
                if(has(tag,"documentary","science"))return "وثائقيات";
                if(has(tag,"music"))return "موسيقى";
            }
        }
        return classify(category,title,channel.optBoolean("is_kids",false));
    }
}
