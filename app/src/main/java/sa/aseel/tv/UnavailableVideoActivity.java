package sa.aseel.tv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.VideoView;

/** Native, offline, first-party video. No web page or external media intent. */
public final class UnavailableVideoActivity extends Activity {
    private VideoView movie;

    public static void show(Activity from, String kind, String title) {
        if (from == null || from.isFinishing()) return;
        Intent intent = new Intent(from, UnavailableVideoActivity.class);
        intent.putExtra("kind", kind == null ? "" : kind);
        intent.putExtra("title", title == null ? "" : title);
        from.startActivity(intent);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        String kind = getIntent().getStringExtra("kind");
        String noun = "channel".equals(kind) || "live".equals(kind) ? "البث المباشر" :
            "series".equals(kind) || "episode".equals(kind) ? "المسلسل" : "الفيلم";
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0C0812);
        setContentView(root);

        movie = new VideoView(this);
        movie.setBackgroundColor(Color.TRANSPARENT);
        root.addView(movie, new FrameLayout.LayoutParams(-1, -1));
        movie.setOnErrorListener(new MediaPlayer.OnErrorListener() {
            @Override public boolean onError(MediaPlayer player, int what, int extra) {
                movie.setVisibility(View.INVISIBLE); // Keep native text visible if decoder fails.
                return true;
            }
        });
        int resource = getResources().getIdentifier("al_ezz_coming_soon", "raw", getPackageName());
        if (resource != 0) {
            try {
                movie.setVideoURI(Uri.parse("android.resource://" + getPackageName() + "/" + resource));
                movie.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                    @Override public void onPrepared(MediaPlayer player) {
                        player.setLooping(true);
                        player.setVolume(0f, 0f);
                        movie.start();
                    }
                });
            } catch (RuntimeException problem) { movie.setVisibility(View.INVISIBLE); }
        } else movie.setVisibility(View.INVISIBLE);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(dp(20), dp(16), dp(20), dp(20));
        GradientDrawable panel = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{0x0A0C0812, 0x710B0710, 0xD90B0710});
        layout.setBackgroundDrawable(panel);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-1, dp(145), Gravity.BOTTOM);
        root.addView(layout, lp);

        TextView status = new TextView(this);
        status.setText("قريبًا سيتم دعم " + noun + " في تطبيق العز TV");
        status.setTextColor(Color.WHITE);
        status.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        status.setTextSize(22);
        status.setGravity(Gravity.CENTER);
        layout.addView(status, new LinearLayout.LayoutParams(-1, dp(56)));

        String title = getIntent().getStringExtra("title");
        if (title != null && !title.trim().isEmpty()) {
            TextView label = new TextView(this);
            label.setText(title);
            label.setTextColor(0xFFEAA5B5);
            label.setTextSize(13);
            label.setSingleLine(true);
            label.setEllipsize(android.text.TextUtils.TruncateAt.END);
            label.setGravity(Gravity.CENTER);
            layout.addView(label, new LinearLayout.LayoutParams(-1, dp(25)));
        }
        Button back = new Button(this);
        back.setAllCaps(false);
        back.setText("العودة إلى العز TV");
        back.setTextColor(Color.WHITE);
        back.setBackgroundColor(0xFFAB183B);
        back.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { finish(); }
        });
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(dp(230), dp(46));
        bp.gravity=Gravity.CENTER_HORIZONTAL;
        layout.addView(back,bp);
        back.requestFocus();
    }

    @Override protected void onPause() {
        super.onPause();
        if (movie != null) movie.pause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (movie != null && movie.getVisibility()==View.VISIBLE) movie.start();
    }
    @Override protected void onDestroy() {
        if (movie != null) movie.stopPlayback();
        super.onDestroy();
    }
}
