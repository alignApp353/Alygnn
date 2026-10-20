'use strict';
const crypto = require('crypto');
const { serviceClient, permanentlyDeleteUser } = require('./delete-account');
module.exports = async function handler(req,res) {
  if (req.method !== 'POST') return res.status(405).json({success:false,error:'POST required'});
  const key=process.env.ACCOUNT_CLEANUP_SECRET;
  const supplied=String(req.headers['x-account-cleanup-secret']||'');
  if (!key || !supplied || Buffer.byteLength(key)!==Buffer.byteLength(supplied) || !crypto.timingSafeEqual(Buffer.from(key),Buffer.from(supplied))) return res.status(401).json({success:false});
  try {
    const sb=serviceClient();
    const {data:due,error}=await sb.from('account_closure_requests').select('user_id').eq('status','deactivated').lte('delete_after',new Date().toISOString()).limit(20);
    if(error) throw error;
    const results=[];
    for(const record of due||[]) {
      try {
        // Claim row; another scheduled worker cannot process the same user twice.
        const {data:claimed,error:claimError}=await sb.from('account_closure_requests').update({status:'deleting',updated_at:new Date().toISOString()}).eq('user_id',record.user_id).eq('status','deactivated').select('user_id');
        if(claimError) throw claimError;
        if(!claimed?.length) continue;
        const {data,error:authError}=await sb.auth.admin.getUserById(record.user_id);
        if(authError || !data?.user) {
          // If already gone, remove stale request. Otherwise do not guess.
          if(authError && !/not found|does not exist/i.test(authError.message||'')) throw authError;
        } else await permanentlyDeleteUser(sb,data.user);
        await sb.from('account_closure_requests').delete().eq('user_id',record.user_id);
        results.push({user_id:record.user_id,success:true});
      }catch(e) {
        console.error('Scheduled closure failure',record.user_id,e);
        await sb.from('account_closure_requests').update({status:'deactivated',updated_at:new Date().toISOString()}).eq('user_id',record.user_id).eq('status','deleting');
        results.push({user_id:record.user_id,success:false});
      }
    }
    return res.status(200).json({success:true,processed:results.length,failures:results.filter(x=>!x.success).length});
  }catch(e){console.error(e);return res.status(500).json({success:false,error:'Cleanup failed.'});}
};
