/* Alygnn device notification permission settings. */
(function(){
  'use strict';
  function render(){
    if(document.getElementById('alygnn-permission-settings'))return;
    const candidate=location.pathname.endsWith('app-account-settings.html');
    const anchor=candidate ? Array.from(document.querySelectorAll('.section-label')).find(x=>x.textContent.trim()==='Notifications')?.closest('.section') : document.querySelector('main');
    if(!anchor)return;
    const card=document.createElement('div');card.id='alygnn-permission-settings';
    card.style.cssText='border:1px solid #DDE3E8;border-radius:14px;padding:16px;margin:15px 0;background:var(--card,#FCFCFA);color:var(--text,#1A2530);font-family:inherit';
    card.innerHTML='<div style="font-weight:700;margin-bottom:5px">Push Notifications</div><div id="alygnn-device-push-status" style="font-size:13px;opacity:.8;line-height:1.5;margin-bottom:12px">Checking this device…</div><button type="button" id="alygnn-device-push-enable" style="border:0;border-radius:9px;background:#5D7FA3;color:white;padding:11px 15px;font:600 13px inherit;cursor:pointer">Enable Notifications</button>';
    if(candidate)anchor.append(card);else anchor.insertBefore(card,anchor.firstChild);
    const label=card.querySelector('#alygnn-device-push-status');
    const btn=card.querySelector('#alygnn-device-push-enable');
    async function update(){
      const cap=window.Capacitor;
      if(!cap?.isNativePlatform?.()){label.textContent='Device push notifications are available in the installed Alygnn app.';btn.hidden=true;return;}
      const p=cap.Plugins?.PushNotifications || cap.registerPlugin?.('PushNotifications');
      if(!p){label.textContent='Push notifications are unavailable in this app build.';return;}
      try{
        const perm=await p.checkPermissions();
        if(perm.receive==='granted'){label.textContent='Notifications are allowed on this device.';btn.textContent='Refresh Registration';}
        else if(perm.receive==='denied'){label.textContent='Notifications are blocked. Go to your phone Settings → Apps → Alygnn → Notifications to enable them.';btn.textContent='Check Again';}
        else {label.textContent='Notifications are currently off. You can enable them here.';btn.textContent='Enable Notifications';}
      }catch(_){label.textContent='Unable to check notification permission.';}
    }
    btn.addEventListener('click',async()=>{btn.disabled=true;try{if(window.AlygnnPush?.enable)await window.AlygnnPush.enable();else label.textContent='Unable to initialize notification registration.';}finally{btn.disabled=false;await update();}});
    update();window.addEventListener('focus',update);
    window.addEventListener('alygnn-push-status',update);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
