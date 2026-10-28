package com.smarttv.plus44;
import android.app.*; import android.os.*; import android.graphics.Color; import android.view.*; import android.widget.*; import android.media.*; import android.net.Uri; import org.json.*; import java.net.*; import java.io.*;
public class MainActivity extends Activity {
 LinearLayout root,list; VideoView activeVideo;
 final String feed="https://qyzmlwtvzzgooccqxglq.supabase.co/rest/v1/catalog_items?select=title,type,stream_url&published=eq.true";
 final String apiKey="sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES";
 Handler handler=new Handler(); boolean loading=false;
 public void onCreate(Bundle b){super.onCreate(b);showHome();}
 TextView label(String s){TextView t=new TextView(this);t.setText(s);t.setTextColor(Color.WHITE);t.setTextSize(18);t.setPadding(8,14,8,14);return t;}
 void showHome(){if(activeVideo!=null){activeVideo.stopPlayback();activeVideo=null;}root=new LinearLayout(this);root.setOrientation(1);root.setPadding(22,18,22,10);root.setBackgroundColor(Color.rgb(12,18,30));setContentView(root);
 TextView title=label("SMART TV PLUS  |  الأفلام والمسلسلات والقنوات");title.setTextSize(23);root.addView(title);
 Button refresh=new Button(this);refresh.setText("تحديث المكتبة");root.addView(refresh);refresh.setOnClickListener(v->load());
 ScrollView sc=new ScrollView(this);root.addView(sc,new LinearLayout.LayoutParams(-1,0,1));list=new LinearLayout(this);list.setOrientation(1);sc.addView(list);load();}
 void status(String s){list.removeAllViews();list.addView(label(s));}
 String read(InputStream in)throws IOException{if(in==null)return "";try{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>2000000)throw new IOException("Response too large");}return out.toString("UTF-8");}finally{in.close();}}
 void load(){if(loading)return;loading=true;status("جار تحميل المكتبة...");
 new Thread(()->{HttpURLConnection c=null;try{
 URL u=new URL(feed+"&cache_bust="+System.currentTimeMillis());c=(HttpURLConnection)u.openConnection();c.setRequestMethod("GET");c.setRequestProperty("apikey",apiKey);c.setRequestProperty("Accept","application/json");c.setRequestProperty("Cache-Control","no-cache");c.setConnectTimeout(15000);c.setReadTimeout(15000);
 int code=c.getResponseCode();String body=read(code>=200&&code<300?c.getInputStream():c.getErrorStream());if(code!=200)throw new IOException("HTTP "+code+" "+body.substring(0,Math.min(150,body.length())));
 JSONArray items=new JSONArray(body);runOnUiThread(()->{loading=false;list.removeAllViews();if(items.length()==0){list.addView(label("المكتبة فارغة حاليًا. ستظهر الأفلام والمسلسلات بعد نشرها من لوحة الإدارة."));return;}
 for(int i=0;i<items.length();i++){JSONObject o=items.optJSONObject(i);if(o==null)continue;String name=o.optString("title","بدون عنوان"),type=o.optString("type","movie"),url=o.optString("stream_url","");
 Button b=new Button(this);b.setText(("series".equals(type)?"مسلسل":("channel".equals(type)?"قناة":"فيلم"))+" | "+name);b.setAllCaps(false);list.addView(b);b.setOnClickListener(v->play(url));}});
 }catch(Exception e){final String reason=e.getClass().getSimpleName()+": "+e.getMessage();runOnUiThread(()->{loading=false;status("تعذر تحديث المكتبة.\n"+reason+"\nتحقق من التاريخ والوقت والاتصال، ثم حاول مجددًا.");});}
 finally{if(c!=null)c.disconnect();}}).start();}
 void play(String url){if(!url.startsWith("https://")&&!url.startsWith("http://")){Toast.makeText(this,"رابط تشغيل غير متاح",Toast.LENGTH_LONG).show();return;}
 root.removeAllViews();activeVideo=new VideoView(this);root.addView(activeVideo,new LinearLayout.LayoutParams(-1,0,1));Button back=new Button(this);back.setText("رجوع للمكتبة");root.addView(back);back.setOnClickListener(v->showHome());
 activeVideo.setVideoURI(Uri.parse(url));MediaController controls=new MediaController(this);controls.setAnchorView(activeVideo);activeVideo.setMediaController(controls);activeVideo.setOnErrorListener((mp,a,b)->{Toast.makeText(this,"تعذر تشغيل الفيديو؛ قد تكون الصيغة غير مدعومة",Toast.LENGTH_LONG).show();return true;});activeVideo.requestFocus();activeVideo.start();}
 @Override public void onBackPressed(){showHome();}
}