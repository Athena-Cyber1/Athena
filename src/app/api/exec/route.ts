import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/exec — proxy local-agent (127.0.0.1:3020).
 * GET  → /sante (état de l'agent)
 * POST → /exec   {commande, confirme?, cwd?, timeout_ms?}
 * Agent absent → 503 message honnête (UI affiche « agent injoignable »).
 */

const AGENT = "http://127.0.0.1:3020";

async function proxy(chemin: string, init?: RequestInit): Promise<Response> {
  try {
    const r = await fetch(AGENT + chemin, {
      ...init,
      signal: AbortSignal.timeout(25_000),
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
  return proxy("/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
}

