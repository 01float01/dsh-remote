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
    var ovls=doc.querySelectorAll('[role="dialog"],[class*="_overlay"]');for(var i=0;i<ovls.length;i++){var o=ovls[i];if(o.offsetWidth>200&&o.offsetHeight>200){var cb=o.querySelector('[class*="_close"]');if(cb){cb.click();return;}}}
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
  // rc5 native drawer JS marks the sidebar inert while it believes the drawer is closed.
  // We open it via CSS, so strip inert whenever our drawer is open (else clicks fall through).
  if(root.classList.contains("dshb1-drawer-open")){var sb=doc.querySelector("[data-dshb1-sidebar]");if(sb&&sb.hasAttribute("inert"))sb.removeAttribute("inert");}
}
function tick(){ if(!state.tagged||!doc.querySelector("[data-dshb1-frame]")){state.tagged=probe();} buildChrome(); applyMode();
}
function start(){
  // Block rc5 from marking our open drawer inert (it sets el.inert=true via the IDL property,
  // which bypasses setAttribute). Override the inert setter on the prototype.
  try{
    var desc=Object.getOwnPropertyDescriptor(HTMLElement.prototype,"inert");
    if(desc&&desc.set){
      Object.defineProperty(HTMLElement.prototype,"inert",{configurable:true,enumerable:desc.enumerable,get:desc.get,set:function(v){
        if(v&&this.hasAttribute&&this.hasAttribute("data-dshb1-sidebar")&&root.classList.contains("dshb1-drawer-open"))return;
        desc.set.call(this,v);
      }});
    }
    var origSetAttr=Element.prototype.setAttribute;
    Element.prototype.setAttribute=function(n,v){
      if(n==="inert"&&this.hasAttribute&&this.hasAttribute("data-dshb1-sidebar")&&root.classList.contains("dshb1-drawer-open"))return;
      return origSetAttr.apply(this,arguments);
    };
  }catch(_){}
  tick();
  setInterval(function(){if(root.classList.contains("dshb1-drawer-open")){var sb=doc.querySelector("[data-dshb1-sidebar]");if(sb&&sb.hasAttribute("inert")){sb.removeAttribute("inert");}}},60);
  // CSS anchor-positioning fallback for old engines (Chrome 97 etc.).
  // NOTE: Chrome<125 drops anchor-name/position-anchor from CSSOM entirely, so we cannot
  // read them back. Instead we hook the setProperty CALL to capture anchor-name->element,
  // and fall back to the last interacted trigger. General across all floating panels.
  var anchorOK=false; try{anchorOK=window.CSS&&CSS.supports&&CSS.supports("anchor-name: --dshb1t");}catch(_){}
  if(!anchorOK){
    var anchorMap={};
    try{
      var origSet=CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty=function(n,v,p){
        if(n==="anchor-name"&&v){var name=String(v).trim();var self=this;setTimeout(function(){var els=doc.querySelectorAll("*");for(var i=0;i<els.length;i++){if(els[i].style===self){anchorMap[name]=els[i];break;}}},0);}
        return origSet.apply(this,arguments);
      };
    }catch(_){}
    var lastTrigger=null;
    doc.addEventListener("pointerdown",function(ev){var b=ev.target&&ev.target.closest?ev.target.closest("button,[role=button],[role=menuitem]"):null;if(b)lastTrigger=b;},true);
    function isChrome(el){var c=String(el.className);return /dshb1|pI_x6G_frame|pI_x6G_sidebarCol|pI_x6G_drawerMask/.test(c)||el.id==="dshb1-topbar"||el.id==="dshb1-backdrop";}
    function place(panel,tr){var w=panel.offsetWidth,h=panel.offsetHeight;if(w<1||h<1||tr.width<1)return;var gap=4;var top,left;
      if(tr.top>window.innerHeight*0.55){top=tr.top-h-gap;}else{top=tr.bottom+gap;}
      left=tr.left; if(left+w>window.innerWidth-4)left=tr.right-w;
      if(top<4)top=tr.bottom+gap; if(top+h>window.innerHeight-4)top=Math.max(4,tr.top-h-gap);
      left=Math.min(Math.max(left,4),Math.max(4,window.innerWidth-w-4)); top=Math.min(Math.max(top,4),Math.max(4,window.innerHeight-h-4));
      panel.style.setProperty("position","fixed","important");panel.style.setProperty("left",left+"px","important");panel.style.setProperty("top",top+"px","important");panel.style.setProperty("right","auto","important");panel.style.setProperty("bottom","auto","important");}
    function fixFloating(){
      var els=doc.querySelectorAll("div,ul,section");
      for(var i=0;i<els.length;i++){var el=els[i];if(isChrome(el))continue;var cs=getComputedStyle(el);
        if(cs.position!=="fixed"&&cs.position!=="absolute")continue;
        var z=parseInt(cs.zIndex||"0",10);if(z<50)continue;
        var r=el.getBoundingClientRect();if(r.width<40||r.height<30)continue;
        if(el.getAttribute("role")==="dialog"||r.width>420||/_overlay|_panel|_card/.test(String(el.className)))continue;
        var corner=(r.x<30&&r.y<40)||(r.x<30&&r.y>window.innerHeight-120);
        if(!corner)continue;
        var tr=null;
        var pa=el.style.getPropertyValue("position-anchor");if(pa){var m=pa.match(/var\((--[^,)]+)/);var nm=m?getComputedStyle(el).getPropertyValue(m[1]).trim():pa;tr=anchorMap[nm]||null;}
        if(!tr||!tr.isConnected)tr=lastTrigger;
        if(tr&&tr.isConnected)place(el,tr.getBoundingClientRect());
      }
    }
    window.__dshb1Fix=fixFloating;
    setInterval(fixFloating,250);
  }
  var lastPop=0;
  function scanPopups(){
    var now=Date.now(); if(now-lastPop<2500)return;
    var els=doc.querySelectorAll("div,ul"); var found=[];
    for(var i=0;i<els.length;i++){var el=els[i];var cs=getComputedStyle(el);
      if((cs.position==="fixed"||cs.position==="absolute")&&parseInt(cs.zIndex||"0",10)>=50&&el.offsetWidth>40&&el.offsetHeight>30&&!/dshb1|pI_x6G_|drawerMask|sidebarCol/.test(String(el.className))&&!/☰/.test(el.innerText||"")){
        var r=el.getBoundingClientRect(); var chain=[]; var p=el.parentElement;
        for(var u=0;u<9&&p;u++){var pc=getComputedStyle(p);chain.push({c:String(p.className).slice(0,30),pos:pc.position,tf:pc.transform!=="none"?"Y":null,ct:pc.contain!=="none"?pc.contain:null,ctype:pc.containerType!=="normal"?pc.containerType:null});p=p.parentElement;}
        found.push({cls:String(el.className).slice(0,40),pos:cs.position,top:cs.top,left:cs.left,x:Math.round(r.x),y:Math.round(r.y),txt:(el.innerText||"").slice(0,24),chain:chain});
        if(found.length>=3)break;
      }}
    if(found.length){lastPop=now;
      for(var f=0;f<found.length;f++){if(found[f].pos==="fixed"&&found[f].x<30&&found[f].y<30){setTimeout(function(){window.dispatchEvent(new Event("resize"));window.dispatchEvent(new Event("scroll"));},120);setTimeout(function(){window.dispatchEvent(new Event("resize"));},400);}}
      var trig=[];var btns=doc.querySelectorAll("button");for(var b=0;b<btns.length;b++){var bt=(btns[b].innerText||"").trim();if(/工作区内修改|完全权限|仅可查看|DeepSeek|标准模式/.test(bt)&&bt.length<30){var br=btns[b].getBoundingClientRect();trig.push({txt:bt.slice(0,20),x:Math.round(br.x),y:Math.round(br.y),w:Math.round(br.width),h:Math.round(br.height)});if(trig.length>=4)break;}}
      try{navigator.sendBeacon("/__gate/diag",new Blob([JSON.stringify({type:"dshb1-popup",popups:found,triggers:trig})],{type:"application/json"}));}catch(_){}}
  }
  var mo=new MutationObserver(function(){tick();scanPopups();if(window.__dshb1Fix)window.__dshb1Fix();});
  mo.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:["inert","style","class"]});
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
