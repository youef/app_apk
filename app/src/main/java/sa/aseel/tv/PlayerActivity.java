package sa.aseel.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;

import java.util.Locale;

/**
 * Framework-only player for old devices. ExoPlayer is intentionally avoided:
 * it would add a large dependency and separate codec path, while Android's
 * VideoView/MediaPlayer already handles MP4 and (usually) HLS on API 19.
 */
public class PlayerActivity extends Activity {

    private static final String PROGRESS_PREFS = "alezz_progress";
    private static final int HIDE_DELAY_MS = 4000;
    private static final int SEEK_STEP_MS = 10000;
    private static final int SAVE_EVERY_SECONDS = 5;

    private final Handler handler = new Handler();

    private VideoView videoView;
    private View controls;
    private TextView titleText;
    private TextView subtitleText;
    private TextView playPause;
    private TextView statusText;
    private TextView elapsedText;
    private TextView totalText;
    private SeekBar seekBar;

    private Runnable hideControlsRunnable;
    private Runnable tickRunnable;

    private String mediaKey = "";
    private boolean live;
    private boolean prepared;
    private boolean seeking;
    private boolean ended;
    private boolean error;

    private int startAt;
    private int lastSavedSeconds;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        setContentView(R.layout.player);
        applyImmersiveMode();
        bindViews();
        buildRunnables();

        Intent intent = getIntent();
        String url = safe(intent.getStringExtra("url"));
        String title = safe(intent.getStringExtra("title"));
        String subtitle = safe(intent.getStringExtra("subtitle"));
        String youtubeId = safe(intent.getStringExtra("youtube"));
        mediaKey = safe(intent.getStringExtra("key"));
        if (mediaKey.length() == 0) {
            mediaKey = title;
        }
        live = intent.getBooleanExtra("live", false);
        startAt = intent.getIntExtra("startAt", 0);
        if (startAt < 0) {
            startAt = 0;
        }

        titleText.setText(title.length() == 0 ? getString(R.string.app_name) : title);
        if (subtitle.length() == 0) {
            subtitleText.setVisibility(View.GONE);
        } else {
            subtitleText.setText(subtitle);
        }
        if (live) {
            totalText.setText(R.string.player_live);
            seekBar.setEnabled(false);
        }

        if (youtubeId.length() > 0) {
            launchYouTube(youtubeId);
            return;
        }

        setupPlayer();
        if (url.length() == 0) {
            showError(getString(R.string.player_error));
            return;
        }

        // MediaPlayer's platform HLS support varies by OEM on API 19, so some
        // .m3u8 streams may fail; the error overlay lets the user go back safely.
        videoView.setVideoURI(Uri.parse(url));
    }

    private void bindViews() {
        videoView = (VideoView) findViewById(R.id.videoView);
        controls = findViewById(R.id.controls);
        titleText = (TextView) findViewById(R.id.titleText);
        subtitleText = (TextView) findViewById(R.id.subtitleText);
        playPause = (TextView) findViewById(R.id.playPause);
        statusText = (TextView) findViewById(R.id.statusText);
        elapsedText = (TextView) findViewById(R.id.elapsedText);
        totalText = (TextView) findViewById(R.id.totalText);
        seekBar = (SeekBar) findViewById(R.id.seekBar);
    }

    private void buildRunnables() {
        hideControlsRunnable = new Runnable() {
            @Override
            public void run() {
                if (controls != null && prepared && !error) {
                    controls.setVisibility(View.GONE);
                }
            }
        };

        tickRunnable = new Runnable() {
            @Override
            public void run() {
                updatePosition();
                handler.postDelayed(this, 1000);
            }
        };
    }

    private void setupPlayer() {
        View root = findViewById(R.id.playerRoot);
        root.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showControls();
            }
        });
        videoView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showControls();
            }
        });
        playPause.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                togglePlay();
            }
        });

        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (fromUser && !live && prepared) {
                    int duration = videoView.getDuration();
                    if (duration > 0) {
                        long target = (long) duration * progress / 1000L;
                        elapsedText.setText(formatTime((int) target));
                    }
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {
                seeking = true;
                showControls();
                handler.removeCallbacks(hideControlsRunnable);
            }

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
                seeking = false;
                if (prepared && !live) {
                    int duration = videoView.getDuration();
                    if (duration > 0) {
                        long target = (long) duration * bar.getProgress() / 1000L;
                        videoView.seekTo((int) target);
                    }
                }
                showControls();
            }
        });

        videoView.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
            @Override
            public void onPrepared(MediaPlayer mp) {
                prepared = true;
                error = false;
                statusText.setVisibility(View.GONE);
                playPause.setVisibility(View.VISIBLE);

                if (!live) {
                    int duration = videoView.getDuration();
                    if (duration > 0) {
                        totalText.setText(formatTime(duration));
                    }
                    if (startAt > 5) {
                        long target = (long) startAt * 1000L;
                        if (duration > 0 && target > duration - 1000L) {
                            target = Math.max(0L, duration - 1000L);
                        }
                        videoView.seekTo((int) target);
                        lastSavedSeconds = startAt;
                    }
                }
                videoView.start();
                updatePlayPauseIcon();
                showControls();
            }
        });

        videoView.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
            @Override
            public void onCompletion(MediaPlayer mp) {
                ended = true;
                saveProgress(0);
                setResult(RESULT_OK);
                finish();
            }
        });

        videoView.setOnErrorListener(new MediaPlayer.OnErrorListener() {
            @Override
            public boolean onError(MediaPlayer mp, int what, int extra) {
                showError(getString(R.string.player_error));
                return true;
            }
        });
    }

    private void updatePosition() {
        if (!prepared || videoView == null) {
            return;
        }
        int position = videoView.getCurrentPosition();
        int duration = videoView.getDuration();

        if (live) {
            elapsedText.setText(formatTime(position));
            totalText.setText(R.string.player_live);
            return;
        }

        if (!seeking) {
            elapsedText.setText(formatTime(position));
            if (duration > 0) {
                totalText.setText(formatTime(duration));
                int progress = (int) ((long) position * 1000L / duration);
                if (progress < 0) {
                    progress = 0;
                } else if (progress > 1000) {
                    progress = 1000;
                }
                seekBar.setProgress(progress);
            }
        }

        int seconds = position / 1000;
        if (Math.abs(seconds - lastSavedSeconds) >= SAVE_EVERY_SECONDS) {
            saveProgress(seconds);
            lastSavedSeconds = seconds;
        }
    }

    private void seekBy(int deltaMs) {
        if (live || !prepared || error || videoView == null) {
            return;
        }
        int duration = videoView.getDuration();
        int target = videoView.getCurrentPosition() + deltaMs;
        if (target < 0) {
            target = 0;
        }
        if (duration > 0 && target > duration) {
            target = duration;
        }
        videoView.seekTo(target);
        elapsedText.setText(formatTime(target));
        showControls();
    }

    private void togglePlay() {
        if (!prepared || error || videoView == null) {
            return;
        }
        if (videoView.isPlaying()) {
            videoView.pause();
        } else {
            videoView.start();
        }
        updatePlayPauseIcon();
        showControls();
    }

    private void updatePlayPauseIcon() {
        if (videoView == null || playPause == null) {
            return;
        }
        boolean playing = videoView.isPlaying();
        playPause.setText(playing ? "❚❚" : "▶");
        playPause.setContentDescription(
                getString(playing ? R.string.pause : R.string.play));
    }

    private void showControls() {
        if (controls == null) {
            return;
        }
        controls.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideControlsRunnable);
        if (prepared && !error) {
            handler.postDelayed(hideControlsRunnable, HIDE_DELAY_MS);
        }
    }

    private void showError(String message) {
        error = true;
        prepared = false;
        handler.removeCallbacks(hideControlsRunnable);
        if (controls != null) {
            controls.setVisibility(View.VISIBLE);
        }
        if (statusText != null) {
            statusText.setText(message);
            statusText.setVisibility(View.VISIBLE);
        }
        if (playPause != null) {
            playPause.setVisibility(View.GONE);
        }
        if (seekBar != null) {
            seekBar.setEnabled(false);
        }
    }

    private void launchYouTube(String videoId) {
        if (videoId == null || !videoId.matches("[A-Za-z0-9_-]{11}")) {
            Toast.makeText(this, R.string.youtube_unavailable, Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        try {
            // Always keep official YouTube embed inside Al Ezz TV.
            Intent intent = new Intent(this, YouTubeActivity.class);
            intent.putExtra("start_video_id", videoId);
            intent.putExtra("title", safe(getIntent().getStringExtra("title")));
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, R.string.youtube_unavailable, Toast.LENGTH_LONG).show();
        }
        finish();
    }

    private void saveCurrentProgress() {
        if (!prepared || live || ended || videoView == null) {
            return;
        }
        saveProgress(videoView.getCurrentPosition() / 1000);
    }

    private void saveProgress(int seconds) {
        if (live || mediaKey.length() == 0) {
            return;
        }
        int safeSeconds = Math.max(0, seconds);
        SharedPreferences prefs = getSharedPreferences(PROGRESS_PREFS, MODE_PRIVATE);
        prefs.edit().putInt(mediaKey, safeSeconds).apply();
        lastSavedSeconds = safeSeconds;
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
        if (!error && tickRunnable != null) {
            handler.removeCallbacks(tickRunnable);
            handler.postDelayed(tickRunnable, 1000);
        }
    }

    @Override
    protected void onPause() {
        saveCurrentProgress();
        if (videoView != null && videoView.isPlaying()) {
            videoView.pause();
        }
        handler.removeCallbacks(tickRunnable);
        handler.removeCallbacks(hideControlsRunnable);
        super.onPause();
    }

    @Override
    protected void onStop() {
        saveCurrentProgress();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        saveCurrentProgress();
        handler.removeCallbacks(tickRunnable);
        handler.removeCallbacks(hideControlsRunnable);
        if (videoView != null) {
            try {
                videoView.stopPlayback();
            } catch (Exception ignored) {
                // Releasing a failed framework decoder must never crash the app.
            }
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    @Override
    public void onBackPressed() {
        saveCurrentProgress();
        super.onBackPressed();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event == null) {
            return super.dispatchKeyEvent(null);
        }
        int code = event.getKeyCode();
        int action = event.getAction();

        if (action == KeyEvent.ACTION_DOWN) {
            showControls();
        }

        if (code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_MEDIA_REWIND) {
            if (action == KeyEvent.ACTION_DOWN) {
                seekBy(-SEEK_STEP_MS);
            }
            return true;
        }
        if (code == KeyEvent.KEYCODE_DPAD_RIGHT
                || code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) {
            if (action == KeyEvent.ACTION_DOWN) {
                seekBy(SEEK_STEP_MS);
            }
            return true;
        }
        if (code == KeyEvent.KEYCODE_DPAD_CENTER
                || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                || code == KeyEvent.KEYCODE_MEDIA_PLAY
                || code == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                togglePlay();
            }
            return true;
        }
        if (code == KeyEvent.KEYCODE_MEDIA_STOP) {
            if (action == KeyEvent.ACTION_DOWN) {
                finish();
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void applyImmersiveMode() {
        if (Build.VERSION.SDK_INT >= 16) {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN;
            if (Build.VERSION.SDK_INT >= 19) {
                flags |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            }
            getWindow().getDecorView().setSystemUiVisibility(flags);
        } else {
            getWindow().setFlags(
                    WindowManager.LayoutParams.FLAG_FULLSCREEN,
                    WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static String formatTime(int millis) {
        if (millis < 0) {
            return "--:--";
        }
        int totalSeconds = millis / 1000;
        int seconds = totalSeconds % 60;
        int minutes = (totalSeconds / 60) % 60;
        int hours = totalSeconds / 3600;
        if (hours > 0) {
            return String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds);
        }
        return String.format(Locale.US, "%02d:%02d", minutes, seconds);
    }
}
