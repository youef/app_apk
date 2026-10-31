"use strict";
/* Aseel TV — standalone mobile-first website, public Supabase REST and Auth only.
   Never place service_role or other secret credentials in a client application. */
(function () {
 const cfg = window.ASEEL_WEB_CONFIG;
 const $ = id => document.getElementById(id);
 const MEDIA = ["movies","series","channels"];
 const state = { page: "home", query: "", category: "", kidsType:"all", kidsCountry:"", kidsLanguage:"", movies: [], series: [], channels: [],
   categories: [], favorites: new Set(), loading: true, error: "", chosen: null,
   token: "", refreshToken: "", userId: "", account: null, authMode: "login",
   playback: null, hls: null, progressTimer: 0, lastProgressAt: 0, heroIndex:0 };
 const labels = { movie: "فيلم", series: "مسلسل", channel: "قناة", episode: "حلقة" };
 let toastTimer = null;
 const storageKey = "aseel-web-favorites-v1";
 function store() {
   try { return JSON.parse(localStorage.getItem(storageKey) || "[]") || []; }
   catch (_) { return []; }
 }
 state.favorites = new Set(store());
 function key(type, item) { return type + ":" + item.id; }
 function saveFavorites() {
   try { localStorage.setItem(storageKey, JSON.stringify(Array.from(state.favorites))); } catch (_) {}
 }
 function safeUrl(v) {
   try { const u = new URL(String(v || "")); return u.protocol === "https:" ? u.href : ""; }
   catch (_) { return ""; }
 }
 function directStream(v) {
   const url=safeUrl(v);
   return url && /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url) ? url : "";
 }
 function playable(item, type) {
   if (!item || !directStream(item.stream_url)) return false;
   if (type === "channel" && item.playback_mode !== "stream") return false;
   return item.status === "published" && item.rights_status === "approved";
 }
 function el(tag, className, text) {
   const node = document.createElement(tag);
   if (className) node.className = className;
   if (text !== undefined) node.textContent = String(text);
   return node;
 }
 function announce(message) {
   const n = $("toast"); n.textContent = message;
   n.classList.add("visible"); clearTimeout(toastTimer);
   toastTimer = setTimeout(() => n.classList.remove("visible"), 4200);
 }
 function setHidden(id, hide) { $(id).hidden = !!hide; }
 async function api(table, query, options) {
   const endpoint = cfg.supabaseUrl + "/rest/v1/" + table + (query ? "?" + query : "");
   const h = { "apikey": cfg.publishableKey, "Accept":"application/json" };
   if (state.token) h.Authorization = "Bearer " + state.token;
   if (options && options.json) { h["Content-Type"]="application/json"; }
   if (options && options.prefer) h.Prefer = options.prefer;
   const request = await fetch(endpoint, { method: options?.method || "GET",
     headers: h, body: options?.json ? JSON.stringify(options.json) : undefined });
   if (!request.ok) {
     let msg = "تعذر تحميل البيانات (" + request.status + ")";
     try { const data = await request.json(); msg = data.message || data.error || msg; } catch (_) {}
     throw new Error(msg);
   }
   const content = await request.text();
   if (!content) return null;
   try { return JSON.parse(content); } catch (_) { return content; }
 }
 function authHeaders() {
   return { apikey: cfg.publishableKey, "Content-Type":"application/json" };
 }
 function persistSession(s) {
   state.token = s?.access_token || ""; state.refreshToken = s?.refresh_token || "";
   state.userId = s?.user?.id || "";
   state.account = s?.user || null;
   try { sessionStorage.setItem("aseel-web-session", JSON.stringify(s)); } catch (_) {}
   $("accountLabel").textContent = state.token ? "حسابي" : "دخول";
   $("authLogout").hidden = !state.token;
 }
 async function restoreSession() {
   let s = null;
   try { s = JSON.parse(sessionStorage.getItem("aseel-web-session") || "null"); } catch (_) {}
   if (!s || !s.access_token) return;
   persistSession(s);
   if (s.expires_at && s.expires_at * 1000 < Date.now()+60000 && s.refresh_token) {
     try {
       const response = await fetch(cfg.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", {
         method:"POST",headers:authHeaders(),body:JSON.stringify({refresh_token:s.refresh_token})
       });
       if (!response.ok) throw Error("session expired");
       const fresh = await response.json();
       persistSession(fresh); await syncFavorites();
     } catch (_) { persistSession(null); try {sessionStorage.removeItem("aseel-web-session")}catch(__){} }
   } else { await syncFavorites().catch(() => {}); }
 }
 async function syncFavorites() {
   if (!state.token || !state.userId) return;
   const records = await api("aseel_favorites","select=item_type,item_id&user_id=eq."+encodeURIComponent(state.userId)+"&limit=1000");
   (records || []).forEach(x => state.favorites.add(x.item_type+":"+x.item_id));
   saveFavorites(); draw();
 }
 async function load() {
   state.loading = true; draw();
   const q = "select=*&order=created_at.desc&limit=100";
   const results = await Promise.allSettled([
     api("aseel_movies", q),
     api("aseel_series", q),
     api("aseel_channels", q),
     api("aseel_categories", "select=id,name_ar,sort_order&order=sort_order.asc&limit=100")
   ]);
   const errors = [];
   ["movies","series","channels","categories"].forEach((field, index) => {
     if (results[index].status === "fulfilled") {
       const items = results[index].value || [];
       state[field] = field === "movies" ? items.filter(x => playable(x,"movie")) :
         field === "channels" ? items.filter(x => playable(x,"channel")) : items;
     }
     else { state[field] = []; errors.push(field); }
   });
   state.loading = false;
   state.error = errors.length ? "تعذّر الاتصال ببعض أقسام المكتبة. يمكنك إعادة المحاولة." : "";
   draw(); setHero();
   if (state.error) announce(state.error);
 }
 function collection(type) {
   return state[type === "movie" ? "movies" : type === "series" ? "series" : "channels"];
 }
 function itemCategory(item) {
   return state.categories.find(x => x.id === item.category_id)?.name_ar || "";
 }
 function makePoster(item, type) {
   const frame = el("div","poster-frame");
   const fallback = el("div","poster-fallback");
   fallback.append(el("span","logo-ghost","عز"), el("span","poster-word", type === "channel" ? "AL EZZ LIVE" : "AL EZZ CINEMA"));
   frame.append(fallback);
   const imgUrl = safeUrl(item.poster_url);
   if (imgUrl) {
     const img = el("img");
     img.loading = "lazy"; img.decoding="async"; img.alt = "";
     img.src = imgUrl; img.onerror = () => img.remove();
     frame.append(img);
   }
   const badge = el("span","poster-badge"+(type === "channel"?" live":""), type === "channel"?"● مباشر":item.quality || (type==="series"?"مسلسل":"فيلم"));
   frame.append(badge);
   frame.append(el("span","poster-play","▶"));
   return frame;
 }
 function makeCard(item, type) {
   const card = el("article","media-card");
   card.tabIndex=0; card.setAttribute("role","button");
   card.setAttribute("aria-label","تفاصيل "+item.title_ar);
   card.append(makePoster(item,type));
   const favorite = el("button","fav-control"+(state.favorites.has(key(type,item))?" is-fav":""),state.favorites.has(key(type,item))?"♥":"♡");
   favorite.type="button"; favorite.setAttribute("aria-label","إضافة أو إزالة من قائمتي");
   favorite.addEventListener("click", event => {
     event.stopPropagation(); toggleFavorite(item,type);
   });
   card.append(favorite);
   card.append(el("h4","media-title",item.title_ar));
   if(item.description){const d=el("p","card-description",item.description);card.append(d)}
   try {
     if(type!=="channel"){
       const progress=Number(localStorage.getItem(progressKey(type,item))||0);
       if(Number.isFinite(progress)&&progress>10){
         const line=el("div","watch-progress");line.setAttribute("aria-label","متابعة متاحة");
         const fill=el("span","");fill.style.width=Math.min(88,Math.max(8,progress/(Math.max(1,Number(item.duration_minutes)||60)*60)*100))+"%";line.append(fill);card.append(line);
       }
     }
   }catch(_){} 
   const meta = el("div","media-meta");
   meta.append(el("span","",item.release_year||itemCategory(item)||labels[type]));
   meta.append(el("span","meta-dot"));
   meta.append(el("span","",type==="channel"?"بث مباشر":(item.quality||"شاهد الآن")));
   card.append(meta);
   card.addEventListener("click",() => details(item,type));
   card.addEventListener("keydown",e => {
     if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); details(item,type); }
   });
   return card;
 }
 async function toggleFavorite(item,type) {
   const k = key(type,item);
   const add = !state.favorites.has(k);
   if (add) state.favorites.add(k); else state.favorites.delete(k);
   saveFavorites(); draw(); if(state.page==="home")setHero();
   announce(add ? "تمت الإضافة إلى قائمتي" : "تمت الإزالة من قائمتي");
   if (!state.token || !state.userId) return;
   try {
     if (add) await api("aseel_favorites",null,{
       method:"POST",json:{user_id:state.userId,item_type:type,item_id:item.id},prefer:"resolution=merge-duplicates,return=minimal"
     });
     else await api("aseel_favorites","user_id=eq."+encodeURIComponent(state.userId)+"&item_type=eq."+type+"&item_id=eq."+encodeURIComponent(item.id),{method:"DELETE"});
   } catch (_) { announce("حُفظت القائمة على هذا الجهاز، لكن تعذّرت مزامنتها مع حسابك"); }
 }
 function kidsMedia(){return [...state.movies,...state.series,...state.channels].filter(x=>x.is_kids===true)}
 function kidsFilters(){
   $("kidsFilters").hidden=state.page!=="kids";
   if(state.page!=="kids")return;
   const type=$("kidsTypeChips");type.replaceChildren();
   for(const [v,n] of [["all","الكل"],["movie","أفلام"],["series","مسلسلات"],["channel","قنوات مباشرة"]]){
     const b=el("button","chip"+(state.kidsType===v?" active":""),n);
     b.type="button";b.onclick=()=>{state.kidsType=v;draw()};type.append(b);
   }
   const items=kidsMedia(),countries={US:"أمريكا",TR:"تركيا",SA:"السعودية",AR:"الأرجنتين",GB:"بريطانيا",FR:"فرنسا",DE:"ألمانيا",ES:"إسبانيا",NL:"هولندا",IT:"إيطاليا"},langs={ar:"العربية",en:"الإنجليزية",tr:"التركية",es:"الإسبانية",fr:"الفرنسية",de:"الألمانية",und:"بدون حوار",ku:"الكردية",it:"الإيطالية"};
   for(const [id,field,stateKey,defaultLabel,dictionary] of [["kidsCountry","country_code","kidsCountry","كل الدول",countries],["kidsLanguage","language_code","kidsLanguage","كل اللغات",langs]]){
     const select=$(id),current=state[stateKey];select.replaceChildren();const all=el("option","",defaultLabel);all.value="";select.append(all);
     const codes=[...new Set(items.map(x=>x[field]).filter(Boolean))].sort();
     for(const c of codes){const o=el("option","",dictionary[c]||c);o.value=c;select.append(o)}
     state[stateKey]=codes.includes(current)?current:"";select.value=state[stateKey];
   }
 }
 function filtered(type) {
   let data = collection(type).slice();
   const term = state.query.toLocaleLowerCase("ar").trim();
   if (term) data=data.filter(x => [x.title_ar,x.title_original,x.description,itemCategory(x)].some(v=>String(v||"").toLocaleLowerCase("ar").includes(term)));
   if(state.page==="kids"){
     data=data.filter(x=>x.is_kids===true);
     if(state.kidsCountry)data=data.filter(x=>x.country_code===state.kidsCountry);
     if(state.kidsLanguage)data=data.filter(x=>(x.language_code||"und")===state.kidsLanguage);
   }
   if (state.category) data = data.filter(x => x.category_id===state.category);
   if (state.page==="favorites") data=data.filter(x=>state.favorites.has(key(type,x)));
   return data;
 }
 function empty(label, error) {
   const node = el("div","empty-state");
   node.append(el("span","empty-symbol",error?"⚠":"✧"));
   node.append(el("h3","",error?"لم نتمكن من تحميل المكتبة":"لا توجد "+label+" هنا حاليًا"));
   node.append(el("p","",error?"تحقق من اتصال الإنترنت ثم أعد المحاولة.":"قد لا تتوفر عناوين بهذا البحث أو التصنيف. جرّب اختيار جميع التصنيفات."));
   if (error) {
     const b=el("button","btn btn-outline","إعادة المحاولة");b.onclick=load;node.append(b);
   }
   return node;
 }
 function renderGrid(id,type,all) {
   const n=$(id);n.replaceChildren();
   n.classList.toggle("grid-view",!!all);n.classList.remove("skeleton-row");
   if (state.loading) { for (let i=0;i<(all?8:5);i++)n.append(el("div","skeleton"));return; }
   const data=filtered(type);
   if (!data.length) { n.append(empty(type==="movie"?"أفلام":type==="series"?"مسلسلات":"قنوات",state.error));return; }
   data.slice(0,all?200:12).forEach(x => n.append(makeCard(x,type)));
 }
 function categories() {
   const bar=$("categoryBar");bar.replaceChildren();
   const all=[{id:"",name_ar:"الكل"},...state.categories];
   all.forEach(x=>{
     const button=el("button","chip"+(state.category===x.id?" active":""),x.name_ar);
     button.onclick=()=>{state.category=x.id;draw()};
     bar.append(button);
   });
 }
 function drawContinue(){
   const section=$("continueSection"),box=$("continueGrid");
   section.hidden=state.page!=="home";box.replaceChildren();
   if(section.hidden)return;
   const recent=[];
   for(const [type,items] of [["movie",state.movies],["series",state.series]]){
     for(const item of items){
       try{
         if(Number(localStorage.getItem(progressKey(type,item))||0)>10)recent.push({item,type});
       }catch(_){}
     }
   }
   if(!recent.length){section.hidden=true;return;}
   recent.slice(0,12).forEach(x=>box.append(makeCard(x.item,x.type)));
 }
 function draw() {
   const route=state.page;
   setHidden("heroSection",route!=="home");
   $("discoveryBar").hidden=route!=="home";
   drawContinue();
   const items={home:["اكتشف عالم العز","مختارات سينمائية تستحق وقتك، كل يوم."],
     movies:["مكتبة الأفلام","اكتشف أفلامًا ومشاهد من مصادر موثّقة."],
     series:["عالم المسلسلات","تابع المواسم والحلقات، في مكان واحد."],
     channels:["البث المباشر","قنوات مجانية تعمل من المشغل مباشرة."],
     kids:["★ عالم الأطفال","أفلام كرتون ومسلسلات وقنوات أطفال مجانية ومباشرة؛ دون متصفح خارجي."],
     favorites:["قائمتي المفضلة","كل ما اخترته من الأفلام والمسلسلات والقنوات."],
     search:["نتائج البحث","ابحث في مكتبة العز عن المحتوى الذي تحبه."]};
   $("pageTitle").textContent=items[route][0];
   $("pageSubtitle").textContent=items[route][1];
   document.querySelectorAll("[data-route]").forEach(b=>b.classList.toggle("active",b.dataset.route===route));
   $("categoryBar").hidden=route==="kids";
   if(route!=="kids")categories();
   kidsFilters();
   const isKids=route==="kids",allKids=state.kidsType==="all";
   const display={movie:route==="home"||route==="movies"||route==="favorites"||route==="search"||(isKids&&(allKids||state.kidsType==="movie")),
     series:route==="home"||route==="series"||route==="favorites"||route==="search"||(isKids&&(allKids||state.kidsType==="series")),
     channel:route==="home"||route==="channels"||route==="favorites"||route==="search"||(isKids&&(allKids||state.kidsType==="channel"))};
   setHidden("movieSection",!display.movie);
   setHidden("seriesSection",!display.series);
   setHidden("channelSection",!display.channel);
   $("movieSection").querySelector("h3").textContent=isKids?"أفلام الأطفال والرسوم المتحركة":"أفلام تستحق المشاهدة";
   $("seriesSection").querySelector("h3").textContent=isKids?"مسلسلات ومغامرات الأطفال":"مسلسلات وحكايات";
   $("channelSection").querySelector("h3").textContent=isKids?"قنوات الأطفال المباشرة":"شاهد البث المباشر";
   renderGrid("movieGrid","movie",route!=="home");
   renderGrid("seriesGrid","series",route!=="home");
   renderGrid("channelGrid","channel",route!=="home");
   document.querySelectorAll(".section-more").forEach(b=>b.hidden=route!=="home");
 }
 function heroCandidates(){
   const all=[...state.movies.map(x=>({item:x,type:"movie"})),
              ...state.series.map(x=>({item:x,type:"series"})),
              ...state.channels.map(x=>({item:x,type:"channel"}))];
   return [...all.filter(x=>x.item.featured),...all.filter(x=>!x.item.featured)].slice(0,15);
 }
 function setHero(){
   if(state.loading)return;
   const picks=heroCandidates();
   if(!picks.length)return;
   state.heroIndex=(state.heroIndex+picks.length)%picks.length;
   const {item,type}=picks[state.heroIndex];
   const imageUrl=safeUrl(item.backdrop_url)||safeUrl(item.poster_url);
   $("heroBackdrop").style.backgroundImage=imageUrl?'url("'+imageUrl.replace(/"/g,"%22")+'")':"";
   $("heroContent").querySelector("h1").textContent=item.title_ar;
   $("heroContent").querySelector(".hero-description").textContent=
     (item.description||"شاهد أعمالاً مجانية ومرخّصة، من أي جهاز.") .slice(0,260);
   $("heroContent").querySelector(".hero-kicker-meta").textContent=
     type==="channel"?"ON AIR • LIVE":type==="series"?"SERIES • COLLECTION":"MOVIE • FEATURED";
   $("heroCount").textContent=(state.heroIndex+1)+" / "+picks.length;
   $("heroWatch").textContent=type==="series"?"▶ استعرض الحلقات":"▶ تشغيل الآن";
   $("heroWatch").onclick=()=>type==="series"?details(item,type):startPlayer(item,type);
   $("heroExplore").onclick=()=>details(item,type);
   const saved=state.favorites.has(key(type,item));
   $("heroFavorite").textContent=saved?"♥ في قائمتي":"＋ أضف لقائمتي";
   $("heroFavorite").onclick=()=>{toggleFavorite(item,type);setHero()};
   $("heroPrev").disabled=picks.length<2;
   $("heroNext").disabled=picks.length<2;
   $("heroPrev").onclick=()=>{state.heroIndex--;setHero()};
   $("heroNext").onclick=()=>{state.heroIndex++;setHero()};
 }
 function navigate(section,push) {
   state.page=["home","movies","series","channels","kids","favorites","search"].includes(section)?section:"home";
   if (state.page!=="search") {state.query="";$("searchInput").value="";$("headerSearchInput").value="";}
   state.category="";
   if (push!==false) {
     const u=new URL(location.href);
     if (state.page==="home") u.searchParams.delete("section"); else u.searchParams.set("section",state.page);
     u.searchParams.delete("type");u.searchParams.delete("id");
     history.pushState({},"",u.toString());
   }
   draw();window.scrollTo({top:0,behavior:"smooth"});
 }
 function modalOpen(id) { $(id).hidden=false;document.body.style.overflow="hidden"; }
 function modalClose(id) { $(id).hidden=true; if ($("modal").hidden&&$("authModal").hidden&&$("playerOverlay").hidden) document.body.style.overflow=""; }
 function detailButton(text,className,fn) { const b=el("button","btn "+className,text);b.onclick=fn;return b; }
 function details(item,type,push) {
   state.chosen={item,type};
   const body=$("modalBody");body.replaceChildren();
   const hero=el("div","detail-art");
   const pic=safeUrl(item.backdrop_url)||safeUrl(item.poster_url);
   if (pic) { const i=el("img");i.src=pic;i.alt="";i.onerror=()=>i.remove();hero.append(i); }
   body.append(hero);
   const data=el("div","detail-body");
   data.append(el("span","detail-sub",labels[type]+" • "+(item.release_year||item.quality||"مكتبة العز")));
   data.append(el("h2","",item.title_ar));
   if (item.description) data.append(el("p","detail-desc",item.description));
   const buttons=el("div","detail-buttons");
   if (type!=="series") buttons.append(detailButton(type==="channel"?"◉  شاهد الآن":"▶  تشغيل الآن","btn-primary",()=>startPlayer(item,type)));
   buttons.append(detailButton(state.favorites.has(key(type,item))?"♥  في قائمتي":"♡  أضف إلى قائمتي","btn-outline",()=>{toggleFavorite(item,type);modalClose("modal")}));
   data.append(buttons);
   if (type==="series") {
     const heading=el("h3","episodes-heading","المواسم والحلقات");
     const holder=el("div");holder.append(el("p","detail-desc","يتم تحميل الحلقات..."));
     data.append(heading,holder);
     loadEpisodes(item,holder);
   }
   const hint=el("p","detail-sub","تخضع المشاهدة لتوفر المصدر وحقوق البث.");
   hint.style.marginTop="20px";data.append(hint);body.append(data);
   modalOpen("modal");
   if (push!==false) {
     const url=new URL(location.href);
     url.searchParams.set("type",type);url.searchParams.set("id",item.id);
     history.replaceState({},"",url.toString());
   }
 }
 async function loadEpisodes(series,holder) {
   try {
     const seasons=await api("aseel_seasons","select=id,number,title_ar&series_id=eq."+encodeURIComponent(series.id)+"&order=number.asc");
     holder.replaceChildren();
     if (!seasons?.length) {holder.append(el("p","detail-desc","لم تُنشر حلقات لهذا المسلسل بعد."));return;}
     const picker=el("select","season-picker");
     picker.setAttribute("aria-label","اختر الموسم");
     seasons.forEach(s=>{const o=el("option","",s.title_ar||("الموسم "+s.number));o.value=s.id;picker.append(o)});
     holder.append(picker);
     const list=el("div");
     holder.append(list);
     const display=async()=>{
       list.replaceChildren(el("p","detail-desc","جارٍ تحميل الحلقات..."));
       const episodes=(await api("aseel_episodes","select=*&season_id=eq."+encodeURIComponent(picker.value)+"&order=number.asc&limit=100") || []).filter(x => playable(x,"episode"));
       list.replaceChildren();
       if (!episodes?.length) {list.append(el("p","detail-desc","لا توجد حلقات منشورة حاليًا."));return;}
       episodes.forEach(ep=>{
         const b=el("button","episode");
         b.append(el("span","",ep.number+". "+ep.title_ar));
         b.append(el("small","",ep.duration_minutes?ep.duration_minutes+" دقيقة":"▶ مشاهدة"));
         b.onclick=()=>startPlayer(ep,"episode");
         list.append(b);
       });
     };
     picker.addEventListener("change",()=>display().catch(e=>{announce(e.message)}));
     await display();
   } catch (e) {holder.replaceChildren(el("p","detail-desc","تعذر تحميل الحلقات: "+e.message));}
 }
 function setPlayerError(message,href) {
   $("playerErrorText").textContent=message||"تحقق من اتصال الإنترنت أو جرّب مصدرًا آخر.";
   $("playerError").hidden=false;
 }
 function stopPlayer() {
   if (state.hls) { try {state.hls.destroy()}catch(_){} state.hls=null; }
   const video=$("videoPlayer");
   video.pause();video.removeAttribute("src");video.removeAttribute("poster");video.load();
   $("playerError").hidden=true;
   state.playback=null;
   modalClose("playerOverlay");
 }
 async function startPlayer(item,type) {
   const url=directStream(item.stream_url);
   if (!url || (type==="channel" && item.playback_mode!=="stream")) {announce("لا يتوفر رابط تشغيل مباشر صالح لهذا المحتوى");return;}
   modalClose("modal");
   if (state.playback) stopPlayer();
   state.playback={item,type};
   $("playerTitle").textContent=item.title_ar;
   $("playerError").hidden=true;
   modalOpen("playerOverlay");
   const video=$("videoPlayer");
   const poster=safeUrl(item.poster_url);if(poster) video.poster=poster;
   const isHls=/\.m3u8(?:[?#]|$)/i.test(url);
   if (isHls && window.Hls && window.Hls.isSupported()) {
     state.hls=new window.Hls({maxBufferLength:30,maxMaxBufferLength:60});
     state.hls.loadSource(url);
     state.hls.attachMedia(video);
     state.hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{
       resumePlayback(item,type,video).then(()=>video.play().catch(()=>{}));
     });
     state.hls.on(window.Hls.Events.ERROR,(_event, data)=>{
       if (data.fatal) setPlayerError("البث غير متاح حاليًا. قد تكون هناك قيود على الشبكة أو تشغيل الفيديو.",url);
     });
   } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
     video.src=url;video.addEventListener("loadedmetadata",function onMeta(){
       video.removeEventListener("loadedmetadata",onMeta);
       resumePlayback(item,type,video).then(()=>video.play().catch(()=>{}));
     });
   } else if (isHls) {
     setPlayerError("هذا المتصفح لا يدعم بث HLS ولا تتوفر مكتبة التشغيل المساعدة.",safeUrl(item.official_url)||url);
   } else {
     video.src=url;video.addEventListener("loadedmetadata",function onMeta(){
       video.removeEventListener("loadedmetadata",onMeta);
       resumePlayback(item,type,video).then(()=>video.play().catch(()=>{}));
     });
   }
 }
 function progressKey(type,item) {return "aseel-progress-"+type+"-"+item.id;}
 async function resumePlayback(item,type,video) {
   if(type==="channel")return;
   let position=0;
   try {position=Number(localStorage.getItem(progressKey(type,item))||0)} catch (_) {}
   if (state.token && state.userId) {
     try {
       const rows=await api("aseel_watch_progress","select=position_ms&user_id=eq."+encodeURIComponent(state.userId)+"&item_type=eq."+type+"&item_id=eq."+encodeURIComponent(item.id)+"&limit=1");
       if(rows?.length)position=Math.max(position,Number(rows[0].position_ms||0)/1000);
     }catch(_){}
   }
   if(Number.isFinite(position)&&position>10&&video.duration&&position<video.duration-15)
     try {video.currentTime=position}catch(_){}
 }
 async function writeProgress() {
   const p=state.playback,v=$("videoPlayer");
   if(!p||p.type==="channel"||!Number.isFinite(v.currentTime)||v.currentTime<1)return;
   try{localStorage.setItem(progressKey(p.type,p.item),String(Math.floor(v.currentTime)))}catch(_){}
   const now=Date.now();
   if(!state.token||!state.userId||now-state.lastProgressAt<20000)return;
   state.lastProgressAt=now;
   try {
     await api("aseel_watch_progress",null,{method:"POST",prefer:"resolution=merge-duplicates,return=minimal",
       json:{user_id:state.userId,item_type:p.type,item_id:p.item.id,position_ms:Math.round(v.currentTime*1000),
         duration_ms:Number.isFinite(v.duration)?Math.round(v.duration*1000):0}});
   }catch(_){}
 }
 function openAuth() {
   if (/(^|\.)githack\.com$/.test(location.hostname) || location.hostname === "htmlpreview.github.io") {
     announce("تسجيل الدخول معطّل على نطاق المعاينة غير الرسمي. استخدم موقعك الرسمي بعد تفعيل الاستضافة.");
     return;
   }
   $("authMessage").textContent="";
   $("authEmail").value=state.account?.email||"";
   $("authPassword").value="";
   setAuthMode("login");
   $("authForm").hidden=!!state.token;
   $("authLogout").hidden=!state.token;
   $("authDescription").textContent=state.token?"حسابك متصل. تتم مزامنة قائمتك وتقدم المشاهدة.":"سجّل الدخول لحفظ قائمتك ومتابعة تقدم المشاهدة بين الأجهزة.";
   modalOpen("authModal");
 }
 function setAuthMode(mode) {
   state.authMode=mode;
   $("authHeading").textContent=mode==="login"?"مرحبًا بك في العز":"أنشئ حسابك في العز";
   $("authSubmit").textContent=mode==="login"?"تسجيل الدخول":"إنشاء حساب";
   $("authSwitch").textContent=mode==="login"?"ليس لديك حساب؟ أنشئ حسابًا":"لديك حساب بالفعل؟ سجّل الدخول";
 }
 async function handleAuth(e) {
   e.preventDefault();
   const email=$("authEmail").value.trim(),password=$("authPassword").value;
   $("authSubmit").disabled=true;$("authMessage").textContent="";
   try {
     const signUp=state.authMode==="signup";
     const endpoint=signUp ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
     const response=await fetch(cfg.supabaseUrl+endpoint,{method:"POST",headers:authHeaders(),body:JSON.stringify({email,password})});
     const data=await response.json();
     if(!response.ok)throw Error(data.error_description||data.msg||data.error||"تعذر إكمال العملية");
     if(signUp&&!data.access_token){
       $("authMessage").textContent="تم إنشاء الطلب. راجع بريدك لتأكيد الحساب ثم سجل الدخول.";
       setAuthMode("login"); return;
     }
     if(!data.access_token||!data.user?.id)throw Error("تعذر تأكيد تسجيل الدخول");
     if(data.expires_in&&!data.expires_at)data.expires_at=Math.floor(Date.now()/1000)+Number(data.expires_in);
     persistSession(data);await syncFavorites().catch(()=>{});
     modalClose("authModal");announce("أهلًا بعودتك إلى العز");
   }catch(error){$("authMessage").textContent=error.message||"تعذرت العملية";}
   finally{$("authSubmit").disabled=false;}
 }
 function logout() {
   const token=state.token;
   persistSession(null);
   try {sessionStorage.removeItem("aseel-web-session")}catch(_){}
   if(token) fetch(cfg.supabaseUrl+"/auth/v1/logout",{
     method:"POST",headers:{...authHeaders(),Authorization:"Bearer "+token}
   }).catch(()=>{});
   modalClose("authModal");announce("تم تسجيل الخروج");
 }
 function init() {
   $("year").textContent=String(new Date().getFullYear());
   document.addEventListener("click", e => {
     const route=e.target.closest("[data-route]");
     if(route) {e.preventDefault();navigate(route.dataset.route);}
     if(e.target.matches("[data-close-modal]")){modalClose("modal");}
     if(e.target.matches("[data-close-auth]")){modalClose("authModal");}
   });
   $("searchToggle").onclick=()=>{setHidden("searchPanel",false);$("searchInput").focus()};
   $("headerSearchInput").oninput=e=>{
     state.query=e.target.value.trim();$("searchInput").value=state.query;
     state.page="search";state.category="";draw();
   };
   $("searchClose").onclick=()=>{setHidden("searchPanel",true);$("searchInput").value="";state.query="";navigate("home")};
   $("searchInput").oninput=e=>{
     state.query=e.target.value.trim();$("headerSearchInput").value=state.query;
     state.page="search";state.category="";
     draw();
   };
   $("accountButton").onclick=openAuth;
   $("authClose").onclick=()=>modalClose("authModal");
   $("modalClose").onclick=()=>modalClose("modal");
   $("authSwitch").onclick=()=>{setAuthMode(state.authMode==="login"?"signup":"login");$("authMessage").textContent=""};
   $("authForm").onsubmit=handleAuth;
   $("authLogout").onclick=logout;
   $("playerBack").onclick=stopPlayer;
   $("kidsCountry").onchange=e=>{state.kidsCountry=e.target.value;draw()};
   $("kidsLanguage").onchange=e=>{state.kidsLanguage=e.target.value;draw()};
   $("videoPlayer").addEventListener("error",()=>{
     if(!state.playback)return;
     setPlayerError("تعذّر التشغيل: الرابط قد يكون غير متاح، أو هناك قيود ترميز أو حظر وصول من المتصفح.",safeUrl(state.playback.item.official_url)||state.playback.item.stream_url);
   });
   $("videoPlayer").addEventListener("timeupdate",()=>{writeProgress().catch(()=>{})});
   $("videoPlayer").addEventListener("pause",()=>{writeProgress().catch(()=>{})});
   document.addEventListener("keydown",e=>{
     if(e.key!=="Escape")return;
     if(!$("playerOverlay").hidden)stopPlayer();
     else if(!$("authModal").hidden)modalClose("authModal");
     else if(!$("modal").hidden)modalClose("modal");
   });
   window.addEventListener("pagehide",()=>{writeProgress().catch(()=>{})});
   window.addEventListener("popstate",()=>{
     const params=new URLSearchParams(location.search);
     state.page=params.get("section")||"home";
     if(!["home","movies","series","channels","kids","favorites","search"].includes(state.page))state.page="home";
     draw();
   });
   const params=new URLSearchParams(location.search);
   state.page=params.get("section")||"home";
   if(!["home","movies","series","channels","kids","favorites","search"].includes(state.page))state.page="home";
   draw();
   restoreSession().then(load).then(()=>{
     const t=params.get("type"),id=params.get("id");
     if(["movie","series","channel"].includes(t)&&id){
       const candidate=collection(t).find(x=>x.id===id);
       if(candidate)details(candidate,t,false);
     }
   }).catch(error=>{state.loading=false;state.error=error.message;draw();announce("تعذر تحميل المنصة، أعد تحديث الصفحة")});
 }
 if(!cfg||!cfg.supabaseUrl||!cfg.publishableKey){
   document.addEventListener("DOMContentLoaded",()=>{
     $("catalogArea").textContent="إعداد الاتصال بمكتبة العز غير مكتمل.";
   });
 } else {
   if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
   else init();
 }
})();