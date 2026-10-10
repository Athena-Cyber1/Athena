const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

function run(script) {
  execFileSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root,
    stdio: "inherit",
  });
}

function copy(source, destination) {
  const from = path.join(root, source);
  const to = path.join(root, destination);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

run("sync-design.js");
run("gen-pages-index.js");
copy("docs/chat-demo.js", "public/chat-demo.js");
copy("docs/api-shim.js", "public/api-shim.js");
copy("docs/keys.js", "public/keys.js"); // v20260928 : sinon localhost sert une vieille clé.
copy("docs/index.html", "public/_index.html");
/* v20260926h : police Inter auto-hébergée (zéro dépendance réseau). */
copy("docs/fonts/inter-400.woff2", "public/fonts/inter-400.woff2");
copy("docs/fonts/inter-500.woff2", "public/fonts/inter-500.woff2");
copy("docs/fonts/inter-700.woff2", "public/fonts/inter-700.woff2");
/* v20260926i : Twemoji auto-hébergé (émojis proches macOS). */
copy("docs/vendor/twemoji.min.js", "public/vendor/twemoji.min.js");
/* v20261007 (et) : les SVG Twemoji sont AUTO-HÉBERGÉS. La bibliothèque était
   déjà locale, mais les images venaient du CDN — hors ligne, le rendu
   retombait sur l'émoji système. GitHub Pages publie `docs/`, donc les SVG
   doivent vivre dans `docs/vendor/twemoji/` ET être copiés dans `public/`
   pour que le serveur local les serve aussi.
   v20261007 (ev) : jeu COMPLET dans `svg/` (3689 fichiers, 14.0.2), à plat.
   L'ancien sous-dossier `72x72/` n'a plus lieu d'être : le chemin dependedait
   du défaut `size` de la bibliothèque, pas d'un choix de notre part. */
(function copieTwemoji() {
  const src = "docs/vendor/twemoji";
  const dst = "public/vendor/twemoji";
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst + "/svg", { recursive: true });
  for (const nom of fs.readdirSync(src + "/svg")) {
    if (nom.endsWith(".svg")) fs.copyFileSync(src + "/svg/" + nom, dst + "/svg/" + nom);
  }
  /* L'ancien miroir `72x72/` ne doit pas survivre : il ferait 14 doublons
     et ferait croire que le chemin est toujours-active. */
  const vieux = dst + "/72x72";
  if (fs.existsSync(vieux)) fs.rmSync(vieux, { recursive: true, force: true });
  const licence = src + "/LICENCE-TWEMOJI-GRAPHICS.txt";
  if (fs.existsSync(licence)) fs.copyFileSync(licence, dst + "/LICENCE-TWEMOJI-GRAPHICS.txt");
})();
console.log("prepared generated assets");
