import { garderOrigine, reponseRefus } from "@/lib/secu";
import { z } from "zod";

/**
 * /api/entrainer — v10.6 : contrat du frontend utilisateur porté.
 *
 * GET      → état de l'entraînement pour l'onglet « Entraînement » :
 *            { conversations (fils distincts), tours_memoire,
 *              base_connaissances, preuves, en_cours:false,
 *              progression:{etape:"en_pause", termine:true}, exemples:[…] }.
 *            v10.6 (F2) : « conversations » compte les FILS DISTINCTS — un
 *            échange question/réponse ne gonfle plus le compteur de 2.
 *            v10.6 (F16) : un label d'outil « ? » est nettoyé en "".
 * POST     → deux usages :
 *            - corps {question, reponse_attendue} (contrat historique) →
 *              passthrough sidecar /entrainer ;
 *            - sans corps (« Lancer ») ou {sujets} (collecte web) → 400
 *              explicite (fonctionnalité non disponible dans ce moteur).
 * PATCH    → 400 (édition d'exemples non disponible côté moteur).
 * DELETE   → v10.6 (F1) : purge RÉELLE des conversations enregistrées —
 *            exige {confirm:true} (contrat du frontend v20260922k) ; sans
 *            confirmation → 400. Corpus d'erreurs et faits préservés.
 */
const URL_SIDECAR_ENTRAINER = "http://127.0.0.1:3010/entrainer";
const TIMEOUT_MS = 30_000;

const schemaCorps = z.object({
  question: z.string().min(1).max(2000),
  reponse_attendue: z.string().min(1).max(20_000),
});

type ExempleBrut = {
  id?: number;
  question?: string;
  attendu?: string;
  prediction?: string;
  source?: string;
  tache?: string;
  ts?: number;
  corrige?: number | boolean;
};

type EtatSidecar = {
  conversations?: number;
  tours_memoire?: number;
  base_connaissances?: number;
  preuves?: number;
  exemples?: ExempleBrut[];
  erreur?: string;
};

export async function GET() {
  try {
    const reponse = await fetch(URL_SIDECAR_ENTRAINER, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const brut = (await reponse.json().catch(() => ({}))) as EtatSidecar;
    const exemples = Array.isArray(brut.exemples) ? brut.exemples : [];
    return Response.json(
      {
        conversations: Number(brut.conversations ?? 0),
        tours_memoire: Number(brut.tours_memoire ?? 0),
        base_connaissances: Number(brut.base_connaissances ?? 0),
        preuves: Number(brut.preuves ?? 0),
        en_cours: false,
        progression: { etape: "en_pause", termine: true },
        exemples: exemples.map((e, i) => ({
          i: Number(e.id ?? i),
          fichier: String(e.source ?? "eval"),
          ts: Number(e.ts ?? 0),
          question: String(e.question ?? ""),
          reponse: String(e.attendu ?? e.prediction ?? ""),
          a_valider: !e.corrige,
          editee: false,
          proposition: "",
          correction: "",
          url: "",
          // v10.6 (F16) : « ? » n'est pas un outil — libellé nettoyé.
          outil: String(e.tache ?? "").trim() === "?" ? "" : String(e.tache ?? ""),
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.warn("[entrainer] Sidecar injoignable (GET) :", err);
    return Response.json(
      {
        conversations: 0,
        tours_memoire: 0,
        base_connaissances: 0,
        preuves: 0,
        en_cours: false,
        progression: { etape: "en_pause", termine: true },
        exemples: [],
        erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant.",
      },
      { status: 503 }
    );
  }
}

export async function POST(req: Request) {
  const garde = garderOrigine(req);
  if (!garde.ok) {
    console.warn("[secu] Origine rejetée", {
      origin: req.headers.get("origin"),
      sfs: req.headers.get("sec-fetch-site"),
      chemin: "/api/entrainer",
    });
    return reponseRefus(garde.raison ?? "origine non autorisée");
  }

  // « Lancer » du frontend : POST sans corps.
  const longueur = Number(req.headers.get("content-length") ?? 0);
  if (longueur === 0) {
    return Response.json(
      {
        erreur:
          "L'entraînement automatique n'est pas disponible dans cette version du moteur. Ajoutez des paires question/réponse via l'API.",
      },
      { status: 400 }
    );
  }

  let brut: unknown;
  try {
    brut = await req.json();
  } catch {
    return Response.json(
      { erreur: "Corps de requête invalide (JSON attendu)." },
      { status: 400 }
    );
  }

  const candidat = (brut ?? {}) as Record<string, unknown>;
  if (typeof candidat.sujets === "string") {
    return Response.json(
      {
        erreur:
          "La collecte web d'entraînement n'est pas disponible dans cette version du moteur.",
      },
      { status: 400 }
    );
  }

  const parse = schemaCorps.safeParse(brut);
  if (!parse.success) {
    return Response.json(
      { erreur: "Corps invalide : « question » et « reponse_attendue » requis." },
      { status: 400 }
    );
  }

  try {
    const reponse = await fetch(URL_SIDECAR_ENTRAINER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parse.data),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    const texte = await reponse.text();
    let json: unknown;
    try {
      json = JSON.parse(texte);
    } catch {
      json = { erreur: "Réponse illisible du moteur Athéna." };
    }
    return Response.json(json, { status: reponse.ok ? 200 : reponse.status });
  } catch (err) {
    console.warn("[entrainer] Sidecar injoignable :", err);
    return Response.json(
      { erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant." },
      { status: 503 }
    );
  }
}

/** Édition d'exemples : non disponible côté moteur v10.3 — refus explicite. */
export async function PATCH() {
  return Response.json(
    { erreur: "Édition des exemples non disponible dans cette version du moteur." },
    { status: 400 }
  );
}

/**
 * v10.6 (F1) — purge RÉELLE des conversations enregistrées, uniquement avec
 * une confirmation explicite {confirm:true} dans le corps (contrat du
 * frontend v20260922k). Sans confirmation → 400 (aucun wipe accidentel).
 * La réponse sidecar indique le nombre de lignes supprimées ; le corpus
 * d'erreurs (L5) et la base de connaissances (L3) sont préservés.
 */
export async function DELETE(req: Request) {
  const garde = garderOrigine(req);
  if (!garde.ok) {
    console.warn("[secu] Origine rejetée", {
      origin: req.headers.get("origin"),
      sfs: req.headers.get("sec-fetch-site"),
      chemin: "/api/entrainer",
    });
    return reponseRefus(garde.raison ?? "origine non autorisée");
  }

  let corps: unknown = null;
  try {
    corps = await req.json();
  } catch {
    corps = null; // DELETE sans corps — toléré, la confirmation manquera.
  }
  const confirme =
    typeof corps === "object" && corps !== null
      ? (corps as { confirm?: unknown }).confirm === true
      : false;
  if (!confirme) {
    return Response.json(
      {
        erreur:
          "Confirmation requise : renvoyer DELETE /api/entrainer avec {\"confirm\": true} pour vider les conversations enregistrées.",
      },
      { status: 400 }
    );
  }

  try {
    const reponse = await fetch(URL_SIDECAR_ENTRAINER, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const texte = await reponse.text();
    let json: unknown;
    try {
      json = JSON.parse(texte);
    } catch {
      json = { erreur: "Réponse illisible du moteur Athéna." };
    }
    return Response.json(json, { status: reponse.ok ? 200 : reponse.status });
  } catch (err) {
    console.warn("[entrainer] Sidecar injoignable (DELETE) :", err);
    return Response.json(
      { erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant." },
      { status: 503 }
    );
  }
}
