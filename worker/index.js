/* ============================================================
   Athéna — proxy CORS « providers » (Cloudflare Worker).

   Pourquoi : deux amonts refusent le navigateur —
   - api.tokenrouter.com renvoie 403 à TOUTE requête portant un
     Origin navigateur (blocage openresty côté serveur) ;
   - integrate.api.nvidia.com ne renvoie AUCUN en-tête CORS (ni
     Access-Control-Allow-Origin) hors sa propre origine :
     le fetch navigateur échoue en « Failed to fetch ».
   Ce Worker relaie côté serveur (sans Origin) et rejoute les
   en-têtes CORS nécessaires au navigateur de la Pages.

   Routage par préfixe de chemin (un amont = un monture) :
     /nvidia/v1/… → https://integrate.api.nvidia.com/v1/…
     /v1/…        → https://api.tokenrouter.com/v1/…   (rétrocompatible)

   Déploiement :
     cd worker && npx wrangler deploy
   ou : coller index.js dans Cloudflare Dashboard → Workers →
        Create Worker → Deploy, puis copier l'URL
        https://<nom>.<compte>.workers.dev

   Puis renseigner cette URL dans docs/keys.js :
     tokenrouter_proxy : "https://<url>/v1"
     nvidia_proxy      : "https://<url>/nvidia/v1"

   Sécurité (v20260928) : AUCUNE clé dans le dépôt ni dans le
   navigateur. Les secrets vivent dans le Worker :
     npx wrangler secret put NVIDIA_KEY        (clé nvapi-…)
     npx wrangler secret put TOKENROUTER_KEY   (clé sk-…)
   puis `npx wrangler deploy`. Le Worker injecte le secret côté
   serveur quand le client n'envoie pas d'Authorization (cas normal
   de la Pages) ; une clé client reste acceptée en priorité (dev
   local via localStorage athena_api_keys). Pour verrouiller
   l'usage au seul site, mettre ALLOW_ORIGIN à l'URL de la Pages.
   ============================================================ */

const ROUTES = [
  { mount: '/nvidia', upstream: 'https://integrate.api.nvidia.com', secret: 'NVIDIA_KEY' },
  { mount: '', upstream: 'https://api.tokenrouter.com', secret: 'TOKENROUTER_KEY' }, // rétrocompat : /v1/…
];
const ALLOW_ORIGIN = '*'; // ex. 'https://athena-cyber1.github.io'

const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept',
  'Access-Control-Max-Age': '86400',
};

function corsHeaders(extra) {
  const h = new Headers(CORS);
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

function routePour(pathname) {
  for (const r of ROUTES) {
    if (r.mount) {
      if (pathname === r.mount || pathname.startsWith(r.mount + '/')) return r;
    } else if (pathname.startsWith('/v1/')) {
      return r;
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('method not allowed', { status: 405, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const route = routePour(url.pathname);
    if (!route) {
      return new Response('not found', { status: 404, headers: corsHeaders() });
    }
    // On retire le monture (/nvidia) pour reconstituer le chemin amont.
    const chemin = url.pathname.slice(route.mount.length) || '/';

    // On reconstruit les en-têtes : JAMAIS d'Origin/Referer client
    // (c'est précisément ce que le 403 amont rejette).
    const headers = new Headers();
    const auth = request.headers.get('Authorization');
    if (auth) {
      headers.set('Authorization', auth); // dev local : clé perso prioritaire
    } else if (env && route.secret && env[route.secret]) {
      headers.set('Authorization', 'Bearer ' + env[route.secret]); // secret serveur
    }
    const ct = request.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);
    // Accept transmis tel quel : indispensable pour le flux SSE
    // (Accept: text/event-stream) demandé par l'UI.
    const accept = request.headers.get('Accept');
    if (accept) headers.set('Accept', accept);

    try {
      const upstream = await fetch(route.upstream + chemin + url.search, {
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
