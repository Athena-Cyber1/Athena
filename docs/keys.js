/* ============================================================
   Athéna — clés API des modèles cloud (GitHub Pages).

   ⚠ CET EST PUBLIC : tout ce qui est écrit ICI est lisible par
   quiconque ouvre la page (view-source) et par le dépôt GitHub.
   Utilisez des clés À PLAFOND LIMITÉ (dépense max) et révoquables.

   Remplissez une clé pour activer le modèle correspondant dans le
   HUD (sélecteur ▾ du header). Les modèles sans clé (pollinations)
   restent gratuits et actifs par défaut.

   Alternative SANS écrire la clé dans le dépôt (prioritaire) :
   localStorage de la console du navigateur —
     localStorage.setItem('athena_api_keys', JSON.stringify({ groq: 'gsk_…' }))
   ============================================================ */
window.ATHENA_KEYS = {
  openai: "",      // sk-…      → gpt-4o-mini (CORS souvent bloqué en navigateur)
  groq: "",        // gsk_…     → llama-3.3-70b, llama-3.1-8b
  openrouter: "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",
                   // compte GRATUIT sans carte ; modèles « :free » = 0 crédit
  deepseek: "",    // sk-…      → deepseek-chat
  mistral: "",     // …         → mistral-small-latest
  together: "",    // …         → llama-3.3-70b
  gemini: "",      // AIza…     → gemini-2.0-flash
  zai: "",         // …         → glm-4.5-air (open.bigmodel.cn)
  cerebras: "",    // …         → llama-3.3-70b
  nebius: "",      // …         → llama-3.3-70b
  xai: "",         // …         → grok-3-mini
  tokenrouter: "sk-0D7XguItXT6h9KawDNTX9cK7xd3rveysAmdwZfDqSNzSwJsR",
                   // jeton Token Router (api.tokenrouter.com) — UTILISÉ VIA
                   // le proxy Worker ci-dessous (l'amont 403 les navigateurs).
                   // ⚠ quota actuellement épuisé (RemainQuota=0) : recharger
                   // sur le dashboard tokenrouter.com avant usage.
  tokenrouter_proxy: "https://athena.amineelbekkai8.workers.dev/v1",
                   // proxy Cloudflare Worker (déployé) — contourne le 403
                   // navigateur de api.tokenrouter.com. Vide = modèles
                   // tokenrouter grisés "proxy non déployé".
  nvidia: "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",
                   // clé NVIDIA (integrate.api.nvidia.com) → kimi-k3.
                   // UTILISÉE VIA le proxy Worker ci-dessous : l'amont ne
                   // renvoie aucun en-tête CORS → fetch navigateur bloqué.
  nvidia_proxy: "https://athena.amineelbekkai8.workers.dev/nvidia/v1",
                   // même Worker, monture /nvidia → integrate.api.nvidia.com
                   // (routage par préfixe : /v1 reste tokenrouter).
                   // ⚠ RE-DÉPLOYER le worker après toute modification de
                   // worker/index.js (cd worker && npx wrangler deploy) :
                   // sinon /nvidia/v1/… renvoie 404 et kimi-k3 est grisé.
};
