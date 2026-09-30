import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/exec — proxy local-agent (127.0.0.1:3020).
 * GET  → /sante (état de l'agent)
 * POST → /exec   {commande, confirme?, cwd?, timeout_ms?, flux?}
 * flux:true → NDJSON de l'agent pipé EN DIRECT (sortie live), sinon JSON unique.
 * Agent absent → 503 message honnête (UI affiche « agent injoignable »).
 */

const AGENT = "http://127.0.0.1:3020";

/* v1.2 (audit 503) : le proxy avortait à 25 s alors que l'agent travaille
   jusqu'à 60 s — toute commande longue mourait en 503 « agent injoignable »
   pendant que l'agent continuait de l'exécuter. Le proxy doit couvrir
   l'agent (60 s) + la marge réseau : 70 s. Le client borne à 90 s. */
const TIMEOUT_PROXY_MS = 70_000;

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
          "Agent local injoignable — démarrez : node mini-services/local-agent/index.js",
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
  let corps: unknown = {};
  try {
    corps = await req.json();
  } catch {
    return Response.json({ erreur: "JSON invalide" }, { status: 400 });
  }
  /* v20260926b (direct) : flux:true → on pipe le NDJSON de l'agent en direct
     (sortie live) au lieu de tamponner la réponse. */
  if (corps && typeof corps === "object" && (corps as { flux?: unknown }).flux === true) {
    try {
      const r = await fetch(AGENT + "/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(TIMEOUT_PROXY_MS),
        cache: "no-store",
      });
      if (!r.ok || !r.body) {
        const txt = await r.text();
        return new Response(txt, {
          status: r.status,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      return new Response(r.body, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
      });
    } catch {
      return Response.json(
        {
          erreur:
            "Agent local injoignable — démarrez : node mini-services/local-agent/index.js",
          port: 3020,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
  }
  return proxy("/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
}

