import { garderOrigine, reponseRefus } from "@/lib/secu";
import { createHash } from "crypto";
import { z } from "zod";

/**
 * /api/chat — v10.6 : passerelle adaptée au frontend utilisateur porté
 * (chat-demo.js v20260922m). Correctifs F12 (outils bool|liste), F13 (format
 * de fil canonique), F15 (statuts 4xx du sidecar préservés).
 *
 * Contrat ENTRANT (frontend utilisateur, note d'origine v9.5/v20260922l) :
 *   POST { messages:[{role:"user"|"assistant"|"system", content}], outils?:bool,
 *          stream?:bool, attachments?:[{file_id,name}] }
 *   — `stream:true` → réponse NDJSON : {type:"progress",etape,message}* puis
 *     {type:"final",reponse,outil,verification,rag,tache,conversation_id,
 *      raisonnement[]} (ou {type:"erreur",erreur}) ;
 *   — sans stream → JSON unique avec les mêmes champs.
 *   GET → sonde { modele_charge:boolean } (toutes les 25 s côté client).
 * Contrat ENTRANT historique (toujours accepté, compat scripts/evals) :
 *   POST { question, historique?:[{role:"utilisateur"|"assistant",contenu}],
 *          filId?, options? } → JSON unique.
 *
 * Contrat SORTANT (sidecar Athéna :3010, inchangé) :
 *   POST /chat { question, historique, fil_id, options } → JSON complet
 *   {reponse, verdicts, verification[], trace[], type_tache, fil_id, …}.
 *
 * La passerelle traduit : dernière question utilisateur = `question`,
 * tours précédents = `historique` (rôles fr), puis reconstitue le raisonnement
 * (`raisonnement`) et l'outil utilisé (`outil`) depuis la trace réelle de
 * l'agent. Les événements `progress` NDJSON rejouent la trace authentique de
 * la boucle planifier → agir → observer → vérifier (aucun faux temps réel :
 * ils partent après l'exécution, groupés, dans l'ordre d'émission).
 */

const URL_SIDECAR_CHAT = "http://127.0.0.1:3010/chat";
const URL_SIDECAR_SANTE = "http://127.0.0.1:3010/sante";
const TIMEOUT_MS = 60_000;

const MAX_MESSAGES = 40;
const MAX_CONTENU = 8000;

/* ------------------------------------------------------------------ */
/* Schémas                                                            */
/* ------------------------------------------------------------------ */

const schemaMessageDemo = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(MAX_CONTENU),
});

const schemaPieceJointe = z.object({
  file_id: z.string().min(1).max(200),
  name: z.string().max(300).optional(),
});

const schemaCorpsDemo = z.object({
  messages: z.array(schemaMessageDemo).min(0).max(MAX_MESSAGES),
  // v10.6 (F12) : le drapeau outils est accepté en booléen OU en liste de
  // noms (le client historique envoyait les deux formes) — une liste non
  // vide vaut true, une liste vide false. Le planificateur reste l'autorité.
  outils: z.union([z.boolean(), z.array(z.string().max(60)).max(20)]).optional(),
  stream: z.boolean().optional(),
  attachments: z.array(schemaPieceJointe).max(10).optional(),
  // v10.6 (F13) : identifiant de conversation fourni par le client (optionnel)
  // — il est normalisé au format canonique « fil-xxxxxxxx » (voir filCanonique).
  conversation_id: z.string().min(1).max(200).optional(),
  // v10.9.4 (HUD) : modèle choisi dans le HUD (id complet « genre:nom »).
  // Absent / vide / "auto" → cascade par défaut inchangée.
  model_id: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9._\-:]+$/)
    .optional(),
});

const schemaMessageLegacy = z.object({
  role: z.enum(["utilisateur", "assistant"]),
  contenu: z.string().min(1).max(MAX_CONTENU),
});

const schemaCorpsLegacy = z.object({
  question: z.string().min(1).max(MAX_CONTENU),
  historique: z.array(schemaMessageLegacy).max(50).optional(),
  filId: z.string().min(1).max(200).optional(),
  fil_id: z.string().min(1).max(200).optional(),
  options: z
    .object({
      maxEtapes: z.number().int().min(1).max(40).optional(),
    })
    .optional(),
});

const schemaCorps = z.union([schemaCorpsDemo, schemaCorpsLegacy]);

/* ------------------------------------------------------------------ */
/* Traduction demo → sidecar                                          */
/* ------------------------------------------------------------------ */

type MsgDemo = z.infer<typeof schemaMessageDemo>;
type MsgLegacy = z.infer<typeof schemaMessageLegacy>;

/**
 * v10.6 (F13) — format de fil UNIFIÉ : quel que soit le chemin (question ou
 * messages), l'identifiant est toujours « fil-xxxxxxxx » (même forme que le
 * sidecar). Un id client est dérivé DÉTERMINISTEMENT (sha256 → 8 hex) : la
 * reprise de fil et la corrélation de logs fonctionnent sur les deux chemins.
 */
function filCanonique(idClient?: string | null): string | undefined {
  const brut = (idClient ?? "").trim();
  if (!brut) return undefined;
  return "fil-" + createHash("sha256").update(brut).digest("hex").slice(0, 8);
}

function versSidecar(corps: z.infer<typeof schemaCorps>) {
  if ("question" in corps) {
    // v10.8 (Classe 5) : trim obligatoire — une question purement blanche ne
    // part PAS au sidecar (la route répondra 200 poli, jamais un 400 technique).
    const questionPropre = corps.question.trim();
    if (!questionPropre) return null;
    const payload: Record<string, unknown> = {
      question: questionPropre,
      historique: (corps.historique ?? []) as MsgLegacy[],
    };
    const fil = filCanonique(corps.filId ?? corps.fil_id);
    if (fil) payload.fil_id = fil;
    if (corps.options?.maxEtapes !== undefined) {
      payload.options = { max_etapes: corps.options.maxEtapes };
    }
    return payload;
  }

  // Contrat démo : les contenus vides sont écartés (comme côté client).
  const propres: MsgDemo[] = corps.messages.filter(
    (m) => m.content.trim() !== ""
  );
  const dernierUtilisateur = [...propres]
    .reverse()
    .find((m) => m.role === "user");
  if (!dernierUtilisateur && propres.length === 0) {
    return null; // rien à demander — la route répondra 400
  }

  const piecesJointes = corps.attachments ?? [];
  const question =
    dernierUtilisateur?.content?.trim() ||
    (piecesJointes.length
      ? `Analyse ${piecesJointes.length > 1 ? "les fichiers joints" : "le fichier joint"} : ${piecesJointes
          .map((p) => p.name ?? p.file_id)
          .join(", ")}.`
      : "");

  if (!question) return null;

  // Historique = tout ce qui précède la question courante (system écarté :
  // le contrat sidecar n'accepte que utilisateur|assistant).
  const idxQuestion = dernierUtilisateur
    ? propres.lastIndexOf(dernierUtilisateur)
    : propres.length;
  const avant = propres.slice(0, Math.max(0, idxQuestion));
  const historique = avant
    .filter((m) => m.role !== "system")
    .slice(-20)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "utilisateur",
      contenu: m.content,
    }));

  const payload: Record<string, unknown> = { question, historique };
  // v10.6 (F13) : plus de « fil-web-… » maison — si le client fournit un
  // conversation_id (stable par conversation UI), il devient un fil
  // canonique réutilisable ; sinon le sidecar génère le sien (fil-xxxxxx).
  const fil = filCanonique(
    (corps as { conversation_id?: string }).conversation_id
  );
  if (fil) payload.fil_id = fil;
  // v10.9.4 (HUD) : le modèle choisi est transmis au sidecar → pont
  // (routage direct) ; "auto"/absent → cascade par défaut inchangée.
  const modelId = (corps as { model_id?: string }).model_id;
  if (modelId && modelId !== "auto") payload.model_id = modelId;
  // v10.6 (F12) : `outils` (bool OU liste) n'a pas d'équivalent sidecar —
  // les outils sont choisis par le planificateur ; le drapeau est accepté,
  // jamais simulé. `options` reste vide pour le contrat démo.
  payload.options = {};
  // v10.3 — CORRECTION du bug « le modèle ne lit pas les fichiers » : les
  // attachments (file_id) étaient validés puis silencieusement abandonnés ici,
  // si bien que le moteur ne recevait JAMAIS les pièces jointes. Ils sont
  // désormais transmis : le sidecar charge le contenu indexé de CES fichiers
  // et l'injecte au LLM comme FILE_DATA (donnée NON FIABLE, règle 9).
  if (piecesJointes.length) {
    payload.attachments = piecesJointes.map((p) => ({
      file_id: p.file_id,
      ...(p.name ? { name: p.name } : {}),
    }));
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* Traduction sidecar → demo                                          */
/* ------------------------------------------------------------------ */

type Trace = { etape?: number; canal?: string; evenement?: string; libelle?: string };
type Verdict = { statut?: string };

/* ------------------------------------------------------------------ */
/* v10.9.2 (P0) — SANITIZE DÉFENSIF FINAL                             */
/* Incident : « LLM indisponible : HTTP Error 502: Bad Gateway »       */
/* apparaissait dans le raisonnement affiché. La source est corrigée   */
/* côté sidecar (erreurs codifiées) et côté bridge (contrat neutre),   */
/* mais la passerelle garde une DERNIÈRE barrière : toute chaîne       */
/* d'infrastructure qui serait encore en train de fuir est remplacée   */
/* par un libellé neutre AVANT émission vers le client. Les codes et   */
/* messages techniques restent dans les logs serveur uniquement.       */
/* ------------------------------------------------------------------ */

const LIBELLE_DEGRADE =
  "modèle de langue momentanément indisponible — poursuite en mode déterministe";
const REPONSE_SECOURS =
  "Une erreur interne est survenue. Je préfère l'admettre que d'inventer une réponse.";

// SIGNATURES STRICTES : chaînes qui n'existent QUE dans nos artefacts internes
// (urllib, SDK, pont, serveur). Une réponse LÉGITIME ne peut pas les contenir
// (ex. une question cyber sur l'erreur 502 produit « Bad Gateway » dans la
// réponse — ce n'est PAS une fuite). Miroir des interdits canari v10.9.2.
const FUITES_STRICTES: RegExp[] = [
  /http\s*error/i,
  /llm\s*indisponible/i,
  /bridge\s*llm/i,
  /internal-api/i,
  /api\s*request\s*failed/i,
  /function\s*invoke\s*failed/i,
  /traceback/i,
  /erreur\s*interne\s*:/i,
  /modèle de langue est momentanément\s*(?:saturé|en pause)/i,
  /modèle de langue reçoit trop de demandes/i,
];

// SIGNATURES ÉLARGIES : valables UNIQUEMENT pour les libellés de TRACE
// (produits par le pipeline, jamais par le contenu utilisateur) — une étape
// de raisonnement qui mentionne 429/502/Bad Gateway est forcément une fuite.
const FUITES_TRACE: RegExp[] = [
  ...FUITES_STRICTES,
  /bad\s*gateway/i,
  /too\s*many\s*requests/i,
  /\b(?:http|erreur|status)\s*[:\-]?\s*(?:429|502|503|504)\b/i,
  /rate\s*limit/i,
];

function contientFuiteStrict(texte: string): boolean {
  if (!texte) return false;
  return FUITES_STRICTES.some((motif) => motif.test(texte));
}

function contientFuiteTrace(texte: string): boolean {
  if (!texte) return false;
  return FUITES_TRACE.some((motif) => motif.test(texte));
}

/** Un libellé de raisonnement qui fuirait est remplacé par un libellé neutre. */
function nettoyerLibelle(message: string): string {
  return contientFuiteTrace(message) ? LIBELLE_DEGRADE : message;
}

/** Une réponse finale qui fuirait est remplacée par l'échec honnête. */
function nettoyerReponse(reponse: string): string {
  return contientFuiteStrict(reponse) ? REPONSE_SECOURS : reponse;
}

/** Message d'erreur (chemin 4a) neutralisé avant émission. */
function nettoyerErreur(erreur: string): string {
  return contientFuiteStrict(erreur)
    ? "Le moteur Athéna est momentanément indisponible. Réessayez dans un instant."
    : erreur;
}


function raisonnementDepuisTrace(trace: Trace[] | undefined) {
  if (!Array.isArray(trace)) return [];
  return trace
    .filter((ev) => ev && typeof ev.libelle === "string" && ev.libelle.trim())
    .map((ev) => ({
      etape: String(ev.evenement ?? ev.canal ?? "etape"),
      // v10.9.2 (P0) : chaque libellé passe par le sanitize défensif.
      message: nettoyerLibelle(String(ev.libelle)),
    }));
}

function outilDepuisTrace(trace: Trace[] | undefined) {
  if (!Array.isArray(trace)) return null;
  let nom: string | null = null;
  for (const ev of trace) {
    const candidat =
      (ev as unknown as { details?: { outil?: string } })?.details?.outil;
    if (typeof candidat === "string" && candidat) nom = candidat;
  }
  if (!nom) return null;
  return { nom };
}

function verificationDepuisVerdicts(verdicts: Verdict[] | undefined) {
  if (!Array.isArray(verdicts) || verdicts.length === 0) return null;
  const comptes = new Map<string, number>();
  for (const v of verdicts) {
    const s = String(v?.statut ?? "UNKNOWN");
    comptes.set(s, (comptes.get(s) ?? 0) + 1);
  }
  const total = verdicts.length;
  const verifies = comptes.get("VERIFIED") ?? 0;
  const contredits =
    (comptes.get("CONTRADICTED") ?? 0) + (comptes.get("DISPROVED") ?? 0);
  // Le frontend affiche un badge ✓ si statut === 'corrige', un badge ⚠ sinon.
  // Ton honnête : badge ✓ quand des verdicts VERIFIED existent sans
  // contradiction ; badge ⚠ en cas de contradiction ; rien si la réponse
  // repose seulement sur du SUPPORTED/HYPOTHESIS (pas de prétention).
  if (contredits > 0) {
    return {
      statut: "doute",
      detail: `vérification : ${contredits} claim(s) contredit(s) sur ${total}`,
    };
  }
  if (verifies > 0) {
    return {
      statut: "corrige",
      detail: `vérifiée par outils d'autorité (${verifies}/${total} claims VERIFIED)`,
    };
  }
  return null;
}

type ReponseSidecar = {
  reponse?: string;
  reponse_courte?: string;
  type_tache?: string;
  statut?: string;
  verdicts?: Verdict[];
  verification?: Verdict[];
  trace?: Trace[];
  duree_ms?: number;
  fil_id?: string;
  erreur?: string;
  // v10.9.4 (HUD) : le modèle choisi a échoué → cascade servie (booléen
  // NEUTRE émis par le sidecar ; jamais de nom de provider — N4).
  modele_repli?: boolean;
};

function versFormatDemo(api: ReponseSidecar) {
  const verification =
    verificationDepuisVerdicts(api.verification) ??
    verificationDepuisVerdicts(api.verdicts);
  return {
    // v10.9.2 (P0) : sanitize défensif sur la réponse ET le raisonnement.
    reponse: nettoyerReponse(api.reponse ?? "(réponse vide)"),
    outil: outilDepuisTrace(api.trace),
    verification,
    rag: { utilise: false },
    tache: api.type_tache ?? null,
    conversation_id: api.fil_id ?? null,
    raisonnement: raisonnementDepuisTrace(api.trace),
    duree_ms: api.duree_ms ?? null,
    statut: api.statut ?? null,
    // v10.9.4 (HUD) : drapeau neutre pour le toast discret côté client.
    modele_repli: api.modele_repli === true,
  };
}

/* ------------------------------------------------------------------ */
/* GET — sonde de santé (le client attend { modele_charge })          */
/* ------------------------------------------------------------------ */

export async function GET() {
  try {
    const reponse = await fetch(URL_SIDECAR_SANTE, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const json = (await reponse.json().catch(() => ({}))) as {
      llm?: boolean;
      version?: string;
    };
    return Response.json(
      { modele_charge: json.llm === true, version: json.version ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { modele_charge: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}

/* ------------------------------------------------------------------ */
/* POST — question → sidecar → NDJSON ou JSON                         */
/* ------------------------------------------------------------------ */

export async function POST(req: Request) {
  // 1) Garde d'origine v2.
  const garde = garderOrigine(req);
  if (!garde.ok) {
    console.warn("[secu] Origine rejetée", {
      origin: req.headers.get("origin"),
      sfs: req.headers.get("sec-fetch-site"),
      chemin: "/api/chat",
    });
    return reponseRefus(garde.raison ?? "origine non autorisée");
  }

  // 2) Validation (contrat démo ou legacy).
  let brut: unknown;
  try {
    brut = await req.json();
  } catch {
    return Response.json(
      { erreur: "Corps de requête invalide (JSON attendu)." },
      { status: 400 }
    );
  }

  const parse = schemaCorps.safeParse(brut);
  if (!parse.success) {
    return Response.json(
      {
        erreur:
          "Corps de requête invalide : « question » ou « messages[] » (avec au moins un contenu) requis — 8000 caractères max par message.",
      },
      { status: 400 }
    );
  }

  const payload = versSidecar(parse.data);
  const veutFlux =
    "stream" in parse.data && (parse.data as { stream?: boolean }).stream === true;

  // v10.8 (Classe 5 du benchmark) — entrée vide/espaces : JAMAIS de 400 dur.
  // Réponse 200 polie au format démo (flux NDJSON compris), sans appeler le
  // sidecar : l'UI affiche une demande de reformulation, pas une erreur technique.
  if (!payload) {
    const polie = {
      reponse: "Pouvez-vous reformuler ? Je n'ai reçu qu'un message vide.",
      outil: null,
      verification: null,
      rag: { utilise: false },
      tache: null,
      conversation_id: null,
      raisonnement: [],
      duree_ms: null,
      statut: "ENTREE_VIDE",
      modele_repli: false,
    };
    return veutFlux
      ? fluxNdjson([{ type: "final", ...polie }])
      : Response.json(polie);
  }

  // 3) Appel sidecar.
  let api: ReponseSidecar;
  let statutSidecar = 0; // v10.6 (F15) : statut d'origine préservé pour les 4xx
  try {
    const reponse = await fetch(URL_SIDECAR_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    statutSidecar = reponse.status;
    const texte = await reponse.text();
    let json: ReponseSidecar;
    try {
      json = JSON.parse(texte) as ReponseSidecar;
    } catch {
      json = { erreur: "Réponse illisible du moteur Athéna." };
    }
    if (!reponse.ok && !json.reponse) {
      api = { erreur: json.erreur ?? "moteur momentanément indisponible" };
    } else {
      api = json;
    }
  } catch (err) {
    const raison =
      err instanceof Error && err.name === "TimeoutError"
        ? "La génération a dépassé le délai disponible. Essayez une question plus courte."
        : "Le moteur Athéna est indisponible. Réessayez dans un instant.";
    console.warn("[chat] Sidecar injoignable :", err);
    api = { erreur: raison };
  }

  // 4a) Échec honnête sans réponse → erreur explicite.
  if (api.erreur && !api.reponse) {
    // v10.9.2 (P0) : le message d'erreur est neutralisé (aucune chaîne
    // d'infrastructure — code HTTP, corps upstream, traceback — ne sort).
    const corps = { erreur: nettoyerErreur(api.erreur) };
    // v10.6 (F15) : une erreur CLIENT du sidecar (400/404/422 — ex. pièce
    // jointe fantôme) repart avec SON statut, pas un 502 trompeur.
    const codeSortie =
      statutSidecar >= 400 && statutSidecar < 500 ? statutSidecar : 502;
    return veutFlux
      ? fluxNdjsonErreur(corps, codeSortie)
      : Response.json(corps, { status: codeSortie });
  }

  // 4b) Traduction vers le format démo.
  const demo = versFormatDemo(api);

  if (veutFlux) {
    const evenements: Array<Record<string, unknown>> = [];
    for (const etape of demo.raisonnement) {
      evenements.push({
        type: "progress",
        etape: etape.etape,
        message: etape.message,
      });
    }
    evenements.push({
      type: "final",
      reponse: demo.reponse,
      outil: demo.outil,
      verification: demo.verification,
      rag: demo.rag,
      tache: demo.tache,
      conversation_id: demo.conversation_id,
      raisonnement: demo.raisonnement,
      modele_repli: demo.modele_repli,
    });
    return fluxNdjson(evenements);
  }

  return Response.json(demo);
}

/** Flux NDJSON : un JSON par ligne, terminé. */
function fluxNdjson(evenements: Array<Record<string, unknown>>) {
  const corps = evenements.map((e) => JSON.stringify(e)).join("\n") + "\n";
  return new Response(corps, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Flux NDJSON d'erreur (statut réel préservé, v10.6 F15). */
function fluxNdjsonErreur(corps: Record<string, unknown>, statut: number) {
  return new Response(JSON.stringify(corps) + "\n", {
    status: statut,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
