// netlify/functions/snapshot.js
// Acessa ad_snapshot_url da Meta no servidor, extrai og:image / og:video
// e retorna as URLs para o frontend exibir via /imgproxy.
//
// CORREÇÃO: Adicionado suporte a gzip/deflate, mais padrões de extração,
// decodificação de unicode escapes e fallback robusto para evitar spinner infinito.

const https  = require('https');
const http   = require('http');
const zlib   = require('zlib');

const cache = {};
const TTL   = 60 * 60 * 1000; // 1h

function fetchHtml(url, hops) {
  hops = hops === undefined ? 5 : hops;
  return new Promise(function(resolve, reject) {
    if (hops < 0) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent':      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'gzip, deflate, identity',
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

      const encoding = res.headers['content-encoding'] || '';
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (encoding === 'gzip') {
          zlib.gunzip(buf, (err, decoded) => {
            if (err) resolve(buf.toString('utf8'));
            else resolve(decoded.toString('utf8'));
          });
        } else if (encoding === 'deflate') {
          zlib.inflate(buf, (err, decoded) => {
            if (err) resolve(buf.toString('utf8'));
            else resolve(decoded.toString('utf8'));
          });
        } else {
          resolve(buf.toString('utf8'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
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

// Decodifica unicode escapes (\u0026 -> &) e barras escapadas (\/ -> /)
function decodeEscapes(str) {
  if (!str) return str;
  return str
    .replace(/\\u0026/g, '&')
    .replace(/\\u003C/gi, '<')
    .replace(/\\u003E/gi, '>')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

function extractMedia(html) {
  // Tenta extrair de og:image com múltiplos padrões
  const imageUrl = first(html, [
    // og:image padrão
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    // og:image com entidades HTML
    /<meta\s+property="og:image"\s+content="([^"]+)"/i,
    /<meta\s+content="([^"]+)"\s+property="og:image"/i,
    // JSON-LD / inline data — URLs fbcdn em strings JSON
    /"(https:\/\/[^"]*fbcdn\.net[^"]*\.(?:jpg|jpeg|png|webp)[^"?]*\?[^"]+)"/i,
    // img tag direto com fbcdn
    /<img[^>]+src=["'](https:\/\/[^"']*fbcdn\.net[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
    // scontent (outro domínio de CDN da Meta)
    /"(https:\/\/scontent[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
  ]);

  // Tenta extrair de og:video
  const videoUrl = first(html, [
    /<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::url|:secure_url)?["']/i,
    /<meta\s+property="og:video(?::url|:secure_url)?"\s+content="([^"]+)"/i,
    // .mp4 em CDN da Meta
    /"(https:\/\/[^"]*fbcdn\.net[^"]*\.mp4[^"]*)"/i,
    /'(https:\/\/[^']*fbcdn\.net[^']*\.mp4[^']*)'/i,
  ]);

  return {
    imageUrl: decodeEscapes(imageUrl) || null,
    videoUrl: decodeEscapes(videoUrl) || null,
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
    // Sempre retorna 200 com found:false para o frontend não travar em spinner
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ error: err.message, imageUrl: null, videoUrl: null, found: false })
    };
  }
};
