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
        int top=Color.argb(219,constrain(r+18,110),constrain(g+19,115),
            constrain(b+30,135));
        int bottom=Color.argb(232,constrain(r+3,60),constrain(g+5,70),
            constrain(b+10,92));
        GradientDrawable drawable=new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{top,bottom});
        drawable.setCornerRadius(Math.max(0,cornerPixels));
        drawable.setStroke(1,border==0?0x52E7D8BE:border);
        return drawable;
    }

    public static GradientDrawable overlay(int border,float cornerPixels){
        GradientDrawable drawable=new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{0xED303C51,0xE8152133,0xE90C1526});
        drawable.setCornerRadius(Math.max(0,cornerPixels));
        drawable.setStroke(1,border==0?0x72F1D39B:border);
        return drawable;
    }

    public static GradientDrawable canvas(){
        return new GradientDrawable(GradientDrawable.Orientation.TL_BR,
            new int[]{0xFF060A13,0xFF141E30,0xFF080C15});
    }
}
