const { chromium } = require(process.env.PW + '/node_modules/playwright');

/* Round 2 : on vise ce qui casse vraiment.
   - les retraits recents (les references mortes ne se voient pas sur l accueil)
   - la concurrence d'actions (deux clics, arret en cours, changement de vue)
   - le quota de stockage (la panne la plus silencieuse d'une app locale)
   - un balayage systematique de tous les boutons
*/

const BUGS = [];
const bug = (t, d) => BUGS.push('  BUG  ' + t + (d ? ' :: ' + d : ''));

async function main() {
  const browser = await chromium.launch();
  const neuf = async (w) => {
    const p = await browser.newPage({ viewport: { width: w || 1400, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:3000', { waitUntil: 'load' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(1900);
    return { p, errs };
  };

  /* ---------- 9. References mortes : le code touche-t-il encore ce qui est parti ? ---------- */
  {
    const { p, errs } = await neuf();
    const morts = ['nav-code', 'nav-artefacts', 'btn-journal', 'journal-actif-nom', 'liste-projets', 'ajouter-projet'];
    // tout le DOM, sur toutes les vues
    const vus = await p.evaluate((ids) => {
      const trouve = {};
      ids.forEach(i => { trouve[i] = document.getElementById(i) ? 'present' : 'absent'; });
      return trouve;
    }, morts);
    Object.keys(vus).forEach(k => { if (vus[k] === 'present') bug('element retire mais toujours dans le DOM : #' + k); });
    // et surtout : le JS ne doit plus les demander
    const demandes = await p.evaluate((ids) => {
      const trouve = ids.filter(i => typeof document.getElementById(i) !== 'undefined' && document.getElementById(i));
      return trouve;
    }, morts);
    // on force l'ouverture de chaque panneau pouruve d'ecouteurs louches
    for (const [nom, f] of [
      ['projets', () => afficherProjets()],
      ['parametres', () => afficherParametres()],
      ['journal', () => afficherJournal()],
    ]) {
      try { await p.evaluate(f); await p.waitForTimeout(500); } catch (e) { bug('vue ' + nom + ' leve', e.message); }
    }
    errs.forEach(e => bug('retraits : erreur JS', e));
    console.log('  [9] elements retires : ' + JSON.stringify(vus));
    await p.close();
  }

  /* ---------- 10. Balayage de tous les boutons de la barre laterale ---------- */
  {
    const { p, errs } = await neuf();
    await p.evaluate(() => { for (let i = 1; i <= 3; i++) conversations.push({ id: 'c' + i, titre: 'Conv ' + i, messages: [{ role: 'user', contenu: 'a' }, { role: 'bot', contenu: 'b' }], maj: Date.now() }); rendreConversations(); });
    await p.waitForTimeout(400);
    const n = await p.evaluate(() => document.querySelectorAll('.side button, header button').length);
    // on clique chaque bouton tour a tour, en fermant ce qui s'ouvre
    let i = 0;
    while (i < 80) {
      const nb = await p.evaluate(() => document.querySelectorAll('.side button, header button').length);
      if (!nb || i >= nb) break;
      const avant = await p.evaluate(() => document.querySelectorAll('.side button, header button').length);
      await p.evaluate((idx) => {
        const b = document.querySelectorAll('.side button, header button')[idx];
        if (b) { try { b.click(); } catch (e) { window.__errClic = String(e && e.message || e); } }
      }, i);
      await p.waitForTimeout(220);
      const clicErr = await p.evaluate(() => window.__errClic || null);
      if (clicErr) bug('clic sur un bouton de la barre laterale leve', clicErr);
      // on referme ce qui pourrait rester ouvert
      await p.keyboard.press('Escape');
      await p.evaluate(() => { try { fermerMenusConvo(); fermerHudJournal(); document.querySelectorAll('.chat-shell > .hud, .hud').forEach(h => { if (!h.hidden) h.hidden = true; }); } catch (e) {} });
      const apres = await p.evaluate(() => document.querySelectorAll('.side button, header button').length);
      // un clic ne doit pas deduire des elements du DOM
      if (apres < avant - 3) bug('le clic sur un bouton retire des elements du DOM', avant + ' -> ' + apres + ' au bouton ' + i);
      i++;
      i++;
    }
    errs.forEach(e => bug('balayage des boutons : erreur JS', e));
    console.log('  [10] ' + i + ' boutons de barre laterale cliques');
    await p.close();
  }

  /* ---------- 11. Quota de stockage plein ---------- */
  {
    const { p, errs } = await neuf();
    const r = await p.evaluate(() => {
      // on remplit le quota, puis on tente d'ecrire une vraie conversation
      try { localStorage.setItem('athena.remplissage', 'y'.repeat(5 * 1024 * 1024)); } catch (e) { return { rempli: false, e: e.name }; }
      let sauvegarde = 'ok';
      try {
        conversations.push({ id: 'q', titre: 'Apres quota', messages: [{ role: 'user', contenu: 'z'.repeat(100000) }, { role: 'bot', contenu: 'w'.repeat(100000) }], maj: Date.now() });
        sauverConversations();
      } catch (e) { sauvegarde = e.name + ': ' + e.message; }
      const localisee = Array.isArray(conversations) && conversations.some(c => c.id === 'q');
      return { rempli: true, sauvegarde, localisee };
    });
    if (r.rempli && r.sauvegarde !== 'ok') {
      // une erreur de quota est legitime, mais elle ne doit pas rester non geree :
      // l'utilisateur doit toujours pouvoir repartir
      const apres = await p.evaluate(() => { try { conversations = conversations.filter(c => c.id !== 'q'); sauverConversations(); return 'recupere'; } catch (e) { return 'bloque: ' + e.name; } });
      console.log('  [11] quota plein : ' + r.sauvegarde + ' -> apres nettoyage ' + apres);
      if (apres.startsWith('bloque')) bug('quota plein : impossible de s apeurer apres saturation', apres);
    } else {
      console.log('  [11] quota plein : pas de saturation atteinte');
    }
    errs.forEach(e => bug('quota de stockage : erreur JS non rattrapee', e));
    await p.close();
  }

  /* ---------- 12. Verrou d envoi : acquisition et liberation naturelle ----------
     LIMITE ASSUMEE, et elle est importante : cet environnement de test NE PEUT
     PAS simuler un flux qui reste ouvert. Playwright remplit une reponse d un
     seul bloc, donc le flux se termine toujours aussitot ; aucun abort n est
     declenche, et « cliquer sur Arreter pendant un flux vivant » reste NON
     VERIFIE ici.
     Deux erreurs ont ete commises avant de le savoir, et il vaut mieux les
     laisser tracees que les effacer :
       - le mock visait «/api/chat » alors que la vraie route d envoi est
         «/api/relais » : aucune interception n avait lieu, chaque « flux »
         etait en realite un echec 503 instantane ;
       - le delai de grace ARRET_GRACE_MS = 5000 (reconciliation toutes les
         2000 ms) faisait croire a un verrou bloque alors qu il attendait.
     Pour couvrir ce cas il faut un endpoint qui ecoule vraiment, pas un mock. */
  {
    const { p, errs } = await neuf();
    await p.route('**/api/relais', r => r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"type":"jeton","canal":"reponse","texte":"bonjour"}\n\ndata: {"type":"fin"}\n\n' }));
    await p.fill('#saisie', 'premier');
    await p.evaluate(() => { const b = document.getElementById('btn'); b.click(); b.click(); b.click(); });
    let delai = null;
    const t0 = Date.now();
    for (let i = 0; i < 80; i++) { await p.waitForTimeout(100); if (await p.evaluate(() => occupe) === false) { delai = Date.now() - t0; break; } }
    if (delai === null) bug('envoi : le verrou n est jamais libere', 'toujours occupe apres 8 s');
    const final = await p.evaluate(() => ({ occupe, enCours: document.getElementById('btn').classList.contains('en-cours') }));
    if (final.occupe === true || final.enCours === true) bug('envoi : le bouton reste sur « Arreter »', JSON.stringify(final));
    errs.forEach(e => bug('envoi : erreur JS', e));
    console.log('  [12] verrou libere en ' + (delai === null ? 'JAMAIS' : delai + ' ms') + ' (3 clics envoyes)');
    await p.close();
  }
  /* ---------- 13. Re-rendus repetes : boucle de mutation ---------- */
  {
    const { p, errs } = await neuf();
    await p.evaluate(() => { for (let i = 1; i <= 5; i++) conversations.push({ id: 'd' + i, titre: 'D ' + i, messages: [{ role: 'user', contenu: 'a' }, { role: 'bot', contenu: 'b' }], maj: Date.now() }); });
    const t0 = Date.now();
    await p.evaluate(() => { for (let k = 0; k < 60; k++) rendreConversations(); });
    const ms = Date.now() - t0;
    if (ms > 8000) bug('rendus repetes : ' + 60 + ' rendus en ' + ms + ' ms (ralentissement)');
    const noeuds = await p.evaluate(() => document.querySelectorAll('.convo-ligne').length);
    if (noeuds !== 6) bug('rendus repetes : le DOM ne revient pas a l etat attendu', noeuds + ' lignes au lieu de 6 (5 posees + 1 semee a froid)');
    // et la memoire d'ecouteurs : un bouton qui s accumule
    const nbBoutons = await p.evaluate(() => document.querySelectorAll('.convo-menu').length);
    if (nbBoutons !== 6) bug('rendus repetes : nombre de boutons incoherent', String(nbBoutons) + ' (6 attendu : 5 posees + 1 semee)');
    errs.forEach(e => bug('rendus repetes : erreur JS', e));
    console.log('  [13] 60 rendus : ' + ms + ' ms, ' + noeuds + ' lignes, ' + nbBoutons + ' boutons');
    await p.close();
  }

  /* ---------- 14. Thème clair : les tokens non definis cassent le contraste ---------- */
  {
    for (const theme of ['light', 'dark']) {
      const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await p.goto('http://localhost:3000', { waitUntil: 'load' });
      await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); localStorage.clear(); }, theme);
      await p.reload({ waitUntil: 'load' });
      await p.waitForTimeout(1800);
      const r = await p.evaluate(() => {
        const racine = getComputedStyle(document.documentElement);
        const noms = ['--texte', '--texte-doux', '--bord', '--bord-fort', '--carte', '--primaire', '--danger-texte', '--ambre-texte', '--gris-fond', '--ombre', '--rayon', '--rayon-s', '--rayon-l'];
        const manquants = noms.filter(n => !racine.getPropertyValue(n).trim());
        // contraste texte principal / fond de page
        const lire = (s) => s.match(/[\d.]+/g).map(Number);
        const c = lire(getComputedStyle(document.body).color);
        const fond = lire(getComputedStyle(document.body).backgroundColor);
        const lum = (rgb) => { const a = rgb.slice(0,3).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; };
        const L1 = lum(c), L2 = lum(fond);
        const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
        return { manquants, ratio: Math.round(ratio*100)/100, couleur: c.join(','), fond: fond.join(',') };
      });
      if (r.manquants.length) bug('theme ' + theme + ' : tokens non definis', r.manquants.join(', '));
      if (r.ratio < 4.5) bug('theme ' + theme + ' : contraste du corps de texte insuffisant', r.ratio + ':1 (min 4.5) couleur=' + r.couleur + ' fond=' + r.fond);
      console.log('  [14] theme ' + theme + ' : contraste ' + r.ratio + ':1, tokens manquants=' + r.manquants.length);
      await p.close();
    }
  }

  await browser.close();
}

main().then(() => {
  console.log('');
  if (BUGS.length) {
    console.log('=== ' + BUGS.length + ' BUG(S) TROUVE(S) ===');
    BUGS.forEach(b => console.log(b));
  } else {
    console.log('=== aucun bug trouve ===');
  }
}).catch(e => { console.error('CRASH DU TEST LUI-MEME :', e.message); process.exit(2); });