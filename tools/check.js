const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'docs');
const h = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
let m, stack = [], errs = [];
while ((m = re.exec(h))) {
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

const ids = [...h.matchAll(/id="([^"]+)"/g)].map(x => x[1]);
console.log('ids=' + ids.length + ' dups=' + JSON.stringify([...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))]));

const js = fs.readFileSync(path.join(dir, 'chat-demo.js'), 'utf8');
const need = [...new Set([...js.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(x => x[1]))];
// les entrainement-* sont créés dynamiquement par le JS (cf. page.tsx)
const dyn = new Set(['entrainement-exemples','entrainement-progres','entrainement-sujets','entrainement-web','entrainement-info','entrainement-lancer','import-fichiers','bandeau-stockage']);
const missing = need.filter(i => !ids.includes(i) && !dyn.has(i));
console.log('JS needs=' + need.length + ' MISSING=' + JSON.stringify(missing));
const uiContract = ['side-nav', 'nav-projets', 'nav-artefacts', 'nav-code', 'nav-personnaliser', 'titre-conversation', 'partager', 'saisie-mirror', 'composeur-pied'];
const uiMissing = uiContract.filter(i => !ids.includes(i) && !h.includes('class="' + i) && !h.includes(' ' + i + '"') && !h.includes(i + ' '));
console.log('UI contract missing=' + JSON.stringify(uiMissing));

const needClasses = ['chat-shell', 'page-demo'];
for (const c of needClasses) console.log('class ' + c + ': ' + (h.includes('class="' + c) || h.includes(' ' + c + '"') || h.includes(c + ' ')));

const scripts = [...h.matchAll(/<script src="([^"]+)"/g)].map(x => x[1]);
console.log('scripts: ' + JSON.stringify(scripts));
for (const s of scripts) {
  const clean = s.replace(/\?[^*]*$/, '').replace('./', '');
  const f = path.join(dir, clean);
  console.log('  ' + s + ' exists=' + fs.existsSync(f));
}
const css = [...h.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(x => x[1]);
for (const s of css) {
  const clean = s.replace(/\?[^*]*$/, '').replace('./', '');
  const f = path.join(dir, clean);
  console.log('  css ' + s + ' exists=' + fs.existsSync(f));
}
console.log('done');
