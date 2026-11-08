package sa.aseel.tv;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
/** Lightweight luminous red card frame, compatible with Android 4.4.4. */
public final class CinemaNeonDrawable extends Drawable {
    private final int tint; private final float radius; private final boolean focused;
    private final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.DITHER_FLAG);
    private int alpha=255; private ColorFilter filter;
    public CinemaNeonDrawable(int tint,float radius,boolean focused){
        this.tint=tint;this.radius=radius;this.focused=focused;
    }
    private void paint(int color){
        p.reset();p.setAntiAlias(true);p.setDither(true);p.setColor(color);
        p.setAlpha(Math.round(Color.alpha(color)*alpha/255f));p.setColorFilter(filter);
    }
    @Override public void draw(Canvas canvas){
        Rect b=getBounds();if(b.isEmpty())return;
        float in=focused?5f:4f;
        RectF r=new RectF(b.left+in,b.top+in,b.right-in,b.bottom-in);
        if(r.width()<10f||r.height()<10f)return;
        float corner=Math.min(radius,Math.min(r.width(),r.height())*.44f);
        paint(Color.WHITE);p.setShader(new LinearGradient(r.left,r.top,r.right,r.bottom,
          new int[]{tint,0xF0191421,0xF02B1725},null,Shader.TileMode.CLAMP));
        canvas.drawRoundRect(r,corner,corner,p);p.setShader(null);
        paint(focused?0x79FF3C61:0x36F1395B);p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(focused?8f:6f);canvas.drawRoundRect(r,corner,corner,p);
        paint(focused?0xB5FF4965:0x65EC3958);p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(focused?4.8f:3.8f);canvas.drawRoundRect(r,corner,corner,p);
        paint(focused?0xFFFFA4B6:0xBFFF526A);p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(focused?2.5f:1.65f);canvas.drawRoundRect(r,corner,corner,p);
    }
    @Override public void setAlpha(int a){alpha=a;invalidateSelf();}
    @Override public void setColorFilter(ColorFilter f){filter=f;invalidateSelf();}
    @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
}
