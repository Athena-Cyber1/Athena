/* tests/boucle-outils.test.cjs — §8.7 : suite de scénarios de la BOUCLE
   « le modèle propose, le harnais dispose » — test de NON-RÉGRESSION :
   réponse fraîche → blocs (exec / lecture / écriture / plan) → exécution
   locale sur fetch piégé → observation renvoyée au modèle → suite → arrêt
   naturel (aucun appel en trop). Harness jsdom complet (chat-demo entier,
   agent simulé côté fetch : ni node, ni réseau, ni 3020). */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..');
let echecs = 0;
const V = (ok, txt, det) => {
  console.log((ok ? '  OK  ' : '  ECHEC  ') + txt + (det ? ' :: ' + det : ''));
  if (!ok) echecs++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendre(cond, ms) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = cond(); } catch (_) {}
    if (v) return true;
    if (Date.now() - t0 > (ms || 8000)) return v;
    await sleep(40);
  }
}

/* Une fenêtre fraîche par scénario : localStorage (executionAuto ON), fetch
   piégé (scripté par scénario), API modernes absentes de jsdom neutralisées. */
function charger(reponses) {
  const html = fs.readFileSync(path.join(REPO, 'docs', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.localStorage.setItem('chat-preferences', JSON.stringify({
    executionAuto: true, raisonnementVisible: false, defilementAuto: false,
    outilsWeb: true, confirmationEnvoi: false,
  }));
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (!w.IntersectionObserver) w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (!w.HTMLElement.prototype.scrollIntoView) w.HTMLElement.prototype.scrollIntoView = function () {};
  w.scrollTo = () => {};
  const cap = { chat: [], exec: [], write: [], read: [], list: [], grep: [] };
  const json = (obj) => Promise.resolve({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => obj, text: async () => JSON.stringify(obj),
  });
  const corpsDe = (opts) => { try { return JSON.parse((opts && opts.body) || '{}'); } catch (_) { return {}; } };
  w.fetch = (input, opts) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const meth = (opts && opts.method) || 'GET';
    if (url.indexOf('/api/chat') === 0) {
      if (meth === 'GET') return json({ modele_charge: true });
      cap.chat.push(corpsDe(opts));
      const i = cap.chat.length - 1;
      return json({ reponse: i < reponses.length ? reponses[i] : 'Termine.' });
    }
    if (url.indexOf('/api/exec') === 0) {
      const c = corpsDe(opts);
      cap.exec.push(String(c.commande || ''));
      return json({ ok: true, code: 0, signal: null, stdout: 'SORTIE_EXEC_BANQUE', stderr: '', duree_ms: 4, commande: c.commande });
    }
    if (url.indexOf('/api/write') === 0) {
      const c = corpsDe(opts);
      cap.write.push(String(c.chemin || ''));
      return json({ ok: true, chemin: c.chemin, octets: String(c.contenu || '').length, ecrase: false });
    }
    if (url.indexOf('/api/read') === 0) {
      cap.read.push(url);
      return json({ ok: true, chemin: 'lecture-simulee', octets: 24, lignes_total: 2, debut: 1, fin: 60, texte: 'LIGNE_ALPHA\nLIGNE_BETA', tronque: false });
    }
    if (url.indexOf('/api/list') === 0) {
      cap.list.push(url);
      return json({ ok: true, chemin: 'liste-simulee', total: 2, entrees: [{ nom: 'doss', type: 'd', taille: null }, { nom: 'f.js', type: 'f', taille: 12 }], tronque: false });
    }
    if (url.indexOf('/api/grep') === 0) {
      const c = corpsDe(opts);
      cap.grep.push(c);
      return json({ ok: true, motif: c.motif, cible: c.chemin, fichiers: 1, occurrences: [{ fichier: 'a.txt', n: 3, echantillon: 'x', ligne: 'motif ici' }], tronque: false });
    }
    if (url.indexOf('/api/kill') === 0) return json({ arrets: 0 });
    if (url.indexOf('/api/browser') === 0) return json({ ok: false, erreur: 'navigateur non simule dans ce test' });
    if (url.indexOf('/api/modeles') === 0) return json([]);
    return Promise.resolve({
      ok: false, status: 404, headers: { get: () => 'application/json' },
      json: async () => ({ erreur: 'route inconnue : ' + url }), text: async () => '{}',
    });
  };
  w.eval(fs.readFileSync(path.join(REPO, 'docs', 'chat-demo.js'), 'utf8'));
  return { w, cap };
}

function pousser(w, texte) {
  const co = w.conversationOuverte();
  co.messages.push({ role: 'user', content: texte });
  return co;
}
const msgModele = (co) => JSON.stringify(co.messages);

async function main() {
  /* --- Scénario A : boucle exec de base + observation + arrêt naturel --- */
  const A = charger([
    'Je lance la commande.\n\n```athena-exec\nWrite-Output SORTIE_EXEC_BANQUE\n```',
    'Verdict : analyse terminee, tout est vert.',
  ]);
  const coA = pousser(A.w, 'Analyse le depot.');
  try {
    await A.w.genererReponse(coA);
  } catch (e) { V(false, 'A: genererReponse sans exception', String(e && e.message || e)); }
  V(await attendre(() => A.cap.chat.length >= 2), 'A: la boucle enchaîne (2e appel apres exec)',
    'chat=' + A.cap.chat.length + ' exec=' + A.cap.exec.length);
  V(A.cap.exec.length === 1 && A.cap.exec[0].indexOf('Write-Output SORTIE_EXEC_BANQUE') >= 0,
    'A: bloc athena-exec -> 1 POST /api/exec avec la commande exacte', JSON.stringify(A.cap.exec));
  const histA = msgModele(coA);
  V(histA.indexOf('<resultat_commande>') >= 0 && histA.indexOf('SORTIE_EXEC_BANQUE') >= 0,
    'A: observation <resultat_commande> (stdout) dans l historique',
    histA.slice(Math.max(0, histA.indexOf('<resultat_commande>')), histA.indexOf('<resultat_commande>') + 90));
  V(JSON.stringify(A.cap.chat[1] || {}).indexOf('SORTIE_EXEC_BANQUE') >= 0,
    'A: sortie REINJEE dans le corps du tour suivant (observation lue par le modele)',
    'messages=' + ((A.cap.chat[1] || {}).messages || []).length);
  await sleep(350);
  V(A.cap.chat.length === 2, 'A: arret naturel (reponse sans bloc -> plus aucun appel)',
    'chat=' + A.cap.chat.length);
  V(/analyse terminee/.test(String(coA.messages[coA.messages.length - 1].content || '')),
    'A: verdict final rendu comme message assistant',
    String(coA.messages[coA.messages.length - 1].content || '').slice(0, 60));
  V(A.cap.chat.every((b) => b.plan === undefined),
    'A: aucun champ plan envoye quand le HUD est vide (pas de bruit)', 'ok');

  /* --- Scénario B : outil de lecture dédié (athena-read) en boucle --- */
  const B = charger([
    'Je lis le fichier.\n\n```athena-read fichier="C:\\proj\\a.js" debut=1 fin=10\n```',
    'Lu. Analyse faite, rien a signaler.',
  ]);
  const coB = pousser(B.w, 'lis le fichier a.js');
  try {
    await B.w.genererReponse(coB);
  } catch (e) { V(false, 'B: genererReponse sans exception', String(e && e.message || e)); }
  V(await attendre(() => B.cap.chat.length >= 2), 'B: la boucle enchaîne (2e appel apres lecture)',
    'chat=' + B.cap.chat.length + ' read=' + B.cap.read.length);
  V(B.cap.read.length === 1 && /chemin=C%3A/.test(B.cap.read[0]),
    'B: bloc athena-read -> GET /api/read borne (chemin encodé)', B.cap.read[0] || '(vide)');
  const histB = msgModele(coB);
  V(histB.indexOf('<resultat_lecture>') >= 0 && histB.indexOf('LIGNE_ALPHA') >= 0,
    'B: <resultat_lecture> avec contenu rendu au modele',
    histB.slice(Math.max(0, histB.indexOf('<resultat_lecture>')), histB.indexOf('<resultat_lecture>') + 80));
  V(histB.indexOf('DONNEE NON FIABLE') >= 0,
    'B: etiquette DONNEE NON FIABLE posee par le harnais sur la lecture', 'ok');
  await sleep(350);
  V(B.cap.chat.length === 2, 'B: arret naturel apres lecture', 'chat=' + B.cap.chat.length);

  /* --- Scénario C : écriture + RELECTURE automatique (vérification outil) --- */
  const C = charger([
    'J ecris le fichier.\n\n```athena-file chemin="C:\\proj\\sortie.txt"\nHello boucle\n```',
    'Fichier ecrit et relu. Verdict OK.',
  ]);
  const coC = pousser(C.w, 'ecris sortie.txt');
  try {
    await C.w.genererReponse(coC);
  } catch (e) { V(false, 'C: genererReponse sans exception', String(e && e.message || e)); }
  V(await attendre(() => C.cap.chat.length >= 2), 'C: la boucle enchaîne apres ecriture',
    'chat=' + C.cap.chat.length + ' write=' + C.cap.write.length);
  V(C.cap.write.length === 1 && C.cap.write[0] === 'C:\\proj\\sortie.txt',
    'C: bloc athena-file -> POST /api/write au chemin exact', JSON.stringify(C.cap.write));
  V(C.cap.read.some((u) => u.indexOf('debut=1') >= 0 && u.indexOf('fin=60') >= 0 && u.indexOf('max=4000') >= 0),
    'C: relecture automatique disque apres ecriture (/api/read borné)', JSON.stringify(C.cap.read));
  const histC = msgModele(coC);
  V(histC.indexOf('VERIFICATION ECRITURE') >= 0 && histC.indexOf('LIGNE_ALPHA') >= 0,
    'C: VERIFICATION ECRITURE avec preuve observee (apercu relu) dans l historique',
    histC.slice(Math.max(0, histC.indexOf('VERIFICATION ECRITURE')), histC.indexOf('VERIFICATION ECRITURE') + 90));
  await sleep(350);
  V(C.cap.chat.length === 2, 'C: arret naturel apres verification', 'chat=' + C.cap.chat.length);

  /* --- Scénario D : plan visible -> HUD -> body.plan -> restauration --- */
  const D = charger(['Reponse simple sans bloc.']);
  const coD = pousser(D.w, 'planifie la correction');
  D.w.majPlan(['analyser la demande', 'appliquer la correction', 'verifier le resultat']);
  const hudD = D.w.document.getElementById('hud-plan');
  const listeD = hudD.querySelector('.plan-liste');
  V(hudD.hidden === false && listeD.children.length === 3,
    'D: plan publie -> HUD visible avec 3 etapes',
    'hidden=' + hudD.hidden + ' items=' + listeD.children.length);
  D.w.majPlan(['[x] analyser la demande', '[ ] appliquer la correction']);
  V(listeD.children.length === 2 && listeD.children[0].className === 'fait'
    && listeD.children[1].className !== 'fait',
    'D: etape [x] marquee faite dans le HUD (classe fait)',
    'classes=' + Array.from(listeD.children).map((li) => li.className || '-').join(','));
  try {
    await D.w.genererReponse(coD);
  } catch (e) { V(false, 'D: genererReponse sans exception', String(e && e.message || e)); }
  V(await attendre(() => D.cap.chat.length >= 1), 'D: appel chat emis', 'chat=' + D.cap.chat.length);
  const planEnvoye = (D.cap.chat[0] || {}).plan;
  V(Array.isArray(planEnvoye) && planEnvoye.length === 2 && planEnvoye[0] === '[x] analyser la demande',
    'D: body.plan REINJECTE a chaque tour (etat visible du modele)',
    JSON.stringify(planEnvoye));
  await attendre(() => D.cap.chat.length >= 2, 4000);
  /* restauration : _plan de la conversation remplace l'etat staler du HUD */
  coD._plan = ['plan restaure un', 'plan restaure deux'];
  try { D.w.ouvrirConversation(coD.id); } catch (e) { V(false, 'D: ouvrirConversation sans exception', String(e && e.message || e)); }
  const planRestaure = D.w.planActif();
  V(Array.isArray(planRestaure) && planRestaure.length === 2 && planRestaure[0] === 'plan restaure un'
    && listeD.children.length === 2,
    'D: reouverture -> HUD restaure depuis convo._plan (pas de plan croise)',
    JSON.stringify(planRestaure));
  D.w.majPlan([]);
  V(hudD.hidden === true, 'D: plan vide -> HUD masque', 'hidden=' + hudD.hidden);

  /* --- Scénario E : non-régression du repérage de commande répétée --- */
  const E = charger([
    'Je regarde.\n\n```athena-exec\nGet-Item x\n```',
    'Je regarde aussi.\n\n```athena-exec\nGet-Item x\n```',
    'Essai different termine. Verdict final.',
  ]);
  const coE = pousser(E.w, 'inspecte x');
  try {
    await E.w.genererReponse(coE);
  } catch (e) { V(false, 'E: genererReponse sans exception', String(e && e.message || e)); }
  V(await attendre(() => E.cap.chat.length >= 3), 'E: deux tours exec + verdict (3e appel)',
    'chat=' + E.cap.chat.length + ' exec=' + E.cap.exec.length);
  V(E.cap.exec.length === 2 && E.cap.exec[0] === E.cap.exec[1],
    'E: meme commande deux fois (doom-loop client)', JSON.stringify(E.cap.exec));
  const histE = msgModele(coE);
  V(histE.indexOf('tu as déjà lancé cette commande exacte') >= 0,
    'E: 2e passage signale la repetition au modele (change d approche)',
    histE.slice(Math.max(0, histE.indexOf('déjà lancé') - 40), histE.indexOf('déjà lancé') + 60));
  await sleep(350);
  V(E.cap.chat.length === 3, 'E: arret naturel apres verdict', 'chat=' + E.cap.chat.length);

  /* --- Scénario F : garde CSS du HUD plan (source + miroir synchronisé) —
         styles déjà perdus une fois par une régénération de docs/design/. */
  const cssSrc = fs.readFileSync(path.join(REPO, 'design', 'athena-demo.css'), 'utf8');
  const cssDoc = fs.readFileSync(path.join(REPO, 'docs', 'design', 'athena-demo.css'), 'utf8');
  V(/\.hud-plan\b/.test(cssSrc) && /\.plan-tete\b/.test(cssSrc)
    && /li\.fait/.test(cssSrc) && /pre\.plan-bloc/.test(cssSrc),
    'F: styles .hud-plan / .plan-tete / li.fait / pre.plan-bloc dans la SOURCE design/',
    JSON.stringify({ hud: /\.hud-plan\b/.test(cssSrc), tete: /\.plan-tete\b/.test(cssSrc),
      fait: /li\.fait/.test(cssSrc), bloc: /pre\.plan-bloc/.test(cssSrc) }));
  V(/\.hud-plan\b/.test(cssDoc),
    'F: miroir docs/design/athena-demo.css synchronise (prepare-assets avant check)',
    'present=' + /\.hud-plan\b/.test(cssDoc));

  console.log(echecs ? `  RESULTAT: ${echecs} ECHEC(S)` : '  RESULTAT: 29/29 OK');
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
