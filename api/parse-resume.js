module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { resumeBase64, resumeType, resumeText } = req.body;

    let messageContent;

    if (resumeBase64 && resumeType === 'application/pdf') {
      messageContent = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: resumeBase64,
          },
        },
        {
          type: 'text',
          text: 'You are a resume parser. Extract key information from this resume and return ONLY a valid JSON object with no extra text, no markdown, no code fences.\n\nReturn this exact JSON structure:\n{"name":"full name","email":"email or empty","phone":"phone or empty","location":"city, state or empty","title":"most recent job title","summary":"2 sentence summary","skills":["skill1","skill2","skill3","skill4","skill5"],"experience_years":3,"education":"degree and field","languages":["English"],"job_types":["Full-time"],"industries":["Technology"]}',
        },
      ];
    } else {
      const text = resumeText || 'No resume content provided';
      messageContent = [
        {
          type: 'text',
          text: 'You are a resume parser. Extract key information from this resume text and return ONLY a valid JSON object with no extra text, no markdown, no code fences.\n\nResume:\n' + text + '\n\nReturn this exact JSON structure:\n{"name":"full name","email":"email or empty","phone":"phone or empty","location":"city, state or empty","title":"most recent job title","summary":"2 sentence summary","skills":["skill1","skill2","skill3","skill4","skill5"],"experience_years":3,"education":"degree and field","languages":["English"],"job_types":["Full-time"],"industries":["Technology"]}',
        },
      ];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: messageContent }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Claude API failed', details: data });
    }

    const text = data.content[0].text.trim();
    const clean = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({ success: true, data: parsed });

  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
};
