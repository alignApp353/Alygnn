module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { resumeBase64, resumeType, resumeText } = req.body;

    // Build message - use text only (most reliable)
    const text = resumeText || 'Extract basic info: name unknown, title unknown, skills unknown';
    
    const prompt = `Parse this resume and return ONLY raw JSON (no markdown, no code fences, no explanation).

Resume content:
${text.substring(0, 4000)}

JSON format:
{"name":"string","email":"string","phone":"string","location":"string","title":"string","summary":"string","skills":["string"],"experience_years":0,"education":"string","languages":["string"],"job_types":["string"],"industries":["string"]}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    console.log('Claude status:', claudeRes.status);
    console.log('Claude response:', JSON.stringify(claudeData).substring(0, 500));

    if (!claudeRes.ok) {
      return res.status(500).json({ error: 'Claude failed', details: claudeData });
    }

    let responseText = claudeData.content[0].text.trim();
    // Strip any markdown fences
    responseText = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    
    const parsed = JSON.parse(responseText);
    return res.status(200).json({ success: true, data: parsed });

  } catch (error) {
    console.error('Handler error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
