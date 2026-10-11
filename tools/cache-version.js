const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* v20261011 (fa) — ANTI-OUBLI D'INVALIDATION DE CACHE.
 *
 * La coloration a ete livree sans que `chat-demo.js` ni `athena-demo.css`
 * changent de `?v=`. Un navigateur qui avait visite le site avant a continue
 * de servir l'ancien JS et l'ancien CSS : pas de coloration, et surtout pas
 * d'erreur. La panne la plus silencieuse qui soit.
 *
 * Un simple controle « le ?v= existe-t-il ? » ne prouve rien — il serait vert
 * avant comme apres le bug. Ce qui PROUVE quelque chose, c'est l'empreinte du
 * contenu : si le fichier a change et que l'epoch annoncee est celle d'avant,
 * les deux ne peuvent pas correspondre.
 *
 * `node tools/cache-version.js bump` regenere le manifeste et le ?v=.
 * `node tools/cache-version.js` verifie que le manifeste decrit le contenu
 * ACTUEL (branche dans tools/check.js).
 */
const dir = path.join(__dirname, '..');
const htmlPath = path.join(dir, 'docs', 'index.html');
const manifestePath = path.join(dir, 'docs', 'cache-manifest.json');

/* Les fichiers servis par l'URL, dans l'ordre du HTML : c'est la liste
   reelle, pas une liste maintained a la main. */
const fichiers = (h) => {
  const out = [];
  for (const m of h.matchAll(/(?:src|href)="(\.\/[^"?]+)(?:\?v=[^"]*)?"/g)) out.push(m[1]);
  return out;
};

/* Les URL du HTML pointent vers `docs/…`, donc l'URL EST le chemin du
   fichier. Resolvee depuis la racine elle echouait sur ENOENT — le controle
   aurait porte sur des fichiers qui n'existent pas a cet endroit. */

/* Les MIROIRS ne doivent PAS etre dans le manifeste.
 *
 * `docs/design/` est une copie generee par `tools/sync-design.js`, et
 * `public/chat-demo.js`… par `tools/prepare-assets.js`. Leur contenu est
 * reconstruit a chaque build : en local l'empreinte etait stable, en CI elle
 * differe — et le garde a alors bloque le build sur un fichier que personne
 * n'avait modifie (c'est arrive sur `fa`).
 *
 * Ce qu'il faut versionner, c'est la SOURCE : `design/athena-demo.css` est le
 * fichier de reference (la charte le dit), `docs/design/` n'en est qu'un
 * miroir. On mesure donc la source quand elle existe, et on ne garde au
 * manifeste que les fichiers réellement servis.
 */
const SOURCE = {
  'design/athena-demo.css': 'design/athena-demo.css',
  'design/theme-loader.js': 'design/theme-loader.js',
  'design/logo.svg': 'design/logo.svg',
};
const cheminSource = (rel) => {
  const rel2 = rel.replace(/^\.\//, '');
  if (SOURCE[rel2]) return path.join(dir, SOURCE[rel2]);
  return path.join(dir, 'docs', rel2.replace(/^docs\//, ''));
};

/* L'empreinte est NORMALISEE sur les fins de ligne.
 *
 * Le depot est ecrit en CRLF cote Windows (`.gitattributes` ne fixe que
 * `docs/chat-demo.js`, pour que le diff de ce fichier-la reste lisible). Au
 * checkout sous Linux, les AUTRES fichiers sortent en LF : meme contenu,
 * octets differents, empreinte differente. Le premier passage en CI a donc
 * echoue sur `theme-loader.js` et `api-shim.js` — deux fichiers que personne
 * n'avait modifies, et dont le contenu est identique.
 *
 * Or ce que le navigateur met en cache, c'est l'URL, pas les octets. Deux
 * versions qui ne different que par CRLF/LF sont le meme fichier pour lui.
 * Comparer les octets rendait donc le garde faux positif sur toute machine
 * non-Windows ; on compare le CONTENU. */
const normaliser = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
const shaSource = (rel) => crypto.createHash('sha256').update(normaliser(fs.readFileSync(cheminSource(rel)))).digest('hex').slice(0, 16);

const epoch = () => {
  const d = new Date();
  const a = d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return a;
};

/* --- regenere : corrige les ?v= et ecrit le manifeste --- */
function bump() {
  const h = fs.readFileSync(htmlPath, 'utf8');
  const liste = fichiers(h);
  const e = epoch();
  /* On garde l'initiale de la derniere epoch si elle existe, sinon 'a'. */
  const ancien = (h.match(/\?v=(\d{8})([a-z])/) || [])[2] || 'a';
  const v = e + ancien;

  let neuf = h;
  for (const f of liste) {
    neuf = neuf.replace(new RegExp('(' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?:\\?v=[^"]*)?(?=["\'])', 'g'), '$1?v=' + v);
  }
  fs.writeFileSync(htmlPath, neuf);

  const manifeste = {};
  for (const f of liste) manifeste[f] = shaSource(f);
  fs.writeFileSync(manifestePath, JSON.stringify({ version: v, fichiers: manifeste }, null, 2) + '\n');
  console.log('cache-version : epoch ' + v + ' sur ' + liste.length + ' fichiers');
  for (const f of liste) console.log('   ' + f + '  ' + manifeste[f]);
}

/* --- verifie : le manifeste decrit-il le contenu actuel ? --- */
function verifie() {
  const h = fs.readFileSync(htmlPath, 'utf8');
  const liste = fichiers(h);
  const ko = [];

  if (!fs.existsSync(manifestePath)) {
    console.error('  BLOQUANT docs/cache-manifest.json absent — lancez : node tools/cache-version.js bump');
    process.exitCode = 1;
    return;
  }
  const m = JSON.parse(fs.readFileSync(manifestePath, 'utf8'));

  for (const f of liste) {
    const annonce = m.fichiers[f];
    if (!annonce) { ko.push(f + ' : absent du manifeste (fichier ajoute, ?v= jamais regenere)'); continue; }
    const reel = shaSource(f);
    if (reel !== annonce) {
      ko.push(f + ' : contenu modifie (' + annonce + ' -> ' + reel + ') sans regenereer le ?v= — le navigateur servira le cache');
    }
  }
  for (const f of Object.keys(m.fichiers)) {
    if (liste.indexOf(f) < 0) ko.push(f + ' : dans le manifeste mais plus dans le HTML');
  }
  /* Le ?v= annonce doit correspondre a l'epoch du manifeste. */
  for (const mm of h.matchAll(/(?:src|href)="([^"?]+)\?v=([^"]+)"/g)) {
    if (mm[2] !== m.version) ko.push(mm[1] + ' : ?v=' + mm[2] + ' mais le manifeste annonce ' + m.version);
  }

  if (ko.length) {
    console.error('  BLOQUANT cache non invalide :');
    ko.forEach(x => console.error('    - ' + x));
    console.error('  corrigez par : node tools/cache-version.js bump');
    process.exitCode = 1;
  } else {
    console.log('  cache : ' + liste.length + ' fichiers, epoch ' + m.version + ', empreintes concordantes');
  }
}

if (require.main === module) {
  if (process.argv[2] === 'bump') bump();
  else verifie();
}

module.exports = { bump, verifie };