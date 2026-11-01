package sa.aseel.tv;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
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
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Al Ezz TV 11: entirely native, remote-first leanback UI (Android KitKat+). */
public final class TVHomeActivity extends Activity {
    private static final int BG=0xFF090A0E, PANEL=0xFF17141C, RED=0xFFF23154;
    private static final int WHITE=0xFFF6F5FA, MUTED=0xFFABB0BB;
    private final ExecutorService background=Executors.newFixedThreadPool(4);
    private final Handler ui=new Handler();
    private final ArrayList<JSONObject> movies=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> series=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> episodeQueue=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> channels=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> youtubeVideos=new ArrayList<JSONObject>();
    private CatalogApi catalog;
    private ScrollView scroller;
    private LinearLayout content,navBar;
    private TextView status;
    private String section="home";
    private String lastLoadError="";
    private boolean loading=false,unlocked=false;
    private int generation=0,episodeGeneration=0,pendingRequests=0;
    private String remoteChannelDigits="";
    private final Runnable remoteChannelCommit=new Runnable(){public void run(){
        try{
            int number=Integer.parseInt(remoteChannelDigits);
            if(number>0 && number<=channels.size())play(channels.get(number-1));
        }catch(Exception ignored){}
        remoteChannelDigits="";
    }};

    private int dp(int val){return Math.round(getResources().getDisplayMetrics().density*val);}
    private LinearLayout column(){LinearLayout x=new LinearLayout(this);x.setOrientation(LinearLayout.VERTICAL);return x;}
    private LinearLayout row(){LinearLayout x=new LinearLayout(this);x.setOrientation(LinearLayout.HORIZONTAL);x.setGravity(Gravity.CENTER_VERTICAL);return x;}
    private LinearLayout.LayoutParams space(int width,int height,int m){
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(width,height);
        p.setMargins(dp(m),dp(m),dp(m),dp(m));return p;
    }
    private GradientDrawable bg(int color,int border,int radius){
        GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));
        if(border!=0)d.setStroke(dp(1),border);return d;
    }
    private TextView text(String label,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(label);t.setTextColor(color);t.setTextSize(size);
        t.setTextDirection(View.TEXT_DIRECTION_RTL);t.setGravity(Gravity.CENTER_VERTICAL);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;
    }
    private Button button(String name){
        final Button b=new Button(this);b.setText(name);b.setAllCaps(false);b.setTextColor(WHITE);
        b.setTextSize(15);b.setFocusable(true);b.setBackgroundDrawable(bg(0xFF2B202B,0xFF4D3744,11));
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){public void onFocusChange(View v,boolean focused){
            b.setBackgroundDrawable(bg(focused?RED:0xFF2B202B,focused?0xFFFFB7C7:0xFF4D3744,11));
            b.setScaleX(focused?1.04f:1f);b.setScaleY(focused?1.04f:1f);
        }});return b;
    }
    private String value(JSONObject item,String key){return item==null?"":item.optString(key,"");}
    private String label(JSONObject item){
        String result=value(item,"title_ar");
        if(result.length()==0)result=value(item,"title");return result.length()==0?"بدون عنوان":result;
    }
    private String kind(JSONObject item){
        return item==null?"":item.optString("_kind","");
    }
    private void mark(JSONObject item,String type){try{item.put("_kind",type);}catch(Exception ignored){}}
    private void putAll(ArrayList<JSONObject> target,JSONArray rows,String type){
        target.clear();
        if(rows==null)return;
        for(int i=0;i<rows.length();i++){
            JSONObject item=rows.optJSONObject(i);
            if(item!=null){mark(item,type);target.add(item);}
        }
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN);
        catalog=new CatalogApi(this);
        if(!PinGate.isActivated(this)){
            new PinGate(this,new Runnable(){public void run(){startViewer();}}).show();
        }else{startViewer();}
    }
    private void startViewer(){
        unlocked=true;buildShell();render();loadCatalog();
    }
    private void buildShell(){
        LinearLayout root=column();root.setBackgroundColor(BG);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        setContentView(root);
        LinearLayout top=row();top.setPadding(dp(24),dp(9),dp(24),dp(9));
        top.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.RIGHT_LEFT,
            new int[]{0xFF4D1424,0xFF190E17,0xFF0A0A10}));
        root.addView(top,new LinearLayout.LayoutParams(-1,dp(83)));
        ImageView logo=new ImageView(this);
        int logoId=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(logoId!=0)logo.setImageResource(logoId);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        top.addView(logo,new LinearLayout.LayoutParams(dp(93),dp(65)));
        LinearLayout intro=column();
        intro.addView(text("العز TV",25,WHITE,true));
        intro.addView(text("تجربة سينمائية لشاشتك",12,0xFFFFAABB,false));
        top.addView(intro,space(dp(175),-2,5));
        top.addView(new View(this),new LinearLayout.LayoutParams(0,1,1));
        status=text("● جاهز",12,MUTED,false);
        top.addView(status,space(dp(245),-2,3));
        Button refresh=button("↻ تحديث");
        refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadCatalog();}});
        top.addView(refresh,space(dp(110),dp(51),4));
        Button search=button("⌕ بحث");
        search.setOnClickListener(new View.OnClickListener(){public void onClick(View v){section="search";render();}});
        top.addView(search,space(dp(96),dp(51),4));
        navBar=row();navBar.setPadding(dp(17),dp(7),dp(17),dp(7));navBar.setBackgroundColor(PANEL);
        root.addView(navBar,new LinearLayout.LayoutParams(-1,dp(61)));
        View line=new View(this);line.setBackgroundColor(0xFF50212E);root.addView(line,new LinearLayout.LayoutParams(-1,dp(2)));
        scroller=new ScrollView(this);scroller.setFillViewport(true);scroller.setVerticalScrollBarEnabled(false);
        root.addView(scroller,new LinearLayout.LayoutParams(-1,0,1));
        content=column();content.setPadding(dp(25),dp(14),dp(25),dp(29));
        scroller.addView(content,new ScrollView.LayoutParams(-1,-2));
        updateNav();
    }
    private void updateNav(){
        navBar.removeAllViews();
        final String[] tabs={"الرئيسية","الأفلام","المسلسلات","البث المباشر","يوتيوب","الأطفال","قائمتي"};
        final String[] modes={"home","movies","series","live","youtube","kids","favorites"};
        for(int i=0;i<tabs.length;i++){
            final String selected=modes[i];Button b=button(tabs[i]);
            b.setTextSize(14);
            if(section.equals(selected))b.setBackgroundDrawable(bg(0xFF8C2039,RED,12));
            navBar.addView(b,new LinearLayout.LayoutParams(0,-1,1));
            b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                section=selected;render();scroller.scrollTo(0,0);
            }});
        }
    }
    private void loadCatalog(){
        if(loading || !unlocked)return;
        loading=true;pendingRequests=4;lastLoadError="";status.setText("◌ تحديث المكتبة...");
        final int token=++generation;
        background.execute(new Runnable(){public void run(){
            JSONArray data=null;String error="";
            try{data=catalog.listQuery("aseel_movies","?select=*&status=eq.published&rights_status=eq.approved&order=created_at.desc&limit=80");}
            catch(Exception e){error+="أفلام: "+CatalogApi.describe(e)+"  ";}
            final JSONArray rows=data;final String problem=error;
            ui.post(new Runnable(){public void run(){if(token!=generation||!unlocked)return;
                if(rows!=null)putAll(movies,rows,"movie");completeCatalog(token,problem);
            }});
        }});
        background.execute(new Runnable(){public void run(){
            JSONArray data=null;String error="";
            try{data=catalog.listQuery("aseel_series","?select=*&status=eq.published&rights_status=eq.approved&order=created_at.desc&limit=80");}
            catch(Exception e){error="مسلسلات: "+CatalogApi.describe(e);}
            final JSONArray rows=data;final String issue=error;
            ui.post(new Runnable(){public void run(){if(token!=generation||!unlocked)return;
                if(rows!=null)putAll(series,rows,"series");completeCatalog(token,issue);
            }});
        }});
        background.execute(new Runnable(){public void run(){
            JSONArray data=null;String error="";
            try{data=catalog.listQuery("aseel_channels","?select=*&status=eq.published&order=created_at.desc&limit=300");}
            catch(Exception e){error="قنوات: "+CatalogApi.describe(e);}
            final JSONArray rows=data;final String issue=error;
            ui.post(new Runnable(){public void run(){if(token!=generation||!unlocked)return;
                if(rows!=null)putAll(channels,rows,"channel");completeCatalog(token,issue);
            }});
        }});
        background.execute(new Runnable(){public void run(){
            JSONArray data=null;String issue="";
            try{
                data=catalog.listQuery("aseel_youtube_videos",
                    "?select=id,title_ar,youtube_url,channel_name,language_code,topic,is_kids,status,sort_order,licensed_stream_url,licensed_stream_variants,licensed_stream_approved&status=eq.published&is_kids=eq.true&order=sort_order.asc&limit=120");
            }catch(Exception e){issue="يوتيوب الأطفال: "+CatalogApi.describe(e);}
            final JSONArray rows=data;final String error=issue;
            ui.post(new Runnable(){public void run(){
                if(token!=generation||!unlocked)return;
                if(rows!=null){
                    youtubeVideos.clear();
                    for(int k=0;k<rows.length();k++){
                        JSONObject clip=rows.optJSONObject(k);
                        if(clip!=null && clip.optBoolean("is_kids",false)
                            && YouTubeLink.usable(value(clip,"youtube_url"))){
                            mark(clip,"youtube");youtubeVideos.add(clip);
                        }
                    }
                }
                completeCatalog(token,error);
            }});
        }});
    }
    private void completeCatalog(int token,String issue){
        if(token!=generation||!unlocked)return;
        if(issue!=null && issue.length()>0){
            lastLoadError=lastLoadError.length()==0?issue:lastLoadError+" | "+issue;
        }
        pendingRequests=Math.max(0,pendingRequests-1);
        loading=pendingRequests>0;
        status.setText(loading?"◌ تحميل المكتبة...":lastLoadError.length()>0
            ?"⚠ بعض الأقسام غير متاحة":"● المكتبة متصلة");
        render();
    }
    private void heading(String title,String note){
        TextView h=text(title,23,WHITE,true);content.addView(h,space(-1,-2,5));
        if(note!=null && note.length()>0)content.addView(text(note,13,MUTED,false),space(-1,-2,2));
    }
    private void render(){
        if(content==null)return;
        if(!"detail".equals(section) && !"episodes".equals(section))updateNav();
        content.removeAllViews();
        if("home".equals(section)){
            hero();
            shelf("الأفلام","اكتشف أحدث الأعمال المتاحة",movies,14);
            shelf("مسلسلات","مواسم وحلقات مرتبة",series,12);
            if(!channels.isEmpty())livePreview();
            shelf("يوتيوب الأطفال","مقاطع يوتيوب الرسمية المنشورة",youtubeVideos,14);
        }else if("movies".equals(section))grid("الأفلام",movies);
        else if("series".equals(section))grid("المسلسلات",series);
        else if("live".equals(section))liveGuide();
        else if("youtube".equals(section))grid("مقاطع يوتيوب للأطفال",youtubeVideos);
        else if("kids".equals(section)){
            ArrayList<JSONObject> kids=new ArrayList<JSONObject>();
            for(JSONObject x:movies)if(x.optBoolean("is_kids",false))kids.add(x);
            for(JSONObject x:series)if(x.optBoolean("is_kids",false))kids.add(x);
            for(JSONObject x:channels)if(x.optBoolean("is_kids",false))kids.add(x);
            grid("عالم الأطفال • أفلام وقنوات",kids);
            shelf("مقاطع يوتيوب للأطفال","محتوى رسمي — افتح المقطع بالريموت",youtubeVideos,34);
        }else if("favorites".equals(section)){
            ArrayList<JSONObject> list=new ArrayList<JSONObject>();
            for(JSONObject x:movies)if(isFavorite(x))list.add(x);
            for(JSONObject x:series)if(isFavorite(x))list.add(x);
            for(JSONObject x:channels)if(isFavorite(x))list.add(x);
            for(JSONObject x:youtubeVideos)if(isFavorite(x))list.add(x);
            grid("قائمتي",list);
        }else if("search".equals(section))searchScreen();
        if(movies.size()+series.size()+channels.size()+youtubeVideos.size()==0){
            heading(loading?"جاري تحميل المكتبة...":"المكتبة لم تُحمّل",
                loading?"اتصل بالإنترنت، ستظهر البطاقات تلقائيًا.":"اضغط تحديث. "+lastLoadError);
            Button refresh=button("إعادة المحاولة");content.addView(refresh,space(dp(240),dp(60),4));
            refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadCatalog();}});
            refresh.requestFocus();
        }
    }
    private void hero(){
        LinearLayout hero=row();hero.setPadding(dp(26),dp(18),dp(26),dp(18));
        hero.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.RIGHT_LEFT,
            new int[]{0xFF591629,0xFF250F1D,0xFF101119}));
        content.addView(hero,space(-1,dp(214),5));
        LinearLayout copy=column();
        copy.addView(text("أهلًا بك في العز TV",30,WHITE,true),space(-1,-2,3));
        copy.addView(text("اختر فيلمك أو مسلسلك أو قناتك مباشرة، وتحكم بالكامل بالريموت.",15,0xFFE1C9D1,false),space(-1,-2,3));
        TextView counts=text(movies.size()+" فيلم  •  "+series.size()+" مسلسل  •  "+channels.size()+" قناة  •  "+youtubeVideos.size()+" مقطع",13,0xFFFFBDCD,true);
        copy.addView(counts,space(-1,-2,4));
        Button explore=button("▶ استكشف الأفلام");copy.addView(explore,space(dp(245),dp(52),6));
        explore.setOnClickListener(new View.OnClickListener(){public void onClick(View v){section="movies";render();}});
        Button liveButton=button("● شاهد التلفزيون المباشر");
        copy.addView(liveButton,space(dp(275),dp(48),2));
        liveButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            section="live";render();scroller.scrollTo(0,0);
        }});
        hero.addView(copy,new LinearLayout.LayoutParams(0,-2,1));
        int logoId=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(logoId!=0){ImageView logo=new ImageView(this);logo.setImageResource(logoId);
            logo.setScaleType(ImageView.ScaleType.FIT_CENTER);hero.addView(logo,new LinearLayout.LayoutParams(dp(182),dp(158)));}
    }
    private void shelf(String name,String note,ArrayList<JSONObject> list,int limit){
        if(list.isEmpty())return;
        heading(name,note);
        HorizontalScrollView scroll=new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout cards=row();cards.setGravity(Gravity.TOP);scroll.addView(cards);
        for(int i=0;i<list.size()&&i<limit;i++)cards.addView(card(list.get(i),true));
        content.addView(scroll,space(-1,dp(251),4));
    }
    private void livePreview(){
        heading("● البث الآن","تصفح القنوات كالتلفزيون، وغيّرها بأزرار CH± أو الأرقام أثناء المشاهدة");
        for(int i=0;i<Math.min(channels.size(),4);i++)content.addView(channelLine(channels.get(i),i));
        Button guide=button("عرض دليل القنوات بالكامل  ❯");
        content.addView(guide,space(dp(325),dp(52),6));
        guide.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            section="live";render();scroller.scrollTo(0,0);
        }});
    }
    private void liveGuide(){
        heading("دليل القنوات • LIVE TV","اضغط OK للمشاهدة • CH+ و CH− للتنقل • الأرقام لاختيار القناة مباشرة");
        if(channels.isEmpty()){
            heading("لا توجد قنوات منشورة","استخدم زر تحديث المكتبة أو راجع المصادر المعتمدة.");return;
        }
        for(int i=0;i<channels.size();i++)content.addView(channelLine(channels.get(i),i));
    }
    private LinearLayout channelLine(final JSONObject channel,final int position){
        final LinearLayout line=row();
        line.setPadding(dp(16),dp(8),dp(16),dp(8));
        line.setFocusable(true);line.setClickable(true);
        line.setBackgroundDrawable(bg(0xFF1D1923,0xFF39313D,13));
        LinearLayout.LayoutParams outer=space(-1,dp(83),4);
        line.setLayoutParams(outer);
        TextView number=text(String.format(Locale.US,"%03d",position+1),23,0xFFFFB9C9,true);
        number.setGravity(Gravity.CENTER);
        line.addView(number,new LinearLayout.LayoutParams(dp(79),-1));
        ImageView poster=new ImageView(this);poster.setScaleType(ImageView.ScaleType.FIT_CENTER);
        poster.setBackgroundDrawable(bg(0xFF362333,0,8));
        String image=value(channel,"poster_url");
        if(image.startsWith("https://"))PosterLoader.load(poster,image);
        line.addView(poster,new LinearLayout.LayoutParams(dp(100),dp(64)));
        LinearLayout information=column();information.setPadding(dp(14),0,dp(14),0);
        information.addView(text(label(channel),20,WHITE,true));
        information.addView(text("● بث مباشر   •   "+value(channel,"language_code"),12,0xFF9FE2BF,false));
        line.addView(information,new LinearLayout.LayoutParams(0,-2,1));
        TextView action=text("▶  مشاهدة",15,0xFFFFA2BB,true);
        line.addView(action,new LinearLayout.LayoutParams(dp(130),-1));
        line.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                line.setBackgroundDrawable(bg(focused?0xFF75213D:0xFF1D1923,
                    focused?0xFFFFAABB:0xFF39313D,13));
            }
        });
        line.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(channel);}});
        return line;
    }
    private void grid(String title,ArrayList<JSONObject> list){
        heading(title,list.size()+" عنوان متاح");
        if(list.isEmpty()){heading("لا يوجد محتوى منشور في هذا القسم","يمكن تحديث المكتبة أو إضافة أعمال من لوحة الإدارة.");return;}
        for(int base=0;base<list.size();base+=5){
            LinearLayout row=row();row.setGravity(Gravity.TOP);
            for(int i=base;i<Math.min(base+5,list.size());i++)
                row.addView(card(list.get(i),false),new LinearLayout.LayoutParams(0,dp(248),1));
            content.addView(row,space(-1,-2,3));
        }
    }
    private LinearLayout card(final JSONObject item,boolean wide){
        final LinearLayout outer=column();outer.setFocusable(true);outer.setClickable(true);
        outer.setBackgroundDrawable(bg(0xFF201C25,0xFF342B38,13));
        outer.setPadding(dp(7),dp(7),dp(7),dp(7));
        LinearLayout.LayoutParams p=space(wide?dp(205):-1,dp(241),6);
        if(wide)outer.setLayoutParams(p);
        ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        image.setBackgroundDrawable(bg(0xFF412335,0,9));
        outer.addView(image,new LinearLayout.LayoutParams(-1,dp(159)));
        String poster=value(item,"poster_url");
        if(poster.length()==0)poster=value(item,"backdrop_url");
        if("youtube".equals(kind(item))){String clip=YouTubeLink.videoId(value(item,"youtube_url"));
            if(clip!=null)poster="https://i.ytimg.com/vi/"+clip+"/hqdefault.jpg";}
        if(poster.startsWith("https://"))PosterLoader.load(image,poster);
        TextView title=text(label(item),15,WHITE,true);title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);outer.addView(title,space(-1,dp(47),3));
        String desc="channel".equals(kind(item))?("official_link".equals(value(item,"playback_mode"))?"↗ موقع رسمي":"● مباشر"):"series".equals(kind(item))?"▤ مسلسل":"youtube".equals(kind(item))?"▶ يوتيوب":"▶ فيلم";
        outer.addView(text(desc,12,0xFFFF8DA6,false));
        outer.setOnFocusChangeListener(new View.OnFocusChangeListener(){public void onFocusChange(View v,boolean focused){
            outer.setBackgroundDrawable(bg(focused?0xFF79203A:0xFF201C25,focused?0xFFFFB0C6:0xFF342B38,13));
            outer.setScaleX(focused?1.055f:1);outer.setScaleY(focused?1.055f:1);
        }});
        outer.setOnClickListener(new View.OnClickListener(){public void onClick(View v){detail(item);}});
        return outer;
    }
    private void detail(final JSONObject item){
        if("series".equals(kind(item))){episodes(item);return;}
        if("youtube".equals(kind(item))){openYouTube(item);return;}
        content.removeAllViews();
        heading(label(item),"channel".equals(kind(item))?("official_link".equals(value(item,"playback_mode"))?"↗ مشاهدة في الموقع الرسمي":"● قناة مباشرة"):"فيلم • مشاهدة مباشرة");
        LinearLayout hero=row();content.addView(hero,space(-1,dp(240),7));
        ImageView poster=new ImageView(this);poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        hero.addView(poster,new LinearLayout.LayoutParams(dp(190),dp(235)));
        String image=value(item,"poster_url");if(image.startsWith("https://"))PosterLoader.load(poster,image);
        LinearLayout info=column();hero.addView(info,new LinearLayout.LayoutParams(0,-1,1));
        info.addView(text(value(item,"description"),16,MUTED,false),space(-1,-2,9));
        Button play=button("official_link".equals(value(item,"playback_mode"))?"↗ فتح الموقع الرسمي":"▶ ابدأ المشاهدة");
        info.addView(play,space(dp(260),dp(56),7));
        play.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(item);}});
        Button favorite=button(isFavorite(item)?"♥ إزالة من قائمتي":"♡ أضف إلى قائمتي");
        info.addView(favorite,space(dp(260),dp(50),7));
        favorite.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            toggleFavorite(item);favorite.setText(isFavorite(item)?"♥ إزالة من قائمتي":"♡ أضف إلى قائمتي");
        }});
        Button back=button("رجوع إلى القسم");
        info.addView(back,space(dp(260),dp(50),7));
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){render();}});
        play.requestFocus();
    }
    private void episodes(final JSONObject show){
        content.removeAllViews();heading(label(show),"جارٍ استرجاع المواسم والحلقات...");
        final String seriesId=value(show,"id");
        if(!seriesId.matches("[0-9a-fA-F-]{36}")){heading("خطأ في معرف المسلسل","");return;}
        final int token=++episodeGeneration;
        background.execute(new Runnable(){public void run(){
            final ArrayList<JSONObject> episodes=new ArrayList<JSONObject>();
            String failure="";
            try{
                JSONArray seasons=catalog.listQuery("aseel_seasons",
                    "?select=*&series_id=eq."+seriesId+"&order=number.asc&limit=40");
                for(int i=0;i<seasons.length();i++){
                    JSONObject season=seasons.optJSONObject(i);
                    if(season==null)continue;
                    String seasonId=value(season,"id");
                    if(!seasonId.matches("[0-9a-fA-F-]{36}"))continue;
                    JSONArray list=catalog.listQuery("aseel_episodes",
                        "?select=*&season_id=eq."+seasonId+"&status=eq.published&rights_status=eq.approved&order=number.asc&limit=100");
                    for(int k=0;k<list.length();k++){
                        JSONObject episode=list.optJSONObject(k);if(episode==null)continue;
                        mark(episode,"episode");
                        try{episode.put("_season",season.optInt("number",i+1));}catch(Exception ignored){}
                        episodes.add(episode);
                    }
                }
            }catch(Exception e){failure=CatalogApi.describe(e);}
            final String problem=failure;
            ui.post(new Runnable(){public void run(){
                if(isFinishing()||token!=episodeGeneration)return;
                content.removeAllViews();
                heading(label(show),"اختر حلقة واضغط OK للتشغيل");
                if(episodes.isEmpty())heading("لا توجد حلقات جاهزة",
                    problem.length()>0?problem:"راجع نشر الموسم والحلقات وروابط تشغيلها.");
                episodeQueue.clear();episodeQueue.addAll(episodes);
                for(final JSONObject ep:episodes){
                    Button b=button("▶ الموسم "+ep.optInt("_season",1)+" — الحلقة "+
                        ep.optInt("number",0)+"  |  "+label(ep));
                    content.addView(b,space(-1,dp(60),5));
                    b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(ep);}});
                }
                Button back=button("↩ رجوع إلى المسلسلات");content.addView(back,space(dp(260),dp(54),5));
                back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){section="series";render();}});
                if(!episodes.isEmpty() && content.getChildCount()>2)content.getChildAt(2).requestFocus();else back.requestFocus();
            }});
        }});
    }
    private void play(JSONObject item){
        if("channel".equals(kind(item)) && "official_link".equals(value(item,"playback_mode"))){
            String official=value(item,"official_url");
            if(!official.startsWith("https://")){
                heading("تعذر فتح القناة","رابط الموقع الرسمي غير صالح.");return;
            }
            try {
                Intent link=new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(official));
                startActivity(link);
            } catch(android.content.ActivityNotFoundException error){
                heading("لا يوجد متصفح متوافق","يتطلب فتح موقع القناة متصفحًا على جهاز التلفزيون.");
            }
            return;
        }
        String youtube=value(item,"youtube_url");
        if(YouTubeLink.usable(youtube)){openYouTube(item);return;}
        String url=value(item,"stream_url");
        if(StreamQuality.parse(url,value(item,"quality"),
            item.optJSONArray("stream_variants")==null?"[]":item.optJSONArray("stream_variants").toString()).isEmpty()){
            heading("لا يوجد مصدر صالح للتشغيل","تأكد من وجود رابط HTTPS MP4/HLS لهذا العنوان في لوحة الإدارة.");
            return;
        }
        Intent intent=new Intent(this,CinemaPlayerActivity.class);
        intent.putExtra("item_id",value(item,"id"));
        intent.putExtra("title",label(item));
        intent.putExtra("stream_url",url);
        intent.putExtra("is_live","channel".equals(kind(item)));
        intent.putExtra("quality",value(item,"quality"));
        intent.putExtra("stream_variants",item.optJSONArray("stream_variants")==null?"[]":item.optJSONArray("stream_variants").toString());
        if("movie".equals(kind(item)) || "episode".equals(kind(item))){
            JSONArray mediaQueue=new JSONArray();
            int currentIndex=0;
            ArrayList<JSONObject> sourceItems="episode".equals(kind(item))?episodeQueue:movies;
            for(JSONObject candidate:sourceItems){
                String candidateUrl=value(candidate,"stream_url");
                String variants=candidate.optJSONArray("stream_variants")==null
                    ? "[]" : candidate.optJSONArray("stream_variants").toString();
                if(StreamQuality.parse(candidateUrl,value(candidate,"quality"),variants).isEmpty())continue;
                JSONObject record=new JSONObject();
                try{
                    record.put("id",value(candidate,"id"));
                    record.put("title",label(candidate));
                    record.put("url",candidateUrl);
                    record.put("quality",value(candidate,"quality"));
                    record.put("variants",new JSONArray(variants));
                    if(value(candidate,"id").equals(value(item,"id")))currentIndex=mediaQueue.length();
                    mediaQueue.put(record);
                }catch(Exception ignored){}
            }
            intent.putExtra("media_playlist",mediaQueue.toString());
            intent.putExtra("media_start",currentIndex);
            intent.putExtra("media_kind",kind(item));
        }
        if("channel".equals(kind(item))){
            JSONArray playlist=new JSONArray();
            int selected=0;
            for(JSONObject candidate:channels){
                if("official_link".equals(value(candidate,"playback_mode")))continue;
                String candidateUrl=value(candidate,"stream_url");
                String variants=candidate.optJSONArray("stream_variants")==null?"[]":
                    candidate.optJSONArray("stream_variants").toString();
                if(StreamQuality.parse(candidateUrl,value(candidate,"quality"),variants).isEmpty())continue;
                JSONObject record=new JSONObject();
                try{
                    record.put("id",value(candidate,"id"));
                    record.put("title",label(candidate));
                    record.put("url",candidateUrl);
                    record.put("quality",value(candidate,"quality"));
                    record.put("variants",new JSONArray(variants));
                    if(value(candidate,"id").equals(value(item,"id")))selected=playlist.length();
                    playlist.put(record);
                }catch(Exception ignored){}
            }
            intent.putExtra("channel_playlist",playlist.toString());
            intent.putExtra("channel_start",selected);
        }
        startActivity(intent);
    }
    private void openYouTube(JSONObject selected){
        // Owner-provided licensed MP4/HLS can play natively even on Android 4.4.4.
        // A normal YouTube watch URL is never passed to ExoPlayer.
        String licensedUrl=value(selected,"licensed_stream_url");
        String variants=selected.optJSONArray("licensed_stream_variants")==null
            ? "[]" : selected.optJSONArray("licensed_stream_variants").toString();
        if(selected.optBoolean("licensed_stream_approved",false)
            && !StreamQuality.parse(licensedUrl,"auto",variants).isEmpty()){
            Intent nativePlayer=new Intent(this,CinemaPlayerActivity.class);
            nativePlayer.putExtra("item_id",value(selected,"id"));
            nativePlayer.putExtra("title",label(selected));
            nativePlayer.putExtra("stream_url",licensedUrl);
            nativePlayer.putExtra("stream_variants",variants);
            nativePlayer.putExtra("quality","auto");
            startActivity(nativePlayer);
            return;
        }
        String id=YouTubeLink.videoId(value(selected,"youtube_url"));
        if(id==null)return;
        JSONArray queue=new JSONArray();
        HashSet<String> seen=new HashSet<String>();
        for(JSONObject clip:youtubeVideos){
            String clipId=YouTubeLink.videoId(value(clip,"youtube_url"));
            if(clipId==null||!seen.add(clipId))continue;
            try{
                JSONObject entry=new JSONObject();
                entry.put("video_id",clipId);
                entry.put("title",label(clip));
                entry.put("channel",value(clip,"channel_name"));
                entry.put("topic",value(clip,"topic"));
                queue.put(entry);
            }catch(Exception ignored){}
        }
        Intent player=new Intent(this,YouTubeActivity.class);
        player.putExtra("youtube_url",value(selected,"youtube_url"));
        player.putExtra("start_video_id",id);
        player.putExtra("title",label(selected));
        player.putExtra("playlist_json",queue.toString());
        startActivity(player);
    }
    private void searchScreen(){
        heading("البحث","ابحث في جميع العناوين المنشورة");
        final EditText input=new EditText(this);input.setSingleLine(true);input.setTextSize(18);
        input.setTextColor(WHITE);input.setHintTextColor(MUTED);input.setHint("اسم الفيلم أو المسلسل أو القناة");
        input.setBackgroundDrawable(bg(PANEL,RED,12));
        content.addView(input,space(-1,dp(63),6));
        final LinearLayout results=column();content.addView(results);
        Button search=button("بحث");content.addView(search,space(dp(200),dp(56),6));
        search.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            results.removeAllViews();
            String term=input.getText().toString().trim().toLowerCase(Locale.US);
            if(term.length()==0){results.addView(text("اكتب كلمة للبحث",14,MUTED,false));return;}
            ArrayList<JSONObject> found=new ArrayList<JSONObject>();
            for(JSONObject x:movies)if(label(x).toLowerCase(Locale.US).contains(term))found.add(x);
            for(JSONObject x:series)if(label(x).toLowerCase(Locale.US).contains(term))found.add(x);
            for(JSONObject x:channels)if(label(x).toLowerCase(Locale.US).contains(term))found.add(x);
            for(JSONObject x:youtubeVideos)if(label(x).toLowerCase(Locale.US).contains(term))found.add(x);
            if(found.isEmpty())results.addView(text("لا توجد نتائج",15,MUTED,false));
            for(final JSONObject item:found){
                Button match=button(label(item));results.addView(match,space(-1,dp(55),3));
                match.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                    ((InputMethodManager)getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(),0);
                    detail(item);
                }});
            }
        }});
        input.requestFocus();
    }
    private String favKey(JSONObject x){return kind(x)+":"+value(x,"id");}
    private boolean isFavorite(JSONObject item){
        return getSharedPreferences("alizz_v11_favorites",MODE_PRIVATE).getBoolean(favKey(item),false);
    }
    private void toggleFavorite(JSONObject item){
        SharedPreferences prefs=getSharedPreferences("alizz_v11_favorites",MODE_PRIVATE);
        prefs.edit().putBoolean(favKey(item),!isFavorite(item)).apply();
    }
    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_BACK && !"home".equals(section)){
            section="home";render();return true;
        }
        if(code==KeyEvent.KEYCODE_MENU||code==KeyEvent.KEYCODE_GUIDE){
            section="live";render();scroller.scrollTo(0,0);return true;
        }
        if(!(getCurrentFocus() instanceof EditText) && !channels.isEmpty()){
            int digit=code-KeyEvent.KEYCODE_0;
            if(digit>=0 && digit<=9){
                remoteChannelDigits+=digit;
                if(remoteChannelDigits.length()>3)
                    remoteChannelDigits=remoteChannelDigits.substring(remoteChannelDigits.length()-3);
                ui.removeCallbacks(remoteChannelCommit);
                ui.postDelayed(remoteChannelCommit,1250L);
                if(status!=null)status.setText("القناة "+remoteChannelDigits+" • OK للاختيار");
                return true;
            }
            if(code==KeyEvent.KEYCODE_DPAD_CENTER && remoteChannelDigits.length()>0){
                ui.removeCallbacks(remoteChannelCommit);remoteChannelCommit.run();return true;
            }
        }
        return super.onKeyDown(code,event);
    }
    @Override protected void onDestroy(){
        generation++;episodeGeneration++;unlocked=false;background.shutdownNow();ui.removeCallbacks(remoteChannelCommit);ui.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
