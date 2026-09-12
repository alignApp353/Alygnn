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
//   payment_intent.succeeded
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.paid
//   invoice.payment_failed
//   invoice.payment_action_required
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

async function stripePost(path, params={}) {
  const body=new URLSearchParams();
  for(const [key,value] of Object.entries(params)){
    if(value===undefined||value===null||value==='')continue;
    body.append(key,String(value));
  }
  const response=await fetch('https://api.stripe.com/v1/' + path.replace(/^\//,''),{
    method:'POST',
    headers:{
      Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,
      'Content-Type':'application/x-www-form-urlencoded'
    },
    body
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message||'Stripe update failed.');
  return data;
}

async function releaseSubscriptionSchedule(subscription){
  const scheduleId=typeof subscription?.schedule==='string'
    ? subscription.schedule
    : subscription?.schedule?.id;
  if(!scheduleId)return;
  try{
    await stripePost(`subscription_schedules/${encodeURIComponent(scheduleId)}/release`,{});
  }catch(error){
    // A completed/released schedule no longer needs action. Log and continue so a
    // successfully paid upgrade is not stranded because of stale schedule data.
    console.warn('Could not release Stripe subscription schedule during upgrade:',error?.message||error);
  }
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
    scale: { legacyPlan: 'enterprise', slots: 8, urgent: true }
  }[key] || null;
}

function planAmountCents(plan, billing) {
  const key = String(plan || '').toLowerCase();
  const period = String(billing || '').toLowerCase();
  if (period === 'monthly') {
    return { launch: 29900, growth: 44900, scale: 64900 }[key] || null;
  }
  if (period === 'quarterly') {
    return { launch: 75000, growth: 114000, scale: 170000 }[key] || null;
  }
  return null;
}

async function upsertPlan({ employerId, plan, billing, status, periodEnd, subscriptionId, customerId, scheduleId }) {
  const info = planInfo(plan);
  if (!employerId || !info) return;

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
    plan_amount_cents: planAmountCents(plan, billing),
    stripe_plan_subscription_id: subscriptionId || null,
    stripe_plan_customer_id: customerId || null,
    stripe_plan_schedule_id: scheduleId || null,
    updated_at: new Date().toISOString()
  };

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
    body: JSON.stringify({
      urgently_hiring: info.urgent,
      alygnn_recommended: info.urgent
    })
  });
}

function normalizedSubscriptionStatus(subscription, forceStatus) {
  if (forceStatus) return String(forceStatus).toLowerCase();
  const status=String(subscription?.status||'active').toLowerCase();
  return status || 'active';
}

async function setCandidateAccessLock(employerId, locked, reason=null, subscriptionStatus=null) {
  if (!employerId) return;
  const url=new URL(`${supabaseBase()}/rest/v1/employer_entitlements`);
  url.searchParams.set('employer_id','eq.'+employerId);
  const now=new Date().toISOString();
  const patch={
    candidate_access_locked: !!locked,
    candidate_access_lock_reason: locked ? (reason || 'payment_failed') : null,
    candidate_access_locked_at: locked ? now : null,
    updated_at: now
  };
  if (locked) patch.last_payment_failed_at=now;
  if (subscriptionStatus) patch.subscription_status=String(subscriptionStatus).toLowerCase();
  const response=await fetch(url,{
    method:'PATCH',
    headers:serviceHeaders({Prefer:'return=minimal'}),
    body:JSON.stringify(patch)
  });
  if(!response.ok) throw new Error('Could not update candidate payment lock: '+await response.text());
}

function subscriptionUnitAmount(subscription, fallback=0) {
  const value=subscription?.items?.data?.[0]?.price?.unit_amount;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

async function clearPendingIfApplied(employerId, activePlan) {
  if (!employerId || !activePlan) return;
  const url = new URL(`${supabaseBase()}/rest/v1/employer_entitlements`);
  url.searchParams.set('employer_id', 'eq.' + employerId);
  url.searchParams.set('select', 'pending_plan');
  url.searchParams.set('limit', '1');

  const read = await fetch(url, { headers: serviceHeaders() });
  const rows = await read.json().catch(() => []);
  if (!read.ok || !Array.isArray(rows) || !rows[0]) return;

  if (String(rows[0].pending_plan || '').toLowerCase() !== String(activePlan).toLowerCase()) return;

  const patchUrl = new URL(`${supabaseBase()}/rest/v1/employer_entitlements`);
  patchUrl.searchParams.set('employer_id', 'eq.' + employerId);
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({
      pending_plan: null,
      pending_billing_period: null,
      pending_plan_effective_at: null,
      stripe_plan_schedule_id: null,
      plan_change_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
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

async function fulfillPaidPlanUpgrade(session){
  const meta=session?.metadata||{};
  const employerId=meta.employer_id;
  const subscriptionId=meta.subscription_id;
  const targetPlan=String(meta.target_plan||'').toLowerCase();
  const billing=String(meta.billing||'').toLowerCase();
  const targetPriceId=String(meta.target_price_id||'');

  if(!employerId||!subscriptionId||!targetPriceId||!['launch','growth','scale'].includes(targetPlan)){
    throw new Error('Paid plan upgrade checkout is missing required metadata.');
  }
  if(!['monthly','quarterly'].includes(billing)){
    throw new Error('Paid plan upgrade checkout has an invalid billing period.');
  }

  let subscription=await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`);
  const item=subscription?.items?.data?.[0];
  if(!item?.id)throw new Error('Stripe subscription item could not be identified for the paid upgrade.');

  // If a downgrade/cancellation schedule was previously queued, the successful
  // paid upgrade takes precedence. Release it only now, after Stripe confirmed payment.
  await releaseSubscriptionSchedule(subscription);

  subscription=await stripePost(`subscriptions/${encodeURIComponent(subscriptionId)}`,{
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

  await upsertPlan({
    employerId,
    plan:targetPlan,
    billing,
    status:normalizedSubscriptionStatus(subscription),
    periodEnd:subscription.current_period_end,
    subscriptionId:subscription.id,
    customerId:typeof subscription.customer==='string'?subscription.customer:subscription.customer?.id,
    scheduleId:null
  });
  await setCandidateAccessLock(employerId,false,null,normalizedSubscriptionStatus(subscription));
  await clearPendingIfApplied(employerId,targetPlan);
}

async function fulfillCheckout(session) {
  const meta = session.metadata || {};
  const employerId = meta.employer_id;
  const product = String(meta.product || '').toLowerCase();
  if (!employerId || !product) return;

  if (product === 'plan_upgrade') {
    await fulfillPaidPlanUpgrade(session);
    return;
  }

  if (product === 'additional_slot' || product === 'single_job') {
    // Standalone $150/month Second Job Slot. The included free slot remains,
    // so this subscription gives the employer 2 total reusable active slots.
    if (session.mode === 'subscription' && session.subscription) {
      const subscription = await stripeGet(`subscriptions/${encodeURIComponent(session.subscription)}`);
      await rpc('sync_second_job_slot_subscription', {
        p_employer_id: employerId,
        p_status: normalizedSubscriptionStatus(subscription),
        p_expires_at: new Date(subscription.current_period_end * 1000).toISOString(),
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

  if (product === 'weekly_slot') {
    await rpc('grant_weekly_job_slot', {
      p_employer_id: employerId,
      p_payment_reference: session.id,
      p_amount_cents: session.amount_total || 9900,
      p_days: 7
    });
    return;
  }

  if (product === 'team_seat') {
    if (session.mode === 'subscription' && session.subscription) {
      const subscription = await stripeGet(`subscriptions/${encodeURIComponent(session.subscription)}?expand[]=items.data.price`);
      await rpc('sync_team_seat_subscription', {
        p_employer_id: employerId,
        p_stripe_subscription_id: subscription.id,
        p_status: normalizedSubscriptionStatus(subscription),
        p_expires_at: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        p_payment_reference: session.id,
        p_amount_cents: subscriptionUnitAmount(subscription, Number(meta.unit_amount_cents || 0))
      });
    }
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
        periodEnd: subscription.current_period_end,
        subscriptionId: subscription.id,
        customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        scheduleId: typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id
      });
      await clearPendingIfApplied(employerId, plan);
      return;
    }

    const expires = billing === 'weekly' ? plusDaysUnix(7) : plusMonthsUnix(3);
    await upsertPlan({ employerId, plan, billing, status: 'active', periodEnd: expires });
  }
}


async function fulfillPaymentIntent(intent){
  const meta=intent?.metadata||{};
  const employerId=meta.employer_id;
  const product=String(meta.product||'').toLowerCase();
  if(!employerId||!product)return;

  if(product==='plan_upgrade'){
    await fulfillPaidPlanUpgrade(intent);
    return;
  }

  if(product==='weekly_slot'){
    await rpc('grant_weekly_job_slot',{
      p_employer_id:employerId,
      p_payment_reference:intent.id,
      p_amount_cents:Number(intent.amount_received||intent.amount||9900),
      p_days:7
    });
    return;
  }

  if(product==='job_boost'){
    await rpc('activate_paid_job_boost',{
      p_employer_id:employerId,
      p_job_id:meta.job_id,
      p_days:Math.max(1,Number.parseInt(meta.days||'1',10)||1),
      p_payment_reference:intent.id,
      p_amount_cents:Number(intent.amount_received||intent.amount||0)||null
    });
  }
}

async function fulfillSubscription(subscription, forceStatus) {
  const meta = subscription.metadata || {};
  const product = String(meta.product || '').toLowerCase();
  const employerId = meta.employer_id;
  if (!employerId) return;

  const status = normalizedSubscriptionStatus(subscription, forceStatus);

  // Native PaymentSheet creates recurring subscriptions as `incomplete` until
  // the customer finishes the first payment. Never grant paid access early.
  if(status==='incomplete') return;

  if (product === 'additional_slot' || product === 'single_job') {
    await rpc('sync_second_job_slot_subscription', {
      p_employer_id: employerId,
      p_status: status,
      p_expires_at: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
      p_payment_reference: null,
      p_amount_cents: subscriptionUnitAmount(subscription, 15000)
    });
    return;
  }

  if (product === 'team_seat') {
    await rpc('sync_team_seat_subscription', {
      p_employer_id: employerId,
      p_stripe_subscription_id: subscription.id,
      p_status: status,
      p_expires_at: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
      p_payment_reference: null,
      p_amount_cents: subscriptionUnitAmount(subscription, Number(meta.unit_amount_cents || 0))
    });
    return;
  }

  if (product !== 'job_plan') return;

  await upsertPlan({
    employerId,
    plan: meta.plan,
    billing: meta.billing || 'monthly',
    status,
    periodEnd: subscription.current_period_end,
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
    scheduleId: typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id
  });

  const terminal=['canceled','unpaid','incomplete_expired','inactive'].includes(status);
  if (status === 'past_due') {
    await setCandidateAccessLock(employerId, true, 'payment_failed', 'past_due');
  } else if (status === 'active' || status === 'trialing' || terminal) {
    await setCandidateAccessLock(employerId, false, null, status);
  }

  await clearPendingIfApplied(employerId, meta.plan);
}

async function handleInvoicePaymentProblem(invoice, reason) {
  const subscriptionId = typeof invoice?.subscription === 'string'
    ? invoice.subscription
    : invoice?.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`);
  const meta=subscription.metadata||{};
  if (String(meta.product||'').toLowerCase() !== 'job_plan' || !meta.employer_id) return;

  await setCandidateAccessLock(meta.employer_id, true, reason || 'payment_failed', 'past_due');
  await upsertPlan({
    employerId: meta.employer_id,
    plan: meta.plan,
    billing: meta.billing || 'monthly',
    status: 'past_due',
    periodEnd: subscription.current_period_end,
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
    scheduleId: typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id
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
      case 'payment_intent.succeeded':
        await fulfillPaymentIntent(event.data.object);
        break;

      case 'checkout.session.completed':
        if (event.data.object.payment_status === 'paid' || event.data.object.mode === 'subscription') {
          await fulfillCheckout(event.data.object);
        }
        break;

      case 'customer.subscription.updated':
        await fulfillSubscription(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await fulfillSubscription(event.data.object, 'canceled');
        break;

      case 'invoice.paid': {
        const subscriptionId = typeof event.data.object.subscription === 'string'
          ? event.data.object.subscription
          : event.data.object.subscription?.id;
        if (subscriptionId) {
          const subscription = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`);
          await fulfillSubscription(subscription);
        }
        break;
      }

      case 'invoice.payment_failed':
        await handleInvoicePaymentProblem(event.data.object, 'payment_failed');
        break;

      case 'invoice.payment_action_required':
        await handleInvoicePaymentProblem(event.data.object, 'payment_action_required');
        break;

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
