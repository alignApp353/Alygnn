export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { resumeText } = req.body;

    if (!resumeText) {
      return res.status(400).json({ error: 'No resume text provided' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `You are a resume parser. Extract key information from this resume and return ONLY a valid JSON object with no extra text.

Resume:
${resumeText}

Return this exact JSON structure:
{
  "name": "full name",
  "email": "email address",
  "phone": "phone number",
  "location": "city, state",
  "title": "current or most recent job title",
  "summary": "2 sentence professional summary",
  "skills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
  "experience_years": 3,
  "education": "highest degree and field",
  "languages": ["English"],
  "job_types": ["Full-time"],
  "industries": ["Technology"]
}`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API error:', data);
      return res.status(500).json({ error: 'Failed to parse resume' });
    }

    const text = data.content[0].text.trim();

    // Strip markdown code fences if present
    const clean = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({ success: true, data: parsed });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
