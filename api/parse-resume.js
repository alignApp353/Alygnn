module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    let body = req.body || {};

    // Be defensive in case the platform hands us the raw JSON string.
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (_) {
        return res.status(400).json({
          success: false,
          error: 'Invalid JSON request body.',
        });
      }
    }

    const { resumeBase64, resumeType } = body;
    const resumeText = String(body.resumeText || '').trim();

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('Resume parser configuration error: ANTHROPIC_API_KEY is missing.');
      return res.status(500).json({
        success: false,
        error: 'Resume parser is not configured on the server.',
      });
    }

    const hasPdfDocument =
      Boolean(resumeBase64) &&
      resumeType === 'application/pdf';

    if (!hasPdfDocument && !resumeText) {
      return res.status(400).json({
        success: false,
        error: 'No readable resume content was provided.',
      });
    }

    // NOTE: "experience" and "education" are arrays of itemized entries.
    // This matches what Alygnn stores in profiles.resume_data.
    const schemaInstructions =
      'You are a resume parser. Extract key information from this resume and return ONLY a valid JSON object with no extra text, no markdown, no code fences.\n\n' +
      'Return this exact JSON structure:\n' +
      '{"name":"full name","email":"email or empty","phone":"phone or empty","location":"city, state or empty","title":"most recent job title","summary":"2 sentence summary","skills":["skill1","skill2","skill3","skill4","skill5"],' +
      '"experience":[{"title":"job title","company":"company name","startYear":"2022","endYear":"2024 or Present"}],' +
      '"education":[{"degree":"degree name, e.g. B.A. Professional Studies","school":"school name","startYear":"2021 or empty","endYear":"2025 or Present or empty"}],' +
      '"languages":["English"],"job_types":["Full-time"],"industries":["Technology"]}\n\n' +
      'Rules:\n' +
      '- Do not invent information that is not present in the resume.\n' +
      '- "experience" must contain ONE entry per job listed on the resume, in the order they appear. If the resume gives no dates for a job, use empty strings for startYear/endYear rather than guessing.\n' +
      '- "education" must contain ONE entry per degree/program listed. If a graduation date is "Expected" or in the future, put that year in endYear anyway — do not omit it.\n' +
      '- If there is no work experience or no education listed at all, return an empty array ([]) for that field — do not omit the key.\n' +
      '- Use "Present" (not "Current" or "Ongoing") for any job or program that is still in progress.\n' +
      '- Years must be 4-digit strings (e.g. "2022"), never full dates.\n' +
      '- "skills", "languages", "job_types", and "industries" must always be arrays, even when empty.';

    let messageContent;

    if (hasPdfDocument) {
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
          text: schemaInstructions,
        },
      ];
    } else {
      messageContent = [
        {
          type: 'text',
          text:
            schemaInstructions +
            '\n\nResume:\n' +
            resumeText.substring(0, 12000),
        },
      ];
    }

    let response;

    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1536,
          messages: [{ role: 'user', content: messageContent }],
        }),
      });
    } catch (networkError) {
      console.error('Claude API network error:', networkError);
      return res.status(502).json({
        success: false,
        error: 'Resume parsing service could not be reached.',
      });
    }

    const rawResponse = await response.text();

    let data = {};
    try {
      data = rawResponse ? JSON.parse(rawResponse) : {};
    } catch (_) {
      console.error(
        'Claude API returned a non-JSON response:',
        rawResponse.substring(0, 500)
      );

      return res.status(502).json({
        success: false,
        error: 'Resume parsing service returned an invalid response.',
      });
    }

    if (!response.ok) {
      const providerMessage =
        data?.error?.message ||
        data?.message ||
        `Resume parsing service failed with status ${response.status}.`;

      console.error(
        'Claude API error:',
        response.status,
        JSON.stringify(data)
      );

      return res.status(502).json({
        success: false,
        error: providerMessage,
      });
    }

    const textBlock = Array.isArray(data?.content)
      ? data.content.find(
          (item) =>
            item &&
            item.type === 'text' &&
            typeof item.text === 'string'
        )
      : null;

    if (!textBlock?.text) {
      console.error('Claude API response contained no text block:', JSON.stringify(data));
      return res.status(502).json({
        success: false,
        error: 'Resume parsing service returned no resume data.',
      });
    }

    const modelText = textBlock.text.trim();
    const withoutFence = modelText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const firstBrace = withoutFence.indexOf('{');
    const lastBrace = withoutFence.lastIndexOf('}');

    if (firstBrace < 0 || lastBrace <= firstBrace) {
      console.error('Resume parser returned non-JSON text:', modelText.substring(0, 800));
      return res.status(502).json({
        success: false,
        error: 'Resume parser returned an unreadable result.',
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(
        withoutFence.slice(firstBrace, lastBrace + 1)
      );
    } catch (jsonError) {
      console.error(
        'Resume parser JSON parse error:',
        jsonError.message,
        modelText.substring(0, 800)
      );

      return res.status(502).json({
        success: false,
        error: 'Resume parser returned malformed resume data.',
      });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(502).json({
        success: false,
        error: 'Resume parser returned an invalid data shape.',
      });
    }

    // Defensive normalization keeps the client and profiles.resume_data
    // on one predictable shape.
    parsed.name = String(parsed.name || '').trim();
    parsed.email = String(parsed.email || '').trim();
    parsed.phone = String(parsed.phone || '').trim();
    parsed.location = String(parsed.location || '').trim();
    parsed.title = String(parsed.title || '').trim();
    parsed.summary = String(parsed.summary || '').trim();

    if (!Array.isArray(parsed.skills)) parsed.skills = [];
    parsed.skills = parsed.skills
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    if (!Array.isArray(parsed.experience)) {
      parsed.experience = [];
    }

    parsed.experience = parsed.experience
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        title: String(entry.title || '').trim(),
        company: String(entry.company || '').trim(),
        startYear: String(entry.startYear || '').trim(),
        endYear: String(entry.endYear || '').trim(),
      }));

    if (!Array.isArray(parsed.education)) {
      if (typeof parsed.education === 'string' && parsed.education.trim()) {
        parsed.education = [
          {
            degree: parsed.education.trim(),
            school: '',
            startYear: '',
            endYear: '',
          },
        ];
      } else {
        parsed.education = [];
      }
    }

    parsed.education = parsed.education
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        degree: String(entry.degree || '').trim(),
        school: String(entry.school || '').trim(),
        startYear: String(entry.startYear || '').trim(),
        endYear: String(entry.endYear || '').trim(),
      }));

    for (const key of ['languages', 'job_types', 'industries']) {
      if (!Array.isArray(parsed[key])) parsed[key] = [];
      parsed[key] = parsed[key]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    }

    return res.status(200).json({
      success: true,
      data: parsed,
    });
  } catch (error) {
    console.error('Resume parser server error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error while parsing the resume.',
    });
  }
};
