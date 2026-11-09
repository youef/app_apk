package sa.aseel.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;

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
        {"music","موسيقى"},{"sports","رياضة"},{"news","أخبار"}
    };
    private static final String[][] COUNTRIES={
        {"TR","تركية"},{"SA","سعودية"},{"EG","مصرية"},{"SY","سورية"},
        {"KW","كويتية"},{"AE","إماراتية"},{"BH","بحرينية"},{"QA","قطرية"},
        {"OM","عمانية"},{"JO","أردنية"},{"LB","لبنانية"},{"IQ","عراقية"},
        {"MA","مغربية"},{"US","أمريكية"},{"IN","هندية"},{"KR","كورية"},
        {"CN","صينية"},{"JP","يابانية"},{"GB","بريطانية"}
    };

    private static String string(JSONObject item,String key){
        return item==null?"":item.optString(key,"").trim();
    }
    private static boolean contains(String text,String... words){
        for(String word:words)if(text.contains(word))return true;
        return false;
    }
    private static String normalizedGenre(String input){
        String t=input.trim().toLowerCase(Locale.US).replace('_','-');
        if(t.length()==0)return "";
        if(contains(t,"romance","romantic","رومان","حب وعشق"))return "romance";
        if(contains(t,"comedy","comic","كوميد","ضحك"))return "comedy";
        if(contains(t,"drama","درام"))return "drama";
        if(contains(t,"action","أكشن","اكشن"))return "action";
        if(contains(t,"thriller","تشويق","إثار","اثار"))return "thriller";
        if(contains(t,"crime","جريم"))return "crime";
        if(contains(t,"horror","رعب"))return "horror";
        if(contains(t,"mystery","غموض"))return "mystery";
        if(contains(t,"war","حرب","حروب"))return "war";
        if(contains(t,"historical","تاريخي"))return "history";
        if(contains(t,"history","تاريخ"))return "history";
        if(contains(t,"fantasy","فانتاز"))return "fantasy";
        if(contains(t,"scifi","sci-fi","خيال علمي"))return "scifi";
        if(contains(t,"science","علوم"))return "science";
        if(contains(t,"documentary","وثائق"))return "documentary";
        if(contains(t,"animation","cartoon","كرتون","رسوم متحركة"))return "animation";
        if(contains(t,"anime","أنمي","انمي","أنيمي"))return "anime";
        if(contains(t,"kids","children","أطفال","اطفال"))return "kids";
        if(contains(t,"family","عائل","أسري"))return "family";
        if(contains(t,"ramadan","رمضان"))return "ramadan";
        if(contains(t,"adventure","مغامر"))return "adventure";
        if(contains(t,"biography","سيرة ذاتية"))return "biography";
        if(contains(t,"short","قصير"))return "short";
        if(contains(t,"classic","كلاسيك","قديم"))return "classic";
        if(contains(t,"music","موسيقى","أغان"))return "music";
        if(contains(t,"sport","رياضة","رياضي"))return "sports";
        if(contains(t,"news","أخبار","اخبار"))return "news";
        // Unknown labels remain data-driven. Avoid long or suspicious label strings.
        return t.length()>42?"":t;
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
    private static String categoryKey(String name,String mediaKind){
        String title=withoutPrefix(name);
        // Production-country groups are shared by manual categories and country_code.
        for(String[] country:COUNTRIES)
            if(title.equals(country[1])||title.equals(country[1].replace("ة","")) ||
                title.equals(country[1].replace("ية","ي")))
                return "country:"+country[0];
        // Do not confuse channel network labels (e.g. Rotana) with genres.
        if("channel".equals(mediaKind))return "source:"+title;
        String genre=normalizedGenre(title);
        if(genre.isEmpty())return "";
        // Use a raw source category only when it was actually tagged with a unique
        // descriptive title, not for "all", a generic site grouping or placeholder.
        if(contains(genre,"غير مصنف","general","uncategorized","misc","other","الكل"))return "";
        return "genre:"+genre;
    }
    private static String labelFor(String key,String original){
        if(key.startsWith("genre:"))return genreTitle(key.substring(6));
        if(key.startsWith("country:"))return countryName(key.substring(8));
        if(key.startsWith("network:"))return key.substring(8);
        if(key.startsWith("type:"))return key.substring(5);
        if(key.startsWith("source:"))return key.substring(7);
        return original;
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
        if("channel".equals(kind)){
            String type=ChannelGuideCategory.from(item);
            add(groups,"type:"+type,type);
            String network=ChannelGuideCategory.broadcaster(item);
            add(groups,"network:"+network,network);
            String explicit=categoryName(item);
            if(explicit.length()>0){
                String key=categoryKey(explicit,kind);
                if(!key.isEmpty())add(groups,key,labelFor(key,explicit));
            }
            return groups;
        }
        for(String field:new String[]{"genre_tags","auto_tags"}){
            JSONArray list=item.optJSONArray(field);
            if(list==null)continue;
            for(int i=0;i<list.length();i++){
                String raw=list.optString(i,"").trim();
                String genre=normalizedGenre(raw);
                if(genre.length()>0){
                    String key="genre:"+genre;
                    add(groups,key,genreTitle(genre));
                }
            }
        }
        String name=categoryName(item);
        if(name.length()>0){
            String key=categoryKey(name,kind);
            if(!key.isEmpty())add(groups,key,labelFor(key,name));
        }
        String country=string(item,"country_code").toUpperCase(Locale.US);
        if(country.matches("[A-Z]{2}"))
            add(groups,"country:"+country,countryName(country));
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
