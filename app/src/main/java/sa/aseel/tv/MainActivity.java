package sa.aseel.tv;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Aseel TV — native light-weight Arabic TV catalog for API 19+.
 * Catalog items are shown only after server-side publishing and rights approval.
 * All navigation is possible using D-pad + OK; no Google Play Services.
 */
public final class MainActivity extends Activity {
    private static final int NAVY=0xFF081526, PANEL=0xFF12263E, GOLD=0xFFE5BF7D, WHITE=0xFFF7F6F0, MUTED=0xFFBBC5D1;
    private final String[] labels={"الرئيسية","الأفلام","المسلسلات","القنوات","المفضلة","البحث","الإعدادات"};
    private final String[] modes={"home","movie","series","channel","favorites","search","settings"};
    private LinearLayout stage,root,menu;
    private ScrollView scrolling;
    private TextView notice;
    private String mode="home";
    private String lastMode="home";
    private String networkErrors="";
    private boolean loading=false,hasLoaded=false;
    private long lastUpdatedAt=0L;
    private final Handler refreshHandler=new Handler();
    private final Runnable refreshLoop=new Runnable(){
        public void run(){
            if(hasLoaded&&!loading&&System.currentTimeMillis()-lastUpdatedAt>=5L*60L*1000L)
                loadCatalog();
            refreshHandler.postDelayed(this,60L*1000L);
        }
    };
    private JSONArray movies=new JSONArray(),series=new JSONArray(),channels=new JSONArray(),categories=new JSONArray();
    private CatalogApi api;
    private SharedPreferences prefs;
    @Override public void onCreate(Bundle bundle){
        super.onCreate(bundle);
        prefs=getSharedPreferences("aseel_user_v2",MODE_PRIVATE);
        api=new CatalogApi(this);
        buildShell();
        warmCache();
        render();
        loadCatalog();
    }
    private int dp(int val){return Math.round(val*getResources().getDisplayMetrics().density);}
    private LinearLayout vertical(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    private LinearLayout horizontal(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);l.setGravity(Gravity.CENTER_VERTICAL);return l;}
    private LinearLayout.LayoutParams lp(int w,int h){return new LinearLayout.LayoutParams(w,h);}
    private LinearLayout.LayoutParams gap(int top,int bottom){
        LinearLayout.LayoutParams p=lp(-1,-2);p.setMargins(0,dp(top),0,dp(bottom));return p;
    }
    private GradientDrawable background(int color,int radius,int stroke){
        GradientDrawable g=new GradientDrawable();g.setColor(color);
        g.setCornerRadius(dp(radius));if(stroke!=0)g.setStroke(dp(1),stroke);return g;
    }
    private TextView text(String value,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);
        t.setTextDirection(View.TEXT_DIRECTION_RTL);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        return t;
    }
    private void buildShell(){
        root=vertical();root.setBackgroundColor(NAVY);root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        LinearLayout top=horizontal();top.setBackgroundColor(0xFF101D30);
        top.setPadding(dp(20),dp(9),dp(20),dp(9));
        root.addView(top,lp(-1,-2));
        TextView brand=text("أسيل",31,GOLD,true);
        top.addView(brand,lp(dp(110),-2));
        TextView tag=text("ASEEL TV",11,MUTED,false);
        top.addView(tag,lp(dp(76),-2));
        HorizontalScrollView nav=new HorizontalScrollView(this);
        nav.setHorizontalScrollBarEnabled(false);nav.setFillViewport(false);
        top.addView(nav,new LinearLayout.LayoutParams(0,dp(48),1));
        menu=horizontal();nav.addView(menu);
        for(int i=0;i<labels.length;i++){
            final String target=modes[i];
            Button b=button(labels[i]);b.setTextSize(14);
            LinearLayout.LayoutParams p=lp(dp(102),dp(44));p.setMargins(dp(3),0,dp(3),0);
            menu.addView(b,p);
            b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){mode=target;render();}});
        }
        notice=text("",12,MUTED,false);
        notice.setPadding(dp(24),dp(4),dp(24),dp(4));
        notice.setVisibility(View.GONE);root.addView(notice,lp(-1,-2));
        scrolling=new ScrollView(this);scrolling.setFillViewport(true);
        scrolling.setSmoothScrollingEnabled(false);
        root.addView(scrolling,new LinearLayout.LayoutParams(-1,0,1));
        stage=vertical();stage.setPadding(dp(22),dp(14),dp(22),dp(28));
        scrolling.addView(stage,new ScrollView.LayoutParams(-1,-2));
        setContentView(root);
    }
    private Button button(String label){
        final Button b=new Button(this);
        b.setText(label);b.setTextSize(16);b.setTextColor(WHITE);b.setAllCaps(false);
        b.setPadding(dp(9),dp(5),dp(9),dp(5));
        b.setFocusable(true);
        b.setBackgroundDrawable(background(PANEL,9,0xFF3A536A));
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View view,boolean focused){
                b.setBackgroundDrawable(background(focused?GOLD:PANEL,9,focused?0xFFF9E5B7:0xFF3A536A));
                b.setTextColor(focused?NAVY:WHITE);
                b.setScaleX(focused?1.03f:1f);b.setScaleY(focused?1.03f:1f);
            }
        });
        return b;
    }
    private void title(String heading,String caption){
        TextView h=text(heading,25,GOLD,true);stage.addView(h,gap(7,4));
        if(caption!=null){TextView c=text(caption,14,MUTED,false);stage.addView(c,gap(0,12));}
    }
    private void empty(String text){
        TextView e=text(text,18,MUTED,false);
        e.setGravity(Gravity.CENTER);e.setPadding(dp(24),dp(34),dp(24),dp(34));
        stage.addView(e,gap(20,15));
    }
    private void showStatus(String value){
        notice.setText(value);notice.setVisibility(value.length()==0?View.GONE:View.VISIBLE);
    }
    private String str(JSONObject x,String key){return x.optString(key,"").equals("null")?"":x.optString(key,"");}
    private JSONArray data(String m){
        if("movie".equals(m))return movies;
        if("series".equals(m))return series;
        if("channel".equals(m))return channels;
        return new JSONArray();
    }
    private void warmCache(){
        JSONArray m=api.recentCache("aseel_movies","?select=*&order=created_at.desc&limit="+AppConfig.MAX_ITEMS);
        JSONArray s=api.recentCache("aseel_series","?select=*&order=created_at.desc&limit="+AppConfig.MAX_ITEMS);
        JSONArray c=api.recentCache("aseel_channels","?select=*&order=created_at.desc&limit="+AppConfig.MAX_ITEMS);
        JSONArray cats=api.recentCache("aseel_categories","?select=*&order=sort_order.asc&limit=60");
        if(m!=null){movies=m;hasLoaded=true;}
        if(s!=null){series=s;hasLoaded=true;}
        if(c!=null){channels=c;hasLoaded=true;}
        if(cats!=null){categories=cats;hasLoaded=true;}
    }
    private void loadCatalog(){
        if(loading)return;
        loading=true;showStatus(hasLoaded?"جاري تحديث المكتبة...":"جارٍ تحميل الأفلام والمسلسلات والقنوات...");
        new Thread(new Runnable(){public void run(){
            final String[] tables={"aseel_movies","aseel_series","aseel_channels","aseel_categories"};
            final JSONArray[] fetched=new JSONArray[4];
            final String[] errors=new String[4];
            final CountDownLatch latch=new CountDownLatch(4);
            for(int index=0;index<4;index++){
                final int i=index;
                Thread task=new Thread(new Runnable(){public void run(){
                    try{
                        fetched[i]=i==3?api.listQuery(tables[i],"?select=*&order=sort_order.asc&limit=60"):api.list(tables[i]);
                    }catch(Exception e){errors[i]=CatalogApi.describe(e);}
                    finally{latch.countDown();}
                }},"Aseel-Catalog-"+i);
                task.setDaemon(true);task.start();
            }
            try{latch.await(35,TimeUnit.SECONDS);}catch(InterruptedException ignored){}
            runOnUiThread(new Runnable(){public void run(){
                if(isFinishing())return;
                if(fetched[0]!=null)movies=fetched[0];
                if(fetched[1]!=null)series=fetched[1];
                if(fetched[2]!=null)channels=fetched[2];
                if(fetched[3]!=null)categories=fetched[3];
                hasLoaded=true;loading=false;
                lastUpdatedAt=System.currentTimeMillis();
                String[] names={"الأفلام","المسلسلات","القنوات","التصنيفات"};
                StringBuilder report=new StringBuilder();
                for(int i=0;i<4;i++){
                    if(errors[i]!=null)report.append(names[i]).append(": ").append(errors[i]).append("\n");
                    else if(fetched[i]==null)report.append(names[i]).append(": انتهت المهلة.\n");
                }
                networkErrors=report.toString();
                showStatus(report.length()>0?"فشل تحديث بعض البيانات، الاحتفاظ بالمحتوى المخزن مؤقتًا. راجع الإعدادات.":"");
                render();
            }});
        }},"Aseel-Refresh").start();
    }
    private void render(){
        if(stage==null)return;
        stage.removeAllViews();scrolling.scrollTo(0,0);
        if("home".equals(mode)){home();return;}
        if("movie".equals(mode)||"series".equals(mode)||"channel".equals(mode)){listing(mode,false);return;}
        if("favorites".equals(mode)){favorites();return;}
        if("search".equals(mode)){search();return;}
        if("settings".equals(mode)){settings();return;}
    }
    private void home(){
        LinearLayout hero=vertical();hero.setPadding(dp(25),dp(16),dp(25),dp(16));
        hero.setBackgroundDrawable(background(0xFF1C324A,14,0xFF6C604E));
        stage.addView(hero,gap(2,12));
        TextView heroTitle=text("أسيل | عالم السينما في بيتك",30,GOLD,true);hero.addView(heroTitle);
        TextView heroSub=text("أفلام ومسلسلات وقنوات مرخصة — استمتع بالتصفح من الريموت",17,WHITE,false);
        hero.addView(heroSub,gap(2,14));
        Button go=button("استعرض الأفلام");hero.addView(go,lp(dp(200),dp(49)));
        go.setOnClickListener(new View.OnClickListener(){public void onClick(View v){mode="movie";render();}});
        if(!hasLoaded){empty("جاري الاتصال بمكتبة أسيل...");return;}
        section("أحدث الأفلام",movies,"movie",8);
        section("المسلسلات",series,"series",8);
        section("القنوات المتاحة",channels,"channel",8);
        categoriesRow();
        resumeRow();
        ArrayList<JSONObject> recent=new ArrayList<JSONObject>();
        addRecent(recent,movies,"movie");addRecent(recent,series,"series");
        if(!recent.isEmpty()){
            title("متابعة المشاهدة","استكمل من الموضع المحفوظ على هذا التلفزيون");
            cards(recent,8);
        }
        if(movies.length()+series.length()+channels.length()==0)
            empty("المكتبة خالية حاليًا. ستظهر الأعمال المعتمدة تلقائيًا بعد إضافتها من لوحة الإدارة.");
    }
    private void resumeRow(){
        final String resumeId=prefs.getString("resume_id","");
        final String resumeUrl=prefs.getString("resume_url","");
        final int position=prefs.getInt("position_"+resumeId,0);
        if(resumeId.length()==0 || !resumeUrl.startsWith("https://") || position<10000)return;
        title("متابعة آخر مشاهدة","اضغط OK للاستكمال من موضعك السابق");
        Button resume=button("▶ متابعة: "+prefs.getString("resume_title","آخر فيديو"));
        stage.addView(resume,lp(-1,dp(60)));
        resume.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            Intent intent=new Intent(MainActivity.this,PlayerActivity.class);
            intent.putExtra("item_id",resumeId);
            intent.putExtra("title",prefs.getString("resume_title","متابعة المشاهدة"));
            intent.putExtra("stream_url",resumeUrl);
            startActivity(intent);
        }});
    }
    private void categoriesRow(){
        if(categories.length()==0)return;
        title("التصنيفات","اكتشف الأعمال المرخصة بحسب نوعها");
        HorizontalScrollView wrap=new HorizontalScrollView(this);
        wrap.setHorizontalScrollBarEnabled(false);
        LinearLayout row=horizontal();wrap.addView(row);
        stage.addView(wrap,gap(3,16));
        for(int c=0;c<categories.length();c++){
            JSONObject cat=categories.optJSONObject(c);if(cat==null)continue;
            final String id=str(cat,"id");
            Button b=button(str(cat,"name_ar"));b.setTextSize(13);
            LinearLayout.LayoutParams p=lp(dp(156),dp(50));p.setMargins(dp(5),0,dp(5),0);
            row.addView(b,p);
            b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                stage.removeAllViews();
                Button back=button("العودة للرئيسية");stage.addView(back,lp(dp(210),dp(48)));
                back.setOnClickListener(new View.OnClickListener(){public void onClick(View w){mode="home";render();}});
                ArrayList<JSONObject> items=new ArrayList<JSONObject>();
                addCategoryItems(items,movies,"movie",id);
                addCategoryItems(items,series,"series",id);
                addCategoryItems(items,channels,"channel",id);
                if(items.isEmpty())empty("لا يوجد محتوى منشور لهذا التصنيف.");
                else cards(items,AppConfig.MAX_ITEMS);
            }});
        }
    }
    private void addCategoryItems(ArrayList<JSONObject> out,JSONArray source,String type,String categoryId){
        for(int j=0;j<source.length();j++){
            JSONObject item=source.optJSONObject(j);
            if(item!=null && categoryId.equals(str(item,"category_id"))){
                try{item.put("_type",type);}catch(Exception ignored){}
                out.add(item);
            }
        }
    }
    @Override protected void onResume(){
        super.onResume();
        if(hasLoaded && !loading && System.currentTimeMillis()-lastUpdatedAt > 5L*60L*1000L){
            loadCatalog();
        }
        refreshHandler.removeCallbacks(refreshLoop);
        refreshHandler.postDelayed(refreshLoop,60L*1000L);
    }
    @Override protected void onPause(){
        refreshHandler.removeCallbacks(refreshLoop);
        super.onPause();
    }
    private void section(String title,JSONArray list,String type,int max){
        if(list.length()==0)return;
        title(title,null);
        ArrayList<JSONObject> items=new ArrayList<JSONObject>();
        for(int i=0;i<list.length()&&i<max;i++){
            JSONObject o=list.optJSONObject(i);if(o!=null){try{o.put("_type",type);}catch(Exception ignored){}items.add(o);}
        }
        cards(items,max);
    }
    private void listing(String type,boolean unused){
        String t="movie".equals(type)?"الأفلام":"series".equals(type)?"المسلسلات":"القنوات";
        title(t,"جميع العناصر المنشورة والمصرح بحقوقها");
        final JSONArray list=data(type);
        if(!hasLoaded){empty("جاري تحميل البيانات...");return;}
        if(list.length()==0){empty("لا توجد أعمال متاحة في هذا القسم.");return;}
        ArrayList<JSONObject> all=new ArrayList<JSONObject>();
        for(int i=0;i<list.length();i++){JSONObject o=list.optJSONObject(i);
            if(o!=null){try{o.put("_type",type);}catch(Exception ignored){}all.add(o);}}
        cards(all,AppConfig.MAX_ITEMS);
    }
    private void cards(ArrayList<JSONObject> all,int max){
        if(all.isEmpty())return;
        HorizontalScrollView scroller=new HorizontalScrollView(this);
        scroller.setHorizontalScrollBarEnabled(false);
        LinearLayout holder=horizontal();holder.setGravity(Gravity.TOP);
        scroller.addView(holder);
        stage.addView(scroller,gap(4,20));
        for(int i=0;i<all.size()&&i<max;i++){
            final JSONObject item=all.get(i);
            LinearLayout card=vertical();card.setPadding(dp(5),dp(5),dp(5),dp(7));
            card.setBackgroundDrawable(background(0xFF132740,12,0xFF2C4057));
            LinearLayout.LayoutParams cardLp=lp(dp(168),-2);cardLp.setMargins(dp(6),0,dp(6),0);
            holder.addView(card,cardLp);
            ImageView poster=new ImageView(this);poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
            poster.setBackgroundDrawable(background(0xFF29415B,8,0));
            card.addView(poster,lp(-1,dp(162)));
            if(!prefs.getBoolean("lite_mode",false))PosterLoader.load(poster,str(item,"poster_url"));
            TextView name=text(str(item,"title_ar"),16,WHITE,true);name.setSingleLine(true);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            card.addView(name,gap(8,2));
            String year=str(item,"release_year");
            TextView meta=text(year.length()>0?year+"  •  "+str(item,"quality"):str(item,"quality"),12,MUTED,false);
            card.addView(meta);
            Button detail=button("عرض التفاصيل");detail.setTextSize(13);card.addView(detail,gap(7,0));
            detail.setOnClickListener(new View.OnClickListener(){
                public void onClick(View v){lastMode=mode;details(item);}
            });
        }
    }
    private void details(final JSONObject item){
        stage.removeAllViews();scrolling.scrollTo(0,0);
        Button back=button("رجوع إلى القائمة");stage.addView(back,lp(dp(220),dp(48)));
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){mode=lastMode;render();}});
        title(str(item,"title_ar"),str(item,"title_original"));
        String description=str(item,"description");
        if(description.length()>0){TextView d=text(description,17,WHITE,false);stage.addView(d,gap(8,15));}
        TextView about=text("سنة الإنتاج: "+str(item,"release_year")+"    اللغة: "+str(item,"language_code")+"    الجودة: "+str(item,"quality")
                +"\nصاحب الحقوق: "+str(item,"rights_holder")
                +"\nالترخيص: "+str(item,"license_reference"),15,MUTED,false);
        stage.addView(about,gap(5,20));
        LinearLayout actions=horizontal();stage.addView(actions,gap(2,15));
        String type=str(item,"_type");if(type.length()==0)type="movie";
        final String t=type, id=str(item,"id"),url=str(item,"stream_url");
        if(!"series".equals(t)){
            Button play=button("▶ تشغيل");actions.addView(play,lp(dp(160),dp(54)));
            play.setText("channel".equals(t)&&"official_link".equals(str(item,"playback_mode"))?"فتح البث الرسمي":"▶ تشغيل");
            play.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(item,null,null,null);}});
            if("channel".equals(t) && str(item,"official_url").startsWith("https://")){
                Button official=button("موقع القناة");actions.addView(official,lp(dp(180),dp(54)));
                official.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                    try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(str(item,"official_url"))));}
                    catch(Exception e){showStatus("لا يوجد متصفح مناسب لعرض موقع القناة");}
                }});
            }
        }else{
            Button episodes=button("عرض الحلقات");actions.addView(episodes,lp(dp(180),dp(54)));
            episodes.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadEpisodes(item);}});
        }
        final Button favorite=button(isFavorite(t,id)?"إزالة من المفضلة":"إضافة للمفضلة");
        LinearLayout.LayoutParams fp=lp(dp(190),dp(54));fp.setMargins(dp(10),0,0,0);
        actions.addView(favorite,fp);
        favorite.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            toggleFavorite(t,id);favorite.setText(isFavorite(t,id)?"إزالة من المفضلة":"إضافة للمفضلة");
        }});
    }
    private void play(JSONObject item,String nextUrl,String nextId,String nextTitle){
        String url=str(item,"stream_url");
        if("official_link".equals(str(item,"playback_mode"))){
            String official=str(item,"official_url");
            if(!official.startsWith("https://")){showStatus("رابط الجهة الرسمية غير صالح");return;}
            try{
                Intent browser=new Intent(Intent.ACTION_VIEW,Uri.parse(official));
                startActivity(browser);
            }catch(Exception e){showStatus("لا يوجد متصفح متوافق لفتح البث الرسمي على التلفزيون");}
            return;
        }
        if(!url.startsWith("https://")){showStatus("لا يمكن تشغيل رابط غير HTTPS");return;}
        Intent i=new Intent(this,PlayerActivity.class);
        i.putExtra("stream_url",url);i.putExtra("official_url",str(item,"official_url"));
        i.putExtra("title",str(item,"title_ar"));
        i.putExtra("item_id",str(item,"id"));if(nextUrl!=null)i.putExtra("next_url",nextUrl);
        if(nextId!=null)i.putExtra("next_item_id",nextId);
        if(nextTitle!=null)i.putExtra("next_title",nextTitle);
        startActivity(i);
    }
    private void loadEpisodes(final JSONObject seriesItem){
        stage.removeAllViews();title("تحميل الحلقات...","يرجى الانتظار");
        new Thread(new Runnable(){public void run(){
            final ArrayList<JSONObject> entries=new ArrayList<JSONObject>();
            String failure="";
            try {
                String seriesId=str(seriesItem,"id");
                JSONArray seasons=api.listQuery("aseel_seasons","?select=*&series_id=eq."+seriesId+"&order=number.asc&limit=100");
                for(int i=0;i<seasons.length();i++){
                    JSONObject season=seasons.getJSONObject(i);
                    JSONArray eps=api.listQuery("aseel_episodes","?select=*&season_id=eq."+str(season,"id")+"&order=number.asc&limit=100");
                    for(int j=0;j<eps.length();j++){
                        JSONObject ep=eps.getJSONObject(j);ep.put("_type","episode");
                        ep.put("_season",season.optInt("number"));entries.add(ep);
                    }
                }
            }catch(Exception e){failure=e.getClass().getSimpleName();}
            final String f=failure;
            runOnUiThread(new Runnable(){public void run(){
                stage.removeAllViews();
                Button back=button("رجوع إلى المسلسل");stage.addView(back,lp(dp(205),dp(50)));
                back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){details(seriesItem);}});
                title("حلقات "+str(seriesItem,"title_ar"),null);
                if(!f.isEmpty())empty("تعذر جلب الحلقات: "+f);
                else if(entries.isEmpty())empty("لم تُنشر حلقات مرخصة لهذا المسلسل بعد.");
                for(int k=0;k<entries.size();k++){
                    final JSONObject e=entries.get(k);
                    final String next=k+1<entries.size()?str(entries.get(k+1),"stream_url"):null;
                    final String nextId=k+1<entries.size()?str(entries.get(k+1),"id"):null;
                    final String nextTitle=k+1<entries.size()?str(entries.get(k+1),"title_ar"):null;
                    Button b=button("الموسم "+e.optInt("_season")+" | الحلقة "+e.optInt("number")+" — "+str(e,"title_ar"));
                    stage.addView(b,gap(3,3));
                    b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(e,next,nextId,nextTitle);}});
                }
            }});
        }}).start();
    }
    private Set<String> saved(){return new HashSet<String>(prefs.getStringSet("favorites",new HashSet<String>()));}
    private boolean isFavorite(String type,String id){return saved().contains(type+":"+id);}
    private void toggleFavorite(String type,String id){
        Set<String> set=saved();String key=type+":"+id;
        if(set.contains(key))set.remove(key);else set.add(key);
        prefs.edit().putStringSet("favorites",set).apply();
    }
    private void favorites(){
        title("المفضلة","محفوظة محليًا على هذه الشاشة دون تسجيل حساب");
        ArrayList<JSONObject> all=new ArrayList<JSONObject>();
        collectFavorites(all,movies,"movie");collectFavorites(all,series,"series");collectFavorites(all,channels,"channel");
        if(all.isEmpty())empty("أضف فيلمًا أو مسلسلًا أو قناة من صفحة التفاصيل.");
        else cards(all,AppConfig.MAX_ITEMS);
    }
    private void collectFavorites(ArrayList<JSONObject> all,JSONArray catalog,String type){
        for(int i=0;i<catalog.length();i++){
            JSONObject item=catalog.optJSONObject(i);
            if(item!=null&&isFavorite(type,str(item,"id"))){
                try{item.put("_type",type);}catch(Exception ignored){}
                all.add(item);
            }
        }
    }
    private void addRecent(ArrayList<JSONObject> all,JSONArray catalog,String type){
        for(int i=0;i<catalog.length();i++){
            JSONObject item=catalog.optJSONObject(i);
            if(item!=null&&prefs.getInt("position_"+str(item,"id"),0)>10000){
                try{item.put("_type",type);}catch(Exception ignored){}all.add(item);
            }
        }
    }
    private void search(){
        title("البحث","اكتب اسم فيلم أو مسلسل أو قناة باستخدام لوحة المفاتيح");
        final EditText input=new EditText(this);
        input.setTextSize(20);input.setTextColor(WHITE);input.setHintTextColor(MUTED);
        input.setHint("ابحث عن عنوان...");input.setSingleLine(true);
        input.setBackgroundDrawable(background(PANEL,10,0xFF54718A));
        input.setPadding(dp(18),dp(9),dp(18),dp(9));
        stage.addView(input,lp(-1,dp(55)));
        final Button submit=button("بحث");stage.addView(submit,gap(8,10));
        submit.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            String query=input.getText().toString().trim().toLowerCase();
            // Hide keyboard while retaining search query and results.
            ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(),0);
            while(stage.getChildCount()>2)stage.removeViewAt(2);
            ArrayList<JSONObject> found=new ArrayList<JSONObject>();
            filter(found,movies,"movie",query);filter(found,series,"series",query);filter(found,channels,"channel",query);
            if(found.isEmpty())empty("لا توجد نتائج مطابقة.");else cards(found,AppConfig.MAX_ITEMS);
        }});
    }
    private void filter(ArrayList<JSONObject> found,JSONArray list,String type,String query){
        if(query.length()==0)return;
        for(int i=0;i<list.length();i++){
            JSONObject j=list.optJSONObject(i);
            if(j!=null&&(str(j,"title_ar").toLowerCase().contains(query)||str(j,"title_original").toLowerCase().contains(query))){
                try{j.put("_type",type);}catch(Exception ignored){}found.add(j);
            }
        }
    }
    private void settings(){
        title("الإعدادات والتشخيص","قياسات فعلية من التلفزيون للمساعدة في تحديد مشكلات التوافق");
        Button sample=button("اختبار مشغل MP4 بمقطع CC0 مرخّص");
        stage.addView(sample,lp(dp(320),dp(52)));
        sample.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            Intent intent=new Intent(MainActivity.this,PlayerActivity.class);
            intent.putExtra("item_id","cc0-mdn-test");
            intent.putExtra("title","مقطع اختبار — MDN CC0");
            intent.putExtra("stream_url","https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4");
            startActivity(intent);
        }});
        final TextView network=text("خادم المحتوى: "+AppConfig.API_ROOT
                +"\nمزود TLS: "+LegacyTls.provider()
                +"\nتاريخ التلفزيون: "+new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm Z",java.util.Locale.US).format(new java.util.Date())
                +"\nأخطاء الاتصال:\n"+(networkErrors.length()>0?networkErrors:"لم تُسجل أخطاء اتصال."),15,WHITE,false);
        network.setPadding(dp(15),dp(14),dp(15),dp(14));
        network.setBackgroundDrawable(background(PANEL,12,0xFF3C5068));
        stage.addView(network,gap(11,9));
        final Button diagnose=button("فحص HTTPS والشهادات");
        stage.addView(diagnose,gap(8,10));
        diagnose.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            diagnose.setEnabled(false);
            network.setText("جاري فحص TLS وواجهة Supabase...");
            new Thread(new Runnable(){public void run(){
                String result;
                try{
                    JSONArray json=api.listQuery("aseel_categories","?select=id&limit=1");
                    result="نجح اتصال HTTPS بالخادم.\nTLS: "+LegacyTls.provider()+"\nاستجابة البيانات: "+json.length();
                }catch(Exception e){
                    result="فشل HTTPS/API:\n"+CatalogApi.describe(e)
                       +"\nمزود TLS: "+LegacyTls.provider()
                       +"\nتأكد من صحة ساعة التلفزيون والاتصال بالإنترنت.";
                }
                final String message=result;
                runOnUiThread(new Runnable(){public void run(){network.setText(message);diagnose.setEnabled(true);}});
            }}).start();
        }});
        final boolean lite=prefs.getBoolean("lite_mode",false);
        Button lowMemory=button(lite?"الوضع الخفيف: مفعّل (صور مخفية)":"الوضع الخفيف: إيقاف (الصور ظاهرة)");
        stage.addView(lowMemory,gap(8,8));
        lowMemory.setOnClickListener(new View.OnClickListener(){public void onClick(View view){
            prefs.edit().putBoolean("lite_mode",!lite).apply();
            PosterLoader.releaseMemory();
            stage.removeAllViews();
            settings();
        }});
        Button refresh=button("تحديث مكتبة المحتوى");stage.addView(refresh,gap(10,0));
        refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadCatalog();}});
        DisplayMetrics m=new DisplayMetrics();getWindowManager().getDefaultDisplay().getRealMetrics(m);
        ActivityManager am=(ActivityManager)getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory=new ActivityManager.MemoryInfo();
        if(am!=null)am.getMemoryInfo(memory);
        String info="الشركة: "+Build.MANUFACTURER+"\nالطراز: "+Build.MODEL+"\nاللوحة: "+Build.BOARD
            +"\nالشريحة: "+Build.HARDWARE+"\nالمعمارية: "+Build.CPU_ABI
            +"\nAndroid: "+Build.VERSION.RELEASE+" / API "+Build.VERSION.SDK_INT
            +"\nKernel: "+System.getProperty("os.version")
            +"\nRAM: "+(memory.totalMem/(1024*1024))+" MB"
            +"\nالدقة: "+m.widthPixels+" × "+m.heightPixels
            +"\nDPI: "+m.densityDpi+"\nBuild: "+Build.DISPLAY
            +"\nحد ذاكرة Java: "+(Runtime.getRuntime().maxMemory()/(1024*1024))+" MB"
            +"\nالمحتوى: "+movies.length()+" أفلام، "+series.length()+" مسلسلات، "+channels.length()+" قنوات"
            +"\nاتصال البيانات: HTTPS/TLS 1.2 مع التحقق من الشهادات"
            +"\nتنبيه: مشغل HLS وبعض خوارزميات الفيديو تعتمد على قدرات الجهاز.";
        TextView stats=text(info,16,WHITE,false);stats.setLineSpacing(dp(5),1f);
        stats.setPadding(dp(15),dp(12),dp(15),dp(12));
        stats.setBackgroundDrawable(background(PANEL,12,0xFF3C5068));
        stage.addView(stats,gap(18,12));
    }
    @Override public void onLowMemory(){
        PosterLoader.releaseMemory();
        super.onLowMemory();
    }
    @Override public void onTrimMemory(int level){
        if(level>=android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)
            PosterLoader.releaseMemory();
        super.onTrimMemory(level);
    }
    @Override protected void onDestroy(){
        refreshHandler.removeCallbacks(refreshLoop);
        super.onDestroy();
    }
    @Override public void onBackPressed(){
        if("home".equals(mode))super.onBackPressed();
        else{mode="home";render();}
    }
}
