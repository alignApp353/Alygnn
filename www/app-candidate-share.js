/* Candidate job sharing: native share when supported, otherwise a reliable link copy. */
(function(){'use strict';
  function copyFallback(text){
    const field=document.createElement('textarea');
    field.value=text;
    field.setAttribute('readonly','');
    field.style.cssText='position:fixed;top:0;left:0;opacity:0;z-index:-1';
    document.body.appendChild(field);field.focus();field.select();
    let copied=false;
    try{copied=!!document.execCommand('copy')}catch(_){copied=false}
    field.remove();return copied;
  }
  async function share({title,text,url},feedback){
    const link=String(url||'https://alygnn.com');
    const shareData={title:String(title||'Alygnn Job'),text:String(text||''),url:link};
    const tell=message=>{if(typeof feedback==='function')feedback(message)};
    try{
      const nativeShare=window.Capacitor?.Plugins?.Share;
      if(nativeShare&&typeof nativeShare.share==='function'){
        await nativeShare.share(shareData);return true;
      }
      if(typeof navigator.share==='function'){
        await navigator.share(shareData);return true;
      }
    }catch(error){
      if(error?.name==='AbortError'||/cancel/i.test(String(error?.message||'')))return false;
      console.warn('Native job share unavailable; using link copy',error);
    }
    try{
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(link);tell('Job link copied');return true}
    }catch(error){console.warn('Clipboard API unavailable',error)}
    if(copyFallback(link)){tell('Job link copied');return true}
    // On older Android WebViews, prompt still lets the user select and copy the exact URL.
    window.prompt('Copy this job link to share:',link);
    tell('Select and copy the job link');return false;
  }
  window.AlygnnCandidateShare={share};
})();
