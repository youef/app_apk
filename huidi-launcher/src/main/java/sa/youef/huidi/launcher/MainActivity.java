package sa.youef.huidi.launcher;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.IntentFilter;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiManager;
import android.content.pm.ResolveInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RadialGradient;
import android.graphics.Rect;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.BatteryManager;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.Collator;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.io.File;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Huidi Home: a stand-alone, offline Android TV HOME launcher.
 * Native widgets, no WebView, no Internet permission, and no heavy bitmap wallpaper.
 * Designed for API 19/ARMv7 televisions with limited free RAM.
 */
public final class MainActivity extends Activity {
    private static final int BG = 0xFF080E18, PANEL = 0xE7192635, WHITE = 0xFFF7F7F3;
    private static final int MUTED = 0xFFB8C4D4, PALE = 0xFFF5D8A6;
    private static final int GLASS = 0xDA172434, GLASS_EDGE = 0x556F829B;
    // KitKat-safe translucent gradients (not unsupported RenderEffect blur).
    private final Handler clockHandler = new Handler();
    private final ArrayList<AppEntry> apps = new ArrayList<AppEntry>();
    private SharedPreferences prefs;
    private AppPinGate pinGate;
    private String page = "home";
    private TextView clockView;
    private AppEntry focusedApp;
    private boolean showAllApps;
    private int accent;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (clockView != null) {
                SimpleDateFormat formatter = new SimpleDateFormat("HH:mm  •  EEEE", new Locale("ar", "SA"));
                clockView.setText(formatter.format(new Date()));
            }
            clockHandler.postDelayed(this, 30000L);
        }
    };

    private static final class AppEntry {
        String label;
        String pkg;
        String activity;
        AppEntry(String label, String pkg, String activity) {
            this.label = label; this.pkg = pkg; this.activity = activity;
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        prefs = getSharedPreferences("huidi_home_prefs_v1", MODE_PRIVATE);
        pinGate = new AppPinGate(this);
        refreshApps();
        render("home");
    }

    @Override protected void onResume() {
        super.onResume();
        refreshApps();
        render(page);
        clockHandler.removeCallbacks(tick);
        clockHandler.post(tick);
    }

    @Override protected void onPause() {
        clockHandler.removeCallbacks(tick);
        super.onPause();
    }

    private int dp(float size) {
        return Math.round(size * getResources().getDisplayMetrics().density);
    }
    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }
    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        return layout;
    }
    private LinearLayout.LayoutParams lp(int w, int h, int margin) {
        LinearLayout.LayoutParams param = new LinearLayout.LayoutParams(w < 0 ? w : dp(w), h < 0 ? h : dp(h));
        param.setMargins(dp(margin), dp(margin), dp(margin), dp(margin));
        return param;
    }
    private TextView text(String value, int sp, int color, boolean bold) {
        TextView label = new TextView(this);
        label.setText(value);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        label.setTextColor(color);
        label.setGravity(Gravity.CENTER_VERTICAL);
        label.setSingleLine(false);
        if (bold) label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return label;
    }
    private static int mix(int a, int b, float ratio, int opacity) {
        float inverse = 1f - ratio;
        int red = (int)(Color.red(a) * inverse + Color.red(b) * ratio);
        int green = (int)(Color.green(a) * inverse + Color.green(b) * ratio);
        int blue = (int)(Color.blue(a) * inverse + Color.blue(b) * ratio);
        return Color.argb(opacity, red, green, blue);
    }
    /** Simulated premium glass: efficient KitKat native gradients, outline and sheen. */
    private GradientDrawable panel(int color, int stroke, int radius) {
        boolean plain = color == PANEL || color == GLASS || color == 0xCC151D30;
        int tint = plain ? 0xFF152133 : mix(0xFF152133, color, 0.14f, 255);
        GradientDrawable drawable = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] {mix(tint, 0xFF91A1B7, 0.15f, 237), mix(tint, BG, 0.16f, 231),
                mix(tint, BG, 0.37f, 237)});
        drawable.setCornerRadius(dp(radius));
        drawable.setStroke(dp(1), stroke == GLASS_EDGE ? 0x556A7D98 : stroke);
        return drawable;
    }
    private GradientDrawable heroDrawable() {
        GradientDrawable hero = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] {mix(0xFF312735, accent, 0.21f, 255), 0xFF1D2939, 0xFF101A2C});
        hero.setCornerRadius(dp(23));
        hero.setStroke(dp(1), mix(accent, 0xFFFFFFFF, 0.1f, 132));
        return hero;
    }
    
    private int currentAccent() {
        String color = prefs.getString("theme", "gold");
        if ("red".equals(color)) return 0xFFE04759;
        if ("blue".equals(color)) return 0xFF58C8F8;
        if ("violet".equals(color)) return 0xFFB39AFF;
        if ("emerald".equals(color)) return 0xFF53E0BB;
        if ("rose".equals(color)) return 0xFFFB8FB0;
        return 0xFFFFC76D;
    }
    private boolean lite() {
        return prefs.getBoolean("lite", Build.VERSION.SDK_INT <= 19);
    }
    private Set<String> favorites() {
        return new HashSet<String>(prefs.getStringSet("favorite_packages", Collections.<String>emptySet()));
    }

    private void addLaunchable(MapCollector collector, String category) {
        Intent filter = new Intent(Intent.ACTION_MAIN);
        filter.addCategory(category);
        PackageManager pm = getPackageManager();
        List<ResolveInfo> matches;
        try { matches = pm.queryIntentActivities(filter, 0); }
        catch (RuntimeException error) { return; }
        for (ResolveInfo candidate : matches) {
            if (candidate.activityInfo == null) continue;
            String packageName = candidate.activityInfo.packageName;
            if (packageName == null || packageName.equals(getPackageName())) continue;
            String activityName = candidate.activityInfo.name;
            if (activityName == null) continue;
            String label = String.valueOf(candidate.loadLabel(pm));
            if (label.trim().length() == 0) label = packageName;
            if (!collector.byPackage.containsKey(packageName)) {
                collector.byPackage.put(packageName, new AppEntry(label, packageName, activityName));
            }
        }
    }
    private static final class MapCollector {
        final HashMap<String, AppEntry> byPackage = new HashMap<String, AppEntry>();
    }
    private void refreshApps() {
        MapCollector found = new MapCollector();
        addLaunchable(found, Intent.CATEGORY_LAUNCHER);
        addLaunchable(found, "android.intent.category.LEANBACK_LAUNCHER");
        apps.clear();
        apps.addAll(found.byPackage.values());
        final Collator collator = Collator.getInstance(new Locale("ar", "SA"));
        Collections.sort(apps, new Comparator<AppEntry>() {
            @Override public int compare(AppEntry left, AppEntry right) {
                return collator.compare(left.label, right.label);
            }
        });
    }
    private AppEntry lookup(String packageHint, String labelHint) {
        for (AppEntry app : apps) if (app.pkg.equalsIgnoreCase(packageHint)) return app;
        for (AppEntry app : apps) {
            String name = app.label.toLowerCase(Locale.US);
            if (name.contains(labelHint.toLowerCase(Locale.US))) return app;
        }
        return null;
    }
    private AppEntry alezz() {
        AppEntry app = lookup("sa.alezz.tv", "العز");
        if (app == null) app = lookup("sa.alezz.tv.redclassic.local", "al ezz");
        return app;
    }
    private void openApp(AppEntry app) {
        if (app == null) { render("apps"); return; }
        if (pinGate.isLocked(app.pkg)) {
            numericPin("فتح " + app.label, new PinAction() {
                @Override public void onPin(String code) {
                    if (pinGate.verify(code)) launchAppDirect(app);
                    else Toast.makeText(MainActivity.this, "رمز غير صحيح", Toast.LENGTH_SHORT).show();
                }
            });
            return;
        }
        launchAppDirect(app);
    }
    private void launchAppDirect(AppEntry app) {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.setComponent(new ComponentName(app.pkg, app.activity));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            try {
                Intent fallback = getPackageManager().getLaunchIntentForPackage(app.pkg);
                if (fallback == null) throw error;
                startActivity(fallback);
            } catch (Exception ignored) {
                Toast.makeText(this, "تعذّر فتح التطبيق، تأكد أنه ما زال مثبتًا.", Toast.LENGTH_LONG).show();
                refreshApps(); render(page);
            }
        } catch (SecurityException error) {
            Toast.makeText(this, "النظام منع تشغيل هذا التطبيق.", Toast.LENGTH_LONG).show();
        }
    }
    private void systemSettings() {
        try { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
        catch (Exception error) { Toast.makeText(this, "تعذّر فتح إعدادات النظام.", Toast.LENGTH_LONG).show(); }
    }
    private void toggleFavorite(AppEntry app) {
        if (app == null) return;
        Set<String> selected = favorites();
        boolean add = !selected.contains(app.pkg);
        if (add) selected.add(app.pkg); else selected.remove(app.pkg);
        prefs.edit().putStringSet("favorite_packages", selected).apply();
        Toast.makeText(this, add ? "تمت إضافة " + app.label + " للمفضلة" : "أُزيل من المفضلة", Toast.LENGTH_SHORT).show();
        render(page);
    }

    private Button button(String label, final View.OnClickListener click, boolean primary) {
        final Button view = new Button(this);
        view.setText(label);
        view.setAllCaps(false);
        view.setTextColor(WHITE);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setMinHeight(0); view.setMinimumHeight(0);
        view.setPadding(dp(17), dp(4), dp(17), dp(4));
        view.setFocusable(true);
        view.setBackgroundDrawable(panel(primary ? mix(0xFF3E301F, accent, 0.44f, 255) : PANEL,
            primary ? accent : GLASS_EDGE, 14));
        view.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View target, boolean focused) {
                view.setBackgroundDrawable(panel(
                    focused ? mix(0xFF283A4B, accent, 0.35f, 255) : primary ? mix(0xFF3E301F, accent, 0.44f, 255) : PANEL,
                    focused ? accent : primary ? accent : GLASS_EDGE, 14));
                view.animate().scaleX(focused ? 1.035f : 1f).scaleY(focused ? 1.035f : 1f).setDuration(120).start();
            }
        });
        view.setOnClickListener(click);
        return view;
    }

    private void render(String section) {
        clockHandler.removeCallbacks(tick);
        page=section;
        accent=currentAccent();
        focusedApp=null;
        clockView=null;
        FrameLayout scene=new FrameLayout(this);
        scene.setBackgroundDrawable(new Wallpaper(accent,prefs.getString("wallpaper","aurora")));
        scene.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        setContentView(scene);
        LinearLayout shell=column();
        shell.setPadding(dp(18),dp(10),dp(18),dp(8));
        scene.addView(shell,new FrameLayout.LayoutParams(-1,-1));

        // Spacious hero-first title bar: Arabic at viewing distance, clock at opposite end.
        LinearLayout header=row();
        header.setPadding(dp(9),0,dp(8),0);
        TextView emblem=text("◈",29,accent,true);
        emblem.setGravity(Gravity.CENTER);
        emblem.setBackgroundDrawable(panel(0xFF30313A,accent,14));
        header.addView(emblem,lp(49,48,3));
        LinearLayout branding=column();
        branding.addView(text("بيتي",24,WHITE,true),lp(-2,30,0));
        branding.addView(text("HUIDI  •  CINEMA HOME",11,MUTED,false),lp(-2,16,0));
        header.addView(branding,lp(-2,50,6));
        header.addView(new View(this),new LinearLayout.LayoutParams(0,1,1f));
        TextView network=text("●  "+wifiStatus(),13,0xFF8EE2C4,true);
        header.addView(network,lp(-2,38,5));
        clockView=text("",18,PALE,true);
        header.addView(clockView,lp(-2,48,7));
        Button settings=button("⚙",new View.OnClickListener(){
            @Override public void onClick(View v){render("settings");}
        },false);
        settings.setContentDescription("إعدادات الشاشة");
        header.addView(settings,lp(50,45,4));
        shell.addView(header,lp(-1,58,0));

        LinearLayout menu=row();
        String[] names={"الرئيسية","التطبيقات","المفضلة","المظهر","المزيد"};
        String[] destinations={"home","apps","favorites","themes","more"};
        menu.setPadding(dp(5),dp(2),dp(5),dp(2));
        for(int i=0;i<names.length;i++){
            final String destination=destinations[i];
            boolean selected=destination.equals(section) ||
                "more".equals(destination) && ("settings".equals(section)||
                 "system".equals(section)||"maintenance".equals(section)||
                 "developer".equals(section)||"wallpapers".equals(section));
            Button tab=button(names[i],new View.OnClickListener(){
                @Override public void onClick(View v){render(destination);}
            },selected);
            tab.setTextSize(TypedValue.COMPLEX_UNIT_SP,16);
            LinearLayout.LayoutParams nav=new LinearLayout.LayoutParams(0,dp(44),1f);
            nav.setMargins(dp(4),0,dp(4),0);
            menu.addView(tab,nav);
        }
        menu.setBackgroundDrawable(panel(0xBD101B2C,0x334B627A,16));
        shell.addView(menu,lp(-1,50,4));

        ScrollView scroller=new ScrollView(this);
        scroller.setFillViewport(true);
        scroller.setVerticalScrollBarEnabled(false);
        scroller.setClipToPadding(false);
        shell.addView(scroller,new LinearLayout.LayoutParams(-1,0,1f));
        LinearLayout content=column();
        content.setPadding(dp(5),dp(3),dp(5),dp(7));
        scroller.addView(content,new ScrollView.LayoutParams(-1,-2));
        if("home".equals(section))homePage(content);
        else if("apps".equals(section))appGrid(content,false);
        else if("favorites".equals(section))appGrid(content,true);
        else if("themes".equals(section))themesPage(content);
        else if("settings".equals(section))settingsPage(content);
        else if("system".equals(section))systemPage(content);
        else if("maintenance".equals(section))maintenancePage(content);
        else if("wallpapers".equals(section))wallpapersPage(content);
        else if("developer".equals(section))developerPage(content);
        else morePage(content);

        TextView hint=text("◉ للتشغيل    •    الأسهم للتنقل    •    MENU لإدارة التطبيقات",12,0xFF8E9EB1,false);
        hint.setGravity(Gravity.CENTER);
        shell.addView(hint,lp(-1,20,0));
        tick.run();
    }
    private void morePage(LinearLayout content) {
        heading(content,"المزيد من التحكم","كل الأدوات المهمة في مكان واحد");
        content.addView(settingRow("لوحة النظام","الذاكرة والتخزين والاتصال وإصدار Android","فتح",new View.OnClickListener(){
            @Override public void onClick(View v){render("system");}
        }),lp(-1,88,5));
        content.addView(settingRow("مركز الصيانة","تنظيف الملفات المؤقتة وتحديث قائمة التطبيقات","فتح",new View.OnClickListener(){
            @Override public void onClick(View v){render("maintenance");}
        }),lp(-1,88,5));
        content.addView(settingRow("المطور","تفعيل خيارات المطور من إعدادات Android الرسمية","فتح",new View.OnClickListener(){
            @Override public void onClick(View v){render("developer");}
        }),lp(-1,88,5));
        content.addView(settingRow("الخلفيات","أنماط الخلفية الداكنة والأضواء الهادئة","فتح",new View.OnClickListener(){
            @Override public void onClick(View v){render("wallpapers");}
        }),lp(-1,88,5));
        content.addView(settingRow("إعدادات بيتي","إعدادات واجهة الشاشة والخصوصية والقفل","فتح",new View.OnClickListener(){
            @Override public void onClick(View v){render("settings");}
        }),lp(-1,88,5));
    }
    
    private void heading(LinearLayout parent,String heading,String caption) {
        LinearLayout line=row();
        TextView title=text(heading,22,WHITE,true);
        line.addView(title,lp(-2,34,1));
        line.addView(new View(this),new LinearLayout.LayoutParams(0,1,1f));
        if(caption!=null&&caption.length()>0) {
            TextView help=text(caption,13,MUTED,false);
            help.setSingleLine(true);help.setEllipsize(TextUtils.TruncateAt.END);
            line.addView(help,lp(-2,34,1));
        }
        parent.addView(line,lp(-1,38,2));
    }

    private void homePage(LinearLayout content) {
        final AppEntry featured=alezz();
        LinearLayout stage=row();
        final int stageHeight=lite()?208:226;

        // Prominent actual media destination, unlike the previous generic dashboard.
        LinearLayout feature=column();
        feature.setPadding(dp(24),dp(16),dp(24),dp(12));
        feature.setBackgroundDrawable(new PremierHero(accent));
        TextView eyebrow=text("✦   THE CINEMA EXPERIENCE",13,0xFFFFE0A1,true);
        feature.addView(eyebrow,lp(-1,23,0));

        LinearLayout headline=row();
        LinearLayout copy=column();
        copy.addView(text(featured==null?"شاشتك.. عالمك":"العز TV",lite()?32:39,WHITE,true),lp(-1,58,0));
        TextView tagline=text(featured==null ? "كل تطبيقاتك في واجهة واحدة" :
            "أفلام ومسلسلات وقنوات.. بلمسة واحدة",17,0xFFDEE6F0,false);
        tagline.setMaxLines(2);
        copy.addView(tagline,lp(-1,44,0));
        headline.addView(copy,new LinearLayout.LayoutParams(0,-2,1f));
        TextView symbol=text("▶",46,0xFFF9C879,true);
        symbol.setGravity(Gravity.CENTER);
        symbol.setBackgroundDrawable(panel(0xEE322A28,0xBBF2C77C,29));
        headline.addView(symbol,lp(76,76,3));
        feature.addView(headline,lp(-1,109,0));
        LinearLayout actions=row();
        Button play=button(featured==null?"▦  جميع التطبيقات":"▶  شاهد الآن",
            new View.OnClickListener() {
                @Override public void onClick(View v) {
                    if(featured!=null)openApp(featured);
                    else render("apps");
                }
            },true);
        actions.addView(play,lp(-2,50,2));
        Button browse=button("تصفح تطبيقاتك",new View.OnClickListener(){
            @Override public void onClick(View v){render("apps");}
        },false);
        actions.addView(browse,lp(-2,50,3));
        feature.addView(actions,lp(-1,53,0));
        LinearLayout.LayoutParams featureParams=new LinearLayout.LayoutParams(0,dp(stageHeight),1.70f);
        featureParams.setMargins(dp(4),dp(5),dp(5),dp(5));
        stage.addView(feature,featureParams);

        LinearLayout side=column();
        side.addView(spotlight("تطبيقاتي","استكشف برامج الشاشة","▦",0xFF64C9D4,new View.OnClickListener(){
            @Override public void onClick(View v){render("apps");}
        }),new LinearLayout.LayoutParams(-1,0,1f));
        side.addView(spotlight("الثيمات","غيّر ألوان تجربتك","◈",0xFFE4B977,new View.OnClickListener(){
            @Override public void onClick(View v){render("themes");}
        }),new LinearLayout.LayoutParams(-1,0,1f));
        LinearLayout.LayoutParams sideParams=new LinearLayout.LayoutParams(0,dp(stageHeight),1.0f);
        sideParams.setMargins(dp(5),dp(5),dp(4),dp(5));
        stage.addView(side,sideParams);
        content.addView(stage,lp(-1,-2,0));

        LinearLayout headingRow=row();
        headingRow.addView(text("تطبيقاتك",22,WHITE,true),lp(-2,34,2));
        headingRow.addView(new View(this),new LinearLayout.LayoutParams(0,1,1f));
        Button see=button("عرض الكل  ←",new View.OnClickListener(){
            @Override public void onClick(View v){render("apps");}
        },false);
        see.setTextSize(TypedValue.COMPLEX_UNIT_SP,14);
        headingRow.addView(see,lp(-2,38,2));
        content.addView(headingRow,lp(-1,44,2));

        ArrayList<AppEntry> chosen=new ArrayList<AppEntry>();
        HashSet<String> included=new HashSet<String>();
        if(featured!=null){chosen.add(featured);included.add(featured.pkg);}
        Set<String> favorites=favorites();
        for(AppEntry app:apps) {
            if(favorites.contains(app.pkg) && included.add(app.pkg))chosen.add(app);
        }
        for(AppEntry app:apps) {
            if(chosen.size()>=5)break;
            if(included.add(app.pkg))chosen.add(app);
        }
        if(chosen.size()==0) {
            content.addView(spotlight("لا توجد تطبيقات بعد","افتح كل التطبيقات للتحديث","▦",
                accent,new View.OnClickListener(){
                    @Override public void onClick(View v){refreshApps();render("apps");}
                }),lp(-1,100,3));
        } else {
            LinearLayout dock=row();
            for(int i=0;i<chosen.size()&&i<5;i++){
                final AppEntry app=chosen.get(i);
                View tile=homeAppCard(app);
                LinearLayout.LayoutParams param=new LinearLayout.LayoutParams(0,dp(104),1f);
                param.setMargins(dp(5),dp(3),dp(5),dp(3));
                dock.addView(tile,param);
            }
            content.addView(dock,lp(-1,113,0));
        }
    }

    private View spotlight(String name,String detail,String glyph,int tint,View.OnClickListener action) {
        final LinearLayout card=row();
        card.setPadding(dp(13),dp(8),dp(13),dp(8));
        card.setBackgroundDrawable(panel(0xFF1C2C3C,0x665D748B,19));
        card.setFocusable(true);
        card.setClickable(true);
        TextView marker=text(glyph,27,tint,true);
        marker.setGravity(Gravity.CENTER);
        marker.setBackgroundDrawable(panel(0xFF263443,tint,13));
        card.addView(marker,lp(46,55,4));
        LinearLayout labels=column();
        TextView heading=text(name,21,WHITE,true);
        heading.setSingleLine(true);
        labels.addView(heading,lp(-1,31,1));
        TextView sub=text(detail,13,MUTED,false);
        sub.setSingleLine(true);sub.setEllipsize(TextUtils.TruncateAt.END);
        labels.addView(sub,lp(-1,23,1));
        card.addView(labels,new LinearLayout.LayoutParams(0,-2,1f));
        card.setOnClickListener(action);
        card.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v,boolean selected){
                card.setBackgroundDrawable(panel(selected?0xFF344A56:0xFF1C2C3C,
                    selected?accent:0x665D748B,19));
                card.animate().scaleX(selected?1.025f:1).scaleY(selected?1.025f:1)
                    .setDuration(125).start();
            }
        });
        return card;
    }
    private View homeAppCard(final AppEntry app) {
        final LinearLayout tile=column();
        tile.setGravity(Gravity.CENTER);
        tile.setPadding(dp(7),dp(6),dp(7),dp(6));
        tile.setBackgroundDrawable(panel(GLASS,GLASS_EDGE,17));
        tile.setFocusable(true);tile.setClickable(true);
        ImageView icon=new ImageView(this);
        try { icon.setImageDrawable(getPackageManager().getApplicationIcon(app.pkg)); }
        catch (Exception ex) { icon.setImageResource(android.R.drawable.sym_def_app_icon); }
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        tile.addView(icon,lp(51,52,1));
        TextView name=text(app.label,16,WHITE,true);
        name.setGravity(Gravity.CENTER);
        name.setSingleLine(true);name.setEllipsize(TextUtils.TruncateAt.END);
        tile.addView(name,lp(-1,32,0));
        tile.setContentDescription(app.label);
        tile.setOnClickListener(new View.OnClickListener(){
            @Override public void onClick(View v){openApp(app);}
        });
        tile.setOnLongClickListener(new View.OnLongClickListener(){
            @Override public boolean onLongClick(View v){appActions(app);return true;}
        });
        tile.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            @Override public void onFocusChange(View v,boolean selected){
                if(selected)focusedApp=app;
                else if(focusedApp==app)focusedApp=null;
                tile.setBackgroundDrawable(panel(selected?0xFF354852:GLASS,
                    selected?accent:GLASS_EDGE,17));
                tile.animate().scaleX(selected?1.065f:1f).scaleY(selected?1.065f:1f)
                    .setDuration(135).start();
            }
        });
        return tile;
    }
    
    private LinearLayout.LayoutParams weightedCard() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(99), 1f);
        p.setMargins(dp(6), dp(4), dp(6), dp(4));
        return p;
    }
    private View shortcut(final String title, String subtitle, String symbol, final AppEntry entry, final boolean settings) {
        final LinearLayout tile = row();
        tile.setPadding(dp(12), dp(9), dp(12), dp(9));
        tile.setBackgroundDrawable(panel(GLASS, GLASS_EDGE, 20));
        tile.setFocusable(true);
        tile.setClickable(true);
        int tileColor = "العز TV".equals(title) ? 0xFFFF7689 :
            "يوتيوب".equals(title) ? 0xFFFFB75E :
            "الإعدادات".equals(title) ? 0xFF79DCFA : 0xFFBDA6FF;
        TextView icon = text(symbol, 28, tileColor, true);
        icon.setGravity(Gravity.CENTER);
        icon.setBackgroundDrawable(panel(0xB522293C, tileColor, 16));
        tile.addView(icon, lp(45, 58, 4));
        LinearLayout labels = column();
        TextView name = text(title, 17, WHITE, true);
        name.setSingleLine(true); name.setEllipsize(TextUtils.TruncateAt.END);
        labels.addView(name, lp(-1, 32, 1));
        TextView desc = text(subtitle, 12, MUTED, false);
        desc.setSingleLine(true); desc.setEllipsize(TextUtils.TruncateAt.END);
        labels.addView(desc, lp(-1, 29, 1));
        tile.addView(labels, new LinearLayout.LayoutParams(0, -2, 1f));
        tile.setContentDescription(title + "، " + subtitle);
        tile.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (settings) systemSettings();
                else if (entry != null) openApp(entry);
                else render("apps");
            }
        });
        tile.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean f) {
                tile.setBackgroundDrawable(panel(f ? mix(GLASS, accent, 0.30f, 238) : GLASS, f ? accent : GLASS_EDGE, 20));
                tile.animate().scaleX(f ? 1.03f : 1f).scaleY(f ? 1.03f : 1f).setDuration(140).start();
            }
        });
        return tile;
    }

    private void appGrid(LinearLayout content, boolean onlyFavorites) {
        heading(content, onlyFavorites ? "تطبيقاتي المفضلة" : "جميع التطبيقات",
            onlyFavorites ? "عناصر اخترتها للفتح السريع" : "كل تطبيقات الشاشة المتاحة للفتح، بدون إضافات وهمية");
        renderGrid(content, onlyFavorites, lite() ? 16 : 30, true);
    }
    private void renderGrid(LinearLayout content, boolean onlyFavorites, int defaultLimit, boolean allowMore) {
        final Set<String> picked = favorites();
        ArrayList<AppEntry> visible = new ArrayList<AppEntry>();
        for (AppEntry app : apps) {
            if (!onlyFavorites || picked.contains(app.pkg)) visible.add(app);
        }
        if (visible.isEmpty()) {
            TextView empty = text(onlyFavorites ? "لا توجد تطبيقات في المفضلة بعد. افتح «التطبيقات» وأضف ما تحب."
                : "لم يتعرّف النظام على تطبيقات قابلة للفتح.", 16, MUTED, false);
            empty.setPadding(dp(14), dp(25), dp(14), dp(25));
            empty.setBackgroundDrawable(panel(GLASS, GLASS_EDGE, 18));
            content.addView(empty, lp(-1, 87, 6));
            return;
        }
        int width = getResources().getDisplayMetrics().widthPixels;
        int usableDp = Math.round(width / getResources().getDisplayMetrics().density) - 80;
        int columns = usableDp > 1260 ? 6 : usableDp > 830 ? 5 : 4;
        int itemWidthDp = Math.max(120, (usableDp - columns * 14) / columns);
        int max = allowMore && !showAllApps ? Math.min(defaultLimit, visible.size()) : visible.size();
        if (onlyFavorites && !allowMore) max = Math.min(8, visible.size());
        GridLayout grid = new GridLayout(this);
        grid.setColumnCount(columns);
        grid.setAlignmentMode(GridLayout.ALIGN_BOUNDS);
        for (int i = 0; i < max; i++) {
            final AppEntry app = visible.get(i);
            View card = appTile(app, picked.contains(app.pkg));
            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = dp(itemWidthDp);
            params.height = dp(lite() ? 118 : 130);
            params.setMargins(dp(7), dp(6), dp(7), dp(6));
            grid.addView(card, params);
        }
        content.addView(grid, lp(-1, -2, 2));
        if (allowMore && visible.size() > defaultLimit) {
            final boolean currentlyAll = showAllApps;
            Button more = button(currentlyAll ? "عرض أقل  ↑" : "عرض كل التطبيقات  (" + visible.size() + ")  ↓",
                new View.OnClickListener() {
                    @Override public void onClick(View v) { showAllApps = !currentlyAll; render(page); }
                }, false);
            content.addView(more, lp(300, 48, 9));
        }
    }

    private View appTile(final AppEntry app,final boolean favorite) {
        final LinearLayout tile=column();
        tile.setPadding(dp(11),dp(7),dp(11),dp(7));
        tile.setGravity(Gravity.CENTER);
        tile.setFocusable(true);tile.setClickable(true);
        tile.setBackgroundDrawable(panel(GLASS,GLASS_EDGE,18));
        ImageView icon=new ImageView(this);
        try { icon.setImageDrawable(getPackageManager().getApplicationIcon(app.pkg)); }
        catch(Exception ignored){ icon.setImageResource(android.R.drawable.sym_def_app_icon); }
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        tile.addView(icon,lp(56,56,2));
        TextView name=text(app.label,17,WHITE,true);
        name.setGravity(Gravity.CENTER);
        name.setSingleLine(true);name.setEllipsize(TextUtils.TruncateAt.END);
        tile.addView(name,lp(-1,32,2));
        TextView hint=text(pinGate.isLocked(app.pkg)?"◈ محمي":
            favorite?"★ مفضّل":"OK للتشغيل",12,
            favorite?accent:MUTED,false);
        hint.setGravity(Gravity.CENTER);
        tile.addView(hint,lp(-1,23,0));
        tile.setOnFocusChangeListener(new View.OnFocusChangeListener(){
            @Override public void onFocusChange(View v,boolean selected){
                if(selected)focusedApp=app;
                else if(focusedApp==app)focusedApp=null;
                tile.setBackgroundDrawable(panel(selected?0xFF345064:GLASS,
                    selected?accent:GLASS_EDGE,18));
                tile.animate().scaleX(selected?1.05f:1f)
                    .scaleY(selected?1.05f:1f).setDuration(120).start();
            }
        });
        tile.setOnClickListener(new View.OnClickListener(){
            @Override public void onClick(View v){openApp(app);}
        });
        tile.setOnLongClickListener(new View.OnLongClickListener(){
            @Override public boolean onLongClick(View v){appActions(app);return true;}
        });
        tile.setContentDescription(app.label);
        return tile;
    }
    
    private void settingsPage(LinearLayout content) {
        heading(content, "تخصيص بيتي  ◈", "ألوان زجاجية وإعدادات محلية بدون حساب أو اتصال");
        content.addView(settingRow("لوحة النظام",
            "الذاكرة، التخزين، شبكة الواي فاي والبطارية", "عرض اللوحة",
            new View.OnClickListener() { @Override public void onClick(View v) { render("system"); } }),
            lp(-1, 98, 6));
        content.addView(settingRow("مركز الصيانة",
            "تنظيف ملفات التطبيق المؤقتة وتحديث قائمة البرامج", "فتح الصيانة",
            new View.OnClickListener() { @Override public void onClick(View v) { render("maintenance"); } }),
            lp(-1, 98, 6));
        content.addView(settingRow("الخصوصية وقفل التطبيقات",
            "قفل اختياري برقم سري، يعمل فقط داخل Huidi Home", "إدارة القفل",
            new View.OnClickListener() { @Override public void onClick(View v) { managePin(); } }),
            lp(-1, 98, 6));
        content.addView(settingRow("خلفية الشاشة",
            "أورورا، نجوم، خطوط أو وضع هادئ منخفض الاستهلاك", "تغيير الخلفية",
            new View.OnClickListener() { @Override public void onClick(View v) { render("wallpapers"); } }),
            lp(-1, 98, 6));
        content.addView(settingRow("ثيمات زجاجية", "ذهبي، أحمر، أزرق، بنفسجي، زمردي ووردي", "معرض الثيمات",
            new View.OnClickListener() {
                @Override public void onClick(View v) { render("themes"); }
            }), lp(-1, 98, 6));
        content.addView(settingRow("وضع الشاشات القديمة", lite() ? "مفعّل: بطاقات أقل وسرعة أعلى" : "معطّل: عرض بطاقات إضافية",
            lite() ? "إيقاف الوضع الخفيف" : "تفعيل الوضع الخفيف", new View.OnClickListener() {
                @Override public void onClick(View v) {
                    prefs.edit().putBoolean("lite", !lite()).apply();
                    showAllApps = false;
                    render("settings");
                }
            }), lp(-1, 98, 6));
        content.addView(settingRow("الصفحة الرئيسية الافتراضية",
            "اختيار Huidi Home من إعدادات الشاشة؛ يمكن الرجوع للمشغّل الأصلي في أي وقت",
            "طريقة التعيين", new View.OnClickListener() {
                @Override public void onClick(View v) { chooseHome(); }
            }), lp(-1, 98, 6));
        content.addView(settingRow("مركز المطوّر",
            "افتح خيارات المطوّر أو اتبع خطوات تفعيلها من إعدادات Android",
            "فتح مركز المطوّر", new View.OnClickListener() {
                @Override public void onClick(View v) { render("developer"); }
            }), lp(-1, 98, 6));
        content.addView(settingRow("إعدادات الشاشة الأصلية",
            "الواي فاي والصوت والعرض والتطبيقات وتغيير المشغّل الافتراضي",
            "فتح إعدادات النظام", new View.OnClickListener() {
                @Override public void onClick(View v) { systemSettings(); }
            }), lp(-1, 98, 6));
        TextView privacy = text("خصوصيتك: يعمل Huidi Home دون حسابات أو إعلانات أو اتصال بالشبكة ولا يطلب صلاحية الإنترنت.", 13, MUTED, false);
        content.addView(privacy, lp(-1, 50, 9));
    }
    private View settingRow(String name, String details, String action, View.OnClickListener listener) {
        LinearLayout line = row();
        line.setPadding(dp(15), dp(6), dp(15), dp(6));
        line.setBackgroundDrawable(panel(GLASS, GLASS_EDGE, 17));
        LinearLayout copy = column();
        copy.addView(text(name, 20, WHITE, true), lp(-1, 35, 1));
        TextView sub = text(details, 14, MUTED, false);
        sub.setSingleLine(true); sub.setEllipsize(TextUtils.TruncateAt.END);
        copy.addView(sub, lp(-1, 30, 1));
        line.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));
        line.addView(button(action, listener, false), lp(-2, 49, 4));
        return line;
    }
    private void themes() {
        final String[] keys = {"gold", "red", "blue", "violet", "emerald", "rose"};
        final String[] names = {"✦  ذهب الشفق", "◈  أحمر سينمائي", "❖  أزرق جليدي",
            "✧  بنفسجي ملكي", "◆  زمردي مضيء", "♥  وردي مخملي"};
        int current = 0;
        for (int i = 0; i < keys.length; i++)
            if (keys[i].equals(prefs.getString("theme", "gold"))) current = i;
        new AlertDialog.Builder(this).setTitle("اختر ثيم شاشتك")
            .setSingleChoiceItems(names, current, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int index) {
                    prefs.edit().putString("theme", keys[index]).apply();
                    dialog.dismiss();
                    render(page);
                }
            }).setNegativeButton("إلغاء", null).show();
    }

    /** User-facing palette showroom: all colors are locally rendered, no remote assets. */
    private void themesPage(LinearLayout content) {
        heading(content,"المظهر والثيمات","ستة ألوان مختارة لإضاءة أنيقة من دون تشويش");
        String[] keys={"gold","red","blue","violet","emerald","rose"};
        String[] names={"ذهب الشفق","أحمر سينمائي","أزرق محيطي",
            "بنفسجي ملكي","زمردي ناعم","وردي مخملي"};
        int[] colors={0xFFFFC76D,0xFFE04759,0xFF58C8F8,
            0xFFB39AFF,0xFF53E0BB,0xFFFB8FB0};
        for(int row=0;row<2;row++){
            LinearLayout line=row();
            for(int i=0;i<3;i++){
                final int index=row*3+i;
                final String key=keys[index];
                final int tint=colors[index];
                final LinearLayout choice=column();
                choice.setPadding(dp(16),dp(14),dp(16),dp(11));
                choice.setBackgroundDrawable(panel(0xFF1C2B3E,
                    key.equals(prefs.getString("theme","gold"))?tint:GLASS_EDGE,19));
                TextView mark=text("◉",37,tint,true);
                choice.addView(mark,lp(-1,48,1));
                choice.addView(text(names[index],20,WHITE,true),lp(-1,37,1));
                TextView state=text(key.equals(prefs.getString("theme","gold"))?
                    "● مفعّل الآن":"اضغط لتطبيق الثيم",13,
                    key.equals(prefs.getString("theme","gold"))?tint:MUTED,false);
                choice.addView(state,lp(-1,28,1));
                choice.setFocusable(true);choice.setClickable(true);
                choice.setOnClickListener(new View.OnClickListener(){
                    @Override public void onClick(View v){
                        prefs.edit().putString("theme",key).apply();render("themes");
                    }
                });
                choice.setOnFocusChangeListener(new View.OnFocusChangeListener(){
                    @Override public void onFocusChange(View v,boolean f){
                        choice.setBackgroundDrawable(panel(f?0xFF355064:0xFF1C2B3E,
                            f?0xFFF5F3ED:tint,19));
                        choice.animate().scaleX(f?1.03f:1f).scaleY(f?1.03f:1f)
                            .setDuration(120).start();
                    }
                });
                LinearLayout.LayoutParams pp=new LinearLayout.LayoutParams(0,dp(151),1f);
                pp.setMargins(dp(6),dp(5),dp(6),dp(5));
                line.addView(choice,pp);
            }
            content.addView(line,lp(-1,162,1));
        }
        Button backgrounds=button("اختيار نمط الخلفية  ←",new View.OnClickListener(){
            @Override public void onClick(View v){render("wallpapers");}
        },false);
        content.addView(backgrounds,lp(-1,50,7));
    }
    
    private boolean isDeveloperModeEnabled() {
        try {
            return Settings.Global.getInt(getContentResolver(), "development_settings_enabled", 0) != 0;
        } catch (Exception ignored) {
            // Some customized television firmware does not expose this flag.
            return false;
        }
    }
    private boolean launchSystemAction(String action) {
        try {
            Intent intent = new Intent(action);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
    private void openAboutDevice() {
        if (!launchSystemAction(Settings.ACTION_DEVICE_INFO_SETTINGS)) {
            Toast.makeText(this, "هذا النظام لا يوفر صفحة معلومات جهاز مستقلة.", Toast.LENGTH_LONG).show();
            systemSettings();
        }
    }
    private void openDeveloperOptions() {
        if (!launchSystemAction(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) {
            new AlertDialog.Builder(this)
                .setTitle("خيارات المطوّر غير متاحة")
                .setMessage("لم يوفّر نظام الشاشة صفحة خيارات المطوّر عبر الرابط القياسي. افتح إعدادات النظام ثم «خيارات المطوّر». إذا لم تظهر، استخدم شرح التفعيل عبر رقم الإصدار.")
                .setPositiveButton("إعدادات النظام", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) { systemSettings(); }
                }).setNeutralButton("طريقة التفعيل", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) { enableDeveloperGuide(); }
                }).setNegativeButton("إغلاق", null).show();
        }
    }
    private void enableDeveloperGuide() {
        new AlertDialog.Builder(this)
            .setTitle("تفعيل خيارات المطوّر — من إعدادات Android")
            .setMessage("١. افتح «حول الجهاز / About device».\n٢. ابحث عن «رقم الإصدار / Build number».\n٣. اضغط عليه بالريموت ٧ مرات (قد يختلف العدد بحسب الشركة).\n٤. أدخل رمز القفل إذا طلبه النظام.\n٥. ارجع إلى «الإعدادات» وافتح «خيارات المطوّر».\n\nبعض شاشات Huidi المعدلة تخفي هذه القائمة. هذا التطبيق لا يغيّر صلاحيات النظام ولا يفعّل USB debugging تلقائيًا.")
            .setPositiveButton("فتح حول الجهاز", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int which) { openAboutDevice(); }
            }).setNeutralButton("خيارات المطوّر", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int which) { openDeveloperOptions(); }
            }).setNegativeButton("إغلاق", null).show();
    }
    private void developerPage(LinearLayout content) {
        heading(content, "مركز المطوّر  ⚙", "وصول سريع وآمن لإعدادات النظام الأصلية");
        LinearLayout intro = column();
        intro.setPadding(dp(19), dp(16), dp(19), dp(13));
        intro.setBackgroundDrawable(heroDrawable());
        intro.addView(text("وضع المطوّر على شاشة Huidi", 24, WHITE, true), lp(-1, 49, 0));
        intro.addView(text(isDeveloperModeEnabled() ?
            "● حالة النظام: خيارات المطوّر مفعّلة بحسب إعدادات Android" :
            "○ الحالة غير مؤكدة أو غير مفعّلة حسب إعدادات Android",
            15, accent, true), lp(-1, 37, 1));
        intro.addView(text("Android " + Build.VERSION.RELEASE + "  •  API "
            + Build.VERSION.SDK_INT + "  •  " + Build.MODEL
            + "  •  ذاكرة التطبيق " + (Runtime.getRuntime().maxMemory() / (1024 * 1024)) + " MB",
            13, MUTED, false), lp(-1, 37, 0));
        content.addView(intro, lp(-1, -2, 7));
        content.addView(settingRow("تفعيل خيارات المطوّر",
            "يوجّهك إلى «حول الجهاز» للضغط على رقم الإصدار ٧ مرات", "بدء التفعيل",
            new View.OnClickListener() {
                @Override public void onClick(View v) { enableDeveloperGuide(); }
            }), lp(-1, 100, 6));
        content.addView(settingRow("فتح خيارات المطوّر",
            "فتح شاشة المطوّر الرسمية إن كانت متاحة على جهازك", "فتح الخيارات",
            new View.OnClickListener() {
                @Override public void onClick(View v) { openDeveloperOptions(); }
            }), lp(-1, 100, 6));
        content.addView(settingRow("حول الجهاز",
            "معلومات النظام وإصدار Android ورقم البناء", "معلومات النظام",
            new View.OnClickListener() {
                @Override public void onClick(View v) { openAboutDevice(); }
            }), lp(-1, 100, 6));
        content.addView(settingRow("الإعدادات الأصلية",
            "للعودة إلى إعدادات الشبكة والتطبيقات والتحديثات", "فتح الإعدادات",
            new View.OnClickListener() {
                @Override public void onClick(View v) { systemSettings(); }
            }), lp(-1, 100, 6));
        TextView caution = text("مهم: تفعيل وضع المطوّر يتم من النظام بموافقتك. التطبيق لا يمنح نفسه صلاحيات Root أو ADB أو يتجاوز حماية الجهاز.", 13, MUTED, false);
        caution.setPadding(dp(13), dp(8), dp(13), dp(8));
        caution.setBackgroundDrawable(panel(0xA41F2333, GLASS_EDGE, 14));
        content.addView(caution, lp(-1, 68, 8));
    }


    // Avoid misleading "RAM booster" claims: only launcher-owned cache is deleted.
    private long clearOwnCache(File path) {
        if (path == null || !path.exists()) return 0L;
        long removed = 0L;
        File[] children = path.listFiles();
        if (children != null) for (File f : children) {
            if (f.isDirectory()) removed += clearOwnCache(f);
            else { long length=f.length(); if (f.delete()) removed += length; }
        }
        return removed;
    }
    private void maintenancePage(LinearLayout content) {
        heading(content, "مركز العناية بالجهاز  ◈", "أدوات صيانة آمنة دون حذف تطبيقاتك أو التعديل على النظام");
        content.addView(settingRow("مسح مؤقتات Huidi Home فقط",
            "يحذف الملفات المؤقتة لهذا اللانشر ولا يحذف صورك أو المفضلة أو الرموز",
            "تنظيف الآن", new View.OnClickListener() {
                @Override public void onClick(View v) {
                    long bytes=clearOwnCache(getCacheDir());
                    Toast.makeText(MainActivity.this,
                        "تم تنظيف مؤقتات الواجهة: "+(bytes/1024)+" KB", Toast.LENGTH_LONG).show();
                    render("maintenance");
                }
            }), lp(-1, 100, 6));
        content.addView(settingRow("تحديث التطبيقات",
            "إعادة قراءة قائمة التطبيقات المثبتة بدون حذف أو إيقاف أي تطبيق", "تحديث الآن",
            new View.OnClickListener() {
                @Override public void onClick(View v) {
                    refreshApps(); render("apps");
                    Toast.makeText(MainActivity.this, "تم تحديث قائمة التطبيقات", Toast.LENGTH_SHORT).show();
                }
            }), lp(-1, 100, 6));
        content.addView(settingRow("تخفيف الضغط على ذاكرة الشاشة",
            lite()?"مفعّل: عدد بطاقات أقل على Android القديم":"غير مفعّل: عدد بطاقات أكبر",
            lite()?"إيقاف الوضع الخفيف":"تشغيل الوضع الخفيف", new View.OnClickListener() {
                @Override public void onClick(View v) {
                    prefs.edit().putBoolean("lite", !lite()).apply();
                    showAllApps=false; render("maintenance");
                }
            }), lp(-1, 100, 6));
        content.addView(settingRow("إعدادات إدارة التطبيقات",
            "مسح مؤقتات التطبيقات الأخرى يتطلب استخدام صفحة النظام الأصلية",
            "فتح الإعدادات", new View.OnClickListener() {
                @Override public void onClick(View v) {
                    if (!launchSystemAction(Settings.ACTION_APPLICATION_SETTINGS)) systemSettings();
                }
            }), lp(-1, 100, 6));
        TextView info=text("لا توجد ميزة تسريع وهمية: Android يدير RAM والتطبيق لا يقتل برامج الخلفية أو يغير صلاحياتها.",13,MUTED,false);
        content.addView(info,lp(-1,60,7));
    }

    private String size(long amount) {
        if (amount < 0L) return "غير متاح";
        if (amount >= 1024L*1024L*1024L)
            return String.format(Locale.US, "%.1f GB", amount/(1024d*1024d*1024d));
        return (amount/(1024L*1024L))+" MB";
    }
    private String wifiStatus() {
        try {
            WifiManager wifi=(WifiManager)getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi == null || !wifi.isWifiEnabled()) return "غير مفعّل";
            ConnectivityManager cm=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
            NetworkInfo info=cm==null?null:cm.getActiveNetworkInfo();
            return info != null && info.isConnected() && info.getType()==ConnectivityManager.TYPE_WIFI
                ? "متصل" : "مفعّل (غير متصل)";
        } catch (Exception e) { return "غير متاح"; }
    }
    private String batteryStatus() {
        try {
            Intent battery=registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (battery==null) return "غير متاح";
            int level=battery.getIntExtra(BatteryManager.EXTRA_LEVEL,-1);
            int scale=battery.getIntExtra(BatteryManager.EXTRA_SCALE,-1);
            if (level<0||scale<=0) return "غير متاح";
            return (level*100/scale)+"%";
        } catch (Exception ignored) { return "غير متاح"; }
    }
    private void dashboardCards(LinearLayout content, boolean compact) {
        ActivityManager.MemoryInfo info=new ActivityManager.MemoryInfo();
        String ram="غير متاح";
        try {
            ActivityManager am=(ActivityManager)getSystemService(Context.ACTIVITY_SERVICE);
            if (am!=null) {
                am.getMemoryInfo(info);
                ram=size(info.availMem)+" متاح";
            }
        } catch (Exception ignored) {}
        String storage="غير متاح";
        try {
            StatFs fs=new StatFs(Environment.getDataDirectory().getPath());
            storage=size(fs.getAvailableBytes())+" متاح";
        } catch (Exception ignored) {}
        String[] names={"الذاكرة","التخزين","الواي فاي","البطارية"};
        String[] values={ram,storage,wifiStatus(),batteryStatus()};
        int[] accents={0xFF7DD3FF,0xFFFFCC78,0xFF83EDCE,0xFFD5A9FF};
        LinearLayout line=row();
        for (int i=0;i<names.length;i++) {
            LinearLayout card=column();
            card.setPadding(dp(14),dp(9),dp(14),dp(7));
            card.setBackgroundDrawable(panel(GLASS,accents[i],17));
            card.addView(text(names[i],13,MUTED,true),lp(-1,26,1));
            TextView value=text(values[i],compact?15:20,WHITE,true);
            value.setSingleLine(true);value.setEllipsize(TextUtils.TruncateAt.END);
            card.addView(value,lp(-1,35,1));
            LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(0,dp(compact?77:90),1f);
            params.setMargins(dp(5),dp(4),dp(5),dp(5));
            line.addView(card,params);
        }
        content.addView(line,lp(-1,-2,3));
    }
    private void systemPage(LinearLayout content) {
        heading(content,"لوحة النظام  ◈","معلومات حقيقية من Android، تُحدّث عند فتح الصفحة");
        dashboardCards(content,false);
        content.addView(settingRow("معلومات الجهاز","Android "+Build.VERSION.RELEASE+"  •  "+Build.MANUFACTURER+
            "  •  "+Build.MODEL,"حول الجهاز",new View.OnClickListener() {
                @Override public void onClick(View v) { openAboutDevice(); }
            }),lp(-1,100,6));
        content.addView(settingRow("إعدادات الشبكة","الحالة الحالية: "+wifiStatus(),
            "فتح الواي فاي",new View.OnClickListener() {
                @Override public void onClick(View v) {
                    if(!launchSystemAction(Settings.ACTION_WIFI_SETTINGS))systemSettings();
                }
            }),lp(-1,100,6));
        content.addView(settingRow("المطوّر","حالة خيارات المطوّر: "+
            (isDeveloperModeEnabled()?"مفعّلة":"مخفية أو غير مفعّلة"),
            "خيارات المطوّر",new View.OnClickListener() {
                @Override public void onClick(View v) { render("developer"); }
            }),lp(-1,100,6));
        content.addView(settingRow("صيانة الواجهة","تنظيف مؤقتات Huidi Home وتحديث التطبيقات",
            "فتح الصيانة",new View.OnClickListener() {
                @Override public void onClick(View v) { render("maintenance"); }
            }),lp(-1,100,6));
    }
    private void wallpapersPage(LinearLayout content) {
        heading(content,"الخلفيات الزجاجية  ✦","اختر النمط؛ تُرسم الخلفيات محليًا بدون ملفات صور كبيرة");
        final String[] keys={"aurora","nebula","grid","minimal"};
        final String[] labels={"أورورا مضيئة","سديم سينمائي","شبكة زجاجية","هادئة وسريعة"};
        for(int i=0;i<keys.length;i++) {
            final String chosen=keys[i];
            content.addView(settingRow(labels[i],
                chosen.equals(prefs.getString("wallpaper","aurora"))?"✓ الخلفية الحالية":"تغيير شكل الإضاءة والأنماط",
                "تطبيق",new View.OnClickListener(){
                    @Override public void onClick(View v){
                        prefs.edit().putString("wallpaper",chosen).apply();
                        render("wallpapers");
                    }
                }),lp(-1,92,5));
        }
    }

    private interface PinAction { void onPin(String pin); }
    /** Accessible, D-pad navigable PIN pad with no system keyboard dependency. */
    private void numericPin(String title, final PinAction action) {
        final android.app.AlertDialog dialog=new AlertDialog.Builder(this).create();
        LinearLayout body=column();
        body.setPadding(dp(18),dp(14),dp(18),dp(14));
        body.setBackgroundDrawable(panel(0xEE192135,accent,19));
        TextView header=text(title,20,WHITE,true);
        header.setGravity(Gravity.CENTER);
        body.addView(header,lp(-1,50,3));
        final StringBuilder digits=new StringBuilder(6);
        final TextView masked=text("○ ○ ○ ○ ○ ○",22,accent,true);
        masked.setGravity(Gravity.CENTER);
        body.addView(masked,lp(-1,41,3));
        GridLayout keyboard=new GridLayout(this);
        keyboard.setColumnCount(3);
        Button first=null;
        for (int n=1;n<=12;n++) {
            final int digit=n<=9?n:(n==11?0:-1);
            String value=n==10?"⌫":n==12?"إلغاء":String.valueOf(digit);
            final Button key=button(value,new View.OnClickListener(){
                @Override public void onClick(View v){
                    if (digit<0) {
                        if("⌫".contentEquals(((Button)v).getText())) {
                            if(digits.length()>0)digits.deleteCharAt(digits.length()-1);
                        } else dialog.dismiss();
                    } else if(digits.length()<6)digits.append(digit);
                    StringBuilder display=new StringBuilder();
                    for(int j=0;j<6;j++)display.append(j<digits.length()?"● ":"○ ");
                    masked.setText(display.toString());
                    if(digits.length()==6){
                        String response=digits.toString();
                        digits.setLength(0);
                        dialog.dismiss();
                        action.onPin(response);
                    }
                }
            },false);
            if(first==null)first=key;
            GridLayout.LayoutParams cell=new GridLayout.LayoutParams();
            cell.width=dp(88); cell.height=dp(46);
            cell.setMargins(dp(4),dp(4),dp(4),dp(4));
            keyboard.addView(key,cell);
        }
        body.addView(keyboard,lp(-2,-2,3));
        dialog.setView(body);
        dialog.setOnShowListener(new DialogInterface.OnShowListener(){
            @Override public void onShow(DialogInterface d){
                if(keyboard.getChildCount()>0)keyboard.getChildAt(0).requestFocus();
            }
        });
        dialog.show();
    }
    private void createPin() {
        numericPin("أنشئ رمز القفل (6 أرقام)",new PinAction(){
            @Override public void onPin(final String first) {
                numericPin("أعد إدخال الرمز للتأكيد",new PinAction(){
                    @Override public void onPin(String verify) {
                        if(!first.equals(verify)) {
                            Toast.makeText(MainActivity.this,"الرمزان غير متطابقين، لم يتم حفظ رمز",Toast.LENGTH_LONG).show();
                            return;
                        }
                        if(pinGate.savePin(first)) {
                            Toast.makeText(MainActivity.this,"تم تفعيل رمز حماية اللانشر",Toast.LENGTH_LONG).show();
                        } else Toast.makeText(MainActivity.this,"تعذّر حفظ الرمز على هذا النظام",Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }
    private void appActions(final AppEntry app) {
        final boolean guarded=pinGate.isLocked(app.pkg);
        final String[] choices={favorites().contains(app.pkg)?"إزالة من المفضلة":"إضافة للمفضلة",
            guarded?"إلغاء قفل التطبيق":"قفل التطبيق برمز"};
        new AlertDialog.Builder(this).setTitle("إدارة "+app.label)
            .setItems(choices,new DialogInterface.OnClickListener(){
                @Override public void onClick(DialogInterface d,int which) {
                    if(which==0)toggleFavorite(app);
                    else if(!pinGate.hasPin()) {
                        new AlertDialog.Builder(MainActivity.this).setTitle("إعداد رمز الحماية")
                            .setMessage("حدّد أولًا رمزًا من 6 أرقام لقفل اختصارات التطبيقات من Huidi Home.")
                            .setPositiveButton("إنشاء الرمز",new DialogInterface.OnClickListener(){
                                @Override public void onClick(DialogInterface d,int w){createPin();}
                            }).setNegativeButton("إلغاء",null).show();
                    } else {
                        numericPin("تأكيد الرمز لإدارة القفل",new PinAction(){
                            @Override public void onPin(String entered){
                                if(!pinGate.verify(entered)) {
                                    Toast.makeText(MainActivity.this,"رمز غير صحيح",Toast.LENGTH_SHORT).show();return;
                                }
                                pinGate.setLocked(app.pkg,!guarded);
                                render(page);
                            }
                        });
                    }
                }
            }).show();
    }
    private void managePin() {
        if (!pinGate.hasPin()) {
            new AlertDialog.Builder(this).setTitle("قفل اختصارات التطبيقات")
                .setMessage("احمِ تشغيل تطبيقات محددة من داخل Huidi Home فقط. يمكن تجاوز الحماية من واجهة النظام الأصلية؛ ليست رقابة أبوية على مستوى الجهاز.")
                .setPositiveButton("إنشاء رمز من 6 أرقام",new DialogInterface.OnClickListener(){
                    @Override public void onClick(DialogInterface d,int which){createPin();}
                }).setNegativeButton("إلغاء",null).show();
            return;
        }
        numericPin("رمز القفل لإدارة الحماية",new PinAction(){
            @Override public void onPin(String code){
                if(!pinGate.verify(code)) {
                    Toast.makeText(MainActivity.this,"رمز غير صحيح",Toast.LENGTH_SHORT).show();return;
                }
                final String[] options={"تغيير رمز الحماية","إلغاء رمز الحماية وكل القيود","تصفّح التطبيقات لقفلها"};
                new AlertDialog.Builder(MainActivity.this).setTitle("إعدادات الحماية")
                    .setItems(options,new DialogInterface.OnClickListener(){
                        @Override public void onClick(DialogInterface d,int which){
                            if(which==0)createPin();
                            else if(which==1) {
                                new AlertDialog.Builder(MainActivity.this)
                                    .setTitle("إزالة القفل")
                                    .setMessage("سيتم إلغاء كل أقفال التطبيقات من داخل Huidi Home.")
                                    .setPositiveButton("إزالة",new DialogInterface.OnClickListener(){
                                        @Override public void onClick(DialogInterface d,int w){
                                            pinGate.clear();render("settings");
                                        }
                                    }).setNegativeButton("إلغاء",null).show();
                            } else render("apps");
                        }
                    }).show();
            }
        });
    }

    private void chooseHome() {
        new AlertDialog.Builder(this).setTitle("تعيين واجهة الشاشة الرئيسية")
            .setMessage("اضغط زر Home في الريموت، واختر «Huidi Home | بيتي» ثم «دائمًا» إذا ظهر اختيار المشغّل.\n\nإذا لم يظهر الاختيار، افتح إعدادات النظام ← التطبيقات ← المشغّل الحالي ← مسح الإعدادات الافتراضية، ثم اضغط Home. لا تُحذف تطبيقاتك.")
            .setPositiveButton("تجربة زر Home", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int which) {
                    Intent home = new Intent(Intent.ACTION_MAIN);
                    home.addCategory(Intent.CATEGORY_HOME);
                    home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { startActivity(home); }
                    catch (Exception error) { systemSettings(); }
                }
            })
            .setNeutralButton("إعدادات النظام", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int which) { systemSettings(); }
            })
            .setNegativeButton("إلغاء", null).show();
    }
    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU && event.getRepeatCount() == 0 && focusedApp != null) {
            appActions(focusedApp);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
    @Override public void onBackPressed() {
        if ("developer".equals(page) || "themes".equals(page) ||
            "wallpapers".equals(page) || "system".equals(page) || "maintenance".equals(page)) render("settings");
        else if (!"home".equals(page)) render("home");
        else new AlertDialog.Builder(this).setMessage("Huidi Home هي واجهتك. لفتح المشغّل الأصلي استخدم إعدادات النظام.")
            .setPositiveButton("الإعدادات", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int which) { systemSettings(); }
            }).setNegativeButton("إلغاء", null).show();
    }
    @Override public void onLowMemory() {
        super.onLowMemory();
        showAllApps = false;
    }
    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) showAllApps = false;
    }
    @Override protected void onDestroy() {
        clockHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private static final class PremierHero extends Drawable {
        private final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);
        private final int color;
        PremierHero(int accent){this.color=accent;}
        @Override public void draw(Canvas canvas){
            Rect b=getBounds();int w=b.width(),h=b.height();
            if(w<=0||h<=0)return;
            p.setShader(new LinearGradient(0,0,w,h,
                new int[]{0xFF392635,0xFF222539,0xFF101D30},
                null,Shader.TileMode.CLAMP));
            canvas.drawRect(b,p);
            p.setShader(new RadialGradient(w*0.92f,h*0.30f,Math.max(w,h)*0.60f,
                new int[]{mix(color,0xFFFFFFFF,0.1f,145),0x00000000},
                null,Shader.TileMode.CLAMP));
            canvas.drawRect(b,p);
            p.setShader(null);
            p.setColor(0x27F8D4A0);p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(Math.max(1f,w/250f));
            canvas.drawCircle(w*0.92f,h*0.40f,h*0.74f,p);
            canvas.drawCircle(w*0.92f,h*0.40f,h*0.93f,p);
            p.setStyle(Paint.Style.FILL);
        }
        @Override public void setAlpha(int a){}
        @Override public void setColorFilter(ColorFilter f){}
        @Override public int getOpacity(){return PixelFormat.OPAQUE;}
    }

    private static final class Wallpaper extends Drawable {
        private final int accent;
        private final String style;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Wallpaper(int accent, String style) { this.accent = accent; this.style = style; }
        @Override public void draw(Canvas canvas) {
            Rect b = getBounds();
            int w = b.width(), h = b.height();
            if (w <= 0 || h <= 0) return;
            paint.setShader(new LinearGradient(0, 0, w, h,
                new int[] {BG, 0xFF171320, 0xFF0C1520}, null, Shader.TileMode.CLAMP));
            canvas.drawRect(b, paint);
            if ("minimal".equals(style)) { paint.setShader(null); return; }
            float cx="nebula".equals(style)?0.50f:0.87f;
            paint.setShader(new RadialGradient(w * cx, h * 0.13f, Math.max(w,h) * 0.65f,
                new int[] {mix(accent, 0xFFFFFFFF, 0.14f, 102), 0x00000000},
                null, Shader.TileMode.CLAMP));
            canvas.drawRect(b, paint);
            paint.setShader(new RadialGradient(w * 0.11f, h * 0.87f, Math.max(w,h) * 0.55f,
                new int[] {0x554B68A6, 0x00000000},
                null, Shader.TileMode.CLAMP));
            canvas.drawRect(b, paint);
            paint.setShader(null);
            // Subtle ambient ornaments, no costly image decoding.
            paint.setColor(0x0AFFFFFF);
            paint.setStrokeWidth(1f);
            if ("grid".equals(style) || "aurora".equals(style)) {
                for(int x=0;x<w;x+=Math.max(80,w/12))canvas.drawLine(x,0,x,h,paint);
                for(int y=0;y<h;y+=Math.max(80,h/8))canvas.drawLine(0,y,w,y,paint);
            } else if ("nebula".equals(style)) {
                paint.setColor(0x50FFFFFF);
                for(int i=0;i<22;i++) {
                    float x=((i*157L+41)%Math.max(1,w));
                    float y=((i*97L+29)%Math.max(1,h));
                    canvas.drawCircle(x,y,Math.max(0.8f,h/720f),paint);
                }
            }
        }
        @Override public void setAlpha(int alpha) { }
        @Override public void setColorFilter(ColorFilter filter) { }
        @Override public int getOpacity() { return PixelFormat.OPAQUE; }
    }
}
