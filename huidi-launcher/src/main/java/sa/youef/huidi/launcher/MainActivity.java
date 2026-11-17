package sa.youef.huidi.launcher;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
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
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Huidi Home: a stand-alone, offline Android TV HOME launcher.
 * Native widgets, no WebView, no Internet permission, and no heavy bitmap wallpaper.
 * Designed for API 19/ARMv7 televisions with limited free RAM.
 */
public final class MainActivity extends Activity {
    private static final int BG = 0xFF090D16, PANEL = 0xEE19212F, WHITE = 0xFFF7F5F0;
    private static final int MUTED = 0xFFBEC3D4, PALE = 0xFFF8DFB4;
    private static final int GLASS = 0xC9253046, GLASS_EDGE = 0x668CC5F4;
    // KitKat-safe translucent gradients (not unsupported RenderEffect blur).
    private final Handler clockHandler = new Handler();
    private final ArrayList<AppEntry> apps = new ArrayList<AppEntry>();
    private SharedPreferences prefs;
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
        int base = color == PANEL ? GLASS : color;
        GradientDrawable drawable = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] {
                mix(base, 0xFFFFFFFF, 0.19f, 225),
                mix(base, 0xFF182134, 0.20f, 211),
                mix(base, 0xFF080C18, 0.35f, 219)
            });
        drawable.setCornerRadius(dp(radius));
        drawable.setStroke(dp(1), mix(stroke, 0xFFFFFFFF, 0.20f, 165));
        return drawable;
    }
    private GradientDrawable heroDrawable() {
        GradientDrawable drawable = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] {
                mix(0xFF272338, accent, 0.28f, 238),
                0xE9232A3E, 0xEC101827
            });
        drawable.setCornerRadius(dp(28));
        drawable.setStroke(dp(2), mix(accent, 0xFFFFFFFF, 0.22f, 180));
        return drawable;
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
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setMinHeight(0); view.setMinimumHeight(0);
        view.setPadding(dp(17), dp(4), dp(17), dp(4));
        view.setFocusable(true);
        view.setBackgroundDrawable(panel(primary ? mix(GLASS, accent, 0.31f, 232) : PANEL,
            primary ? accent : GLASS_EDGE, 16));
        view.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View target, boolean focused) {
                view.setBackgroundDrawable(panel(
                    focused ? mix(GLASS, accent, 0.52f, 241) : primary ? mix(GLASS, accent, 0.31f, 232) : PANEL,
                    focused ? 0xFFF9F3E8 : primary ? accent : GLASS_EDGE, 16));
                view.animate().scaleX(focused ? 1.035f : 1f).scaleY(focused ? 1.035f : 1f).setDuration(120).start();
            }
        });
        view.setOnClickListener(click);
        return view;
    }

    private void render(String section) {
        clockHandler.removeCallbacks(tick);
        page = section;
        accent = currentAccent();
        focusedApp = null;
        clockView = null;
        FrameLayout scene = new FrameLayout(this);
        scene.setBackgroundDrawable(new Wallpaper(accent));
        scene.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        setContentView(scene);
        LinearLayout shell = column();
        shell.setPadding(dp(lite() ? 14 : 23), dp(10), dp(lite() ? 14 : 23), dp(10));
        scene.addView(shell, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout top = row();
        top.setPadding(dp(13), dp(5), dp(13), dp(5));
        top.setBackgroundDrawable(panel(0xCC151D30, GLASS_EDGE, 23));
        TextView emblem = text("◈", 36, accent, true);
        emblem.setGravity(Gravity.CENTER);
        emblem.setBackgroundDrawable(panel(0xFF24222D, accent, 16));
        top.addView(emblem, lp(62, 57, 4));
        LinearLayout brand = column();
        brand.addView(text("HUIDI  HOME", 23, WHITE, true), lp(-2, -2, 0));
        brand.addView(text("LIVING GLASS  •  بيتي الذكي", 12, MUTED, false), lp(-2, -2, 0));
        top.addView(brand, lp(-2, -2, 7));
        top.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1f));
        TextView status = text("●  " + (lite() ? "الوضع الخفيف" : "تصميم زجاجي"), 12, accent, true);
        status.setBackgroundDrawable(panel(0x991B2638, accent, 13));
        status.setPadding(dp(12), 0, dp(12), 0);
        top.addView(status, lp(-2, 37, 7));
        clockView = text("", 18, PALE, true);
        top.addView(clockView, lp(-2, 52, 9));
        shell.addView(top, lp(-1, 71, 0));

        LinearLayout menu = row();
        String[] names = {"الرئيسية", "التطبيقات", "المفضلة", "الثيمات", "المطوّر", "الإعدادات"};
        String[] pages = {"home", "apps", "favorites", "themes", "developer", "settings"};
        for (int i = 0; i < names.length; i++) {
            final String destination = pages[i];
            Button tab = button(names[i], new View.OnClickListener() {
                @Override public void onClick(View view) { render(destination); }
            }, destination.equals(page));
            menu.addView(tab, lp(-2, 46, 5));
        }
        menu.setPadding(dp(9), dp(3), dp(9), dp(3));
        menu.setBackgroundDrawable(panel(0xB3141B2C, GLASS_EDGE, 20));
        shell.addView(menu, lp(-1, 60, 6));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setVerticalScrollBarEnabled(false);
        shell.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));
        LinearLayout content = column();
        content.setPadding(dp(5), dp(9), dp(5), dp(6));
        scroll.addView(content, new ScrollView.LayoutParams(-1, -2));
        if ("apps".equals(section)) {
            appGrid(content, false);
        } else if ("favorites".equals(section)) {
            appGrid(content, true);
        } else if ("settings".equals(section)) {
            settingsPage(content);
        } else if ("developer".equals(section)) {
            developerPage(content);
        } else if ("themes".equals(section)) {
            themesPage(content);
        } else {
            homePage(content);
        }
        TextView footer = text("الأسهم للتنقل  •  OK للفتح  •  MENU لحفظ التطبيق في المفضلة", 12, 0xFF929AAC, false);
        footer.setGravity(Gravity.CENTER);
        footer.setBackgroundDrawable(panel(0xA2162236, 0x446B7897, 12));
        shell.addView(footer, lp(-1, 33, 3));
        tick.run();
    }

    private void heading(LinearLayout parent, String value, String sub) {
        parent.addView(text(value, 25, WHITE, true), lp(-1, 43, 6));
        if (sub != null && sub.length() > 0)
            parent.addView(text(sub, 13, MUTED, false), lp(-1, 27, 5));
    }

    private void homePage(LinearLayout content) {
        LinearLayout hero = column();
        hero.setPadding(dp(24), dp(17), dp(24), dp(17));
        hero.setBackgroundDrawable(heroDrawable());
        TextView eyebrow = text("✦  HUIDI HOME  /  GLASS EDITION", 13, accent, true);
        hero.addView(eyebrow, lp(-1, 28, 0));
        hero.addView(text("تلفزيونك... بإطلالة جديدة.", lite() ? 27 : 36, WHITE, true), lp(-1, 61, 0));
        hero.addView(text("زجاج داكن  •  ألوان مضيئة  •  وصول سريع  •  تحكم كامل بالريموت",
            16, MUTED, false), lp(-1, 38, 0));
        LinearLayout actions = row();
        final AppEntry tv = alezz();
        actions.addView(button(tv == null ? "كل التطبيقات  ←" : "▶  افتح العز TV",
            new View.OnClickListener() {
                @Override public void onClick(View view) { if (tv == null) render("apps"); else openApp(tv); }
            }, true), lp(-2, 52, 4));
        actions.addView(button("◈  معرض الثيمات", new View.OnClickListener() {
            @Override public void onClick(View view) { render("themes"); }
        }, false), lp(-2, 52, 4));
        actions.addView(button("⚙  خيارات المطوّر", new View.OnClickListener() {
            @Override public void onClick(View view) { render("developer"); }
        }, false), lp(-2, 52, 4));
        hero.addView(actions, lp(-1, 58, 0));
        content.addView(hero, lp(-1, -2, 7));

        heading(content, "الوصول السريع  ✦", "اختصارات زجاجية بألوان متناسقة مع الثيم");
        LinearLayout shortcuts = row();
        shortcuts.setWeightSum(4);
        shortcuts.addView(shortcut("العز TV", "مشاهدة الأفلام والقنوات", "▶", tv, false), weightedCard());
        shortcuts.addView(shortcut("يوتيوب", "مقاطع وفيديو", "▷", lookup("com.google.android.youtube.tv", "youtube"), false), weightedCard());
        shortcuts.addView(shortcut("الإعدادات", "إعدادات التلفزيون", "⚙", null, true), weightedCard());
        shortcuts.addView(shortcut("التطبيقات", "جميع التطبيقات", "▦", null, false), weightedCard());
        content.addView(shortcuts, lp(-1, 112, 0));

        heading(content, "مفضلتك  ★", "اضغط مطوّلًا OK أو زر MENU على أي تطبيق لإضافته");
        renderGrid(content, true, 8, false);
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
        renderGrid(content, onlyFavorites, lite() ? 18 : 36, true);
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
        int columns = usableDp > 1260 ? 5 : usableDp > 890 ? 4 : 3;
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
            params.height = dp(lite() ? 88 : 99);
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

    private View appTile(final AppEntry app, final boolean favorite) {
        final LinearLayout tile = row();
        tile.setPadding(dp(11), dp(7), dp(11), dp(7));
        tile.setFocusable(true);
        tile.setClickable(true);
        tile.setBackgroundDrawable(panel(GLASS, GLASS_EDGE, 20));
        ImageView icon = new ImageView(this);
        try { icon.setImageDrawable(getPackageManager().getApplicationIcon(app.pkg)); }
        catch (Exception ignore) { icon.setImageResource(android.R.drawable.sym_def_app_icon); }
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        icon.setBackgroundDrawable(panel(0x99242B41, 0x667D97B4, 13));
        icon.setPadding(dp(5), dp(5), dp(5), dp(5));
        tile.addView(icon, lp(lite() ? 39 : 45, lite() ? 39 : 45, 4));
        LinearLayout labels = column();
        TextView title = text(app.label, 15, WHITE, true);
        title.setSingleLine(true); title.setEllipsize(TextUtils.TruncateAt.END);
        labels.addView(title, lp(-1, 31, 1));
        TextView tag = text(favorite ? "★  مفضّل" : "تطبيق  •  MENU للحفظ", 11, favorite ? accent : MUTED, false);
        tag.setSingleLine(true); tag.setEllipsize(TextUtils.TruncateAt.END);
        labels.addView(tag, lp(-1, 25, 1));
        tile.addView(labels, new LinearLayout.LayoutParams(0, -2, 1f));
        tile.setContentDescription(app.label + (favorite ? " في المفضلة" : ""));
        tile.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View view, boolean focused) {
                if (focused) focusedApp = app;
                else if (focusedApp == app) focusedApp = null;
                tile.setBackgroundDrawable(panel(focused ? mix(GLASS, accent, 0.33f, 242) : GLASS,
                    focused ? 0xFFF9F3E8 : GLASS_EDGE, 20));
                tile.animate().scaleX(focused ? 1.035f : 1f)
                    .scaleY(focused ? 1.035f : 1f).setDuration(130).start();
            }
        });
        tile.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { openApp(app); }
        });
        tile.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { toggleFavorite(app); return true; }
        });
        return tile;
    }

    private void settingsPage(LinearLayout content) {
        heading(content, "تخصيص بيتي  ◈", "ألوان زجاجية وإعدادات محلية بدون حساب أو اتصال");
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
        line.setBackgroundDrawable(panel(GLASS, GLASS_EDGE, 19));
        LinearLayout copy = column();
        copy.addView(text(name, 18, WHITE, true), lp(-1, 34, 1));
        TextView sub = text(details, 13, MUTED, false);
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
        heading(content, "معرض الثيمات الزجاجية  ✦", "ستة ألوان مضيئة على واجهة خفيفة متوافقة مع Android 4.4");
        String[] keys = {"gold", "red", "blue", "violet", "emerald", "rose"};
        String[] names = {"ذهبي فاخر", "أحمر سينمائي", "أزرق جليدي",
            "بنفسجي ملكي", "زمردي", "وردي مخملي"};
        int[] colors = {0xFFFFC76D, 0xFFE04759, 0xFF58C8F8, 0xFFB39AFF, 0xFF53E0BB, 0xFFFB8FB0};
        for (int i = 0; i < keys.length; i++) {
            final String key = keys[i];
            final int color = colors[i];
            final LinearLayout line = row();
            line.setPadding(dp(16), dp(6), dp(16), dp(6));
            line.setBackgroundDrawable(panel(mix(GLASS, color, 0.22f, 215), color, 19));
            TextView chip = text("◉", 30, color, true);
            chip.setGravity(Gravity.CENTER);
            chip.setBackgroundDrawable(panel(0xBB141D2E, color, 13));
            line.addView(chip, lp(60, 58, 3));
            LinearLayout labels = column();
            labels.addView(text(names[i], 19, WHITE, true), lp(-1, 35, 2));
            labels.addView(text(key.equals(prefs.getString("theme","gold")) ?
                "✓  الثيم الحالي" : "ألوان متناغمة مع خلفية مضيئة وزجاج داكن",
                12, key.equals(prefs.getString("theme","gold")) ? color : MUTED, false), lp(-1, 27, 2));
            line.addView(labels, new LinearLayout.LayoutParams(0, -2, 1f));
            line.addView(button("تطبيق الثيم", new View.OnClickListener() {
                @Override public void onClick(View v) {
                    prefs.edit().putString("theme", key).apply();
                    render("themes");
                }
            }, false), lp(-2, 47, 3));
            content.addView(line, lp(-1, 87, 6));
        }
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
            toggleFavorite(focusedApp);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
    @Override public void onBackPressed() {
        if ("developer".equals(page) || "themes".equals(page)) render("settings");
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

    private static final class Wallpaper extends Drawable {
        private final int accent;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Wallpaper(int accent) { this.accent = accent; }
        @Override public void draw(Canvas canvas) {
            Rect b = getBounds();
            int w = b.width(), h = b.height();
            if (w <= 0 || h <= 0) return;
            paint.setShader(new LinearGradient(0, 0, w, h,
                new int[] {BG, 0xFF171320, 0xFF0C1520}, null, Shader.TileMode.CLAMP));
            canvas.drawRect(b, paint);
            paint.setShader(new RadialGradient(w * 0.87f, h * 0.13f, Math.max(w,h) * 0.65f,
                new int[] {mix(accent, 0xFFFFFFFF, 0.14f, 102), 0x00000000},
                null, Shader.TileMode.CLAMP));
            canvas.drawRect(b, paint);
            paint.setShader(new RadialGradient(w * 0.11f, h * 0.87f, Math.max(w,h) * 0.55f,
                new int[] {0x554B68A6, 0x00000000},
                null, Shader.TileMode.CLAMP));
            canvas.drawRect(b, paint);
            paint.setShader(null);
            // Delicate glass-grid lines: no bitmap allocation, animations or blur shaders.
            paint.setColor(0x15FFFFFF);
            paint.setStrokeWidth(1f);
            for(int x=0;x<w;x+=Math.max(80,w/12))canvas.drawLine(x,0,x,h,paint);
            for(int y=0;y<h;y+=Math.max(80,h/8))canvas.drawLine(0,y,w,y,paint);
        }
        @Override public void setAlpha(int alpha) { }
        @Override public void setColorFilter(ColorFilter filter) { }
        @Override public int getOpacity() { return PixelFormat.OPAQUE; }
    }
}
