import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/write — proxy local-agent (127.0.0.1:3020).
 * POST → /write  {chemin, contenu, confirme?, ecraser?}
 * v20260926b (direct) : enregistre les fichiers créés par le modèle
 * (blocs ```athena-file). 428 = confirmation requise (avec `existe`),
 * 409 = existe déjà sans ecraser:true. Garde-fous côté agent
 * (dossiers système interdits, 2 Mo max, journal).
 * Agent absent → 503 message honnête.
 */

const AGENT = "http://127.0.0.1:3020";

function garde(req: Request): Response | null {
  const refus = garderOrigine(req);
  if (refus.ok) return null;
  return reponseRefus(refus.raison ?? "origine non autorisée");
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
  try {
    const r = await fetch(AGENT + "/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(30_000),
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
