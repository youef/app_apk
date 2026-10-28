package com.aseel.tv;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(11, 18, 34);
    private static final int PANEL = Color.rgb(17, 29, 48);
    private static final int GOLD = Color.rgb(213, 184, 117);
    private TextView status;

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private GradientDrawable panel(int fill, int stroke) {
        GradientDrawable result = new GradientDrawable();
        result.setColor(fill);
        result.setCornerRadius(dp(16));
        result.setStroke(dp(2), stroke);
        return result;
    }

    private TextView text(int resourceId, float size, int color) {
        TextView view = new TextView(this);
        view.setText(resourceId);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        return view;
    }

    private Button button(int title) {
        final Button result = new Button(this);
        result.setText(title);
        result.setTextSize(18);
        result.setTextColor(Color.WHITE);
        result.setAllCaps(false);
        result.setFocusable(true);
        result.setFocusableInTouchMode(true);
        result.setBackgroundDrawable(panel(PANEL, Color.rgb(65, 72, 89)));
        result.setPadding(dp(12), dp(8), dp(12), dp(8));
        result.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View view, boolean hasFocus) {
                result.setTextColor(hasFocus ? BG : Color.WHITE);
                result.setBackgroundDrawable(hasFocus
                        ? panel(GOLD, Color.WHITE)
                        : panel(PANEL, Color.rgb(65, 72, 89)));
            }
        });
        return result;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setGravity(Gravity.CENTER);
        screen.setBackgroundColor(BG);
        screen.setPadding(dp(20), dp(16), dp(20), dp(16));
        screen.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        content.setPadding(dp(24), dp(24), dp(24), dp(24));
        content.setBackgroundDrawable(panel(PANEL, Color.rgb(51, 61, 78)));
        int viewport = getResources().getDisplayMetrics().widthPixels;
        int panelWidth = Math.min(dp(780), Math.max(dp(280), viewport - dp(48)));
        screen.addView(content, new LinearLayout.LayoutParams(panelWidth, -2));

        TextView brand = text(R.string.intro_title, 43, GOLD);
        brand.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        content.addView(brand);

        TextView subheading = text(R.string.intro_subtitle, 21, Color.WHITE);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(-1, -2);
        subtitleParams.topMargin = dp(4);
        content.addView(subheading, subtitleParams);

        status = text(R.string.test_status, 19, Color.rgb(204, 218, 221));
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(26);
        content.addView(status, statusParams);

        TextView hint = text(R.string.test_hint, 15, Color.rgb(170, 179, 193));
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(-1, -2);
        hintParams.topMargin = dp(12);
        content.addView(hint, hintParams);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams controlParams = new LinearLayout.LayoutParams(-1, -2);
        controlParams.topMargin = dp(24);
        content.addView(controls, controlParams);

        final Button test = button(R.string.test_button);
        final Button exit = button(R.string.exit_button);
        LinearLayout.LayoutParams first = new LinearLayout.LayoutParams(0, dp(60), 1);
        first.rightMargin = dp(8);
        LinearLayout.LayoutParams second = new LinearLayout.LayoutParams(0, dp(60), 1);
        second.leftMargin = dp(8);
        controls.addView(test, first);
        controls.addView(exit, second);

        test.setNextFocusRightId(exit.getId());
        test.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                status.setText(R.string.test_passed);
                status.setTextColor(GOLD);
            }
        });
        exit.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { finish(); }
        });

        TextView footer = text(R.string.test_footer, 13, Color.rgb(149, 159, 172));
        LinearLayout.LayoutParams footerParams = new LinearLayout.LayoutParams(-1, -2);
        footerParams.topMargin = dp(25);
        content.addView(footer, footerParams);

        setContentView(screen);
        test.requestFocus();
    }
}
