(function(){
"use strict";
// DSH Remote Block1 macro responsive layer. Gateway-injected; does NOT modify DSH source.
// Detection borrows dsh-mobile-layout geometry+hysteresis & dsh-web-mobile pointer:coarse (avoid desktop narrow-window misjudge).
var ENTER_SHORT=600, ENTER_RATIO=1.25, HOLD_SHORT=640, HOLD_RATIO=1.15; // hysteresis
var root=document.documentElement, doc=document;
var state={mobile:false, tagged:false};
function log(){try{console.log.apply(console,["[dshb1]"].concat([].slice.call(arguments)));}catch(e){}}
function coarse(){try{return matchMedia("(pointer: coarse)").matches;}catch(e){return false;}}
function classify(){
  // explicit override for testing / escape hatch
  var q=(location.search.match(/[?&]dshb1=(mobile|landscape|auto)/)||[])[1];
  if(q==="mobile")return true; if(q==="landscape")return false;
  // use screen.* (stable against soft-keyboard viewport shrink) so keyboard open/close does NOT flip mode
  var w=screen.width||window.innerWidth||root.clientWidth, h=screen.height||window.innerHeight||root.clientHeight;
  var shortS=Math.min(w,h), longS=Math.max(w,h), ratio=longS/Math.max(1,shortS);
  var touch=coarse()||(h>w); // coarse touch OR portrait geometry (emulator reports fine pointer)
  if(!touch) return false; // mouse landscape host => official layout
  var portraitGeom = h > w; // require portrait so tablet landscape stays official even if touch
  if(state.mobile){ return portraitGeom && shortS<=HOLD_SHORT && ratio>=HOLD_RATIO; } // hold (hysteresis)
  return portraitGeom && shortS<=ENTER_SHORT && ratio>=ENTER_RATIO; // enter
}
function probe(){
  var rb=doc.querySelector("[data-rightbar-col]");
  var frame=rb?rb.parentElement:null;
  if(!frame){var all=doc.querySelectorAll("div");for(var i=0;i<all.length;i++){var st=all[i].style;if(st&&st.gridTemplateColumns&&/sidebarCol/.test(all[i].className||"")){frame=all[i];break;}}}
  if(!frame)return false;
  frame.setAttribute("data-dshb1-frame","1");
  var kids=frame.children;
  for(var j=0;j<kids.length;j++){var cn=kids[j].className||"";
    if(/sidebarCol/.test(cn))kids[j].setAttribute("data-dshb1-sidebar","1");
    else if(/centerCol/.test(cn))kids[j].setAttribute("data-dshb1-center","1");
    else if(/handle/.test(cn))kids[j].setAttribute("data-dshb1-handle","1");}
  return true;
}
function buildChrome(){
  if(doc.getElementById("dshb1-topbar"))return;
  var bar=doc.createElement("div");bar.id="dshb1-topbar";
  var burger=doc.createElement("button");burger.id="dshb1-burger";burger.setAttribute("aria-label","menu");burger.textContent="\u2630";
  var title=doc.createElement("span");title.id="dshb1-title";title.textContent="DSH";
  bar.appendChild(burger);bar.appendChild(title);
  var backdrop=doc.createElement("div");backdrop.id="dshb1-backdrop";
  doc.body.appendChild(bar);doc.body.appendChild(backdrop);
  burger.addEventListener("click",function(){
    var ovls=doc.querySelectorAll('[class*="_overlay"]');for(var i=0;i<ovls.length;i++){var o=ovls[i];if(o.offsetWidth>0){var cb=o.querySelector('[class*="_close"]');if(cb){cb.click();return;}}}
    root.classList.toggle("dshb1-drawer-open");
  });
  backdrop.addEventListener("click",function(){root.classList.remove("dshb1-drawer-open");});
  // left-edge right-swipe to open drawer (dsh-mobile-layout gesture, simplified)
  var sx=null,sy=null;
  doc.addEventListener("touchstart",function(e){var t=e.touches[0];if(t.clientX<=Math.max(24,window.innerWidth*0.15)){sx=t.clientX;sy=t.clientY;}else{sx=null;}},{passive:true});
  doc.addEventListener("touchend",function(e){if(sx===null)return;var t=e.changedTouches[0];var dx=t.clientX-sx,dy=Math.abs(t.clientY-sy);if(dx>48&&dx>dy*1.5&&root.classList.contains("dshb1-portrait")){root.classList.add("dshb1-drawer-open");}sx=null;},{passive:true});
}
function applyMode(){
  var m=classify();
  state.mobile=m;
  root.classList.toggle("dshb1-portrait",m);
  root.classList.toggle("dshb1-landscape",!m);
  root.setAttribute("data-dshb1-mode",m?"mobile":"default");
  if(!m)root.classList.remove("dshb1-drawer-open");
}
function tick(){ if(!state.tagged||!doc.querySelector("[data-dshb1-frame]")){state.tagged=probe();} buildChrome(); applyMode();
}
function start(){
  tick();
  var mo=new MutationObserver(function(){tick();});
  mo.observe(doc.body,{childList:true,subtree:true});
  var rt=null;function onChange(){if(rt)clearTimeout(rt);rt=setTimeout(function(){state.tagged=false;tick();},120);}
  window.addEventListener("resize",onChange);
  window.addEventListener("orientationchange",onChange);
  if(window.visualViewport){window.visualViewport.addEventListener("resize",onChange);}
  try{matchMedia("(pointer: coarse)").addEventListener("change",onChange);}catch(e){}
  log("active mode=",root.getAttribute("data-dshb1-mode"),"w=",window.innerWidth,"h=",window.innerHeight,"coarse=",coarse());
  try{var w=window.innerWidth,h=window.innerHeight;navigator.sendBeacon("/__gate/diag",new Blob([JSON.stringify({type:"dshb1-mode",mode:root.getAttribute("data-dshb1-mode"),w:w,h:h,shortS:Math.min(w,h),coarse:coarse(),orient:matchMedia("(orientation: portrait)").matches,ua:navigator.userAgent})],{type:"application/json"}));}catch(e){}
}
if(doc.readyState==="loading")doc.addEventListener("DOMContentLoaded",start);else start();
})();
