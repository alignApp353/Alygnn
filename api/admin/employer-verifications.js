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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
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


function isMissingSchemaError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205' ||
    message.includes('does not exist') || message.includes('could not find the') || message.includes('schema cache')
  );
}

async function safeDeleteBy(supabase, table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error && !isMissingSchemaError(error)) {
    throw new Error(`${table}.${column} cleanup failed: ${error.message}`);
  }
}

async function safeNullBy(supabase, table, column, value) {
  const { error } = await supabase.from(table).update({ [column]: null }).eq(column, value);
  if (error && !isMissingSchemaError(error)) {
    console.warn(`Could not clear ${table}.${column}:`, error.message);
  }
}

async function safeSelectIds(supabase, table, select, column, value) {
  const { data, error } = await supabase.from(table).select(select).eq(column, value);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw new Error(`${table}.${column} lookup failed: ${error.message}`);
  }
  return data || [];
}

async function fetchInChunks(supabase, table, select, column, values, chunkSize = 100) {
  const unique = [...new Set((values || []).filter(Boolean))];
  const result = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const batch = unique.slice(i, i + chunkSize);
    const { data, error } = await supabase.from(table).select(select).in(column, batch);
    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw error;
    }
    result.push(...(data || []));
  }
  return result;
}

async function listAllAuthUsers(supabase, maxUsers = 5000) {
  const users = [];
  const perPage = 1000;
  for (let page = 1; users.length < maxUsers; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < perPage) break;
  }
  return users.slice(0, maxUsers);
}

async function buildAccountRows(supabase, queryText = '') {
  const authUsers = await listAllAuthUsers(supabase);
  const userIds = authUsers.map(user => user.id).filter(Boolean);

  const [profiles, memberships, ownedCompanies] = await Promise.all([
    fetchInChunks(supabase, 'profiles', 'id,full_name,role,is_admin,company_name,created_at', 'id', userIds),
    fetchInChunks(supabase, 'company_members', 'user_id,company_id,team_role,role,membership_status,member_name,member_email', 'user_id', userIds),
    fetchInChunks(supabase, 'companies', 'id,owner_user_id,company_name,account_status,verification_status', 'owner_user_id', userIds)
  ]);

  const profileMap = new Map((profiles || []).map(row => [String(row.id), row]));
  const membershipMap = new Map();
  for (const row of memberships || []) {
    const key = String(row.user_id || '');
    if (!membershipMap.has(key)) membershipMap.set(key, []);
    membershipMap.get(key).push(row);
  }

  const ownedMap = new Map();
  for (const row of ownedCompanies || []) {
    const key = String(row.owner_user_id || '');
    if (!ownedMap.has(key)) ownedMap.set(key, []);
    ownedMap.get(key).push(row);
  }

  const companyIds = [...new Set([
    ...(memberships || []).map(row => row.company_id),
    ...(ownedCompanies || []).map(row => row.id)
  ].filter(Boolean))];
  const companies = await fetchInChunks(
    supabase,
    'companies',
    'id,company_name,owner_user_id,account_status,verification_status',
    'id',
    companyIds
  );
  const companyMap = new Map((companies || []).map(row => [String(row.id), row]));

  let rows = authUsers.map(user => {
    const id = String(user.id || '');
    const profile = profileMap.get(id) || {};
    const memberRows = membershipMap.get(id) || [];
    const activeMembership = memberRows.find(row => String(row.membership_status || 'active').toLowerCase() === 'active') || memberRows[0] || null;
    const ownerCompanies = ownedMap.get(id) || [];
    const owned = ownerCompanies[0] || null;
    const memberCompany = activeMembership ? companyMap.get(String(activeMembership.company_id || '')) : null;
    const company = owned || memberCompany || null;

    return {
      user_id: user.id,
      email: user.email || activeMembership?.member_email || '',
      full_name: profile.full_name || activeMembership?.member_name || user.user_metadata?.full_name || user.user_metadata?.name || '',
      role: profile.role || user.user_metadata?.role || user.user_metadata?.account_type || '',
      account_type: user.user_metadata?.account_type || '',
      is_admin: profile.is_admin === true,
      owns_company: !!owned,
      company_id: company?.id || activeMembership?.company_id || null,
      company_name: company?.company_name || profile.company_name || '',
      company_status: company?.account_status || '',
      team_role: activeMembership?.team_role || activeMembership?.role || '',
      membership_status: activeMembership?.membership_status || '',
      created_at: user.created_at || profile.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      email_confirmed_at: user.email_confirmed_at || null
    };
  });

  const q = String(queryText || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter(row => [
      row.user_id,
      row.email,
      row.full_name,
      row.role,
      row.account_type,
      row.team_role,
      row.company_name
    ].some(value => String(value || '').toLowerCase().includes(q)));
  }

  rows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  return rows.slice(0, q ? 100 : 50);
}

async function listAllFiles(storageBucket, rootPrefix) {
  const files = [];
  const folders = [String(rootPrefix || '').replace(/^\/+|\/+$/g, '')];
  let safetyCount = 0;

  while (folders.length && safetyCount < 10000) {
    const folder = folders.shift();
    let offset = 0;
    while (safetyCount < 10000) {
      const { data, error } = await storageBucket.list(folder, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      });
      if (error) {
        console.warn(`Could not list storage folder "${folder}":`, error.message);
        break;
      }
      const rows = data || [];
      if (!rows.length) break;
      for (const item of rows) {
        safetyCount += 1;
        const path = folder ? `${folder}/${item.name}` : item.name;
        if (item.id || item.metadata) files.push(path);
        else folders.push(path);
      }
      if (rows.length < 100) break;
      offset += rows.length;
    }
  }
  return files;
}

async function removePaths(storageBucket, paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const { error } = await storageBucket.remove(unique.slice(i, i + 100));
    if (error) throw new Error(`Could not remove stored account files: ${error.message}`);
  }
}

async function cleanupStorage(supabase, userId, profile, ownedCompanyIds) {
  const resumeBucket = supabase.storage.from('resumes');
  const resumePaths = await listAllFiles(resumeBucket, userId);
  if (profile?.resume_file_path) resumePaths.push(profile.resume_file_path);
  if (resumePaths.length) await removePaths(resumeBucket, resumePaths);

  const employerBucket = supabase.storage.from('employer-verification-documents');
  const employerPaths = [];
  if (profile?.hiring_blueprint?.irs_document_path) employerPaths.push(profile.hiring_blueprint.irs_document_path);
  const verificationDocs = await safeSelectIds(
    supabase,
    'employer_verification_documents',
    'storage_path',
    'uploaded_by',
    userId
  );
  for (const row of verificationDocs) if (row.storage_path) employerPaths.push(row.storage_path);
  employerPaths.push(...(await listAllFiles(employerBucket, userId)));
  for (const companyId of ownedCompanyIds) {
    employerPaths.push(...(await listAllFiles(employerBucket, companyId)));
  }
  if (employerPaths.length) await removePaths(employerBucket, employerPaths);
}

async function cleanupMessagingData(supabase, userId) {
  const conversationIds = new Set();
  for (const column of ['candidate_id', 'employer_id']) {
    const rows = await safeSelectIds(supabase, 'application_conversations', 'id', column, userId);
    rows.forEach(row => row?.id && conversationIds.add(row.id));
  }
  for (const id of conversationIds) {
    await safeDeleteBy(supabase, 'application_messages', 'conversation_id', id);
    await safeDeleteBy(supabase, 'application_conversations', 'id', id);
  }
  await safeDeleteBy(supabase, 'application_messages', 'sender_id', userId);

  const threadIds = new Set();
  for (const column of ['candidate_id', 'employer_id']) {
    const rows = await safeSelectIds(supabase, 'message_threads', 'id', column, userId);
    rows.forEach(row => row?.id && threadIds.add(row.id));
  }
  for (const id of threadIds) {
    await safeDeleteBy(supabase, 'messages', 'thread_id', id);
    await safeDeleteBy(supabase, 'message_threads', 'id', id);
  }
  await safeDeleteBy(supabase, 'messages', 'sender_id', userId);
}

async function cleanupCandidateData(supabase, userId) {
  await cleanupMessagingData(supabase, userId);
  const candidateTables = [
    ['applications', 'candidate_id'],
    ['skipped_jobs', 'candidate_id'],
    ['saved_jobs', 'candidate_id'],
    ['liked_jobs', 'candidate_id'],
    ['job_likes', 'candidate_id'],
    ['swipes', 'candidate_id'],
    ['swipe_actions', 'candidate_id'],
    ['job_views', 'candidate_id'],
    ['password_change_codes', 'user_id']
  ];
  for (const [table, column] of candidateTables) await safeDeleteBy(supabase, table, column, userId);
}

async function deleteJobDependents(supabase, jobIds) {
  for (const jobId of jobIds) {
    const apps = await safeSelectIds(supabase, 'applications', 'id', 'job_id', jobId);
    for (const app of apps) {
      await safeDeleteBy(supabase, 'application_messages', 'application_id', app.id);
      await safeDeleteBy(supabase, 'application_conversations', 'application_id', app.id);
      await safeDeleteBy(supabase, 'message_threads', 'application_id', app.id);
    }
    await safeDeleteBy(supabase, 'application_conversations', 'job_id', jobId);
    await safeDeleteBy(supabase, 'message_threads', 'job_id', jobId);
    await safeDeleteBy(supabase, 'applications', 'job_id', jobId);
    await safeDeleteBy(supabase, 'skipped_jobs', 'job_id', jobId);
    await safeDeleteBy(supabase, 'saved_jobs', 'job_id', jobId);
    await safeDeleteBy(supabase, 'liked_jobs', 'job_id', jobId);
    await safeDeleteBy(supabase, 'job_likes', 'job_id', jobId);
    await safeDeleteBy(supabase, 'swipes', 'job_id', jobId);
    await safeDeleteBy(supabase, 'swipe_actions', 'job_id', jobId);
    await safeDeleteBy(supabase, 'job_views', 'job_id', jobId);
  }
}

async function cleanupJobsOwnedByUser(supabase, userId) {
  const ownershipColumns = ['employer_id', 'created_by', 'user_id', 'owner_id'];
  const jobIds = new Set();
  for (const column of ownershipColumns) {
    const rows = await safeSelectIds(supabase, 'jobs', 'id', column, userId);
    rows.forEach(row => row?.id && jobIds.add(row.id));
  }
  await deleteJobDependents(supabase, [...jobIds]);
  for (const column of ownershipColumns) await safeDeleteBy(supabase, 'jobs', column, userId);
}

async function cleanupCompanyData(supabase, userId) {
  const ownedCompanies = await safeSelectIds(supabase, 'companies', 'id', 'owner_user_id', userId);
  const ownedCompanyIds = ownedCompanies.map(row => row?.id).filter(Boolean);

  await safeNullBy(supabase, 'company_members', 'approved_by', userId);
  await safeNullBy(supabase, 'employer_verifications', 'reviewed_by', userId);
  await safeNullBy(supabase, 'employer_verification_documents', 'reviewed_by', userId);
  await safeNullBy(supabase, 'company_team_invites', 'invited_by', userId);

  await safeDeleteBy(supabase, 'company_activity_log', 'actor_user_id', userId);
  await safeDeleteBy(supabase, 'company_activity_log', 'target_user_id', userId);
  await safeDeleteBy(supabase, 'company_members', 'user_id', userId);
  await safeDeleteBy(supabase, 'company_team_invites', 'accepted_user_id', userId);
  await safeDeleteBy(supabase, 'company_team_invites', 'user_id', userId);

  for (const companyId of ownedCompanyIds) {
    const companyJobs = await safeSelectIds(supabase, 'jobs', 'id', 'company_id', companyId);
    await deleteJobDependents(supabase, companyJobs.map(row => row?.id).filter(Boolean));
    await safeDeleteBy(supabase, 'jobs', 'company_id', companyId);
    await safeDeleteBy(supabase, 'employer_verification_documents', 'company_id', companyId);
    await safeDeleteBy(supabase, 'employer_verifications', 'company_id', companyId);
    await safeDeleteBy(supabase, 'company_activity_log', 'company_id', companyId);
    await safeDeleteBy(supabase, 'company_blueprints', 'company_id', companyId);
    await safeDeleteBy(supabase, 'company_team_invites', 'company_id', companyId);
    await safeDeleteBy(supabase, 'company_members', 'company_id', companyId);
    await safeDeleteBy(supabase, 'companies', 'id', companyId);
  }
  return ownedCompanyIds;
}

async function permanentlyDeleteAccount(supabase, admin, body) {
  const targetUserId = String(body.user_id || '').trim();
  const confirmationEmail = String(body.confirmation_email || '').trim().toLowerCase();
  const confirmationText = String(body.confirmation_text || '').trim();

  if (!targetUserId) {
    const error = new Error('Choose an Alygnn account to delete.');
    error.status = 400;
    throw error;
  }
  if (targetUserId === admin.id) {
    const error = new Error('You cannot delete the admin account you are currently using.');
    error.status = 400;
    throw error;
  }

  const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(targetUserId);
  const targetUser = targetData?.user;
  if (targetError || !targetUser) {
    const error = new Error('That Alygnn account could not be found.');
    error.status = 404;
    throw error;
  }

  const targetEmail = String(targetUser.email || '').trim().toLowerCase();
  if (!targetEmail || confirmationEmail !== targetEmail || confirmationText !== 'DELETE') {
    const error = new Error('Account deletion confirmation did not match.');
    error.status = 400;
    throw error;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', targetUserId)
    .maybeSingle();
  if (profileError && !isMissingSchemaError(profileError)) throw profileError;

  const protectedAdminEmail = adminEmails().has(targetEmail);
  if (profile?.is_admin === true || protectedAdminEmail) {
    const error = new Error('Admin accounts are protected and cannot be deleted from Account Management.');
    error.status = 403;
    throw error;
  }

  const ownedCompanies = await safeSelectIds(supabase, 'companies', 'id', 'owner_user_id', targetUserId);
  const ownedCompanyIds = ownedCompanies.map(row => row?.id).filter(Boolean);

  await cleanupStorage(supabase, targetUserId, profile || null, ownedCompanyIds);
  await cleanupCandidateData(supabase, targetUserId);
  await cleanupJobsOwnedByUser(supabase, targetUserId);
  await cleanupCompanyData(supabase, targetUserId);
  await safeDeleteBy(supabase, 'employer_verification_documents', 'uploaded_by', targetUserId);
  await safeDeleteBy(supabase, 'employer_verifications', 'user_id', targetUserId);
  await safeDeleteBy(supabase, 'employer_entitlements', 'employer_id', targetUserId);
  await safeDeleteBy(supabase, 'profiles', 'id', targetUserId);

  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(targetUserId, false);
  if (deleteUserError) {
    throw new Error(
      'The Alygnn profile data was cleaned up, but Supabase could not remove the login because another database reference still exists. Check the Vercel log for the exact constraint: ' + deleteUserError.message
    );
  }

  console.log('ADMIN_ACCOUNT_DELETED', {
    admin_user_id: admin.id,
    admin_email: admin.email,
    target_user_id: targetUserId,
    target_email: targetEmail,
    deleted_at: new Date().toISOString()
  });

  return { success: true, user_id: targetUserId, email: targetEmail };
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const supabase = serviceClient();
    const admin = await requireAdmin(req, supabase);
    const resource = String(req.query?.resource || '').trim().toLowerCase();

    if (req.method === 'GET' && resource === 'accounts') {
      const q = String(req.query?.q || '').trim();
      const accounts = await buildAccountRows(supabase, q);
      return sendJson(res, 200, { success: true, accounts });
    }

    if (req.method === 'DELETE' && resource === 'accounts') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const result = await permanentlyDeleteAccount(supabase, admin, body);
      return sendJson(res, 200, result);
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

      if(action==='deactivate'||action==='reactivate'){
        const {error}=await supabase.from('companies')
          .update({account_status:action==='deactivate'?'deactivated':'active'})
          .eq('id',companyId);
        if(error)throw error;
        return sendJson(res,200,{success:true,company_id:companyId,account_status:action==='deactivate'?'deactivated':'active'});
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
        synced_profile_count:profileIds.size
      });
    }

    res.setHeader('Allow','GET, PATCH, DELETE, OPTIONS');
    return sendJson(res,405,{success:false,error:'Method not allowed.'});
  } catch (error) {
    console.error('Employer verification admin error:',error);
    return sendJson(res,error.status||500,{success:false,error:error.message||'Unable to process the employer review.'});
  }
};
