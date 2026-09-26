# Athéna — assistant conversationnel cyber à pipeline déterministe

Dépôt de code source du projet **Athéna** (pipeline v10.9.4).

> ⚠️ Ce dépôt ne contient **que le code** (`src/`, `docs/`, `mini-services/`).
> Aucune donnée utilisateur, aucun `.env` (voir `.gitignore`).

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — architecture complète, flux, catalogue des modèles gratuits, contrat de commandes PC.

## Structure

| Dossier | Rôle |
|---------|------|
| `docs/` | **GitHub Pages** — site statique; `design/` est généré depuis la source canonique |
| `design/` | **Source canonique** des CSS, logo et loader de thème |
| `src/` | App **Next.js** (dev local, passerelle `/api/chat` → sidecar) |
| `public/` | Assets statiques Next générés depuis `design/` et `docs/` |
| `mini-services/llm-bridge/` | Pont LLM **:3015** (Bun) — cascade + circuit-breaker |
| `mini-services/llm-chat/` | Moteur Athéna **:3010** (Python) — agent déterministe |
| `mini-services/local-agent/` | Agent **:3020** — **exécution de commandes sur le PC** |
| `worker/` | Proxy CORS Cloudflare (tokenrouter, nvidia) |
| `tools/` | Scripts utilitaires |

## Lancer le stack en local

Prérequis : [Bun](https://bun.sh) ≥ 1.1, Python ≥ 3.12, Node ≥ 18.

```bash
# 1. Pages en local (optionnel) — ou utiliser la Pages GitHub en prod
# 2. Agent commandes PC
node mini-services/local-agent/index.js
#    ou sans confirmation (dev) :
node mini-services/local-agent/index.js --auto

# 3. Générer les sorties Next/Pages depuis les sources canoniques
node tools/prepare-assets.js

# 4. Application Next.js
bun install && bun run dev            # → http://localhost:3000

# 5. Bridge LLM
cd mini-services/llm-bridge && bun install && bun --hot index.ts   # :3015

# 6. Moteur Athéna
cd mini-services/llm-chat && pip install fastapi uvicorn && bash daemon.sh  # :3010
```

## Vitrine GitHub Pages

`https://athena-cyber1.github.io/Athena/` — servie depuis **`docs/`** après génération des assets par GitHub Actions.
Fonctionne **sans backend** (modèles gratuits via navigateur).
Le pipeline complet (crans, canari, mémoire) exige le stack local.

## Modèles gratuits

Voir le tableau complet dans [ARCHITECTURE.md §4](./ARCHITECTURE.md#4-catalogue-des-modèles-gratuits) :
OpenRouter `:free` (22+), Pollinations `openai-fast`, locaux Ollama / LM Studio / llama.cpp.

## Commandes PC

Les modèles peuvent proposer une commande dans un bloc ` ```athena-exec ` ;
l'UI affiche un bouton **Exécuter** → confirmation → `POST /api/exec`
→ `local-agent` (`127.0.0.1:3020`).

```bash
node mini-services/local-agent/index.js
# ou sans confirmation (dev) :
node mini-services/local-agent/index.js --auto
```

**Chrome / Pages GitHub :** autoriser le site (⋮ → **Local Network** → Allow),
sinon le navigateur bloque `127.0.0.1` depuis une page HTTPS publique.
Sur le stack local (`localhost:3000`), le proxy Next `/api/exec` contourne
cette restriction.

## Sécurité

- Clés dans `keys.js` uniquement avec **plafond limité** (fichier public Pages).
- `local-agent` : bind `127.0.0.1`, CORS restreint, motifs dangereux bloqués, confirmation obligatoire.
- Aucun secret committé (`.gitignore`).

## Lancer le stack — résumé

```bash
bun install && bun run dev
# détails : ARCHITECTURE.md §7
```
