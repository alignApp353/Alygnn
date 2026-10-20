// Apply ONLY the requested customer-facing wording updates to the current
// www/app-employer-account-security.html. Leaves other code unmodified.
// Run from the Alygnn repository root: node apply-closure-copy.js
'use strict';
const fs = require('fs');
const path = require('path');
const target = path.join(process.cwd(), 'www', 'app-employer-account-security.html');
if(!fs.existsSync(target)) {
  console.error('Cannot find www/app-employer-account-security.html. Run this from the Alygnn repository root.');
  process.exit(1);
}
const original = fs.readFileSync(target, 'utf8');
let result = original;
const changes = [
  [
    'Hide your account while you have 30 days to reactivate. After that, the server schedules permanent deletion. Active subscriptions will be canceled and jobs closed.',
    'Your account will be deactivated for up to 30 days. Active and paused job postings will close, and recurring subscriptions will be canceled. Sign in within 30 days to reactivate.'
  ],
  [
    'Employer jobs, team access, and Stripe subscriptions must be handled as part of account closure. The server must confirm completion before the app signs you out.',
    'Closed job postings and canceled subscriptions will not automatically restart if you reactivate your account.'
  ],
  [
    'Your account will be deactivated for up to 30 days. Your active listings will close and recurring subscriptions will be canceled. If you reactivate, they do not restart automatically. The server must confirm this action.',
    'Your account will be deactivated for up to 30 days. Active and paused job postings will close, and recurring subscriptions will be canceled. You can reactivate within 30 days, but these will not restart automatically.'
  ],
  [
    'This requests permanent removal of your account and eligible personal information. This cannot be undone after processing. Active jobs and billing must be handled by Alygnn.',
    'This requests permanent deletion of your account and eligible personal information. Active job postings will close, and recurring subscriptions will be canceled. This cannot be undone once completed.'
  ],
  [
    'Account closure is not yet configured on the Alygnn server. No account change was confirmed.',
    'Account closure is temporarily unavailable. Please try again later.'
  ],
  [
    'Server did not confirm account closure. Check your account status before trying again.',
    'We could not confirm the account change. Check your account status before trying again.'
  ]
];
let errors = [];
for(const [before,after] of changes) {
  const n = result.split(before).length - 1;
  if(n !== 1) errors.push(`Expected 1 occurrence of ${JSON.stringify(before.slice(0,60))}, found ${n}`);
  else result=result.replace(before,after);
}
if(errors.length) {
 console.error('Stopped without changing anything; this HTML differs from the reviewed version:\n'+errors.join('\n'));
 process.exit(1);
}
const backup=target+'.before-closure-copy.bak';
if(fs.existsSync(backup)) { console.error('Backup already exists; not overwriting: '+backup); process.exit(1); }
fs.writeFileSync(backup,original);
fs.writeFileSync(target,result);
console.log('Updated customer-facing account closure wording. Original backed up to: '+backup);
