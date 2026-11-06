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
        if(text.length()==0 || has(text,"غير مصنف","uncategorized","general","عام","other","misc")){
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

    public static String from(JSONObject channel){
        if(channel==null)return "عامة";
        String[] fields={"category_name","category_label","group_title","genre","category"};
        String category="";
        for(String field:fields){
            category=channel.optString(field,"");
            if(!category.isEmpty())break;
        }
        String title=channel.optString("title_ar",channel.optString("title",""));
        return classify(category,title,channel.optBoolean("is_kids",false));
    }
}
