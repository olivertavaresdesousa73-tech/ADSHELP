// netlify/functions/media-ingest.js
// Recebe mídias da extensão e serve lista de anúncios pendentes para ela processar.

const mediaStore = global._mediaStore || (global._mediaStore = new Map());

function isValidToken(t) {
  if (!t) return false;
  if (t === (process.env.EXTENSION_TOKEN || 'adhelp-token-secreto-troque-isso')) return true;
  return /^adh_[0-9a-f]{48}$/.test(t);
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-AdHelp-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const token = event.headers['x-adhelp-token'] || '';
  const q = event.queryStringParameters || {};

  // ── GET ?pending=true — extensão pede lista de anúncios sem mídia ──────────
  if (event.httpMethod === 'GET' && q.pending === 'true') {
    if (!isValidToken(token)) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Token inválido' }) };

    // Busca anúncios que foram registrados mas ainda não têm imagem
    const limit = parseInt(q.limit || '5');
    const pending = [...mediaStore.values()]
      .filter(ad => !ad.images || ad.images.length === 0)
      .slice(0, limit)
      .map(ad => ({ adId: ad.adId, pageId: ad.pageId || '', snapshotUrl: ad.snapshotUrl || '' }));

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ads: pending }) };
  }

  // ── GET ?adId=X — site busca mídia de um anúncio ──────────────────────────
  if (event.httpMethod === 'GET' && q.adId) {
    const media = mediaStore.get(q.adId);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(media || { images: [], videos: [] }) };
  }

  // ── POST — extensão envia mídias capturadas ───────────────────────────────
  if (event.httpMethod === 'POST') {
    if (!isValidToken(token)) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Token inválido' }) };

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: '{"error":"JSON inválido"}' }; }

    const ads = body.ads || [];
    let saved = 0;

    for (const ad of ads) {
      if (!ad.adId) continue;
      const existing = mediaStore.get(ad.adId) || { images: [], videos: [] };
      mediaStore.set(ad.adId, {
        ...existing,
        ...ad,
        images:  [...new Set([...(existing.images||[]), ...(ad.images||[])])],
        videos:  [...(existing.videos||[]), ...(ad.videos||[]).filter(v => !(existing.videos||[]).find(ev=>ev.url===v.url))],
        savedAt: Date.now(),
      });
      saved++;
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, saved, total: mediaStore.size }) };
  }

  return { statusCode: 405, headers: CORS, body: '{"error":"Método não permitido"}' };
};
