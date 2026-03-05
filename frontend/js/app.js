// ============================================
// ADHELP v4 — app.js
// iframe preview · paginação · análise inteligente
// anúncios salvos · canvas texto livre · fontes
// ============================================

// ── API CONFIG ────────────────────────────────────────────────
const META_API      = 'https://graph.facebook.com/v19.0/ads_archive';
const DEFAULT_TOKEN = 'EAAawblFuQiwBQ4cEWlWsB5SDZBKhJZB7VKZB51ckZCLMTMKkqgBNPfHLjAx9U6yFXVgEqWRwCoGPtzChGt5kCK6Ek7jxR0tGIFLOXXIZAZAZA36pCByVJikVHpoGqg1UCAgqIVtN7ZCOhjuppir6D4j59fXzHZA2O3tzPg3qaO7wyZATK1qboFtSFCZB15EQFD8IGVYmpqJiCBmZA8qLRIMM2ZA20DxOLZBhlWlxroW0oQgZAFiWUsbW9z7iLuKOco4xes3WOzu2tg9TC7X3EFijZCTZCR7LR4hxNj2ucgtxG9bfw454ZD';

const AD_FIELDS = [
  'id','page_name','page_id',
  'ad_creative_bodies',
  'ad_snapshot_url',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'snapshot{title,body{text},images{original_image_url,resized_image_url},videos{video_hd_url,video_sd_url,video_preview_image_url},cards{original_image_url,resized_image_url,video_hd_url,video_sd_url}}'
].join(',');

function getToken() {
  return localStorage.getItem('adhelp_token') || DEFAULT_TOKEN;
}
function isNetlify() {
  const h = window.location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '';
}

async function fetchAds(params) {
  if (isNetlify()) {
    const p = new URLSearchParams(params.toString());
    const res = await fetch(`/.netlify/functions/ads?${p}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const d = await res.json();
    if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
    return d;
  }
  // Local dev
  const p = new URLSearchParams(params.toString());
  p.set('access_token', getToken());
  p.set('fields', AD_FIELDS);
  const url = `https://corsproxy.io/?url=${encodeURIComponent(META_API + '?' + p)}`;
  const res = await fetch(url);
  const d   = await res.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d;
}

// ── PREVIEW DE MÍDIA ─────────────────────────────────────────────────────────
//
// SOLUÇÃO DEFINITIVA:
// A Meta Graph API retorna URLs de imagem/vídeo diretamente no campo "snapshot"
// quando solicitados nos fields da query (veja ads.js).
// Não há scraping, não há proxy, não há fetch extra — as URLs já estão no objeto ad.
//
// Hierarquia de mídia extraída do campo ad.snapshot:
//   1. Vídeo  → snapshot.videos[0].video_hd_url ou video_sd_url
//   2. Imagem → snapshot.images[0].original_image_url ou resized_image_url
//   3. Cards  → snapshot.cards[0].original_image_url / video_hd_url
//   4. Fallback → link para ad_snapshot_url no Facebook

// ─── PREVIEW: busca mídia capturada pela extensão ────────────────────────────
// A extensão Chrome captura imagens/vídeos enquanto o usuário navega no Facebook.
// O frontend busca esses dados via /.netlify/functions/media-ingest?adId=<id>
// Se não houver mídia capturada ainda, cai no fallback da foto da página.

const _previewCache = {};

function _getToken(ad) {
  try {
    const url = new URL(ad.ad_snapshot_url || '');
    return url.searchParams.get('access_token') || '';
  } catch(e) { return ''; }
}

async function _loadPreview(wrap) {
  const ad = wrap._adData;
  if (!ad) { _showNoMedia(wrap); return; }

  const adId = ad.id;

  // Cache hit
  if (_previewCache[adId]) {
    _applyMedia(wrap, _previewCache[adId]);
    return;
  }

  // 1ª tentativa: mídia capturada pela extensão
  try {
    const r = await fetch('/.netlify/functions/media-ingest?adId=' + encodeURIComponent(adId));
    if (r.ok) {
      const data = await r.json();
      if (data && (data.images?.length > 0 || data.videos?.length > 0)) {
        _previewCache[adId] = { source: 'extension', ...data };
        _applyMedia(wrap, _previewCache[adId]);
        return;
      }
    }
  } catch(e) {}

  // 2ª tentativa: foto da página via Graph API (sempre disponível)
  const token = _getToken(ad);
  const pid   = ad.page_id;
  if (pid && token) {
    try {
      const r = await fetch(`https://graph.facebook.com/${pid}/picture?type=large&redirect=false&access_token=${token}`);
      if (r.ok) {
        const data = await r.json();
        if (data?.data?.url) {
          const media = { source: 'page_picture', images: [data.data.url], videos: [] };
          _previewCache[adId] = media;
          _applyMedia(wrap, media);
          return;
        }
      }
    } catch(e) {}
  }

  _showNoMedia(wrap);
}

function _applyMedia(wrap, data) {
  wrap.innerHTML = '';

  // Vídeo tem prioridade
  const vid = data.videos && data.videos[0];
  if (vid) {
    const video = document.createElement('video');
    video.className   = 'ad-preview-media';
    video.autoplay    = true;
    video.muted       = true;
    video.loop        = true;
    video.playsInline = true;
    video.src         = vid.url || vid;
    video.poster      = vid.thumb || '';
    video.onerror     = () => _tryImage(wrap, data);
    wrap.appendChild(video);
    _addOverlay(wrap);
    return;
  }

  _tryImage(wrap, data);
}

function _tryImage(wrap, data) {
  const imgUrl = data.images && data.images[0];
  if (!imgUrl) { _showNoMedia(wrap); return; }

  const img = new Image();
  img.className = 'ad-preview-media';
  // Se for foto da página, aplica object-fit contain para não distorcer
  if (data.source === 'page_picture') {
    img.style.objectFit = 'contain';
    img.style.background = '#1a1a2e';
    img.style.padding = '8px';
  }
  img.onerror = () => _showNoMedia(wrap);
  img.onload  = () => {
    wrap.innerHTML = '';
    wrap.appendChild(img);
    _addOverlay(wrap);
  };
  img.src = imgUrl;
}

function _addOverlay(wrap) {
  if (!wrap._onclickFn) return;
  const ov = document.createElement('div');
  ov.className = 'iframe-click-overlay';
  ov.addEventListener('click', wrap._onclickFn);
  wrap.appendChild(ov);
}

function _showNoMedia(wrap) {
  wrap.innerHTML = '';
  const ad  = wrap._adData;
  const div = document.createElement('div');
  div.className = 'ad-preview-no-media';
  if (ad && ad.ad_snapshot_url) {
    const a = document.createElement('a');
    a.className   = 'ad-preview-fb-link';
    a.href        = ad.ad_snapshot_url;
    a.target      = '_blank';
    a.rel         = 'noopener';
    a.textContent = '↗ Ver no Facebook';
    a.addEventListener('click', e => e.stopPropagation());
    div.appendChild(a);
  } else {
    div.innerHTML = '<span style="font-size:28px;opacity:.3">🖼</span>';
  }
  wrap.appendChild(div);
  if (wrap._onclickFn) {
    const ov = document.createElement('div');
    ov.className = 'iframe-click-overlay';
    ov.addEventListener('click', wrap._onclickFn);
    wrap.appendChild(ov);
  }
}

// IntersectionObserver: carrega quando card entra na tela
const _previewObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    _previewObserver.unobserve(entry.target);
    _loadPreview(entry.target);
  });
}, { rootMargin: '400px' });

function buildPreviewWrap(ad, onclickFn) {
  const wrap = document.createElement('div');
  wrap.className  = 'ad-preview-wrap';
  wrap._adData    = ad;
  wrap._onclickFn = typeof onclickFn === 'function' ? onclickFn : null;

  // Spinner
  const loading = document.createElement('div');
  loading.className = 'ad-preview-loading';
  const sp = document.createElement('div');
  sp.className = 'mini-spinner';
  loading.appendChild(sp);
  wrap.appendChild(loading);

  if (ad && _previewCache[ad.id]) {
    _applyMedia(wrap, _previewCache[ad.id]);
  } else {
    _previewObserver.observe(wrap);
  }

  return wrap;
}

// ── STATE ─────────────────────────────────────────────────────
let state = {
  theme:            localStorage.getItem('adhelp_theme') || 'dark',
  sidebarCollapsed: false,
  searchHistory:    JSON.parse(localStorage.getItem('adhelp_history') || '[]'),
  savedAds:         JSON.parse(localStorage.getItem('adhelp_saved')   || '[]'),
  totalAdsAnalyzed: parseInt(localStorage.getItem('adhelp_total_ads') || '0'),
  currentSearch:    { term:'', country:'BR', adType:'ALL' },
  currentResults:   [],
  nextCursor:       null,
  loadingMore:      false,
  pageFrequency:    {},
  // canvas
  nodeColor:      '#4f7cff',
  nodeFontSize:   14,
  nodeFontFamily: 'Inter',
  selectedNode:   null,
  canvasHistory:  [],
  canvasRedo:     [],
  // viewport
  vpX:0, vpY:0, vpScale:1,
  isPanning:false, panStartX:0, panStartY:0, panOriginX:0, panOriginY:0,
  draggingNode:null, dragStartX:0, dragStartY:0, nodeStartX:0, nodeStartY:0,
  resizingNode:null, resizeStartW:0, resizeStartH:0, resizeMouseX:0, resizeMouseY:0,
};

document.documentElement.setAttribute('data-theme', state.theme);

// ── NAVIGATION ────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard:'Dashboard', intelligence:'Inteligência — Ad Library',
  saved:'Anúncios Salvos', strategy:'Estratégia', map:'Mapa Mental',
  planning:'Planejamento', settings:'Configurações',
  privacy:'Política de Privacidade', terms:'Termos de Uso'
};

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick')?.includes(`'${page}'`)) n.classList.add('active');
  });
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;
  if (page === 'dashboard')  updateDashboard();
  if (page === 'planning')   calcPlanning();
  if (page === 'strategy')   generateKeywords();
  if (page === 'settings')   initSettingsToken();
  if (page === 'saved')      renderSavedPage();
  document.getElementById('sidebar').classList.remove('mobile-open');
  window.scrollTo(0, 0);
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', state.sidebarCollapsed);
  document.getElementById('mainContent').classList.toggle('expanded', state.sidebarCollapsed);
  document.getElementById('sidebarToggle').textContent = state.sidebarCollapsed ? '›' : '‹';
}
function toggleMobileSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
}
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('adhelp_theme', state.theme);
  document.getElementById('themeSwitch').classList.toggle('on', state.theme === 'dark');
}
function showToast(msg, type = 'info') {
  const icons = {success:'✅', error:'❌', info:'ℹ️'};
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateX(110%)'; }, 3000);
  setTimeout(()=> el.remove(), 3400);
}

// ── SCORING ───────────────────────────────────────────────────
function scoreAd(ad) {
  let s = 0;
  const body = (ad.ad_creative_bodies?.[0] || '').toLowerCase();
  if (ad.ad_delivery_start_time) {
    const d = Math.floor((Date.now() - new Date(ad.ad_delivery_start_time)) / 86400000);
    s += d > 60 ? 28 : d > 30 ? 20 : d > 7 ? 12 : 4;
  }
  const len = body.length;
  s += len > 300 ? 20 : len > 150 ? 12 : len > 60 ? 6 : 0;
  const triggers = ['grátis','free','desconto','oferta','exclusivo','garantido','resultado','transformar','rápido','agora','hoje','última','limitado','especial','bônus','revelar','segredo','comprovado','promoção','aproveite'];
  s += Math.min(triggers.filter(t => body.includes(t)).length * 4, 24);
  const social = ['pessoas','clientes','alunos','depoimento','avaliação','estrelas','aprovado','recomendado','confia','satisfeito'];
  s += Math.min(social.filter(t => body.includes(t)).length * 4, 18);
  if (['clique','saiba mais','acesse','compre','cadastre','inscreva','baixe','garanta'].some(c => body.includes(c))) s += 10;
  return Math.min(Math.max(Math.round(s), 1), 100);
}
const scoreClass = s => s >= 70 ? 'score-high' : s >= 40 ? 'score-mid' : 'score-low';
const scoreColor = s => s >= 70 ? 'var(--green)' : s >= 40 ? 'var(--yellow)' : 'var(--red)';
function scoreBadge(s) {
  if (s >= 70) return `<span class="badge badge-green">🟢 Alto</span>`;
  if (s >= 40) return `<span class="badge badge-yellow">🟡 Médio</span>`;
  return `<span class="badge badge-red">🔴 Baixo</span>`;
}

// ── ANÁLISE INTELIGENTE ────────────────────────────────────────
function analyzeAds(ads) {
  const freq = {};
  ads.forEach(ad => {
    const pid = ad.page_id || ad.id;
    if (!freq[pid]) freq[pid] = { count:0, name: ad.page_name||'', dates:[] };
    freq[pid].count++;
    if (ad.ad_delivery_start_time) freq[pid].dates.push(new Date(ad.ad_delivery_start_time));
  });
  state.pageFrequency = freq;
}

function getAdIndicators(ad) {
  const pid   = ad.page_id || ad.id;
  const freq  = state.pageFrequency[pid] || {};
  const count = freq.count || 1;
  const tags  = [];
  if (count >= 5)       tags.push({ label:'Alta Atividade',     color:'var(--green)',   icon:'🔥' });
  else if (count >= 3)  tags.push({ label:'Anunciante Ativo',   color:'var(--yellow)',  icon:'⚡' });
  if (ad.ad_delivery_start_time) {
    const days = Math.floor((Date.now() - new Date(ad.ad_delivery_start_time)) / 86400000);
    if (days > 60) tags.push({ label:`${days}d rodando`,        color:'var(--accent)',  icon:'⏱' });
    if (days <= 3) tags.push({ label:'Novo',                    color:'var(--accent2)', icon:'🆕' });
  }
  if (count >= 3)       tags.push({ label:'Teste de Criativo',  color:'var(--text2)',   icon:'🧪' });
  const body = (ad.ad_creative_bodies?.[0]||'').toLowerCase();
  if (['comprovado','testado','clientes','depoimento'].some(w => body.includes(w)))
    tags.push({ label:'Prova Social', color:'var(--green)', icon:'👥' });
  return tags;
}

// ── SEARCH ────────────────────────────────────────────────────
function buildBaseParams(after) {
  const { term, country, adType } = state.currentSearch;
  const p = new URLSearchParams({
    search_terms: term, country, ad_type: adType,
    limit: '24', fields: AD_FIELDS,
    ad_reached_countries: JSON.stringify([country])
  });
  if (after) p.set('after', after);
  return p;
}

async function searchAds() {
  const term = document.getElementById('searchInput').value.trim();
  if (!term) { showToast('Digite um termo de busca', 'error'); return; }
  state.currentSearch = {
    term,
    country: document.getElementById('countryFilter').value,
    adType:  document.getElementById('adTypeFilter').value
  };
  state.currentResults = [];
  state.nextCursor     = null;

  const container = document.getElementById('searchResults');
  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>Buscando na Meta Ads Library...</p></div>`;

  try {
    const data = await fetchAds(buildBaseParams());
    const ads  = data.data || [];
    state.currentResults = ads;
    state.nextCursor     = data.paging?.cursors?.after || null;
    state.totalAdsAnalyzed += ads.length;
    localStorage.setItem('adhelp_total_ads', state.totalAdsAnalyzed);
    const entry = { term, country: state.currentSearch.country, date: new Date().toISOString(), count: ads.length };
    state.searchHistory.unshift(entry);
    if (state.searchHistory.length > 20) state.searchHistory.pop();
    localStorage.setItem('adhelp_history', JSON.stringify(state.searchHistory));
    analyzeAds(ads);
    renderResults(container, ads);
    showToast(`${ads.length} anúncios encontrados!`, 'success');
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div><h3>Erro ao buscar</h3>
        <p style="color:var(--red);font-size:13px">${err.message}</p>
        <p style="font-size:12px;color:var(--text3);margin-top:10px">
          Verifique o token em <strong>Configurações</strong>.</p>
      </div>`;
  }
}

async function loadMore() {
  if (!state.nextCursor || state.loadingMore) return;
  state.loadingMore = true;
  const btn = document.getElementById('loadMoreBtn');
  if (btn) { btn.disabled=true; btn.textContent='⏳ Carregando...'; }
  try {
    const data = await fetchAds(buildBaseParams(state.nextCursor));
    const ads  = data.data || [];
    state.currentResults.push(...ads);
    state.nextCursor = data.paging?.cursors?.after || null;
    state.totalAdsAnalyzed += ads.length;
    localStorage.setItem('adhelp_total_ads', state.totalAdsAnalyzed);
    analyzeAds(state.currentResults);
    const grid = document.getElementById('adsGrid');
    if (grid) ads.forEach(ad => grid.appendChild(createAdCard(ad)));
    const footer = document.getElementById('loadMoreFooter');
    if (footer) footer.innerHTML = state.nextCursor ? loadMoreBtnHTML() : `<p style="text-align:center;color:var(--text3);font-size:13px;padding:24px">— Fim dos resultados —</p>`;
    showToast(`+${ads.length} anúncios`, 'success');
  } catch (err) { showToast('Erro: '+err.message,'error'); }
  state.loadingMore = false;
}

function loadMoreBtnHTML() {
  return `<button id="loadMoreBtn" class="btn btn-ghost" style="width:100%;margin-top:20px;padding:14px;font-size:14px" onclick="loadMore()">
    ⬇️ Ver mais anúncios
  </button>`;
}

function renderResults(container, ads) {
  if (!ads.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><h3>Nenhum anúncio encontrado</h3><p>Tente outro termo ou país</p></div>`;
    return;
  }
  const topPages = Object.entries(state.pageFrequency).sort((a,b)=>b[1].count-a[1].count).slice(0,3);
  const summaryHTML = topPages.length ? `<div style="font-size:12px;color:var(--text3)">
    🏆 Mais ativo: <strong style="color:var(--accent)">${topPages[0][1].name}</strong> (${topPages[0][1].count} anúncios)
  </div>` : '';

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:8px">
      <span style="font-size:14px;color:var(--text2)">
        <strong style="color:var(--text)">${ads.length}</strong> anúncios para 
        <strong style="color:var(--accent)">"${state.currentSearch.term}"</strong>
      </span>
      ${summaryHTML}
    </div>
    <div id="adsGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:20px"></div>
    <div id="loadMoreFooter">${state.nextCursor ? loadMoreBtnHTML() : ''}</div>`;

  const grid = document.getElementById('adsGrid');
  ads.forEach(ad => grid.appendChild(createAdCard(ad)));
}

// ── AD CARD ───────────────────────────────────────────────────
function createAdCard(ad) {
  const score = scoreAd(ad);
  const body  = ad.ad_creative_bodies?.[0] || '';
  const date  = ad.ad_delivery_start_time
    ? new Date(ad.ad_delivery_start_time).toLocaleDateString('pt-BR') : 'N/D';
  const indicators = getAdIndicators(ad);

  // Encode for onclick — escapar corretamente
  const adEncoded = encodeURIComponent(JSON.stringify(ad));

  const indHTML = indicators.slice(0,3).map(i =>
    `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(255,255,255,.07);color:${i.color}">${i.icon} ${i.label}</span>`
  ).join('');

  const card = document.createElement('div');
  card.className = 'ad-card';

  // buildPreviewWrap agora retorna elemento DOM — inserir diretamente
  const previewEl = buildPreviewWrap(ad, function() { openAdDetail(adEncoded); });
  card.appendChild(previewEl);

  const body_div = document.createElement('div');
  body_div.className = 'ad-body';
  body_div.innerHTML = `
    <div class="ad-page-name">${ad.page_name||'Página Anunciante'}</div>
    ${indHTML ? `<div class="ad-indicators">${indHTML}</div>` : ''}
    <div class="ad-copy-text">${body||'<em style="color:var(--text3)">Texto não disponível</em>'}</div>
    <div class="ad-meta-row">
      <span class="ad-date">📅 ${date}</span>
      ${scoreBadge(score)}
    </div>
    <div class="ad-card-footer">
      <div class="score-ring ${scoreClass(score)}">${score}</div>
      <button class="btn btn-ghost btn-sm" onclick="openAdDetail('${adEncoded}')">👁 Ver</button>
      <button class="btn btn-primary btn-sm" onclick="saveAdFromCard('${adEncoded}')">💾 Salvar</button>
    </div>`;
  card.appendChild(body_div);

  return card;
}

function saveAdFromCard(encoded) {
  try { doSaveAd(JSON.parse(decodeURIComponent(encoded))); }
  catch(_) { showToast('Erro ao salvar','error'); }
}

// ── AD MODAL ──────────────────────────────────────────────────
function openAdDetail(encoded) {
  let ad;
  try { ad = JSON.parse(decodeURIComponent(encoded)); }
  catch(e) { showToast('Erro ao abrir anúncio: '+e.message,'error'); return; }

  state.currentAd = ad;
  const score    = scoreAd(ad);
  const body     = ad.ad_creative_bodies?.[0] || '';
  const date     = ad.ad_delivery_start_time
    ? new Date(ad.ad_delivery_start_time).toLocaleDateString('pt-BR') : 'N/D';
  const days     = ad.ad_delivery_start_time
    ? Math.floor((Date.now() - new Date(ad.ad_delivery_start_time)) / 86400000) : 0;
  const indicators = getAdIndicators(ad);
  const triggers = ['grátis','free','desconto','oferta','exclusivo','garantido','resultado','transformar','rápido','agora','hoje','última','limitado','especial','bônus'];
  const trigCount = triggers.filter(t => body.toLowerCase().includes(t)).length;
  const hasSocial = ['pessoas','clientes','alunos','depoimento','avaliação','comprovado'].some(w => body.toLowerCase().includes(w));

  // Preview do modal — buildPreviewWrap retorna elemento DOM
  const previewEl = buildPreviewWrap(ad, null);
  previewEl.style.cssText = 'width:100%;max-height:420px;aspect-ratio:9/16';

  document.getElementById('modalAdName').textContent = ad.page_name || 'Anúncio';

  document.getElementById('modalAdBody').innerHTML = `
    <div class="modal-layout">
      <div>
        <div class="modal-iframe-wrap" id="modal-preview-slot"></div>
        <div style="text-align:center;margin-top:10px">
          ${ad.ad_snapshot_url ? `<a href="${ad.ad_snapshot_url}" target="_blank" rel="noopener"
             class="btn btn-ghost btn-sm" style="width:100%;justify-content:center">🔗 Abrir no Facebook Ads Library</a>` : ''}
        </div>
      </div>
      <div class="modal-info">
        <div class="modal-ad-header">
          <div class="score-ring ${scoreClass(score)}" style="width:52px;height:52px;font-size:16px;flex-shrink:0">${score}</div>
          <div>
            <div class="modal-ad-title">${ad.page_name||'Página'}</div>
            <div class="modal-ad-sub">📅 Ativo desde: ${date}</div>
            <div class="inds-row" style="margin-top:6px">
              ${scoreBadge(score)}
              ${indicators.map(i=>`<span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(255,255,255,.07);color:${i.color}">${i.icon} ${i.label}</span>`).join('')}
            </div>
          </div>
        </div>

        <div class="info-section-title" style="margin-top:14px">Copy do Anúncio</div>
        <div class="copy-box" style="max-height:160px;overflow-y:auto">${body||'Texto não disponível'}</div>

        <div class="analysis-grid" style="margin-top:14px">
          ${[
            ['⏱ Dias Ativo',   days+'d'],
            ['📝 Tamanho',      body.length>200?'Longo':body.length>80?'Médio':'Curto'],
            ['🔥 Gatilhos',     trigCount+' detectados'],
            ['👥 Prova Social', hasSocial?'Presente':'Ausente'],
            ['🆔 Page ID',      ad.page_id||'N/D'],
            ['📋 Ad ID',        (ad.id||'N/D').slice(0,16)]
          ].map(([k,v])=>`
            <div class="ai-item">
              <div class="ai-k">${k}</div>
              <div class="ai-v">${v}</div>
            </div>`).join('')}
        </div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="saveCurrentAd()">💾 Salvar</button>
          ${ad.ad_snapshot_url
            ? `<a href="${ad.ad_snapshot_url}" target="_blank" rel="noopener" class="btn btn-ghost" style="flex:1;justify-content:center">🔗 Facebook</a>`
            : ''}
        </div>
      </div>
    </div>`;

  // Inserir o elemento DOM do preview no slot após o innerHTML ser setado
  const slot = document.getElementById('modal-preview-slot');
  if (slot) slot.appendChild(previewEl);

  document.getElementById('adModal').classList.add('open');
}

function saveCurrentAd() {
  if (state.currentAd) { doSaveAd(state.currentAd); closeModal('adModal'); }
}

// ── SALVAR / BIBLIOTECA ───────────────────────────────────────
function doSaveAd(ad) {
  if (!ad.id) { showToast('Anúncio sem ID','error'); return; }
  if (state.savedAds.find(a => a.id === ad.id)) { showToast('Anúncio já salvo!','info'); return; }
  state.savedAds.unshift({ ...ad, _score: scoreAd(ad), _savedAt: new Date().toISOString() });
  localStorage.setItem('adhelp_saved', JSON.stringify(state.savedAds));
  updateSavedCount();
  showToast('Salvo na biblioteca! 💾','success');
}

function removeSavedAd(adId) {
  state.savedAds = state.savedAds.filter(a => a.id !== adId);
  localStorage.setItem('adhelp_saved', JSON.stringify(state.savedAds));
  updateSavedCount();
  renderSavedPage();
}

function updateSavedCount() {
  const el = document.getElementById('savedCount');
  if (!el) return;
  el.style.display = state.savedAds.length > 0 ? 'flex' : 'none';
  el.textContent   = state.savedAds.length;
}

function renderSavedPage() {
  const container = document.getElementById('saved-ads-container');
  if (!container) return;
  if (!state.savedAds.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">💾</div>
        <h3>Biblioteca vazia</h3>
        <p>Na aba Inteligência, clique em 💾 para salvar anúncios aqui</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="navigate('intelligence')">🔍 Pesquisar Anúncios</button>
      </div>`;
    return;
  }
  const scores   = state.savedAds.map(a => a._score || scoreAd(a));
  const avgScore = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
      <div>
        <h2 style="font-family:var(--font-h);font-weight:800;font-size:20px">💾 Anúncios Salvos</h2>
        <p style="font-size:13px;color:var(--text2);margin-top:4px">
          ${state.savedAds.length} anúncios · Score médio: <strong style="color:var(--accent)">${avgScore}</strong>
        </p>
      </div>
      <button class="btn btn-danger btn-sm" onclick="if(confirm('Limpar todos os salvos?'))clearAllSaved()">🗑 Limpar Tudo</button>
    </div>
    <div id="savedGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:20px"></div>`;

  const grid = document.getElementById('savedGrid');
  state.savedAds.forEach(ad => grid.appendChild(createSavedCard(ad)));
}

function createSavedCard(ad) {
  const score   = ad._score || scoreAd(ad);
  const body    = ad.ad_creative_bodies?.[0] || '';
  const date    = ad.ad_delivery_start_time
    ? new Date(ad.ad_delivery_start_time).toLocaleDateString('pt-BR') : 'N/D';
  const savedAt = ad._savedAt ? new Date(ad._savedAt).toLocaleDateString('pt-BR') : '';
  const adEncoded = encodeURIComponent(JSON.stringify(ad));

  const card = document.createElement('div');
  card.className = 'ad-card';

  // buildPreviewWrap retorna elemento DOM
  const previewEl = buildPreviewWrap(ad, function() { openAdDetail(adEncoded); });
  card.appendChild(previewEl);

  const body_div = document.createElement('div');
  body_div.className = 'ad-body';
  body_div.innerHTML = `
    <div class="ad-page-name">${ad.page_name||'Página Anunciante'}</div>
    <div class="ad-copy-text">${body||'<em style="color:var(--text3)">Sem texto</em>'}</div>
    <div class="ad-meta-row">
      <span class="ad-date">📅 Ativo: ${date}</span>
      ${savedAt ? `<span class="ad-date">💾 ${savedAt}</span>` : ''}
    </div>
    <div class="ad-meta-row" style="margin-top:2px">${scoreBadge(score)}</div>
    <div class="ad-card-footer">
      <div class="score-ring ${scoreClass(score)}">${score}</div>
      <button class="btn btn-ghost btn-sm" onclick="openAdDetail('${adEncoded}')">👁 Ver</button>
      <button class="btn btn-danger btn-sm" onclick="removeSavedAd('${ad.id}')">🗑 Remover</button>
    </div>`;
  card.appendChild(body_div);

  return card;
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── DASHBOARD ─────────────────────────────────────────────────
function updateDashboard() {
  document.getElementById('m-searches').textContent = state.searchHistory.length;
  document.getElementById('m-ads').textContent      = state.totalAdsAnalyzed;
  document.getElementById('m-saved').textContent    = state.savedAds.length;
  const scores = state.savedAds.map(a => a._score || scoreAd(a));
  document.getElementById('m-score').textContent    = scores.length
    ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : '—';

  const hist = document.getElementById('searchHistory');
  hist.innerHTML = !state.searchHistory.length
    ? '<div class="empty-state" style="padding:28px"><div class="icon">🔍</div><h3>Nenhuma busca ainda</h3></div>'
    : state.searchHistory.slice(0,8).map(h=>`
        <div class="history-item" onclick="document.getElementById('searchInput').value='${h.term}';navigate('intelligence')">
          <div>
            <div class="history-term">🔍 ${h.term}</div>
            <div class="history-meta">🌍 ${h.country} · ${new Date(h.date).toLocaleDateString('pt-BR')} · ${h.count} resultados</div>
          </div>
          <span style="color:var(--text3)">›</span>
        </div>`).join('');

  const high=scores.filter(s=>s>=70).length, mid=scores.filter(s=>s>=40&&s<70).length, low=scores.filter(s=>s<40).length;
  const t=scores.length||1;
  document.getElementById('sc-high').textContent=high; document.getElementById('sp-high').style.width=(high/t*100)+'%';
  document.getElementById('sc-mid').textContent=mid;   document.getElementById('sp-mid').style.width=(mid/t*100)+'%';
  document.getElementById('sc-low').textContent=low;   document.getElementById('sp-low').style.width=(low/t*100)+'%';
  document.getElementById('miniChart').innerHTML=scores.slice(-12).map(s=>
    `<div class="bar" style="height:${s}%;background:${scoreColor(s)}" title="${s}"></div>`).join('');
  updateSavedCount();
}

function clearSearchHistory() {
  state.searchHistory=[]; localStorage.removeItem('adhelp_history');
  updateDashboard(); showToast('Histórico limpo!','success');
}

// ── STRATEGY ──────────────────────────────────────────────────
const kwSets = {
  ecommerce:{top:['comprar','loja virtual','frete grátis','desconto','promoção'],mid:['melhor preço','avaliações','garantia','comparar'],bot:['comprar agora','carrinho','checkout']},
  saude:    {top:['saúde','emagrecer','dieta','vitamina','suplemento'],mid:['como perder peso','eficácia','resultado'],bot:['comprar suplemento','kit saúde']},
  educacao: {top:['aprender','curso','aula','carreira','certificado'],mid:['melhor curso','plataforma','depoimentos'],bot:['matricular','inscrever','acesso imediato']},
  beleza:   {top:['beleza','maquiagem','skincare','cabelo','pele'],mid:['review','antes e depois','como usar'],bot:['comprar produto','kit completo']},
  tech:     {top:['tecnologia','app','software','automação','SaaS'],mid:['funcionalidades','melhor software'],bot:['assinar','teste grátis','plano']},
  financas: {top:['investir','renda extra','liberdade financeira'],mid:['como investir','rendimento'],bot:['abrir conta','aplicar agora']},
  imoveis:  {top:['apartamento','casa','comprar imóvel','lançamento'],mid:['bairro','financiamento'],bot:['agendar visita','proposta']},
  fitness:  {top:['academia','treino','musculação','esporte'],mid:['personal online','resultados reais'],bot:['contratar personal','plano anual']}
};
let activeKeywords = [];
function generateKeywords() {
  const s=kwSets[document.getElementById('kwCategory').value]||kwSets.ecommerce;
  activeKeywords=[...s.top,...s.mid,...s.bot]; renderKwTags();
}
function renderKwTags() {
  document.getElementById('keywordTags').innerHTML=activeKeywords.map((kw,i)=>
    `<span class="keyword-tag">${kw}<span class="remove" onclick="removeKw(${i})">✕</span></span>`).join('');
}
function removeKw(i){activeKeywords.splice(i,1);renderKwTags();}
function addCustomKw(){
  const inp=document.getElementById('customKw'),v=inp.value.trim();if(!v)return;
  activeKeywords.push(v);inp.value='';renderKwTags();
}
function autoFillFunnel(){
  const s=kwSets[document.getElementById('kwCategory').value]||kwSets.ecommerce;
  document.getElementById('funnel-top').innerHTML=s.top.map(k=>`<span class="tag">${k}</span>`).join('');
  document.getElementById('funnel-mid').innerHTML=s.mid.map(k=>`<span class="tag">${k}</span>`).join('');
  document.getElementById('funnel-bot').innerHTML=s.bot.map(k=>`<span class="tag">${k}</span>`).join('');
  showToast('Funil preenchido!','success');
}
function exportKwCSV(){
  if(!activeKeywords.length){showToast('Gere palavras-chave primeiro','error');return;}
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['Palavra-chave\n'+activeKeywords.join('\n')],{type:'text/csv'})),download:'keywords.csv'});
  a.click();showToast('CSV exportado!','success');
}
function generateCopy(){
  const product=document.getElementById('adProduct').value.trim();
  if(!product){showToast('Preencha o produto','error');return;}
  const audience=document.getElementById('adAudience').value.trim()||'Você';
  const benefit=document.getElementById('adBenefit').value.trim()||'resultados reais';
  const hooks={urgente:'🔥 ATENÇÃO',emocional:'💛 Uma história real',racional:'📊 Dados comprovam',provocativo:'🤔 Você ainda não fez isso?'};
  const hook=hooks[document.getElementById('adTone').value];
  const aida=`${hook}: ${product}\n\n✅ Atenção: ${audience} precisa conhecer isso.\n💡 Interesse: ${benefit} alcançável em dias.\n🎯 Desejo: Imagine sua vida com ${product.toLowerCase()}.\n🚀 Ação: Clique e garanta sua vaga!`;
  const pas=`Cansado de não ver resultado com ${product.toLowerCase()}?\n\n😔 Problema: ${audience} tenta e não consegue.\n🔥 Agitação: Sem ${benefit} é tempo perdido.\n✅ Solução: ${product} — comprovado.\n\n👉 Acesse agora!`;
  const cta=`${hook}!\n\n${product} para ${audience}.\n→ ${benefit}\n→ Suporte incluso\n→ Acesso imediato\n\n⏰ Oferta encerra em breve.\n👆 CLIQUE AGORA!`;
  document.getElementById('adCopyResults').innerHTML=[['📐 AIDA',aida],['🎯 PAS',pas],['🚀 CTA',cta]].map(([t,txt])=>
    `<div class="copy-framework"><h5>${t}</h5><div class="copy-output">${txt}</div>
     <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick='copyText(${JSON.stringify(txt)})'>📋 Copiar</button></div>`).join('');
  showToast('Copies geradas!','success');
}
function copyText(t){navigator.clipboard.writeText(t).then(()=>showToast('Copiado!','success'));}

// ── CANVAS / MAPA ─────────────────────────────────────────────
let nodeCounter = 0;
const getVP     = () => document.getElementById('map-viewport');
const getCanvas = () => document.getElementById('map-canvas');

function applyVP() {
  const c = getCanvas();
  if (c) c.style.transform = `translate(${state.vpX}px,${state.vpY}px) scale(${state.vpScale})`;
}

function initCanvasZoom() {
  getVP().addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const ns    = Math.min(Math.max(state.vpScale * delta, 0.15), 5);
    const rect  = getVP().getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    state.vpX   = mx - (mx - state.vpX) * (ns / state.vpScale);
    state.vpY   = my - (my - state.vpY) * (ns / state.vpScale);
    state.vpScale = ns;
    applyVP();
    const el = document.getElementById('zoom-level');
    if (el) el.textContent = Math.round(ns*100)+'%';
  }, { passive:false });
}

let spaceDown = false;
document.addEventListener('keydown', e => {
  if (e.key===' '){ spaceDown=true; if(document.activeElement.tagName!=='INPUT'&&document.activeElement.contentEditable!=='true') e.preventDefault(); }
  if ((e.ctrlKey||e.metaKey)&&e.key==='z'){ e.preventDefault(); undoCanvas(); }
  if ((e.ctrlKey||e.metaKey)&&e.key==='y'){ e.preventDefault(); redoCanvas(); }
  if ((e.key==='Delete'||e.key==='Backspace')&&document.activeElement.contentEditable!=='true'&&document.activeElement.tagName!=='INPUT') deleteSelected();
});
document.addEventListener('keyup', e => { if(e.key===' ') spaceDown=false; });

function onVPDown(e) {
  if (e.button===1 || (e.button===0&&spaceDown)) {
    e.preventDefault();
    state.isPanning=true; state.panStartX=e.clientX; state.panStartY=e.clientY;
    state.panOriginX=state.vpX; state.panOriginY=state.vpY;
    getVP().classList.add('panning');
  }
}

// Caixa com borda
function addNode(text='Novo Bloco') {
  const id=`n${++nodeCounter}`;
  const cx=(getVP().clientWidth/2-state.vpX)/state.vpScale-100;
  const cy=(getVP().clientHeight/2-state.vpY)/state.vpScale-35;
  const node=document.createElement('div');
  node.className='canvas-node'; node.id=id;
  node.style.cssText=`left:${cx+Math.random()*80-40}px;top:${cy+Math.random()*60-30}px;width:200px;min-height:70px;border-color:${state.nodeColor};font-size:${state.nodeFontSize}px;font-family:'${state.nodeFontFamily}',sans-serif`;
  node.innerHTML=`<div class="node-label" contenteditable="true"
    onmousedown="event.stopPropagation()"
    onfocus="selectNode('${id}')"
    onblur="saveCanvasState()">${text}</div>
    <div class="resize-handle" data-node="${id}"></div>`;
  node.addEventListener('mousedown', onNodeDown);
  getCanvas().appendChild(node);
  saveCanvasState();
  setTimeout(()=>node.querySelector('.node-label').focus(), 50);
  return node;
}

// Texto livre (sem caixa)
function addTextNode(text='Texto livre') {
  const id=`t${++nodeCounter}`;
  const cx=(getVP().clientWidth/2-state.vpX)/state.vpScale-80;
  const cy=(getVP().clientHeight/2-state.vpY)/state.vpScale-20;
  const node=document.createElement('div');
  node.className='canvas-node text-node'; node.id=id;
  node.style.cssText=`left:${cx+Math.random()*80-40}px;top:${cy+Math.random()*60-30}px;width:200px;min-height:32px;border-color:transparent;background:transparent;box-shadow:none;padding:4px 6px;font-size:${state.nodeFontSize}px;font-family:'${state.nodeFontFamily}',sans-serif;color:${state.nodeColor}`;
  node.innerHTML=`<div class="node-label" contenteditable="true"
    onmousedown="event.stopPropagation()"
    onfocus="selectNode('${id}')"
    onblur="saveCanvasState()"
    style="color:${state.nodeColor};min-width:60px">${text}</div>
    <div class="resize-handle" data-node="${id}"></div>`;
  node.addEventListener('mousedown', onNodeDown);
  getCanvas().appendChild(node);
  saveCanvasState();
  setTimeout(()=>node.querySelector('.node-label').focus(), 50);
  return node;
}

function selectNode(id) {
  document.querySelectorAll('.canvas-node').forEach(n=>n.classList.remove('selected'));
  const n=document.getElementById(id);
  if(n){ n.classList.add('selected'); state.selectedNode=id; }
}
function deleteSelected() {
  if(!state.selectedNode) return;
  const n=document.getElementById(state.selectedNode);
  if(n){ n.remove(); state.selectedNode=null; saveCanvasState(); showToast('Elemento removido','info'); }
}

function onNodeDown(e) {
  if(e.target.classList.contains('resize-handle')){
    e.preventDefault(); e.stopPropagation();
    selectNode(e.target.dataset.node);
    const n=document.getElementById(e.target.dataset.node);
    state.resizingNode=n; state.resizeStartW=n.offsetWidth; state.resizeStartH=n.offsetHeight;
    state.resizeMouseX=e.clientX; state.resizeMouseY=e.clientY; return;
  }
  if(e.target.contentEditable==='true') return;
  e.preventDefault(); e.stopPropagation();
  selectNode(e.currentTarget.id);
  state.draggingNode=e.currentTarget;
  state.dragStartX=e.clientX; state.dragStartY=e.clientY;
  state.nodeStartX=parseFloat(e.currentTarget.style.left);
  state.nodeStartY=parseFloat(e.currentTarget.style.top);
}

document.addEventListener('mousemove', e => {
  if(state.isPanning){ state.vpX=state.panOriginX+(e.clientX-state.panStartX); state.vpY=state.panOriginY+(e.clientY-state.panStartY); applyVP(); return; }
  if(state.resizingNode){
    const dw=(e.clientX-state.resizeMouseX)/state.vpScale;
    const dh=(e.clientY-state.resizeMouseY)/state.vpScale;
    state.resizingNode.style.width    =Math.max(80,state.resizeStartW+dw)+'px';
    state.resizingNode.style.minHeight=Math.max(30,state.resizeStartH+dh)+'px'; return;
  }
  if(state.draggingNode){
    const dx=(e.clientX-state.dragStartX)/state.vpScale;
    const dy=(e.clientY-state.dragStartY)/state.vpScale;
    state.draggingNode.style.left=(state.nodeStartX+dx)+'px';
    state.draggingNode.style.top =(state.nodeStartY+dy)+'px';
  }
});

document.addEventListener('mouseup', ()=>{
  if(state.isPanning){ state.isPanning=false; getVP()?.classList.remove('panning'); }
  if(state.resizingNode){ saveCanvasState(); state.resizingNode=null; }
  if(state.draggingNode){ saveCanvasState(); state.draggingNode=null; }
});

function setNodeColor(color, el) {
  state.nodeColor=color;
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  if(!state.selectedNode) return;
  const n=document.getElementById(state.selectedNode);
  if(!n) return;
  if(n.classList.contains('text-node')){
    n.style.color=color;
    const lbl=n.querySelector('.node-label');
    if(lbl) lbl.style.color=color;
  } else {
    n.style.borderColor=color;
  }
}

function applyFontSize() {
  state.nodeFontSize=parseInt(document.getElementById('nodeFontSize').value)||14;
  if(!state.selectedNode) return;
  const n=document.getElementById(state.selectedNode);
  if(n) n.style.fontSize=state.nodeFontSize+'px';
}

function applyFontFamily() {
  state.nodeFontFamily=document.getElementById('nodeFontFamily').value||'Inter';
  if(!state.selectedNode) return;
  const n=document.getElementById(state.selectedNode);
  if(n) n.style.fontFamily=`'${state.nodeFontFamily}',sans-serif`;
}

function zoomIn()    { state.vpScale=Math.min(state.vpScale*1.2,5);     applyVP(); document.getElementById('zoom-level').textContent=Math.round(state.vpScale*100)+'%'; }
function zoomOut()   { state.vpScale=Math.max(state.vpScale*0.83,0.15); applyVP(); document.getElementById('zoom-level').textContent=Math.round(state.vpScale*100)+'%'; }
function zoomReset() { state.vpScale=1; state.vpX=0; state.vpY=0; applyVP(); document.getElementById('zoom-level').textContent='100%'; }

function saveCanvasState() {
  const c=getCanvas(); if(!c) return;
  state.canvasHistory.push(c.innerHTML);
  if(state.canvasHistory.length>40) state.canvasHistory.shift();
  state.canvasRedo=[];
}
function undoCanvas(){
  if(state.canvasHistory.length<=1){showToast('Nada para desfazer','info');return;}
  state.canvasRedo.push(state.canvasHistory.pop());
  getCanvas().innerHTML=state.canvasHistory[state.canvasHistory.length-1];
  rebindNodes(); showToast('Desfeito','info');
}
function redoCanvas(){
  if(!state.canvasRedo.length){showToast('Nada para refazer','info');return;}
  getCanvas().innerHTML=state.canvasRedo.pop();
  state.canvasHistory.push(getCanvas().innerHTML);
  rebindNodes(); showToast('Refeito','info');
}
function rebindNodes(){
  document.querySelectorAll('.canvas-node').forEach(n=>{
    n.removeEventListener('mousedown',onNodeDown);
    n.addEventListener('mousedown',onNodeDown);
  });
}
function clearCanvas(){
  if(!confirm('Limpar o mapa?')) return;
  state.canvasHistory=[]; state.canvasRedo=[];
  getCanvas().innerHTML=''; nodeCounter=0;
  saveCanvasState(); showToast('Canvas limpo','info');
}

// ── PLANNING ──────────────────────────────────────────────────
function calcPlanning(){
  const budget=parseFloat(document.getElementById('budgetDaily').value)||0;
  const cpc   =parseFloat(document.getElementById('cpcAvg').value)||1;
  const conv  =parseFloat(document.getElementById('convRate').value)||0;
  const ticket=parseFloat(document.getElementById('avgTicket').value)||0;
  const days  =parseFloat(document.getElementById('planDays').value)||30;
  const total=budget*days, clicks=Math.round(total/cpc);
  const converts=Math.round(clicks*conv/100), revenue=converts*ticket;
  document.getElementById('r-revenue').textContent     ='R$ '+revenue.toLocaleString('pt-BR');
  document.getElementById('r-profit').textContent      ='R$ '+(revenue-total).toLocaleString('pt-BR');
  document.getElementById('r-clicks').textContent      =clicks.toLocaleString('pt-BR');
  document.getElementById('r-conversions').textContent =converts.toLocaleString('pt-BR');
  document.getElementById('scaleResults').innerHTML=[
    {label:'2× Conjuntos',mult:2,type:'Horizontal',color:'var(--accent)'},
    {label:'3× Conjuntos',mult:3,type:'Horizontal',color:'var(--accent2)'},
    {label:'+50% Orçamento',mult:1.5,type:'Vertical',color:'var(--green)'},
    {label:'2× Orçamento',mult:2,type:'Vertical',color:'var(--yellow)'},
  ].map(s=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
    <div><div style="font-size:13px;font-weight:600">${s.label} <span class="badge badge-blue" style="font-size:10px">${s.type}</span></div></div>
    <div style="text-align:right">
      <div style="font-size:14px;font-weight:800;font-family:var(--font-h);color:${s.color}">R$ ${(revenue*s.mult).toLocaleString('pt-BR')}</div>
      <div style="font-size:10px;color:var(--text3)">receita estimada</div>
    </div>
  </div>`).join('');
}
function selectStrategy(t){
  state.selectedStrategy=t;
  document.getElementById('abo-card').classList.toggle('selected',t==='ABO');
  document.getElementById('cbo-card').classList.toggle('selected',t==='CBO');
  showToast(`Estratégia ${t} selecionada!`,'success');
}

// ── SETTINGS ──────────────────────────────────────────────────
function initSettingsToken(){
  const saved=localStorage.getItem('adhelp_token');
  document.getElementById('apiTokenInput').value=saved||'';
  document.getElementById('tokenStatus').textContent=saved?'✓ Token personalizado':'✓ Token padrão';
}
function saveApiToken(){
  const v=document.getElementById('apiTokenInput').value.trim();
  if(!v){showToast('Cole o token antes de salvar','error');return;}
  localStorage.setItem('adhelp_token',v);
  document.getElementById('tokenStatus').textContent='✓ Token personalizado';
  showToast('Token salvo!','success');
}
function toggleTokenVis(){
  const inp=document.getElementById('apiTokenInput');
  inp.type=inp.type==='password'?'text':'password';
}
function clearAllSaved(){
  state.savedAds=[]; localStorage.removeItem('adhelp_saved');
  updateSavedCount(); renderSavedPage(); showToast('Anúncios removidos!','success');
}
function resetAll(){
  if(!confirm('Apagar TODOS os dados locais?')) return;
  localStorage.clear(); state.searchHistory=[]; state.savedAds=[]; state.totalAdsAnalyzed=0;
  updateDashboard(); updateSavedCount(); showToast('Sistema resetado!','success');
}

// ── RESPONSIVE ────────────────────────────────────────────────
function handleResize(){
  const btn=document.getElementById('mobileMenuBtn');
  if(btn) btn.style.display=window.innerWidth<=640?'flex':'none';
  if(window.innerWidth>640) document.getElementById('sidebar')?.classList.remove('mobile-open');
}
window.addEventListener('resize', handleResize);

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('themeSwitch').classList.toggle('on', state.theme==='dark');
  const vp=getVP();
  if(vp){ vp.addEventListener('mousedown', onVPDown); initCanvasZoom(); saveCanvasState(); }
  document.querySelectorAll('.modal-overlay').forEach(o=>{
    o.addEventListener('click', e=>{ if(e.target===o) o.classList.remove('open'); });
  });
  handleResize();
  updateDashboard();
  calcPlanning();
  setTimeout(()=>showToast('ADHELP v4 — Pronto 🚀','info'), 700);
});
