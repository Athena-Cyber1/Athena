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
console.log("prepared generated assets");
