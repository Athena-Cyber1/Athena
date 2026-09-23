import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/files/[id] — v10.6 : accès PATH-STYLE à un fichier (correctifs F9, F10
 * du rapport QA — l'ancien segment non routé tombait sur la page 404 HTML de
 * Next au lieu d'une erreur API JSON).
 *
 * GET                → fiche JSON du fichier (objet unique, même schéma que
 *                      la liste) ; 404 JSON si inconnu.
 * GET  ?raw=1        → contenu BRUT du fichier (text/plain, téléchargeable).
 * DELETE             → purge réelle (registre + chunks), garde d'origine.
 * HEAD               → sonde sans corps.
 */

const URL_SIDECAR_FILES = "http://127.0.0.1:3010/files";

type Contexte = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Contexte) {
  const { id } = await ctx.params;
  const file_id = (id ?? "").trim();
  if (!file_id) {
    return Response.json({ erreur: "identifiant de fichier requis." }, { status: 400 });
  }
  const brut = new URL(req.url).searchParams.get("raw") === "1";

  try {
    if (brut) {
      const reponse = await fetch(
        `${URL_SIDECAR_FILES}/${encodeURIComponent(file_id)}/contenu`,
        { signal: AbortSignal.timeout(15_000), cache: "no-store" }
      );
      if (reponse.status === 404) {
        return Response.json({ erreur: "fichier introuvable.", file_id }, { status: 404 });
      }
      if (!reponse.ok) {
        return Response.json({ erreur: "contenu indisponible." }, { status: 502 });
      }
      const texte = await reponse.text();
      return new Response(texte, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${file_id}.txt"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const reponse = await fetch(`${URL_SIDECAR_FILES}/${encodeURIComponent(file_id)}`, {
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
        { erreur: json.detail ?? "fichier introuvable.", file_id },
        { status: 404 }
      );
    }
    return Response.json(json.fichier, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.warn("[files/:id] Sidecar injoignable (GET) :", err);
    return Response.json(
      { erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant." },
      { status: 503 }
    );
  }
}

export async function DELETE(req: Request, ctx: Contexte) {
  const garde = garderOrigine(req);
  if (!garde.ok) return reponseRefus(garde.raison ?? "origine non autorisée");

  const { id } = await ctx.params;
  const file_id = (id ?? "").trim();
  if (!file_id) {
    return Response.json({ erreur: "identifiant de fichier requis." }, { status: 400 });
  }
  try {
    const reponse = await fetch(`${URL_SIDECAR_FILES}/${encodeURIComponent(file_id)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (reponse.status === 404) {
      return Response.json(
        { erreur: "fichier introuvable (déjà supprimé ?).", file_id },
        { status: 404 }
      );
    }
    if (!reponse.ok) {
      return Response.json({ erreur: "purge impossible." }, { status: 502 });
    }
    return Response.json({ statut: "purge", file_id });
  } catch (err) {
    console.warn("[files/:id] Sidecar injoignable (DELETE) :", err);
    return Response.json(
      { erreur: "Le moteur Athéna est indisponible. Réessayez dans un instant." },
      { status: 503 }
    );
  }
}

export async function HEAD(_req: Request, ctx: Contexte) {
  const { id } = await ctx.params;
  const file_id = (id ?? "").trim();
  try {
    const reponse = await fetch(`${URL_SIDECAR_FILES}/${encodeURIComponent(file_id)}`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    return new Response(null, { status: reponse.ok ? 200 : reponse.status });
  } catch {
    return new Response(null, { status: 503 });
  }
}
