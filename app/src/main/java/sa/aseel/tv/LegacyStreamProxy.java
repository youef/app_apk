package sa.aseel.tv;

import android.os.Build;
import android.util.Log;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;

/**
 * Android 4.4 MediaPlayer may be unable to negotiate HTTPS to modern hosts.
 * A loopback-only HTTP bridge performs upstream TLS 1.2 with Android's
 * HttpsURLConnection, preserving certificate and hostname verification.
 * It forwards byte ranges so VideoView can progressively play and seek MP4.
 *
 * The HTTP endpoint is restricted to 127.0.0.1 and a random secret path.
 * No remote content is cached to disk or served to the local network.
 */
public final class LegacyStreamProxy {
    private static final String TAG="AseelLegacyVideo";
    private final String origin;
    private final String token=UUID.randomUUID().toString().replace("-","");
    private final ExecutorService workers=Executors.newFixedThreadPool(2);
    private ServerSocket server;
    private Thread acceptThread;
    private volatile boolean closed;
    private volatile String lastError="";

    private final android.content.Context context;
    public LegacyStreamProxy(android.content.Context app,String httpsUrl) {
        context=app.getApplicationContext();
        if(httpsUrl==null || !httpsUrl.startsWith("https://"))
            throw new IllegalArgumentException("HTTPS video source required");
        origin=httpsUrl;
    }
    public synchronized String start() throws IOException {
        if(server!=null)throw new IllegalStateException("Already started");
        server=new ServerSocket(0,4,InetAddress.getByName("127.0.0.1"));
        acceptThread=new Thread(new Runnable(){public void run(){acceptLoop();}},"Aseel-Video-Loopback");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return "http://127.0.0.1:"+server.getLocalPort()+"/stream/"+token;
    }
    public String getLastError(){return lastError;}
    public synchronized void close(){
        closed=true;
        try{if(server!=null)server.close();}catch(IOException ignored){}
        workers.shutdownNow();
    }
    private void acceptLoop(){
        while(!closed){
            try{
                final Socket client=server.accept();
                workers.execute(new Runnable(){public void run(){handle(client);}});
            }catch(IOException e){if(!closed)Log.w(TAG,"Loopback accept failed",e);}
            catch(java.util.concurrent.RejectedExecutionException ignored){}
        }
    }
    private void handle(Socket client){
        HttpsURLConnection upstream=null;
        try{
            client.setSoTimeout(25000);
            BufferedReader headers=new BufferedReader(new InputStreamReader(client.getInputStream(),"ISO-8859-1"));
            String request=headers.readLine();
            if(request==null || request.length()>4096){respond(client,400);return;}
            boolean head=request.startsWith("HEAD ");
            if(!head && !request.startsWith("GET ")){respond(client,405);return;}
            if(!request.contains(" /stream/"+token+" ")){respond(client,404);return;}
            String range=null;int lines=0;
            for(String line;(line=headers.readLine())!=null;){
                if(line.length()==0)break;
                if(++lines>80 || line.length()>4096){respond(client,400);return;}
                if(line.regionMatches(true,0,"Range:",0,6)){
                    range=line.substring(6).trim();
                    if(!range.matches("bytes=[0-9]+(-[0-9]*)?"))range=null;
                }
            }
            URL target=new URL(origin);
            for(int redirect=0;redirect<4;redirect++){
                if(!"https".equalsIgnoreCase(target.getProtocol()))
                    throw new IOException("HTTP downgrade blocked");
                upstream=(HttpsURLConnection)target.openConnection();
                upstream.setInstanceFollowRedirects(false);
                upstream.setRequestMethod(head?"HEAD":"GET");
                upstream.setConnectTimeout(12000);
                upstream.setReadTimeout(20000);
                upstream.setRequestProperty("Accept-Encoding","identity");
                upstream.setRequestProperty("User-Agent","AseelTV-LegacyVideo/1.1");
                if(range!=null)upstream.setRequestProperty("Range",range);
                upstream.setSSLSocketFactory(LegacyTls.factory(context));
                int status=upstream.getResponseCode();
                if(status==301 || status==302 || status==303 || status==307 || status==308){
                    String location=upstream.getHeaderField("Location");
                    if(location==null)throw new IOException("Redirect missing location");
                    URL next=new URL(target,location);
                    upstream.disconnect();upstream=null;
                    target=next;continue;
                }
                if(status!=200 && status!=206 && status!=416)
                    throw new IOException("Video HTTP status "+status);
                String contentType=upstream.getContentType();
                if(contentType==null || contentType.length()>120)contentType="video/mp4";
                String length=upstream.getHeaderField("Content-Length");
                String contentRange=upstream.getHeaderField("Content-Range");
                StringBuilder response=new StringBuilder();
                response.append("HTTP/1.1 ").append(status).append(status==206?" Partial Content":status==416?" Range Not Satisfiable":" OK").append("\r\n");
                response.append("Content-Type: ").append(contentType.replace("\r","").replace("\n","")).append("\r\n");
                response.append("Accept-Ranges: bytes\r\n");
                response.append("Connection: close\r\n");
                if(length!=null && length.matches("[0-9]+"))response.append("Content-Length: ").append(length).append("\r\n");
                if(contentRange!=null && contentRange.matches("bytes [0-9]+-[0-9]+/[0-9]+|bytes \\*/[0-9]+"))
                    response.append("Content-Range: ").append(contentRange).append("\r\n");
                response.append("\r\n");
                OutputStream output=client.getOutputStream();
                output.write(response.toString().getBytes("ISO-8859-1"));
                output.flush();
                if(head||status==416)return;
                InputStream input=upstream.getInputStream();
                try{
                    byte[] buffer=new byte[16384];int read;
                    while(!closed && (read=input.read(buffer))!=-1){
                        output.write(buffer,0,read);
                    }
                    output.flush();
                }finally{input.close();}
                return;
            }
            throw new IOException("Too many HTTPS redirects");
        }catch(Exception e){
            lastError=e.getClass().getSimpleName()+": "+e.getMessage();
            Log.w(TAG,"Secure video proxy request failed",e);
            try{respond(client,502);}catch(Exception ignored){}
        }finally{
            if(upstream!=null)upstream.disconnect();
            try{client.close();}catch(IOException ignored){}
        }
    }
    private void respond(Socket socket,int status)throws IOException{
        String reason=status==404?"Not Found":status==400?"Bad Request":status==405?"Method Not Allowed":"Bad Gateway";
        String response="HTTP/1.1 "+status+" "+reason+"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        OutputStream out=socket.getOutputStream();out.write(response.getBytes("ISO-8859-1"));out.flush();
    }
}
