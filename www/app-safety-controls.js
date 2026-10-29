/* Alygnn Android safety controls: shared by the candidate/employer app screens.
   Requires the accompanying Supabase migration. No website changes. */
(function () {
  'use strict';
  const reasons = [
    ['scam','Suspected scam or fraud'],
    ['harassment','Harassment or threats'],
    ['inappropriate','Inappropriate or offensive content'],
    ['misleading','Misleading job information'],
    ['spam','Spam or unwanted contact'],
    ['other','Other safety concern']
  ];
  function ensureStyles(){
    if(document.getElementById('alygnn-safety-styles'))return;
    const style=document.createElement('style');
    style.id='alygnn-safety-styles';
    style.textContent=`
      .alygnn-safety-mask{position:fixed;inset:0;z-index:99998;background:rgba(8,21,34,.55);display:flex;align-items:center;justify-content:center;padding:18px}
      .alygnn-safety-card{width:min(100%,440px);max-height:90dvh;overflow:auto;border-radius:20px;background:var(--card,#fff);color:var(--text,#1b2a3a);border:1px solid var(--border,#dde3e8);padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.22);font-family:inherit}
      .alygnn-safety-card h2{font-size:22px;margin:0 0 9px;font-weight:800;line-height:1.25}
      .alygnn-safety-card p{font-size:13px;line-height:1.5;margin:0 0 16px;color:var(--muted,#667a89)}
      .alygnn-safety-card label{display:block;font-size:13px;font-weight:700;margin:12px 0 6px}
      .alygnn-safety-card select,.alygnn-safety-card textarea{width:100%;box-sizing:border-box;max-width:100%;border:1px solid var(--border,#dde3e8);border-radius:11px;background:var(--card,#fff);color:var(--text,#1b2a3a);font:inherit;font-size:14px;padding:12px;min-height:44px}
      .alygnn-safety-card textarea{min-height:90px;resize:vertical}
      .alygnn-safety-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}
      .alygnn-safety-actions button{border-radius:11px;padding:11px 16px;border:1px solid var(--border,#dde3e8);background:var(--card,#fff);color:var(--text,#1b2a3a);font:inherit;font-size:13px;font-weight:750;cursor:pointer}
      .alygnn-safety-actions button[type=submit]{background:#39679a;border-color:#39679a;color:#fff}
      .alygnn-safety-actions button:disabled{opacity:.55}
      .alygnn-safety-error{color:#b63333!important;margin:9px 0 0!important}
      .alygnn-safety-notice{font-size:13px;line-height:1.5;padding:12px 14px;margin:9px 12px;border-radius:11px;background:var(--soft,#edf3f8);color:var(--text,#1b2a3a)}
      .alygnn-safety-small-btn{border:1px solid var(--border,#dde3e8);color:var(--muted,#5d7fa3);background:var(--card,#fff);border-radius:11px;padding:10px 12px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}
    `;
    document.head.appendChild(style);
  }
  async function blockState(client,conversationId,me){
    const {data,error}=await client.from('alygnn_safety_blocks').select('blocked_by').eq('conversation_id',conversationId);
    if(error)throw error;
    const rows=data||[];
    return {blocked:rows.length>0,mine:rows.some(row=>String(row.blocked_by)===String(me))};
  }
  async function setBlocked(client,conversationId,me,block){
    if(!conversationId||!me)throw new Error('Conversation or account unavailable.');
    const result=block
      ?await client.from('alygnn_safety_blocks').insert({conversation_id:conversationId,blocked_by:me})
      :await client.from('alygnn_safety_blocks').delete().eq('conversation_id',conversationId).eq('blocked_by',me);
    if(result.error)throw result.error;
  }
  function report(client,kind,id,me){
    return new Promise(resolve=>{
      ensureStyles();
      if(!client||!id||!me){resolve(false);return;}
      const mask=document.createElement('div');mask.className='alygnn-safety-mask';
      mask.innerHTML=`<form class="alygnn-safety-card" aria-label="Report safety concern">
        <h2>Report ${kind==='job'?'job':'conversation'}</h2>
        <p>Your report is private and goes to Alygnn for review. Do not include passwords or financial details.</p>
        <label for="alygnn-safety-reason">Reason</label>
        <select id="alygnn-safety-reason" required>${reasons.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select>
        <label for="alygnn-safety-detail">More information (optional)</label>
        <textarea id="alygnn-safety-detail" maxlength="1000" placeholder="Briefly tell us what happened"></textarea>
        <p class="alygnn-safety-error" role="alert" hidden></p>
        <div class="alygnn-safety-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Send report</button></div>
      </form>`;
      document.body.appendChild(mask);
      const form=mask.querySelector('form'), cancel=mask.querySelector('[data-cancel]');
      function end(success){mask.remove();resolve(success);}
      cancel.onclick=()=>end(false);
      mask.addEventListener('click',e=>{if(e.target===mask)end(false)});
      form.onsubmit=async e=>{
        e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
        const payload={reporter_id:me,subject_type:kind,reason:form.querySelector('select').value,details:form.querySelector('textarea').value.trim()};
        payload[kind==='job'?'job_id':'conversation_id']=id;
        try{
          const {error}=await client.from('alygnn_safety_reports').insert(payload);
          if(error)throw error;
          end(true);
        }catch(error){
          const notice=form.querySelector('.alygnn-safety-error');
          notice.hidden=false;notice.textContent=error.message||'Could not submit the report. Please try again.';
          submit.disabled=false;
        }
      };
      form.querySelector('select').focus();
    });
  }
  window.AlygnnSafety={blockState,setBlocked,report};
})();
