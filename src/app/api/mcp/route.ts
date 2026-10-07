import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/mcp — serveurs MCP branchés (Model Context Protocol).
 *
 * GET  → INVENTAIRE SEULEMENT (lecture) : {serveurs, dispo}.
 *        v20261007 : le GET ne démarre PLUS aucun serveur. Il filait vers
 *        `/mcp/inventaire` (lecture du registre), et le démarrage passe par
 *        `POST /api/mcp {connecter:true}` — donc ouvrir le panneau ne lance
 *        plus N sous-processus sans consentement explicite de l'utilisateur.
 * POST → {confirme, serveur, outil, arguments} → appel réel d'un outil.
 *        `confirme` est OBLIGATOIRE (même modèle que /api/exec côté agent :
 *        l'agent local répond 428 sans confirmation).
 *
 * Lecture/cadrage côté passerelle : aucun transport MCP n'est implémenté ici,
 * tout vit dans le sidecar (mini-services/llm-chat/athena/tools/mcp.py).
 */

const URL_SIDECAR = "http://127.0.0.1:3010/mcp";
/* Inventaire mis en cache (60 s) : sert à la fois d'affichage et de
   référence pour VALIDER les noms d'arguments (voir POST). */
let cacheInventaire: { t: number; vue: { serveurs: FicheServeur[]; dispo: boolean } | null } | null = null;

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
    /* v20261007 : `/mcp/inventaire` ne démarre rien (le sidecar expose ce
       point de lecture) ; le sous-processus ne sera lancé qu'après un POST
       `connecter:true`. Une chute sur l'ancien point de lecture ne doit pas
       faire retomber sur celui qui lance les serveurs : on rend alors un
       inventaire vide SANS effet de bord. */
    const reponse = await fetch(`${URL_SIDECAR}/inventaire`, {
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const json = await reponse.json().catch(() => null);
    const vue = normaliser(json);
    cacheInventaire = { t: Date.now(), vue };
    if (!vue) {
      return Response.json({ serveurs: [], dispo: false }, { headers: entetes });
    }
    return Response.json(vue, { headers: entetes });
  } catch {
    cacheInventaire = { t: Date.now(), vue: null };
    return Response.json({ serveurs: [], dispo: false }, { headers: entetes });
  }
}

/* Inventaire récente (60 s) ; sinon on le rafraîchit (lecture seule). */
async function vueCourante(): Promise<{ serveurs: FicheServeur[]; dispo: boolean } | null> {
  if (cacheInventaire && Date.now() - cacheInventaire.t < 60_000) return cacheInventaire.vue;
  try {
    const reponse = await fetch(`${URL_SIDECAR}/inventaire`, {
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const vue = normaliser(await reponse.json().catch(() => null));
    cacheInventaire = { t: Date.now(), vue };
    return vue;
  } catch {
    cacheInventaire = { t: Date.now(), vue: null };
    return null;
  }
}

const RE_SERVEUR = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const RE_OUTIL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

export async function POST(request: Request) {
  const garde = garderOrigine(request);
  if (!garde.ok) return reponseRefus(garde.raison ?? "origine non autorisée");
  const corps = (await request.json().catch(() => null)) as
    | {
        serveur?: unknown;
        outil?: unknown;
        arguments?: unknown;
        confirme?: unknown;
        connecter?: unknown;
      }
    | null;

  /* v20261007 : DÉMARRAGE EXPLICITE des serveurs (déplacé hors du GET).
     Sans ce point, il fallait ouvrir le panneau `/mcp` — un simple GET — pour
     lancer N sous-processus arbitraires. */
  if (corps?.connecter === true) {
    try {
      const reponse = await fetch(URL_SIDECAR, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connecter" }),
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      });
      const json = await reponse.json().catch(() => null);
      const vue = normaliser(json);
      cacheInventaire = { t: Date.now(), vue };
      if (!vue) {
        return Response.json(
          { statut: "ERREUR", raison: "sidecar MCP injoignable" },
          { headers: entetes, status: 502 }
        );
      }
      return Response.json(vue, { headers: entetes });
    } catch {
      return Response.json(
        { statut: "ERREUR", raison: "sidecar MCP injoignable" },
        { headers: entetes, status: 502 }
      );
    }
  }

  /* v20261007 : un appel d'outil EXÉCUTE du code côté serveur. On exige donc
     une confirmation explicite — même modèle que /api/exec (428 côté agent) —
     et on valide les NOMS D'ARGUMENTS contre l'inventaire : avant, seule la
     TAILLE de la charge utile était contrôlée, donc n'importe quelle clé
     pouvait être transmise à un outil, sans passer par le planner ni par la
     garde d'injection. */
  if (corps?.confirme !== true) {
    return Response.json(
      {
        statut: "CONFIRMATION_REQUISE",
        raison: "confirmez l'appel d'outil MCP avant exécution",
        serveur: typeof corps?.serveur === "string" ? corps.serveur : "",
        outil: typeof corps?.outil === "string" ? corps.outil : "",
      },
      { headers: entetes, status: 428 }
    );
  }
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
  const vue = await vueCourante();
  if (vue) {
    const fiche = vue.serveurs.find((s) => s.nom === serveur);
    const f = fiche ? fiche.outils.find((o) => o.nom === outil) : null;
    if (!f) {
      return Response.json(
        { statut: "UNKNOWN", raison: `outil inconnu : ${serveur}.${outil}` },
        { headers: entetes, status: 404 }
      );
    }
    const connus = new Set(f.parametres);
    const inconnus = Object.keys(args).filter((k) => !connus.has(k));
    if (inconnus.length) {
      return Response.json(
        {
          statut: "ERREUR",
          raison: `paramètre(s) non déclaré(s) pour cet outil : ${inconnus.join(", ")}`,
          parametres: f.parametres,
        },
        { headers: entetes, status: 400 }
      );
    }
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
