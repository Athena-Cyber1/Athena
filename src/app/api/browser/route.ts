import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/browser — proxy local-agent (127.0.0.1:3020), route navigateur.
 * GET  → /sante (état de l'agent, session Firefox incluse)
 * POST → /browser {action, arg?, confirme?}
 *   action ∈ ouvrir|snapshot|texte|html|cliquer|taper|js|capture|attente|fermer
 *   428 → origine inconnue ou JavaScript : le CLIENT affiche une modale puis
 *         reposte confirme:true (la confirmation ne se fait JAMAIS ici).
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

export async function GET(req: Request) {
  return garde(req) ?? proxy("/sante");
}

export async function POST(req: Request) {
  const interdite = garde(req);
  if (interdite) return interdite;
  let corps: { action?: unknown; arg?: unknown; confirme?: unknown } = {};
  try {
    corps = await req.json();
  } catch {
    return Response.json({ erreur: "JSON invalide" }, { status: 400 });
  }
  if (typeof corps.action !== "string" || !corps.action.trim()) {
    return Response.json({ erreur: "action manquante" }, { status: 400 });
  }
  const corpsNettoye: { action: string; arg?: string; confirme?: boolean } = {
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

  return proxy("/browser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpsNettoye),
  });
}
