import { garderOrigine, reponseRefus } from "@/lib/secu";

/**
 * /api/relais — v20261004 : relais NAVIGATEUR → PONT (llm-bridge :3015).
 *
 * Pollinations bloque tout appel émis depuis un NAVIGATEUR (403
 * « Missing Turnstile token » — challenge Cloudflare) alors que le même appel
 * passe côté serveur (Bun/Node). Sans relais, chaque message hors skill qui
 * vise un modèle gratuit échoue en « Échec du modèle : … 403 », l'historique
 * se remplit d'erreurs et le tour suivant (skill compris) perd le contexte.
 *
 * Contrat ENTRANT (shim api-shim.js, même corps qu'un appel OpenAI) :
 *   POST { messages:[{role, content}], model?, temperature?, max_tokens? }
 * Contrat SORTANT (tel quel depuis le pont) :
 *   { texte, provider, model, repli, fin, duree_ms }  → 200
 *   ou erreur structurée neutre du pont               → 502/503/504
 *
 * Le pont conserve le modèle choisi (route directe), la cascade saine et le
 * cache — le relais n'ajoute AUCUN comportement, il contourne seulement le
 * blocage navigateur. Jamais bloquant : pont injoignable → 503 neutre, le
 * shim enchaîne alors sur le provider suivant de sa chaîne.
 */

const URL_PONT_COMPLETE = "http://127.0.0.1:3015/complete";
const TIMEOUT_MS = 60_000;
const MAX_MESSAGES = 400;
const MAX_CONTENU = 200_000;
/* v20261007 : plafond de corps (avant parsing) — 400 × 200 000 = 80 Mo
   théoriques, inacceptable à charger en mémoire. */
const CORPS_MAX_OCTETS = 12_000_000;

type MessageRelais = { role: string; content: string };

export async function POST(request: Request) {
  const garde = garderOrigine(request);
  if (!garde.ok) return reponseRefus(garde.raison ?? "origine non autorisée");

  /* v20261007 (B1) : plafond AVANT parsing (même raison que /api/chat : un
     corps de 80 Mo était chargé en mémoire avant d'être rejeté). */
  const octets = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(octets) && octets > CORPS_MAX_OCTETS) {
    return Response.json({ erreur: "corps trop volumineux (relais)" }, { status: 413 });
  }

  let corps: Record<string, unknown> | null = null;
  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    corps = null;
  }
  const brut = Array.isArray(corps?.messages) ? corps.messages : null;
  if (!brut || brut.length === 0) {
    return Response.json({ erreur: "messages manquants" }, { status: 400 });
  }
  const messages: MessageRelais[] = [];
  for (const m of brut.slice(0, MAX_MESSAGES)) {
    const o = (m ?? {}) as { role?: unknown; content?: unknown };
    const role = typeof o.role === "string" ? o.role : "user";
    const content = typeof o.content === "string" ? o.content : "";
    if (!content || content.length > MAX_CONTENU) continue;
    messages.push({ role, content });
  }
  if (messages.length === 0) {
    return Response.json({ erreur: "aucun message exploitable" }, { status: 400 });
  }

  const aEnvoyer: Record<string, unknown> = { messages };
  if (typeof corps?.model === "string" && corps.model.trim()) {
    aEnvoyer.model = corps.model.trim().slice(0, 120);
  }
  if (typeof corps?.temperature === "number" && Number.isFinite(corps.temperature)) {
    aEnvoyer.temperature = Math.max(0, Math.min(2, corps.temperature));
  }
  if (typeof corps?.max_tokens === "number" && Number.isFinite(corps.max_tokens)) {
    aEnvoyer.max_tokens = Math.max(256, Math.min(32_000, corps.max_tokens));
  }

  try {
    const reponse = await fetch(URL_PONT_COMPLETE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(aEnvoyer),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const texte = await reponse.text();
    return new Response(texte, {
      status: reponse.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { code: "PONT_INJOIGNABLE", erreur: "relais local indisponible" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
