'use strict';
const { createClient } = require('@supabase/supabase-js');
const service = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
function reply(res, code, data) { return res.status(code).json(data); }
async function userFor(req, sb) {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw Object.assign(new Error('Sign-in required.'), {status:401});
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error('Invalid session.'), {status:401});
  return data.user;
}
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.status(204).end(); }
  if (!['GET','POST'].includes(req.method)) return reply(res,405,{success:false,error:'Method not allowed.'});
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server configuration missing.');
    const sb = service();
    const user = await userFor(req,sb);
    const {data:current,error:readError} = await sb.from('account_closure_requests').select('*').eq('user_id',user.id).maybeSingle();
    if (readError) throw readError;
    if (req.method === 'GET') return reply(res,200,{success:true,status:current?.status || 'active',delete_after:current?.delete_after || null});
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || '');
    if (!['deactivate','reactivate'].includes(action)) return reply(res,400,{success:false,error:'Invalid action.'});
    const now = new Date();
    if (action === 'deactivate') {
      if (current?.status === 'deactivated') return reply(res,200,{success:true,status:'deactivated',delete_after:current.delete_after});
      if (current?.status === 'deleting') return reply(res,409,{success:false,error:'This account is already pending deletion.'});
      // Safety guard: do not deactivate a company owner while live jobs/billing could continue.
      // Phase 2 must implement atomic job suspension and Stripe subscription handling.
      const {data:companies,error:companyError} = await sb.from('companies').select('id').eq('owner_user_id',user.id).limit(1);
      if (companyError) throw companyError;
      if (companies?.length) return reply(res,409,{success:false,error:'Employer company accounts cannot be deactivated yet. Alygnn must first safely suspend job listings and handle recurring Stripe billing. Your account has not changed.'});
      const {data:profile,error:profileError}= await sb.from('profiles').select('is_admin').eq('id',user.id).maybeSingle();
      if (profileError) throw profileError;
      if (profile?.is_admin) return reply(res,403,{success:false,error:'Administrator accounts cannot use self-service deactivation.'});
      const deleteAfter = new Date(now.getTime()+30*24*60*60*1000).toISOString();
      const {error} = await sb.from('account_closure_requests').upsert({user_id:user.id,status:'deactivated',deactivated_at:now.toISOString(),delete_after:deleteAfter,updated_at:now.toISOString()}, {onConflict:'user_id'});
      if (error) throw error;
      // Login gating is handled by the website; enforce status in other clients/API too.
      return reply(res,200,{success:true,status:'deactivated',delete_after:deleteAfter});
    }
    if (!current || current.status !== 'deactivated') return reply(res,409,{success:false,error:'This account is not in the recovery period.'});
    if (new Date(current.delete_after).getTime() <= now.getTime()) return reply(res,410,{success:false,error:'Your recovery period has expired. Contact support.'});
    const {error} = await sb.from('account_closure_requests').delete().eq('user_id',user.id).eq('status','deactivated');
    if (error) throw error;
    return reply(res,200,{success:true,status:'active'});
  } catch (err) { console.error('Account lifecycle error:',err); return reply(res,err.status||500,{success:false,error:err.message||'Could not update account status.'}); }
};
