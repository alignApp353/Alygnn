// Vercel/Node Stripe webhook additions for Alygnn employer monetization.
// Route suggestion: /api/stripe-webhook
//
// Required environment variables:
//   STRIPE_WEBHOOK_SECRET
//   STRIPE_SECRET_KEY
//   SUPABASE_URL=https://auth.alygnn.com
//   SUPABASE_SERVICE_ROLE_KEY
//
// In Stripe Dashboard, point the webhook at this route and subscribe at least to:
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.paid
//
// If you ALREADY have a Stripe webhook, merge the fulfillment branches below into
// your existing verified webhook instead of running two handlers for the same event.

const crypto = require('crypto');

function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body));
  // Signature verification needs the exact raw bytes. If a framework parsed the
  // body first, disable its body parser for this route.
  if (req.body && typeof req.body === 'object') {
    throw new Error('Webhook body was parsed before signature verification. Disable body parsing for this route.');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyStripeSignature(buffer, header, secret) {
  const parts = String(header || '').split(',').map(v => v.trim());
  const timestamp = parts.find(v => v.startsWith('t='))?.slice(2);
  const signatures = parts.filter(v => v.startsWith('v1=')).map(v => v.slice(3));
  if (!timestamp || !signatures.length) throw new Error('Missing Stripe signature.');

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) throw new Error('Stripe webhook timestamp is outside the tolerance window.');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + buffer.toString('utf8'), 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const valid = signatures.some(sig => {
    try {
      const received = Buffer.from(sig, 'hex');
      return received.length === expectedBuf.length && crypto.timingSafeEqual(received, expectedBuf);
    } catch (_) { return false; }
  });
  if (!valid) throw new Error('Invalid Stripe webhook signature.');
}

async function stripeGet(path) {
  const response = await fetch('https://api.stripe.com/v1/' + path.replace(/^\//, ''), {
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Stripe lookup failed.');
  return data;
}

async function stripePost(path, params = {}) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      body.append(key, String(value));
    }
  });

  const response = await fetch(
    'https://api.stripe.com/v1/' + path.replace(/^\//, ''),
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Stripe update failed.');
  }
  return data;
}

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  return {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    ...extra
  };
}

function supabaseBase() {
  return (process.env.SUPABASE_URL || 'https://auth.alygnn.com').replace(/\/$/, '');
}

async function rpc(name, body) {
  const response = await fetch(`${supabaseBase()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data && (data.message || data.error)) || `Supabase RPC ${name} failed.`);
  return data;
}

function planInfo(plan) {
  const key = String(plan || '').toLowerCase();
  return {
    launch: { legacyPlan: 'business', slots: 3, urgent: false },
    growth: { legacyPlan: 'enterprise', slots: 5, urgent: true },
    scale: { legacyPlan: 'enterprise', slots: 8, urgent: true },
    weekly_slot: { legacyPlan: 'business', slots: 1, urgent: false }
  }[key] || null;
}

// Some Stripe API versions expose subscription renewal dates on the item.
function stripePeriodEndUnix(subscription){
  const value=Number(subscription?.current_period_end ?? subscription?.items?.data?.[0]?.current_period_end);
  return Number.isFinite(value)&&value>0?value:null;
}

async function upsertPlan({ employerId, plan, billing, status, periodEnd, subscription = null }) {
  const info = planInfo(plan);
  if (!employerId || !info) return;

  periodEnd=periodEnd||stripePeriodEndUnix(subscription);

  // test_plan stores the exact Launch/Growth/Scale/Weekly code for compatibility
  // with Alygnn's existing entitlement schema; test_mode remains false.
  const row = {
    employer_id: employerId,
    plan: info.legacyPlan,
    subscription_status: status || 'active',
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    slot_limit: info.slots,
    billing_period: billing || null,
    test_mode: false,
    test_plan: plan,
    urgently_hiring: info.urgent,
    alygnn_recommended: String(plan || '').toLowerCase() === 'scale',
    pending_plan: null,
    pending_billing_period: null,
    pending_plan_effective_at: null,
    stripe_plan_schedule_id: null,
    stripe_plan_subscription_id:
      subscription?.id || undefined,
    stripe_plan_customer_id:
      typeof subscription?.customer === 'string'
        ? subscription.customer
        : subscription?.customer?.id || undefined,
    updated_at: new Date().toISOString()
  };

  // Do not send undefined values to Supabase.
  Object.keys(row).forEach(key => {
    if (row[key] === undefined) delete row[key];
  });

  const response = await fetch(`${supabaseBase()}/rest/v1/employer_entitlements?on_conflict=employer_id`, {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error('Could not update employer plan entitlement: ' + text);
  }

  // Keep the job-level badge state consistent with the current plan.
  await fetch(`${supabaseBase()}/rest/v1/jobs?employer_id=eq.${encodeURIComponent(employerId)}&status=eq.active&posting_access_type=eq.plan`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ urgently_hiring: info.urgent })
  });
}

function plusDaysUnix(days) {
  return Math.floor(Date.now() / 1000) + days * 86400;
}

function plusMonthsUnix(months) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + months);
  return Math.floor(date.getTime() / 1000);
}


async function fulfillWeeklySlotPayment({employerId,reference,amount}){
  if(!employerId||!reference)throw new Error('Missing Weekly Job Slot payment details.');
  const query=new URL(`${supabaseBase()}/rest/v1/employer_weekly_slot_purchases`);
  query.searchParams.set('payment_reference','eq.'+reference);
  query.searchParams.set('select','id,employer_id');
  query.searchParams.set('limit','1');
  async function existing(){
    const r=await fetch(query,{headers:serviceHeaders()});
    const rows=await r.json().catch(()=>[]);
    if(!r.ok)throw new Error('Could not verify Weekly Job Slot purchase.');
    return Array.isArray(rows)?rows[0]:null;
  }
  const prior=await existing();
  if(prior){
    if(String(prior.employer_id)!==String(employerId))throw new Error('Weekly payment reference belongs to another employer.');
    return;
  }
  const r=await fetch(`${supabaseBase()}/rest/v1/employer_weekly_slot_purchases`,{
    method:'POST',headers:serviceHeaders({Prefer:'return=minimal'}),
    body:JSON.stringify({
      employer_id:employerId,payment_reference:reference,
      amount_cents:Number(amount||0),test_mode:false,
      expires_at:new Date(Date.now()+7*86400000).toISOString(),activated_at:null
    })
  });
  if(!r.ok){
    const recorded=await existing();
    if(!recorded || String(recorded.employer_id)!==String(employerId)){
      throw new Error('Weekly Job Slot activation failed: '+await r.text());
    }
  }
}

async function fulfillCheckout(session) {
  const meta = session.metadata || {};
  const employerId = meta.employer_id;
  const product = String(meta.product || '').toLowerCase();
  if (!employerId || !product) return;
  if (session?.status && session.status !== 'complete') return;

  if (product === 'weekly_slot') {
    if(!['paid','no_payment_required'].includes(String(session.payment_status)) ||
       (session.status && session.status!=='complete'))return;
    await fulfillWeeklySlotPayment({
      employerId,reference:session.id,amount:Number(session.amount_total||0)
    });
    return;
  }

  if (product === 'additional_slot' || product === 'single_job') {
    // Standalone $150/month Second Job Slot. The included free slot remains,
    // so this subscription gives the employer 2 total reusable active slots.
    if (session.mode === 'subscription' && session.subscription) {
      const subscription = await stripeGet(`subscriptions/${encodeURIComponent(session.subscription)}`);
      await rpc('sync_second_job_slot_subscription', {
        p_employer_id: employerId,
        p_status: subscription.status === 'trialing' ? 'trialing' : 'active',
        p_expires_at: stripePeriodEndUnix(subscription)
          ? new Date(stripePeriodEndUnix(subscription)*1000).toISOString()
          : null,
        p_payment_reference: session.id,
        p_amount_cents: session.amount_total || 15000
      });
      return;
    }

    // Legacy one-time checkout compatibility.
    await rpc('grant_additional_reusable_slot', {
      p_employer_id: employerId,
      p_quantity: 1,
      p_payment_reference: session.id,
      p_amount_cents: session.amount_total || 15000
    });
    return;
  }

  if (product === 'job_boost') {
    await rpc('activate_paid_job_boost', {
      p_employer_id: employerId,
      p_job_id: meta.job_id,
      p_days: Math.max(1, Number.parseInt(meta.days || '1', 10) || 1),
      p_payment_reference: session.id,
      p_amount_cents: session.amount_total || null
    });
    return;
  }

  if (product === 'test_plan_upgrade') {
    // Test entitlements have no Stripe subscription. A completed, 100%-off
    // Checkout can change ONLY the existing test entitlement, not create an
    // unapproved recurring subscription or extend the test term.
    if(session?.status!=='complete' ||
       session?.payment_status!=='no_payment_required' ||
       Number(session?.amount_total)!==0){
      throw new Error('Test upgrade requires a verified completed $0 checkout.');
    }
    const current=String(meta.current_plan||'').toLowerCase();
    const target=String(meta.target_plan||'').toLowerCase();
    const billing=String(meta.billing||'').toLowerCase();
    const ranks={launch:1,growth:2,scale:3};
    if(!ranks[current]||!ranks[target]||ranks[target]<=ranks[current]||
      !['monthly','quarterly'].includes(billing)){
      throw new Error('Invalid promotional test-plan upgrade.');
    }
    const res=await fetch(
      `${supabaseBase()}/rest/v1/employer_entitlements?employer_id=eq.${encodeURIComponent(employerId)}&select=*`,
      {headers:serviceHeaders()}
    );
    const rows=await res.json().catch(()=>[]);
    if(!res.ok)throw new Error('Could not verify existing employer test plan.');
    const ent=Array.isArray(rows)?rows[0]:null;
    if(!ent||ent.test_mode!==true){
      // Already applied or subsequently moved to a real plan; do not overwrite.
      return;
    }
    const currentEntPlan=String(ent.test_plan||'').toLowerCase();
    if(currentEntPlan===target)return;
    if(currentEntPlan!==current){
      console.warn('Ignoring obsolete test upgrade for employer',employerId);
      return;
    }
    const info=planInfo(target);
    const patch={
      plan:info.legacyPlan,test_plan:target,test_mode:true,
      subscription_status:'active',billing_period:billing,
      slot_limit:info.slots,urgently_hiring:info.urgent,
      alygnn_recommended:target==='scale',
      plan_amount_cents:target==='scale'?(billing==='monthly'?64900:170000)
        :(target==='growth'?(billing==='monthly'?44900:114000):(billing==='monthly'?29900:75000)),
      pending_plan:null,pending_billing_period:null,pending_plan_effective_at:null,
      stripe_plan_schedule_id:null,updated_at:new Date().toISOString()
    };
    const updated=await fetch(
      `${supabaseBase()}/rest/v1/employer_entitlements?employer_id=eq.${encodeURIComponent(employerId)}`,
      {method:'PATCH',headers:serviceHeaders({Prefer:'return=minimal'}),body:JSON.stringify(patch)}
    );
    if(!updated.ok)throw new Error('Could not activate promotional test upgrade: '+await updated.text());
    return;
  }

  if (product === 'plan_upgrade') {
    if (!['paid','no_payment_required'].includes(String(session.payment_status||''))) return;
    // An authenticated Checkout event is the only authority to apply an
    // upgrade. For a 100%-off code, Stripe returns no_payment_required.
    const targetPlan=String(meta.target_plan||'').toLowerCase();
    const fromPlan=String(meta.current_plan||'').toLowerCase();
    const billing=String(meta.billing||'').toLowerCase();
    const subscriptionId=String(meta.subscription_id||'').trim();
    const targetPriceId=String(meta.target_price_id||'').trim();
    const storedItemId=String(meta.subscription_item_id||'').trim();

    if(!['launch','growth','scale'].includes(targetPlan) ||
       !['monthly','quarterly'].includes(billing) ||
       !subscriptionId || !targetPriceId){
      throw new Error('Verified plan-upgrade Checkout is missing valid metadata.');
    }

    let sub=await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`);
    const item=sub?.items?.data?.find(row=>row.id===storedItemId)||sub?.items?.data?.[0];
    if(!item?.id)throw new Error('Plan upgrade subscription item was not found.');

    const livePriceId=typeof item.price==='string'?item.price:item.price?.id;
    const livePlan=String(sub?.metadata?.plan||'').toLowerCase();

    // Stripe retries and manual redeliveries must never downgrade an employer
    // who has since legitimately changed plans. Replays for the SAME plan can
    // safely re-sync a missing Supabase entitlement.
    if(livePriceId!==targetPriceId && fromPlan && livePlan && livePlan!==fromPlan){
      console.warn('Ignoring obsolete plan-upgrade Checkout:',session.id,livePlan,'is no longer',fromPlan);
      return;
    }

    if(livePriceId!==targetPriceId){
      const scheduleId=typeof sub.schedule==='string'?sub.schedule:sub.schedule?.id;
      if(scheduleId){
        // A previously scheduled downgrade can block Stripe price updates.
        await stripePost(`subscription_schedules/${encodeURIComponent(scheduleId)}/release`,{});
        sub=await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`);
      }
      sub=await stripePost(`subscriptions/${encodeURIComponent(subscriptionId)}`,{
        cancel_at_period_end:'false',
        'items[0][id]':item.id,
        'items[0][price]':targetPriceId,
        'items[0][quantity]':1,
        proration_behavior:'none',
        'metadata[employer_id]':employerId,
        'metadata[product]':'job_plan',
        'metadata[plan]':targetPlan,
        'metadata[billing]':billing
      });
    }

    await upsertPlan({
      employerId,
      plan:targetPlan,
      billing,
      status:String(sub.status||'active').toLowerCase(),
      periodEnd:stripePeriodEndUnix(sub),
      subscription:sub
    });
    return;
  }

  if (product === 'job_plan') {
    const plan = meta.plan;
    const billing = meta.billing;

    if (session.mode === 'subscription' && session.subscription) {
      const subscription = await stripeGet(`subscriptions/${encodeURIComponent(session.subscription)}`);
      await upsertPlan({
        employerId,
        plan,
        billing,
        status: subscription.status === 'trialing' ? 'trialing' : 'active',
        periodEnd: stripePeriodEndUnix(subscription),
        subscription
      });
      return;
    }

    const expires = billing === 'weekly' ? plusDaysUnix(7) : plusMonthsUnix(3);
    await upsertPlan({ employerId, plan, billing, status: 'active', periodEnd: expires });
  }
}

async function fulfillSubscription(subscription, forceStatus) {
  const meta = subscription.metadata || {};
  const product = String(meta.product || '').toLowerCase();
  if (!meta.employer_id) return;

  if (product === 'weekly_slot') {
    if(!['paid','no_payment_required'].includes(String(session.payment_status)) ||
       (session.status && session.status!=='complete'))return;
    await fulfillWeeklySlotPayment({
      employerId,reference:session.id,amount:Number(session.amount_total||0)
    });
    return;
  }

  if (product === 'additional_slot' || product === 'single_job') {
    const status = forceStatus || (subscription.status === 'trialing' ? 'trialing' : subscription.status);
    await rpc('sync_second_job_slot_subscription', {
      p_employer_id: meta.employer_id,
      p_status: status,
      p_expires_at: stripePeriodEndUnix(subscription)
        ? new Date(stripePeriodEndUnix(subscription)*1000).toISOString()
        : null,
      p_payment_reference: null,
      p_amount_cents: 15000
    });
    return;
  }

  if (product !== 'job_plan') return;
  // A paid pending update may change the Price before metadata is refreshed.
  // Always derive the effective tier from Stripe's actual subscription Price.
  const activePrice=subscription?.items?.data?.[0]?.price;
  const priceId=typeof activePrice==='string'?activePrice:activePrice?.id;
  const catalog={
    'price_1UACGoRvnGY3BeGX4Dnlv9ZP':['launch','monthly'],
    'price_1UEJGJRvnGY3BeGX9yK3XL2i':['launch','quarterly'],
    'price_1UEJI7RvnGY3BeGXXDSX5rqM':['growth','monthly'],
    'price_1UEJJIRvnGY3BeGXPIAyRF2z':['growth','quarterly'],
    'price_1UEJK6RvnGY3BeGXKfZEsIIk':['scale','monthly'],
    'price_1UEJMSRvnGY3BeGXEwCM1bmu':['scale','quarterly']
  };
  const resolved=catalog[priceId]||[meta.plan,meta.billing||'monthly'];
  if(catalog[priceId]&&(meta.plan!==resolved[0]||meta.billing!==resolved[1])&&!subscription.pending_update){
    await stripePost('subscriptions/'+encodeURIComponent(subscription.id),{
      'metadata[plan]':resolved[0], 'metadata[billing]':resolved[1]
    });
  }
  await upsertPlan({
    employerId: meta.employer_id,
    plan: resolved[0],
    billing: resolved[1],
    status: forceStatus || (subscription.status === 'trialing' ? 'trialing' : 'active'),
    periodEnd: stripePeriodEndUnix(subscription),
    subscription
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured.');

    const buffer = await rawBody(req);
    verifyStripeSignature(buffer, req.headers['stripe-signature'], secret);
    const event = JSON.parse(buffer.toString('utf8'));

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent=event.data.object;
        if(String(intent?.metadata?.product||'')==='weekly_slot' && intent.status==='succeeded' && String(intent?.metadata?.payment_flow||'')==='native'){
          await fulfillWeeklySlotPayment({
            employerId:String(intent.metadata.employer_id||''),
            reference:intent.id,
            amount:Number(intent.amount_received||intent.amount||0)
          });
        }
        if(String(intent?.metadata?.product||'')==='plan_upgrade'){
          await fulfillCheckout({
            id:intent.id,status:'complete',payment_status:'paid',
            metadata:intent.metadata
          });
        }
        break;
      }
      case 'checkout.session.completed':
        if (['paid','no_payment_required'].includes(event.data.object.payment_status) || event.data.object.mode === 'subscription') {
          await fulfillCheckout(event.data.object);
        }
        break;

      case 'customer.subscription.updated': {
        const subscription=await stripeGet(`subscriptions/${encodeURIComponent(event.data.object.id)}?expand[]=items.data.price`);
        await fulfillSubscription(subscription);
        break;
      }

      case 'customer.subscription.deleted':
        await fulfillSubscription(event.data.object, 'canceled');
        break;

      case 'invoice.paid': {
        const subscriptionId = event.data.object.subscription;
        if (subscriptionId) {
          const subscription = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}`);
          await fulfillSubscription(subscription);
        }
        break;
      }

      default:
        break;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ received: true }));
  } catch (error) {
    console.error('Alygnn Stripe webhook error:', error);
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: error?.message || 'Webhook failed.' }));
  }
};

// If this route is hosted through a framework that auto-parses request bodies,
// disable body parsing. In Next.js this export/config must be translated to the
// framework's expected form. Plain Vercel Node Functions generally expose the raw stream.
module.exports.config = { api: { bodyParser: false } };
