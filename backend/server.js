// ============================================
// ADHELP — Backend Server
// Proxy seguro para Meta Ads Library API
// ============================================

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;

// ---------- CORS ----------
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ---------- Serve frontend estático ----------
const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ---------- Helpers ----------
function getToken(req) {
  // Prioridade: header Authorization > query param token > .env
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.query.token) return req.query.token;
  return process.env.META_ACCESS_TOKEN || '';
}

// ---------- ROTA: Proxy de imagem ----------
// GET /api/imgproxy?url=<encoded_url>
// Serve imagens do CDN da Meta com CORS correto (resolve bloqueio no browser)
app.get('/api/imgproxy', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: 'url param required' });
  const imgUrl = decodeURIComponent(raw);
  let host;
  try { host = new URL(imgUrl).hostname; } catch(e) { return res.status(400).json({ error: 'invalid url' }); }
  const allowed = ['fbcdn.net', 'facebook.com', 'cdninstagram.com'];
  if (!allowed.some(d => host.endsWith(d))) return res.status(403).json({ error: 'domain not allowed' });
  try {
    const imgRes = await fetch(imgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Referer':    'https://www.facebook.com/',
        'Accept':     'image/webp,image/apng,image/*,*/*;q=0.8',
      }
    });
    if (!imgRes.ok) return res.status(502).json({ error: 'upstream ' + imgRes.status });
    const ct  = imgRes.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await imgRes.arrayBuffer());
    res.set({ 'Content-Type': ct, 'Cache-Control': 'public,max-age=3600', 'Access-Control-Allow-Origin': '*' });
    return res.send(buf);
  } catch(err) { return res.status(502).json({ error: err.message }); }
});

// ---------- ROTA: Buscar anúncios ----------
// GET /api/ads?search_terms=...&country=BR&limit=24
app.get('/api/ads', async (req, res) => {
  try {
    const {
      search_terms,
      country   = 'BR',
      ad_type   = 'ALL',
      limit     = '24',
      after            // cursor de paginação
    } = req.query;

    if (!search_terms) {
      return res.status(400).json({ error: 'Parâmetro search_terms é obrigatório' });
    }

    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Token de API não configurado. Defina META_ACCESS_TOKEN no .env ou envie via header Authorization.' });
    }

    const params = new URLSearchParams({
      search_terms,
      ad_type,
      ad_reached_countries: JSON.stringify([country]),
      fields: 'id,page_name,page_id,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_snapshot_url,ad_delivery_start_time,ad_delivery_stop_time,impressions,spend,currency,demographic_distribution',
      limit,
      access_token: token
    });

    if (after) params.set('after', after);

    const apiUrl = `https://graph.facebook.com/v19.0/ads_archive?${params}`;
    const apiRes = await fetch(apiUrl);
    const data   = await apiRes.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message || 'Erro da API da Meta', details: data.error });
    }

    return res.json(data);

  } catch (err) {
    console.error('[ADHELP] Erro /api/ads:', err.message);
    return res.status(500).json({ error: 'Erro interno do servidor', message: err.message });
  }
});

// ---------- ROTA: Salvar token (opcional — armazena só em memória/sessão) ----------
// POST /api/token  { "token": "EAA..." }
app.post('/api/token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token não informado' });
  // Em produção, considere salvar por usuário autenticado
  process.env.META_ACCESS_TOKEN = token;
  return res.json({ ok: true, message: 'Token atualizado para esta sessão do servidor' });
});

// ---------- Health check ----------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    token_configured: !!process.env.META_ACCESS_TOKEN,
    timestamp: new Date().toISOString()
  });
});

// ---------- Fallback SPA ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`\n🚀 ADHELP Backend rodando em http://localhost:${PORT}`);
  console.log(`📡 API proxy:  http://localhost:${PORT}/api/ads`);
  console.log(`❤️  Health:     http://localhost:${PORT}/api/health`);
  console.log(`🌐 Frontend:   http://localhost:${PORT}\n`);
  if (!process.env.META_ACCESS_TOKEN) {
    console.warn('⚠️  META_ACCESS_TOKEN não definido! Configure no arquivo .env\n');
  }
});
