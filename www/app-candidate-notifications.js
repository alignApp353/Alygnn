/* Alygnn candidate message notifications — v23.
   Tap the header bell for recent employer conversations; select one to open its chat.
   In-app only. This does not register device push notifications. */
(function () {
  'use strict';
  if (window.__alygnnCandidateNotifyV23 || window.__alygnnCandidateNotifyV22) return;
  window.__alygnnCandidateNotifyV23 = true;

  const urlRole = new URLSearchParams(location.search).get('role');
  if (urlRole === 'employer' || document.body?.classList.contains('employer-mode')) return;
  const bellSlot = document.getElementById('settings-shortcut');
  const header = document.querySelector('.my-jobs-header, header.top-header, header.app-header, header.topbar, .shell > .top, .topbar');
  if (!bellSlot && !header) return;
  const existingMessageBell = document.getElementById('employer-header-notification');
  if (existingMessageBell && urlRole !== 'employer') existingMessageBell.style.display='none';

  const css = `
    .alygnn-notify-trigger{appearance:none;box-sizing:border-box;border:1px solid var(--border,#DDE3E8);border-radius:50%;
      background:var(--card,#fff);color:var(--text,#172333);width:38px;height:38px;min-width:38px;display:grid;
      place-items:center;cursor:pointer;position:relative;padding:0;touch-action:manipulation;}
    .alygnn-notify-trigger svg{height:19px;width:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
    .alygnn-notify-trigger:focus-visible,.alygnn-notify-row:focus-visible,.alygnn-notify-close:focus-visible,
    .alygnn-notify-all:focus-visible{outline:2px solid #6D9BD0;outline-offset:3px;}
    .alygnn-notify-count{position:absolute;right:-5px;top:-5px;min-width:18px;height:18px;padding:0 4px;
      border-radius:12px;background:#BA4450;color:#fff;font:700 10px/18px system-ui,sans-serif;text-align:center;box-sizing:border-box;}
    .alygnn-notify-count[hidden],.alygnn-notify-backdrop[hidden],.alygnn-notify-sheet[hidden],.alygnn-notify-toast[hidden]{display:none!important;}
    .alygnn-notify-anchor{position:absolute;right:16px;top:50%;transform:translateY(-50%);z-index:5;}
    #settings-shortcut .alygnn-notify-trigger{margin:auto;}
    .alygnn-notify-backdrop{position:fixed;inset:0;z-index:29990;background:rgba(8,24,34,.57);}
    .alygnn-notify-sheet{position:fixed;z-index:29991;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));
      width:min(460px,calc(100vw - 24px));max-height:min(76dvh,680px);display:flex;flex-direction:column;overflow:hidden;
      border:1px solid #DDE3E8;border-radius:22px;background:#fff;color:#172333;
      box-shadow:0 18px 54px rgba(0,0,0,.27);font-family:inherit;box-sizing:border-box;}
    .alygnn-notify-head{padding:18px 18px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;
      border-bottom:1px solid #E5EAF0;flex-shrink:0;}
    .alygnn-notify-head strong{display:block;font-size:18px;font-weight:800;line-height:1.3;}
    .alygnn-notify-subtitle{display:block;font-size:12px;margin-top:4px;color:#627588;font-weight:500;}
    .alygnn-notify-close{appearance:none;width:32px;height:32px;min-width:32px;display:grid;place-items:center;
      border:1px solid #DDE3E8;border-radius:50%;background:transparent;color:inherit;cursor:pointer;font-size:23px;line-height:1;}
    .alygnn-notify-list{overflow-y:auto;overscroll-behavior:contain;min-height:75px;flex:1;}
    .alygnn-notify-row{box-sizing:border-box;appearance:none;background:transparent;color:inherit;border:0;
      border-bottom:1px solid #EDF0F3;width:100%;padding:15px 18px;display:flex;align-items:center;
      gap:12px;text-align:left;cursor:pointer;font:inherit;touch-action:manipulation;}
    .alygnn-notify-row:last-child{border-bottom:0;}
    .alygnn-notify-row:active{background:#EDF4FA;}
    .alygnn-notify-avatar{display:grid;place-items:center;flex:0 0 38px;height:38px;width:38px;border-radius:12px;
      background:#E8F0F7;color:#3B668F;font-size:12px;font-weight:800;}
    .alygnn-notify-body{flex:1;min-width:0;display:grid;gap:3px;}
    .alygnn-notify-title{font-size:13px;font-weight:750;line-height:1.35;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}
    .alygnn-notify-context,.alygnn-notify-preview{color:#627588;font-size:12px;line-height:1.38;
      white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}
    .alygnn-notify-preview{color:#405568;}
    .alygnn-notify-meta{align-self:flex-start;display:flex;flex-direction:column;align-items:flex-end;gap:7px;
      flex-shrink:0;color:#748798;font-size:10px;white-space:nowrap;}
    .alygnn-notify-dot{height:8px;width:8px;border-radius:50%;background:#5D7FA3;}
    .alygnn-notify-unread{background:rgba(93,127,163,.065);}
    .alygnn-notify-empty{padding:34px 22px;text-align:center;color:#627588;font-size:13px;line-height:1.6;}
    .alygnn-notify-empty-icon{margin:0 auto 12px;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;
      background:#EFF4F7;color:#587B9D;font-size:20px;}
    .alygnn-notify-empty strong{display:block;color:#172333;font-size:14px;margin-bottom:3px;}
    .alygnn-notify-foot{padding:12px 18px 16px;border-top:1px solid #E5EAF0;flex-shrink:0;}
    .alygnn-notify-all{border:0;width:100%;min-height:42px;border-radius:11px;background:#5D7FA3;
      color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;touch-action:manipulation;}
    .alygnn-notify-toast{position:fixed;z-index:31000;bottom:calc(92px + env(safe-area-inset-bottom));
      left:12px;right:12px;max-width:420px;margin:auto;display:flex;align-items:center;gap:12px;
      padding:12px 14px;background:#fff;color:#172333;border:1px solid #DDE3E8;border-left:4px solid #5D7FA3;
      border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.22);font:700 13px system-ui,sans-serif;}
    .alygnn-notify-toast span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .alygnn-notify-toast button{background:none;border:0;color:#3F6B96;font-weight:800;cursor:pointer;}
    html[data-effective-theme="dark"] .alygnn-notify-trigger,body[data-theme="dark"] .alygnn-notify-trigger{
      background:#102733;border-color:#345064;color:#D5E8F3;}
    html[data-effective-theme="dark"] .alygnn-notify-sheet,body[data-theme="dark"] .alygnn-notify-sheet,
    html[data-effective-theme="dark"] .alygnn-notify-toast,body[data-theme="dark"] .alygnn-notify-toast{
      background:#132C3A;border-color:#345064;color:#EFF7FA;}
    html[data-effective-theme="dark"] .alygnn-notify-head,html[data-effective-theme="dark"] .alygnn-notify-foot,
    body[data-theme="dark"] .alygnn-notify-head,body[data-theme="dark"] .alygnn-notify-foot{border-color:#345064;}
    html[data-effective-theme="dark"] .alygnn-notify-row,body[data-theme="dark"] .alygnn-notify-row{border-color:#345064;}
    html[data-effective-theme="dark"] .alygnn-notify-row:active,body[data-theme="dark"] .alygnn-notify-row:active{background:#1F3D50;}
    html[data-effective-theme="dark"] .alygnn-notify-unread,body[data-theme="dark"] .alygnn-notify-unread{background:#1A384A;}
    html[data-effective-theme="dark"] .alygnn-notify-avatar,body[data-theme="dark"] .alygnn-notify-avatar{
      background:#28465B;color:#D3E7F8;}
    html[data-effective-theme="dark"] .alygnn-notify-context,html[data-effective-theme="dark"] .alygnn-notify-subtitle,
    html[data-effective-theme="dark"] .alygnn-notify-empty,body[data-theme="dark"] .alygnn-notify-context,
    body[data-theme="dark"] .alygnn-notify-subtitle,body[data-theme="dark"] .alygnn-notify-empty{color:#B1C6D4;}
    html[data-effective-theme="dark"] .alygnn-notify-preview,body[data-theme="dark"] .alygnn-notify-preview{color:#D1E1EC;}
    html[data-effective-theme="dark"] .alygnn-notify-empty strong,body[data-theme="dark"] .alygnn-notify-empty strong{color:#EFF7FA;}
    html[data-effective-theme="dark"] .alygnn-notify-close,body[data-theme="dark"] .alygnn-notify-close{border-color:#345064;}
    @media(max-width:350px){.alygnn-notify-trigger{height:34px;width:34px;min-width:34px;}
      .alygnn-notify-sheet{width:calc(100vw - 12px);}.alygnn-notify-row{padding:13px 12px;}}
    @media(min-width:720px){.alygnn-notify-sheet{bottom:50%;transform:translate(-50%,50%);max-height:70dvh;}}
    @media(prefers-reduced-motion:reduce){.alygnn-notify-sheet,.alygnn-notify-row{scroll-behavior:auto;}}
  `;
  const style = document.createElement('style');
  style.id = 'alygnn-candidate-notifications-v23-style';
  style.textContent = css;
  document.head.append(style);

  const bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'alygnn-notify-trigger';
  bell.setAttribute('aria-label', 'Notifications');
  bell.setAttribute('aria-expanded', 'false');
  bell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
  const bellCount = document.createElement('span');
  bellCount.className = 'alygnn-notify-count';
  bellCount.hidden = true;
  bell.appendChild(bellCount);
  if (bellSlot) {
    bellSlot.removeAttribute('aria-hidden');
    bellSlot.appendChild(bell);
  } else {
    if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
    const anchor = document.createElement('div');
    anchor.className = 'alygnn-notify-anchor';
    anchor.appendChild(bell);
    header.appendChild(anchor);
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'alygnn-notify-backdrop';
  backdrop.hidden = true;
  const sheet = document.createElement('section');
  sheet.className = 'alygnn-notify-sheet';
  sheet.hidden = true;
  sheet.setAttribute('role','dialog');
  sheet.setAttribute('aria-modal','true');
  sheet.setAttribute('aria-label','Message notifications');
  sheet.innerHTML = '<div class="alygnn-notify-head"><div><strong>Notifications</strong><span class="alygnn-notify-subtitle">Recent employer messages</span></div><button class="alygnn-notify-close" type="button" aria-label="Close notifications">×</button></div><div class="alygnn-notify-list" aria-live="polite"></div><div class="alygnn-notify-foot"><button class="alygnn-notify-all" type="button">Open Messages</button></div>';
  document.body.append(backdrop, sheet);
  const list = sheet.querySelector('.alygnn-notify-list');
  const subtitle = sheet.querySelector('.alygnn-notify-subtitle');
  const toast = document.createElement('div');
  toast.className = 'alygnn-notify-toast';
  toast.hidden = true;
  toast.innerHTML = '<span>New message received</span><button type="button">View</button>';
  document.body.appendChild(toast);
  const closeButton = sheet.querySelector('.alygnn-notify-close');
  const messagesButton = sheet.querySelector('.alygnn-notify-all');
  const messagesHref = 'app-messages.html?role=candidate';
  messagesButton.addEventListener('click', () => { location.href = messagesHref; });
  toast.querySelector('button').addEventListener('click', () => { location.href = messagesHref; });
  const activeBeforeOpen = {element:null};
  function toggle(open) {
    sheet.hidden = !open;
    backdrop.hidden = !open;
    bell.setAttribute('aria-expanded', String(open));
    if (open) {
      activeBeforeOpen.element = document.activeElement;
      toast.hidden = true;
      closeButton.focus({preventScroll:true});
      refresh();
    } else if (activeBeforeOpen.element && typeof activeBeforeOpen.element.focus === 'function') {
      activeBeforeOpen.element.focus({preventScroll:true});
      activeBeforeOpen.element = null;
    }
  }
  bell.addEventListener('click', () => toggle(sheet.hidden));
  backdrop.addEventListener('click', () => toggle(false));
  closeButton.addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', event => {
    if (sheet.hidden) return;
    if (event.key === 'Escape') {event.preventDefault();toggle(false);}
    if (event.key === 'Tab') {
      const controls = Array.from(sheet.querySelectorAll('button:not([disabled])'));
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
    }
  });

  let userId = '';
  let knownMessageIds = null;
  let recentMessages = [];
  let lastCount = 0;
  let fetching = false;
  let needsRefresh = false;
  let toastTimer = null;
  let channel = null;
  let pollTimer = null;
  const messageBadge = () => document.getElementById('candidate-message-badge');
  const text = value => String(value ?? '').trim();
  const short = (value,length=130) => {
    const cleaned=text(value).replace(/\s+/g,' ');
    return cleaned.length>length ? cleaned.slice(0,length-1).trimEnd()+'…' : cleaned;
  };
  function stamp(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    const hours=(Date.now()-date.getTime())/3600000;
    if (hours>=0 && hours<1) return 'Now';
    if (hours<24 && hours>=0) return Math.max(1,Math.floor(hours))+'h';
    if (hours<168 && hours>=0) return Math.max(1,Math.floor(hours/24))+'d';
    return date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }
  function initials(value) {
    return text(value).split(/\s+/).slice(0,2).map(word=>word[0]||'').join('').toUpperCase()||'A';
  }
  function navigateTo(conversation) {
    const params = new URLSearchParams({role:'candidate',conversation:String(conversation.id)});
    if (conversation.application_id) params.set('application',String(conversation.application_id));
    location.href = 'app-chat.html?' + params.toString();
  }
  function empty(title,description){
    list.replaceChildren();
    const block = document.createElement('div');
    block.className = 'alygnn-notify-empty';
    const icon = document.createElement('div'); icon.className='alygnn-notify-empty-icon'; icon.textContent='✉';
    const heading = document.createElement('strong'); heading.textContent = title;
    const sub = document.createElement('div'); sub.textContent = description;
    block.append(icon,heading,sub);
    list.append(block);
  }
  function paint(count,threads) {
    lastCount=count;
    bellCount.hidden = count<=0;
    bellCount.textContent = count>99 ? '99+' : String(count);
    const nav = messageBadge();
    try {
      localStorage.setItem('alygnn_candidate_unread_messages_last',String(count));
      if(userId) localStorage.setItem('alygnn_candidate_unread_messages:'+userId,String(count));
    } catch (_) {}
    if (nav) {nav.textContent = count>99 ? '99+' : String(count);nav.hidden=count<=0;}
    subtitle.textContent=count ? `${count} unread message${count===1?'':'s'} · Recent employer conversations` : 'Recent employer messages';
    if (!threads.length) {
      empty('No messages yet','When an employer sends you a message, it will appear here.');
      return;
    }
    list.replaceChildren();
    for (const thread of threads) {
      const conversation=thread.conversation;
      const message=thread.message;
      const unread=thread.unreadCount>0;
      const company=text(conversation.recruiter_name)||text(conversation.company_name)||
        text(conversation.employer_name)||text(conversation.contact_name)||text(conversation.sender_name)||'Employer';
      const job=text(conversation.job_title)||'Job application';
      const row=document.createElement('button');
      row.type='button';
      row.className='alygnn-notify-row'+(unread?' alygnn-notify-unread':'');
      row.setAttribute('aria-label',`Open conversation with ${company} about ${job}`);
      const avatar=document.createElement('div');avatar.className='alygnn-notify-avatar';avatar.textContent=initials(company);
      const body=document.createElement('span');body.className='alygnn-notify-body';
      const title=document.createElement('span');title.className='alygnn-notify-title';title.textContent=company;
      const context=document.createElement('span');context.className='alygnn-notify-context';context.textContent=job;
      const preview=document.createElement('span');preview.className='alygnn-notify-preview';preview.textContent=short(message.body)||'New employer message';
      body.append(title,context,preview);
      const meta=document.createElement('span');meta.className='alygnn-notify-meta';
      const time=document.createElement('span');time.textContent=stamp(message.created_at);meta.append(time);
      if(unread){const dot=document.createElement('span');dot.className='alygnn-notify-dot';dot.setAttribute('aria-label',`${thread.unreadCount} unread`);meta.append(dot);}
      row.append(avatar,body,meta);
      row.addEventListener('click',()=>navigateTo(conversation));
      list.append(row);
    }
  }
  function announce(thread){
    if (document.visibilityState !== 'visible' || !sheet.hidden) return;
    const conversation=thread?.conversation;
    toast.querySelector('span').textContent=conversation?.company_name ? `New message from ${short(conversation.company_name,36)}`:'New employer message';
    const action=toast.querySelector('button');
    action.onclick=()=>conversation?navigateTo(conversation):location.href=messagesHref;
    toast.hidden=false;
    if(toastTimer)clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{toast.hidden=true;},6000);
  }
  async function refresh(){
    if(fetching){needsRefresh=true;return;}
    if(typeof sb==='undefined')return;
    fetching=true;
    try {
      const {data,error}=await sb.auth.getSession();
      if(error)throw error;
      const id=data?.session?.user?.id||'';
      if(id!==userId){knownMessageIds=null;userId=id;}
      if(!id){recentMessages=[];paint(0,[]);return;}
      const conversationResult=await sb.from('application_conversations').select('*')
        .eq('candidate_id',id).is('candidate_hidden_at',null);
      if(conversationResult.error)throw conversationResult.error;
      const conversations=conversationResult.data||[];
      const ids=conversations.map(c=>c.id).filter(Boolean);
      if(!ids.length){recentMessages=[];knownMessageIds=new Set();paint(0,[]);return;}
      const [unreadResult,recentResult]=await Promise.all([
        sb.from('application_messages').select('id,conversation_id',{count:'exact'})
          .in('conversation_id',ids).neq('sender_id',id).is('read_at',null).limit(1000),
        sb.from('application_messages').select('id,conversation_id,body,created_at,read_at')
          .in('conversation_id',ids).neq('sender_id',id).order('created_at',{ascending:false}).limit(100)
      ]);
      if(unreadResult.error)throw unreadResult.error;
      if(recentResult.error)throw recentResult.error;
      const unreadCount=unreadResult.count??(unreadResult.data||[]).length;
      const countByConversation=new Map();
      for(const unread of unreadResult.data||[]){
        const key=String(unread.conversation_id);
        countByConversation.set(key,(countByConversation.get(key)||0)+1);
      }
      const byConversation=new Map(conversations.map(c=>[String(c.id),c]));
      const received=recentResult.data||[];
      const newestIds=new Set(received.map(m=>String(m.id)));
      const threadMap=new Map();
      for(const message of received){
        const key=String(message.conversation_id);
        if(threadMap.has(key)||!byConversation.has(key))continue;
        threadMap.set(key,{message,conversation:byConversation.get(key),unreadCount:countByConversation.get(key)||0});
      }
      const threads=Array.from(threadMap.values())
        .sort((a,b)=>(b.unreadCount>0)-(a.unreadCount>0) || new Date(b.message.created_at)-new Date(a.message.created_at)).slice(0,12);
      if(knownMessageIds){
        const firstNew=threads.find(thread=>!knownMessageIds.has(String(thread.message.id)) && !thread.message.read_at);
        if(firstNew)announce(firstNew);
      }
      knownMessageIds=newestIds;
      recentMessages=threads;
      paint(unreadCount,threads);
    }catch(error){
      console.warn('Alygnn candidate notifications could not refresh:',error);
      if(!sheet.hidden && !recentMessages.length){empty('Messages unavailable','Open Messages to try again.');}
      // Keep last known count; never display a false zero on a connection error.
    }finally{
      fetching=false;
      if(needsRefresh){needsRefresh=false;refresh();}
    }
  }
  window.AlygnnRefreshCandidateMessageBadge=refresh;
  async function connectRealtime(){
    try {
      if(typeof sb==='undefined')return;
      const {data}=await sb.auth.getSession();
      const id=data?.session?.user?.id;
      if(!id)return;
      channel=sb.channel('alygnn-candidate-notifications-v23-'+id+'-'+Math.random().toString(36).slice(2))
        .on('postgres_changes',{event:'*',schema:'public',table:'application_messages'},refresh)
        .on('postgres_changes',{event:'*',schema:'public',table:'application_conversations'},refresh)
        .subscribe();
    }catch(error){console.warn('Candidate realtime notifications unavailable, using refresh fallback.',error);}
  }
  empty('Checking messages','Looking for your recent employer conversations.');
  refresh();connectRealtime();
  pollTimer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},15000);
  window.addEventListener('focus',refresh);
  window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
  window.addEventListener('pagehide',()=>{
    if(pollTimer)clearInterval(pollTimer);
    if(toastTimer)clearTimeout(toastTimer);
    if(channel && typeof sb!=='undefined'){try{sb.removeChannel(channel);}catch(_){}}
  },{once:true});
})();
