'use strict';

const { createClient } = require('@supabase/supabase-js');

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

  const candidateMarked =
    ['candidate', 'seeker', 'employee'].includes(accountType) ||
    ['candidate', 'seeker', 'employee'].includes(authRole) ||
    ['candidate', 'seeker', 'employee'].includes(profileRole);

  const teamMarked =
    accountType === 'employer_team' ||
    authRole === 'team_member' ||
    profileRole === 'team_member';

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

  if (!teamMarked || candidateMarked || candidateActivityCount > 0 || hasResume) {
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

  const users = await listAllAuthUsers(supabase);
  const ids = users.map(user => user.id);

  const profiles = ids.length
    ? await (async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('id,full_name,role,account_type,is_admin')
          .in('id', ids);
        if (error) {
          if (schemaMissing(error)) return [];
          throw error;
        }
        return data || [];
      })()
    : [];

  const memberships = ids.length
    ? await (async () => {
        const { data, error } = await supabase
          .from('company_members')
          .select('user_id,company_id,team_role,membership_status')
          .in('user_id', ids);
        if (error) {
          if (schemaMissing(error)) return [];
          throw error;
        }
        return data || [];
      })()
    : [];

  const ownedCompanies = ids.length
    ? await (async () => {
        const { data, error } = await supabase
          .from('companies')
          .select('id,company_name,owner_user_id')
          .in('owner_user_id', ids);
        if (error) {
          if (schemaMissing(error)) return [];
          throw error;
        }
        return data || [];
      })()
    : [];

  const companyIds = [...new Set([
    ...memberships.map(row => row.company_id),
    ...ownedCompanies.map(row => row.id)
  ].filter(Boolean))];

  const companies = companyIds.length
    ? await (async () => {
        const { data, error } = await supabase
          .from('companies')
          .select('id,company_name')
          .in('id', companyIds);
        if (error) {
          if (schemaMissing(error)) return [];
          throw error;
        }
        return data || [];
      })()
    : [];

  const profileMap = new Map(profiles.map(row => [String(row.id), row]));
  const companyMap = new Map(companies.map(row => [String(row.id), row.company_name || 'Company']));

  const membershipMap = new Map();
  for (const row of memberships) {
    if (String(row.membership_status || 'active').toLowerCase() !== 'active') continue;
    const key = String(row.user_id);
    if (!membershipMap.has(key)) membershipMap.set(key, []);
    membershipMap.get(key).push(row);
  }

  const ownerMap = new Map();
  for (const row of ownedCompanies) {
    const key = String(row.owner_user_id);
    if (!ownerMap.has(key)) ownerMap.set(key, []);
    ownerMap.get(key).push(row);
  }

  const normalizedQuery = String(query || '').trim().toLowerCase();

  return users
    .map(user => {
      const profile = profileMap.get(String(user.id)) || {};
      const memberRows = membershipMap.get(String(user.id)) || [];
      const ownerRows = ownerMap.get(String(user.id)) || [];
      const teamRoles = [...new Set(memberRows.map(row => String(row.team_role || '').toLowerCase()).filter(Boolean))];
      const companyNames = [...new Set([
        ...memberRows.map(row => companyMap.get(String(row.company_id))).filter(Boolean),
        ...ownerRows.map(row => row.company_name || companyMap.get(String(row.id))).filter(Boolean)
      ])];
      const isAdmin = profile.is_admin === true;
      let protectedReason = '';
      if (isAdmin) protectedReason = 'Admin accounts are protected from deletion here.';
      else if (String(user.id) === String(requester.id)) protectedReason = 'You cannot delete the admin account you are currently signed in with.';

      return {
        id: user.id,
        email: user.email || '',
        full_name: profile.full_name || user.user_metadata?.full_name || '',
        role: profile.role || profile.account_type || user.user_metadata?.role || user.user_metadata?.account_type || '',
        is_admin: isAdmin,
        team_roles: teamRoles,
        companies: companyNames,
        owns_company: ownerRows.length > 0,
        created_at: user.created_at || null,
        protected_reason: protectedReason
      };
    })
    .filter(row => {
      if (!normalizedQuery) return true;
      const haystack = [
        row.email,
        row.full_name,
        row.role,
        row.id,
        ...(row.team_roles || []),
        ...(row.companies || [])
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 250);
}

module.exports = async function handler(req, res) {
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
    const requester = await authenticatedUser(req, supabase);
    const body = parseBody(req);
    const scope = String(
      req.method === 'GET' ? (req.query?.scope || '') : (body.scope || '')
    ).trim().toLowerCase();

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

        if (!targetId) return sendJson(res, 400, { success: false, error: 'A user ID is required.' });
        if (targetId === requester.id) return sendJson(res, 400, { success: false, error: 'You cannot delete the admin account you are currently using.' });
        if (confirmWord !== 'DELETE') return sendJson(res, 400, { success: false, error: 'Type DELETE exactly to confirm.' });

        const { data, error } = await supabase.auth.admin.getUserById(targetId);
        const target = data?.user;
        if (error || !target) return sendJson(res, 404, { success: false, error: 'Alygnn account not found.' });

        const targetProfile = await profileFor(supabase, targetId, 'id,is_admin');
        if (targetProfile?.is_admin === true) {
          return sendJson(res, 403, { success: false, error: 'Admin accounts are protected from deletion on this page.' });
        }
        if (confirmEmail !== String(target.email || '').toLowerCase()) {
          return sendJson(res, 400, { success: false, error: 'The confirmation email does not match this account.' });
        }

        await permanentlyDeleteUser(supabase, target);
        return sendJson(res, 200, { success: true, user_id: targetId });
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
