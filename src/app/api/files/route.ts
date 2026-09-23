import { garderOrigine, reponseRefus } from "@/lib/secu";
import { z } from "zod";

/**
 * /api/files — v10.6 : ingestion + consultation des fichiers (correctifs F4,
 * F7, F8, F9, F10, F11, F19, F22 du rapport QA).
 *
 * GET    → liste des fichiers connus du sidecar, schéma HARMONISÉ avec
 *          l'upload (file_id, filename/nom, mime, langue, lignes, ts,
 *          status, kind, sha256, size_bytes, chunks, erreur).
 *          Paramètres supportés :
 *            ?id=<file_id>    → la fiche du fichier ciblé (objet unique) ;
 *            ?id=…&raw=1      → le CONTENU BRUT du fichier (text/plain) ;
 *            ?status=indexed|failed → filtre sur l'état d'indexation ;
 *            ?limit=<n>       → borne le nombre de résultats.
 * HEAD   → 200 sans corps (health-check fichier).
 * POST   → deux contrats : JSON {filename, content_base64} (démo) ou
 *          multipart/form-data « fichier » (historique). Un refus moteur
 *          (taille, exécutable…) → 422 explicite + trace « failed ».
 * DELETE ?id=<file_id> → purge RÉELLE (registre + chunks) ; le frontend
 *          l'appelle pour les échecs d'upload / chips retirées / abandons.
 */

const URL_SIDECAR_FILES = "http://127.0.0.1:3010/files";
const URL_SIDECAR_INGEST = "http://127.0.0.1:3010/files/ingest";
const MAX_OCTETS = 20_000_000; // même borne que le sidecar (ZAI_MAX_UPLOAD)

const schemaUploadJson = z.object({
  filename: z.string().min(1).max(300),
  content_base64: z.string().min(1).max(28_000_000), // 20 Mo ≈ 26,7 Mo en base64
});

/* ------------------------------------------------------------------ */
/* GET — liste / fiche / contenu brut                                  */
/* ------------------------------------------------------------------ */

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = (params.get("id") ?? "").trim();
  const raw = params.get("raw") === "1" || params.get("raw") === "true";
  const statutFiltre = (params.get("status") ?? "").trim();
  const limiteBrute = Number(params.get("limit") ?? "");

  try {
    // 1) Contenu brut d'un fichier précis (?raw=1&id=…).
    if (id && raw) {
      const reponse = await fetch(`${URL_SIDECAR_FILES}/${encodeURIComponent(id)}/contenu`, {
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (reponse.status === 404) {
        return Response.json({ erreur: "fichier introuvable.", file_id: id }, { status: 404 });
      }
      if (!reponse.ok) {
        return Response.json({ erreur: "contenu indisponible." }, { status: 502 });
      }
      const texte = await reponse.text();
      return new Response(texte, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.txt"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // 2) Fiche d'un fichier précis (?id=…).
    if (id) {
      const reponse = await fetch(`${URL_SIDECAR_FILES}/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      const texte = await reponse.text();
      let json: { fichier?: Record<string, unknown>; detail?: string } = {};
      try {
        json = JSON.parse(texte);
      } catch {
        json = {};
      }
      if (reponse.status === 404 || !json.fichier) {
        return Response.json(
          { erreur: json.detail ?? "fichier introuvable.", file_id: id },
          { status: 404 }
        );
      }
      return Response.json(json.fichier, { headers: { "Cache-Control": "no-store" } });
    }

    // 3) Liste complète (+ filtres status / limit côté passerelle).
    const reponse = await fetch(URL_SIDECAR_FILES, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const texte = await reponse.text();
    let json: { fichiers?: Record<string, unknown>[] } = {};
    try {
      json = JSON.parse(texte);
    } catch {
      json = {};
    }
    let fichiers = Array.isArray(json.fichiers) ? json.fichiers : [];
    const total = fichiers.length;
    if (statutFiltre) {
      fichiers = fichiers.filter((f) => String(f.status ?? "") === statutFiltre);
    }
    if (Number.isFinite(limiteBrute) && limiteBrute > 0) {
      fichiers = fichiers.slice(0, Math.floor(limiteBrute));
    }
    return Response.json(
      { fichiers, count: fichiers.length, total },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.warn("[files] Sidecar injoignable (GET) :", err);
    return Response.json(
      { erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant." },
      { status: 503 }
    );
  }
}

/** v10.6 (F19) : HEAD explicite — health-check fichier sans corps. */
export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------------ */
/* POST — ingestion (JSON base64 ou multipart)                         */
/* ------------------------------------------------------------------ */

/** Décode du base64 pur (ou data:URI tolérée) en octets, avec garde de taille. */
function decoderBase64(brut: string): { ok: true; octets: Uint8Array } | { ok: false; erreur: string } {
  let b64 = brut.trim();
  const prefixe = b64.indexOf("base64,");
  if (b64.startsWith("data:") && prefixe > 0) b64 = b64.slice(prefixe + 7);
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) {
    return { ok: false, erreur: "content_base64 invalide (base64 attendu)." };
  }
  let tampon: Buffer;
  try {
    tampon = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, erreur: "content_base64 indécodable." };
  }
  if (tampon.length === 0) return { ok: false, erreur: "fichier vide." };
  if (tampon.length > MAX_OCTETS) {
    return { ok: false, erreur: "fichier trop volumineux (> 20 Mo)." };
  }
  return { ok: true, octets: new Uint8Array(tampon) };
}

/** Nom de fichier sûr : sans chemin, borné. */
function nomSur(nom: string): string {
  return nom.replace(/[/\\\x00-\x1f]/g, "_").slice(0, 280) || "fichier";
}

async function ingesterOctets(
  filename: string,
  octets: Uint8Array
): Promise<Response> {
  const form = new FormData();
  form.append("fichier", new Blob([octets as BlobPart]), filename);
  const reponse = await fetch(URL_SIDECAR_INGEST, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  const texte = await reponse.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(texte) as Record<string, unknown>;
  } catch {
    json = { erreur: "Réponse illisible du moteur Athéna." };
  }
  if (!reponse.ok || json.statut === "ERREUR") {
    return Response.json(
      { erreur: String(json.raison ?? json.erreur ?? "ingestion refusée par le moteur.") },
      { status: reponse.status === 200 ? 422 : reponse.status }
    );
  }
  // v10.6 (F7) : même schéma que la LISTE — filename, status, kind,
  // size_bytes en plus des champs historiques du contrat démo.
  return Response.json({
    file_id: json.file_id,
    filename: json.filename ?? json.nom ?? filename,
    status: json.status ?? "indexed",
    kind: json.kind ?? "document",
    size_bytes: json.size_bytes ?? 0,
    chunks: json.chunks ?? 0,
    mime: json.mime ?? null,
  });
}

export async function POST(req: Request) {
  const garde = garderOrigine(req);
  if (!garde.ok) {
    console.warn("[secu] Origine rejetée", {
      origin: req.headers.get("origin"),
      sfs: req.headers.get("sec-fetch-site"),
      chemin: "/api/files",
    });
    return reponseRefus(garde.raison ?? "origine non autorisée");
  }

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

  // Contrat démo : JSON base64.
  if (contentType.includes("application/json")) {
    let brut: unknown;
    try {
      brut = await req.json();
    } catch {
      return Response.json(
        { erreur: "Corps de requête invalide (JSON attendu)." },
        { status: 400 }
      );
    }
    const parse = schemaUploadJson.safeParse(brut);
    if (!parse.success) {
      return Response.json(
        { erreur: "filename et content_base64 requis (fichier ≤ 20 Mo)." },
        { status: 400 }
      );
    }
    const decode = decoderBase64(parse.data.content_base64);
    if (!decode.ok) return Response.json({ erreur: decode.erreur }, { status: 413 });
    try {
      return await ingesterOctets(nomSur(parse.data.filename), decode.octets);
    } catch (err) {
      console.warn("[files] Sidecar injoignable (POST json) :", err);
      return Response.json(
        { erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant." },
        { status: 503 }
      );
    }
  }

  // Contrat historique : multipart brut.
  if (!contentType.startsWith("multipart/form-data")) {
    return Response.json(
      { erreur: "multipart/form-data (champ « fichier ») ou JSON {filename, content_base64} attendu." },
      { status: 400 }
    );
  }

  try {
    // Forward du body BRUT : on ne re-parse pas le multipart, le sidecar
    // recoit exactement l'octet-stream d'origine avec son Content-Type
    // (boundary incluse).
    const corps = await req.arrayBuffer();
    const reponse = await fetch(URL_SIDECAR_INGEST, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: corps,
      signal: AbortSignal.timeout(120_000),
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
    console.warn("[files] Sidecar injoignable (POST) :", err);
    return Response.json(
      { erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant." },
      { status: 503 }
    );
  }
}

/* ------------------------------------------------------------------ */
/* DELETE — purge réelle d'un fichier (?id=…)                          */
/* ------------------------------------------------------------------ */

export async function DELETE(req: Request) {
  const garde = garderOrigine(req);
  if (!garde.ok) return reponseRefus(garde.raison ?? "origine non autorisée");

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!id) {
    return Response.json(
      { erreur: "paramètre « id » requis (DELETE /api/files?id=<file_id>)." },
      { status: 400 }
    );
  }
  try {
    const reponse = await fetch(`${URL_SIDECAR_FILES}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (reponse.status === 404) {
      return Response.json(
        { erreur: "fichier introuvable (déjà supprimé ?).", file_id: id },
        { status: 404 }
      );
    }
    if (!reponse.ok) {
      return Response.json({ erreur: "purge impossible." }, { status: 502 });
    }
    return Response.json({ statut: "purge", file_id: id });
  } catch (err) {
    console.warn("[files] Sidecar injoignable (DELETE) :", err);
    return Response.json(
      { erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant." },
      { status: 503 }
    );
  }
}
