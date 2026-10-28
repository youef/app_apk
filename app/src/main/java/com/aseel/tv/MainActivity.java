package com.aseel.tv;
import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.widget.*;
public class MainActivity extends Activity {
 @Override public void onCreate(Bundle state){super.onCreate(state); LinearLayout page=new LinearLayout(this);page.setOrientation(1);page.setPadding(24,24,24,24);page.setBackgroundColor(Color.rgb(12,17,34));TextView title=new TextView(this);title.setText("أسيل | أفلام ومسلسلات");title.setTextSize(27);title.setTextColor(Color.WHITE);page.addView(title);TextView status=new TextView(this);status.setText("تم تشغيل النسخة الأساسية المتوافقة مع Android 4.4.4 بنجاح");status.setTextSize(18);status.setTextColor(Color.LTGRAY);status.setPadding(0,30,0,20);page.addView(status);setContentView(page);}
}
