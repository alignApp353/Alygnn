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


async function pauseCompanyJobsForVerification(supabase, companyId, reason) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'paused',
      pause_reason: reason,
      updated_at: now
    })
    .eq('company_id', companyId)
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
      html=`<h2>New company update request</h2><p><strong>${companyUpdateEsc(r.company_name_snapshot)}</strong> · Account ID: ${companyUpdateEsc(account)}</p><p>Field: ${companyUpdateEsc(label)}</p><p>Current: ${companyUpdateEsc(r.current_value)}</p><p>Requested: ${companyUpdateEsc(r.requested_value)}</p><p>Reason: ${companyUpdateEsc(r.reason)}</p><p><a href="https://alygnn.com/employer-verification-admin.html">Review in Alygnn Admin</a></p>`;
    }else{
      // Address is resolved from Supabase Auth; never trust a client-supplied recipient.
      const {data:auth}=await db.auth.admin.getUserById(r.employer_id);
      recipient=auth?.user?.email;
      if(!recipient)return res.status(422).json({error:'Employer email is unavailable'});
      subject=event==='approved'?'Alygnn — Company update approved':'Alygnn — Company update declined';
      html=`<h2>Company update ${companyUpdateEsc(event)}</h2><p>Your request to update <strong>${companyUpdateEsc(label)}</strong> for ${companyUpdateEsc(r.company_name_snapshot)} (Account ID: ${companyUpdateEsc(account)}) was ${companyUpdateEsc(event)}.</p>${event==='declined'&&r.admin_note?`<p>Reason: ${companyUpdateEsc(r.admin_note)}</p>`:''}<p><a href="https://alygnn.com/employer-account.html">View your Alygnn account</a></p>`;
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
            companyId,
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
          companyId,
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
