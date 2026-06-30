// /api/send-password-code.js
//
// Sends a 6-digit verification code by email. The code itself is
// generated and stored by the client (account-settings.html), this
// route's only job is delivering it via Resend.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { email, code } = req.body || {};

  if (!email || !code) {
    return res.status(400).json({ success: false, error: 'Missing email or code' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Alygnn <admin@alygnn.com>',
        to: email,
        subject: 'Your Alygnn verification code',
        html: `
          <div style="font-family: sans-serif; color: #1A2530; max-width: 480px; margin: 0 auto;">
            <h2 style="font-family: serif; color: #5D7FA3;">Alygnn</h2>
            <p>Use this code to confirm your password change:</p>
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 20px 0;">${code}</p>
            <p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Resend error:', errText);
      return res.status(500).json({ success: false, error: 'Failed to send email' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Send password code error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
