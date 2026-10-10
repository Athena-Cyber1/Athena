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
/* v20261007 (ez) : la copie de `vendor/twemoji.min.js` a été retirée avec la
   bibliothèque (les émojis sont natifs). Elle plantait ici en ENOENT, car elle
   pointait sur un fichier supprimé — `tools/check.js` ne valide pas ce script. */
/* v20260926i : Twemoji auto-hébergé.
   v20261007 (ez) : SUPPRIMÉ. Les émojis sont rendus par l'OS — la pile
   `--police-emoji` met Apple Color Emoji en tête. Les dessins Apple ne sont pas
   redistribuables (règle App Store 5.2.5) ; laisser le système dessiner est
   explicitement autorisé, et cela supprime 3689 fichiers (8,19 Mo) du dépôt
   ainsi que toute requête réseau pour un émoji. Le dossier `vendor/twemoji/`
   est retiré des deux côtés. */
(function purgeTwemoji() {
  for (const d of ["docs/vendor/twemoji", "public/vendor/twemoji", "docs/vendor/twemoji.min.js", "public/vendor/twemoji.min.js"]) {
    const p = path.join(root, d);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
})();
console.log("prepared generated assets");
