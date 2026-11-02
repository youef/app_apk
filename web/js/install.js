/* Al Ezz TV — install support for phones, tablets, laptops and TVs. */
(function(){
 "use strict";
 var installPrompt=null,guide=null,previousFocus=null;
 function $(id){return document.getElementById(id);}
 function standalone(){return !!((window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone);}
 function steps(){
   var ua=navigator.userAgent||"";
   if(/iPhone|iPad|iPod/i.test(ua))return "على iPhone أو iPad: افتح الموقع في Safari، واضغط زر المشاركة، ثم «إضافة إلى الشاشة الرئيسية» واختر «إضافة». بعدها شغّل العز TV من أيقونته.";
   if(/Android/i.test(ua))return "على Android: افتح الموقع في Chrome، ثم قائمة ⋮ واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية». بعض متصفحات Android TV لا تدعم التثبيت.";
   return "على الكمبيوتر: افتح الموقع في Chrome أو Edge واختر «تثبيت التطبيق» من شريط العنوان أو قائمة المتصفح. على التلفزيون يمكنك فتحه بمتصفح متوافق.";
 }
 function openGuide(){
   guide=$("installGuide");if(!guide)return;
   previousFocus=document.activeElement;
   $("installGuideSteps").textContent=steps();
   guide.hidden=false;document.body.classList.add("install-guide-open");
   var close=guide.querySelector("[data-dismiss-install]");if(close)close.focus();
 }
 function closeGuide(){
   guide=$("installGuide");if(!guide)return;
   guide.hidden=true;document.body.classList.remove("install-guide-open");
   if(previousFocus&&previousFocus.focus)previousFocus.focus();
 }
 function syncDock(){
   var name=((location.hash||"#/home").split("/")[1]||"home").split("?")[0];
   var links=document.querySelectorAll("[data-dock]");
   for(var i=0;i<links.length;i++){
     var on=links[i].getAttribute("data-dock")===name;
     links[i].classList.toggle("is-active",on);
     if(on)links[i].setAttribute("aria-current","page");
     else links[i].removeAttribute("aria-current");
   }
 }
 window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();installPrompt=e;});
 window.addEventListener("appinstalled",function(){installPrompt=null;closeGuide();});
 document.addEventListener("click",function(e){
   var t=e.target,install=t.closest&&t.closest("[data-install-app]");
   if(install){
     e.preventDefault();
     if(standalone()){openGuide();$("installGuideSteps").textContent="العز TV مثبّت بالفعل ويعمل بوضع التطبيق المستقل على هذا الجهاز.";return;}
     if(installPrompt){
       try{
         installPrompt.prompt();
         if(installPrompt.userChoice&&installPrompt.userChoice.then)
           installPrompt.userChoice.then(function(){installPrompt=null;});
         else installPrompt=null;
       }catch(err){openGuide();}
     }else openGuide();
     return;
   }
   if(t.closest&&t.closest("[data-dismiss-install]")){closeGuide();return;}
   if(t.closest&&t.closest("[data-app-search]")){
     e.preventDefault();var btn=$("searchBtn");if(btn)btn.click();
   }
 });
 document.addEventListener("keydown",function(e){if(e.key==="Escape"&&guide&&!guide.hidden){e.preventDefault();closeGuide();}});
 window.addEventListener("hashchange",syncDock);
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",syncDock);else syncDock();
 if("serviceWorker" in navigator&&location.protocol==="https:")
   window.addEventListener("load",function(){
     navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(function(){});
   });
})();
