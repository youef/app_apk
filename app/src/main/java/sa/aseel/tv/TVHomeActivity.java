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
    private static final int BG=0xFF090B11, PANEL=0xFF191B28, RED=0xFFEF3658;
    private static final int WHITE=0xFFF7F4F8, MUTED=0xFFA7A6B4, GOLD=0xFFE9BF7A;
    private static final String SETTINGS="alezz_tv_settings_v14";
    private final ExecutorService background=Executors.newFixedThreadPool(4);
    private final Handler ui=new Handler();
    private long lastEntitlementCheckAt=0L;
    private boolean checkingEntitlement=false;
    private final Runnable entitlementGuard=new Runnable(){public void run(){
        if(!unlocked||isFinishing())return;
        if(!MemberAuth.hasSession(TVHomeActivity.this) || MemberAuth.isExpiredLocally(TVHomeActivity.this)){
            MemberAuth.logoutLocal(TVHomeActivity.this);
            ui.removeCallbacks(this);
            showMemberLogin("انتهت صلاحية الحساب أو أُلغيت الجلسة. تواصل مع الإدارة.");
            return;
        }
        long now=android.os.SystemClock.elapsedRealtime();
        if(!checkingEntitlement && (lastEntitlementCheckAt==0L || now-lastEntitlementCheckAt>=90000L)){
            checkingEntitlement=true;
            lastEntitlementCheckAt=now;
            background.execute(new Runnable(){public void run(){
                try{
                    MemberAuth.validateAccount(TVHomeActivity.this);
                }catch(final MemberAuth.AuthenticationException denied){
                    ui.post(new Runnable(){public void run(){
                        if(unlocked&&!isFinishing()){
                            unlocked=false;
                            ui.removeCallbacks(entitlementGuard);
                            showMemberLogin(denied.getMessage());
                        }
                    }});
                }catch(Exception network){ /* Keep retrying; expired local deadline is checked each tick. */ }
                finally{ui.post(new Runnable(){public void run(){checkingEntitlement=false;}});}
            }});
        }
        ui.postDelayed(this,60000L);
    }};
    private final ArrayList<JSONObject> movies=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> series=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> episodeQueue=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> channels=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> localChannels=new ArrayList<JSONObject>();
    private int localPlaylistGeneration=0;
    private long lastLocalPlaylistRefreshAt=0L;
    private final ArrayList<JSONObject> youtubeVideos=new ArrayList<JSONObject>();
    private CatalogApi catalog;
    private ScrollView scroller;
    private LinearLayout content,navBar;
    private TextView status;
    private String section="home";
    private boolean detailVisible=false, showingWelcome=false;
    private String detailOrigin="home";
    private String pendingResumeEpisodeId="",activeChannelCategory="الكل";
    private int liveGuideLimit=48;
    private int kidsAge=6,kidsDailyMinutes=60;
    private String lastLoadError="";
    private boolean loading=false,unlocked=false;
    private static final long CATALOG_REFRESH_INTERVAL_MS=10L*60L*1000L;
    private long lastCatalogRefreshAt=0L;
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
        // Shared translucent glass material; Android KitKat uses gradients, not GPU blur.
        return GlassSurface.panel(color,border,dp(radius));
    }
    private TextView text(String label,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(label);t.setTextColor(color);t.setTextSize(size);
        t.setTextDirection(View.TEXT_DIRECTION_RTL);t.setGravity(Gravity.CENTER_VERTICAL);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;
    }
    private Button button(String name){
        final Button b=new Button(this);b.setText(name);b.setAllCaps(false);b.setTextColor(WHITE);
        b.setTextSize(15);b.setFocusable(true);b.setBackgroundDrawable(bg(0xFF252D3C,0x8B65748D,12));
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){public void onFocusChange(View v,boolean focused){
            b.setBackgroundDrawable(bg(focused?0xFF6A5132:0xFF252D3C,
                focused?0xFFE8C385:0x8B65748D,12));
            b.setScaleX(focused?1.04f:1f);b.setScaleY(focused?1.04f:1f);
        }});return b;
    }
    private String value(JSONObject item,String key){return item==null?"":item.optString(key,"");}

    /** Country reflects production metadata, not dubbed language or guessed origin. */
    private boolean isArabOrigin(String country){
        return ("SA EG AE KW BH QA OM YE IQ JO LB SY PS MA DZ TN LY SD SO MR DJ KM ")
            .contains(country.toUpperCase(Locale.US)+" ") && country.length()==2;
    }
    private boolean matchesCountry(JSONObject item,String code){
        String country=value(item,"country_code").toUpperCase(Locale.US);
        if("ARAB".equals(code))return isArabOrigin(country);
        if("FOREIGN".equals(code))return country.length()==2&&!isArabOrigin(country);
        return country.equals(code);
    }
    private boolean hasGenre(JSONObject item,String key){
        if(item==null)return false;
        for(String name:new String[]{"genre_tags","auto_tags"}){
            JSONArray list=item.optJSONArray(name);
            if(list==null)continue;
            for(int i=0;i<list.length();i++)if(key.equals(list.optString(i)))return true;
        }
        return false;
    }
    private ArrayList<JSONObject> originItems(ArrayList<JSONObject> list,String code){
        ArrayList<JSONObject> filtered=new ArrayList<JSONObject>();
        for(JSONObject item:list)if(matchesCountry(item,code))filtered.add(item);
        return filtered;
    }
    private ArrayList<JSONObject> genreItems(ArrayList<JSONObject> list,String key){
        ArrayList<JSONObject> filtered=new ArrayList<JSONObject>();
        for(JSONObject item:list)if(hasGenre(item,key))filtered.add(item);
        return filtered;
    }
    private void classifiedHomeShelves(){
        shelf("مسلسلات تركية","مباشرة من بيانات بلد الإنتاج",originItems(series,"TR"),18);
        shelf("مسلسلات أجنبية","أعمال عالمية متاحة",originItems(series,"FOREIGN"),18);
        shelf("مسلسلات كورية","دراما وإنتاج كوري",originItems(series,"KR"),18);
        shelf("مسلسلات عربية","دراما من الدول العربية",originItems(series,"ARAB"),18);
        shelf("أفلام تركية","السينما التركية",originItems(movies,"TR"),18);
        shelf("أفلام أجنبية","أعمال دولية",originItems(movies,"FOREIGN"),18);
        shelf("أفلام هندية","السينما الهندية",originItems(movies,"IN"),18);
        shelf("أفلام أمريكية","السينما الأمريكية",originItems(movies,"US"),18);
        classifiedGenreShelves(movies,"أفلام",12);
        classifiedGenreShelves(series,"مسلسلات",12);
    }
    private void classifiedGenreShelves(ArrayList<JSONObject> list,String label,int limit){
        String[][] genres={
            {"anime","أنمي"},{"animation","كرتون ورسوم متحركة"},
            {"documentary","وثائقي"},{"crime","جريمة"},{"war","حرب"},
            {"action","أكشن"},{"thriller","إثارة وتشويق"},
            {"drama","دراما"},{"comedy","كوميديا"},{"horror","رعب"},
            {"mystery","غموض"},{"romance","رومانسي"},
            {"history","تاريخي"},{"fantasy","فانتازيا"},
            {"scifi","خيال علمي"},{"kids","أطفال"}
        };
        for(String[] genre:genres){
            shelf(label+" "+genre[1],"مصنّف تلقائيًا أو من لوحة الإدارة",genreItems(list,genre[0]),limit);
        }
    }

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
            if(item!=null){
                if("channel".equals(type)){
                    String liveUrl=value(item,"stream_url");
                    if(!"stream".equals(value(item,"playback_mode")) ||
                       !"healthy".equals(value(item,"link_health_status")) ||
                       !liveUrl.matches("(?i)^https://[^\\s]+\\.(m3u8|mp4)(\\?[^\\s]*)?$"))continue;
                }
                mark(item,type);target.add(item);
            }
        }
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN);
        catalog=new CatalogApi(this);
        kidsAge=getSharedPreferences("alezz_kids",MODE_PRIVATE).getInt("age",6);
        kidsDailyMinutes=getSharedPreferences("alezz_kids",MODE_PRIVATE).getInt("minutes",60);
        PlaybackMemory.prune(this);
        showSplash();
    }
    /** Figma v14: public viewer has no PIN, credential or activation gate. */
    private void showSplash(){
        showingWelcome=true;
        LinearLayout splash=column();
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundDrawable(new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[]{0xFF0A0D15,0xFF271422,0xFF090B11}));
        setContentView(splash);
        ImageView icon=new ImageView(this);
        int mark=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(mark!=0)icon.setImageResource(mark);
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        splash.addView(icon,new LinearLayout.LayoutParams(dp(145),dp(145)));
        TextView brand=text("العز TV",42,WHITE,true);brand.setGravity(Gravity.CENTER);
        splash.addView(brand,space(dp(380),dp(84),7));
        TextView note=text("عالمك السينمائي يبدأ هنا",18,MUTED,false);note.setGravity(Gravity.CENTER);
        splash.addView(note);
        ui.postDelayed(new Runnable(){public void run(){
            if(!isFinishing()&&showingWelcome&&!unlocked)showWelcome();
        }},1100L);
    }
    /** Login once; on later launches refresh the persisted session transparently. */
    private void showWelcome(){
        if(MemberAuth.hasSession(this))restoreMember();
        else showMemberLogin("");
    }
    private void restoreMember(){
        showingWelcome=true;
        final LinearLayout panel=column();
        panel.setGravity(Gravity.CENTER);
        panel.setBackgroundDrawable(new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,new int[]{0xFF0B0E18,0xFF302331,0xFF090B11}));
        setContentView(panel);
        TextView message=text("◌  التحقق من الجلسة المحفوظة...",22,WHITE,true);
        message.setGravity(Gravity.CENTER);
        panel.addView(message,space(-1,dp(72),8));
        background.execute(new Runnable(){public void run(){
            try{
                MemberAuth.resume(TVHomeActivity.this);
                ui.post(new Runnable(){public void run(){
                    if(isFinishing())return;
                    startViewer();
                }});
            }catch(final Exception error){
                ui.post(new Runnable(){public void run(){
                    if(isFinishing())return;
                    showMemberLogin(error instanceof MemberAuth.AuthenticationException?
                        error.getMessage():MemberAuth.hasSession(TVHomeActivity.this)?
                        "تعذر التحقق من الجلسة. تأكد من الاتصال ثم اضغط إعادة المحاولة.":
                        "انتهت الجلسة أو توقف الحساب. يرجى تسجيل الدخول.");
                }});
            }
        }});
    }
    private void showMemberLogin(String notice){
        if(notice!=null && (notice.contains("انتهت صلاحية") || notice.contains("صلاحية حسابك")))
        {showExpiredScreen();return;}
        showingWelcome=true;unlocked=false;
        final LinearLayout panel=column();
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(32),dp(15),dp(32),dp(15));
        panel.setBackgroundDrawable(new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,new int[]{0xFF0B0E18,0xFF302331,0xFF090B11}));
        setContentView(panel);
        ImageView logo=new ImageView(this);
        int resource=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(resource!=0)logo.setImageResource(resource);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        panel.addView(logo,space(dp(116),dp(110),3));
        TextView title=text("دخول العز TV",30,WHITE,true);
        title.setGravity(Gravity.CENTER);
        panel.addView(title,space(-1,dp(56),2));
        TextView sub=text("اسم المستخدم وكلمة المرور مرة واحدة، ثم يبدأ التطبيق بحسابك تلقائيًا.",15,MUTED,false);
        sub.setGravity(Gravity.CENTER);
        panel.addView(sub,space(-1,dp(42),3));
        final EditText username=new EditText(this),password=new EditText(this);
        for(EditText input:new EditText[]{username,password}){
            input.setSingleLine(true);input.setTextColor(WHITE);input.setHintTextColor(MUTED);
            input.setTextSize(18);input.setPadding(dp(17),dp(3),dp(17),dp(3));
            input.setBackgroundDrawable(bg(PANEL,0xFF7B6041,10));
            panel.addView(input,space(dp(430),dp(57),5));
        }
        username.setHint("اسم المستخدم");username.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        username.setText(getSharedPreferences(SETTINGS,MODE_PRIVATE).getString("last_username",""));
        password.setHint("كلمة المرور");
        password.setInputType(android.text.InputType.TYPE_CLASS_TEXT|
            android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        final TextView feedback=text(notice,13,0xFFE9BF7A,false);
        feedback.setGravity(Gravity.CENTER);
        panel.addView(feedback,space(-1,dp(43),3));
        final Button signIn=button("دخول حسابي  ❯");
        panel.addView(signIn,space(dp(300),dp(62),7));
        signIn.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            final String name=username.getText().toString().trim();
            final char[] secret=password.getText().toString().toCharArray();
            password.setText("");
            if(name.length()<3||secret.length==0){
                java.util.Arrays.fill(secret,'\0');
                feedback.setText("أدخل اسم المستخدم وكلمة المرور.");return;
            }
            signIn.setEnabled(false);feedback.setText("جارٍ التحقق من الحساب...");
            background.execute(new Runnable(){public void run(){
                try{
                    MemberAuth.login(TVHomeActivity.this,name,secret);
                    getSharedPreferences(SETTINGS,MODE_PRIVATE).edit().putString("last_username",name).apply();
                    ui.post(new Runnable(){public void run(){
                        if(isFinishing())return;
                        PlaybackMemory.prune(TVHomeActivity.this);
                        startViewer();
                    }});
                }catch(final Exception error){
                    ui.post(new Runnable(){public void run(){
                        if(isFinishing())return;
                        if(error instanceof MemberAuth.AuthenticationException &&
                           error.getMessage()!=null && error.getMessage().contains("انتهت صلاحية")){
                            showExpiredScreen();
                            return;
                        }
                        feedback.setText(error instanceof MemberAuth.AuthenticationException?
                            error.getMessage():"تعذر الاتصال. تحقق من الإنترنت ثم حاول مجددًا.");
                        signIn.setEnabled(true);
                    }});
                }finally{java.util.Arrays.fill(secret,'\0');}
            }});
        }});
        if(MemberAuth.hasSession(this)){
            Button retry=button("↻ إعادة محاولة استعادة الجلسة");
            panel.addView(retry,space(dp(330),dp(55),4));
            retry.setOnClickListener(new View.OnClickListener(){public void onClick(View v){restoreMember();}});
        }
        username.requestFocus();
    }
    /** Explicit, remote-friendly subscription expiration screen (Android API 19+). */
    private void showExpiredScreen(){
        unlocked=false;showingWelcome=true;
        final LinearLayout panel=column();
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(38),dp(16),dp(38),dp(16));
        panel.setBackgroundDrawable(new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,new int[]{0xFF100F18,0xFF38232A,0xFF0D111B}));
        setContentView(panel);
        TextView icon=text("⌛",58,GOLD,true);
        icon.setGravity(Gravity.CENTER);
        panel.addView(icon,space(dp(135),dp(91),4));
        TextView title=text("انتهت صلاحية اشتراكك",34,WHITE,true);
        title.setGravity(Gravity.CENTER);
        panel.addView(title,space(-1,dp(63),6));
        TextView note=text("توقف حساب المشاهدة تلقائيًا عند موعد الانتهاء.\n"+
            "المفضلة وسجل المشاهدة محفوظان حتى تجدد الاشتراك من الإدارة.",18,MUTED,false);
        note.setGravity(Gravity.CENTER);
        panel.addView(note,space(-1,dp(104),9));
        Button renew=button("↻  تسجيل الدخول بعد تجديد الاشتراك");
        panel.addView(renew,space(dp(420),dp(68),8));
        renew.setOnClickListener(new View.OnClickListener(){public void onClick(View view){
            showMemberLogin("");
        }});
        TextView foot=text("باقة 90 يومًا • تواصل مع مسؤول الاشتراكات لتجديد حسابك",14,GOLD,false);
        foot.setGravity(Gravity.CENTER);
        panel.addView(foot,space(-1,dp(50),5));
        renew.requestFocus();
    }
    private void startViewer(){
        if(!MemberAuth.hasSession(this)){
            showMemberLogin("يرجى تسجيل الدخول بحساب عميل مفعل.");return;
        }
        unlocked=true;showingWelcome=false;
        section="home";buildShell();render();loadCatalog();
        lastEntitlementCheckAt=0L;
        ui.removeCallbacks(entitlementGuard);
        ui.postDelayed(entitlementGuard,1800L);
        MemberSync.begin(this);
        if(!getSharedPreferences(SETTINGS,MODE_PRIVATE).getString("iptv_m3u","").isEmpty())
            refreshLocalPlaylist(false);
    }
    private void buildShell(){
        LinearLayout root=column();
        root.setBackgroundDrawable(GlassSurface.canvas());
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        setContentView(root);
        LinearLayout top=row();top.setPadding(dp(16),dp(6),dp(16),dp(6));
        top.setBackgroundDrawable(GlassSurface.overlay(0x82DCC8A9,dp(0)));
        root.addView(top,new LinearLayout.LayoutParams(-1,dp(79)));
        ImageView logo=new ImageView(this);
        int logoId=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(logoId!=0)logo.setImageResource(logoId);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        top.addView(logo,new LinearLayout.LayoutParams(dp(76),dp(67)));
        LinearLayout branding=column();
        branding.addView(text("العز TV",25,WHITE,true));
        branding.addView(text("عالمك السينمائي",12,GOLD,false));
        top.addView(branding,space(dp(175),-2,2));
        top.addView(new View(this),new LinearLayout.LayoutParams(0,1,1));
        int remaining=MemberAuth.daysRemaining(this);
        status=text(remaining>=0 && remaining<=7?"⚠ تبقى "+remaining+" يومًا على انتهاء اشتراكك":"● متصل",12,
            remaining>=0&&remaining<=7?GOLD:MUTED,false);
        status.setSingleLine(true);status.setEllipsize(TextUtils.TruncateAt.END);
        top.addView(status,space(dp(170),-2,3));
        Button search=button("⌕  بحث");
        top.addView(search,space(dp(102),dp(49),2));
        search.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            section="search";render();
        }});
        Button refresh=button("↻  تحديث");
        top.addView(refresh,space(dp(108),dp(49),2));
        refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadCatalog();}});
        navBar=row();navBar.setPadding(dp(15),dp(3),dp(15),dp(3));
        navBar.setBackgroundDrawable(GlassSurface.overlay(0x55C7D8F3,0));
        root.addView(navBar,new LinearLayout.LayoutParams(-1,dp(57)));
        scroller=new ScrollView(this);scroller.setFillViewport(true);scroller.setVerticalScrollBarEnabled(false);
        root.addView(scroller,new LinearLayout.LayoutParams(-1,0,1));
        content=column();content.setPadding(dp(19),dp(12),dp(19),dp(19));
        scroller.addView(content,new ScrollView.LayoutParams(-1,-2));
        updateNav();
    }
    private String sectionName(String s){
        if("movies".equals(s))return "الأفلام";
        if("series".equals(s))return "المسلسلات";
        if("live".equals(s))return "البث المباشر";
        if("kids".equals(s))return "عالم الأطفال";
        if("favorites".equals(s))return "قائمتي";
        if("settings".equals(s))return "الإعدادات";
        if("search".equals(s))return "البحث";
        if("youtube".equals(s))return "يوتيوب الأطفال";
        return "اختر عالمك";
    }
    private void goTo(String target){
        episodeGeneration++;detailVisible=false;section=target;
        render();if(scroller!=null)scroller.scrollTo(0,0);
    }
    private void updateNav(){
        if(navBar==null)return;
        navBar.removeAllViews();
        navBar.setVisibility("home".equals(section)?View.GONE:View.VISIBLE);
        if("home".equals(section))return;
        Button back=button("⌂  القائمة الرئيسية");
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo("home");}});
        navBar.addView(back,space(dp(210),dp(48),2));
        TextView breadcrumb=text("العز TV   /   "+sectionName(section),19,GOLD,true);
        navBar.addView(breadcrumb,new LinearLayout.LayoutParams(0,-1,1));
        Button next=button("التنقل بين الأقسام");
        next.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo("home");}});
        navBar.addView(next,space(dp(218),dp(48),2));
    }
    private int screenWidthDp(){
        return Math.round(getResources().getDisplayMetrics().widthPixels/
            getResources().getDisplayMetrics().density);
    }
    private int screenHeightDp(){
        return Math.round(getResources().getDisplayMetrics().heightPixels/
            getResources().getDisplayMetrics().density);
    }
    private LinearLayout dashboardTile(final String label,final String subtitle,
            final String glyph,final String target,final int baseColor){
        final LinearLayout tile=column();tile.setPadding(dp(19),dp(13),dp(19),dp(12));
        tile.setFocusable(true);tile.setClickable(true);
        tile.setBackgroundDrawable(bg(baseColor,0x7BCCD7E7,19));
        TextView symbol=text(glyph,37,WHITE,true);symbol.setGravity(Gravity.RIGHT);
        tile.addView(symbol,new LinearLayout.LayoutParams(-1,0,1));
        TextView name=text(label,27,WHITE,true);name.setGravity(Gravity.RIGHT);
        tile.addView(name,space(-1,-2,2));
        TextView caption=text(subtitle,14,0xFFCFCCD7,false);caption.setGravity(Gravity.RIGHT);
        tile.addView(caption,space(-1,-2,0));
        tile.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                tile.setBackgroundDrawable(bg(focused?0xFF665035:baseColor,
                    focused?0xFFE8C385:0x7BCCD7E7,19));
                tile.setScaleX(focused?1.035f:1f);
                tile.setScaleY(focused?1.035f:1f);
                if(android.os.Build.VERSION.SDK_INT>=21)tile.setElevation(focused?dp(8):0f);
            }
        });
        tile.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo(target);}});
        return tile;
    }
    private void portal(){
        LinearLayout banner=column();
        banner.setPadding(dp(22),dp(13),dp(22),dp(9));
        content.addView(banner,space(-1,dp(91),3));
        banner.addView(text("اختر عالمك",34,WHITE,true));
        banner.addView(text("كل الترفيه في مكان واحد  •  تحكم كامل بالريموت",16,MUTED,false));
        final String[][] data={
            {"المسلسلات","المواسم والحلقات","▣","series"},
            {"الأفلام","اكتشف مكتبة السينما","▤","movies"},
            {"البث المباشر","شاهد قنواتك المفضلة","◉","live"},
            {"الأطفال","محتوى مناسب للصغار","☻","kids"},
            {"قائمتي","المفضلة وتابع المشاهدة","♥","favorites"},
            {"الإعدادات","خصص تجربتك","⚙","settings"}
        };
        int[] colors={0xFF482A3F,0xFF503724,0xFF223D4C,0xFF225044,0xFF352A48,0xFF2C3047};
        int columns=screenWidthDp()>=620?3:2;
        int cellHeight=Math.max(130,Math.min(190,(screenHeightDp()-205)/2));
        for(int j=0;j<6;j+=columns){
            LinearLayout line=row();line.setGravity(Gravity.CENTER);
            for(int k=j;k<Math.min(6,j+columns);k++){
                LinearLayout tile=dashboardTile(data[k][0],data[k][1],data[k][2],data[k][3],colors[k]);
                LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,dp(cellHeight),1);
                lp.setMargins(dp(7),dp(7),dp(7),dp(7));
                line.addView(tile,lp);
                if(j==0&&k==0){
                    final View primaryTile=tile;
                    ui.post(new Runnable(){public void run(){
                        if(unlocked&&"home".equals(section))primaryTile.requestFocus();
                    }});
                }
            }
            content.addView(line,space(-1,-2,1));
        }
        TextView guide=text("الأسهم للتنقل     •     OK اختيار     •     رجوع للخروج",13,MUTED,false);
        guide.setGravity(Gravity.CENTER);content.addView(guide,space(-1,dp(39),5));
    }

    /**
     * Device-local playlists are not written to Supabase or published for other viewers.
     * Failed updates keep the last in-memory channel set and never mark links as verified.
     */
    private void refreshLocalPlaylist(final boolean interactive){
        final SharedPreferences preferences=getSharedPreferences(SETTINGS,MODE_PRIVATE);
        final String playlist=preferences.getString("iptv_m3u","").trim();
        final String epg=preferences.getString("iptv_xmltv","").trim();
        final int token=++localPlaylistGeneration;
        if(playlist.isEmpty())return;
        lastLocalPlaylistRefreshAt=android.os.SystemClock.elapsedRealtime();
        if(interactive&&status!=null)status.setText("◌ استيراد قائمة M3U وبيانات دليل البرامج...");
        background.execute(new Runnable(){public void run(){
            ArrayList<JSONObject> fetched=null;
            String error="";
            try {
                fetched=IPTVPlaylist.load(TVHomeActivity.this,playlist);
                if(!epg.isEmpty())XmltvGuide.apply(TVHomeActivity.this,epg,fetched);
            }catch(Exception exception){error=CatalogApi.describe(exception);}
            final ArrayList<JSONObject> result=fetched;
            final String failure=error;
            ui.post(new Runnable(){public void run(){
                if(isFinishing()||!unlocked||token!=localPlaylistGeneration)return;
                if(result!=null){
                    localChannels.clear();localChannels.addAll(result);
                    for(int i=channels.size()-1;i>=0;i--)
                        if(channels.get(i).optBoolean("_local_iptv",false))channels.remove(i);
                    channels.addAll(localChannels);
                    if(status!=null)status.setText("● أضيفت "+result.size()+" قناة محلية (الروابط تُفحص عند التشغيل)");
                    if("live".equals(section)||"settings".equals(section))render();
                }else if(status!=null){
                    status.setText("⚠ تعذّر تحميل القائمة: "+failure);
                }
            }});
        }});
    }
    private void clearLocalPlaylist(){
        ++localPlaylistGeneration;
        getSharedPreferences(SETTINGS,MODE_PRIVATE).edit()
            .remove("iptv_m3u").remove("iptv_xmltv").apply();
        localChannels.clear();
        for(int i=channels.size()-1;i>=0;i--)
            if(channels.get(i).optBoolean("_local_iptv",false))channels.remove(i);
        if(status!=null)status.setText("تم حذف بيانات القائمة المحلية فقط");
        render();
    }
    private void loadCatalog(){
        if(loading || !unlocked)return;
        lastCatalogRefreshAt=android.os.SystemClock.elapsedRealtime();
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
            try{data=catalog.listQuery("aseel_channels","?select=*&status=eq.published&rights_status=eq.approved&playback_mode=eq.stream&link_health_status=eq.healthy&order=display_order.asc,created_at.desc&limit=500");}
            catch(Exception e){error="قنوات: "+CatalogApi.describe(e);}
            final JSONArray rows=data;final String issue=error;
            ui.post(new Runnable(){public void run(){if(token!=generation||!unlocked)return;
                if(rows!=null){putAll(channels,rows,"channel");channels.addAll(localChannels);}
                completeCatalog(token,issue);
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
        if(!detailVisible && !loading)render();
    }
    private void heading(String title,String note){
        TextView h=text(title,23,WHITE,true);content.addView(h,space(-1,-2,5));
        if(note!=null && note.length()>0)content.addView(text(note,13,MUTED,false),space(-1,-2,2));
    }
    private void render(){
        if(content==null)return;
        if(detailVisible)episodeGeneration++;
        detailVisible=false;
        updateNav();
        content.removeAllViews();
        if("home".equals(section)){
            portal();
        }else if("movies".equals(section)){
            heading("الأفلام بحسب التصنيف","تظهر قوائم الأعمال المتوفرة تلقائيًا، مع إمكانية التنقل بالريموت.");
            shelf("أفلام تركية","بلد الإنتاج: تركيا",originItems(movies,"TR"),30);
            shelf("أفلام أجنبية","بلد إنتاج غير عربي",originItems(movies,"FOREIGN"),30);
            shelf("أفلام عربية","بلد إنتاج عربي",originItems(movies,"ARAB"),30);
            classifiedGenreShelves(movies,"أفلام",20);
            grid("كل الأفلام",movies);
        }
        else if("series".equals(section)){
            showContinueWatching(true);
            heading("المسلسلات بحسب التصنيف","تُحدّث التصنيفات تلقائيًا عند إضافة حلقات ومسلسلات.");
            shelf("مسلسلات تركية","بلد الإنتاج: تركيا",originItems(series,"TR"),30);
            shelf("مسلسلات أجنبية","بلد إنتاج غير عربي",originItems(series,"FOREIGN"),30);
            shelf("مسلسلات عربية","بلد إنتاج عربي",originItems(series,"ARAB"),30);
            classifiedGenreShelves(series,"مسلسلات",20);
            grid("كل المسلسلات",series);
        }
        else if("live".equals(section))liveGuide();
        else if("youtube".equals(section))grid("مقاطع يوتيوب للأطفال",youtubeVideos);
        else if("kids".equals(section)){
            heading("عالم الأطفال المستقل","قنوات وأفلام بروابط MP4/HLS مباشرة، بدون مشغل يوتيوب.");
            LinearLayout ages=row();content.addView(ages,space(-1,-2,7));
            for(final int age:new int[]{3,6,9,12}){
                Button b=button((kidsAge==age?"✓ ":"")+"عمر "+age);
                ages.addView(b,space(dp(135),dp(54),3));
                b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                    kidsAge=age;getSharedPreferences("alezz_kids",MODE_PRIVATE).edit().putInt("age",age).apply();render();
                }});
            }
            LinearLayout times=row();content.addView(times,space(-1,-2,7));
            for(final int minutes:new int[]{30,60,90,120}){
                Button b=button((kidsDailyMinutes==minutes?"✓ ":"")+minutes+" دقيقة يوميًا");
                times.addView(b,space(dp(165),dp(54),3));
                b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                    kidsDailyMinutes=minutes;getSharedPreferences("alezz_kids",MODE_PRIVATE).edit().putInt("minutes",minutes).apply();render();
                }});
            }
            ArrayList<JSONObject> kids=new ArrayList<JSONObject>();
            for(JSONObject x:movies)if(kidsDirect(x))kids.add(x);
            for(JSONObject x:series)if(x.optBoolean("is_kids",false) &&
                "approved".equals(value(x,"rights_status")) && kidsAgeAllowed(value(x,"age_rating")))kids.add(x);
            for(JSONObject x:channels)if(kidsDirect(x))kids.add(x);
            grid("محتوى أطفال ملائم للشاشة",kids);
        }else if("favorites".equals(section)){
            showContinueWatching(false);
            ArrayList<JSONObject> list=new ArrayList<JSONObject>();
            for(JSONObject x:movies)if(isFavorite(x))list.add(x);
            for(JSONObject x:series)if(isFavorite(x))list.add(x);
            for(JSONObject x:channels)if(isFavorite(x))list.add(x);
            for(JSONObject x:youtubeVideos)if(isFavorite(x))list.add(x);
            grid("قائمتي",list);
        }else if("search".equals(section))searchScreen();
        else if("settings".equals(section))settingsScreen();
        if(!"home".equals(section)&&!"settings".equals(section)&&movies.size()+series.size()+channels.size()+youtubeVideos.size()==0){
            heading(loading?"جاري تحميل المكتبة...":"المكتبة لم تُحمّل",
                loading?"اتصل بالإنترنت، ستظهر البطاقات تلقائيًا.":"اضغط تحديث. "+lastLoadError);
            Button refresh=button("إعادة المحاولة");content.addView(refresh,space(dp(240),dp(60),4));
            refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadCatalog();}});
            refresh.requestFocus();
        }
    }
    private void settingsScreen(){
        heading("الإعدادات","تخصيص تجربة العز TV • التفضيلات محفوظة على هذا الجهاز فقط");
        heading("حساب المشاهدة","مسجل الدخول: "+MemberAuth.username(this));
        final int daysLeft=MemberAuth.daysRemaining(this);
        heading("اشتراكي",daysLeft<0?"الصلاحية الحالية يحددها المسؤول":daysLeft==0?
            "انتهت الصلاحية، جدّد اشتراكك":daysLeft<=7?
            "⚠ تنبيه: متبقي "+daysLeft+" يومًا فقط":"متبقي "+daysLeft+" يومًا على انتهاء الباقة");
        Button logout=button("↪ تسجيل الخروج من الحساب");
        content.addView(logout,space(-1,dp(58),6));
        logout.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            unlocked=false;showingWelcome=true;
            background.execute(new Runnable(){public void run(){
                MemberAuth.logout(TVHomeActivity.this);
                ui.post(new Runnable(){public void run(){
                    if(!isFinishing())showMemberLogin("تم تسجيل الخروج من الحساب.");
                }});
            }});
        }});
        final SharedPreferences prefs=getSharedPreferences(SETTINGS,MODE_PRIVATE);
        final String active=PlaybackMemory.activeProfile(this);
        heading("ملفات المشاهدة","ملفات مستقلة للعائلة والأطفال والضيف داخل حسابك");
        LinearLayout profiles=row();content.addView(profiles,space(-1,-2,4));
        for(final String profile:new String[]{"family","kids","guest"}){
            Button choice=button((active.equals(profile)?"✓ ":"")+PlaybackMemory.profileName(profile));
            profiles.addView(choice,new LinearLayout.LayoutParams(0,dp(55),1));
            choice.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                PlaybackMemory.setProfile(TVHomeActivity.this,profile);render();
            }});
        }
        final boolean autoNext=prefs.getBoolean("auto_next",true);
        Button next=button((autoNext?"✓  ":"")+"تشغيل الحلقة التالية تلقائيًا");
        content.addView(next,space(-1,dp(62),6));
        next.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            prefs.edit().putBoolean("auto_next",!prefs.getBoolean("auto_next",true)).apply();
            render();
        }});
        final boolean autoRefresh=prefs.getBoolean("auto_refresh",true);
        Button sync=button((autoRefresh?"✓  ":"")+"تحديث المكتبة تلقائيًا بعد العودة للتطبيق");
        content.addView(sync,space(-1,dp(62),6));
        sync.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            prefs.edit().putBoolean("auto_refresh",!prefs.getBoolean("auto_refresh",true)).apply();
            render();
        }});
        heading("عالم الأطفال","تعديل العمر المسموح ووقت المشاهدة اليومي");
        Button kids=button("♧  إعدادات الأطفال  •  "+kidsAge+" سنوات  /  "+kidsDailyMinutes+" دقيقة");
        content.addView(kids,space(-1,dp(62),6));
        kids.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo("kids");}});

        heading("قنوات IPTV من جهازك","استيراد M3U ودليل XMLTV بشكل محلي فقط؛ لا تُنشر المصادر للآخرين.");
        final EditText playlistUrl=new EditText(this);
        playlistUrl.setSingleLine(true);playlistUrl.setTextSize(16);playlistUrl.setTextColor(WHITE);
        playlistUrl.setHintTextColor(MUTED);playlistUrl.setHint("رابط قائمة M3U بصيغة HTTPS");
        playlistUrl.setText(prefs.getString("iptv_m3u",""));
        playlistUrl.setBackgroundDrawable(bg(PANEL,RED,12));
        content.addView(playlistUrl,space(-1,dp(59),4));
        final EditText epgUrl=new EditText(this);
        epgUrl.setSingleLine(true);epgUrl.setTextSize(16);epgUrl.setTextColor(WHITE);
        epgUrl.setHintTextColor(MUTED);epgUrl.setHint("رابط XMLTV اختياري (HTTPS)");
        epgUrl.setText(prefs.getString("iptv_xmltv",""));
        epgUrl.setBackgroundDrawable(bg(PANEL,0xFF453744,12));
        content.addView(epgUrl,space(-1,dp(59),4));
        Button importButton=button("↓ استيراد القنوات وتحديث دليل البرامج");
        content.addView(importButton,space(-1,dp(59),4));
        importButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            String m3u=playlistUrl.getText().toString().trim();
            String xml=epgUrl.getText().toString().trim();
            if(!m3u.startsWith("https://")||m3u.length()>2048||
               (!xml.isEmpty()&&(!xml.startsWith("https://")||xml.length()>2048))){
                status.setText("يرجى إدخال روابط HTTPS صحيحة؛ دليل XMLTV اختياري.");return;
            }
            prefs.edit().putString("iptv_m3u",m3u).putString("iptv_xmltv",xml).apply();
            ((InputMethodManager)getSystemService(Context.INPUT_METHOD_SERVICE))
                .hideSoftInputFromWindow(playlistUrl.getWindowToken(),0);
            refreshLocalPlaylist(true);
        }});
        Button clearImport=button("✕ حذف قائمة IPTV المحلية");
        content.addView(clearImport,space(-1,dp(55),6));
        clearImport.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            clearLocalPlaylist();
        }});
        content.addView(text("المصادر المستوردة غير مفحوصة حتى بدء تشغيلها. استخدم فقط القنوات المصرّح لك بمشاهدتها.",
            12,MUTED,false),space(-1,-2,8));
        heading("المكتبة والمشغل","تعتمد الجودة والتوافق على اتصال الإنترنت وإمكانات الجهاز");
        Button reload=button("↻  تحديث جميع أقسام المكتبة");
        content.addView(reload,space(-1,dp(58),6));
        reload.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            loadCatalog();refreshLocalPlaylist(true);
        }});
        Button youtube=button("▶  مكتبة فيديوهات يوتيوب المعتمدة");
        content.addView(youtube,space(-1,dp(58),6));
        youtube.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo("youtube");}});
        TextView data=text("Android "+android.os.Build.VERSION.RELEASE+
            "  •  API "+android.os.Build.VERSION.SDK_INT+
            "  •  المحتوى من Supabase  •  حساب "+MemberAuth.username(this),14,MUTED,false);
        content.addView(data,space(-1,dp(51),8));
        next.requestFocus();
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

    private JSONObject findCatalogItem(String id,boolean isSeries){
        if(id==null||id.isEmpty())return null;
        for(JSONObject x:isSeries?series:movies)if(id.equals(value(x,"id")))return x;
        return null;
    }
    private void showContinueWatching(boolean episodesOnly){
        final String profile=PlaybackMemory.activeProfile(this);
        ArrayList<JSONObject> recent=PlaybackMemory.recent(this,profile);
        HashSet<String> shows=new HashSet<String>();
        ArrayList<JSONObject> entries=new ArrayList<JSONObject>();
        for(JSONObject progress:recent){
            String id=progress.optString("id"),seriesId=progress.optString("series_id");
            boolean episode="episode".equals(progress.optString("kind"));
            if(episodesOnly&&!episode)continue;
            if(episode){
                if(seriesId.isEmpty()||!shows.add(seriesId)||findCatalogItem(seriesId,true)==null)continue;
            }else if(findCatalogItem(id,false)==null)continue;
            entries.add(progress);if(entries.size()>=7)break;
        }
        if(entries.isEmpty())return;
        heading("▶ أكمل المشاهدة","ملف "+PlaybackMemory.profileName(profile)+" • الحلقة والدقيقة محفوظتان");
        for(final JSONObject progress:entries){
            final String id=progress.optString("id"),seriesId=progress.optString("series_id");
            final boolean episode="episode".equals(progress.optString("kind"));
            LinearLayout line=row();line.setBackgroundDrawable(bg(PANEL,0xFF373341,12));
            content.addView(line,space(-1,dp(69),3));
            long seconds=progress.optLong("position",0)/1000;
            Button resume=button("▶ "+progress.optString("title","متابعة")+
                "  •  "+(seconds/60)+":"+String.format(Locale.US,"%02d",seconds%60));
            line.addView(resume,new LinearLayout.LayoutParams(0,dp(57),1));
            resume.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                if(episode){
                    JSONObject show=findCatalogItem(seriesId,true);
                    if(show!=null){pendingResumeEpisodeId=id;episodes(show);}
                }else{
                    JSONObject movie=findCatalogItem(id,false);
                    if(movie!=null)play(movie);
                }
            }});
            Button remove=button("✕ حذف السجل");
            line.addView(remove,space(dp(155),dp(57),3));
            remove.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                PlaybackMemory.remove(TVHomeActivity.this,profile,id);render();
            }});
        }
    }
    private String channelCategory(JSONObject x){return ChannelGuideCategory.from(x);}
    private String epgNow(JSONObject x){
        String s=value(x,"epg_now_title");
        if(s.isEmpty())s=value(x,"current_program");
        if(s.isEmpty())s=value(x,"now_title");
        return s;
    }
    private String epgNext(JSONObject x){
        String s=value(x,"epg_next_title");
        if(s.isEmpty())s=value(x,"next_program");
        if(s.isEmpty())s=value(x,"next_title");
        return s;
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
        activeChannelCategory=getSharedPreferences("alezz_tv_settings_v14",MODE_PRIVATE)
            .getString("live_selected_group",activeChannelCategory);
        heading("● تلفزيون العز المباشر",channels.size()+" قناة • اختر التصنيف، ثم اضغط OK للمشاهدة • MENU للدليل أثناء البث");
        if(channels.isEmpty()){
            heading("لا توجد قنوات منشورة","استخدم تحديث المكتبة أو راجع المصادر.");return;
        }
        String last=PlaybackMemory.lastChannel(this,PlaybackMemory.activeProfile(this));
        for(JSONObject channel:channels)if(last.equals(value(channel,"id"))){
            final JSONObject recent=channel;
            Button resume=button("▶ آخر قناة: "+label(channel));
            content.addView(resume,space(-1,dp(60),4));
            resume.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(recent);}});
            break;
        }
        java.util.LinkedHashMap<String,Integer> counts=new java.util.LinkedHashMap<String,Integer>();
        for(String group:new String[]{"أخبار","رياضة","أفلام","مسلسلات","أطفال",
                "وثائقيات","دينية","موسيقى","تعليمية","طبخ","منوعات","عامة"})
            counts.put(group,0);
        int favoriteCount=0;
        for(JSONObject x:channels){
            String group=channelCategory(x);
            counts.put(group,counts.containsKey(group)?counts.get(group)+1:1);
            if(isFavorite(x))favoriteCount++;
        }
        java.util.LinkedHashSet<String> types=new java.util.LinkedHashSet<String>();
        types.add("الكل");
        if(favoriteCount>0)types.add("المفضلة");
        for(java.util.Map.Entry<String,Integer> entry:counts.entrySet())
            if(entry.getValue()>0)types.add(entry.getKey());
        if(!types.contains(activeChannelCategory))activeChannelCategory="الكل";
        HorizontalScrollView scroll=new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        content.addView(scroll,space(-1,dp(60),3));
        LinearLayout filters=row();scroll.addView(filters);
        for(final String type:types){
            int count="الكل".equals(type)?channels.size():
                "المفضلة".equals(type)?favoriteCount:counts.get(type);
            Button b=button((type.equals(activeChannelCategory)?"✓ ":"")+type+"  "+count);
            b.setContentDescription("تصنيف "+type+"، "+count+" قناة");
            filters.addView(b,space(dp(156),dp(52),3));
            b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                activeChannelCategory=type;liveGuideLimit=48;
                getSharedPreferences("alezz_tv_settings_v14",MODE_PRIVATE).edit()
                    .putString("live_selected_group",type).apply();
                render();
            }});
        }
        int displayed=0,matching=0;
        boolean twoColumns=getResources().getDisplayMetrics().widthPixels>=dp(1000);
        LinearLayout pair=null;
        for(int i=0;i<channels.size();i++){
            JSONObject x=channels.get(i);
            boolean match="الكل".equals(activeChannelCategory) ||
                ("المفضلة".equals(activeChannelCategory)&&isFavorite(x)) ||
                activeChannelCategory.equals(channelCategory(x));
            if(!match)continue;
            matching++;
            if(displayed>=Math.min(350,liveGuideLimit))continue;
            if(displayed>350)break; // Safety bound for the legacy TV memory profile.
            LinearLayout card=channelLine(x,i);
            if(twoColumns){
                if(displayed%2==0){
                    pair=row();
                    content.addView(pair,space(-1,dp(92),3));
                }
                pair.addView(card,new LinearLayout.LayoutParams(0,dp(84),1));
            }else content.addView(card);
            displayed++;
        }
        if(matching>displayed){
            final int remaining=matching-displayed;
            Button more=button("＋ عرض المزيد من القنوات  ("+remaining+" متبقية)");
            content.addView(more,space(-1,dp(56),6));
            more.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                liveGuideLimit=Math.min(350,liveGuideLimit+48);render();
            }});
        }
        if(matching>350&&liveGuideLimit>=350)
            heading("عرض أول 350 قناة من هذا التصنيف","استخدم البحث للوصول إلى بقية القنوات.");
    }
    private LinearLayout channelLine(final JSONObject channel,final int position){
        final LinearLayout line=row();
        line.setPadding(dp(16),dp(8),dp(16),dp(8));
        line.setFocusable(true);line.setClickable(true);
        line.setBackgroundDrawable(bg(0xFF172236,0x7B9DB2CD,12));
        LinearLayout.LayoutParams outer=space(-1,dp(83),4);
        line.setLayoutParams(outer);
        TextView number=text(String.format(Locale.US,"%03d",position+1),20,0xFFF3D293,true);
        number.setGravity(Gravity.CENTER);
        line.addView(number,new LinearLayout.LayoutParams(dp(59),-1));
        ImageView poster=new ImageView(this);poster.setScaleType(ImageView.ScaleType.FIT_CENTER);
        poster.setBackgroundDrawable(bg(0xFF1E2634,0,8));
        String image=value(channel,"poster_url");
        if(image.startsWith("https://"))PosterLoader.load(poster,image);
        line.addView(poster,new LinearLayout.LayoutParams(dp(76),dp(55)));
        LinearLayout information=column();information.setPadding(dp(14),0,dp(14),0);
        information.addView(text(label(channel),17,WHITE,true));
        information.addView(text("● بث مباشر   •   "+channelCategory(channel),12,0xFF9FE2BF,false));
        String now=epgNow(channel),next=epgNext(channel);
        if(!now.isEmpty()||!next.isEmpty())information.addView(text(
            (!now.isEmpty()?"الآن: "+now:"")+(!next.isEmpty()?"  التالي: "+next:""),12,MUTED,false));
        line.addView(information,new LinearLayout.LayoutParams(0,-2,1));
        TextView action=text("▶  تشغيل",13,0xFFE6C786,true);
        line.addView(action,new LinearLayout.LayoutParams(dp(91),-1));
        line.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                line.setBackgroundDrawable(bg(focused?0xFF3D4E67:0xFF172236,
                    focused?0xFFF3D293:0x7B9DB2CD,12));
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
        if("series".equals(kind(item))&&isFavorite(item)){
            int count=item.optInt("episode_count",-1);
            int seen=PlaybackMemory.seenEpisodeCount(this,PlaybackMemory.activeProfile(this),value(item,"id"));
            if(seen>=0&&count>seen)outer.addView(text("● حلقة جديدة",12,0xFF44C892,true));
        }
        String desc="channel".equals(kind(item))?("official_link".equals(value(item,"playback_mode"))?"↗ موقع رسمي":"● مباشر"):"series".equals(kind(item))?"▤ مسلسل":"youtube".equals(kind(item))?"▶ يوتيوب":"▶ فيلم";
        outer.addView(text(desc,12,0xFFFF8DA6,false));
        outer.setOnFocusChangeListener(new View.OnFocusChangeListener(){public void onFocusChange(View v,boolean focused){
            outer.setBackgroundDrawable(bg(focused?0xFF79203A:0xFF201C25,focused?0xFFFFB0C6:0xFF342B38,13));
            outer.setScaleX(focused?1.055f:1);outer.setScaleY(focused?1.055f:1);
        }});
        outer.setOnClickListener(new View.OnClickListener(){public void onClick(View v){detail(item);}});
        return outer;
    }
    private boolean kidsAgeAllowed(String rating){
        String r=rating.trim().toLowerCase(Locale.US);
        if(r.equals("all")||r.equals("g")||r.equals("tv-y")||r.equals("tv-g"))return true;
        if(r.equals("6")||r.equals("6+"))return kidsAge>=6;
        if(r.equals("pg")||r.equals("tv-y7")||r.equals("7")||r.equals("7+"))return kidsAge>=7;
        if(r.equals("9")||r.equals("9+"))return kidsAge>=9;
        if(r.equals("tv-pg")||r.equals("12")||r.equals("12+"))return kidsAge>=12;
        return false;
    }
    private boolean kidsDirect(JSONObject x){
        if(x==null || !x.optBoolean("is_kids",false) ||
           !"approved".equals(value(x,"rights_status")) ||
           !kidsAgeAllowed(value(x,"age_rating")))return false;
        String url=value(x,"stream_url");
        return url.startsWith("https://") &&
           url.matches("(?i)^https://[^\\s?#]+\\.(mp4|m3u8)([?#].*)?$");
    }
    private String kidsDayKey(){
        java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.US);
        return format.format(new java.util.Date());
    }
    private void detail(final JSONObject item){
        if("series".equals(kind(item))){episodes(item);return;}
        if("youtube".equals(kind(item))){openYouTube(item);return;}
        detailVisible=true;detailOrigin=section;
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
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){detailVisible=false;render();}});
        play.requestFocus();
    }
    private void episodes(final JSONObject show){
        detailVisible=true;detailOrigin=section;
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
                        "?select=*&season_id=eq."+seasonId+"&status=eq.published&rights_status=eq.approved&order=number.asc&limit=500");
                    for(int k=0;k<list.length();k++){
                        JSONObject episode=list.optJSONObject(k);if(episode==null)continue;
                        mark(episode,"episode");
                        try{
                            episode.put("_season",season.optInt("number",i+1));
                            episode.put("_series_id",seriesId);
                        }catch(Exception ignored){}
                        episodes.add(episode);
                    }
                }
            }catch(Exception e){failure=CatalogApi.describe(e);}
            final String problem=failure;
            ui.post(new Runnable(){public void run(){
                if(isFinishing()||token!=episodeGeneration)return;
                content.removeAllViews();
                heading(label(show),"المواسم والحلقات  •  "+episodes.size()+" حلقة مرتبة  •  تشغيل متتالٍ");
                if(episodes.isEmpty())heading("لا توجد حلقات جاهزة",
                    problem.length()>0?problem:"راجع نشر الموسم والحلقات وروابط تشغيلها.");
                episodeQueue.clear();episodeQueue.addAll(episodes);
                int last=PlaybackMemory.seenEpisodeCount(TVHomeActivity.this,
                    PlaybackMemory.activeProfile(TVHomeActivity.this),seriesId);
                if(last>=0&&episodes.size()>last)
                    heading("● حلقات جديدة","تمت إضافة "+(episodes.size()-last)+" حلقات منذ آخر تصفح.");
                PlaybackMemory.markEpisodeCount(TVHomeActivity.this,
                    PlaybackMemory.activeProfile(TVHomeActivity.this),seriesId,episodes.size());
                String resumeId=pendingResumeEpisodeId;pendingResumeEpisodeId="";
                if(!resumeId.isEmpty()){
                    for(JSONObject ep:episodes)if(resumeId.equals(value(ep,"id"))){play(ep);return;}
                }
                for(final JSONObject ep:episodes){
                    Button b=button("▶ الموسم "+ep.optInt("_season",1)+" — الحلقة "+
                        ep.optInt("number",0)+"  |  "+label(ep));
                    content.addView(b,space(-1,dp(60),5));
                    b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(ep);}});
                }
                Button back=button("↩ رجوع إلى المسلسلات");content.addView(back,space(dp(260),dp(54),5));
                back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo(detailOrigin);}});
                if(!episodes.isEmpty() && content.getChildCount()>2)content.getChildAt(2).requestFocus();else back.requestFocus();
            }});
        }});
    }
    private void play(JSONObject item){
        boolean kidsMode="kids".equals(section);
        if(kidsMode){
            int seconds=getSharedPreferences("alezz_kids",MODE_PRIVATE).getInt("watched_"+kidsAge+"_"+kidsDayKey(),0);
            if(seconds>=kidsDailyMinutes*60){
                heading("انتهى وقت مشاهدة الأطفال","عدّل الوقت اليومي من قسم الأطفال أو تابع غدًا.");return;
            }
            if("youtube".equals(kind(item)) || (!"episode".equals(kind(item)) && !kidsDirect(item))){
                heading("هذا المحتوى غير متاح للأطفال","يجب وجود رابط MP4/HLS مباشر معتمد وتصنيف عمري مناسب.");return;
            }
        }
        if("channel".equals(kind(item)) && "official_link".equals(value(item,"playback_mode"))){
            heading("المحتوى غير قابل للتشغيل داخل التطبيق",
                "القناة تعرض رابطًا رسميًا خارجيًا وليست لديها وصلة بث مرخصة مباشرة. حدّث المصدر من لوحة الإدارة.");
            return;
        }
        // A title can have an MP4/HLS stream, several approved alternatives, and/or
        // an official YouTube or Embed player. Prefer a compatible native source.
        String youtube=value(item,"youtube_url");
        String variantsJson=item.optJSONArray("stream_variants")==null?
            "[]":item.optJSONArray("stream_variants").toString();
        ArrayList<PlaybackSources.Source> available=PlaybackSources.collect(
            value(item,"stream_url"),value(item,"quality"),variantsJson,youtube,kidsMode);
        if(available.isEmpty()){
            heading("لا يوجد مصدر صالح للتشغيل",
                "أضف مصدر MP4/HLS أو Embed/YouTube معتمدًا من لوحة الإدارة.");return;
        }
        PlaybackSources.Source selected=available.get(PlaybackSources.preferred(available));
        String url=selected.url;
        String sourceList=PlaybackSources.encode(available);
        if("embed".equals(selected.kind)||"youtube".equals(selected.kind)){
            if(kidsMode || !"approved".equals(value(item,"rights_status"))){
                heading("المصدر غير معتمد",
                    "مشغلات Embed وYouTube تتطلب اعتماد الحقوق ولا تعمل في وضع الأطفال.");return;
            }
            Intent embedded=new Intent(this,EmbedPlayerActivity.class);
            embedded.putExtra("stream_url",url);
            embedded.putExtra("available_sources",sourceList);
            embedded.putExtra("stream_variants",variantsJson);
            embedded.putExtra("youtube_url",youtube);
            embedded.putExtra("item_id",value(item,"id"));
            embedded.putExtra("title",label(item));
            embedded.putExtra("profile",PlaybackMemory.activeProfile(this));
            embedded.putExtra("kids_mode",false);
            startActivity(embedded);
            return;
        }
        Intent intent=new Intent(this,CinemaPlayerActivity.class);
        intent.putExtra("item_id",value(item,"id"));
        intent.putExtra("title",label(item));
        intent.putExtra("series_id",value(item,"_series_id"));
        intent.putExtra("profile","kids".equals(section)?"kids":PlaybackMemory.activeProfile(this));
        intent.putExtra("stream_url",url);
        intent.putExtra("available_sources",sourceList);
        intent.putExtra("is_live","channel".equals(kind(item)));
        intent.putExtra("kids_mode",kidsMode);
        intent.putExtra("kids_age",kidsAge);
        intent.putExtra("kids_minutes",kidsDailyMinutes);
        intent.putExtra("quality","default");
        intent.putExtra("stream_variants",item.optJSONArray("stream_variants")==null?"[]":item.optJSONArray("stream_variants").toString());
        if("movie".equals(kind(item)) || "episode".equals(kind(item))){
            JSONArray mediaQueue=new JSONArray();
            int currentIndex=0;
            ArrayList<JSONObject> sourceItems="episode".equals(kind(item))?episodeQueue:movies;
            for(JSONObject candidate:sourceItems){
                if(kidsMode && "movie".equals(kind(candidate)) && !kidsDirect(candidate))continue;
                if(kidsMode && "episode".equals(kind(candidate)) &&
                    !"approved".equals(value(candidate,"rights_status")))continue;
                String candidateUrl=value(candidate,"stream_url");
                String variants=candidate.optJSONArray("stream_variants")==null
                    ? "[]" : candidate.optJSONArray("stream_variants").toString();
                if(StreamQuality.parse(candidateUrl,value(candidate,"quality"),variants).isEmpty())continue;
                JSONObject record=new JSONObject();
                try{
                    record.put("id",value(candidate,"id"));
                    record.put("title",label(candidate));
                    record.put("series_id",value(candidate,"_series_id"));
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
            intent.putExtra("channel_group","live".equals(section)?activeChannelCategory:"الكل");
            JSONArray playlist=new JSONArray();
            int selected=0;
            // Keep Android Binder intents below the transaction limit for large local IPTV lists.
            int selectedGlobal=channels.indexOf(item);
            int from=Math.max(0,selectedGlobal-75);
            int to=Math.min(channels.size(),Math.max(from+150,selectedGlobal+76));
            for(int channelIndex=from;channelIndex<to;channelIndex++){
                JSONObject candidate=channels.get(channelIndex);
                if(kidsMode && !kidsDirect(candidate))continue;
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
                    record.put("category",channelCategory(candidate));
                    record.put("favorite",isFavorite(candidate));
                    record.put("poster_url",value(candidate,"poster_url"));
                    record.put("epg_now_title",epgNow(candidate));
                    record.put("epg_next_title",epgNext(candidate));
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
        SharedPreferences prefs=getSharedPreferences("alizz_v11_favorites."+MemberAuth.userId(this),MODE_PRIVATE);
        String profile=PlaybackMemory.activeProfile(this);
        String scoped=profile+"."+favKey(item);
        if(prefs.contains(scoped))return prefs.getBoolean(scoped,false);
        // Family keeps the user's original v14 favorites; kids/guest stay private.
        return "family".equals(profile)&&prefs.getBoolean(favKey(item),false);
    }
    private void toggleFavorite(JSONObject item){
        SharedPreferences prefs=getSharedPreferences("alizz_v11_favorites."+MemberAuth.userId(this),MODE_PRIVATE);
        String scoped=PlaybackMemory.activeProfile(this)+"."+favKey(item);
        boolean selected=!isFavorite(item);
        prefs.edit().putBoolean(scoped,selected).apply();
        if("family".equals(PlaybackMemory.activeProfile(this)))
            MemberSync.favorite(this,kind(item),value(item,"id"),selected);
    }
    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_BACK && showingWelcome){
            finish();return true;
        }
        if(code==KeyEvent.KEYCODE_BACK && detailVisible){
            detailVisible=false;episodeGeneration++;render();return true;
        }
        if(code==KeyEvent.KEYCODE_BACK && !"home".equals(section)){
            goTo("home");return true;
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
    @Override protected void onResume(){
        super.onResume();
        if(unlocked){
            ui.removeCallbacks(entitlementGuard);
            ui.post(entitlementGuard);
        }
        if(unlocked && !getSharedPreferences(SETTINGS,MODE_PRIVATE).getString("iptv_m3u","").isEmpty()
            && android.os.SystemClock.elapsedRealtime()-lastLocalPlaylistRefreshAt>45L*60L*1000L){
            refreshLocalPlaylist(false);
        }
        if(unlocked && !loading && getSharedPreferences(SETTINGS,MODE_PRIVATE).getBoolean("auto_refresh",true)
            && android.os.SystemClock.elapsedRealtime()-lastCatalogRefreshAt>=CATALOG_REFRESH_INTERVAL_MS){
            loadCatalog();
        }
    }
    @Override protected void onPause(){
        ui.removeCallbacks(entitlementGuard);
        super.onPause();
    }
    @Override protected void onDestroy(){
        ui.removeCallbacks(entitlementGuard);
        generation++;episodeGeneration++;localPlaylistGeneration++;unlocked=false;background.shutdownNow();ui.removeCallbacks(remoteChannelCommit);ui.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
