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
    public static String planName(Context context){
        String name=preferences(context).getString("subscription_plan_name","");
        return name.isEmpty()?"حسب الباقة المحددة من الإدارة":name;
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
            if(status==429)throw new java.io.IOException("محاولات كثيرة. أعد المحاولة لاحقًا.");
            if(status<200||status>=300)
                throw new java.io.IOException("تعذّر الاتصال بخادم الحسابات (HTTP "+status+").");
            return new JSONObject(readLimited(connection.getInputStream()));
        }finally{connection.disconnect();}
    }
    public static class AuthenticationException extends Exception{
        AuthenticationException(String message){super(message);}
    }
    private static final class SubscriptionExpiredException extends AuthenticationException{
        SubscriptionExpiredException(){
            super("انتهت صلاحية حسابك. تواصل مع الإدارة لتجديد الاشتراك.");
        }
    }
    /**
     * Parse server-owned ISO-8601 timestamps without assuming a single fractional
     * precision. Android 4.4 does not provide java.time; all accepted formats
     * have explicit UTC or offset information and must match completely.
     */
    private static final java.util.regex.Pattern BACKEND_TIMESTAMP=java.util.regex.Pattern.compile(
        "^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d{1,9}))?(Z|[+-]\\d{2}:\\d{2})$");
    static java.util.Date parseBackendTimestamp(String raw){
        if(raw==null || raw.length()<20 || raw.length()>48)return null;
        java.util.regex.Matcher stamp=BACKEND_TIMESTAMP.matcher(raw.trim());
        if(!stamp.matches())return null;
        String fraction=stamp.group(2);
        String millis=((fraction==null?"":fraction)+"000").substring(0,3);
        String offset=stamp.group(3);
        String iso=stamp.group(1)+"."+millis+("Z".equals(offset)?"+0000":offset.replace(":",""));
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ",Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        format.setLenient(false);
        ParsePosition at=new ParsePosition(0);
        java.util.Date value=format.parse(iso,at);
        return at.getIndex()==iso.length()?value:null;
    }
    private static long subscriptionDeadline(JSONObject user)throws AuthenticationException{
        JSONObject metadata=user.optJSONObject("app_metadata");
        if(metadata==null)throw new AuthenticationException("بيانات صلاحية الحساب غير صالحة.");
        String raw=metadata.optString("alezz_expires_at","");
        if(raw.isEmpty())return 0L; // Existing accounts await an assigned admin expiry.
        java.util.Date parsed=parseBackendTimestamp(raw);
        if(parsed==null)
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
            java.util.Date cutOff=parseBackendTimestamp(reset);
            if(cutOff==null||sessionStarted<=0L||sessionStarted<=cutOff.getTime())
                throw new AuthenticationException("تم إلغاء ارتباط الجهاز من الإدارة. سجّل الدخول مجددًا.");
        }
        long deadline=subscriptionDeadline(user);
        if(deadline>0L && deadline<=System.currentTimeMillis())
            throw new SubscriptionExpiredException();
        if(user.optString("id","").isEmpty())throw new AuthenticationException("تعذّر تأكيد هوية الحساب.");
        return user;
    }
    public static boolean isExpiredLocally(Context context){
        long until=preferences(context).getLong("subscription_expires_ms",0L);
        return until>0L && System.currentTimeMillis()>=until;
    }
    /** Verify entitlement even during a long-lived session, not only at login. */
    public static synchronized void validateAccount(Context context)throws Exception{
        // An administrator may have renewed the subscription after the local
        // deadline was cached. Refresh from the server before denying access.
        // resume() still rejects genuinely expired/disabled accounts.
        if(isExpiredLocally(context))resume(context);
        ensureFresh(context);
        try{
            JSONObject user=authorizedUser(context,accessToken(context),
                preferences(context).getLong("session_started_ms",0L));
            JSONObject metadata=user.optJSONObject("app_metadata");
            String plan=metadata==null?"":metadata.optString("alezz_plan_name","");
            if(plan.isEmpty()&&metadata!=null)plan=metadata.optString("alezz_plan","");
            if(plan.length()>48)plan=plan.substring(0,48);
            preferences(context).edit()
                .putLong("subscription_expires_ms",subscriptionDeadline(user))
                .putString("subscription_plan_name",plan).commit();
            registerDevice(context);
        }catch(SubscriptionExpiredException expired){
            throw expired;
        }catch(AuthenticationException denied){
            logoutLocal(context);
            throw denied;
        }
    }
    /** Report this authenticated Android TV device to the owner's RLS-protected
     * Supabase device list. Only an irreversible SHA-256 of a private random id
     * leaves the device; failure never blocks customer playback. */
    private static void registerDevice(Context context){
        try{
            SharedPreferences pref=preferences(context);
            long now=System.currentTimeMillis();
            if(now-pref.getLong("device_seen_ms",0L)<300000L)return;
            String uid=userId(context),token=accessToken(context);
            if(!uid.matches("[a-fA-F0-9-]{36}")||token.isEmpty())return;
            String seed=pref.getString("device_seed","");
            if(seed.isEmpty()){
                byte[] random=new byte[32];new java.security.SecureRandom().nextBytes(random);
                StringBuilder result=new StringBuilder();
                for(byte b:random)result.append(String.format(Locale.US,"%02x",b&0xff));
                seed=result.toString();
                if(!pref.edit().putString("device_seed",seed).commit())return;
            }
            byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(seed.getBytes("UTF-8"));
            StringBuilder hash=new StringBuilder();
            for(byte b:digest)hash.append(String.format(Locale.US,"%02x",b&0xff));
            JSONObject row=new JSONObject();
            row.put("user_id",uid);row.put("device_hash",hash.toString());
            row.put("platform","android_tv");
            row.put("device_model",android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL);
            row.put("app_version","API"+android.os.Build.VERSION.SDK_INT);
            SimpleDateFormat timeFormat=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'",Locale.US);
            timeFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
            row.put("last_seen_at",timeFormat.format(new java.util.Date(now)));
            URL url=new URL(AppConfig.API_ROOT+
                "aseel_device_sessions?on_conflict=user_id%2Cdevice_hash");
            HttpsURLConnection conn=(HttpsURLConnection)url.openConnection();
            conn.setSSLSocketFactory(LegacyTls.factory(context));
            conn.setConnectTimeout(9000);conn.setReadTimeout(9000);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("apikey",AppConfig.PUBLISHABLE_KEY);
            conn.setRequestProperty("Authorization","Bearer "+token);
            conn.setRequestProperty("Content-Type","application/json; charset=utf-8");
            conn.setRequestProperty("Prefer","resolution=merge-duplicates,return=minimal");
            conn.setDoOutput(true);
            try{
                OutputStream out=conn.getOutputStream();
                try{out.write(row.toString().getBytes("UTF-8"));}finally{out.close();}
                int code=conn.getResponseCode();
                if(code>=200&&code<300)pref.edit().putLong("device_seen_ms",now).apply();
            }finally{conn.disconnect();}
        }catch(Exception ignored){/* Device inventory is best effort, never auth. */}
    }

    private static void save(Context context,JSONObject reply,String username,long sessionStarted)throws Exception{
        String access=reply.optString("access_token",""),refresh=reply.optString("refresh_token","");
        // Supabase may issue legacy 12-character refresh tokens as well as longer tokens.
        // Treat 12-character tokens as valid and rely on /auth/v1/user to verify the JWT.
        if(access.length()<30||refresh.length()<12)
            throw new AuthenticationException("الخادم لم يُرجع رموز دخول مكتملة. أعد المحاولة.");
        JSONObject user=authorizedUser(context,access,sessionStarted);
        long lifetime=Math.max(60,Math.min(86400,reply.optLong("expires_in",3600)));
        JSONObject metadata=user.optJSONObject("app_metadata");
        String plan=metadata==null?"":metadata.optString("alezz_plan_name","");
        if(plan.isEmpty()&&metadata!=null)plan=metadata.optString("alezz_plan","");
        if(plan.length()>48)plan=plan.substring(0,48);
        boolean stored=preferences(context).edit()
            .putString("subscription_plan_name",plan)
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
            registerDevice(context);
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
            String rotated=reply.optString("refresh_token","");
            if(rotated.length()>=12&&!rotated.equals(refresh)&&!preferences(context).edit()
                .putString("refresh_token",rotated).commit())
                throw new java.io.IOException("تعذّر حفظ جلسة الدخول المحدّثة.");
            save(context,reply,username(context),
                preferences(context).getLong("session_started_ms",0L));
            registerDevice(context);
        }catch(SubscriptionExpiredException expired){
            throw expired;
        }catch(AuthenticationException invalid){
            logoutLocal(context);
            throw invalid;
        }
    }
    /** Refresh only when necessary; serializing avoids refresh-token rotation races. */
    public static synchronized void ensureFresh(Context context)throws Exception{
        // A stale locally cached deadline is not proof of server-side expiry.
        if(isExpiredLocally(context)){
            resume(context);
            return;
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
