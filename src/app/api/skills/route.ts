import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/skills — v10.10 : registre de skills du moteur Athéna.
 *
 * Un skill est un playbook nommé branché sur le planner : déclencheur
 * (type de tâche), outils, genre de vérificateur, autorité. Lecture seule
 * côté passerelle — la sélection active se fait côté sidecar (type/motifs
 * ou champ `skill` optionnel de /api/chat).
 *
 * GET → {skills: [{nom, description, types, outils, …}]}
 * Jamais bloquant : sidecar injoignable → {skills: [], dispo: false}.
 */

const URL_SIDECAR_SKILLS = "http://127.0.0.1:3010/skills";

export async function GET(request: Request) {
  const garde = garderOrigine(request);
  if (!garde.ok) return reponseRefus(garde.raison ?? "origine non autorisée");
  try {
    const reponse = await fetch(URL_SIDECAR_SKILLS, {
      signal: AbortSignal.timeout(6_000),
      cache: "no-store",
    });
    const json = (await reponse.json().catch(() => null)) as
      | { skills?: unknown[] }
      | null;
    if (!json || !Array.isArray(json.skills)) {
      return Response.json(
        { skills: [], dispo: false },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const skills = json.skills
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        nom: typeof s.nom === "string" ? s.nom : "",
        description: typeof s.description === "string" ? s.description : "",
        types: Array.isArray(s.types) ? s.types.filter((t): t is string => typeof t === "string") : [],
        outils: Array.isArray(s.outils) ? s.outils.filter((t): t is string => typeof t === "string") : [],
        genre_verificateur:
          typeof s.genre_verificateur === "string" ? s.genre_verificateur : null,
        autorite: s.autorite === true,
        actif: s.actif !== false,
      }))
      .filter((s) => s.nom.length > 0 && s.nom.length <= 64);
    return Response.json(
      { skills, dispo: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { skills: [], dispo: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
