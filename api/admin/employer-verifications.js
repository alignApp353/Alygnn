'use strict';

const { createClient } = require('@supabase/supabase-js');

function applyCors(req, res) {
  const allowedOrigins = new Set([
    'https://alygnn.com',
    'https://www.alygnn.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'capacitor://localhost'
  ]);

  const origin = String(req.headers.origin || '').trim();

  if (
    allowedOrigins.has(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : '';
}

function adminEmails() {
  return new Set(
    String(process.env.ALYGNN_ADMIN_EMAILS || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function serviceClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Server configuration is incomplete.');
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}

async function requireAdmin(req, supabase) {
  const token = bearerToken(req);

  if (!token) {
    const error = new Error('Sign in before opening the admin review page.');
    error.status = 401;
    throw error;
  }

  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;

  if (error || !user) {
    const authError = new Error('Your login session is invalid or expired.');
    authError.status = 401;
    throw authError;
  }

  const allowed = adminEmails();

  if (!allowed.size || !allowed.has(String(user.email || '').toLowerCase())) {
    const permissionError = new Error('This account is not authorized to review employers.');
    permissionError.status = 403;
    throw permissionError;
  }

  return user;
}

async function latestDocuments(supabase, companyIds) {
  if (!companyIds.length) return new Map();

  const { data, error } = await supabase
    .from('employer_verification_documents')
    .select(
      'id, company_id, storage_path, original_file_name, document_type, review_status, created_at'
    )
    .in('company_id', companyIds)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const map = new Map();

  for (const document of data || []) {
    if (!map.has(document.company_id)) {
      map.set(document.company_id, document);
    }
  }

  return map;
}


async function pauseCompanyJobsForVerification(supabase, employerId, reason) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'paused',
      pause_reason: reason,
      updated_at: now
    })
    .eq('employer_id', employerId)
    .eq('status', 'active')
    .select('id');

  if (error) throw error;
  return (data || []).length;
}

async function addSignedUrls(supabase, rows) {
  const documentMap = await latestDocuments(
    supabase,
    rows.map(row => row.company_id).filter(Boolean)
  );

  return Promise.all(
    rows.map(async row => {
      const document = documentMap.get(row.company_id) || null;
      let documentUrl = '';

      if (document?.storage_path) {
        const { data, error } = await supabase.storage
          .from('employer-verification-documents')
          .createSignedUrl(document.storage_path, 300);

        if (!error) documentUrl = data?.signedUrl || '';
      }

      return {
        ...row,
        document,
        document_url: documentUrl
      };
    })
  );
}


// Company profile update emails only. Existing admin GET/PATCH actions are unchanged.
const companyUpdateEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const companyUpdateFieldNames={company_name:'Company name',company_headline:'About the company',company_website:'Website',company_phone:'Business phone',business_email:'Business email',business_address:'Business address'};
// Alygnn branded layout for company update notices only. Email-safe table HTML.
function companyUpdateMailLayout({heading,intro,details,actionUrl,actionText,note=''}){
  const line=(label,value)=>`<tr><td style="padding:9px 12px;border-bottom:1px solid #E6EBEF;color:#607080;font-size:12px;width:34%;vertical-align:top">${companyUpdateEsc(label)}</td><td style="padding:9px 12px;border-bottom:1px solid #E6EBEF;color:#1A2530;font-size:12px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word">${companyUpdateEsc(value)}</td></tr>`;
  const rows=details.map(d=>line(d[0],d[1])).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F8F7;font-family:Arial,Helvetica,sans-serif;color:#1A2530">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F6F8F7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;background:#FFFFFF;border:1px solid #DDE3E8;border-radius:18px">
<tr><td align="center" style="padding:20px 24px 16px;border-bottom:1px solid #E7ECEF"><img src="https://alygnn.com/alygnn-email-logo.png" alt="Alygnn" width="150" style="display:block;width:150px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none" /></td></tr>
<tr><td style="padding:22px 24px 14px"><div style="font-size:11px;font-weight:bold;letter-spacing:1.6px;color:#5D7FA3;margin-bottom:12px">COMPANY PROFILE</div><h1 style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.3;color:#1A2530">${companyUpdateEsc(heading)}</h1><p style="margin:0;color:#4A5968;font-size:13px;line-height:1.6">${intro}</p></td></tr>
<tr><td style="padding:2px 24px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #DDE3E8;border-radius:12px;border-collapse:separate;border-spacing:0;background:#FCFCFA">${rows}</table>${note?`<p style="margin:16px 0 0;color:#4A5968;font-size:13px;line-height:1.7">${note}</p>`:''}</td></tr>
<tr><td style="padding:0 24px 24px"><a href="${actionUrl}" style="display:inline-block;background:#5D7FA3;color:#FFFFFF;text-decoration:none;border-radius:10px;padding:11px 18px;font-size:13px;font-weight:bold">${companyUpdateEsc(actionText)}</a></td></tr>
<tr><td style="border-top:1px solid #E7ECEF;padding:14px 24px 18px;color:#8895A2;font-size:11px;line-height:1.8">This is an automated message from Alygnn.<br>Need help? <a href="mailto:contact@alygnn.com" style="color:#5D7FA3">Contact Alygnn</a> &nbsp;·&nbsp; <a href="https://alygnn.com/privacy.html" style="color:#5D7FA3">Privacy</a> &nbsp;·&nbsp; <a href="https://alygnn.com/terms.html" style="color:#5D7FA3">Terms</a><br>© 2026 Alygnn. All rights reserved.</td></tr>
</table></td></tr></table></body></html>`;
}
async function handleCompanyUpdateNotification(req,res){
  try{
    const token=bearerToken(req);
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const requestId=String(body.request_id||'');
    const event=String(body.event||'');
    if(!/^[0-9a-f-]{36}$/i.test(requestId)||!['submitted','approved','declined'].includes(event))return res.status(400).json({error:'Invalid notification request'});
    if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.RESEND_API_KEY)return res.status(503).json({error:'Notifications are not configured'});
    const db=serviceClient();
    const {data:{user},error:authError}=await db.auth.getUser(token);
    if(authError||!user)return res.status(401).json({error:'Sign in required'});
    const {data:r,error:requestError}=await db.from('employer_profile_update_requests').select('id,company_id,employer_id,company_name_snapshot,field_key,current_value,requested_value,reason,status,admin_note,created_at,reviewed_at').eq('id',requestId).maybeSingle();
    if(requestError||!r)return res.status(404).json({error:'Request not found'});
    if(event==='submitted'){
      if(r.status!=='pending')return res.status(409).json({error:'Request is no longer pending'});
      const {data:ver}=await db.from('employer_verifications').select('user_id').eq('company_id',r.company_id).maybeSingle();
      let allowed=user.id===r.employer_id||user.id===ver?.user_id;
      if(!allowed){const {data:m}=await db.from('company_members').select('user_id').eq('company_id',r.company_id).eq('user_id',user.id).eq('membership_status','active').maybeSingle();allowed=!!m;}
      if(!allowed)return res.status(403).json({error:'Not your company'});
      // Submission notification may only be requested immediately after submission.
      if(Math.abs(Date.now()-new Date(r.created_at).getTime())>10*60*1000)return res.status(409).json({error:'Notification window expired'});
    }else{
      const admins=new Set(String(process.env.ALYGNN_ADMIN_EMAILS||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));
      if(!admins.has(String(user.email||'').toLowerCase()))return res.status(403).json({error:'Admin authorization required'});
      if(r.status!==event||!r.reviewed_at)return res.status(409).json({error:'Decision has not been recorded'});
    }
    const {data:company,error:companyError}=await db.from('companies').select('account_number').eq('id',r.company_id).maybeSingle();
    if(companyError)throw companyError;
    const account=String(company?.account_number||'Unavailable');
    const label=companyUpdateFieldNames[r.field_key]||'Company information';
    let recipient,subject,html;
    if(event==='submitted'){
      recipient='admin@alygnn.com';subject='Alygnn — New company update request';
      html=companyUpdateMailLayout({heading:'New company update request',intro:'An employer has submitted a company profile update for your review.',details:[['Company',r.company_name_snapshot],['Account ID',account],['Field',label],['Current',r.current_value],['Requested',r.requested_value],['Reason',r.reason]],actionUrl:'https://alygnn.com/employer-verification-admin.html',actionText:'Review request'});
    }else{
      // Address is resolved from Supabase Auth; never trust a client-supplied recipient.
      const {data:auth}=await db.auth.admin.getUserById(r.employer_id);
      recipient=auth?.user?.email;
      if(!recipient)return res.status(422).json({error:'Employer email is unavailable'});
      subject=event==='approved'?'Alygnn — Company update approved':'Alygnn — Company update declined';
      html=companyUpdateMailLayout({heading:event==='approved'?'Company update approved':'Company update declined',intro:event==='approved'?'Your company profile update has been approved. Your verified company information now reflects the change.':'Your company profile update request was declined. Your existing company information remains unchanged.',details:[['Company',r.company_name_snapshot],['Account ID',account],['Field',label],['Status',event==='approved'?'Approved':'Declined']],note:event==='declined'&&r.admin_note?`<strong>Reason:</strong> ${companyUpdateEsc(r.admin_note)}`:'',actionUrl:'https://alygnn.com/employer-account.html',actionText:'View your Alygnn account'});
    }
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'alygnn-company-update-'+r.id+'-'+event},body:JSON.stringify({from:'Alygnn <admin@alygnn.com>',to:[recipient],subject,html,reply_to:'contact@alygnn.com'})});
    if(!response.ok){console.error('Company update Resend error',response.status,await response.text());return res.status(502).json({error:'Email could not be sent'});}
    return res.status(200).json({success:true});
  }catch(error){console.error('Company update notification error',error);return res.status(500).json({error:'Notification failed'});}
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'POST') {
    const body=typeof req.body==='string' ? (()=>{try{return JSON.parse(req.body)}catch(_){return {}}})() : (req.body||{});
    if(body.action==='company_update_notification') return handleCompanyUpdateNotification(req,res);
    return sendJson(res,405,{success:false,error:'Method not allowed.'});
  }

  try {
    const supabase = serviceClient();
    const admin = await requireAdmin(req, supabase);

    // Admin-only short Account ID lookup and preserved company update history.
    // Does not modify verification, account deletion or request review behavior.
    if (req.method === 'GET' && String(req.query.account_lookup||'').trim()) {
      const q=String(req.query.account_lookup).trim();
      if(!/^ALY-[A-Z0-9]{3,20}$/i.test(q) && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(q))
        return sendJson(res,400,{success:false,error:'Enter a valid Alygnn Account ID.'});
      let lookup=supabase.from('companies').select('id,account_number,company_name');
      lookup=/^ALY-/i.test(q)?lookup.ilike('account_number',q):lookup.eq('id',q);
      const {data:company,error:companyError}=await lookup.maybeSingle();
      if(companyError)throw companyError;
      if(!company)return sendJson(res,404,{success:false,error:'No company found for that Account ID.'});
      const {data:history,error:historyError}=await supabase.from('employer_profile_update_requests')
        .select('id,company_id,company_name_snapshot,field_key,current_value,requested_value,reason,status,created_at,reviewed_at,admin_note')
        .eq('company_id',company.id).order('created_at',{ascending:false}).limit(1000);
      if(historyError)throw historyError;
      return sendJson(res,200,{success:true,company_id:company.id,account_number:company.account_number,
        company_name:company.company_name,history:history||[]});
    }
    if (req.method === 'GET' && req.query.update_history === '1') {
      const {data,error}=await supabase.from('employer_profile_update_requests')
        .select('id,employer_id,company_id,company_name_snapshot,field_key,current_value,requested_value,reason,supporting_document_path,status,created_at,reviewed_at,admin_note')
        .order('created_at',{ascending:false}).limit(1000);
      if(error)throw error;
      const ids=[...new Set((data||[]).map(r=>r.company_id).filter(Boolean))];
      let companies=[];
      if(ids.length){
        const found=await supabase.from('companies').select('id,account_number,company_name').in('id',ids);
        if(found.error)throw found.error;
        companies=found.data||[];
      }
      return sendJson(res,200,{success:true,requests:data||[],companies});
    }



    if (req.method === 'GET') {
      const requestedStatus = String(req.query.status || 'pending_review').trim();
      const allowedStatuses = new Set(['pending_review','approved','rejected','deactivated']);
      const status = allowedStatuses.has(requestedStatus) ? requestedStatus : 'pending_review';
      let rows = [];

      if (status === 'deactivated') {
        const {data:companies,error:companyError}=await supabase
          .from('companies').select('id').eq('account_status','deactivated');
        if(companyError)throw companyError;
        const ids=(companies||[]).map(row=>row.id).filter(Boolean);
        if(ids.length){
          const {data,error}=await supabase.from('employer_verifications')
            .select('user_id,company_id,company_name,website,business_phone,industry,company_size,headquarters,ein_last4,verification_status,rejection_reason,created_at,updated_at')
            .in('company_id',ids).order('created_at',{ascending:true});
          if(error)throw error;
          rows=data||[];
        }
      }else{
        const {data,error}=await supabase.from('employer_verifications')
          .select('user_id,company_id,company_name,website,business_phone,industry,company_size,headquarters,ein_last4,verification_status,rejection_reason,created_at,updated_at')
          .eq('verification_status',status).order('created_at',{ascending:true});
        if(error)throw error;
        rows=data||[];
      }

      const ids=rows.map(row=>row.company_id).filter(Boolean);
      const companyMap=new Map();
      if(ids.length){
        const {data:companies,error}=await supabase.from('companies')
          .select('id,account_number,account_status').in('id',ids);
        if(error)throw error;
        for(const company of companies||[])companyMap.set(company.id,company);
      }

      const enriched=rows.map(row=>({
        ...row,
        account_number:companyMap.get(row.company_id)?.account_number||null,
        account_status:companyMap.get(row.company_id)?.account_status||'active'
      }));
      const reviews=await addSignedUrls(supabase,enriched);
      return sendJson(res,200,{success:true,reviews});
    }

    if (req.method === 'PATCH') {
      const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
      const companyId=String(body.company_id||'').trim();
      // Current admin page sends action; older page sent decision. Support both.
      const action=String(body.action||body.decision||'').trim();
      const reason=String(body.reason||'').trim();

      if(!companyId)return sendJson(res,400,{success:false,error:'A company ID is required.'});
      const allowed=new Set(['approved','rejected','pending_review','deactivate','reactivate']);
      if(!allowed.has(action))return sendJson(res,400,{success:false,error:'Unsupported employer review action.'});
      if((action==='rejected'||action==='deactivate')&&!reason){
        return sendJson(res,400,{success:false,error:'Enter a reason before continuing.'});
      }

      const now=new Date().toISOString();
      const {data:verificationRow,error:lookupError}=await supabase
        .from('employer_verifications').select('user_id,company_id,verification_status')
        .eq('company_id',companyId).maybeSingle();
      if(lookupError)throw lookupError;

      // Jobs belong to the employer user, not directly to the company.
      // Verify that link before changing verification/account state.
      if(['pending_review','rejected','deactivate'].includes(action) && !verificationRow?.user_id){
        return sendJson(res,400,{success:false,error:'Could not identify the employer account for this company.'});
      }

      if(action==='deactivate'||action==='reactivate'){
        const nextAccountStatus=action==='deactivate'?'deactivated':'active';

        const {error}=await supabase.from('companies')
          .update({account_status:nextAccountStatus})
          .eq('id',companyId);
        if(error)throw error;

        // A deactivated company must never have candidate-visible jobs.
        // Only active jobs are changed, so manually paused/closed/archived jobs
        // keep their existing state.
        let jobsPaused=0;
        if(action==='deactivate'){
          jobsPaused=await pauseCompanyJobsForVerification(
            supabase,
            verificationRow.user_id,
            'account_deactivated'
          );
        }

        // Reactivation does NOT automatically reopen jobs. The employer/admin
        // can deliberately activate eligible jobs after the account is restored.
        return sendJson(res,200,{
          success:true,
          company_id:companyId,
          account_status:nextAccountStatus,
          jobs_paused:jobsPaused
        });
      }

      const {data:latestDocument,error:documentLookupError}=await supabase
        .from('employer_verification_documents').select('id,review_status')
        .eq('company_id',companyId).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(documentLookupError)throw documentLookupError;
      if(action==='approved'&&!latestDocument){
        return sendJson(res,400,{success:false,error:'A verification document must be uploaded before this employer can be approved.'});
      }

      // One admin decision must be reflected everywhere Alygnn still reads
      // verification state. `companies` / `employer_verifications` are canonical,
      // while several employer-facing website pages still read the legacy fields
      // on `profiles`, so keep them in lockstep here on the server.
      const returningToPending=action==='pending_review';

      const {error:verificationError}=await supabase.from('employer_verifications').update({
        verification_status:action,
        reviewed_by:returningToPending?null:admin.id,
        reviewed_at:returningToPending?null:now,
        rejection_reason:action==='rejected'?reason:null,
        updated_at:now
      }).eq('company_id',companyId);
      if(verificationError)throw verificationError;

      const {error:companyError}=await supabase.from('companies')
        .update({verification_status:action}).eq('id',companyId);
      if(companyError)throw companyError;

      // Candidate safety: any company that is not approved must have no active
      // candidate-visible jobs. Candidate pages load jobs where jobs.status='active',
      // so pausing active jobs removes them from candidate discovery.
      //
      // Do NOT auto-reactivate jobs on approval. That avoids reopening manually
      // paused/closed jobs or exceeding the employer's current slot capacity.
      let jobsPaused=0;
      if(action==='pending_review'||action==='rejected'){
        jobsPaused=await pauseCompanyJobsForVerification(
          supabase,
          verificationRow.user_id,
          action==='rejected'?'verification_rejected':'verification_pending'
        );
      }

      // Sync every active Alygnn employer account attached to this company, not
      // only the original owner/submitting user. That prevents the Account page,
      // Dashboard, team members, and admin queue from showing different states.
      const profileIds=new Set();
      if(verificationRow?.user_id)profileIds.add(verificationRow.user_id);

      const {data:members,error:memberLookupError}=await supabase
        .from('company_members')
        .select('user_id,membership_status')
        .eq('company_id',companyId)
        .in('membership_status',['active','pending']);

      if(memberLookupError){
        console.warn('Company member verification sync lookup failed:',memberLookupError);
      }else{
        for(const member of members||[]){
          if(member?.user_id)profileIds.add(member.user_id);
        }
      }

      if(profileIds.size){
        const {error:profileError}=await supabase.from('profiles').update({
          verification_status:action,
          employer_verified:action==='approved'
        }).in('id',[...profileIds]);
        if(profileError)throw profileError;
      }

      // Keep the latest uploaded verification document in the same state too.
      // This is especially important for Move to Pending after an approval.
      if(latestDocument?.id){
        const {error:documentError}=await supabase.from('employer_verification_documents')
          .update({
            review_status:action,
            rejection_reason:action==='rejected'?reason:null,
            reviewed_by:returningToPending?null:admin.id,
            reviewed_at:returningToPending?null:now
          })
          .eq('id',latestDocument.id);
        if(documentError)throw documentError;
      }

      return sendJson(res,200,{
        success:true,
        company_id:companyId,
        verification_status:action,
        synced_profile_count:profileIds.size,
        jobs_paused:jobsPaused
      });
    }

    res.setHeader('Allow','GET, PATCH, POST, OPTIONS');
    return sendJson(res,405,{success:false,error:'Method not allowed.'});
  } catch (error) {
    console.error('Employer verification admin error:',error);
    return sendJson(res,error.status||500,{success:false,error:error.message||'Unable to process the employer review.'});
  }
};
