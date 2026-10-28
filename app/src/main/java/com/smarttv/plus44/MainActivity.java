package com.smarttv.plus44;
import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import javax.net.ssl.HttpsURLConnection;

public class MainActivity extends Activity {
 private LinearLayout root,items;
 private VideoView video;
 private volatile boolean loading=false;
 private static final String API="https://qyzmlwtvzzgooccqxglq.supabase.co/rest/v1/catalog_items?select=title,type,stream_url&published=eq.true";
 private static final String KEY="sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES";
 @Override public void onCreate(Bundle state){super.onCreate(state);home();}
 private TextView text(String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(Color.WHITE);t.setPadding(16,12,16,12);return t;}
 private void home(){
  if(video!=null){video.stopPlayback();video=null;}
  root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(18,18,18,12);root.setBackgroundColor(Color.rgb(9,12,28));setContentView(root);
  TextView title=text("أسيل | أفلام ومسلسلات",28);title.setTextColor(Color.rgb(247,204,125));root.addView(title);
  Button refresh=new Button(this);refresh.setText("تحديث مكتبة أسيل");root.addView(refresh);refresh.setOnClickListener(new View.OnClickListener(){public void onClick(View v){load();}});
  ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
  items=new LinearLayout(this);items.setOrientation(LinearLayout.VERTICAL);scroll.addView(items);load();
 }
 private void status(String message){items.removeAllViews();items.addView(text(message,18));}
 private static String read(InputStream in)throws IOException{if(in==null)return "";try{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>2000000)throw new IOException("Response too large");}return out.toString("UTF-8");}finally{in.close();}}
 private void load(){
  if(loading)return;loading=true;status("جار تحميل المكتبة...");
  new Thread(new Runnable(){public void run(){HttpURLConnection conn=null;try{
   conn=(HttpURLConnection)new URL(API).openConnection();
   if(conn instanceof HttpsURLConnection && android.os.Build.VERSION.SDK_INT<21){((HttpsURLConnection)conn).setSSLSocketFactory(new Tls12SocketFactory());}
   conn.setConnectTimeout(15000);conn.setReadTimeout(15000);conn.setRequestProperty("apikey",KEY);conn.setRequestProperty("Accept","application/json");
   int code=conn.getResponseCode();String response=read(code<400?conn.getInputStream():conn.getErrorStream());
   if(code!=200)throw new IOException("HTTP "+code+" "+response.substring(0,Math.min(120,response.length())));
   final JSONArray result=new JSONArray(response);
   runOnUiThread(new Runnable(){public void run(){loading=false;items.removeAllViews();if(result.length()==0){status("مكتبة أسيل فارغة حاليًا. ستظهر الأعمال المرخصة بعد نشرها.");return;}
    for(int i=0;i<result.length();i++){JSONObject o=result.optJSONObject(i);if(o==null)continue;final String url=o.optString("stream_url","");
     Button b=new Button(MainActivity.this);String type=o.optString("type","movie");b.setText(("series".equals(type)?"مسلسل":("channel".equals(type)?"قناة":"فيلم"))+" | "+o.optString("title","بدون عنوان"));b.setAllCaps(false);items.addView(b);
     b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){play(url);}});
    }
   }});
  }catch(final Exception error){runOnUiThread(new Runnable(){public void run(){loading=false;status("تعذر تحديث المكتبة: "+error.getClass().getSimpleName()+"\n"+error.getMessage());}});}
  finally{if(conn!=null)conn.disconnect();}}}).start();
 }
 private void play(String url){if(!url.startsWith("https://")&&!url.startsWith("http://")){Toast.makeText(this,"رابط التشغيل غير صالح",Toast.LENGTH_LONG).show();return;}
  root.removeAllViews();video=new VideoView(this);root.addView(video,new LinearLayout.LayoutParams(-1,0,1));Button back=new Button(this);back.setText("رجوع");root.addView(back);back.setOnClickListener(new View.OnClickListener(){public void onClick(View v){home();}});
  video.setVideoURI(Uri.parse(url));MediaController controller=new MediaController(this);controller.setAnchorView(video);video.setMediaController(controller);video.setOnErrorListener(new android.media.MediaPlayer.OnErrorListener(){public boolean onError(android.media.MediaPlayer mp,int what,int extra){Toast.makeText(MainActivity.this,"صيغة الفيديو غير مدعومة",Toast.LENGTH_LONG).show();return true;}});video.start();
 }
 @Override public void onBackPressed(){home();}
}