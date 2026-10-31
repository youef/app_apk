"use strict";
(function(){
 const KEY="alezz-v8-browser-activated",FAIL="alezz-v8-browser-fail",UNTIL="alezz-v8-browser-until";
 const SALT="e42695223c465d0af575de49db015021",HASH="385035d1e0dbbf3941728251aa080e9180a218aeeaf510dbe6922bb64fb0d19f";
 const bytes=s=>Uint8Array.from(s.match(/../g),n=>parseInt(n,16));
 const get=k=>{try{return localStorage.getItem(k)}catch(_){return null}};
 const put=(k,v)=>{try{localStorage.setItem(k,v);return true}catch(_){return false}};
 let done;window.AL_EZZ_ACCESS={ready:new Promise(resolve=>done=resolve)};
 const success=()=>{document.getElementById("activationGate").hidden=true;document.body.classList.remove("viewer-locked");done()};
 async function valid(pin){
   if(!window.crypto?.subtle)throw Error("متصفحك لا يدعم التحقق الآمن.");
   const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),{name:"PBKDF2"},false,["deriveBits"]);
   const output=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:bytes(SALT),iterations:12000,hash:"SHA-1"},key,256));
   const original=bytes(HASH);let diff=0;for(let i=0;i<output.length;i++)diff|=output[i]^original[i];return diff===0;
 }
 function init(){
   if(get(KEY)==="ok"){success();return}
   const form=document.getElementById("activationForm"),input=document.getElementById("activationPin"),notice=document.getElementById("activationMessage"),button=form.querySelector("button");input.focus();
   form.onsubmit=async e=>{
     e.preventDefault();const until=Number(get(UNTIL)||0);
     if(until>Date.now()){notice.textContent="انتظر "+Math.ceil((until-Date.now())/1000)+" ثانية قبل المحاولة.";return}
     const code=input.value.trim();input.value="";
     if(!/^[0-9]{6}$/.test(code)){notice.textContent="رمز الدخول يجب أن يتكون من ستة أرقام.";return}
     button.disabled=true;
     try{
       if(await valid(code)){
         if(!put(KEY,"ok")){notice.textContent="تعذّر حفظ التفعيل في هذا المتصفح.";return}
         put(FAIL,"0");put(UNTIL,"0");success();return;
       }
       const n=Number(get(FAIL)||0)+1;put(FAIL,String(n));
       if(n>=5){const secs=Math.min(900,30*Math.pow(2,Math.min(4,Math.floor((n-5)/5))));
         put(UNTIL,String(Date.now()+secs*1000));notice.textContent="محاولات كثيرة. انتظر "+secs+" ثانية.";}
       else notice.textContent="رمز غير صحيح. متبقٍ "+(5-n)+" محاولات.";
     }catch(error){notice.textContent=error.message||"تعذر التحقق";}
     finally{button.disabled=false;input.focus();}
   };
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
