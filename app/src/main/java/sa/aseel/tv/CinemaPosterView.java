package sa.aseel.tv;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.widget.ImageView;
/** Rounded poster artwork for API19+ screens. */
public final class CinemaPosterView extends ImageView {
    private final Path clip=new Path();
    private final RectF bounds=new RectF();
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float radius,stroke;
    public CinemaPosterView(Context context){super(context);
        float density=getResources().getDisplayMetrics().density;
        radius=14f*density;stroke=Math.max(1f,1.5f*density);
    }
    @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){
        super.onSizeChanged(w,h,oldw,oldh);
        bounds.set(0,0,w,h);clip.reset();clip.addRoundRect(bounds,radius,radius,Path.Direction.CW);
    }
    @Override protected void onDraw(Canvas canvas){
        int saved=canvas.save();canvas.clipPath(clip);super.onDraw(canvas);canvas.restoreToCount(saved);
        if(getWidth()<6||getHeight()<6)return;
        paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(stroke);
        paint.setColor(Color.argb(205,244,62,91));
        float in=stroke/2f+1f;
        canvas.drawRoundRect(new RectF(in,in,getWidth()-in,getHeight()-in),radius,radius,paint);
        paint.setStyle(Paint.Style.FILL);
    }
}
