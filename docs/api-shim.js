/* ============================================================
   Athéna Pages — api-shim.js
   Intercepte window.fetch pour les routes API de l'UI
   (/api/chat, /chat-attache, /api/modeles, /api/files,
   /api/entrainer, /api/design) qui n'existent pas sur une
   Pages statique, et les route VERS LES VRAIS PROVIDERS
   (OpenAI-compatible) depuis le navigateur.

   - pollinations : gratuit, sans clé (primary).
   - autres providers : nécessitent une clé (keys.js ou
     localStorage.athena_api_keys) — visibles dans le HUD,
      grisées tant que la clé manque.
    - proxy Cloudflare (worker/index.js) : tokenrouter (403 sur
      Origin) et nvidia (aucun en-tête CORS) — URLs dans keys.js.
    - Cascade : modèle choisi → pollinations → autres dispos.
     Échec du modèle choisi → modele_repli:true (toast UI).
   ============================================================ */
(function () {
  'use strict';

  var realFetch = window.fetch.bind(window);

  var PROVIDERS = {
    pollinations: { base: 'https://text.pollinations.ai/openai', free: true, label: 'pollinations · gratuit' },
    groq:         { base: 'https://api.groq.com/openai/v1', label: 'groq · clé API' },
    openrouter:   { base: 'https://openrouter.ai/api/v1', label: 'openrouter · clé API', extra: function () { return { 'HTTP-Referer': location.origin, 'X-Title': 'Athéna' }; } },
    openai:       { base: 'https://api.openai.com/v1', label: 'openai · clé API' },
    deepseek:     { base: 'https://api.deepseek.com/v1', label: 'deepseek · clé API' },
    mistral:      { base: 'https://api.mistral.ai/v1', label: 'mistral · clé API' },
    together:     { base: 'https://api.together.xyz/v1', label: 'together · clé API' },
    gemini:       { base: 'https://generativelanguage.googleapis.com/v1beta/openai', label: 'gemini · clé API' },
    zai:          { base: 'https://open.bigmodel.cn/api/paas/v4', label: 'zhipu zai · clé API' },
    cerebras:     { base: 'https://api.cerebras.ai/v1', label: 'cerebras · clé API' },
    nebius:      { base: 'https://api.studio.nebius.ai/v1', label: 'nebius · clé API' },
    xai:          { base: 'https://api.x.ai/v1', label: 'xai · clé API' },
    /* tokenrouter : amont 403 sur Origin navigateur → base = URL du
       proxy Cloudflare Worker (stockée dans keys.js: tokenrouter_proxy). */
    tokenrouter:  { baseKey: 'tokenrouter_proxy', label: 'tokenrouter · proxy CF' },
    /* NVIDIA : integrate.api.nvidia.com ne renvoie AUCUN en-tête CORS →
       base = URL du proxy Worker (keys.js: nvidia_proxy, monture /nvidia/v1).
       sse: la réponse amont arrive en flux SSE (delta.reasoning_content
       puis delta.content) — agrégée ici, diffusée à l'UI en progress.
        payload: cadrage NVIDIA par défaut (temperature 1, seed 0,
        max_tokens 16384, reasoning_effort « max ») — une entry MODELS
        peut le surcharger via son propre `payload` (voir plus bas). */
    nvidia:       {
      baseKey: 'nvidia_proxy',
      label: 'nvidia · proxy CF',
      sse: true,
      payload: function () {
        return { temperature: 1, max_tokens: 16384, seed: 0, reasoning_effort: 'max' };
      },
    },
  };

  var MODELS = [
    { provider: 'pollinations', model: 'openai-fast', name: 'openai-fast (gratuit)' },
    { provider: 'pollinations', model: 'openai', name: 'openai (gratuit)' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b · groq' },
    { provider: 'groq', model: 'llama-3.1-8b-instant', name: 'llama-3.1-8b · groq' },
    /* openrouter : les ids « :free » fonctionnent avec 0 crédit sur un
       compte gratuit (sans carte) — catalogue vérifié via /models public.
       Trio prioritare d'abord (un seul endpoint chacun → cascade models[]
       côté OpenRouter si l'un est rate-limité). */
    { provider: 'openrouter', model: 'z-ai/glm-5.2:free', name: 'glm-5.2 free · openrouter' },
    { provider: 'openrouter', model: 'google/gemma-4-31b-it:free', name: 'gemma-4-31b free · openrouter' },
    { provider: 'openrouter', model: 'qwen/qwen3.8-27b:free', name: 'qwen3.8-27b free · openrouter' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'nemotron-3-nano free · openrouter' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'nemotron-3-ultra 550b free · openrouter' },
    { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free', name: 'gemma-4-26b free · openrouter' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'nemotron-3-super free · openrouter' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3.5-lightning:free', name: 'nemotron-3.5-lightning free · openrouter' },
    { provider: 'openrouter', model: 'thinkingmachines/inkling:free', name: 'inkling free · openrouter' },
    { provider: 'openrouter', model: 'thinkingmachines/inkling-small:free', name: 'inkling-small free · openrouter' },
    { provider: 'openrouter', model: 'poolside/laguna-s-2.1:free', name: 'laguna-s free · openrouter' },
    { provider: 'openrouter', model: 'poolside/laguna-xs-2.1:free', name: 'laguna-xs free · openrouter' },
    { provider: 'openrouter', model: 'cohere/north-mini-code:free', name: 'north-mini-code free · openrouter' },
    { provider: 'openrouter', model: 'nex-agi/nex-n2.5-mini:free', name: 'nex-n2.5-mini free · openrouter' },
    { provider: 'openrouter', model: 'nex-agi/nex-n2.5-pro:free', name: 'nex-n2.5-pro free · openrouter' },
    { provider: 'openrouter', model: 'inclusionai/ling-3.0-flash-sante:free', name: 'ling-3.0-flash-sante free · openrouter' },
    { provider: 'openrouter', model: 'inclusionai/ling-3.0-flash-fin:free', name: 'ling-3.0-flash-fin free · openrouter' },
    { provider: 'openrouter', model: 'dots-studio/dots-3-note-preview:free', name: 'dots-3-note free · openrouter' },
    { provider: 'openrouter', model: 'liquid/lfm-2.5-2.6b:free', name: 'lfm-2.5-2.6b free · openrouter' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3.5-content-safety:free', name: 'nemotron-3.5-safety free · openrouter' },
    { provider: 'openrouter', model: 'openrouter/free', name: 'free models router · openrouter' },
    { provider: 'openai', model: 'gpt-4o-mini', name: 'gpt-4o-mini · openai' },
    { provider: 'deepseek', model: 'deepseek-chat', name: 'deepseek-chat' },
    { provider: 'mistral', model: 'mistral-small-latest', name: 'mistral-small · mistral' },
    { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'llama-3.3-70b · together' },
    { provider: 'gemini', model: 'gemini-2.0-flash', name: 'gemini-2.0-flash' },
    { provider: 'zai', model: 'glm-4.5-air', name: 'glm-4.5-air · zai' },
    { provider: 'cerebras', model: 'llama-3.3-70b', name: 'llama-3.3-70b · cerebras' },
    { provider: 'nebius', model: 'meta-llama/Llama-3.3-70B-Instruct', name: 'llama-3.3-70b · nebius' },
    { provider: 'xai', model: 'grok-3-mini', name: 'grok-3-mini · xai' },
    /* NVIDIA — TOUTES les IA gratuites de build.nvidia.com UTILISABLES en
       chat, vérifiées le 2026-09-26 : 82 modèles listés via GET /v1/models,
       17 répondent sur /v1/chat/completions (65 → 404 « not found for
       account », 500/503 ou timeout). FAQ officielle NVIDIA : free tier
       40 RPM par modèle, AUCUN billing par token → 0 €.
       kimi-k3 en tête (modèle de référence : effort « max », 16 384 tok).
       Les entrées sans `payload` héritent du cadrage PROVIDERS.nvidia ;
       `payload` local remplace le cadrage pour les modèles qui refusent
       reasoning_effort ou plafonnent sous 16 384 tokens.
       Exclu : nvidia/nemotron-parse-2.0 (répond en ~2 M d'événements SSE
       sans texte lisible → inutilisable en discussion). */
    { provider: 'nvidia', model: 'moonshotai/kimi-k3', name: 'kimi-k3 · nvidia' },
    { provider: 'nvidia', model: 'z-ai/glm-5.3', name: 'glm-5.3 · nvidia' },
    { provider: 'nvidia', model: 'z-ai/glm-5.3-flash', name: 'glm-5.3-flash · nvidia' },
    { provider: 'nvidia', model: 'google/gemma-4-31b-it', name: 'gemma-4-31b · nvidia' },
    { provider: 'nvidia', model: 'google/diffusiongemma-26b-a4b-it', name: 'diffusiongemma-26b · nvidia' },
    { provider: 'nvidia', model: 'meta/muse-glimmer-30b', name: 'muse-glimmer-30b · nvidia' },
    { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b-a12b', name: 'nemotron-3-super 120b · nvidia' },
    { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b', name: 'nemotron-3-ultra 550b · nvidia' },
    { provider: 'nvidia', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', name: 'nemotron-3-nano omni · nvidia' },
    { provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b', name: 'nemotron-3.5-lightning · nvidia' },
    { provider: 'nvidia', model: 'nvidia/ising-calibration-1.5-31b', name: 'ising-calibration-31b · nvidia' },
    { provider: 'nvidia', model: 'meta/llama-3.2-11b-vision-instruct', name: 'llama-3.2-11b vision · nvidia', payload: { temperature: 1, max_tokens: 16384, seed: 0 } },
    /* spécialisés : en ligne, mais réponses non conversationnelles */
    { provider: 'nvidia', model: 'nvidia/riva-translate-4b-instruct-v1.1', name: 'riva-translate v1.1 · nvidia (trad.)', payload: { temperature: 1, max_tokens: 4096, seed: 0 } },
    { provider: 'nvidia', model: 'nvidia/riva-translate-4b-instruct-v2', name: 'riva-translate v2 · nvidia (trad.)', payload: { temperature: 1, max_tokens: 2048, seed: 0 } },
    { provider: 'nvidia', model: 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3', name: 'nemotron-safety-guard · nvidia (garde)' },
    { provider: 'nvidia', model: 'nvidia/nemotron-3.5-content-safety', name: 'nemotron-content-safety · nvidia (garde)', payload: { temperature: 1, max_tokens: 16384, seed: 0 } },
  ];

  function keyFor(provider) {
    var store = {};
    try { store = JSON.parse(localStorage.getItem('athena_api_keys') || '{}') || {}; } catch (e) { store = {}; }
    var k = (window.ATHENA_KEYS && window.ATHENA_KEYS[provider]) || store[provider] || '';
    return typeof k === 'string' ? k.trim() : '';
  }

  /* Base URL d'un provider : fixe (base) ou dynamique via baseKey
     (proxy Worker pour tokenrouter / nvidia — URL remplie dans keys.js). */
  function baseFor(p) {
    if (p && p.base) return p.base;
    return p && p.baseKey ? keyFor(p.baseKey) : '';
  }

  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  function ndjson(events, status) {
    var txt = events.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n';
    return new Response(txt, {
      status: status || 200,
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  function erreurs(obj) {
    var msg = (obj && obj.erreur) || 'Erreur inconnue.';
    return msg;
  }

  /* Texte exposé à l'UI : humaniserErreur() n'affiche le détail QUE si la
     chaîne est "lisible" (≤300 car., sans HTML/JSON/traceback) ET si le
     status est <500. On sanitisée donc et on renvoie 400 (pas 502) pour
     que l'utilisateur voie la VRAIE raison (429, timeout, CORS, quota…). */
  function detailAffichable(msg) {
    var t = String(msg || 'erreur inconnue')
      .replace(/[\{\}<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length > 280) t = t.slice(0, 280) + '…';
    return 'Échec des modèles : ' + t;
  }

  /* Garde-fou par tentative : une souche qui bloque (saturée, Turnstile,
     sans réponse) ne fait plus échouer la chaîne entière — on enchaîne sur
     le modèle suivant après 60 s. */
  function appelBorne(promise, ms) {
    return new Promise(function (resolve, reject) {
      var fini = false;
      var t = setTimeout(function () {
        if (fini) return;
        fini = true;
        reject(new Error('timeout ' + ms + ' ms'));
      }, ms);
      promise.then(function (v) {
        if (fini) return;
        fini = true;
        clearTimeout(t);
        resolve(v);
      }, function (e) {
        if (fini) return;
        fini = true;
        clearTimeout(t);
        reject(e);
      });
    });
  }

  /* ---- Modèles tokenrouter : liste dynamique via GET /models -----
     Le catalogue amont est inconnu à l'avance (300+ modèles) : on le
     lit depuis le proxy (cache 5 min). Quota épuisé / proxy absent →
     la liste reste vide et le HUD affiche l'erreur honnête. */
  var DYN = { ts: 0, models: [], err: '' };

  async function refreshDyn() {
    var p = PROVIDERS.tokenrouter;
    var base = baseFor(p);
    var key = keyFor('tokenrouter');
    if (!base || !key) { DYN = { ts: 0, models: [], err: '' }; return; }
    if (Date.now() - DYN.ts < 300000 && (DYN.models.length || DYN.err)) return;
    try {
      var r = await appelBorne(realFetch(base + '/models', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + key },
      }), 8000);
      var t = await r.text();
      var d = null;
      try { d = JSON.parse(t); } catch (e) { d = null; }
      if (!r.ok) {
        var m = (d && d.error && d.error.message) || t.slice(0, 80) || ('HTTP ' + r.status);
        DYN = { ts: Date.now(), models: [], err: r.status + ' ' + m };
        return;
      }
      var ids = (d && Array.isArray(d.data) ? d.data : [])
        .map(function (x) { return x && (x.id || x.name); })
        .filter(function (s) { return typeof s === 'string' && s; })
        .slice(0, 40);
      DYN = {
        ts: Date.now(),
        err: ids.length ? '' : 'liste vide',
        models: ids.map(function (id) {
          return { provider: 'tokenrouter', model: id, name: id + ' · tokenrouter' };
        }),
      };
    } catch (e) {
      DYN = { ts: Date.now(), models: [], err: String((e && e.message) || e).slice(0, 80) };
    }
  }

  function catalogue() {
    var liste = MODELS.concat(DYN.models);
    var cat = liste.map(function (m) {
      var p = PROVIDERS[m.provider];
      var aCle = !!(p && keyFor(m.provider));
      var aBase = !!(p && baseFor(p));
      var up = !!(p && (p.free || (aCle && aBase)));
      var label = p ? p.label : m.provider;
      if (!up && p && !p.free) {
        label = m.provider + ' · ' + (!aCle ? 'clé manquante' : 'proxy non déployé');
      }
      return { id: m.provider + ':' + m.model, name: m.name, model: m.model, provider: label, providerKey: m.provider, active: false, local: false, up: up, payload: m.payload || null };
    });
    if (DYN.err && keyFor('tokenrouter') && keyFor('tokenrouter_proxy')) {
      var st = DYN.err.replace(/[\{\}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
      cat.push({
        id: 'tokenrouter:__err__',
        name: 'tokenrouter (liste indisponible)',
        provider: 'tokenrouter · ' + st,
        active: false,
        local: false,
        up: false,
      });
    }
    return cat;
  }

  /* Modèles openrouter « :free » du catalogue : envoyés en tableau models[]
     OpenRouter cascade lui-même sur 429/5xx (rate-limit pool partagé amont
     = une seule issue : un autre free du trio/extra). */
  var OR_TRIO = [
    'z-ai/glm-5.2:free',
    'google/gemma-4-31b-it:free',
    'qwen/qwen3.8-27b:free',
  ];
  var OR_EXTRA = [
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
  ];
  var OR_FREE = OR_TRIO.concat(OR_EXTRA, [
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3.5-lightning:free',
    'thinkingmachines/inkling:free',
    'thinkingmachines/inkling-small:free',
    'poolside/laguna-s-2.1:free',
    'poolside/laguna-xs-2.1:free',
    'cohere/north-mini-code:free',
    'nex-agi/nex-n2.5-mini:free',
    'nex-agi/nex-n2.5-pro:free',
    'inclusionai/ling-3.0-flash-sante:free',
    'inclusionai/ling-3.0-flash-fin:free',
    'dots-studio/dots-3-note-preview:free',
    'liquid/lfm-2.5-2.6b:free',
    'nvidia/nemotron-3.5-content-safety:free',
    'openrouter/free',
  ]);

  function orModelsBody(entryModel) {
    if (OR_FREE.indexOf(entryModel) < 0) return null;
    /* OpenRouter : models[] = 3 items max (400 au-delà). */
    if (OR_TRIO.indexOf(entryModel) >= 0) {
      var autresTrio = OR_TRIO.filter(function (m) { return m !== entryModel; });
      return [entryModel].concat(autresTrio); /* 3 = trio complet */
    }
    if (entryModel === 'openrouter/free') return [entryModel];
    /* free hors trio : cible + 2 du trio (cascade maximale) */
    var pad = OR_TRIO.filter(function (m) { return m !== entryModel; }).slice(0, 2);
    return [entryModel].concat(pad);
  }

  /* ---- Agent local (:3020) — exécution de commandes PC ----
     Le navigateur ne peut pas lancer un shell : on délègue à
     mini-services/local-agent (127.0.0.1). Absent → erreur honnête. */
  var LOCAL_AGENT = 'http://127.0.0.1:3020';

  var ATHENA_SYSTEM_EXEC =
    'Athéna · outil local : pour exécuter une commande sur le PC de l\'utilisateur, ' +
    'réponds UNIQUEMENT avec un bloc de code fenced avec le langage exact athena-exec ' +
    'contenant la commande shell exacte, par exemple:\n```athena-exec\nhostname\n```\n' +
    'La UI affichera un bouton « Exécuter » (confirmation obligatoire → agent local 127.0.0.1:3020). ' +
    'N\'invente pas d\'autres balises d\'exécution. Si l\'agent est injoignable, dis-le simplement.';

  async function agentLocalExec(payload, signal) {
    try {
      /* Chrome Local Network Access (2026) : une page HTTPS publique doit
         déclarer targetAddressSpace:'loopback' pour toucher 127.0.0.1 —
         sinon ERR_FAILED avant même le preflight CORS. Permission browser
         (site info → Local Network → Allow) peut rester requise. */
      var reqInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: signal || undefined,
      };
      try {
        var reqObj = new Request(LOCAL_AGENT + '/exec', reqInit);
        if ('targetAddressSpace' in reqObj) reqObj.targetAddressSpace = 'loopback';
        var r = await appelBorne(realFetch(reqObj), 25000);
      } catch (eReq) {
        var r = await appelBorne(realFetch(LOCAL_AGENT + '/exec', reqInit), 25000);
      }
      var t = await r.text();
      var d = null;
      try { d = JSON.parse(t); } catch (e) { d = null; }
      if (!d) return json({ erreur: 'agent local : réponse illisible' }, 502);
      return json(d, r.status || 200);
    } catch (e) {
      return json({
        erreur: 'Agent local injoignable ou Local Network bloqué — démarrez node mini-services/local-agent/index.js, puis autorisez le site (⋮ → Local Network → Allow).',
        detail: String((e && e.message) || e).slice(0, 160),
      }, 503);
    }
  }

  async function gererExec(bodyStr, signal) {
    var body = {};
    try { body = JSON.parse(bodyStr || '{}'); } catch (e) { body = {}; }
    var commande = String(body.commande || body.command || '').trim();
    if (!commande) return json({ erreur: 'commande absente' }, 400);
    return agentLocalExec({
      commande: commande,
      confirme: body.confirme === true,
      cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
      timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined,
    }, signal);
  }

  /* Garde-fou par appel : openrouter attend le reset de quota (~70 s) ;
     nvidia kimi-k3 raisonne longtemps (effort « max », 16 384 tokens) →
     5 min, la coupure interne se faisant sur l'inactivité (120 s/chunk). */
  function bornePour(entry) {
    if (entry.providerKey === 'openrouter') return 70000;
    if (entry.providerKey === 'nvidia') return 300000;
    return 60000;
  }

  /* onDelta (etape, message) : fourni par gererChat sur un flux NDJSON —
     chaque tranche de raisonnement part alors EN DIRECT vers l'UI. */
  function callModel(entry, messages, signal, onDelta) {
    /* entry.provider = label d'affichage (« nvidia · proxy CF ») ;
       la clé PROVIDERS est dans entry.providerKey ( ajouté au catalogue ). */
    var pk = entry.providerKey || entry.provider;
    var p = PROVIDERS[pk];
    if (!p) return Promise.reject(new Error('provider inconnu : ' + pk));
    var key = keyFor(pk);
    if (!p.free && !key && !p.viaProxy) return Promise.reject(new Error(pk + ' : clé API manquante'));
    var base = baseFor(p);
    if (!base) return Promise.reject(new Error(pk + ' : proxy non déployé (keys.js: ' + (p.baseKey || 'base') + ')'));
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = 'Bearer ' + key;
    if (p.extra) {
      var x = p.extra();
      Object.keys(x).forEach(function (k) { headers[k] = x[k]; });
    }
    var orList = pk === 'openrouter' ? orModelsBody(entry.model) : null;
    var orBase = orList ? orList.slice() : null;

    function corpsPour(liste, enFlux) {
      var c = {
        messages: messages,
        temperature: 0.6,
        max_tokens: 1200,
        stream: !!enFlux,
      };
      /* cadrage spécifique : provider (nvidia → kimi-k3 : temperature 1,
         seed 0, max_tokens 16384, reasoning_effort « max ») ; une entry
         peut le surcharger (payload local) pour un modèle qui refuse
         reasoning_effort ou plafonne sous 16 384 tokens. */
      var opts = entry.payload || (p.payload ? p.payload() : null);
      if (opts) {
        Object.keys(opts).forEach(function (k) { c[k] = opts[k]; });
      }
      if (liste) c.models = liste;
      else c.model = entry.model;
      return JSON.stringify(c);
    }

    function erreurHttp(r, t) {
      var d = null;
      try { d = JSON.parse(t); } catch (e) { d = null; }
      var m = (d && d.error && d.error.message) || t.slice(0, 180) || ('HTTP ' + r.status);
      var err = new Error(entry.provider + ' ' + r.status + ' : ' + m);
      err.status = r.status;
      if (d && d.error && d.error.metadata) {
        var md = d.error.metadata;
        err.retryAfter = md.retry_after_seconds
          || (md.headers && md.headers['Retry-After'])
          || null;
        err.limitSource = md.limit_source || null;
        /* free-models-per-min : Reset = epoch ms de fin de fenêtre */
        if (md.headers && md.headers['X-RateLimit-Reset']) {
          err.resetAt = parseInt(md.headers['X-RateLimit-Reset'], 10) || null;
        }
      }
      return err;
    }

    function texteDe(d) {
      var ch = d && d.choices && d.choices[0];
      var c = ch && ch.message;
      var txt = c && c.content;
      if (Array.isArray(txt)) {
        txt = txt.map(function (x) { return (x && x.text) || ''; }).join('');
      }
      /* reasoning-only (modèles free type GLM/gemma/qwen) : si content
         vide, on retient le raisonnement plutôt que d'échouer. */
      if ((!txt || !String(txt).trim()) && c && typeof c.reasoning === 'string' && c.reasoning.trim()) {
        txt = c.reasoning;
      }
      if (txt && typeof txt !== 'string') txt = JSON.stringify(txt);
      if (d && d.model) {
        try { entry._modeleReel = String(d.model); } catch (e) {}
      }
      return txt ? String(txt) : '';
    }

    /* ---- Flux SSE amont (nvidia) : data: {delta.reasoning_content|content}
       accumulés puis rendus en texte complet ; si onDelta est branché, chaque
       tranche part aussi en événement progress (panneau raisonnement live).
       Inactivité bornée à 120 s par chunk : le raisonnement « max » est long
       mais jamais silencieux. */
    async function lireSSE(r) {
      var reader = r.body.getReader();
      var dec = new TextDecoder();
      var tampon = '';
      var contenu = '';
      var pensee = '';
      var emisPensee = 0;
      var emisContenu = 0;
      var dernierEnvoi = 0;
      var fini = false;
      var emis = false;

      function tranche(txt, dep) {
        var s = txt.slice(dep);
        return s.length > 200 ? '…' + s.slice(-200) : s;
      }
      function diffuser() {
        if (!onDelta) return;
        var maintenant = Date.now();
        var np = pensee.length - emisPensee;
        var nc = contenu.length - emisContenu;
        if (np <= 0 && nc <= 0) return;
        var debutReponse = nc > 0 && emisContenu === 0;
        /* rafraîchi au pire toutes les ~900 ms ou dès 120 nouveaux caractères
           (le panneau ne garde que 40 étapes) ; le début de réponse n'attend
           pas : il clôt le raisonnement. */
        if (!debutReponse && np + nc < 120 && maintenant - dernierEnvoi < 900) return;
        if (np > 0) {
          onDelta('reasoning', tranche(pensee, emisPensee));
          emisPensee = pensee.length;
        }
        if (debutReponse) {
          onDelta('generation', 'Rédaction de la réponse…');
          emisContenu = contenu.length;
        } else if (nc > 0) {
          onDelta('generation', tranche(contenu, emisContenu));
          emisContenu = contenu.length;
        }
        dernierEnvoi = maintenant;
        emis = true;
      }

      try {
        while (!fini) {
          var lu = await appelBorne(reader.read(), 120000);
          if (lu.done) break;
          tampon += dec.decode(lu.value, { stream: true });
          var idx;
          while ((idx = tampon.indexOf('\n')) >= 0) {
            var ligne = tampon.slice(0, idx);
            tampon = tampon.slice(idx + 1);
            if (ligne.charAt(0) === '\r') ligne = ligne.slice(1);
            if (ligne.indexOf('data:') !== 0) continue;
            var donnees = ligne.slice(5).replace(/^ /, '');
            if (donnees === '[DONE]') { fini = true; break; }
            var d = null;
            try { d = JSON.parse(donnees); } catch (e) { continue; }
            if (d && d.error) {
              var eFlux = new Error(entry.provider + ' : ' + ((d.error && d.error.message) || 'erreur de flux'));
              eFlux.status = (d.error && d.error.status) || 500;
              throw eFlux;
            }
            var ch = d && d.choices && d.choices[0];
            var delta = (ch && ch.delta) || {};
            if (typeof delta.reasoning_content === 'string') pensee += delta.reasoning_content;
            else if (typeof delta.reasoning === 'string') pensee += delta.reasoning;
            if (typeof delta.content === 'string') contenu += delta.content;
            if (d && d.model) {
              try { entry._modeleReel = String(d.model); } catch (e) {}
            }
            diffuser();
          }
        }
      } catch (e) {
        try { reader.cancel(); } catch (e2) {}
        /* des étapes sont déjà parties : JAMAIS de re-POST (doublon UI). */
        if (e && emis) e.partiel = true;
        throw e;
      }
      var txt = contenu;
      if (!String(txt).trim()) txt = pensee;
      if (!String(txt).trim()) throw new Error(entry.provider + ' : réponse vide');
      return String(txt);
    }

    function uneTentative(liste) {
      var enFlux = !!p.sse;
      var enTetes = headers;
      if (enFlux) {
        enTetes = {};
        Object.keys(headers).forEach(function (k) { enTetes[k] = headers[k]; });
        enTetes.Accept = 'text/event-stream';
      }
      return realFetch(base + '/chat/completions', {
        method: 'POST',
        headers: enTetes,
        signal: signal || undefined,
        body: corpsPour(liste, enFlux),
      }).then(function (r) {
        if (enFlux && r.ok && r.body) return lireSSE(r);
        return r.text().then(function (t) {
          if (!r.ok) throw erreurHttp(r, t);
          var d = null;
          try { d = JSON.parse(t); } catch (e) { d = null; }
          var txt = texteDe(d);
          if (!txt || !String(txt).trim()) throw new Error(entry.provider + ' : réponse vide');
          return txt;
        });
      });
    }

    /* Retry sur 429/502/503 : 2 retries max (quota free = 20 req/min,
       chaque POST compte). Rotation du free prioritaire à chaque essai.
       Quota free-models-per-min : on attend le vrai reset (borné pour
       rester sous appelBorne). */
    var delaisRetry = [700, 1800];
    function avecRetry(n, liste) {
      return uneTentative(liste).catch(function (err) {
        if (err && err.name === 'AbortError') throw err;
        /* flux déjà diffusé en partie → re-POST interdit (étapes en double) */
        if (err && err.partiel) throw err;
        var st = err && err.status;
        var retryable = st === 429 || st === 502 || st === 503;
        if (retryable && n < delaisRetry.length && !(signal && signal.aborted)) {
          var prochaine = liste;
          if (liste && liste.length > 1) {
            /* rotation : modèle rate-limité passe en fin de file */
            prochaine = liste.slice(1).concat(liste.slice(0, 1));
          }
          var attente = delaisRetry[n];
          /* quota OpenRouter free/min : Reset = timestamp ms.
             On attend jusqu'à ~64 s si compatible avec borneMs OR (70 s),
             sinon fail-fast → pollinations répond tout de suite. */
          if (err.resetAt) {
            var reste = err.resetAt - Date.now();
            if (reste > 0 && reste < 64000) {
              attente = Math.min(reste + 250, 64000);
            } else if (reste >= 64000) {
              throw err;
            }
          } else if (err.retryAfter) {
            var ra = parseInt(err.retryAfter, 10);
            if (!isNaN(ra) && ra > 0 && ra < 8) attente = Math.min(ra * 1000, 5000);
          }
          /* free-models-per-min : 1 seul cycle d'attente-reset puis on rend la main */
          if (err.limitSource === 'openrouter_free_tier_per_minute' && n >= 1) {
            throw err;
          }
          return new Promise(function (res) { setTimeout(res, attente); })
            .then(function () { return avecRetry(n + 1, prochaine); });
        }
        throw err;
      });
    }
    return avecRetry(0, orBase);
  }

  function construireChaine(modelId) {
    var cat = catalogue();
    var parId = {};
    cat.forEach(function (e) { parId[e.id] = e; });
    var chaine = [];
    if (modelId && parId[modelId] && parId[modelId].up) chaine.push(parId[modelId]);
    /* Un seul entry openrouter free : models[] couvre déjà les autres free
       en cascade interne → on ne les empile pas (évite 5× la même requête). */
    var orCouvert = chaine.some(function (e) {
      return e.providerKey === 'openrouter' && OR_FREE.indexOf(e.model) >= 0;
    });
    cat.forEach(function (e) {
      if (!e.up || chaine.indexOf(e) >= 0) return;
      if (e.providerKey === 'openrouter' && OR_FREE.indexOf(e.model) >= 0) {
        if (orCouvert) return;
        orCouvert = true;
      }
      chaine.push(e);
    });
    return { chaine: chaine, choisiOk: !modelId || (parId[modelId] && parId[modelId].up) };
  }

  async function gererChat(bodyStr, signal) {
    var body = {};
    try { body = JSON.parse(bodyStr || '{}'); } catch (e) { body = {}; }
    var wantStream = body.stream === true;
    var messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter(function (m) { return m && typeof m === 'object' && typeof m.content === 'string'; });
    if (!messages.length) {
      var e1 = 'Aucun message à traiter.';
      return wantStream ? ndjson([{ type: 'erreur', erreur: e1 }], 400) : json({ erreur: e1 }, 400);
    }
    var attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length) {
      messages = messages.slice();
      var noms = attachments.map(function (a) { return (a && (a.name || a.filename || a.file_id)) || 'fichier'; }).join(', ');
      var dernier = messages[messages.length - 1];
      messages[messages.length - 1] = {
        role: dernier.role,
        content: dernier.content + '\n\n(Pièces jointes : ' + noms + ' — Pages statique : contenu fichier non transféré.)',
      };
    }

    await refreshDyn();

    /* Instructions systèmePages : le bloc ```athena-exec est le SEUL chemin
       d'exécution de commande (bouton UI → /api/exec → local-agent). */
    var aSystem = messages.some(function (m) { return m.role === 'system'; });
    if (!aSystem) {
      messages = [{ role: 'system', content: ATHENA_SYSTEM_EXEC }].concat(messages);
    } else if (body.outils !== false) {
      messages = messages.map(function (m, idx) {
        if (m.role !== 'system' || idx !== 0) return m;
        if (m.content.indexOf('athena-exec') >= 0) return m;
        return { role: 'system', content: m.content + '\n\n' + ATHENA_SYSTEM_EXEC };
      });
    }

    var plan = construireChaine(typeof body.model_id === 'string' ? body.model_id : '');
    if (!plan.chaine.length) {
      var e2 = 'Aucun modèle disponible (clé API manquante pour tous les providers non gratuits).';
      return wantStream ? ndjson([{ type: 'erreur', erreur: e2 }], 503) : json({ erreur: e2 }, 503);
    }

    /* aboutissement d'une tentative réussie — commun aux 2 chemins */
    function assembler(entry, texte) {
      var modeleReel = entry._modeleReel || entry.model || '';
      var modeleDemande = typeof body.model_id === 'string' && body.model_id
        ? body.model_id.split(':').slice(1).join(':')
        : '';
      var repli = !!(modeleDemande && modeleReel && modeleReel !== modeleDemande);
      var nomVoie = entry.name || entry.id;
      /* n'afficher « (openrouter free) » que si CET entry est openrouter
         (Pollinations renvoie aussi un d.model exotique : gpt-oss-20b). */
      if (entry.providerKey === 'openrouter' && modeleReel && modeleReel !== entry.model) {
        nomVoie = modeleReel + ' (openrouter free)';
      }
      return {
        nomVoie: nomVoie,
        payload: {
          reponse: texte,
          outil: null,
          correction: false,
          verification: null,
          rag: null,
          tache: null,
          raisonnement: null,
          conversation_id: typeof body.conversation_id === 'string' ? body.conversation_id : null,
          modele_repli: repli || undefined,
        },
      };
    }

    var dernierErr = null;

    /* ---- Chemin JSON (sans flux) : tout arrive d'un coup ---- */
    if (!wantStream) {
      for (var i = 0; i < plan.chaine.length; i++) {
        var entry = plan.chaine[i];
        try {
          var texte = await appelBorne(callModel(entry, messages, signal), bornePour(entry));
          return json(assembler(entry, texte).payload);
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          dernierErr = err;
        }
      }
      var msg = detailAffichable((dernierErr && dernierErr.message) || 'erreur inconnue');
      return json({ erreur: msg }, 400);
    }

    /* ---- Chemin NDJSON : les étapes partent EN DIRECT ----
       nvidia (SSE) : chaque tranche de raisonnement → une ligne
       {type:'progress'} du panneau « raisonnement en direct », puis
       {type:'final'} porte la réponse agrégée. Les autres providers
       n'ont pas de flux amont : ils émettent appel → réponse d'un bloc. */
    var enc = new TextEncoder();
    var flux = new ReadableStream({
      start: async function (ctrl) {
        var emit = function (ev) {
          try { ctrl.enqueue(enc.encode(JSON.stringify(ev) + '\n')); } catch (e) {}
        };
        var err = null;
        for (var i = 0; i < plan.chaine.length; i++) {
          var entry = plan.chaine[i];
          var pk = entry.providerKey || entry.provider;
          var p = PROVIDERS[pk];
          emit({ type: 'progress', etape: 'appel', message: 'Appel · ' + (entry.name || entry.id) });
          var onDelta = p && p.sse
            ? function (etape, message) { emit({ type: 'progress', etape: etape, message: message }); }
            : null;
          try {
            var texte = await appelBorne(callModel(entry, messages, signal, onDelta), bornePour(entry));
            var fin = assembler(entry, texte);
            emit({ type: 'progress', etape: 'generation', message: 'Réponse générée via ' + fin.nomVoie });
            emit({
              type: 'final',
              reponse: fin.payload.reponse,
              outil: null,
              correction: false,
              verification: null,
              rag: null,
              tache: null,
              conversation_id: fin.payload.conversation_id,
              raisonnement: null,
              modele_repli: fin.payload.modele_repli,
            });
            try { ctrl.close(); } catch (e) {}
            return;
          } catch (e2) {
            if (e2 && e2.name === 'AbortError') {
              try { ctrl.error(e2); } catch (e3) {}
              return;
            }
            err = e2;
          }
        }
        emit({ type: 'erreur', erreur: detailAffichable((err && err.message) || 'erreur inconnue') });
        try { ctrl.close(); } catch (e) {}
      },
    });
    return new Response(flux, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  async function handleApi(url, input, init) {
    var path = url.split('?')[0];
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var signal = (init && init.signal) || (input && input.signal) || null;
    var body = (init && init.body != null) ? init.body : null;
    if (body == null && input && typeof input !== 'string' && typeof input.clone === 'function') {
      try { body = await input.clone().text(); } catch (e) { body = null; }
    }

    if (path === '/api/chat') {
      if (method === 'GET') return json({ modele_charge: true, version: '10.9.4-pages' });
      if (method === 'POST') return gererChat(body, signal);
      return json({ erreur: 'méthode' }, 405);
    }
    if (path === '/chat-attache') {
      if (method === 'POST') return gererChat(body, signal);
      return json({ erreur: 'méthode' }, 405);
    }
    if (path === '/api/exec') {
      if (method === 'POST') return gererExec(body, signal);
      if (method === 'GET') {
        try {
          var hsReq = new Request(LOCAL_AGENT + '/sante');
          if ('targetAddressSpace' in hsReq) hsReq.targetAddressSpace = 'loopback';
          var hs;
          try { hs = await appelBorne(realFetch(hsReq), 2000); }
          catch (eH) { hs = await appelBorne(realFetch(LOCAL_AGENT + '/sante'), 2000); }
          return json(await hs.json(), hs.status);
        } catch (e) {
          return json({
            ok: false,
            erreur: 'agent local injoignable ou Local Network bloqué — autorisez le site (⋮ → Local Network → Allow)',
            port: 3020,
          }, 503);
        }
      }
      return json({ erreur: 'méthode' }, 405);
    }
    if (path === '/api/modeles') {
      await refreshDyn();
      return json({ dispo: true, modeles: catalogue() });
    }
    if (path === '/api/files') {
      if (method === 'POST') {
        var fb = {};
        try { fb = JSON.parse(body || '{}'); } catch (e) {}
        return json({ file_id: 'f' + Date.now().toString(36), filename: fb.filename || 'fichier', status: 'indexed', chunks: 0 });
      }
      if (method === 'DELETE') return json({ ok: true });
      return json({ erreur: 'méthode' }, 405);
    }
    if (path === '/api/entrainer') {
      if (method === 'GET') {
        return json({
          conversations: 0,
          base_connaissances: 0,
          preuves: 0,
          en_cours: false,
          progression: {},
          exemples: [],
        });
      }
      if (method === 'DELETE') return json({ ok: true });
      if (method === 'POST' || method === 'PATCH') {
        return json({ erreur: 'Entraînement indisponible sur GitHub Pages (site statique — servez le pipeline complet pour cet écran).' });
      }
      return json({ erreur: 'méthode' }, 405);
    }
    if (path === '/api/design') {
      if (method === 'GET') return json({ tokens: null });
      if (method === 'DELETE') return json({ ok: true });
      if (method === 'POST') return json({ erreur: 'Import de thème indisponible sur GitHub Pages (site statique).' }, 400);
      return json({ erreur: 'méthode' }, 405);
    }
    return json({ erreur: 'route inconnue' }, 404);
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string'
      ? input
      : (input && typeof input.url === 'string' ? input.url : '');
    if (url.charAt(0) !== '/' || url.charAt(1) === '/') {
      // absolu (https://…) ou protocol-relative : on ne touche pas
      if (url.indexOf('/api/') === -1 && url.indexOf('/chat-attache') === -1) return realFetch(input, init);
      if (/^https?:\/\//.test(url)) return realFetch(input, init);
    }
    if (/^\/(api\/|chat-attache)/.test(url)) return handleApi(url, input, init || {});
    return realFetch(input, init);
  };
})();
