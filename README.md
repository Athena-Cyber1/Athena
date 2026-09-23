# Athéna — assistant conversationnel cyber à pipeline déterministe

Dépôt de code source du projet **Athéna** (pipeline v10.9.4).

> ⚠️ Ce dépôt ne contient **que le code** (`src/`, `public/`, `mini-services/`).
> Aucune donnée utilisateur, aucun secret, aucun fichier d'environnement.
> Le site GitHub Pages associé est une **vitrine statique** : voir [Vitrine GitHub Pages](#vitrine-github-pages).

## Architecture

```
Navigateur ──► Next.js :3000 (UI + passerelle /api)
                 │
                 ▼
              sidecar FastAPI :3010 (moteur Athéna — crans déterministes,
                 │                        solveur, canari anti-injection)
                 ▼
              bridge LLM :3015 (cascade de fournisseurs, circuit-breaker,
                 │                 limiteur de concurrence, cache LRU)
                 ▼
              fournisseurs LLM (endpoint gratuit sans clé en primaire,
                                secours SDK, serveurs locaux optionnels)
```

- **`src/`** — application Next.js 16 (App Router, TypeScript) : interface de chat,
  passerelle `/api/chat` (sanitization défensive), `/api/modeles`, HUD de
  sélection de modèle (Actif / Cloud / Local) avec persistance `localStorage`.
- **`public/`** — assets statiques : logique cliente du chat (`demo/chat-demo.js`),
  importeur de thème, feuille de style monochrome (`src/app/athena-demo.css`).
- **`mini-services/llm-bridge/`** — pont LLM (Bun) : cascade de fournisseurs
  (gratuit sans clé → SDK → secours), circuit-breaker par fournisseur, buckets de
  quota, retry exponentiel borné, cache LRU 60×15 min, découverte des modèles
  cloud et locaux (Ollama / LM Studio / llama.cpp, best-effort), télémétrie
  `/statut` et `/sante`. **Aucune clé API dans le code** — le primaire est un
  endpoint public gratuit, le secours SDK lit son credential dans
  l'environnement d'exécution.
- **`mini-services/llm-chat/`** — moteur Athéna (FastAPI) : pipeline à crans
  déterministes, vérificateurs (math, faits, grammaire, code), canari
  anti-injection, évals (13 tests) et suite golden (118 tests).

## Lancer le stack en local

Prérequis : [Bun](https://bun.sh) ≥ 1.1, Python ≥ 3.12, `pip install fastapi uvicorn`.

```bash
# 1. Application Next.js (racine du dépôt)
bun install
bun run dev            # → http://localhost:3000

# 2. Bridge LLM (terminal séparé)
cd mini-services/llm-bridge
bun install
bun --hot index.ts     # → écoute sur :3015

# 3. Moteur Athéna (terminal séparé)
cd mini-services/llm-chat
pip install fastapi uvicorn
bash daemon.sh         # → écoute sur :3010
```

Ouvrir `http://localhost:3000` : l'UI passe par `/api/chat` → sidecar :3010 →
bridge :3015 → cascade de fournisseurs. Si tous les fournisseurs distants sont
indisponibles, le pipeline bascule automatiquement en **mode déterministe**
(crans locaux : solveur vérifié, faits canoniques, réponse honnête) — l'UI
n'affiche jamais d'erreur HTTP brute.

### Serveurs LLM locaux (optionnel)

Le HUD détecte automatiquement (best-effort) :

| Serveur   | Endpoint détecté        |
|-----------|-------------------------|
| Ollama    | `http://127.0.0.1:11434` |
| LM Studio | `http://127.0.0.1:1234`  |
| llama.cpp | `http://127.0.0.1:8080`  |

Un modèle local sélectionné est appelé en OpenAI-compatible
(`POST {base}/v1/chat/completions`) ; en cas d'échec, repli silencieux sur la
cascade avec un toast discret « repli sur modèle auto ».

## Vitrine GitHub Pages

Le site Pages (`https://athena-cyber1.github.io/Athena/`) est généré depuis le
dossier **`docs/`** : une page statique monochrome qui présente le projet et
embarque une **mini-démonstration réelle** du sélecteur de modèle (appel direct
de l'endpoint public gratuit depuis le navigateur, sans clé, sans backend).

- La page **charge et fonctionne** sans backend (démo LLM + HUD modèles cloud).
- En revanche, le **stack complet** (pipeline à crans, mémoire, canari,
  sanitization) exige le moteur et le pont : il ne peut pas tourner en statique
  sur Pages — suivre « Lancer le stack en local » ci-dessus.

## Garanties de sécurité du dépôt

- Aucun token, clé ou `.env` committé (voir `.gitignore`) ; le credential du
  fournisseur de secours reste dans l'environnement d'exécution du serveur.
- `data/`, `*.db`, `node_modules/`, `__pycache__/` exclus du versionnement.
- La passerelle Next.js applique une sanitization défensive en sortie ; aucun
  code d'erreur HTTP ni nom de fournisseur ne traverse l'interface.
