(function(){'use strict';
  const arrow='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 18l-6-6 6-6"/></svg>';
  function apply(){
    if(document.body?.classList.contains('employer-mode'))return;
    document.querySelectorAll('button.header-back-inline,button.back[aria-label],button.profile-view-back,button#back-btn').forEach(btn=>{
      if(btn.classList.contains('alygnn-unified-back'))return;
      btn.classList.add('alygnn-unified-back');
      btn.innerHTML=arrow;
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();
