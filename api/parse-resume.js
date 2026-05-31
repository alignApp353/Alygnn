const formidable = require('formidable');
const pdfParse = require('pdf-parse');
const fs = require('fs');
 
export const config = {
  api: { bodyParser: false },
};
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const file = files.resume?.[0];
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
 
    const buffer = fs.readFileSync(file.filepath);
    const pdf = await pdfParse(buffer);
    const text = pdf.text.substring(0, 4000);
 
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
          content: 'Parse this resume. Return ONLY a JSON object, no markdown, no explanation.\n\nResume:\n' + text + '\n\nJSON format:\n{"name":"","email":"","location":"","title":"","skills":[],"experience_years":0,"education":""}',
        }],
      }),
    });
 
    const data = await response.json();
    console.log('Claude status:', response.status);
    console.log('Claude response:', JSON.stringify(data).substring(0, 300));
 
    if (!response.ok) return res.status(500).json({ error: 'Claude failed', details: data });
 
    const responseText = data.content[0].text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(responseText);
    return res.status(200).json({ success: true, data: parsed });
 
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
 
