// netlify/functions/snapshot.js
// Acessa ad_snapshot_url da Meta, extrai a URL real da mídia (imagem/vídeo),
// faz download, salva em /tmp e retorna a URL servida.
// Cache em memória enquanto a função Netlify estiver quente.

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

// ── Cache em memória ──────────────────────────────────────────
const mediaCache = {};

// Netlify Functions usa /tmp (efêmero mas funcional por sessão)
const UPLOAD_DIR = process.env.MEDIA_UPLOAD_DIR || path.join(os.tmpdir(), 'adhelp_ads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────
function fetchHtml(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve(raw));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout ao buscar snapshot')); });
  });
}

function downloadBinary(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Referer': 'https://www.facebook.com/',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBinary(res.headers.location, destPath, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ao baixar mídia`));
      const contentType = res.headers['content-type'] || '';
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(contentType)));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout ao baixar mídia')); });
  });
}

function extractMediaFromHtml(html) {
  // Vídeo tem prioridade
  const videoPatterns = [
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["']/i,
    /["'](https:\/\/[^"']*\.mp4[^"']*)['"]/i,
    /video_url["']\s*:\s*["']([^"']+)["']/i,
  ];
  for (const re of videoPatterns) {
    const m = html.match(re);
    if (m?.[1]) return { url: m[1].replace(/\\u0025/g,'%').replace(/\\\//g,'/'), type: 'video' };
  }
  // Imagem
  const imagePatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<img[^>]+src=["']([^"']*fbcdn[^"']+)["']/i,
  ];
  for (const re of imagePatterns) {
    const m = html.match(re);
    if (m?.[1]) return { url: m[1], type: 'image' };
  }
  return null;
}

function extForType(type, contentType) {
  if (type === 'video') return '.mp4';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('png'))  return '.png';
  return '.jpg';
}

// Lê arquivo e retorna base64 (Netlify não tem static file serving nas functions)
function fileToBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function mimeFromExt(ext) {
  const map = { '.mp4':'video/mp4', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg' };
  return map[ext] || 'application/octet-stream';
}

// ── Handler principal ──────────────────────────────────────────
exports.handler = async function (event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const q            = event.queryStringParameters || {};
  const snapshotUrl  = q.url ? decodeURIComponent(q.url) : null;
  const adId         = q.id  || null;
  const forceRefresh = q.refresh === '1';

  if (!snapshotUrl) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Parâmetro url obrigatório' }) };
  }

  try {
    const cacheKey = adId || snapshotUrl;

    // 1. Cache hit
    if (!forceRefresh && mediaCache[cacheKey]) {
      const cached = mediaCache[cacheKey];
      if (fs.existsSync(cached.filePath)) {
        return {
          statusCode: 200, headers: corsHeaders,
          body: JSON.stringify({
            mediaUrl:  cached.dataUrl,
            mediaType: cached.mediaType,
            cached:    true,
            found:     true
          })
        };
      }
    }

    // 2. Buscar HTML do snapshot
    const html = await fetchHtml(snapshotUrl);

    const title    = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    const bodyText = (html.match(/class="[^"]*body[^"]*"[^>]*>([^<]{10,})<\//i) || [])[1] || '';

    // 3. Extrair URL da mídia
    const media = extractMediaFromHtml(html);
    if (!media) {
      return {
        statusCode: 200, headers: corsHeaders,
        body: JSON.stringify({
          mediaUrl: null, mediaType: null, found: false,
          title: title.replace(/\s+/g,' ').trim(),
          bodyText: bodyText.replace(/\s+/g,' ').trim()
        })
      };
    }

    // 4. Download para /tmp
    const fileId      = adId || Date.now().toString(36);
    const tmpPath     = path.join(UPLOAD_DIR, `${fileId}_tmp`);
    const contentType = await downloadBinary(media.url, tmpPath);
    const ext         = extForType(media.type, contentType);
    const fileName    = `${fileId}${ext}`;
    const filePath    = path.join(UPLOAD_DIR, fileName);
    fs.renameSync(tmpPath, filePath);

    // 5. Em Netlify, servimos como data URL (arquivo está em /tmp, não em pasta pública)
    // Para VPS, troque por servedUrl = `/uploads/ads/${fileName}`
    const b64     = fileToBase64(filePath);
    const mime    = mimeFromExt(ext);
    const dataUrl = `data:${mime};base64,${b64}`;

    // 6. Cache em memória
    mediaCache[cacheKey] = { filePath, dataUrl, mediaType: media.type, ts: Date.now() };

    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({
        mediaUrl:  dataUrl,
        mediaType: media.type,
        fileName,
        cached:    false,
        found:     true,
        title:     title.replace(/\s+/g,' ').trim(),
        bodyText:  bodyText.replace(/\s+/g,' ').trim()
      })
    };

  } catch (err) {
    return {
      statusCode: 500, headers: corsHeaders,
      body: JSON.stringify({ error: err.message, mediaUrl: null, found: false })
    };
  }
};
