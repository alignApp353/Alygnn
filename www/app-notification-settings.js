/* Alygnn shared per-device push preferences (candidate and employer). */
(function(){
  'use strict';
  function render(){
    if(document.getElementById('alygnn-permission-settings'))return;
    const candidate=location.pathname.endsWith('app-account-settings.html');
    const anchor=candidate ? Array.from(document.querySelectorAll('.section-label')).find(x=>x.textContent.trim()==='Notifications')?.closest('.section') : document.querySelector('main');
    if(!anchor)return;
    const card=document.createElement('section');
    card.id='alygnn-permission-settings';
    card.style.cssText='border:1px solid var(--border,#DDE3E8);border-radius:14px;padding:16px;margin:15px 0;background:var(--card,#FCFCFA);color:var(--text,#1A2530);font-family:inherit';
    card.innerHTML='<div style="font-weight:700;margin-bottom:5px">Push Notifications</div><div id="alygnn-device-push-status" role="status" aria-live="polite" style="font-size:13px;opacity:.85;line-height:1.5;margin-bottom:12px">Checking notifications…</div><div id="alygnn-device-push-error" role="alert" style="display:none;color:var(--danger,#C74747);font-size:13px;margin-bottom:12px"></div><button type="button" id="alygnn-device-push-toggle" style="border:0;border-radius:9px;background:#5D7FA3;color:white;padding:11px 15px;font:600 13px inherit;cursor:pointer">Turn Off Notifications</button>';
    if(candidate)anchor.append(card);else anchor.insertBefore(card,anchor.firstChild);
    const label=card.querySelector('#alygnn-device-push-status');
    const button=card.querySelector('#alygnn-device-push-toggle');
    const error=card.querySelector('#alygnn-device-push-error');
    let cached=null;
    let busy=false;
    async function update(){
      if(busy)return;
      const settings=await window.AlygnnPush?.getSettings?.().catch(()=>null);
      cached=settings;
      if(!settings?.native){label.textContent='Manage device notifications in the installed Alygnn app.';button.hidden=true;return;}
      if(!settings.signedIn){label.textContent='Sign in to manage notifications.';button.hidden=true;return;}
      button.hidden=false;
      button.textContent=settings.enabled?'Turn Off Notifications':'Turn On Notifications';
      label.textContent=!settings.enabled?'Off for this device. Messages are still available in Alygnn.':settings.permission==='granted'?'On for this device.':'Allow notifications in Android Settings → Apps → Alygnn → Notifications to receive alerts.';
    }
    button.addEventListener('click',async()=>{
      if(busy)return;
      busy=true;button.disabled=true;error.style.display='none';
      try{
        if(!window.AlygnnPush?.setEnabled)throw Error('Notification settings are still loading.');
        await window.AlygnnPush.setEnabled(!cached?.enabled);
      }catch(e){error.textContent=e?.message||'Could not save notification settings.';error.style.display='block';}
      finally{busy=false;button.disabled=false;await update();}
    });
    update();window.addEventListener('focus',update);
    window.addEventListener('alygnn-push-status',update);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
