package com.aseel.tv;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Lightweight TV-first UI; Android API 19, Java 7, no external dependencies.
 * This is an offline UI preview. Licensed catalog and playback are NOT connected.
 */
public final class MainActivity extends Activity {
    private static final int NAVY = Color.rgb(9, 16, 31);
    private static final int PANEL = Color.rgb(19, 29, 48);
    private static final int GOLD = Color.rgb(218, 188, 117);
    private static final int MUTED = Color.rgb(171, 187, 204);
    private static final String[] PAGES =
        {"home", "movies", "series", "channels", "favorites", "search", "settings"};
    private static final int[] LABELS =
        {R.string.nav_home, R.string.nav_movies, R.string.nav_series, R.string.nav_channels,
         R.string.nav_favorites, R.string.nav_search, R.string.nav_settings};
    private final Map<String, Button> navButtons = new LinkedHashMap<String, Button>();
    private LinearLayout body;
    private TextView keyResult;
    private String page = "home";

    private int dp(float n) {
        return (int) (n * getResources().getDisplayMetrics().density + 0.5f);
    }

    private GradientDrawable bg(int color, int outline, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radius));
        d.setStroke(dp(1), outline);
        return d;
    }

    private GradientDrawable gradient() {
        GradientDrawable d = new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] {Color.rgb(43, 53, 68), PANEL, NAVY});
        d.setCornerRadius(dp(20));
        d.setStroke(dp(1), Color.rgb(96, 82, 59));
        return d;
    }

    private TextView text(String s, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(color);
        t.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        t.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        t.setPadding(dp(2), dp(3), dp(2), dp(3));
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private void space(LinearLayout parent, int height) {
        View v = new View(this);
        parent.addView(v, new LinearLayout.LayoutParams(1, dp(height)));
    }

    private Button button(String label, boolean gold) {
        final Button b = new Button(this);
        b.setId(View.generateViewId());
        b.setText(label);
        b.setTextSize(17);
        b.setAllCaps(false);
        b.setFocusable(true);
        b.setTextColor(gold ? NAVY : Color.WHITE);
        b.setBackgroundDrawable(bg(gold ? GOLD : PANEL,
                gold ? GOLD : Color.rgb(68, 77, 91), 11));
        b.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View view, boolean focused) {
                boolean activeGold = Boolean.TRUE.equals(view.getTag());
                b.setBackgroundDrawable(bg(focused ? GOLD : (activeGold ? GOLD : PANEL),
                        focused ? Color.WHITE : (activeGold ? GOLD : Color.rgb(68, 77, 91)), 11));
                b.setTextColor(focused || activeGold ? NAVY : Color.WHITE);
                b.setScaleX(focused ? 1.035f : 1f);
                b.setScaleY(focused ? 1.035f : 1f);
            }
        });
        b.setTag(Boolean.valueOf(gold));
        return b;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        root.setBackgroundColor(NAVY);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setVerticalScrollBarEnabled(false);
        body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        body.setPadding(dp(22), dp(17), dp(22), dp(22));
        scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(0, -1, 1f));

        LinearLayout sidebar = new LinearLayout(this);
        sidebar.setOrientation(LinearLayout.VERTICAL);
        sidebar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        sidebar.setPadding(dp(12), dp(21), dp(12), dp(12));
        sidebar.setBackgroundColor(Color.rgb(15, 23, 40));
        int w = getResources().getDisplayMetrics().widthPixels;
        int sidebarWidth = Math.min(dp(212), Math.max(dp(150), w / 4));
        root.addView(sidebar, new LinearLayout.LayoutParams(sidebarWidth, -1));

        TextView logo = text(getString(R.string.intro_title), 32, GOLD, true);
        logo.setGravity(Gravity.CENTER);
        sidebar.addView(logo, new LinearLayout.LayoutParams(-1, dp(49)));
        TextView subtitle = text(getString(R.string.intro_subtitle), 13, MUTED, false);
        subtitle.setGravity(Gravity.CENTER);
        sidebar.addView(subtitle);
        space(sidebar, 17);

        ScrollView menuScroll = new ScrollView(this);
        menuScroll.setFillViewport(false);
        menuScroll.setVerticalScrollBarEnabled(false);
        LinearLayout menu = new LinearLayout(this);
        menu.setOrientation(LinearLayout.VERTICAL);
        menu.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        menuScroll.addView(menu);
        sidebar.addView(menuScroll, new LinearLayout.LayoutParams(-1, 0, 1f));
        for (int i = 0; i < PAGES.length; i++) {
            final String id = PAGES[i];
            final Button b = button(getString(LABELS[i]), false);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(48));
            params.bottomMargin = dp(6);
            menu.addView(b, params);
            b.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View view) { showPage(id); }
            });
            navButtons.put(id, b);
        }
        TextView footer = text(getString(R.string.preview_label), 11, MUTED, false);
        footer.setGravity(Gravity.CENTER);
        sidebar.addView(footer);
        setContentView(root);
        showPage("home");
        navButtons.get("home").requestFocus();
    }

    private void heading(String title, String description) {
        TextView brand = text(getString(R.string.intro_title) + "  /  " + title, 23, GOLD, true);
        body.addView(brand);
        space(body, 4);
        body.addView(text(description, 15, MUTED, false));
        space(body, 20);
    }

    private void showPage(String next) {
        page = next;
        keyResult = null;
        body.removeAllViews();
        for (Map.Entry<String, Button> entry : navButtons.entrySet()) {
            Button b = entry.getValue();
            boolean active = entry.getKey().equals(next);
            b.setBackgroundDrawable(bg(active ? Color.rgb(47, 44, 41) : Color.rgb(21, 31, 49),
                  active ? GOLD : Color.rgb(21, 31, 49), 11));
            b.setTextColor(active ? GOLD : Color.WHITE);
        }
        if ("home".equals(page)) home();
        else if ("diagnostics".equals(page)) diagnostics();
        else if ("remote".equals(page)) remoteTest();
        else if ("settings".equals(page)) settings();
        else emptyCategory();
    }

    private void home() {
        heading(getString(R.string.nav_home), getString(R.string.preview_description));
        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        hero.setGravity(Gravity.CENTER_VERTICAL);
        hero.setPadding(dp(24), dp(22), dp(24), dp(23));
        hero.setBackgroundDrawable(gradient());
        body.addView(hero, new LinearLayout.LayoutParams(-1, -2));
        hero.addView(text(getString(R.string.hero_eyebrow), 14, GOLD, true));
        hero.addView(text(getString(R.string.hero_title), 29, Color.WHITE, true));
        space(hero, 7);
        hero.addView(text(getString(R.string.hero_description), 16, MUTED, false));
        space(hero, 18);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        hero.addView(actions, new LinearLayout.LayoutParams(-1, -2));
        Button remote = button(getString(R.string.check_remote), true);
        Button info = button(getString(R.string.check_device), false);
        LinearLayout.LayoutParams a = new LinearLayout.LayoutParams(0, dp(54), 1f);
        a.leftMargin = dp(9);
        actions.addView(remote, a);
        actions.addView(info, new LinearLayout.LayoutParams(0, dp(54), 1f));
        remote.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showPage("remote"); }
        });
        info.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showPage("diagnostics"); }
        });

        space(body, 21);
        body.addView(text(getString(R.string.sections_title), 20, Color.WHITE, true));
        space(body, 9);
        HorizontalScrollView h = new HorizontalScrollView(this);
        h.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        row.setOrientation(LinearLayout.HORIZONTAL);
        String[] ids = {"movies", "series", "channels"};
        for (int i = 0; i < ids.length; i++) {
            final String id = ids[i];
            Button tile = button(getString(LABELS[i + 1]), false);
            tile.setTextSize(20);
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(177), dp(108));
            p.leftMargin = dp(12);
            row.addView(tile, p);
            tile.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { showPage(id); }
            });
        }
        h.addView(row);
        body.addView(h);
        space(body, 16);
        body.addView(text(getString(R.string.no_content_explanation), 14, MUTED, false));
    }

    private void cardMessage(String headline, String detail) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        card.setPadding(dp(23), dp(21), dp(23), dp(22));
        card.setBackgroundDrawable(bg(PANEL, Color.rgb(45, 59, 77), 15));
        card.addView(text(headline, 23, GOLD, true));
        space(card, 7);
        card.addView(text(detail, 17, MUTED, false));
        body.addView(card);
    }

    private void emptyCategory() {
        int index = -1;
        for (int i = 0; i < PAGES.length; i++)
            if (PAGES[i].equals(page)) index = i;
        String title = index < 0 ? getString(R.string.nav_home) : getString(LABELS[index]);
        heading(title, getString(R.string.preview_description));
        cardMessage(getString(R.string.empty_title),
            getString(R.string.empty_description) + " " + title + ".");
        space(body, 17);
        Button diagnostics = button(getString(R.string.check_device), true);
        body.addView(diagnostics, new LinearLayout.LayoutParams(-1, dp(55)));
        diagnostics.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showPage("diagnostics"); }
        });
    }

    private void settings() {
        heading(getString(R.string.nav_settings), getString(R.string.preview_description));
        cardMessage(getString(R.string.preview_label), getString(R.string.settings_description));
        space(body, 15);
        Button info = button(getString(R.string.check_device), true);
        body.addView(info, new LinearLayout.LayoutParams(-1, dp(58)));
        info.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showPage("diagnostics"); }
        });
        space(body, 11);
        Button remote = button(getString(R.string.check_remote), false);
        body.addView(remote, new LinearLayout.LayoutParams(-1, dp(58)));
        remote.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showPage("remote"); }
        });
    }

    private void diagnostics() {
        heading(getString(R.string.check_device), getString(R.string.diag_intro));
        cardMessage(getString(R.string.diag_title), DeviceDiagnostics.getReport(this));
        space(body, 12);
        body.addView(text(getString(R.string.diag_note), 14, MUTED, false));
        space(body, 15);
        Button back = button(getString(R.string.nav_home), true);
        body.addView(back, new LinearLayout.LayoutParams(-1, dp(56)));
        back.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showPage("home"); }
        });
    }

    private void remoteTest() {
        heading(getString(R.string.check_remote), getString(R.string.remote_intro));
        cardMessage(getString(R.string.remote_heading), getString(R.string.remote_instruction));
        space(body, 16);
        keyResult = text(getString(R.string.remote_waiting), 22, GOLD, true);
        body.addView(keyResult);
        space(body, 15);
        Button ok = button(getString(R.string.test_button), true);
        body.addView(ok, new LinearLayout.LayoutParams(-1, dp(58)));
        ok.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (keyResult != null) keyResult.setText(getString(R.string.test_passed));
            }
        });
        space(body, 10);
        Button back = button(getString(R.string.nav_home), false);
        body.addView(back, new LinearLayout.LayoutParams(-1, dp(56)));
        back.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showPage("home"); }
        });
        ok.requestFocus();
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if (keyResult != null && event.getAction() == KeyEvent.ACTION_DOWN) {
            String name = KeyEvent.keyCodeToString(event.getKeyCode())
                .replace("KEYCODE_", "");
            keyResult.setText(getString(R.string.remote_pressed) + " " + name);
        }
        return super.dispatchKeyEvent(event);
    }

    @Override public void onBackPressed() {
        if (!"home".equals(page)) showPage("home");
        else super.onBackPressed();
    }
}
