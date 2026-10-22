/* Functional candidate Settings panels, shared by both Settings entrances. */
(function(){'use strict';
 const POLICY='https://alygnn.com/privacy.html';
 const TERMS='https://alygnn.com/terms.html';
 const ESC=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const styles=`
 #alygnn-candidate-info-overlay[hidden]{display:none!important}
 #alygnn-candidate-info-overlay{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.54);display:flex;align-items:flex-end;justify-content:center;padding-top:env(safe-area-inset-top)}
 #alygnn-candidate-info-overlay .alygnn-info-card{width:min(640px,100%);max-height:89dvh;overflow:auto;background:var(--card,#fff);color:var(--text,#172333);border:1px solid var(--border,#DDE3E8);border-radius:24px 24px 0 0;padding:20px 22px calc(22px + env(safe-area-inset-bottom));box-shadow:0 0 40px rgba(0,0,0,.16);font-family:'DM Sans',Arial,sans-serif}
 #alygnn-candidate-info-overlay .alygnn-info-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}
 #alygnn-candidate-info-overlay h2{font-size:22px;line-height:1.2;margin:0;font-weight:800}
 #alygnn-candidate-info-overlay p{font-size:14px;line-height:1.65;color:var(--muted,#647282);margin:10px 0 15px}
 #alygnn-candidate-info-overlay .alygnn-info-close{border:1px solid var(--border,#DDE3E8);background:transparent;color:inherit;border-radius:50%;width:42px;height:42px;flex:0 0 42px;font-size:26px;cursor:pointer}
 #alygnn-candidate-info-overlay label{display:block;font-size:13px;font-weight:700;margin:14px 0 7px}
 #alygnn-candidate-info-overlay select,#alygnn-candidate-info-overlay textarea{box-sizing:border-box;width:100%;padding:11px;border-radius:12px;border:1px solid var(--border,#DDE3E8);background:var(--card,#fff);color:var(--text,#172333);font:inherit;font-size:14px}
 #alygnn-candidate-info-overlay textarea{min-height:112px;resize:vertical}
 #alygnn-candidate-info-overlay .alygnn-info-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
 #alygnn-candidate-info-overlay .alygnn-info-action{border-radius:12px;min-height:44px;padding:12px 16px;border:1px solid var(--border,#DDE3E8);background:transparent;color:var(--text,#172333);font:inherit;font-weight:750;cursor:pointer;text-decoration:none;font-size:13px}
 #alygnn-candidate-info-overlay .alygnn-info-primary{background:#35679A;color:#fff;border-color:#35679A}
 #alygnn-candidate-info-overlay .alygnn-info-status{font-size:13px;line-height:1.5;margin-top:12px;white-space:pre-wrap}
 @media(min-width:650px){#alygnn-candidate-info-overlay{align-items:center;padding:24px}#alygnn-candidate-info-overlay .alygnn-info-card{border-radius:24px;padding:24px}}
 `;
 function ensure(){
   if(document.getElementById('alygnn-candidate-info-overlay'))return;
   const style=document.createElement('style');style.textContent=styles;document.head.appendChild(style);
   const overlay=document.createElement('div');overlay.id='alygnn-candidate-info-overlay';overlay.hidden=true;
   overlay.innerHTML='<section class="alygnn-info-card" role="dialog" aria-modal="true" aria-labelledby="alygnn-info-title"><div class="alygnn-info-head"><h2 id="alygnn-info-title"></h2><button class="alygnn-info-close" aria-label="Close panel" type="button">×</button></div><div id="alygnn-info-body"></div></section>';
   overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
   overlay.querySelector('.alygnn-info-close').addEventListener('click',close);
   document.body.appendChild(overlay);
   document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)close()});
 }
 function close(){const overlay=document.getElementById('alygnn-candidate-info-overlay');if(overlay)overlay.hidden=true}
 async function openExternal(url){
   try{const browser=window.Capacitor?.Plugins?.Browser;if(browser?.open){await browser.open({url});return}}catch(e){console.warn('Native browser not available',e)}
   window.open(url,'_blank','noopener,noreferrer');
 }
 function legalButtons(){return '<div class="alygnn-info-actions"><button class="alygnn-info-action" type="button" data-external="'+POLICY+'">Privacy Policy ↗</button><button class="alygnn-info-action" type="button" data-external="'+TERMS+'">Terms of Service ↗</button></div>'}
 function open(type){
   ensure();const overlay=document.getElementById('alygnn-candidate-info-overlay'),title=overlay.querySelector('#alygnn-info-title'),body=overlay.querySelector('#alygnn-info-body');
   const types={privacy:'Privacy',support:'Help & Support',about:'About Alygnn'};
   title.textContent=types[type]||'Alygnn';
   if(type==='privacy')body.innerHTML='<p>Read Alygnn’s published privacy policy and terms, or contact our team about accessing or deleting your personal data.</p>'+legalButtons()+'<div class="alygnn-info-actions"><button class="alygnn-info-action alygnn-info-primary" type="button" data-goto-support="Privacy request">Contact us about privacy</button></div>';
   else if(type==='about')body.innerHTML='<p><strong>Alygnn Candidate Workspace</strong></p><p>Discover opportunities, apply to jobs and manage your candidate profile. To see the installed Android app version, open your device’s Settings → Apps → Alygnn.</p>'+legalButtons()+'<div class="alygnn-info-actions"><button class="alygnn-info-action alygnn-info-primary" type="button" data-goto-support="Other">Contact Alygnn</button></div>';
   else body.innerHTML='<p>Send a message to the Alygnn team. We will use your signed-in account email for the reply.</p><label for="alygnn-support-category">What do you need help with?</label><select id="alygnn-support-category"><option>Account & login</option><option>Job applications</option><option>Profile & resume</option><option>Report a problem</option><option>Privacy request</option><option>Other</option></select><label for="alygnn-support-message">Message</label><textarea id="alygnn-support-message" maxlength="4000" placeholder="Describe what happened..."></textarea><div class="alygnn-info-actions"><button class="alygnn-info-action alygnn-info-primary" type="button" id="alygnn-support-send">Send message</button><a class="alygnn-info-action" href="mailto:admin@alygnn.com?subject=Alygnn%20Candidate%20Support">Email Alygnn instead ↗</a></div><div class="alygnn-info-status" id="alygnn-support-status" role="status" aria-live="polite"></div>';
   body.querySelectorAll('[data-external]').forEach(btn=>btn.onclick=()=>openExternal(btn.dataset.external));
   body.querySelectorAll('[data-goto-support]').forEach(btn=>btn.onclick=()=>{const c=btn.dataset.gotoSupport;open('support');const choice=document.getElementById('alygnn-support-category');if(choice)choice.value=c});
   if(type==='support')document.getElementById('alygnn-support-send').onclick=sendSupport;
   overlay.hidden=false;
   overlay.querySelector('.alygnn-info-close').focus();
 }
 async function sendSupport(){
   const btn=document.getElementById('alygnn-support-send'),status=document.getElementById('alygnn-support-status');
   const category=document.getElementById('alygnn-support-category').value;
   const message=String(document.getElementById('alygnn-support-message').value||'').trim();
   if(message.length<10){status.textContent='Please describe the issue in at least 10 characters.';return}
   btn.disabled=true;btn.textContent='Sending…';status.textContent='';
   try{
     const client=(typeof sb!=='undefined'&&sb)?sb:(typeof workspaceSb!=='undefined'&&workspaceSb)?workspaceSb:null;
     if(!client)throw new Error('Your session is not available. Try signing in again.');
     const result=await client.auth.getSession();const user=result.data?.session?.user;
     if(!user?.email)throw new Error('Please sign in to send a message.');
     const name=String(user.user_metadata?.full_name||user.user_metadata?.name||user.email.split('@')[0]);
     const resultSend=await client.functions.invoke('send-contact-message',{body:{name,email:user.email,message:'[Candidate support: '+category+']\n\n'+message}});
     if(resultSend.error)throw resultSend.error;
     document.getElementById('alygnn-support-message').value='';status.textContent='Message sent. Alygnn will reply to your account email.';
   }catch(err){status.textContent='Message could not be sent: '+(err?.message||'Try emailing Alygnn instead.');console.error('Alygnn candidate support',err)}
   finally{btn.disabled=false;btn.textContent='Send message'}
 }
 window.AlygnnCandidateSettings={open,close};
})();
