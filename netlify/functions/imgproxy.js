// netlify/functions/imgproxy.js
// Baixa imagem/video do CDN da Meta (fbcdn.net) no servidor
// e serve com CORS aberto pro browser.
// Sem isso o <img src="fbcdn.net/..."> e bloqueado por CORS/hotlink.
//
// Chamada: /.netlify/functions/imgproxy?url=<url_encodada>

const https = require('https');
const http  = require('http');

// Cache em memoria: url -> { buf, ct, ts }
const cache = {};
const TTL   = 30 * 60 * 1000; // 30 min

// Dominios permitidos (so Meta)
function isAllowed(url) {
  try {
    const h = new URL(url).hostname;
    return h.endsWith('fbcdn.net')
        || h.endsWith('facebook.com')
        || h.endsWith('cdninstagram.com');
  } catch(e) { return false; }
}

function fetchBinary(url, hops) {
  hops = hops === undefined ? 5 : hops;
  return new Promise(function(resolve, reject) {
    if (hops < 0) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Referer':    'https://www.facebook.com/',
        'Accept':     'image/webp,image/apng,image/*,video/mp4,*/*;q=0.8',
      }
    }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let next = res.headers.location;
        if (next.startsWith('/')) {
          try { const u = new URL(url); next = u.protocol + '//' + u.host + next; } catch(e) {}
        }
        res.resume();
        return fetchBinary(next, hops - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const ct = res.headers['content-type'] || 'image/jpeg';
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve({ buf: Buffer.concat(chunks), ct }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

exports.handler = async function(event) {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const raw = (event.queryStringParameters || {}).url;
  if (!raw) return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'url param required' }) };

  const url = decodeURIComponent(raw);
  if (!isAllowed(url)) return { statusCode: 403, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'domain not allowed' }) };

  // Cache hit
  const now = Date.now();
  if (cache[url] && now - cache[url].ts < TTL) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': cache[url].ct, 'Cache-Control': 'public,max-age=3600' },
      body: cache[url].buf.toString('base64'),
      isBase64Encoded: true,
    };
  }

  try {
    const { buf, ct } = await fetchBinary(url);
    // Netlify Function tem limite de 6MB na resposta
    if (buf.length > 5.5 * 1024 * 1024) return { statusCode: 413, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'file too large' }) };
    cache[url] = { buf, ct, ts: now };
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': ct, 'Cache-Control': 'public,max-age=3600' },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch(err) {
    return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
