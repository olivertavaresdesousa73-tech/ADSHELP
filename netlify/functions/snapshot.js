// netlify/functions/snapshot.js
// Acessa ad_snapshot_url da Meta no servidor, extrai og:image / og:video
// e retorna as URLs para o frontend exibir via /imgproxy.

const https = require('https');
const http  = require('http');

const cache = {};
const TTL   = 60 * 60 * 1000; // 1h

function fetchHtml(url, hops) {
  hops = hops === undefined ? 5 : hops;
  return new Promise(function(resolve, reject) {
    if (hops < 0) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'identity',
        'Cache-Control':   'no-cache',
      }
    }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let next = res.headers.location;
        if (next.startsWith('/')) {
          try { const u = new URL(url); next = u.protocol + '//' + u.host + next; } catch(e) {}
        }
        res.resume();
        return fetchHtml(next, hops - 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function first(html, patterns) {
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(html);
    if (m && m[1]) return m[1];
  }
  return null;
}

function extractMedia(html) {
  const imageUrl = first(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<img[^>]+src=["'](https:\/\/[^"']*fbcdn\.net[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
  ]);

  const videoUrl = first(html, [
    /<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::url|:secure_url)?["']/i,
    /["'](https:\/\/[^"']*fbcdn\.net[^"']*\.mp4[^"']*?)["']/i,
  ]);

  return {
    imageUrl: imageUrl || null,
    videoUrl: videoUrl ? videoUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/') : null,
  };
}

exports.handler = async function(event) {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const q   = event.queryStringParameters || {};
  const url = q.url ? decodeURIComponent(q.url) : null;
  const id  = q.id  || url;

  if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'url param required' }) };

  const now = Date.now();
  if (cache[id] && now - cache[id].ts < TTL) {
    const hit = Object.assign({}, cache[id], { cached: true });
    return { statusCode: 200, headers: cors, body: JSON.stringify(hit) };
  }

  try {
    const html  = await fetchHtml(url);
    const media = extractMedia(html);
    const data  = Object.assign({}, media, { found: !!(media.imageUrl || media.videoUrl), cached: false, ts: now });
    cache[id] = data;
    return { statusCode: 200, headers: cors, body: JSON.stringify(data) };
  } catch(err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message, imageUrl: null, videoUrl: null, found: false }) };
  }
};
