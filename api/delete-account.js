'use strict';

const { createClient } = require('@supabase/supabase-js');

// Capacitor Android's local WebView must be explicitly permitted to call Alygnn's API.
const ALLOWED_ACCOUNT_ORIGINS = new Set([
  'https://alygnn.com', 'https://www.alygnn.com',
  'https://localhost', 'http://localhost',
  'capacitor://localhost', 'ionic://localhost'
]);
function setAccountCors(req, res) {
  const origin = String(req.headers?.origin || '');
  if (ALLOWED_ACCOUNT_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Apikey');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.toLowerCase().startsWith('bearer ')
    ? value.slice(7).trim()
    : '';
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
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );
}

function schemaMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();

  return (
    ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) ||
    message.includes('does not exist') ||
    message.includes('could not find the') ||
    message.includes('schema cache')
  );
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
  }
  return req.body || {};
}

async function authenticatedUser(req, supabase) {
  const token = bearer(req);
  if (!token) {
    const error = new Error('Sign in required.');
    error.status = 401;
    throw error;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const authError = new Error('Your session is invalid or expired.');
    authError.status = 401;
    throw authError;
  }

  return data.user;
}

async function profileFor(supabase, userId, columns = '*') {
  const { data, error } = await supabase
    .from('profiles')
    .select(columns)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (schemaMissing(error)) return null;
    throw error;
  }

  return data || null;
}

async function requireAdmin(supabase, requester) {
  const profile = await profileFor(supabase, requester.id, 'id,is_admin');
  if (profile?.is_admin !== true) {
    const error = new Error('This account is not authorized as an Alygnn administrator.');
    error.status = 403;
    throw error;
  }
  return profile;
}

async function safeDeleteBy(supabase, table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error && !schemaMissing(error)) {
    throw new Error(`${table}.${column} cleanup failed: ${error.message}`);
  }
}

async function safeNullBy(supabase, table, column, value) {
  const { error } = await supabase
    .from(table)
    .update({ [column]: null })
    .eq(column, value);

  if (error && !schemaMissing(error)) {
    console.warn(`Could not clear ${table}.${column}:`, error.message);
  }
}

async function safeSelect(supabase, table, columns, column, value) {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq(column, value);

  if (error) {
    if (schemaMissing(error)) return [];
    throw error;
  }

  return data || [];
}

async function safeCount(supabase, table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);

  if (error) {
    if (schemaMissing(error)) return 0;
    throw error;
  }

  return Number(count || 0);
}


async function stripeRequest(method, path, params = {}) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    const error = new Error('Stripe billing cleanup is not configured on the server.');
    error.status = 500;
    throw error;
  }

  const url = new URL('https://api.stripe.com/v1/' + String(path || '').replace(/^\/+/, ''));
  const options = {
    method,
    headers: { Authorization: 'Bearer ' + secret }
  };

  if (method === 'GET') {
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.append(key, String(value));
    }
  } else if (Object.keys(params || {}).length) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null) continue;
      body.append(key, String(value));
    }
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = body;
  }

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Stripe billing cleanup failed.');
    error.status = response.status;
    error.stripeCode = data?.error?.code || '';
    throw error;
  }

  return data;
}

async function stripeSubscriptionIdsForEmployer(supabase, userId, ownedCompanyIds) {
  const ids = new Set();

  const entitlements = await safeSelect(
    supabase,
    'employer_entitlements',
    'stripe_plan_subscription_id',
    'employer_id',
    userId
  );
  for (const row of entitlements) {
    if (row?.stripe_plan_subscription_id) ids.add(String(row.stripe_plan_subscription_id));
  }

  const seatRows = await safeSelect(
    supabase,
    'company_team_seat_subscriptions',
    'stripe_subscription_id',
    'employer_id',
    userId
  );
  for (const row of seatRows) {
    if (row?.stripe_subscription_id) ids.add(String(row.stripe_subscription_id));
  }

  for (const companyId of ownedCompanyIds || []) {
    const companySeatRows = await safeSelect(
      supabase,
      'company_team_seat_subscriptions',
      'stripe_subscription_id',
      'company_id',
      companyId
    );
    for (const row of companySeatRows) {
      if (row?.stripe_subscription_id) ids.add(String(row.stripe_subscription_id));
    }
  }

  let page = '';
  for (let i = 0; i < 10; i += 1) {
    const result = await stripeRequest('GET', 'subscriptions/search', {
      query: `metadata['employer_id']:'${userId}'`,
      limit: 100,
      page: page || undefined
    });

    for (const subscription of result?.data || []) {
      if (subscription?.id) ids.add(String(subscription.id));
    }

    if (!result?.has_more || !result?.next_page) break;
    page = result.next_page;
  }

  return [...ids].filter(id => /^sub_/.test(id));
}

async function cancelEmployerStripeSubscriptions(supabase, userId, ownedCompanyIds) {
  if (!(ownedCompanyIds || []).length) return [];

  const subscriptionIds = await stripeSubscriptionIdsForEmployer(
    supabase,
    userId,
    ownedCompanyIds
  );

  const canceled = [];

  for (const subscriptionId of subscriptionIds) {
    let subscription;
    try {
      subscription = await stripeRequest(
        'GET',
        'subscriptions/' + encodeURIComponent(subscriptionId)
      );
    } catch (error) {
      if (error?.status === 404 || error?.stripeCode === 'resource_missing') continue;
      throw error;
    }

    if (String(subscription?.status || '').toLowerCase() === 'canceled') continue;

    // Clear the employer binding first so the later Stripe cancellation webhook
    // cannot recreate billing entitlements after this Alygnn account is removed.
    await stripeRequest(
      'POST',
      'subscriptions/' + encodeURIComponent(subscriptionId),
      { 'metadata[employer_id]': '' }
    );

    try {
      await stripeRequest(
        'DELETE',
        'subscriptions/' + encodeURIComponent(subscriptionId)
      );
      canceled.push(subscriptionId);
    } catch (error) {
      if (error?.status === 404 || error?.stripeCode === 'resource_missing') continue;
      throw error;
    }
  }

  return canceled;
}

async function candidateState(supabase, targetUser, profileOverride = null) {
  const id = targetUser.id;
  const profile = profileOverride || await profileFor(supabase, id, '*') || {};
  const meta = targetUser.user_metadata || {};

  const accountType = String(meta.account_type || profile?.account_type || '').toLowerCase();
  const authRole = String(meta.role || '').toLowerCase();
  const profileRole = String(profile?.role || '').toLowerCase();

  const candidateMarked =
    ['candidate', 'seeker', 'employee'].includes(accountType) ||
    ['candidate', 'seeker', 'employee'].includes(authRole) ||
    ['candidate', 'seeker', 'employee'].includes(profileRole);

  const candidateActivityChecks = [
    ['applications', 'candidate_id'],
    ['saved_jobs', 'candidate_id'],
    ['liked_jobs', 'candidate_id'],
    ['skipped_jobs', 'candidate_id'],
    ['swipes', 'candidate_id'],
    ['swipe_actions', 'candidate_id'],
    ['job_views', 'candidate_id'],
    ['preferences', 'user_id'],
    ['preferences', 'candidate_id'],
    ['resumes', 'user_id'],
    ['resumes', 'candidate_id']
  ];

  let candidateActivityCount = 0;
  for (const [table, column] of candidateActivityChecks) {
    candidateActivityCount += await safeCount(supabase, table, column, id);
    if (candidateActivityCount > 0) break;
  }

  const hasResume = !!(
    profile?.resume_file_path ||
    profile?.resume_source ||
    profile?.resume_data
  );

  const hasCandidate = candidateMarked || candidateActivityCount > 0 || hasResume;

  let candidateRole =
    ['candidate', 'seeker', 'employee'].includes(profileRole) ? profileRole :
    ['candidate', 'seeker', 'employee'].includes(authRole) ? authRole :
    ['candidate', 'seeker', 'employee'].includes(accountType) ? accountType :
    'candidate';

  if (candidateRole === 'employee') candidateRole = 'candidate';

  return {
    has_candidate: hasCandidate,
    candidate_role: candidateRole,
    candidate_marked: candidateMarked,
    candidate_activity_count: candidateActivityCount,
    has_resume: hasResume,
    profile
  };
}

async function activeTeamMemberships(supabase, userId) {
  const rows = await safeSelect(
    supabase,
    'company_members',
    'company_id,user_id,team_role,membership_status',
    'user_id',
    userId
  );

  return rows.filter(
    row => String(row.membership_status || 'active').toLowerCase() === 'active'
  );
}

async function removeEmployerTeamAccessOnly(supabase, targetUser) {
  const id = targetUser.id;
  const profile = await profileFor(supabase, id, '*') || {};
  const candidate = await candidateState(supabase, targetUser, profile);

  if (!candidate.has_candidate) {
    const error = new Error(
      'This login does not have a candidate account to preserve. Use full account deletion for a team-only login.'
    );
    error.status = 409;
    throw error;
  }

  const memberships = await activeTeamMemberships(supabase, id);
  if (!memberships.length) {
    const error = new Error('This account does not currently have employer team access.');
    error.status = 409;
    throw error;
  }

  // Remove employer workspace membership/role only.
  await safeDeleteBy(supabase, 'company_members', 'user_id', id);

  // Remove accepted invite links when those columns exist in the installed schema.
  await safeDeleteBy(supabase, 'company_team_invites', 'accepted_user_id', id);
  await safeDeleteBy(supabase, 'company_team_invites', 'user_id', id);

  // Restore candidate-facing role markers if an older team invitation changed them.
  const profileRole = String(profile?.role || '').toLowerCase();
  const profileAccountType = String(profile?.account_type || '').toLowerCase();
  const profilePatch = {};

  if (['team_member', 'employer_team', 'recruiter', 'hiring_manager'].includes(profileRole)) {
    profilePatch.role = candidate.candidate_role;
  }
  if (['team_member', 'employer_team'].includes(profileAccountType)) {
    profilePatch.account_type = 'candidate';
  }

  if (Object.keys(profilePatch).length) {
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update(profilePatch)
      .eq('id', id);

    if (profileUpdateError && !schemaMissing(profileUpdateError)) {
      throw profileUpdateError;
    }
  }

  const currentMeta = { ...(targetUser.user_metadata || {}) };
  delete currentMeta.team_invite_id;
  delete currentMeta.team_role;
  delete currentMeta.company_id;
  delete currentMeta.company_account_number;

  if (['team_member', 'employer_team', 'recruiter', 'hiring_manager'].includes(String(currentMeta.role || '').toLowerCase())) {
    currentMeta.role = candidate.candidate_role;
  }
  if (['team_member', 'employer_team'].includes(String(currentMeta.account_type || '').toLowerCase())) {
    currentMeta.account_type = 'candidate';
  }

  const { error: metadataError } = await supabase.auth.admin.updateUserById(id, {
    user_metadata: currentMeta
  });
  if (metadataError) throw metadataError;

  return {
    user_id: id,
    removed_company_ids: memberships.map(row => row.company_id).filter(Boolean),
    candidate_preserved: true
  };
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

  if (profile?.hiring_blueprint?.irs_document_path) {
    employerPaths.push(profile.hiring_blueprint.irs_document_path);
  }

  const verificationDocs = await safeSelect(
    supabase,
    'employer_verification_documents',
    'storage_path',
    'uploaded_by',
    userId
  );

  for (const row of verificationDocs) {
    if (row.storage_path) employerPaths.push(row.storage_path);
  }

  employerPaths.push(...(await listAllFiles(employerBucket, userId)));

  for (const companyId of ownedCompanyIds) {
    employerPaths.push(...(await listAllFiles(employerBucket, companyId)));
  }

  if (employerPaths.length) await removePaths(employerBucket, employerPaths);
}

async function cleanupConversationRows(supabase, userId) {
  for (const side of ['candidate_id', 'employer_id']) {
    const conversations = await safeSelect(
      supabase,
      'application_conversations',
      'id',
      side,
      userId
    );
    for (const row of conversations) {
      if (row?.id) await safeDeleteBy(supabase, 'application_messages', 'conversation_id', row.id);
    }
    await safeDeleteBy(supabase, 'application_conversations', side, userId);

    const threads = await safeSelect(
      supabase,
      'message_threads',
      'id',
      side,
      userId
    );
    for (const row of threads) {
      if (row?.id) await safeDeleteBy(supabase, 'messages', 'thread_id', row.id);
    }
    await safeDeleteBy(supabase, 'message_threads', side, userId);
  }

  await safeDeleteBy(supabase, 'application_messages', 'sender_id', userId);
  await safeDeleteBy(supabase, 'messages', 'sender_id', userId);
}

async function cleanupCandidateData(supabase, userId) {
  await cleanupConversationRows(supabase, userId);

  const candidateTables = [
    ['applications', 'candidate_id'],
    ['skipped_jobs', 'candidate_id'],
    ['saved_jobs', 'candidate_id'],
    ['liked_jobs', 'candidate_id'],
    ['job_likes', 'candidate_id'],
    ['swipes', 'candidate_id'],
    ['swipe_actions', 'candidate_id'],
    ['job_views', 'candidate_id'],
    ['preferences', 'user_id'],
    ['preferences', 'candidate_id'],
    ['resumes', 'user_id'],
    ['resumes', 'candidate_id'],
    ['password_change_codes', 'user_id'],
    ['notifications', 'user_id']
  ];

  for (const [table, column] of candidateTables) {
    await safeDeleteBy(supabase, table, column, userId);
  }
}

async function deleteConversationRowsForJob(supabase, jobId) {
  const conversations = await safeSelect(
    supabase,
    'application_conversations',
    'id',
    'job_id',
    jobId
  );
  for (const row of conversations) {
    if (row?.id) await safeDeleteBy(supabase, 'application_messages', 'conversation_id', row.id);
  }
  await safeDeleteBy(supabase, 'application_conversations', 'job_id', jobId);

  const threads = await safeSelect(supabase, 'message_threads', 'id', 'job_id', jobId);
  for (const row of threads) {
    if (row?.id) await safeDeleteBy(supabase, 'messages', 'thread_id', row.id);
  }
  await safeDeleteBy(supabase, 'message_threads', 'job_id', jobId);
}

async function deleteJobDependents(supabase, jobIds) {
  for (const jobId of jobIds) {
    await deleteConversationRowsForJob(supabase, jobId);
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
    const rows = await safeSelect(supabase, 'jobs', 'id', column, userId);
    rows.forEach(row => { if (row?.id) jobIds.add(row.id); });
  }

  await deleteJobDependents(supabase, [...jobIds]);

  for (const column of ownershipColumns) {
    await safeDeleteBy(supabase, 'jobs', column, userId);
  }
}

async function cleanupCompanyData(supabase, userId) {
  const ownedCompanies = await safeSelect(
    supabase,
    'companies',
    'id,company_name',
    'owner_user_id',
    userId
  );

  const ownedCompanyIds = ownedCompanies.map(row => row?.id).filter(Boolean);

  await safeNullBy(supabase, 'company_members', 'approved_by', userId);
  await safeNullBy(supabase, 'employer_verifications', 'reviewed_by', userId);
  await safeNullBy(supabase, 'employer_verification_documents', 'reviewed_by', userId);

  await safeDeleteBy(supabase, 'company_activity_log', 'actor_user_id', userId);
  await safeDeleteBy(supabase, 'company_activity_log', 'target_user_id', userId);
  await safeDeleteBy(supabase, 'company_members', 'user_id', userId);
  await safeDeleteBy(supabase, 'company_team_seat_subscriptions', 'employer_id', userId);
  await safeDeleteBy(supabase, 'employer_addon_slot_purchases', 'employer_id', userId);
  await safeDeleteBy(supabase, 'employer_profile_update_requests', 'employer_id', userId);

  for (const companyId of ownedCompanyIds) {
    const companyJobs = await safeSelect(supabase, 'jobs', 'id', 'company_id', companyId);
    await deleteJobDependents(supabase, companyJobs.map(row => row?.id).filter(Boolean));
    await safeDeleteBy(supabase, 'jobs', 'company_id', companyId);

    const companyTables = [
      'employer_verification_documents',
      'employer_verifications',
      'company_activity_log',
      'company_blueprints',
      'company_members',
      'company_team_seat_subscriptions',
      'employer_profile_update_requests'
    ];

    for (const table of companyTables) {
      await safeDeleteBy(supabase, table, 'company_id', companyId);
    }

    await safeDeleteBy(supabase, 'companies', 'id', companyId);
  }

  return ownedCompanyIds;
}

async function permanentlyDeleteUser(supabase, targetUser) {
  const userId = targetUser.id;
  const profile = await profileFor(supabase, userId, '*');

  const ownedCompanies = await safeSelect(
    supabase,
    'companies',
    'id',
    'owner_user_id',
    userId
  );
  const ownedCompanyIds = ownedCompanies.map(row => row?.id).filter(Boolean);

  // An employer owner must not leave live recurring Stripe billing behind after
  // permanent account deletion. Team-only/candidate deletions never enter this
  // cleanup because they do not own a company.
  await cancelEmployerStripeSubscriptions(supabase, userId, ownedCompanyIds);

  await cleanupStorage(supabase, userId, profile, ownedCompanyIds);
  await cleanupCandidateData(supabase, userId);
  await cleanupJobsOwnedByUser(supabase, userId);
  await cleanupCompanyData(supabase, userId);

  await safeDeleteBy(supabase, 'employer_verification_documents', 'uploaded_by', userId);
  await safeDeleteBy(supabase, 'employer_verifications', 'user_id', userId);
  await safeDeleteBy(supabase, 'employer_entitlements', 'employer_id', userId);
  await safeDeleteBy(supabase, 'profiles', 'id', userId);

  const { error } = await supabase.auth.admin.deleteUser(userId, false);
  if (error) {
    throw new Error(
      'Database error deleting user. A remaining database reference is still attached to this account. ' +
      error.message
    );
  }
}

async function ownerContext(supabase, requester, targetId) {
  const { data: owned, error } = await supabase
    .from('companies')
    .select('id,company_name,owner_user_id')
    .eq('owner_user_id', requester.id);

  if (error) throw error;
  if (!(owned || []).length) {
    const e = new Error('Only the company owner can permanently delete a team-only Alygnn login.');
    e.status = 403;
    throw e;
  }

  const ids = (owned || []).map(c => c.id);
  const { data: memberships, error: membershipError } = await supabase
    .from('company_members')
    .select('company_id,user_id,team_role,membership_status')
    .eq('user_id', targetId)
    .in('company_id', ids);

  if (membershipError) throw membershipError;

  const membership = (memberships || []).find(
    row => String(row.membership_status || 'active').toLowerCase() === 'active'
  ) || null;

  if (!membership) {
    const e = new Error('That account is not an active member of a company you own.');
    e.status = 403;
    throw e;
  }

  const company = (owned || []).find(c => String(c.id) === String(membership.company_id));
  return { company, membership };
}

async function teamDeletionEligibility(supabase, targetUser) {
  const id = targetUser.id;
  const profile = await profileFor(supabase, id, '*');

  if (profile?.is_admin === true) {
    return { allowed: false, reason: 'Admin accounts cannot be deleted by an employer.' };
  }

  const owned = await safeSelect(supabase, 'companies', 'id', 'owner_user_id', id);
  if (owned.length) {
    return { allowed: false, reason: 'This account owns an employer company and cannot be deleted from Team Members.' };
  }

  const memberships = await safeSelect(
    supabase,
    'company_members',
    'company_id,membership_status',
    'user_id',
    id
  );
  const activeMemberships = memberships.filter(
    row => String(row.membership_status || 'active').toLowerCase() === 'active'
  );

  if (activeMemberships.length > 1) {
    return {
      allowed: false,
      reason: 'This login belongs to more than one employer workspace. Remove it from this workspace instead, or use Alygnn Admin Account Management.'
    };
  }

  const meta = targetUser.user_metadata || {};
  const accountType = String(meta.account_type || profile?.account_type || '').toLowerCase();
  const authRole = String(meta.role || '').toLowerCase();
  const profileRole = String(profile?.role || '').toLowerCase();

  const teamMarked =
    accountType === 'employer_team' ||
    authRole === 'team_member' ||
    profileRole === 'team_member';

  const candidate = await candidateState(supabase, targetUser, profile);

  if (!teamMarked || candidate.has_candidate) {
    return {
      allowed: false,
      reason: 'This person has a personal candidate account or candidate activity. The company can remove workspace access, but only the person or an Alygnn administrator can permanently delete the Alygnn account.'
    };
  }

  return { allowed: true, reason: '' };
}

async function listAllAuthUsers(supabase) {
  const users = [];
  const perPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }

  return users;
}

async function adminAccountList(supabase, requester, query) {
  await requireAdmin(supabase, requester);

  // Privacy + support workflow rule:
  // never enumerate all Alygnn accounts from the admin page. The admin must
  // provide the exact Company ID supplied by the customer, and only accounts
  // connected to that one company are returned.
  const companyId = String(query || '').trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!companyId || !uuidPattern.test(companyId)) return [];

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('id,company_name,owner_user_id,account_status,verification_status')
    .eq('id', companyId)
    .maybeSingle();

  if (companyError) {
    if (schemaMissing(companyError)) return [];
    throw companyError;
  }
  if (!company) return [];

  const { data: membershipRows, error: membershipError } = await supabase
    .from('company_members')
    .select('user_id,company_id,team_role,membership_status')
    .eq('company_id', companyId);

  if (membershipError && !schemaMissing(membershipError)) throw membershipError;

  const memberships = (membershipRows || []).filter(
    row => String(row.membership_status || 'active').toLowerCase() === 'active'
  );

  const userIds = [...new Set([
    company.owner_user_id,
    ...memberships.map(row => row.user_id)
  ].filter(Boolean).map(String))];

  if (!userIds.length) return [];

  const { data: profilesData, error: profilesError } = await supabase
    .from('profiles')
    .select('id,full_name,role,account_type,is_admin')
    .in('id', userIds);

  if (profilesError && !schemaMissing(profilesError)) throw profilesError;
  const profileMap = new Map((profilesData || []).map(row => [String(row.id), row]));

  const membershipsByUser = new Map();
  for (const row of memberships) {
    const key = String(row.user_id || '');
    if (!membershipsByUser.has(key)) membershipsByUser.set(key, []);
    membershipsByUser.get(key).push(row);
  }

  const rows = [];

  for (const userId of userIds) {
    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
    const user = authData?.user;
    if (authError || !user) continue;

    const profile = profileMap.get(String(userId)) || {};
    const memberRows = membershipsByUser.get(String(userId)) || [];
    const isOwner = String(company.owner_user_id || '') === String(userId);
    const isAdmin = profile.is_admin === true;
    const candidate = await candidateState(supabase, user, profile);
    const hasTeamAccess = memberRows.length > 0;
    const dualWorkspace = hasTeamAccess && candidate.has_candidate;
    const teamRoles = [...new Set(
      memberRows.map(row => String(row.team_role || '').toLowerCase()).filter(Boolean)
    )];

    let protectedReason = '';
    if (isAdmin) protectedReason = 'Admin accounts are protected from deletion here.';
    else if (String(user.id) === String(requester.id)) protectedReason = 'You cannot delete the admin account you are currently signed in with.';

    rows.push({
      id: user.id,
      email: user.email || '',
      full_name: profile.full_name || user.user_metadata?.full_name || '',
      role: profile.role || profile.account_type || user.user_metadata?.role || user.user_metadata?.account_type || '',
      is_admin: isAdmin,
      team_roles: teamRoles,
      companies: [company.company_name || 'Company'],
      company_ids: [company.id],
      company_id: company.id,
      company_name: company.company_name || '',
      owns_company: isOwner,
      has_candidate_account: candidate.has_candidate,
      has_team_access: hasTeamAccess,
      dual_workspace: dualWorkspace,
      created_at: user.created_at || null,
      protected_reason: protectedReason
    });
  }

  rows.sort((a, b) => {
    if (a.owns_company !== b.owns_company) return a.owns_company ? -1 : 1;
    return String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || ''));
  });

  return rows;
}


// Account lifecycle shares the existing /api/delete-account function.
// No additional Vercel function is necessary.
const LIFE_TABLE = 'account_deactivation_requests';
const LIFECYCLE_DAY_MS = 24 * 60 * 60 * 1000;

// Send a security confirmation only after Stripe/job cleanup is complete.
// This uses Alygnn's existing Resend account; no new API route is needed.
function formatDeactivationDeadline(iso) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    timeZoneName: 'short'
  }).format(new Date(iso));
}

// The brand mark is Alygnn's actual image asset (GitHub root /alygnn-logo.png),
// not an approximate text logo drawn with an email client's fallback font.
const ACCOUNT_EMAIL_LOGO_URL = 'https://alygnn.com/alygnn-email-logo.png';
function accountEmailLayout(contentHtml) {
  return `
  <div style="margin:0;padding:32px 12px;background:#F6F8F7;font-family:Arial,Helvetica,sans-serif;color:#1A2530">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="max-width:540px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #DDE3E8;border-radius:16px">
      <tr><td align="center" style="padding:25px 24px 23px;border-bottom:1px solid #DDE3E8;background:#ffffff;text-align:center">
        <a href="https://alygnn.com/" style="text-decoration:none;display:inline-block" target="_blank">
          <img alt="Alygnn" src="${ACCOUNT_EMAIL_LOGO_URL}" width="226" height="69" align="center" style="width:226px;height:auto;max-width:100%;display:block;margin:0 auto;border:0;outline:none;text-decoration:none" />
        </a>
      </td></tr>
      <tr><td style="padding:30px 30px 24px;font-size:15px;line-height:1.7;color:#4A5968">${contentHtml}</td></tr>
      <tr><td style="padding:18px 30px;border-top:1px solid #DDE3E8;color:#718295;font-size:12px;line-height:1.6">Security notification from Alygnn. <a href="https://alygnn.com/" style="color:#5D7FA3;text-decoration:underline">alygnn.com</a></td></tr>
    </table>
  </div>`;
}

async function sendDeactivationConfirmationOnce(sb, user) {
  // A missing or failed email must never undo a completed deactivation.
  const row = await lifecycleRow(sb, user.id);
  if (row?.status !== 'deactivated' || !row.cleanup_completed_at) {
    return {queued:false, reason:'cleanup_incomplete'};
  }
  if (row.deactivation_email_sent_at) return {queued:true, already_sent:true};
  if (!row.delete_after || Date.parse(row.delete_after) <= Date.now()) {
    return {queued:false, reason:'recovery_window_expired'};
  }
  if (!user.email) {
    console.error('Alygnn account deactivated without a verified notification address:', user.id);
    return {queued:false, reason:'missing_email'};
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured; account was deactivated, but its email was not sent.');
    return {queued:false, reason:'email_not_configured'};
  }

  const dateText = formatDeactivationDeadline(row.delete_after);
  const subject = 'Your Alygnn account has been deactivated';
  const text = [
    'Your Alygnn account has been deactivated.',
    '',
    'Your 30-day recovery period ends on ' + dateText + '.',
    'To reactivate, sign in to Alygnn before that deadline and follow the instructions.',
    'Your account is scheduled for permanent deletion after the recovery period.',
    '',
    'Any canceled subscriptions and closed job postings are not automatically restored when you reactivate.',
    '',
    'If you did not request this change, contact contact@alygnn.com as soon as possible.',
    '',
    'Alygnn Support | https://alygnn.com'
  ].join('\n');
  const html = accountEmailLayout(`
    <h1 style="font-size:25px;line-height:1.3;margin:0 0 18px;color:#1A2530">Your account is deactivated</h1>
    <p style="margin:0 0 18px">This email confirms your Alygnn account has been deactivated.</p>
    <div style="background:#F0F6F8;border:1px solid #DAE7ED;padding:16px 18px;border-radius:12px;margin:0 0 18px">
      <div style="font-size:13px;color:#506274">Your 30-day recovery period ends</div>
      <div style="font-size:17px;font-weight:700;color:#1A2530;margin-top:6px">${dateText}</div>
    </div>
    <p style="margin:0 0 16px">To reactivate, sign in to Alygnn before this deadline and follow the recovery instructions. After the recovery period, the account is scheduled for permanent deletion.</p>
    <p style="margin:0 0 16px">Canceled subscriptions and closed job postings will not automatically reopen if you reactivate.</p>
    <p style="margin:0">Didn't request this? Contact <a href="mailto:contact@alygnn.com" style="color:#5D7FA3">contact@alygnn.com</a> right away.</p>
  `);

  // Resend deduplicates retries with the same idempotency key for 24 hours.
  // A distinct deactivation period uses a distinct key.
  const key = `alygnn-deactivated-${user.id}-${row.deactivated_at}`;
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify({
        from: 'Alygnn <admin@alygnn.com>',
        reply_to: 'contact@alygnn.com',
        to: [user.email],
        subject, text, html
      }),
      signal: AbortSignal.timeout(9000)
    });
  } catch (error) {
    console.error('Resend account deactivation notification connection failed:', error);
    return {queued:false, reason:'email_service_unavailable'};
  }
  if (!response.ok) {
    const errorText = await response.text().catch(()=>'');
    console.error('Resend rejected account deactivation notification:', response.status, errorText.slice(0,600));
    return {queued:false, reason:'email_provider_rejected'};
  }

  // Resend accepted the email. Record this for future requests/retries.
  const {error:markError} = await sb.from(LIFE_TABLE)
    .update({deactivation_email_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})
    .eq('user_id', user.id).eq('status','deactivated')
    .is('deactivation_email_sent_at', null);
  if (markError) console.error('Email accepted by Resend but could not mark it sent in Supabase:', markError);
  return {queued:true};
}

async function lifecycleRow(sb, userId) {
  const {data, error} = await sb.from(LIFE_TABLE)
    .select('user_id,status,deactivated_at,delete_after,reactivated_at,cleanup_completed_at,deactivation_email_sent_at,reactivation_email_sent_at')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function closeOwnedJobs(sb, userId, companyIds) {
  // Closing listings is essential, but other Alygnn routes must independently
  // reject applications against inactive/closed jobs.
  for (const column of ['employer_id', 'created_by', 'user_id', 'owner_id']) {
    const {error} = await sb.from('jobs').update({status:'closed'})
      .eq(column, userId).in('status', ['active','pending']);
    if (error && !schemaMissing(error)) throw error;
  }
  for (const companyId of companyIds) {
    const {error} = await sb.from('jobs').update({status:'closed'})
      .eq('company_id',companyId).in('status',['active','pending']);
    if (error && !schemaMissing(error)) throw error;
  }
}

async function deactivateAccount(sb, user) {
  const profile = await profileFor(sb, user.id, 'id,is_admin');
  if (profile?.is_admin === true) {
    const error = new Error('Alygnn administrator accounts cannot use self-service deactivation.');
    error.status = 403;
    throw error;
  }
  const current = await lifecycleRow(sb, user.id);
  if (current?.status === 'deleting') {
    const error = new Error('Account deletion is already underway.');
    error.status = 409;
    throw error;
  }
  if (current?.status === 'deactivated' && current.cleanup_completed_at) {
    return {success:true,status:'deactivated',delete_after:current.delete_after,
      cleanup_complete:true,already_deactivated:true};
  }

  // Mark deactivated FIRST; retries never extend an existing 30-day deadline.
  const now = new Date().toISOString();
  const deadline = current?.status === 'deactivated' && current.delete_after
    ? current.delete_after
    : new Date(Date.now() + 30 * LIFECYCLE_DAY_MS).toISOString();
  const {error:writeError} = await sb.from(LIFE_TABLE).upsert({
    user_id:user.id, status:'deactivated',
    deactivated_at:(current?.status === 'deactivated' && current.deactivated_at) || now,
    delete_after:deadline, reactivated_at:null, cleanup_completed_at:null,
    deactivation_email_sent_at:current?.status === 'deactivated' ? (current.deactivation_email_sent_at || null) : null,
    reactivation_email_sent_at:null,
    updated_at:now
  },{onConflict:'user_id'});
  if (writeError) throw writeError;

  // A deactivated employer owner must not keep billing or accepting applicants.
  // These operations are NOT atomic with Supabase state; report partial failures.
  const {data:companies,error:companiesError} = await sb.from('companies')
    .select('id').eq('owner_user_id',user.id);
  if (companiesError) throw companiesError;
  const companyIds = (companies || []).map(c=>c.id).filter(Boolean);
  await cancelEmployerStripeSubscriptions(sb,user.id,companyIds);
  await closeOwnedJobs(sb,user.id,companyIds);

  const {error:completedError} = await sb.from(LIFE_TABLE)
    .update({cleanup_completed_at:new Date().toISOString(),updated_at:new Date().toISOString()})
    .eq('user_id',user.id).eq('status','deactivated');
  if (completedError) throw completedError;
  return {success:true,status:'deactivated',delete_after:deadline,
    cleanup_complete:true,subscriptions_canceled:true,jobs_closed:true};
}

async function reactivateAccount(sb, user) {
  const row = await lifecycleRow(sb,user.id);
  if (row?.status !== 'deactivated' || !row.delete_after ||
      Date.parse(row.delete_after) <= Date.now()) {
    const error = new Error('This account is not within its 30-day recovery period.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const {data,error} = await sb.from(LIFE_TABLE)
    .update({status:'active',reactivated_at:now,delete_after:null,
      cleanup_completed_at:null,reactivation_email_sent_at:null,updated_at:now})
    .eq('user_id',user.id).eq('status','deactivated')
    .gt('delete_after',now).select('user_id');
  if (error) throw error;
  if (!data?.length) {
    const error = new Error('Reactivation could not be completed. Please retry.');
    error.status = 409;
    throw error;
  }
  return {success:true,status:'active',
    subscriptions_restored:false,jobs_restored:false};
}

async function sendReactivationConfirmationOnce(sb, user) {
  // Send only after the database confirms that this account was reactivated.
  const row = await lifecycleRow(sb, user.id);
  if (row?.status !== 'active' || !row.reactivated_at) {
    return {queued:false, reason:'reactivation_not_confirmed'};
  }
  if (row.reactivation_email_sent_at) return {queued:true, already_sent:true};
  if (!user.email) return {queued:false, reason:'missing_email'};
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured; reactivation was successful but no email could be sent.');
    return {queued:false, reason:'email_not_configured'};
  }

  const dateText = formatDeactivationDeadline(row.reactivated_at);
  const subject = 'Your Alygnn account has been reactivated';
  const text = [
    'Your Alygnn account has been successfully reactivated.',
    '',
    'Reactivated on ' + dateText + '.',
    'You can sign in to your account again.',
    '',
    'Canceled subscriptions and closed job postings are not automatically restored.',
    'If you did not reactivate this account, contact contact@alygnn.com immediately.',
    '',
    'Alygnn Support | https://alygnn.com'
  ].join('\n');
  const html = accountEmailLayout(`
    <h1 style="font-size:25px;line-height:1.3;margin:0 0 18px;color:#1A2530">Your account is active again</h1>
    <p style="margin:0 0 16px">Your Alygnn account has been <strong style="color:#206B45">successfully reactivated</strong>. Welcome back!</p>
    <div style="background:#EEF8F0;border:1px solid #D1E9DA;border-radius:12px;padding:15px 18px;margin:0 0 18px">
      <div style="font-size:13px;color:#49715C">Account status</div>
      <div style="font-size:18px;font-weight:700;color:#206B45;margin-top:4px">Active</div>
      <div style="font-size:13px;color:#506274;margin-top:5px">Reactivated on ${dateText}</div>
    </div>
    <p style="margin:0 0 16px">You can now sign in and use your Alygnn account again.</p>
    <p style="margin:0 0 18px"><strong>Important:</strong> Any subscriptions canceled or job postings closed during deactivation have not automatically been restored.</p>
    <p style="margin:0 0 20px"><a href="https://alygnn.com/" style="display:inline-block;background:#5D7FA3;padding:11px 19px;border-radius:8px;color:#ffffff;text-decoration:none;font-weight:700">Go to Alygnn</a></p>
    <p style="margin:0">Didn't reactivate your account? Contact <a href="mailto:contact@alygnn.com" style="color:#5D7FA3">contact@alygnn.com</a> immediately.</p>
  `);

  const key = `alygnn-reactivated-${user.id}-${row.reactivated_at}`;
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{
        Authorization:`Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':'application/json',
        'Idempotency-Key':key
      },
      body:JSON.stringify({
        from:'Alygnn <admin@alygnn.com>',
        reply_to:'contact@alygnn.com',
        to:[user.email], subject, text, html
      }),
      signal:AbortSignal.timeout(9000)
    });
  } catch (error) {
    console.error('Resend reactivation email request failed:', error);
    return {queued:false, reason:'email_service_unavailable'};
  }
  if (!response.ok) {
    const errorText = await response.text().catch(()=>'');
    console.error('Resend rejected reactivation email:',response.status,errorText.slice(0,600));
    return {queued:false, reason:'email_provider_rejected'};
  }
  // Guard against overwriting a later deactivation/reactivation event.
  const {error:markError} = await sb.from(LIFE_TABLE)
    .update({reactivation_email_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})
    .eq('user_id',user.id).eq('status','active').eq('reactivated_at',row.reactivated_at)
    .is('reactivation_email_sent_at',null);
  if (markError) console.error('Resend accepted reactivation email but Supabase marker update failed:',markError);
  return {queued:true};
}

async function lifecycleAction(req,res,sb,user,action) {
  if (action === 'closure_status') {
    const current=await lifecycleRow(sb,user.id);
    return sendJson(res,200,{success:true,status:current?.status || 'active',
      delete_after:current?.status === 'deactivated' ? current.delete_after : null,
      cleanup_complete:current?.status === 'deactivated' ? !!current.cleanup_completed_at : null});
  }
  if (action === 'deactivate') {
    try {
      const outcome = await deactivateAccount(sb,user);
      let confirmation = {queued:false};
      try {
        confirmation = await sendDeactivationConfirmationOnce(sb,user);
      } catch (emailError) {
        // Do not turn an account-closure success into a failure if email logging fails.
        console.error('Unexpected deactivation notification error:', emailError);
      }
      return sendJson(res,200,{
        ...outcome,
        confirmation_email_queued:!!confirmation.queued,
        confirmation_email_reason:confirmation.queued ? undefined : (confirmation.reason || 'email_unavailable')
      });
    } catch (error) {
      // A partial Stripe/job failure must never be misreported as no change.
      const current=await lifecycleRow(sb,user.id).catch(()=>null);
      if (current?.status === 'deactivated') {
        console.error('Deactivation cleanup incomplete:',user.id,error);
        return sendJson(res,503,{success:false,status:'deactivated',
          error:'Account deactivation was recorded, but billing or job cleanup was not confirmed. Contact Alygnn support.'});
      }
      throw error;
    }
  }
  if (action === 'reactivate') {
    const outcome = await reactivateAccount(sb,user);
    let confirmation = {queued:false};
    try {
      confirmation = await sendReactivationConfirmationOnce(sb,user);
    } catch (emailError) {
      console.error('Unexpected reactivation notification error:',emailError);
    }
    return sendJson(res,200,{
      ...outcome,
      confirmation_email_queued:!!confirmation.queued,
      confirmation_email_reason:confirmation.queued ? undefined : (confirmation.reason || 'email_unavailable')
    });
  }
  return sendJson(res,400,{success:false,error:'Unknown account action.'});
}

async function scheduledClosureCleanup(res,sb) {
  const {data:due,error} = await sb.from(LIFE_TABLE).select('user_id')
    .eq('status','deactivated').lte('delete_after',new Date().toISOString()).limit(10);
  if (error) throw error;
  let processed=0,failures=0;
  for (const row of due || []) {
    try {
      const {data:claimed,error:claimError} = await sb.from(LIFE_TABLE)
        .update({status:'deleting',updated_at:new Date().toISOString()})
        .eq('user_id',row.user_id).eq('status','deactivated')
        .lte('delete_after',new Date().toISOString()).select('user_id');
      if (claimError) throw claimError;
      if (!claimed?.length) continue;
      const {data,error:authError}=await sb.auth.admin.getUserById(row.user_id);
      if (authError && !/not found|does not exist/i.test(authError.message || '')) throw authError;
      if (data?.user) await permanentlyDeleteUser(sb,data.user);
      const {error:clearError}=await sb.from(LIFE_TABLE).delete().eq('user_id',row.user_id);
      if (clearError) throw clearError;
      processed++;
    } catch (error) {
      failures++;
      console.error('Scheduled account deletion failed:',row.user_id,error);
      // Only reset a row we have claimed; leave it for safe retry.
      const {error:resetError}=await sb.from(LIFE_TABLE)
        .update({status:'deactivated',updated_at:new Date().toISOString()})
        .eq('user_id',row.user_id).eq('status','deleting');
      if (resetError) console.error('Could not reset pending deletion:',resetError);
    }
  }
  return sendJson(res,200,{success:true,processed,failures});
}

function isVercelCron(req) {
  if (req.method !== 'GET') return false;
  const secret=String(process.env.CRON_SECRET || '');
  const provided=String(req.headers?.authorization || '');
  const expected='Bearer '+secret;
  if (!secret || provided.length !== expected.length) return false;
  const crypto=require('crypto');
  return crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  setAccountCors(req,res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    return res.status(204).end();
  }

  let supabase;
  try {
    supabase = serviceClient();
  } catch (error) {
    console.error('Delete account configuration error:', error);
    return sendJson(res, 500, {
      success: false,
      error: 'Account deletion is not configured on the server.'
    });
  }

  try {
    const body = parseBody(req);
    // Vercel Cron calls GET with Authorization: Bearer CRON_SECRET.
    if (isVercelCron(req)) return await scheduledClosureCleanup(res,supabase);
    const requester = await authenticatedUser(req, supabase);
    const closureAction = req.method === 'GET' ? String(req.query?.action || '') : String(body.action || '');
    const scope = String(
      req.method === 'GET' ? (req.query?.scope || '') : (body.scope || '')
    ).trim().toLowerCase();
    if (!scope && ((req.method === 'GET' && (!closureAction || closureAction === 'closure_status')) ||
        (req.method === 'POST' && ['deactivate','reactivate'].includes(closureAction)))) {
      return await lifecycleAction(req,res,supabase,requester,closureAction || 'closure_status');
    }

    // ---------------------------------------------------------------------
    // Admin account management, reusing this EXISTING Vercel function.
    // ---------------------------------------------------------------------
    if (scope === 'admin') {
      await requireAdmin(supabase, requester);

      if (req.method === 'GET') {
        const accounts = await adminAccountList(supabase, requester, req.query?.q || '');
        return sendJson(res, 200, { success: true, accounts });
      }

      if (req.method === 'DELETE') {
        const targetId = String(body.user_id || '').trim();
        const confirmEmail = String(body.confirm_email || '').trim().toLowerCase();
        const confirmWord = String(body.confirm_word || '').trim();
        const deletionMode = String(body.deletion_mode || 'full').trim().toLowerCase();

        if (!targetId) return sendJson(res, 400, { success: false, error: 'A user ID is required.' });
        if (targetId === requester.id) return sendJson(res, 400, { success: false, error: 'You cannot delete the admin account you are currently using.' });
        if (confirmWord !== 'DELETE') return sendJson(res, 400, { success: false, error: 'Type DELETE exactly to confirm.' });

        const { data, error } = await supabase.auth.admin.getUserById(targetId);
        const target = data?.user;
        if (error || !target) return sendJson(res, 404, { success: false, error: 'Alygnn account not found.' });

        const targetProfile = await profileFor(supabase, targetId, '*');
        if (targetProfile?.is_admin === true) {
          return sendJson(res, 403, { success: false, error: 'Admin accounts are protected from deletion on this page.' });
        }
        if (confirmEmail !== String(target.email || '').toLowerCase()) {
          return sendJson(res, 400, { success: false, error: 'The confirmation email does not match this account.' });
        }

        const candidate = await candidateState(supabase, target, targetProfile || {});
        const memberships = await activeTeamMemberships(supabase, targetId);
        const isDualCandidateTeamAccount = candidate.has_candidate && memberships.length > 0;

        // A dual candidate + Recruiter/Hiring Manager/Admin account keeps the
        // Alygnn login and candidate data. Admin deletion removes only employer
        // workspace access.
        if (deletionMode === 'employer_only') {
          if (!isDualCandidateTeamAccount) {
            return sendJson(res, 409, {
              success: false,
              error: 'Employer-only deletion is available only when this login has both a candidate account and employer team access.'
            });
          }

          const result = await removeEmployerTeamAccessOnly(supabase, target);
          return sendJson(res, 200, {
            success: true,
            mode: 'employer_only',
            user_id: targetId,
            candidate_preserved: true,
            removed_company_ids: result.removed_company_ids
          });
        }

        if (isDualCandidateTeamAccount) {
          return sendJson(res, 409, {
            success: false,
            error: 'This login also has a candidate account. To protect the candidate account, Alygnn Admin can remove only the employer team access from this screen.'
          });
        }

        await permanentlyDeleteUser(supabase, target);
        return sendJson(res, 200, { success: true, mode: 'full', user_id: targetId });
      }

      res.setHeader('Allow', 'GET, DELETE, OPTIONS');
      return sendJson(res, 405, { success: false, error: 'Method not allowed.' });
    }

    // ---------------------------------------------------------------------
    // Employer owner deletion of TEAM-ONLY logins.
    // ---------------------------------------------------------------------
    if (scope === 'team') {
      const targetId = String(
        req.method === 'GET' ? (req.query?.user_id || '') : (body.user_id || '')
      ).trim();

      if (!targetId) return sendJson(res, 400, { success: false, error: 'A team member user ID is required.' });
      if (targetId === requester.id) return sendJson(res, 400, { success: false, error: 'You cannot delete your own account from Team Members.' });

      const context = await ownerContext(supabase, requester, targetId);
      const { data, error } = await supabase.auth.admin.getUserById(targetId);
      const target = data?.user;
      if (error || !target) return sendJson(res, 404, { success: false, error: 'Team member account not found.' });

      const check = await teamDeletionEligibility(supabase, target);

      if (req.method === 'GET') {
        return sendJson(res, 200, {
          success: true,
          can_delete: check.allowed,
          reason: check.reason,
          email: target.email || '',
          company_name: context.company?.company_name || ''
        });
      }

      if (req.method === 'DELETE') {
        if (!check.allowed) return sendJson(res, 409, { success: false, error: check.reason });

        const confirmEmail = String(body.confirm_email || '').trim().toLowerCase();
        const confirmWord = String(body.confirm_word || '').trim();
        if (confirmWord !== 'DELETE') return sendJson(res, 400, { success: false, error: 'Type DELETE exactly to confirm.' });
        if (confirmEmail !== String(target.email || '').toLowerCase()) {
          return sendJson(res, 400, { success: false, error: 'The confirmation email does not match this team member.' });
        }

        await permanentlyDeleteUser(supabase, target);
        return sendJson(res, 200, { success: true, user_id: targetId });
      }

      res.setHeader('Allow', 'GET, DELETE, OPTIONS');
      return sendJson(res, 405, { success: false, error: 'Method not allowed.' });
    }

    // ---------------------------------------------------------------------
    // Existing self-service account deletion. Keep this behavior intact.
    // ---------------------------------------------------------------------
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return sendJson(res, 405, { success: false, error: 'Method not allowed.' });
    }

    // Self-deletion must be explicitly requested and confirmed. A missing or
    // misspelled action must NEVER fall through into permanent deletion.
    if (body.action !== 'delete' || body.confirm_word !== 'DELETE') {
      return sendJson(res,400,{success:false,error:'Permanent deletion requires action delete and the exact confirmation DELETE.'});
    }
    await permanentlyDeleteUser(supabase, requester);
    return sendJson(res, 200, { success: true });
  } catch (error) {
    console.error('Account deletion/account management error:', error);
    return sendJson(res, error.status || 500, {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to manage this Alygnn account.'
    });
  }
};
