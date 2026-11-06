/* Al Ezz TV — keep open browser players behind active customer entitlement.
 * Backend is authoritative; the player is left immediately after a 401/403.
 * Polling errors while offline are retried, never confused with an expiry.
 */
(function(){
  "use strict";
  if(!window.ALEZZ_MEMBER_CONTEXT || window.ALEZZ_MEMBER_CONTEXT.authenticated !== true) return;
  var active=true;
  var pending=false;
  function check(){
    if(!active||pending||typeof window.fetch!=="function")return;
    pending=true;
    window.fetch("/account/status",{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error"})
      .then(function(response){
        if(response.status===401||response.status===403){
          active=false;
          window.location.replace("/account/login?expired=1");
        }
      })
      .catch(function(){ /* Offline: retry on next heartbeat. */ })
      .then(function(){pending=false;});
  }
  check();
  window.setInterval(check,45000);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)check();});
  window.addEventListener("focus",check);
})();
