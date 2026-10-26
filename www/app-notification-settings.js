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
    // Category preferences are per-account. Turning off push never hides the
    // corresponding event inside Alygnn, and security alerts stay mandatory.
    const employer=location.pathname.includes('employer');
    const prefs=document.createElement('div');
    prefs.id='alygnn-notification-category-preferences';
    prefs.style.cssText='margin-top:18px;border-top:1px solid var(--border,#DDE3E8);padding-top:14px';
    const header=document.createElement('div');
    header.style.cssText='font-weight:700;margin-bottom:5px';
    header.textContent='Notification preferences';
    const help=document.createElement('p');
    help.style.cssText='font-size:12px;line-height:1.5;opacity:.8;margin:0 0 12px';
    help.textContent='Choose which alerts reach your device. Your in-app notification history is always available.';
    prefs.append(header,help);
    const defs=employer?[
      ['messages','New candidate messages',true],
      ['new_applicants','New job applicants',true],
      ['job_updates','Job approvals, status and slot updates',true],
      ['billing','Billing and subscription updates',true],
      ['team_updates','Verification, team and company updates',true]
    ]:[
      ['messages','New employer messages',true],
      ['applications','Application decisions and status updates',true],
      ['job_updates','Important job status updates',true],
      ['recommendations','Recommended job matches',false]
    ];
    const rows=new Map();
    const prefError=document.createElement('div');
    prefError.style.cssText='color:var(--danger,#C74747);font-size:12px;margin-top:8px;display:none';
    for(const [key,title,defaultValue] of defs){
      const wrap=document.createElement('label');
      wrap.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0;font-size:13px;cursor:pointer';
      const titleEl=document.createElement('span');titleEl.textContent=title;
      const input=document.createElement('input');
      input.type='checkbox';input.checked=defaultValue;input.disabled=true;
      input.setAttribute('aria-label',title);
      wrap.append(titleEl,input);prefs.append(wrap);rows.set(key,input);
    }
    const security=document.createElement('div');
    security.style.cssText='font-size:12px;line-height:1.5;opacity:.8;margin-top:13px';
    security.textContent='Security notices are always saved in Alygnn and are not controlled by these switches.';
    prefs.append(security,prefError);
    card.append(prefs);
    let prefsUser='';
    let prefsDb=null;
    function client(){
      try{if(typeof sb!=='undefined'&&sb?.auth?.getSession)return sb;}catch(_){ }
      return window.sb||window.Alygnn?.sb||null;
    }
    async function refreshPrefs(){
      prefsDb=client();
      if(!prefsDb?.auth){prefs.style.display='none';return;}
      try{
        const {data:session,error:authError}=await prefsDb.auth.getSession();
        if(authError)throw authError;
        prefsUser=session?.session?.user?.id||'';
        if(!prefsUser){prefs.style.display='none';return;}
        prefs.style.display='block';
        const {data,error}=await prefsDb.from('notification_preferences')
          .select('*').eq('user_id',prefsUser).maybeSingle();
        if(error)throw error;
        for(const [key,,defaultValue] of defs){
          const control=rows.get(key);
          control.checked=data?.[key]??defaultValue;
          control.disabled=false;
        }
        prefError.style.display='none';
      }catch(error){
        // Uninstalled schema or RLS must not affect the existing device toggle.
        for(const control of rows.values())control.disabled=true;
        prefError.textContent='Notification preferences are unavailable. Device-level controls still work.';
        prefError.style.display='block';
      }
    }
    for(const [key,,defaultValue] of defs){
      const control=rows.get(key);
      control.addEventListener('change',async()=>{
        if(!prefsDb||!prefsUser)return;
        control.disabled=true;prefError.style.display='none';
        const before=!control.checked;
        try{
          const payload={user_id:prefsUser,[key]:Boolean(control.checked)};
          const {error}=await prefsDb.from('notification_preferences')
            .upsert(payload,{onConflict:'user_id'});
          if(error)throw error;
        }catch(error){
          control.checked=before;
          prefError.textContent='Could not save your preference. Please try again.';
          prefError.style.display='block';
        }finally{control.disabled=false;}
      });
    }
    refreshPrefs();
    window.addEventListener('focus',refreshPrefs);
    update();window.addEventListener('focus',update);
    window.addEventListener('alygnn-push-status',update);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
