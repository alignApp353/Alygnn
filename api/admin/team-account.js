'use strict';

const { createClient } = require('@supabase/supabase-js');

function sendJson(res,status,payload){return res.status(status).json(payload)}
function bearer(req){const h=String(req.headers.authorization||'');return h.toLowerCase().startsWith('bearer ')?h.slice(7).trim():''}
function serviceClient(){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server configuration is incomplete.');
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
function schemaMissing(error){const c=String(error?.code||'');const m=String(error?.message||'').toLowerCase();return ['42P01','42703','PGRST204','PGRST205'].includes(c)||m.includes('does not exist')||m.includes('schema cache')||m.includes('could not find the')}
async function safeDeleteBy(sb,table,column,value){const {error}=await sb.from(table).delete().eq(column,value);if(error&&!schemaMissing(error))throw new Error(`${table} cleanup failed: ${error.message}`)}
async function safeNullBy(sb,table,column,value){const {error}=await sb.from(table).update({[column]:null}).eq(column,value);if(error&&!schemaMissing(error))console.warn(`Could not clear ${table}.${column}:`,error.message)}
async function safeSelect(sb,table,columns,column,value){const {data,error}=await sb.from(table).select(columns).eq(column,value);if(error){if(schemaMissing(error))return[];throw error}return data||[]}
async function safeCount(sb,table,column,value){const {count,error}=await sb.from(table).select('*',{count:'exact',head:true}).eq(column,value);if(error){if(schemaMissing(error))return 0;throw error}return Number(count||0)}
async function authenticatedUser(req,sb){const t=bearer(req);if(!t){const e=new Error('Sign in required.');e.status=401;throw e}const {data,error}=await sb.auth.getUser(t);if(error||!data?.user){const e=new Error('Your session is invalid or expired.');e.status=401;throw e}return data.user}
async function ownerContext(sb,requester,targetId){
  const {data:owned,error}=await sb.from('companies').select('id,company_name,owner_user_id').eq('owner_user_id',requester.id);
  if(error)throw error;
  if(!(owned||[]).length){const e=new Error('Only the company owner can permanently delete a team-only Alygnn login.');e.status=403;throw e}
  const ids=(owned||[]).map(c=>c.id);
  const {data:memberships,error:mErr}=await sb.from('company_members').select('company_id,user_id,team_role,membership_status').eq('user_id',targetId).in('company_id',ids);
  if(mErr)throw mErr;
  const membership=(memberships||[]).find(row=>String(row.membership_status||'active').toLowerCase()==='active')||null;
  if(!membership){const e=new Error('That account is not an active member of a company you own.');e.status=403;throw e}
  const company=(owned||[]).find(c=>String(c.id)===String(membership.company_id));
  return {company,membership};
}
async function eligibility(sb,target){
  const id=target.id;
  const {data:profile,error:pErr}=await sb.from('profiles').select('*').eq('id',id).maybeSingle();
  if(pErr&&!schemaMissing(pErr))throw pErr;
  if(profile?.is_admin===true)return {allowed:false,reason:'Admin accounts cannot be deleted by an employer.'};
  const owned=await safeSelect(sb,'companies','id','owner_user_id',id);
  if(owned.length)return {allowed:false,reason:'This account owns an employer company and cannot be deleted from Team Members.'};
  const activeMemberships=await safeSelect(sb,'company_members','company_id,membership_status','user_id',id);
  const active=activeMemberships.filter(m=>String(m.membership_status||'active').toLowerCase()==='active');
  if(active.length>1)return {allowed:false,reason:'This login belongs to more than one employer workspace. Remove it from this workspace instead, or use Alygnn Admin Account Management.'};

  const meta=target.user_metadata||{};
  const accountType=String(meta.account_type||profile?.account_type||'').toLowerCase();
  const authRole=String(meta.role||'').toLowerCase();
  const profileRole=String(profile?.role||'').toLowerCase();
  const candidateMarked=['candidate','seeker','employee'].includes(accountType)||['candidate','seeker','employee'].includes(authRole)||['candidate','seeker','employee'].includes(profileRole);
  const teamMarked=accountType==='employer_team'||authRole==='team_member'||profileRole==='team_member';
  const applicationCount=await safeCount(sb,'applications','candidate_id',id);
  const hasResume=!!(profile?.resume_file_path||profile?.resume_source||profile?.resume_data);
  const hasCandidateActivity=candidateMarked||applicationCount>0||hasResume;
  if(!teamMarked||hasCandidateActivity){
    return {allowed:false,reason:'This person has a personal candidate account or candidate activity. The company can remove workspace access, but only the person or an Alygnn administrator can permanently delete the Alygnn account.'};
  }
  return {allowed:true,reason:''};
}
async function listPaths(bucket,prefix){const result=[];const queue=[String(prefix||'').replace(/^\/+|\/+$/g,'')];let guard=0;while(queue.length&&guard<5000){const folder=queue.shift();let offset=0;while(guard<5000){const {data,error}=await bucket.list(folder,{limit:100,offset});if(error)break;const rows=data||[];if(!rows.length)break;for(const item of rows){guard++;const path=folder?`${folder}/${item.name}`:item.name;if(item.id||item.metadata)result.push(path);else queue.push(path)}if(rows.length<100)break;offset+=rows.length}}return result}
async function deletePaths(bucket,paths){const unique=[...new Set((paths||[]).filter(Boolean))];for(let i=0;i<unique.length;i+=100){const {error}=await bucket.remove(unique.slice(i,i+100));if(error)throw error}}
async function cleanupConversations(sb,id){const convs=await safeSelect(sb,'application_conversations','id','candidate_id',id);for(const c of convs)await safeDeleteBy(sb,'application_messages','conversation_id',c.id);await safeDeleteBy(sb,'application_conversations','candidate_id',id);const threads=await safeSelect(sb,'message_threads','id','candidate_id',id);for(const t of threads)await safeDeleteBy(sb,'messages','thread_id',t.id);await safeDeleteBy(sb,'message_threads','candidate_id',id);await safeDeleteBy(sb,'application_messages','sender_id',id);await safeDeleteBy(sb,'messages','sender_id',id)}
async function cleanupUser(sb,target){const id=target.id;const profileRows=await safeSelect(sb,'profiles','resume_file_path','id',id);const resumePaths=await listPaths(sb.storage.from('resumes'),id);if(profileRows[0]?.resume_file_path)resumePaths.push(profileRows[0].resume_file_path);if(resumePaths.length)await deletePaths(sb.storage.from('resumes'),resumePaths);await cleanupConversations(sb,id);for(const [table,col] of [['applications','candidate_id'],['skipped_jobs','candidate_id'],['saved_jobs','candidate_id'],['liked_jobs','candidate_id'],['job_likes','candidate_id'],['swipes','candidate_id'],['swipe_actions','candidate_id'],['job_views','candidate_id'],['password_change_codes','user_id']])await safeDeleteBy(sb,table,col,id);await safeNullBy(sb,'company_members','approved_by',id);await safeDeleteBy(sb,'company_activity_log','actor_user_id',id);await safeDeleteBy(sb,'company_activity_log','target_user_id',id);await safeDeleteBy(sb,'company_members','user_id',id);await safeDeleteBy(sb,'employer_verification_documents','uploaded_by',id);await safeNullBy(sb,'employer_verification_documents','reviewed_by',id);await safeNullBy(sb,'employer_verifications','reviewed_by',id);await safeDeleteBy(sb,'employer_verifications','user_id',id);await safeDeleteBy(sb,'employer_entitlements','employer_id',id);await safeNullBy(sb,'jobs','created_by',id);await safeNullBy(sb,'jobs','updated_by',id);await safeDeleteBy(sb,'profiles','id',id);const {error}=await sb.auth.admin.deleteUser(id,false);if(error)throw new Error('Supabase Auth deletion failed: '+error.message)}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.setHeader('Allow','GET, DELETE, OPTIONS');return res.status(204).end()}
  try{
    const sb=serviceClient();const requester=await authenticatedUser(req,sb);const targetId=String(req.method==='GET'?req.query?.user_id:(typeof req.body==='string'?JSON.parse(req.body||'{}')?.user_id:req.body?.user_id)||'').trim();
    if(!targetId)return sendJson(res,400,{success:false,error:'A team member user ID is required.'});
    if(targetId===requester.id)return sendJson(res,400,{success:false,error:'You cannot delete your own account from Team Members.'});
    const context=await ownerContext(sb,requester,targetId);
    const {data:{user:target},error:uErr}=await sb.auth.admin.getUserById(targetId);
    if(uErr||!target)return sendJson(res,404,{success:false,error:'Team member account not found.'});
    const check=await eligibility(sb,target);
    if(req.method==='GET')return sendJson(res,200,{success:true,can_delete:check.allowed,reason:check.reason,email:target.email||'',company_name:context.company?.company_name||''});
    if(req.method==='DELETE'){
      if(!check.allowed)return sendJson(res,409,{success:false,error:check.reason});
      const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});const confirmEmail=String(body.confirm_email||'').trim().toLowerCase();const confirmWord=String(body.confirm_word||'').trim();
      if(confirmWord!=='DELETE')return sendJson(res,400,{success:false,error:'Type DELETE exactly to confirm.'});
      if(confirmEmail!==String(target.email||'').toLowerCase())return sendJson(res,400,{success:false,error:'The confirmation email does not match this team member.'});
      await cleanupUser(sb,target);
      return sendJson(res,200,{success:true,user_id:targetId});
    }
    res.setHeader('Allow','GET, DELETE, OPTIONS');return sendJson(res,405,{success:false,error:'Method not allowed.'});
  }catch(error){console.error('Employer team account management error:',error);return sendJson(res,error.status||500,{success:false,error:error.message||'Unable to manage this team account.'})}
};
