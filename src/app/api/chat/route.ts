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
const TIMEOUT_MS = 150_000;

/* v1.2 (pleine puissance) : 100 messages / 60 000 car. rejetaient en 400 une
   tâche longue, AVANT même que le shim puisse compresser le contexte. Le
   relais doit donc laisser passer l'historique complet : la compression
   intelligente est faite plus loin, une fois la fenêtre réelle du modèle
   connue. Ces bornes restent de simples garde-fous anti-déni de service. */
const MAX_MESSAGES = 400;
const MAX_CONTENU = 400000;
/* Plafond de corps accepté PAR LA PASSERELLE (avant parsing). Doit rester
   supérieur au pire cas légitime (historique + pièces + plan) mais très inférieur
   au plafond théorique du schéma (400 × 400 000 = 160 Mo). */
const CORPS_MAX_OCTETS = 12_000_000;

/* ------------------------------------------------------------------ */
/* Schémas                                                            */
/* ------------------------------------------------------------------ */

const schemaMessageDemo = z.object({
  // Tolérance : un champ d'historique hors contrat (rôle inconnu, contenu
  // non texte) ne doit PAS tuer la requête entière — on normalise.
  role: z.enum(["user", "assistant", "system"]).catch("user"),
  /* v20261007 (P0) : `.catch("")` EFFAÇAIT silencieusement un message trop
     long (la borne client MAX_CONTENU_API vaut exactement MAX_CONTENU :
     tout dépassement — journal d'outils, consigne de fin, pièce jointe —
     transformait la question de l'utilisateur en chaîne VIDE). On garde la
     queue : la fin d'un message contient sa conclusion et son code retour. */
  content: z.string().max(MAX_CONTENU).catch((v) => String(v ?? "").slice(-MAX_CONTENU)),
});

const schemaPieceJointe = z.object({
  file_id: z.string().min(1).max(200),
  name: z.string().max(300).optional().catch(undefined),
});

/* Pièces jointes : on ÉLIMINE les entrées invalides (file_id vide/absent)
   au lieu de rejeter la requête — le reste est envoyé tel quel. */
const schemaPiecesJointes = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? v.filter(
          (x: unknown): x is { file_id: string; name?: string } =>
            Boolean(x) &&
            typeof (x as { file_id?: unknown }).file_id === "string" &&
            String((x as { file_id?: unknown }).file_id).trim().length > 0
        )
      : undefined,
  z.array(schemaPieceJointe).max(10).optional().catch(undefined)
);

/* Champs optionnels « confort » (identifiant de fil, modèle du HUD,
   température, effort de raisonnement, skill) : valeur absente/invalide →
   ignorée (auto), jamais un 400 qui refuserait tout le message. */
const schemaFilOptionnel = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
  z.string().min(1).max(200).optional().catch(undefined)
);

const schemaModeleOptionnel = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
  z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._\-:/]+$/)
    .optional()
    .catch(undefined)
);

const schemaTemperatureOptionnelle = z.preprocess(
  (v) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(2, Math.max(0, v))
      : undefined,
  z.number().min(0).max(2).optional().catch(undefined)
);

/* P0 (audit « modèles fainéants ») : effort de raisonnement du HUD —
   l'échelle basse → haute du contrôle d'effort. Valeur inconnue →
   absente (effort par défaut du modèle), jamais un 400. */
const schemaEffortOptionnel = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined),
  z.enum(["low", "medium", "high", "xhigh", "max"]).optional().catch(undefined)
);

const schemaSkillOptionnel = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
  z
    .string()
    .min(1)
    .max(64)
    /* Identifiants ASCII ou accentués (ex. « factuel-sourcée ») : on ne
       réécrit PAS l'id (un skill forcé réécrit = skill perdu en route). */
    .regex(/^[A-Za-z0-9]+(-[\p{L}\p{N}]+)*$/u)
    .optional()
    .catch(undefined)
);

const schemaCorpsDemo = z.object({
  messages: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((m) => m && typeof m === "object") : v),
    z.array(schemaMessageDemo).min(0).max(MAX_MESSAGES)
  ),
  // v10.6 (F12) : le drapeau outils est accepté en booléen OU en liste de
  // noms (le client historique envoyait les deux formes) — une liste non
  // vide vaut true, une liste vide false. Le planificateur reste l'autorité.
  outils: z
    .union([z.boolean(), z.array(z.string().max(60)).max(20)])
    .optional()
    .catch(undefined),
  stream: z.boolean().optional().catch(undefined),
  attachments: schemaPiecesJointes,
  // v10.6 (F13) : identifiant de conversation fourni par le client (optionnel)
  // — il est normalisé au format canonique « fil-xxxxxxxx » (voir filCanonique).
  conversation_id: schemaFilOptionnel,
  // v10.9.4 (HUD) : modèle choisi dans le HUD (id complet « genre:nom »).
  // Absent / vide / "auto" → cascade par défaut inchangée.
  model_id: schemaModeleOptionnel,
  // v1.2 (anti-bâclage, item 12) : température préférée de l'UI (0..2),
  // transmise au sidecar (RequeteChat.temperature → moteur).
  temperature: schemaTemperatureOptionnelle,
  // v10.10 — skill forcé côté UI (id court, ex. « math-exact »).
  // Absent / vide → sélection automatique par type de tâche / motifs.
  skill: schemaSkillOptionnel,
  // P0 (audit fainéant) : effort du HUD (low/medium/high/max) — transmis au
  // sidecar → moteur → pont (reasoning_effort). Absent → défaut modèle.
  effort: schemaEffortOptionnel,
  // v20261007 : le PLAN visible du HUD (§8.7-4). Il était envoyé par le
  // client à CHAQUE requête et ABSENT d'ici : `z.object` étant non-strict,
  // zod retirait la clé en SILENCE — le moteur travaillait donc sans l'état de
  // travail affiché, sans la moindre erreur. Pire, dès que viseMoteur()
  // détournait la requête vers cette route (skill forcé), le plan disparaissait
  // alors qu'il était visible à l'écran.
  plan: z
    .array(z.string().max(300))
    .max(12)
    .optional()
    .catch(undefined),
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
  // v1.2 (anti-bâclage, item 16) : le sidecar n'accepte que 8000 car. en
  // `question` — on garde la QUEUE (la vraie question est en fin de message,
  // ex. code collé + « que fait ceci ? »), jamais la tête seule.
  const questionBrute =
    dernierUtilisateur?.content?.trim() ||
    (piecesJointes.length
      ? `Analyse ${piecesJointes.length > 1 ? "les fichiers joints" : "le fichier joint"} : ${piecesJointes
          .map((p) => p.name ?? p.file_id)
          .join(", ")}.`
      : "");
  /* v1.2 (pleine puissance) : 8 000 car. amputaient la question — sur une
     tâche technique, l'énoncé + les consignes + le contexte de fichiers
     dépassent couramment cette borne, et la consigne de fin (la plus
     importante) était la seule conservée. On suit la fenêtre réelle du
     modèle ; le reste est Compute côté shim. */
  const question =
    questionBrute.length > MAX_CONTENU ? questionBrute.slice(-MAX_CONTENU) : questionBrute;

  if (!question) return null;

  // Historique = tout ce qui précède la question courante (system écarté :
  // le contrat sidecar n'accepte que utilisateur|assistant).
  const idxQuestion = dernierUtilisateur
    ? propres.lastIndexOf(dernierUtilisateur)
    : propres.length;
  const avant = propres.slice(0, Math.max(0, idxQuestion));
  /* v1.2 (pleine puissance) : .slice(-20) ne gardait que 20 messages — sur
     une tâche de 100+ tours, le sidecar perdait le début du travail (le
     fichier analysé, les bugs déjà trouvés). On laisse passer l'historique
     entier : la compression se fait côté moteur, avec la fenêtre réelle. */
  const historique = avant
    .filter((m) => m.role !== "system")
    .slice(-200)
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
  // v10.10 — skill forcé (playbook du planner) transmis au sidecar.
  const skillId = (corps as { skill?: string }).skill;
  if (skillId) payload.skill = skillId;
  // v1.2 (anti-bâclage, item 12) : température préférée de l'UI (0..2,
  // validée par le schéma) → RequeteChat.temperature → moteur.
  const temperature = (corps as { temperature?: number }).temperature;
  if (typeof temperature === "number") payload.temperature = temperature;
  // P0 (audit fainéant) : effort du HUD validé par le schéma →
  // RequeteChat.effort → run_agent → raisonner_llm → pont (reasoning_effort).
  const effort = (corps as { effort?: string }).effort;
  if (effort) payload.effort = effort;
  // v20261007 (§8.7-4) : le plan du HUD est transmis AU MÊME titre que
  // l'effort ou le modèle. Avant : la clé n'était pas dans le schéma (zod la
  // supprimait en silence) et le moteur ne voyait jamais le plan.
  const plan = (corps as { plan?: string[] }).plan;
  if (Array.isArray(plan) && plan.length) {
    // (1) contrat transmis tel quel au sidecar (traces, versions futures) ;
    payload.plan = plan;
    // (2) ET injecté dans la question, seul point d'entrée disponible ici :
    // le shim le fait dans le message SYSTEM (avecPlan), mais cette route
    // passe par le sidecar dont le prompt on ne maîtrise pas la forme.
    // Sans cela, le plan visible à l'écran n'arrivait JAMAIS au modèle
    // (le champ était même retiré par zod, en silence).
    const blocPlan =
      "<plan_publie_par_ti>\n"
      + "Plan en cours (publié par toi dans un bloc ```athena-plan, « [x] » = faite) :\n"
      + plan.map((e) => String(e)).join("\n")
      + "\n</plan_publie_par_ti>\n\n";
    payload.question = blocPlan + question;
  }
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
  // v1.2 (anti-bâclage, items 9/10) : réponse coupée par le budget +
  // voie réellement servie — transmis tels quels au client.
  tronquee?: boolean;
  provider?: string | null;
  model?: string | null;
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
    // v1.2 (anti-bâclage, items 9/10) : l'UI affiche le badge « tronquée »
    // et la voie (déjà gérés côté chat-demo).
    tronquee: api.tronquee === true,
    provider: typeof api.provider === "string" ? api.provider : null,
    model: typeof api.model === "string" ? api.model : null,
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

  /* v20261007 (B1) : PLAFOND DE CORPS AVANT TOUT PARSAGE. Les bornes du
     schéma (400 messages × 400 000 car.) ne s'appliquent qu'APRÈS
     `req.json()` : un POST de 160 Mo était intégralement chargé en mémoire
     (×2-3 en UTF-16) avant d'être rejeté → OOM du process Node, donc 503 sur
     TOUTES les routes. On refuse donc en amont, sur l'en-tête (0 octet lu). */
  const octetsDeclares = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(octetsDeclares) && octetsDeclares > CORPS_MAX_OCTETS) {
    return Response.json(
      { erreur: `Corps trop volumineux (max ${CORPS_MAX_OCTETS} octets).` },
      { status: 413 }
    );
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
          "Corps de requête invalide : « question » ou « messages[] » (avec au moins un contenu) requis — 60000 caractères max par message.",
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
      tronquee: demo.tronquee,
      provider: demo.provider,
      model: demo.model,
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
