module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { resumeText } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: 'Parse this resume. Return ONLY a JSON object, no markdown, no explanation.\n\nResume:\n' + (resumeText || '') + '\n\nReturn:\n{"name":"","email":"","location":"","title":"","skills":[],"experience_years":0,"education":""}',
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: 'Claude failed', details: data });

    const text = data.content[0].text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(text);
    return res.status(200).json({ success: true, data: parsed });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
