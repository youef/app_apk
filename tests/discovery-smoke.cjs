"use strict";
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict");
const read=p=>fs.readFileSync(p,"utf8");
const ctx={window:{}};vm.runInNewContext(read("web/js/explore.js"),ctx);
const ex=ctx.window.AlezzExplore;
const items=[
 {kind:"movie",country:"TR",categoryId:"classic",genreTags:["crime","drama"]},
 {kind:"series",country:"EG",categoryId:"drama",genreTags:["drama"]},
 {kind:"movie",country:"US",categoryId:"crime",genreTags:["action"]},
 {kind:"youtube",topic:"science",country:null,genreTags:[]},
 {kind:"channel",country:"SA",categoryId:"news",genreTags:["documentary"]}
];
assert(ex.matches(items[0],"country:TR"));
assert(ex.matches(items[0],"genre:crime"));
assert(ex.matches(items[1],"origin:arab"));
assert(ex.matches(items[2],"origin:foreign"));
assert(ex.matches(items[3],"topic:science"));
assert(ex.matches(items[4],"kind:channel"));
assert(!ex.matches(items[0],"genre:war"));
for(const name of ["movies","series","kids","live","youtube","mylist"]){
 const html=ex.picker(items,"",name,[{id:"classic",name_ar:"كلاسيكيات"}]);
 assert.equal((html.match(/>الكل<\/button>/g)||[]).length,1,name+" all must be unique");
 assert(html.includes("data-browse-select="));
 assert(!html.includes("classified-filter-group"));
 if(name==="live")assert(html.includes("data-live-filter"));
 if(name==="youtube")assert(html.includes("topic:science"));
}
assert(ex.picker(items,"genre:crime","movies",[]).includes("إزالة التصفية"));
assert(ex.picker([],"","movies",[]).includes("0 من 0"));
const app=read("web/js/app.js"),live=read("web/js/live.js"),page=read("web/index.html");
for(const section of ["movies","series","kids","youtube","mylist"]){
 assert(app.includes(',"'+section+'")')||app.includes('"'+section+'")'),"section picker missing: "+section);
}
assert(live.includes('Explore.picker(state.channels,state.category,"live"'));
assert(page.includes('js/explore.js?v='));
console.log("PASS: compact unified taxonomy, no duplicate all, across the entire platform");
