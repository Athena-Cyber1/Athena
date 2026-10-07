const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'docs');
const h = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

/* v20261007 (B1) : ce script DIAGNOSTIQUE depuis toujours, mais ne faisait
   jamais échouer le build : `npm run check` et l'étape CI « Static checks »
   sortaient en 0 même avec `MISSING=["hud-fichier"]`. Un contrôle qui ne peut
   pas échouer n'est pas un contrôle. On accumule désormais les anomalies
 *bloquantes* et on fixe process.exitCode — sans casser l'usage en lecture
   (les avertissements restent affichés). */
const bloquants = [];
const signaler = (msg) => { bloquants.push(msg); console.error('  BLOQUANT ' + msg); };

/* Les scripts inline et les styles NE sont pas du HTML : on les retire avant
   de compter les balises (sinon `if (a<b)` ou `i < 3` devient une « balise »
   et le rapport perd tout son sens). */
const htmlScan = h
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
let m, stack = [], errs = [];
while ((m = re.exec(htmlScan))) {
  const close = m[1] === '/', tag = m[2].toLowerCase(), self = m[4] === '/';
  if (voids.has(tag) || self) continue;
  if (!close) stack.push({ tag, i: m.index });
  else {
    if (stack.length === 0) { errs.push('extra </' + tag + '> at ' + m.index); continue; }
    const top = stack.pop();
    if (top.tag !== tag) errs.push('mismatch: <' + top.tag + '> closed by </' + tag + '> at ' + m.index);
  }
}
for (const s of stack) errs.push('unclosed <' + s.tag + '> at ' + s.i);
console.log(errs.length ? errs.join('\n') : 'HTML tags balanced');
if (errs.length) signaler(errs.length + ' probleme(s) de balisage HTML');

const ids = [...h.matchAll(/id="([^"]+)"/g)].map(x => x[1]);
const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
console.log('ids=' + ids.length + ' dups=' + JSON.stringify(dups));
if (dups.length) signaler('id duplique(s) : ' + dups.join(', '));

const js = fs.readFileSync(path.join(dir, 'chat-demo.js'), 'utf8');
/* v20261007 (B1/U1) : on scannait UNIQUEMENT `getElementById("x")`. Or le code
   utilise massivement l'alias `$('x')` — `const statutEl = $('statut')` n'était
   donc jamais vérifié, et #statut/#dot ont pu disparaître du HTML sans que
   l'outil ne voie rien (la garde `if (!statutEl) return` masquait la panne).
   Les deux formes sont désormais détectées. */
const besoin = [];
for (const m of js.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) besoin.push(m[1]);
for (const m of js.matchAll(/(?:^|[^.\w$])\$\(\s*["'`]([a-z][a-z0-9-]*)["'`]\s*\)/g)) besoin.push(m[1]);
const need = [...new Set(besoin)];
/* Ids créés DYNAMIQUEMENT par le JS : détectés automatiquement
   (`document.createElement(...)` puis `.id = '…'`), au lieu d'une liste
   manuelle quiothekait déjà un faux positif (`hud-fichier`). */
const dyn = new Set([
  'entrainement-exemples','entrainement-progres','entrainement-sujets','entrainement-web','entrainement-info','entrainement-lancer',
  'import-fichiers','bandeau-stockage',
]);
for (const m2 of js.matchAll(/\.id\s*=\s*["'`]([^"'`]+)["'`]/g)) dyn.add(m2[1]);
for (const m2 of js.matchAll(/\.id\s*=\s*["'`]([^"'`]*?)["'`]\s*\+\s*[A-Za-z_$][\w$]*/g)) dyn.add(m2[1] + '#suffixe');
/* Affectations par variable (`hud.id = CLE_HUD` avec `const CLE_HUD = 'hud-fichier'`)
   : on récupère les littéraux affectés à des constantes et on les accepte. */
for (const m2 of js.matchAll(/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*["'`]([a-z][a-z0-9-]{2,})["`]/gi)) dyn.add(m2[1]);
const missing = need.filter(i => !ids.includes(i) && !dyn.has(i));
console.log('JS needs=' + need.length + ' (dynamiques=' + dyn.size + ') MISSING=' + JSON.stringify(missing));
if (missing.length) signaler('id appele par le JS mais absent du HTML : ' + missing.join(', '));
const uiContract = ['side-nav', 'nav-projets', 'nav-artefacts', 'nav-code', 'nav-personnaliser', 'titre-conversation', 'partager', 'saisie-mirror', 'composeur-pied'];
const uiMissing = uiContract.filter(i => !ids.includes(i) && !h.includes('class="' + i) && !h.includes(' ' + i + '"') && !h.includes(i + ' '));
console.log('UI contract missing=' + JSON.stringify(uiMissing));
if (uiMissing.length) signaler('contrat UI manquant : ' + uiMissing.join(', '));

const needClasses = ['chat-shell', 'page-demo'];
for (const c of needClasses) console.log('class ' + c + ': ' + (h.includes('class="' + c) || h.includes(' ' + c + '"') || h.includes(c + ' ')));

const scripts = [...h.matchAll(/<script src="([^"]+)"/g)].map(x => x[1]);
console.log('scripts: ' + JSON.stringify(scripts));
for (const s of scripts) {
  const clean = s.replace(/\?[^*]*$/, '').replace('./', '');
  const f = path.join(dir, clean);
  const ok = fs.existsSync(f);
  console.log('  ' + s + ' exists=' + ok);
  if (!ok) signaler('script reference absent : ' + s);
}
const css = [...h.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(x => x[1]);
for (const s of css) {
  const clean = s.replace(/\?[^*]*$/, '').replace('./', '');
  const f = path.join(dir, clean);
  const ok = fs.existsSync(f);
  console.log('  css ' + s + ' exists=' + ok);
  if (!ok) signaler('feuille de style absente : ' + s);
  /* v20261007 (dh) : EQUILIBRE DES ACCOLADES.
     check.js ne lisait pas le CSS. Une édition qui tronque une règle (fermeture
     ou sélecteur suivant mangé) laissait des déclarations orphelines et le
     site perdait des styles — sans qu'aucun contrôle ne bronche, puisque le
     fichier existe et que le HTML reste valide. On compte la profondeur. */
  if (ok) {
    const texte = fs.readFileSync(f, 'utf8');
    let profondeur = 0, premierNégatif = 0, ligne = 1;
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i];
      if (c === '\n') ligne++;
      else if (c === '{') profondeur++;
      else if (c === '}') {
        profondeur--;
        if (profondeur < 0 && !premierNégatif) { premierNégatif = ligne; profondeur = 0; }
      }
    }
    const equilibre = profondeur === 0 && !premierNégatif;
    console.log('  css ' + s + ' accolades=' + (equilibre ? 'equilibrees' : 'DESEQUILIBREES (profondeur ' + profondeur + ', fermeture orpheline L' + premierNégatif + ')'));
    if (!equilibre) signaler('CSS desequilibre : ' + s + ' (accolades)');
  }
}
console.log(bloquants.length ? 'ECHEC : ' + bloquants.length + ' anomalie(s) bloquante(s)' : 'OK : aucune anomalie bloquante');
if (bloquants.length) process.exitCode = 1;
console.log('done');
