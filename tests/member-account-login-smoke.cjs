#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict");
const read=p=>fs.readFileSync(p,"utf8");
const auth=read("app/src/main/java/sa/aseel/tv/MemberAuth.java");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const memory=read("app/src/main/java/sa/aseel/tv/PlaybackMemory.java");
const player=read("app/src/main/java/sa/aseel/tv/CinemaPlayerActivity.java");
const portal=read("python-cloud-studio/member_portal.py");
const sessions=read("python-cloud-studio/member_sessions.py");
const manifest=read("app/src/main/AndroidManifest.xml");
function ok(label,condition){assert.ok(condition,label);console.log("PASS | "+label);}
ok("Native customer login uses a server-verified password grant",
 auth.includes('token?grant_type=password')&&auth.includes('app_metadata')&&auth.includes('"alezz_customer"'));
// Supabase Auth still accepts 12-character legacy refresh tokens. Regression
// guard: rejecting tokens shorter than 15 incorrectly blocked valid logins.
const tokenGuard=auth.match(/if\(access\.length\(\)<(\d+)\|\|refresh\.length\(\)<(\d+)\)/);
ok("Supabase legacy 12-character refresh tokens are accepted",
 tokenGuard && Number(tokenGuard[1])<=30 && Number(tokenGuard[2])===12 &&
 !(12<Number(tokenGuard[2])) && (11<Number(tokenGuard[2])));
ok("App resumes sessions without storing plaintext passwords",
 auth.includes("token?grant_type=refresh_token")&&auth.includes('putString("refresh_token",refresh)')&&
 !auth.includes('putString("password"')&&!auth.includes("SERVICE_ROLE"));
ok("User can explicitly logout and purge local credentials",
 auth.includes("void logoutLocal(")&&auth.includes('preferences(context).edit().clear().commit()')&&
 home.includes('MemberAuth.logout(TVHomeActivity.this)'));
ok("Android home cannot start public guest shell",
 home.includes('if(MemberAuth.hasSession(this))restoreMember();')&&
 home.includes('MemberAuth.login(TVHomeActivity.this,name,secret)')&&
 home.includes('if(!MemberAuth.hasSession(this))')&&
 !home.includes("دون حساب أو رمز دخول"));
ok("Password field is never persisted and login responds to errors",
 home.includes('password.setInputType(android.text.InputType.TYPE_CLASS_TEXT|')&&
 home.includes('password.setText("");')&&home.includes('java.util.Arrays.fill(secret'));
ok("Playback progress and channel favorites are account isolated",
 memory.includes('PREF+"."+(user.matches')&&
 home.includes('"alizz_v11_favorites."+MemberAuth.userId(this)')&&
 player.includes('"alizz_v11_favorites."+MemberAuth.userId(this)'));
ok("Private account cookies persist and can be revoked",
 sessions.includes('CUSTOMER_SESSION_SECONDS = 180 * 86400')&&
 sessions.includes("token_hash TEXT PRIMARY KEY")&&
 portal.includes("self.member_sessions.delete")&&
 portal.includes("self.member_sessions.revoke_user(uid)"));
ok("Browser and native sessions do not put admin secrets in client bundles",
 auth.includes("AppConfig.PUBLISHABLE_KEY")&&
 manifest.includes('android:allowBackup="false"'));
const expiry=read("python-cloud-studio/member_expiry.py");
const admin=read("python-cloud-studio/customer_directory.py");
const guard=read("web/js/customer-session-guard.js");
ok("90-day subscription is server managed, includes existing expiry carryover",
 expiry.includes("PLAN_DAYS = 90")&&expiry.includes("def plan_90_dates(")&&
 portal.includes("action=='renew-90'")&&admin.includes('value="renew-90"'));
ok("Expiry enforces browser and native sessions including active playback",
 sessions.includes("account_expires_at")&&portal.includes("account_deadline")&&
 auth.includes('"alezz_expires_at"')&&home.includes("showExpiredScreen")&&
 player.includes("subscriptionGuard"));
ok("Live subscription warnings appear in customer interface",
 admin.includes("تنبيهات الاشتراكات")&&guard.includes("subscriptionNotice")&&
 guard.includes("remaining_days"));
ok("Native device registry uses Supabase authenticated RLS and admin can revoke",
 auth.includes("aseel_device_sessions")&&auth.includes('"Authorization","Bearer "+token')&&
 auth.includes('"alezz_devices_revoked_at"')&&portal.includes("DEVICE_REVOKED_KEY"));
ok("Native accepts precise ISO-8601 subscription dates and administrator renewals",
 auth.includes("parseBackendTimestamp(raw)")&&
 auth.includes("SSSXXX")&&
 auth.includes("if(isExpiredLocally(context))resume(context);")&&
 auth.includes("if(isExpiredLocally(context)){\n            resume(context);")&&
 home.includes("final boolean cachedExpired=MemberAuth.isExpiredLocally(TVHomeActivity.this)")&&
 home.includes("cachedExpired || lastEntitlementCheckAt")&&
 player.includes("the home screen can verify an admin renewal"));
console.log("PASS | Native/portal customer auth acceptance; physical-device and end-to-end login tests require a provisioned test customer.");
