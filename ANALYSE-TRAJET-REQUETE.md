# Analyse — le trajet complet d'une requête (2026-10-05)

> Objectif : documenter la chaîne réelle d'un message (UI openrouter free),
> lister les correctifs appliqués le 2026-10-05 et les améliorations restantes.
> Concerné : banc d'essai des 19 modèles openrouter free (effort max,
> prompt three.js aquatique) et les réponses « flemmardes » constatées.

---

## 1. Chaîne principale (page servie sur `localhost:3000`)

```
#saisie (chat-demo.js)
  → POST /api/chat  { messages, effort, model_id, temperature, … }
  → [api-shim.js intercepte window.fetch — ligne ~1878 gererChat(body)]
      → construireChaine(model_id)          ← modèle choisi + cascade max 7
      → compression de contexte (95 % de la limite, résumé LLM, repli troncature)
      → boucle de tentatives (chemin NDJSON flux)
          → bornePour(entry)                ← garde-fou PAR APPEL, adaptatif effort
          → callModel → corpsPour → fetch amont openrouter /api/v1/chat/completions
          → SSE → {type:'jeton'} … → {type:'final'} | {type:'erreur'}
  → chat-demo.js : rendu (bulles, athena-file, athena-exec), toast repli,
      pied « via <modèle> » (data-voie / data-repli)
```

### Détail des étapes

1. **chat-demo.js — composition** : historique + consignes système,
   `effortChoisi` (HUD, défaut `medium`, désormais cas par cas — voir §3),
   `modeleChoisi` (`localStorage athena_selected_model`), température
   (HUD > payload provider > préférences > 0.6).
2. **api-shim.js — interception** : toute requête `fetch('/api/chat')` est
   interceptée côté navigateur ; la clé openrouter vient de
   `localStorage athena_api_keys.openrouter`. La requête **ne passe jamais
   par le serveur Next** — ni quota serveur, ni bridge.
3. **construireChaine(model_id)** (`api-shim.js:1783`) :
   - modèle choisi en tête si valide et sain (`providerSain`) ;
   - cascade ensuite : `chat:false` (garde/traduction) **jamais** relais,
     tri par score de session (validé +n / échec −n), rotation des égalités,
     préférence `openrouter → pollinations → autre → nvidia`, cap 7 entrées ;
   - mode auto : même cascade sans modèle choisi.
4. **Compression** : estimation de contexte (car/3.5), compression
   automatique à 95 % de la limite du modèle visé, jusqu'à 3 compressions
   d'urgence sur erreur 400 « context length » (même modèle rejoué).
5. **Boucle de tentatives (flux NDJSON)** :
   - `bornePour(entry)` : **adaptée à l'effort de la requête** (voir §3a) ;
     budget total de cascade 10 min (voir §3b) ;
   - `corpsPour` : `models[]` (cascade interne côté openrouter), `reasoning`
     via payload de l'entrée + effort (`effortNvidia` : body > localStorage,
     borné aux `efforts` admis par le modèle), consigne de langue ;
   - gestion d'erreurs : timeout (1 rejouée si 0 jeton diffusé),
     `contexteTropLong` (compression), jetons déjà partis → final partiel
     (pas de cascade pour éviter le texte doublé), 402/403/429 →
     `marquerPause(provider + modèle, 180 s)`, 5xx → pause du modèle seul,
     `noterModele(id, ok)` alimente le score de session.
6. **Final** : `assembler()` calcule `modele_repli` (modèle réel `d.model`
   ≠ modèle demandé), expose `provider`/`model` ; chat-demo affiche le
   toast de repli, le pied `via <modèle>` (attributs `data-voie`/`data-repli`
   machine-lisibles) et transforme les fences ` ```athena-file ` en cartes
   téléchargeables (contenu réel conservé dans `carte._contenuComplet`).

## 2. Chaîne alternative (NON interceptée)

Page React `src/app/page.tsx`, skills forcés/MCP, messages non-stream :

```
fetch('/api/chat') réel → src/app/api/chat/route.ts
  → sidecar :3010 (serveur:app) → run_agent → engine.complete
  → bridge :3015 (llm-bridge) — ⚠ aucun provider openrouter configuré
  → repli automatique nvidia (modele_repli:true, toast « repli »)
```

**Écart** : le modèle choisi dans l'UI n'est pas honoré sur ce chemin.
Le toast `modele_repli` prévient, mais la cause reste (voir §4-T1).

## 3. Correctifs appliqués le 2026-10-05

| # | Problème (constaté par le banc 19 modèles) | Correctif |
|---|---|---|
| a | `bornePour` openrouter = 70 s fixes pour les entrées **sans `efforts` déclarés** → appels coupés en plein TTFB (40-46 s mesurés) alors que l'UI affichait l'effort demandé | `bornePour` lit l'effort courant pour **tous** les modèles : openrouter 150 s (low/medium) / 240 s (high/xhigh) / 300 s (max) ; nvidia 300 s, 20 min en max ; suppression du surélèvement conditionné à `efforts` (`api-shim.js:1259`) |
| b | Cascade sans plafond global : 8 entrées × bornes = ~40 min d'attente silencieuse | `BUDGET_CASCADE = 600 000 ms` (10 min) sur les deux chemins (JSON + flux) → erreur honnête « cascade épuisée » (`errBudget()`) |
| c | Effort **global** (une seule valeur pour 19 modèles) : « max » sur 2,6 B mange le budget, « medium » bâcle les raisonner | **Effort cas par cas** : table `EFFORT_MODELES` (recommandation par modèle, relevés du banc), choix manuel persisté **par modèle** (`athena_effort_modele:<id>`), appliqué au changement de modèle et à l'init ; bouton effort = effort effectif, titre = « recommandé pour <modèle> : X » (`chat-demo.js:6157`) |
| d | `nemotron-3.5-content-safety:free` (garde : répond « User Safety: safe ») sélectionnable et en cascade | `chat:false` (catalogue) + retiré de `OR_FREE` (cascade interne openrouter) + filtré du HUD (`chat:false` jamais rendu ; ancien choix mémorisé reste visible) |
| e | Pied « via … » lu par regex dans les tests → faux positifs (« via CDN ») | Attributs DOM `data-voie` / `data-repli` sur `.voie-modele` |
| f | `nemotron-nano` en double dans `OR_TRIO` + `OR_EXTRA` (cran de cascade gaspillé) | Doublon retiré |
| g | Sélecteur d'effort « sans effet » non expliqué | Titre du badge : « recommandé pour <modèle> : X » ; note du HUD d'effort réécrite (persistance par modèle) |
| — | Cache-buster obsolète | `?v=20260925cq → 20260925cr` (index.html ×4, page.tsx ×2, ARCHITECTURE.md) |

### Recommandations d'effort (table `EFFORT_MODELES`)

| Modèle | Effort | Raison (banc 2026-10-05) |
|---|---|---|
| `liquid/lfm-2.5-2.6b:free` | low | 2,6 B : 16 s complet, le max n'apporte rien |
| `qwen/qwen3.8-27b:free` | max | le max paie réellement (réponses complètes) |
| `nemotron-3-nano…:free` | max | servait 8 requêtes des autres — fiable en max |
| `nemotron-3.5-lightning:free` | max | TTFB correct, sortie propre en max |
| `gemma-4-31b/26b:free` | high | complet en high ; max allonge inutilement le TTFB |
| `nemotron-3-super/ultra…:free` | high | ultra en max restait bloqué (300+ s), high sort |
| `poolside/laguna-s/xs:free` | high | rendu complet côté voie openrouter en high |
| `inclusionai/ling-3.1-flash` | high | max a été coupé en plein raisonnement |
| `apodex/apodex-1.1-mini:free` | medium | médian entre carte vide et délai |
| `stealth/space-bunny-alpha` | high | en max le raisonnement mangeait tout (réponse vide) |
| sans `efforts` déclarés (ling-3.0, dots, north-mini, …) | — | effort sans effet (bouton grisé) — déclarer `efforts` si le provider le supporte (§4-T2) |

## 4. Améliorations restantes (TODO)

- **T1 — bridge `:3015` sans openrouter** : ajouter un provider openrouter
  (clé serveur, `TIMEOUT_EFFORT` déjà prévu) pour que le chemin
  page React / skills honorise le modèle choisi au lieu de replier sur
  nvidia. Fichiers : `mini-services/llm-bridge`, `llm-chat/athena/llm/engine.py`.
- **T2 — `efforts` à déclarer** : `ling-3.0-*`, `north-mini-code`,
  `dots-3-note`, `lfm-2.5` n'annoncent pas `efforts` (bouton grisé, effort
  non envoyé). À tester un par un côté openrouter ; si supporté, déclarer
  dans `MODELS` (efforts + payload) et ajouter une ligne dans
  `EFFORT_MODELES`.
- **T3 — quota free (50 req/jour)** : en cas de 429 `free-models-per-min`,
  appliquer le `retry-after` lus dans `erreurHttp` (`err.retryAfter`)
  avant de consommer un cran de cascade.
- **T4 — outillage de test** : `analyse-modeles.py` et les sondes doivent
  lire `.voie-modele[data-voie]` (plus de regex sur le texte).
- **T5 — budget cascade réglable** : `BUDGET_CASCADE` pourrait suivre
  l'effort (ex. 6 min en low, 10 min en max) plutôt qu'une constante.
- **T6 — relevé hebdo** : rejouer le banc (19 modèles) pour valider les
  effort recommandés sur données fraîches (les pools free tournent).

## 5. Repères de code

| Étape | Fichier |
|---|---|
| Composition requête, HUD effort/modèle | `docs/chat-demo.js` (`CLE_EFFORT`/`EFFORT_MODELES` ~L6144, `itemModeleHud`, `majBadgeEffort`) |
| Interception, cascade, watchdogs | `docs/api-shim.js` (`gererChat` ~L1900, `construireChaine` ~L1790, `bornePour` ~L1259, `BUDGET_CASCADE`, boucle flux ~L2110) |
| Catalogue / `chat:false` / `OR_FREE` | `docs/api-shim.js` (MODELS ~L112, `OR_TRIO/OR_EXTRA/OR_FREE` ~L503) |
| Pied « via » machine-lisible | `docs/chat-demo.js` (~L5332, `data-voie`) |
| Page React (chemin non intercepté) | `src/app/page.tsx`, `src/app/api/chat/route.ts` |
| Bridge LLM serveur | `mini-services/llm-bridge`, `llm-chat/athena/llm/engine.py` (`BRIDGE=127.0.0.1:3015`) |
| Sync docs → public | `tools/prepare-assets.js` (`npm run sync:assets`) |
