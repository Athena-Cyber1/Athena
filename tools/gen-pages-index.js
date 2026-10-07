const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");

/* v20261007 : docs/index.html est embarqué BRUT dans un littéral template
   TypeScript. Un simple accent grave dans un commentaire HTML (p. ex.
   `if (!x) return`) fermait le littéral : le module ne compilait plus et
   TOUTES les routes renvoyaient 500 — sans qu'aucun test ne le voie, car le
   HTML reste valide et `npm run check` n'examine pas le module généré.
   On ÉCHAPPE donc systematically les deux séquences actives d'un template
   literal, ce qui rend le générateur correct par construction : le HTML peut
   contenir ce qu'il veut. */
const echappe = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const corps = echappe(html);

/* Garde-fou explicite : on vérifie que le résultat reste inerte en relisant
   le fichier produit (aucune interpolation non échappée). */
const out =
  "/** docs/index.html exact bytes (LF) — served on GET / for Pages parity. */\n" +
  "export const PAGES_INDEX_HTML = `" +
  corps +
  "`;\n";

/* Garde-fou explicite : dans le corps échappé, tout accent grave doit être
   précédé d'un nombre impair de barres obliques (donc échappé), et toute
   séquence d'interpolation doit l'être aussi. */
let inerte = true;
for (let i = 0; i < corps.length; i++) {
  if (corps[i] !== "`") continue;
  let n = 0;
  for (let j = i - 1; j >= 0 && corps[j] === "\\"; j--) n++;
  if (n % 2 === 0) { inerte = false; console.error("ECHEC : accent grave non echappe, offset " + i); break; }
}
if (inerte && /(^|[^\\])\$\{/.test(corps)) {
  inerte = false;
  console.error("ECHEC : interpolation non echappee");
}
if (!inerte) process.exit(1);

const cible = path.join(root, "src", "lib", "pages-index-html.ts");
fs.writeFileSync(cible, out);
console.log("regenerated pages-index-html.ts len=" + out.length);