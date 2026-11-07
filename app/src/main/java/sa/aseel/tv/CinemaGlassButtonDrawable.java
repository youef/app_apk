package sa.aseel.tv;

import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;

/**
 * Scalable premium crimson-glass buttons inspired by the approved four-state art.
 * Live text/icons remain real Android controls; this is only the material.
 * No bitmap scaling, blur filters or RenderEffect: Android 4.4.4 / API19 safe.
 */
public final class CinemaGlassButtonDrawable extends Drawable {
    private final boolean primary, compact;
    private final int tint;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
    private boolean focused, pressed, enabled = true;
    private int alpha = 255;
    private ColorFilter filter;

    public CinemaGlassButtonDrawable(boolean primary, boolean compact, int tint) {
        this.primary=primary;
        this.compact=compact;
        this.tint=tint;
    }
    @Override public boolean isStateful(){return true;}
    @Override protected boolean onStateChange(int[] state){
        boolean f=false,pr=false,en=false;
        for(int i=0;i<state.length;i++){
            if(state[i]==android.R.attr.state_focused)f=true;
            if(state[i]==android.R.attr.state_pressed)pr=true;
            if(state[i]==android.R.attr.state_enabled)en=true;
        }
        if(focused!=f||pressed!=pr||enabled!=en){
            focused=f;pressed=pr;enabled=en;invalidateSelf();return true;
        }
        return false;
    }
    private void reset(int color){
        p.reset();p.setAntiAlias(true);p.setDither(true);
        p.setColor(color);
        p.setColorFilter(filter);
        p.setAlpha(Math.round(Color.alpha(color)*alpha/255f));
    }
    private void stroke(Canvas canvas,RectF rect,float radius,int color,float width){
        reset(color);p.setStrokeWidth(width);p.setStyle(Paint.Style.STROKE);
        canvas.drawRoundRect(rect,radius,radius,p);
    }
    @Override public void draw(Canvas canvas){
        Rect bounds=getBounds();
        if(bounds.isEmpty())return;
        float w=bounds.width(),h=bounds.height();
        float inset=(focused?5f:2.4f);
        float x=bounds.left+inset,y=bounds.top+inset;
        float rw=w-inset*2,rh=h-inset*2;
        if(rw<6||rh<6)return;
        float radius=compact?Math.min(rh*.30f,18f):rh*.46f;
        RectF r=new RectF(x,y,x+rw,y+rh);
        boolean muted=!enabled;
        int top=muted?0xFF51454C:primary?(pressed?0xFF3D0715:0xFF861329):tint;
        int middle=muted?0xFF342E36:primary?(pressed?0xFF24030B:0xFF3D020D):0xFF211823;
        int end=muted?0xFF473D45:primary?(pressed?0xFF50081A:0xFF8B0A28):0xFF3F1A2E;
        reset(Color.WHITE);
        p.setShader(new LinearGradient(x,y,x+rw,y+rh,
            new int[]{top,middle,end},new float[]{0f,.55f,1f},Shader.TileMode.CLAMP));
        canvas.drawRoundRect(r,radius,radius,p);
        p.setShader(null);

        // Top sheen and lower luminous wave are clipped inside the pill surface.
        canvas.save();
        Path clip=new Path();clip.addRoundRect(r,radius,radius,Path.Direction.CW);
        canvas.clipPath(clip);
        Path topShine=new Path();
        topShine.moveTo(x,y+rh*.16f);
        topShine.cubicTo(x+rw*.16f,y-rh*.12f,x+rw*.50f,y+rh*.05f,x+rw,y+rh*.06f);
        topShine.lineTo(x+rw,y+rh*.32f);
        topShine.cubicTo(x+rw*.69f,y+rh*.29f,x+rw*.35f,y+rh*.50f,x,y+rh*.70f);
        topShine.close();
        reset(muted?0x1FFFFFFF:0x39FFE2EA);
        canvas.drawPath(topShine,p);
        Path wave=new Path();
        wave.moveTo(x-8,y+rh*.68f);
        wave.cubicTo(x+rw*.22f,y+rh*.96f,x+rw*.44f,y+rh*.89f,
            x+rw*.64f,y+rh*.77f);
        wave.cubicTo(x+rw*.82f,y+rh*.66f,x+rw*.92f,y+rh*.65f,x+rw+8,y+rh*.63f);
        wave.lineTo(x+rw+8,y+rh+8);wave.lineTo(x-8,y+rh+8);
        wave.close();
        reset(muted?0x125F515A:primary?0x66BD102F:0x3A9C244B);
        canvas.drawPath(wave,p);
        if(primary&&!muted){
            reset(pressed?0x77C72A49:0xAEF2254C);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(Math.max(1.2f,rh*.018f));
            Path light=new Path();
            light.moveTo(x,y+rh*.70f);
            light.cubicTo(x+rw*.20f,y+rh*.94f,x+rw*.38f,y+rh*.94f,
                x+rw*.53f,y+rh*.82f);
            canvas.drawPath(light,p);
        }
        canvas.restore();

        // Strong focused rim for reliable D-pad focus on dark television screens.
        stroke(canvas,new RectF(x+1,y+1,x+rw-1,y+rh-1),radius,
            muted?0x668C858A:focused?0xFFFFE4E8:primary?0xFFEE5C74:0xFF9C5369,
            focused?2.6f:1.35f);
        stroke(canvas,new RectF(x+4,y+4,x+rw-4,y+rh-4),Math.max(1f,radius-3f),
            muted?0x228B8790:focused?0xC9FF7E91:0x50FFB1BF,1f);
        if(focused&&!muted){
            stroke(canvas,new RectF(x-2,y-2,x+rw+2,y+rh+2),radius+3f,
                0xBFF03959,3f);
        }
    }
    @Override public void setAlpha(int value){alpha=value;invalidateSelf();}
    @Override public void setColorFilter(ColorFilter value){filter=value;invalidateSelf();}
    @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    public static ColorStateList labelColors(){
        return new ColorStateList(
            new int[][]{new int[]{-android.R.attr.state_enabled},new int[]{}},
            new int[]{0xFFB4AEB7,0xFFFFFFFF});
    }
}
