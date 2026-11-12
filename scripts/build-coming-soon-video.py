#!/usr/bin/env python3
"""Build AL EZZ TV's ORIGINAL offline coming-soon loop for web and Android TV."""
from pathlib import Path
import math, shutil, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
W,H,FPS,FRAMES=960,540,18,108

def font_path(*choices):
    for option in choices:
        if Path(option).is_file(): return option
    out=subprocess.check_output(["fc-match","-f","%{file}","Noto Sans Arabic"],text=True).strip()
    if not Path(out).is_file(): raise RuntimeError("Install fonts-noto-core before rendering")
    return out

arabic=font_path("/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf",
                 "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf")
brand=font_path("/usr/share/fonts/truetype/noto/NotoKufiArabic-ExtraBold.ttf",arabic)
english=font_path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",arabic)
fonts=[ImageFont.truetype(brand,61),ImageFont.truetype(arabic,27),
       ImageFont.truetype(arabic,21),ImageFont.truetype(brand,33),
       ImageFont.truetype(english,17)]
x,y=np.meshgrid(np.arange(W,dtype=np.float32),np.arange(H,dtype=np.float32))
glow=np.exp(-((x-730)**2/(380**2)+(y-245)**2/(250**2)))
base=np.zeros((H,W,3),dtype=np.uint8)
base[:,:,0]=np.clip(6+32*glow,0,255).astype(np.uint8)
base[:,:,1]=np.clip(7+3*glow,0,255).astype(np.uint8)
base[:,:,2]=np.clip(15+13*glow,0,255).astype(np.uint8)

target=ROOT/"web/assets/al_ezz_coming_soon.mp4"
target.parent.mkdir(parents=True,exist_ok=True)
command=[
    "ffmpeg","-hide_banner","-loglevel","error","-y",
    "-f","rawvideo","-vcodec","rawvideo","-s",f"{W}x{H}",
    "-pix_fmt","rgb24","-r",str(FPS),"-i","-","-an",
    "-c:v","libx264","-profile:v","baseline","-level","3.1",
    "-pix_fmt","yuv420p","-preset","veryfast","-crf","32",
    "-movflags","+faststart",str(target)
]
proc=subprocess.Popen(command,stdin=subprocess.PIPE)
for i in range(FRAMES):
    t=i/FPS
    im=Image.fromarray(base.copy(),"RGB").convert("RGBA")
    overlay=Image.new("RGBA",(W,H),(0,0,0,0))
    d=ImageDraw.Draw(overlay)
    for k in range(4):
        dx=int(10*math.sin(t*.7+k*.4))
        cx=720+dx
        d.arc((cx-190-k*23,77-k*23,cx+190+k*23,457+k*23),
              205+int(t*12),472+int(t*12),
              fill=(189,25,62,max(24,70-k*19)),width=2)
    d.ellipse((758,195,842,279),fill=(184,27,62,58))
    d.ellipse((771,208,829,266),outline=(247,87,114,210),width=2)
    d.polygon([(796,218),(796,256),(826,237)],fill=(255,225,231,240))
    scan=int(t/6*(W+200)-140)
    d.rounded_rectangle((scan,480,scan+80,482),radius=1,fill=(255,55,90,70))
    for k in range(6):
        xx=50+(k*157)%900; yy=70+(k*87)%410
        d.ellipse((xx,yy,xx+2,yy+2),fill=(255,120,140,int(48+30*math.sin(t+k))))
    im=Image.alpha_composite(im,overlay)
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((50,33,210,84),radius=17,fill=(20,16,29,237),outline=(145,40,67,160))
    d.text((197,38),"العز",font=fonts[3],anchor="ra",fill=(255,242,246),direction="rtl")
    d.text((86,57),"TV",font=fonts[4],fill=(255,242,246))
    d.text((605,177),"قريبًا على العز",font=fonts[0],anchor="ra",fill=(255,245,247),direction="rtl")
    d.rounded_rectangle((65,265,168,270),radius=2,fill=(246,48,81,240))
    d.text((605,297),"نعمل على توفير هذا المحتوى",font=fonts[1],anchor="ra",fill=(213,196,204),direction="rtl")
    d.text((605,349),"أفلام، مسلسلات، بث مباشر",font=fonts[2],anchor="ra",fill=(192,161,174),direction="rtl")
    d.text((62,491),"AL EZZ TV  /  COMING SOON",font=fonts[4],fill=(154,113,132))
    proc.stdin.write(im.convert("RGB").tobytes())
proc.stdin.close()
if proc.wait()!=0:raise RuntimeError("ffmpeg failed creating offline placeholder")
android=ROOT/"app/src/main/res/raw/al_ezz_coming_soon.mp4"
android.parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(target,android)
print(f"Generated {target.stat().st_size} bytes for web and Android TV")
