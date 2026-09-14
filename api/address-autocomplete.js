// Vercel Node Function: /api/address-autocomplete
// Secure Google Places Autocomplete (New) proxy for Alygnn checkout.
//
// Required Vercel environment variables:
//   GOOGLE_PLACES_API_KEY
//   SUPABASE_URL=https://auth.alygnn.com
//   SUPABASE_ANON_KEY
//
// The Google API key stays server-side. The mobile app sends the user's
// Supabase bearer token so this endpoint is not an unauthenticated public proxy.

const PLACES_BASE = 'https://places.googleapis.com/v1';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

function send(res, status, payload) {
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try {
    return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body));
  } catch (_) {
    return {};
  }
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

async function verifySupabaseUser(token) {
  const base = (process.env.SUPABASE_URL || 'https://auth.alygnn.com').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!anon) throw new Error('SUPABASE_ANON_KEY is not configured.');

  const response = await fetch(base + '/auth/v1/user', {
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + token
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error('Invalid Alygnn session.');
  return data;
}

function cleanCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : '';
}

function cleanSessionToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  // Google allows URL/filename-safe strings up to 36 ASCII chars.
  return /^[A-Za-z0-9_-]{1,36}$/.test(token) ? token : '';
}

function component(components, types, short = false) {
  for (const type of types) {
    const found = components.find(item => Array.isArray(item?.types) && item.types.includes(type));
    if (found) {
      return String(short ? (found.shortText || found.longText || '') : (found.longText || found.shortText || '')).trim();
    }
  }
  return '';
}

function addressFromPlace(place) {
  const components = Array.isArray(place?.addressComponents) ? place.addressComponents : [];

  const streetNumber = component(components, ['street_number']);
  const route = component(components, ['route']);
  const premise = component(components, ['premise']);
  const subpremise = component(components, ['subpremise']);

  let line1 = [streetNumber, route].filter(Boolean).join(' ').trim();
  if (!line1) line1 = [premise, subpremise].filter(Boolean).join(' ').trim();

  if (!line1 && place?.formattedAddress) {
    line1 = String(place.formattedAddress).split(',')[0].trim();
  }

  const city = component(components, [
    'locality',
    'postal_town',
    'sublocality_level_1',
    'sublocality',
    'administrative_area_level_2'
  ]);

  const state = component(components, ['administrative_area_level_1'], true);
  const postalCode = component(components, ['postal_code']);
  const country = component(components, ['country'], true).toUpperCase();

  return {
    line1,
    city,
    state,
    postal_code: postalCode,
    country,
    formatted_address: String(place?.formattedAddress || '').trim()
  };
}

async function googleAutocomplete({ input, country, sessionToken, apiKey }) {
  const requestBody = {
    input,
    includeQueryPredictions: false
  };

  if (country) {
    requestBody.includedRegionCodes = [country.toLowerCase()];
    requestBody.regionCode = country.toLowerCase();
  }
  if (sessionToken) requestBody.sessionToken = sessionToken;

  const response = await fetch(PLACES_BASE + '/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'suggestions.placePrediction.placeId',
        'suggestions.placePrediction.text.text',
        'suggestions.placePrediction.structuredFormat.mainText.text',
        'suggestions.placePrediction.structuredFormat.secondaryText.text'
      ].join(',')
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Google Places autocomplete failed.');
  }

  return (Array.isArray(data?.suggestions) ? data.suggestions : [])
    .map(item => item?.placePrediction)
    .filter(item => item?.placeId)
    .slice(0, 6)
    .map(item => ({
      place_id: String(item.placeId),
      text: String(item?.text?.text || ''),
      main_text: String(item?.structuredFormat?.mainText?.text || item?.text?.text || ''),
      secondary_text: String(item?.structuredFormat?.secondaryText?.text || '')
    }));
}

async function googlePlaceDetails({ placeId, sessionToken, apiKey }) {
  const url = new URL(PLACES_BASE + '/places/' + encodeURIComponent(placeId));
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

  const response = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,formattedAddress,addressComponents'
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Google Place Details failed.');
  }
  return data;
}

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method not allowed.' });
  }

  try {
    const token = bearer(req);
    if (!token) return send(res, 401, { error: 'Sign in to Alygnn to search addresses.' });

    await verifySupabaseUser(token);

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not configured.');

    const data = body(req);
    const action = String(data.action || 'suggest').toLowerCase();
    const sessionToken = cleanSessionToken(data.session_token);

    if (action === 'suggest') {
      const input = String(data.input || '').trim().slice(0, 120);
      if (input.length < 3) return send(res, 200, { suggestions: [] });

      const suggestions = await googleAutocomplete({
        input,
        country: cleanCountry(data.country),
        sessionToken,
        apiKey
      });

      return send(res, 200, { suggestions });
    }

    if (action === 'details') {
      const placeId = String(data.place_id || '').trim();
      if (!/^[A-Za-z0-9_-]{3,256}$/.test(placeId)) {
        return send(res, 400, { error: 'Invalid place ID.' });
      }

      const place = await googlePlaceDetails({ placeId, sessionToken, apiKey });
      return send(res, 200, { address: addressFromPlace(place) });
    }

    return send(res, 400, { error: 'Unsupported address action.' });
  } catch (error) {
    console.error('Alygnn address autocomplete:', error);
    return send(res, 500, { error: error?.message || 'Address lookup failed.' });
  }
};
