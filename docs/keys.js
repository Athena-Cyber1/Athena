/* ============================================================
   Athéna — clés API des modèles cloud (GitHub Pages).

   ⚠ CE FICHIER EST PUBLIC : n'y écrivez AUCUNE clé (ni view-source,
   ni dépôt GitHub). Les secrets vivent dans le Worker Cloudflare :
     npx wrangler secret put NVIDIA_KEY / TOKENROUTER_KEY
   (voir worker/index.js), qui les injecte côté serveur.

   Usage perso (clé à vous, invisible des autres) : localStorage —
      localStorage.setItem('athena_api_keys', JSON.stringify({ groq: 'gsk_…' }))
   ============================================================ */
window.ATHENA_KEYS = {
   openai: "",      // sk-…      → gpt-4o-mini (CORS souvent bloqué en navigateur)
   groq: "",        // gsk_…     → llama-3.3-70b, llama-3.1-8b
   openrouter: "",   // v20260928 : clé retirée (était visible en public).
                    // compte GRATUIT sans carte ; modèles « :free » = 0 crédit.
                    // Perso : localStorage athena_api_keys { openrouter: 'sk-or-v1-…' }
   deepseek: "",    // sk-…      → deepseek-chat
   mistral: "",     // …         → mistral-small-latest
   together: "",    // …         → llama-3.3-70b
   gemini: "",      // AIza…     → gemini-2.0-flash
   zai: "",         // …         → glm-4.5-air (open.bigmodel.cn)
   cerebras: "",    // …         → llama-3.3-70b
   nebius: "",      // …         → llama-3.3-70b
   xai: "",         // …         → grok-3-mini
   tokenrouter: "",  // v20260928 : secret déplacé dans le Worker (TOKENROUTER_KEY).
                    // Modèles proposés via le proxy sans clé cliente (viaProxy).
                    // ⚠ quota actuellement épuisé (RemainQuota=0) : recharger
                    // sur le dashboard tokenrouter.com avant usage.
  tokenrouter_proxy: "https://athena.amineelbekkai8.workers.dev/v1",
                   // proxy Cloudflare Worker (déployé) — contourne le 403
                   // navigateur de api.tokenrouter.com. Vide = modèles
                   // tokenrouter grisés "proxy non déployé".
   nvidia: "",       // v20261007 (sécurité) : clé RETIRÉE du dépôt. Elle était
                     // versionnée dans un fichier PUBLIC (visible en
                     // view-source et sur GitHub) et lue par le navigateur
                     // pour appeler integrate.api.nvidia.com : n'importe
                     // qui pouvait s'en servir. À RÉÉMETTRE côté serveur :
                     //   cd worker && npx wrangler secret put NVIDIA_KEY
                     // Perso : localStorage athena_api_keys { nvidia: 'nvapi-…' }
                     // (et pense à RÉVOQUER celle qui était publique).
  nvidia_proxy: "https://athena.amineelbekkai8.workers.dev/nvidia/v1",
                   // même Worker, monture /nvidia → integrate.api.nvidia.com
                   // (routage par préfixe : /v1 reste tokenrouter).
                   // ⚠ RE-DÉPLOYER le worker après toute modification de
                   // worker/index.js (cd worker && npx wrangler deploy) :
                   // sinon /nvidia/v1/… renvoie 404 et kimi-k3 est grisé.
};
