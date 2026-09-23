import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/modeles — v10.9.4 (HUD) : liste des modèles de langue disponibles
 * (cloud : pollinations openai-fast + zai ; locaux best-effort : Ollama /
 * LM Studio / llama.cpp détectés par le pont). Le HUD de l'UI les affiche
 * avec leur état (up/down) et permet la sélection (persistée côté client,
 * envoyée en `model_id` dans /api/chat).
 *
 * GET  → lecture (cache court côté sidecar) : {dispo, modeles:[…]}
 * POST → rafraîchissement manuel demandé par le HUD (re-catalogue cloud +
 *        re-scan des serveurs locaux) : même forme de réponse.
 *
 * Jamais bloquant : si le pont est injoignable → {dispo:false, modeles:[]}
 * — l'UI garde la sélection « auto » et la cascade par défaut continue de
 * servir. AUCUN détail d'infrastructure ne franchit la frontière (N4).
 */

const URL_SIDECAR_MODELES = "http://127.0.0.1:3010/modeles";

async function appelerSidecar(rafraichir: boolean): Promise<Response> {
  try {
    const reponse = await fetch(URL_SIDECAR_MODELES, {
      method: rafraichir ? "POST" : "GET",
      signal: AbortSignal.timeout(rafraichir ? 18_000 : 8_000),
      cache: "no-store",
    });
    const json = (await reponse.json().catch(() => null)) as
      | { dispo?: boolean; modeles?: unknown[] }
      | null;
    if (!json || !Array.isArray(json.modeles)) {
      return Response.json(
        { dispo: false, modeles: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    // Normalisation défensive : seuls les champs attendus sortent.
    const modeles = json.modeles
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => ({
        id: typeof m.id === "string" ? m.id : "",
        name: typeof m.name === "string" ? m.name : "",
        provider: typeof m.provider === "string" ? m.provider : "",
        active: m.active === true,
        local: m.local === true,
        up: m.up === true,
      }))
      .filter((m) => m.id.length > 0 && m.id.length <= 120);
    return Response.json(
      { dispo: json.dispo === true, modeles },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { dispo: false, modeles: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function GET() {
  return appelerSidecar(false);
}

export async function POST() {
  return appelerSidecar(true);
}
