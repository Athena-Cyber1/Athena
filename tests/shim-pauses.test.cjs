/* tests/shim-pauses.test.cjs — §8 (console propre) : les pauses de provider
   (429/402/403) doivent SURVIVRE à une recharge — sinon chaque F5 retente le
   provider sanctionné et débite une ligne « 429 » + une requête du quota
   journalier déjà épuisé. Vérifie : lecture au démarrage (état + clé), purge
   d'une pause expirée, plafond 6 h, et que rien n'est requis réseau à l'init.
   §8.1 : traces persistées (localStorage, survit au F5).
   §8.5-1 : effort HUD TRANSMIS dans le corps openrouter (reasoning.effort).
   §8.5-2 : garde CoT vomi (nettoyageCot expose sur window.__athenaCot).
   §8.6-3 : backoff Retry-After-aware (window.__athenaBackoff, 2 s×2^n+jitter).
   §8.6-4 : temperature RETIREE des corps reasoning.
   §8.6-5 : petit modèle pour la compaction (window.__athenaPetitPourResume). */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
const CLE = 'athena_pauses_providers';
let echecs = 0;
const V = (ok, txt, det) => {
  console.log((ok ? '  OK  ' : '  ECHEC  ') + txt + (det ? ' :: ' + det : ''));
  if (!ok) echecs++;
};

function chargerAvecPauses(pauses, traces) {
  const html = fs.readFileSync(path.join(REPO, 'docs', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  if (pauses) w.localStorage.setItem(CLE, JSON.stringify(pauses));
  if (traces) w.localStorage.setItem('athena_traces', JSON.stringify(traces));
  const appels = [];
  w.fetch = (input) => {
    appels.push(typeof input === 'string' ? input : (input && input.url) || '');
    return Promise.reject(new Error('reseau interdit dans ce test'));
  };
  w.eval(fs.readFileSync(path.join(REPO, 'docs', 'api-shim.js'), 'utf8'));
  return { w, appels };
}

/* 1. Pause future au démarrage -> reprise de la pause (aucun réseau à l'init). */
const fin = Date.now() + 3600000;
const a = chargerAvecPauses({ openrouter: fin });
V(typeof a.w.__athenaPauses === 'object', 'window.__athenaPauses expose', typeof a.w.__athenaPauses);
const etat = a.w.__athenaPauses.etat();
V(etat.openrouter === fin, 'pause future reprise au demarrage', JSON.stringify(etat));
V(a.w.__athenaPauses.restantMs('openrouter') > 3500000, 'restantMs coherente', String(a.w.__athenaPauses.restantMs('openrouter')));
V(a.appels.length === 0, 'aucun appel reseau a l init', JSON.stringify(a.appels));

/* 2. Pause expiree -> purgeee (etat vide + clé retiree du localStorage). */
const b = chargerAvecPauses({ openrouter: Date.now() - 1000, pollinations: Date.now() - 5000 });
V(Object.keys(b.w.__athenaPauses.etat()).length === 0, 'pauses expirees purgees', JSON.stringify(b.w.__athenaPauses.etat()));
V(b.w.localStorage.getItem(CLE) === null, 'cle retiree quand tout est expire', String(b.w.localStorage.getItem(CLE)));

/* 3. Pause trop lointaine (> 6 h + marge) -> ignoree (plafond de securite). */
const c = chargerAvecPauses({ openrouter: Date.now() + 7 * 3600000 });
V(c.w.__athenaPauses.restantMs('openrouter') === 0, 'pause > 6 h ignoree (plafond)', String(c.w.__athenaPauses.restantMs('openrouter')));

/* 3b (§8.6-3) : backoff opencode-style expose — standard 2 s × 2^n + jitter
   25 % (plafond 30 s), saturation = palier court historique (bascule rapide). */
const bo = a.w.__athenaBackoff;
V(typeof bo === 'function', 'window.__athenaBackoff expose', typeof bo);
const d0 = bo(0, false), d2 = bo(2, false), dCap = bo(9, false), dSat = bo(0, true);
V(d0 >= 2000 && d0 <= 2500 && d2 >= 8000 && d2 <= 10000 && dCap <= 37500 && dSat >= 500 && dSat <= 625,
  'backoff 2s×2^n + jitter borne (cap 30 s, sat 500 ms)',
  JSON.stringify({ d0: d0, d2: d2, dCap: dCap, dSat: dSat }));

/* 3c (§8.6-5) : selection du petit modele pour la compaction — sur la
   fenêtre b (pauses expirées purgées : providerSain(openrouter) = vrai). */
const pr = b.w.__athenaPetitPourResume;
V(typeof pr === 'function', 'window.__athenaPetitPourResume expose', typeof pr);
const eNord = pr([{ model: 'cohere/north-mini-code:free', up: true, providerKey: 'openrouter' },
  { model: 'mistralai/mistral-small:free', up: true, providerKey: 'openrouter' }]);
const eVide = pr([{ model: 'mistralai/mistral-small:free', up: true, providerKey: 'openrouter' }]);
V(eNord && eNord.model === 'cohere/north-mini-code:free' && eVide === null,
  'resume compaction : north-mini prefere, sinon repli null',
  JSON.stringify([eNord && eNord.model, eVide]));

/* 4. Traces PERSISTEES (§8.1 v20261007) : restauration au demarrage, puis
      ecriture apres un essai reel (fetch en echec) — « analyse ma derniere
      requete » doit survivre a un F5. Le verdict est DIFFERE (setTimeout) :
      il faut que l'event loop du shim tourne pendant le tour de cascade
      (Atomics.wait le gelerait et le test ne finirait jamais). */
const tracesAvant = [{ t: 1, servi: 'ancienne-trace' }, { t: 2, servi: 'ancienne-2' }];
const d = chargerAvecPauses(null, tracesAvant);
V(Array.isArray(d.w.__athenaTraces) && d.w.__athenaTraces.length === 2
  && d.w.__athenaTraces[1].servi === 'ancienne-2',
  'traces restaurees depuis localStorage au demarrage',
  JSON.stringify(d.w.__athenaTraces.map((x) => x.servi)));
d.w.fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }] }),
}).catch(() => {});

/* 5+6 (§8.5) montés sur leur propre fenêtre : pollinations+groq en pause
   (la cascade les saute, providerSain) pour tomber sur openrouter au 1er
   essai, et fetch qui CAPTURE les corps (pas seulement les URL). */
const html5 = fs.readFileSync(path.join(REPO, 'docs', 'index.html'), 'utf8');
const dom5 = new JSDOM(html5, { url: 'http://localhost:3000/', runScripts: 'outside-only', pretendToBeVisual: true });
const w5 = dom5.window;
w5.localStorage.setItem(CLE, JSON.stringify({ pollinations: Date.now() + 3600000, groq: Date.now() + 3600000 }));
w5.localStorage.setItem('athena_effort', 'high');
/* sans clé openrouter, la chaîne = pollinations+groq seulement → mis en
   pause, construireChaine tombe à vide (503 avant tout fetch). */
w5.localStorage.setItem('athena_api_keys', JSON.stringify({ openrouter: 'cle-de-test' }));
const corpsVus = [];
w5.fetch = (u, opts) => {
  if (opts && typeof opts.body === 'string') corpsVus.push(opts.body);
  return Promise.reject(new Error('reseau interdit dans ce test'));
};
w5.eval(fs.readFileSync(path.join(REPO, 'docs', 'api-shim.js'), 'utf8'));

/* 6. Garde CoT vomi (§8.5-2) : helper nettoyageCot. */
const cot = w5.__athenaCot;
V(typeof cot === 'function', 'window.__athenaCot expose', typeof cot);
const vomi = "Here's a thinking process:\n1. Analyze the request\n2. Plan the steps";
V(cot(vomi) === null, 'cot vomi sans reponse -> null (cascade)', String(cot(vomi)).slice(0, 50));
const avecReponse = "Here's a thinking process:\n1. Analyze\n\n```html\n<html></html>\n```";
const nettoye = cot(avecReponse);
V(typeof nettoye === 'string' && nettoye.indexOf('thinking process') < 0 && nettoye.indexOf('```') >= 0,
  'cot + vraie reponse -> preamble nettoye', String(nettoye).slice(0, 60));
V(cot('Bonjour ! Voici ton animation three.js, elle tourne a 60 fps.') === 'Bonjour ! Voici ton animation three.js, elle tourne a 60 fps.',
  'reponse normale inchangee', 'ok');

/* 5. Effort HUD TRANSMIS a openrouter (§8.5-1) : on declenche un essai
      reel (fetch rejette) — le corps openrouter doit porter
      reasoning.effort = 'high' (athena_effort pose plus haut). Verdict
      DIFFERE comme la trace (tour de cascade a besoin de l'event loop). */
w5.fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }] }),
}).catch(() => {});

setTimeout(() => {
  let apres = [];
  try { apres = JSON.parse(d.w.localStorage.getItem('athena_traces')) || []; } catch (e) {}
  V(apres.length > tracesAvant.length && apres.some((x) => x.provider),
    'essai reel trace et persiste (provider + erreur)',
    'avant=' + tracesAvant.length + ' apres=' + apres.length
    + (apres.length ? ' derniere=' + JSON.stringify({ provider: apres[apres.length - 1].provider, erreur: String(apres[apres.length - 1].erreur).slice(0, 40) }) : ''));
  V(apres.length <= 50, 'ring persiste borne a 50', String(apres.length));
  const corpsOk = corpsVus.map((b) => { try { return JSON.parse(b); } catch (e) { return null; } }).filter(Boolean);
  V(corpsOk.some((c2) => c2.reasoning && c2.reasoning.effort === 'high'),
    'effort HUD transmis dans le corps openrouter (reasoning.effort)',
    JSON.stringify(corpsOk.map((c2) => c2.reasoning || null).slice(0, 4)));
  /* §8.6-4 (opencode) : un modele raisonneur ignore/renvoie 400 sur
     temperature — elle ne doit plus figurer dans AUCUN corps reasoning. */
  const raisonnables = corpsOk.filter((c2) => c2.reasoning && c2.reasoning.effort);
  V(raisonnables.length > 0 && raisonnables.every((c2) => c2.temperature === undefined),
    'temperature retiree des corps reasoning (§8.6-4)',
    JSON.stringify(raisonnables.map((c2) => ({ temp: c2.temperature, eff: c2.reasoning.effort }))));
  /* §8.7 (plus de repli de modèle auto) : modèle choisi = chaine d'une
     seule entrée strictChoisi ; models[] OpenRouter serre a la cible
     unique en strict, trio de relais conserve en mode auto. */
  const s87 = chargerAvecPauses(null, null);
  const w87 = s87.w;
  V(typeof w87.__athenaConstruireChaine === 'function' && typeof w87.__athenaOrModelsBody === 'function',
    '8.7: construireChaine + orModelsBody exposes',
    typeof w87.__athenaConstruireChaine + ' / ' + typeof w87.__athenaOrModelsBody);
  const planAuto87 = w87.__athenaConstruireChaine('');
  const cible87 = planAuto87.chaine && planAuto87.chaine[0] && planAuto87.chaine[0].id;
  V(!!cible87, '8.7: auto a au moins un modele', JSON.stringify(cible87));
  const planChoisi87 = w87.__athenaConstruireChaine(cible87);
  V(planChoisi87.chaine.length === 1 && planChoisi87.chaine[0].strictChoisi === true,
    '8.7: modele choisi = SEUL de la chaine (aucun relais)',
    'len=' + planChoisi87.chaine.length + ' strict=' + (planChoisi87.chaine[0] || {}).strictChoisi);
  const orStrict = w87.__athenaOrModelsBody({ model: 'google/gemma-4-31b-it:free', strictChoisi: true });
  V(Array.isArray(orStrict) && orStrict.length === 1 && orStrict[0] === 'google/gemma-4-31b-it:free',
    '8.7: models[] serre a la cible unique en strict', JSON.stringify(orStrict));
  const orAuto = w87.__athenaOrModelsBody({ model: 'google/gemma-4-31b-it:free' });
  V(Array.isArray(orAuto) && orAuto.length > 1,
    '8.7: auto garde le trio de relais', JSON.stringify(orAuto));
  console.log(echecs ? `  RESULTAT: ${echecs} ECHEC(S)` : '  RESULTAT: 24/24 OK');
  process.exit(echecs ? 1 : 0);
}, 35000);
