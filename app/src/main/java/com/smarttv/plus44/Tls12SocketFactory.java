package com.smarttv.plus44;
import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import javax.net.ssl.*;
public final class Tls12SocketFactory extends SSLSocketFactory {
 private final SSLSocketFactory delegate;
 public Tls12SocketFactory() throws Exception {
  SSLContext context=SSLContext.getInstance("TLSv1.2");
  context.init(null,null,null);
  delegate=context.getSocketFactory();
 }
 private Socket enable(Socket socket){
  if(socket instanceof SSLSocket){
   SSLSocket ssl=(SSLSocket)socket;
   for(String protocol:ssl.getSupportedProtocols()){
    if("TLSv1.2".equals(protocol)){ssl.setEnabledProtocols(new String[]{"TLSv1.2"});break;}
   }
  }
  return socket;
 }
 public String[] getDefaultCipherSuites(){return delegate.getDefaultCipherSuites();}
 public String[] getSupportedCipherSuites(){return delegate.getSupportedCipherSuites();}
 public Socket createSocket(Socket s,String h,int p,boolean a)throws IOException{return enable(delegate.createSocket(s,h,p,a));}
 public Socket createSocket(String h,int p)throws IOException{return enable(delegate.createSocket(h,p));}
 public Socket createSocket(String h,int p,InetAddress l,int lp)throws IOException{return enable(delegate.createSocket(h,p,l,lp));}
 public Socket createSocket(InetAddress h,int p)throws IOException{return enable(delegate.createSocket(h,p));}
 public Socket createSocket(InetAddress h,int p,InetAddress l,int lp)throws IOException{return enable(delegate.createSocket(h,p,l,lp));}
}