/* Alygnn candidate 16+ screen (Android WWW only).
   Self-declared age is not identity/age verification and cannot establish legal job eligibility.
   Keep server-side eligibility protections and job-specific rules separately. */
(function(){
 'use strict';
 function ageOf(value){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
   const d=new Date(value+'T12:00:00Z');
   if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==value)return null;
   const now=new Date();
   let years=now.getFullYear()-d.getUTCFullYear();
   if(now.getMonth()<d.getUTCMonth()||(now.getMonth()===d.getUTCMonth()&&now.getDate()<d.getUTCDate()))years--;
   return years>=0&&years<=120?years:null;
 }
 let pending=null;
 function askForBirthday(client){
   if(pending)return pending;
   pending=new Promise(resolve=>{
     const veil=document.createElement('div');
     veil.id='alygnn-age-check';
     veil.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(18,31,45,.75);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box';
     veil.innerHTML='<section role="dialog" aria-modal="true" aria-label="Age eligibility" style="width:min(100%,430px);box-sizing:border-box;border-radius:22px;padding:25px;background:#f8faf9;color:#172333;box-shadow:0 20px 60px rgba(0,0,0,.26);font:inherit"><div style="font-family:Georgia,serif;font-size:32px;color:#5d7fa3;font-weight:bold">Alygnn<span style="color:#8cb69b">.</span></div><h2 style="font-size:23px;line-height:1.2;margin:12px 0">Confirm your age</h2><p style="color:#586879;line-height:1.5">Alygnn job seekers must be at least 16. Please enter your date of birth to continue.</p><label for="alygnn-age-date" style="display:block;font-weight:700;margin:12px 0 6px">Date of birth</label><input id="alygnn-age-date" type="date" autocomplete="bday" style="width:100%;box-sizing:border-box;min-height:48px;border:1px solid #ccd7e0;border-radius:12px;padding:8px;font:inherit;color:#172333;background:#fff"><p id="alygnn-age-error" role="alert" style="color:#aa3333;min-height:18px;font-size:13px"></p><button type="button" id="alygnn-age-continue" style="width:100%;min-height:48px;border:0;border-radius:12px;background:#356393;color:white;font-size:15px;font-weight:700">Continue</button><button type="button" id="alygnn-age-signout" style="width:100%;margin-top:10px;min-height:40px;background:transparent;border:0;color:#50657a">Sign out</button></section>';
     document.body.appendChild(veil);
     const input=veil.querySelector('#alygnn-age-date'), error=veil.querySelector('#alygnn-age-error'), btn=veil.querySelector('#alygnn-age-continue');
     setTimeout(()=>input.focus(),50);
     veil.querySelector('#alygnn-age-signout').addEventListener('click',async()=>{try{await client.auth.signOut()}catch(_){} location.replace('app-login.html');resolve(false)});
     btn.addEventListener('click',async()=>{
       const years=ageOf(input.value);
       if(years===null){error.textContent='Enter a valid date of birth.';return;}
       if(years<16){error.textContent='Alygnn candidate accounts are available from age 16.';btn.disabled=true;try{await client.auth.signOut()}catch(_){} resolve(false);return;}
       btn.disabled=true;error.textContent='Saving…';
       const {error:saveError}=await client.auth.updateUser({data:{date_of_birth:input.value,age_screen_version:'16plus-2026-10'}});
       if(saveError){error.textContent=saveError.message||'Could not save date of birth.';btn.disabled=false;return;}
       veil.remove();pending=null;resolve(true);
     });
   });
   return pending;
 }
 async function ensure(client){
   if(!client?.auth)return false;
   const {data,error}=await client.auth.getSession();
   if(error||!data?.session?.user)return false;
   const user=data.session.user;
   const role=String(user.user_metadata?.account_type||user.user_metadata?.role||'candidate').toLowerCase();
   if(role==='employer'||role==='employer_team'||role==='team_member')return true;
   const value=user.user_metadata?.date_of_birth;
   const years=ageOf(value);
   if(years!==null){
     if(years<16){try{await client.auth.signOut()}catch(_){} alert('Alygnn candidate accounts are available from age 16.'); location.replace('app-login.html');return false;}
     return true;
   }
   return askForBirthday(client);
 }
 async function beforeApplication(client,job){
   if(!await ensure(client))return false;
   const {data}=await client.auth.getSession();
   const years=ageOf(data?.session?.user?.user_metadata?.date_of_birth);
   const minimum=Number(job?.minimum_age||job?.min_age||0);
   if(Number.isFinite(minimum)&&minimum>=16&&minimum<=99&&years<minimum){
     alert('This job requires applicants to be at least '+minimum+'.');return false;
   }
   if(years!==null&&years<18){
     return confirm('Some jobs require applicants to be 18 or older, or have a work permit. Confirm you meet this employer’s age requirements and applicable work rules before applying.');
   }
   return true;
 }
 window.AlygnnAge={ageOf,ensure,beforeApplication};
 document.addEventListener('DOMContentLoaded',function(){
    const client=typeof sb!=='undefined'?sb:(typeof workspaceSb!=='undefined'?workspaceSb:null);
    if(client)ensure(client).catch(error=>console.warn('Candidate age gate:',error));
 });
 if(document.readyState!=='loading'){
   const client=typeof sb!=='undefined'?sb:(typeof workspaceSb!=='undefined'?workspaceSb:null);
   if(client)ensure(client).catch(error=>console.warn('Candidate age gate:',error));
 }
})();
