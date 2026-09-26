# Athéna — Architecture complète du système

> Dernière mise à jour : 2026-09-26 · pipeline v10.9.4 · Pages `?v=20260925ak`

---

## 1. Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────────┐
│  UTILISATEUR                                                            │
│  Navigateur (Pages GitHub  OU  Next.js :3000 local)                     │
│    ├─ index.html / page.tsx   (coquille DOM monochrome)                 │
│    ├─ chat-demo.js   (UI chat, streaming NDJSON, HUD modèles + effort)  │
│    ├─ keys.js                 (clés API — PUBLIC, choix utilisateur)    │
│    └─ api-shim.js             (Pages seulement) intercepte /api/*       │
└───────────────┬─────────────────────────────────────┬───────────────────┘
                │ GitHub Pages (statique)             │ Local dev
                ▼                                     ▼
┌───────────────────────────────┐   ┌─────────────────────────────────────┐
│  PROVIDERS CLOUD (navigateur) │   │  STACK COMPLET (localhost)          │
│  • Pollinations  (gratuit)    │   │                                     │
│  • OpenRouter    (:free)      │   │  Next.js :3000                      │
│  • Groq / OpenAI / … (clé)    │   │    └─ /api/chat → sidecar :3010     │
│  • Tokenrouter via Worker CF  │   │         (llm-chat / FastAPI)        │
│                               │   │              │                      │
│  Cascade + retry + rotation   │   │              ▼                      │
│  models[] max 3 OpenRouter    │   │         bridge :3015 (Bun)          │
│                               │   │         cascade + circuit-breaker   │
└───────────────────────────────┘   │              │                      │
                                    │              ▼                      │
                                    │         providers cloud/locaux      │
                                    │                                     │
                                    │  local-agent :3020 (Node)           │
                                    │  ★ exécution de commandes PC ★      │
                                    └─────────────────────────────────────┘
```

**Deux modes de fonctionnement :**

| Mode | Entrée | LLM | Pipeline | Commandes PC |
|------|--------|-----|----------|--------------|
| **Pages** (prod) | `athena-cyber1.github.io/Athena` | navigateur → providers | shim-only (pas de crans) | via local-agent si démarré |
| **Stack local** | `localhost:3000` | bridge :3015 | agent complet :3010 | local-agent :3020 + outil agent |

---

## 2. Arborescence du dépôt

```
Athena/                          ← racine git (repo Athena-Cyber1/Athena)
├── ARCHITECTURE.md              ← CE DOCUMENT
├── README.md                    ← lancement rapide du stack
├── .gitignore                   ← secrets / data / build exclus
│
├── design/                      ★ SOURCE DE TOUS LES FICHIERS DESIGN
│   ├── athena-demo.css          design monochrome (tokens + composants)
│   ├── logo.svg                 favicon / marque
│   ├── theme-loader.js          import de thème (/api/design)
│   └── theme-importe.json       dernier thème importé
│
├── docs/                        ★ SOURCE DE LA GITHUB PAGES
│   ├── index.html               coquille DOM (sidebar + chat)
│   ├── api-shim.js              intercepteur fetch → providers réels
│   ├── chat-demo.js             logique chat (stream, HUD, markdown)
│   ├── keys.js                  clés API (PUBLIC — plafond limité)
│   ├── .nojekyll                désactive Jekyll Pages
│   └── design/                  sortie générée depuis design/ (servie par Pages)
│
├── src/                         ★ APPLICATION NEXT.JS (dev local)
│   ├── app/
│   │   ├── page.tsx             coquille DOM alignée sur docs/index.html
│   │   ├── layout.tsx           importe design/athena-demo.css
│   │   ├── not-found.tsx
│   │   └── api/
│   │       ├── chat/route.ts    passerelle → sidecar :3010
│   │       ├── modeles/         catalogue modèles
│   │       ├── files/           upload / fichiers
│   │       ├── entrainer/       entraînement
│   │       ├── design/          thèmes (lit/écrit design/theme-importe.json)
│   │       └── route.ts         racine API
│   ├── lib/                     db.ts, secu.ts (garde origine)
│   └── proxy.ts                 en-têtes sécurité (ex-middleware)
│
├── public/                      assets Next générés (design/ + docs/)
│   ├── design/                  sortie générée depuis design/
│   ├── robots.txt
│   └── chat-demo.js             sortie générée depuis docs/chat-demo.js
│
├── mini-services/               ★ SERVICES LOCAUX INDÉPENDANTS
│   ├── llm-bridge/              :3015  Bun — cascade multi-provider
│   │   ├── index.ts             pollinations → zai → locaux, circuit-breaker
│   │   ├── package.json / bun.lock / daemon.sh
│   ├── llm-chat/                :3010  Python — moteur Athéna (agent)
│   │   ├── serveur.py           HTTP mince → run_agent()
│   │   ├── athena/
│   │   │   ├── agent/           agent.py, planner, skills, executor, critic…
│   │   │   ├── llm/             engine.py (→ bridge), prompts.py
│   │   │   ├── tools/           registry, enregistres (solveur, sandbox…)
│   │   │   ├── memory/          store.py (fils, faits, RAG)
│   │   │   ├── verification/    canari, math, code, grammar, facts, riddle
│   │   │   └── evals/           runner.py + datasets
│   │   ├── tests/ qa/           suites golden
│   │   └── daemon.sh
│   └── local-agent/             :3020  Node — ★ commandes PC ★
│       ├── index.js             HTTP 127.0.0.1, déni motifs, confirm
│       └── package.json
│
├── worker/                      proxy CORS Cloudflare (tokenrouter, nvidia)
│   ├── index.js
│   └── wrangler.toml
│
└── tools/                       scripts utilitaires (non prod)
    └── check.js
```

---

## 3. Flux détaillés

### 3.1 Chat sur GitHub Pages (mode dégradé)

```
chat-demo.js
  POST /api/chat {messages, stream:true, model_id?, outils?}
       │
       ▼
api-shim.js  (intercepte window.fetch)
  1. catalogue()  → liste modèles (static + tokenrouter dyn)
  2. construireChaine(model_id)
       • modèle choisi en tête
       • UN seul slot openrouter-free (models[] couvre le trio)
       • pollinations et autres en secours
  3. callModel(entry)
       • OpenRouter free : body.models = [choisi, autre1, autre2] (max 3)
       • retry 429/502/503 : rotation + backoff 700/1800 ms
       • quota free/min : attend X-RateLimit-Reset (max 64 s)
       • content vide → fallback reasoning
  4. progress NDJSON : « Réponse générée via <modèle réel> »
  5. final {reponse, modele_repli?}
```

### 3.2 Chat stack local (pipeline complet)

```
chat-demo.js
  POST /api/chat
       │
       ▼
Next route.ts  (sanitization + garde origine)
  traduit messages → {question, historique, fil_id, model_id, attachments}
       │
       ▼
sidecar llm-chat :3010  serveur.py → run_agent()
  COMPRENDRE → PLANNER → [outil → observe → verify → critic → replan?] → FINAL
  outils autorité : solveur_math, simulateur_code, grammaire, devinette
  outils data    : recherche_web, recherche_fichiers, python_sandbox
       │
       ▼ (quand le LLM est needed)
bridge llm-bridge :3015
  cascade : pollinations(openai-fast) → zai-principal → zai-alternatif
  circuit-breaker / 8 échecs → pause 20 s
  cache LRU 60×15 min, limiteur 2 en vol
       │
       ▼
providers distants ou locaux (Ollama/LM Studio/llama.cpp)
```

### 3.3 Exécution de commandes sur le PC

```
┌─ Modèle (LLM) ─────────────────────────────────────────┐
│  produit un bloc :                                      │
│  ```athena-exec                                         │
│  dir C:\Users                                           │
│  ```                                                    │
└──────────────────────┬──────────────────────────────────┘
                       │ chat-demo détecte le bloc (réponse fraîche)
                       ▼
              exécution AUTOMATIQUE (préf. executionAuto, ON) :
              POST /api/exec {commande, confirme:true} — sans modale
              • si executionAuto est décoché : bouton « Exécuter »
                puis modale de confirmation (flux428 → confirme:true)
                       │
                       ▼
              POST /api/exec {commande}
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
   Pages : api-shim          Stack : Next /api (option)
          │                         │
          └──────────┬──────────────┘
                     ▼
         http://127.0.0.1:3020/exec
         mini-services/local-agent
           • origin CORS (Pages + localhost)
           • liste de refus (rm -rf, format, pipe sh…)
           • confirme:true requis (ou --auto)
           • timeout 20 s, sortie 64 Ko
           • journal
                     │
                     ▼
              spawn powershell / sh
                     │
                     ▼
              stdout / stderr / code → UI
```

**Démarrage de l'agent :**

```bash
node mini-services/local-agent/index.js
# ou dev sans confirmation :
node mini-services/local-agent/index.js --auto
# restreindre un dossier :
node mini-services/local-agent/index.js --allow "C:\Users\me\Documents"
```

**Contrat HTTP local-agent :**

| Route | Méthode | Corps | Réponse |
|-------|---------|-------|---------|
| `/sante` | GET | — | `{ok, version, auto, allow_dir, platform, user, host}` |
| `/journal` | GET | — | `{entrees: [...]}` |
| `/exec` | POST | `{commande, confirme?, cwd?, timeout_ms?}` | `{ok, code, stdout, stderr, duree_ms}` ou `428` sans confirm |

---

## 4. Catalogue des MODÈLES GRATUITS

### 4.1 OpenRouter — `:free` (compte gratuit, 0 crédit, 20 req/min)

Inventaire API `openrouter.ai/api/v1/models` (2026-09-24) :

| ID | Nom | Contexte |
|----|-----|----------|
| `z-ai/glm-5.2:free` | Z.ai GLM 5.2 | 32k |
| `google/gemma-4-31b-it:free` | Google Gemma 4 31B | 262k |
| `google/gemma-4-26b-a4b-it:free` | Google Gemma 4 26B | 262k |
| `qwen/qwen3.8-27b:free` | Qwen3.8 27B | 262k |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | Nemotron 3 Nano | 256k |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | Nemotron 3 Ultra | 1M |
| `nvidia/nemotron-3-super-120b-a12b:free` | Nemotron 3 Super | 262k |
| `nvidia/nemotron-3.5-lightning:free` | Nemotron 3.5 Lightning | 1M |
| `nvidia/nemotron-3.5-content-safety:free` | Nemotron 3.5 Safety | 128k |
| `thinkingmachines/inkling:free` | Inkling | 1M |
| `thinkingmachines/inkling-small:free` | Inkling Small | 1M |
| `poolside/laguna-s-2.1:free` | Laguna S 2.1 | 262k |
| `poolside/laguna-xs-2.1:free` | Laguna XS 2.1 | 262k |
| `cohere/north-mini-code:free` | North Mini Code | 256k |
| `nex-agi/nex-n2.5-mini:free` | Nex N2.5 Mini | 262k |
| `nex-agi/nex-n2.5-pro:free` | Nex N2.5 Pro | 262k |
| `inclusionai/ling-3.0-flash-sante:free` | Ling 3.0 Flash Santé | 262k |
| `inclusionai/ling-3.0-flash-fin:free` | Ling 3.0 Flash Fin | 262k |
| `dots-studio/dots-3-note-preview:free` | Dots3 Note Preview | 512k |
| `liquid/lfm-2.5-2.6b:free` | LFM2.5 2.6B | 65k |
| `stealth/space-bunny-alpha` | Space Bunny Alpha | 1M |
| `openrouter/free` | Free Models Router (auto) | 200k |

**Actifs dans le HUD Athéna (ordre de cascade `models[]`, max 3 par requête) :**

1. Trio prioritaire : `glm-5.2` · `gemma-4-31b` · `qwen3.8-27b`
2. Extra : `nemotron-nano` · `nemotron-ultra`

**Contraintes OpenRouter free :**
- `models[]` : **3 items max** (400 au-delà)
- Quota **20 requêtes/min** (`free-models-per-min`)
- Chaque free = souvent **1 endpoint amont** → 429 `upstream_provider_shared_pool` fréquent
- Correctifs Athéna : rotation, attente `X-RateLimit-Reset`, fallback Pollinations

### 4.2 Pollinations (sans clé)

| ID | Notes |
|----|-------|
| `openai-fast` | primaire, répond souvent `model: gpt-oss-20b` |

Endpoint : `https://text.pollinations.ai/openai/chat/completions`

### 4.3 Autres cloud (clé dans `keys.js` ou `localStorage.athena_api_keys`)

| Provider | Modèles typiques | Clé |
|----------|------------------|-----|
| groq | llama-3.3-70b, llama-3.1-8b | `gsk_…` |
| openai | gpt-4o-mini | `sk-…` |
| deepseek | deepseek-chat | |
| mistral | mistral-small-latest | |
| together | Llama-3.3-70B-Instruct-Turbo | |
| gemini | gemini-2.0-flash | `AIza…` |
| zai | glm-4.5-air | |
| cerebras / nebius / xai | llama-3.3-70b / grok-3-mini | |
| tokenrouter | catalogue dyn (300+) via Worker CF | quota souvent 0 |
| nvidia | 16 modèles gratuits (kimi-k3, glm-5.3, nemotron 3, gemma-4, muse-glimmer…), vérifiés SSE + `reasoning_effort:max` via Worker CF `/nvidia/v1` | `nvapi-…` (free tier 40 RPM, 0 €) |

### 4.4 Locaux (détection best-effort par le bridge)

| Serveur | Endpoint | HUD |
|---------|----------|-----|
| Ollama | `127.0.0.1:11434` | `ollama:<tag>` |
| LM Studio | `127.0.0.1:1234` | `lmstudio:<id>` |
| llama.cpp | `127.0.0.1:8080` | `llamacpp:<id>` |

---

## 5. Contrats d'API

### 5.1 `POST /api/chat` (Pages shim + Next)

**Entrée :**
```json
{
  "messages": [{"role": "user", "content": "…"}],
  "stream": true,
  "model_id": "openrouter:z-ai/glm-5.2:free",
  "outils": true,
  "conversation_id": "conv-abc",
  "skill": "math-exact",
   "attachments": [{"file_id": "f1", "name": "note.txt", "contenu": "… (texte lu côté navigateur — Pages uniquement)"}]
}
```

`skill` (optionnel) force un playbook du registre (`GET /api/skills` → sidecar
`GET /skills`). Absent → sélection auto par type de tâche / motifs
(`athena/agent/skills.py`). Le skill actif figure dans `state.skill`, la trace
(`plan_cree` / `plan_created`) et le paquet final.

Pièces jointes — Pages : le navigateur lit le contenu TEXTE à l'ajout du fichier
(≤ 200 Ko, sniffer binaire, mémoire de session non persistée) et l'envoie dans
`attachments[].contenu` ; le shim l'injecte dans le dernier message (budget total
60 000 caractères, marqué donnée NON FIABLE). Les binaires (PDF, images…)
arrivent sans contenu. Stack locale : le sidecar relit ses chunks indexés
(PDF/DOCX/XLSX inclus). Le client utilise toujours `/api/chat` — la route
historique `/chat-attache` n'existe plus côté Next (le shim la garde pour les
pages en cache).

**Sortie NDJSON :**
```
{"type":"progress","etape":"generation","message":"Réponse générée via glm-5.2 free · openrouter"}
{"type":"jeton","canal":"reponse","texte":"… (texte NOUVEAU — l'UI l'affiche au fil de l'eau)"}
{"type":"final","reponse":"…","outil":null,"verification":null,"rag":null,"tache":null,"conversation_id":"fil-…","raisonnement":null,"modele_repli":false}
```

`jeton` (canal `reponse`|`raisonnement`) : frappe et réflexion EN DIRECT —
émis au fil du SSE amont (Pages). Chemins tamponnés (stack locale) : aucun
jeton, l'UI révèle le texte final en machine à écrire plutôt que d'un bloc.

Erreur : `{"type":"erreur","erreur":"Échec des modèles : …"}`

### 5.2 `POST /api/exec` → local-agent

**Chemin Pages :** UI `lancerCommandeLocale` → shim `/api/exec` → `fetch http://127.0.0.1:3020/exec`
(`targetAddressSpace: 'loopback'` — opt-in Chrome Local Network Access).

**Exécution automatique (défaut) :** la préférence `executionAuto` (`chat-preferences`, ON par
défaut, réglable dans Paramètres → Discussion) fait partir les blocs ```athena-exec d'une
réponse **fraîche** directement en `confirme:true` : le modèle exécute sa commande sur le PC
sans clic ni modale. Le déclenchement n'a lieu qu'au rendu neuf d'une réponse — rejeu,
rechargement et réouverture de conversation ne ré-exécutent rien. Désactiver la préférence
restaure le flux historique (probe `428` → modale → `confirme:true`). Les garde-fous
local-agent (liste de refus, origine, bind 127.0.0.1, timeout, journal) sont identiques
dans les deux cas.

**Sortie en direct :** `POST /api/exec {…, flux:true}` renvoie du NDJSON
(`{type:'sortie',canal,texte}*` puis `{type:'fin', …résultat complet}`) pipé
sans tampon (agent → shim/Next → UI) ; le terminal s'écrit en live dans la
bulle. En cas de coupure, l'UI finalise le partiel — jamais de second POST
(pas de double exécution). Sans `flux` (vieil agent) : JSON unique réutilisé.

**`POST /api/write` → local-agent :** enregistre un fichier créé par le modèle
(blocs ```athena-file chemin="…" — spec dans le prompt système, Pages comme
sidecar) : `{chemin, contenu, confirme?, ecraser?}`. `confirme:false` → 428
(avec `existe`) ; existe sans `ecraser:true` → 409 ; dossiers système interdits,
2 Mo max, `mkdir -p`, journal. En auto (executionAuto), un seul POST ; sinon
probe → modale (écrasement annoncé). Sans agent : bouton Télécharger (le contenu
est persisté dans le texte du message).

**Chemin stack local :** même UI → route Next `src/app/api/exec/route.ts` (proxy serveur,
pas de restriction navigateur / LNA).

**Chrome Local Network Access (2026) :** une page **HTTPS publique** (Pages GitHub) qui
appelle `127.0.0.1` est bloquée tant que l’utilisateur n’a **pas autorisé le site** :
- ⋮ → Informations sur le site → **Local Network** → **Allow**, ou
- `chrome://settings/content/localNetwork` → autoriser `athena-cyber1.github.io`.

Sans permission : erreur **503** explicite (agent injoignable **ou** Local Network bloqué).
Sur `localhost:3000` (stack Next), le proxy serveur contourne la restriction.

Sans agent démarré : `{"erreur":"agent local injoignable…"}`.

### 5.3 Autres routes Pages shim

| Route | Pages |
|-------|-------|
| `GET /api/modeles` | catalogue |
| `GET /api/skills` | registre skills (sidecar) ou `{skills:[],dispo:false}` |
| `POST /api/files` | file_id synthétique |
| `POST /chat-attache` | compatibilité (pages en cache) → même handler que `/api/chat` |
| `POST /api/write` | écriture fichier (agent local) ou 503 honnête |
| `GET/DELETE /api/entrainer` | désactivé (message honnête) |
| `GET/POST/DELETE /api/design` | tokens null / import refusé |

---

## 6. Sécurité

| Surface | Mesure |
|---------|--------|
| Clés API | dans `keys.js` **public** — uniquement plafonds limités/révocables ; priorité `localStorage.athena_api_keys` |
| Pages shim | appels navigateur directs, pas de proxy serveur Athéna |
| Next API | `garderOrigine()` CSRF + sanitization fuite infra (P0) |
| local-agent | **127.0.0.1**, CORS + `Access-Control-Allow-Private-Network`, déni motifs dangereux, confirmation, timeout, journal |
| sidecar | canari anti-injection, FILE_DATA = non fiable, refus exécutables upload |
| Worker | relaie Authorization sans Origin (403 tokenrouter, CORS absent nvidia) |

**Ce que le navigateur ne peut PAS faire seul :** exécuter une commande locale — d'où l'obligation du process `local-agent`.

---

## 7. Lancer le système

```bash
# A. Pages seule (déjà en prod)
#    → https://athena-cyber1.github.io/Athena/

# B. Agent commandes PC (toujours utile)
node mini-services/local-agent/index.js

# C. Stack complet local
bun install && bun run dev          # Next :3000
cd mini-services/llm-bridge && bun --hot index.ts   # :3015
cd mini-services/llm-chat && pip install fastapi uvicorn && bash daemon.sh  # :3010
```

---

## 8. Historique des couches (résumé)

| Couche | Fichiers | Rôle |
|--------|----------|------|
| UI | `chat-demo.js`, `index.html`, `design/athena-demo.css` | chat, HUD (effort `reasoning_effort`), exécution auto des commandes, design |
| Bridge navigateur | `api-shim.js` | catalogue, cascade LLM, exec |
| Passerelle Next | `src/app/api/chat` | validation, sidecar, sanitize |
| Agent déterministe | `mini-services/llm-chat` | planifier→agir→vérifier |
| Pont LLM | `mini-services/llm-bridge` | multi-provider résilient |
| Commandes PC | `mini-services/local-agent` | shell local sécurisé |
| Proxy réseaux | `worker/` | CORS tokenrouter + nvidia |
