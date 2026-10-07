import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/browser — proxy local-agent (127.0.0.1:3020), route navigateur.
 * GET  → /sante (état de l'agent, session Firefox incluse)
 * POST → /browser {action, arg?, confirme?, taille?}
 *   action ∈ ouvrir|snapshot|texte|html|cliquer|taper|js|capture|attente|fermer
 *        ∪ retour|suivant|recharger|survol|glisser        (barre d'URL / outils)
 *        ∪ defiler|touche                         (molette, clavier)
 *        ∪ point|cadre                            (surface humaine, coordonnées
 *          écran = taille de .navigateur-corps, envoyée par le client avec
 *          chaque `cadre` : le viewport de l'agent suit la boîte d'affichage)
 *   arg n'est PAS rogné ici (« touche » + la barre d'espace doit survivre) ;
 *   l'agent tranche : il trime lui-même sauf pour `touche`.
 *   snapshot → arbre ARIA en mode « ai » (Playwright 1.63) : chaque élément
 *         porte `[ref=e13]` (+ `f1e5` en iframe) et `[box=x,y,l,h]`.
 *   cliquer|attente acceptent UNE de ces références (`cliquer e13`) ou un
 *         sélecteur classique (CSS/text=) ; l'agent normalise de son côté.
 *   prechauffer (hors NAV_ACTIONS) → lance Firefox SANS ouvrir de session :
 *         le client l'envoie quand une action est imminente (ouverture du
 *         panneau, modale 428, saisie d'adresse) pour recouvrir les ~2 s de
 *         démarrage. Firefox ne tourne jamais en veille : préchauffé et
 *         inutilisé, il se referme au bout de 60 s.
 *   428 → origine inconnue ou JavaScript : le CLIENT affiche une modale puis
 *         reposte confirme:true (la confirmation ne se fait JAMAIS ici).
 *   409 → verrou navigateur saturé (plus de 30 s d'attente).
 * Agent absent → 503 message honnête (UI affiche « agent navigateur injoignable »).
 *
 * Sécurité (déjà appliquée dans l'agent, reprise ici en défense en profondeur) :
 * schémas dangereux rejetés en 400, origines validées en 428, borne 4000
 * caractères sur `arg`, 428 obligatoire sur `js` sans confirme:true.
 */

const AGENT = "http://127.0.0.1:3020";

/* Une action navigateur ne doit JAMAIS attendre 60 s : snapshot/taper bornés
   à 15 s côté agent. Le proxy laisse 30 s (2 essais réseau + marge). */
const TIMEOUT_PROXY_MS = 30_000;

const ARG_MAX = 4000;

async function proxy(chemin: string, init?: RequestInit): Promise<Response> {
  try {
    const r = await fetch(AGENT + chemin, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_PROXY_MS),
      cache: "no-store",
    });
    const txt = await r.text();
    return new Response(txt, {
      status: r.status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        erreur:
          "Agent navigateur injoignable — démarrez : node mini-services/local-agent/index.js",
        port: 3020,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

function garde(req: Request): Response | null {
  const refus = garderOrigine(req);
  if (refus.ok) return null;
  return reponseRefus(refus.raison ?? "origine non autorisée");
}

/**
 * P4 — relais de FLUX (GET /api/browser?flux=W,H → agent GET /flux?w=&h=).
 *
 * Motivation : depuis une page https (Pages, tunnel, host LAN), le navigateur
 * INTERDIT tout appel vers http://127.0.0.1:3020 (mixed content) : le HUD
 * retombait sur le repli `cadre`, une requête PAR image (≈125 req/s à 8 ms).
 * Le serveur Next, lui, parle à l'agent en local : on relaye donc le flux
 * poussé tel quel.
 *
 * AUCUNE mise en tampon : `amont.body` (ReadableStream) est branché sur la
 * réponse — Node émet en chunked au rythme de page.screenshot, et les trames
 * binaires n'ont ni JSON ni base64. `AbortSignal` du client → coupure amont
 * → l'agent retire l'abonné (`req.on('close')`) et arrête son groupe.
 * `Cache-Control: no-transform` + `X-Accel-Buffering: no` : aucun proxy ne
 * doit regrouper les trames (sinon +100 ms de latence au pire moment).
 */
async function proxyFlux(spec: string, req: Request): Promise<Response> {
  const m = /^(\d{1,5}),(\d{1,5})$/.exec(spec.trim());
  if (!m) {
    return Response.json(
      { erreur: "flux=W,H invalide (ex. ?flux=845,1005)" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  const amont = new AbortController();
  const couper = () => amont.abort();
  try {
    req.signal.addEventListener("abort", couper, { once: true });
  } catch {
    /* signal absent : on repose sur la déconnexion du lecteur */
  }
  return relayerFlux(m[1], m[2], amont.signal);
}

async function relayerFlux(w: string, h: string, signal: AbortSignal): Promise<Response> {
  try {
    const r = await fetch(`${AGENT}/flux?w=${w}&h=${h}`, { cache: "no-store", signal });
    if (!r.ok || !r.body) {
      const txt = await r.text().catch(() => "");
      return new Response(txt || JSON.stringify({ erreur: `flux amont HTTP ${r.status}` }), {
        status: r.status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return new Response(r.body, {
      status: 200,
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "application/x-athena-frames",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      {
        erreur:
          "Agent navigateur injoignable — démarrez : node mini-services/local-agent/index.js",
        port: 3020,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function GET(req: Request) {
  const refus = garde(req);
  if (refus) return refus;
  const flux = new URL(req.url).searchParams.get("flux");
  if (flux !== null) return proxyFlux(flux, req);
  return proxy("/sante");
}

export async function POST(req: Request) {
  const interdite = garde(req);
  if (interdite) return interdite;
  /* v20261007 : `taille` fait partie du contrat transmis à l'agent, donc du
     type du corps parsé — il manquait, et TypeScript le signalait (erreur
     TS2339) sans que quoi que ce soit ne l'affichage. */
  let corps: {
    action?: unknown;
    arg?: unknown;
    confirme?: unknown;
    taille?: { w?: unknown; h?: unknown };
  } = {};
  try {
    corps = await req.json();
  } catch {
    return Response.json({ erreur: "JSON invalide" }, { status: 400 });
  }
  if (typeof corps.action !== "string" || !corps.action.trim()) {
    return Response.json({ erreur: "action manquante" }, { status: 400 });
  }
  const corpsNettoye: {
    action: string;
    arg?: string;
    confirme?: boolean;
    taille?: { w: number; h: number };
  } = {
    action: corps.action.trim().slice(0, 32),
  };
  if (corps.arg !== undefined) {
    if (typeof corps.arg !== "string") {
      return Response.json({ erreur: "arg doit être une chaîne" }, { status: 400 });
    }
    if (corps.arg.length > ARG_MAX) {
      return Response.json(
        { erreur: "arg trop long (max " + ARG_MAX + " caractères)" },
        { status: 400 }
      );
    }
    corpsNettoye.arg = corps.arg;
  }
  if (corps.confirme === true) corpsNettoye.confirme = true;
  /* v1.3.6 : la taille de .navigateur-corps (pixels écran) accompagne `cadre` :
     sans elle, l'agent garde son viewport par défaut et le relais affiche une
     image qui ne remplit plus la boîte. On ne la propage QUE si elle est
     bornée — l'agent revalide de toute façon (navTailleValide). */
  const t = corps.taille as { w?: unknown; h?: unknown } | undefined;
  if (t && typeof t === "object") {
    const w = Number(t.w);
    const h = Number(t.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 100 && h >= 100 && w <= 4000 && h <= 4000) {
      corpsNettoye.taille = { w: Math.round(w), h: Math.round(h) };
    }
  }

  return proxy("/browser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpsNettoye),
  });
}
