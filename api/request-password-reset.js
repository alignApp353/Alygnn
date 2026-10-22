'use strict';

/*
 * Alygnn password recovery — Vercel Node serverless route.
 *
 * POST /api/request-password-reset { email }
 *
 * Checks Supabase Auth **on the server** (using admin.generate_link with
 * type=recovery, which does NOT create a user and does NOT send mail).
 * Sends via Resend:
 *  - Active account: six-digit OTP (valid for Supabase verifyOtp(recovery)).
 *  - Missing/deleted account: private email explaining no active account.
 *
 * Never returns email-existence status to a public client.
 * NO secret is ever sent to the browser.
 *
 * Before deployment:
 *  1. Apply supabase/RESET-RATE-LIMIT.sql once.
 *  2. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 *     and PASSWORD_RESET_RATE_LIMIT_SECRET in Vercel Production env.
 *  3. Verify admin@alygnn.com is an approved Resend sender.
 *  4. Deploy this file as api/request-password-reset.js.
 */
const { createHmac } = require('node:crypto');

const ORIGINS = new Set([
  'https://alygnn.com',
  'https://www.alygnn.com',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost'
]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const successfulMessage =
  'If the address can receive mail, you will get recovery instructions. ' +
  'Active accounts receive a six-digit code; other addresses receive account-help instructions.';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(JSON.stringify(payload));
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  let result = {};
  try { result = await response.json(); } catch (_) { /* only inspect status */ }
  return { status: response.status, ok: response.ok, result };
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
}
async function holdSince(started, minMs=900) {
  const elapsed = Date.now() - started;
  if (elapsed < minMs) await new Promise(resolve => setTimeout(resolve, minMs-elapsed));
}

module.exports = async function handler(req, res) {
  const started = Date.now();
  const origin = String(req.headers.origin || '');
  res.setHeader('Vary', 'Origin');
  if (ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'Request not allowed' });

  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const rateSecret = process.env.PASSWORD_RESET_RATE_LIMIT_SECRET;
  if (!url.startsWith('https://') || !serviceKey || !resendKey || !rateSecret || rateSecret.length < 24)
    return send(res, 503, { error: 'Account recovery is temporarily unavailable.' });

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch (_) {}
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email))
    return send(res, 400, { error: 'Enter a valid email address.' });

  const authHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  try {
    // Database-backed atomic per-email AND per-IP limits; shared across all Vercel instances.
    // A missing SQL function FAILS CLOSED: no unprotected recovery endpoint.
    const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown')
      .split(',')[0].trim().slice(0,100);
    for (const [label, value, allowed] of [['email',email,3], ['ip',ip,20]]) {
      const quota = await postJson(
        `${url}/rest/v1/rpc/alygnn_password_reset_consume_limit`, authHeaders,
        { p_bucket: hmac(rateSecret, `${label}:${value}`), p_max_attempts: allowed }
      );
      if (!quota.ok || typeof quota.result !== 'boolean')
        return send(res, 503, { error: 'Account recovery is temporarily unavailable.' });
      if (!quota.result)
        return send(res, 429, { error: 'Too many requests. Please try again later.' });
    }

    // This admin operation looks up a user and issues a recovery OTP WITHOUT
    // creating an account or sending email. Its result is never exposed.
    const link = await postJson(
      `${url}/auth/v1/admin/generate_link`, authHeaders,
      { type: 'recovery', email }
    );

    const notFound = link.status === 404 && 
      (link.result?.code === 'user_not_found' ||
       /user.*(not found|does not exist)/i.test(String(link.result?.msg || link.result?.message || '')));

    let subject, plain, html;
    if (notFound) {
      subject = 'Alygnn account recovery — next steps';
      plain = 'We received a recovery request for this email, but there is no active Alygnn account associated with it. ' +
              'The account may have been deleted, or another email may have been used. ' +
              'You can create a new account at https://alygnn.com or contact contact@alygnn.com if you need help. ' +
              'If you did not make this request, you can ignore this message.';
      html = `<h2>Alygnn account recovery</h2>
<p>We received a recovery request for this email, but <strong>no active Alygnn account</strong>
is associated with it. It may have been deleted, or a different email may have been used.</p>
<p><a href="https://alygnn.com">Create an Alygnn account</a> or
<a href="mailto:contact@alygnn.com">contact support</a>.</p>
<p>If you did not request this, you can ignore this message.</p>`;
    } else if (link.ok) {
      const code = String(link.result?.email_otp || '');
      if (!/^\d{6}$/.test(code)) {
        // Fail if Supabase's OTP length differs from the app's six-digit form.
        return send(res, 503, { error: 'Account recovery is temporarily unavailable.' });
      }
      subject = 'Your Alygnn six-digit password reset code';
      plain = `Your Alygnn password reset code is ${code}.\n\n` +
              'Enter it in the Alygnn app to set a new password. Never share this code. ' +
              'If you did not make this request, ignore this email.';
      html = `<h2>Alygnn password reset</h2>
<p>Enter this six-digit code in the Alygnn app:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:7px">${escapeHtml(code)}</p>
<p>Do not share this code. If you did not request it, ignore this email.</p>`;
    } else {
      // Don't mistake a provider/admin error for a nonexistent user.
      console.error('Alygnn recovery Supabase error', link.status, link.result?.code || 'unknown');
      return send(res, 503, { error: 'Account recovery is temporarily unavailable.' });
    }

    const mail = await postJson('https://api.resend.com/emails', {
      Authorization: `Bearer ${resendKey}`,
    }, {
      from: 'Alygnn <admin@alygnn.com>',
      to: [email],
      subject, text: plain, html,
      reply_to: 'contact@alygnn.com'
    });
    if (!mail.ok) {
      console.error('Alygnn recovery mail-provider error', mail.status);
      return send(res, 503, { error: 'We could not request the recovery email. Please try again later.' });
    }

    await holdSince(started);
    return send(res, 200, { ok: true, message: successfulMessage });
  } catch (err) {
    console.error('Alygnn recovery service error', String(err?.name || 'unknown'));
    return send(res, 503, { error: 'Account recovery is temporarily unavailable.' });
  }
};
