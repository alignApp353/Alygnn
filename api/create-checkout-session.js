// Vercel Node Function: /api/create-checkout-session
// Alygnn checkout + subscription management in ONE Serverless Function.
// This combined route avoids adding /api/manage-subscription on Vercel Hobby.

const STRIPE_API = 'https://api.stripe.com/v1';

// Real Stripe Prices created in Alygnn's Product Catalog on 2026-09-10.
// Price IDs are not secrets. Environment variables can override these defaults
// later without changing the app/backend code.
const PRICE_IDS = {
  launch_monthly: process.env.STRIPE_PRICE_LAUNCH_MONTHLY || 'price_1UACGoRvnGY3BeGX4Dnlv9ZP',
  launch_quarterly: process.env.STRIPE_PRICE_LAUNCH_QUARTERLY || 'price_1UEJGJRvnGY3BeGX9yK3XL2i',
  growth_monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY || 'price_1UEJI7RvnGY3BeGXXDSX5rqM',
  growth_quarterly: process.env.STRIPE_PRICE_GROWTH_QUARTERLY || 'price_1UEJJIRvnGY3BeGXPIAyRF2z',
  scale_monthly: process.env.STRIPE_PRICE_SCALE_MONTHLY || 'price_1UEJK6RvnGY3BeGXKfZEsIIk',
  scale_quarterly: process.env.STRIPE_PRICE_SCALE_QUARTERLY || 'price_1UEJMSRvnGY3BeGXEwCM1bmu',
  second_job_slot_monthly: process.env.STRIPE_PRICE_SECOND_JOB_SLOT_MONTHLY || 'price_1UEJOORvnGY3BeGXLx2mlXVv',
  weekly_job_slot: process.env.STRIPE_PRICE_WEEKLY_JOB_SLOT || 'price_1UEJUgRvnGY3BeGXLd6LyDlp',
  job_boost_day: process.env.STRIPE_PRICE_JOB_BOOST_DAY || 'price_1UEJVyRvnGY3BeGXTe3FSe0T',
  launch_team_seat: process.env.STRIPE_PRICE_LAUNCH_TEAM_SEAT || 'price_1UEJX3RvnGY3BeGXVtlptGHa',
  growth_team_seat: process.env.STRIPE_PRICE_GROWTH_TEAM_SEAT || 'price_1UEJXmRvnGY3BeGX2ZKnAUiB',
  scale_team_seat: process.env.STRIPE_PRICE_SCALE_TEAM_SEAT || 'price_1UEJYDRvnGY3BeGX3mgVEjdN',

  // Fixed one-time upgrade-difference Prices. These are charged through Stripe
  // Checkout first; only after checkout.session.completed does the webhook swap
  // the existing recurring subscription to the destination plan Price.
  upgrade_launch_growth_monthly: process.env.STRIPE_PRICE_UPGRADE_LAUNCH_GROWTH_MONTHLY || 'price_1UEK5lRvnGY3BeGXzVZONdkt',
  upgrade_growth_scale_monthly: process.env.STRIPE_PRICE_UPGRADE_GROWTH_SCALE_MONTHLY || 'price_1UEK8QRvnGY3BeGXdXSvcpSS',
  upgrade_launch_scale_monthly: process.env.STRIPE_PRICE_UPGRADE_LAUNCH_SCALE_MONTHLY || 'price_1UEKA8RvnGY3BeGX6VzTZoKp',
  upgrade_launch_growth_quarterly: process.env.STRIPE_PRICE_UPGRADE_LAUNCH_GROWTH_QUARTERLY || 'price_1UEKC3RvnGY3BeGX2c5xyzTO',
  upgrade_growth_scale_quarterly: process.env.STRIPE_PRICE_UPGRADE_GROWTH_SCALE_QUARTERLY || 'price_1UEKCsRvnGY3BeGX0kG04aVd',
  upgrade_launch_scale_quarterly: process.env.STRIPE_PRICE_UPGRADE_LAUNCH_SCALE_QUARTERLY || 'price_1UEKDnRvnGY3BeGXgUiBR0hY'
};

const CHECKOUT_CATALOG = {
  monthly: {
    launch: { name: 'Alygnn Launch', cents: 29900, slots: 3, mode: 'subscription', priceId: PRICE_IDS.launch_monthly },
    growth: { name: 'Alygnn Growth', cents: 44900, slots: 5, mode: 'subscription', priceId: PRICE_IDS.growth_monthly },
    scale:  { name: 'Alygnn Scale',  cents: 64900, slots: 8, mode: 'subscription', priceId: PRICE_IDS.scale_monthly }
  },
  quarterly: {
    launch: { name: 'Alygnn Launch — 3 months', cents: 75000, slots: 3, mode: 'subscription', priceId: PRICE_IDS.launch_quarterly },
    growth: { name: 'Alygnn Growth — 3 months', cents: 114000, slots: 5, mode: 'subscription', priceId: PRICE_IDS.growth_quarterly },
    scale:  { name: 'Alygnn Scale — 3 months',  cents: 170000, slots: 8, mode: 'subscription', priceId: PRICE_IDS.scale_quarterly }
  },
  weekly: {
    weekly_slot: { name: 'Alygnn Weekly Job Slot — 7 days', cents: 9900, slots: 1, mode: 'payment', priceId: PRICE_IDS.weekly_job_slot }
  }
};

function cors(res) {
  // Authorization is Bearer-token based, not cookie based, so wildcard origin is
  // appropriate for the local Capacitor WebView + alygnn.com.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

function send(res, status, payload) {
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body)); }
  catch (_) { return {}; }
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function allowedReturnUrl(value, fallback) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'https:' && (url.hostname === 'alygnn.com' || url.hostname.endsWith('.alygnn.com'))) {
      return url.toString();
    }
  } catch (_) {}
  return fallback;
}

async function supabaseUser(token) {
  const base = process.env.SUPABASE_URL || 'https://auth.alygnn.com';
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!anon) throw new Error('SUPABASE_ANON_KEY is not configured.');

  const response = await fetch(base.replace(/\/$/, '') + '/auth/v1/user', {
    headers: { apikey: anon, Authorization: 'Bearer ' + token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error('Invalid employer session.');
  return data;
}

async function verifyOwnedActiveJob(token, userId, jobId) {
  const base = process.env.SUPABASE_URL || 'https://auth.alygnn.com';
  const anon = process.env.SUPABASE_ANON_KEY;
  const url = new URL(base.replace(/\/$/, '') + '/rest/v1/jobs');
  url.searchParams.set('id', 'eq.' + jobId);
  url.searchParams.set('employer_id', 'eq.' + userId);
  url.searchParams.set('select', 'id,status');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: { apikey: anon, Authorization: 'Bearer ' + token }
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows) || !rows[0]) throw new Error('The selected job could not be verified.');
  if (String(rows[0].status || '').toLowerCase() !== 'active') throw new Error('Only active jobs can be boosted.');
  return rows[0];
}


async function getEmployerPostingAccess(token) {
  const base=(process.env.SUPABASE_URL||'https://auth.alygnn.com').replace(/\/$/,'');
  const anon=process.env.SUPABASE_ANON_KEY;

  if(!anon) throw new Error('SUPABASE_ANON_KEY is not configured.');

  const response=await fetch(base+'/rest/v1/rpc/get_employer_posting_access',{
    method:'POST',
    headers:{
      apikey:anon,
      Authorization:'Bearer '+token,
      'Content-Type':'application/json'
    },
    body:'{}'
  });

  const data=await response.json().catch(()=>null);

  if(!response.ok){
    throw new Error(
      (data&&(data.message||data.error))||
      'Could not verify employer hiring capacity.'
    );
  }

  return data||{};
}

async function getMyTeamAccess(token) {
  const base=(process.env.SUPABASE_URL||'https://auth.alygnn.com').replace(/\/$/,'');
  const anon=process.env.SUPABASE_ANON_KEY;
  if(!anon) throw new Error('SUPABASE_ANON_KEY is not configured.');

  const response=await fetch(base+'/rest/v1/rpc/get_my_team_access',{
    method:'POST',
    headers:{
      apikey:anon,
      Authorization:'Bearer '+token,
      'Content-Type':'application/json'
    },
    body:'{}'
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    throw new Error((data&&(data.message||data.error))||'Could not verify team-seat access.');
  }
  return data||{};
}

function teamSeatPrice(plan){
  const key=String(plan||'').toLowerCase();
  if(key==='launch') return {priceId:PRICE_IDS.launch_team_seat,cents:9900};
  if(key==='growth') return {priceId:PRICE_IDS.growth_team_seat,cents:7500};
  if(key==='scale') return {priceId:PRICE_IDS.scale_team_seat,cents:5000};
  return null;
}

function additionalSlotEligible(access) {
  // The $150/month Second Job Slot is FREE-ACCOUNT ONLY and can exist only once.
  // The database RPC is the source of truth so direct checkout URLs cannot bypass it.
  return access?.second_slot_eligible === true &&
    access?.active_paid_plan !== true &&
    Number(access?.addon_slot_count || 0) < 1;
}

function fixedUpgradePrice(currentPlan,targetPlan,billing){
  const current=String(currentPlan||'').toLowerCase();
  const target=String(targetPlan||'').toLowerCase();
  const period=String(billing||'').toLowerCase();
  const key=`${period}:${current}->${target}`;
  return {
    'monthly:launch->growth':{priceId:PRICE_IDS.upgrade_launch_growth_monthly,cents:15000},
    'monthly:growth->scale':{priceId:PRICE_IDS.upgrade_growth_scale_monthly,cents:20000},
    'monthly:launch->scale':{priceId:PRICE_IDS.upgrade_launch_scale_monthly,cents:35000},
    'quarterly:launch->growth':{priceId:PRICE_IDS.upgrade_launch_growth_quarterly,cents:39000},
    'quarterly:growth->scale':{priceId:PRICE_IDS.upgrade_growth_scale_quarterly,cents:56000},
    'quarterly:launch->scale':{priceId:PRICE_IDS.upgrade_launch_scale_quarterly,cents:95000}
  }[key]||null;
}

async function stripeCreateCheckout(params) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_SECRET_KEY is not configured.');

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    body.append(key, String(value));
  }

  const response = await fetch(STRIPE_API + '/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + secret,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.url) {
    throw new Error(data?.error?.message || 'Stripe could not create the checkout session.');
  }
  return data;
}


// Native mobile PaymentSheet support. Website checkout continues to use
// Stripe Checkout; Capacitor can request a client secret instead so payment
// stays inside Alygnn on iOS/Android.
const STRIPE_NATIVE_API_VERSION='2025-11-17.clover';
const ALYGNN_TAX_CODE='txcd_20040006';

async function stripeNativeRequest(method,path,params={},extraHeaders={}){
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)throw new Error('STRIPE_SECRET_KEY is not configured.');

  let url=STRIPE_API+'/'+String(path||'').replace(/^\//,'');
  const options={
    method,
    headers:{
      Authorization:'Bearer '+secret,
      'Stripe-Version':STRIPE_NATIVE_API_VERSION,
      ...extraHeaders
    }
  };

  if(method==='GET'){
    const u=new URL(url);
    Object.entries(params||{}).forEach(([key,value])=>{
      if(value===undefined||value===null||value==='')return;
      u.searchParams.append(key,String(value));
    });
    url=u.toString();
  }else{
    const body=new URLSearchParams();
    Object.entries(params||{}).forEach(([key,value])=>{
      if(value===undefined||value===null||value==='')return;
      body.append(key,String(value));
    });
    options.headers['Content-Type']='application/x-www-form-urlencoded';
    options.body=body;
  }

  const response=await fetch(url,options);
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data?.error?.message||'Stripe request failed.');
    error.status=response.status;
    error.stripe=data?.error||null;
    throw error;
  }
  return data;
}

function nativePaymentSheetRequested(input){
  return String(input?.payment_ui||'').toLowerCase()==='payment_sheet' ||
    input?.native_payment_sheet===true;
}

function normalizeBillingAddress(value){
  const input=value&&typeof value==='object'?value:{};
  const country=String(input.country||'').trim().toUpperCase();
  const postal=String(input.postal_code||input.postalCode||'').trim();
  const address={
    line1:String(input.line1||'').trim(),
    line2:String(input.line2||'').trim(),
    city:String(input.city||'').trim(),
    state:String(input.state||'').trim(),
    postal_code:postal,
    country
  };

  if(!/^[A-Z]{2}$/.test(country)){
    const error=new Error('Choose a valid billing country before payment.');
    error.status=400;
    throw error;
  }
  if(country==='US'&&!postal){
    const error=new Error('ZIP code is required for United States billing addresses.');
    error.status=400;
    throw error;
  }
  return address;
}

function customerAddressParams(address){
  const params={};
  for(const key of ['line1','line2','city','state','postal_code','country']){
    if(address?.[key])params[`address[${key}]`]=address[key];
  }
  return params;
}

async function findStripeCustomerForEmployer(employerId){
  const query=`metadata["employer_id"]:"${String(employerId).replace(/"/g,'')}"`;
  try{
    const result=await stripeNativeRequest('GET','customers/search',{query,limit:10});
    return (result?.data||[]).find(row=>!row?.deleted)||null;
  }catch(error){
    console.warn('Stripe customer search failed:',error?.message||error);
    return null;
  }
}

async function ensureNativeStripeCustomer({user,employerId,address,preferredCustomerId}){
  let customer=null;

  if(preferredCustomerId){
    try{
      customer=await stripeNativeRequest(
        'GET',
        'customers/'+encodeURIComponent(preferredCustomerId)
      );
    }catch(_error){}
  }

  if(!customer)customer=await findStripeCustomerForEmployer(employerId);

  const common={
    email:user?.email||undefined,
    'metadata[employer_id]':employerId,
    ...customerAddressParams(address)
  };

  if(customer?.id){
    customer=await stripeNativeRequest(
      'POST',
      'customers/'+encodeURIComponent(customer.id),
      common
    );
    return customer;
  }

  return await stripeNativeRequest('POST','customers',common);
}

async function createNativeTaxCalculation({customerId,cents,reference}){
  const calculation=await stripeNativeRequest('POST','tax/calculations',{
    currency:'usd',
    customer:customerId,
    'line_items[0][amount]':cents,
    'line_items[0][reference]':String(reference||'alygnn-payment'),
    'line_items[0][tax_code]':ALYGNN_TAX_CODE
  });

  if(!calculation?.id||!Number.isFinite(Number(calculation?.amount_total))){
    throw new Error('Stripe Tax could not calculate this payment.');
  }
  return calculation;
}

async function createNativePaymentIntent({
  user,
  employerId,
  customerId,
  cents,
  name,
  metadata,
  requestId
}){
  const tax=await createNativeTaxCalculation({
    customerId,
    cents,
    reference:`${metadata?.product||'alygnn'}:${requestId||Date.now()}`
  });

  const params={
    amount:Number(tax.amount_total),
    currency:'usd',
    customer:customerId,
    description:name,
    receipt_email:user?.email||undefined,
    'automatic_payment_methods[enabled]':'true',
    'hooks[inputs][tax][calculation]':tax.id
  };

  Object.entries(metadata||{}).forEach(([key,value])=>{
    if(value===undefined||value===null||value==='')return;
    params[`metadata[${key}]`]=value;
  });

  const headers={};
  if(requestId)headers['Idempotency-Key']='alygnn-pi-'+String(requestId).slice(0,180);

  const intent=await stripeNativeRequest('POST','payment_intents',params,headers);
  if(!intent?.client_secret)throw new Error('Stripe did not return a PaymentSheet client secret.');

  const subtotal=Number(cents)||0;
  const total=Number(tax.amount_total)||subtotal;
  const taxCents=Math.max(0,Number(tax.tax_amount_exclusive||0)||total-subtotal);

  return{
    payment_sheet:true,
    client_secret:intent.client_secret,
    payment_intent_id:intent.id,
    customer_id:customerId,
    amount_subtotal_cents:subtotal,
    tax_cents:taxCents,
    amount_total_cents:total,
    currency:'usd'
  };
}

async function createNativeSubscription({
  employerId,
  customerId,
  priceId,
  quantity,
  metadata,
  requestId,
  promotionCodeId
}){
  const params={
    customer:customerId,
    'items[0][price]':priceId,
    'items[0][quantity]':quantity||1,
    payment_behavior:'default_incomplete',
    collection_method:'charge_automatically',
    'payment_settings[save_default_payment_method]':'on_subscription',
    'automatic_tax[enabled]':'true',
    'expand[]':'latest_invoice.confirmation_secret'
  };

  if(promotionCodeId){
    params['discounts[0][promotion_code]']=promotionCodeId;
  }

  Object.entries(metadata||{}).forEach(([key,value])=>{
    if(value===undefined||value===null||value==='')return;
    params[`metadata[${key}]`]=value;
  });

  const headers={};
  if(requestId)headers['Idempotency-Key']='alygnn-sub-'+String(requestId).slice(0,178);

  const subscription=await stripeNativeRequest('POST','subscriptions',params,headers);
  const invoice=subscription?.latest_invoice||{};
  const clientSecret=invoice?.confirmation_secret?.client_secret||null;
  const status=String(subscription?.status||'').toLowerCase();

  if(!clientSecret&&!['active','trialing'].includes(status)){
    throw new Error('Stripe could not prepare the subscription payment sheet.');
  }

  const subtotal=Number(invoice?.subtotal||0);
  const total=Number(invoice?.total||subtotal);

  return{
    payment_sheet:true,
    client_secret:clientSecret,
    subscription_id:subscription?.id||null,
    customer_id:customerId,
    already_paid:!clientSecret&&['active','trialing'].includes(status),
    amount_subtotal_cents:subtotal,
    tax_cents:Math.max(0,total-subtotal),
    amount_total_cents:total,
    currency:String(invoice?.currency||'usd').toLowerCase()
  };
}

async function createNativePaymentSheetCheckout({
  user,
  employerId,
  input,
  mode,
  priceId,
  quantity,
  cents,
  name,
  metadata,
  preferredCustomerId,
  promotionCodeId
}){
  const publishableKey=process.env.STRIPE_PUBLISHABLE_KEY;
  if(!publishableKey)throw new Error('STRIPE_PUBLISHABLE_KEY is not configured.');

  const address=normalizeBillingAddress(input?.billing_address);
  const customer=await ensureNativeStripeCustomer({
    user,
    employerId,
    address,
    preferredCustomerId
  });

  const requestId=String(input?.checkout_request_id||'').trim();
  const result=mode==='subscription'
    ?await createNativeSubscription({
        employerId,
        customerId:customer.id,
        priceId,
        quantity,
        metadata,
        requestId,
        promotionCodeId
      })
    :await createNativePaymentIntent({
        user,
        employerId,
        customerId:customer.id,
        cents,
        name,
        metadata,
        requestId
      });

  return{
    ...result,
    publishable_key:publishableKey,
    billing_address:address
  };
}


const MANAGE_CATALOG={
  monthly:{
    launch:{name:'Alygnn Launch',cents:29900,slots:3,rank:1,interval:'month',intervalCount:1,priceId:PRICE_IDS.launch_monthly},
    growth:{name:'Alygnn Growth',cents:44900,slots:5,rank:2,interval:'month',intervalCount:1,priceId:PRICE_IDS.growth_monthly},
    scale:{name:'Alygnn Scale',cents:64900,slots:8,rank:3,interval:'month',intervalCount:1,priceId:PRICE_IDS.scale_monthly}
  },
  quarterly:{
    launch:{name:'Alygnn Launch — 3 months',cents:75000,slots:3,rank:1,interval:'month',intervalCount:3,priceId:PRICE_IDS.launch_quarterly},
    growth:{name:'Alygnn Growth — 3 months',cents:114000,slots:5,rank:2,interval:'month',intervalCount:3,priceId:PRICE_IDS.growth_quarterly},
    scale:{name:'Alygnn Scale — 3 months',cents:170000,slots:8,rank:3,interval:'month',intervalCount:3,priceId:PRICE_IDS.scale_quarterly}
  }
};

function manageCors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');
}
function manageSend(res,status,payload){
  manageCors(res);res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(payload));
}
function manageBody(req){
  if(!req.body)return {};
  if(typeof req.body==='object'&&!Buffer.isBuffer(req.body))return req.body;
  try{return JSON.parse(Buffer.isBuffer(req.body)?req.body.toString('utf8'):String(req.body));}catch(_){return {};}
}
function manageBearer(req){const v=String(req.headers.authorization||'');return v.toLowerCase().startsWith('bearer ')?v.slice(7).trim():'';}
function manageBase(){return (process.env.SUPABASE_URL||'https://auth.alygnn.com').replace(/\/$/,'');}
function manageServiceHeaders(extra={}){
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  return {apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...extra};
}
async function manageCurrentUser(token){
  const anon=process.env.SUPABASE_ANON_KEY;
  if(!anon)throw new Error('SUPABASE_ANON_KEY is not configured.');
  const r=await fetch(manageBase()+'/auth/v1/user',{headers:{apikey:anon,Authorization:'Bearer '+token}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data?.id){const e=new Error('Invalid employer session.');e.status=401;throw e;}
  return data;
}
async function getEntitlement(employerId){
  const url=new URL(manageBase()+'/rest/v1/employer_entitlements');
  url.searchParams.set('employer_id','eq.'+employerId);
  url.searchParams.set('select','*');
  url.searchParams.set('limit','1');
  const r=await fetch(url,{headers:manageServiceHeaders()});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok)throw new Error(rows?.message||'Could not load billing entitlement.');
  return Array.isArray(rows)?(rows[0]||{}):{};
}
async function patchEntitlement(employerId,patch){
  const url=new URL(manageBase()+'/rest/v1/employer_entitlements');
  url.searchParams.set('employer_id','eq.'+employerId);
  const r=await fetch(url,{
    method:'PATCH',
    headers:manageServiceHeaders({Prefer:'return=minimal'}),
    body:JSON.stringify({...patch,plan_change_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()})
  });
  if(!r.ok)throw new Error('Could not save billing state: '+await r.text());
}
function exactPlan(ent){
  const exact=String(ent?.test_plan||'').toLowerCase();
  if(['launch','growth','scale'].includes(exact))return exact;
  const legacy=String(ent?.plan||'').toLowerCase();
  if(legacy==='business')return 'launch';
  if(legacy==='enterprise')return Number(ent?.slot_limit||0)>=8?'scale':'growth';
  return ['launch','growth','scale'].includes(legacy)?legacy:'free';
}
function billingPeriod(ent){
  const billing=String(ent?.billing_period||'').toLowerCase();
  return ['monthly','quarterly'].includes(billing)?billing:billing||'free';
}
function recurringPlan(ent){
  const billing=billingPeriod(ent);
  const plan=exactPlan(ent);
  return MANAGE_CATALOG[billing]?.[plan]||null;
}
function entitlementLooksActive(ent){
  const status=String(ent?.subscription_status||'').toLowerCase();
  const end=ent?.current_period_end?new Date(ent.current_period_end).getTime():Infinity;
  if(status==='past_due') return !!recurringPlan(ent);
  return ['active','trialing'].includes(status)&&!!recurringPlan(ent)&&end>Date.now();
}
function shouldResolveSubscription(ent){
  const stored=String(ent?.stripe_plan_subscription_id||'').trim();
  if(stored) return true;

  // Developer test plans are real Supabase entitlements but intentionally have
  // no Stripe subscription. Do not make a Stripe request just to display them.
  if(ent?.test_mode===true) return false;

  const status=String(ent?.subscription_status||'').toLowerCase();
  return ['active','trialing','past_due'].includes(status)&&!!recurringPlan(ent);
}
function subscriptionIsActive(sub){
  if(!sub)return false;
  const status=String(sub.status||'').toLowerCase();
  const end=sub.current_period_end?Number(sub.current_period_end)*1000:Infinity;
  if(status==='past_due') return true;
  return ['active','trialing'].includes(status)&&end>Date.now();
}
function subscriptionPlan(ent,sub){
  const fromStripe=String(sub?.metadata?.plan||'').toLowerCase();
  return ['launch','growth','scale'].includes(fromStripe)?fromStripe:exactPlan(ent);
}
function subscriptionBilling(ent,sub){
  const fromStripe=String(sub?.metadata?.billing||'').toLowerCase();
  return ['monthly','quarterly'].includes(fromStripe)?fromStripe:billingPeriod(ent);
}

async function manageStripe(method,path,params){
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)throw new Error('STRIPE_SECRET_KEY is not configured.');
  let url=STRIPE_API+'/'+String(path).replace(/^\//,'');
  const options={method,headers:{Authorization:'Bearer '+secret}};
  if(method==='GET'){
    const u=new URL(url);
    Object.entries(params||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.append(k,String(v));});
    url=u.toString();
  }else{
    const form=new URLSearchParams();
    Object.entries(params||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')form.append(k,String(v));});
    options.headers['Content-Type']='application/x-www-form-urlencoded';
    options.body=form;
  }
  const r=await fetch(url,options);
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const err=new Error(data?.error?.message||'Stripe request failed.');err.status=r.status;err.stripe=data?.error||null;throw err;}
  return data;
}


async function resolvePromotionCode(code){
  const normalized=String(code||'').trim().toUpperCase();
  if(!normalized)return null;

  const result=await manageStripe(
    'GET',
    'promotion_codes',
    {
      code:normalized,
      active:'true',
      limit:1,
      'expand[]':'data.coupon'
    }
  );

  const promotion=(result?.data||[])[0]||null;
  if(!promotion||promotion.active!==true)return null;

  let coupon=
    promotion.coupon ||
    promotion.promotion?.coupon ||
    null;

  if(typeof coupon==='string'){
    coupon=await manageStripe(
      'GET',
      'coupons/'+encodeURIComponent(coupon)
    );
  }

  if(coupon?.valid===false)return null;

  return{promotion,coupon};
}

function promotionSummary(resolved){
  const coupon=resolved?.coupon||{};
  return{
    id:resolved?.promotion?.id||null,
    code:resolved?.promotion?.code||null,
    percent_off:coupon?.percent_off==null?null:Number(coupon.percent_off),
    amount_off_cents:coupon?.amount_off==null?null:Number(coupon.amount_off),
    currency:coupon?.currency||null
  };
}

async function ensureRecurringPrice(plan,billing){
  const p=MANAGE_CATALOG[billing]?.[plan];
  if(!p?.priceId)throw new Error('Unknown recurring plan or Stripe Price ID.');
  return p.priceId;
}

async function searchPlanSubscription(employerId){
  const q=`metadata[\"employer_id\"]:\"${employerId}\" AND metadata[\"product\"]:\"job_plan\"`;
  const found=await manageStripe('GET','subscriptions/search',{query:q,limit:20});
  const rows=(found?.data||[]).filter(s=>!['canceled','incomplete_expired'].includes(String(s.status||'')));
  rows.sort((a,b)=>(b.created||0)-(a.created||0));
  return rows[0]||null;
}
async function resolveSubscription(employerId,ent){
  let sub=null;
  const stored=String(ent?.stripe_plan_subscription_id||'').trim();
  if(stored){try{sub=await manageStripe('GET','subscriptions/'+encodeURIComponent(stored));}catch(_){} }
  if(!sub)sub=await searchPlanSubscription(employerId);
  if(sub){
    await patchEntitlement(employerId,{
      stripe_plan_subscription_id:sub.id,
      stripe_plan_customer_id:typeof sub.customer==='string'?sub.customer:sub.customer?.id||null,
      stripe_plan_schedule_id:typeof sub.schedule==='string'?sub.schedule:sub.schedule?.id||null
    });
  }
  return sub;
}
function subscriptionSummary(ent,sub){
  const rawPlan=subscriptionPlan(ent,sub);
  const rawBilling=subscriptionBilling(ent,sub);
  const status=String(sub?.status||ent?.subscription_status||'free').toLowerCase();
  const terminal=['canceled','unpaid','incomplete_expired','inactive'].includes(status);
  const plan=terminal?'free':rawPlan;
  const billing=terminal?'free':rawBilling;
  const p=terminal?null:(MANAGE_CATALOG[billing]?.[plan]||null);
  const endUnix=sub?.current_period_end||null;
  return {
    current_plan:plan,
    billing_period:billing,
    subscription_status:status,
    current_period_end:endUnix?new Date(endUnix*1000).toISOString():(ent?.current_period_end||null),
    amount_cents:p?.cents??0,
    slot_limit:p ? Number(p.slots||0)+1 : 1,
    plan_slot_limit:p?.slots??0,
    included_free_slot_count:1,
    pending_plan:ent?.pending_plan||null,
    pending_billing_period:ent?.pending_billing_period||null,
    pending_plan_effective_at:ent?.pending_plan_effective_at||null,
    cancel_at_period_end:
      !terminal && (
        sub?.cancel_at_period_end===true ||
        (
          String(ent?.pending_plan||'').toLowerCase()==='free' &&
          !!ent?.pending_plan_effective_at
        )
      ),
    cancel_effective_at:
      !terminal && sub?.cancel_at_period_end===true && sub?.current_period_end
        ? new Date(Number(sub.current_period_end)*1000).toISOString()
        : (
            !terminal && String(ent?.pending_plan||'').toLowerCase()==='free'
              ? ent?.pending_plan_effective_at||null
              : null
          ),
    stripe_subscription_id:sub?.id||ent?.stripe_plan_subscription_id||null,
    managed_subscription:!!sub,
    test_mode:ent?.test_mode===true
  };
}

async function searchSubscriptionByProduct(employerId,product){
  const q=`metadata[\"employer_id\"]:\"${employerId}\" AND metadata[\"product\"]:\"${product}\"`;
  const found=await manageStripe('GET','subscriptions/search',{query:q,limit:20});
  const rows=(found?.data||[])
    .filter(row=>!['canceled','incomplete_expired'].includes(String(row.status||'')));
  rows.sort((a,b)=>(b.created||0)-(a.created||0));
  return rows[0]||null;
}

async function resolveSecondSlotSubscription(employerId){
  const products=['additional_slot','single_job'];
  const candidates=[];
  for(const product of products){
    const q=`metadata["employer_id"]:"${employerId}" AND metadata["product"]:"${product}"`;
    const found=await manageStripe('GET','subscriptions/search',{query:q,limit:100});
    candidates.push(...(found?.data||[]));
  }
  const eligible=candidates.filter(sub=>
    String(sub.metadata?.employer_id||'')===employerId &&
    products.includes(String(sub.metadata?.product||'').toLowerCase()) &&
    ['active','trialing','past_due'].includes(String(sub.status||'').toLowerCase())
  );
  eligible.sort((a,b)=>(b.created||0)-(a.created||0));
  return eligible[0]||null;
}

function secondSlotSummary(sub){
  if(!sub)return {
    managed_subscription:false,
    subscription_status:null,
    current_period_end:null,
    cancel_at_period_end:false,
    cancel_effective_at:null
  };

  return {
    managed_subscription:true,
    subscription_status:String(sub.status||'').toLowerCase(),
    current_period_end:sub.current_period_end
      ? new Date(Number(sub.current_period_end)*1000).toISOString()
      : null,
    cancel_at_period_end:sub.cancel_at_period_end===true,
    cancel_effective_at:
      sub.cancel_at_period_end===true && sub.current_period_end
        ? new Date(Number(sub.current_period_end)*1000).toISOString()
        : null,
    stripe_subscription_id:sub.id||null
  };
}

async function cancelPlanAtRenewal({employerId,ent,sub}){
  const effectiveIso=
    sub?.current_period_end
      ? new Date(Number(sub.current_period_end)*1000).toISOString()
      : ent?.current_period_end||null;

  if(sub&&subscriptionIsActive(sub)){
    // A scheduled downgrade and a scheduled cancellation should never coexist.
    await releaseSchedule(sub,ent);

    const updated=await manageStripe(
      'POST',
      'subscriptions/'+encodeURIComponent(sub.id),
      {cancel_at_period_end:'true'}
    );

    const endIso=updated.current_period_end
      ? new Date(Number(updated.current_period_end)*1000).toISOString()
      : effectiveIso;

    await patchEntitlement(employerId,{
      stripe_plan_schedule_id:null,
      pending_plan:null,
      pending_billing_period:null,
      pending_plan_effective_at:null
    });

    return {
      change:'cancellation_scheduled',
      effective_at:endIso,
      cancel_at_period_end:true
    };
  }

  // Developer test plans are prepaid test terms rather than Stripe subscriptions.
  // Scheduling "free" lets the app demonstrate the same cancel-at-renewal UX.
  if(ent?.test_mode===true && recurringPlan(ent) && entitlementLooksActive(ent)){
    if(!effectiveIso)throw new Error('Could not determine when this test plan ends.');

    await patchEntitlement(employerId,{
      stripe_plan_schedule_id:null,
      pending_plan:'free',
      pending_billing_period:'free',
      pending_plan_effective_at:effectiveIso
    });

    return {
      change:'cancellation_scheduled',
      effective_at:effectiveIso,
      cancel_at_period_end:true,
      test_mode:true
    };
  }

  const error=new Error(
    'This plan is already prepaid without automatic renewal, so there is no future charge to cancel.'
  );
  error.status=409;
  throw error;
}

async function resumePlanRenewal({employerId,ent,sub}){
  if(sub&&sub.cancel_at_period_end===true){
    await manageStripe(
      'POST',
      'subscriptions/'+encodeURIComponent(sub.id),
      {cancel_at_period_end:'false'}
    );
  }

  await patchEntitlement(employerId,{
    pending_plan:null,
    pending_billing_period:null,
    pending_plan_effective_at:null
  });

  return {
    change:'cancellation_reversed',
    cancel_at_period_end:false
  };
}

async function cancelSecondSlotAtRenewal({sub}){
  if(!sub||!subscriptionIsActive(sub)){
    const error=new Error(
      'The Second Job Slot does not have an active recurring subscription to cancel.'
    );
    error.status=409;
    throw error;
  }

  const updated=await manageStripe(
    'POST',
    'subscriptions/'+encodeURIComponent(sub.id),
    {cancel_at_period_end:'true'}
  );

  return {
    change:'second_slot_cancellation_scheduled',
    effective_at:updated.current_period_end
      ? new Date(Number(updated.current_period_end)*1000).toISOString()
      : null,
    cancel_at_period_end:true
  };
}

async function resumeSecondSlotRenewal({sub}){
  if(!sub){
    const error=new Error('Second Job Slot subscription could not be found.');
    error.status=409;
    throw error;
  }

  await manageStripe(
    'POST',
    'subscriptions/'+encodeURIComponent(sub.id),
    {cancel_at_period_end:'false'}
  );

  return {
    change:'second_slot_cancellation_reversed',
    cancel_at_period_end:false
  };
}

async function releaseSchedule(sub,ent){
  const scheduleId=(typeof sub?.schedule==='string'?sub.schedule:sub?.schedule?.id)||ent?.stripe_plan_schedule_id;
  if(!scheduleId)return false;
  try{
    await manageStripe('POST','subscription_schedules/'+encodeURIComponent(scheduleId)+'/release',{});
  }catch(error){
    if(!/released|completed|not found|no such subscription schedule/i.test(error.message||''))throw error;
  }
  return true;
}

async function detachPlanScheduleForImmediateChange({employerId,ent,sub}){
  let current=sub;
  const scheduleId=(typeof current?.schedule==='string'?current.schedule:current?.schedule?.id)||ent?.stripe_plan_schedule_id||null;

  if(scheduleId){
    await releaseSchedule(current,ent);
    await patchEntitlement(employerId,{
      stripe_plan_schedule_id:null,
      pending_plan:null,
      pending_billing_period:null,
      pending_plan_effective_at:null,
      plan_change_updated_at:new Date().toISOString()
    });
    current=await manageStripe('GET','subscriptions/'+encodeURIComponent(current.id),{
      'expand[]':'items.data.price'
    });
  }

  // Stripe blocks cancel_at_period_end changes while a schedule owns the
  // subscription. At this point the schedule is detached, so it is safe to
  // restore renewal if an older scheduled change had marked it for cancellation.
  if(current?.cancel_at_period_end===true){
    current=await manageStripe(
      'POST',
      'subscriptions/'+encodeURIComponent(current.id),
      {cancel_at_period_end:'false'}
    );
  }

  return current;
}
async function scheduleDowngrade({employerId,ent,sub,currentPlan,targetPlan,billing,currentBilling=billing}){
  if(sub?.cancel_at_period_end===true){
    sub=await manageStripe(
      'POST',
      'subscriptions/'+encodeURIComponent(sub.id),
      {cancel_at_period_end:'false'}
    );
  }

  const item=sub?.items?.data?.[0];
  const currentPriceId=typeof item?.price==='string'?item.price:item?.price?.id;
  if(!item?.id||!currentPriceId)throw new Error('Stripe subscription item could not be identified.');
  const targetPrice=await ensureRecurringPrice(targetPlan,billing);

  let scheduleId=(typeof sub.schedule==='string'?sub.schedule:sub.schedule?.id)||ent?.stripe_plan_schedule_id||null;
  let schedule=null;
  if(scheduleId){
    schedule=await manageStripe('GET','subscription_schedules/'+encodeURIComponent(scheduleId));
  }else{
    schedule=await manageStripe('POST','subscription_schedules',{from_subscription:sub.id});
    scheduleId=schedule.id;
  }

  const now=Math.floor(Date.now()/1000);
  const phase=(schedule?.phases||[]).find(p=>p.start_date<=now&&p.end_date>now)||(schedule?.phases||[])[0];
  const start=phase?.start_date||sub.current_period_start;
  const end=phase?.end_date||sub.current_period_end;
  if(!start||!end)throw new Error('Could not determine the current billing-period boundary.');

  const phasePrice=typeof phase?.items?.[0]?.price==='string'?phase.items[0].price:phase?.items?.[0]?.price?.id;
  const currentPrice=phasePrice||currentPriceId;
  const currentQty=phase?.items?.[0]?.quantity||item.quantity||1;
  const intervalCount=MANAGE_CATALOG[billing][targetPlan].intervalCount;

  await manageStripe('POST','subscription_schedules/'+encodeURIComponent(scheduleId),{
    end_behavior:'release',
    'phases[0][start_date]':start,
    'phases[0][end_date]':end,
    'phases[0][items][0][price]':currentPrice,
    'phases[0][items][0][quantity]':currentQty,
    'phases[0][proration_behavior]':'none',
    'phases[0][metadata][employer_id]':employerId,
    'phases[0][metadata][product]':'job_plan',
    'phases[0][metadata][plan]':currentPlan,
    'phases[0][metadata][billing]':currentBilling,
    'phases[1][start_date]':end,
    'phases[1][duration][interval]':'month',
    'phases[1][duration][interval_count]':intervalCount,
    'phases[1][items][0][price]':targetPrice,
    'phases[1][items][0][quantity]':1,
    'phases[1][proration_behavior]':'none',
    'phases[1][metadata][employer_id]':employerId,
    'phases[1][metadata][product]':'job_plan',
    'phases[1][metadata][plan]':targetPlan,
    'phases[1][metadata][billing]':billing
  });

  await patchEntitlement(employerId,{
    stripe_plan_schedule_id:scheduleId,
    pending_plan:targetPlan,
    pending_billing_period:billing,
    pending_plan_effective_at:new Date(end*1000).toISOString()
  });
  return {change:'plan_change_scheduled',effective_at:new Date(end*1000).toISOString(),schedule_id:scheduleId,billing_period:billing};
}
function planLegacyName(plan){
  return plan==='launch'?'business':'enterprise';
}

async function applyPaidFixedUpgrade({employerId,sub,targetPlan,billing,targetPrice}){
  const item=sub?.items?.data?.[0];
  if(!item?.id)throw new Error('Stripe subscription item could not be identified.');

  const updated=await manageStripe('POST','subscriptions/'+encodeURIComponent(sub.id),{
    'items[0][id]':item.id,
    'items[0][price]':targetPrice,
    'items[0][quantity]':1,
    proration_behavior:'none',
    'metadata[employer_id]':employerId,
    'metadata[product]':'job_plan',
    'metadata[plan]':targetPlan,
    'metadata[billing]':billing
  });

  const catalog=MANAGE_CATALOG[billing]?.[targetPlan];
  await patchEntitlement(employerId,{
    plan:planLegacyName(targetPlan),
    test_plan:targetPlan,
    test_mode:false,
    subscription_status:String(updated.status||'active').toLowerCase(),
    current_period_end:updated.current_period_end
      ? new Date(Number(updated.current_period_end)*1000).toISOString()
      : null,
    slot_limit:catalog?.slots||null,
    billing_period:billing,
    urgently_hiring:['growth','scale'].includes(targetPlan),
    alygnn_recommended:targetPlan==='scale',
    plan_amount_cents:catalog?.cents||null,
    stripe_plan_subscription_id:updated.id,
    stripe_plan_customer_id:typeof updated.customer==='string'?updated.customer:updated.customer?.id||null,
    stripe_plan_schedule_id:null,
    pending_plan:null,
    pending_billing_period:null,
    pending_plan_effective_at:null
  });

  return updated;
}


async function syncPaidPlanUpgradePayment({employerId,ent,sub,paymentIntentId}){
  if(!paymentIntentId){
    const error=new Error('A Stripe payment reference is required to finish this upgrade.');
    error.status=400;
    throw error;
  }
  if(!subscriptionIsActive(sub)){
    const error=new Error('The Alygnn plan subscription could not be found for this upgrade.');
    error.status=409;
    throw error;
  }

  const intent=await stripeNativeRequest(
    'GET',
    'payment_intents/'+encodeURIComponent(paymentIntentId)
  );

  const status=String(intent?.status||'').toLowerCase();
  if(status!=='succeeded'){
    const error=new Error('Stripe is still confirming this payment. Please try again in a moment.');
    error.status=409;
    throw error;
  }

  const meta=intent?.metadata||{};
  const metaEmployer=String(meta.employer_id||'');
  const metaProduct=String(meta.product||'').toLowerCase();
  const subscriptionId=String(meta.subscription_id||'');
  const targetPlan=String(meta.target_plan||'').toLowerCase();
  const billing=String(meta.billing||'').toLowerCase();

  if(
    metaEmployer!==String(employerId) ||
    metaProduct!=='plan_upgrade' ||
    subscriptionId!==String(sub.id) ||
    !['launch','growth','scale'].includes(targetPlan) ||
    !['monthly','quarterly'].includes(billing)
  ){
    const error=new Error('This Stripe payment does not match the requested Alygnn plan upgrade.');
    error.status=409;
    throw error;
  }

  const currentPlan=subscriptionPlan(ent,sub);
  const currentBilling=subscriptionBilling(ent,sub);
  const currentRank=Number(MANAGE_CATALOG[currentBilling]?.[currentPlan]?.rank||0);
  const targetRank=Number(MANAGE_CATALOG[billing]?.[targetPlan]?.rank||0);

  if(currentPlan===targetPlan && currentBilling===billing){
    return{
      change:'upgrade_applied',
      effective:'immediate',
      current_plan:targetPlan,
      target_plan:targetPlan,
      billing_period:billing,
      already_applied:true,
      next_renewal_amount_cents:MANAGE_CATALOG[billing]?.[targetPlan]?.cents||null
    };
  }

  if(currentBilling!==billing || targetRank<=currentRank){
    const error=new Error('The paid Stripe transaction is not an immediate same-cycle Alygnn upgrade.');
    error.status=409;
    throw error;
  }

  sub=await detachPlanScheduleForImmediateChange({
    employerId,
    ent,
    sub
  });
  ent=await getEntitlement(employerId);

  const targetPrice=await ensureRecurringPrice(targetPlan,billing);

  await applyPaidFixedUpgrade({
    employerId,
    sub,
    targetPlan,
    billing,
    targetPrice
  });

  return{
    change:'upgrade_applied',
    effective:'immediate',
    current_plan:targetPlan,
    target_plan:targetPlan,
    billing_period:billing,
    payment_intent_id:intent.id,
    amount_paid_cents:Number(intent.amount_received||intent.amount||0),
    next_renewal_amount_cents:MANAGE_CATALOG[billing]?.[targetPlan]?.cents||null
  };
}

async function reconcileStuckPaidUpgrade({employerId,ent,sub}){
  if(!subscriptionIsActive(sub))return false;

  const currentPlan=subscriptionPlan(ent,sub);
  const currentBilling=subscriptionBilling(ent,sub);
  const pendingPlan=String(ent?.pending_plan||'').toLowerCase();
  const pendingBilling=String(ent?.pending_billing_period||currentBilling).toLowerCase();

  const currentRank=Number(MANAGE_CATALOG[currentBilling]?.[currentPlan]?.rank||0);
  const pendingRank=Number(MANAGE_CATALOG[pendingBilling]?.[pendingPlan]?.rank||0);

  if(
    !pendingPlan ||
    pendingBilling!==currentBilling ||
    pendingRank<=currentRank ||
    !ent?.pending_plan_effective_at
  ){
    return false;
  }

  const customerId=stripeCustomerId(sub,ent);
  if(!customerId)return false;

  const listed=await stripeNativeRequest('GET','payment_intents',{
    customer:customerId,
    limit:20
  });

  const cutoff=Math.floor(Date.now()/1000)-(48*60*60);
  const matches=(listed?.data||[])
    .filter(intent=>{
      const meta=intent?.metadata||{};
      return(
        String(intent?.status||'').toLowerCase()==='succeeded' &&
        Number(intent?.created||0)>=cutoff &&
        String(meta.product||'').toLowerCase()==='plan_upgrade' &&
        String(meta.employer_id||'')===String(employerId) &&
        String(meta.subscription_id||'')===String(sub.id) &&
        String(meta.target_plan||'').toLowerCase()===pendingPlan &&
        String(meta.billing||'').toLowerCase()===pendingBilling
      );
    })
    .sort((a,b)=>Number(b.created||0)-Number(a.created||0));

  const intent=matches[0];
  if(!intent)return false;

  await syncPaidPlanUpgradePayment({
    employerId,
    ent,
    sub,
    paymentIntentId:intent.id
  });

  return true;
}

async function upgradeNow({employerId,ent,sub,targetPlan,billing,input={}}){
  const item=sub?.items?.data?.[0];
  if(!item?.id)throw new Error('Stripe subscription item could not be identified.');

  const currentPlan=subscriptionPlan(ent,sub);
  const currentCatalog=MANAGE_CATALOG[billing]?.[currentPlan];
  const targetCatalog=MANAGE_CATALOG[billing]?.[targetPlan];
  if(!currentCatalog||!targetCatalog)throw new Error('Could not calculate the plan upgrade price.');

  const difference=Math.max(0,Number(targetCatalog.cents)-Number(currentCatalog.cents));
  if(difference<=0)throw new Error('This plan change is not an upgrade.');

  const upgrade=fixedUpgradePrice(currentPlan,targetPlan,billing);
  if(!upgrade?.priceId){
    throw new Error('The Stripe Price ID for this Alygnn upgrade difference is not configured.');
  }
  if(Number(upgrade.cents)!==difference){
    throw new Error("The configured Stripe upgrade Price does not match Alygnn's fixed plan difference.");
  }

  const customerId=stripeCustomerId(sub,ent);
  if(!customerId)throw new Error('Stripe customer could not be identified.');

  const targetPrice=await ensureRecurringPrice(targetPlan,billing);
  const requestedPromotionCode=String(input.promotion_code||'').trim().toUpperCase();
  const resolvedPromotion=requestedPromotionCode
    ? await resolvePromotionCode(requestedPromotionCode)
    : null;

  if(requestedPromotionCode&&!resolvedPromotion){
    const error=new Error('This promotion code is invalid, expired, or inactive.');
    error.status=400;
    throw error;
  }

  const coupon=resolvedPromotion?.coupon||{};
  let amountDue=difference;
  if(Number.isFinite(Number(coupon.percent_off))){
    amountDue=Math.max(0,Math.round(difference*(1-(Number(coupon.percent_off)/100))));
  }else if(Number.isFinite(Number(coupon.amount_off))){
    const couponCurrency=String(coupon.currency||'').toLowerCase();
    if(!couponCurrency||couponCurrency==='usd'){
      amountDue=Math.max(0,difference-Number(coupon.amount_off));
    }
  }

  const metadata={
    employer_id:employerId,
    product:'plan_upgrade',
    current_plan:currentPlan,
    target_plan:targetPlan,
    billing,
    subscription_id:sub.id,
    subscription_item_id:item.id,
    target_price_id:targetPrice,
    upgrade_price_id:upgrade.priceId,
    fixed_difference_cents:difference,
    charged_difference_cents:amountDue,
    promotion_code:requestedPromotionCode||'',
    source:String(input.source||'billing_settings'),
    terms_version:String(input.terms_version||'')
  };

  // A valid 100%-off (or otherwise fully covering) promotion needs no Stripe
  // payment object. Apply the recurring plan swap immediately and return the
  // response the app already understands.
  if(amountDue===0&&resolvedPromotion){
    await applyPaidFixedUpgrade({
      employerId,
      sub,
      targetPlan,
      billing,
      targetPrice
    });
    return{
      change:'upgrade_applied',
      effective:'immediate',
      fixed_difference_cents:difference,
      amount_due_now_cents:0,
      amount_due_cents:0,
      amount_paid_cents:0,
      promotion_code:requestedPromotionCode,
      billing_period:billing,
      current_plan:currentPlan,
      target_plan:targetPlan,
      next_renewal_amount_cents:targetCatalog.cents,
      stripe_target_plan_price_id:targetPrice
    };
  }

  if(nativePaymentSheetRequested(input)){
    const native=await createNativePaymentSheetCheckout({
      user:{email:input.employer_email||null},
      employerId,
      input,
      mode:'payment',
      priceId:upgrade.priceId,
      quantity:1,
      cents:amountDue,
      name:`Alygnn ${currentPlan} to ${targetPlan} upgrade`,
      metadata,
      preferredCustomerId:customerId
    });

    return{
      change:'upgrade_payment_required',
      effective:'after_payment',
      fixed_difference_cents:difference,
      amount_due_now_cents:amountDue,
      amount_due_cents:amountDue,
      amount_paid_cents:0,
      billing_period:billing,
      current_plan:currentPlan,
      target_plan:targetPlan,
      next_renewal_amount_cents:targetCatalog.cents,
      stripe_upgrade_price_id:upgrade.priceId,
      stripe_target_plan_price_id:targetPrice,
      ...native
    };
  }

  const successUrl=allowedReturnUrl(
    input.success_url,
    `https://alygnn.com/employer-dashboard.html?payment=upgrade-success&plan=${encodeURIComponent(targetPlan)}&billing=${encodeURIComponent(billing)}`
  );
  const cancelUrl=allowedReturnUrl(
    input.cancel_url,
    'https://alygnn.com/employer-account.html?billing=upgrade-cancelled'
  );

  const params={
    mode:'payment',
    customer:customerId,
    success_url:successUrl,
    cancel_url:cancelUrl,
    client_reference_id:employerId,
    'line_items[0][price]':upgrade.priceId,
    'line_items[0][quantity]':1,
    'automatic_tax[enabled]':'true',
    billing_address_collection:'auto'
  };

  if(resolvedPromotion?.promotion?.id){
    params['discounts[0][promotion_code]']=resolvedPromotion.promotion.id;
  }else{
    params.allow_promotion_codes='true';
  }

  Object.entries(metadata).forEach(([key,value])=>{
    if(value===undefined||value===null||value==='')return;
    params[`metadata[${key}]`]=value;
    params[`payment_intent_data[metadata][${key}]`]=value;
  });

  const checkout=await stripeCreateCheckout(params);

  return{
    change:'upgrade_payment_required',
    effective:'after_payment',
    fixed_difference_cents:difference,
    amount_due_now_cents:amountDue,
    amount_due_cents:amountDue,
    amount_paid_cents:0,
    hosted_invoice_url:checkout.url,
    checkout_url:checkout.url,
    checkout_session_id:checkout.id,
    payment_status:'unpaid',
    billing_period:billing,
    current_plan:currentPlan,
    target_plan:targetPlan,
    next_renewal_amount_cents:targetCatalog.cents,
    stripe_upgrade_price_id:upgrade.priceId,
    stripe_target_plan_price_id:targetPrice
  };
}

function stripeCustomerId(sub,ent){
  return (
    (typeof sub?.customer==='string' ? sub.customer : sub?.customer?.id) ||
    ent?.stripe_plan_customer_id ||
    null
  );
}

function normalizePaymentMethod(pm){
  if(!pm || typeof pm!=='object')return null;

  if(pm.type==='card' && pm.card){
    return {
      type:'card',
      brand:String(pm.card.brand||'card').toLowerCase(),
      last4:String(pm.card.last4||''),
      exp_month:Number(pm.card.exp_month||0)||null,
      exp_year:Number(pm.card.exp_year||0)||null
    };
  }

  return {
    type:String(pm.type||'payment_method'),
    brand:String(pm.type||'payment method'),
    last4:'',
    exp_month:null,
    exp_year:null
  };
}

async function customerSnapshot(customerId,sub){
  if(!customerId)return {
    customer_id:null,
    email:null,
    payment_method:null,
    invoices:[]
  };

  let customer=null;
  try{
    customer=await manageStripe(
      'GET',
      'customers/'+encodeURIComponent(customerId),
      {'expand[]':'invoice_settings.default_payment_method'}
    );
  }catch(error){
    console.warn('Could not load Stripe customer:',error?.message||error);
  }

  let pm=
    customer?.invoice_settings?.default_payment_method ||
    sub?.default_payment_method ||
    null;

  if(typeof pm==='string'){
    try{
      pm=await manageStripe(
        'GET',
        'payment_methods/'+encodeURIComponent(pm)
      );
    }catch(error){
      console.warn('Could not load Stripe payment method:',error?.message||error);
      pm=null;
    }
  }

  let invoices=[];
  try{
    const result=await manageStripe('GET','invoices',{
      customer:customerId,
      limit:8
    });

    invoices=(result?.data||[]).map(invoice=>{
      const taxCents=(invoice.total_tax_amounts||[]).reduce(
        (sum,row)=>sum+Number(row?.amount||0),
        0
      );
      return {
        id:invoice.id,
        number:invoice.number||null,
        created:invoice.created
          ? new Date(Number(invoice.created)*1000).toISOString()
          : null,
        status:String(invoice.status||'').toLowerCase(),
        amount_paid_cents:Number(invoice.amount_paid||0),
        amount_due_cents:Number(invoice.amount_due||0),
        subtotal_cents:Number(invoice.subtotal||0),
        tax_cents:taxCents,
        total_cents:Number(invoice.total||invoice.amount_due||invoice.amount_paid||0),
        currency:String(invoice.currency||'usd').toLowerCase(),
        hosted_invoice_url:invoice.hosted_invoice_url||null,
        invoice_pdf:invoice.invoice_pdf||null,
        description:
          invoice.lines?.data?.[0]?.description ||
          invoice.description ||
          null,
        payment_kind:'invoice'
      };
    });
  }catch(error){
    console.warn('Could not load Stripe invoice history:',error?.message||error);
  }

  return {
    customer_id:customerId,
    email:customer?.email||null,
    payment_method:normalizePaymentMethod(pm),
    invoices
  };
}


function oneTimePaymentLabel(product,metadata={}){
  const key=String(product||'').toLowerCase();
  if(key==='job_boost')return 'Job Boost';
  if(key==='weekly_slot')return 'Weekly Job Slot';
  if(key==='additional_slot'||key==='single_job')return 'Second Job Slot';
  if(key==='plan_upgrade'){
    const target=String(metadata?.target_plan||metadata?.plan||'').trim();
    return target
      ? `Plan upgrade to ${target.charAt(0).toUpperCase()+target.slice(1)}`
      : 'Plan upgrade';
  }
  if(key==='team_seat')return 'Extra Team Seat';
  return 'Alygnn payment';
}

async function stripeCheckoutForPaymentIntent(paymentIntentId){
  if(!paymentIntentId)return null;
  try{
    const result=await manageStripe('GET','checkout/sessions',{
      payment_intent:paymentIntentId,
      limit:1
    });
    return (result?.data||[])[0]||null;
  }catch(error){
    console.warn(
      'Could not load Stripe Checkout session for payment:',
      error?.message||error
    );
    return null;
  }
}

async function employerJobSnapshot(jobIds){
  const ids=[...new Set(
    (jobIds||[]).map(value=>String(value||'').trim()).filter(Boolean)
  )];

  if(!ids.length)return new Map();

  const url=new URL(manageBase()+'/rest/v1/jobs');
  url.searchParams.set('id',`in.(${ids.join(',')})`);
  url.searchParams.set(
    'select',
    'id,title,status,boosted_until,created_at,updated_at'
  );

  const response=await fetch(url,{headers:manageServiceHeaders()});
  const rows=await response.json().catch(()=>[]);

  if(!response.ok){
    console.warn(
      'Could not load job names for billing history:',
      rows?.message||rows?.error||response.status
    );
    return new Map();
  }

  return new Map(
    (Array.isArray(rows)?rows:[]).map(row=>[String(row.id),row])
  );
}

async function employerOneTimePayments(employerId){
  const safeEmployer=String(employerId||'').replace(/"/g,'').trim();
  if(!safeEmployer)return [];

  let result=null;
  try{
    result=await manageStripe(
      'GET',
      'payment_intents/search',
      {
        query:`metadata["employer_id"]:"${safeEmployer}"`,
        limit:25
      }
    );
  }catch(error){
    console.warn(
      'Could not load one-time Stripe payment history:',
      error?.message||error
    );
    return [];
  }

  const raw=(result?.data||[]).filter(payment=>{
    if(payment?.invoice)return false;
    const product=String(payment?.metadata?.product||'').toLowerCase();
    return !!product;
  });

  const jobIds=raw
    .map(payment=>payment?.metadata?.job_id)
    .filter(Boolean);

  const jobs=await employerJobSnapshot(jobIds);
  const payments=[];

  for(const payment of raw){
    const metadata=payment?.metadata||{};
    const product=String(metadata.product||'').toLowerCase();
    const checkout=await stripeCheckoutForPaymentIntent(payment.id);

    const subtotal=Number(
      checkout?.amount_subtotal ??
      payment?.amount ??
      0
    );

    const total=Number(
      checkout?.amount_total ??
      payment?.amount_received ??
      payment?.amount ??
      0
    );

    const tax=Number(
      checkout?.total_details?.amount_tax ??
      Math.max(0,total-subtotal)
    );

    const jobId=String(metadata.job_id||'').trim()||null;
    const job=jobId?jobs.get(jobId):null;
    const days=Math.max(
      0,
      Number.parseInt(metadata.days||'0',10)||0
    );

    payments.push({
      id:payment.id,
      created:payment.created
        ? new Date(Number(payment.created)*1000).toISOString()
        : null,
      status:String(payment.status||'').toLowerCase(),
      currency:String(payment.currency||'usd').toLowerCase(),
      description:oneTimePaymentLabel(product,metadata),
      product,
      subtotal_cents:subtotal,
      tax_cents:tax,
      total_cents:total,
      amount_paid_cents:Number(payment.amount_received||total||0),
      receipt_url:
        (typeof payment?.latest_charge==='object'
          ? payment.latest_charge?.receipt_url
          : null) || null,
      checkout_session_id:checkout?.id||null,
      payment_kind:'one_time',
      job_id:jobId,
      job_title:job?.title||null,
      job_status:job?.status||null,
      boosted_until:job?.boosted_until||null,
      days
    });
  }

  payments.sort((a,b)=>{
    const at=a?.created?new Date(a.created).getTime():0;
    const bt=b?.created?new Date(b.created).getTime():0;
    return bt-at;
  });

  return payments;
}

function calculateNextPlanCharge(ent,sub){
  const currentPlan=subscriptionPlan(ent,sub);
  const billing=subscriptionBilling(ent,sub);

  if(
    sub?.cancel_at_period_end===true ||
    (
      String(ent?.pending_plan||'').toLowerCase()==='free' &&
      !!ent?.pending_plan_effective_at
    )
  ){
    return 0;
  }

  const pending=String(ent?.pending_plan||'').toLowerCase();
  const pendingBilling=String(
    ent?.pending_billing_period||billing
  ).toLowerCase();

  if(MANAGE_CATALOG[pendingBilling]?.[pending]){
    return MANAGE_CATALOG[pendingBilling][pending].cents;
  }

  return MANAGE_CATALOG[billing]?.[currentPlan]?.cents ??
    Number(ent?.plan_amount_cents||0);
}

async function billingAccountSummary(user,ent,planSub,secondSub){
  const ids=[
    stripeCustomerId(planSub,ent),
    typeof secondSub?.customer==='string'
      ? secondSub.customer
      : secondSub?.customer?.id
  ].filter(Boolean);

  const uniqueIds=[...new Set(ids)];
  const snapshots=[];

  for(const customerId of uniqueIds){
    const related=
      stripeCustomerId(planSub,ent)===customerId
        ? planSub
        : secondSub;

    snapshots.push(
      await customerSnapshot(customerId,related)
    );
  }

  const paymentMethod=
    snapshots.map(row=>row.payment_method).find(Boolean) ||
    null;

  const stripeEmail=
    snapshots.map(row=>row.email).find(Boolean) ||
    null;

  const invoices=[];
  const seen=new Set();

  for(const snap of snapshots){
    for(const invoice of snap.invoices||[]){
      if(!invoice?.id || seen.has(invoice.id))continue;
      seen.add(invoice.id);
      invoices.push(invoice);
    }
  }

  invoices.sort((a,b)=>{
    const at=a?.created?new Date(a.created).getTime():0;
    const bt=b?.created?new Date(b.created).getTime():0;
    return bt-at;
  });

  const oneTimePayments=await employerOneTimePayments(user?.id);

  return {
    billing_email:stripeEmail||user?.email||null,
    payment_method:paymentMethod,
    invoices:invoices.slice(0,12),
    one_time_payments:oneTimePayments.slice(0,25),
    stripe_customer_count:uniqueIds.length,
    next_plan_charge_cents:calculateNextPlanCharge(ent,planSub)
  };
}

async function runManageAction(res,user,input){
  const action=String(input.action||'summary').toLowerCase();

  let ent=await getEntitlement(user.id);
  let sub=null;

  if(shouldResolveSubscription(ent)){
    try{
      sub=await resolveSubscription(user.id,ent);
    }catch(error){
      // The account page should still be able to display the employer's
      // Supabase entitlement if Stripe is temporarily unavailable. Actions
      // that actually change billing still require Stripe and must fail.
      if(action!=='summary') throw error;
      console.warn('Could not resolve Stripe subscription for billing summary:',error?.message||error);
    }
  }

  ent=await getEntitlement(user.id);

  if(action==='sync_plan_upgrade_payment'){
    const result=await syncPaidPlanUpgradePayment({
      employerId:user.id,
      ent,
      sub,
      paymentIntentId:String(input.payment_intent_id||'')
    });
    return send(res,200,{ok:true,...result});
  }

  if(action==='billing_portal'){
    let secondSlot=null;
    try{ secondSlot=await resolveSecondSlotSubscription(user.id); }catch(error){
      console.warn('Could not resolve Second Job Slot for billing portal:',error?.message||error);
    }

    const customerId=
      stripeCustomerId(sub,ent) ||
      (typeof secondSlot?.customer==='string' ? secondSlot.customer : secondSlot?.customer?.id) ||
      null;

    if(!customerId){
      const error=new Error('No Stripe billing account is connected to this employer yet.');
      error.status=409;
      throw error;
    }

    const returnUrl=allowedReturnUrl(
      input.return_url,
      'https://alygnn.com/employer-account.html?billing=return'
    );
    const portal=await manageStripe('POST','billing_portal/sessions',{
      customer:customerId,
      return_url:returnUrl
    });

    return send(res,200,{ok:true,url:portal.url});
  }

  if(action==='summary'){
    try{
      const repaired=await reconcileStuckPaidUpgrade({
        employerId:user.id,
        ent,
        sub
      });
      if(repaired){
        ent=await getEntitlement(user.id);
        sub=await resolveSubscription(user.id,ent);
      }
    }catch(error){
      console.warn(
        'Could not reconcile a recently paid plan upgrade:',
        error?.message||error
      );
    }

    /*
     * Self-heal stale scheduled-plan data.
     *
     * A canceled/terminal job-plan subscription can leave pending_plan,
     * pending_billing_period, or pending_plan_effective_at behind from an
     * earlier test downgrade. That must never make a Free account look as
     * though Launch (or another plan) will start automatically.
     */
    let planSummary=subscriptionSummary(ent,sub);

    const hasStalePendingPlan=
      planSummary.current_plan==='free' &&
      (
        !!ent?.pending_plan ||
        !!ent?.pending_billing_period ||
        !!ent?.pending_plan_effective_at ||
        !!ent?.stripe_plan_schedule_id
      );

    if(hasStalePendingPlan){
      try{
        if(sub){
          await releaseSchedule(sub,ent);
        }
      }catch(error){
        console.warn(
          'Could not release stale plan schedule while cleaning billing summary:',
          error?.message||error
        );
      }

      await patchEntitlement(user.id,{
        stripe_plan_schedule_id:null,
        pending_plan:null,
        pending_billing_period:null,
        pending_plan_effective_at:null
      });

      ent=await getEntitlement(user.id);
      planSummary=subscriptionSummary(ent,sub);
    }

    let secondSlot=null;

    try{
      secondSlot=await resolveSecondSlotSubscription(user.id);
    }catch(error){
      console.warn(
        'Could not resolve Second Job Slot subscription:',
        error?.message||error
      );
    }

    let billingAccount={
      billing_email:user?.email||null,
      payment_method:null,
      invoices:[],
      one_time_payments:[],
      stripe_customer_count:0,
      next_plan_charge_cents:calculateNextPlanCharge(ent,sub)
    };

    try{
      billingAccount=await billingAccountSummary(
        user,
        ent,
        sub,
        secondSlot
      );
    }catch(error){
      console.warn(
        'Could not load billing account summary:',
        error?.message||error
      );
    }

    return send(res,200,{
      ok:true,
      summary:{
        ...planSummary,
        second_job_slot:secondSlotSummary(secondSlot),
        billing_account:billingAccount
      }
    });
  }

  if(action==='cancel_scheduled_change'){
    if(sub)await releaseSchedule(sub,ent);
    await patchEntitlement(user.id,{
      stripe_plan_schedule_id:null,
      pending_plan:null,
      pending_billing_period:null,
      pending_plan_effective_at:null
    });
    return send(res,200,{ok:true,change:'scheduled_change_canceled'});
  }

  if(action==='cancel_plan'){
    const result=await cancelPlanAtRenewal({
      employerId:user.id,
      ent,
      sub
    });
    return send(res,200,{ok:true,...result});
  }

  if(action==='resume_plan'){
    const result=await resumePlanRenewal({
      employerId:user.id,
      ent,
      sub
    });
    return send(res,200,{ok:true,...result});
  }

  if(action==='cancel_second_slot'){
    const secondSlot=await resolveSecondSlotSubscription(user.id);
    const result=await cancelSecondSlotAtRenewal({sub:secondSlot});
    return send(res,200,{ok:true,...result});
  }

  if(action==='resume_second_slot'){
    const secondSlot=await resolveSecondSlotSubscription(user.id);
    const result=await resumeSecondSlotRenewal({sub:secondSlot});
    return send(res,200,{ok:true,...result});
  }

  if(action!=='change_plan'){
    return send(res,400,{error:'Unknown billing action.'});
  }

  const target=String(input.target_plan||'').toLowerCase();
  const current=subscriptionPlan(ent,sub);
  const currentBilling=subscriptionBilling(ent,sub);
  const requestedBilling=String(input.billing||input.target_billing||currentBilling).toLowerCase();
  const targetBilling=['monthly','quarterly'].includes(requestedBilling)?requestedBilling:currentBilling;
  const currentCatalog=MANAGE_CATALOG[currentBilling];
  const targetCatalog=MANAGE_CATALOG[targetBilling];

  if(!targetCatalog?.[target]){
    return send(res,400,{error:'Choose Launch, Growth, or Scale with Monthly or Quarterly billing.'});
  }

  // Developer test entitlements mirror the same renewal-only plan-change UX.
  // They do not have a live Stripe subscription, so store the pending plan and
  // effective date directly on the entitlement instead of creating a schedule.
  if(ent?.test_mode===true && currentCatalog?.[current] && entitlementLooksActive(ent)){
    const effectiveAt=ent?.current_period_end||null;
    if(!effectiveAt){
      return send(res,409,{error:'Could not determine the current test-plan renewal date.'});
    }
    await patchEntitlement(user.id,{
      pending_plan:target,
      pending_billing_period:targetBilling,
      pending_plan_effective_at:effectiveAt,
      plan_change_updated_at:new Date().toISOString()
    });
    return send(res,200,{
      ok:true,
      change:'plan_change_scheduled',
      effective_at:effectiveAt,
      billing_period:targetBilling,
      current_plan:current,
      target_plan:target,
      test_mode:true
    });
  }

  if(!subscriptionIsActive(sub)||!currentCatalog?.[current]){
    return send(res,409,{
      error:'This account does not have a recurring Alygnn plan that can be modified automatically. Choose a plan through secure checkout first.',
      requires_checkout:true,
      billing_period:currentBilling
    });
  }

  if(current===target && currentBilling===targetBilling){
    return send(res,200,{
      ok:true,
      change:'none',
      message:'You are already on this plan and billing cadence.'
    });
  }

  if(String(sub?.status||ent?.subscription_status||'').toLowerCase()==='past_due'){
    return send(res,409,{
      error:'Resolve the outstanding payment before changing plans. Update your payment method, then try the plan change again.',
      payment_required:true
    });
  }

  // Choosing another plan/cadence means the employer wants billing to continue.
  // A Stripe subscription managed by a Subscription Schedule cannot have its
  // cancellation behavior edited directly, so detach the schedule first only
  // when we actually need to reverse cancel_at_period_end.
  if(sub?.cancel_at_period_end===true){
    const scheduleId=(typeof sub?.schedule==='string'?sub.schedule:sub?.schedule?.id)||ent?.stripe_plan_schedule_id||null;
    if(scheduleId){
      sub=await detachPlanScheduleForImmediateChange({
        employerId:user.id,
        ent,
        sub
      });
      ent=await getEntitlement(user.id);
    }else{
      sub=await manageStripe(
        'POST',
        'subscriptions/'+encodeURIComponent(sub.id),
        {cancel_at_period_end:'false'}
      );
    }
  }

  if(String(ent?.pending_plan||'').toLowerCase()==='free'){
    await patchEntitlement(user.id,{
      pending_plan:null,
      pending_billing_period:null,
      pending_plan_effective_at:null
    });
    ent=await getEntitlement(user.id);
  }

  const currentRank=Number(currentCatalog?.[current]?.rank||0);
  const targetRank=Number(targetCatalog?.[target]?.rank||0);
  const sameBilling=currentBilling===targetBilling;

  // Same-cadence upgrades are immediate. If an older plan change left a Stripe
  // Subscription Schedule attached, release it first; otherwise Stripe rejects
  // the immediate price swap with "subscription is managed by a schedule".
  if(sameBilling&&targetRank>currentRank){
    sub=await detachPlanScheduleForImmediateChange({
      employerId:user.id,
      ent,
      sub
    });
    ent=await getEntitlement(user.id);

    const result=await upgradeNow({
      employerId:user.id,
      ent,
      sub,
      targetPlan:target,
      billing:targetBilling,
      input
    });
    return send(res,200,{ok:true,...result});
  }

  // Downgrades and billing-cadence changes take effect at renewal so there is
  // no mid-cycle refund/credit calculation.
  const result=await scheduleDowngrade({
    employerId:user.id,
    ent,
    sub,
    currentPlan:current,
    targetPlan:target,
    billing:targetBilling,
    currentBilling
  });

  return send(res,200,{
    ok:true,
    ...result,
    change:targetRank<currentRank&&sameBilling?'downgrade_scheduled':'plan_change_scheduled',
    current_billing_period:currentBilling,
    target_billing_period:targetBilling,
    current_plan:current,
    target_plan:target,
    amount_due_now_cents:0
  });
}


async function syncCompletedBoostCheckout({ user, checkoutSessionId }) {
  const sessionId = String(checkoutSessionId || '').trim();
  if (!sessionId) {
    const error = new Error('Checkout session ID is required.');
    error.status = 400;
    throw error;
  }

  const checkout = await manageStripe(
    'GET',
    'checkout/sessions/' + encodeURIComponent(sessionId),
    {}
  );

  const metadata = checkout?.metadata || {};
  const product = String(metadata.product || '').toLowerCase();
  const employerId = String(metadata.employer_id || '').trim();
  const jobId = String(metadata.job_id || '').trim();
  const days = Math.max(
    1,
    Math.min(30, Number.parseInt(metadata.days || '1', 10) || 1)
  );

  if (product !== 'job_boost') {
    return { synced: false, product: product || null };
  }

  if (!employerId || employerId !== String(user?.id || '')) {
    const error = new Error('This Job Boost checkout does not belong to this employer.');
    error.status = 403;
    throw error;
  }

  if (!jobId) {
    const error = new Error('This Job Boost checkout is missing its job ID.');
    error.status = 400;
    throw error;
  }

  const paymentStatus = String(checkout?.payment_status || '').toLowerCase();
  const checkoutStatus = String(checkout?.status || '').toLowerCase();

  // Stripe uses "paid" for normal payments and "no_payment_required" for a
  // valid $0 checkout created by a 100%-off promotion.
  const paymentComplete =
    paymentStatus === 'paid' ||
    paymentStatus === 'no_payment_required' ||
    (checkoutStatus === 'complete' && Number(checkout?.amount_total || 0) === 0);

  if (!paymentComplete) {
    const error = new Error('This Job Boost checkout has not completed payment yet.');
    error.status = 409;
    throw error;
  }

  const response = await fetch(
    manageBase() + '/rest/v1/rpc/activate_paid_job_boost',
    {
      method: 'POST',
      headers: manageServiceHeaders(),
      body: JSON.stringify({
        p_employer_id: employerId,
        p_job_id: jobId,
        p_days: days,
        p_payment_reference: checkout.id,
        p_amount_cents: Number.isFinite(Number(checkout?.amount_total))
          ? Number(checkout.amount_total)
          : null
      })
    }
  );

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (data && (data.message || data.error)) ||
      'Could not activate the completed Job Boost.'
    );
  }

  return {
    synced: true,
    product: 'job_boost',
    job_id: jobId,
    days,
    boosted_until: data?.boosted_until || null
  };
}

// Secure, idempotent Second Job Slot recovery for completed Stripe Checkout.
// The dashboard uses this when Stripe's webhook has not yet synced the entitlement.
async function syncCompletedSecondSlotCheckout({user,checkoutSessionId,reconcile=false}) {
  const employerId=String(user?.id||'');
  if(!employerId)throw Object.assign(new Error('Employer login required.'),{status:401});

  async function applySubscription(subscription,reference,amountCents){
    if(!subscription?.id || String(subscription.metadata?.employer_id||'')!==employerId ||
      !['additional_slot','single_job'].includes(String(subscription.metadata?.product||'').toLowerCase())){
      throw Object.assign(new Error('This Second Job Slot does not belong to your employer account.'),{status:403});
    }
    const status=String(subscription.status||'').toLowerCase();
    if(!['active','trialing','past_due'].includes(status)){
      throw Object.assign(new Error('The Second Job Slot subscription is not active.'),{status:409});
    }
    // Do not re-grant an expired or ended slot. Cancellation at renewal keeps access
    // until Stripe actually ends the subscription.
    // Newer Stripe API versions put the billing-period end on subscription items.
    // A null expiry is not a valid paid-slot entitlement.
    const end=Number(subscription.current_period_end ||
      subscription.items?.data?.[0]?.current_period_end ||
      subscription.items?.data?.find(item=>item.current_period_end)?.current_period_end || 0);
    if(!end){
      throw Object.assign(new Error('Stripe did not provide the Second Job Slot billing end date. Please retry.'),{status:409});
    }
    if(end*1000<=Date.now()){
      throw Object.assign(new Error('The Second Job Slot paid period has ended.'),{status:409});
    }
    const periodEnd=new Date(end*1000).toISOString();
    await manageRpc('sync_second_job_slot_subscription',{
      p_employer_id:employerId,
      p_status:status,
      p_expires_at:periodEnd,
      p_payment_reference:reference||null,
      p_amount_cents:Number(amountCents??15000)
    });

    // Verify the persistent entitlement. The sync RPC can return HTTP 200 even
    // when a slot is not reflected in the employer's entitlement row.
    async function readAddon(){
      const url=new URL(manageBase()+'/rest/v1/employer_entitlements');
      url.searchParams.set('employer_id','eq.'+employerId);
      url.searchParams.set('select','employer_id,addon_slot_count,addon_slots_expires_at');
      url.searchParams.set('limit','1');
      const response=await fetch(url,{headers:manageServiceHeaders()});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.message||'Unable to verify the purchased slot.');
      return Array.isArray(data)?data[0]||null:null;
    }
    const isActiveAddon=row=>Number(row?.addon_slot_count||0)>=1 &&
      (!row.addon_slots_expires_at || Date.parse(row.addon_slots_expires_at)>Date.now());
    let row=await readAddon();
    if(!isActiveAddon(row)){
      // Recover only the proven, current Stripe subscription entitlement; do not
      // modify the employer's plan, jobs, or other billing fields.
      const url=new URL(manageBase()+'/rest/v1/employer_entitlements');
      url.searchParams.set('on_conflict','employer_id');
      const response=await fetch(url,{
        method:'POST',
        headers:manageServiceHeaders({Prefer:'resolution=merge-duplicates,return=minimal'}),
        body:JSON.stringify({employer_id:employerId,addon_slot_count:1,
          addon_slots_expires_at:periodEnd,updated_at:new Date().toISOString()})
      });
      if(!response.ok)throw new Error('Stripe checkout completed but the second slot could not be activated: '+await response.text());
      row=await readAddon();
      if(!isActiveAddon(row))throw new Error('Stripe checkout completed but the second slot is still unavailable. Contact support with the checkout session ID.');
    }
    return {ok:true,synced:true,product:'additional_slot',subscription_id:subscription.id,status};
  }

  const sessionId=String(checkoutSessionId||'').trim();
  if(sessionId){
    if(!/^cs_(?:live|test)_[A-Za-z0-9]+$/.test(sessionId)){
      throw Object.assign(new Error('Invalid Stripe Checkout session ID.'),{status:400});
    }
    const checkout=await manageStripe('GET','checkout/sessions/'+encodeURIComponent(sessionId));
    if(String(checkout.metadata?.employer_id||'')!==employerId ||
       !['additional_slot','single_job'].includes(String(checkout.metadata?.product||'').toLowerCase())){
      throw Object.assign(new Error('Checkout does not belong to this employer.'),{status:403});
    }
    if(checkout.mode!=='subscription'||checkout.status!=='complete'||
       !['paid','no_payment_required'].includes(String(checkout.payment_status||''))){
      throw Object.assign(new Error('Second Job Slot checkout is not complete.'),{status:409});
    }
    const subId=typeof checkout.subscription==='string'?checkout.subscription:checkout.subscription?.id;
    if(!subId)throw Object.assign(new Error('Stripe has not attached the subscription yet. Please retry.'),{status:409});
    const sub=await manageStripe('GET','subscriptions/'+encodeURIComponent(subId));
    return applySubscription(sub,checkout.id,checkout.amount_total);
  }

  if(!reconcile)throw Object.assign(new Error('Checkout session ID required.'),{status:400});
  // For old return URLs without {CHECKOUT_SESSION_ID}, recover only an active
  // subscription whose Stripe metadata explicitly identifies this employer.
  const sub=await resolveSecondSlotSubscription(employerId);
  if(!sub)throw Object.assign(new Error('No active Second Job Slot subscription found yet. Please retry.'),{status:404});
  return applySubscription(sub,null,15000);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });

  try {
    const token = bearer(req);
    if (!token) return send(res, 401, { error: 'Authentication required.' });

    const user = await supabaseUser(token);
    const input = parseBody(req);

    // Billing & plan management shares this existing Vercel function so the
    // Hobby deployment stays below the Serverless Function limit.
    const billingAction = String(input.action || '').toLowerCase();

    if(billingAction==='validate_promo'){
      const resolved=await resolvePromotionCode(input.promotion_code);

      if(!resolved){
        return send(res,400,{
          error:'This promotion code is invalid, expired, or inactive.'
        });
      }

      return send(res,200,{
        ok:true,
        ...promotionSummary(resolved)
      });
    }
    if ([
      'summary',
      'change_plan',
      'sync_plan_upgrade_payment',
      'cancel_scheduled_change',
      'cancel_plan',
      'resume_plan',
      'cancel_second_slot',
      'resume_second_slot',
      'billing_portal'
    ].includes(billingAction)) {
      return await runManageAction(res, user, input);
    }

    if (billingAction === 'sync_second_slot_checkout' || billingAction === 'reconcile_second_slot_checkout') {
      const result = await syncCompletedSecondSlotCheckout({
        user,
        checkoutSessionId: billingAction === 'sync_second_slot_checkout' ? input.checkout_session_id : '',
        reconcile: billingAction === 'reconcile_second_slot_checkout'
      });
      return send(res,200,result);
    }

    if (billingAction === 'sync_boost_checkout') {
      const result = await syncCompletedBoostCheckout({
        user,
        checkoutSessionId: input.checkout_session_id
      });
      return send(res, 200, result);
    }

    if (input.terms_accepted !== true) return send(res, 400, { error: 'Terms must be accepted before checkout.' });

    const successUrl = allowedReturnUrl(
      input.success_url,
      'https://alygnn.com/employer-dashboard.html?payment=success'
    );
    const cancelUrl = allowedReturnUrl(
      input.cancel_url,
      'https://alygnn.com/employer-dashboard.html?payment=cancelled'
    );

    let product = String(input.product || '').toLowerCase();
    let plan = String(input.plan || '').toLowerCase();
    let billing = String(input.billing || '').toLowerCase();
    let name = '';
    let cents = 0;
    let mode = 'payment';
    let slots = 0;
    let days = 0;
    let jobId = '';
    let priceId = '';
    let quantity = 1;

    // Backward compatibility: the former $150 "single_job" product is now
    // the standalone $150/month Second Job Slot.
    if (!product && (billing === 'weekly' || plan === 'weekly_slot')) product = 'weekly_slot';
    if (!product && plan && plan !== 'single_job') product = 'job_plan';
    if (!product && plan === 'single_job') product = 'additional_slot';
    if (product === 'single_job') product = 'additional_slot';

    if (product === 'additional_slot') {
      const access = await getEmployerPostingAccess(token);

      // Stripe is authoritative for active subscriptions. Never create duplicate
      // $150 renewals just because Supabase has a stale expired entitlement.
      const existingSecondSlot = await resolveSecondSlotSubscription(user.id);
      if (existingSecondSlot) {
        return send(res,409,{error:'A Second Job Slot subscription is already active. Return to your dashboard to restore access; do not purchase another.',existing_subscription:true});
      }
      if (!additionalSlotEligible(access)) {
        const message = access?.active_paid_plan === true
          ? 'The $150/month Second Job Slot is only for Free employers. Use a $99 Weekly Job Slot or upgrade your plan.'
          : 'Your Second Job Slot is already active.';
        return send(res, 400, { error: message });
      }

      plan = 'second_job_slot';
      billing = 'monthly';
      name = 'Alygnn Second Job Slot';
      cents = 15000;
      slots = 1;
      mode = 'subscription';
      priceId = PRICE_IDS.second_job_slot_monthly;

    } else if (product === 'job_boost') {
      jobId = String(input.job_id || '');
      days = Math.max(1, Math.min(30, Number.parseInt(input.days || Math.ceil(Number(input.duration_hours || 24) / 24), 10) || 1));
      if (!jobId) return send(res, 400, { error: 'Job ID is required for Job Boost.' });
      await verifyOwnedActiveJob(token, user.id, jobId);
      name = `Alygnn Job Boost — ${days} day${days === 1 ? '' : 's'}`;
      cents = 1500 * days;
      billing = 'one_time';
      mode = 'payment';
      priceId = PRICE_IDS.job_boost_day;
      quantity = days;

    } else if (product === 'team_seat') {
      const teamAccess = await getMyTeamAccess(token);
      const currentPlan = String(teamAccess?.plan || '').toLowerCase();
      const seat = teamSeatPrice(currentPlan);

      if (teamAccess?.is_owner !== true) {
        return send(res, 403, { error: 'Only the company owner can purchase an additional team seat.' });
      }
      if (teamAccess?.can_purchase_seat !== true || !seat) {
        return send(res, 400, { error: 'An additional team seat is not available for this company right now.' });
      }

      plan = currentPlan;
      billing = 'monthly';
      name = `Alygnn ${currentPlan.charAt(0).toUpperCase()+currentPlan.slice(1)} Extra Team Seat`;
      cents = seat.cents;
      slots = 1;
      mode = 'subscription';
      priceId = seat.priceId;

    } else if (product === 'weekly_slot' || billing === 'weekly' || plan === 'weekly_slot') {
      product = 'weekly_slot';
      billing = 'weekly';
      plan = 'weekly_slot';

      const access = await getEmployerPostingAccess(token);
      if (access?.candidate_access_locked === true) {
        return send(res, 402, {
          error: 'Update your payment method before adding another Weekly Job Slot.',
          payment_issue: true
        });
      }
      if (access?.active_paid_plan !== true) {
        return send(res, 400, {
          error: 'The $99 Weekly Job Slot is available only with an active Launch, Growth, or Scale monthly/quarterly plan.'
        });
      }
      if (access?.weekly_purchase_allowed !== true) {
        const recommended = String(access?.recommended_upgrade_plan || '').toLowerCase();
        return send(res, 409, {
          error: recommended
            ? `You already have one active Weekly Job Slot. Upgrade to ${recommended.charAt(0).toUpperCase()+recommended.slice(1)} for better ongoing value.`
            : 'Another Weekly Job Slot is not available for this plan right now.',
          recommended_upgrade_plan: recommended || null,
          manage_plan: !!recommended
        });
      }

      const item = CHECKOUT_CATALOG.weekly.weekly_slot;
      name = item.name;
      cents = item.cents;
      slots = item.slots;
      mode = item.mode;
      priceId = item.priceId;

    } else {
      product = 'job_plan';
      const item = CHECKOUT_CATALOG[billing]?.[plan];
      if (!item) return send(res, 400, { error: 'Unknown Alygnn plan or billing period.' });

      // Do not create a second paid plan while an employer already has one active.
      // Existing recurring subscribers change plans through Billing & plan so
      // every plan or billing-cadence change is scheduled for the next renewal.
      if (billing === 'monthly' || billing === 'quarterly') {
        const access = await getEmployerPostingAccess(token);
        const currentPlan = String(access?.plan || '').toLowerCase();
        const currentBilling = String(access?.billing_period || '').toLowerCase();
        if (
          access?.active_paid_plan === true &&
          ['monthly','quarterly'].includes(currentBilling) &&
          ['launch','growth','scale','business','enterprise'].includes(currentPlan)
        ) {
          return send(res, 409, {
            error: 'You already have an active paid plan. Change it from Pricing or Settings → Billing & plan; the selected plan will take effect at your next renewal and nothing is charged today.',
            manage_plan: true
          });
        }
      }

      name = item.name;
      cents = item.cents;
      slots = item.slots;
      mode = item.mode;
      priceId = item.priceId;
    }

    if (!priceId) return send(res, 500, { error: 'Stripe Price ID is not configured for this Alygnn product.' });

    const requestedPromotionCode=
      String(input.promotion_code||'').trim().toUpperCase();

    const resolvedPromotion=
      requestedPromotionCode
        ?await resolvePromotionCode(requestedPromotionCode)
        :null;

    if(requestedPromotionCode&&!resolvedPromotion){
      return send(res,400,{
        error:'This promotion code is invalid, expired, or inactive.'
      });
    }

    const promotionCodeId=
      resolvedPromotion?.promotion?.id||'';

    const metadata = {
      employer_id: user.id,
      employer_email: user.email || '',
      product,
      plan,
      billing,
      slots: slots || '',
      job_id: jobId,
      days: days || '',
      unit_amount_cents: product === 'job_boost' ? '1500' : cents,
      stripe_price_id: priceId,
      source: String(input.source || 'website'),
      terms_version: String(input.terms_version || ''),
      promotion_code: requestedPromotionCode || ''
    };

    const useNativePaymentSheet=
      nativePaymentSheetRequested(input) &&
      !(promotionCodeId && mode==='payment');

    if (useNativePaymentSheet) {
      let preferredCustomerId=null;

      // Reuse the plan customer whenever one already exists. This keeps saved
      // billing details and recurring purchases on the same Stripe Customer.
      try{
        const ent=await getEntitlement(user.id);
        let sub=null;
        if(shouldResolveSubscription(ent)){
          try{sub=await resolveSubscription(user.id,ent);}catch(_error){}
        }
        preferredCustomerId=stripeCustomerId(sub,ent);
      }catch(_error){}

      const native=await createNativePaymentSheetCheckout({
        user,
        employerId:user.id,
        input,
        mode,
        priceId,
        quantity,
        cents,
        name,
        metadata,
        preferredCustomerId,
        promotionCodeId
      });

      return send(res,200,native);
    }

    const params = {
      mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user.email || undefined,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': quantity,
      'automatic_tax[enabled]': 'true',
      billing_address_collection: 'auto'
    };

    if(promotionCodeId){
      params['discounts[0][promotion_code]']=promotionCodeId;
    }else{
      params.allow_promotion_codes='true';
    }

    Object.entries(metadata).forEach(([key, value]) => {
      params[`metadata[${key}]`] = value;
      if (mode === 'subscription') params[`subscription_data[metadata][${key}]`] = value;
      else params[`payment_intent_data[metadata][${key}]`] = value;
    });

    const session = await stripeCreateCheckout(params);
    return send(res, 200, { url: session.url, id: session.id });
  } catch (error) {
    console.error('Alygnn billing/checkout error:', error);
    return send(res, error.status&&error.status>=400&&error.status<500?error.status:500, { error: error?.message || 'Could not complete billing request.' });
  }
};
