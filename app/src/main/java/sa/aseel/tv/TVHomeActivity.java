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
import android.widget.FrameLayout;
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
    private static final int BG=0xFF090B11, PANEL=0xFF191823, RED=0xFFE33246;
    private static final int WHITE=0xFFF8F8FB, MUTED=0xFFAFADBB, GOLD=0xFFFA6578;
    private static final String SETTINGS="alezz_tv_settings_v14";
    private final ExecutorService background=Executors.newFixedThreadPool(4);
    private final Handler ui=new Handler();
    private long lastEntitlementCheckAt=0L;
    private boolean checkingEntitlement=false;
    private final Runnable entitlementGuard=new Runnable(){public void run(){
        if(!unlocked||isFinishing())return;
        if(!MemberAuth.hasSession(TVHomeActivity.this)){
            ui.removeCallbacks(this);
            showMemberLogin("يلزم تسجيل الدخول للمشاهدة.");
            return;
        }
        // A renewal may have happened in admin after we cached the expiry.
        final boolean cachedExpired=MemberAuth.isExpiredLocally(TVHomeActivity.this);
        long now=android.os.SystemClock.elapsedRealtime();
        if(!checkingEntitlement && (cachedExpired || lastEntitlementCheckAt==0L || now-lastEntitlementCheckAt>=90000L)){
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
                }catch(Exception network){
                    // Do not continue unverified access after a cached deadline.
                    // Keep the refresh token so a newly renewed user can retry.
                    if(MemberAuth.isExpiredLocally(TVHomeActivity.this))
                        ui.post(new Runnable(){public void run(){
                            if(unlocked&&!isFinishing()){
                                unlocked=false;
                                ui.removeCallbacks(entitlementGuard);
                                showMemberLogin("تعذر التحقق من تجديد الاشتراك. تحقق من الإنترنت ثم أعد المحاولة.");
                            }
                        }});
                }
                finally{ui.post(new Runnable(){public void run(){checkingEntitlement=false;}});}
            }});
        }
        ui.postDelayed(this,60000L);
    }};
    private final ArrayList<JSONObject> movies=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> series=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> episodeQueue=new ArrayList<JSONObject>();
    private final java.util.HashMap<String,JSONObject> watchedMedia=new java.util.HashMap<String,JSONObject>();
    private final ArrayList<JSONObject> channels=new ArrayList<JSONObject>();
    private final ArrayList<JSONObject> localChannels=new ArrayList<JSONObject>();
    private final java.util.HashMap<String,String> categoryNames=new java.util.HashMap<String,String>();
    private int localPlaylistGeneration=0;
    private long lastLocalPlaylistRefreshAt=0L;
    private final ArrayList<JSONObject> youtubeVideos=new ArrayList<JSONObject>();
    private CatalogApi catalog;
    private AppUpdater appUpdater;
    private EpisodeAlerts episodeAlerts;
    private String latestEpisodeAlert="";
    private ScrollView scroller;
    private LinearLayout content,navBar;
    private TextView status,featuredTitle,featuredMeta,topProfileLabel;
    private ImageView featuredArtwork;
    private JSONObject featuredItem;
    private Runnable pendingFeature;
    private final ArrayList<JSONObject> featuredItems=new ArrayList<JSONObject>();
    private int featuredIndex;
    private final Runnable featureRotation=new Runnable(){public void run(){
        if(!unlocked||detailVisible||!"home".equals(section)||featuredItems.size()<2)return;
        if(!"featured:watch".equals(focusedItemTag())){
            featuredIndex=(featuredIndex+1)%featuredItems.size();
            applyFeatured(featuredItems.get(featuredIndex));
        }
        ui.postDelayed(this,10000L);
    }};
    private int featureSelectionGeneration=0;
    private String section="home",lastRenderedSection="";
    private boolean detailVisible=false, showingWelcome=false;
    private String detailFocus="",browseOriginFocus="";
    private int detailScroll,browseOriginScroll,renderGeneration;
    private String pendingResumeEpisodeId="",activeChannelCategory="الكل",activeChannelCompany="الكل";
    private int liveGuideLimit=48;
    private int kidsAge=6,kidsDailyMinutes=60;
    private String lastLoadError="";
    private boolean loading=false,unlocked=false;
    private static final long CATALOG_REFRESH_INTERVAL_MS=2L*60L*1000L;
    private String browseKind="movie",browseMode="all",browseKey="",browseTitle="عرض الكل",browseOrigin="home";
    private static final int BROWSE_PAGE_SIZE=48;
    private int browsePage;
    private int cardGridLimit=72;
    private final Runnable libraryHeartbeat=new Runnable(){public void run(){
        if(!unlocked||isFinishing())return;
        if(!loading && getSharedPreferences(SETTINGS,MODE_PRIVATE).getBoolean("auto_refresh",true)
            && android.os.SystemClock.elapsedRealtime()-lastCatalogRefreshAt>=CATALOG_REFRESH_INTERVAL_MS)
            loadCatalog();
        // New signed app versions are checked periodically without interrupting playback.
        if(appUpdater!=null)appUpdater.check(false);
        ui.postDelayed(this,30000L);
    }};
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
        TextView t=new TextView(this);t.setText(UiLanguage.label(this,label));t.setTextColor(color);t.setTextSize(size);
        t.setTextDirection(UiLanguage.english(this)?View.TEXT_DIRECTION_LTR:View.TEXT_DIRECTION_RTL);t.setGravity(Gravity.CENTER_VERTICAL);
        if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;
    }
    private Button button(String name){
        final Button b=new Button(this);b.setText(UiLanguage.label(this,name));b.setAllCaps(false);
        b.setTextDirection(UiLanguage.english(this)?View.TEXT_DIRECTION_LTR:View.TEXT_DIRECTION_RTL);
        b.setTextColor(CinemaGlassButtonDrawable.labelColors());
        b.setTextSize(15);b.setFocusable(true);
        b.setBackgroundDrawable(new CinemaGlassButtonDrawable(false,false,0xFF29232F));
        b.setOnFocusChangeListener(new View.OnFocusChangeListener(){public void onFocusChange(View v,boolean focused){
            b.setBackgroundDrawable(new CinemaGlassButtonDrawable(false,false,
                focused?0xFF78223C:0xFF29232F));
            b.setScaleX(focused?1.024f:1f);b.setScaleY(focused?1.024f:1f);
        }});return b;
    }
    private Button primaryButton(String label){
        final Button action=button(label);
        action.setBackgroundDrawable(new CinemaGlassButtonDrawable(true,false,0xFF6F0C26));
        action.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                action.setBackgroundDrawable(new CinemaGlassButtonDrawable(true,false,
                    focused?0xFF9A1532:0xFF6F0C26));
                action.setScaleX(focused?1.02f:1f);action.setScaleY(focused?1.02f:1f);
            }
        });
        return action;
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
        if("GULF".equals(code))return country.length()==2&&
            "SA KW AE BH QA OM ".contains(country+" ");
        return country.equals(code);
    }
    private boolean hasGenre(JSONObject item,String key){
        if(item==null)return false;
        for(String name:new String[]{"genre_tags","auto_tags"}){
            JSONArray list=item.optJSONArray(name);
            if(list==null)continue;
            for(int i=0;i<list.length();i++)if(key.equalsIgnoreCase(list.optString(i)))return true;
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
        shelf("مسلسلات تركية","مباشرة من بيانات بلد الإنتاج",originItems(series,"TR"),18,"country","TR");
        shelf("مسلسلات أجنبية","أعمال عالمية متاحة",originItems(series,"FOREIGN"),18,"country","FOREIGN");
        shelf("مسلسلات كورية","دراما وإنتاج كوري",originItems(series,"KR"),18,"country","KR");
        shelf("مسلسلات عربية","دراما من الدول العربية",originItems(series,"ARAB"),18,"country","ARAB");
        shelf("أفلام تركية","السينما التركية",originItems(movies,"TR"),18,"country","TR");
        shelf("أفلام أجنبية","أعمال دولية",originItems(movies,"FOREIGN"),18,"country","FOREIGN");
        shelf("أفلام هندية","السينما الهندية",originItems(movies,"IN"),18,"country","IN");
        shelf("أفلام أمريكية","السينما الأمريكية",originItems(movies,"US"),18,"country","US");
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
            shelf(label+" "+genre[1],"مصنّف تلقائيًا أو من لوحة الإدارة",genreItems(list,genre[0]),limit,"genre",genre[0]);
        }
        // Future tags from Supabase appear as shelves without shipping another APK.
        java.util.HashSet<String> known=new java.util.HashSet<String>();
        for(String[] genre:genres)known.add(genre[0]);
        java.util.LinkedHashSet<String> discovered=new java.util.LinkedHashSet<String>();
        for(JSONObject item:list){
            for(String field:new String[]{"genre_tags","auto_tags"}){
                JSONArray tags=item.optJSONArray(field);
                if(tags==null)continue;
                for(int n=0;n<tags.length();n++){
                    String tag=tags.optString(n,"").trim().toLowerCase(Locale.US);
                    if(tag.length()<2||tag.length()>32||known.contains(tag)||
                        tag.startsWith("network:")||tag.startsWith("country:")||
                        tag.equals("general")||tag.equals("other")||tag.equals("misc"))continue;
                    discovered.add(tag);
                }
            }
        }
        int extras=0;
        for(String tag:discovered){
            if(extras++>=24)break;
            shelf(label+" "+genreLabel(tag),"تصنيف مضاف من مكتبة العز",
                genreItems(list,tag),limit,"genre",tag);
        }
    }
    private String genreLabel(String key){
        if("ramadan".equals(key))return "رمضان";
        if("family".equals(key))return "عائلية";
        if("romantic".equals(key))return "رومانسية";
        if("adventure".equals(key))return "مغامرات";
        if("biography".equals(key))return "سيرة ذاتية";
        if("historical".equals(key))return "تاريخية";
        if("social".equals(key))return "اجتماعية";
        if("turkish".equals(key))return "تركية";
        if("gulf".equals(key))return "خليجية";
        return key;
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
                    String mode=value(item,"playback_mode");
                    if("official_link".equals(mode)){
                        String official=value(item,"official_url");
                        if(!(official.startsWith("https://rotana.net/")||
                            official.startsWith("https://www.rotana.net/")||
                            official.startsWith("https://roya.tv/")||
                            official.startsWith("https://www.qanwatlive.com/")||
                            official.startsWith("https://qanwatlive.com/")))continue;
                    }else if(!"stream".equals(mode) ||
                        !"healthy".equals(value(item,"link_health_status")) ||
                        !liveUrl.matches("(?i)^https://[^\\s]+\\.(m3u8|mp4)(\\?[^\\s]*)?$"))continue;
                }
                mark(item,type);target.add(item);
            }
        }
    }
    /**
     * Fill the complete landscape display on tablets and Android TV.
     * FULLSCREEN alone hides only the status bar; navigation/cutout insets
     * can otherwise leave a black strip beside the cinema wallpaper.
     */
    private void applyCinemaImmersiveLayout(){
        final View decor=getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        // On Android 9+ a landscape display cutout can reserve a black strip
        // along the short edge unless the window opts into that area.
        if(android.os.Build.VERSION.SDK_INT>=28){
            android.view.WindowManager.LayoutParams attrs=getWindow().getAttributes();
            if(attrs.layoutInDisplayCutoutMode!=
                 android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES){
                attrs.layoutInDisplayCutoutMode=
                    android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                getWindow().setAttributes(attrs);
            }
        }
    }
    @Override public void onWindowFocusChanged(boolean hasFocus){
        super.onWindowFocusChanged(hasFocus);
        if(hasFocus)applyCinemaImmersiveLayout();
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        applyCinemaImmersiveLayout();
        catalog=new CatalogApi(this);
        appUpdater=new AppUpdater(this);
        episodeAlerts=new EpisodeAlerts(this);
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
        splash.setBackgroundDrawable(new CinemaBackdropDrawable());
        setContentView(splash);
        ImageView icon=new ImageView(this);
        int mark=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(mark!=0)icon.setImageResource(mark);
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        icon.setAlpha(0f);icon.animate().alpha(1f).setDuration(420).start();
        splash.addView(icon,new LinearLayout.LayoutParams(dp(145),dp(145)));
        TextView brand=text("العز TV",42,WHITE,true);brand.setGravity(Gravity.CENTER);
        brand.setAlpha(0f);brand.animate().alpha(1f).setStartDelay(180).setDuration(480).start();
        splash.addView(brand,space(dp(380),dp(84),7));
        TextView note=text("عالمك السينمائي يبدأ هنا",18,MUTED,false);note.setGravity(Gravity.CENTER);
        splash.addView(note);
        ui.postDelayed(new Runnable(){public void run(){
            if(!isFinishing()&&showingWelcome&&!unlocked)showWelcome();
        }},750L);
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
        panel.setBackgroundDrawable(new CinemaBackdropDrawable());
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
        panel.setBackgroundDrawable(new CinemaBackdropDrawable());
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
        boolean tvKeyboard=getPackageManager().hasSystemFeature("android.software.leanback")
            ||(getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_TYPE_MASK)
                ==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION;
        if(tvKeyboard)getWindow().setSoftInputMode(
            android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
            |android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        for(EditText input:new EditText[]{username,password}){
            input.setSingleLine(true);input.setTextColor(WHITE);input.setHintTextColor(MUTED);
            input.setTextSize(18);input.setPadding(dp(17),dp(3),dp(17),dp(3));
            input.setBackgroundDrawable(bg(PANEL,0xFFB45165,13));
            if(tvKeyboard){
                if(android.os.Build.VERSION.SDK_INT>=21)input.setShowSoftInputOnFocus(false);
                input.setOnClickListener(view->{
                    view.requestFocus();
                    android.view.inputmethod.InputMethodManager keyboard=
                        (android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
                    if(keyboard!=null)keyboard.showSoftInput(view,
                        android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
                });
            }
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
        username.setId(View.generateViewId());
        password.setId(View.generateViewId());
        signIn.setId(View.generateViewId());
        username.setNextFocusDownId(password.getId());
        password.setNextFocusUpId(username.getId());
        password.setNextFocusDownId(signIn.getId());
        signIn.setNextFocusUpId(password.getId());
        moveLoginFocus(username,null,password,tvKeyboard);
        moveLoginFocus(password,username,signIn,tvKeyboard);
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
    private void moveLoginFocus(EditText field,View above,View below,boolean tvKeyboard){
        field.setOnKeyListener((view,key,event)->{
            if(tvKeyboard&&key==KeyEvent.KEYCODE_DPAD_CENTER){
                if(event.getAction()==KeyEvent.ACTION_UP)field.performClick();
                return true;
            }
            View target=key==KeyEvent.KEYCODE_DPAD_DOWN?below:
                key==KeyEvent.KEYCODE_DPAD_UP?above:null;
            if(target==null||!target.isEnabled())return false;
            if(event.getAction()==KeyEvent.ACTION_DOWN)target.requestFocus();
            return true;
        });
    }
    /** Explicit, remote-friendly subscription expiration screen (Android API 19+). */
    private void showExpiredScreen(){
        unlocked=false;showingWelcome=true;
        final LinearLayout panel=column();
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(38),dp(16),dp(38),dp(16));
        panel.setBackgroundDrawable(new CinemaBackdropDrawable());
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
        Button renew=button("↻  التحقق بعد تجديد الاشتراك");
        panel.addView(renew,space(dp(420),dp(68),8));
        renew.setOnClickListener(new View.OnClickListener(){public void onClick(View view){
            if(MemberAuth.hasSession(TVHomeActivity.this))restoreMember();
            else showMemberLogin("");
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
        generation++;
        loading=false;
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        unlocked=true;showingWelcome=false;
        section="home";buildShell();render();loadCatalog();
        ui.removeCallbacks(libraryHeartbeat);
        ui.postDelayed(libraryHeartbeat,30000L);
        if(appUpdater!=null)appUpdater.check(false);
        lastEntitlementCheckAt=0L;
        ui.removeCallbacks(entitlementGuard);
        ui.postDelayed(entitlementGuard,1800L);
        MemberSync.begin(this);
        if(!getSharedPreferences(SETTINGS,MODE_PRIVATE).getString("iptv_m3u","").isEmpty())
            refreshLocalPlaylist(false);
    }
    private void buildShell(){
        LinearLayout root=column();
        root.setBackgroundDrawable(new CinemaBackdropDrawable());
        root.setLayoutDirection(UiLanguage.direction(this));
        setContentView(root);
        LinearLayout top=row();top.setPadding(dp(16),dp(6),dp(16),dp(6));
        top.setBackgroundDrawable(GlassSurface.transparentHeader(0));
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
        final LinearLayout account=row();account.setFocusable(true);account.setClickable(true);
        account.setTag("nav:account");
        account.setContentDescription("حسابي وبروفايلاتي واشتراكي");
        account.setPadding(dp(8),0,dp(8),0);
        account.setBackgroundDrawable(new CinemaGlassButtonDrawable(false,true,0xFF38202F));
        ImageView accountIcon=new ImageView(this);
        accountIcon.setImageDrawable(new CinemaGlyph("account",0xFFFF8DA6));
        account.addView(accountIcon,new LinearLayout.LayoutParams(dp(26),dp(26)));
        topProfileLabel=text(PlaybackMemory.displayProfile(this,PlaybackMemory.activeProfile(this)),14,WHITE,true);
        topProfileLabel.setSingleLine(true);
        topProfileLabel.setEllipsize(TextUtils.TruncateAt.END);
        account.addView(topProfileLabel,space(dp(102),-2,2));
        top.addView(account,space(dp(167),dp(49),2));
        account.setOnClickListener(new View.OnClickListener(){
            public void onClick(View view){goTo("account");}
        });
        Button refresh=button("↻");
        refresh.setContentDescription("تحديث المكتبة");
        top.addView(refresh,space(dp(54),dp(49),2));
        refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadCatalog();}});
        navBar=row();navBar.setPadding(dp(15),dp(3),dp(15),dp(3));
        navBar.setBackgroundDrawable(GlassSurface.transparentHeader(0));
        root.addView(navBar,new LinearLayout.LayoutParams(-1,dp(57)));
        scroller=new ScrollView(this);scroller.setFillViewport(true);scroller.setVerticalScrollBarEnabled(false);
        root.addView(scroller,new LinearLayout.LayoutParams(-1,0,1));
        content=column();content.setPadding(dp(19),dp(12),dp(19),dp(19));
        scroller.addView(content,new ScrollView.LayoutParams(-1,-2));
        updateNav();
    }
    private String sectionName(String s){
        if("movies".equals(s))return UiLanguage.label(this,"الأفلام");
        if("browse".equals(s))return browseTitle;
        if("series".equals(s))return UiLanguage.label(this,"المسلسلات");
        if("live".equals(s))return UiLanguage.label(this,"البث المباشر");
        if("kids".equals(s))return UiLanguage.label(this,"عالم الأطفال");
        if("favorites".equals(s))return UiLanguage.label(this,"قائمتي");
        if("settings".equals(s))return UiLanguage.label(this,"الإعدادات");
        if("watching".equals(s))return UiLanguage.label(this,"مشاهداتي");
        if("account".equals(s))return "حسابي واشتراكي";
        if("profiles".equals(s))return "بروفايلات المشاهدة";
        if("search".equals(s))return UiLanguage.label(this,"البحث");
        if("youtube".equals(s))return "يوتيوب الأطفال";
        return "اختر عالمك";
    }
    private void goTo(String target){
        if("developer".equals(target)){startActivity(new Intent(this,DeveloperActivity.class));return;}
        episodeGeneration++;detailVisible=false;section=target;cardGridLimit=72;
        render();if(scroller!=null)scroller.scrollTo(0,0);
    }
    private void updateNav(){
        if(navBar==null)return;
        navBar.removeAllViews();
        navBar.setVisibility("home".equals(section)?View.GONE:View.VISIBLE);
        if("home".equals(section))return;
        Button back=button("browse".equals(section)?"❮  رجوع للفئات":"⌂  القائمة الرئيسية");
        back.setTag("nav:back");
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            if(detailVisible)closeDetails();
            else if("browse".equals(section))closeBrowse();
            else goTo("home");
        }});
        navBar.addView(back,space(dp(210),dp(48),2));
        TextView breadcrumb=text("العز TV   /   "+sectionName(section),19,GOLD,true);
        navBar.addView(breadcrumb,new LinearLayout.LayoutParams(0,-1,1));
        // One clear Back/Home action is sufficient; avoid duplicate remote targets.
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
        tile.setTag("nav:"+target);
        tile.setBackgroundDrawable(new CinemaNeonDrawable(baseColor,dp(19),false));
        FrameLayout symbolSpace=new FrameLayout(this);
        tile.addView(symbolSpace,new LinearLayout.LayoutParams(-1,0,1));
        FrameLayout capsule=new FrameLayout(this);
        capsule.setBackgroundDrawable(bg(0xFF4D2233,0x8AD85B73,15));
        FrameLayout.LayoutParams iconPlace=new FrameLayout.LayoutParams(dp(60),dp(60),Gravity.RIGHT|Gravity.TOP);
        symbolSpace.addView(capsule,iconPlace);
        ImageView symbol=new ImageView(this);
        symbol.setImageDrawable(new CinemaGlyph(target,0xFFFF7A8D));
        symbol.setContentDescription(label);
        FrameLayout.LayoutParams mark=new FrameLayout.LayoutParams(dp(38),dp(38),Gravity.CENTER);
        capsule.addView(symbol,mark);
        TextView name=text(label,24,WHITE,true);name.setGravity(Gravity.RIGHT);
        tile.addView(name,space(-1,-2,2));
        TextView caption=text(subtitle,13,0xFFC3C0CD,false);caption.setGravity(Gravity.RIGHT);
        tile.addView(caption,space(-1,-2,0));
        tile.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                tile.setBackgroundDrawable(new CinemaNeonDrawable(focused?0xFF692039:baseColor,dp(19),focused));
                capsule.setBackgroundDrawable(bg(focused?0xFFAE2B4A:0xFF4D2233,
                    focused?0xFFFFA0B0:0x8AD85B73,15));
                tile.setScaleX(focused?1.015f:1f);
                tile.setScaleY(focused?1.015f:1f);
                if(android.os.Build.VERSION.SDK_INT>=21)tile.setElevation(focused?dp(8):0f);
            }
        });
        tile.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo(target);}});
        return tile;
    }
    private void scheduleFeatured(final JSONObject item){
        if(item==null||!"home".equals(section)||featuredTitle==null)return;
        if(featuredItem!=null && value(featuredItem,"id").equals(value(item,"id")))return;
        if(pendingFeature!=null)ui.removeCallbacks(pendingFeature);
        final int gen=++featureSelectionGeneration;
        pendingFeature=new Runnable(){public void run(){
            if(gen!=featureSelectionGeneration || !"home".equals(section))return;
            applyFeatured(item);
        }};
        ui.postDelayed(pendingFeature,160L);
    }
    private void applyFeatured(final JSONObject item){
        if(item==null||featuredTitle==null||featuredArtwork==null)return;
        featuredItem=item;
        featuredTitle.setText(label(item));
        String kind="series".equals(kind(item))?"مسلسل":"فيلم";
        String year=value(item,"release_year");
        if(year.isEmpty())year=value(item,"year");
        String quality=value(item,"quality");
        featuredMeta.setText(kind+(year.isEmpty()?"":"  •  "+year)+
            (quality.isEmpty()?"":"  •  "+quality)+"  •  اختيار العز");
        String backdrop=value(item,"backdrop_url");
        if(backdrop.isEmpty())backdrop=value(item,"poster_url");
        if(backdrop.startsWith("https://")){
            featuredArtwork.setAlpha(.35f);
            PosterLoader.load(featuredArtwork,backdrop);
            featuredArtwork.animate().alpha(.65f).setDuration(260L).start();
        }else{
            featuredArtwork.setImageDrawable(null);
            featuredArtwork.setAlpha(.1f);
        }
    }
    private void featuredBanner(){
        ui.removeCallbacks(featureRotation);
        featuredItems.clear();
        for(ArrayList<JSONObject> library:java.util.Arrays.asList(movies,series))
            for(JSONObject item:library)
                if(item.optBoolean("featured",false)&&featuredItems.size()<6)featuredItems.add(item);
        if(featuredItems.isEmpty()){
            featuredItems.addAll(movies.subList(0,Math.min(3,movies.size())));
            featuredItems.addAll(series.subList(0,Math.min(3,series.size())));
        }
        if(featuredItems.isEmpty())return;
        featuredIndex=Math.min(featuredIndex,featuredItems.size()-1);
        FrameLayout banner=new FrameLayout(this);
        banner.setFocusable(false);
        banner.setBackgroundDrawable(bg(0xFF190D18,0xAA91384D,20));
        banner.setClipChildren(true);
        featuredArtwork=new ImageView(this);
        featuredArtwork.setScaleType(ImageView.ScaleType.CENTER_CROP);
        banner.addView(featuredArtwork,new FrameLayout.LayoutParams(-1,-1));
        View shade=new View(this);
        shade.setBackgroundDrawable(new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{0xC0080710,0xD5110712,0xEC130B16}));
        banner.addView(shade,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout overlay=column();
        overlay.setPadding(dp(24),dp(15),dp(24),dp(10));
        overlay.addView(text("●  العمل المميز",13,0xFFFF8295,true));
        featuredTitle=text("",27,WHITE,true);
        featuredTitle.setSingleLine(true);
        featuredTitle.setEllipsize(TextUtils.TruncateAt.END);
        overlay.addView(featuredTitle,space(-1,dp(51),1));
        featuredMeta=text("",13,0xFFF6CED5,false);
        overlay.addView(featuredMeta,space(-1,dp(27),0));
        Button watch=primaryButton("▶ شاهد الآن");
        watch.setTag("featured:watch");
        overlay.addView(watch,space(dp(210),dp(52),1));
        watch.setOnClickListener(new View.OnClickListener(){
            public void onClick(View v){if(featuredItem!=null)detail(featuredItem);}
        });
        FrameLayout.LayoutParams pos=new FrameLayout.LayoutParams(-1,-2,
            Gravity.RIGHT|Gravity.BOTTOM);
        banner.addView(overlay,pos);
        content.addView(banner,space(-1,dp(Math.max(187,Math.min(235,screenHeightDp()/3))),6));
        applyFeatured(featuredItems.get(featuredIndex));
        ui.postDelayed(featureRotation,10000L);
    }
    private void portal(){
        LinearLayout heading=column();heading.setPadding(dp(12),dp(7),dp(12),dp(7));
        content.addView(heading,space(-1,-2,3));
        heading.addView(text("AL EZZ  •  RED CINEMA",12,GOLD,true));
        heading.addView(text("اختر عالمك",33,WHITE,true));
        heading.addView(text("اختر ما تريد مشاهدته — أقسام واضحة بالريموت",15,MUTED,false));
        featuredBanner();
        final String[][] main={
            {"المسلسلات","المواسم والحلقات","series"},
            {"الأفلام","مكتبة السينما","movies"},
            {"البث المباشر","القنوات والبرامج","live"}
        };
        LinearLayout primary=row();primary.setGravity(Gravity.TOP);
        primary.setFocusable(false);
        content.addView(primary,space(-1,-2,4));
        final int cardHeight=Math.max(165,Math.min(250,screenHeightDp()/3));
        for(int i=0;i<main.length;i++){
            LinearLayout tile=dashboardTile(main[i][0],main[i][1],"",main[i][2],
                i==0?0xFF34212E:i==1?0xFF30222A:0xFF272631);
            LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(0,dp(cardHeight),1);
            params.setMargins(dp(6),dp(5),dp(6),dp(7));
            primary.addView(tile,params);
        }
        TextView secondaryTitle=text("المزيد",16,MUTED,true);
        content.addView(secondaryTitle,space(-1,dp(29),7));
        final String[][] small={
            {"الأطفال","kids"},{"قائمتي","favorites"},{"البحث","search"},{"مشاهداتي","watching"},{"الإعدادات","settings"}
        };
        LinearLayout secondary=row();
        secondary.setFocusable(false);
        content.addView(secondary,space(-1,dp(106),4));
        for(int i=0;i<small.length;i++){
            final String target=small[i][1];
            LinearLayout tile=column();
            tile.setGravity(Gravity.CENTER);
            tile.setFocusable(true);tile.setClickable(true);
            tile.setTag("nav:"+target);
            tile.setBackgroundDrawable(new CinemaNeonDrawable(0xFF201B28,dp(16),false));
            ImageView icon=new ImageView(this);
            icon.setImageDrawable(new CinemaGlyph(target,0xFFFF778A));
            tile.setContentDescription(small[i][0]);
            tile.addView(icon,new LinearLayout.LayoutParams(dp(30),dp(30)));
            TextView label=text(small[i][0],14,WHITE,true);
            label.setGravity(Gravity.CENTER);
            tile.addView(label,space(-1,dp(29),1));
            final LinearLayout focusTile=tile;
            tile.setOnFocusChangeListener(new View.OnFocusChangeListener(){
                public void onFocusChange(View v,boolean focused){
                    focusTile.setBackgroundDrawable(new CinemaNeonDrawable(focused?0xFF60233A:0xFF201B28,dp(16),focused));
                    focusTile.setScaleX(focused?1.015f:1f);
                    focusTile.setScaleY(focused?1.015f:1f);
                }
            });
            tile.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo(target);}});
            LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(0,dp(91),1);
            params.setMargins(dp(6),0,dp(6),0);
            secondary.addView(tile,params);
        }
        TextView guide=text("← → اختيار القسم   •   OK فتح   •   رجوع للصفحة السابقة",12,MUTED,false);
        guide.setGravity(Gravity.CENTER);
        content.addView(guide,space(-1,dp(35),4));
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
                    sortChannels();
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
            try{data=catalog.listPaged("aseel_movies","?select=*&status=eq.published&rights_status=eq.approved&order=created_at.desc,id.asc");}
            catch(Exception e){error+="أفلام: "+CatalogApi.describe(e)+"  ";}
            final JSONArray rows=data;final String problem=error;
            ui.post(new Runnable(){public void run(){if(token!=generation||!unlocked)return;
                if(rows!=null)putAll(movies,rows,"movie");else movies.clear();
                completeCatalog(token,problem);
            }});
        }});
        background.execute(new Runnable(){public void run(){
            JSONArray data=null;String error="";
            try{data=catalog.listPaged("aseel_series","?select=*&status=eq.published&rights_status=eq.approved&order=created_at.desc,id.asc");}
            catch(Exception e){error="مسلسلات: "+CatalogApi.describe(e);}
            final JSONArray rows=data;final String issue=error;
            ui.post(new Runnable(){public void run(){if(token!=generation||!unlocked)return;
                if(rows!=null)putAll(series,rows,"series");else series.clear();
                completeCatalog(token,issue);
            }});
        }});
        background.execute(new Runnable(){public void run(){
            JSONArray data=null;String error="";
            try{data=catalog.listPaged("aseel_channels","?select=*&status=eq.published"+
                "&or=(rights_status.eq.approved,and(rights_status.eq.pending,playback_mode.eq.official_link))"+
                "&order=display_order.asc,created_at.desc,id.asc");}
            catch(Exception e){error="قنوات: "+CatalogApi.describe(e);}
            // Resolve category IDs for ALL three libraries, not only channels.
            final java.util.HashMap<String,String> labels=new java.util.HashMap<String,String>();
            boolean categoriesLoaded=false;
            try{
                JSONArray categories=catalog.listPaged("aseel_categories",
                    "?select=id,name_ar&published=eq.true&order=id.asc");
                for(int i=0;i<categories.length();i++){
                    JSONObject category=categories.optJSONObject(i);
                    if(category!=null){
                        String id=value(category,"id"),name=value(category,"name_ar");
                        if(!id.isEmpty()&&!name.isEmpty())labels.put(id,name);
                    }
                }
                categoriesLoaded=true;
            }catch(Exception e){error+=(error.isEmpty()?"":" | ")+"تعذّر تحميل أسماء الفئات";}
            final boolean replaceLabels=categoriesLoaded;
            final JSONArray rows=data;final String issue=error;
            ui.post(new Runnable(){public void run(){if(token!=generation||!unlocked)return;
                categoryNames.clear();
                if(replaceLabels)categoryNames.putAll(labels);
                if(rows!=null)putAll(channels,rows,"channel");else channels.clear();
                channels.addAll(localChannels);sortChannels();
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
    private void applyCategoryNames(ArrayList<JSONObject> entries){
        for(JSONObject item:entries){
            String name=categoryNames.get(value(item,"category_id"));
            if(item.optBoolean("_local_iptv",false))continue;
            if(name==null)item.remove("category_name");
            else try{item.put("category_name",name);}catch(org.json.JSONException ignored){}
        }
    }
    private void completeCatalog(int token,String issue){
        if(token!=generation||!unlocked)return;
        if(issue!=null && issue.length()>0){
            lastLoadError=lastLoadError.length()==0?issue:lastLoadError+" | "+issue;
        }
        pendingRequests=Math.max(0,pendingRequests-1);
        loading=pendingRequests>0;
        if(!loading){
            if(episodeAlerts!=null)checkFollowedEpisodes(false);
            applyCategoryNames(movies);
            applyCategoryNames(series);
            applyCategoryNames(channels);
        }
        status.setText(loading?"◌ تحميل المكتبة...":lastLoadError.length()>0
            ?"⚠ بعض الأقسام غير متاحة":"● المكتبة متصلة");
        // Keep customer forms stable when asynchronous library updates arrive.
        if(!detailVisible && !loading && !"account".equals(section) &&
            !"profiles".equals(section) && !"settings".equals(section))render();
    }
    private void heading(String title,String note){
        TextView h=text(title,23,WHITE,true);content.addView(h,space(-1,-2,5));
        if(note!=null && note.length()>0)content.addView(text(note,13,MUTED,false),space(-1,-2,2));
    }
    /**
     * Focus stays attached to a semantic item instead of a recycled View instance.
     * Refreshing a shelf must never throw the remote user to another category.
     */
    private String focusedItemTag(){
        View focused=getCurrentFocus();
        if(focused==null||content==null)return "";
        View view=focused;
        while(view!=null && view!=content){
            if(view.getTag() instanceof String)return (String)view.getTag();
            if(!(view.getParent() instanceof View))break;
            view=(View)view.getParent();
        }
        return "";
    }
    private View findTagged(View parent,String tag){
        if(parent==null||tag==null||tag.length()==0)return null;
        if(tag.equals(parent.getTag()) && parent.isFocusable() && parent.getVisibility()==View.VISIBLE)
            return parent;
        if(parent instanceof ViewGroup){
            ViewGroup group=(ViewGroup)parent;
            for(int i=0;i<group.getChildCount();i++){
                View found=findTagged(group.getChildAt(i),tag);
                if(found!=null)return found;
            }
        }
        return null;
    }
    private void rebuildWatchedMedia(){
        watchedMedia.clear();
        for(JSONObject watch:PlaybackMemory.recent(this,PlaybackMemory.activeProfile(this))){
            String id=watch.optString("id","");
            if(id.length()>0&&!watchedMedia.containsKey("movie:"+id))
                watchedMedia.put("movie:"+id,watch);
            String showId=watch.optString("series_id","");
            if(showId.length()>0&&!watchedMedia.containsKey("series:"+showId))
                watchedMedia.put("series:"+showId,watch);
        }
    }
    private void render(){
        if(content==null)return;
        if(topProfileLabel!=null)topProfileLabel.setText(PlaybackMemory.displayProfile(this,
            PlaybackMemory.activeProfile(this)));
        if(detailVisible)episodeGeneration++;
        final boolean sameSection=section.equals(lastRenderedSection);
        final String focusTag=sameSection?focusedItemTag():"";
        final int previousScroll=(sameSection&&scroller!=null)?scroller.getScrollY():0;
        detailVisible=false;
        rebuildWatchedMedia();
        updateNav();
        content.removeAllViews();
        if("home".equals(section)){
            portal();
            showHomeLibrary();
        }else if("browse".equals(section)){
            ArrayList<JSONObject> matches=filteredBrowseItems();
            sectionSearchBar("ابحث داخل "+browseTitle,matches);
            if("channel".equals(browseKind))channelBrowse(browseTitle,matches);
            else grid(browseTitle,matches);
        }else if("movies".equals(section)){
            categoryDirectory("movie");
        }
        else if("series".equals(section)){
            categoryDirectory("series");
        }
        else if("live".equals(section)){
            categoryDirectory("channel");
        }
        else if("youtube".equals(section)){
            sectionSearchBar("ابحث في يوتيوب الأطفال",youtubeVideos);
            grid("مقاطع يوتيوب للأطفال",youtubeVideos);
        }
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
            sectionSearchBar("ابحث في عالم الأطفال",kids);
            grid("محتوى أطفال ملائم للشاشة",kids);
        }else if("favorites".equals(section)){
            showContinueWatching(false);
            ArrayList<JSONObject> list=new ArrayList<JSONObject>();
            for(JSONObject x:movies)if(isFavorite(x))list.add(x);
            for(JSONObject x:series)if(isFavorite(x))list.add(x);
            for(JSONObject x:channels)if(isFavorite(x))list.add(x);
            for(JSONObject x:youtubeVideos)if(isFavorite(x))list.add(x);
            sectionSearchBar("ابحث في قائمتي",list);
            grid("قائمتي",list);
        }else if("watching".equals(section)){
            heading("مشاهداتي","أكمل الأفلام والحلقات من الموضع الذي توقفت عنده");
            ArrayList<JSONObject> recentItems=new ArrayList<JSONObject>();
            for(JSONObject progress:PlaybackMemory.recent(this,PlaybackMemory.activeProfile(this))){
                String seriesId=progress.optString("series_id","");
                JSONObject item=findCatalogItem(seriesId.isEmpty()?progress.optString("id",""):seriesId,!seriesId.isEmpty());
                if(item!=null&&!recentItems.contains(item))recentItems.add(item);
            }
            sectionSearchBar("ابحث في سجل المشاهدة",recentItems);
            showContinueWatching(false);
            if(recentItems.isEmpty())heading("لا توجد مشاهدات بعد","ابدأ مشاهدة فيلم أو مسلسل ليظهر هنا.");
        }else if("search".equals(section))searchScreen();
        else if("settings".equals(section))settingsScreen();
        else if("account".equals(section))accountScreen();
        else if("profiles".equals(section))profilesScreen();
        if(!"home".equals(section)&&!"settings".equals(section)&&!"account".equals(section)&&!"profiles".equals(section)&&movies.size()+series.size()+channels.size()+youtubeVideos.size()==0){
            heading(loading?"جاري تحميل المكتبة...":"المكتبة لم تُحمّل",
                loading?"اتصل بالإنترنت، ستظهر البطاقات تلقائيًا.":"اضغط تحديث. "+lastLoadError);
            Button refresh=button("إعادة المحاولة");content.addView(refresh,space(dp(240),dp(60),4));
            refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){loadCatalog();}});
            refresh.requestFocus();
        }
        lastRenderedSection=section;
        if(!sameSection && "home".equals(section) && scroller!=null){
            scroller.post(new Runnable(){public void run(){
                View entry=findTagged(content,"nav:series");
                if(entry!=null && "home".equals(section))entry.requestFocus();
            }});
        }
        if(!sameSection && ("account".equals(section)||"profiles".equals(section))
            && scroller!=null){
            final String targetSection=section;
            final String desired="profiles".equals(targetSection)?
                "profile:"+PlaybackMemory.activeProfile(this):"nav:profiles";
            scroller.post(new Runnable(){public void run(){
                if(!targetSection.equals(section))return;
                View choice=findTagged(content,desired);
                if(choice!=null)choice.requestFocus();
            }});
        }
        ++renderGeneration;
        if(sameSection)restorePosition(focusTag,previousScroll);
        else if("movies".equals(section)||"series".equals(section)||"live".equals(section))
            restorePosition("directory:"+("movies".equals(section)?"movie":
                "series".equals(section)?"series":"channel")+":all",0);
    }
    private void restorePosition(final String tag,final int scroll){
        if(scroller==null)return;
        final int token=renderGeneration;
        scroller.post(new Runnable(){public void run(){
            if(!unlocked||detailVisible||token!=renderGeneration)return;
            View target=findTagged(content,tag);
            if(target!=null)target.requestFocus();
            scroller.scrollTo(0,scroll);
        }});
    }
    private void openBrowse(String kind,String mode,String key,String title){
        browseOrigin=section;
        browseOriginFocus=focusedItemTag();
        browseOriginScroll=scroller.getScrollY();
        browseKind=kind;
        browseMode=mode;
        browseKey=key;
        browseTitle=title;
        browsePage=0;
        goTo("browse");
        if("directory".equals(mode)){
            ArrayList<JSONObject> matches=filteredBrowseItems();
            if(!matches.isEmpty()){
                JSONObject first=matches.get(0);
                restorePosition(("channel".equals(kind)?"channel:":"item:"+kind+":")+value(first,"id"),0);
            }
        }
    }
    private void closeBrowse(){
        goTo(browseOrigin);
        if(!browseOriginFocus.isEmpty())restorePosition(browseOriginFocus,browseOriginScroll);
    }
    private int browseStart(int count){
        browsePage=Math.min(browsePage,Math.max(0,count-1)/BROWSE_PAGE_SIZE);
        return browsePage*BROWSE_PAGE_SIZE;
    }
    private void browsePageControls(final ArrayList<JSONObject> list){
        final int lastPage=(list.size()-1)/BROWSE_PAGE_SIZE;
        if(lastPage==0)return;
        LinearLayout controls=row();
        content.addView(controls,space(-1,dp(66),4));
        for(final int direction:new int[]{-1,1}){
            Button button=button(direction<0?"الصفحة السابقة":"الصفحة التالية");
            button.setEnabled(browsePage+direction>=0&&browsePage+direction<=lastPage);
            controls.addView(button,new LinearLayout.LayoutParams(0,dp(52),1));
            button.setOnClickListener(v->{
                browsePage+=direction;
                JSONObject first=list.get(browsePage*BROWSE_PAGE_SIZE);
                render();
                restorePosition(("channel".equals(browseKind)?"channel:":"item:"+browseKind+":")
                    +value(first,"id"),0);
            });
        }
        heading("صفحة "+(browsePage+1)+" من "+(lastPage+1),"");
    }
    private void rememberDetailOrigin(){
        if(!detailVisible){
            detailFocus=focusedItemTag();
            detailScroll=scroller.getScrollY();
        }
        detailVisible=true;
    }
    private void closeDetails(){
        detailVisible=false;
        episodeGeneration++;
        pendingResumeEpisodeId="";
        render();
        restorePosition(detailFocus,detailScroll);
    }
    /** Confirmation prevents accidental sign-out from a TV remote. */
    private void confirmLogout(){
        new android.app.AlertDialog.Builder(this)
            .setTitle("تسجيل الخروج")
            .setMessage("هل تريد تسجيل الخروج من هذا الجهاز؟ تبقى محفوظات الحساب وبروفايلاته على الجهاز.")
            .setNegativeButton("إلغاء",null)
            .setPositiveButton("تسجيل الخروج",new android.content.DialogInterface.OnClickListener(){
                public void onClick(android.content.DialogInterface d,int which){
                    unlocked=false;showingWelcome=true;
                    generation++;episodeGeneration++;localPlaylistGeneration++;
                    ui.removeCallbacks(entitlementGuard);
                    if(pendingFeature!=null)ui.removeCallbacks(pendingFeature);
                    LinearLayout wait=column();wait.setGravity(Gravity.CENTER);
                    wait.setBackgroundDrawable(new CinemaBackdropDrawable());
                    TextView note=text("جارٍ تسجيل الخروج...",21,WHITE,true);
                    note.setGravity(Gravity.CENTER);wait.addView(note);
                    setContentView(wait);
                    background.execute(new Runnable(){public void run(){
                        MemberAuth.logout(TVHomeActivity.this);
                        ui.post(new Runnable(){public void run(){
                            if(!isFinishing())showMemberLogin("تم تسجيل الخروج بنجاح.");
                        }});
                    }});
                }
            }).show();
    }
    private void accountScreen(){
        heading("حسابي","بيانات العميل والاشتراك وملفات المشاهدة على هذا الجهاز");
        LinearLayout panel=column();
        panel.setPadding(dp(23),dp(14),dp(23),dp(15));
        panel.setBackgroundDrawable(bg(0xFF231827,0xABDA4862,18));
        content.addView(panel,space(-1,-2,5));
        String login=MemberAuth.username(this);
        LinearLayout identity=row();
        FrameLayout avatar=new FrameLayout(this);
        avatar.setBackgroundDrawable(bg(0xFF732840,0xFFFF8EAA,17));
        ImageView avatarIcon=new ImageView(this);
        avatarIcon.setImageDrawable(new CinemaGlyph("account",0xFFFFCED8));
        avatar.addView(avatarIcon,new FrameLayout.LayoutParams(dp(37),dp(37),Gravity.CENTER));
        identity.addView(avatar,new LinearLayout.LayoutParams(dp(65),dp(65)));
        LinearLayout names=column();names.setPadding(dp(16),0,dp(16),0);
        names.addView(text(login.isEmpty()?"مشاهد العز TV":login,26,WHITE,true),space(-1,dp(42),1));
        names.addView(text("بروفايلك: "+PlaybackMemory.displayProfile(this,
            PlaybackMemory.activeProfile(this)),14,0xFFFFB6C5,false),space(-1,dp(30),1));
        identity.addView(names,new LinearLayout.LayoutParams(0,-2,1));
        panel.addView(identity,space(-1,dp(79),1));
        panel.addView(text("حساب مشاهدة مفعل  •  التحقق من الصلاحية تلقائيًا",
            14,0xFFD7BFC8,false),space(-1,-2,2));
        heading("الباقة الحالية",MemberAuth.planName(this));
        int days=MemberAuth.daysRemaining(this);
        String expiry=days<0?"لم يُحدد تاريخ انتهاء من الإدارة":days==0?
            "انتهت الصلاحية":"متبقي "+days+" يومًا";
        TextView deadline=text(expiry,23,days>=0&&days<=7?0xFFFFB35C:0xFFFF8496,true);
        content.addView(deadline,space(-1,dp(49),6));
        heading("الأجهزة المرتبطة","يراجع المسؤول الأجهزة المسجلة من لوحة الإدارة؛ لا نعرض عددًا غير مؤكد.");
        Button profiles=primaryButton("بروفايلات المشاهدة  •  "+PlaybackMemory.displayProfile(this,
            PlaybackMemory.activeProfile(this)));
        profiles.setTag("nav:profiles");
        content.addView(profiles,space(dp(380),dp(63),5));
        profiles.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            goTo("profiles");
        }});
        Button settings=button("تفضيلات التطبيق");
        content.addView(settings,space(dp(280),dp(57),4));
        settings.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            goTo("settings");
        }});
        Button logout=button("تسجيل الخروج من الحساب");
        logout.setTag("account:logout");
        content.addView(logout,space(dp(300),dp(59),4));
        logout.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            confirmLogout();
        }});
    }
    private void profilesScreen(){
        heading("من يشاهد الآن؟","بروفايلات شخصية مستقلة • أسماؤها محفوظة على الجهاز");
        final String active=PlaybackMemory.activeProfile(this);
        final String[] values={"personal","family","kids","guest"};
        final String[] descriptions={"مشاهدة شخصية","العائلة والمزامنة","عالم الأطفال","سجل الضيف"};
        HorizontalScrollView profileScroll=new HorizontalScrollView(this);
        profileScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout strip=row();strip.setGravity(Gravity.TOP);
        profileScroll.addView(strip,new HorizontalScrollView.LayoutParams(-2,-1));
        content.addView(profileScroll,space(-1,dp(214),4));
        for(int i=0;i<values.length;i++){
            final String profile=values[i];
            LinearLayout card=column();
            card.setPadding(dp(14),dp(12),dp(14),dp(10));
            card.setBackgroundDrawable(bg(active.equals(profile)?0xFF682239:0xFF241C29,
                active.equals(profile)?0xFFFF7389:0x886D4C5D,18));
            ImageView icon=new ImageView(this);
            icon.setImageDrawable(new CinemaGlyph("kids".equals(profile)?"kids":
                "guest".equals(profile)?"search":"personal".equals(profile)?"account":
                "favorites",0xFFFF8094));
            LinearLayout.LayoutParams symbol=new LinearLayout.LayoutParams(dp(52),dp(52));
            symbol.gravity=Gravity.CENTER_HORIZONTAL;
            card.addView(icon,symbol);
            TextView name=text(PlaybackMemory.displayProfile(this,profile),20,WHITE,true);
            name.setGravity(Gravity.CENTER);
            card.addView(name,space(-1,dp(39),1));
            TextView detail=text(descriptions[i],12,MUTED,false);detail.setGravity(Gravity.CENTER);
            card.addView(detail,space(-1,dp(32),1));
            Button choose=primaryButton(active.equals(profile)?"✓ البروفايل النشط":"اختيار");
            choose.setTag("profile:"+profile);
            card.addView(choose,space(-1,dp(47),1));
            choose.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                PlaybackMemory.setProfile(TVHomeActivity.this,profile);
                goTo("home");
            }});
            strip.addView(card,space(dp(213),dp(197),4));
        }
        heading("تخصيص الأسماء","يمكن تعديل اسم كل بروفايل بدون تغيير صلاحيات الاشتراك.");
        for(final String profile:values){
            Button change=button("✎  تعديل اسم "+PlaybackMemory.displayProfile(this,profile));
            change.setTag("profile:rename:"+profile);
            content.addView(change,space(-1,dp(52),3));
            change.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                final EditText input=new EditText(TVHomeActivity.this);
                input.setSingleLine(true);
                input.setText(PlaybackMemory.displayProfile(TVHomeActivity.this,profile));
                input.setSelectAllOnFocus(true);
                new android.app.AlertDialog.Builder(TVHomeActivity.this)
                    .setTitle("اسم بروفايل "+PlaybackMemory.profileName(profile))
                    .setView(input)
                    .setPositiveButton("حفظ",new android.content.DialogInterface.OnClickListener(){
                        public void onClick(android.content.DialogInterface d,int selected){
                            PlaybackMemory.renameProfile(TVHomeActivity.this,profile,
                                input.getText().toString());
                            render();
                        }
                    }).setNegativeButton("إلغاء",null).show();
            }});
        }
    }
    private void checkFollowedEpisodes(final boolean manual){
        if(episodeAlerts==null || !unlocked)return;
        ArrayList<JSONObject> followed=new ArrayList<JSONObject>();
        for(JSONObject x:series)if(isFavorite(x))followed.add(x);
        episodeAlerts.check(followed,PlaybackMemory.activeProfile(this),manual,
            new EpisodeAlerts.Listener(){public void onResult(String message){
                latestEpisodeAlert=message;
                if(manual)android.widget.Toast.makeText(TVHomeActivity.this,message,
                    android.widget.Toast.LENGTH_LONG).show();
                if("settings".equals(section))render();
            }});
    }
    public void remoteHome(){goTo("home");}
    private void showPhoneRemote(){
        try{
            final String url=PhoneRemote.start(this);
            PhoneRemote.setForeground(this);
            LinearLayout pane=column();
            pane.setPadding(dp(18),dp(16),dp(18),dp(14));
            pane.setGravity(Gravity.CENTER);
            ImageView image=new ImageView(this);
            image.setImageBitmap(PhoneRemote.qr(url));
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            pane.addView(image,new LinearLayout.LayoutParams(dp(260),dp(260)));
            TextView address=text(url.substring(0,url.indexOf("/#"))+"/",14,WHITE,false);
            address.setGravity(Gravity.CENTER);
            pane.addView(address,space(-1,dp(42),5));
            new android.app.AlertDialog.Builder(this)
                .setTitle("ريموت الجوال • QR")
                .setMessage("صوّر الرمز من الجوال المتصل بنفس شبكة التلفزيون. التحكم متاح لمدة 20 دقيقة، ويمكن إيقافه من الإعدادات. لا تشارك الرمز.")
                .setView(pane)
                .setPositiveButton("إغلاق",null)
                .show();
        }catch(Exception e){
            android.widget.Toast.makeText(this,"تعذر تشغيل ريموت الجوال: "+e.getMessage(),
                android.widget.Toast.LENGTH_LONG).show();
        }
    }
    private void settingsScreen(){
        heading("الإعدادات","تخصيص تجربة العز TV • التفضيلات محفوظة على هذا الجهاز فقط");
        heading("حساب المشاهدة","مسجل الدخول: "+MemberAuth.username(this));
        final int daysLeft=MemberAuth.daysRemaining(this);
        heading("اشتراكي",daysLeft<0?"الصلاحية الحالية يحددها المسؤول":daysLeft==0?
            "انتهت الصلاحية، جدّد اشتراكك":daysLeft<=7?
            "⚠ تنبيه: متبقي "+daysLeft+" يومًا فقط":"متبقي "+daysLeft+" يومًا على انتهاء الباقة");
        Button logout=button("تسجيل الخروج من الحساب");
        logout.setTag("settings:logout");
        content.addView(logout,space(-1,dp(58),6));
        logout.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            confirmLogout();
        }});
        final SharedPreferences prefs=getSharedPreferences(SETTINGS,MODE_PRIVATE);
        heading("اللغة  •  Language",UiLanguage.english(this)?"English interface • Left to right":"الواجهة العربية • من اليمين إلى اليسار");
        LinearLayout languages=row();content.addView(languages,space(-1,dp(59),4));
        for(final boolean english:new boolean[]{false,true}){
            Button choice=button((UiLanguage.english(this)==english?"✓  ":"")+(english?"English":"العربية"));
            languages.addView(choice,new LinearLayout.LayoutParams(0,dp(54),1));
            choice.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                if(UiLanguage.english(TVHomeActivity.this)==english)return;
                UiLanguage.set(TVHomeActivity.this,english);
                buildShell();render();
            }});
        }
        heading("تنبيهات الحلقات الجديدة",latestEpisodeAlert.isEmpty()?
            "تصل تنبيهات الأعمال المضافة إلى قائمتي عند فتح التطبيق أو تحديث المكتبة":latestEpisodeAlert);
        Button alertToggle=button((episodeAlerts.enabled()?"✓  ":"")+"تنبيهات الحلقات الجديدة");
        content.addView(alertToggle,space(-1,dp(57),4));
        alertToggle.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            episodeAlerts.setEnabled(!episodeAlerts.enabled());render();
        }});
        Button alertCheck=button("↻ فحص الحلقات الآن");
        content.addView(alertCheck,space(-1,dp(54),4));
        alertCheck.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            checkFollowedEpisodes(true);
        }});
        Button retrySources=button("↻ إعادة فحص المصادر المتعطلة");
        content.addView(retrySources,space(-1,dp(54),4));
        retrySources.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            SourceHealth.reset(TVHomeActivity.this);
            android.widget.Toast.makeText(TVHomeActivity.this,
                UiLanguage.english(TVHomeActivity.this)?"All sources available for retry":"تمت إعادة إتاحة المصادر للفحص عند تشغيلها",
                android.widget.Toast.LENGTH_LONG).show();
        }});
        final String active=PlaybackMemory.activeProfile(this);
        heading("ملفات المشاهدة","ملفات مستقلة للعائلة والأطفال والضيف داخل حسابك");
        Button manageProfiles=primaryButton("◉ إدارة البروفايلات");
        manageProfiles.setTag("nav:profiles");
        content.addView(manageProfiles,space(dp(285),dp(55),4));
        manageProfiles.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            goTo("profiles");
        }});
        LinearLayout profiles=row();content.addView(profiles,space(-1,-2,4));
        for(final String profile:new String[]{"personal","family","kids","guest"}){
            Button choice=button((active.equals(profile)?"✓ ":"")+PlaybackMemory.displayProfile(this,profile));
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
        Button sync=button((autoRefresh?"✓  ":"")+"تحديث الأفلام والمسلسلات والقنوات كل دقيقتين");
        content.addView(sync,space(-1,dp(62),6));
        sync.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            prefs.edit().putBoolean("auto_refresh",!prefs.getBoolean("auto_refresh",true)).apply();
            render();
        }});
        heading("إدارة التخزين","تنظيف الصور والملفات المؤقتة فقط — المفضلة والحسابات وتقدم المشاهدة تبقى محفوظة.");
        final long posters=PosterLoader.cachedBytes(this);
        Button cleanPosters=button("🧹 تنظيف بوسترات مؤقتة • "+String.format(Locale.US,"%.1f",posters/1048576.0)+" MB");
        content.addView(cleanPosters,space(-1,dp(58),5));
        cleanPosters.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            new android.app.AlertDialog.Builder(TVHomeActivity.this)
                .setTitle("حذف بوسترات التخزين المؤقت")
                .setMessage("لن تُحذف المفضلة أو سجلات المشاهدة أو بيانات الحساب. ستُحمّل الصور من جديد عند الحاجة.")
                .setPositiveButton("تنظيف",(d,w)->{
                    long bytes=PosterLoader.clearPosterCache(TVHomeActivity.this);
                    android.widget.Toast.makeText(TVHomeActivity.this,
                        "تم تحرير "+String.format(Locale.US,"%.1f",bytes/1048576.0)+" MB",android.widget.Toast.LENGTH_LONG).show();
                    render();
                }).setNegativeButton("إلغاء",null).show();
        }});
        Button clearTemporary=button("🗑 تنظيف بيانات المكتبة المؤقتة");
        content.addView(clearTemporary,space(-1,dp(55),4));
        clearTemporary.setOnClickListener(v->{
            new android.app.AlertDialog.Builder(TVHomeActivity.this)
                .setTitle("تنظيف بيانات المكتبة المؤقتة")
                .setMessage("سيتم تفريغ نسخة المكتبة المؤقتة وتنزيلها مجددًا. لن تتأثر المفضلة أو الحسابات أو سجل المشاهدة؛ يلزم اتصال بالإنترنت.")
                .setPositiveButton("تنظيف",(d,w)->{
                    getSharedPreferences("aseel_catalog_cache_v1",MODE_PRIVATE).edit().clear().apply();
                    java.io.File scratch=new java.io.File(getCacheDir(),"al-ezz-verify-update.apk");
                    if(scratch.isFile())scratch.delete();
                    android.widget.Toast.makeText(TVHomeActivity.this,
                        "تم تنظيف بيانات المكتبة المؤقتة",android.widget.Toast.LENGTH_LONG).show();
                    loadCatalog();
                }).setNegativeButton("إلغاء",null).show();
        });
        heading("الريموت عبر الجوال","امسح رمز QR بكاميرا الجوال المتصل بنفس الشبكة، ثم تحكم بالأسهم وOK والتشغيل.");
        Button phoneRemote=primaryButton("▦  عرض باركود ريموت الجوال");
        content.addView(phoneRemote,space(-1,dp(58),5));
        phoneRemote.setOnClickListener(v->showPhoneRemote());
        if(PhoneRemote.active()){
            Button revoke=button("✕ إلغاء اقتران الجوال الآن");
            content.addView(revoke,space(-1,dp(54),4));
            revoke.setOnClickListener(v->{PhoneRemote.stop();render();});
        }
        heading("إصدار التطبيق","تحديثات المحتوى تظهر دون تنزيل APK، أما تحديث التطبيق فيُنزّل ويُثبّت بعد موافقتك.");
        Button updateApp=primaryButton("↻ فحص إصدار APK جديد وتحديث التطبيق");
        updateApp.setTag("settings:app-update");
        content.addView(updateApp,space(-1,dp(60),5));
        updateApp.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            if(appUpdater!=null)appUpdater.check(true);
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
        Button developer=primaryButton("المطور  •  يوسف الحازمي");
        content.addView(developer,space(dp(290),dp(58),4));
        developer.setOnClickListener(new View.OnClickListener(){public void onClick(View v){goTo("developer");}});
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
            new int[]{0xFF642039,0xFF2A1623,0xFF11121B}));
        content.addView(hero,space(-1,dp(214),5));
        LinearLayout copy=column();
        copy.addView(text("أهلًا بك في العز TV",30,WHITE,true),space(-1,-2,3));
        copy.addView(text("اختر فيلمك أو مسلسلك أو قناتك مباشرة، وتحكم بالكامل بالريموت.",15,0xFFE1C9D1,false),space(-1,-2,3));
        TextView counts=text(movies.size()+" فيلم  •  "+series.size()+" مسلسل  •  "+channels.size()+" قناة  •  "+youtubeVideos.size()+" مقطع",13,0xFFFFBDCD,true);
        copy.addView(counts,space(-1,-2,4));
        Button explore=primaryButton("▶ استكشف الأفلام");copy.addView(explore,space(dp(245),dp(52),6));
        explore.setOnClickListener(new View.OnClickListener(){public void onClick(View v){section="movies";render();}});
        Button liveButton=primaryButton("● شاهد التلفزيون المباشر");
        copy.addView(liveButton,space(dp(275),dp(48),2));
        liveButton.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            section="live";render();scroller.scrollTo(0,0);
        }});
        hero.addView(copy,new LinearLayout.LayoutParams(0,-2,1));
        int logoId=getResources().getIdentifier("alizz_brand","drawable",getPackageName());
        if(logoId!=0){ImageView logo=new ImageView(this);logo.setImageResource(logoId);
            logo.setScaleType(ImageView.ScaleType.FIT_CENTER);hero.addView(logo,new LinearLayout.LayoutParams(dp(182),dp(158)));}
    }
    private ArrayList<JSONObject> filteredBrowseItems(){
        ArrayList<JSONObject> source="series".equals(browseKind)?series:
            "channel".equals(browseKind)?channels:movies;
        if("directory".equals(browseMode))
            return TvCategoryDirectory.filter(source,browseKind,browseKey);
        if("country".equals(browseMode))return originItems(source,browseKey);
        if("genre".equals(browseMode))return genreItems(source,browseKey);
        if("channelGenre".equals(browseMode)||"channelNetwork".equals(browseMode)){
            ArrayList<JSONObject> result=new ArrayList<JSONObject>();
            for(JSONObject channel:channels){
                String actual="channelGenre".equals(browseMode)?
                    channelCategory(channel):channelCompany(channel);
                if(browseKey.equals(actual))result.add(channel);
            }
            return result;
        }
        return new ArrayList<JSONObject>(source);
    }
    /** Live channel rows are computed from the feed; new networks and types need no new APK. */
    private void classifiedLiveShelves(){
        if(channels.isEmpty())return;
        shelf("كل القنوات المباشرة","تحديث تلقائي من قائمة القنوات",channels,12);
        java.util.LinkedHashMap<String,ArrayList<JSONObject>> genres=
            new java.util.LinkedHashMap<String,ArrayList<JSONObject>>();
        java.util.LinkedHashMap<String,ArrayList<JSONObject>> networks=
            new java.util.LinkedHashMap<String,ArrayList<JSONObject>>();
        for(JSONObject channel:channels){
            String genre=channelCategory(channel),network=channelCompany(channel);
            if(!genres.containsKey(genre))genres.put(genre,new ArrayList<JSONObject>());
            if(!networks.containsKey(network))networks.put(network,new ArrayList<JSONObject>());
            genres.get(genre).add(channel);
            networks.get(network).add(channel);
        }
        int count=0;
        for(java.util.Map.Entry<String,ArrayList<JSONObject>> entry:genres.entrySet()){
            if(count++>=6)break;
            shelf("قنوات "+entry.getKey(),"تصفح جميع قنوات التصنيف",entry.getValue(),12,
                "channelGenre",entry.getKey());
        }
        count=0;
        for(java.util.Map.Entry<String,ArrayList<JSONObject>> entry:networks.entrySet()){
            if(count++>=6)break;
            shelf("شبكة "+entry.getKey(),"تصفح جميع قنوات الشركة",entry.getValue(),12,
                "channelNetwork",entry.getKey());
        }
    }
    private void shelf(String name,String note,ArrayList<JSONObject> list,int limit){
        shelf(name,note,list,limit,"all","");
    }
    private void shelf(final String name,String note,ArrayList<JSONObject> list,
                       int limit,final String filter,final String filterKey){
        if(list.isEmpty())return;
        final String itemKind=kind(list.get(0));
        LinearLayout headingRow=row();
        TextView title=text(name+"  •  "+list.size(),23,WHITE,true);
        headingRow.addView(title,new LinearLayout.LayoutParams(0,dp(52),1));
        Button all=button("عرض الكل  ❯");
        all.setTag("shelf:all:"+name);
        headingRow.addView(all,space(dp(168),dp(49),3));
        content.addView(headingRow,space(-1,dp(62),4));
        content.addView(text(note,12,MUTED,false),space(-1,-2,3));
        all.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            openBrowse(itemKind,filter,filterKey,name);
        }});
        HorizontalScrollView scroll=new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout cards=row();cards.setGravity(Gravity.TOP);scroll.addView(cards);
        for(int i=0;i<list.size()&&i<limit;i++)cards.addView(card(list.get(i),true));
        content.addView(scroll,space(-1,dp(251),4));
    }

    /**
     * Category-directory is the entry point for films, series and live TV.
     * No long horizontal shelves here: only square category tiles, with ALL first.
     */
    private void categoryDirectory(final String mediaKind){
        final ArrayList<JSONObject> source="series".equals(mediaKind)?series:
            "channel".equals(mediaKind)?channels:movies;
        final String mediaTitle="series".equals(mediaKind)?"المسلسلات":
            "channel".equals(mediaKind)?"القنوات المباشرة":"الأفلام";
        heading("تصنيفات "+mediaTitle,
            "اختر مربع الفئة لعرض الأعمال المرتبطة بها • تُحدَّث التصنيفات تلقائيًا");
        sectionSearchBar("ابحث في "+mediaTitle,source);
        ArrayList<TvCategoryDirectory.Tile> tiles=TvCategoryDirectory.tiles(source,mediaKind);
        final int screen=screenWidthDp();
        final int columns=screen>=1250?6:screen>=950?5:screen>=670?4:screen>=460?3:2;
        final int gap=dp(5);
        final int side=(getResources().getDisplayMetrics().widthPixels-content.getPaddingLeft()
            -content.getPaddingRight()-2*gap*columns)/columns;
        for(int base=0;base<tiles.size();base+=columns){
            LinearLayout line=row();
            line.setGravity(Gravity.TOP);
            line.setLayoutDirection(UiLanguage.direction(this));
            for(int col=0;col<columns;col++){
                int index=base+col;
                if(index<tiles.size()){
                    final TvCategoryDirectory.Tile tile=tiles.get(index);
                    final LinearLayout square=column();
                    square.setFocusable(true);square.setClickable(true);
                    square.setTag("directory:"+mediaKind+":"+tile.key);
                    square.setContentDescription(tile.title+"، "+tile.count+
                        ("channel".equals(mediaKind)?" قناة":"series".equals(mediaKind)?" مسلسل":" فيلم"));
                    square.setGravity(Gravity.CENTER);
                    square.setPadding(dp(5),dp(5),dp(5),dp(5));
                    final int baseColor=index==0?0xFF431C30:0xFF1C1C2A;
                    square.setBackgroundDrawable(new CinemaNeonDrawable(baseColor,dp(18),false));
                    ImageView art=new ImageView(this);
                    art.setImageDrawable(new CinemaGlyph(tile.icon,0xFFFF9DB0));
                    art.setScaleType(ImageView.ScaleType.FIT_CENTER);
                    int iconSize=Math.min(dp(42),side/4);
                    square.addView(art,space(iconSize,iconSize,2));
                    TextView name=text(tile.title,18,WHITE,true);
                    name.setMaxLines(2);name.setGravity(Gravity.CENTER);
                    name.setEllipsize(TextUtils.TruncateAt.END);
                    square.addView(name,space(-1,-2,2));
                    TextView count=text(tile.count+("channel".equals(mediaKind)?" قناة":
                        "series".equals(mediaKind)?" مسلسل":" فيلم"),13,0xFFDAC0CA,false);
                    count.setGravity(Gravity.CENTER);
                    square.addView(count,space(-1,-2,1));
                    square.setOnFocusChangeListener(new View.OnFocusChangeListener(){
                        public void onFocusChange(View v,boolean focused){
                            square.setBackgroundDrawable(new CinemaNeonDrawable(
                                focused?0xFF8E2340:baseColor,dp(18),focused));
                            square.setScaleX(focused?1.025f:1f);
                            square.setScaleY(focused?1.025f:1f);
                        }
                    });
                    square.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                        browseMode="directory";
                        openBrowse(mediaKind,browseMode,tile.key,mediaTitle+" • "+tile.title);
                    }});
                    line.addView(square,space(side,side,5));
                }
            }
            content.addView(line,new LinearLayout.LayoutParams(-1,-2));
        }
        if(source.isEmpty())
            heading(loading?"تُحمّل الفئات الآن":"المكتبة فارغة حاليًا",
                loading?"ستظهر التصنيفات تلقائيًا عند اكتمال تحميلها.":
                "تظهر الفئات الجديدة بمجرد إضافة أعمال منشورة إلى لوحة الإدارة.");
    }
    private void channelBrowse(String title,ArrayList<JSONObject> list){
        heading(title,list.size()+" قناة في هذا التصنيف • اضغط OK للمشاهدة");
        if(list.isEmpty()){
            heading("لا توجد قنوات في هذا التصنيف","يمكن تغيير الفئة أو تحديث المكتبة.");
            return;
        }
        int start=browseStart(list.size());
        int end=Math.min(start+BROWSE_PAGE_SIZE,list.size());
        boolean paired=screenWidthDp()>=1000;
        LinearLayout pair=null;
        for(int i=start;i<end;i++){
            LinearLayout line=channelLine(list.get(i),channels.indexOf(list.get(i)));
            if(paired){
                if(i%2==0){
                    pair=row();content.addView(pair,space(-1,dp(92),3));
                }
                pair.addView(line,new LinearLayout.LayoutParams(0,dp(84),1));
            }else content.addView(line);
        }
        browsePageControls(list);
    }

    private JSONObject findCatalogItem(String id,boolean isSeries){
        if(id==null||id.isEmpty())return null;
        for(JSONObject x:isSeries?series:movies)if(id.equals(value(x,"id")))return x;
        return null;
    }
    private void showHomeLibrary(){
        ArrayList<JSONObject> latest=new ArrayList<JSONObject>(movies.size()+series.size());
        latest.addAll(movies);latest.addAll(series);
        java.util.Collections.sort(latest,new java.util.Comparator<JSONObject>(){
            @Override public int compare(JSONObject a,JSONObject b){
                return value(b,"created_at").compareTo(value(a,"created_at"));
            }
        });
        homeShelf("أحدث الإضافات",latest);
        ArrayList<JSONObject> picks=new ArrayList<JSONObject>();
        for(JSONObject item:latest)
            if(item.optBoolean("featured",false)&&picks.size()<12)picks.add(item);
        homeShelf("مختارات لك",picks);
        showLastChannel();
    }
    private void homeShelf(String title,ArrayList<JSONObject> entries){
        if(entries.isEmpty())return;
        heading(title,"");
        HorizontalScrollView scroll=new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout cards=row();
        scroll.addView(cards);
        for(int i=0;i<Math.min(entries.size(),12);i++)cards.addView(card(entries.get(i),true));
        content.addView(scroll,space(-1,dp(251),4));
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
    private String channelCompany(JSONObject x){return ChannelGuideCategory.broadcaster(x);}
    private void sortChannels(){
        final java.text.Collator alphabet=java.text.Collator.getInstance(new Locale("ar"));
        alphabet.setStrength(java.text.Collator.PRIMARY);
        java.util.Collections.sort(channels,new java.util.Comparator<JSONObject>(){
            public int compare(JSONObject first,JSONObject second){
                int order=alphabet.compare(label(first).trim(),label(second).trim());
                return order!=0?order:value(first,"id").compareTo(value(second,"id"));
            }
        });
    }
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
    private void showLastChannel(){
        String last=PlaybackMemory.lastChannel(this,PlaybackMemory.activeProfile(this));
        for(JSONObject channel:channels)if(last.equals(value(channel,"id"))){
            final JSONObject recent=channel;
            Button resume=button("▶ آخر قناة: "+label(channel));
            resume.setTag("home:last-channel");
            content.addView(resume,space(-1,dp(60),4));
            resume.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(recent);}});
            break;
        }
    }
    private void liveGuide(){
        activeChannelCategory=getSharedPreferences("alezz_tv_settings_v14",MODE_PRIVATE)
            .getString("live_selected_group",activeChannelCategory);
        activeChannelCompany=getSharedPreferences("alezz_tv_settings_v14",MODE_PRIVATE)
            .getString("live_selected_company",activeChannelCompany);
        heading("● تلفزيون العز المباشر",channels.size()+" قناة • اختر التصنيف، ثم اضغط OK للمشاهدة • MENU أثناء البث");
        if(channels.isEmpty()){
            heading("لا توجد قنوات منشورة","استخدم تحديث المكتبة أو راجع المصادر.");return;
        }
        showLastChannel();
        java.util.LinkedHashMap<String,Integer> companies=new java.util.LinkedHashMap<String,Integer>();
        companies.put("الكل",channels.size());
        for(JSONObject x:channels){
            String network=channelCompany(x);
            companies.put(network,companies.containsKey(network)?companies.get(network)+1:1);
        }
        if(!companies.containsKey(activeChannelCompany))activeChannelCompany="الكل";
        content.addView(text("الشركات والشبكات • اختر مثل MBC أو beIN SPORTS",14,0xFFE8C993,true),space(-1,-2,4));
        HorizontalScrollView companyScroll=new HorizontalScrollView(this);
        companyScroll.setHorizontalScrollBarEnabled(false);
        content.addView(companyScroll,space(-1,dp(60),3));
        LinearLayout companyFilters=row();companyScroll.addView(companyFilters);
        for(final String network:companies.keySet()){
            Button b=button((network.equals(activeChannelCompany)?"✓ ":"")+network+"  "+companies.get(network));
            b.setContentDescription("شبكة "+network+"، "+companies.get(network)+" قناة");
            b.setTag("company:"+network);
            companyFilters.addView(b,space(dp(168),dp(52),3));
            b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                activeChannelCompany=network;liveGuideLimit=48;
                getSharedPreferences("alezz_tv_settings_v14",MODE_PRIVATE).edit()
                    .putString("live_selected_company",network).apply();
                render();
            }});
        }
        content.addView(text("أنواع القنوات • رياضة، أخبار، أفلام، أطفال وغيرها",14,0xFFE8C993,true),space(-1,-2,4));
        java.util.LinkedHashMap<String,Integer> counts=new java.util.LinkedHashMap<String,Integer>();
        for(String group:new String[]{"أخبار","رياضة","أفلام","مسلسلات","أطفال",
                "وثائقيات","دينية","موسيقى","تعليمية","طبخ","منوعات","عامة"})
            counts.put(group,0);
        int favoriteCount=0;
        for(JSONObject x:channels){
            if(!"الكل".equals(activeChannelCompany) &&
                !activeChannelCompany.equals(channelCompany(x)))continue;
            String group=channelCategory(x);
            counts.put(group,counts.containsKey(group)?counts.get(group)+1:1);
            if(isFavorite(x))favoriteCount++;
        }
        java.util.LinkedHashSet<String> types=new java.util.LinkedHashSet<String>();
        types.add("الكل");
        if(favoriteCount>0)types.add("المفضلة");
        for(java.util.Map.Entry<String,Integer> entry:counts.entrySet())
            types.add(entry.getKey());
        if(!types.contains(activeChannelCategory))activeChannelCategory="الكل";
        HorizontalScrollView scroll=new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        content.addView(scroll,space(-1,dp(60),3));
        LinearLayout filters=row();scroll.addView(filters);
        for(final String type:types){
            int count="الكل".equals(type)?companies.get(activeChannelCompany):
                "المفضلة".equals(type)?favoriteCount:counts.get(type);
            Button b=button((type.equals(activeChannelCategory)?"✓ ":"")+type+"  "+count);
            b.setContentDescription("تصنيف "+type+"، "+count+" قناة");
            b.setTag("filter:"+type);
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
            boolean companyMatch="الكل".equals(activeChannelCompany) ||
                activeChannelCompany.equals(channelCompany(x));
            boolean match=companyMatch&&("الكل".equals(activeChannelCategory) ||
                ("المفضلة".equals(activeChannelCategory)&&isFavorite(x)) ||
                activeChannelCategory.equals(channelCategory(x)));
            if(!match)continue;
            matching++;
            if(displayed>=liveGuideLimit)continue;
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
        if(matching==0)heading("لا توجد قنوات متاحة حاليًا لهذا الاختيار","غيّر الشركة أو النوع، أو حدّث المصادر من لوحة الإدارة.");
        if(matching>displayed){
            final int remaining=matching-displayed;
            LinearLayout actions=row();content.addView(actions,space(-1,dp(61),5));
            Button more=button("＋ عرض المزيد ("+remaining+")");
            more.setTag("live:more");
            actions.addView(more,space(dp(275),dp(56),3));
            more.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                liveGuideLimit=Math.min(channels.size(),liveGuideLimit+48);render();
            }});
            Button all=primaryButton("عرض الكل • "+matching+" قناة  ❯");
            all.setTag("live:all");
            actions.addView(all,space(dp(290),dp(56),3));
            all.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                liveGuideLimit=channels.size();render();
            }});
        }
        // Every matching channel remains reachable through progressive paging.
    }
    private LinearLayout channelLine(final JSONObject channel,final int position){
        final LinearLayout line=row();
        line.setPadding(dp(16),dp(8),dp(16),dp(8));
        line.setFocusable(true);line.setClickable(true);
        line.setTag("channel:"+value(channel,"id"));
        line.setBackgroundDrawable(new CinemaNeonDrawable(0xFF172236,dp(15),false));
        LinearLayout.LayoutParams outer=space(-1,dp(83),4);
        line.setLayoutParams(outer);
        TextView number=text(String.format(Locale.US,"%03d",position+1),20,0xFFF3D293,true);
        number.setGravity(Gravity.CENTER);
        line.addView(number,new LinearLayout.LayoutParams(dp(59),-1));
        CinemaPosterView poster=new CinemaPosterView(this);poster.setScaleType(ImageView.ScaleType.FIT_CENTER);
        poster.setBackgroundDrawable(bg(0xFF1E2634,0,8));
        String image=value(channel,"poster_url");
        if(image.startsWith("https://"))PosterLoader.load(poster,image);
        line.addView(poster,new LinearLayout.LayoutParams(dp(76),dp(55)));
        LinearLayout information=column();information.setPadding(dp(14),0,dp(14),0);
        information.addView(text(label(channel),17,WHITE,true));
        information.addView(text("● "+channelCompany(channel)+"   •   "+channelCategory(channel),12,0xFF9FE2BF,false));
        String now=epgNow(channel),next=epgNext(channel);
        if(!now.isEmpty()||!next.isEmpty())information.addView(text(
            (!now.isEmpty()?"الآن: "+now:"")+(!next.isEmpty()?"  التالي: "+next:""),12,MUTED,false));
        line.addView(information,new LinearLayout.LayoutParams(0,-2,1));
        TextView action=text("▶  تشغيل",13,0xFFE6C786,true);
        line.addView(action,new LinearLayout.LayoutParams(dp(91),-1));
        line.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            public void onFocusChange(View v,boolean focused){
                line.setBackgroundDrawable(new CinemaNeonDrawable(focused?0xFF3D4E67:0xFF172236,dp(15),focused));
            }
        });
        line.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(channel);}});
        return line;
    }
    private void grid(String title,ArrayList<JSONObject> list){
        heading(title,list.size()+" عنوان متاح");
        if(list.isEmpty()){heading("لا يوجد محتوى منشور في هذا القسم","يمكن تحديث المكتبة أو إضافة أعمال من لوحة الإدارة.");return;}
        final boolean browsing="browse".equals(section);
        final int start=browsing?browseStart(list.size()):0;
        final int end=Math.min(list.size(),browsing?start+BROWSE_PAGE_SIZE:cardGridLimit);
        final int columns=screenWidthDp()>=1060?5:screenWidthDp()>=760?4:3;
        for(int base=start;base<end;base+=columns){
            LinearLayout row=row();row.setGravity(Gravity.TOP);
            for(int i=base;i<base+columns;i++)
                row.addView(i<end?card(list.get(i),false):new View(this),
                    new LinearLayout.LayoutParams(0,dp(248),1));
            content.addView(row,space(-1,-2,3));
        }
        if(browsing)browsePageControls(list);
        else if(list.size()>cardGridLimit){
            Button more=button("عرض المزيد  •  "+(list.size()-cardGridLimit)+" عنوان متبقي");
            more.setTag("grid:more");
            content.addView(more,space(-1,dp(56),5));
            more.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                cardGridLimit=Math.min(list.size(),cardGridLimit+72);render();
            }});
        }
    }
    private LinearLayout card(final JSONObject item,boolean wide){
        final LinearLayout outer=column();outer.setFocusable(true);outer.setClickable(true);
        outer.setTag("item:"+kind(item)+":"+value(item,"id"));
        outer.setBackgroundDrawable(new CinemaNeonDrawable(0xFF201C25,dp(19),false));
        outer.setPadding(dp(7),dp(7),dp(7),dp(7));
        LinearLayout.LayoutParams p=space(wide?dp(205):-1,dp(241),6);
        if(wide)outer.setLayoutParams(p);
        FrameLayout imageSurface=new FrameLayout(this);
        imageSurface.setBackgroundDrawable(new CinemaNeonDrawable(0xFF412335,dp(16),false));
        imageSurface.setPadding(dp(4),dp(4),dp(4),dp(4));
        imageSurface.setClipChildren(true);
        outer.addView(imageSurface,new LinearLayout.LayoutParams(-1,dp(159)));
        CinemaPosterView image=new CinemaPosterView(this);
        image.setScaleType("movie".equals(kind(item))||"series".equals(kind(item))
            ?ImageView.ScaleType.FIT_CENTER:ImageView.ScaleType.CENTER_CROP);
        image.setBackgroundDrawable(bg(0xFF412335,0,10));
        imageSurface.addView(image,new FrameLayout.LayoutParams(-1,-1));
        String poster=value(item,"poster_url");
        if(poster.length()==0)poster=value(item,"backdrop_url");
        if("youtube".equals(kind(item))){String clip=YouTubeLink.videoId(value(item,"youtube_url"));
            if(clip!=null)poster="https://i.ytimg.com/vi/"+clip+"/hqdefault.jpg";}
        if(poster.startsWith("https://"))PosterLoader.load(image,poster);
        String quality=value(item,"quality").toUpperCase(Locale.US);
        if(quality.contains("2160")||quality.contains("4K"))quality="4K";
        else if(quality.contains("1080"))quality="FHD";
        else if(quality.contains("720")||quality.contains("HD"))quality="HD";
        else quality="";
        if(!quality.isEmpty()){
            TextView badge=text(quality,11,WHITE,true);
            badge.setGravity(Gravity.CENTER);
            badge.setPadding(dp(7),0,dp(7),0);
            badge.setBackgroundDrawable(bg(0xCD7B182F,0x9CFF879C,8));
            FrameLayout.LayoutParams chip=new FrameLayout.LayoutParams(dp(53),dp(27),Gravity.TOP|Gravity.RIGHT);
            chip.setMargins(dp(7),dp(7),dp(7),0);
            imageSurface.addView(badge,chip);
        }
        String progressKey=("series".equals(kind(item))?"series:":"movie:")+value(item,"id");
        JSONObject watch=watchedMedia.get(progressKey);
        if(watch!=null){
            final long duration=watch.optLong("duration",0L);
            final long position=watch.optLong("position",0L);
            if(duration>0&&position>0&&position<duration){
                final float fraction=Math.min(1f,position/(float)duration);
                View progressView=new View(this){
                    private final android.graphics.Paint paint=new android.graphics.Paint(
                        android.graphics.Paint.ANTI_ALIAS_FLAG);
                    @Override protected void onDraw(android.graphics.Canvas c){
                        float width=getWidth(),height=getHeight();
                        paint.setColor(0xBB11131B);c.drawRect(0,0,width,height,paint);
                        paint.setColor(0xFFFB546D);c.drawRect(0,0,width*fraction,height,paint);
                    }
                };
                imageSurface.addView(progressView,new FrameLayout.LayoutParams(-1,dp(6),Gravity.BOTTOM));
                long minutes=(duration-position)/60000L;
                TextView marker=text("▶ متبقي "+minutes+" د",11,WHITE,true);
                marker.setGravity(Gravity.CENTER);
                marker.setPadding(dp(6),0,dp(6),0);
                marker.setBackgroundDrawable(bg(0xB71C1120,0x556E4F5F,8));
                FrameLayout.LayoutParams labelPosition=new FrameLayout.LayoutParams(
                    dp(114),dp(24),Gravity.BOTTOM|Gravity.RIGHT);
                labelPosition.bottomMargin=dp(9);
                labelPosition.rightMargin=dp(4);
                imageSurface.addView(marker,labelPosition);
            }
        }
        TextView title=text(label(item),15,WHITE,true);title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);outer.addView(title,space(-1,dp(47),3));
        if("series".equals(kind(item))&&isFavorite(item)){
            int count=item.optInt("episode_count",-1);
            int seen=PlaybackMemory.seenEpisodeCount(this,PlaybackMemory.activeProfile(this),value(item,"id"));
            if(seen>=0&&count>seen)outer.addView(text("● حلقة جديدة",12,0xFF44C892,true));
        }
        String desc="channel".equals(kind(item))?("official_link".equals(value(item,"playback_mode"))?"↗ مشاهدة خارجية":"● مباشر"):"series".equals(kind(item))?"▤ مسلسل":"youtube".equals(kind(item))?"▶ يوتيوب":"▶ فيلم";
        outer.addView(text(desc,12,0xFFFF8DA6,false));
        outer.setOnFocusChangeListener(new View.OnFocusChangeListener(){public void onFocusChange(View v,boolean focused){
            outer.setBackgroundDrawable(new CinemaNeonDrawable(focused?0xFF79203A:0xFF201C25,dp(19),focused));
            outer.setScaleX(focused?1.015f:1);outer.setScaleY(focused?1.015f:1);
            if(focused&&"home".equals(section))scheduleFeatured(item);
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
        rememberDetailOrigin();
        content.removeAllViews();
        heading(label(item),"channel".equals(kind(item))?("official_link".equals(value(item,"playback_mode"))?"↗ صفحة مشاهدة خارجية":"● قناة مباشرة"):"فيلم • مشاهدة مباشرة");
        LinearLayout hero=row();content.addView(hero,space(-1,dp(240),7));
        CinemaPosterView poster=new CinemaPosterView(this);poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        hero.addView(poster,new LinearLayout.LayoutParams(dp(190),dp(235)));
        String image=value(item,"poster_url");if(image.startsWith("https://"))PosterLoader.load(poster,image);
        LinearLayout info=column();hero.addView(info,new LinearLayout.LayoutParams(0,-1,1));
        info.addView(text(value(item,"description"),16,MUTED,false),space(-1,-2,9));
        Button play=primaryButton("official_link".equals(value(item,"playback_mode"))?"↗ فتح صفحة المشاهدة":"▶ ابدأ المشاهدة");
        info.addView(play,space(dp(260),dp(56),7));
        play.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(item);}});
        Button favorite=button(isFavorite(item)?"♥ إزالة من قائمتي":"♡ أضف إلى قائمتي");
        info.addView(favorite,space(dp(260),dp(50),7));
        favorite.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            toggleFavorite(item);favorite.setText(isFavorite(item)?"♥ إزالة من قائمتي":"♡ أضف إلى قائمتي");
        }});
        Button back=button("رجوع إلى القسم");
        info.addView(back,space(dp(260),dp(50),7));
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){closeDetails();}});
        play.requestFocus();
    }
    private void episodes(final JSONObject show){
        rememberDetailOrigin();
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
                int chosenSeason=1;
                if(!episodes.isEmpty())chosenSeason=episodes.get(0).optInt("_season",1);
                JSONObject lastEpisode=null;
                for(JSONObject progress:PlaybackMemory.recent(TVHomeActivity.this,
                        PlaybackMemory.activeProfile(TVHomeActivity.this))){
                    if(seriesId.equals(progress.optString("series_id",""))){
                        for(JSONObject ep:episodes)if(value(ep,"id").equals(progress.optString("id",""))){
                            lastEpisode=ep;break;
                        }
                        if(lastEpisode!=null)break;
                    }
                }
                if(lastEpisode!=null)chosenSeason=lastEpisode.optInt("_season",chosenSeason);
                renderSeriesSeason(show,episodes,chosenSeason,true);
            }});
        }});
    }
    /** A single stable seasons screen; selecting a capsule never refetches or reorders data. */
    private void renderSeriesSeason(final JSONObject show,final ArrayList<JSONObject> entries,
                                    final int selectedSeason,final boolean initial){
        if(!detailVisible)return;
        final String seriesId=value(show,"id");
        content.removeAllViews();
        FrameLayout backdrop=new FrameLayout(this);
        backdrop.setBackgroundDrawable(bg(0xFF261421,0xA66F4759,18));
        backdrop.setClipChildren(true);
        ImageView cover=new ImageView(this);cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        String source=value(show,"backdrop_url");
        if(source.isEmpty())source=value(show,"poster_url");
        if(source.startsWith("https://"))PosterLoader.load(cover,source);
        cover.setAlpha(.46f);
        backdrop.addView(cover,new FrameLayout.LayoutParams(-1,-1));
        View dim=new View(this);
        dim.setBackgroundDrawable(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{0x90100A12,0xBB120B15,0xF0150C17}));
        backdrop.addView(dim,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout intro=column();intro.setPadding(dp(25),dp(13),dp(25),dp(10));
        intro.addView(text("العز TV  •  مكتبة المسلسلات",13,0xFFFF7C91,true));
        TextView name=text(label(show),29,WHITE,true);name.setMaxLines(2);
        intro.addView(name,space(-1,dp(63),2));
        String description=value(show,"description");
        if(description.length()>140)description=description.substring(0,140)+"…";
        intro.addView(text(description.isEmpty()?"استمتع بمواسم وحلقات هذا المسلسل":description,
            14,0xFFF1D9E0,false),space(-1,dp(54),2));
        FrameLayout.LayoutParams introPos=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        backdrop.addView(intro,introPos);
        content.addView(backdrop,space(-1,dp(204),5));

        java.util.LinkedHashSet<Integer> seasonNumbers=new java.util.LinkedHashSet<Integer>();
        for(JSONObject ep:entries)seasonNumbers.add(ep.optInt("_season",1));
        TextView subtitle=text("المواسم والحلقات  •  "+seasonNumbers.size()+" موسم  •  "+
            entries.size()+" حلقة",17,WHITE,true);
        content.addView(subtitle,space(-1,dp(40),6));
        HorizontalScrollView seasonsScroll=new HorizontalScrollView(this);
        seasonsScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout chips=row();
        chips.setFocusable(false);chips.setPadding(dp(4),0,dp(4),0);
        seasonsScroll.addView(chips,new HorizontalScrollView.LayoutParams(-2,-1));
        content.addView(seasonsScroll,space(-1,dp(67),3));
        View selectedChip=null;
        for(final Integer no:seasonNumbers){
            final Button capsule=button("الموسم "+no);
            capsule.setTag("season:"+no);
            capsule.setContentDescription("عرض حلقات الموسم "+no);
            if(no.intValue()==selectedSeason){
                capsule.setBackgroundDrawable(new CinemaGlassButtonDrawable(true,true,0xFF87283B));
                selectedChip=capsule;
            }
            chips.addView(capsule,space(dp(156),dp(53),4));
            capsule.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                renderSeriesSeason(show,entries,no.intValue(),false);
            }});
        }
        String lastEpisodeId="";
        for(JSONObject record:PlaybackMemory.recent(this,PlaybackMemory.activeProfile(this))){
            if(seriesId.equals(record.optString("series_id",""))){
                lastEpisodeId=record.optString("id","");break;
            }
        }
        int count=0;
        View firstEpisode=null,lastWatched=null;
        for(final JSONObject ep:entries){
            if(ep.optInt("_season",1)!=selectedSeason)continue;
            count++;
            final String id=value(ep,"id");
            final boolean resume=id.equals(lastEpisodeId);
            final JSONObject saved=PlaybackMemory.entry(this,PlaybackMemory.activeProfile(this),id);
            int number=ep.optInt("number",count);
            long minutes=ep.optLong("duration_minutes",0L);
            if(minutes<=0)minutes=ep.optLong("runtime_minutes",0L);
            final LinearLayout card=row();
            card.setPadding(dp(10),dp(7),dp(10),dp(7));
            card.setFocusable(true);card.setClickable(true);
            card.setTag("episode:"+id);
            card.setBackgroundDrawable(new CinemaNeonDrawable(resume?0xFF532039:0xFF241C28,dp(17),resume));
            CinemaPosterView thumb=new CinemaPosterView(this);
            thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
            thumb.setBackgroundDrawable(bg(0xFF402333,0,9));
            String image=value(ep,"poster_url");
            if(image.isEmpty())image=value(show,"poster_url");
            if(image.startsWith("https://"))PosterLoader.load(thumb,image);
            card.addView(thumb,new LinearLayout.LayoutParams(dp(106),dp(69)));
            LinearLayout info=column();info.setPadding(dp(12),0,dp(12),0);
            TextView title=text("الحلقة "+number+"  •  "+label(ep),16,WHITE,true);
            title.setSingleLine(true);title.setEllipsize(TextUtils.TruncateAt.END);
            info.addView(title,space(-1,dp(30),0));
            String durationLabel=minutes>0?("  •  "+minutes+" دقيقة"):"";
            info.addView(text(resume?"● آخر حلقة شاهدتها"+durationLabel:
                "الموسم "+selectedSeason+durationLabel,12,resume?0xFFFF8999:MUTED,false));
            if(saved!=null&&saved.optLong("duration")>0){
                long duration=saved.optLong("duration"),position=saved.optLong("position");
                int percent=(int)Math.min(100,100L*position/duration);
                if(percent>0&&percent<100)
                    info.addView(text("متابعة المشاهدة  •  "+percent+"٪",12,0xFFFF8999,false));
            }
            card.addView(info,new LinearLayout.LayoutParams(0,-2,1));
            ImageView action=new ImageView(this);
            action.setImageDrawable(new CinemaGlyph("play",0xFFFF8798));
            card.addView(action,new LinearLayout.LayoutParams(dp(30),dp(30)));
            card.setOnFocusChangeListener(new View.OnFocusChangeListener(){
                public void onFocusChange(View v,boolean focused){
                    card.setBackgroundDrawable(new CinemaNeonDrawable(focused?0xFF75243E:resume?0xFF532039:0xFF241C28,dp(17),focused||resume));
                    card.setScaleX(focused?1.018f:1f);card.setScaleY(focused?1.018f:1f);
                }
            });
            card.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(ep);}});
            content.addView(card,space(-1,dp(88),3));
            if(firstEpisode==null)firstEpisode=card;
            if(resume)lastWatched=card;
        }
        if(count==0)heading("لا توجد حلقات في هذا الموسم","اختر موسمًا آخر.");
        Button back=button("العودة إلى قائمة المسلسلات");
        back.setTag("series:back");
        content.addView(back,space(dp(290),dp(55),5));
        back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
            closeDetails();
        }});
        final View focusTarget=initial?(lastWatched!=null?lastWatched:
            firstEpisode!=null?firstEpisode:selectedChip):selectedChip;
        if(focusTarget!=null)focusTarget.requestFocus();
        if(scroller!=null&&!initial)scroller.scrollTo(0,0);
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
            String external=value(item,"official_url");
            if(!CatalogApi.officialChannelLink(external)){
                heading("صفحة المصدر غير متاحة","هذه القناة لا تملك رابط صفحة مشاهدة خارجيًا صالحًا.");
                return;
            }
            try {
                startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,
                    android.net.Uri.parse(external)));
            } catch(android.content.ActivityNotFoundException e){
                heading("تعذّر فتح المصدر الخارجي","ثبّت متصفحًا متوافقًا على جهاز Android TV.");
            }
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
        PlaybackSources.Source chosenSource=available.get(PlaybackSources.preferred(available));
        String url=chosenSource.url;
        String sourceList=PlaybackSources.encode(available);
        if("youtube".equals(chosenSource.kind) && available.size()==1 && !kidsMode){
            openYouTube(item);return;
        }
        if("embed".equals(chosenSource.kind)||"youtube".equals(chosenSource.kind)){
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
            java.util.List<JSONObject> sourceItems="episode".equals(kind(item))?episodeQueue:
                java.util.Collections.singletonList(item);
            int queueStart=Math.max(0,sourceItems.indexOf(item)-20);
            for(int i=queueStart;i<Math.min(sourceItems.size(),queueStart+60);i++){
                JSONObject candidate=sourceItems.get(i);
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
                    record.put("poster",value(candidate,"poster_url"));
                    record.put("youtube_url",value(candidate,"youtube_url"));
                    record.put("series_id",value(candidate,"_series_id"));
                    record.put("url",candidateUrl);
                    record.put("quality",value(candidate,"quality"));
                    record.put("variants",new JSONArray(variants));
                    if(value(candidate,"id").equals(value(item,"id")))currentIndex=mediaQueue.length();
                    mediaQueue.put(record);
                }catch(Exception ignored){}
                if(mediaQueue.toString().length()>90000)break;
            }
            intent.putExtra("media_playlist",mediaQueue.toString());
            intent.putExtra("media_start",currentIndex);
            intent.putExtra("media_kind",kind(item));
        }
        if("channel".equals(kind(item))){
            intent.putExtra("channel_group","live".equals(section)?activeChannelCategory:"الكل");
            intent.putExtra("channel_company","live".equals(section)?activeChannelCompany:"الكل");
            JSONArray playlist=new JSONArray();
            int selected=0;
            // Keep Android Binder intents below the transaction limit for large local IPTV lists.
            ArrayList<JSONObject> availableChannels="browse".equals(section)&&"channel".equals(browseKind)
                ?filteredBrowseItems():channels;
            int selectedGlobal=availableChannels.indexOf(item);
            int from=Math.max(0,selectedGlobal-75);
            int to=Math.min(availableChannels.size(),Math.max(from+150,selectedGlobal+76));
            for(int channelIndex=from;channelIndex<to;channelIndex++){
                JSONObject candidate=availableChannels.get(channelIndex);
                if(kidsMode && !kidsDirect(candidate))continue;
                if("live".equals(section) && !value(candidate,"id").equals(value(item,"id"))){
                    if(!"الكل".equals(activeChannelCompany) &&
                        !activeChannelCompany.equals(channelCompany(candidate)))continue;
                    if(!"الكل".equals(activeChannelCategory) &&
                        !("المفضلة".equals(activeChannelCategory)&&isFavorite(candidate)) &&
                        !activeChannelCategory.equals(channelCategory(candidate)))continue;
                }
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
                    record.put("company",channelCompany(candidate));
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
    /** Search is restricted to the current screen's catalog, never other sections. */
    private void sectionSearchBar(String hint,final ArrayList<JSONObject> source){
        LinearLayout controls=row();
        controls.setGravity(Gravity.CENTER_VERTICAL);
        content.addView(controls,space(-1,dp(65),5));
        final EditText input=new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(17);
        input.setTextColor(WHITE);
        input.setHintTextColor(MUTED);
        input.setHint(hint);
        input.setBackgroundDrawable(bg(PANEL,RED,12));
        input.setPadding(dp(16),0,dp(16),0);
        controls.addView(input,new LinearLayout.LayoutParams(0,dp(55),1));
        final LinearLayout results=column();
        Button find=button("⌕ بحث");
        controls.addView(find,space(dp(132),dp(54),5));
        content.addView(results,space(-1,-2,4));
        final Runnable perform=new Runnable(){public void run(){
            results.removeAllViews();
            String query=input.getText().toString().trim().toLowerCase(Locale.ROOT);
            if(query.isEmpty())return;
            int count=0;
            for(final JSONObject item:source){
                if(!label(item).toLowerCase(Locale.ROOT).contains(query))continue;
                final Button match=button(label(item));
                results.addView(match,space(-1,dp(51),3));
                match.setOnClickListener(new View.OnClickListener(){public void onClick(View v){
                    ((InputMethodManager)getSystemService(Context.INPUT_METHOD_SERVICE))
                        .hideSoftInputFromWindow(input.getWindowToken(),0);
                    detail(item);
                }});
                if(++count>=40)break;
            }
            if(count==0)results.addView(text("لا توجد نتائج في هذا القسم",15,MUTED,false));
        }};
        find.setOnClickListener(new View.OnClickListener(){public void onClick(View v){perform.run();}});
        input.setOnEditorActionListener(new TextView.OnEditorActionListener(){
            public boolean onEditorAction(TextView v,int actionId,KeyEvent event){
                perform.run();return true;
            }
        });
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
            closeDetails();return true;
        }
        if(code==KeyEvent.KEYCODE_BACK && "browse".equals(section)){
            closeBrowse();return true;
        }
        if(code==KeyEvent.KEYCODE_BACK && !"home".equals(section)){
            goTo("home");return true;
        }
        // MENU is contextual, not a shortcut that teleports the viewer to live TV.
        if(code==KeyEvent.KEYCODE_MENU||code==KeyEvent.KEYCODE_GUIDE){
            if("live".equals(section))return super.onKeyDown(code,event);
            return true;
        }
        if("live".equals(section) && !(getCurrentFocus() instanceof EditText) && !channels.isEmpty()){
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
        PhoneRemote.setForeground(this);
        ui.removeCallbacks(featureRotation);
        if("home".equals(section))ui.postDelayed(featureRotation,10000L);
        if(unlocked){
            ui.removeCallbacks(entitlementGuard);
            ui.post(entitlementGuard);
        }
        if(unlocked && !getSharedPreferences(SETTINGS,MODE_PRIVATE).getString("iptv_m3u","").isEmpty()
            && android.os.SystemClock.elapsedRealtime()-lastLocalPlaylistRefreshAt>45L*60L*1000L){
            refreshLocalPlaylist(false);
        }
        if(unlocked){
            ui.removeCallbacks(libraryHeartbeat);
            ui.postDelayed(libraryHeartbeat,30000L);
        }
        if(appUpdater!=null)appUpdater.onResume();
        if(unlocked && !loading && getSharedPreferences(SETTINGS,MODE_PRIVATE).getBoolean("auto_refresh",true)
            && android.os.SystemClock.elapsedRealtime()-lastCatalogRefreshAt>=CATALOG_REFRESH_INTERVAL_MS){
            loadCatalog();
        }
    }
    @Override protected void onPause(){
        PhoneRemote.clearForeground(this);
        if(appUpdater!=null)appUpdater.onPause();
        ui.removeCallbacks(featureRotation);
        ui.removeCallbacks(entitlementGuard);
        ui.removeCallbacks(libraryHeartbeat);
        super.onPause();
    }
    @Override protected void onDestroy(){
        PhoneRemote.stop();
        ui.removeCallbacks(entitlementGuard);
        if(appUpdater!=null)appUpdater.stop();
        generation++;episodeGeneration++;localPlaylistGeneration++;unlocked=false;background.shutdownNow();ui.removeCallbacks(remoteChannelCommit);ui.removeCallbacksAndMessages(null);
        if(episodeAlerts!=null)episodeAlerts.shutdown();
        super.onDestroy();
    }
}
