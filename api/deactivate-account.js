'use strict';

// Employer/candidate 30-day account lifecycle endpoint.
// POST { action: 'deactivate' }  -- authenticated account only
// POST { action: 'reactivate' }  -- authenticated account only, within 30 days
// GET                           -- authenticated account lifecycle status
// GET + Authorization: Bearer CRON_SECRET -- scheduled batch purge (Vercel Cron)
//
// REQUIRES sql/account-deactivation.sql to have been applied to Supabase.
// IMPORTANT: App login/navigation and server authorization must also enforce
// the deactivated state. Adding this endpoint by itself does NOT make hidden
// accounts inaccessible in all parts of Alygnn.

const {
  serviceClient,
  authenticatedUser,
  safeSelect,
  schemaMissing,
  cancelEmployerStripeSubscriptions,
  permanentlyDeleteUser,
  setAccountCors,
  profileFor
} = require('./delete-account').__accountLifecycle;

const DAY = 24 * 60 * 60 * 1000;
const LIFE_TABLE = 'account_deactivation_requests';
const BATCH_LIMIT = 10;

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body;
}

function authHeader(req) {
  return String(req.headers?.authorization || '');
}

function safeError(error) {
  const message = String(error?.message || '');
  if (/account_deactivation_requests|relation .*does not exist|schema cache|PGRST205|42P01/i.test(message)) {
    return { status: 503, error: 'Account deactivation database setup is incomplete. Please contact Alygnn support.' };
  }
  if (/fetch failed|failed to fetch|ECONN|ENOTFOUND|ETIMEDOUT|network/i.test(message)) {
    return { status: 502, error: 'Could not reach Alygnn authentication or database. Please try again.' };
  }
  return { status: error?.status || 500, error: message || 'Unable to update your account status.' };
}

async function lifecycleRow(supabase, userId) {
  const { data, error } = await supabase.from(LIFE_TABLE)
    .select('user_id,status,deactivated_at,delete_after,reactivated_at,cleanup_completed_at')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function closeOwnedJobs(supabase, userId, companyIds) {
  // Keep data intact for restoration. Closing listings prevents new applications.
  // This is additive to, not a substitute for, central server-side enforcement.
  for (const column of ['employer_id', 'created_by', 'user_id', 'owner_id']) {
    const { error } = await supabase.from('jobs').update({ status: 'closed' })
      .eq(column, userId).in('status', ['active', 'pending']);
    if (error && !schemaMissing(error)) throw error;
  }
  for (const companyId of companyIds) {
    const { error } = await supabase.from('jobs').update({ status: 'closed' })
      .eq('company_id', companyId).in('status', ['active', 'pending']);
    if (error && !schemaMissing(error)) throw error;
  }
}

async function deactivate(supabase, user) {
  const profile = await profileFor(supabase, user.id, 'is_admin');
  if (profile?.is_admin === true) {
    return { success: false, http_status: 403, error: 'An Alygnn administrator cannot deactivate their account here.' };
  }
  const previous = await lifecycleRow(supabase, user.id);
  if (previous?.status === 'deleting') {
    return { success: false, error: 'Account deletion is already underway.', http_status: 409 };
  }
  if (previous?.status === 'deactivated' && previous.cleanup_completed_at) {
    return { success: true, status: 'deactivated', delete_after: previous.delete_after, already_deactivated: true };
  }

  // Register deactivation BEFORE billing/job cleanup. If a downstream service
  // fails, access checks must still see this account as deactivated. Retrying
  // POST resumes cleanup without extending the original 30-day deadline.
  const now = new Date();
  const deadline = previous?.status === 'deactivated' && previous.delete_after
    ? previous.delete_after : new Date(now.getTime() + 30 * DAY).toISOString();
  const { error } = await supabase.from(LIFE_TABLE).upsert({
    user_id: user.id,
    status: 'deactivated',
    deactivated_at: previous?.deactivated_at || now.toISOString(),
    delete_after: deadline,
    reactivated_at: null,
    cleanup_completed_at: null,
    updated_at: now.toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw error;

  const companies = await safeSelect(supabase, 'companies', 'id', 'owner_user_id', user.id);
  const companyIds = companies.map(row => row.id).filter(Boolean);
  await cancelEmployerStripeSubscriptions(supabase, user.id, companyIds);
  await closeOwnedJobs(supabase, user.id, companyIds);
  const { error: completionError } = await supabase.from(LIFE_TABLE)
    .update({ cleanup_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', user.id).eq('status', 'deactivated');
  if (completionError) throw completionError;
  return { success: true, status: 'deactivated', delete_after: deadline,
    subscriptions_canceled: true, jobs_closed: true };
}

async function reactivate(supabase, user) {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from(LIFE_TABLE)
    .update({ status: 'active', reactivated_at: now, delete_after: null, cleanup_completed_at: null, updated_at: now })
    .eq('user_id', user.id).eq('status', 'deactivated').gt('delete_after', now)
    .select('user_id');
  if (error) throw error;
  if (!data?.length) {
    return { success: false, http_status: 409,
      error: 'This account is not within an active 30-day recovery window.' };
  }
  return { success: true, status: 'active',
    // Former subscriptions and jobs must be explicitly restarted by owner.
    subscriptions_restored: false, jobs_restored: false };
}

async function purgeExpired(supabase) {
  const now = new Date().toISOString();
  const { data: rows, error } = await supabase.from(LIFE_TABLE)
    .select('user_id').eq('status', 'deactivated').lte('delete_after', now)
    .limit(BATCH_LIMIT);
  if (error) throw error;
  let deleted = 0; let failed = 0;
  for (const row of rows || []) {
    const { data: claimed, error: claimError } = await supabase.from(LIFE_TABLE)
      .update({ status: 'deleting', updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id).eq('status', 'deactivated')
      .lte('delete_after', new Date().toISOString()).select('user_id');
    if (claimError || !claimed?.length) {
      if (claimError) { failed++; console.error('Cannot claim account for deletion:', claimError); }
      continue;
    }
    try {
      const { data, error: findError } = await supabase.auth.admin.getUserById(row.user_id);
      if (findError && !/not found/i.test(findError.message || '')) throw findError;
      if (data?.user) {
        // Existing production cleanup: subscriptions, jobs, data and auth user.
        await permanentlyDeleteUser(supabase, data.user);
      } else {
        const { error: clearError } = await supabase.from(LIFE_TABLE).delete().eq('user_id', row.user_id);
        if (clearError) throw clearError;
      }
      deleted++;
    } catch (error) {
      failed++;
      console.error('Purge failed for user:', row.user_id, error);
      // Retry later, rather than marking the account deleted without confirmation.
      await supabase.from(LIFE_TABLE)
        .update({ status: 'deactivated', updated_at: new Date().toISOString() })
        .eq('user_id', row.user_id).eq('status', 'deleting');
    }
  }
  return { success: true, deleted, failed };
}

module.exports = async function handler(req, res) {
  setAccountCors(req,res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, { success: false, error: 'Method not allowed.' });
  }

  // Protected cron auth is checked *before* any user-token processing.
  const cronToken = process.env.CRON_SECRET;
  const isCron = req.method === 'GET' && cronToken && authHeader(req) === `Bearer ${cronToken}`;
  try {
    const sb = serviceClient();
    if (isCron) return send(res, 200, await purgeExpired(sb));

    // Only an authenticated user can change their own state.
    const user = await authenticatedUser(req, sb);
    if (req.method === 'GET') {
      const row = await lifecycleRow(sb, user.id);
      return send(res, 200, { success: true, status: row?.status || 'active',
        delete_after: row?.status === 'deactivated' ? row.delete_after : null,
        cleanup_complete: row?.status === 'deactivated' ? !!row.cleanup_completed_at : null });
    }
    const action = String(bodyOf(req)?.action || '').trim().toLowerCase();
    if (action === 'deactivate') {
      try {
        const result = await deactivate(sb, user);
        return send(res, result.http_status || 200, result);
      } catch (error) {
        // The state is written before Stripe/job cleanup. Never tell a user
        // nothing happened if their account was actually deactivated already.
        const row = await lifecycleRow(sb, user.id).catch(() => null);
        if (row?.status === 'deactivated') {
          console.error('Deactivation cleanup incomplete:', user.id, error);
          return send(res, 503, { success: false, status: 'deactivated',
            error: 'Account deactivation was recorded, but subscription or job cleanup could not be confirmed. Contact Alygnn support.' });
        }
        throw error;
      }
    }
    if (action === 'reactivate') {
      const result = await reactivate(sb, user);
      return send(res, result.http_status || 200, result);
    }
    return send(res, 400, { success: false, error: 'Invalid account action.' });
  } catch (error) {
    console.error('Account lifecycle failed:', error);
    const details = safeError(error);
    return send(res, details.status, { success: false, error: details.error });
  }
};
