package sa.aseel.tv;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;

/**
 * Consistent glass-like panels for legacy Android TV (API 19+).
 *
 * Android 4.4.4 cannot blur views below API 31, so translucent gradients and
 * subtle one-pixel borders replace expensive blur/shader effects. Never apply
 * this drawable over the actual decoded video surface.
 */
public final class GlassSurface {
    private GlassSurface(){}

    private static int constrain(int value,int max){
        return Math.min(max,Math.max(0,value));
    }

    public static GradientDrawable panel(int tint,int border,float cornerPixels){
        int r=Color.red(tint),g=Color.green(tint),b=Color.blue(tint);
        int top=Color.argb(231,constrain(r+22,115),constrain(g+10,92),
            constrain(b+21,115));
        int bottom=Color.argb(240,constrain(r+5,72),constrain(g+3,65),
            constrain(b+11,85));
        GradientDrawable drawable=new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{top,bottom});
        drawable.setCornerRadius(Math.max(0,cornerPixels));
        drawable.setStroke(1,border==0?0x5CF87D92:border);
        return drawable;
    }

    public static GradientDrawable overlay(int border,float cornerPixels){
        GradientDrawable drawable=new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{0xEE342333,0xEA201C2A,0xED0C1019});
        drawable.setCornerRadius(Math.max(0,cornerPixels));
        drawable.setStroke(1,border==0?0x72F66A7C:border);
        return drawable;
    }

    /** Near-clear chrome over gradient artwork. No expensive blur on API19. */
    public static GradientDrawable transparentHeader(float cornerPixels){
        GradientDrawable drawable=new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{0x2B1A1723,0x130E1119,0x080A0B10});
        drawable.setCornerRadius(Math.max(0,cornerPixels));
        drawable.setStroke(1,0x4BEF4D68);
        return drawable;
    }

    public static GradientDrawable canvas(){
        return new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{0xFF090B12,0xFF21141F,0xFF090C14});
    }
}
