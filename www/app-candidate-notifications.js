/* Alygnn candidate in-app message notifications — v22.
   Only the candidate-side header bell, live unread count and in-app alert.
   No device-level push notifications are claimed or registered here. */
(function(){
  'use strict';
  if (window.__alygnnCandidateNotifyV22) return;
  window.__alygnnCandidateNotifyV22 = true;

  const urlRole = new URLSearchParams(location.search).get('role');
  if (urlRole === 'employer' || document.body?.classList.contains('employer-mode')) return;

  const notificationCss = `
    .alygnn-notify-trigger{appearance:none;border:1px solid var(--border,#DDE3E8);
      border-radius:50%;background:var(--card,#fff);color:var(--text,#172333);
      width:38px;height:38px;min-width:38px;display:grid;place-items:center;
      cursor:pointer;position:relative;padding:0;box-sizing:border-box;}
    .alygnn-notify-trigger svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
    .alygnn-notify-count{position:absolute;top:-5px;right:-6px;min-width:17px;height:17px;padding:0 4px;
      border-radius:9px;background:#BA4450;color:white;font:700 10px/17px system-ui,sans-serif;text-align:center;box-sizing:border-box;}
    .alygnn-notify-count[hidden],.alygnn-notify-panel[hidden],.alygnn-notify-toast[hidden]{display:none!important;}
    .alygnn-notify-anchor{position:absolute;right:16px;top:50%;transform:translateY(-50%);z-index:5;}
    #settings-shortcut .alygnn-notify-trigger{margin:auto;}
    .alygnn-notify-panel{position:fixed;z-index:30000;right:12px;top:calc(66px + env(safe-area-inset-top));
      width:min(380px,calc(100vw - 24px));max-height:min(65vh,500px);overflow:auto;
      background:var(--card,#fff);color:var(--text,#172333);border:1px solid var(--border,#DDE3E8);
      border-radius:18px;padding:16px;box-shadow:0 16px 42px rgba(0,0,0,.2);box-sizing:border-box;
      font-family:inherit;}
    .alygnn-notify-panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;}
    .alygnn-notify-panel-title{font-size:16px;font-weight:800;}
    .alygnn-notify-panel-close{border:0;background:transparent;color:inherit;font-size:25px;line-height:1;cursor:pointer;}
    .alygnn-notify-panel-copy{font-size:13px;line-height:1.5;margin:10px 0;color:var(--muted,#66788A);}
    .alygnn-notify-item{padding:11px 0;border-top:1px solid var(--border,#DDE3E8);font-size:13px;}
    .alygnn-notify-item time{font-size:11px;color:var(--muted,#66788A);display:block;margin-top:3px;}
    .alygnn-notify-view{background:#5D7FA3;color:#fff;border:0;border-radius:10px;
      padding:11px 14px;width:100%;font:700 13px system-ui,sans-serif;cursor:pointer;margin-top:8px;}
    .alygnn-notify-toast{position:fixed;z-index:31000;left:12px;right:12px;
      bottom:calc(92px + env(safe-area-inset-bottom));max-width:400px;margin:auto;
      background:var(--card,#fff);color:var(--text,#172333);border:1px solid var(--border,#DDE3E8);
      border-left:4px solid #5D7FA3;border-radius:13px;box-shadow:0 12px 36px rgba(0,0,0,.22);
      padding:13px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;
      font:700 13px system-ui,sans-serif;box-sizing:border-box;}
    .alygnn-notify-toast button{background:none;border:0;color:#5D7FA3;font-weight:800;cursor:pointer;}
    html[data-effective-theme="dark"] .alygnn-notify-trigger,
    body[data-theme="dark"] .alygnn-notify-trigger{background:#102733;border-color:#345064;color:#D5E8F3;}
    html[data-effective-theme="dark"] .alygnn-notify-panel,
    body[data-theme="dark"] .alygnn-notify-panel,
    html[data-effective-theme="dark"] .alygnn-notify-toast,
    body[data-theme="dark"] .alygnn-notify-toast{background:#132C3A;border-color:#345064;color:#EFF7FA;}
    @media(max-width:350px){.alygnn-notify-trigger{height:34px;width:34px;min-width:34px;}}
  `;
  const style=document.createElement('style');
  style.id='alygnn-candidate-notifications-v22-style';
  style.textContent=notificationCss;
  document.head.append(style);

  const bell=document.createElement('button');
  bell.className='alygnn-notify-trigger';bell.type='button';
  bell.setAttribute('aria-label','Notifications');
  bell.setAttribute('aria-expanded','false');
  bell.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
  const bellCount=document.createElement('span');
  bellCount.className='alygnn-notify-count';bellCount.hidden=true;
  bell.appendChild(bellCount);
  const headerSlot=document.getElementById('settings-shortcut');
  if (headerSlot) {
    headerSlot.removeAttribute('aria-hidden');
    headerSlot.appendChild(bell);
  } else {
    const header=document.querySelector('.my-jobs-header, header.top-header, header.app-header');
    if(header){
      if(getComputedStyle(header).position==='static')header.style.position='relative';
      const anchor=document.createElement('div');anchor.className='alygnn-notify-anchor';
      anchor.appendChild(bell);header.appendChild(anchor);
    }
  }

  const panel=document.createElement('section');
  panel.className='alygnn-notify-panel';panel.hidden=true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Candidate notifications');
  panel.innerHTML='<div class="alygnn-notify-panel-header"><span class="alygnn-notify-panel-title">Notifications</span><button type="button" class="alygnn-notify-panel-close" aria-label="Close notifications">×</button></div><p class="alygnn-notify-panel-copy">Checking for new messages…</p><div class="alygnn-notify-items"></div><button type="button" class="alygnn-notify-view">View messages</button>';
  document.body.appendChild(panel);
  const toast=document.createElement('div');toast.className='alygnn-notify-toast';toast.hidden=true;
  toast.innerHTML='<span>New message received</span><button type="button">View</button>';
  document.body.appendChild(toast);
  const gotoMessages=()=>{location.href='app-messages.html?role=candidate';};
  panel.querySelector('.alygnn-notify-view').addEventListener('click',gotoMessages);
  toast.querySelector('button').addEventListener('click',gotoMessages);
  panel.querySelector('.alygnn-notify-panel-close').addEventListener('click',()=>togglePanel(false));
  function togglePanel(open){
    panel.hidden=!open;
    bell.setAttribute('aria-expanded',String(open));
    if(open) {toast.hidden=true;refresh();}
  }
  bell.addEventListener('click',()=>togglePanel(panel.hidden));
  document.addEventListener('click',event=>{
    if(!panel.hidden && !panel.contains(event.target) && !bell.contains(event.target)) togglePanel(false);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')togglePanel(false);});

  let idOfUser='';let knownIds=null;let latest=[];let loading=false;let rerun=false;
  let toastHide=null;let channel=null;let timer=null;
  const badge=()=>document.getElementById('candidate-message-badge');
  function paint(messages){
    const count=messages.length;
    bellCount.hidden=count===0;bellCount.textContent=count>99?'99+':String(count);
    const nav=badge();
    // Write caches *before* hiding the old badge: older pages observe that DOM mutation.
    try{
      localStorage.setItem('alygnn_candidate_unread_messages_last',String(count));
      if(idOfUser)localStorage.setItem('alygnn_candidate_unread_messages:'+idOfUser,String(count));
    }catch(_){}
    if(nav){nav.textContent=count>99?'99+':String(count);nav.hidden=count===0;}
    panel.querySelector('.alygnn-notify-panel-copy').textContent=
      count===0?'You have no unread messages.':`${count} unread message${count===1?'':'s'}`;
    const items=panel.querySelector('.alygnn-notify-items');items.replaceChildren();
    for(const item of messages.slice(0,5)){
      const row=document.createElement('div');row.className='alygnn-notify-item';
      const label=document.createElement('strong');label.textContent='New message';row.append(label);
      if(item.created_at){
        const time=document.createElement('time');
        const date=new Date(item.created_at);
        time.textContent=Number.isNaN(+date)?'':date.toLocaleString();
        row.append(time);
      }
      items.append(row);
    }
  }
  function announce(){
    if(document.visibilityState!=='visible')return;
    toast.hidden=false;
    if(toastHide)clearTimeout(toastHide);
    toastHide=setTimeout(()=>{toast.hidden=true;},6000);
  }
  async function refresh(){
    if(loading){rerun=true;return;}
    if(typeof sb==='undefined')return;
    loading=true;
    try{
      const {data:session,error:authError}=await sb.auth.getSession();
      if(authError)throw authError;
      const id=session?.session?.user?.id||'';
      if(id!==idOfUser){knownIds=null;idOfUser=id;}
      if(!id){knownIds=null;latest=[];paint([]);return;}
      const conversations=await sb.from('application_conversations').select('id').eq('candidate_id',id);
      if(conversations.error)throw conversations.error;
      const ids=(conversations.data||[]).map(x=>x.id).filter(Boolean);
      let messages=[];
      if(ids.length){
        // Keep the same unread criteria used by Alygnn's Messages page.
        const result=await sb.from('application_messages').select('id,conversation_id,created_at')
          .in('conversation_id',ids).neq('sender_id',id).is('read_at',null)
          .order('created_at',{ascending:false});
        if(result.error)throw result.error;
        messages=result.data||[];
      }
      const now=new Set(messages.map(x=>String(x.id)));
      if(knownIds && messages.some(x=>!knownIds.has(String(x.id))))announce();
      knownIds=now;latest=messages;paint(latest);
    }catch(err){
      console.warn('Alygnn candidate notifications could not refresh:',err);
      panel.querySelector('.alygnn-notify-panel-copy').textContent=
        'Could not refresh messages. Open Messages to try again.';
      // Do not overwrite the last known count with false zeros when offline.
    }finally{
      loading=false;
      if(rerun){rerun=false;refresh();}
    }
  }
  window.AlygnnRefreshCandidateMessageBadge=refresh;
  async function connectRealtime(){
    try{
      if(typeof sb==='undefined')return;
      const {data}=await sb.auth.getSession();
      const id=data?.session?.user?.id;
      if(!id)return;
      channel=sb.channel('alygnn-candidate-notifications-v22-'+id+'-'+Math.random().toString(36).slice(2))
        .on('postgres_changes',{event:'*',schema:'public',table:'application_messages'},refresh)
        .on('postgres_changes',{event:'*',schema:'public',table:'application_conversations'},refresh)
        .subscribe();
    }catch(err){console.warn('Candidate realtime notifications unavailable; polling remains enabled.',err);}
  }
  refresh();connectRealtime();
  // Fallback if database Realtime isn't enabled. Only runs on the currently open page.
  timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},15000);
  window.addEventListener('focus',refresh);
  window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
  window.addEventListener('pagehide',()=>{
    if(timer)clearInterval(timer);
    if(toastHide)clearTimeout(toastHide);
    if(channel && typeof sb!=='undefined') {try{sb.removeChannel(channel);}catch(_){}}
  },{once:true});
})();
