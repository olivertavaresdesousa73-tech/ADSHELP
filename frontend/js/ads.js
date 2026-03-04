// netlify/functions/ads.js — proxy seguro para Meta Graph API
const https = require('https');

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const q     = event.queryStringParameters || {};
  const token = ((event.headers['authorization'] || '').replace('Bearer ', '') || q.token || process.env.META_ACCESS_TOKEN || '').trim();

  if (!token) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Token não configurado. Defina META_ACCESS_TOKEN nas variáveis do Netlify.' }) };
  if (!q.search_terms) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'search_terms obrigatório' }) };

  const params = new URLSearchParams({
    search_terms:         q.search_terms,
    ad_type:              q.ad_type || 'ALL',
    ad_reached_countries: JSON.stringify([q.country || 'BR']),
    fields:               'id,page_name,page_id,ad_creative_bodies,ad_snapshot_url,ad_delivery_start_time,ad_delivery_stop_time',
    limit:                q.limit  || '24',
    access_token:         token
  });
  if (q.after) params.set('after', q.after);

  return new Promise((resolve) => {
    const req = https.get('https://graph.facebook.com/v19.0/ads_archive?' + params, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) resolve({ statusCode: 400, headers: cors, body: JSON.stringify({ error: data.error.message, code: data.error.code }) });
          else resolve({ statusCode: 200, headers: cors, body: JSON.stringify(data) });
        } catch(e) { resolve({ statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Resposta inválida da Meta API' }) }); }
      });
    });
    req.on('error', (e) => resolve({ statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ statusCode: 504, headers: cors, body: JSON.stringify({ error: 'Timeout na Meta API' }) }); });
  });
};
