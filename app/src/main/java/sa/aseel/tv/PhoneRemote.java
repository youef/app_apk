package sa.aseel.tv;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URLDecoder;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

/**
 * Opt-in phone browser remote. Session is local-network only and expires after 20 minutes.
 * QR fragment holds the one-time pairing secret; it is not sent by the initial GET.
 * Browser commands require a POST with the secret. No commands are accepted anonymously.
 */
public final class PhoneRemote {
    private static final int PORT=18376;
    private static final long SESSION_MS=20L*60L*1000L;
    private static final SecureRandom random=new SecureRandom();
    private static final Handler main=new Handler(Looper.getMainLooper());
    private static volatile ServerSocket server;
    private static volatile boolean enabled;
    private static volatile long expires;
    private static volatile String secret="";
    private static volatile WeakReference<Activity> foreground=new WeakReference<Activity>(null);
    private static volatile String address="";
    private PhoneRemote(){}

    public static void setForeground(Activity activity){foreground=new WeakReference<Activity>(activity);}
    public static void clearForeground(Activity activity){
        if(foreground.get()==activity)foreground=new WeakReference<Activity>(null);
    }
    public static synchronized String start(Context context)throws Exception{
        stop();
        String host=localIp();
        if(host.isEmpty())throw new IllegalStateException("صل التلفزيون والجوال بشبكة Wi-Fi واحدة");
        byte[] token=new byte[24];random.nextBytes(token);
        StringBuilder hex=new StringBuilder();
        for(byte b:token)hex.append(String.format(java.util.Locale.US,"%02x",b&255));
        secret=hex.toString();
        expires=System.currentTimeMillis()+SESSION_MS;
        address="http://"+host+":"+PORT+"/#pair="+secret;
        server=new ServerSocket(PORT,8);
        server.setSoTimeout(1500);
        enabled=true;
        new Thread(new Runnable(){public void run(){serve();}},"alezz-local-phone-remote").start();
        return address;
    }
    public static synchronized void stop(){
        enabled=false;secret="";address="";expires=0;
        try{if(server!=null)server.close();}catch(Exception ignored){}
        server=null;
    }
    public static boolean active(){return enabled&&System.currentTimeMillis()<expires;}
    public static String url(){return active()?address:"";}
    private static String localIp()throws Exception{
        Enumeration<NetworkInterface> interfaces=NetworkInterface.getNetworkInterfaces();
        if(interfaces==null)return "";
        for(NetworkInterface network:Collections.list(interfaces)){
            if(!network.isUp()||network.isLoopback())continue;
            for(java.net.InetAddress ip:Collections.list(network.getInetAddresses())){
                if(ip instanceof Inet4Address && ip.isSiteLocalAddress())return ip.getHostAddress();
            }
        }
        return "";
    }
    public static Bitmap qr(String url)throws Exception{
        Map<EncodeHintType,Object> hints=new HashMap<EncodeHintType,Object>();
        hints.put(EncodeHintType.MARGIN,1);
        BitMatrix bits=new MultiFormatWriter().encode(url,BarcodeFormat.QR_CODE,330,330,hints);
        Bitmap image=Bitmap.createBitmap(bits.getWidth(),bits.getHeight(),Bitmap.Config.RGB_565);
        for(int y=0;y<bits.getHeight();y++)for(int x=0;x<bits.getWidth();x++)
            image.setPixel(x,y,bits.get(x,y)?0xFF17121C:0xFFFFFFFF);
        return image;
    }
    private static void serve(){
        while(active()){
            Socket client=null;
            try{
                ServerSocket listener=server;
                if(listener==null)break;
                client=listener.accept();
                client.setSoTimeout(2500);
                // Reject non-LAN clients, and keep the listener explicitly opt-in.
                java.net.InetAddress peer=client.getInetAddress();
                if(!peer.isSiteLocalAddress()&&!peer.isLoopbackAddress())continue;
                handle(client);
            }catch(SocketTimeoutException ignored){}
            catch(Exception ignored){}
            finally{if(client!=null)try{client.close();}catch(Exception ignored){}}
        }
        stop();
    }
    private static String page(){
        return "<!doctype html><html lang='ar' dir='rtl'><meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1'>"+
            "<title>العز TV • ريموت الجوال</title><style>body{font:18px system-ui;background:#130d17;color:white;text-align:center;max-width:450px;margin:auto;padding:20px}"+
            "h1{color:#ff718d}button{background:#532238;color:white;border:1px solid #ba496a;border-radius:17px;font-size:23px;min-height:66px;cursor:pointer}"+
            ".pad{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.wide{width:100%;margin-top:12px}small{color:#b8a5b2}</style>"+
            "<h1>العز TV</h1><p>التحكم بالتلفزيون</p><div class='pad'>"+
            "<span></span><button onclick=\"send('up')\">▲</button><span></span>"+
            "<button onclick=\"send('left')\">◀</button><button onclick=\"send('ok')\">OK</button><button onclick=\"send('right')\">▶</button>"+
            "<span></span><button onclick=\"send('down')\">▼</button><span></span></div>"+
            "<button class='wide' onclick=\"send('back')\">رجوع</button>"+
            "<button class='wide' onclick=\"send('home')\">الرئيسية</button>"+
            "<button class='wide' onclick=\"send('play')\">تشغيل / إيقاف مؤقت</button>"+
            "<p id='state'></p><small>يعمل على نفس الشبكة فقط • تنتهي الجلسة تلقائيًا</small>"+
            "<script>const token=new URLSearchParams(location.hash.substring(1)).get('pair')||'';"+
            "history.replaceState(null,'',location.pathname);"+
            "async function send(key){let box=document.getElementById('state');try{let r=await fetch('/command',{method:'POST',"+
            "headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'pair='+encodeURIComponent(token)+'&key='+encodeURIComponent(key)});"+
            "box.textContent=r.ok?'✓ تم إرسال الأمر':'الجلسة منتهية أو التلفزيون غير متاح';}catch(e){box.textContent='تعذر الاتصال بالتلفزيون';}}</script></html>";
    }
    private static String readBody(java.io.InputStream in,int count)throws Exception{
        if(count<0||count>512)throw new IllegalArgumentException("invalid body");
        byte[] data=new byte[count];int pos=0;
        while(pos<count){int n=in.read(data,pos,count-pos);if(n<0)break;pos+=n;}
        return new String(data,0,pos,"UTF-8");
    }
    private static String value(String payload,String key)throws Exception{
        for(String part:payload.split("&")){
            int n=part.indexOf('=');
            if(n>=0&&key.equals(part.substring(0,n)))return URLDecoder.decode(part.substring(n+1),"UTF-8");
        }
        return "";
    }
    private static void handle(Socket client)throws Exception{
        java.io.InputStream stream=client.getInputStream();
        BufferedReader reader=new BufferedReader(new InputStreamReader(stream,"ISO-8859-1"));
        String request=reader.readLine();
        if(request==null||request.length()>200)return;
        int length=0;
        String line;
        while((line=reader.readLine())!=null&&!line.isEmpty()){
            if(line.length()>512)return;
            int p=line.indexOf(':');
            if(p>0 && "content-length".equalsIgnoreCase(line.substring(0,p).trim()))
                length=Integer.parseInt(line.substring(p+1).trim());
        }
        // BufferedReader may buffer body bytes: request body is read using the same reader.
        int status=404;String result="Not found";String type="text/plain; charset=UTF-8";
        if(request.startsWith("GET / ")){
            status=200;result=page();type="text/html; charset=UTF-8";
        }else if(request.startsWith("POST /command ")){
            if(length<0||length>512)return;
            char[] buffer=new char[length];int done=0;
            while(done<length){int n=reader.read(buffer,done,length-done);if(n<0)break;done+=n;}
            String payload=new String(buffer,0,done);
            String token=value(payload,"pair"),key=value(payload,"key");
            if(active()&&secret.equals(token)&&token.length()==48&&dispatch(key)){
                status=200;result="OK";
            }else{status=403;result="Forbidden";}
        }
        byte[] bytes=result.getBytes("UTF-8");
        String head="HTTP/1.1 "+status+" "+(status==200?"OK":status==403?"Forbidden":"Not Found")+"\r\n"+
            "Content-Type: "+type+"\r\nContent-Length: "+bytes.length+"\r\n"+
            "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"+
            "Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'\r\n"+
            "Connection: close\r\n\r\n";
        OutputStream out=client.getOutputStream();
        out.write(head.getBytes("UTF-8"));out.write(bytes);out.flush();
    }
    private static boolean dispatch(String name){
        int code;
        switch(name){
            case "up":code=KeyEvent.KEYCODE_DPAD_UP;break;
            case "down":code=KeyEvent.KEYCODE_DPAD_DOWN;break;
            case "left":code=KeyEvent.KEYCODE_DPAD_LEFT;break;
            case "right":code=KeyEvent.KEYCODE_DPAD_RIGHT;break;
            case "ok":code=KeyEvent.KEYCODE_DPAD_CENTER;break;
            case "back":code=KeyEvent.KEYCODE_BACK;break;
            case "home":code=KeyEvent.KEYCODE_HOME;break;
            case "play":code=KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;break;
            default:return false;
        }
        final Activity target=foreground.get();
        if(target==null||target.isFinishing())return false;
        final int key=code;
        main.post(new Runnable(){public void run(){
            if(target.isFinishing())return;
            if(key==KeyEvent.KEYCODE_HOME){
                if(target instanceof TVHomeActivity)((TVHomeActivity)target).remoteHome();
                else target.finish();
            }else{
                target.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,key));
                target.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP,key));
            }
        }});
        return true;
    }
}
