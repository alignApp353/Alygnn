// /api/notify-password-change.js
//
// Sends a "your password was changed" confirmation email via Resend.
// Called from account-settings.html right after a successful password
// update, so the person has proof in their inbox that the change was
// intentional (and a heads-up if it wasn't them).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ success: false, error: 'Missing email' });
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
        subject: 'Your Alygnn password was changed',
        html: `
          <div style="font-family: sans-serif; color: #1A2530; max-width: 480px; margin: 0 auto;">
            <h2 style="font-family: serif; color: #5D7FA3;">Alygnn</h2>
            <p>Your password was just changed on your Alygnn account (${email}).</p>
            <p>If this was you, no action is needed.</p>
            <p>If you didn't make this change, please reset your password immediately and contact support.</p>
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
    console.error('Notify password change error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
