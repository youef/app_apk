package com.smarttv.plus44;
import android.app.*; import android.os.*; import android.graphics.Color; import android.view.*; import android.widget.*; import android.media.*; import org.json.*; import java.net.*; import java.io.*;
public class MainActivity extends Activity {
 LinearLayout root, list; String feed="https://raw.githubusercontent.com/youef/app_apk/main/content/catalog.json";
 public void onCreate(Bundle b){super.onCreate(b); showHome();}
 void showHome(){root=new LinearLayout(this);root.setOrientation(1);root.setPadding(22,18,22,10);root.setBackgroundColor(Color.rgb(12,18,30));setContentView(root);
 TextView title=new TextView(this);title.setText("SMART TV PLUS  |  الأفلام والمسلسلات والقنوات");title.setTextColor(-1);title.setTextSize(24);root.addView(title);
 Button refresh=new Button(this);refresh.setText("تحديث المكتبة");root.addView(refresh);refresh.setOnClickListener(v->load());
 ScrollView sc=new ScrollView(this);root.addView(sc);list=new LinearLayout(this);list.setOrientation(1);sc.addView(list);load();}
 void message(String s){runOnUiThread(()->Toast.makeText(this,s,Toast.LENGTH_LONG).show());}
 void load(){list.removeAllViews();TextView wait=new TextView(this);wait.setText("جار تحميل المكتبة...");wait.setTextColor(-1);list.addView(wait);
 new Thread(()->{try{HttpURLConnection c=(HttpURLConnection)new URL(feed+"?t="+System.currentTimeMillis()).openConnection();c.setConnectTimeout(12000);c.setReadTimeout(12000);
 ByteArrayOutputStream out=new ByteArrayOutputStream();InputStream in=c.getInputStream();byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);in.close();
 JSONArray items=new JSONObject(out.toString("UTF-8")).getJSONArray("items");
 runOnUiThread(()->{list.removeAllViews();if(items.length()==0){message("المكتبة فارغة. أضف محتوى من لوحة الإدارة.");}for(int i=0;i<items.length();i++){JSONObject o=items.optJSONObject(i);if(o==null)continue;
 String name=o.optString("title"),type=o.optString("type"),url=o.optString("url");Button b=new Button(this);b.setText(type+"  |  "+name);b.setAllCaps(false);list.addView(b);b.setOnClickListener(v->play(url,name));}});}
 catch(Exception e){runOnUiThread(()->{list.removeAllViews();message("تعذر تحديث المحتوى. تحقق من اتصال الإنترنت.");});}}).start();}
 void play(String url,String name){if(!url.startsWith("https://")&&!url.startsWith("http://")){message("رابط غير صالح");return;}
 root.removeAllViews();VideoView video=new VideoView(this);root.addView(video,new LinearLayout.LayoutParams(-1,0,1));Button back=new Button(this);back.setText("رجوع للمكتبة");root.addView(back);back.setOnClickListener(v->{video.stopPlayback();showHome();});
 video.setVideoURI(android.net.Uri.parse(url));video.setMediaController(new MediaController(this));video.setOnErrorListener((mp,a,b)->{message("تعذر تشغيل الفيديو أو الصيغة غير مدعومة");return true;});video.requestFocus();video.start();}
 @Override public void onBackPressed(){showHome();}
}