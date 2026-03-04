# 🚀 ADHELP — Ferramenta de Inteligência de Anúncios

## 📁 Estrutura do Projeto

```
adhelp/
├── netlify.toml                     ← Configuração Netlify (SPA + Functions)
├── .env.example                     ← Modelo de variáveis de ambiente
├── .gitignore
├── netlify/
│   └── functions/
│       ├── ads.js                   ← Proxy da Meta Ads Library API
│       ├── snapshot.js              ← Extrai imagem/vídeo do criativo
│       └── imgproxy.js              ← Serve mídia do CDN da Meta com CORS correto
├── frontend/                        ← Pasta publicada no Netlify
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── images/
│       └── LEIA-ME.txt             ← Coloque sua logo.png aqui
└── backend/                         ← Servidor alternativo (VPS/local)
    ├── server.js
    ├── package.json
    └── .env.example                 ← (copie o da raiz)
```

---

## ⚡ Deploy no Netlify (Recomendado — Grátis)

### 1 — Subir no GitHub
```bash
git init
git add .
git commit -m "ADHELP inicial"
git remote add origin https://github.com/SEU_USER/adhelp.git
git push -u origin main
```

### 2 — Conectar ao Netlify
1. Acesse https://netlify.com e faça login
2. **Add new site → Import an existing project**
3. Conecte ao GitHub e selecione o repositório

### 3 — Build Settings
```
Build command:      (deixar vazio)
Publish directory:  frontend
```
> O `netlify.toml` já configura isso automaticamente.

### 4 — Variável de Ambiente (OBRIGATÓRIO)
No painel do Netlify: **Site Settings → Environment variables**

| Chave | Valor |
|-------|-------|
| `META_ACCESS_TOKEN` | `seu_token_da_meta_api` |

### 5 — Deploy
Clique em **Deploy site** — em ~1 minuto o site estará no ar.

---

## 🔑 Como obter o Token da Meta API

1. Acesse: https://developers.facebook.com/tools/explorer/
2. Selecione seu App (ou crie em developers.facebook.com)
3. Adicione a permissão: `ads_read`
4. Clique em **Generate Access Token**
5. Cole o token na variável `META_ACCESS_TOKEN` do Netlify

> ⚠️ Tokens de usuário expiram em ~60 dias. Para token permanente, use um **System User Token** via Meta Business Manager.

---

## 🖼️ Como funciona o preview de criativos

O ADHELP usa 3 Netlify Functions para exibir imagens e vídeos dos anúncios sem iframe:

| Function | O que faz |
|----------|-----------|
| `ads.js` | Busca anúncios na Meta Ads Library API |
| `snapshot.js` | Acessa o HTML do anúncio no servidor e extrai `og:image` / `og:video` |
| `imgproxy.js` | Baixa a imagem do CDN da Meta e serve com CORS correto para o browser |

> A Meta bloqueia iframes com `X-Frame-Options: DENY`. Esta solução contorna isso sem violar a política da plataforma — o servidor acessa o snapshot e o frontend exibe a mídia via `<img>` normal.

---

## 🖼️ Logo Personalizada

Coloque sua logo em:
```
frontend/images/logo.png
```
Recomendado: 64×64px, fundo transparente (PNG).

---

## 💻 Rodar Localmente (sem Netlify)

```bash
cd backend
npm install
cp ../.env.example .env   # edite e coloque seu token
npm start
# Acesse: http://localhost:3001
```

---

## 📡 Arquitetura

```
Netlify (produção)
  Browser → /.netlify/functions/ads        → Meta Graph API
  Browser → /.netlify/functions/snapshot   → HTML do snapshot (extrai og:image)
  Browser → /.netlify/functions/imgproxy   → CDN Meta → bytes da imagem

Local (desenvolvimento)
  Browser → corsproxy.io → Meta Graph API
```

---

## 📝 Licença
Uso privado. Todos os direitos reservados — ADHELP.
