import { garderOrigine, reponseRefus } from "@/lib/secu";
import { promises as fs, readFileSync } from "fs";
import path from "path";

/**
 * /api/design — v10.2 : import de design utilisateur.
 *
 * Contexte : les fichiers envoyés via la messagerie n'arrivent jamais sur le
 * disque du sandbox (/home/z/my-project/upload/ reste vide). Cette route fait
 * de l'APPLICATION elle-même le canal d'import :
 *   POST   → archive le contenu brut dans upload/ (fichier lisible ensuite par
 *            les agents) + extrait les variables CSS du thème Athéna
 *            (--primaire, --violet, --fond…) et les applique en direct ;
 *   GET    → état du design importé (métadonnées + tokens) ;
 *   DELETE → réinitialise le thème par défaut (supprime les fichiers créés).
 *
 * Sécurité : garde d'origine v2 (comme /api/chat), valeurs de tokens
 * strictement filtrées (aucune url(), caractère de break-out interdit) —
 * le JSON archivé est réinjecté dans un <style> côté client.
 */

const DOSSIER_UPLOAD = path.join(process.cwd(), "upload");
const CHEMIN_THEME = path.join(process.cwd(), "design", "theme-importe.json");
const CHEMIN_THEME_PAGES = path.join(process.cwd(), "docs", "design", "theme-importe.json");
const CHEMIN_THEME_PUBLIC = path.join(process.cwd(), "public", "design", "theme-importe.json");
const TAILLE_MAX = 300_000; // 300 Ko de contenu collé/uploadé max.

/** Tokens de thème réellement consommés par public/demo/chat-demo.js. */
const TOKENS_AUTORISES = new Set([
  "fond", "carte", "carte-doux", "texte", "texte-doux", "bord", "bord-fort",
  "primaire", "primaire-fort", "primaire-doux", "primaire-texte",
  "sur-primaire", "lien",
  "violet", "violet-doux", "violet-texte",
  "ambre-fond", "ambre-bord", "ambre-texte",
  "rouge-fond", "rouge-bord", "rouge-texte",
  "gris-fond", "gris-bord", "gris-texte",
  "code-fond", "heros", "ombre",
]);

/** Alias courants anglais/français → token Athéna. */
const ALIAS_TOKENS: Record<string, string> = {
  background: "fond", bg: "fond", surface: "carte", card: "carte",
  color: "texte", text: "texte", foreground: "texte",
  "text-muted": "texte-doux", muted: "texte-doux",
  border: "bord", primary: "primaire", accent: "primaire",
  "primary-dark": "primaire-fort", "primary-light": "primaire-doux",
  "on-primary": "sur-primaire", "primary-contrast": "sur-primaire",
  link: "lien", anchor: "lien",
  secondary: "violet", purple: "violet", warning: "ambre-texte",
  danger: "rouge-texte", error: "rouge-texte", success: "primaire-texte",
  code: "code-fond", shadow: "ombre",
};

/** Caractères / motifs interdits dans une valeur de token (anti break-out CSS). */
const MOTIFS_INTERDITS = [
  /url\s*\(/i, /expression\s*\(/i, /@/, /</, />/, /\{/, /\}/, /;/, /\\/,
  /javascript/i, /behavior/i, /binding/i, /import/i, /\/\*/,
];

function valeurSure(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 300) return false;
  return !MOTIFS_INTERDITS.some((re) => re.test(v));
}

/**
 * Extrait les tokens de thème d'un contenu HTML/CSS/JS quelconque.
 * Dernière déclaration gagnante. Retourne la map token → valeur validée.
 */
function extraireTokens(contenu: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)[;}]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contenu)) !== null) {
    let nom = m[1].toLowerCase();
    const brut = m[2].trim();
    if (!valeurSure(brut)) continue;
    nom = ALIAS_TOKENS[nom] ?? nom;
    if (!TOKENS_AUTORISES.has(nom)) continue;
    tokens[nom] = brut;
  }
  return tokens;
}

/** Nom de fichier sûr (sans chemin, sans caractères exotiques, borné). */
function nomFichierSur(nom: string | undefined | null): string {
  const base = (nom ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 80)
    .replace(/^\.+/, "_");
  return base || "design-colle.txt";
}

function lireTheme(): {
  existe: boolean;
  nom?: string;
  date?: string;
  tokens?: Record<string, string>;
  taille_brut?: number;
} {
  try {
    const brut = readFileSync(CHEMIN_THEME, "utf8");
    const json = JSON.parse(brut);
    return { existe: true, ...json };
  } catch {
    return { existe: false };
  }
}

export async function GET() {
  const theme = lireTheme();
  return Response.json(theme, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const garde = garderOrigine(req);
  if (!garde.ok) {
    console.warn("[secu] Origine rejetée", {
      origin: req.headers.get("origin"),
      sfs: req.headers.get("sec-fetch-site"),
      chemin: "/api/design",
    });
    return reponseRefus(garde.raison ?? "origine non autorisée");
  }

  let contenu = "";
  let nom = "";

  try {
    const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const fichier = form.get("fichier");
      if (fichier && typeof fichier !== "string") {
        contenu = await fichier.text();
        nom = fichier.name ?? "";
      } else {
        const texte = form.get("contenu");
        if (typeof texte === "string") contenu = texte;
      }
    } else {
      const brut = (await req.json()) as { contenu?: unknown; nom?: unknown };
      if (typeof brut.contenu === "string") contenu = brut.contenu;
      if (typeof brut.nom === "string") nom = brut.nom;
    }
  } catch {
    return Response.json(
      { erreur: "Corps de requête invalide (JSON {contenu, nom} ou multipart attendu)." },
      { status: 400 }
    );
  }

  if (!contenu.trim()) {
    return Response.json({ erreur: "Aucun contenu fourni." }, { status: 400 });
  }
  if (contenu.length > TAILLE_MAX) {
    return Response.json(
      { erreur: `Contenu trop long (${contenu.length} > ${TAILLE_MAX} caractères).` },
      { status: 413 }
    );
  }

  const tokens = extraireTokens(contenu);

  try {
    // 1) Archive du brut dans upload/ (le canal que la messagerie n'assure pas).
    await fs.mkdir(DOSSIER_UPLOAD, { recursive: true });
    const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
    const archive = path.join(
      DOSSIER_UPLOAD,
      `design-${horodatage}-${nomFichierSur(nom)}`
    );
    await fs.writeFile(archive, contenu, "utf8");

    // 2) Tokens normalisés pour le frontend.
    const theme = {
      nom: nom || "contenu collé",
      date: new Date().toISOString(),
      taille_brut: contenu.length,
      tokens,
    };
    const brut = JSON.stringify(theme, null, 2);
    for (const chemin of [CHEMIN_THEME, CHEMIN_THEME_PAGES, CHEMIN_THEME_PUBLIC]) {
      await fs.writeFile(chemin, brut, "utf8");
    }

    return Response.json({
      ok: true,
      archive: path.basename(archive),
      tokens_appliques: Object.keys(tokens).length,
      tokens,
      note:
        Object.keys(tokens).length === 0
          ? "Aucune variable CSS reconnue — le fichier brut est archivé, mais aucun thème n'a pu être extrait."
          : undefined,
    });
  } catch (err) {
    console.warn("[design] Échec d'écriture :", err);
    return Response.json(
      { erreur: "Échec d'enregistrement du design." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const garde = garderOrigine(req);
  if (!garde.ok) {
    return reponseRefus(garde.raison ?? "origine non autorisée");
  }
  try {
    for (const chemin of [CHEMIN_THEME, CHEMIN_THEME_PAGES, CHEMIN_THEME_PUBLIC]) {
      try {
        await fs.unlink(chemin);
      } catch {
        // absent → déjà l'état par défaut, ce n'est pas une erreur.
      }
    }
  } catch {
    // ignore
  }
  return Response.json({ ok: true, reset: true });
}
