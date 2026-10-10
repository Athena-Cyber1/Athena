/* tests/gras-code.test.cjs — v20261007 (et)
 * ------------------------------------------------------------------
 * GRAS ET ITALIQUE AUTOUR DES SEGMENTS DE CODE.
 *
 * Le texte était découpé sur les segments `code` AVANT le traitement du gras.
 * Un `**` qui englobe du code était donc coupé en deux morceaux, et aucun des
 * deux ne formait une paire de `**` : le gras disparaissait sans bruit.
 *
 * Correction : les segments de code sont retirés derrière un jeton AVANT toute
 * mise en forme, puis restaurés à la fin. Le gras et l'italique portent donc
 * sur la chaîne entière.
 *
 * Même chargement que tests/xss-markdown.test.cjs : JSDOM complet, puis
 * `w.eval` du fichier de l'application. Aucune fonction n'est re-déclarée ici —
 * ce serait un doublon de la source, donc un test qui ne teste pas l'application.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
let echecs = 0;
const V = (ok, txt, det) => {
  console.log((ok ? '  OK  ' : '  ECHEC  ') + txt + (det ? ' :: ' + det : ''));
  if (!ok) echecs++;
};

const html = fs.readFileSync(path.join(REPO, 'docs', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window;
w.localStorage.setItem('chat-preferences', JSON.stringify({
  executionAuto: false, raisonnementVisible: false, defilementAuto: false,
  outilsWeb: true, confirmationEnvoi: false,
}));
if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!w.IntersectionObserver) w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!w.HTMLElement.prototype.scrollIntoView) w.HTMLElement.prototype.scrollIntoView = function () {};
w.scrollTo = () => {};
w.fetch = () => Promise.reject(new Error('reseau interdit dans ce test'));
w.eval(fs.readFileSync(path.join(REPO, 'docs', 'chat-demo.js'), 'utf8'));

V(typeof w.markdownInline === 'function', 'markdownInline exposee', typeof w.markdownInline);

/* Analyse SÛRE : on injecte dans un conteneur détaché et on interroge le DOM.
   Une balise échappée reste du texte ; une balade réelle deviendrait un nœud —
   c'est exactement ce qu'on veut détecter. */
function rendre(src) {
  const hote = w.document.createElement('div');
  hote.innerHTML = w.markdownInline(src);
  return {
    strong: [...hote.querySelectorAll('strong')].map((n) => n.textContent),
    em: [...hote.querySelectorAll('em')].map((n) => n.textContent),
    code: [...hote.querySelectorAll('code')].map((n) => n.textContent),
    html: hote.innerHTML,
  };
}

let n = 0;

/* Les cas demandés, plus les voisins qui verrouillent la regex. */
const CAS = [
  ['**fichier**', ['fichier'], [], [], '**fichier** : gras simple'],
  ['**a * b**', ['a * b'], [], [], '**a * b** : un * isolé ne casse pas le gras'],
  ['**nom `du code`**', ['nom du code'], [], ['du code'],
    '**nom `du code`** : le gras TRAVERSE un segment de code'],
  ['**code `x` dans du gras**', ['code x dans du gras'], [], ['x'],
    '**code `x` dans du gras** : segment au milieu'],
  ['*italic*', [], ['italic'], [], '*italic* : italique simple'],
  ['texte **gras** puis *ital*', ['gras'], ['ital'], [],
    'mixte : gras et italique dans la même chaîne'],
  ['**première** et **deuxième**', ['première', 'deuxième'], [], [],
    'deux gras distincts ne se fusionnent pas'],
  ['`du code` seul', [], [], ['du code'], 'un segment code seul reste un code'],
];

for (const [src, strong, em, code, label] of CAS) {
  const r = rendre(src);
  const ok = JSON.stringify(r.strong) === JSON.stringify(strong) &&
    JSON.stringify(r.em) === JSON.stringify(em) &&
    JSON.stringify(r.code) === JSON.stringify(code);
  V(ok, label, ok ? '' :
    'strong=' + JSON.stringify(r.strong) + ' em=' + JSON.stringify(r.em) +
    ' code=' + JSON.stringify(r.code) + ' html=' + r.html.slice(0, 90));
  n++;
}

/* Un `**` orphelin reste du texte littéral : on ne fabrique pas de balise
   autour d'une saisie brute. */
const orphelin = rendre('** orphelin');
V(orphelin.strong.length === 0 && orphelin.html === '** orphelin',
  '** orphelin : laisse tel quel', orphelin.html.slice(0, 60));
n++;

const seul = rendre('un ** seul');
V(seul.strong.length === 0 && seul.html === 'un ** seul',
  'un ** seul : laisse tel quel', seul.html.slice(0, 60));
n++;

/* Le segment code survit au gras, et son `&` n'est pas double-échappé. */
const echap = rendre('`a & b`');
V(echap.code.length === 1 && echap.code[0] === 'a & b',
  'un segment code reste intact', JSON.stringify(echap.code));
n++;

/* Le gras ne doit pas traverser un saut de ligne : `**a\nb**` reste brut. */
const multiligne = rendre('**a\nb**');
V(multiligne.strong.length === 0,
  'un gras ne traverse pas un saut de ligne', JSON.stringify(multiligne.strong));
n++;

/* Le contournement reste fermé : la nouvelle passe ne réintroduit pas de HTML. */
const xss = rendre('**<img src=x onerror=alert(1)>**');
V(xss.strong.length === 1 && xss.html.indexOf('<img') === -1,
  'un gras autour de HTML : echappe, aucun <img>', xss.html.slice(0, 90));
n++;

console.log(echecs
  ? `  RESULTAT: ${echecs} ECHEC(S) sur ${n}`
  : `  RESULTAT: ${n}/${n} OK`);
process.exit(echecs ? 1 : 0);