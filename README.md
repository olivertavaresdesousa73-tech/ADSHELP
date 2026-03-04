# 🚀 ADHELP — Ferramenta de Inteligência de Anúncios

## 📁 Estrutura do Projeto

```
adhelp/
├── netlify.toml                  ← Configuração Netlify (SPA + Functions)
├── netlify/
│   └── functions/
│       ├── ads.js                ← Proxy Meta API (sem CORS)
│       └── snapshot.js           ← Extrai imagens dos anúncios
├── frontend/                     ← Pasta publicada no Netlify
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── images/
│       └── LEIA-ME.txt           ← Coloque logo.png aqui
└── backend/                      ← Servidor alternativo (VPS/local)
    ├── server.js
    ├── package.json
    └── .env.example
```

---

## ⚡ Deploy no Netlify (RECOMENDADO — Grátis)

### Passo 1 — Subir no GitHub
```bash
git init
git add .
git commit -m "ADHELP inicial"
git remote add origin https://github.com/SEU_USER/adhelp.git
git push -u origin main
```

### Passo 2 — Conectar ao Netlify
1. Acesse https://netlify.com e faça login
2. Clique em **"Add new site" → "Import an existing project"**
3. Conecte ao GitHub e selecione o repositório

### Passo 3 — Configurar Build Settings
```
Build command:   (deixar vazio)
Publish directory:  frontend
```
> O arquivo `netlify.toml` já configura isso automaticamente.

### Passo 4 — Variáveis de Ambiente (IMPORTANTE)
No painel do Netlify:
**Site Settings → Environment variables → Add variable**

| Chave | Valor |
|-------|-------|
| `META_ACCESS_TOKEN` | `seu_token_da_meta_api` |

> Sem isso, a busca de anúncios não funcionará em produção.

### Passo 5 — Deploy
Clique em **"Deploy site"** — em ~1 minuto o site estará no ar!

---

## 🔑 Como obter o Token da Meta API

1. Acesse: https://developers.facebook.com/tools/explorer/
2. Selecione seu App (ou crie um em developers.facebook.com)
3. Adicione permissão: `ads_read`
4. Clique em **"Generate Access Token"**
5. Copie o token e cole em:
   - **Netlify:** variável `META_ACCESS_TOKEN`
   - **Painel ADHELP:** Configurações → Token de API

> ⚠️ Tokens de usuário expiram em ~60 dias. Para tokens permanentes, use um "System User Token" via Meta Business Manager.

---

## 🖼️ Logo Personalizada

Coloque sua logo em:
```
frontend/images/logo.png
```
Recomendado: 64×64px ou 128×128px, fundo transparente (PNG).

---

## 🗺️ Funcionalidades do Mapa

| Ação | Como fazer |
|------|-----------|
| Zoom in/out | Scroll do mouse |
| Mover canvas | Segurar Espaço + arrastar |
| Adicionar bloco | Botão "+ Bloco" |
| Mover bloco | Arrastar o bloco |
| Redimensionar | Arrastar o canto inferior direito |
| Editar texto | Duplo clique no bloco |
| Mudar cor | Selecionar bloco + clicar na cor |
| Desfazer/Refazer | Botões ↩ ↪ |

---

## 💻 Rodar Localmente (sem Netlify)

```bash
cd backend
npm install
cp .env.example .env   # configure o token
npm start
# Acesse: http://localhost:3001
```

---

## 📡 Arquitetura

```
Netlify (produção)
  Browser → /.netlify/functions/ads → Meta Graph API
  Browser → /.netlify/functions/snapshot → Extrai imagem do criativo

Local (desenvolvimento)  
  Browser → corsproxy.io → Meta Graph API
```

---

## 📝 Licença
Uso privado. Todos os direitos reservados — ADHELP.
