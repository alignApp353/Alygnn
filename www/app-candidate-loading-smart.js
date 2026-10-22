/* Don't flash loading screens for normal tab transitions. Show only if opening is slow. */
(function(){'use strict';
 const root=document.documentElement;
 const params=new URLSearchParams(location.search);
 const messages=location.pathname.endsWith('/app-messages.html')&&params.get('role')==='candidate';
 if(messages)root.classList.add('alygnn-candidate-messages-route');
 const isCandidate=root.dataset.alygnnResponsive==='candidate'||messages;
 if(!isCandidate)return;
 const hide=()=>root.classList.remove('alygnn-slow-boot');
 const bootPending=()=>{
   const body=document.body;
   if(!body)return false;
   if(body.classList.contains('prefs-hydrating')||
      (messages&&body.classList.contains('messages-booting')))return true;
   const candidateLoader=document.getElementById('alygnn-shared-candidate-loader');
   if(candidateLoader&&!candidateLoader.classList.contains('alygnn-boot-complete')&&candidateLoader.getAttribute('aria-hidden')!=='true')return true;
   const ordinary=document.getElementById('loading');
   return !!(ordinary&&!ordinary.hidden);
 };
 let timer;
 function start(){
   timer=setTimeout(()=>{if(bootPending())root.classList.add('alygnn-slow-boot')},1250);
   const observer=new MutationObserver(()=>{if(!bootPending()){hide();observer.disconnect();clearTimeout(timer)}});
   observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','hidden','aria-hidden']});
   window.addEventListener('pageshow',e=>{if(e.persisted)hide()}, {once:true});
   setTimeout(()=>{hide();observer.disconnect()},10000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
