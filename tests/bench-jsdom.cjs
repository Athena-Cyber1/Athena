/* tests/bench-jsdom.cjs — §8.4 : banc de performance des fonctions pures de
   chat-demo.js dans un DOM jsdom (sans navigateur lourd).
   Mesure : parser (actions navigateur), corpsPourModele (assemblage entrée),
   humaniserErreur si exposé. Seuils LARGEs (détection de régression x10, pas
   de micro-benchmark) : la sortie sert de baseline datée, l'exit code ne vire
   que sur anomalie structurelle ou régression énorme. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
const seuils = { parser: 3000, corps: 3000, human: 3000 }; /* ms / 2000 iters */

function charger() {
  const html = fs.readFileSync(path.join(REPO, 'docs', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '', body: null });
  w.eval(fs.readFileSync(path.join(REPO, 'docs', 'chat-demo.js'), 'utf8'));
  return w;
}

function chrono(fn, n) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(i);
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function main() {
  const w = charger();
  let echecs = 0;
  const V = (ok, txt, det) => {
    console.log((ok ? '  OK  ' : '  ECHEC  ') + txt + (det ? ' :: ' + det : ''));
    if (!ok) echecs++;
  };

  const bloc = 'ouvrir https://example.com\nclic #btn\njs: 1+1\npoint #tete';
  V(typeof w.parserActionNavigateur === 'function', 'window.parserActionNavigateur expose', typeof w.parserActionNavigateur);
  const tParser = typeof w.parserActionNavigateur === 'function' ? chrono(() => w.parserActionNavigateur(bloc), 2000) : 1e9;
  V(tParser < seuils.parser, 'parser x2000 sous seuil', tParser.toFixed(1) + ' ms');

  V(typeof w.corpsPourModele === 'function', 'window.corpsPourModele expose', typeof w.corpsPourModele);
  const entree = {
    navigateur: true, commande: 'ouvrir https://example.com', ok: true,
    stdout: 'url : https://example.com/\ntitre : Example Domain',
    duree_ms: 1821,
  };
  const tCorps = typeof w.corpsPourModele === 'function' ? chrono(() => w.corpsPourModele(entree, false), 2000) : 0;
  V(tCorps < seuils.corps, 'corpsPourModele x2000 sous seuil', tCorps.toFixed(1) + ' ms');

  /* humaniserErreur si exposé (facultatif : pas de seuil, juste baseline). */
  const tHuman = typeof w.humaniserErreur === 'function'
    ? chrono(() => w.humaniserErreur('erreur: stream terminé prématurément'), 2000)
    : -1;
  V(tHuman >= 0 ? tHuman < seuils.human : true, 'humaniserErreur (facultatif)', tHuman < 0 ? 'non exposé' : tHuman.toFixed(1) + ' ms');

  /* Baseline datée (JSON) pour comparaison inter-runs. */
  const base = {
    date: new Date().toISOString(),
    node: process.version,
    parser_ms_2000: +tParser.toFixed(1),
    corps_ms_2000: +tCorps.toFixed(1),
    human_ms_2000: +tHuman.toFixed(1),
  };
  const sortie = path.join(__dirname, 'bench-jsdom-baseline.json');
  fs.writeFileSync(sortie, JSON.stringify(base, null, 2));
  console.log('  baseline -> ' + path.relative(REPO, sortie));
  console.log(echecs ? `  RESULTAT: ${echecs} ECHEC(S)` : '  RESULTAT: 4/4 OK');
  process.exit(echecs ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error('FATAL', (e && e.stack) || e);
  process.exit(1);
}
