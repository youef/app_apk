/* AL EZZ TV — independent kids world. Approved direct MP4/HLS only. ES5. */
(function(w){
"use strict";
var Store=w.AlezzStore, Player=w.AlezzPlayer;
var catalog=null, refresh=null, watching=false, lastTick=0, chosen="all", term="";
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function get(k,d){return Store.pref("kids_"+k,d);}
function put(k,v){Store.setPref("kids_"+k,v);}
function profiles(){var a=get("profiles",[]);return Array.isArray(a)?a:[];}
function active(){var id=get("active","");return profiles().filter(function(p){return p.id===id;})[0]||null;}
function dateKey(){var d=new Date();return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}
function used(id){var x=get("usage",{})[id];return x&&x.date===dateKey()?Math.max(0,Number(x.seconds)||0):0;}
function remaining(){var p=active();return p?Math.max(0,p.minutes*60-used(p.id)):0;}
function update(){if(refresh&&location.hash.indexOf("#/kids")===0)refresh();}
function notify(text){if(w.Alezz&&w.Alezz.toast)w.Alezz.toast(text);}
function create(name,age,minutes){
 name=String(name||"").trim().slice(0,25);age=Number(age);minutes=Number(minutes);
 if(name.length<2)throw Error("اكتب اسم الطفل (حرفان على الأقل).");
 if([3,6,9,12].indexOf(age)<0||[15,30,45,60,90,120].indexOf(minutes)<0)throw Error("العمر أو المدة غير صالحة.");
 var list=profiles();if(list.length>=4)throw Error("الحد الأقصى أربعة ملفات أطفال.");
 var id="kid_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6);
 list.push({id:id,name:name,age:age,minutes:minutes,autoNext:true});
 put("profiles",list);put("active",id);watching=false;update();return id;
}
function choose(id){
 if(!profiles().some(function(p){return p.id===id;}))return false;
 if(Player.isOpen())Player.close();
 put("active",id);watching=false;lastTick=0;update();return true;
}
function settings(minutes,auto){
 minutes=Number(minutes);if([15,30,45,60,90,120].indexOf(minutes)<0)return false;
 var p=active();if(!p)return false;
 var list=profiles();list.forEach(function(row){if(row.id===p.id){row.minutes=minutes;row.autoNext=!!auto;}});
 put("profiles",list);update();return true;
}
function removeProfile(){
 var p=active();if(!p)return;
 if(Player.isOpen())Player.close();
 var list=profiles().filter(function(x){return x.id!==p.id;});
 put("profiles",list);put("active",list.length?list[0].id:"");watching=false;update();
}
function ratingAge(value){
 var x=String(value||"").toLowerCase().replace(/[\s_]+/g,"-");
 if(["all","g","tv-y","tv-g","0","3","3+"].indexOf(x)>=0)return 0;
 if(["6","6+"].indexOf(x)>=0)return 6;
 if(["7","7+","tv-y7","pg"].indexOf(x)>=0)return 7;
 if(["9","9+"].indexOf(x)>=0)return 9;
 if(["10","10+","12","12+","tv-pg"].indexOf(x)>=0)return 12;
 if(["pg-13","13+","tv-14","16","16+","r","18","18+","tv-ma"].indexOf(x)>=0)return 18;
 return 99;
}
function direct(url){return /^https:\/\/[^\s?#]+\.(?:mp4|m3u8)(?:[?#]|$)/i.test(String(url||""));}
function playable(item){
 if(!item||item.youtubeId)return false;
 return direct(item.stream)||(item.variants||[]).some(function(x){return direct(x.url);});
}
function episodes(series){
 var all=[];(series.seasons||[]).forEach(function(season){
  (season.episodes||[]).forEach(function(ep){
   if(ep.rightsStatus==="approved"&&playable(ep))all.push(ep);
  });
 });return all;
}
function approved(item,age){
 if(!item||!item.kids||item.kind==="youtube"||!item.rights||item.rights.status!=="approved")return false;
 if(ratingAge(item.age)>age)return false;
 if(item.kind==="movie"||item.kind==="channel")return playable(item);
 if(item.kind==="series")return episodes(item).length>0;
 return false;
}
function items(){
 var p=active();return p&&catalog?catalog.items.filter(function(item){return approved(item,p.age);}):[];
}
function card(key,item,title,type){
 var img=item.poster||item.backdrop;
 return '<button type="button" class="kid-card" data-kid-action="play" data-kid-key="'+esc(key)+'" aria-label="تشغيل '+esc(title)+'">'+
 '<span class="kid-card__image">'+(img?'<img src="'+esc(img)+'" alt="" loading="lazy" onerror="this.remove()">':'<b>★</b>')+'</span>'+
 '<strong>'+esc(title)+'</strong><small>'+esc(type)+'</small></button>';
}
function shelf(title,list,subtitle){
 if(!list.length)return "";
 return '<section class="kid-shelf"><header><h2>'+esc(title)+'</h2><p>'+esc(subtitle)+'</p></header>'+
 '<div class="kid-shelf__track">'+list.map(function(x){return card(x.key,x.parent||x,x.title,x.type||"تشغيل مباشر");}).join("")+'</div></section>';
}
function render(state){
 catalog=state;
 var ps=profiles(),p=active(),left=remaining();
 var out='<section class="kid-world" id="kidsWorld"><header class="kid-world__banner">'+
 '<span>★ AL EZZ KIDS</span><h1>عالم أطفال مستقل</h1>'+
 '<p>برامج وأفلام ومسلسلات وقنوات للأطفال، من روابط تشغيل مباشرة معتمدة؛ من دون الاعتماد على مشغل يوتيوب.</p>'+
 '<small>MP4 / HLS • يعمل على الأجهزة التي تدعم هذه الصيغ</small></header>'+
 '<div class="kid-world__profile-heading"><h2>اختر ملف الطفل</h2><span>الملفات محفوظة على هذا الجهاز</span></div>'+
 '<div class="kid-world__profiles">'+ps.map(function(x){return '<button type="button" data-kid-action="select" data-kid-id="'+esc(x.id)+
 '" class="kid-profile'+(p&&p.id===x.id?' is-selected':'')+'" aria-pressed="'+!!(p&&p.id===x.id)+'">'+
 '<span aria-hidden="true">'+(x.age<=6?'🧸':x.age<=9?'🚀':'🎮')+'</span><strong>'+esc(x.name)+'</strong><small>'+x.age+' سنوات</small></button>';}).join("")+'</div>';
 if(p){
  var spent=Math.floor(used(p.id)/60),percent=Math.min(100,Math.round(used(p.id)/(p.minutes*60)*100));
  out+='<section class="kid-world__clock"><div><small>وقت مشاهدة '+esc(p.name)+'</small>'+
  '<h2>'+(left?Math.ceil(left/60)+' دقيقة متبقية':'انتهى وقت المشاهدة اليوم 🌙')+'</h2>'+
  '<span>المستخدم '+spent+' من '+p.minutes+' دقيقة</span></div>'+
  '<div class="kid-world__progress" role="progressbar" aria-valuemin="0" aria-valuemax="'+p.minutes+
  '" aria-valuenow="'+spent+'"><i style="width:'+percent+'%"></i></div>'+
  '<button type="button" data-kid-action="toggle-settings">إعدادات المشاهدة ⚙</button></section>';
  var list=items(),visible=list.filter(function(x){return chosen==="all"||x.kind===chosen;})
    .filter(function(x){return !term||x.title.toLowerCase().indexOf(term.toLowerCase())!==-1;});
  var short=[];
  list.forEach(function(x){
   if(x.kind==="movie"&&x.duration&&x.duration<=25)short.push({key:x.key,parent:x,title:x.title,type:"برنامج قصير"});
   if(x.kind==="series")episodes(x).forEach(function(e){
    if(e.duration&&e.duration<=25)short.push({key:e.key,parent:x,title:x.title+" — "+e.title,type:"حلقة قصيرة"});
   });
  });
  if(left<=0)out+='<div class="kid-world__expired">استُنفدت المدة المحددة اليوم. يمكنك تعديلها من إعدادات الملف.</div>';
  out+='<section class="kid-world__library"><div class="kid-world__search"><h2>مكتبة '+esc(p.name)+'</h2>'+
   '<input id="kidSearch" type="search" value="'+esc(term)+'" placeholder="ابحث داخل عالم الأطفال" aria-label="بحث الأطفال"></div>'+
   '<div class="kid-world__filters">'+[["all","الكل"],["channel","القنوات"],["movie","الأفلام"],["series","المسلسلات"]].map(function(f){
    return '<button type="button" data-kid-action="filter" data-kid-filter="'+f[0]+'" class="'+(chosen===f[0]?'active':'')+'">'+f[1]+'</button>';
   }).join("")+'</div>'+
   (!term&&chosen==="all"?shelf("مقاطع وبرامج قصيرة",short.slice(0,24),"محتوى قصير مباشر عندما يتوفر في المكتبة"):"")+
   (!term&&chosen==="all"?shelf("أفلام وبرامج",list.filter(function(x){return x.kind==="movie";}),"بدون روابط يوتيوب"):"")+
   (!term&&chosen==="all"?shelf("مسلسلات بحلقات متتابعة",list.filter(function(x){return x.kind==="series";}),"تشغيل الحلقة التالية آليًا حسب إعدادات الملف"):"")+
   (!term&&chosen==="all"?shelf("قنوات الأطفال",list.filter(function(x){return x.kind==="channel";}).slice(0,30),"بث مباشر داخل العز TV"):"")+
   '<section class="kid-shelf"><header><h2>جميع الأعمال المناسبة للعمر</h2><p>'+visible.length+' عمل متاح</p></header>'+
   (visible.length?'<div class="kid-grid">'+visible.map(function(x){return card(x.key,x,x.title,x.kind==="channel"?"● قناة مباشرة":x.kind==="series"?"مسلسل":"فيلم");}).join("")+'</div>':
   '<div class="kid-world__empty">لا يوجد محتوى مباشر معتمد يطابق العمر أو البحث. لا نعرض بدائل يوتيوب.</div>')+
   '</section></section>';
 }else out+='<div class="kid-world__empty"><h2>أنشئ ملف الطفل للبدء</h2><p>اختر العمر والوقت اليومي ليظهر المحتوى المناسب.</p></div>';
 out+='<section class="kid-world__parent"><h2>إدارة ملفات الأطفال</h2>'+
 '<p>الإعدادات محلية على هذا الجهاز وليست قفلًا أبويًا محميًا بكلمة مرور.</p>'+
 '<form id="kidAddForm" class="kid-world__form">'+
 '<label>اسم الطفل<input id="kidName" type="text" minlength="2" maxlength="25" required placeholder="اسم الطفل"></label>'+
 '<label>العمر<select id="kidAge"><option value="3">3 سنوات</option><option value="6">6 سنوات</option><option value="9">9 سنوات</option><option value="12">12 سنة</option></select></label>'+
 '<label>المدة اليومية<select id="kidMinutes"><option value="15">15 دقيقة</option><option value="30">30 دقيقة</option><option value="45">45 دقيقة</option><option value="60" selected>60 دقيقة</option><option value="90">90 دقيقة</option><option value="120">120 دقيقة</option></select></label>'+
 '<button type="submit"'+(ps.length>=4?' disabled':'')+'>إضافة ملف +</button></form>'+
 (p?'<div id="kidSettings" class="kid-world__settings" hidden><label>الوقت اليومي<select id="kidLimit">'+
 [15,30,45,60,90,120].map(function(n){return '<option value="'+n+'"'+(n===p.minutes?' selected':'')+'>'+n+' دقيقة</option>';}).join("")+
 '</select></label><label><input type="checkbox" id="kidAutoNext"'+(p.autoNext!==false?' checked':'')+'> تشغيل الحلقات التالية تلقائيًا</label>'+
 '<button type="button" data-kid-action="save-settings">حفظ الإعدادات</button>'+
 '<button type="button" data-kid-action="remove">حذف الملف المحدد</button></div>':'')+
 '</section></section>';
 return out;
}
function find(key){
 var all=items();
 for(var i=0;i<all.length;i++){
  if(all[i].key===key)return {parent:all[i],ep:null};
  if(all[i].kind==="series"){
   var eps=episodes(all[i]);
   for(var n=0;n<eps.length;n++)if(eps[n].key===key)return {parent:all[i],ep:eps[n]};
  }
 }
 return null;
}
function play(key){
 if(!remaining()){notify("انتهى وقت المشاهدة اليوم");update();return false;}
 var found=find(key);if(!found){notify("هذا المحتوى غير متاح للعمر أو لا يملك رابطًا مباشرًا معتمدًا.");return false;}
 var parent=found.parent,list=parent.kind==="series"?episodes(parent):[];
 var ep=found.ep||(parent.kind==="series"?list[0]:null);
 if(parent.kind==="series"&&!ep)return false;
 var current=ep||parent,idx=ep?list.indexOf(ep):-1,p=active();
 var next=idx>=0&&p.autoNext!==false?list[idx+1]||null:null;
 var payload={key:current.key,kind:ep?"episode":parent.kind,title:ep?parent.title+" — "+ep.title:parent.title,
 subtitle:parent.title,stream:current.stream,variants:current.variants||[],youtubeId:"",
 live:parent.kind==="channel",poster:current.poster||parent.poster,quality:parent.quality,kids:true,age:parent.age};
 watching=true;lastTick=Date.now();
 if(w.AlezzNative&&w.AlezzNative.playMedia){w.AlezzNative.playMedia(JSON.stringify(payload));return true;}
 Player.open(payload,{next:next?{key:next.key,title:parent.title+" — "+next.title,stream:next.stream,
  variants:next.variants||[],youtubeId:"",kind:"episode"}:null,
  onNext:next?function(){play(next.key);}:null});
 return true;
}
function tick(playing){
 if(!watching)return;
 var now=Date.now(),gap=lastTick&&playing?Math.max(0,Math.min(5,(now-lastTick)/1000)):0;lastTick=now;
 if(!gap)return;
 var p=active();if(!p){watching=false;return;}
 var u=get("usage",{}),seconds=used(p.id)+gap;
 u[p.id]={date:dateKey(),seconds:seconds};put("usage",u);
 if(seconds>=p.minutes*60){watching=false;lastTick=0;if(Player.isOpen())Player.close();
  notify("انتهى وقت مشاهدة "+p.name+" اليوم");update();}
}
function stop(){watching=false;lastTick=0;}
function handleClick(e){
 var b=e.target.closest("[data-kid-action]");if(!b)return false;
 var action=b.getAttribute("data-kid-action");
 if(action==="select")choose(b.getAttribute("data-kid-id"));
 if(action==="play")play(b.getAttribute("data-kid-key"));
 if(action==="filter"){chosen=b.getAttribute("data-kid-filter");update();}
 if(action==="toggle-settings"){var x=document.getElementById("kidSettings");if(x)x.hidden=!x.hidden;}
 if(action==="save-settings"){
  var v=document.getElementById("kidLimit"),a=document.getElementById("kidAutoNext");
  if(v&&a){settings(v.value,a.checked);notify("تم حفظ إعدادات المشاهدة");}
 }
 if(action==="remove"&&w.confirm("حذف ملف الطفل من هذا الجهاز؟"))removeProfile();
 return true;
}
function mount(state,rerender){
 catalog=state;refresh=rerender;
 var form=document.getElementById("kidAddForm");
 if(form)form.addEventListener("submit",function(e){e.preventDefault();
  try{create(document.getElementById("kidName").value,document.getElementById("kidAge").value,
      document.getElementById("kidMinutes").value);}
  catch(err){notify(err.message);}
 });
 var search=document.getElementById("kidSearch");
 if(search){
  search.addEventListener("change",function(){term=this.value.trim();update();});
  search.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();term=this.value.trim();update();}});
 }
}
w.AlezzKids={render:render,mount:mount,handleClick:handleClick,play:play,tick:tick,stop:stop,
 active:active,profiles:profiles,create:create,choose:choose,settings:settings,remaining:remaining,
 ratingAge:ratingAge,approved:approved,episodes:episodes};
})(window);
