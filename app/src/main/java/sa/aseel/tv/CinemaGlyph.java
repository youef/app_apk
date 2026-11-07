package sa.aseel.tv;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;

/**
 * Lightweight native stroke icons; no font downloads, WebView or vector XML
 * required. Works on Android API 19+, and stays crisp on television screens.
 */
public final class CinemaGlyph extends Drawable {
    private final String name;
    private final Paint brush=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final int tint;
    private float width=1.8f;

    public CinemaGlyph(String name,int tint){this.name=name==null?"film":name;this.tint=tint;}
    private void line(Canvas canvas,float x1,float y1,float x2,float y2){
        canvas.drawLine(x1,y1,x2,y2,brush);
    }
    private void rectangle(Canvas canvas,float x1,float y1,float x2,float y2){
        canvas.drawRoundRect(new RectF(x1,y1,x2,y2),2f,2f,brush);
    }
    private void poly(Canvas canvas,float... pts){
        if(pts.length<4)return;
        Path p=new Path();p.moveTo(pts[0],pts[1]);
        for(int i=2;i<pts.length;i+=2)p.lineTo(pts[i],pts[i+1]);
        canvas.drawPath(p,brush);
    }
    @Override public void draw(Canvas canvas){
        Rect rect=getBounds();if(rect.width()<=0||rect.height()<=0)return;
        canvas.save();
        float size=Math.min(rect.width(),rect.height()),scale=size/24f;
        canvas.translate(rect.left+(rect.width()-size)/2f,rect.top+(rect.height()-size)/2f);
        canvas.scale(scale,scale);
        brush.setColor(tint);brush.setStyle(Paint.Style.STROKE);
        brush.setStrokeWidth(width);brush.setStrokeCap(Paint.Cap.ROUND);
        brush.setStrokeJoin(Paint.Join.ROUND);
        if("movies".equals(name)||"film".equals(name)){
            rectangle(canvas,3,6,21,20);line(canvas,3,10,21,10);
            line(canvas,8,6,11,10);line(canvas,14,6,17,10);
            poly(canvas,10,13,15,15.5f,10,18,10,13);
        }else if("series".equals(name)){
            rectangle(canvas,3,4,21,20);line(canvas,8,4,8,20);
            poly(canvas,13,10,17,12,13,14,13,10);
            line(canvas,11,17,17,17);
        }else if("live".equals(name)){
            rectangle(canvas,3,7,21,19);poly(canvas,9,3,12,6,15,3);
            line(canvas,8,22,16,22);poly(canvas,10,11,15,13,10,16,10,11);
        }else if("kids".equals(name)){
            canvas.drawCircle(12,12,9,brush);
            brush.setStyle(Paint.Style.FILL);canvas.drawCircle(9,10,1,brush);
            canvas.drawCircle(15,10,1,brush);brush.setStyle(Paint.Style.STROKE);
            Path smile=new Path();smile.moveTo(8,15);
            smile.quadTo(12,19,16,15);canvas.drawPath(smile,brush);
        }else if("favorites".equals(name)||"heart".equals(name)){
            Path heart=new Path();heart.moveTo(12,20);
            heart.cubicTo(8,17,3.4f,13,3.4f,8.6f);
            heart.cubicTo(3.4f,4.2f,9,2.6f,12,7.3f);
            heart.cubicTo(15,2.6f,20.6f,4.2f,20.6f,8.6f);
            heart.cubicTo(20.6f,13,16,17,12,20);canvas.drawPath(heart,brush);
        }else if("account".equals(name)||"profile".equals(name)){
            canvas.drawCircle(12,8,4f,brush);
            Path shoulder=new Path();shoulder.moveTo(4,20);
            shoulder.cubicTo(4,15,8,14,12,14);
            shoulder.cubicTo(16,14,20,15,20,20);
            canvas.drawPath(shoulder,brush);
        }else if("logout".equals(name)){
            poly(canvas,11,4,4,4,4,20,11,20);
            line(canvas,10,12,22,12);poly(canvas,17,7,22,12,17,17);
        }else if("subscription".equals(name)){
            rectangle(canvas,3,5,21,19);
            line(canvas,3,10,21,10);line(canvas,7,15,13,15);
        }else if("settings".equals(name)){
            canvas.drawCircle(12,12,8.5f,brush);canvas.drawCircle(12,12,3,brush);
            line(canvas,12,1.5f,12,4);line(canvas,12,20,12,22.5f);
            line(canvas,1.5f,12,4,12);line(canvas,20,12,22.5f,12);
        }else if("search".equals(name)){
            canvas.drawCircle(10.5f,10.5f,6.6f,brush);line(canvas,15.5f,15.5f,21,21);
        }else if("home".equals(name)){
            poly(canvas,3,11,12,3.5f,21,11,21,20,15,20,15,14,9,14,9,20,3,20,3,11);
        }else if("play".equals(name)){
            poly(canvas,8,5,19,12,8,19,8,5);
        }else if("playpause".equals(name)){
            poly(canvas,5,5,12,12,5,19,5,5);
            line(canvas,16,6,16,18);line(canvas,20,6,20,18);
        }else if("retry".equals(name)){
            Path arc=new Path();arc.addArc(new RectF(5,5,19,19),-55,293);
            canvas.drawPath(arc,brush);poly(canvas,18,3,21,9,15,9);
        }else if("guide".equals(name)){
            for(int y=6;y<=18;y+=6){
                canvas.drawCircle(5,y,1,brush);line(canvas,9,y,21,y);
            }
        }else if("star".equals(name)||"star-filled".equals(name)){
            Path star=new Path();
            for(int i=0;i<10;i++){
                double angle=-Math.PI/2+i*Math.PI/5;
                float rad=i%2==0?9f:4.4f;
                float x=12+(float)Math.cos(angle)*rad,y=12+(float)Math.sin(angle)*rad;
                if(i==0)star.moveTo(x,y);else star.lineTo(x,y);
            }
            star.close();brush.setStyle("star-filled".equals(name)?Paint.Style.FILL:Paint.Style.STROKE);
            canvas.drawPath(star,brush);
        }else if("mute".equals(name)||"volume".equals(name)||"audio".equals(name)){
            poly(canvas,3,9,7,9,12,5,12,19,7,15,3,15,3,9);
            if("mute".equals(name)){
                line(canvas,16,9,21,15);line(canvas,21,9,16,15);
            }else{
                Path wave=new Path();wave.moveTo(15,8);
                wave.quadTo(19,12,15,16);canvas.drawPath(wave,brush);
                if("audio".equals(name))line(canvas,20,7,20,17);
            }
        }else if("screen".equals(name)){
            poly(canvas,4,9,4,4,9,4);poly(canvas,15,4,20,4,20,9);
            poly(canvas,4,15,4,20,9,20);poly(canvas,15,20,20,20,20,15);
        }else if("more".equals(name)){
            brush.setStyle(Paint.Style.FILL);
            canvas.drawCircle(5,12,1.65f,brush);canvas.drawCircle(12,12,1.65f,brush);
            canvas.drawCircle(19,12,1.65f,brush);
        }else if("close".equals(name)){
            line(canvas,5,5,19,19);line(canvas,19,5,5,19);
        }else if("back".equals(name)){
            poly(canvas,15,5,8,12,15,19);line(canvas,8,12,21,12);
        }else{
            rectangle(canvas,3,5,21,19);line(canvas,9,5,9,19);
        }
        canvas.restore();
    }
    @Override public void setAlpha(int alpha){brush.setAlpha(alpha);invalidateSelf();}
    @Override public void setColorFilter(ColorFilter filter){brush.setColorFilter(filter);invalidateSelf();}
    @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    @Override public int getIntrinsicWidth(){return 32;}
    @Override public int getIntrinsicHeight(){return 32;}
}