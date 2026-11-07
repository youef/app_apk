package sa.aseel.tv;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.util.Locale;
import java.util.TimeZone;
import java.text.SimpleDateFormat;
import java.text.ParsePosition;
import javax.net.ssl.HttpsURLConnection;

/**
 * Native customer sign-in for Android API19+ using Supabase Auth's password
 * and refresh-token grants. No password or service-role key is ever stored.
 * Sessions are scoped to private, non-backed-up application preferences.
 */
public final class MemberAuth {
    private static final String PREFERENCES="alezz_tv_member_auth_v1";
    private static final String AUTH_ROOT=AppConfig.API_ROOT.replace("/rest/v1/","/auth/v1/");
    private static final String ALIAS_DOMAIN="members.alezz.invalid";

    private MemberAuth(){}
    private static SharedPreferences preferences(Context context){
        return context.getApplicationContext().getSharedPreferences(PREFERENCES,Context.MODE_PRIVATE);
    }
    public static boolean hasSession(Context context){
        return !preferences(context).getString("refresh_token","").isEmpty();
    }
    public static String userId(Context context){
        return preferences(context).getString("user_id","");
    }
    public static String username(Context context){
        return preferences(context).getString("username","");
    }
    public static String accessToken(Context context){
        return preferences(context).getString("access_token","");
    }

    private static String readLimited(InputStream input)throws Exception{
        try{
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            byte[] block=new byte[4096];int size;
            while((size=input.read(block))!=-1){
                if(output.size()+size>128*1024)throw new SecurityException("Auth response too large");
                output.write(block,0,size);
            }
            return output.toString("UTF-8");
        }finally{input.close();}
    }

    private static JSONObject request(Context context,String path,JSONObject body,String bearer)throws Exception{
        URL target=new URL(AUTH_ROOT+path);
        if(!"https".equalsIgnoreCase(target.getProtocol()))throw new SecurityException("HTTPS required");
        HttpsURLConnection connection=(HttpsURLConnection)target.openConnection();
        connection.setSSLSocketFactory(LegacyTls.factory(context));
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("apikey",AppConfig.PUBLISHABLE_KEY);
        connection.setRequestProperty("Accept","application/json");
        connection.setRequestProperty("User-Agent","AlEzzTV-Android/1.0");
        if(bearer!=null&&!bearer.isEmpty())connection.setRequestProperty("Authorization","Bearer "+bearer);
        if(body!=null){
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
            connection.setDoOutput(true);
        }
        try{
            if(body!=null){
                byte[] encoded=body.toString().getBytes("UTF-8");
                if(encoded.length>3072)throw new IllegalArgumentException("Credentials exceed limit");
                OutputStream stream=connection.getOutputStream();
                try{stream.write(encoded);}finally{stream.close();}
            }
            int status=connection.getResponseCode();
            if(status==401||status==400||status==403)
                throw new AuthenticationException("بيانات الدخول غير صحيحة، أو الحساب غير مفعل.");
            if(status==429)throw new AuthenticationException("محاولات كثيرة. أعد المحاولة لاحقًا.");
            if(status<200||status>=300)
                throw new java.io.IOException("تعذّر الاتصال بخادم الحسابات (HTTP "+status+").");
            return new JSONObject(readLimited(connection.getInputStream()));
        }finally{connection.disconnect();}
    }
    public static final class AuthenticationException extends Exception{
        AuthenticationException(String message){super(message);}
    }
    private static long subscriptionDeadline(JSONObject user)throws AuthenticationException{
        JSONObject metadata=user.optJSONObject("app_metadata");
        if(metadata==null)throw new AuthenticationException("بيانات صلاحية الحساب غير صالحة.");
        String raw=metadata.optString("alezz_expires_at","");
        if(raw.isEmpty())return 0L; // Existing accounts await an assigned admin expiry.
        SimpleDateFormat fmt=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        fmt.setLenient(false);
        ParsePosition cursor=new ParsePosition(0);
        java.util.Date parsed=fmt.parse(raw,cursor);
        if(parsed==null||cursor.getIndex()!=raw.length())
            throw new AuthenticationException("تاريخ صلاحية الحساب غير صحيح. راجع الإدارة.");
        return parsed.getTime();
    }
    private static JSONObject authorizedUser(Context context,String access,long sessionStarted)throws Exception{
        JSONObject user=request(context,"user",null,access);
        if(!"active".equals(user.optJSONObject("app_metadata")==null?"":user.optJSONObject("app_metadata").optString("alezz_customer","")))
            throw new AuthenticationException("هذا الحساب غير نشط. تواصل مع الإدارة.");
        JSONObject metadata=user.optJSONObject("app_metadata");
        String reset=metadata==null?"":metadata.optString("alezz_devices_revoked_at","");
        if(!reset.isEmpty()){
            SimpleDateFormat resetFormat=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);
            resetFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
            resetFormat.setLenient(false);
            ParsePosition resetAt=new ParsePosition(0);
            java.util.Date cutOff=resetFormat.parse(reset,resetAt);
            if(cutOff==null||resetAt.getIndex()!=reset.length()||
                sessionStarted<=0L||sessionStarted<=cutOff.getTime())
                throw new AuthenticationException("تم إلغاء ارتباط الجهاز من الإدارة. سجّل الدخول مجددًا.");
        }
        long deadline=subscriptionDeadline(user);
        if(deadline>0L && deadline<=System.currentTimeMillis())
            throw new AuthenticationException("انتهت صلاحية حسابك. تواصل مع الإدارة لتجديد الاشتراك.");
        if(user.optString("id","").isEmpty())throw new AuthenticationException("تعذّر تأكيد هوية الحساب.");
        return user;
    }
    public static boolean isExpiredLocally(Context context){
        long until=preferences(context).getLong("subscription_expires_ms",0L);
        return until>0L && System.currentTimeMillis()>=until;
    }
    /** Verify entitlement even during a long-lived session, not only at login. */
    public static synchronized void validateAccount(Context context)throws Exception{
        if(isExpiredLocally(context)){
            logoutLocal(context);
            throw new AuthenticationException("انتهت صلاحية حسابك. تواصل مع الإدارة.");
        }
        ensureFresh(context);
        try{
            JSONObject user=authorizedUser(context,accessToken(context),
                preferences(context).getLong("session_started_ms",0L));
            preferences(context).edit()
                .putLong("subscription_expires_ms",subscriptionDeadline(user)).commit();
        }catch(AuthenticationException denied){
            logoutLocal(context);
            throw denied;
        }
    }
    private static void save(Context context,JSONObject reply,String username,long sessionStarted)throws Exception{
        String access=reply.optString("access_token",""),refresh=reply.optString("refresh_token","");
        if(access.length()<30||refresh.length()<15)throw new AuthenticationException("فشل استلام جلسة صالحة.");
        JSONObject user=authorizedUser(context,access,sessionStarted);
        long lifetime=Math.max(60,Math.min(86400,reply.optLong("expires_in",3600)));
        boolean stored=preferences(context).edit()
            .putLong("subscription_expires_ms",subscriptionDeadline(user))
            .putLong("expires_at_ms",System.currentTimeMillis()+lifetime*1000L)
            .putLong("session_started_ms",sessionStarted)
            .putString("user_id",user.optString("id"))
            .putString("username",username)
            .putString("access_token",access)
            .putString("refresh_token",refresh)
            .commit();
        if(!stored)throw new AuthenticationException("تعذر حفظ جلسة الدخول محليًا.");
    }
    public static void login(Context context,String username,char[] password)throws Exception{
        try{
            String name=username==null?"":username.trim().toLowerCase(Locale.US);
            if(!name.matches("[a-z0-9][a-z0-9_.-]{2,39}"))
                throw new AuthenticationException("اسم المستخدم يجب أن يحتوي من 3 إلى 40 حرفًا أو رقمًا.");
            if(password==null||password.length==0||password.length>128)
                throw new AuthenticationException("أدخل كلمة مرور صالحة.");
            JSONObject body=new JSONObject();
            body.put("email",name+"@"+ALIAS_DOMAIN);
            body.put("password",new String(password));
            long sessionStarted=System.currentTimeMillis();
            JSONObject reply=request(context,"token?grant_type=password",body,null);
            save(context,reply,name,sessionStarted);
        }finally{
            if(password!=null)java.util.Arrays.fill(password,'\0');
        }
    }
    public static synchronized void resume(Context context)throws Exception{
        String refresh=preferences(context).getString("refresh_token","");
        if(refresh.isEmpty())throw new AuthenticationException("يلزم تسجيل الدخول.");
        JSONObject body=new JSONObject();body.put("refresh_token",refresh);
        try{
            JSONObject reply=request(context,"token?grant_type=refresh_token",body,null);
            save(context,reply,username(context),
                preferences(context).getLong("session_started_ms",0L));
        }catch(AuthenticationException invalid){
            logoutLocal(context);
            throw invalid;
        }
    }
    /** Refresh only when necessary; serializing avoids refresh-token rotation races. */
    public static synchronized void ensureFresh(Context context)throws Exception{
        if(isExpiredLocally(context)){
            logoutLocal(context);
            throw new AuthenticationException("انتهت صلاحية حسابك. تواصل مع الإدارة.");
        }
        long expiry=preferences(context).getLong("expires_at_ms",0L);
        if(accessToken(context).isEmpty()||System.currentTimeMillis()>expiry-90000L)
            resume(context);
    }
    public static int daysRemaining(Context context){
        long deadline=preferences(context).getLong("subscription_expires_ms",0L);
        if(deadline<=0L)return -1;
        long remaining=deadline-System.currentTimeMillis();
        return remaining<=0L?0:(int)Math.min(3651L,(remaining+86400000L-1)/86400000L);
    }
    public static void logoutLocal(Context context){
        preferences(context).edit().clear().commit();
    }
    public static void logout(Context context){
        String token=accessToken(context);
        logoutLocal(context);
        if(!token.isEmpty()){
            try{request(context,"logout",new JSONObject(),token);}
            catch(Exception ignored){ /* local sign-out must work even if offline */ }
        }
    }
}
