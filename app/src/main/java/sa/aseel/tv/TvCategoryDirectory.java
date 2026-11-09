package sa.aseel.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Dynamic category-directory for native TV. A category is shown only when an
 * approved/published item from CatalogApi belongs to it. Every item can belong
 * to multiple categories. Nothing here grants streaming rights or invents media.
 */
public final class TvCategoryDirectory {
    private TvCategoryDirectory(){}

    public static final class Tile {
        public final String key,title,icon;
        public int count;
        Tile(String key,String title,String icon){
            this.key=key;this.title=title;this.icon=icon;
        }
    }

    private static final String[][] GENRES={
        {"romance","رومانسي"},{"comedy","كوميديا"},{"drama","دراما"},
        {"action","أكشن"},{"thriller","إثارة وتشويق"},{"crime","جريمة"},
        {"horror","رعب"},{"mystery","غموض"},{"war","حرب"},
        {"history","تاريخي"},{"historical","تاريخي"},{"fantasy","فانتازيا"},
        {"scifi","خيال علمي"},{"science","علوم"},{"documentary","وثائقي"},
        {"animation","كرتون"},{"anime","أنمي"},{"kids","أطفال"},
        {"family","عائلي"},{"ramadan","رمضان"},{"adventure","مغامرات"},
        {"biography","سيرة ذاتية"},{"short","قصيرة"},{"classic","كلاسيكية"},
        {"music","موسيقى"},{"sports","رياضة"},{"news","أخبار"},
        {"religion","دينية"},{"variety","منوعات"},{"food","طبخ"},
        {"education","تعليمية"},{"series","مسلسلات"},{"movies","أفلام"}
    };
    private static final String[][] COUNTRIES={
        {"TR","تركية"},{"SA","سعودية"},{"EG","مصرية"},{"SY","سورية"},
        {"KW","كويتية"},{"AE","إماراتية"},{"BH","بحرينية"},{"QA","قطرية"},
        {"OM","عمانية"},{"JO","أردنية"},{"LB","لبنانية"},{"IQ","عراقية"},
        {"MA","مغربية"},{"US","أمريكية"},{"IN","هندية"},{"KR","كورية"},
        {"CN","صينية"},{"JP","يابانية"},{"GB","بريطانية"}
    };
    private static final Pattern ARABIC_MARKS=Pattern.compile("[\\u0640\\u064b-\\u065f]");
    private static final Pattern LABEL_SPACING=Pattern.compile("[\\s_-]+");
    private static final String ARAB_COUNTRIES=" SA EG AE KW BH QA OM YE IQ JO LB SY PS MA DZ TN LY SD SO MR DJ KM ";
    private static final String GULF_COUNTRIES=" SA AE KW BH QA OM ";

    private static String string(JSONObject item,String key){
        return item==null||item.isNull(key)?"":item.optString(key,"").trim();
    }
    private static String normalizedLabel(String value){
        String label=value.trim().toLowerCase(Locale.ROOT)
            .replace('أ','ا').replace('إ','ا').replace('آ','ا').replace('ى','ي');
        return LABEL_SPACING.matcher(ARABIC_MARKS.matcher(label).replaceAll("")).replaceAll(" ").trim();
    }
    private static final String[][] GENRE_ALIASES={
        {"romance","romantic","رومانسية","حب وعشق"},
        {"comedy","comic","كوميدي","كوميدية"},{"drama","درامي","درامية"},
        {"action","حركة"},{"history","historical","تاريخية","تاريخ"},
        {"thriller","تشويق","اثارة"},{"scifi","sci fi"},{"crime","بوليسية"},
        {"documentary","documentaries","وثائقية","وثائقيات"},
        {"animation","cartoon","رسوم متحركة"},{"kids","children","الاطفال"},
        {"family","عائلية","اسري"},{"sports","sport","رياضية","الرياضية"},
        {"news","الاخبار","اخبارية"},{"religion","religious","quran","ديني"},
        {"variety","entertainment","ترفيه"},{"movies","film","movie","cinema"},
        {"series","مسلسل"}
    };
    private static final LinkedHashMap<String,String> GENRE_KEYS=new LinkedHashMap<String,String>();
    static{
        for(String[] entry:GENRES){
            GENRE_KEYS.put(entry[0],entry[0]);
            GENRE_KEYS.put(normalizedLabel(entry[1]),entry[0]);
        }
        for(String[] entry:GENRE_ALIASES)
            for(int i=1;i<entry.length;i++)GENRE_KEYS.put(normalizedLabel(entry[i]),entry[0]);
    }
    private static boolean placeholder(String key){
        return key.isEmpty()||key.equals("all")||key.equals("الكل")||key.equals("عام")||
            key.equals("عامة")||key.equals("غير مصنف")||key.equals("general")||
            key.equals("uncategorized")||key.equals("misc")||key.equals("other");
    }
    private static String genreTitle(String canonical){
        if("history".equals(canonical))return "تاريخي";
        for(String[] entry:GENRES)if(entry[0].equals(canonical))return entry[1];
        return canonical;
    }
    private static String countryName(String code){
        for(String[] c:COUNTRIES)if(c[0].equals(code))return c[1];
        return code;
    }
    private static String categoryName(JSONObject item){
        String name=string(item,"category_name");
        if(name.length()==0)name=string(item,"category_label");
        return name;
    }
    private static String withoutPrefix(String text){
        return text.replaceFirst("^(أفلام|افلام|مسلسلات|قنوات|فئة|تصنيف)\\s+", "").trim();
    }
    private static String countryCode(String name){
        String key=normalizedLabel(name);
        for(String[] country:COUNTRIES){
            String label=normalizedLabel(country[1]);
            if(key.equals(country[0].toLowerCase(Locale.ROOT))||key.equals(label)||
                key.equals(label.substring(0,label.length()-1)))return country[0];
        }
        return "";
    }
    private static void addLabel(LinkedHashMap<String,String> tags,String title,boolean channel){
        String normalized=normalizedLabel(title);
        if(placeholder(normalized))return;
        String genre=GENRE_KEYS.get(normalized);
        if(genre!=null){
            String label=genreTitle(genre);
            if(channel&&"documentary".equals(genre))label="وثائقيات";
            add(tags,(channel?"type:":"genre:")+genre,label);
        }else if(!channel&&("خليجي".equals(normalized)||"خليجية".equals(normalized))){
            add(tags,"region:gulf","خليجية");
        }else if(!channel&&("عربي".equals(normalized)||"عربية".equals(normalized))){
            add(tags,"region:arab","عربية");
        }else if(!channel&&("اجنبي".equals(normalized)||"اجنبية".equals(normalized))){
            add(tags,"region:foreign","أجنبية");
        }else{
            String country=countryCode(title);
            if(!country.isEmpty())add(tags,"country:"+country,countryName(country));
            else add(tags,"label:"+normalized,title);
        }
    }
    private static void addCountry(LinkedHashMap<String,String> tags,String code,boolean channel){
        if(!code.matches("[A-Z]{2}"))return;
        add(tags,"country:"+code,countryName(code));
        if(channel)return;
        String token=" "+code+" ";
        if(GULF_COUNTRIES.contains(token))add(tags,"region:gulf","خليجية");
        if(ARAB_COUNTRIES.contains(token))add(tags,"region:arab","عربية");
        else add(tags,"region:foreign","أجنبية");
    }
    private static void addNetwork(LinkedHashMap<String,String> tags,String name){
        String key=normalizedLabel(name);
        if(placeholder(key)||"اخري".equals(key))return;
        if("rotana".equals(key)||"شبكة روتانا".equals(key))name="روتانا";
        if("mbc".equals(key)||"ام بي سي".equals(key))name="MBC";
        if("السعودية".equals(key)||"القنوات السعودية".equals(key))name="القنوات السعودية";
        add(tags,"network:"+normalizedLabel(name),name);
    }
    private static String iconFor(String key,String mediaKind){
        if("all".equals(key))return "guide";
        if(key.contains("romance")||key.contains("family"))return "heart";
        if(key.contains("kids")||key.contains("animation")||key.contains("anime"))return "kids";
        if(key.startsWith("network:"))return "live";
        if(key.startsWith("type:"))return "live";
        return "series".equals(mediaKind)?"series":"channel".equals(mediaKind)?"live":"film";
    }

    private static void add(LinkedHashMap<String,String> tags,String key,String label){
        if(key.length()==0 || label.length()==0 || label.length()>48)return;
        if(!tags.containsKey(key))tags.put(key,label);
    }
    /** Keys are generated from live row metadata. Never use title-only guessing for VOD. */
    private static LinkedHashMap<String,String> tagsFor(JSONObject item,String kind){
        LinkedHashMap<String,String> groups=new LinkedHashMap<String,String>();
        if(item==null)return groups;
        boolean channel="channel".equals(kind);
        String network=channel?ChannelGuideCategory.broadcaster(item):"";
        if(channel)addNetwork(groups,network);
        for(String field:new String[]{"genre_tags","auto_tags"}){
            JSONArray list=item.optJSONArray(field);
            if(list==null)continue;
            for(int i=0;i<list.length();i++){
                String raw=list.optString(i,"").trim();
                String prefix=raw.toLowerCase(Locale.ROOT);
                if(prefix.startsWith("network:")){
                    if(channel)addNetwork(groups,withoutPrefix(raw.substring(8).trim()));
                }else if(prefix.startsWith("country:")){
                    String code=raw.substring(8).trim().toUpperCase(Locale.ROOT);
                    addCountry(groups,code,channel);
                }else if(!list.isNull(i)){
                    addLabel(groups,withoutPrefix(raw),channel);
                }
            }
        }
        String name=categoryName(item);
        String title=withoutPrefix(name);
        String normalized=normalizedLabel(title);
        if(!channel||(!normalized.equals(normalizedLabel(network))&&
            !normalized.equals(normalizedLabel(withoutPrefix(network)))))
            addLabel(groups,title,channel);
        if(item.optBoolean("is_kids",false))addLabel(groups,"أطفال",channel);
        String country=string(item,"country_code").toUpperCase(Locale.US);
        addCountry(groups,country,channel);
        return groups;
    }
    /** All first; other nonempty categories alphabetically for predictable remote navigation. */
    public static ArrayList<Tile> tiles(ArrayList<JSONObject> items,String kind){
        ArrayList<Tile> output=new ArrayList<Tile>();
        Tile all=new Tile("all","الكل","guide");
        all.count=items.size();output.add(all);
        LinkedHashMap<String,Tile> index=new LinkedHashMap<String,Tile>();
        for(JSONObject item:items){
            for(java.util.Map.Entry<String,String> entry:tagsFor(item,kind).entrySet()){
                String key=entry.getKey();
                Tile t=index.get(key);
                if(t==null){
                    t=new Tile(key,entry.getValue(),iconFor(key,kind));
                    index.put(key,t);
                }
                t.count++;
            }
        }
        ArrayList<Tile> sorted=new ArrayList<Tile>(index.values());
        final Collator arabic=Collator.getInstance(new Locale("ar"));
        arabic.setStrength(Collator.PRIMARY);
        Collections.sort(sorted,new Comparator<Tile>(){
            @Override public int compare(Tile a,Tile b){
                int name=arabic.compare(a.title,b.title);
                return name!=0?name:a.key.compareTo(b.key);
            }
        });
        output.addAll(sorted);
        return output;
    }
    public static ArrayList<JSONObject> filter(ArrayList<JSONObject> source,String kind,String selected){
        if("all".equals(selected))return new ArrayList<JSONObject>(source);
        ArrayList<JSONObject> result=new ArrayList<JSONObject>();
        for(JSONObject item:source)if(tagsFor(item,kind).containsKey(selected))result.add(item);
        return result;
    }
}
