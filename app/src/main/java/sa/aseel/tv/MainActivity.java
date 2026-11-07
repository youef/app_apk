package sa.aseel.tv;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.widget.FrameLayout;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Rect;
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
import java.util.List;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Al Ezz TV — native streaming experience for Android TV API 19+.
 * Catalog items are shown only after server-side publishing and rights approval.
 * All navigation is possible using D-pad + OK; no Google Play Services.
 */
public final class MainActivity extends Activity {
    private static final int NAVY=0xFF0F0F11, PANEL=0xFF222226, GOLD=0xFFFF0033, WHITE=0xFFF8F9FC, MUTED=0xFFB5B5BC;
    private final String[] labels={"الرئيسية","المقاطع","الأفلام","المسلسلات","القنوات","الأطفال","المفضلة","البحث","الإعدادات"};
    private final String[] modes={"home","youtube","movie","series","channel","kids","favorites","search","settings"};
    private LinearLayout stage,root,menu;
    private Button[] navButtons;
    private ScrollView scrolling;
    private TextView notice,headerUpdate;
    private String mode="home";
    private String kidsKind="all",kidsCountry="",kidsLanguage="";
    private String lastMode="home";
    private String subPage="",returnFocusTag="",pendingFocusTag="";
    private JSONObject activeDetail,activeSeries;
    private int listingPage=0,handledArrow=-1;
    private static final int TV_PAGE_SIZE=20, YOUTUBE_PAGE_SIZE=12;
    private int youtubePage=0;
    private String youtubeTopic="all",youtubeLanguage="all";
    private String networkErrors="";
    private boolean loading=false,hasLoaded=false;
    private long lastUpdatedAt=0L,lastRefreshAttempt=0L;
    private final Handler refreshHandler=new Handler();
    private final Runnable refreshLoop=new Runnable(){
        public void run(){
            if(hasLoaded&&!loading&&System.currentTimeMillis()-lastUpdatedAt>=3L*60L*1000L)
                loadCatalog();
            refreshHandler.postDelayed(this,60L*1000L);
        }
    };
    private JSONArray movies=new JSONArray(),series=new JSONArray(),channels=new JSONArray(),categories=new JSONArray(),youtubeVideos=new JSONArray();
    private CatalogApi api;
    private SharedPreferences prefs;
    private PinGate accessGate;
    private boolean unlocked=false;
    private final Handler splashHandler=new Handler();
    private boolean splashVisible=false;
    @Override public void onCreate(Bundle bundle){
        super.onCreate(bundle);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        prefs=getSharedPreferences("aseel_user_v2",MODE_PRIVATE);
        api=new CatalogApi(this);
        showWelcome();
    }
    /** Native launch experience, safe on API 19 and completely independent of network. */
    private void showWelcome(){
        splashVisible=true;
        FrameLayout screen=new FrameLayout(this);
        screen.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{0xFF08070C,0xFF30101D,0xFF09070D}));
        LinearLayout group=vertical();group.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams center=new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER);
        group.setPadding(dp(24),dp(16),dp(24),dp(16));screen.addView(group,center);
        int imageId=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(imageId!=0){
            ImageView logo=new ImageView(this);logo.setImageResource(imageId);
            logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
            LinearLayout.LayoutParams logoP=lp(dp(290),dp(250));logoP.gravity=Gravity.CENTER;
            group.addView(logo,logoP);
            logo.setAlpha(0f);logo.animate().alpha(1f).setDuration(650).start();
        }else{
            TextView logo=text("العز TV",48,WHITE,true);logo.setGravity(Gravity.CENTER);
            group.addView(logo,lp(-1,dp(130)));
        }
        TextView label=text("ALIZZ TV  •  CINEMA EXPERIENCE",16,0xFFFFA9B9,true);
        label.setGravity(Gravity.CENTER);group.addView(label,gap(14,8));
        TextView sub=text("عالم من الحكايات على شاشتك",17,0xFFB9ADB8,false);
        sub.setGravity(Gravity.CENTER);group.addView(sub,gap(0,22));
        TextView subtitle=text("اضغط تخطي للانتقال إلى التفعيل أو المكتبة",14,0xFFC6B5C1,false);
        subtitle.setGravity(Gravity.CENTER);group.addView(subtitle,gap(0,14));
        final Button skip=button("تخطي الترحيب  ❯");
        skip.setTextSize(19);
        skip.setTag("splash:skip");
        skip.setContentDescription("تخطي شاشة الترحيب والانتقال إلى التفعيل أو المحتوى");
        skip.setBackgroundDrawable(background(0xFFC51A3D,15,0xFFFF9BB1));
        LinearLayout.LayoutParams skipP=lp(dp(238),dp(57));skipP.gravity=Gravity.CENTER;
        skipP.setMargins(0,dp(17),0,0);group.addView(skip,skipP);
        skip.setOnClickListener(new View.OnClickListener(){public void onClick(View v){finishSplash();}});
        skip.requestFocus();
        TextView foot=text("✦  العز TV",13,0xFFAD6378,false);
        foot.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams fp=new FrameLayout.LayoutParams(-1,dp(40),Gravity.BOTTOM);
        screen.addView(foot,fp);
        setContentView(screen);
        splashHandler.postDelayed(new Runnable(){public void run(){
            finishSplash();
        }},5000L);
    }
    private void finishSplash(){
        if(!splashVisible||isFinishing())return;
        splashVisible=false;
        splashHandler.removeCallbacksAndMessages(null);
        if(PinGate.isActivated(this))openActivatedApp();
        else lockScreen();
    }
    private void openActivatedApp(){
        unlocked=true;accessGate=null;
        buildShell();warmCache();render();loadCatalog();
        // The splash finishes after Activity.onResume; start periodic refresh here too.
        refreshHandler.removeCallbacks(refreshLoop);
        refreshHandler.postDelayed(refreshLoop,60L*1000L);
    }
    private void lockScreen(){
        unlocked=false;root=null;stage=null;menu=null;scrolling=null;navButtons=null;notice=null;
        accessGate=new PinGate(this,new Runnable(){public void run(){
            if(isFinishing())return;
            openActivatedApp();
        }});
        accessGate.show();
    }
    private int dp(int val){return Math.round(val*getResources().getDisplayMetrics().density);}
    private LinearLayout vertical(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    private LinearLayout horizontal(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);l.setGravity(Gravity.CENTER_VERTICAL);return l;}
    private LinearLayout.LayoutParams lp(int w,int h){return new LinearLayout.LayoutParams(w,h);}
    private LinearLayout.LayoutParams gap(int top,int bottom){
        LinearLayout.LayoutParams p=lp(-1,-2);p.setMargins(0,dp(top),0,dp(bottom));return p;
    }
    private GradientDrawable background(int color,int radius,int stroke){
        return GlassSurface.panel(color,stroke,dp(radius));
    }
    private TextView text(String value,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);
        t.setTextDirection(View.TEXT_DIRECTION_RTL);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        return t;
    }
    /** Android KitKat cinema shell: native 10-foot layout, remote-first and RTL. */
    private void buildShell(){
        root=vertical();root.setBackgroundDrawable(GlassSurface.canvas());
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        LinearLayout head=horizontal();
        head.setPadding(dp(27),dp(8),dp(27),dp(8));
        head.setBackgroundDrawable(GlassSurface.overlay(0x78E4C58B,dp(0)));
        root.addView(head,lp(-1,dp(78)));
        int logoResource=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(logoResource!=0){
            ImageView brandLogo=new ImageView(this);
            brandLogo.setImageResource(logoResource);
            brandLogo.setScaleType(ImageView.ScaleType.FIT_CENTER);
            LinearLayout.LayoutParams logoLayout=lp(dp(90),dp(64));
            logoLayout.setMargins(0,0,dp(14),0);
            head.addView(brandLogo,logoLayout);
        }else{
            TextView brand=text("العز TV",29,WHITE,true);
            brand.setGravity(Gravity.CENTER_VERTICAL);
            head.addView(brand,lp(dp(132),-1));
        }
        TextView intro=text("  |  شاهد ما تحب",13,0xFFC4C4CC,false);
        intro.setGravity(Gravity.CENTER_VERTICAL);head.addView(intro);
        head.addView(new View(this),new LinearLayout.LayoutParams(0,1,1));
        headerUpdate=text("◌  تحديث تلقائي",12,MUTED,false);
        headerUpdate.setGravity(Gravity.CENTER_VERTICAL);head.addView(headerUpdate);
        Button fastSearch=button("⌕  البحث");
        fastSearch.setTag("header:search");
        LinearLayout.LayoutParams fp=lp(dp(115),dp(47));fp.setMargins(dp(12),0,dp(10),0);
        head.addView(fastSearch,fp);
        fastSearch.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            mode="search";pendingFocusTag="input:search";render();
        }});
        Button refresh=button("↻  تحديث");
        refresh.setTag("header:refresh");
        head.addView(refresh,lp(dp(115),dp(47)));
        refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadCatalog();}});
        View line=new View(this);line.setBackgroundColor(0xFF33313E);root.addView(line,lp(-1,dp(1)));
        LinearLayout theater=horizontal();theater.setGravity(Gravity.TOP);
        root.addView(theater,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout rail=vertical();
        rail.setPadding(dp(15),dp(19),dp(15),dp(16));
        rail.setBackgroundDrawable(GlassSurface.overlay(0x61E4D6C5,dp(0)));
        theater.addView(rail,lp(dp(205),-1));
        TextView guide=text("✦  استكشف العز TV",14,0xFFFFAAB7,true);
        guide.setGravity(Gravity.RIGHT);guide.setPadding(dp(8),dp(7),0,dp(12));rail.addView(guide);
        ScrollView railScroll=new ScrollView(this);railScroll.setVerticalScrollBarEnabled(false);
        railScroll.setSmoothScrollingEnabled(false);
        rail.addView(railScroll,new LinearLayout.LayoutParams(-1,0,1));
        menu=vertical();railScroll.addView(menu,new ScrollView.LayoutParams(-1,-2));
        navButtons=new Button[labels.length];
        final String[] icons={"⌂","▶","▣","▤","●","★","♡","⌕","⚙"};
        for(int i=0;i<labels.length;i++){
            final String target=modes[i];
            Button item=button("  "+icons[i]+"   "+labels[i]);
            item.setGravity(Gravity.RIGHT|Gravity.CENTER_VERTICAL);
            item.setTextSize(16);item.setTag("nav:"+target);
            LinearLayout.LayoutParams p=lp(-1,dp(55));p.setMargins(0,dp(5),0,dp(5));
            menu.addView(item,p);navButtons[i]=item;
            item.setContentDescription("انتقل إلى "+labels[i]);
            item.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                listingPage=0;pendingFocusTag="nav:"+target;mode=target;render();
            }});
        }
        TextView foot=text("◉ الأسهم: تنقل   •   OK: اختيار\n⌕ زر البحث   •   رجوع: الصفحة السابقة",11,0xFFABA3B2,false);
        foot.setGravity(Gravity.RIGHT);foot.setPadding(dp(8),dp(10),0,0);rail.addView(foot);
        View divider=new View(this);divider.setBackgroundColor(0xFF292A34);theater.addView(divider,lp(dp(1),-1));
        LinearLayout page=vertical();theater.addView(page,new LinearLayout.LayoutParams(0,-1,1));
        notice=text("",12,0xFFFFB6BF,false);
        notice.setPadding(dp(23),dp(6),dp(23),dp(6));notice.setVisibility(View.GONE);
        page.addView(notice,lp(-1,-2));
        scrolling=new ScrollView(this);scrolling.setFillViewport(true);
        scrolling.setVerticalScrollBarEnabled(false);
        scrolling.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS);
        scrolling.setSmoothScrollingEnabled(false);
        page.addView(scrolling,new LinearLayout.LayoutParams(-1,0,1));
        stage=vertical();stage.setPadding(dp(34),dp(23),dp(34),dp(48));
        scrolling.addView(stage,new ScrollView.LayoutParams(-1,-2));
        setContentView(root);
    }
    private Button button(String label){
        final Button b=new Button(this);
        b.setText(label);b.setTag("btn:"+label);b.setTextSize(15);b.setTextColor(WHITE);b.setAllCaps(false);
        b.setPadding(dp(12),dp(5),dp(12),dp(5));
        b.setFocusable(true);
        b.setBackgroundDrawable(background(PANEL,14,0xFF42303F));
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View view,boolean focused){
                b.setBackgroundDrawable(background(focused?0xFFB71D3B:PANEL,14,focused?0xFFFF93AA:0xFF42303F));
                b.setTextColor(focused?WHITE:WHITE);
                b.setScaleX(focused?1.045f:1f);b.setScaleY(focused?1.045f:1f);
                if(Build.VERSION.SDK_INT>=21)b.setElevation(focused?dp(8):0);
            }
        });
        return b;
    }
    private void title(String heading,String caption){
        LinearLayout headingRow=horizontal();
        TextView accent=text("▏",25,GOLD,true);headingRow.addView(accent,lp(dp(16),-2));
        TextView h=text(heading,24,WHITE,true);headingRow.addView(h);
        stage.addView(headingRow,gap(15,3));
        if(caption!=null){TextView c=text(caption,13,MUTED,false);stage.addView(c,gap(0,10));}
    }
    private void empty(String text){
        TextView e=text(text,18,MUTED,false);
        e.setGravity(Gravity.CENTER);e.setPadding(dp(24),dp(34),dp(24),dp(34));
        stage.addView(e,gap(20,15));
    }
    private void showStatus(String value){
        if(!unlocked||notice==null)return;
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
        JSONArray yt=api.recentCache("aseel_youtube_videos",youtubeCatalogQuery());
        if(m!=null){movies=m;hasLoaded=true;}
        if(s!=null){series=s;hasLoaded=true;}
        if(c!=null){channels=c;hasLoaded=true;}
        if(cats!=null){categories=cats;hasLoaded=true;}
        if(yt!=null){youtubeVideos=yt;hasLoaded=true;}
    }
    /** Use exactly the same published, kids-only Supabase feed as /web/?section=youtube. */
    private String youtubeCatalogQuery(){
        return "?select=id,title_ar,youtube_url,channel_name,language_code,topic,sort_order,source_page_url,is_kids,status&status=eq.published&is_kids=eq.true&order=sort_order.asc&limit=200";
    }
    private void loadCatalog(){
        if(loading)return;
        loading=true;lastRefreshAttempt=System.currentTimeMillis();
        if(headerUpdate!=null)headerUpdate.setText("◌  جارٍ التحديث...");
        showStatus(hasLoaded?"جاري تحديث المكتبة...":"جارٍ تحميل الأفلام والمسلسلات والقنوات...");
        new Thread(new Runnable(){public void run(){
            final String[] tables={"aseel_movies","aseel_series","aseel_channels","aseel_categories","aseel_youtube_videos"};
            final JSONArray[] fetched=new JSONArray[tables.length];
            final String[] errors=new String[tables.length];
            final CountDownLatch latch=new CountDownLatch(tables.length);
            for(int index=0;index<tables.length;index++){
                final int i=index;
                Thread task=new Thread(new Runnable(){public void run(){
                    try{
                        fetched[i]=i==3?api.listQuery(tables[i],"?select=*&order=sort_order.asc&limit=60"):
                            i==4?api.listQuery(tables[i],youtubeCatalogQuery()):api.list(tables[i]);
                    }catch(Exception e){errors[i]=CatalogApi.describe(e);}
                    finally{latch.countDown();}
                }},"Aseel-Catalog-"+i);
                task.setDaemon(true);task.start();
            }
            try{latch.await(35,TimeUnit.SECONDS);}catch(InterruptedException ignored){}
            runOnUiThread(new Runnable(){public void run(){
                if(isFinishing())return;
                boolean changed=!hasLoaded ||
                    (fetched[0]!=null&&!movies.toString().equals(fetched[0].toString())) ||
                    (fetched[1]!=null&&!series.toString().equals(fetched[1].toString())) ||
                    (fetched[2]!=null&&!channels.toString().equals(fetched[2].toString())) ||
                    (fetched[3]!=null&&!categories.toString().equals(fetched[3].toString())) ||
                    (fetched[4]!=null&&!youtubeVideos.toString().equals(fetched[4].toString()));
                if(fetched[0]!=null)movies=fetched[0];
                if(fetched[1]!=null)series=fetched[1];
                if(fetched[2]!=null)channels=fetched[2];
                if(fetched[3]!=null)categories=fetched[3];
                if(fetched[4]!=null)youtubeVideos=fetched[4];
                hasLoaded=true;loading=false;
                lastUpdatedAt=System.currentTimeMillis();
                String[] names={"الأفلام","المسلسلات","القنوات","التصنيفات","المقاطع"};
                StringBuilder report=new StringBuilder();
                for(int i=0;i<tables.length;i++){
                    if(errors[i]!=null)report.append(names[i]).append(": ").append(errors[i]).append("\n");
                    else if(fetched[i]==null)report.append(names[i]).append(": انتهت المهلة.\n");
                }
                networkErrors=report.toString();
                if(headerUpdate!=null)headerUpdate.setText(report.length()>0?"●  مشكلة اتصال":"✓  محدث الآن");
                showStatus(report.length()>0?"فشل تحديث بعض البيانات. تعرض العناصر المتاحة؛ راجع الإعدادات.":"");
                // Keep the browsing position while refreshing the clips feed.
                // Never replace an open video or any active search text.
                if(changed && subPage.length()==0 && !"search".equals(mode) && !"settings".equals(mode)){
                    final int oldScroll=scrolling==null?0:scrolling.getScrollY();
                    render();
                    if(oldScroll>0 && scrolling!=null)scrolling.post(new Runnable(){
                        public void run(){if(scrolling!=null)scrolling.scrollTo(0,oldScroll);}
                    });
                }
            }});
        }},"AlEzz-Refresh").start();
    }
    private void render(){
        if(!unlocked||stage==null)return;
        final String previous=pendingFocusTag.length()>0?pendingFocusTag:currentFocusTag();
        pendingFocusTag="";
        subPage="";
        stage.removeAllViews();scrolling.scrollTo(0,0);
        if(navButtons!=null)for(int j=0;j<navButtons.length;j++){
            boolean selected=modes[j].equals(mode);
            if(!navButtons[j].isFocused()){
                navButtons[j].setTextColor(WHITE);
                navButtons[j].setBackgroundDrawable(background(selected?0xFF641B2B:0xFF252529,14,selected?GOLD:0xFF404045));
            }
        }
        if("home".equals(mode))home();
        else if("movie".equals(mode)||"series".equals(mode)||"channel".equals(mode))listing(mode,false);
        else if("kids".equals(mode))kids();
        else if("youtube".equals(mode))youtube();
        else if("favorites".equals(mode))favorites();
        else if("search".equals(mode))search();
        else if("settings".equals(mode))settings();
        focusWhenReady(previous.length()>0?previous:"nav:"+mode);
    }
    private String currentFocusTag(){
        View focused=getCurrentFocus();
        Object tag=focused==null?null:focused.getTag();
        return tag instanceof String?(String)tag:"";
    }
    private View tagged(View node,String key){
        if(node==null||key==null||key.length()==0)return null;
        if(key.equals(node.getTag())&&node.isFocusable()&&node.isEnabled()&&node.getVisibility()==View.VISIBLE)return node;
        if(node instanceof ViewGroup){
            ViewGroup group=(ViewGroup)node;
            for(int i=0;i<group.getChildCount();i++){
                View found=tagged(group.getChildAt(i),key);
                if(found!=null)return found;
            }
        }
        return null;
    }
    private void focusWhenReady(final String key){
        if(stage==null)return;
        stage.post(new Runnable(){public void run(){
            if(isFinishing()||root==null)return;
            View target=tagged(root,key);
            if(target==null)target=tagged(root,"nav:"+mode);
            if(target==null&&navButtons!=null&&navButtons.length>0)target=navButtons[0];
            if(target!=null){target.requestFocus();ensureVisible(target);}
        }});
    }
    private void ensureVisible(View view){
        if(view!=null&&view.getWidth()>0&&view.getHeight()>0)
            view.requestRectangleOnScreen(new Rect(0,0,view.getWidth(),view.getHeight()),true);
    }
    private boolean remoteTarget(View view){
        return view!=null&&view.isFocusable()&&view.isEnabled()&&view.getVisibility()==View.VISIBLE
            &&view.getWidth()>0&&view.getHeight()>0
            &&(view instanceof Button||view instanceof EditText
              ||(view.getTag() instanceof String&&((String)view.getTag()).startsWith("card:")));
    }
    private void collectRemote(View node,List<View> out){
        if(node==null||node.getVisibility()!=View.VISIBLE)return;
        if(remoteTarget(node))out.add(node);
        if(node instanceof ViewGroup){
            ViewGroup group=(ViewGroup)node;
            for(int i=0;i<group.getChildCount();i++)collectRemote(group.getChildAt(i),out);
        }
    }
    /** Spatial remote navigation works without Android TV Leanback or touch support. */
    private boolean moveRemoteFocus(int key){
        ArrayList<View> all=new ArrayList<View>();collectRemote(root,all);
        if(all.isEmpty())return false;
        View current=getCurrentFocus();
        if(!remoteTarget(current)){
            View fallback=tagged(root,"nav:"+mode);
            if(fallback==null)fallback=all.get(0);
            fallback.requestFocus();ensureVisible(fallback);return true;
        }
        if(current instanceof EditText&&(key==KeyEvent.KEYCODE_DPAD_LEFT||key==KeyEvent.KEYCODE_DPAD_RIGHT))
            return false;
        int[] original=new int[2];current.getLocationOnScreen(original);
        int curX=original[0]+current.getWidth()/2,curY=original[1]+current.getHeight()/2;
        boolean sideways=key==KeyEvent.KEYCODE_DPAD_LEFT||key==KeyEvent.KEYCODE_DPAD_RIGHT;
        View best=null;double bestScore=Double.MAX_VALUE;
        for(View candidate:all){
            if(candidate==current)continue;
            int[] pos=new int[2];candidate.getLocationOnScreen(pos);
            int dx=pos[0]+candidate.getWidth()/2-curX,dy=pos[1]+candidate.getHeight()/2-curY;
            if(key==KeyEvent.KEYCODE_DPAD_LEFT&&dx>=-dp(8))continue;
            if(key==KeyEvent.KEYCODE_DPAD_RIGHT&&dx<=dp(8))continue;
            if(key==KeyEvent.KEYCODE_DPAD_UP&&dy>=-dp(8))continue;
            if(key==KeyEvent.KEYCODE_DPAD_DOWN&&dy<=dp(8))continue;
            boolean overlap=sideways?
              pos[1]<original[1]+current.getHeight()&&pos[1]+candidate.getHeight()>original[1]:
              pos[0]<original[0]+current.getWidth()&&pos[0]+candidate.getWidth()>original[0];
            double score=Math.abs(sideways?dx:dy)+Math.abs(sideways?dy:dx)*(sideways?3.5:1.3)
                +(overlap?0:dp(sideways?720:80));
            if(score<bestScore){bestScore=score;best=candidate;}
        }
        if(best==null)return false;
        best.requestFocus();ensureVisible(best);return true;
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event){
        if(!unlocked){
            if(accessGate!=null&&accessGate.keyEvent(event))return true;
            return super.dispatchKeyEvent(event);
        }
        int code=event.getKeyCode();
        boolean directional=code==KeyEvent.KEYCODE_DPAD_LEFT||code==KeyEvent.KEYCODE_DPAD_RIGHT||
                            code==KeyEvent.KEYCODE_DPAD_UP||code==KeyEvent.KEYCODE_DPAD_DOWN;
        if(directional&&event.getAction()==KeyEvent.ACTION_UP&&code==handledArrow){
            handledArrow=-1;return true;
        }
        if(event.getAction()==KeyEvent.ACTION_DOWN){
            if(directional&&moveRemoteFocus(code)){handledArrow=code;return true;}
            if(code==KeyEvent.KEYCODE_SEARCH&&event.getRepeatCount()==0){
                mode="search";pendingFocusTag="input:search";render();return true;
            }
            if(code==KeyEvent.KEYCODE_MENU&&event.getRepeatCount()==0){
                mode="settings";pendingFocusTag="nav:settings";render();return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
    private void home(){
        final JSONObject featured=firstFeature();
        android.widget.FrameLayout spotlight=new android.widget.FrameLayout(this);
        GradientDrawable backdrop=new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{0xFF421528,0xFF100B14,0xFF29101C});
        backdrop.setCornerRadius(dp(24));spotlight.setBackgroundDrawable(GlassSurface.overlay(0x69E0BB80,dp(24)));
        stage.addView(spotlight,lp(-1,dp(340)));
        if(featured!=null && !prefs.getBoolean("lite_mode",false)){
            ImageView visual=new ImageView(this);
            visual.setScaleType(ImageView.ScaleType.CENTER_CROP);
            spotlight.addView(visual,new android.widget.FrameLayout.LayoutParams(-1,-1));
            PosterLoader.load(visual,str(featured,"backdrop_url").length()>0?
                str(featured,"backdrop_url"):str(featured,"poster_url"));
            View shade=new View(this);
            shade.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{0xF609080D,0xE909080D,0xB009080D,0x2609080D}));
            spotlight.addView(shade,new android.widget.FrameLayout.LayoutParams(-1,-1));
        }
        LinearLayout content=vertical();content.setPadding(dp(36),dp(27),dp(32),dp(27));
        android.widget.FrameLayout.LayoutParams contentParams=
            new android.widget.FrameLayout.LayoutParams(-1,-2,Gravity.CENTER_VERTICAL);
        spotlight.addView(content,contentParams);
        TextView eyebrow=text("✦  ALIZZ TV  /  PREMIERE",14,0xFFFFB8C1,true);
        content.addView(eyebrow);
        TextView name=text(featured!=null?str(featured,"title_ar"):"أهلًا بك في عالم العز TV",39,WHITE,true);
        name.setMaxLines(2);content.addView(name,gap(8,6));
        if(featured!=null){
            String type=str(featured,"_type");
            String metadata=("channel".equals(type)?"● بث مباشر":"series".equals(type)?"▤ مسلسل":"▣ فيلم")
                +(str(featured,"quality").length()>0?"   •   "+str(featured,"quality"):"")
                +(str(featured,"release_year").length()>0?"   •   "+str(featured,"release_year"):"");
            TextView featureMeta=text(metadata,13,0xFFFFB0C0,true);
            content.addView(featureMeta,gap(0,6));
        }
        TextView sub=text(featured!=null?str(featured,"description"):"أفلام ومسلسلات وبث مباشر في مكان واحد. استمتع بتجربة مشاهدة عربية.",
            14,0xFFCED4DD,false);sub.setMaxLines(2);content.addView(sub,gap(3,12));
        LinearLayout heroActions=horizontal();content.addView(heroActions,gap(7,1));
        if(featured!=null){
            Button watch=button("▶  تشغيل الآن");watch.setBackgroundDrawable(background(GOLD,11,0xFFFF6972));
            heroActions.addView(watch,lp(dp(158),dp(49)));
            watch.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                try{
                    String t=str(featured,"_type");
                    if("series".equals(t)){lastMode="home";loadEpisodes(featured);}
                    else play(featured,null,null,null);
                }catch(Exception e){showStatus("تعذر فتح المحتوى");}
            }});
            Button info=button("معلومات +");LinearLayout.LayoutParams ip=lp(dp(148),dp(49));ip.setMargins(dp(9),0,0,0);heroActions.addView(info,ip);
            info.setOnClickListener(new View.OnClickListener(){public void onClick(View v){lastMode="home";details(featured);}});
        }else{
            Button explore=button("استكشف المكتبة");heroActions.addView(explore,lp(dp(174),dp(49)));
            explore.setOnClickListener(new View.OnClickListener(){public void onClick(View v){mode="movie";render();}});
        }
        if(!hasLoaded){empty("جاري تحديث مكتبة العز TV...");return;}
        Button ytShortcut=button("▶  شاهد المقاطع  •  تشغيل مباشر");
        ytShortcut.setTextSize(17);
        ytShortcut.setBackgroundDrawable(background(0xFF32171C,14,0xFFA82B42));
        stage.addView(ytShortcut,gap(15,8));
        ytShortcut.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            mode="youtube";render();
        }});
        LinearLayout quick=horizontal();quick.setGravity(Gravity.CENTER);stage.addView(quick,gap(20,10));
        dashboardStat(quick,"الأفلام",movies.length());
        dashboardStat(quick,"المسلسلات",series.length());
        dashboardStat(quick,"مباشر",channels.length());
        Button kidsShortcut=button("★  عالم الأطفال  •  مشاهدة آمنة للعائلة");
        kidsShortcut.setBackgroundDrawable(background(0xFF1B2833,12,0xFF385768));
        kidsShortcut.setTextColor(0xFFFAE6CB);kidsShortcut.setTextSize(17);
        stage.addView(kidsShortcut,gap(13,11));
        kidsShortcut.setOnClickListener(new View.OnClickListener(){public void onClick(View v){mode="kids";render();}});
        resumeRow();
        ArrayList<JSONObject> recent=new ArrayList<JSONObject>();
        addRecent(recent,movies,"movie");addRecent(recent,series,"series");
        if(!recent.isEmpty()){title("أكمل من حيث توقفت","كل ما تابعته محفوظ على هذا التلفزيون");cards(recent,8);}
        section("اختيارات العز  •  أفلام",movies,"movie",12);
        section("مسلسلات ومغامرات",series,"series",12);
        section("على الهواء الآن  ●",channels,"channel",12);
        ArrayList<JSONObject> child=new ArrayList<JSONObject>();
        for(int i=0;i<movies.length();i++){
            JSONObject item=movies.optJSONObject(i);
            if(item!=null && item.optBoolean("is_kids",false)){
                try{item.put("_type","movie");}catch(Exception ignored){}
                child.add(item);
            }
        }
        if(!child.isEmpty()){title("★ ركن الأطفال","محتوى مختار للعائلة");cards(child,8);}
        ArrayList<JSONObject> clips=new ArrayList<JSONObject>();
        for(int i=0;i<youtubeVideos.length() && clips.size()<8;i++){
            JSONObject item=youtubeVideos.optJSONObject(i);
            if(item==null||!"published".equals(str(item,"status"))||
                !item.optBoolean("is_kids",false)||
                !YouTubeLink.usable(str(item,"youtube_url")))continue;
            try{item.put("_type","youtube");}catch(Exception ignored){}
            clips.add(item);
        }
        if(!clips.isEmpty()){
            title("مقاطع مختارة لك","تشغيل مباشر • المقترحات والتالي تلقائيًا");
            cards(clips,8);
        }
        categoriesRow();
        if(movies.length()+series.length()+channels.length()==0)
            empty("المكتبة خالية حاليًا. تظهر الأعمال المعتمدة تلقائيًا بعد إضافتها.");
    }
    private JSONObject firstFeature(){
        for(JSONArray data:new JSONArray[]{movies,series,channels})
            for(int i=0;i<data.length();i++){
                JSONObject obj=data.optJSONObject(i);
                if(obj!=null && obj.optBoolean("featured",false)){
                    try{obj.put("_type",data==movies?"movie":data==series?"series":"channel");}catch(Exception ignored){}
                    return obj;
                }
            }
        for(JSONArray data:new JSONArray[]{movies,series,channels})
            if(data.length()>0){
                JSONObject obj=data.optJSONObject(0);
                if(obj!=null){
                    try{obj.put("_type",data==movies?"movie":data==series?"series":"channel");}catch(Exception ignored){}
                    return obj;
                }
            }
        return null;
    }
    private void dashboardStat(LinearLayout parent,String heading,int count){
        TextView info=text(heading+"  "+count,15,WHITE,true);
        info.setGravity(Gravity.CENTER);
        info.setPadding(dp(8),dp(10),dp(8),dp(10));
        info.setBackgroundDrawable(background(0xFF251622,14,0xFF583044));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(52),1);
        p.setMargins(dp(5),0,dp(5),0);parent.addView(info,p);
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
    private String countryLabel(String code){
        if("US".equals(code))return "الولايات المتحدة";
        if("TR".equals(code))return "تركيا";
        if("SA".equals(code))return "السعودية";
        if("GB".equals(code))return "بريطانيا";
        if("AR".equals(code))return "الأرجنتين";
        if("NL".equals(code))return "هولندا";
        if("IT".equals(code))return "إيطاليا";
        if("DE".equals(code))return "ألمانيا";
        if("FR".equals(code))return "فرنسا";
        if("ES".equals(code))return "إسبانيا";
        return code;
    }
    private String languageLabel(String code){
        if("ar".equals(code))return "العربية";
        if("en".equals(code))return "الإنجليزية";
        if("tr".equals(code))return "التركية";
        if("es".equals(code))return "الإسبانية";
        if("it".equals(code))return "الإيطالية";
        if("ku".equals(code))return "الكردية";
        if("de".equals(code))return "الألمانية";
        if("fr".equals(code))return "الفرنسية";
        if("und".equals(code))return "بلا حوار";
        return code;
    }
    private ArrayList<JSONObject> kidsItems(String type){
        ArrayList<JSONObject> all=new ArrayList<JSONObject>();
        JSONArray src=data(type);
        for(int i=0;i<src.length();i++){
            JSONObject item=src.optJSONObject(i);if(item==null || !item.optBoolean("is_kids",false))continue;
            if(!kidsCountry.isEmpty()&&!kidsCountry.equals(str(item,"country_code")))continue;
            if(!kidsLanguage.isEmpty()&&!kidsLanguage.equals(str(item,"language_code")))continue;
            try{item.put("_type",type);}catch(Exception ignored){}
            all.add(item);
        }
        return all;
    }
    /** Official YouTube search and local viewing history without an unlicensed feed. */
    private void youtube(){
        LinearLayout panel=vertical();
        panel.setPadding(dp(25),dp(24),dp(25),dp(22));
        panel.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.RIGHT_LEFT,
            new int[]{0xFF5D1024,0xFF22151B,0xFF19191E}));
        stage.addView(panel,gap(6,12));
        panel.addView(text("▶  مقاطع العز",31,WHITE,true));
        panel.addView(text("اختر ما تريد مشاهدته • تشغيل مباشر داخل التطبيق • التالي تلقائيًا",15,0xFFE4D4DC,false),gap(5,6));
        TextView tip=text("مرّر للأعلى أثناء المشاهدة أو استخدم زر ↑ لعرض المقاطع المقترحة",13,0xFFBDB4BC,false);
        stage.addView(tip,gap(0,14));
        JSONArray recent;
        try{recent=new JSONArray(prefs.getString("youtube_recent_v1","[]"));}
        catch(Exception e){recent=new JSONArray();}
        ArrayList<JSONObject> saved=new ArrayList<JSONObject>();
        for(int i=0;i<recent.length();i++){
            JSONObject item=recent.optJSONObject(i);
            if(item!=null&&YouTubeLink.usable(str(item,"youtube_url"))){
                try{item.put("_type","youtube");}catch(Exception ignored){}
                saved.add(item);
            }
        }
        if(!saved.isEmpty()){
            title("◉  شاهدت مؤخرًا","محفوظ على هذا التلفزيون فقط");
            cards(saved,12);
        }
        // Identical source and approval scope as the working public website.
        if(loading && youtubeVideos.length()==0)
            empty("جاري تحميل مكتبة المقاطع...");
        final String[] topics={"all","letters","numbers","animals","colors","stories","songs","science"};
        final String[] topicLabels={"الكل","الحروف","الأرقام","الحيوانات","الألوان","القصص","الأناشيد","العلوم"};
        title("استكشف المقاطع","فيديوهات تعليمية وترفيهية مصنّفة • تحديث تلقائي");
        HorizontalScrollView filters=new HorizontalScrollView(this);
        filters.setHorizontalScrollBarEnabled(false);
        LinearLayout chips=horizontal();filters.addView(chips);
        stage.addView(filters,gap(3,10));
        for(int i=0;i<topics.length;i++){
            final String key=topics[i];
            Button chip=button(topicLabels[i]+(key.equals(youtubeTopic)?" ✓":""));
            chip.setTextSize(12);
            LinearLayout.LayoutParams chipP=lp(dp(126),dp(46));
            chipP.setMargins(dp(4),0,dp(4),0);chips.addView(chip,chipP);
            chip.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                youtubeTopic=key;youtubePage=0;render();
            }});
        }
        LinearLayout languageRow=horizontal();stage.addView(languageRow,gap(2,6));
        for(final String lang:new String[]{"all","ar","en"}){
            Button chip=button(("all".equals(lang)?"كل اللغات":languageLabel(lang))+
                (lang.equals(youtubeLanguage)?" ✓":""));
            LinearLayout.LayoutParams p=lp(dp(148),dp(43));
            p.setMargins(dp(4),0,dp(4),0);languageRow.addView(chip,p);
            chip.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                youtubeLanguage=lang;youtubePage=0;render();
            }});
        }
        ArrayList<JSONObject> approved=new ArrayList<JSONObject>();
        for(int i=0;i<youtubeVideos.length();i++){
            JSONObject item=youtubeVideos.optJSONObject(i);
            if(item==null || !"published".equals(str(item,"status")) ||
                !item.optBoolean("is_kids",false) ||
                !YouTubeLink.usable(str(item,"youtube_url")))continue;
            if(!"all".equals(youtubeTopic) && !youtubeTopic.equals(str(item,"topic")))continue;
            if(!"all".equals(youtubeLanguage) && !youtubeLanguage.equals(str(item,"language_code")))continue;
            try{item.put("_type","youtube");}catch(Exception ignored){}
            approved.add(item);
        }
        if(!approved.isEmpty()){
            int pages=Math.max(1,(approved.size()+YOUTUBE_PAGE_SIZE-1)/YOUTUBE_PAGE_SIZE);
            youtubePage=Math.max(0,Math.min(youtubePage,pages-1));
            TextView count=text(approved.size()+" مقطع   •   صفحة "+(youtubePage+1)+" من "+pages,13,MUTED,false);
            stage.addView(count,gap(0,8));
            ArrayList<JSONObject> visible=new ArrayList<JSONObject>();
            int start=youtubePage*YOUTUBE_PAGE_SIZE;
            for(int i=start;i<Math.min(approved.size(),start+YOUTUBE_PAGE_SIZE);i++)
                visible.add(approved.get(i));
            cardsGrid(visible,YOUTUBE_PAGE_SIZE);
            if(pages>1){
                LinearLayout pageNav=horizontal();stage.addView(pageNav,gap(2,16));
                Button next=button("الصفحة التالية");
                Button previous=button("الصفحة السابقة");
                next.setEnabled(youtubePage<pages-1);
                previous.setEnabled(youtubePage>0);
                pageNav.addView(next,lp(dp(178),dp(50)));
                LinearLayout.LayoutParams previousP=lp(dp(178),dp(50));
                previousP.setMargins(dp(12),0,0,0);pageNav.addView(previous,previousP);
                next.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                    youtubePage++;render();
                }});
                previous.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                    youtubePage--;render();
                }});
            }
        }else if(!loading || youtubeVideos.length()>0){
            TextView warning=text(youtubeVideos.length()>0?
                "لا توجد مقاطع مطابقة للتصنيف المحدد. جرّب «الكل».":
                "لم تصل المقاطع من قاعدة البيانات. اضغط «تحديث» بالأعلى أو راجع الاتصال.",15,MUTED,false);
            warning.setPadding(dp(18),dp(19),dp(18),dp(19));
            warning.setBackgroundDrawable(background(0xFF232329,13,0xFF404049));
            stage.addView(warning,gap(13,16));
        }
        ArrayList<JSONObject> library=new ArrayList<JSONObject>();
        for(JSONArray source:new JSONArray[]{movies,channels}){
            for(int i=0;i<source.length()&&library.size()<9;i++){
                JSONObject item=source.optJSONObject(i);if(item==null)continue;
                try{item.put("_type",source==movies?"movie":"channel");}catch(Exception ignored){}
                library.add(item);
            }
        }
        if(!library.isEmpty()){
            title("شاهد أيضًا","من مكتبة الأفلام والقنوات");
            cards(library,9);
        }
    }
    private void saveYouTubeRecent(String url,String label){
        String id=YouTubeLink.videoId(url);if(id==null)return;
        try{
            JSONArray previous=new JSONArray(prefs.getString("youtube_recent_v1","[]"));
            JSONArray next=new JSONArray();
            JSONObject item=new JSONObject();
            item.put("id","yt-"+id);
            item.put("youtube_url","https://www.youtube.com/watch?v="+id);
            item.put("title_ar",label==null||label.trim().length()==0?"فيديو YouTube":label);
            item.put("_type","youtube");next.put(item);
            for(int i=0;i<previous.length()&&next.length()<12;i++){
                JSONObject old=previous.optJSONObject(i);
                if(old!=null&&!id.equals(YouTubeLink.videoId(old.optString("youtube_url",""))))next.put(old);
            }
            prefs.edit().putString("youtube_recent_v1",next.toString()).apply();
        }catch(Exception ignored){}
    }
    /** Launch the native in-app viewer with a bounded, published local queue. */
    private void openYouTube(String url,String label){
        if(!unlocked)return;
        String selected=YouTubeLink.videoId(url);
        if(selected==null){showStatus("المقطع غير متاح.");return;}
        saveYouTubeRecent(url,label);
        JSONArray queue=new JSONArray();
        boolean selectedInCatalog=false;
        for(int i=0;i<youtubeVideos.length() && queue.length()<120;i++){
            JSONObject source=youtubeVideos.optJSONObject(i);
            if(source==null||!"published".equals(str(source,"status"))||
                !source.optBoolean("is_kids",false))continue;
            String itemId=YouTubeLink.videoId(str(source,"youtube_url"));
            if(itemId==null)continue;
            JSONObject item=new JSONObject();
            try{
                item.put("video_id",itemId);
                item.put("title",str(source,"title_ar"));
                item.put("channel",str(source,"channel_name"));
                item.put("topic",str(source,"topic"));
                queue.put(item);
                if(itemId.equals(selected))selectedInCatalog=true;
            }catch(Exception ignored){}
        }
        if(!selectedInCatalog){
            JSONObject first=new JSONObject();
            try{
                first.put("video_id",selected);
                first.put("title",label);
                first.put("channel","العز TV");
                first.put("topic","other");
                JSONArray merged=new JSONArray();merged.put(first);
                for(int i=0;i<queue.length();i++)merged.put(queue.optJSONObject(i));
                queue=merged;
            }catch(Exception ignored){}
        }
        Intent view=new Intent(this,YouTubeActivity.class);
        view.putExtra("start_video_id",selected);
        view.putExtra("playlist_json",queue.toString());
        startActivity(view);
    }
    private void kids(){
        title("★ عالم الأطفال","قنوات وأفلام ومسلسلات مناسبة للعائلة، بدون متصفح خارجي");
        TextView note=text("تظهر المواد المرخّصة ذات الروابط المباشرة فقط. قد يختلف توفر القنوات بحسب البلد أو الجهاز.",14,MUTED,false);
        stage.addView(note,gap(0,11));
        LinearLayout typeRow=horizontal();stage.addView(typeRow,gap(5,10));
        final String[] kinds={"all","movie","series","channel","youtube"},names={"الكل","أفلام","مسلسلات","قنوات","مقاطع"};
        for(int i=0;i<kinds.length;i++){
            final String selected=kinds[i];
            Button b=button(names[i]+(selected.equals(kidsKind)?" ✓":""));b.setTextSize(12);
            typeRow.addView(b,new LinearLayout.LayoutParams(0,dp(48),1));
            b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){kidsKind=selected;render();}});
        }
        java.util.LinkedHashSet<String> countries=new java.util.LinkedHashSet<String>();
        java.util.LinkedHashSet<String> languages=new java.util.LinkedHashSet<String>();
        for(String type:new String[]{"movie","series","channel"}){
            JSONArray input=data(type);
            for(int i=0;i<input.length();i++){
                JSONObject x=input.optJSONObject(i);if(x==null || !x.optBoolean("is_kids",false))continue;
                String c=str(x,"country_code"),l=str(x,"language_code");
                if(!c.isEmpty())countries.add(c);
                if(!l.isEmpty())languages.add(l);
            }
        }
        kidsFilterRow("الدولة",countries,true);
        kidsFilterRow("اللغة",languages,false);
        boolean visible=false;
        for(String type:new String[]{"movie","series","channel"}){
            if(!"all".equals(kidsKind)&&!type.equals(kidsKind))continue;
            ArrayList<JSONObject> items=kidsItems(type);
            if(!items.isEmpty()){
                visible=true;
                title("movie".equals(type)?"أفلام الأطفال":"series".equals(type)?"مسلسلات ومغامرات":"قنوات الأطفال المباشرة",items.size()+" متاح");
                cards(items,TV_PAGE_SIZE);
            }
        }
        if(("all".equals(kidsKind)||"youtube".equals(kidsKind))&&youtubeVideos.length()>0){
            ArrayList<JSONObject> videos=new ArrayList<JSONObject>();
            for(int i=0;i<youtubeVideos.length()&&videos.size()<12;i++){
                JSONObject video=youtubeVideos.optJSONObject(i);
                if(video==null || !"published".equals(str(video,"status")) ||
                    !video.optBoolean("is_kids",false) || !YouTubeLink.usable(str(video,"youtube_url")))continue;
                try{video.put("_type","youtube");}catch(Exception ignored){}
                videos.add(video);
            }
            if(!videos.isEmpty()){
                visible=true;
                title("▶  مقاطع الأطفال",youtubeVideos.length()+" مقطع متاح • انتقل إلى المقاطع لعرض الكل");
                cards(videos,12);
                Button seeAll=button("عرض كل المقاطع");
                stage.addView(seeAll,gap(0,12));
                seeAll.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                    mode="youtube";youtubePage=0;render();
                }});
            }
        }
        if(!visible)empty("لا تتوفر عناصر مناسبة لفلاترك. لن تُعرض روابط غير مفحوصة.");
    }
    private void kidsFilterRow(String heading,java.util.LinkedHashSet<String> options,final boolean country){
        if(options.isEmpty())return;
        TextView label=text(heading,14,MUTED,true);stage.addView(label,gap(10,2));
        HorizontalScrollView scroll=new HorizontalScrollView(this);scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout buttons=horizontal();scroll.addView(buttons);stage.addView(scroll,gap(0,4));
        String current=country?kidsCountry:kidsLanguage;
        Button all=button("الكل"+(current.isEmpty()?" ✓":""));buttons.addView(all,lp(dp(88),dp(44)));
        all.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            if(country)kidsCountry="";else kidsLanguage="";render();
        }});
        for(final String code:options){
            String caption=country?countryLabel(code):languageLabel(code);
            Button b=button(caption+(current.equals(code)?" ✓":""));b.setTextSize(12);
            LinearLayout.LayoutParams p=lp(dp(156),dp(44));p.setMargins(dp(4),0,dp(4),0);buttons.addView(b,p);
            b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                if(country)kidsCountry=code;else kidsLanguage=code;render();
            }});
        }
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
                subPage="category";lastMode="home";returnFocusTag=currentFocusTag();
                stage.removeAllViews();
                Button back=button("العودة للرئيسية");stage.addView(back,lp(dp(210),dp(48)));
                back.setOnClickListener(new View.OnClickListener(){public void onClick(View w){mode="home";render();}});
                ArrayList<JSONObject> items=new ArrayList<JSONObject>();
                addCategoryItems(items,movies,"movie",id);
                addCategoryItems(items,series,"series",id);
                addCategoryItems(items,channels,"channel",id);
                if(items.isEmpty())empty("لا يوجد محتوى منشور لهذا التصنيف.");
                else cards(items,TV_PAGE_SIZE);
                focusWhenReady("btn:العودة للرئيسية");
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
        if(!unlocked)return;
        if(!loading && System.currentTimeMillis()-lastRefreshAttempt > 30L*1000L){
            loadCatalog();
        }
        refreshHandler.removeCallbacks(refreshLoop);
        refreshHandler.postDelayed(refreshLoop,60L*1000L);
    }
    @Override protected void onPause(){
        refreshHandler.removeCallbacks(refreshLoop);
        // User enabled this TV once; do not re-lock on exit, background, or reboot.
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
        final JSONArray list=data(type);
        if(!hasLoaded){title(t,"جاري تحميل البيانات...");return;}
        if(list.length()==0){title(t,null);empty("لا توجد أعمال متاحة في هذا القسم.");return;}
        int pages=Math.max(1,(list.length()+TV_PAGE_SIZE-1)/TV_PAGE_SIZE);
        listingPage=Math.max(0,Math.min(listingPage,pages-1));
        title(t,"أعمال منشورة ومرخصة  •  الصفحة "+(listingPage+1)+" من "+pages);
        ArrayList<JSONObject> page=new ArrayList<JSONObject>();
        for(int i=listingPage*TV_PAGE_SIZE;i<Math.min(list.length(),(listingPage+1)*TV_PAGE_SIZE);i++){
            JSONObject item=list.optJSONObject(i);
            if(item!=null){try{item.put("_type",type);}catch(Exception ignored){}page.add(item);}
        }
        cardsGrid(page,TV_PAGE_SIZE);
        if(pages>1){
            LinearLayout row=horizontal();stage.addView(row,gap(4,14));
            Button back=button("السابق");back.setEnabled(listingPage>0);
            row.addView(back,lp(dp(152),dp(54)));
            Button next=button("التالي");next.setEnabled(listingPage<pages-1);
            LinearLayout.LayoutParams np=lp(dp(152),dp(54));np.setMargins(dp(12),0,0,0);
            row.addView(next,np);
            back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                listingPage--;pendingFocusTag="btn:السابق";render();
            }});
            next.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                listingPage++;pendingFocusTag="btn:التالي";render();
            }});
        }
    }
    /** Multirow, remote-navigable video grid for TV browsing. */
    private void cardsGrid(ArrayList<JSONObject> items,int max){
        DisplayMetrics metrics=getResources().getDisplayMetrics();
        int widthDp=Math.round(metrics.widthPixels/metrics.density);
        int columns=widthDp>=1150?3:widthDp>=740?2:1;
        for(int i=0;i<items.size() && i<max;i+=columns){
            ArrayList<JSONObject> row=new ArrayList<JSONObject>();
            for(int j=i;j<Math.min(items.size(),Math.min(max,i+columns));j++)row.add(items.get(j));
            cards(row,columns);
        }
    }
    private void cards(ArrayList<JSONObject> all,int max){
        if(all.isEmpty())return;
        HorizontalScrollView scroller=new HorizontalScrollView(this);
        scroller.setHorizontalScrollBarEnabled(false);
        LinearLayout holder=horizontal();holder.setGravity(Gravity.TOP);
        scroller.addView(holder);
        stage.addView(scroller,gap(6,18));
        for(int i=0;i<all.size()&&i<max;i++){
            final JSONObject item=all.get(i);
            final LinearLayout card=vertical();
            card.setPadding(dp(8),dp(8),dp(8),dp(13));
            card.setBackgroundDrawable(background(0xFF1C141E,18,0xFF443140));
            LinearLayout.LayoutParams cardLp=lp(dp(266),-2);
            cardLp.setMargins(dp(5),0,dp(5),0);holder.addView(card,cardLp);
            card.setFocusable(true);card.setClickable(true);
            card.setTag("card:"+str(item,"_type")+":"+str(item,"id"));
            card.setContentDescription("فتح تفاصيل "+str(item,"title_ar")+
                (isFavorite(str(item,"_type"),str(item,"id"))?"، في المفضلة":"")+
                (str(item,"quality").length()>0?"، الجودة "+str(item,"quality"):""));
            android.widget.FrameLayout artwork=new android.widget.FrameLayout(this);
            artwork.setBackgroundDrawable(background(0xFF301827,14,0));
            card.addView(artwork,lp(-1,dp(158)));
            ImageView poster=new ImageView(this);
            poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
            artwork.addView(poster,new android.widget.FrameLayout.LayoutParams(-1,-1));
            if(!prefs.getBoolean("lite_mode",false)){
                String posterUrl=str(item,"poster_url");
                String yt=YouTubeLink.videoId(str(item,"youtube_url"));
                if(posterUrl.length()==0&&yt!=null)posterUrl="https://i.ytimg.com/vi/"+yt+"/hqdefault.jpg";
                PosterLoader.load(poster,posterUrl);
            }
            TextView overlay=text("▶",25,WHITE,true);overlay.setGravity(Gravity.CENTER);
            overlay.setBackgroundDrawable(background(0xAA080B0F,12,0x66FFFFFF));
            android.widget.FrameLayout.LayoutParams pp=new android.widget.FrameLayout.LayoutParams(dp(50),dp(44),Gravity.CENTER);
            artwork.addView(overlay,pp);
            String itemId=str(item,"id");
            if(itemId.equals(prefs.getString("resume_id",""))){
                TextView resumeBadge=text("◉  تابع المشاهدة",12,WHITE,true);
                resumeBadge.setPadding(dp(12),dp(5),dp(12),dp(5));
                resumeBadge.setBackgroundDrawable(background(0xE2BC2140,14,0x66FFB2C0));
                android.widget.FrameLayout.LayoutParams badgeP=new android.widget.FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.RIGHT);
                badgeP.setMargins(dp(9),dp(9),dp(9),0);
                artwork.addView(resumeBadge,badgeP);
            }else if(isFavorite(str(item,"_type"),itemId)){
                TextView love=text("♥",19,0xFFFF6179,true);
                love.setPadding(dp(8),dp(2),dp(8),dp(2));
                love.setBackgroundDrawable(background(0xD90D0A10,14,0));
                android.widget.FrameLayout.LayoutParams badgeP=new android.widget.FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.RIGHT);
                badgeP.setMargins(dp(9),dp(9),dp(9),0);
                artwork.addView(love,badgeP);
            }
            String type=str(item,"_type");
            TextView label=text("youtube".equals(type)?"▶ مقطع":"channel".equals(type)?"● مباشر":"series".equals(type)?"▣ مسلسل":"▶ فيلم",11,
                    "channel".equals(type)?0xFFFF646C:0xFFFFC4C8,true);
            label.setPadding(dp(7),dp(5),dp(7),dp(2));card.addView(label);
            TextView name=text(str(item,"title_ar"),16,WHITE,true);name.setSingleLine(true);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);card.addView(name,gap(4,1));
            String sub=str(item,"release_year");
            if(sub.length()==0)sub=str(item,"quality");
            else if(str(item,"quality").length()>0)sub+="  •  "+str(item,"quality");
            if("youtube".equals(type)){
                sub=str(item,"channel_name");
                String lang=str(item,"language_code");
                if(lang.length()>0)sub+=(sub.length()>0?"  •  ":"")+languageLabel(lang);
            }
            TextView meta=text(sub.length()>0?sub:"العز TV",12,MUTED,false);card.addView(meta,gap(3,2));
            card.setOnFocusChangeListener(new View.OnFocusChangeListener(){
                public void onFocusChange(View view,boolean focused){
                    card.setBackgroundDrawable(background(focused?0xFF512139:0xFF1C141E,18,focused?0xFFFF617E:0xFF443140));
                    card.setScaleX(focused?1.065f:1f);card.setScaleY(focused?1.065f:1f);
                    if(Build.VERSION.SDK_INT>=21)card.setElevation(focused?dp(12):0);
                    // Focus border and scale remain compatible with Android 4.4 (API 19).
                }
            });
            card.setOnClickListener(new View.OnClickListener(){
                public void onClick(View v){
                    if("youtube".equals(str(item,"_type")))openYouTube(str(item,"youtube_url"),str(item,"title_ar"));
                    else{lastMode=mode;details(item);}
                }
            });
        }
    }
    private void details(final JSONObject item){
        if(!"episodes".equals(subPage))returnFocusTag=currentFocusTag();
        activeDetail=item;subPage="details";
        stage.removeAllViews();scrolling.scrollTo(0,0);
        Button back=button("← العودة إلى القائمة");
        back.setTag("btn:رجوع إلى القائمة");
        stage.addView(back,lp(dp(220),dp(49)));
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            mode=lastMode;pendingFocusTag=returnFocusTag;returnFocusTag="";render();
        }});
        android.widget.FrameLayout hero=new android.widget.FrameLayout(this);
        hero.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{0xFF361526,0xFF160E18,0xFF0D0A10}));
        LinearLayout.LayoutParams heroP=gap(16,12);
        heroP.height=dp(255);stage.addView(hero,heroP);
        String picture=str(item,"backdrop_url");
        if(picture.length()==0)picture=str(item,"poster_url");
        if(picture.length()>0 && !prefs.getBoolean("lite_mode",false)){
            ImageView image=new ImageView(this);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            hero.addView(image,new android.widget.FrameLayout.LayoutParams(-1,-1));
            PosterLoader.load(image,picture);
            View shade=new View(this);
            shade.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{0xF50B0910,0xC40B0910,0x240B0910}));
            hero.addView(shade,new android.widget.FrameLayout.LayoutParams(-1,-1));
        }
        LinearLayout heroText=vertical();heroText.setGravity(Gravity.CENTER_VERTICAL);
        heroText.setPadding(dp(26),dp(20),dp(26),dp(20));
        hero.addView(heroText,new android.widget.FrameLayout.LayoutParams(-1,-1));
        String t=str(item,"_type");
        TextView tag=text("✦  العز TV   /   "+("channel".equals(t)?"بث مباشر":"series".equals(t)?"مسلسل":"فيلم"),13,0xFFFFAAB8,true);
        heroText.addView(tag);
        TextView headline=text(str(item,"title_ar"),32,WHITE,true);headline.setMaxLines(2);
        heroText.addView(headline,gap(8,7));
        TextView summary=text(str(item,"release_year")+
            (str(item,"quality").length()>0?"    •    "+str(item,"quality"):"")+
            (str(item,"language_code").length()>0?"    •    "+languageLabel(str(item,"language_code")):""),
            14,0xFFDDD0DA,true);
        heroText.addView(summary,gap(1,5));
        String original=str(item,"title_original");
        if(original.length()>0&&!original.equals(str(item,"title_ar"))){
            TextView originalName=text(original,14,0xFFB9AAB8,false);
            heroText.addView(originalName,gap(2,0));
        }
        String description=str(item,"description");
        if(description.length()>0){
            title("القصة والمعلومات",null);
            TextView d=text(description,16,WHITE,false);d.setLineSpacing(dp(4),1.12f);
            stage.addView(d,gap(8,12));
        }
        LinearLayout actions=horizontal();stage.addView(actions,gap(12,16));
        String type=str(item,"_type");if(type.length()==0)type="movie";
        final String kind=type, id=str(item,"id");
        if(!"series".equals(kind)){
            Button watch=button("▶  ابدأ المشاهدة");
            watch.setBackgroundDrawable(background(0xFFBA1C3B,15,0xFFFF8EAD));
            actions.addView(watch,lp(dp(192),dp(56)));
            watch.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                play(item,null,null,null);
            }});
        }else{
            Button episodes=button("▤  عرض الحلقات");
            episodes.setBackgroundDrawable(background(0xFFBA1C3B,15,0xFFFF8EAD));
            actions.addView(episodes,lp(dp(192),dp(56)));
            episodes.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                loadEpisodes(item);
            }});
        }
        final Button favorite=button(isFavorite(kind,id)?"♥  إزالة من قائمتي":"♡  أضف إلى قائمتي");
        LinearLayout.LayoutParams fp=lp(dp(199),dp(56));fp.setMargins(dp(13),0,0,0);
        actions.addView(favorite,fp);
        favorite.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            toggleFavorite(kind,id);
            favorite.setText(isFavorite(kind,id)?"♥  إزالة من قائمتي":"♡  أضف إلى قائمتي");
        }});
        String holder=str(item,"rights_holder"),license=str(item,"license_reference");
        if(holder.length()>0||license.length()>0){
            TextView rights=text("حقوق العرض: "+(holder.length()>0?holder:"غير محدد")+
                (license.length()>0?"   •   مرجع الترخيص: "+license:""),12,MUTED,false);
            stage.addView(rights,gap(14,3));
        }
        focusWhenReady("btn:رجوع إلى القائمة");
    }
    private void play(JSONObject item,String nextUrl,String nextId,String nextTitle){
        // Official-channel entries are navigation only; they are not playable HLS streams.
        if("official_link".equals(str(item,"playback_mode")) &&
           str(item,"stream_url").length()==0){
            String official=str(item,"official_url");
            if(!official.startsWith("https://")){
                showStatus("رابط الناشر الرسمي غير متوفر");return;
            }
            try{
                startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(official)));
            }catch(android.content.ActivityNotFoundException error){
                showStatus("لم يتم العثور على متصفح متوافق لفتح موقع الناشر");
            }
            return;
        }
        String youtube=str(item,"youtube_url");
        String variants=item.optJSONArray("stream_variants")==null?
            "[]":item.optJSONArray("stream_variants").toString();
        boolean kids="kids".equals(mode);
        ArrayList<PlaybackSources.Source> available=PlaybackSources.collect(
            str(item,"stream_url"),str(item,"quality"),variants,youtube,kids);
        if(available.isEmpty()){showStatus("لا يوجد مصدر MP4/HLS أو Embed/YouTube معتمد");return;}
        PlaybackSources.Source selected=available.get(PlaybackSources.preferred(available));
        String url=selected.url;
        String encoded=PlaybackSources.encode(available);
        if("embed".equals(selected.kind)||"youtube".equals(selected.kind)){
            if(kids || !"approved".equals(str(item,"rights_status"))){
                showStatus("مشغل Embed/YouTube غير معتمد الحقوق");return;
            }
            if(available.size()==1 && "youtube".equals(selected.kind)){
                openYouTube(youtube,str(item,"title_ar"));return;
            }
            Intent embed=new Intent(this,EmbedPlayerActivity.class);
            embed.putExtra("stream_url",url);
            embed.putExtra("title",str(item,"title_ar"));
            embed.putExtra("available_sources",encoded);
            embed.putExtra("stream_variants",variants);
            embed.putExtra("item_id",str(item,"id"));
            startActivity(embed);
            return;
        }
        Intent i=new Intent(this,available.size()>1?CinemaPlayerActivity.class:PlayerActivity.class);
        i.putExtra("available_sources",encoded);
        i.putExtra("stream_url",url);
        i.putExtra("quality",available.size()>1?"default":str(item,"quality"));
        i.putExtra("stream_variants",variants);
        i.putExtra("is_live","channel".equals(str(item,"_type")));
        i.putExtra("title",str(item,"title_ar"));
        i.putExtra("item_id",str(item,"id"));if(nextUrl!=null)i.putExtra("next_url",nextUrl);
        if(nextId!=null)i.putExtra("next_item_id",nextId);
        if(nextTitle!=null)i.putExtra("next_title",nextTitle);
        startActivity(i);
    }
    private void loadEpisodes(final JSONObject seriesItem){
        activeSeries=seriesItem;subPage="episodes";
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
        final EditText input=new EditText(this);input.setTag("input:search");
        input.setTextSize(20);input.setTextColor(WHITE);input.setHintTextColor(MUTED);
        input.setHint("ابحث عن عنوان...");input.setSingleLine(true);
        input.setBackgroundDrawable(background(PANEL,10,0xFF54718A));
        input.setPadding(dp(18),dp(9),dp(18),dp(9));
        stage.addView(input,lp(-1,dp(55)));
        final Button submit=button("بحث");stage.addView(submit,gap(8,10));
        final int searchControlsCount=stage.getChildCount();
        submit.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            String query=input.getText().toString().trim().toLowerCase();
            // Hide keyboard while retaining search query and results.
            ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(),0);
            while(stage.getChildCount()>searchControlsCount)
                stage.removeViewAt(searchControlsCount);
            ArrayList<JSONObject> found=new ArrayList<JSONObject>();
            filter(found,movies,"movie",query);filter(found,series,"series",query);filter(found,channels,"channel",query);filter(found,youtubeVideos,"youtube",query);
            if(found.isEmpty())empty("لا توجد نتائج مطابقة.");else cardsGrid(found,AppConfig.MAX_ITEMS);
        }});
    }
    private void filter(ArrayList<JSONObject> found,JSONArray list,String type,String query){
        if(query.length()==0)return;
        for(int i=0;i<list.length();i++){
            JSONObject j=list.optJSONObject(i);
            if(j!=null&&(str(j,"title_ar").toLowerCase().contains(query)||str(j,"title_original").toLowerCase().contains(query)||str(j,"channel_name").toLowerCase().contains(query))){
                try{j.put("_type",type);}catch(Exception ignored){}found.add(j);
            }
        }
    }
    private String qualityLabel(String value){
        if("lowest".equals(value))return "أقل جودة";
        if("highest".equals(value))return "أعلى جودة";
        if("default".equals(value))return "الأصلية";
        return "تلقائي اقتصادي";
    }
    private void settings(){
        title("الإعدادات والتشخيص","قياسات فعلية من التلفزيون للمساعدة في تحديد مشكلات التوافق");
        title("جودة العرض","تؤثر في الأفلام والحلقات والقنوات إذا كانت مصادر متعددة متاحة.");
        final String[] qualities={"تلقائي اقتصادي (مناسب للشاشة)","أقل جودة متاحة","أعلى جودة متاحة","الجودة الأصلية"};
        final String[] qualityValues={"auto","lowest","highest","default"};
        final Button quality=button("الجودة الافتراضية: "+qualityLabel(prefs.getString("quality_pref","auto")));
        stage.addView(quality,lp(-1,dp(53)));
        quality.setOnClickListener(new View.OnClickListener(){public void onClick(View view){
            new android.app.AlertDialog.Builder(MainActivity.this).setTitle("اختيار الجودة الافتراضية")
              .setItems(qualities,new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface dialog,int index){
                    prefs.edit().putString("quality_pref",qualityValues[index]).apply();
                    quality.setText("الجودة الافتراضية: "+qualities[index]);
                }
              }).show();
        }});
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
        splashHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
    @Override public void onBackPressed(){
        if(splashVisible){finishSplash();return;}
        if(!unlocked){finish();return;}
        if("episodes".equals(subPage)&&activeSeries!=null){
            details(activeSeries);return;
        }
        if("details".equals(subPage)||"category".equals(subPage)){
            subPage="";pendingFocusTag=returnFocusTag;returnFocusTag="";
            mode=lastMode;render();return;
        }
        if("home".equals(mode))super.onBackPressed();
        else{listingPage=0;pendingFocusTag="nav:home";mode="home";render();}
    }
}
