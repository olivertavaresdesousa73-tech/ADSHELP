// netlify/functions/media-ingest.js
//
// Recebe POST da extensão Chrome com URLs de imagens/vídeos capturados
// da Biblioteca de Anúncios do Facebook.
//
// Body: { ads: [{ adId, pageId, images: [], videos: [{url, thumb}], capturedAt }] }
//
// Armazena em memória (Map) — em produção, trocar por banco de dados (Supabase, etc.)

// Armazenamento em memória (persiste enquanto a função está ativa)
// Em produção, use um banco de dados real.
const mediaStore = global._mediaStore || (global._mediaStore = new Map());

// Tokens válidos — em produção, gere tokens reais por usuário
// Por enquanto usa um token fixo que você configura no .env
const VALID_TOKENS = new Set([
  process.env.EXTENSION_TOKEN || 'adhelp-token-secreto-troque-isso'
]);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-AdHelp-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const token = event.headers['x-adhelp-token'] || event.headers['X-AdHelp-Token'];

  // ── POST: extensão envia mídias ──────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    if (!token || !VALID_TOKENS.has(token)) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Token inválido' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    const ads = body.ads || [];
    let saved = 0;

    for (const ad of ads) {
      if (!ad.adId) continue;
      // Merge: se já existe, adiciona imagens novas sem duplicar
      const existing = mediaStore.get(ad.adId) || { images: [], videos: [] };
      const newImages = [...new Set([...existing.images, ...(ad.images || [])])];
      const existingVideoUrls = new Set(existing.videos.map(v => v.url));
      const newVideos = [
        ...existing.videos,
        ...(ad.videos || []).filter(v => !existingVideoUrls.has(v.url))
      ];
      mediaStore.set(ad.adId, {
        ...ad,
        images:  newImages,
        videos:  newVideos,
        savedAt: Date.now(),
      });
      saved++;
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, saved, total: mediaStore.size }),
    };
  }

  // ── GET: site busca mídia de um anúncio específico ───────────────────────
  if (event.httpMethod === 'GET') {
    const { adId } = event.queryStringParameters || {};

    if (adId) {
      const media = mediaStore.get(adId);
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify(media || { images: [], videos: [] }),
      };
    }

    // Retorna todos (paginado)
    const { page = '1', limit = '50' } = event.queryStringParameters || {};
    const all    = [...mediaStore.values()]
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    const start  = (parseInt(page) - 1) * parseInt(limit);
    const result = all.slice(start, start + parseInt(limit));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        total: mediaStore.size,
        page:  parseInt(page),
        data:  result,
      }),
    };
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Método não permitido' }) };
};
