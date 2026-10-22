// /api/send-password-code.js — Alygnn combined password email endpoint.
// One Vercel function; existing password-change email behavior is preserved.
// NEW: { action: 'request_recovery', email } requests a server-issued recovery OTP.
// Legacy: { email, code } remains supported for existing signed-in account settings.
// WARNING: legacy calls are not authenticated; harden that existing flow separately.
import { createHmac } from 'node:crypto';

// --- Existing password-change sender (function logic preserved below) ---
// /api/send-password-code.js
//
// Sends the 6-digit password-change verification code through Resend.

async function legacyPasswordCodeHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const { email, code } = req.body || {};

  if (!email || !code) {
    return res.status(400).json({
      success: false,
      error: 'Missing email or code'
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
        subject: 'Your Alygnn verification code',

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

              <p style="
                margin: 0 0 22px;
                font-size: 15px;
                line-height: 1.6;
                color: #1A2530;
              ">
                Use this code to confirm your password change:
              </p>

              <div style="
                font-size: 32px;
                font-weight: 700;
                letter-spacing: 8px;
                color: #1A2530;
                margin: 0 0 24px;
              ">
                ${code}
              </div>

              <p style="
                margin: 0;
                font-size: 14px;
                line-height: 1.6;
                color: #4A5968;
              ">
                This code expires in 10 minutes. If you didn't request this,
                you can safely ignore this email.
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
    console.error('Send password code error:', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

// --- Server-side six-digit account recovery ---
'use strict';

/*
 * Alygnn password recovery — Vercel Node serverless route.
 *
 * POST /api/send-password-code { action:"request_recovery", email }
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
 *  4. Merge into the EXISTING api/send-password-code.js only.
 */


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

async function recoveryHandler(req, res) {
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

// Keep the SAME Vercel route; do not create request-password-reset.js.
export default async function handler(req, res) {
  // Cross-origin requests to the JSON recovery API require an OPTIONS preflight.
  // Preflight has no JSON body or action and must be routed explicitly.
  if (req.method === 'OPTIONS') return recoveryHandler(req, res);

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (body?.action === 'request_recovery') {
    req.body = body;
    return recoveryHandler(req, res);
  }
  return legacyPasswordCodeHandler(req, res);
}
