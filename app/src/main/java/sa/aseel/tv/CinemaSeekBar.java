package sa.aseel.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

/** Lightweight neon timeline with rounded track, playhead and D-pad-safe touch seeking. */
public final class CinemaSeekBar extends View {
    public interface OnSeek { void seekTo(long positionMs); }
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF track=new RectF();
    private final float density;
    private long positionMs=0L,durationMs=0L;
    private boolean live=false;
    private OnSeek listener;
    public CinemaSeekBar(Context context){super(context);
        density=getResources().getDisplayMetrics().density;
        setMinimumHeight((int)(20*density));setContentDescription("شريط تقدم أحمر متوهج");
    }
    public void setOnSeek(OnSeek callback){listener=callback;}
    public void setProgress(long position,long duration,boolean isLive){
        live=isLive;positionMs=Math.max(0L,position);
        durationMs=Math.max(0L,duration);invalidate();
    }
    @Override protected void onDraw(Canvas canvas){
        super.onDraw(canvas);
        float left=8*density,right=getWidth()-8*density;
        float center=getHeight()/2f;
        float thick=5*density;
        if(right<=left)return;
        track.set(left,center-thick/2,right,center+thick/2);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(0x7F6D6471);
        canvas.drawRoundRect(track,thick,thick,paint);
        float portion=live?1f:durationMs>0?
            Math.min(1f,positionMs/(float)durationMs):0f;
        float end=left+(right-left)*portion;
        if(portion>0f){
            paint.setColor(0x30FF3455);
            canvas.drawRoundRect(new RectF(left,center-6*density,end,center+6*density),
                6*density,6*density,paint);
            paint.setColor(0x80FF3E59);
            canvas.drawRoundRect(new RectF(left,center-4*density,end,center+4*density),
                4*density,4*density,paint);
            paint.setColor(0xFFFF4965);
            canvas.drawRoundRect(new RectF(left,center-thick/2,end,center+thick/2),
                thick,thick,paint);
        }
        if(!live&&durationMs>0){
            paint.setColor(0x60FF486B);
            canvas.drawCircle(end,center,8*density,paint);
            paint.setColor(0xFFFFD7DE);
            canvas.drawCircle(end,center,4.5f*density,paint);
        }
    }
    @Override public boolean onTouchEvent(MotionEvent event){
        if(live||durationMs<=0||listener==null)return false;
        if(event.getAction()==MotionEvent.ACTION_DOWN||
           event.getAction()==MotionEvent.ACTION_MOVE||
           event.getAction()==MotionEvent.ACTION_UP){
            float left=8*density,width=Math.max(1f,getWidth()-16*density);
            float f=Math.max(0f,Math.min(1f,(event.getX()-left)/width));
            if(event.getAction()==MotionEvent.ACTION_UP){
                listener.seekTo((long)(durationMs*f));
                performClick();
            }
            return true;
        }
        return super.onTouchEvent(event);
    }
    @Override public boolean performClick(){super.performClick();return true;}
}
