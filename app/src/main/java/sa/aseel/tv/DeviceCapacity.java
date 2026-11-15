package sa.aseel.tv;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
/** Small-heap profile for Android 4.4 TVs like Huidi SMART_PC822. */
public final class DeviceCapacity {
    private DeviceCapacity(){}
    public static boolean isConstrained(Context context){
        if(Build.VERSION.SDK_INT<=19)return true;
        try {
            ActivityManager am=(ActivityManager)context.getSystemService(Context.ACTIVITY_SERVICE);
            return am!=null&&(am.isLowRamDevice()||am.getMemoryClass()<=96);
        }catch(RuntimeException ex){return false;}
    }
}
