/* Al Ezz TV — keep open browser players behind active customer entitlement.
 * Backend is authoritative; the player is left immediately after a 401/403.
 * Polling errors while offline are retried, never confused with an expiry.
 */
(function(){
  "use strict";
  if(!window.ALEZZ_MEMBER_CONTEXT || window.ALEZZ_MEMBER_CONTEXT.authenticated !== true) return;
  var active=true;
  var pending=false;
  function notify(data){
    var box=document.getElementById("subscriptionNotice");
    var days=data&&data.remaining_days;
    if(!data||!data.warning||typeof days!=="number"||days<1||days>7){
      if(box)box.hidden=true;
      return;
    }
    if(!box){
      box=document.createElement("aside");
      box.id="subscriptionNotice";
      box.className="subscription-notice";
      box.setAttribute("role","status");
      box.setAttribute("aria-live","polite");
      var top=document.querySelector("header.topbar");
      if(top&&top.parentNode)top.parentNode.insertBefore(box,top.nextSibling);
      else document.body.insertBefore(box,document.body.firstChild);
    }
    box.hidden=false;
    box.className="subscription-notice"+(days<=1?" subscription-notice--urgent":"");
    box.textContent="⏳ تنبيه الاشتراك: متبقٍ "+days+" يوم"+(days===1?"":"ًا")+
      " حتى انتهاء الصلاحية"+(data.expires_on?" ("+data.expires_on+")":"")+
      ". تواصل مع الإدارة للتجديد قبل الانتهاء.";
  }
  function check(){
    if(!active||pending||typeof window.fetch!=="function")return;
    pending=true;
    window.fetch("/account/status",{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error"})
      .then(function(response){
        if(response.status===401||response.status===403){
          active=false;
          window.location.replace("/account/login?expired=1");
          return null;
        }
        if(!response.ok)return null;
        return response.json();
      })
      .then(function(status){if(status&&active)notify(status);})
      .catch(function(){ /* Offline: retry on next heartbeat. */ })
      .then(function(){pending=false;});
  }
  check();
  window.setInterval(check,45000);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)check();});
  window.addEventListener("focus",check);
})();
