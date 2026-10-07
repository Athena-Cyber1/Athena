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
/* v20261007 : le rapport final n'est imprimé qu'une fois TOUS les scénarios
   asynchrones terminés (3g puis H/I/J). Avant, un simple setTimeout pouvait
   sortir le rapport avant le verdict le plus lent — le test passait au green
   alors qu'un scénario n'avait pas encore judged. */
const promesses = [];
/* v20261007 : lecteur NDJSON de test. La réponse du shim en mode stream est
   un Response dont le corps est un VRAI ReadableStream (polyfillé plus haut) :
   `text()` ne rend pas le flux, il faut le consommer. */
async function lireNdjson(r) {
  if (!r) return { ct: '', corps: '', lignes: [] };
  const ct = (r.headers && typeof r.headers.get === 'function') ? (r.headers.get('content-type') || '') : '';
  if (!/ndjson/.test(ct)) {
    const corps = typeof r.text === 'function' ? await r.text().catch(() => '') : '';
    return { ct, corps, lignes: String(corps).split('\n').filter(Boolean) };
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  buf += dec.decode();
  return { ct, corps: buf, lignes: buf.split('\n').filter(Boolean) };
}

function chargerAvecPauses(pauses, traces, fetchPerso, cles) {
  const html = fs.readFileSync(path.join(REPO, 'docs', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  /* v20261007 : le chemin stream:true (NDJSON) n'était JAMAIS testé — et il
     utilise `new ReadableStream`, absent de jsdom. Le scénario H l'a révélé
     immédiatement (« ReadableStream is not defined »). Polyfill depuis les
     globals Node : sans lui, on ne peut pas tester le chemin que le client
     utilise 100 % du temps. */
  if (typeof w.ReadableStream !== 'function' && typeof ReadableStream === 'function') {
    w.ReadableStream = ReadableStream;
  }
  if (typeof w.TextEncoder !== 'function' && typeof TextEncoder === 'function') {
    w.TextEncoder = TextEncoder;
  }
  if (typeof w.TextDecoder !== 'function' && typeof TextDecoder === 'function') {
    w.TextDecoder = TextDecoder;
  }
  /* jsdom n'expose PAS Response (API fetch) — le shim en a besoin pour ses
     json()/ndjson() : polyfill minimal (body/status/ok/headers/json/text). */
  if (typeof w.Response !== 'function') {
    w.Response = class FauxResponse {
constructor(body, init) {
        this._body = body;
        /* v20261007 : `body` doit être exposé tel quel (le chemin NDJSON du
           shim passe un ReadableStream que le client consomme via
           getReader()) — sans cette propriété, le scénario H ne pouvait pas
           lire le flux. */
        this.body = body;
        init = init || {};
this.status = init.status || 200;
        this.ok = this.status >= 200 && this.status < 300;
        /* v20261007 : `Headers.get` est INSENSIBLE À LA CASSE (comme le
           standard). Le shim écrit 'Content-Type: …' et le client lit
           'content-type' → sans cette normalisation, le test voyait un
           content-type vide et concluait à tort que la réponse n'était pas
           du NDJSON. */
        const entetes = init.headers || {};
        this.headers = {
          get: (h) => {
            const cle = String(h).toLowerCase();
            for (const k of Object.keys(entetes)) {
              if (k.toLowerCase() === cle) return entetes[k];
            }
            return null;
          },
        };
      }
      json() { return Promise.resolve(typeof this._body === 'string' ? JSON.parse(this._body) : this._body); }
      text() { return Promise.resolve(typeof this._body === 'string' ? this._body : String(this._body)); }
    };
  }
  if (pauses) w.localStorage.setItem(CLE, JSON.stringify(pauses));
  if (traces) w.localStorage.setItem('athena_traces', JSON.stringify(traces));
  if (cles) w.localStorage.setItem('athena_api_keys', JSON.stringify(cles));
  const appels = [];
  w.fetch = fetchPerso || ((input) => {
    appels.push(typeof input === 'string' ? input : (input && input.url) || '');
    return Promise.reject(new Error('reseau interdit dans ce test'));
  });
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

/* 3d (§8.7-4) : plan visible REINJECTE a chaque tour — helper pur
     avecPlan (window.__athenaPlanConsigne) collé au system par gererChat. */
const pc = a.w.__athenaPlanConsigne;
V(typeof pc === 'function', 'window.__athenaPlanConsigne expose', typeof pc);
const basePC = 'CONSIGNES.';
const avecPC = pc(basePC, ['[ ] etat initial', '[x] analyser le depot']);
V(typeof avecPC === 'string' && avecPC !== basePC
  && avecPC.indexOf('PLAN EN COURS') >= 0 && avecPC.indexOf('[x] analyser') >= 0,
  'plan non vide -> consigne PLAN EN COURS avec etapes',
  String(avecPC).slice(0, 120));
V(pc(basePC, []) === basePC && pc(basePC, null) === basePC,
  'plan vide/absent -> consignes inchangees (rien a injecter)', String(pc(basePC, [])).slice(0, 40));

/* 3e (§8.7-3) : outils NATIFS — schema expose, injection conditionnee fc,
     traduction tool_calls -> blocs athena-* (un seul chemin d'execution). */
const ao = a.w.__athenaOutils;
V(ao && typeof ao.schema === 'object' && typeof ao.ajouter === 'function'
  && typeof ao.accumuler === 'function' && typeof ao.versBlocs === 'function',
  'window.__athenaOutils expose (schema/ajouter/accumuler/versBlocs)',
  JSON.stringify(Object.keys(ao || {})));
const nomsOutils = (ao.schema || []).map((s) => s && s.function && s.function.name).join(',');
V(nomsOutils === 'exec,read_file,grep,list_dir,write_file',
  'schema function calling : 5 outils attendus', nomsOutils);
const cFc = ao.ajouter({ fc: true }, {});
V(cFc && Array.isArray(cFc.tools) && cFc.tools.length === 5 && cFc.tool_choice === 'auto',
  'entree fc -> corps porte tools + tool_choice auto',
  JSON.stringify({ n: cFc && cFc.tools && cFc.tools.length, tc: cFc && cFc.tool_choice }));
const cNoFc = ao.ajouter({ fc: false }, {});
const cIg = ao.ajouter({ fc: true, _toolsIgnore: true }, {});
V(!cNoFc.tools && !cIg.tools,
  'sans fc / _toolsIgnore -> aucun champ tools (repli blocs texte)',
  JSON.stringify({ nofc: !!cNoFc.tools, ig: !!cIg.tools }));
const blocsExec = ao.versBlocs([{ name: 'exec', args: JSON.stringify({ commande: 'Get-ChildItem' }) }]);
const blocsLect = ao.versBlocs([
  { name: 'read_file', args: JSON.stringify({ fichier: 'C:\\a\\b.js', debut: 1, fin: 20 }) },
  { name: 'list_dir', args: JSON.stringify({ chemin: 'C:\\a' }) },
]);
V(blocsExec.indexOf('```athena-exec\nGet-ChildItem\n```') === 0,
  'tool_call exec -> bloc athena-exec', JSON.stringify(blocsExec));
V(blocsLect.indexOf('```athena-read fichier="C:\\a\\b.js" debut=1 fin=20') >= 0
  && blocsLect.indexOf('```athena-list chemin="C:\\a"') >= 0,
  'tool_calls read/list -> blocs athena-read / athena-list', JSON.stringify(blocsLect).slice(0, 200));
const blocsSuite = ao.versBlocs([
  { name: 'grep', args: JSON.stringify({ motif: 'TODO', chemin: 'C:\\a', sous: false }) },
  { name: 'write_file', args: JSON.stringify({ chemin: 'C:\\a\\f.txt', contenu: 'salut' }) },
  { name: 'exec', args: '{json illisible' },
]);
V(blocsSuite.indexOf('```athena-grep motif="TODO" chemin="C:\\a" sous=false') >= 0
  && blocsSuite.indexOf('```athena-file chemin="C:\\a\\f.txt"\nsalut') >= 0,
  'tool_calls grep/write -> blocs athena-grep / athena-file (args illisible ignore)',
  JSON.stringify(blocsSuite).slice(0, 240));
const appelsAcc = ao.accumuler(ao.accumuler([], { tool_calls: [{ index: 0, function: { name: 'exe' } }] }),
  { tool_calls: [{ index: 0, function: { name: 'c', arguments: '{"commande":"ls"}' } }] });
V(appelsAcc.length === 1 && appelsAcc[0].name === 'exec' && appelsAcc[0].args === '{"commande":"ls"}',
  'deltas tool_calls (nom+args decoupes) accumules par index',
  JSON.stringify(appelsAcc));

/* 3f : drapeau fc PROPAGE par catalogue() (copie blistee explicitement).
     v20261007 : fc a SUivi qwen (404 gratuit) vers gemma ; l'entrée qwen
     est maintenant chat:false (sortie du HUD et de la cascade). */
const planFc = a.w.__athenaConstruireChaine('openrouter:google/gemma-4-31b-it:free');
V(planFc.chaine.length === 1 && planFc.chaine[0].fc === true,
  'fc marque present sur l entree gemma (fc:true reporte de qwen)',
  JSON.stringify({ n: planFc.chaine.length, fc: (planFc.chaine[0] || {}).fc }));
const planNoFc = a.w.__athenaConstruireChaine('openrouter:qwen/qwen3.8-27b:free');
V(planNoFc.chaine.length === 1 && !planNoFc.chaine[0].fc && planNoFc.chaine[0].chat === false,
  'qwen 404 -> chat:false sans fc (plus de repli ni d item HUD)',
  JSON.stringify({ fc: (planNoFc.chaine[0] || {}).fc, chat: (planNoFc.chaine[0] || {}).chat }));

/* Réponses HTTP factices réutilisées par les scénarios 3g et H/I/J (v20261007) :
   le shim lit `ok`, `status`, `headers.get('content-type')`, `text()` et
   `json()`. `repHttpSSE` ajoute `body.getReader()` (SSE → NDJSON). */
const repHttp = (status, payload) => ({
  ok: status === 200, status, body: null,
  headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(payload),
  json: async () => payload,
});
/* `repHttpSSE` : réponse d'un PROVIDER en streaming = text/event-stream.
   Le shim la convertit ensuite en NDJSON pour le client — se tromper de
   content-type ici faisait ignorer le flux par uneTentative (et le scénario H
   ne voyait aucun jeton). */
const repHttpSSE = (sse) => {
  /* Le lecteur SSE du shim consomme `r.body.getReader()` : le mock doit donc
     exposer un VRAI ReadableStream, pas seulement `text()`. */
  const encodeur = new TextEncoder();
  let lu = false;
  return {
    ok: true, status: 200,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader() {
        return {
          read() {
            if (lu) return Promise.resolve({ done: true, value: undefined });
            lu = true;
            return Promise.resolve({ done: false, value: encodeur.encode(sse) });
          },
          cancel() { return Promise.resolve(); },
        };
      },
    },
    text: async () => sse,
    json: async () => ({}),
  };
};

/* 3g (v20261007, pool partagé amont) : 429 upstream_provider_shared_pool →
      1) avecRetry re-tente le MÊME tour (délaiBackoff ~2 s) et la 2e passe
         répond ; 2) la pause courte (30 s) posée par le 1er essai est
         RETIRÉE sur le succès → AUCUN fantôme gris. Verdict asynchrone
      (~3 s) avant le rapport final des 35 s. */
promesses.push((async () => {
  let completions = 0;
  const g = chargerAvecPauses(null, null, (input) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      completions += 1;
      if (completions === 1) {
        return Promise.resolve(repHttp(429, { error: { message: 'Provider returned error', code: 429, metadata: { raw: 'upstream rate-limited', provider_name: 'Google AI Studio', is_byok: false, provider_error_code: '429', limit_source: 'upstream_provider_shared_pool' } } }));
      }
      return Promise.resolve(repHttp(200, { id: 'x', choices: [{ message: { role: 'assistant', content: 'REPONSE-OK-POOL' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3 } }));
    }
    if (url.indexOf('/models') >= 0) return Promise.resolve(repHttp(401, { error: { message: 'DYN hors test' } }));
    return Promise.reject(new Error('reseau interdit dans ce test'));
  }, { openrouter: 'cle-de-test' });
  let corpsG = null;
  let errG = null;
  try {
    const rG = await g.w.fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }], model_id: 'openrouter:google/gemma-4-31b-it:free' }),
    });
    corpsG = rG && typeof rG.json === 'function' ? await rG.json() : null;
  } catch (eG) { corpsG = null; errG = String((eG && eG.message) || eG); }
  V(!!corpsG && /REPONSE-OK-POOL/.test(String(corpsG.reponse || corpsG.erreur || '')),
    '3g: 429 pool -> retry meme tour -> reponse rendue',
    JSON.stringify(corpsG ? String(corpsG.reponse || corpsG.erreur).slice(0, 60) : 'ERR:' + errG));
  V(completions === 2, '3g: exactement 2 appels (1 x 429 + 1 retry)', completions + (errG ? ' err=' + errG : ''));
  const etatG = g.w.__athenaPauses.etat();
  V(Object.keys(etatG).length === 0,
    '3g: pause pool 30 s RETIRÉE au succes (aucun item gris fantome)',
    JSON.stringify(etatG));
})());

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
      DIFFERE comme la trace (tour de cascade a besoin de l'event loop).
      §8.7-4 : body.plan (HUD) doit etre recolle au system dans le corps
      provider — meme essai, meme capture. */
w5.fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'salut' }],
    plan: ['[ ] etat initial', '[x] analyser le depot'],
  }),
}).catch(() => {});

setTimeout(async () => {
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
  /* §8.7-4 bout-en-bout : le system du corps provider porte le plan du HUD
     (avecPlan geree par gererChat, pas seulement le helper expose). */
  const sysPlan = corpsOk.map((c2) => (c2.messages && c2.messages[0]
    && c2.messages[0].role === 'system' ? c2.messages[0].content : '') || '');
  V(sysPlan.some((s2) => s2.indexOf('PLAN EN COURS') >= 0 && s2.indexOf('[x] analyser le depot') >= 0),
    'plan HUD recolle au system du corps provider (gererChat)',
    JSON.stringify(sysPlan.map((s2) => s2.indexOf('PLAN EN COURS'))));
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

  /* === H (v20261007) : le CHEMIN RÉEL DE PRODUCTION — stream:true (NDJSON)
     n'était couvert par AUCUN test : tous les appels de ce fichier sont sans
     `stream`, donc la boucle de cascade testée n'était pas celle que le
     client utilise 100 % du temps. On vérifie le flux complet : jetons →
     final avec raisonnement/compression/chain, et le nom du modèle dans le
     progress (pour que l'utilisateur sache QUEL modèle est essayé). === */
promesses.push((async () => {
  const h = chargerAvecPauses(null, null, (input) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      const sse = [
        'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'je reflechis' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'BONJOUR ' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'DU FLUX' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 } }),
        'data: [DONE]',
        '',
      ].join('\n\n');
      return Promise.resolve(repHttpSSE(sse));
    }
    if (url.indexOf('/models') >= 0) return Promise.resolve(repHttp(401, { error: { message: 'DYN hors test' } }));
    return Promise.reject(new Error('reseau interdit dans ce test'));
  }, { openrouter: 'cle-de-test' });
  const rH = await h.w.fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }], model_id: 'openrouter:google/gemma-4-31b-it:free', stream: true }),
  });
const luH = await lireNdjson(rH);
  const nd = luH.ct;
  const evts = luH.lignes.map((l) => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);
  const jetonsH = evts.filter((e) => e.type === 'jeton').map((e) => e.texte).join('');
  const finalH = evts.filter((e) => e.type === 'final')[0] || null;
  const progressH = evts.filter((e) => e.type === 'progress').map((e) => e.message);
  V(/ndjson/.test(nd), 'H: la reponse du chemin stream est bien du NDJSON', nd);
  V(jetonsH.indexOf('BONJOUR DU FLUX') >= 0, 'H: les jetons NDJSON sont recus dans l ordre', jetonsH);
  V(evts.some((e) => e.type === 'jeton' && e.canal === 'raisonnement'),
    'H: le raisonnement arrive sur son propre canal', JSON.stringify(evts.filter((e) => e.type === 'jeton').map((e) => e.canal)));
  V(!!finalH && finalH.reponse === 'BONJOUR DU FLUX',
    'H: final porte la reponse complete', JSON.stringify(finalH && String(finalH.reponse).slice(0, 40)));
  V(!!finalH && typeof finalH.ms === 'number' && Array.isArray(finalH.chain),
    'H: final porte la duree et la chaine parcourue (diagnostic)',
    JSON.stringify({ ms: finalH && finalH.ms, chain: finalH && finalH.chain && finalH.chain.length }));
  V(!!finalH && finalH.chain && finalH.chain.length === 1 && finalH.chain[0].ok === true,
    'H: la chaine indique le modele qui a repondu', JSON.stringify(finalH && finalH.chain));
  V(progressH.some((m) => /Appel « /.test(String(m))),
    'H: le progress nomme le modele essaye (plus « Appel au modele. » x7)',
    JSON.stringify(progressH.slice(0, 3)));

  /* === I (v20261007) : le PLAFOND DE POSTS par tour. Avant, un tour pouvait
     partir en 50-60 requêtes provider (7 entrées × 2 × retries) : le quota
     gratuit openrouter (50/j) partait en un seul tour. === */
  let postsI = 0;
  const i = chargerAvecPauses(null, null, (input) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      postsI += 1;
      /* toujours 429 : le pire cas (chaque entrée est rejouée par avecRetry) */
      return Promise.resolve(repHttp(429, { error: { message: 'Rate limited', metadata: { limit_source: 'upstream_provider_shared_pool' } } }));
    }
    if (url.indexOf('/models') >= 0) return Promise.resolve(repHttp(401, { error: { message: 'DYN hors test' } }));
    return Promise.reject(new Error('reseau interdit dans ce test'));
  }, { openrouter: 'cle-de-test' });
  const rI = await i.w.fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }], stream: true }),
  }).catch(() => null);
  const corpsI = (await lireNdjson(rI)).corps;
V(postsI > 0 && postsI <= 12,
    'I: le nombre de POSTs provider par tour est PLAFONNE (12)',
    'posts=' + postsI);
  V(/type":"erreur"/.test(corpsI) && corpsI.length > 40,
    'I: l échec est rendu au client sous forme d\'événement erreur (jamais un silence muet)',
    corpsI.slice(-140).replace(/\s+/g, ' '));

/* === J (v20261007) : le rejeu de timeout ne peut PAS boucler (P0). Le
     garde `i > 0` rendait le budget inactif sur la 1re entrée (donc pour tout
     modèle choisi) et le marqueur vivait sur l'objet ERREUR, recréé à chaque
     essai → rejeu sans fin, ~1 POST toutes les 45-90 s jusqu'à épuisement du
     quota. On déclenche le chemin du rejeu SANS attendre un vrai timeout
     (message « timeout N ms », celui que produit le watchdog d'en-têtes) :
     sinon le test durerait des minutes pour le même verdict. === */
  let postsJ = 0;
  const j = chargerAvecPauses(null, null, (input) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      postsJ += 1;
      /* 504 « timeout » : le watchdog produit exactement cette forme */
      return Promise.resolve(repHttp(504, { error: { message: 'timeout 300000 ms (en-têtes jamais reçus)' } }));
    }
    if (url.indexOf('/models') >= 0) return Promise.resolve(repHttp(401, { error: { message: 'DYN hors test' } }));
    return Promise.reject(new Error('reseau interdit dans ce test'));
  }, { openrouter: 'cle-de-test' });
  const departJ = Date.now();
  const rJ = await j.w.fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }], model_id: 'openrouter:google/gemma-4-31b-it:free', stream: true }),
  }).catch(() => null);
  const corpsJ = (await lireNdjson(rJ)).corps;
  V(postsJ >= 1 && postsJ <= 3,
    'J: un timeout sans jeton est rejoue AU PLUS UNE fois (pas de boucle infinie)',
    'posts=' + postsJ + ' en ' + (Date.now() - departJ) + ' ms');
  V(/timeout|erreur/i.test(corpsJ), 'J: l échec est rendu au client', corpsJ.slice(-120));
})());

  /* v20261007 : on ATTEND tous les scénarios asynchrones (3g + H/I/J) avant
     d'imprimer le rapport — sinon process.exit coupait la vérification en vol
     (le rapport annonçait un green avant même que le scénario le plus lent
     ait été jugé). */
  await Promise.all(promesses);
  console.log(echecs ? `  RESULTAT: ${echecs} ECHEC(S)` : '  RESULTAT: 52/52 OK');
  process.exit(echecs ? 1 : 0);
}, 8000);
