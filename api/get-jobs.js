export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, location, employment_type } = req.body;

  const searchQuery = [query || 'software engineer', location || ''].filter(Boolean).join(' in ');

  const params = new URLSearchParams({
    query: searchQuery,
    num_pages: '1',
    date_posted: 'month',
  });

  if (employment_type) params.append('employment_types', employment_type);

  try {
    const response = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'jsearch.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      },
    });

    const data = await response.json();

    if (!data.data) return res.status(500).json({ success: false, error: 'No results' });

    const jobs = data.data.slice(0, 15).map(job => ({
      id: job.job_id,
      title: job.job_title,
      company: job.employer_name,
      logo: job.employer_logo || null,
      location: job.job_city
        ? `${job.job_city}, ${job.job_state || job.job_country}`
        : job.job_country || 'Remote',
      remote: job.job_is_remote,
      type: job.job_employment_type,
      salary_min: job.job_min_salary,
      salary_max: job.job_max_salary,
      salary_period: job.job_salary_period,
      description: job.job_description?.substring(0, 300) + '...',
      highlights: job.job_highlights?.Qualifications?.slice(0, 3) || [],
      benefits: job.job_highlights?.Benefits?.slice(0, 3) || [],
      posted: job.job_posted_at_datetime_utc,
      apply_url: job.job_apply_link,
    }));

    res.status(200).json({ success: true, jobs });
  } catch (err) {
    console.error('JSearch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
