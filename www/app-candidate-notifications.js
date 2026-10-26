/* Alygnn candidate notification center — v25.
   Existing message conversations plus the candidate's Supabase notifications.
   In-app only. This does not register device push notifications. */
(function () {
  'use strict';
  if (window.__alygnnCandidateNotifyV25 || window.__alygnnCandidateNotifyV23 || window.__alygnnCandidateNotifyV22) return;
  window.__alygnnCandidateNotifyV25 = true;

  const urlRole = new URLSearchParams(location.search).get('role');
  if (urlRole === 'employer' || document.body?.classList.contains('employer-mode')) return;
  const bellSlot = document.getElementById('settings-shortcut');
  const header = document.querySelector('.my-jobs-header, header.top-header, header.app-header, header.topbar, .shell > .top, .topbar');
  if (!bellSlot && !header) return;
  const existingMessageBell = document.getElementById('employer-header-notification');
  if (existingMessageBell && urlRole !== 'employer') existingMessageBell.style.display='none';

  // Reuse My Profile's real header geometry. Never force all five different
  // headers to flex: that breaks safe-area spacing and their grid positioning.
  const shellCSS = document.createElement('style');
  shellCSS.id = 'alygnn-candidate-header-alignment-v2';
  shellCSS.textContent = `
    /* The profile header is the reference; leave its original layout alone. */
    header.top-header:not(.app-header), header.my-jobs-header,
    body.candidate-mode .shell > .top {
      position:relative!important;
      min-height:86px!important;
      box-sizing:border-box!important;
      display:grid!important;
      grid-template-columns:46px minmax(0,1fr) 46px!important;
      align-items:center!important;
      padding:calc(12px + env(safe-area-inset-top)) 18px 12px!important;
      border-bottom:1px solid #29404c!important;
    }
    header.top-header:not(.app-header){margin:0!important;}
    header.my-jobs-header{margin:0!important;width:100%!important;}
    body.candidate-mode .shell > .top{margin:0 -18px!important;width:auto!important;}
    header.top-header:not(.app-header) .brand-block {grid-column:2!important;grid-row:1!important;display:block!important;min-width:0!important;}
    header.top-header:not(.app-header) .brand-block .tagline{display:none!important;}
    header.top-header:not(.app-header) .brand-block .logo,
    header.my-jobs-header .my-jobs-wordmark,
    body.candidate-mode .shell > .top .logo{
      position:static!important;transform:none!important;margin:0!important;
      font-family:'DM Serif Display',Georgia,serif!important;font-size:31px!important;
      font-weight:400!important;line-height:1!important;letter-spacing:-.7px!important;
      text-align:center!important;white-space:nowrap!important;
    }
    header.my-jobs-header .my-jobs-wordmark-wrap{grid-column:2!important;grid-row:1!important;display:flex!important;justify-content:center!important;min-width:0!important;}
    header.my-jobs-header .my-jobs-profile-button,
    header.top-header:not(.app-header) .profile-chip {display:none!important;}
    body.candidate-mode .shell > .top .back{visibility:hidden!important;pointer-events:none!important;}
    body.candidate-mode .shell > .top .logo{grid-column:2!important;grid-row:1!important;}
    header.topbar .logo{position:static!important;transform:none!important;}
    .alygnn-notify-anchor{
      position:absolute!important;right:18px!important;
      top:calc(50% + env(safe-area-inset-top) / 2)!important;
      transform:translateY(-50%)!important;z-index:8!important;
    }
    /* No second bell: My Profile already reserves a third header column. */
    header.app-header #settings-shortcut{position:static!important;transform:none!important;grid-column:3!important;grid-row:1!important;
      display:grid!important;place-items:center!important;justify-self:center!important;}
    .alygnn-notify-trigger{width:38px!important;height:38px!important;min-width:38px!important;}
  `;
  document.head.appendChild(shellCSS);

  const css = `
    .alygnn-notify-trigger{appearance:none;box-sizing:border-box;border:1px solid var(--border,#DDE3E8);border-radius:50%;
      background:var(--card,#fff);color:var(--text,#172333);width:38px;height:38px;min-width:38px;display:grid;
      place-items:center;cursor:pointer;position:relative;padding:0;touch-action:manipulation;}
    .alygnn-notify-trigger svg{height:19px;width:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
    .alygnn-notify-trigger:focus-visible,.alygnn-notify-row:focus-visible,.alygnn-notify-close:focus-visible,
    .alygnn-notify-filter:focus-visible,.alygnn-notify-mark:focus-visible{outline:2px solid #7CA6CF;outline-offset:2px;}
    .alygnn-notify-count{position:absolute;right:-5px;top:-5px;min-width:18px;height:18px;padding:0 4px;
      border-radius:12px;background:#B45163;color:#fff;font:700 10px/18px system-ui,sans-serif;text-align:center;box-sizing:border-box;}
    .alygnn-notify-count[hidden],.alygnn-notify-backdrop[hidden],.alygnn-notify-sheet[hidden],.alygnn-notify-toast[hidden],
    .alygnn-notify-mark[hidden]{display:none!important;}
    .alygnn-notify-anchor{position:absolute;right:16px;top:50%;transform:translateY(-50%);z-index:5;}
    #settings-shortcut .alygnn-notify-trigger{margin:auto;}
    .alygnn-notify-backdrop{position:fixed;inset:0;z-index:29990;background:rgba(4,16,23,.70);backdrop-filter:blur(3px);}
    .alygnn-notify-sheet{position:fixed;z-index:29991;left:50%;transform:translateX(-50%);
      bottom:calc(8px + env(safe-area-inset-bottom));width:min(510px,calc(100vw - 16px));
      max-height:min(84dvh,810px);display:flex;flex-direction:column;overflow:hidden;
      border:1px solid #DDE4E9;border-radius:23px;background:#FCFCFA;color:#1A2530;
      box-shadow:0 28px 72px rgba(0,0,0,.28);font-family:inherit;box-sizing:border-box;}
    .alygnn-notify-head{padding:22px 22px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0;}
    .alygnn-notify-heading{display:flex;gap:12px;align-items:center;min-width:0;}
    .alygnn-notify-symbol{height:43px;width:43px;display:grid;place-items:center;flex-shrink:0;border-radius:14px;
      background:#E9EFF5;color:#476D90;}
    .alygnn-notify-symbol svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round;}
    .alygnn-notify-head strong{display:block;font-size:21px;font-weight:750;letter-spacing:-.4px;line-height:1.2;}
    .alygnn-notify-subtitle{display:block;font-size:12px;margin-top:5px;color:#6C7D89;line-height:1.4;font-weight:500;}
    .alygnn-notify-close{appearance:none;width:35px;height:35px;min-width:35px;display:grid;place-items:center;
      border:1px solid #DFE6EB;border-radius:50%;background:#F4F7F8;color:#476070;cursor:pointer;font-size:23px;line-height:1;}
    .alygnn-notify-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:0 22px 14px;border-bottom:1px solid #E6EBEE;flex-shrink:0;}
    .alygnn-notify-tabs{display:flex;align-items:center;gap:3px;background:#EEF2F4;padding:4px;border-radius:12px;}
    .alygnn-notify-filter{appearance:none;border:0;cursor:pointer;background:transparent;color:#697B89;
      padding:8px 16px;min-height:35px;border-radius:9px;font-family:inherit;font-weight:650;font-size:12px;line-height:1.2;white-space:nowrap;}
    .alygnn-notify-filter[aria-selected="true"]{background:#fff;color:#233C52;box-shadow:0 1px 5px rgba(26,37,48,.11);}
    .alygnn-notify-tabcount{margin-left:4px;color:#5D7FA3;font-weight:800;}
    .alygnn-notify-mark{appearance:none;border:0;background:none;padding:7px 0;color:#4B7499;
      font-family:inherit;font-weight:700;font-size:12px;line-height:1.3;cursor:pointer;text-align:right;}
    .alygnn-notify-mark:disabled{opacity:.5;cursor:default;}
    .alygnn-notify-list{overflow-y:auto;overscroll-behavior:contain;min-height:125px;flex:1;
      scrollbar-width:thin;}
    .alygnn-notify-section{padding:18px 22px 8px;text-transform:uppercase;letter-spacing:1.25px;
      font:750 10px/1.4 system-ui,sans-serif;color:#84939F;}
    .alygnn-notify-row{box-sizing:border-box;appearance:none;background:transparent;color:inherit;border:0;
      border-bottom:1px solid #EDF1F3;width:100%;padding:16px 22px;display:flex;align-items:flex-start;
      gap:13px;text-align:left;cursor:pointer;font:inherit;touch-action:manipulation;min-height:85px;}
    .alygnn-notify-row:last-child{border-bottom:0;}
    .alygnn-notify-row:active{background:#E9F1F6;}
    .alygnn-notify-row.alygnn-notify-unread{background:rgba(93,127,163,.055);}
    .alygnn-notify-avatar{display:grid;place-items:center;flex:0 0 43px;height:43px;width:43px;border-radius:13px;
      background:#E7EFF5;color:#426888;font-size:13px;font-weight:800;}
    .alygnn-notify-avatar[data-kind="application"]{background:#E5F2EA;color:#397B55;}
    .alygnn-notify-avatar[data-kind="security"]{background:#F3EAF1;color:#88587B;}
    .alygnn-notify-avatar[data-kind="job"]{background:#E9EDF8;color:#4E65A0;}
    .alygnn-notify-body{flex:1;min-width:0;display:grid;gap:4px;padding-top:1px;}
    .alygnn-notify-type{font-size:10px;font-weight:750;color:#5D7FA3;letter-spacing:.5px;text-transform:uppercase;line-height:1.35;}
    .alygnn-notify-title{font-size:13px;font-weight:750;line-height:1.35;overflow-wrap:anywhere;}
    .alygnn-notify-context,.alygnn-notify-preview{color:#667989;font-size:12px;line-height:1.48;
      display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;}
    .alygnn-notify-preview{color:#44596A;}
    .alygnn-notify-meta{align-self:flex-start;display:flex;flex-direction:column;align-items:flex-end;gap:9px;
      flex-shrink:0;color:#8797A2;font-size:10px;white-space:nowrap;padding-top:3px;}
    .alygnn-notify-dot{height:8px;width:8px;border-radius:50%;background:#5D7FA3;}
    .alygnn-notify-empty{padding:52px 28px;text-align:center;color:#6B7D89;font-size:13px;line-height:1.6;}
    .alygnn-notify-empty-icon{margin:0 auto 13px;display:grid;place-items:center;width:49px;height:49px;border-radius:15px;
      background:#EFF3F6;color:#587B9D;font-size:18px;font-weight:800;}
    .alygnn-notify-empty strong{display:block;color:#223849;font-size:14px;margin-bottom:4px;}
    .alygnn-notify-foot{padding:14px 22px 16px;border-top:1px solid #E6EBEE;flex-shrink:0;
      background:#F8FAFA;display:flex;align-items:center;justify-content:space-between;gap:12px;}
    .alygnn-notify-footnote{color:#82939E;font-size:11px;line-height:1.4;}
    .alygnn-notify-footlink{appearance:none;border:1px solid #CBD7DF;background:#fff;color:#426C91;
      border-radius:10px;padding:10px 12px;font-family:inherit;font-weight:750;font-size:12px;line-height:1.2;cursor:pointer;white-space:nowrap;}
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
      background:#112C3A;border-color:#294A5A;color:#EDF4F6;}
    html[data-effective-theme="dark"] .alygnn-notify-symbol,body[data-theme="dark"] .alygnn-notify-symbol{
      background:#203F50;color:#AFCCE0;}
    html[data-effective-theme="dark"] .alygnn-notify-close,body[data-theme="dark"] .alygnn-notify-close{
      background:#1B3849;border-color:#345466;color:#D3E3EA;}
    html[data-effective-theme="dark"] .alygnn-notify-toolbar,html[data-effective-theme="dark"] .alygnn-notify-foot,
    body[data-theme="dark"] .alygnn-notify-toolbar,body[data-theme="dark"] .alygnn-notify-foot{
      border-color:#2D4958;}
    html[data-effective-theme="dark"] .alygnn-notify-tabs,body[data-theme="dark"] .alygnn-notify-tabs{
      background:#092330;}
    html[data-effective-theme="dark"] .alygnn-notify-filter,body[data-theme="dark"] .alygnn-notify-filter{
      color:#A8C0D0;}
    html[data-effective-theme="dark"] .alygnn-notify-filter[aria-selected="true"],
    body[data-theme="dark"] .alygnn-notify-filter[aria-selected="true"]{background:#2A4A5D;color:#fff;box-shadow:none;}
    html[data-effective-theme="dark"] .alygnn-notify-row,body[data-theme="dark"] .alygnn-notify-row{border-color:#294552;}
    html[data-effective-theme="dark"] .alygnn-notify-row.alygnn-notify-unread,
    body[data-theme="dark"] .alygnn-notify-row.alygnn-notify-unread{background:rgba(140,182,155,.055);}
    html[data-effective-theme="dark"] .alygnn-notify-row:active,body[data-theme="dark"] .alygnn-notify-row:active{background:#1A4051;}
    html[data-effective-theme="dark"] .alygnn-notify-avatar,body[data-theme="dark"] .alygnn-notify-avatar{
      background:#234B62;color:#BBD9EB;}
    html[data-effective-theme="dark"] .alygnn-notify-avatar[data-kind="application"],body[data-theme="dark"] .alygnn-notify-avatar[data-kind="application"]{background:#21493D;color:#C4E8CC;}
    html[data-effective-theme="dark"] .alygnn-notify-avatar[data-kind="security"],body[data-theme="dark"] .alygnn-notify-avatar[data-kind="security"]{background:#513849;color:#F2C7E1;}
    html[data-effective-theme="dark"] .alygnn-notify-avatar[data-kind="job"],body[data-theme="dark"] .alygnn-notify-avatar[data-kind="job"]{background:#35446B;color:#C5D4FC;}
    html[data-effective-theme="dark"] .alygnn-notify-title,body[data-theme="dark"] .alygnn-notify-title{color:#EDF5F9;}
    html[data-effective-theme="dark"] .alygnn-notify-type,html[data-effective-theme="dark"] .alygnn-notify-mark,
    body[data-theme="dark"] .alygnn-notify-type,body[data-theme="dark"] .alygnn-notify-mark{color:#A4C9E4;}
    html[data-effective-theme="dark"] .alygnn-notify-context,html[data-effective-theme="dark"] .alygnn-notify-preview,
    html[data-effective-theme="dark"] .alygnn-notify-subtitle,html[data-effective-theme="dark"] .alygnn-notify-empty,
    body[data-theme="dark"] .alygnn-notify-context,body[data-theme="dark"] .alygnn-notify-preview,
    body[data-theme="dark"] .alygnn-notify-subtitle,body[data-theme="dark"] .alygnn-notify-empty{color:#B2C4D0;}
    html[data-effective-theme="dark"] .alygnn-notify-empty strong,body[data-theme="dark"] .alygnn-notify-empty strong{color:#EDF5F9;}
    html[data-effective-theme="dark"] .alygnn-notify-foot,body[data-theme="dark"] .alygnn-notify-foot{background:#102631;}
    html[data-effective-theme="dark"] .alygnn-notify-footlink,body[data-theme="dark"] .alygnn-notify-footlink{
      background:#1F4053;border-color:#476476;color:#DCECF6;}
    @media(max-width:350px){.alygnn-notify-sheet{width:calc(100vw - 8px);}.alygnn-notify-head{padding:15px 14px;}
      .alygnn-notify-toolbar{padding:0 14px 12px;}.alygnn-notify-row{padding:13px 14px;}}
    @media(min-width:720px){.alygnn-notify-sheet{bottom:50%;transform:translate(-50%,50%);width:min(580px,calc(100vw - 60px));
      max-height:min(77dvh,840px);border-radius:24px;}.alygnn-notify-row{min-height:91px;}}
    @media(prefers-reduced-motion:reduce){.alygnn-notify-sheet,.alygnn-notify-row{scroll-behavior:auto;}}
  `;
  const style = document.createElement('style');
  style.id = 'alygnn-candidate-notifications-v25-style';
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
  sheet.setAttribute('aria-label','Notifications');
  sheet.innerHTML = `<div class="alygnn-notify-head"><div class="alygnn-notify-heading"><span class="alygnn-notify-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></span><div><strong>Notifications</strong><span class="alygnn-notify-subtitle">Messages, applications and account updates</span></div></div><button class="alygnn-notify-close" type="button" aria-label="Close notifications">×</button></div><div class="alygnn-notify-toolbar"><div class="alygnn-notify-tabs" role="tablist" aria-label="Filter notifications"><button class="alygnn-notify-filter" type="button" role="tab" aria-selected="true" data-filter="all">All</button><button class="alygnn-notify-filter" type="button" role="tab" aria-selected="false" data-filter="unread">Unread <span class="alygnn-notify-tabcount"></span></button></div><button class="alygnn-notify-mark" type="button">Mark all read</button></div><div class="alygnn-notify-list" aria-live="polite"></div><div class="alygnn-notify-foot"><span class="alygnn-notify-footnote">Select a notification to view its details</span><button class="alygnn-notify-footlink" type="button">My Jobs</button></div>`;
  document.body.append(backdrop, sheet);
  const list = sheet.querySelector('.alygnn-notify-list');
  const subtitle = sheet.querySelector('.alygnn-notify-subtitle');
  const toast = document.createElement('div');
  toast.className = 'alygnn-notify-toast';
  toast.hidden = true;
  toast.innerHTML = '<span>New message received</span><button type="button">View</button>';
  document.body.appendChild(toast);
  const closeButton = sheet.querySelector('.alygnn-notify-close');
  const markButton = sheet.querySelector('.alygnn-notify-mark');
  const filterButtons = Array.from(sheet.querySelectorAll('.alygnn-notify-filter'));
  const unreadTabCount = sheet.querySelector('.alygnn-notify-tabcount');
  const jobsButton = sheet.querySelector('.alygnn-notify-footlink');
  const messagesHref = 'app-messages.html?role=candidate';
  jobsButton.addEventListener('click', () => { location.href = 'app-applied.html'; });
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
  let recentStatusNotifications = [];
  let allConversationIds = [];
  let lastCount = 0;
  let lastMessageUnread = 0;
  let activeFilter = 'all';
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
    const icon = document.createElement('div'); icon.className='alygnn-notify-empty-icon'; icon.textContent='✓';
    const heading = document.createElement('strong'); heading.textContent = title;
    const sub = document.createElement('div'); sub.textContent = description;
    block.append(icon,heading,sub);
    list.append(block);
  }
  function noticeKind(notice) {
    const type=text(notice.type).toLowerCase();
    if(type.includes('application')||type.includes('selected')||type.includes('hired')) return 'application';
    if(type.includes('password')||type.includes('security')||type.includes('account')) return 'security';
    if(type.includes('job')||type.includes('recommend')) return 'job';
    return 'account';
  }
  function noticeCategory(kind) {
    return kind==='application'?'APPLICATION UPDATE':kind==='security'?'ACCOUNT & SECURITY':
      kind==='job'?'JOB UPDATE':'ALYGNN UPDATE';
  }
  function noticeDestination(notice,kind){
    const link=text(notice.link);
    // Navigation stays inside app files. Never follow arbitrary database URLs.
    if(/^app-[a-z0-9-]+\.html(?:\?[a-z0-9_%+&=.-]*)?$/i.test(link))return link;
    if(kind==='application')return 'app-applied.html';
    if(kind==='job')return 'app-swipe.html';
    return 'app-account.html';
  }
  function setFilter(value){
    activeFilter=value==='unread'?'unread':'all';
    filterButtons.forEach(button=>button.setAttribute('aria-selected',String(button.dataset.filter===activeFilter)));
    paint(lastMessageUnread,recentMessages,recentStatusNotifications);
  }
  filterButtons.forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.filter)));
  markButton.addEventListener('click',async()=>{
    if(!userId || markButton.disabled)return;
    markButton.disabled=true;
    const readAt=new Date().toISOString();
    let failed=false;
    try{
      const updates=[];
      if(recentStatusNotifications.some(n=>!n.read_at)) {
        updates.push(sb.from('notifications').update({read_at:readAt})
          .eq('recipient_id',userId).is('read_at',null));
      }
      const ids=allConversationIds;
      if(lastMessageUnread && ids.length){
        updates.push(sb.from('application_messages').update({read_at:readAt})
          .in('conversation_id',ids).neq('sender_id',userId).is('read_at',null));
      }
      const results=await Promise.all(updates);
      failed=results.some(result=>Boolean(result.error));
      if(failed){console.warn('Some notification read updates failed:',results.filter(x=>x.error).map(x=>x.error));}
    }catch(error){failed=true;console.warn('Could not mark all candidate notifications read:',error);}
    await refresh();
    markButton.disabled=false;
    if(failed){
      toast.querySelector('span').textContent='Some notifications could not be marked read.';
      toast.querySelector('button').hidden=true;
      toast.hidden=false;
      if(toastTimer)clearTimeout(toastTimer);
      toastTimer=setTimeout(()=>{toast.hidden=true;toast.querySelector('button').hidden=false;},5000);
    }
  });
  // The bottom Messages navigation badge remains message-only; the bell counts
  // both unread messages and unread database notifications.
  function paint(count,threads,notices=[]) {
    lastMessageUnread=count;
    const statusUnread=notices.filter(n=>!n.read_at).length;
    const totalUnread=count+statusUnread;
    lastCount=totalUnread;
    bellCount.hidden=totalUnread<=0;
    bellCount.textContent=totalUnread>99?'99+':String(totalUnread);
    const nav=messageBadge();
    try {
      localStorage.setItem('alygnn_candidate_unread_messages_last',String(count));
      if(userId)localStorage.setItem('alygnn_candidate_unread_messages:'+userId,String(count));
    }catch(_){ }
    if(nav){nav.textContent=count>99?'99+':String(count);nav.hidden=count<=0;}
    subtitle.textContent=totalUnread
      ? `${totalUnread} unread · Messages, applications and account updates`
      : 'You’re all caught up · Recent activity';
    unreadTabCount.textContent=totalUnread>99?'99+':String(totalUnread);
    markButton.hidden=totalUnread<=0;
    const rows=[
      ...threads.map(thread=>({kind:'message',value:thread,created_at:thread.message.created_at,
        unread:thread.unreadCount>0})),
      ...notices.map(notice=>({kind:'status',value:notice,created_at:notice.created_at,
        unread:!notice.read_at}))
    ].filter(item=>activeFilter==='all'||item.unread)
      .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,60);
    if(!rows.length){
      empty(activeFilter==='unread'?'No unread notifications':'No notifications yet',
        activeFilter==='unread'?'You’re all caught up. Check All to see previous updates.':
          'Employer messages, application decisions and account updates will show here.');
      return;
    }
    list.replaceChildren();
    let lastSection='';
    for(const item of rows){
      const date=new Date(item.created_at);
      const today=new Date();today.setHours(0,0,0,0);
      const section=!Number.isNaN(date.getTime()) && date>=today?'Today':'Earlier';
      if(section!==lastSection){
        const heading=document.createElement('div');heading.className='alygnn-notify-section';
        heading.textContent=section;list.append(heading);lastSection=section;
      }
      if(item.kind==='status'){
        const notice=item.value;
        const unread=item.unread;
        const row=document.createElement('button');
        row.type='button';
        row.className='alygnn-notify-row'+(unread?' alygnn-notify-unread':'');
        const heading=text(notice.title)||'Alygnn update';
        row.setAttribute('aria-label',`View ${heading}`);
        const kind=noticeKind(notice);
        const avatar=document.createElement('div');
        avatar.className='alygnn-notify-avatar';avatar.dataset.kind=kind;
        avatar.textContent=kind==='application'?'✓':kind==='security'?'S':kind==='job'?'J':'A';
        const body=document.createElement('span');body.className='alygnn-notify-body';
        const category=document.createElement('span');category.className='alygnn-notify-type';category.textContent=noticeCategory(kind);
        const title=document.createElement('span');title.className='alygnn-notify-title';title.textContent=heading;
        const preview=document.createElement('span');preview.className='alygnn-notify-preview';
        preview.textContent=short(notice.body,195)||'View your latest Alygnn update.';
        body.append(category,title,preview);
        const meta=document.createElement('span');meta.className='alygnn-notify-meta';
        const time=document.createElement('span');time.textContent=stamp(notice.created_at);meta.append(time);
        if(unread){const dot=document.createElement('span');dot.className='alygnn-notify-dot';meta.append(dot);}
        row.append(avatar,body,meta);
        row.addEventListener('click',async()=>{
          try{
            if(!notice.read_at){
              const {error}=await sb.from('notifications')
                .update({read_at:new Date().toISOString()})
                .eq('id',notice.id).eq('recipient_id',userId);
              if(error)console.warn('Could not mark candidate notification read:',error);
            }
          }catch(error){console.warn('Could not mark candidate notification read:',error);}
          location.href=noticeDestination(notice,kind);
        });
        list.append(row);
        continue;
      }
      const thread=item.value;
      const conversation=thread.conversation;
      const message=thread.message;
      const unread=item.unread;
      const company=text(conversation.recruiter_name)||text(conversation.company_name)||
        text(conversation.employer_name)||text(conversation.contact_name)||text(conversation.sender_name)||'Employer';
      const job=text(conversation.job_title)||'Job application';
      const row=document.createElement('button');
      row.type='button';
      row.className='alygnn-notify-row'+(unread?' alygnn-notify-unread':'');
      row.setAttribute('aria-label',`Open conversation with ${company} about ${job}`);
      const avatar=document.createElement('div');avatar.className='alygnn-notify-avatar';avatar.textContent=initials(company);
      const body=document.createElement('span');body.className='alygnn-notify-body';
      const category=document.createElement('span');category.className='alygnn-notify-type';
      category.textContent=thread.unreadCount>0 ? `MESSAGE · ${thread.unreadCount} UNREAD`:'MESSAGE';
      const title=document.createElement('span');title.className='alygnn-notify-title';title.textContent=company;
      const context=document.createElement('span');context.className='alygnn-notify-context';context.textContent=job;
      const preview=document.createElement('span');preview.className='alygnn-notify-preview';
      preview.textContent=short(message.body,170)||'New employer message';
      body.append(category,title,context,preview);
      const meta=document.createElement('span');meta.className='alygnn-notify-meta';
      const time=document.createElement('span');time.textContent=stamp(message.created_at);meta.append(time);
      if(unread){const dot=document.createElement('span');dot.className='alygnn-notify-dot';meta.append(dot);}
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
      if(id!==userId){knownMessageIds=null;recentStatusNotifications=[];allConversationIds=[];userId=id;}
      if(!id){recentMessages=[];recentStatusNotifications=[];allConversationIds=[];paint(0,[],[]);return;}
      let notices=recentStatusNotifications;
      try{
        const {data:rows,error:noticeError}=await sb.from('notifications')
          .select('id,type,title,body,link,created_at,read_at')
          .eq('recipient_id',id).order('created_at',{ascending:false}).limit(40);
        if(noticeError)throw noticeError;
        // Message rows are already represented by conversation threads.
        // Filter them here to prevent a duplicate message notification.
        notices=(rows||[]).filter(n=>!String(n.type||'').toLowerCase().includes('message'));
        recentStatusNotifications=notices;
      }catch(noticeError){
        // Never break the working message bell if candidate notification RLS
        // is not yet configured. Retain last successfully read notification rows.
        console.warn('Could not load candidate application notifications:',noticeError);
      }
      const conversationResult=await sb.from('application_conversations').select('*')
        .eq('candidate_id',id).is('candidate_hidden_at',null);
      if(conversationResult.error){
        console.warn('Could not load candidate conversations:',conversationResult.error);
        paint(0,[],notices);
        return;
      }
      const conversations=conversationResult.data||[];
      const ids=conversations.map(c=>c.id).filter(Boolean);
      allConversationIds=ids;
      if(!ids.length){recentMessages=[];knownMessageIds=new Set();paint(0,[],notices);return;}
      const [unreadResult,recentResult]=await Promise.all([
        sb.from('application_messages').select('id,conversation_id',{count:'exact'})
          .in('conversation_id',ids).neq('sender_id',id).is('read_at',null).limit(1000),
        sb.from('application_messages').select('id,conversation_id,body,created_at,read_at')
          .in('conversation_id',ids).neq('sender_id',id).order('created_at',{ascending:false}).limit(100)
      ]);
      if(unreadResult.error||recentResult.error){
        console.warn('Could not load candidate message history:',unreadResult.error||recentResult.error);
        paint(0,[],notices);
        return;
      }
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
      paint(unreadCount,threads,notices);
    }catch(error){
      console.warn('Alygnn candidate notifications could not refresh:',error);
      if(!sheet.hidden && !recentMessages.length && !recentStatusNotifications.length){empty('Notifications unavailable','Please try again in a moment.');}
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
      channel=sb.channel('alygnn-candidate-notifications-v25-'+id+'-'+Math.random().toString(36).slice(2))
        .on('postgres_changes',{event:'*',schema:'public',table:'application_messages'},refresh)
        .on('postgres_changes',{event:'*',schema:'public',table:'application_conversations'},refresh)
        .on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:'recipient_id=eq.'+id},refresh)
        .subscribe();
    }catch(error){console.warn('Candidate realtime notifications unavailable, using refresh fallback.',error);}
  }
  empty('Checking notifications','Looking for recent messages and application updates.');
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
