#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=name=>fs.readFileSync(name,"utf8");
const home=read("app/src/main/java/sa/aseel/tv/TVHomeActivity.java");
const api=read("app/src/main/java/sa/aseel/tv/CatalogApi.java");
const updater=read("app/src/main/java/sa/aseel/tv/AppUpdater.java");
const config=read("app/src/main/java/sa/aseel/tv/AppConfig.java");
const manifest=read("app/src/main/AndroidManifest.xml");
const nativeCategory=read("app/src/main/java/sa/aseel/tv/ChannelGuideCategory.java");
const feed=JSON.parse(read("data/android-update.json"));
assert.ok(config.includes("MAX_ITEMS = 3000"),"all-content cap should grow beyond 80");
assert.ok(api.includes("public JSONArray listPaged("),"paged API available");
assert.ok(api.includes("if(raw.length()<size)break;"),"pagination tests raw length, not filtered length");
assert.ok(home.includes('catalog.listPaged("aseel_movies"'),"movies loaded from Supabase");
assert.ok(home.includes('catalog.listPaged("aseel_series"'),"series loaded from Supabase");
assert.ok(home.includes('catalog.listPaged("aseel_channels"'),"channels loaded from Supabase");
assert.ok(!home.includes("order=created_at.desc&limit=80"),"no fixed 80-item ceilings");
assert.ok(home.includes("libraryHeartbeat"),"active app refreshes catalog");
assert.ok(home.includes("2L*60L*1000L"),"refresh interval 2 minutes");
assert.ok(home.includes('shelf(label+" "+genre[1]'),"genre shelves");
assert.ok(home.includes('shelf(label+" "+genreLabel(tag)'),"new genres automatically get their own shelves");
assert.ok(home.includes('all.setTag("shelf:all:"+name)'),"every non-empty shelf has View All");
assert.ok(home.includes('ArrayList<JSONObject> matches=filteredBrowseItems()'),"View All opens scoped list");
assert.ok(home.includes('categoryDirectory("movie")'),"movie entry is a square category directory");
assert.ok(home.includes('categoryDirectory("series")'),"series entry is a square category directory");
assert.ok(home.includes('categoryDirectory("channel")'),"channel entry is a square category directory");
const directory=read("app/src/main/java/sa/aseel/tv/TvCategoryDirectory.java");
assert.ok(directory.includes('new Tile("all","الكل","guide")'),"All is the first tile");
assert.ok(directory.includes('categoryName(item)'),"database-linked category names contribute");
assert.ok(directory.includes('for(String field:new String[]{"genre_tags","auto_tags"})'),"new genre tags contribute");
assert.ok(directory.includes('ChannelGuideCategory.broadcaster(item)'),"network tiles for channels");
assert.ok(home.includes('browseMode="directory"')&&
    home.includes('TvCategoryDirectory.filter(source,browseKind,browseKey)'),
    "category click navigates to linked filtered titles");
assert.ok(home.includes('if("channel".equals(browseKind))channelBrowse('),
    "channels open the native playable channel list");
assert.ok(home.includes("goTo(browseOrigin)")&&home.includes("restorePosition(browseOriginFocus,browseOriginScroll)"),
    "back button returns to category directory");
assert.ok(home.includes('cardGridLimit+72'),"large lists progressively render");
assert.ok(home.includes("CatalogApi.officialChannelLink(external)")&&api.includes("officialChannelLink(external)"),
    "official outbound channels no longer discarded");
assert.ok(nativeCategory.includes('category.contains("قنوات روتانا")'),"Rotana entries grouped by network");
assert.ok(home.includes("appUpdater.check(true)"),"settings update button wired");
assert.ok(home.includes('all.setTag("live:all")'),"live categories have View All");
assert.ok(home.includes("appUpdater.check(false)"),"signed update checks repeat while app remains open");
assert.ok(updater.includes("30L*60L*1000L"),"background version checks every 30 minutes");
assert.ok(updater.includes("snoozed_version"),"Later button suppresses repeated popups");
assert.ok(updater.includes("MessageDigest.getInstance(\"SHA-256\")"),"APK digest verification");
assert.ok(updater.includes("PackageManager.GET_SIGNATURES"),"existing signature validated");
assert.ok(updater.includes("getPackageArchiveInfo"),"download package identity checked");
assert.ok(updater.includes("canRequestPackageInstalls"),"Android permission requested");
assert.ok(updater.includes("Intent.ACTION_VIEW"),"Android installer opened after consent");
assert.ok(manifest.includes("android.permission.REQUEST_INSTALL_PACKAGES"),"update install permission declared");
assert.equal(feed.channel,"stable");
assert.equal(feed.package_name,"sa.alezz.tv");
console.log("PASS: native live catalog, dynamic genres, View All, signed update flow configured");
