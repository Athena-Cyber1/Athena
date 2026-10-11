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
/* v20261008 (fj) : vendor highlight.js. Copie RECURSIVE — le fichier de
   langage (languages/powershell.min.js) est dans un sous-dossier, et une
   copie plate l'aurait laissé absent : le core se chargerait quand même, mais
   PowerShell — le langage de toutes les commandes de cet agent — resterait non
   coloré, SANS LE MOINDRE SIGNAL.
   La récursion est explicite (`dirent.isDirectory()`) : un `readdirSync` sans
   `withFileTypes` suivi d'un `copyFileSync` tente de copier un dossier comme
   un fichier et echoue en EPERM — ce qui est exactement ce qu'a fait mon
   premiere version, silencieusement pour la moitie du vendor. */
function copieRecursif( depuis, vers) {
  fs.mkdirSync(vers, { recursive: true });
  for (const entree of fs.readdirSync(depuis, { withFileTypes: true })) {
    const a = path.join(depuis, entree.name);
    const b = path.join(vers, entree.name);
    if (entree.isDirectory()) copieRecursif(a, b);
    else fs.copyFileSync(a, b);
  }
}
(function copieVendor() {
  const depuis = path.join(root, "docs", "vendor");
  if (!fs.existsSync(depuis)) return;
  copieRecursif(depuis, path.join(root, "public", "vendor"));
})();
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
