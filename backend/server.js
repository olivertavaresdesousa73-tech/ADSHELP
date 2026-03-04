// ============================================
// ADHELP — Backend Server
// Proxy seguro para Meta Ads Library API
// + Download, cache e serve de mídias dos anúncios
// ============================================

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Diretório de uploads ───────────────────────────────────────
// Em VPS, defina MEDIA_UPLOAD_DIR para um caminho permanente
const UPLOAD_DIR = process.env.MEDIA_UPLOAD_DIR
  || path.join(__dirname, '..', 'frontend', 'uploads', 'ads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Cache em memória: cacheKey → { filePath, servedUrl, mediaType, ts } ──
const mediaCache = {};

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ── Serve frontend estático ────────────────────────────────────
const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND));

// Serve mídias baixadas diretamente pelo servidor
app.use('/uploads/ads', express.static(UPLOAD_DIR));

// ── Helpers ───────────────────────────────────────────────────
function getToken(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.query.token) return req.query.token;
  return process.env.META_ACCESS_TOKEN || '';
}

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

// ── ROTA: Download + cache de mídia ───────────────────────────
// GET /api/media?url=<encoded_snapshot_url>&id=<ad_id>&refresh=1
app.get('/api/media', async (req, res) => {
  const { url: rawUrl, id: adId, refresh } = req.query;
  if (!rawUrl) return res.status(400).json({ error: 'Parâmetro url obrigatório' });

  const snapshotUrl  = decodeURIComponent(rawUrl);
  const cacheKey     = adId || snapshotUrl;
  const forceRefresh = refresh === '1';

  try {
    // 1. Cache hit
    if (!forceRefresh && mediaCache[cacheKey]) {
      const cached = mediaCache[cacheKey];
      if (fs.existsSync(cached.filePath)) {
        return res.json({ mediaUrl: cached.servedUrl, mediaType: cached.mediaType, cached: true, found: true });
      }
    }

    // 2. Buscar HTML do snapshot da Meta
    const html = await fetchHtml(snapshotUrl);

    // Texto auxiliar
    const title    = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    const bodyText = (html.match(/class="[^"]*body[^"]*"[^>]*>([^<]{10,})<\//i) || [])[1] || '';

    // 3. Extrair URL da mídia
    const media = extractMediaFromHtml(html);
    if (!media) {
      return res.json({
        mediaUrl: null, mediaType: null, found: false,
        title: title.replace(/\s+/g,' ').trim(),
        bodyText: bodyText.replace(/\s+/g,' ').trim()
      });
    }

    // 4. Download
    const fileId      = adId || Date.now().toString(36);
    const tmpPath     = path.join(UPLOAD_DIR, `${fileId}_tmp`);
    const contentType = await downloadBinary(media.url, tmpPath);
    const ext         = extForType(media.type, contentType);
    const fileName    = `${fileId}${ext}`;
    const filePath    = path.join(UPLOAD_DIR, fileName);
    fs.renameSync(tmpPath, filePath);

    // 5. URL servida pelo próprio domínio
    const servedUrl = `/uploads/ads/${fileName}`;

    // 6. Salvar no cache
    mediaCache[cacheKey] = { filePath, servedUrl, mediaType: media.type, ts: Date.now() };

    return res.json({
      mediaUrl:  servedUrl,
      mediaType: media.type,
      fileName,
      cached:    false,
      found:     true,
      title:     title.replace(/\s+/g,' ').trim(),
      bodyText:  bodyText.replace(/\s+/g,' ').trim()
    });

  } catch (err) {
    console.error('[ADHELP] Erro /api/media:', err.message);
    return res.status(500).json({ error: err.message, mediaUrl: null, found: false });
  }
});

// ── ROTA: Buscar anúncios ──────────────────────────────────────
app.get('/api/ads', async (req, res) => {
  try {
    const { search_terms, country = 'BR', ad_type = 'ALL', limit = '24', after } = req.query;
    if (!search_terms) return res.status(400).json({ error: 'Parâmetro search_terms é obrigatório' });

    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Token de API não configurado. Defina META_ACCESS_TOKEN no .env' });

    const params = new URLSearchParams({
      search_terms,
      ad_type,
      ad_reached_countries: JSON.stringify([country]),
      fields: 'id,page_name,page_id,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_snapshot_url,ad_delivery_start_time,ad_delivery_stop_time,impressions,spend,currency,demographic_distribution',
      limit,
      access_token: token
    });
    if (after) params.set('after', after);

    const apiRes = await fetch(`https://graph.facebook.com/v19.0/ads_archive?${params}`);
    const data   = await apiRes.json();
    if (data.error) return res.status(400).json({ error: data.error.message, details: data.error });
    return res.json(data);

  } catch (err) {
    console.error('[ADHELP] Erro /api/ads:', err.message);
    return res.status(500).json({ error: 'Erro interno do servidor', message: err.message });
  }
});

// ── ROTA: Salvar token ─────────────────────────────────────────
app.post('/api/token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token não informado' });
  process.env.META_ACCESS_TOKEN = token;
  return res.json({ ok: true, message: 'Token atualizado para esta sessão do servidor' });
});

// ── Health check ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    token_configured: !!process.env.META_ACCESS_TOKEN,
    media_cache_entries: Object.keys(mediaCache).length,
    upload_dir: UPLOAD_DIR,
    timestamp: new Date().toISOString()
  });
});

// ── Fallback SPA ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND, 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ADHELP Backend rodando em http://localhost:${PORT}`);
  console.log(`📡 API proxy:  http://localhost:${PORT}/api/ads`);
  console.log(`🖼  Media:      http://localhost:${PORT}/api/media`);
  console.log(`❤️  Health:     http://localhost:${PORT}/api/health`);
  console.log(`🗂  Uploads:    ${UPLOAD_DIR}\n`);
  if (!process.env.META_ACCESS_TOKEN) {
    console.warn('⚠️  META_ACCESS_TOKEN não definido! Configure no arquivo .env\n');
  }
});
