/* ============================================================
   Athéna — proxy CORS « tokenrouter » (Cloudflare Worker).

   Pourquoi : api.tokenrouter.com répond 403 à TOUTE requête
   portant un Origin navigateur (blocage openresty côté serveur).
   Ce Worker relaie côté serveur (sans Origin) et rejoute les
   en-têtes CORS nécessaires au navigateur de la Pages.

   Déploiement :
     cd worker && npx wrangler deploy
   ou : coller index.js dans Cloudflare Dashboard → Workers →
        Create Worker → Deploy, puis copier l'URL
        https://<nom>.<compte>.workers.dev

   Puis renseigner cette URL (+ "v1") dans docs/keys.js
   sous tokenrouter_proxy.

   Sécurité : le proxy est "open" mais inutile sans clé — chaque
   appel doit fournir son propre Authorization: Bearer sk-…
   (l'amont 401 sans clé valide). Optionnel : passer ALLOW_ORIGIN
   à l'URL exacte de la Pages pour restreindre encore l'accès.
   ============================================================ */

const UPSTREAM = 'https://api.tokenrouter.com';
const ALLOW_ORIGIN = '*'; // ex. 'https://athena-cyber1.github.io'

const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Max-Age': '86400',
};

function corsHeaders(extra) {
  const h = new Headers(CORS);
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('method not allowed', { status: 405, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/')) {
      return new Response('not found', { status: 404, headers: corsHeaders() });
    }

    // On reconstruit les en-têtes : JAMAIS d'Origin/Referer client
    // (c'est précisément ce que le 403 amont rejette).
    const headers = new Headers();
    const auth = request.headers.get('Authorization');
    if (auth) headers.set('Authorization', auth);
    const ct = request.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);

    try {
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? request.body : undefined,
        redirect: 'manual',
      });
      const out = corsHeaders();
      const uct = upstream.headers.get('Content-Type');
      if (uct) out.set('Content-Type', uct);
      const rid = upstream.headers.get('x-request-id');
      if (rid) out.set('x-request-id', rid);
      // corps passé tel quel (stream) : SSE/NDJSON non cassés
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: { message: 'proxy: ' + String((e && e.message) || e), type: 'proxy_error' } }),
        { status: 502, headers: corsHeaders({ 'Content-Type': 'application/json' }) }
      );
    }
  },
};
