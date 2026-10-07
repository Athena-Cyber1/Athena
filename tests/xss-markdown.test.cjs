/* tests/xss-markdown.test.cjs — v20261007 (ajout §8.8)
   ------------------------------------------------------------------
   NON-RÉGRESSION SANITISATION MARKDOWN.

   Le rendu des réponses du modèle passe par markdownInline →
   echapperHtml → decoderEntites → liens limités à https?://. Le
   sanitization est CORRECT (vérifié à l'audit 2026-10-07) mais n'était
   couvert par AUCUN test : la moindre évolution du parseur (support
   d'images, nouveau raccourci, nouvelle cible de lien) pouvait rouvrir
   une XSS sans qu'aucun signal ne tire.

   CONTRAT RÉEL vérifié ici (et non un contrat supposé) :
   - le HTML brut du modèle est ÉCHAPPÉ (rendu en texte) ;
   - seuls les liens http(s) absolus deviennent des <a> ;
   - les autres formes (relatives, javascript:, data:) restent du TEXTE
     littéral — donc inertes.

   Les assertions portent sur le DOM APRÈS PARSING (c'est le seul
   endroit où une XSS existe réellement), jamais sur la chaîne HTML
   brute : `&lt;img onerror=…&gt;` est inerte, et un test par regex
   la.signalait à tort comme une faille. */
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

V(typeof w.markdownInline === 'function', 'markdownInline exposée (sanitizer testable)',
  typeof w.markdownInline);

/* Analyse SÛRE : on injecte dans un conteneur détaché du document vivant et on
   interroge le DOM. Une balise échappée reste du texte ; une balade réelle
   deviendrait un nœud — c'est exactement ce qu'on veut détecter. */
function analyser(source) {
  const hote = w.document.createElement('div');
  hote.innerHTML = w.markdownInline(source);
  const coupables = [];
  ['script', 'iframe', 'object', 'embed', 'meta', 'base', 'svg', 'img', 'form', 'style', 'link'].forEach((balise) => {
    if (hote.querySelector(balise)) coupables.push('<' + balise + '>');
  });
  hote.querySelectorAll('*').forEach((el) => {
    for (let i = 0; i < el.attributes.length; i += 1) {
      const a = el.attributes[i];
      if (/^on/i.test(a.name)) coupables.push(balise2(el) + '@' + a.name);
      if (/^(href|src|action|formaction|xlink:href)$/i.test(a.name)
        && /^\s*(javascript|vbscript|data):/i.test(a.value)) {
        coupables.push(balise2(el) + '@' + a.name + '=' + a.value.slice(0, 24));
      }
    }
  });
  return { coupables, texte: hote.textContent, html: hote.innerHTML };
}
function balise2(el) { return el.tagName.toLowerCase(); }

const VECTEURS = [
  ['script inline', '<script>window.__XSS1 = 1;</script>'],
  ['img onerror', '<img src=x onerror="window.__XSS2=1">'],
  ['svg onload', '<svg onload="window.__XSS3=1"></svg>'],
  ['iframe javascript:', '<iframe src="javascript:window.__XSS4=1"></iframe>'],
  ['lien javascript:', '[clic](javascript:window.__XSS5=1)'],
  ['lien data:text/html', '[clic](data:text/html;base64,PHNjcmlwdD4x)'],
  ['guillemets dans URL', '[x](https://a.test/" onmouseover="window.__XSS6=1)'],
  ['entité HTML', '&lt;script&gt;window.__XSS7=1&lt;/script&gt;'],
  ['event sur strong', '<strong onmouseover="window.__XSS8=1">gras</strong>'],
  ['event sur li', '- <li onfocus="window.__XSS9=1" autofocus>x</li>'],
  ['style expression', '<span style="background:url(javascript:window.__XSS10=1)">x</span>'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:window.__XSS11=1">'],
  ['attribut sans guillemets', '<img src=x onerror=window.__XSS12=1>'],
  ['base tag', '<base href="javascript:window.__XSS13=1//">'],
  ['objet data:', '<object data="javascript:window.__XSS14=1"></object>'],
];

for (const [nom, vecteur] of VECTEURS) {
  const r = analyser(vecteur);
  V(r.coupables.length === 0, 'vecteur neutralisé : ' + nom,
    r.coupables.length ? r.coupables.join(',') : r.html.slice(0, 70));
}

/* --- Aucune exécution de JS --------------------------------------------- */
V(!w.__XSS1 && !w.__XSS2 && !w.__XSS3 && !w.__XSS4 && !w.__XSS5 && !w.__XSS6
  && !w.__XSS7 && !w.__XSS8 && !w.__XSS9 && !w.__XSS10 && !w.__XSS11
  && !w.__XSS12 && !w.__XSS13 && !w.__XSS14, 'aucun script exécuté pendant le rendu',
  Object.keys(w).filter((k) => k.indexOf('__XSS') === 0).join(',') || 'aucun marqueur');

/* --- Le contenu lisible survit ------------------------------------------- */
const garde = analyser('**gras** et `code` : <script>x</script> fin');
V(/<strong>gras<\/strong>/.test(garde.html), 'le markdown légitime survit (gras)',
  garde.html.slice(0, 80));
V(/<code>code<\/code>/.test(garde.html), 'l\'inline code survit', garde.html.slice(0, 80));
V(/fin/.test(garde.texte) && /gras/.test(garde.texte), 'le texte reste lisible',
  garde.texte.slice(0, 80));

/* --- Liens : https devient une ancre, le reste reste du texte ------------ */
const lienSain = analyser('[doc](https://exemple.test/page?a=1&b=2)');
V(/href="https:\/\/exemple\.test\/page\?a=1&amp;b=2"/.test(lienSain.html)
  && lienSain.html.indexOf('rel="noopener noreferrer"') >= 0,
  'lien https accepté, & échappé, rel=noopener', lienSain.html.slice(0, 110));

const lienRelatif = analyser('[interne](/fichiers/a.txt)');
V(!/href=/.test(lienRelatif.html), 'lien relatif : PAS d\'ancre (reste du texte)',
  lienRelatif.html.slice(0, 70));

const lienJs = analyser('[x](javascript:alert(1))');
V(!/href=/.test(lienJs.html) && /javascript:/.test(lienJs.texte),
  'lien javascript : PAS d\'ancre, texte visible (contrat actuel)',
  lienJs.html.slice(0, 70));

/* --- Rendu COMPLET (formater) ------------------------------------------- */
const zone = w.document.createElement('div');
zone.appendChild(w.formater('Salut <b onclick="window.__XSSF=1">clic</b> [x](javascript:1)'));
const zoneAnalysée = (() => {
  const hote = w.document.createElement('div');
  hote.innerHTML = zone.innerHTML;
  const coupables = [];
  hote.querySelectorAll('*').forEach((el) => {
    for (let i = 0; i < el.attributes.length; i += 1) {
      if (/^on/i.test(el.attributes[i].name)) coupables.push(el.tagName + '@' + el.attributes[i].name);
    }
  });
  ['script', 'iframe', 'object', 'meta', 'base', 'img'].forEach((b) => {
    if (hote.querySelector(b)) coupables.push('<' + b + '>');
  });
  return { coupables, html: hote.innerHTML };
})();
V(zoneAnalysée.coupables.length === 0 && !/__XSSF/.test(w.document.body.innerHTML),
  'formater() : aucun nœud ni attribut dangereux dans le DOM final',
  zoneAnalysée.coupables.join(',') || zoneAnalysée.html.slice(0, 90));

console.log(echecs ? `  RESULTAT: ${echecs} ECHEC(S)` : '  RESULTAT: 21/21 OK');
process.exit(echecs ? 1 : 0);