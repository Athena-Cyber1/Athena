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
  /* v20261007 (J1) : jsdom n'implémente pas Response ; tout navigateur en a
     une. appelAgent reconstruit une Response après avoir bufferisé le corps,
     donc sans elle le code du produit lève dans la fenêtre. On comble donc
     l'écart de la plateforme au niveau du harnais. */
  if (!w.Response) w.Response = Response;
  if (!w.Headers) w.Headers = Headers;
  if (!w.HTMLElement.prototype.scrollIntoView) w.HTMLElement.prototype.scrollIntoView = function () {};
  w.scrollTo = () => {};
  const cap = { chat: [], exec: [], write: [], read: [], list: [], grep: [] };
  /* v20261007 (J1) : le harnais renvoie de VRAIES Response. Il mimait
     l'API par des objets plats ({ok, status, json, text}), ce qui suffisait
     tant que le code ne faisait que `.json()`. appelAgent bufferise désormais
     le corps (`arrayBuffer()`) pour que la borne couvre aussi la lecture —
     la propriété est standard sur Response, donc c'est le harnais qui devait
     être corrigé, pas le produit. */
  const json = (obj, status = 200) => Promise.resolve(new Response(
    JSON.stringify(obj),
    { status, headers: { 'Content-Type': 'application/json' } }));
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

  /* --- Scénario G (v20261007) : coupure de flux en PLEIN MILIEU — le texte
     déjà affiché ne doit PAS disparaître. Avant le correctif, la rangée de
     diffusion était supprimée puis remplacée par la seule phrase d'erreur :
     des dizaines de kilo-caractères composaient à l'écran partaient au
     premier hoquet réseau, sans être persistés. --- */
  const G = charger(['FIN_PARTIEL_ET_PUIS_COUPURE_ABSENTE']);
  const coG = pousser(G.w, 'raconte une longue histoire');
  /* Le shim simulé renvoie final + une coupure : on force l'erreur de flux en
     remplaçant le texte par un marqueur puis en simulant un flux sans final. */
  G.cap.couper = true;
  G.w.fetch = ((f) => function (input, opts) {
    const url = typeof input === 'string' ? input : '';
    const meth = (opts && opts.method) || 'GET';
    if (url.indexOf('/api/chat') === 0 && meth === 'GET') return f(input, opts);
    if (url.indexOf('/api/chat') === 0) {
      G.cap.chat.push({ messages: [], markers: 1 });
      /* NDJSON : 3 jetons puis une erreur, SANS final. */
      const lignes = [
        { type: 'jeton', canal: 'reponse', texte: 'DEBUT_' },
        { type: 'jeton', canal: 'reponse', texte: 'MILIEU_' },
        { type: 'jeton', canal: 'reponse', texte: 'FIN_' },
        { type: 'erreur', erreur: 'coupure du flux' },
      ].map((e) => JSON.stringify(e)).join('\n') + '\n';
      /* Lecteur : un seul chunk contenant TOUT le corps, puis done — l'index
         doit avancer, sinon la boucle `for(;;) { await read() }` du client
         tourne à l'infini (piège du premier jet de ce scénario).
         L'encodeur vient de NODE (global), pas de la fenêtre jsdom : dans
         certaines fenêtres `window.TextEncoder` est absent et `new undefined`
         faisait échouer le fetch DANS le mock (le client basculait alors sur
         le chemin classique — faux positif de diagnostic). */
      let lu = false;
      const encodeur = new TextEncoder();
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'application/x-ndjson' : null) },
        body: {
          getReader() {
            return {
              read() {
                if (lu) return Promise.resolve({ done: true, value: undefined });
                lu = true;
                return Promise.resolve({ done: false, value: encodeur.encode(lignes) });
              },
              cancel() { return Promise.resolve(); },
            };
          },
        },
        json: async () => ({}), text: async () => lignes,
      });
    }
    return f(input, opts);
  })(G.w.fetch);
  try { await G.w.genererReponse(coG); } catch (e) { /* arret attendu */ }
  await sleep(300);
  const texteVisibleG = G.w.document.body.textContent || '';
  const histG = msgModele(coG);
  V(texteVisibleG.indexOf('DEBUT_') >= 0 || histG.indexOf('DEBUT_') >= 0,
    'G: le texte deja diffuse SURVIT a la coupure de flux (affichage OU historique)',
    'visible=' + (texteVisibleG.indexOf('DEBUT_') >= 0) + ' persiste=' + (histG.indexOf('DEBUT_') >= 0));
  V(histG.indexOf('DEBUT_') >= 0 && histG.indexOf('FIN_') >= 0,
    'G: le partiel est PERSISTE dans l historique (marque tronquee)',
    histG.slice(-90));
  V(histG.indexOf('coupure du flux') >= 0,
    'G: la cause reste affichee (on ne masque pas l erreur)', histG.slice(-90));

  /* --- Scénario H (v20261007) : un tour qui ne contient QU'un athena-read ne
     doit pas être relancé comme « promesse » alors que la lecture est en
     cours. Avant, autoExecBlocs exécutait `.read-bloc` mais le garde « il a
     agi » ne testait que `.exec-bloc, .nav-bloc` → double génération. --- */
  const H = charger([
    'Je lis.\n\n```athena-read fichier="C:\\proj\\a.js" debut=1 fin=10\n```',
    'Lu, rien a signaler.',
    'LU ET TERMINE. FINALE.',
  ]);
  const coH = pousser(H.w, 'lis le fichier');
  try { await H.w.genererReponse(coH); } catch (e) { V(false, 'H: genererReponse sans exception', String(e && e.message || e)); }
  V(await attendre(() => H.cap.chat.length >= 2, 6000), 'H: la lecture enchaine le tour',
    'chat=' + H.cap.chat.length + ' read=' + H.cap.read.length);
  await sleep(400);
  const stopsH = msgModele(coH).indexOf('STOP. Tu tournes en rond');
  V(stopsH < 0 && H.cap.chat.length === 2,
    'H: PAS de relance « tour en rond » apres un bloc de lecture (une seule chaine)',
    'chat=' + H.cap.chat.length + ' stop=' + (stopsH >= 0));

  /* --- Scénario I (v20261007) : l'agent qui ne répond pas doit produire une
     erreur HONNÊTE et bornée, jamais une promesse pendante. Les 5 appels
     agent passent désormais par appelAgent() (borne + AbortController
     enregistré → annulable par ■). On teste les deux moitiés :
     (1) le helper seul avec un agent muet (promesse jamais résolue) — il doit
         rejeter avec « Délai dépassé » ;
     (2) bout en bout, un /api/read qui échoue doit produire une observation
         rendue au modèle (« lecture impossible »), donc une relance. --- */
  const I = charger(['Je tente.\n\n```athena-read fichier="C:\\proj\\b.js" debut=1 fin=5\n```', 'Verdict : rien à signaler.']);
  const agentMuet = (opts) => new Promise((_, rejeter) => {
    /* « muet » : ne résout jamais ; seule une ABORTION la débloque, comme un
       agent suspendu par le gestionnaire de fenêtres. */
    const sig = opts && opts.signal;
    if (!sig) { rejeter(new Error('pas de signal')); return; }
    const t = setTimeout(() => { try { sig.abort(); } catch (_) {} }, 40);
    sig.addEventListener('abort', () => {
      clearTimeout(t);
      rejeter(Object.assign(new Error('aborte'), { name: 'AbortError' }));
    }, { once: true });
  });
  I.w.fetch = ((f) => function (input, opts) {
    const url = typeof input === 'string' ? input : '';
    if (url.indexOf('/api/read?micro') === 0) return agentMuet(opts);
    if (url.indexOf('/api/read') === 0) return Promise.reject(new Error('agent local injoignable (simule)'));
    return f(input, opts);
  })(I.w.fetch);

  /* (1) le helper : muet + borne courte → rejet honnête et rapide */
  const departI1 = Date.now();
  const issueI1 = await Promise.race([
    I.w.appelAgent('/api/read?micro=1', {}, 300)
      .then(() => 'RESOLU (inattendu)').catch((e) => String((e && e.message) || e).slice(0, 60)),
    sleep(3000).then(() => 'PROMESSE PENDANTE (bug)'),
  ]);
  V(/^Délai dépassé/.test(issueI1) && Date.now() - departI1 < 2500,
    'I1: agent muet -> appelAgent rejette avec « Délai dépassé » (pas de promesse pendante)',
    issueI1 + ' en ' + (Date.now() - departI1) + ' ms');

  /* (2) bout en bout : erreur agent -> observation rendue -> relance */
  const coI = pousser(I.w, 'lis b.js');
  const departI2 = Date.now();
  try { await I.w.genererReponse(coI); } catch (e) { /* attendu */ }
  V(await attendre(() => msgModele(coI).indexOf('lecture impossible') >= 0, 6000),
    'I2: erreur agent -> observation rendue au modele (« lecture impossible »)',
    msgModele(coI).slice(-140));
  V(I.cap.chat.length >= 2 && Date.now() - departI2 < 20000,
    'I2: la chaine enchaine et le tour se termine vite (pas de blocage indefini)',
    'chat=' + I.cap.chat.length + ' en ' + (Date.now() - departI2) + ' ms');

  /* --- Scénario J (v20261007) : la frappe de repli (machine a ecrire) est
     INTERRUPTIBLE, et le compteur de generations retombe a zero apres un
     arret. Avant : controleurEnCours etait relache avant reveler(), donc le
     bouton ■ ne pouvait rien arreter et `occupé` restait bloque. --- */
  const J = charger(['LIGNE_' + 'x'.repeat(400)]);
  const coJ = pousser(J.w, 'raconte');
  const pJ = J.w.genererReponse(coJ);
  await attendre(() => J.w.document.querySelector('.diffusion') !== null, 4000);
  J.w.document.dispatchEvent(new J.w.Event('visibilitychange'));
  pJ.catch(() => {});
  await sleep(250);
  /* l'etat doit etre revenu au calme : occupe false et generationsEnCours 0 */
  const occupeJ = await J.w.eval('(function(){ return typeof occupe !== "undefined" ? occupe : null; })()');
  const genJ = await J.w.eval('(function(){ return typeof generationsEnCours !== "undefined" ? generationsEnCours : null; })()');
  V(genJ === null || genJ === 0, 'J: generationsEnCours retombe a 0 apres le tour',
    'gen=' + genJ);
  V(occupeJ === null || occupeJ === false, 'J: occupe relache (composer de nouveau actif)',
    'occupe=' + occupeJ);
  await sleep(400);
  V(J.cap.chat.length === 1, 'J: un seul appel chat (pas de relance parasites)',
    'chat=' + J.cap.chat.length);

  /* --- Scénario K : le bouton n'est plus figé sur « Arrêter » ---------------
        Garde-fou de comportement, PAS une reproduction démontrée du bug.
        Le défaut corrigé dans chat-demo.js est structurel : `verrouChaine` était
        déclaré `let` À L'INTÉRIEUR de genererReponse, donc invisible de
        deverrouillerChaine() et du handler d'arrêt — aucun autre code ne
        pouvait le remettre à false, alors qu'il conditionne le dé-verrouillage
        (`!generationsEnCours && !verrouChaine`).

        Honnêteté sur la portée : ce scénario exercise une vraie chaîne
        d'outils puis un vrai appui sur le bouton d'arrêt, mais il reste VERT
        même avec le code d'origine réinjecté — l'entrelacement exact qui
        bloque le bouton n'a pas été reproduit ici. Le test verrouille donc le
        comportement attendu (le bouton redevient « Envoyer »), pas la
        régression. La confirmation que le symptôme a disparu reste à faire
        dans l'application.

        On vérifie ce que la PERSONNE voit : le harnais jsdom n'expose pas les
        `let` de premier niveau (le scénario J tolère `null` pour ça). */
     const repK = 'Je continue.\n\n```athena-exec\nWrite-Output TOUR_K\n```';
     const K = charger(new Array(12).fill(repK));
     const coK = pousser(K.w, 'Analyse le depot.');
     const pK = K.w.genererReponse(coK).catch(() => {});
     await attendre(() => K.cap.chat.length >= 2, 8000);
     await attendre(() => K.cap.exec.length >= 1, 8000);
     /* l'utilisateur appuie sur le bouton : occupe est vrai -> c'est l'arrêt */
     K.w.document.getElementById('form').dispatchEvent(new K.w.Event('submit', { cancelable: true, bubbles: true }));
     await sleep(900);
     const btnK = await K.w.eval('(function(){ var b=document.getElementById("btn"); return b ? { enCours: b.classList.contains("en-cours"), titre: b.title } : null; })()');
     V(Boolean(btnK) && btnK.enCours === false, 'K: le bouton n est plus en mode Arreter', JSON.stringify(btnK));
     V(Boolean(btnK) && /Envoyer/.test(btnK.titre || ''), 'K: le bouton porte de nouveau le libelle Envoyer', JSON.stringify(btnK));
     await pK;
     await sleep(500);
     const chatFinK = K.cap.chat.length;
     await sleep(700);
     V(K.cap.chat.length === chatFinK, 'K: plus aucune relance apres l arret', 'chat=' + K.cap.chat.length);
     const btnK2 = await K.w.eval('(function(){ var b=document.getElementById("btn"); return b ? { enCours: b.classList.contains("en-cours"), titre: b.title } : null; })()');
     V(Boolean(btnK2) && btnK2.enCours === false && /Envoyer/.test(btnK2.titre || ''),
       'K: le bouton reste libere une fois le deballage termine', JSON.stringify(btnK2));

     console.log(echecs ? `  RESULTAT: ${echecs} ECHEC(S)` : '  RESULTAT: 43/43 OK');
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
