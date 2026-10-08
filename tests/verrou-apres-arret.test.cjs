/* Test de régression : le verrou d'envoi ne doit pas fuir après un arrêt.
 *
 * LE BUG (trouvé au crash test, mesuré au navigateur)
 * ----------------------------------------------------
 * Un arrêt demandé dont l'appel sous-jacent ne se résout jamais était traité
 * par `reconcilierVerrou`, qui rendait `occupe = false` après le délai de
 * grâce… mais laissait `generationsEnCours` à sa valeur.
 *
 * Or ce compteur conditionne le déverrouillage NATUREL de toute génération
 * future :
 *     if (!generationsEnCours && !verrouChaine) occupe = false;
 *
 * Compteur resté à 1, cette condition devient fausse pour toujours. Et comme
 * `arretDemandeDepuis` était remis à zéro, le délai de grâce n'était plus
 * armé : plus aucune sortie. Chaque envoi suivant incrémentait puis
 * décrémentait sans jamais retomber à zéro.
 *
 * Résultat mesuré avant correction :
 *     envoi + arrêt          -> verrou libéré au bout de ~6 s, mais gen = 1
 *     envoi suivant, sans arrêt -> JAMAIS déverrouillé (>12 s observées),
 *                                 interface définitivement bloquée
 *
 * Symptôme utilisateur : bouton figé sur « Arrêter la génération », plus rien
 * d'envoyable, seul un rechargement de page rend la main. C'est le
 * symptôme « il reste bloqué, un rechargement suffit » — les correctifs
 * précédents (dj/dk/dl) en traitaient le repeint et le délai, pas la fuite.
 *
 * CE QUE CE TEST FAIT
 * -------------------
 * Il rejoue la séquence et exige deux choses :
 *   1. après l'arrêt, le compteur de générations est revenu à zéro ;
 *   2. l'envoi suivant se déverrouille par le chemin NATUREL, sans attendre
 *      le délai de grâce et sans aucune intervention.
 *
 * LIMITE ASSUMÉE : Playwright remplit une réponse en un bloc, donc le flux se
 * termine aussitôt. Cet environnement ne peut pas fabriquer un appel qui ne
 * rend jamais : on provoque donc l'arrêt pendant la fenêtre où le verrou est
 * pris, ce qui suffit à armer `arretDemandeDepuis` et donc le chemin forcé.
 */

const path = require('path');

const PW = process.env.PW;
if (!PW) {
  console.log('  (crash-verrou : PW non defini, test ignore)');
  process.exit(0);
}
const { chromium } = require(path.join(PW, 'node_modules', 'playwright'));

const BASE = process.env.BASE || 'http://localhost:3000';
const ok = [];
const ko = [];
const V = (nom, cond, detail) => (cond ? ok : ko).push(nom + (detail ? ' :: ' + detail : ''));

(async () => {
  const nav = await chromium.launch();
  const p = await nav.newPage({ viewport: { width: 1400, height: 900 } });
  const erreursJs = [];
  p.on('pageerror', e => erreursJs.push(e.message));

  await p.goto(BASE, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(2000);

  // Un flux qui se termine proprement : le modèle « travaille » puis finit.
  await p.route('**/api/relais', r => r.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'data: {"type":"jeton","canal":"reponse","texte":"ok"}\n\ndata: {"type":"fin"}\n\n',
  }));

  const etat = () => p.evaluate(() => ({
    occupe: typeof occupe !== 'undefined' ? occupe : null,
    gen: typeof generationsEnCours !== 'undefined' ? generationsEnCours : null,
    arret: typeof arretDemandeDepuis !== 'undefined' ? arretDemandeDepuis > 0 : null,
  }));

  /* --- 1. Envoi simple : le chemin naturel doit suffire --- */
  await p.fill('#saisie', 'premier');
  const t0 = Date.now();
  await p.evaluate(() => document.getElementById('btn').click());
  let delaiSimple = null;
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(100);
    if ((await p.evaluate(() => occupe)) === false) { delaiSimple = Date.now() - t0; break; }
  }
  V('envoi simple : deverrouille par le chemin naturel (< 3 s)',
    delaiSimple !== null && delaiSimple < 3000, delaiSimple === null ? 'JAMAIS' : delaiSimple + ' ms');

  /* --- 2. Envoi puis arrêt immédiat : c'est ce qui déclenchait la fuite --- */
  await p.fill('#saisie', 'deuxieme');
  await p.evaluate(() => { const b = document.getElementById('btn'); b.click(); b.click(); });
  // on laisse le délai de grâce s'écouler entièrement
  await p.waitForTimeout(7000);
  const apresArret = await etat();
  V('après arrêt : le verrou est rendu', apresArret.occupe === false, JSON.stringify(apresArret));
  V('après arrêt : le compteur de générations est revenu à zéro',
    apresArret.gen === 0, 'gen=' + apresArret.gen + ' (1 = la fuite)');

  /* --- 3. L'envoi suivant doit repartir normalement --- */
  await p.fill('#saisie', 'troisieme');
  const t1 = Date.now();
  await p.evaluate(() => document.getElementById('btn').click());
  let delaiApres = null;
  for (let i = 0; i < 120; i++) {
    await p.waitForTimeout(100);
    if ((await p.evaluate(() => occupe)) === false) { delaiApres = Date.now() - t1; break; }
  }
  const final = await etat();
  V('envoi suivant : il se déverrouille (il ne restait pas bloqué)',
    delaiApres !== null, delaiApres === null ? 'JAMAIS (>12 s) — l interface reste bloquée' : delaiApres + ' ms');
  V('envoi suivant : par le chemin naturel, sans attendre le délai de grâce (< 3 s)',
    delaiApres !== null && delaiApres < 3000, delaiApres === null ? 'JAMAIS' : delaiApres + ' ms');
  V('compteur revenu à zéro après l’envoi suivant', final.gen === 0, 'gen=' + final.gen);
  /* Après l'envoi le composeur est vide : le bouton d'envoi est ALORS
     normalement désactivé. Ce qu'il ne faut pas, c'est qu'il reste bloqué sur
     « Arrêter ». On vérifie donc les deux états distincts : inactif à vide,
     actif dès qu'on retape — c'est ce second qui prouvait le blocage. */
  const inactifAVide = await p.evaluate(() => document.getElementById('btn').disabled);
  const libelleApres = await p.evaluate(() => document.getElementById('btn').getAttribute('aria-label'));
  V('composeur vide : le bouton d’envoi est inactif (attendu)', inactifAVide === true);
  V('le bouton n’est plus figé sur « Arrêter »',
    !/Arr/i.test(libelleApres || ''), 'libelle=' + libelleApres);
  await p.fill('#saisie', 'a moi');
  await p.waitForTimeout(250);
  V('dès qu’on retape, l’envoi redevient possible',
    await p.evaluate(() => !document.getElementById('btn').disabled));

  V('aucune erreur JS pendant la séquence', erreursJs.length === 0, erreursJs.join(' | '));

  await nav.close();

  const rapport = ok.map(l => '  OK    ' + l).concat(ko.map(l => '  ECHEC ' + l));
  console.log(rapport.join('\n'));
  console.log('RESULTAT: ' + (ok.length) + '/' + (ok.length + ko.length) + (ko.length ? ' — ' + ko.length + ' ECHEC(S)' : ' OK'));
  process.exit(ko.length ? 1 : 0);
})().catch(e => {
  console.error('  ECHEC crash du test :', e.message);
  process.exit(2);
});