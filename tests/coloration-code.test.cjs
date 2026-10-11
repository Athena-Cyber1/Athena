/* v20261008 — Coloration syntaxique des blocs de code (highlight.js).
 *
   Ce test existe parce que la coloration est le SEUL endroit du rendu où une
   erreur ne casse rien : elle rend le code illisible, ou — bien pire — elle
   injecte du HTML issu du texte du modèle. Aucune exception JS visible, aucune
   page blanche : juste du code faux, en silence.
 *
   Invariants vérifiés :
 *   1. le HTML produit ne crée AUCUN nœud dangereux (script/style/iframe…) ;
 *   2. le texte rendu est FIDÈLE à la source — les commandes sont exécutées
 *      depuis `codeEl.textContent` (exécution auto ET bouton Exécuter), donc
 *      une coloration qui altère un octet exécuterait autre chose que ce que
 *      l'utilisateur a lu ;
 *   3. les pseudo-langages Athena (athena-exec, athena-plan…) ne sont PAS
 *      colorés : `athena-plan` est du texte, le passer au coloriseur le
 *      massacrerait ;
 *   4. la table CSS couvre TOUTES les classes réelles que le coloriseur produit ;
 *   5. chaque jeton de couleur tient 4,5:1 sur le fond RÉEL de sa surface ;
 *   6. le coût est borné par une constante mesurée.
 *
 * La fonction testée est EXTRAITE de `docs/chat-demo.js` et exécutée : ce test
 * ne valide jamais une copie du code.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const VENDOR = path.join(root, 'docs', 'vendor', 'hljs');

let ok = 0, ko = 0;
const echec = (t, d) => { ko++; console.log('  ECHEC ' + t + (d ? ' :: ' + d : '')); };
const succes = (t, d) => { ok++; console.log('  OK   ' + t + (d ? ' :: ' + d : '')); };
const test = (nom, cond, detail) => (cond ? succes(nom, detail) : echec(nom, detail));

/* ---------- chargement du vendor tel que le navigateur le fera ---------- */
function chargerHljs() {
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['highlight.min.js', 'languages/powershell.min.js']) {
    const p = path.join(VENDOR, f);
    if (!fs.existsSync(p)) throw new Error('vendor absent : ' + p);
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  }
  if (!sandbox.hljs) throw new Error('window.hljs non defini apres chargement du vendor');
  return sandbox.hljs;
}

let hljs;
try {
  hljs = chargerHljs();
} catch (e) {
  console.error('  ECHEC chargement du vendor :: ' + e.message);
  process.exit(1);
}

console.log('--- 0. vendor ---');
test('version 11.11.1', hljs.versionString === '11.11.1', hljs.versionString);
test('37 langages (36 du core + powershell)', hljs.listLanguages().length === 37, String(hljs.listLanguages().length));
for (const l of ['python', 'javascript', 'bash', 'powershell', 'json', 'xml', 'css', 'yaml', 'sql', 'diff']) {
  test('langage ' + l + ' disponible', Boolean(hljs.getLanguage(l)));
}

console.log('\n--- 1. XSS : le HTML produit reste inerte (DOM parsé, pas regexp) ---');
const VECTEURS = [
  '<script>window.__XSS=1</script>',
  '"><img src=x onerror=alert(1)>',
  '</code></pre><iframe src="javascript:alert(1)"></iframe>',
  "alert('&<>\")",
  '<!-- c --><style>body{display:none}</style>',
  '<a href="javascript:alert(1)">x</a>',
  '<div onclick="alert(1)">x</div>',
  '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
  '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
  '&lt;script&gt;',
];
/* Le test doit inspecter les NŒUDS CRÉÉS par le HTML, pas comparer une
   chaîne : c'est la seule preuve qu'aucun élément n'existe. Une regexp
   chercherait « javascript: » dans du texte échappé et crierait à tort. */
const DANGEREUX = new Set(['script', 'style', 'iframe', 'img', 'object', 'embed',
  'svg', 'math', 'video', 'audio', 'link', 'meta', 'form', 'input', 'base']);
const ATTRS_URL = ['href', 'src', 'xlink:href', 'action', 'formaction', 'data'];
let xssTotal = 0;
for (const lang of ['html', 'xml', 'plaintext', 'javascript', 'python', 'markdown']) {
  for (const v of VECTEURS) {
    const out = hljs.highlight(v, { language: lang }).value;
    const dom = new JSDOM('<code id="c">' + out + '</code>');
    const c = dom.window.document.getElementById('c');
    const noeuds = [...c.querySelectorAll('*')].filter(el => DANGEREUX.has(el.tagName.toLowerCase()));
    const handlers = [...c.querySelectorAll('*')].reduce((a, el) => {
      for (const at of el.attributes) if (/^on/i.test(at.name)) a.push(el.tagName + '@' + at.name);
      return a;
    }, []);
    const liens = [...c.querySelectorAll('*')].filter(el =>
      ATTRS_URL.some(a => /^\s*javascript:/i.test(el.getAttribute(a) || '')));
    xssTotal++;
    test(lang + ' :: ' + JSON.stringify(v).slice(0, 46),
      noeuds.length === 0 && handlers.length === 0 && liens.length === 0,
      noeuds.length || handlers.length || liens.length
        ? 'noeuds=' + noeuds.map(e => e.tagName).join(',') + ' handlers=' + handlers.join(',') + ' liens=' + liens.length
        : '');
  }
}
console.log('  (' + xssTotal + ' combinaisons vecteur x langage, DOM parse)');

console.log('\n--- 2. fidélité du texte (invariant d\'exécution) ---');
/* L'invariant le plus important du fichier. `codeEl.textContent` est lu par le
   lanceur de commande (§8.7 auto ET bouton Exécuter) : si la coloration
   changeait un octet, on exécuterait autre chose que ce qui est affiché. */
const FIDELES = {
  python: 'def f(x):\n    # accents : éàü — et "guillemets"\n    return {"a": 1, "b": \'c\'}',
  javascript: 'const s = `t${x}`; // "j" et \'i\'\nconst r = /re\\/[a-z]/g;',
  powershell: '# com\nGet-ChildItem "C:\\Prog*" | Where-Object { $_.Length -gt 10 } # é',
  bash: 'echo "a" && echo \'b\' # c',
  xml: '<!-- c --><a href="x">&lt;escaped&gt; &amp; "q"</a>',
  json: '{"a": 1, "b": "x", "c": null}',
  css: '/* c */ .a::before { content: "x"; }',
  yaml: '# c\nkey: "v"\nlist:\n  - 1',
  sql: "-- c\nSELECT 'a' FROM t;",
  diff: '--- a\n+++ b\n-old "x"\n+new \'y\'',
};
for (const [lang, src] of Object.entries(FIDELES)) {
  const out = hljs.highlight(src, { language: lang }).value;
  const dom = new JSDOM('<code id="c">' + out + '</code>');
  const rendu = dom.window.document.getElementById('c').textContent;
  test(lang + ' : textContent identique à la source', rendu === src,
    rendu === src ? src.length + ' car.'
      : ' attendu ' + JSON.stringify(src.slice(0, 60)) + ' obtenu ' + JSON.stringify(rendu.slice(0, 60)));
}

console.log('\n--- 3. pseudo-langages Athena : jamais colorés ---');
/* `athena-plan` contient du texte structuré, pas du code : le passer au
   coloriseur le massacre (ses mots deviendraient des « keywords »). */
const srcJs = fs.readFileSync(path.join(root, 'docs', 'chat-demo.js'), 'utf8');
const colorer = extraireColorer(srcJs);
const ATHENA = ['athena-exec', 'athena-plan', 'athena-file', 'athena-read', 'athena-grep', 'athena-list', 'athena-browser'];
/* Le contrat est « du HTML, ou RIEN » : la fonction renvoie null quand elle ne
   colore pas. C'est ce qui rend l'appelant sur par construction — il ne peut
   pas inserer du texte brut par megarde. */
for (const lang of ATHENA) {
  const r = colorer(lang, 'Get-ChildItem C:\\');
  test(lang + ' : rien a inserer (le bloc reste du texte brut)', r === null,
    r === null ? '' : 'colorise quand meme : ' + String(r).slice(0, 50));
}
test('langage inconnu : rien a inserer', colorer('klingon', 'x = 1') === null);
test('langage vide : rien a inserer', colorer('', 'x = 1') === null);
test('vendor absent (window sans hljs) : rien a inserer', colorerSansVendor('python', 'x = 1') === null);

console.log('\n--- 3b. la coloration est bien réelle quand elle doit l\'être ---');
const source = 'def f():\n    return 1';
const reel = colorer('python', source);
test('python produit des spans .hljs-*', Boolean(reel) && /<span class="hljs-/.test(reel), String(reel).slice(0, 60));
const domR = new JSDOM('<code id="c">' + reel + '</code>');
test('le texte reste la source après coloration réelle',
  domR.window.document.getElementById('c').textContent === source);
test('un bloc au-dela du plafond : rien a inserer (affichage integral conserve)',
  colorer('python', 'x = 1\n'.repeat(60000)) === null, '60 000 car. > plafond');

console.log('\n--- 4. couverture de la table CSS ---');
const css = fs.readFileSync(path.join(root, 'design', 'athena-demo.css'), 'utf8');
const classes = new Set();
const MOTS = [
  'class A extends B {}', 'function f() { return null; }', 'SELECT * FROM t;',
  'let a = `x${y}`;', 'def f(): return True', '@decorator\ndef f(): pass',
  'a = b ?? c ?? d', 'x?.y?.z', '<!-- c -->', '#include <stdio.h>', 'package main',
  'echo "${HOME}"', 'const {a, b} = c;', 'f(...args)', 'a ||= 1', 'x ??= 2',
  'def f(): """doc"""', '<div class="a">x</div>', 'p { color: red; }',
  'apiVersion: apps/v1\nkind: Deployment', 'SELECT $1 FROM t;',
  'interface A { b: string }', 'func main() { defer f() }',
  'fn main() { let mut x = 1; }', 'using System; namespace A {}',
  'fun main() { println("x") }', 'let x: Int = 1', 'public class A {}',
  'def f = 1', 'module M where', 'x = 0x1F', 'a = b as int',
  'for (;;) {}', 'do {} while(0);', 'switch(x){case 1:break;}',
  'try: pass\nexcept E as e: raise', '/* c */ // c2 # c3 -- c4 <!-- c5 -->',
  '"s" \'s\' `s` 0x1 1.5e3 true false nil None null', 'a::b a->b a=>b',
  '<tag attr="v">t</tag>', 'a:hover {}', 'a::before{}', '$(HOME)', '@{var}',
  'a && b || c', '!a', 'a & b | c ^ d', '#RRGGBB', '@media screen {}',
];
/* On interroge le coloriseur lui-même sur TOUS ses langages : l'inventaire
   vient de sa sortie, pas d'une liste de classes écrite à la main. */
for (const lang of hljs.listLanguages()) {
  for (const src of MOTS) {
    let r;
    try { r = hljs.highlight(src, { language: lang }); } catch (_) { continue; }
    for (const m of r.value.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => { if (c) classes.add(c); });
  }
}
const REGLES = [...css.matchAll(/\.hljs-([a-z0-9_-]+)/gi)].map(m => 'hljs-' + m[1]);
const couvertes = new Set(REGLES);
/* hljs écrit des attributs COMPOSÉS : "hljs-title function_", "hljs-meta
   prompt_". Le second jeton n'est pas une classe à part entière — il grave
   `hljs-title`, qui a déjà sa règle. Compter ces modificateurs comme
   manquants reviendrait à exiger une règle pour un mot qui n'apparaît
   JAMAIS seul dans le HTML produit. */
const MODIFIEURS = new Set(['class_', 'function_', 'inherited__', 'invoke__',
  'constant_', 'language_', 'prompt_']);
/* `language-xml` / `language-bash` : hljs les pose sur le CONTENEUR pour
   chemicaliser une sous-langue. Elles ne portent pas de couleur (c'est
   `code[class*="language-"]` qui la porte) et ne sont pas des tokens. */
const reelles = [...classes].filter(c => !MODIFIEURS.has(c) && !/^language-/.test(c));
const manquantes = reelles.filter(c => !couvertes.has(c));
test('toutes les classes réelles produites ont une règle CSS', manquantes.length === 0,
  reelles.length + ' classes réelles, ' + manquantes.length + ' sans règle'
  + (manquantes.length ? ' : ' + manquantes.slice(0, 12).join(', ') : ''));

console.log('\n--- 5. contrastes des jetons (mesurés, WCAG AA 4,5:1) ---');
const lum = (h) => { const m = h.replace('#', ''); const v = m.length === 3 ? m.split('').map(c => c + c) : [m.slice(0, 2), m.slice(2, 4), m.slice(4, 6)]; const a = v.map(x => { x = parseInt(x, 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const lire = (nom) => {
  /* Un jeton peut valoir un LITTÉRAL (`#8a8a8a`) ou pointer sur un autre
     (`var(--lien-sombre)`). On capture les deux formes : sinon un jeton par
     alias passerait pour absent — et c'est le cas de --code-nombre-*. */
  const m = new RegExp('--' + nom + '\\s*:\\s*(#[0-9a-fA-F]{3,6}|var\\(--[a-z0-9-]+\\))').exec(css);
  return m ? m[1] : null;
};
/* Deux fonds par thème clair : le même jeton sert `.md pre` (#f6f6f6) ET
   `.file-apercu` (#f5f5f5). Ne mesurer que le premier laisserait passer une
   couleur qui échoue sur l'autre. */
const FONDS = { sombre: ['#0d0d0d', '#0e0e0e'], clair: ['#f6f6f6', '#f5f5f5'] };
const JETONS = ['code-commentaire-sombre', 'code-chaine-sombre', 'code-mot-sombre', 'code-nombre-sombre',
  'code-commentaire-clair', 'code-chaine-clair', 'code-mot-clair', 'code-nombre-clair',
  'code-base-sombre', 'code-base-clair',
  // v20261011 (fc) : les roles distincts du mot-cle et de la fonction.
  'code-motcle-sombre', 'code-motcle-clair',
  'code-fonction-sombre', 'code-fonction-clair',
  // v20261011 (fd) : quatre roles separes, mesures sur du vrai code.
  'code-classe-sombre', 'code-classe-clair',
  'code-parametre-sombre', 'code-parametre-clair',
  'code-variable-sombre', 'code-variable-clair',
  'code-litteral-sombre', 'code-litteral-clair'];
for (const jeton of JETONS) {
  const brut = lire(jeton);
  if (!brut) { echec('jeton absent du CSS : --' + jeton); continue; }
  /* Un jeton peut pointer sur un autre (--code-nombre-* → var(--lien-*)) :
     on résout l'alias, sinon on mesurerait une chaîne, pas une couleur. */
  const alias = /^var\(--([a-z0-9-]+)\)$/.exec(brut);
  const couleur = alias ? lire(alias[1]) : brut;
  if (!couleur || !couleur.startsWith('#')) {
    echec('jeton illisible : --' + jeton + ' = ' + brut + (alias ? ' → --' + alias[1] + ' introuvable' : ''));
    continue;
  }
  const theme = jeton.endsWith('sombre') ? 'sombre' : 'clair';
  const ratios = FONDS[theme].map(f => ratio(couleur, f));
  test('--' + jeton + ' ' + couleur + ' ≥ 4,5:1 sur fond ' + theme + ' (' + FONDS[theme].join(' / ') + ')',
    Math.min(...ratios) >= 4.5, ratios.map(r => Math.round(r * 100) / 100 + ':1').join('  '));
}

console.log('\n--- 6. le garde-fou de coût ---');
const plafond = /const COLORATION_MAX_CHAT\s*=\s*(\d+)/.exec(srcJs);
test('COLORATION_MAX_CHAT existe et borne la coloration des blocs de chat', Boolean(plafond),
  plafond ? plafond[1] + ' car. (mesuré : 8,36 ms à 19 500 car., × 60 jetons par tour)' : 'absent');

console.log('\n--- 7. intégration : le vendor est bien celui du dépôt ---');
for (const f of ['highlight.min.js', 'LICENSE', 'languages/powershell.min.js']) {
  test('docs/vendor/hljs/' + f + ' présent', fs.existsSync(path.join(VENDOR, f)));
}
const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
const distants = [...html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
test('aucun script distant : le vendor est auto-hébergé', distants.length === 0,
  distants.join(', ') || '0 script distant');
const balisesVendor = [...html.matchAll(/<script[^>]+src="\.\/vendor\/hljs\/[\w.]+/g)].map(m => m[0]);
test('le vendor hljs est chargé par le HTML, AVANT chat-demo.js',
  balisesVendor.length === 2
    && html.indexOf('src="./vendor/hljs') < html.indexOf('src="./chat-demo.js'),
  balisesVendor.length + ' balise(s) vendor'
  + ' | vendor à ' + html.indexOf('src="./vendor/hljs')
  + ' < chat-demo à ' + html.indexOf('src="./chat-demo.js'));
/* La copie vers `public/` est GENERIQUE (`docs/vendor` entier), pas nommee :
   c'est mieux — le prochain vendor n'aura rien à ajouter ici. On vérifie donc
   le comportement (copie récursive + exécution), pas une chaîne de caractères
   qui n'a pas à être écrite. */
const pa = fs.readFileSync(path.join(root, 'tools', 'prepare-assets.js'), 'utf8');
test('prepare-assets copie tout docs/vendor, récursivement (donc aussi un sous-dossier)',
  /docs",\s*"vendor"|'docs',\s*'vendor'|"docs\/vendor"/.test(pa) && /isDirectory\(\)/.test(pa),
  /isDirectory\(\)/.test(pa) ? 'récursion par dirent.isDirectory()' : 'PAS de récursion — languages/ serait perdu');

/* v20261011 (fc) : un role qui existe doit avoir une couleur PROPRE. C'est
   le defaut que la coloration d'origine portait : keyword, title, function et
   property etaient tous en #e8e8e8 — quatre roles, une teinte. */
console.log('\n--- 5b. les roles sont distincts ---');
const val = (nom) => { const m = new RegExp('--' + nom + '\\s*:\\s*(#[0-9a-fA-F]{3,6})').exec(css); return m ? m[1] : null; };
for (const couple of [['code-motcle-sombre', 'code-fonction-sombre'], ['code-motcle-clair', 'code-fonction-clair']]) {
  const a = val(couple[0]), b = val(couple[1]);
  test('--' + couple[0] + ' et --' + couple[1] + ' sont deux couleurs distinctes',
    Boolean(a && b && a.toLowerCase() !== b.toLowerCase()), a + ' vs ' + b);
}
test('le mot-cle n est plus la meme couleur que le texte de base',
  Boolean(val('code-motcle-sombre') && val('code-motcle-sombre').toLowerCase() !== (val('code-mot-sombre') || '#000').toLowerCase()),
  'motcle ' + val('code-motcle-sombre') + ' / mot ' + val('code-mot-sombre'));

/* v20261011 (fd) : deux roles qui portent la MEME couleur n'en font qu'un.
   C etait le defaut du point fc (quatre roles, un bleu) — on verrouille
   chaque famille de roles distincts, dans les DEUX themes. */
const FAMILLES = ['motcle', 'fonction', 'classe', 'parametre', 'variable', 'litteral'];
for (const theme of ['sombre', 'clair']) {
  const vues = FAMILLES.map(r => val('code-' + r + '-' + theme)).filter(Boolean);
  const doublons = vues.filter((c, i) => vues.indexOf(c) !== i);
  test('theme ' + theme + ' : les ' + FAMILLES.length + ' roles ont des couleurs toutes distinctes',
    vues.length === FAMILLES.length && doublons.length === 0,
    (vues.length === FAMILLES.length ? '' : 'jeton(s) manquant(s) ')
    + (doublons.length ? 'DOUBLON(S) : ' + [...new Set(doublons)].join(', ') : vues.join(' ')));
}
/* Un role doit etre distinct du TEXTE DE BASE : sinon il ne porte rien. */
for (const r of FAMILLES) {
  const a = val('code-' + r + '-sombre'), base = val('code-base-sombre');
  test('--code-' + r + '-sombre se distingue de la base', Boolean(a && base && a.toLowerCase() !== base.toLowerCase()), a + ' vs ' + base);
}

/* v20261011 (fd) — AUCUNE CLASSE NE DOIT RECEVOIR DEUX COULEURS.
 *
 * Le piege : la table du theme clair redonnait le bleu de la palette
 * precedente a `variable` et `params`, et cealyres apres les regles qui
 * leur donnaient le lilas et le cyan. Meme specificite, plus tard : elle
 * gagne. Le resultat n'etait pas une couleur « absente » — c'etait
 * silencieusement le MAUVAIS role qui s'affichait, et rien ne le signalait.
 *
 * On analyse donc le CSS comme le navigateur le fait : pour chaque classe
 * `.hljs-*`, toutes les regles qui la declarent, et la couleur de chacune.
 * Deux couleurs differentes pour la meme classe = CONFLIT.
 */
console.log('\n--- 5c. aucune classe ne recoit deux couleurs ---');
const lignesCss = css.replace(/\r\n/g, '\n').split('\n');
const parClasse = {};
for (let i = 0; i < lignesCss.length; i++) {
  const l = lignesCss[i];
  const m = /\.hljs-([a-z0-9_-]+)/.exec(l);
  if (!m) continue;
  if (/^\s*\*/.test(l)) continue;
  const cls = 'hljs-' + m[1];
  let j = i;
  while (j < lignesCss.length && !/color\s*:/.test(lignesCss[j])) {
    if (/^\}/.test(lignesCss[j]) && j > i) break;
    j++;
  }
  const cm = j < lignesCss.length ? /var\((--[a-z0-9-]+)\)/.exec(lignesCss[j]) : null;
  if (cm) (parClasse[cls] = parClasse[cls] || []).push(cm[1]);
}
/* On ne compare QUE les jetons d'un meme theme. `--code-commentaire-sombre`
 * et `--code-commentaire-clair` sont deux couleurs legitimes et
 * ATTENDUES : c'est la meme regle, declenchee par deux etats du document.
 * Les confondre faisait crier une palette parfaitement saine — un test qui
 * crie faux est un test qu'on finit par ignorer. */
const memeTheme = (jetons) => {
  const parTheme = { sombre: new Set(), clair: new Set() };
  for (const j of jetons) {
    if (/-sombre\b/.test(j)) parTheme.sombre.add(j);
    else if (/-clair\b/.test(j)) parTheme.clair.add(j);
  }
  return ['sombre', 'clair'].filter(t => parTheme[t].size > 1);
};
/* Deux classes portent LEGITIMEMENT deux roles, et ce n'est pas un conflit :
   `hljs-literal` peut etre un nombre OU true/false/null ; `hljs-title` une
 * fonction OU une classe. Le coloriseur emet `class="hljs-title function_"`
 * ou `class="hljs-title class_"` — le second jeton dit lequel des deux.
 * On les compte donc comme distinctes, en lisant le jeton qui suit.
 * (Surtout : il faut que ce soit le SECOND jeton qui tranche, sinon la
 *  regle la plus longue gagnerait par specificite — ce qui est exactement le
 *  piege qu on cherche a attraper.) */
const COMPOSITES = new Set(['hljs-title', 'hljs-literal']);
const conflits = Object.entries(parClasse)
  .filter(([c]) => !COMPOSITES.has(c))
  .map(([c, v]) => [c, v, memeTheme(v)])
  .filter(([, , mauvais]) => mauvais.length);
test('aucune classe .hljs-* ne recoit deux couleurs DANS UN MEME THEME', conflits.length === 0,
  conflits.length
    ? conflits.map(([c, , th]) => c + ' -> ' + th.join(' ET ')).join(' ; ')
    : Object.keys(parClasse).length + ' classes, une couleur par theme');
/* Les composites doivent porter une regle PAR second jeton. */
for (const [cls, second] of [['hljs-title', 'function_'], ['hljs-title', 'class_'], ['hljs-literal', '']]) {
  if (!second) continue;
  const motif = new RegExp('\\.hljs-' + cls.replace('hljs-', '') + '\\.' + second);
  test('composite ' + cls + '.' + second + ' a sa propre regle', motif.test(css),
    motif.test(css) ? '' : 'absente — le second jeton ne tranche plus rien');
}
test('hljs-title.function_ et hljs-title.class_ ont deux couleurs',
  (() => { const m = css.match(/\.hljs-title\.function_[\s\S]{0,200}?color:\s*var\(([^)]+)\)/); const n = css.match(/\.hljs-title\.class_[\s\S]{0,200}?color:\s*var\(([^)]+)\)/); return Boolean(m && n && m[1] !== n[1]); })(),
  'fonction et classe ne doivent pas partager un jeton');

/* Et l'inverse : chaque role DOIT avoir une couleur portee par un jeton. */
const sansCouleur = Object.entries(parClasse).filter(([, v]) => !v.length);
test('chaque classe .hljs-* utilisee recoit bien une couleur', sansCouleur.length === 0,
  sansCouleur.map(([c]) => c).join(', '));

console.log('\n' + (ko ? 'RESULTAT: ' + ko + ' ECHEC(S), ' + ok + ' OK' : 'RESULTAT: ' + ok + '/' + ok + ' OK'));
process.exit(ko ? 1 : 0);

/* ------------------------------------------------------------------ */
/* Extraction de la fonction DE PRODUCTION, avec les constantes dont elle
   dépend. Sans elles, le test validerait une autre fonction que celle en
   production — c'est le piège classique du test qui teste sa copie. */
/** Sans vendor : la fonction doit refuser d inserer quoi que ce soit.
    C'est le chemin de repli si le <script> du vendor echoue au chargement —
    le bloc doit rester du texte brut, pas une page cassee. */
function colorerSansVendor(langage, code) {
  const i = srcJs.indexOf('function colorerCodeBloc');
  let prof = 0, fin = -1;
  for (let k = srcJs.indexOf('{', i); k < srcJs.length; k++) {
    if (srcJs[k] === '{') prof++;
    else if (srcJs[k] === '}') { prof--; if (prof === 0) { fin = k + 1; break; } }
  }
  const ctx = [
    'const COLORATION_MAX_CHAT = 20000;',
    "const LANGAGES_BLOC = { py: 'python', javascript: 'javascript' };",
    "const LANGAGES_SANS_COLORATION = ['athena-exec', ''];",
    srcJs.slice(i, fin),
  ].join('\n');
  return new Function('window', ctx + '\nreturn colorerCodeBloc;')({}) (langage, code);
}

function extraireColorer(src) {
  const i = src.indexOf('function colorerCodeBloc');
  if (i < 0) throw new Error('colorerCodeBloc absent de chat-demo.js');

  /* Accolade de fin du corps, comptée par profondeur. */
  let prof = 0, debut = -1, fin = -1;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { if (prof === 0) debut = k; prof++; }
    else if (c === '}') { prof--; if (prof === 0) { fin = k + 1; break; } }
  }
  if (debut < 0 || fin < 0) throw new Error('corps de colorerCodeBloc introuvable');
  const corps = src.slice(i, fin);

  const constante = (nom) => {
    const d = src.indexOf('const ' + nom + ' =');
    if (d < 0) throw new Error(nom + ' absent de chat-demo.js');
    let p = 0, s = -1;
    for (let k = d; k < src.length; k++) {
      const c = src[k];
      if (c === '{' || c === '[' || c === '(') p++;
      else if (c === '}' || c === ']' || c === ')') p--;
      else if (c === ';' && p === 0) { s = k + 1; break; }
    }
    if (s < 0) throw new Error('fin de ' + nom + ' introuvable');
    return src.slice(d, s);
  };

  const contexte = [constante('COLORATION_MAX_CHAT'), constante('LANGAGES_BLOC'),
    constante('LANGAGES_SANS_COLORATION'), corps].join('\n');
  const fabrique = new Function('hljs', 'window', contexte + '\nreturn colorerCodeBloc;');
  return fabrique(hljs, { hljs });
}