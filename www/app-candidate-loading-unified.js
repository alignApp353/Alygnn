/* Primary candidate-tab loader. Data-aware completion called from existing page initialization. */
(function(){
  'use strict';
  let ended=false;
  let watchdog;
  function finish(){
    if(ended)return;
    ended=true;
    if(watchdog)clearTimeout(watchdog);
    const element=document.getElementById('alygnn-shared-candidate-loader');
    if(element){
      element.classList.add('alygnn-boot-complete');
      element.setAttribute('aria-hidden','true');
    }
  }
  window.AlygnnCandidateBoot={finish};
  // Never prevent the user from navigating if a network call hangs.
  watchdog=setTimeout(finish,8000);
  window.addEventListener('pageshow',function(event){
    if(event.persisted)finish();
  });
})();
