package sa.youef.huidi.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Local-only launcher shortcut gate. Not a device policy or system-wide app lock. */
final class AppPinGate {
    private final SharedPreferences preferences;
    AppPinGate(Context context) {
        preferences=context.getSharedPreferences("huidi_app_gate_v1",Context.MODE_PRIVATE);
    }
    boolean hasPin() {
        return preferences.contains("salt") && preferences.contains("hash");
    }
    private static byte[] derive(char[] pin, byte[] salt) throws Exception {
        PBEKeySpec spec=new PBEKeySpec(pin,salt,12000,160);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1")
                .generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }
    boolean savePin(String text) {
        if (text==null || !text.matches("[0-9]{6}")) return false;
        char[] pin=text.toCharArray();
        try {
            byte[] salt=new byte[16];
            new SecureRandom().nextBytes(salt);
            byte[] hash=derive(pin,salt);
            return preferences.edit()
                .putString("salt",Base64.encodeToString(salt,Base64.NO_WRAP))
                .putString("hash",Base64.encodeToString(hash,Base64.NO_WRAP))
                .commit();
        } catch(Exception ignored) { return false; }
        finally { Arrays.fill(pin,'\0'); }
    }
    boolean verify(String text) {
        if(!hasPin() || text==null || !text.matches("[0-9]{6}")) return false;
        char[] pin=text.toCharArray();
        try {
            byte[] salt=Base64.decode(preferences.getString("salt",""),Base64.DEFAULT);
            byte[] expected=Base64.decode(preferences.getString("hash",""),Base64.DEFAULT);
            return MessageDigest.isEqual(expected,derive(pin,salt));
        } catch(Exception ignored) { return false; }
        finally { Arrays.fill(pin,'\0'); }
    }
    boolean isLocked(String pkg) {
        return hasPin() && preferences.getStringSet("locked",java.util.Collections.<String>emptySet()).contains(pkg);
    }
    void setLocked(String pkg,boolean locked) {
        if(!hasPin() || pkg==null || pkg.length()==0) return;
        Set<String> packages=new HashSet<String>(
            preferences.getStringSet("locked",java.util.Collections.<String>emptySet()));
        if(locked)packages.add(pkg);else packages.remove(pkg);
        preferences.edit().putStringSet("locked",packages).apply();
    }
    void clear() { preferences.edit().clear().apply(); }
}
