export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { resumeBase64, resumeType, resumeText } = req.body;

    let messageContent;

    if (resumeBase64 && resumeType === 'application/pdf') {
      // Send PDF directly to Claude as a document
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
          text: `You are a resume parser. Extract key information from this resume and return ONLY a valid JSON object with no extra text, no markdown, no code fences.

Return this exact JSON structure:
{
  "name": "full name",
  "email": "email address or empty string",
  "phone": "phone number or empty string",
  "location": "city, state or empty string",
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
      ];
    } else {
      // Fall back to text
      const text = resumeText || 'No resume content provided';
      messageContent = [
        {
          type: 'text',
          text: `You are a resume parser. Extract key information from this resume text and return ONLY a valid JSON object with no extra text, no markdown, no code fences.

Resume text:
${text}

Return this exact JSON structure:
{
  "name": "full name",
  "email": "email address or empty string",
  "phone": "phone number or empty string",
  "location": "city, state or empty string",
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
      console.error('Claude API error:', data);
      return res.status(500).json({ error: 'Failed to parse resume' });
    }

    const text = data.content[0].text.trim();
    const clean = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({ success: true, data: parsed });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}
