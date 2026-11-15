/* Al Ezz TV customer authentication. Never stores passwords or admin secrets. */
(function () {
  "use strict";
  var API = "https://app-apk-oquy.onrender.com/customer-auth/";
  var SB = window.ALEZZ_CONFIG.supabaseUrl.replace(/\/+$/, "");
  var KEY = window.ALEZZ_CONFIG.publishableKey;
  var STORE_KEY = "alezz.customer.session.v1";
  var session = null, verified = false, pending = null;

  function saved() {
    try { var x = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      return x && x.access_token && x.refresh_token ? x : null;
    } catch (_) { return null; }
  }
  function save(x) {
    session = x;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(x)); } catch (_) {}
  }
  function clear() {
    session = null; verified = false;
    try { localStorage.removeItem(STORE_KEY); } catch (_) {}
  }
  function request(url, body, token) {
    var headers = {"Content-Type":"application/json"};
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(url, {method:"POST",headers:headers,cache:"no-store",
      body:JSON.stringify(body || {})}).then(function(response) {
        return response.json().catch(function(){return {};}).then(function(data){
          if(!response.ok) throw new Error(data.error || "تعذر إكمال العملية");
          return data;
        });
      });
  }
  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(new Error("انتهت الجلسة"));
    return fetch(SB + "/auth/v1/token?grant_type=refresh_token", {
      method:"POST",cache:"no-store",
      headers:{"Content-Type":"application/json","apikey":KEY},
      body:JSON.stringify({refresh_token:session.refresh_token})
    }).then(function(r){
      if(!r.ok)throw new Error("انتهت جلسة الدخول");
      return r.json();
    }).then(function(r){
      if(!r.access_token || !r.refresh_token)throw new Error("انتهت الجلسة");
      save({access_token:r.access_token,refresh_token:r.refresh_token,
        user_id:session.user_id,username:session.username,
        expires_at:Date.now()+(Number(r.expires_in)||3600)*1000});
    });
  }
  function restore() {
    if (pending) return pending;
    session = saved(); verified = false;
    if (!session) return Promise.resolve(false);
    pending = Promise.resolve()
      .then(function(){
        if (Date.now() >= Number(session.expires_at || 0)-90000)return refresh();
      })
      .then(function(){
        return request(API+"session",{action:"session"},session.access_token);
      })
      .then(function(data){
        if(!data.ok || data.user_id !== session.user_id)throw new Error("انتهت الجلسة");
        session.username=data.username;
        save(session);verified=true;return true;
      })
      .catch(function(){verified=false;return false;})
      .then(function(valid){pending=null;return valid;});
    return pending;
  }
  function login(username,password) {
    verified=false;
    return request(API+"login",{username:username,password:password}).then(function(data){
      if (!data.access_token || !data.refresh_token || !data.user_id)throw new Error("تعذّر توثيق الحساب");
      save({access_token:data.access_token,refresh_token:data.refresh_token,
        username:data.username,user_id:data.user_id,
        expires_at:Date.now()+(Number(data.expires_in)||3600)*1000});
      verified=true;return data;
    });
  }
  function logout() {
    var token=session && session.access_token;
    clear();
    if(token)fetch(SB+"/auth/v1/logout",{
      method:"POST",headers:{"apikey":KEY,"Authorization":"Bearer "+token}
    }).catch(function(){});
    window.location.replace("./#/home");
    window.location.reload();
  }
  window.AlezzCustomerAuth = {
    login:login,restore:restore,logout:logout,
    isAuthenticated:function(){return verified && !!session;},
    getUserId:function(){return session && session.user_id || "";},
    getUsername:function(){return session && session.username || "";}
  };
  window.setInterval(function(){
    if(!verified)return;
    restore().then(function(ok){if(!ok){clear();window.location.reload();}});
  },15*60*1000);
})();
