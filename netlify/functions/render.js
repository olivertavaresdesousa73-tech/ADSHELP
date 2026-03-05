// netlify/functions/render.js
//
// Usa o Cloudflare Worker público (render-facebook-ad.lejo.workers.dev)
// para buscar o HTML do anúncio e extrair a URL da imagem/vídeo via og:image.
//
// Endpoint: /.netlify/functions/render?id=<AD_ID>
//
// Retorna JSON: { imageUrl, videoUrl, title, found }

const https = require('https');

function fetchUrl(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      timeout: 10000,
    }, (res) => {
      // Segue redirecionamentos
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        req.destroy();
        return fetchUrl(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractMeta(html, property) {
  // og:image, og:video etc
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i');
  const m = html.match(re) || html.match(re2);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  const { id } = event.queryStringParameters || {};
  if (!id) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id obrigatório' }) };
  }

  // Tenta 3 URLs em sequência, na ordem de preferência
  const urls = [
    `https://render-facebook-ad.lejo.workers.dev/${id}`,
    `https://www.facebook.com/ads/library/?id=${id}`,
    `https://www.facebook.com/ads/archive/render_ad/?id=${id}`,
  ];

  let imageUrl = null;
  let videoUrl = null;
  let title    = null;

  for (const url of urls) {
    try {
      const { status, body } = await fetchUrl(url);
      if (status !== 200 || !body) continue;

      // Extrai og:image e og:video
      imageUrl = extractMeta(body, 'og:image');
      videoUrl = extractMeta(body, 'og:video') || extractMeta(body, 'og:video:url');
      title    = extractMeta(body, 'og:title');

      // Fallback: procura qualquer URL de imagem de CDN do Facebook no HTML
      if (!imageUrl) {
        const cdnRe = /https:\/\/(?:scontent[^"'\s]+\.fbcdn\.net|z-m-scontent[^"'\s]+\.fbcdn\.net)[^"'\s]*/g;
        const imgs = body.match(cdnRe) || [];
        // Filtra URLs que parecem imagens (não .js, não pixel)
        const imgUrls = imgs.filter(u => /\.(jpg|jpeg|png|webp)/i.test(u) || u.includes('_n.'));
        if (imgUrls.length > 0) imageUrl = imgUrls[0].replace(/&amp;/g, '&');
      }

      // Se achou algo, para aqui
      if (imageUrl || videoUrl) break;

    } catch (e) {
      // Tenta próxima URL
      continue;
    }
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      found: !!(imageUrl || videoUrl),
      imageUrl: imageUrl || null,
      videoUrl: videoUrl || null,
      title:    title    || null,
    }),
  };
};
