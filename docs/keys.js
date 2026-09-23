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
  openrouter: "",  // sk-or-…   → compte GRATUIT sans carte ; modèles « :free »
                   // fonctionnent avec 0 crédit (21 dispo, vérifiés).
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
};
