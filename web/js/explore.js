/* AL EZZ TV — unified discovery filters, ES5 / RTL / TV remote. */
(function(){
"use strict";
var genres=[["action","أكشن"],["adventure","مغامرات"],["animation","كرتون"],["anime","أنمي"],["biography","سيرة ذاتية"],["comedy","كوميديا"],["crime","جريمة"],["documentary","وثائقي"],["drama","دراما"],["education","تعليمي"],["family","عائلي"],["fantasy","فانتازيا"],["history","تاريخي"],["horror","رعب"],["kids","أطفال"],["mystery","غموض"],["nature","طبيعة"],["romance","رومانسي"],["scifi","خيال علمي"],["science","علوم"],["short","قصير"],["sports","رياضة"],["thriller","إثارة"],["war","حرب"],["western","ويسترن"],["music","موسيقي"],["classic","كلاسيكي"]],countries=[["TR","تركية"],["US","أمريكية"],["GB","بريطانية"],["KR","كورية"],["IN","هندية"],["JP","يابانية"],["CN","صينية"],["FR","فرنسية"],["ES","إسبانية"],["EG","مصرية"],["SA","سعودية"],["DE","ألمانية"],["NL","هولندية"],["IT","إيطالية"],["MX","مكسيكية"],["BR","برازيلية"],["CA","كندية"],["AU","أسترالية"],["RU","روسية"],["PK","باكستانية"],["ID","إندونيسية"],["AE","إماراتية"],["KW","كويتية"],["MA","مغربية"]],arab=["SA","EG","AE","KW","BH","QA","OM","YE","IQ","JO","LB","SY","PS","MA","DZ","TN","LY","SD","SO","MR","DJ","KM"],topics=[["letters","الحروف"],["numbers","الأرقام"],["animals","الحيوانات"],["colors","الألوان"],["stories","القصص"],["songs","الأناشيد"],["science","العلوم"]],kinds=[["movie","أفلام"],["series","مسلسلات"],["channel","قنوات"],["youtube","فيديوهات"]];
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,'&quot;').replace(/'/g,"&#39;");}
function label(code){for(var i=0;i<genres.length;i++)if(genres[i][0]===code)return genres[i][1];return code;}
function matches(x,id){
 if(!id)return true;
 if(id.indexOf("genre:")===0)return (x.genreTags||[]).indexOf(id.slice(6))!==-1;
 if(id.indexOf("topic:")===0)return x.topic===id.slice(6);
 if(id.indexOf("kind:")===0)return x.kind===id.slice(5);
 var country=String(x.country||"").toUpperCase();
 if(id.indexOf("country:")===0)return country===id.slice(8);
 if(id==="origin:arab")return arab.indexOf(country)!==-1;
 if(id==="origin:foreign")return !!country&&arab.indexOf(country)===-1;
 return x.categoryId===id;
}
function count(list,id){var n=0;list.forEach(function(x){if(matches(x,id))n++;});return n;}
function options(list,values,prefix){return values.map(function(x){var id=prefix+x[0];return{id:id,label:x[1],count:count(list,id)};});}
function groups(list,section,categories){
 var result=[];
 if(section==="kids"||section==="mylist")result.push({name:"نوع المحتوى",items:options(list,kinds,"kind:")});
 if(section==="youtube")return[{name:"موضوع الفيديو",items:options(list,topics,"topic:")}];
 var origins=[{id:"origin:arab",label:"عربية",count:count(list,"origin:arab")},{id:"origin:foreign",label:"أجنبية",count:count(list,"origin:foreign")}];
 result.push({name:"بلد الإنتاج",items:origins.concat(options(list,countries,"country:"))});
 result.push({name:"النوع والقصة",items:options(list,genres,"genre:")});
 var cats=[];
 (categories||[]).forEach(function(c){var n=count(list,c.id);if(n)cats.push({id:c.id,label:c.name_ar,count:n});});
 cats.sort(function(a,b){return b.count-a.count||a.label.localeCompare(b.label,"ar");});
 if(cats.length)result.push({name:"أقسام المكتبة",items:cats});
 return result;
}
function picker(list,active,section,categories){
 list=list||[];var isLive=section==="live",attr=isLive?"data-live-filter":"data-filter";
 var sections=groups(list,section,categories),all=[];
 sections.forEach(function(g){all=all.concat(g.items);});
 var picks=section==="youtube"?["topic:stories","topic:animals","topic:science","topic:songs","topic:letters"]:
 section==="kids"?["kind:channel","kind:movie","kind:series","genre:animation","genre:anime"]:
 section==="live"?["origin:arab","origin:foreign","genre:sports","genre:documentary"]:
 section==="mylist"?["kind:movie","kind:series","kind:channel"]:
 ["origin:foreign","country:TR","genre:action","genre:crime","genre:comedy","genre:anime","genre:documentary","genre:war"];
 var quick=[];
 picks.forEach(function(id){var x=all.filter(function(y){return y.id===id&&y.count>0;})[0];if(x&&quick.length<7)quick.push(x);});
 var selected=all.filter(function(x){return x.id===active;})[0];
 var html='<section class="browse-panel" aria-label="خيارات التصنيف">'+
 '<div class="browse-panel__head"><div><span class="browse-panel__eyebrow">AL EZZ · DISCOVER</span><h2>اكتشف حسب ذوقك</h2></div>'+
 '<span class="browse-panel__count">'+count(list,active)+' من '+list.length+' عنوان</span></div>'+
 '<div class="browse-panel__quick" aria-label="تصنيفات سريعة">'+
 '<button type="button" '+attr+'="" class="browse-pill'+(!active?' is-on':'')+'" aria-pressed="'+(!active)+'">الكل</button>'+
 quick.map(function(x){return '<button type="button" '+attr+'="'+esc(x.id)+'" class="browse-pill'+(active===x.id?' is-on':'')+
 '" aria-pressed="'+(active===x.id)+'">'+esc(x.label)+'</button>';}).join("")+'</div>'+
 '<div class="browse-panel__controls">';
 sections.forEach(function(section){
 html+='<label class="browse-select"><span>'+esc(section.name)+'</span><select data-browse-select="'+(isLive?'live':'main')+
 '" aria-label="'+esc(section.name)+'"><option value="">اختر '+esc(section.name)+'</option>'+
 section.items.map(function(x){return '<option value="'+esc(x.id)+'"'+(active===x.id?' selected':'')+
 (x.count===0&&x.id!==active?' disabled':'')+'>'+esc(x.label)+' · '+x.count+'</option>';}).join("")+'</select></label>';
 });
 html+='</div>';
 if(active)html+='<div class="browse-panel__selected"><span>تصفية حسب <b>'+esc(selected?selected.label:"التصنيف المختار")+
 '</b></span><button type="button" '+attr+'="">إزالة التصفية ×</button></div>';
 return html+'</section>';
}
function shortcuts(){
 var items=[["movies","","أفلام","كل الأفلام"],["series","","مسلسلات","كل الحلقات"],["movies","genre:action","أكشن","حماس ومغامرة"],
 ["movies","genre:crime","جريمة","تحقيق وغموض"],["movies","genre:documentary","وثائقي","قصص حقيقية"],
 ["series","country:TR","تركي","مسلسلات تركية"],["movies","genre:anime","أنمي","عالم الأنمي"],
 ["kids","","أطفال","عائلي وترفيهي"],["live","","مباشر","قنوات حية"],["youtube","","فيديوهات","قصص وعلوم"]];
 return '<section class="browse-shortcuts"><div class="browse-shortcuts__head"><span>استكشف عالم العز</span><strong>وش ودك تشاهد؟</strong></div>'+
 '<div class="browse-shortcuts__rail">'+items.map(function(x){return '<a class="browse-shortcut" href="#/'+x[0]+
 (x[1]?'/'+encodeURIComponent(x[1]):'')+'"><b>'+esc(x[2])+'</b><small>'+esc(x[3])+'</small></a>';}).join("")+'</div></section>';
}
window.AlezzExplore={matches:matches,genreLabel:label,groups:groups,picker:picker,shortcuts:shortcuts};
})();