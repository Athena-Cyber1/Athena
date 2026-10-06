import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/mcp — serveurs MCP branchés (Model Context Protocol).
 *
 * GET  → inventaire : {serveurs: [{nom, type, etat, erreur, outils[]}], dispo}
 *        (premier appel = démarrage réel des serveurs : timeout 30 s).
 * POST → appel réel d'un outil : {serveur, outil, arguments} →
 *        {statut: "SUPPORTED"|"ERREUR"|"UNKNOWN", …} renvoyé tel quel.
 *
 * Lecture seule côté passerelle : aucun transport MCP n'est implémenté ici,
 * tout vit dans le sidecar (mini-services/llm-chat/athena/tools/mcp.py).
 */

const URL_SIDECAR = "http://127.0.0.1:3010/mcp";

type FicheOutil = {
  nom: string;
  registre: string;
  description: string;
  parametres: string[];
  risque: string;
};

type FicheServeur = {
  nom: string;
  type: string;
  etat: string;
  erreur: string | null;
  outils: FicheOutil[];
};

const entetes = { "Cache-Control": "no-store" } as const;

function normaliser(json: unknown) {
  if (!json || typeof json !== "object") return null;
  const brut = json as { serveurs?: unknown };
  if (!Array.isArray(brut.serveurs)) return null;
  const serveurs = brut.serveurs
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => {
      const nom = typeof s.nom === "string" ? s.nom : "";
      const outils = Array.isArray(s.outils)
        ? s.outils
            .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
            .map((o) => ({
              nom: typeof o.nom === "string" ? o.nom.slice(0, 120) : "",
              registre: typeof o.registre === "string" ? o.registre.slice(0, 120) : "",
              description: typeof o.description === "string" ? o.description.slice(0, 400) : "",
              parametres: Array.isArray(o.parametres)
                ? o.parametres.filter((p): p is string => typeof p === "string")
                : [],
              risque: typeof o.risque === "string" ? o.risque : "moyen",
            }))
            .filter((o) => o.nom.length > 0)
        : [];
      return {
        nom: nom.slice(0, 80),
        type: typeof s.type === "string" ? s.type : "local",
        etat: typeof s.etat === "string" ? s.etat : "inconnu",
        erreur: typeof s.erreur === "string" ? s.erreur.slice(0, 300) : null,
        outils,
        nombre_outils: outils.length,
      };
    })
    .filter((s) => s.nom.length > 0);
  return { serveurs, dispo: true };
}

export async function GET(request: Request) {
  const garde = garderOrigine(request);
  if (!garde.ok) return reponseRefus(garde.raison ?? "origine non autorisée");
  try {
    const reponse = await fetch(URL_SIDECAR, {
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const json = await reponse.json().catch(() => null);
    const vue = normaliser(json);
    if (!vue) {
      return Response.json({ serveurs: [], dispo: false }, { headers: entetes });
    }
    return Response.json(vue, { headers: entetes });
  } catch {
    return Response.json({ serveurs: [], dispo: false }, { headers: entetes });
  }
}

const RE_SERVEUR = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const RE_OUTIL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

export async function POST(request: Request) {
  const garde = garderOrigine(request);
  if (!garde.ok) return reponseRefus(garde.raison ?? "origine non autorisée");
  const corps = (await request.json().catch(() => null)) as
    | { serveur?: unknown; outil?: unknown; arguments?: unknown }
    | null;
  const serveur = typeof corps?.serveur === "string" ? corps.serveur : "";
  const outil = typeof corps?.outil === "string" ? corps.outil : "";
  if (!RE_SERVEUR.test(serveur) || !RE_OUTIL.test(outil)) {
    return Response.json(
      { statut: "ERREUR", raison: "cible MCP invalide (serveur/outil)" },
      { headers: entetes, status: 400 }
    );
  }
  const args =
    corps?.arguments && typeof corps.arguments === "object" && !Array.isArray(corps.arguments)
      ? (corps.arguments as Record<string, unknown>)
      : {};
  if (JSON.stringify(args).length > 8_000) {
    return Response.json(
      { statut: "ERREUR", raison: "arguments MCP trop volumineux" },
      { headers: entetes, status: 400 }
    );
  }
  try {
    const reponse = await fetch(`${URL_SIDECAR}/appel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serveur, outil, arguments: args }),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    const json = await reponse.json().catch(() => null);
    if (!json || typeof json !== "object") {
      return Response.json(
        { statut: "ERREUR", raison: "sidecar injoignable" },
        { headers: entetes, status: 502 }
      );
    }
    return Response.json(json, { headers: entetes });
  } catch {
    return Response.json(
      { statut: "ERREUR", raison: "sidecar injoignable" },
      { headers: entetes, status: 502 }
    );
  }
}
