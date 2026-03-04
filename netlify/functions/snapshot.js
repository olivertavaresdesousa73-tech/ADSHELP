// netlify/functions/snapshot.js
// Busca o HTML do snapshot da Meta e extrai a URL real da imagem/vídeo
// Isso contorna o X-Frame-Options bloqueando iframes diretos

const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      }
    };
    let raw = '';
    const req = https.get(url, options, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      res.on('data', d => raw += d);
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const snapshotUrl = (event.queryStringParameters || {}).url;
  if (!snapshotUrl) return { statusCode: 400, headers, body: JSON.stringify({ error: 'url param required' }) };

  try {
    const result = await fetchUrl(decodeURIComponent(snapshotUrl));
    const html   = result.body;

    // Extrai imagens do og:image ou primeira img src do snapshot
    const ogImg   = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1];
    const firstImg = (html.match(/<img[^>]+src=["']([^"']+fbcdn[^"']+)["']/i) || [])[1];

    // Extrai título / copy do anúncio do HTML do snapshot
    const title    = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    const bodyText = (html.match(/class="[^"]*body[^"]*"[^>]*>([^<]{10,})<\//) || [])[1] || '';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        imageUrl: ogImg || firstImg || null,
        title: title.replace(/\s+/g,' ').trim(),
        bodyText: bodyText.replace(/\s+/g,' ').trim(),
        found: !!(ogImg || firstImg)
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, imageUrl: null }) };
  }
};
