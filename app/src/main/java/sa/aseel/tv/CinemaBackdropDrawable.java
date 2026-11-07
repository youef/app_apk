package sa.aseel.tv;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;

/**
 * Al Ezz TV cinematic red glass backdrop, matching the web wallpaper.
 *
 * Uses cached coordinates, simple paths and shader fills; no blur, bitmaps,
 * WebView, RenderEffect or GPU-heavy realtime effects. Android API 19+.
 * The video surface itself retains its own opaque black background.
 */
public final class CinemaBackdropDrawable extends Drawable {
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
    private int alpha = 255;
    private ColorFilter colorFilter;

    private Path shape(float... xy) {
        Path result = new Path();
        if (xy.length >= 2) {
            result.moveTo(xy[0], xy[1]);
            for (int i=2;i+1<xy.length;i+=2) result.lineTo(xy[i],xy[i+1]);
            result.close();
        }
        return result;
    }
    private void fill(Canvas c, Path path, int color) {
        p.reset();
        p.setAntiAlias(true);
        p.setDither(true);
        p.setColor(color);
        p.setAlpha(Math.round(ColorAlpha(color) * alpha / 255f));
        p.setColorFilter(colorFilter);
        c.drawPath(path,p);
    }
    private static int ColorAlpha(int color){ return (color >>> 24) & 255; }
    private void line(Canvas c, Path path,int color,float width){
        p.reset();p.setAntiAlias(true);p.setDither(true);
        p.setColor(color);p.setStyle(Paint.Style.STROKE);
        p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);
        p.setStrokeWidth(width);p.setAlpha(Math.round(ColorAlpha(color) * alpha / 255f));
        p.setColorFilter(colorFilter);
        c.drawPath(path,p);
    }
    @Override public void draw(Canvas canvas){
        Rect r=getBounds();
        if(r.width()<=0 || r.height()<=0)return;
        canvas.save();
        canvas.translate(r.left,r.top);
        canvas.scale(r.width()/1920f,r.height()/1080f);
        p.reset();p.setDither(true);p.setAntiAlias(true);
        p.setShader(new LinearGradient(0,0,1920,1080,
            new int[]{0xFF21030B,0xFF0D090F,0xFF15050C,0xFF49020C},
            new float[]{0f,.32f,.7f,1f},Shader.TileMode.CLAMP));
        canvas.drawRect(0,0,1920,1080,p);
        p.setShader(null);

        // Frosted sheets along edges. Leave a clear dark central canvas for text.
        Path top=shape(0,0,605,0,510,132,410,221,0,292);
        fill(canvas,top,0x66731A2B);
        Path second=shape(274,0,659,0,562,202,466,335,0,409,0,285);
        fill(canvas,second,0x88401322);
        Path topTrace=new Path();
        topTrace.moveTo(0,402);topTrace.cubicTo(155,369,340,351,465,333);
        topTrace.cubicTo(532,291,547,192,625,0);
        line(canvas,topTrace,0x70FA596D,2.6f);

        // Subtle right-side luminous glass ribbons.
        Path right=new Path();right.moveTo(1920,427);
        right.lineTo(1642,512);right.cubicTo(1560,539,1534,620,1512,683);
        right.lineTo(1332,1080);right.lineTo(1920,1080);right.close();
        fill(canvas,right,0x579C2038);
        line(canvas,right,0x65FF657D,1.9f);
        Path inner=new Path();inner.moveTo(1920,570);inner.lineTo(1416,699);
        inner.cubicTo(1370,711,1354,755,1335,808);
        inner.lineTo(1201,1080);inner.lineTo(1920,1080);inner.close();
        fill(canvas,inner,0x48D22240);
        line(canvas,inner,0x86FF536A,2.2f);

        // Signature curved red light wave across the base.
        Path shadow=new Path();shadow.moveTo(0,742);
        shadow.cubicTo(348,962,700,990,1010,1007);
        shadow.cubicTo(1350,1080,1670,924,1920,970);
        shadow.lineTo(1920,1080);shadow.lineTo(0,1080);shadow.close();
        fill(canvas,shadow,0x52680720);
        Path wave=new Path();wave.moveTo(0,743);
        wave.cubicTo(337,947,720,990,1021,1016);
        wave.cubicTo(1378,1066,1645,951,1920,995);
        line(canvas,wave,0xB5D61836,3.4f);
        Path highlight=new Path();highlight.moveTo(130,830);
        highlight.cubicTo(292,925,414,947,498,967);
        line(canvas,highlight,0xB8FF6B7D,3.4f);
        Path upper=new Path();upper.moveTo(1200,357);
        upper.cubicTo(1470,169,1708,91,1920,62);
        line(canvas,upper,0x9DF43A54,2.7f);

        // Fine deep shade makes overlaid text/controls readable.
        p.reset();p.setColor(0x17010307);
        canvas.drawRect(0,0,1920,1080,p);
        canvas.restore();
    }
    @Override public void setAlpha(int value){alpha=value;invalidateSelf();}
    @Override public void setColorFilter(ColorFilter filter){colorFilter=filter;invalidateSelf();}
    @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
}