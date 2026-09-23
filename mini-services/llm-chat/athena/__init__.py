"""Athéna v10.7 — noyau agentique.

Architecture : PLAN → ACTION → OBSERVATION → CRITIQUE → SOUS-AGENT → REPLAN
v10.1 : le petit modèle juge 0.5B a été RETIRÉ (il biaisait les verdicts).
La vérification critique est assurée par un sous-agent bâti sur le MÊME
modèle que le moteur (seconde passe adversariale). Le LLM n'est jamais
l'autorité sur ce que le code peut vérifier.
v10.2 : cohérence de version avec le frontend (import de design /api/design).
v10.3 : lecture réelle des pièces jointes (FILE_DATA côté moteur + sous-agent).
v10.6 : correctifs F1–F22 (rapport QA) — purge réelle fichiers/conversations,
schéma fichiers harmonisé (status/kind/sha256/size_bytes), contenu brut
(?raw=1), filtres de liste, rejet des exécutables, attachments fantômes
refusés, corpus d'erreurs dédoublonné, format de fil unifié, versions
UI/API alignées.
v10.7 — correctifs du diagnostic pipeline LLM (audit serveur.py) :
- Scission SYS_NOYAU (1)(2) : « appuie-toi UNIQUEMENT sur le contexte » ne
  s'applique qu'aux observations d'outils ; le refus « info insuffisante »
  est conditionné (bool(contextes or resultat_outil) côté Python). Sans
  observation, la connaissance générale stable est permise avec nuance.
- MEMORY_RECENT gaté : fil récent injecté seulement en cas de reprise
  (anaphore/continuation/chevauchement ≥ 2 jetons significatifs) ; la
  mémoire est toujours étiquetée INDICATIVE (≠ autorité). Fini le refus
  « le contexte ne mentionne que Athéna » pour une question VPN.
- RAG durci : mots vides français écartés (le « est » faisait matcher la
  mémoire Athéna pour n'importe quelle question), BM25 requête purgée +
  seuil de score (> 0.8) → vide honnête au lieu de bruit.
- Classification élargie : « qu'est-ce que », « comment fonctionne » et le
  vocabulaire technique/réseau (vpn, proxy, dns, chiffrement, algorithme…)
  routent vers FACTUEL → RAG + web + juge (équivalent regex cyber).
- Juge faits SYSTÉMATIQUE (pas seulement si chiffre) : verdicts visibles en
  trace pour toute réponse à claims (CONVERSATIONNEL inclus).
- Budget/température : temp 0.5 / max_tokens 900 pour le raisonnement
  (sous-agent juge inchangé à 0.1/520).
- Corpus d'erreurs : boucle erreur → régression passée → corrige=1
  (verrouillage, aucune destruction).
v10.9.0 — INVARIANT STRUCTUREL « rendu_final, unique point de sortie »
(anti-régression v10.8 : 64 des 76 échecs étaient un template de refus) :
- Les GATES (verdict≠SUPPORTED, RAG vide, critic, garde entité…) ANNOTENT
  seulement (codes de raison internes, state.annoter) — elles ne TERMINENT
  plus jamais la boucle et ne rédigent plus jamais le texte utilisateur.
- rendu_final (policies) = UNIQUE point de sortie, politique de dégradation
  FIXE : (a) refus de politique SUBSTANTIEL → (b) réponse du modèle non
  rejetée → (c) hedge paramétrique « D'après ce que je sais : X (à vérifier) »
  (seconde chance LLM) → (d) inconnu honnête SUBSTANTIEL (voisinage + manque).
  Le template « Je n'ai pas pu construire une réponse complète… Reformulez »
  est SUPPRIMÉ (interdit de sortie).
- CANARI de sortie (verification/canari.py) : détection de non-réponse =
  télémétrie + tests CI (tolérance zéro aux interdits), plus mécanisme
  d'application. Télémétrie : distribution des classes terminales
  (outillee/modele/hegdee/inconnu_honnete/politique) par domaine → GET
  /telemetrie.
- N1 exemptions : inconnu honnête ≠ refus vide ; refus de politique (« ne
  peut pas » / « ne doit pas ») exemptés du fallback « forcer une réponse » ;
  critic ne REJETE qu'avec contre-proposition outillée (critic.contre_proposition),
  rejets sans proposition LOGGÉS.
- N2 : garde d'entité TRI-STATE (sources en échec → garde muette, hedge
  direct ; sources consultées sans l'entité → inconnu honnête substantiel) +
  whitelist stable-facts (capitales) = accélérateur injecté comme autorité.
- N3 : solveur élargi — nombres en lettres FR (parseur interne), fractions en
  mots (trois quarts → 3/4), températures AFFINES °C↔°F↔K (à part des ratios),
  conversions d'unités (t = tonne métrique), constantes (365 j non bissextile,
  1440 min/j…). « aucune structure reconnue » n'atteint JAMAIS l'UI.
- N4 : toute erreur d'outil/parseur = code raison INTERNE (trace/télémétrie) ;
  l'utilisateur ne voit que la politique de dégradation.
- Verrous vérifiés : inconnu 100 %, edge_injection, edge_math_long,
  multiturn VPN, anaphore Troie (golden tests tests/test_golden_v109.py).
v10.9.1 — COUCHE DE SORTIE HUMAINE ET DIVERSE (global, modulaire) :
- Le retour utilisateur sur v10.9.0 : tous les crans sortaient le MÊME moule
  robotique (« Sur « hello », voici où j'en suis. Ce qui manque pour aller
  plus loin : la précision attendue… ») mot pour mot à chaque fois.
- voix.py (NOUVEAU) : POOLS DE FORMULATIONS par classe terminale (outillée /
  hedgée / inconnu honnête / politique / conversationnelle), chacun ≥ 8
  variantes de fond ET de ton (directe, légère, pédagogique, concise…). Le
  ladder de rendu_final décide la CLASSE, le pool réalise le texte.
- DÉDUP STRUCTUREL : empreinte-squelette (tokens de contenu + bigrammes +
  seau de longueur) ; similarité ≥ 0.6 avec l'une des 8 dernières réponses
  → variante rejetée, nouvelle tirée (à épuisement : la moins similaire).
  Fenêtre GLOBALE (toutes classes) mise à jour à chaque réponse finale.
- FORMULES USÉES = interdits canari (tolérance zéro) : « voici où j'en
  suis », « détail vérifiable », « plutôt que d'inventer », « je reprends la
  recherche », « état exact de ce que je sais ».
- STYLE : longueur calibrée sur la question (signal GÉNÉRIQUE micro/courte/
  standard — longueur + marqueurs interrogatifs, PAS de lexique de cas par
  cas) ; contenu d'abord, méta seulement si utile ; jamais de nombrilisme
  pipeline ; EN court si question EN.
- Cran (b') : micro-social conversationnel sans LLM (accueil/gratitude/
  congé, FR/EN) — une salutation n'a NI hedge NI inconnu ; classe terminale
  « conversationnelle » ajoutée au canari/télémétrie.
- Télémétrie diversité : variante + signature squelette enregistrées par
  sortie → taux_unique_pct + top_repetees dans GET /telemetrie.
- Verrous intacts : rendu_final unique sortie, canari, inconnu substantiel,
  edge_injection, math_long, anaphore Troie.
v10.9.2 — INCIDENT P0 « LLM indisponible : HTTP Error 502: Bad Gateway »
(RÉSILIENCE DÉFINITIVE — plus jamais un message d'infrastructure dans l'UI) :
- CAUSE RACINE : l'upstream unique (internal-api.z.ai, pont :3015) applique
  un rate-limit par fenêtres (429 instantané, preuves : 228×200 / 1023×429
  dans le log du pont) ; le pont v1 propageait chaque 429 en HTTP 502 SANS
  retry, et le sidecar encapulait str(HTTPError) = « HTTP Error 502: Bad
  Gateway » dans obs.erreurs → trace `llm_indisponible` VISIBLE de l'UI.
- BRIDGE v2.0.0 (llm-bridge/index.ts) : contrat d'erreur STRUCTURÉ
  {erreur: phrase neutre, code} (détail upstream = logs seuls) ; RETRY
  exponentiel borné + jitter (429/5xx) ; LIMITEUR de concurrence (2 en vol,
  espacement 250 ms, file FIFO, admission 25 s) ; CIRCUIT-BREAKER
  (8 échecs → OPEN 20 s → HALF-OPEN sonde) ; CACHE LRU des dernières bonnes
  réponses (clé exacte, TTL 15 min, servi en circuit ouvert) ; CASCADE
  providers (zai-principal → zai-alternatif pour les échecs non-429) ;
  GET /statut (télémétrie) ; GET /sante + llm_disponible.
- MOTEUR (llm/engine.py) : toute erreur CODIFIÉE {erreur:
  MODELE_INDISPONIBLE, code, detail_interne} — str(HTTPError) n'existe plus ;
  disponible() lit le circuit du pont (échec immédiat ≈0 ms en surcharge) ;
  statut_providers() pour la télémétrie.
- PIPELINE : observer/agent/enregistres émettent des codes neutres — l'étape
  visible `llm_indisponible` affiche « modèle de langue momentanément
  indisponible — poursuite en mode déterministe », le code interne va dans
  les détails de trace (canal serveur, jamais rendu).
- PASSERELLE (route.ts) : SANITIZE défensif final — toute signature de fuite
  (http error, bad gateway, too many requests, erreur 429/502…, llm
  indisponible, bridge llm, internal-api, sdk, traceback, rate limit) est
  remplacée par un libellé neutre dans `reponse` ET chaque message de
  `raisonnement` avant émission ; le chemin d'erreur 4a est neutralisé aussi.
- CANARI : +7 interdits de fuite infra (signatures PRÉCISES du pipeline ;
  pas de nombres nus ni « bad gateway » nu — une vraie réponse cyber sur les
  codes HTTP resterait légitime et ne doit pas être ré-émise cran (d)).
- TÉLÉMÉTRIE : GET /telemetrie expose l'état du pont (circuit, compteurs,
  dernier succès/échec) ; /chat 500 → phrase neutre (détail en log serveur).
- Verrous intacts : rendu_final unique sortie, canari, inconnu substantiel,
  edge_injection, math_long, anaphore Troie, diversité voix.
v10.9.3 — TODO GRATUIT « IA gratuite SANS clé dans le bridge » (P0) :
- CAUSE : l'upstream ZAI reste saturé (429 par fenêtres, quota externe épuisé)
  et l'utilisateur n'AUCUNE clé alternative. Solution : provider PRIMAIRE
  gratuit SANS clé — Pollinations.ai (text.pollinations.ai/openai, modèle
  « openai-fast » / gpt-oss-20b, tier anonymous), prouvé ici : 3 prompts
  courts → HTTP 200 + contenu non vide, sans Authorization.
- BRIDGE v2.1.0 (llm-bridge/index.ts) : CASCADE pollinations → zai-principal
  → zai-alternatif (tout échec 429/5xx/timeout/vide → provider suivant ;
  liste épuisée → backoff puis nouveau tour) ; CIRCUIT-BREAKER PAR PROVIDER
  (8 échecs → pause 20 s d'UN provider, les autres servent ; RATE_LIMITED
  n'ouvre pas le circuit — backoff seul) ; buckets de quota (un 429 ZAI skip
  l'autre ZAI au même tour) ; télémétrie /statut + /sante :
  providers: [{name, up, last_status, ok, erreurs}] ; timeout pollinations
  40 s par tentative (lent : 5–30 s observés) ; BUDGET 55 s conservé.
- CONTRATS INCHANGÉS côté sidecar : /complete {texte, duree_ms}, /sante
  llm_disponible — le cran (b) reprend AUTOMATIQUEMENT par le même chemin
  (mêmes prompts hedge/inconnu/policy, aucun chemin parallèle) ; pools (d)
  restent le filet final ; libellé neutre « modèle de langue momentanément
  indisponible — poursuite en mode déterministe » si tout est down ; JAMAIS
  le nom d'un provider ni une erreur HTTP dans reponse/raisonnement (N4).
- PREUVES : cascade déclenchée en réel (2 échecs pollinations → failover
  zai → 429 → backoff → pollinations OK) ; 20/20 appels /api/chat variés
  0 occurrence 502/429/Bad Gateway/LLM indisponible ; cran (b) actif
  (réponses LLM non-pool : chiffrement, TCP, adresse IP) ; golden 118/118 ;
  evals 13/13 ; lint OK.
- Verrous intacts : rendu_final unique sortie, canari, inconnu substantiel,
  edge_injection, math_long, anaphore Troie, diversité voix.
v10.9.4 — HUD « sélecteur de modèle » (P1) :
- BRIDGE v2.2.0 : /statut + /modeles exposent models: [{id, name, provider,
  active, local, up}] — cloud (catalogue pollinations /openai/models en cache
  10 min, openai-fast garanti, borné à 8 ; zai-principal ; zai-alternatif) +
  LOCAUX best-effort (Ollama :11434/api/tags, LM Studio :1234/v1/models,
  llama.cpp :8080/v1/models — timeout 1,5 s, silencieux si absent) ; POST
  /modeles = rafraîchissement manuel (re-catalogue + re-scan) ; POST /complete
  accepte "model" → route DIRECTE (pollinations:X / zai / local
  OpenAI-compatible) ; échec du modèle choisi → CASCADE normale + "repli":
  true (drapeau NEUTRE, jamais d'erreur visible — N4) ; appelLocal timeout
  55 s (CPU).
- SIDECAR : /chat accepte model_id (≤120) → run_agent → AgentState.model_id →
  raisonner_llm → MOTEUR.complete(model_id) ; le juge (sous-agent) reste sur
  la cascade par défaut ; "repli" du pont → state.mode_repli → /chat renvoie
  modele_repli (booléen neutre) ; GET/POST /modeles (proxy pont, jamais
  bloquant : {dispo:false, modeles:[]} si pont down).
- PASSERELLE : /api/chat accepte model_id (regex [A-Za-z0-9._:-], ≤120) et
  transmet modele_repli (JSON + event final NDJSON) ; NOUVELLE /api/modeles
  (GET lecture / POST rafraîchissement, normalisation défensive, garde
  d'origine).
- UI (HUD) : badge compact « modèle actif » dans le header + panneau overlay
  (sections Actif / Cloud / Local — Local absent si rien de détecté) ; item =
  nom + provider + badge (actif/local) + point up/down (monochrome : --ok /
  --gris-bord) ; item down grisé + tooltip neutre ; sélection persistée
  (localStorage athena_selected_model) et envoyée
  en model_id ; toast discret « repli sur le modèle auto » si le choix
  échoue ; ↻ rafraîchissement manuel ; clic extérieur / Échap ferment.
- PREUVES : routage direct pollinations:openai-fast → 200 repli:false ;
  zai-alternatif → 429 → cascade a servi → 200 repli:true (réponse livrée,
  aucun message d'erreur) ; ollama inexistant → repli cascade ; golden
  118/118 ; evals 13/13 ; lint OK ; QA navigateur desktop + mobile.
- Verrous intacts : rendu_final unique sortie, canari, inconnu substantiel,
  edge_injection, math_long, anaphore Troie, diversité voix, N4 (aucun nom de
  provider ni erreur HTTP dans reponse/raisonnement — le HUD est hors
  reponse/raisonnement).
"""
__version__ = "10.9.4"

STATUTS = ("UNKNOWN", "HYPOTHESIS", "SUPPORTED", "VERIFIED", "DISPROVED", "CONTRADICTED", "STALE")
