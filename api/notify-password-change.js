import { createHash, createSign, timingSafeEqual } from 'node:crypto';

// /api/notify-password-change.js
// Also receives secret-authenticated server-side push events (same existing API route).
//
// Sends the confirmation email after a user's password
// has successfully been changed.

const ALLOWED_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'https://alygnn.com',
  'https://www.alygnn.com'
]);

function applyCors(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
}

export default async function handler(req, res) {
  // Supabase webhooks use a private header and never enter the existing email flow.
  if (req.headers?.['x-alygnn-webhook-secret'] !== undefined) {
    return handlePushWebhook(req, res);
  }

  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Missing email'
    });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',

      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        from: 'Alygnn <admin@alygnn.com>',
        reply_to: 'noreply@alygnn.com',
        to: email,
        subject: 'Your Alygnn password was changed',

        html: `
          <div style="
            margin: 0;
            padding: 32px 20px;
            background: #F6F8F7;
            font-family: Arial, sans-serif;
            color: #1A2530;
          ">

            <div style="
              max-width: 520px;
              margin: 0 auto;
              background: #ffffff;
              border: 1px solid #DDE3E8;
              border-radius: 18px;
              padding: 32px;
            ">

              <h2 style="
                margin: 0 0 16px;
                font-size: 24px;
                line-height: 1.3;
                color: #1A2530;
              ">
                Your password was changed
              </h2>

              <p style="
                margin: 0 0 16px;
                font-size: 14px;
                line-height: 1.6;
                color: #4A5968;
              ">
                Your password was just changed on your Alygnn account
                (${email}).
              </p>

              <p style="
                margin: 0 0 16px;
                font-size: 14px;
                line-height: 1.6;
                color: #4A5968;
              ">
                If this was you, no action is needed.
              </p>

              <p style="
                margin: 0;
                font-size: 14px;
                line-height: 1.6;
                color: #4A5968;
              ">
                If you didn't make this change, reset your password immediately
                and contact the Alygnn team at

                <a
                  href="mailto:contact@alygnn.com"
                  style="color: #5D7FA3;"
                >
                  contact@alygnn.com
                </a>.
              </p>

              <div style="
                border-top: 1px solid #DDE3E8;
                margin-top: 28px;
                padding-top: 18px;
              ">

                <p style="
                  margin: 0 0 10px;
                  font-size: 12px;
                  line-height: 1.6;
                  color: #9BA8B3;
                ">
                  This is an automated security email from the Alygnn team.
                  Replies to this message are not monitored.
                </p>

                <p style="
                  margin: 0;
                  font-size: 12px;
                  line-height: 1.7;
                  color: #9BA8B3;
                ">
                  © 2026 Alygnn. All Rights Reserved.
                  <br>

                  <a
                    href="https://alygnn.com/terms.html"
                    style="color: #5D7FA3; text-decoration: none;"
                  >
                    Terms of Service
                  </a>

                  &nbsp;|&nbsp;

                  <a
                    href="https://alygnn.com/privacy.html"
                    style="color: #5D7FA3; text-decoration: none;"
                  >
                    Privacy Policy
                  </a>

                  &nbsp;|&nbsp;

                  <a
                    href="mailto:contact@alygnn.com"
                    style="color: #5D7FA3; text-decoration: none;"
                  >
                    Contact Us
                  </a>
                </p>

              </div>

            </div>

          </div>
        `
      })
    });

    if (!response.ok) {
      const errText = await response.text();

      console.error('Resend error:', errText);

      return res.status(500).json({
        success: false,
        error: 'Failed to send email'
      });
    }

    return res.status(200).json({
      success: true
    });

  } catch (err) {
    console.error('Password change notification error:', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}


/*
 * Secret-authenticated Firebase dispatcher for Supabase Database Webhooks.
 * Served by the EXISTING /api/notify-password-change endpoint.
 * Website callers without the webhook header still use the original email function.
 */
const CHANNEL_ID = 'alygnn_updates';
const MAX_DEVICES_PER_USER = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let googleAccessToken = '';
let googleTokenExpiresAt = 0;

function validId(value) { return typeof value === 'string' && UUID.test(value); }
function safeId(value) { return validId(value) ? value : ''; }
function statusValue(row) { return String(row?.employer_pipeline_status || row?.status || '').trim().toLowerCase(); }
function safeMatch(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function settings() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALYGNN_PUSH_WEBHOOK_SECRET, FIREBASE_SERVICE_ACCOUNT_JSON } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ALYGNN_PUSH_WEBHOOK_SECRET || !FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Push delivery environment variables are missing');
  }
  const base = SUPABASE_URL.replace(/\/+$/, '');
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:') throw new Error('SUPABASE_URL must be HTTPS');
  let firebase;
  try { firebase = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON); } catch (_) { throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON'); }
  if (!firebase.client_email || !firebase.private_key || !firebase.project_id) throw new Error('Incomplete Firebase service account');
  if (firebase.project_id !== 'alygnn-500603') throw new Error('Firebase project does not match the Alygnn Android app');
  return { base, key: SUPABASE_SERVICE_ROLE_KEY, secret: ALYGNN_PUSH_WEBHOOK_SECRET, firebase };
}
function base64url(value) { return Buffer.from(value).toString('base64url'); }
async function googleToken(firebase) {
  if (googleAccessToken && Date.now() < googleTokenExpiresAt - 120000) return googleAccessToken;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: firebase.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3500
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(firebase.private_key).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${signature}` })
  });
  if (!response.ok) throw new Error(`Firebase OAuth failed (${response.status})`);
  const result = await response.json();
  if (!result.access_token) throw new Error('Firebase OAuth did not return an access token');
  googleAccessToken = result.access_token;
  googleTokenExpiresAt = Date.now() + Math.min(Number(result.expires_in) || 3600, 3600) * 1000;
  return googleAccessToken;
}
async function supabase(settings, table, method, query, body, extraHeaders = {}) {
  const uri = new URL(`/rest/v1/${table}`, settings.base);
  Object.entries(query || {}).forEach(([k, v]) => uri.searchParams.set(k, v));
  const resp = await fetch(uri, {
    method,
    headers: {
      apikey: settings.key,
      Authorization: `Bearer ${settings.key}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!resp.ok) {
    // Do not log payloads or access keys, even on errors.
    throw new Error(`Supabase ${table} request failed (${resp.status})`);
  }
  if (resp.status === 204) return null;
  const raw = await resp.text();
  return raw ? JSON.parse(raw) : null;
}
async function getOne(settings, table, id) {
  if (!safeId(id)) return null;
  const rows = await supabase(settings, table, 'GET', { id: `eq.${id}`, select: '*', limit: '1' });
  return rows?.[0] || null;
}
function owners(job, conversation) {
  return [...new Set([
    conversation?.employer_id,
    conversation?.employer_user_id,
    job?.employer_id,
    job?.created_by,
    job?.user_id,
    job?.owner_id
  ].map(safeId).filter(Boolean))].slice(0, 5);
}
async function getJobOwners(settings, application, conversation) {
  const job = await getOne(settings, 'jobs', application?.job_id || conversation?.job_id);
  return owners(job, conversation);
}
async function resolveEvent(settings, event) {
  if (event?.type === 'UPDATE' && event.schema === 'auth' && event.table === 'users') {
    const userId = safeId(event.record?.id);
    if (!userId) return null;
    // IMPORTANT: the auth trigger sends *only* {id}. Never send password hashes.
    return { key: `security:password:${userId}:${safeId(event.record?.change_id) || 'event'}`,
      recipients: [userId], title: 'Alygnn security alert',
      body: 'Your Alygnn password was changed.', data: { kind: 'security' } };
  }
  if (event?.schema !== 'public') return null;
  if (event.table === 'application_messages' && event.type === 'INSERT') {
    const id = safeId(event.record?.id);
    const message = await getOne(settings, 'application_messages', id);
    if (!message || safeId(message.conversation_id) !== safeId(event.record?.conversation_id)) return null;
    const conversation = await getOne(settings, 'application_conversations', message.conversation_id);
    if (!conversation) return null;
    const application = await getOne(settings, 'applications', conversation.application_id);
    if (!application) return null;
    const candidateId = safeId(application.candidate_id || conversation.candidate_id);
    if (!candidateId) return null;
    const ownerIds = await getJobOwners(settings, application, conversation);
    const senderId = safeId(message.sender_id);
    if (!senderId) return null;
    const fromCandidate = senderId === candidateId;
    const recipients = fromCandidate ? ownerIds.filter(x => x !== senderId) : [candidateId];
    if (!fromCandidate && !ownerIds.length) return null;
    if (!fromCandidate && ownerIds.length && !ownerIds.includes(senderId)) {
      // An authorized employer team seat may send through RLS; still deliver to the candidate.
      // Database identity is authoritative; no user-supplied recipient is accepted.
    }
    return { key: `message:${id}`, recipients, title: 'New Alygnn message',
      body: 'You have a new message.',
      data: { kind: 'message', role: fromCandidate ? 'employer' : 'candidate',
        conversation: conversation.id, ...(safeId(application.id) ? { application: application.id } : {}) } };
  }
  if (event.table === 'applications' && (event.type === 'INSERT' || event.type === 'UPDATE')) {
    const id = safeId(event.record?.id);
    const application = await getOne(settings, 'applications', id);
    if (!application) return null;
    if (event.type === 'INSERT') {
      const recipients = await getJobOwners(settings, application);
      return { key: `application:new:${id}`, recipients, title: 'New Alygnn applicant',
        body: 'Someone applied to one of your jobs.', data: { kind: 'applicant', role: 'employer' } };
    }
    const status = statusValue(application);
    const oldStatus = statusValue(event.old_record);
    const newStatusFromEvent = statusValue(event.record);
    if (!['shortlisted', 'hired', 'rejected'].includes(status) || status === oldStatus || status !== newStatusFromEvent) return null;
    const candidateId = safeId(application.candidate_id);
    if (!candidateId) return null;
    const copy = {
      shortlisted: ['You were shortlisted', 'An employer shortlisted your application.'],
      hired: ['Application update', 'An employer marked your application as hired.'],
      rejected: ['Application update', 'An employer marked your application as not selected.']
    }[status];
    // Updated-at differentiates multiple changes to the same status if that column exists.
    const revision = String(application.updated_at || application.modified_at || status).slice(0, 50);
    return { key: `application:${id}:${status}:${revision}`, recipients: [candidateId],
      title: copy[0], body: copy[1], data: { kind: 'application', role: 'candidate' } };
  }
  return null;
}
async function tokenRows(settings, userId) {
  const rows = await supabase(settings, 'push_device_tokens', 'GET', {
    user_id: `eq.${userId}`, platform: 'eq.android', enabled: 'eq.true', select: 'token', limit: String(MAX_DEVICES_PER_USER)
  });
  return rows || [];
}
async function claim(settings, key, token) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await supabase(settings, 'push_delivery_receipts', 'POST', {
    on_conflict: 'event_key,token_hash', select: 'event_key'
  }, { event_key: key, token_hash: tokenHash }, { Prefer: 'resolution=ignore-duplicates,return=representation' });
  return { newlyClaimed: Array.isArray(result) && result.length === 1, tokenHash };
}
async function release(settings, key, tokenHash) {
  await supabase(settings, 'push_delivery_receipts', 'DELETE', {
    event_key: `eq.${key}`, token_hash: `eq.${tokenHash}`
  }, undefined, { Prefer: 'return=minimal' });
}
async function disableDeadToken(settings, token) {
  await supabase(settings, 'push_device_tokens', 'PATCH', { token: `eq.${token}` }, { enabled: false }, { Prefer: 'return=minimal' });
}
async function sendFCM(settings, token, info) {
  const bearer = await googleToken(settings.firebase);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(settings.firebase.project_id)}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      token,
      notification: { title: info.title, body: info.body },
      data: info.data,
      android: { priority: 'HIGH', notification: { channel_id: CHANNEL_ID, sound: 'default', visibility: 'PRIVATE' } }
    } })
  });
  if (response.ok) return 'sent';
  let code = '';
  try {
    const json = await response.json();
    code = json?.error?.details?.find(x => x?.errorCode)?.errorCode || json?.error?.status || '';
  } catch (_) {}
  if (code === 'UNREGISTERED') return 'dead';
  throw new Error(`FCM send failed (${response.status}, ${String(code).slice(0, 35)})`);
}
async function deliver(settings, eventInfo) {
  let sent = 0, alreadyDelivered = 0, disabled = 0, failed = 0;
  const tokens = new Map();
  for (const userId of [...new Set(eventInfo.recipients.filter(validId))].slice(0, 6)) {
    for (const row of await tokenRows(settings, userId)) if (typeof row?.token === 'string' && row.token.length > 10) tokens.set(row.token, true);
  }
  for (const token of tokens.keys()) {
    const { newlyClaimed, tokenHash } = await claim(settings, eventInfo.key, token);
    if (!newlyClaimed) { alreadyDelivered++; continue; }
    try {
      const result = await sendFCM(settings, token, eventInfo);
      if (result === 'dead') { await disableDeadToken(settings, token); disabled++; }
      else sent++;
    } catch (error) {
      failed++;
      // Permit a genuine resend if a delivery failed. This is best-effort,
      // not a guarantee that Supabase webhooks will retry automatically.
      try { await release(settings, eventInfo.key, tokenHash); } catch (_) {}
      console.error('Alygnn push delivery error:', error.message);
    }
  }
  return { sent, alreadyDelivered, disabled, failed, devices: tokens.size };
}
async function handlePushWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.ALYGNN_PUSH_WEBHOOK_SECRET || '';
  const provided = req.headers['x-alygnn-webhook-secret'];
  if (typeof provided !== 'string' || !safeMatch(expected, provided)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const cfg = settings();
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!event || typeof event !== 'object' || Array.isArray(event)) return res.status(400).json({ error: 'Invalid event' });
    const supported = (event.schema === 'public' &&
        (event.type === 'INSERT' && ['application_messages', 'applications'].includes(event.table) ||
         event.type === 'UPDATE' && event.table === 'applications')) ||
      (event.schema === 'auth' && event.table === 'users' && event.type === 'UPDATE');
    if (!supported) return res.status(200).json({ skipped: true, reason: 'Unrelated event' });
    const info = await resolveEvent(cfg, event);
    if (!info || !info.recipients.length) return res.status(200).json({ skipped: true, reason: 'No matching notification' });
    const result = await deliver(cfg, info);
    return res.status(result.failed ? 502 : 200).json(result);
  } catch (error) {
    console.error('Alygnn push webhook failed:', error.message);
    return res.status(500).json({ error: 'Push delivery failed; check server logs' });
  }
}
