/**
 * Garde d'origine v2 — reprise de l'ancien système Athéna.
 *
 * Objectif : bloquer les requêtes cross-site forgées (CSRF / déclenchement
 * depuis un site tiers) sur les routes API qui mutent de l'état ou consomment
 * du budget LLM, tout en laissant passer :
 *   - les clients sans navigateur (curl, healthchecks) ;
 *   - les navigations/fetchs légitimes du site (même origine ou même site) ;
 *   - les cas connus de l'edge de preview (Origin: null + same-site).
 *
 * Les règles sont ORDONNÉES : la première qui s'applique décide.
 */

const RAISON_REFUS = "origine non autorisée";

export interface ResultatOrigine {
  ok: boolean;
  raison?: string;
}

/** Normalise un en-tête (null-safe, minuscules, sans espaces parasites). */
function norme(valeur: string | null): string {
  return (valeur ?? "").trim().toLowerCase();
}

export function garderOrigine(req: Request): ResultatOrigine {
  const origin = req.headers.get("origin");
  const sfs = norme(req.headers.get("sec-fetch-site"));
  const host = (req.headers.get("host") ?? "").trim();

  // Règle 1 — Absence d'Origin ET absence de Sec-Fetch-Site → autorisé
  // (client non navigateur : curl, healthchecks, tests d'intégration).
  if (!origin && !sfs) {
    return { ok: true };
  }

  // Règle 2 — Sec-Fetch-Site same-origin | same-site | none → autorisé.
  // Source primaire : envoyée par le navigateur, insensible à la réécriture
  // du Host par l'edge (contrairement à l'en-tête Host lui-même).
  if (sfs === "same-origin" || sfs === "same-site" || sfs === "none") {
    return { ok: true };
  }

  // Règle 3 — Origin présente et exactement égale à https://$host ou http://$host.
  if (origin && host) {
    if (origin === `https://${host}` || origin === `http://${host}`) {
      return { ok: true };
    }
  }

  // Règle 4 — Origin: null ET Sec-Fetch-Site same-site → autorisé
  // (iframe sandboxée servie par l'edge de preview).
  if (origin === "null" && sfs === "same-site") {
    return { ok: true };
  }

  // Règle 5 — Liste blanche explicite via ZAI_ORIGINES_SUP (séparée par virgules).
  const sup = process.env.ZAI_ORIGINES_SUP;
  if (origin && sup) {
    const liste = sup
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (liste.includes(origin)) {
      return { ok: true };
    }
  }

  // Règle 6 — Filet : X-Forwarded-Host présent et l'hôte de l'Origin correspond
  // (égalité stricte ou sous-domaine) — couvre les edges qui réécrivent Host.
  const xfh = (req.headers.get("x-forwarded-host") ?? "").trim().toLowerCase();
  if (origin && xfh) {
    try {
      const hoteOrigin = new URL(origin).host.toLowerCase();
      if (hoteOrigin === xfh || hoteOrigin.endsWith(`.${xfh}`)) {
        return { ok: true };
      }
    } catch {
      // Origin malformée → on laisse tomber cette règle, le refus tranchera.
    }
  }

  // Règle 7 — Sinon → refus.
  return { ok: false, raison: RAISON_REFUS };
}

/** Réponse 403 JSON standardisée pour un refus d'origine. */
export function reponseRefus(raison: string): Response {
  return Response.json(
    { erreur: "Origine non autorisée", raison },
    { status: 403 }
  );
}
