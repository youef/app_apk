package sa.aseel.tv;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
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
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Locale;

/**
 * Aseel TV - Phase 1, offline Android 4.4.4 installation diagnostic.
 * Java 7, native platform Views only, no network and no native libraries.
 */
public final class MainActivity extends Activity {
    private static final int NAVY = Color.rgb(7, 17, 32);
    private static final int GOLD = Color.rgb(206, 174, 108);
    private static final int WHITE = Color.rgb(243, 244, 245);
    private static final int MUTED = Color.rgb(177, 189, 202);
    private TextView status;
    private TextView diagnostics;
    private boolean diagnosticsVisible;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);

        getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int pageMargin = dp(24);
        int contentWidth = Math.min(metrics.widthPixels - (2 * pageMargin), dp(880));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackground(makeBackground());
        scroll.setVerticalScrollBarEnabled(false);

        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        outer.setGravity(Gravity.CENTER);
        outer.setPadding(pageMargin, dp(18), pageMargin, dp(18));
        scroll.addView(outer, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setGravity(Gravity.CENTER_HORIZONTAL);
        body.setPadding(dp(30), dp(22), dp(30), dp(22));
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(Color.rgb(13, 28, 48));
        cardBg.setCornerRadius(dp(18));
        cardBg.setStroke(dp(1), Color.rgb(72, 78, 84));
        body.setBackgroundDrawable(cardBg);
        outer.addView(body, new LinearLayout.LayoutParams(contentWidth,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView logo = text("أسيل", 46, GOLD, true);
        logo.setGravity(Gravity.CENTER);
        body.addView(logo, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView label = text("ASEEL TV  •  أفلام ومسلسلات", 17, MUTED, false);
        label.setGravity(Gravity.CENTER);
        body.addView(label, margin(0, dp(5), 0, dp(13)));

        TextView success = text("تم تشغيل أسيل بنجاح", 27, WHITE, true);
        success.setGravity(Gravity.CENTER);
        body.addView(success, margin(0, dp(3), 0, dp(6)));

        TextView hint = text("اختبار التثبيت الأولي — بدون إنترنت أو تشغيل فيديو", 16, MUTED, false);
        hint.setGravity(Gravity.CENTER);
        body.addView(hint, margin(0, 0, 0, dp(20)));

        status = text("استخدم أسهم الريموت، ثم اضغط OK للاختيار", 16, GOLD, false);
        status.setGravity(Gravity.CENTER);
        body.addView(status, margin(0, 0, 0, dp(13)));

        Button remote = button("اختبار زر OK بالريموت");
        body.addView(remote, margin(0, dp(5), 0, dp(5)));
        remote.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                status.setText("نجح الاختبار: تم استقبال زر OK");
            }
        });

        Button details = button("عرض مواصفات هذه الشاشة");
        body.addView(details, margin(0, dp(5), 0, dp(5)));
        details.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                diagnosticsVisible = !diagnosticsVisible;
                diagnostics.setVisibility(diagnosticsVisible ? View.VISIBLE : View.GONE);
                status.setText(diagnosticsVisible ? "تم قراءة بيانات الجهاز محليًا" : "تم إخفاء بيانات الجهاز");
            }
        });

        Button exit = button("إغلاق التطبيق");
        body.addView(exit, margin(0, dp(5), 0, dp(5)));
        exit.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                finish();
            }
        });

        diagnostics = text(buildDiagnostics(), 14, WHITE, false);
        diagnostics.setGravity(Gravity.RIGHT);
        diagnostics.setTextDirection(View.TEXT_DIRECTION_RTL);
        diagnostics.setLineSpacing(dp(3), 1.0f);
        diagnostics.setVisibility(View.GONE);
        body.addView(diagnostics, margin(0, dp(18), 0, 0));

        TextView footer = text("Android 4.4.4 / API 19  •  Phase 1  •  v0.1.0", 13, MUTED, false);
        footer.setGravity(Gravity.CENTER);
        outer.addView(footer, margin(0, dp(15), 0, 0));

        setContentView(scroll);
        remote.requestFocus();
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (status != null) {
            if (keyCode == KeyEvent.KEYCODE_DPAD_UP) {
                status.setText("تم استقبال سهم الأعلى");
            } else if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                status.setText("تم استقبال سهم الأسفل");
            } else if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                status.setText("تم استقبال سهم اليسار");
            } else if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                status.setText("تم استقبال سهم اليمين");
            }
        }
        return super.onKeyUp(keyCode, event);
    }

    private Button button(String label) {
        final Button button = new Button(this);
        button.setText(label);
        button.setTextColor(WHITE);
        button.setTextSize(17);
        button.setAllCaps(false);
        button.setFocusable(true);
        button.setFocusableInTouchMode(false);
        button.setPadding(dp(16), dp(8), dp(16), dp(8));
        button.setMinimumHeight(dp(50));
        button.setBackgroundDrawable(buttonBackground(false));
        button.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            public void onFocusChange(View view, boolean hasFocus) {
                button.setBackgroundDrawable(buttonBackground(hasFocus));
                button.setTextColor(hasFocus ? NAVY : WHITE);
                button.setScaleX(hasFocus ? 1.025f : 1.0f);
                button.setScaleY(hasFocus ? 1.025f : 1.0f);
            }
        });
        return button;
    }

    private GradientDrawable buttonBackground(boolean focused) {
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(9));
        bg.setColor(focused ? GOLD : Color.rgb(30, 48, 69));
        bg.setStroke(dp(2), focused ? Color.rgb(252, 223, 149) : Color.rgb(86, 102, 116));
        return bg;
    }

    private GradientDrawable makeBackground() {
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{NAVY, Color.rgb(17, 35, 57), NAVY});
        return bg;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setTextDirection(View.TEXT_DIRECTION_RTL);
        if (bold) {
            view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        }
        return view;
    }

    private LinearLayout.LayoutParams margin(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.setMargins(left, top, right, bottom);
        return p;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String buildDiagnostics() {
        DisplayMetrics display = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(display);
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        if (am != null) {
            am.getMemoryInfo(memory);
        }
        long memoryMb = memory.totalMem / (1024L * 1024L);
        return "الشركة: " + safe(Build.MANUFACTURER)
                + "\nالطراز: " + safe(Build.MODEL)
                + "\nالعلامة: " + safe(Build.BRAND)
                + "\nاللوحة: " + safe(Build.BOARD)
                + "\nالمعالج/الشريحة: " + safe(Build.HARDWARE)
                + "\nالمعمارية: " + safe(Build.CPU_ABI)
                + "\nAndroid: " + safe(Build.VERSION.RELEASE)
                + "\nAPI: " + Build.VERSION.SDK_INT
                + "\nKernel: " + safe(System.getProperty("os.version"))
                + "\nالذاكرة الإجمالية (تقريبًا): " + memoryMb + " MB"
                + "\nدقة مساحة عرض الشاشة: " + display.widthPixels + " × " + display.heightPixels
                + "\nDPI: " + display.densityDpi
                + "\nإصدار النظام: " + safe(Build.DISPLAY);
    }

    private String safe(String value) {
        return value == null || value.length() == 0 ? "غير متاح" : value;
    }
}
