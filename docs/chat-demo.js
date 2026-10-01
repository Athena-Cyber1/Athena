/* Fond 3D Three.js SUPPRIMÉ (design simple demandé par l'utilisateur) : le
   canvas #bg était déjà masqué par CSS mais le module (≈1 Mo depuis un CDN)
   continuait de se charger et de rendre 60 images/s en tâche de fond — CPU
   et RAM gaspillés pour un décor invisible. Le module démarre désormais
   immédiatement (l'attente de 3,5 s du chargement CDN a disparu aussi). */

/* ============================================================
   v20260922j — Passe « audit 15 bugs » (4 critiques / 7 moyens / 4 faibles)
   1  filtre localStorage no-op -> normalisation défensive
   2  NDJSON : dernière ligne sans \n + flush dec.decode()
   3  réponse JAMAIS rendue dans une autre vue (garde + toast « Ouvrir »)
   4  envoi bloqué pendant un upload + confirmation fichiers échoués
   5  verrou occupe AVANT les modales (double Entrée -> 2 générations)
   6  requête de recherche effacée quand le champ est masqué
   7  échec HTTP non-NDJSON : plus de re-POST aveugle (double capture)
   8  ordre question / étiquettes Entraînement (append unique)
   9  PATCH/DELETE entrainer : vérif r.ok + signature stable anti-décalage
   10 upload 422 -> failed explicite (puce plus bloquée sur « indexation »)
   11 retrait pendant upload -> purge serveur différée (file_id connu)
   12 re-lecture de la saisie après modale (texte édité écrasé)
   13 Alt + A (joindre) et Alt + E (export) branchés et documentés
   14 copie de repli try/finally (textarea + fini() garantis)
   15 « Nouveau » ne réutilise plus une conversation épinglée vide
   ============================================================ */

/* ============================================================
   v20260922k — Passe « audit P0/P1 serveur » (concordance route.ts/sidecar)
   16 « Vider les conversations » envoie {confirm:true} — le serveur refuse
      désormais TOUT DELETE sans confirmation explicite (audit 10.9/12.8)
   ============================================================ */

/* ============================================================
   v20260922l — Passe « audit P2 » (client + concordance sidecar v9.7)
   17 garde taille upload AVANT lecture base64 (borne serveur 20 Mo) —
      plus de fichier de 25 Mo encodé en RAM pour un 413 garanti
   18 QuotaExceeded : repli dégradé (éviction des plus vieilles non
      épinglées) + alerte unique — la persistance ne meurt plus en silence
   19 synchronisation inter-onglets (event storage) sans reboucle
   20 sondes/rappels JSON : AbortSignal.timeout — plus de fetch fantôme
      pendant indéfiniment si la passerelle ne répond jamais
   21 pastille « nouvelle réponse » : comptage des SEULES bulles IA
      réellement ajoutées (un re-rendu de vue ne gonfle plus le badge)
   22 Alt+R : volontairement INCHANGÉ (choix explicite de l'utilisateur)
   ============================================================ */

/* ============================================================
   Chat local — démo autonome avec fond 3D Three.js
   Thème : rouge #E02600 / encre #1C1A1A sur #F0F0F0
   ============================================================ */

const $ = (id) => document.getElementById(id);
/* v9.4 — sécurité (audit) : les hooks window.__atelier* étaient exposés en
   prod (surface d'attaque + empreinte). Ils ne sont publiés QUE avec ?qa
   dans l'URL (tests automatisés) ; l'application n'y touche jamais. */
const MODE_QA = new URLSearchParams(location.search).has('qa');
function publierHooks(nom, obj) { if (MODE_QA) window[nom] = obj; }
const msgsEl = $('msgs'), saisieEl = $('saisie'), btnEl = $('btn');
const titreConversationEl = $('titre-conversation'), partagerEl = $('partager');
/* v20261001 : liste des fichiers de la conversation (bouton à gauche de
   « Partager ») + HUD interpréteur HTML à droite (la page se rétracte). */
const listeFichiersEl = $('liste-fichiers'), panneauFichiersEl = $('panneau-fichiers');
const zoneFichiersEl = document.querySelector('.zone-fichiers');
const pageDemoEl = document.querySelector('.page-demo');
const interpreteurEl = $('interpreteur'), interpreteurNomEl = $('interpreteur-nom');
const interpreteurCodeEl = $('interpreteur-code'), interpreteurCadreEl = $('interpreteur-cadre');
const interpreteurExeEl = $('interpreteur-exe'), interpreteurFermerEl = $('interpreteur-fermer');
const interpreteurCorpsEl = $('interpreteur-corps'), interpreteurSplitEl = $('interpreteur-split'), interpreteurToggleEl = $('interpreteur-toggle');
const interpreteurBordEl = $('interpreteur-bord');
const saisieMirrorEl = $('saisie-mirror'), modelePiedEl = $('modele-pied');
const navProjetsEl = $('nav-projets'), navArtefactsEl = $('nav-artefacts');
const navCodeEl = $('nav-code'), navPersonnaliserEl = $('nav-personnaliser');
const statutEl = $('statut'), dotEl = $('dot');
const fichiersEl = $('fichiers'), attacherEl = $('attacher'), apercuFichiersEl = $('file-preview');
const compteurSaisieEl = $('compteur-saisie');
const nouvelleDiscussionEl = $('nouvelle-discussion');
const ouvrirProjetsEl = $('ouvrir-projets'), ouvrirParametresEl = $('ouvrir-parametres');
const ajouterProjetEl = $('ajouter-projet'), plierConversationsEl = $('plier-conversations'), listeConversationsEl = $('liste-conversations');
const ouvrirCompteEl = $('ouvrir-compte'), menuCompteEl = $('menu-compte');
const basculeSidebarEl = $('bascule-sidebar');
const gererCompteEl = $('gerer-compte'), preferencesCompteEl = $('preferences-compte'), aideCompteEl = $('aide-compte');

/* ————— Jeu d'icônes SVG inline (traits, courants hérités) —————
   Remplace les glyphes Unicode (✎ ⤓ × ↑ ↓ ⧉ ✓ ■ ↵ › …) par un jeu
   d'icônes homogène : stroke=currentColor, 1.7, extrémités arrondies. */
const SVG_ICOS = {
  pencil: '<path d="M4.5 19.5h4L19.8 8.2a2.1 2.1 0 0 0-3-3L5.5 16.5v3z"/><path d="m14.5 6.5 3 3"/>',
  download: '<path d="M12 4.5v10m0 0 3.5-3.5M12 14.5 8.5 11"/><path d="M5 19.5h14"/>',
  x: '<path d="m7.5 7.5 9 9m0-9-9 9"/>',
  /* v20260926c (affichage) : la carte fichier utilisait icoSvg('file') qui
     n'existait pas → repli sur la croix X (lu comme « fermer »). */
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
  pin: '<path d="M12 20.5v-6.5"/><path d="M8.8 4.5h6.4l-1 6 2.3 2.3H7.5l2.3-2.3z"/>',
  pinOff: '<path d="M12 20.5v-6.5"/><path d="M8.8 4.5h6.4l-1 6 2.3 2.3H7.5l2.3-2.3z"/><path d="m4.5 4.5 15 15"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  stop: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none"/>',
  send: '<path d="M12 19V5.5M6 11l6-5.5L18 11"/>',
  alert: '<path d="M12 4.5 3 19.5h18z"/><path d="M12 10v3.5M12 16.5h.01"/>',
  terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 9.5 10.2 12 7 14.5"/><path d="M12 14.5h5"/>',
  folder: '<path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.2L11 6.5h7A2.5 2.5 0 0 1 20.5 9v7.5A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"/>',
  layers: '<path d="m12 3 7 4-7 4-7-4 7-4Z"/><path d="m5 12 7 4 7-4M5 17l7 4 7-4"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  briefcase: '<path d="M4 8.5h16v11H4zM8 8.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2.5M4 12h16M10 12v2h4v-2"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  volume: '<path d="M5 10v4h3l4 3V7l-4 3H5Z"/><path d="M15 9.5a3 3 0 0 1 0 5M17.5 7a6 6 0 0 1 0 10"/>',
  thumbUp: '<path d="M7 10v10H4V10h3ZM7 20h8.2a2 2 0 0 0 1.9-1.4l1.8-5.5A2 2 0 0 0 17 10h-4l.7-3.1A2.2 2.2 0 0 0 11.5 4L7 10"/>',
  thumbDown: '<path d="M7 14V4H4v10h3ZM7 4h8.2a2 2 0 0 1 1.9 1.4l1.8 5.5A2 2 0 0 1 17 14h-4l.7 3.1a2.2 2.2 0 0 1-2.2 2.9L7 14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4L4 9"/><path d="M4 4v5h5M4 13a8 8 0 0 0 14.7 4L20 15"/><path d="M20 20v-5h-5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
};

/* Version chaîne (pas un nœud DOM) — pour injecter une icône dans du HTML
   construit par concaténation/innerHTML (ex. markdownInline). icoSvg()
   reste la version DOM pour la construction programmatique habituelle. */
function icoSvgTexte(nom) {
  return '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true">' + (SVG_ICOS[nom] || SVG_ICOS.x) + '</svg>';
}
function icoSvg(nom) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = SVG_ICOS[nom] || SVG_ICOS.x;
  return svg;
}

let messages = [];   // référence vers les messages de la conversation OUVERTE
let occupe = false;
let fichiersJoints = [];
/* v20260926a (pièces jointes) : contenu TEXTUEL lu côté navigateur à l'ajout
   du fichier, indexé par file_id. Non persisté (les conversations gardent
   file_id, name et des métadonnées d'affichage) : la lecture est donc valable
   pour la SESSION en cours, y compris après la purge des puces (envoyer) et
   pendant une régénération. */
const contenusFichiers = new Map();
/* v20260922l (21) : true PENDANT un re-rendu complet de vue (changement de
   conversation) — l'observateur de pastille ignore ces mutations-là. */
let renduVueEnCours = false;

function tailleFichier(octets) {
  if (octets < 1024 * 1024) return Math.max(1, Math.round(octets / 1024)) + ' Ko';
  return (octets / (1024 * 1024)).toFixed(1) + ' Mo';
}

function extensionFichier(nom) {
  const base = String(nom || '').split(/[\\/]/).pop() || '';
  const point = base.lastIndexOf('.');
  if (point <= 0 || point === base.length - 1) return '';
  return base.slice(point + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4).toUpperCase();
}

/* ---------- v9.5 — File Ingestion Layer : VRAI upload des fichiers ----------
   Les fichiers ne sont plus « cousus » dans le texte du message : ils sont
   envoyés au sidecar (POST /api/files, base64) qui détecte le vrai type
   (magic bytes), extrait le contenu (PDF, DOCX, XLSX, PPTX, CSV, JSON,
   code, archives, texte, binaire -> métadonnées), le découpe en segments
   (chunks) et l'indexe (registry SQLite). À l'envoi, seul le file_id part
   dans attachments[] — le moteur retrouve les segments pertinents de CE
   fichier et les injecte comme FILE_DATA (donnée NON FIABLE, règle 9). */
const API_FILES = '/api/files';
const MAX_FICHIERS = 10;             // borne serveur : FICHIER_MAX_ATTACHMENTS
/* v20260922l (17) : même borne que le sidecar (MAX_OCTETS_INGEST, 50 Mo).
   Contrôle AVANT lecture FileReader : un fichier trop gros ne gonfle plus la
   RAM en base64 (+33 %) pour récolter un 413 garanti. */
const MAX_OCTETS_CLIENT = 52428800; // 50 Mio (affiché « 50,0 Mo »)
/* v20260922l (20) : délai d'abandon pour les appels JSON rapides (sondes,
   état entraînement, purges). AbortSignal.timeout n'existe pas sur les
   vieux navigateurs -> repli sans signal (comportement historique). */
const PEUT_TIMEOUT = typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function';
function delaiFetch(ms) { return PEUT_TIMEOUT ? AbortSignal.timeout(ms) : undefined; }
function fichierVersBase64(fichier) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => rejeter(lecteur.error);
    lecteur.onload = () => {
      const brut = String(lecteur.result || '');   // data:*/*;base64,XXXX
      resoudre(brut.slice(brut.indexOf(',') + 1));
    };
    lecteur.readAsDataURL(fichier);
  });
}
async function uploaderFichier(fichier) {
  const content_base64 = await fichierVersBase64(fichier);
  const r = await fetch(API_FILES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: fichier.name, content_base64 }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 422) {
    throw new Error(d.erreur || 'upload impossible (' + r.status + ')');
  }
  /* v20260922j (bug 10) : « d.status || 'uploaded' » rendait un 422 en puce
     « … indexation » éternelle (état non terminal, jamais attachable). Seuls
     les états TERMINAUX (indexed/failed) sortent d'ici ; tout le reste est
     un échec explicite avec sa raison. */
  const indexe = d.status === 'indexed' || (r.ok && d.file_id && !d.status);
  return {
    file_id: d.file_id || null,
    name: d.filename || fichier.name,
    size: fichier.size,
    status: indexe ? 'indexed' : 'failed',
    chunks: d.chunks || 0,
    erreur: indexe ? null : (d.raison || d.erreur || (r.status === 422
      ? 'type de fichier non pris en charge'
      : 'échec du traitement (' + r.status + ')')),
  };
}
async function ajouterFichiers(liste) {
  for (const fichier of Array.from(liste || [])) {
    if (fichiersJoints.length >= MAX_FICHIERS) {
      boiteModale({ titre: 'Limite de pièces jointes',
        message: MAX_FICHIERS + ' fichiers maximum par message.',
        labelOk: 'OK', info: true }).catch(() => {});
      break;
    }
    /* v20260922l (17) : refus AVANT lecture — même borne que le serveur. */
    if (fichier.size > MAX_OCTETS_CLIENT) {
      boiteModale({ titre: 'Fichier trop volumineux',
        message: '« ' + fichier.name + ' » pèse ' + tailleFichier(fichier.size)
          + ' — la limite est de ' + tailleFichier(MAX_OCTETS_CLIENT) + ' par fichier.',
        labelOk: 'OK', info: true }).catch(() => {});
      continue;
    }
    /* puce immédiate (« … envoi »), mise à jour à la fin du transfert */
    const attente = { name: fichier.name, size: fichier.size, status: 'uploading', chunks: 0, file_id: null, erreur: null };
    fichiersJoints.push(attente);
    afficherFichiers(); majBouton();
    try {
      Object.assign(attente, await uploaderFichier(fichier));
    } catch (e) {
      attente.status = 'failed';
      attente.erreur = (e && e.message) || 'transfert impossible';
    }
    /* v20260926a (pièces jointes) : on garde en mémoire le contenu TEXTUEL du
       fichier — seul moyen pour les chemins sans serveur (Pages) de faire
       lire le fichier au modèle. Borne stricte + sniffer binaire ; si c'est du
       binaire ou trop gros, rien n'est retenu (le nom reste joint). */
    if (attente.file_id) {
      const texte = await lireTexteSiPossible(fichier);
      if (texte) contenusFichiers.set(attente.file_id, texte);
    }
    /* v20260922j (bug 11) : retrait PENDANT l'upload -> le file_id n'est
       connu qu'ici : purge serveur différée ; la puce ne revient pas. */
    if (attente.abandonne) {
      if (attente.file_id) {
        fetch(API_FILES + '?id=' + attente.file_id, { method: 'DELETE', signal: delaiFetch(5000) }).catch(() => {});
      }
      const idx = fichiersJoints.indexOf(attente);
      if (idx >= 0) fichiersJoints.splice(idx, 1);
    }
    afficherFichiers(); majBouton();
  }
}
/* Seuls les fichiers INDEXÉS partent avec le message. Les métadonnées
   d'affichage restent locales : le schéma /api/chat ne conserve que
   file_id et name. */
function attachmentsEnvoyes() {
  return fichiersJoints
    .filter((f) => f.file_id && f.status === 'indexed')
    .map((f) => {
      const sortie = { file_id: f.file_id, name: f.name };
      if (Number.isFinite(f.size)) sortie.size = f.size;
      if (Number.isFinite(f.chunks)) sortie.chunks = f.chunks;
      if (f.status) sortie.status = f.status;
      return sortie;
    });
}
/* v9.5 : /chat-attache était une passerelle vers un proxy dédié — ce chemin
   n'existe plus côté Next (404) ni côté Pages (handler identique). /api/chat
   accepte les pièces jointes (schéma + transmission au sidecar en FILE_DATA),
   on l'utilise donc TOUJOURS. /chat-attache reste géré par le shim pour la
   compatibilité des pages mises en cache. */
function endpointChat() {
  return '/api/chat';
}
/* v20260926a (pièces jointes) : borne de lecture NAVIGATEUR (le serveur a sa
   propre borne de découpage/indexation). Au-delà, on lit le DÉBUT seul avec
   mention de troncature — jamais de « trop volumineux » sec pour un texte. */
const MAX_CONTENU_JOINT = 1000000;
const MAX_PIECES = 10;
/* Lecture texte : on ne garde que ce qui ressemble vraiment à du texte — un
   PNG/PDF/DOCX décodé en UTF-8 contient des octets de contrôle et est rejeté. */
function lectureTexte(fichier) {
  return new Promise((resolve) => {
    try {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(typeof lecteur.result === 'string' ? lecteur.result : null);
      lecteur.onerror = () => resolve(null);
      lecteur.readAsText(fichier);
    } catch (e) { resolve(null); }
  });
}
function compteOctetsDeControle(texte) {
  let mauvais = 0;
  for (let i = 0; i < texte.length; i += 1) {
    const code = texte.charCodeAt(i);
    /* tabulation, LF et CR sont admis ; tout autre octet de contrôle = binaire */
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) mauvais += 1;
  }
  return mauvais;
}
async function lireTexteSiPossible(fichier) {
  if (!fichier || fichier.size <= 0) return null;
  /* v1.2 (audit) : un texte de 219 Ko n'est ni « binaire » ni « trop
     volumineux » — on lit le début (1 Mo) avec mention, au lieu de null. */
  const tronque = fichier.size > MAX_CONTENU_JOINT;
  const source = tronque && typeof fichier.slice === 'function' ? fichier.slice(0, MAX_CONTENU_JOINT) : fichier;
  const texte = await lectureTexte(source);
  if (texte == null || !texte.length) return null;
  if (compteOctetsDeControle(texte) / texte.length > 0.02) return null;
  return tronque ? texte + '\n[…fichier volumineux : début seul transmis…]' : texte;
}
/* v20260926a : le contenu lu part UNIQUEMENT au moment de l'appel (jamais
   persisté avec la conversation — seuls file_id, name et des métadonnées
   d'affichage sont stockés). */
function enrichirPieces(pieces) {
  if (!pieces || !pieces.length) return [];
  return pieces.slice(0, MAX_PIECES).map((p) => {
    const piece = p || {};
    const sortie = { file_id: piece.file_id };
    if (piece.name) sortie.name = piece.name;
    const contenu = piece.file_id ? contenusFichiers.get(piece.file_id) : null;
    if (contenu) sortie.contenu = contenu;
    return sortie;
  });
}
function majBouton() {
  // Pendant une génération, le bouton sert à ARRÊTER (il reste actif)
  btnEl.disabled = occupe ? false : (!saisieEl.value.trim() && fichiersJoints.length === 0);
}
function afficherFichiers() {
  apercuFichiersEl.replaceChildren();
  fichiersJoints.forEach((fichier, index) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    if (fichier.status === 'failed') chip.classList.add('echec');
    const nom = document.createElement('span');
    nom.className = 'file-chip-name';
    /* v1.2 (anti-bâclage) : binaire indexé mais sans texte lisible côté
       navigateur (PDF/image) — sur Pages, sans sidecar, le modèle n'a rien
       à lire et invente : on l'affiche dans la puce au lieu de le taire. */
    const sansTexte = fichier.status === 'indexed' && fichier.file_id
      && !contenusFichiers.get(fichier.file_id);
    const etat = fichier.status === 'indexed'
      ? '✓ indexé · ' + (fichier.chunks || 0) + ' seg.' + (sansTexte ? ' · ⚠ texte non lisible' : '')
      : fichier.status === 'failed'
      ? 'échec : ' + (fichier.erreur || 'extraction impossible')
      : '… ' + (fichier.status === 'uploading' ? 'envoi' : 'indexation');
    nom.textContent = fichier.name + ' · ' + tailleFichier(fichier.size || 0) + ' · ' + etat;
    if (fichier.status === 'indexed') {
      chip.title = 'Fichier indexé côté serveur — les segments pertinents seront fournis au modèle (FILE_DATA).'
        + (sansTexte ? ' Sans texte lisible côté navigateur (binaire ou volumineux) : en mode Pages le modèle ne pourra pas le lire.' : '');
    } else if (fichier.status === 'failed') {
      chip.title = (fichier.erreur || 'Extraction impossible') + ' — ce fichier ne sera pas transmis.';
    }
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'file-chip-remove';
    retirer.setAttribute('aria-label', 'Retirer ' + fichier.name);
    retirer.appendChild(icoSvg('x'));
    retirer.addEventListener('click', () => {
      /* v20260922j (bug 11) : retrait pendant l'upload — file_id encore
         inconnu, aucun DELETE possible immédiatement. La puce est marquée
         « abandonnée » : la purge serveur aura lieu dès la fin du transfert
         (ajouterFichiers). indexOf évite tout splice sur index obsolète. */
      fichier.abandonne = true;
      const idx = fichiersJoints.indexOf(fichier);
      if (idx >= 0) fichiersJoints.splice(idx, 1);
      if (fichier.file_id) {
        fetch(API_FILES + '?id=' + fichier.file_id, { method: 'DELETE', signal: delaiFetch(5000) }).catch(() => {});
      }
      afficherFichiers();
      majBouton();
    });
    chip.append(nom, retirer);
    apercuFichiersEl.appendChild(chip);
  });
}

function afficherVue(titre, description, contenu) {
  msgsEl.replaceChildren();
  const vue = document.createElement('section');
  vue.className = 'workspace-view';
  const h = document.createElement('h2');
  h.textContent = titre;
  const p = document.createElement('p');
  p.textContent = description;
  vue.append(h, p);
  if (contenu) vue.appendChild(contenu);
  msgsEl.appendChild(vue);
}

/* ---------- Journal et requêtes envoyées ---------- */
const URL_JOURNAL_AGENT = 'http://127.0.0.1:3020/journal?limit=200';
function heureCourte(ts) {
  try { return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return ''; }
}
function tableauSimple(entetes, lignes) {
  const table = document.createElement('table');
  table.className = 'journal-table';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  entetes.forEach((h) => { const th = document.createElement('th'); th.textContent = h; tr.appendChild(th); });
  thead.appendChild(tr);
  const tbody = document.createElement('tbody');
  lignes.forEach((cells) => {
    const row = document.createElement('tr');
    cells.forEach((c) => { const td = document.createElement('td'); td.textContent = c; row.appendChild(td); });
    tbody.appendChild(row);
  });
  table.append(thead, tbody);
  const cadre = document.createElement('div');
  cadre.className = 'journal-cadre';
  cadre.appendChild(table);
  return cadre;
}
async function chargerJournalAgent() {
  const r = await fetch(URL_JOURNAL_AGENT, { signal: delaiFetch(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return Array.isArray(d.entrees) ? d.entrees : [];
}
function afficherJournal() {
  msgsEl.replaceChildren();
  const vue = document.createElement('section');
  vue.className = 'workspace-view journal-view';
  const h = document.createElement('h2');
  h.textContent = 'Journal et requêtes';
  const intro = document.createElement('p');
  intro.textContent = 'Tout ce qui a été envoyé : commandes et écritures de l’agent local, et requêtes de vos discussions.';
  const barre = document.createElement('div');
  barre.className = 'journal-barre';
  const retour = document.createElement('button');
  retour.type = 'button';
  retour.className = 'journal-btn';
  retour.textContent = '← Retour à la discussion';
  retour.addEventListener('click', () => ouvrirConversation(idConversation));
  const rafraichir = document.createElement('button');
  rafraichir.type = 'button';
  rafraichir.className = 'journal-btn';
  rafraichir.textContent = '↻ Actualiser';
  rafraichir.addEventListener('click', () => afficherJournal());
  barre.append(retour, rafraichir);
  vue.append(h, intro, barre);
  /* — Agent local : exécutions + écritures — */
  const hAgent = document.createElement('h3');
  hAgent.textContent = 'Agent local (exécutions et fichiers)';
  vue.appendChild(hAgent);
  const zoneAgent = document.createElement('div');
  zoneAgent.textContent = 'Chargement…';
  vue.appendChild(zoneAgent);
  chargerJournalAgent().then((entrees) => {
    zoneAgent.replaceChildren();
    if (!entrees.length) {
      zoneAgent.textContent = 'Aucune entrée — aucune commande ni écriture enregistrée pour le moment.';
      return;
    }
    const lignes = [...entrees].reverse().map((e) => {
      if (e && e.ecriture) {
        return [heureCourte(e.ts), 'écriture', String(e.ecriture).slice(-80), 'oui', tailleFichier(e.octets || 0) + (e.ecrase ? ' (remplacé)' : '')];
      }
      return [heureCourte(e.ts), 'commande', String((e && e.commande) || '').slice(0, 80), (e && e.ok) ? 'oui' : 'non (code ' + ((e && e.code) ?? '?') + ')', ((e && e.duree_ms) ?? '?') + ' ms'];
    });
    zoneAgent.appendChild(tableauSimple(['Heure', 'Type', 'Détail', 'Réussi', 'Mesure'], lignes));
  }).catch(() => {
    zoneAgent.textContent = 'Agent local injoignable (127.0.0.1:3020) — démarrez node mini-services/local-agent/index.js pour voir son journal.';
  });
  /* — Requêtes des discussions — */
  const hReq = document.createElement('h3');
  hReq.textContent = 'Requêtes envoyées (discussions)';
  vue.appendChild(hReq);
  let totalMessages = 0;
  let totalPieces = 0;
  const lignes = conversations.map((c) => {
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    const questions = msgs.filter((m) => m && m.role === 'user').length;
    const pieces = msgs.reduce((n, m) => n + (Array.isArray(m.attachments) ? m.attachments.length : 0), 0);
    totalMessages += msgs.length;
    totalPieces += pieces;
    return [c.titre || 'Sans titre', String(questions), String(pieces), heureCourte(c.maj)];
  });
  const resume = document.createElement('p');
  resume.textContent = conversations.length + ' discussion(s), ' + totalMessages + ' message(s), ' + totalPieces + ' pièce(s) jointe(s).';
  vue.append(resume, tableauSimple(['Discussion', 'Questions', 'Pièces jointes', 'Dernière activité'], lignes));
  msgsEl.appendChild(vue);
}

/* ---------- Conversations persistées (localStorage) ---------- */
const CLE_CONVOS = 'chat-conversations';
const CLE_COURANTE = 'chat-conversation-courante';
const MAX_CONVOS_UI = 50;

function chargerStockage(nom, defaut) {
  try {
    const v = JSON.parse(localStorage.getItem(nom) || 'null');
    return v ?? defaut;
  } catch { return defaut; }
}
function creerConversation() {
  return { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
           titre: 'Nouvelle discussion', messages: [], maj: Date.now() };
}
let conversations = chargerStockage(CLE_CONVOS, []);
let idConversation = chargerStockage(CLE_COURANTE, null);
if (!Array.isArray(conversations)) conversations = [];
/* v20260922j (bug 1 critique) : le filtre Array.isArray(c.messages || [])
   était un NO-OP — « c.messages || [] » est toujours un tableau. Un seul
   enregistrement corrompu (sans messages) survivait, puis c.messages.length
   tuait tout le module au chargement (sidebar vide, bouton mort).
   Normalisation défensive : chaque conversation reçoit des champs typés
   valides — jamais d'exception au chargement. */
conversations = conversations
  .filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && c.id)
  .map((c) => ({
    ...c,
    titre: typeof c.titre === 'string' && c.titre ? c.titre : 'Nouvelle discussion',
    messages: Array.isArray(c.messages)
      ? c.messages.filter((m) => m && typeof m === 'object' && typeof m.content === 'string')
      : [],
    maj: typeof c.maj === 'number' && Number.isFinite(c.maj) ? c.maj : Date.now(),
  }));
if (conversations.length === 0) conversations = [creerConversation()];
if (!conversations.some((c) => c.id === idConversation)) idConversation = conversations[0].id;

function conversationOuverte() {
  return conversations.find((c) => c.id === idConversation) || conversations[0];
}
let quotaAverti = false;
function sauverConversations() {
  /* Capacité maximale respectée en suivant l'ORDRE D'AFFICHAGE : les
     conversations épinglées (tête de liste) ne sont jamais les premières
     sacrifiées si la limite est atteinte. */
  const ecrire = (convos) => {
    localStorage.setItem(CLE_CONVOS, JSON.stringify(convos));
    localStorage.setItem(CLE_COURANTE, JSON.stringify(idConversation));
  };
  let garde = trierPourAffichage().slice(0, MAX_CONVOS_UI);
  try {
    ecrire(garde);
    quotaAverti = false;
  } catch (e) {
    /* v20260922l (18) : QuotaExceeded n'est plus un silence total — on
       réessaie en sacrifiant les plus vieilles conversations NON épinglées
       (l'ouverte est toujours conservée) ; en dernier recours, une alerte
       UNIQUE prévient que la persistance est saturée.
       v20260926d (kimi) : les victimes sont AUSSI retirées de `conversations`
       (pas seulement de la copie `garde`) — sinon elles revenaient à la
       sauvegarde suivante (échec en boucle) puis disparaissaient au
       rechargement. */
    const victimes = [];
    let ecritOk = false;
    while (garde.length > 1) {
      const victime = garde
        .map((c, i) => ({ c, i }))
        .filter((x) => !x.c.epingle && x.c.id !== idConversation)
        .sort((a, b) => a.c.maj - b.c.maj)[0];
      if (!victime) break;
      victimes.push(victime.c.id);
      garde.splice(victime.i, 1);
      try { ecrire(garde); quotaAverti = false; ecritOk = true; break; } catch { /* on continue d'élaguer */ }
    }
    if (victimes.length) {
      conversations = conversations.filter((c) => !victimes.includes(c.id));
      try { rendreConversations(); } catch { /* DOM pas prêt (sauvegarde précoce) */ }
    }
    if (ecritOk) return;
    /* v20260926d : le bandeau masqué à la main réapparaît à l'échec suivant
       (son titre le promettait déjà). */
    const bandeauExistant = document.getElementById('bandeau-stockage');
    if (bandeauExistant) bandeauExistant.hidden = false;
    if (!quotaAverti) {
      quotaAverti = true;
      try {
        afficherBandeauStockage();
      } catch { /* toast pas encore prêt (sauvegarde très précoce) */ }
    }
  }
}

/* Bandeau PERSISTANT (role=alert) tant que le stockage reste saturé —
   un toast 6 s était le seul avertissement et pouvait être manqué. */
function afficherBandeauStockage() {
  if (document.getElementById('bandeau-stockage')) return;
  const shell = document.querySelector('.chat-shell');
  if (!shell) return;
  const b = document.createElement('div');
  b.id = 'bandeau-stockage';
  b.className = 'bandeau-persistant';
  b.setAttribute('role', 'alert');
  const msg = document.createElement('span');
  msg.textContent = 'Stockage local saturé : les nouveaux messages ne seront plus sauvegardés. Exportez vos conversations.';
  b.appendChild(msg);
  const actions = document.createElement('span');
  actions.className = 'bandeau-actions';
  const btnExport = document.createElement('button');
  btnExport.type = 'button';
  btnExport.textContent = 'Exporter (Alt+E)';
  btnExport.addEventListener('click', () => {
    exporterToutesConversations();
  });
  actions.appendChild(btnExport);
  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.textContent = 'Masquer';
  btnClose.title = 'Masquer cet avertissement (réapparaîtra si le stockage reste plein)';
  btnClose.addEventListener('click', () => { b.hidden = true; });
  actions.appendChild(btnClose);
  b.appendChild(actions);
  shell.insertBefore(b, shell.firstChild);
}

/* v20260922l (19) : synchronisation inter-onglets — localStorage est PARTAGÉ
   par origine : quand un autre onglet écrit (nouvelle conversation, message,
   renommage), celui-ci recharge et réaffiche. AUCUNE écriture ici (sinon
   rebouclage des events entre onglets) ; et rien du tout pendant une
   génération (occupe) pour ne pas casser l'état en cours. */
window.addEventListener('storage', (e) => {
  if (e.key !== CLE_CONVOS || occupe) return;
  const convos = chargerStockage(CLE_CONVOS, null);
  if (!Array.isArray(convos) || convos.length === 0) return;
  conversations = convos
    .filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && c.id)
    .map((c) => ({
      ...c,
      titre: typeof c.titre === 'string' && c.titre ? c.titre : 'Nouvelle discussion',
      messages: Array.isArray(c.messages)
        ? c.messages.filter((m) => m && typeof m === 'object' && typeof m.content === 'string')
        : [],
      maj: typeof c.maj === 'number' && Number.isFinite(c.maj) ? c.maj : Date.now(),
    }));
  if (conversations.length === 0) conversations = [creerConversation()];
  if (!conversations.some((c) => c.id === idConversation)) {
    idConversation = chargerStockage(CLE_COURANTE, conversations[0].id);
  }
  if (!conversations.some((c) => c.id === idConversation)) idConversation = conversations[0].id;
  const c = conversationOuverte();
  messages = c.messages;
  renduVueEnCours = true;             // re-rendu ≠ nouvelles réponses
  try {
    msgsEl.replaceChildren();
    if (c.messages.length === 0) exemplesInitiaux();
    else c.messages.forEach((m) => {
      try {
        bulle(m.role === 'user' ? 'user' : 'assistant', m.content, m.outil, { verification: m.verification, rag: m.rag, raisonnement: m.raisonnement, attachments: m.attachments || null, traces: m.traces || null });
      } catch { bulle('assistant', '(message non affiché — erreur de rejeu)'); }
    });
    rendreConversations();
  } finally {
    /* l'observateur tourne en microtask : le reset passe par un macrotask */
    setTimeout(() => { renduVueEnCours = false; }, 0);
  }
  try { notifier('Conversations mises à jour dans un autre onglet.'); } catch { /* toast pas prêt */ }
});
/* Les aperçus (titre sidebar + extrait) ne montrent jamais de Markdown brut
   (ex. « ```athena-file… » affiché tel quel dans la liste). */
function nettoyerApercu(texte) {
  let t = String(texte || '');
  t = t.replace(/```\s*athena-file\s+([^\n`]+)[\s\S]*?(?:```|$)/gi, '[fichier : $1]');
  t = t.replace(/```\s*athena-exec\b[\s\S]*?(?:```|$)/gi, '[commande]');
  t = t.replace(/```/g, '');
  t = t.replace(/^\s*(#{1,6}\s+|>+\s*|[-*•]\s+|\d+[.)]\s+)/gm, '');
  return t.replace(/\s+/g, ' ').trim();
}
function titreDepuis(texte) {
  const premiereLigne = nettoyerApercu((texte || '').split('\n')[0]).trim();
  if (!premiereLigne) return 'Nouvelle discussion';
  return premiereLigne.length > 30 ? premiereLigne.slice(0, 30) + '…' : premiereLigne;
}
/* Aperçu sobre sous le titre (2e ligne de la conversation) + heure. */
function apercuConversation(c) {
  /* v1.2 : les messages _exec (journal technique des commandes, poussé pour
     le modèle) ne doivent JAMAIS apparaître pour l'humain — avant, la
     sidebar affichait « Vous : Commande(s) exécutée(s)… » comme dernière
     activité, masquant la vraie réponse. */
  const dernier = [...(c.messages || [])].reverse().find((m) => m && !m._exec && m.content && String(m.content).trim());
  if (!dernier) return 'Conversation vide';
  const t = nettoyerApercu(dernier.content);
  return (dernier.role === 'user' ? 'Vous : ' : '') + (t.length > 72 ? t.slice(0, 72) + '…' : t);
}
function heureCourt(ts) {
  /* v20260926d (kimi) : Date invalide ne lève pas — toLocaleTimeString
     rendrait la chaîne "Invalid Date" dans la sidebar. */
  const n = Number(ts);
  if (!Number.isFinite(n)) return '';
  try { return new Date(n).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
/* Ordre d'affichage des conversations : épinglées d'abord (tête de liste),
   activité récente au sein de chaque groupe. Source unique partagée par le
   rendu de la liste, le renommage (correspondance index DOM) et la sauvegarde. */
function trierPourAffichage() {
  return [...conversations].sort((a, b) =>
    (Number(Boolean(b.epingle)) - Number(Boolean(a.epingle))) || (b.maj - a.maj));
}
function majTitreConversation() {
  const c = conversationOuverte();
  if (titreConversationEl && c) titreConversationEl.textContent = c.titre;
}
function rendreConversations() {
  majTitreConversation();
  if (!listeConversationsEl) return;
  listeConversationsEl.replaceChildren();
  trierPourAffichage().forEach((c) => {
    const ligne = document.createElement('div');
    ligne.className = 'convo-ligne' + (c.epingle ? ' epinglee' : '');
    ligne.dataset.convoId = c.id;
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'side-item conversation-item' + (c.id === idConversation ? ' active' : '');
    bouton.title = c.titre;
    const l1 = document.createElement('span');
    l1.className = 'side-item-l1';
    if (c.epingle) l1.appendChild(icoSvg('pin'));
    const libelle = document.createElement('span');
    libelle.className = 'side-item-label';
    libelle.textContent = c.titre;
    l1.appendChild(libelle);
    const l2 = document.createElement('span');
    l2.className = 'side-item-l2';
    const extrait = document.createElement('span');
    extrait.className = 'convo-extrait';
    extrait.textContent = apercuConversation(c);
    const horloge = document.createElement('span');
    horloge.className = 'convo-h';
    horloge.textContent = heureCourt(c.maj);
    l2.append(extrait, horloge);
    bouton.append(l1, l2);
    bouton.addEventListener('click', () => ouvrirConversation(c.id));
    const renommer = document.createElement('button');
    renommer.type = 'button';
    renommer.className = 'convo-renommer';
    renommer.appendChild(icoSvg('pencil'));
    renommer.title = 'Renommer';
    renommer.setAttribute('aria-label', 'Renommer « ' + c.titre + ' »');
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'convo-export';
    exportBtn.appendChild(icoSvg('download'));
    exportBtn.title = 'Exporter en Markdown';
    exportBtn.setAttribute('aria-label', 'Exporter « ' + c.titre + ' » en Markdown');
    exportBtn.addEventListener('click', (e) => { e.stopPropagation(); exporterConversation(c.id); });
    const suppr = document.createElement('button');
    suppr.type = 'button';
    suppr.className = 'convo-suppr';
    suppr.appendChild(icoSvg('x'));
    suppr.setAttribute('aria-label', 'Supprimer « ' + c.titre + ' »');
    suppr.title = 'Supprimer';
    suppr.addEventListener('click', (e) => { e.stopPropagation(); supprimerConversation(c.id); });
    const epingle = document.createElement('button');
    epingle.type = 'button';
    epingle.className = 'convo-epingle';
    epingle.appendChild(icoSvg(c.epingle ? 'pinOff' : 'pin'));
    epingle.title = c.epingle ? 'Désépingler' : 'Épingler en haut';
    epingle.setAttribute('aria-label', (c.epingle ? 'Désépingler « ' : 'Épingler « ') + c.titre + ' »');
    epingle.addEventListener('click', (e) => { e.stopPropagation(); basculerEpingle(c.id); });
    ligne.append(bouton, renommer, exportBtn, suppr, epingle);
    listeConversationsEl.appendChild(ligne);
  });
  majRechercheConversations();
  /* La section Projets vit sur les mêmes données (épinglées) — un seul
     point de re-rendu pour éviter toute dérive entre les deux listes. */
  rendreProjets();
}

/* Recherche de conversations (filtrage local instantané, insensible à la
   casse et aux accents). Le champ n'apparaît qu'à partir de 2 conversations.
   v8.11 : recherche PLEIN TEXTE — une conversation dont un MESSAGE contient
   la requête reste visible avec un extrait sobre sous le titre (le rôle de
   l'auteur est indiqué). Les accents décomposés par NFD décalent les indices :
   la position brute est retrouvée via une table de correspondance. */
const rechercheConversationsEl = $('recherche-conversations');
function normaliserRecherche(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function extraitDepuisMessage(m, q) {
  /* v1.2 : pas de recherche dans le journal technique _exec. */
  if (m && m._exec) return null;
  const brut = String(m.content || '').replace(/\s+/g, ' ').trim();
  if (!brut) return null;
  const norm = normaliserRecherche(brut);
  if (!norm.includes(q)) return null;
  const map = [];
  let forme = '';
  for (let i = 0; i < brut.length; i++) {
    const f = normaliserRecherche(brut[i]);
    for (let j = 0; j < f.length; j++) map.push(i);
    forme += f;
  }
  const idx = forme.indexOf(q);
  const debut = map[idx] ?? 0;
  const fin = (map[Math.min(idx + q.length - 1, map.length - 1)] ?? brut.length - 1) + 1;
  const rayon = 36;
  const s = Math.max(0, debut - rayon);
  const e = Math.min(brut.length, fin + rayon);
  return (s > 0 ? '… ' : '') + brut.slice(s, e) + (e < brut.length ? ' …' : '');
}
function extraitConversation(c, q) {
  for (const m of c.messages) {
    const extrait = extraitDepuisMessage(m, q);
    if (extrait) return (m.role === 'user' ? 'Vous : ' : 'Assistant : ') + extrait;
  }
  return '';
}
function filtrerConversations() {
  if (!rechercheConversationsEl || !listeConversationsEl) return;
  const q = normaliserRecherche(rechercheConversationsEl.value.trim());
  let visibles = 0;
  listeConversationsEl.querySelectorAll('.convo-ligne').forEach((ligne) => {
    const c = conversations.find((x) => x.id === ligne.dataset.convoId);
    const label = ligne.querySelector('.side-item-label');
    const texte = normaliserRecherche(label ? label.textContent : '');
    const corresTitre = q !== '' && texte.includes(q);
    let extrait = '';
    if (q.length >= 2 && c) extrait = extraitConversation(c, q);
    ligne.hidden = q !== '' && !corresTitre && !extrait;
    if (!ligne.hidden) visibles++;
    const el = ligne.querySelector('.convo-extrait');
    const horloge = ligne.querySelector('.convo-h');
    if (el) {
      if (extrait) { el.textContent = extrait; el.hidden = false; if (horloge) horloge.hidden = true; }
      else {
        el.textContent = c ? apercuConversation(c) : '';
        el.hidden = false;
        if (horloge) { horloge.hidden = q !== ''; }
      }
    }
  });
  const aucun = document.getElementById('aucun-resultat');
  if (aucun) aucun.hidden = !(q !== '' && visibles === 0);
}
function majRechercheConversations() {
  if (!rechercheConversationsEl) return;
  /* v20260922j (bug 6) : champ masqué (< 2 convos) mais requête encore
     active -> sidebar « brickée » (lignes masquées, aucun moyen d'effacer).
     La requête est réinitialisée en même temps que le masquage. */
  if (conversations.length < 2) {
    rechercheConversationsEl.hidden = true;
    if (rechercheConversationsEl.value) rechercheConversationsEl.value = '';
    /* v20260926o (audit) : sans champ, la rangée (loupe seule) n'a aucun
       sens — on la referme. */
    document.querySelector('.side-recherche')?.classList.remove('ouverte');
  } else {
    rechercheConversationsEl.hidden = false;
  }
  filtrerConversations();
}
if (rechercheConversationsEl) {
  rechercheConversationsEl.addEventListener('input', filtrerConversations);
  rechercheConversationsEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      rechercheConversationsEl.value = '';
      filtrerConversations();
    }
  });
}
publierHooks('__atelierRecherche', { filtrer: filtrerConversations, extrait: extraitConversation }); /* hook QA — non utilisé par l'interface */
function ouvrirConversation(id) {
  idConversation = id;
  /* v20261001 : l'interpréteur HUD et le panneau fichiers dépendent de LA
     conversation affichée — toute création/changement de conversation les
     ferme (sinon le HUD persiste avec le code de l'ancienne discussion). */
  fermerInterpreteur();
  fermerHudFichier();
  basculerPanneauFichiers(false);
  /* v20260926e (kimi) : la voix ne continue pas sur une conversation
     détruite/reaffichée. */
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch {}
  const c = conversationOuverte();
  messages = c.messages;
  /* v20260922l (21) : un re-rendu complet de vue n'est pas une « nouvelle
     réponse » — l'observateur de pastille ignore ces mutations (le flag est
     rendu faux en MACROTASK, après la microtask de l'observateur). */
  renduVueEnCours = true;
  try {
    msgsEl.replaceChildren();
    if (c.messages.length === 0) exemplesInitiaux();
    else c.messages.forEach((m) => {
      /* v1.2 : les messages _exec (journal technique des commandes, pour le
         modèle uniquement) ne REJOUENT pas en bulles visibles — avant, à
         chaque réouverture on voyait des bulles « Vous : Commande(s)
         exécutée(s)… === RÉSULTAT DE TA DERNIÈRE COMMANDE === », comme si le
         modèle recréait des messages. C'est le défaut exact « il recrée un
         message au lieu de continuer ». */
      if (m && m._exec) return;
      /* v7.2.2 : UN message corrompu (ancien format, champ inattendu) ne doit
         JAMAIS tuer tout le rejeu ni la sidebar - on rend un placeholder et on
         continue (avant : exception -> module mort au chargement). */
      try {
        bulle(m.role === 'user' ? 'user' : 'assistant', m.content, m.outil, { verification: m.verification, rag: m.rag, raisonnement: m.raisonnement, attachments: m.attachments || null, traces: m.traces || null });
      } catch (e) {
        if (console && console.warn) console.warn('rejeu : message non rendu', e);
        bulle('assistant', '(message non affiché - erreur de rejeu)');
      }
    });
    rendreConversations();
    sauverConversations();
  } finally {
    setTimeout(() => { renduVueEnCours = false; }, 0);
  }
  saisieEl.focus();
  /* v1.2 (audit UI) : après (re)chargement ou changement de conversation, on
     repart d'en BAS (dernier message) — sans ça l'utilisateur atterrit en
     haut, au premier message. Respecte defilementAuto. */
  if (preferences.defilementAuto !== false) {
    requestAnimationFrame(() => { try { msgsEl.scrollTop = msgsEl.scrollHeight; } catch {} });
  }
}
async function supprimerConversation(id) {
  const c = conversations.find((x) => x.id === id);
  if (!c) return;
  /* v20260926d (kimi) : supprimer la conversation ACTIVE pendant une
     génération détache le tableau où la réponse en vol est poussée —
     réponse perdue en silence. On refuse, sans ambiguïté. */
  if (id === idConversation && occupe) {
    boiteModale({ titre: 'Génération en cours',
      message: '« ' + c.titre + ' » reçoit une réponse : attendez la fin (ou stoppez-la) avant de la supprimer.',
      labelOk: 'OK', info: true }).catch(() => {});
    return;
  }
  /* v9.4 : modale sobre au lieu de window.confirm (non stylé, bloquant) */
  if (c.messages.length > 0) {
    const accord = await boiteModale({
      titre: 'Supprimer la conversation ?',
      message: '« ' + c.titre + ' » et ses ' + c.messages.length + ' message' + (c.messages.length > 1 ? 's' : '') + ' seront définitivement effacés.',
      labelOk: 'Supprimer', labelAnnuler: 'Annuler', danger: true,
    });
    if (!accord) return;
  }
  conversations = conversations.filter((x) => x.id !== id);
  if (conversations.length === 0) conversations = [creerConversation()];
  if (idConversation === id) idConversation = conversations[0].id;
  sauverConversations();
  ouvrirConversation(idConversation);
}
function nouvelleDiscussion() {
  /* v20260922j (bug 15) : ne réutilise qu'une conversation vide NON épinglée
     — un projet épinglé (même vide) n'est pas un brouillon à écraser. */
  const vide = conversations.find((c) => c.messages.length === 0 && !c.epingle);
  if (vide) return ouvrirConversation(vide.id);
  const c = creerConversation();
  conversations.push(c);
  sauverConversations();
  ouvrirConversation(c.id);
}

/* ---------- Copie de messages ---------- */
function copierTexteRepli(texte, fini) {
  /* v20260922j (bug 14) : un execCommand qui lançait laissait la textarea
     dans le DOM (fuite) et sautait fini() (aucun retour visuel) — le bloc
     try/finally garantit le nettoyage et le retour dans TOUS les cas. */
  const z = document.createElement('textarea');
  z.value = texte;
  z.setAttribute('readonly', '');
  z.style.position = 'fixed';
  z.style.opacity = '0';
  document.body.appendChild(z);
  try {
    z.select();
    document.execCommand('copy');
    fini();
  } catch { /* copie impossible */ }
  finally { z.remove(); }
}
function copierTexte(texte, bouton) {
  const fini = () => {
    bouton.replaceChildren(icoSvg('check'));
    bouton.classList.add('copie-ok');
    setTimeout(() => { bouton.replaceChildren(icoSvg('copy')); bouton.classList.remove('copie-ok'); }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texte).then(fini).catch(() => copierTexteRepli(texte, fini));
  } else copierTexteRepli(texte, fini);
}

/* ---------- v9.4 — Modale sobre (remplace confirm/prompt/alert natifs) ----------
   Les boîtes natives ne sont pas stylées, bloquent le thread de rendu et
   cassent l'identité sobre de l'atelier. Composant minimal à promesse :
   attente non bloquante, Escape = annuler, Entrée = confirmer, focus géré. */
function boiteModale({ titre, message, champ = null, labelOk = 'Confirmer', labelAnnuler = 'Annuler', danger = false, info = false }) {
  return new Promise((resoudre) => {
    /* v20260926d (kimi) : pile des modales — Escape ne ferme que la DERNIÈRE
       (avant, deux modales empilées se fermaient d'un coup : stopPropagation
       ne bloque pas les autres listeners document). */
    if (!window.__modalesAthena) window.__modalesAthena = [];
    const precedentFocus = document.activeElement;
    const voile = document.createElement('div');
    voile.className = 'voile-modale';
    voile.setAttribute('role', 'dialog');
    voile.setAttribute('aria-modal', 'true');
    voile.setAttribute('aria-label', titre);
    const boite = document.createElement('div');
    boite.className = 'modale';
    const h = document.createElement('h3');
    h.textContent = titre;
    const p = document.createElement('div');
    p.className = 'modale-message';
    p.textContent = message;
    boite.append(h, p);
    let input = null;
    if (champ !== null) {
      input = document.createElement('input');
      input.className = 'modale-champ';
      input.value = champ;
      input.maxLength = 60;
      input.setAttribute('aria-label', titre);
      boite.appendChild(input);
    }
    const actions = document.createElement('div');
    actions.className = 'modale-actions';
    const fermer = (ok) => {
      document.removeEventListener('keydown', surTouche);
      const pile = window.__modalesAthena || [];
      const idx = pile.indexOf(voile);
      if (idx >= 0) pile.splice(idx, 1);
      voile.remove();
      /* v20260926d : le focus revient à l'élément déclencheur. */
      try {
        if (precedentFocus && precedentFocus.isConnected && typeof precedentFocus.focus === 'function') precedentFocus.focus();
      } catch { /* focus optionnel */ }
      resoudre(ok ? (champ !== null ? (input.value.trim() || null) : true) : null);
    };
    if (!info) {
      const annuler = document.createElement('button');
      annuler.type = 'button';
      annuler.textContent = labelAnnuler;
      annuler.addEventListener('click', () => fermer(false));
      actions.appendChild(annuler);
    }
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = labelOk;
    ok.className = danger ? 'modale-danger' : 'modale-principal';
    ok.addEventListener('click', () => fermer(true));
    actions.appendChild(ok);
    boite.appendChild(actions);
    voile.appendChild(boite);
    voile.addEventListener('mousedown', (e) => { if (e.target === voile) fermer(false); });
    const piegerTab = (e) => {
      const focusables = [...voile.querySelectorAll('button, input, [tabindex]')].filter((el) => !el.disabled);
      if (!focusables.length) return;
      const premier = focusables[0];
      const dernier = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    };
    const surTouche = (e) => {
      /* v20260926d : seule la modale du dessus réagit (pile) + piège Tab. */
      const pile = window.__modalesAthena || [];
      if (pile.length && pile[pile.length - 1] !== voile) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fermer(false); return; }
      if (e.key === 'Tab') piegerTab(e);
    };
    document.addEventListener('keydown', surTouche);
    window.__modalesAthena.push(voile);
    document.body.appendChild(voile);
    /* NB : le focus va au champ (ou au bouton) ; Escape/Entrée sont traités
       LOCALEMENT (puis stopPropagation) car stopPropagation empêcherait
       sinon l'événement d'atteindre le listener document — Échap semblerait
       inopérant (bug attrapé par la QA navigateur v9.4). */
    const surToucheChamp = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fermer(true); }
      else if (e.key === 'Escape') { e.preventDefault(); fermer(false); }
      /* v20260926d : le piège Tab vit aussi ici — ce handler stoppe la
         propagation, la version document ne verrait jamais Tab sinon. */
      else if (e.key === 'Tab') piegerTab(e);
      e.stopPropagation(); // pas de raccourci global du chat derrière la modale
    };
    if (input) {
      input.addEventListener('keydown', surToucheChamp);
      input.focus();
      input.select();
    } else {
      ok.addEventListener('keydown', surToucheChamp);
      ok.focus();
    }
  });
}

/* ---------- v20260922j — Toast sobre (notification non bloquante) ----------
   Une réponse terminée PENDANT que l'utilisateur est ailleurs (autre
   conversation, Paramètres) ne doit ni être injectée dans la mauvaise vue
   ni disparaître sans un mot : toast discret avec action « Ouvrir »,
   auto-dismiss 6 s, un seul à la fois (bug 3). */
let toastActif = null;
function notifier(message, action) {
  if (toastActif) toastActif.remove();
  /* v20260926d (kimi) : appel précoce (avant le rendu du shell) = crash. */
  const shellEl = document.querySelector('.chat-shell');
  if (!shellEl) return;
  const t = document.createElement('div');
  t.className = 'toast-notice';
  t.setAttribute('role', 'status');
  const span = document.createElement('span');
  span.className = 'toast-message';
  span.textContent = message;
  t.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label || 'Ouvrir';
    b.addEventListener('click', () => {
      t.remove();
      if (toastActif === t) toastActif = null;
      action.action();
    });
    t.appendChild(b);
  }
  shellEl.appendChild(t);
  toastActif = t;
  setTimeout(() => {
    if (!t.isConnected) return;
    t.classList.add('part');
    setTimeout(() => {
      t.remove();
      if (toastActif === t) toastActif = null;
    }, 260);
  }, 6000);
}

/* ---------- Export Markdown (une conversation ou toutes) ---------- */
function slugFichier(titre) {
  const base = (titre || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return base || 'conversation';
}
function horodatageFichier() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}
function dateLisible(ms) {
  try { return new Date(ms || Date.now()).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }); }
  catch { return ''; }
}
function extrasMessageMarkdown(m) {
  const notes = [];
  if (m.outil && m.outil.nom) {
    /* mêmes libellés que les badges de l'interface (bulle()) */
    const noms = { curl: 'requête curl', recherche_web: 'recherche web', lecture_page: 'lecture de page' };
    const hote = (m.outil.sources && m.outil.sources[0]) ? m.outil.sources[0].replace(/^https?:\/\//, '').split('/')[0] : '';
    notes.push('Outil : ' + (noms[m.outil.nom] || m.outil.nom) + (hote ? ' — ' + hote : ''));
  }
  if (m.verification && m.verification.statut && m.verification.statut !== 'ok') {
    notes.push('Vérification : ' + (m.verification.detail || m.verification.statut));
  }
  if (m.rag && m.rag.utilise) notes.push('Réponse appuyée sur la base de connaissances locale');
  return notes;
}
function conversationVersMarkdown(c) {
  const lignes = [];
  lignes.push('# ' + (c.titre || 'Conversation'));
  lignes.push('');
  const dateMaj = dateLisible(c.maj);
  const n = (c.messages || []).length;
  lignes.push('*Exportée le ' + dateLisible(Date.now()) + ' · ' + n + ' message' + (n > 1 ? 's' : '') + (dateMaj ? ' · dernière activité le ' + dateMaj : '') + '*');
  lignes.push('');
  lignes.push('---');
  lignes.push('');
  (c.messages || []).forEach((m) => {
    lignes.push('## ' + (m.role === 'user' ? 'Vous' : 'Assistant'));
    lignes.push('');
    lignes.push(m.content || '');
    lignes.push('');
    const notes = extrasMessageMarkdown(m);
    notes.forEach((note) => lignes.push('> ' + note));
    if (notes.length) lignes.push('');
    if (Array.isArray(m.raisonnement) && m.raisonnement.length) {
      /* v20260926g : export AGRÉGÉ (texte continu + phases), jamais la
         frise de tranches. */
      const agg = agregerRaisonnement(m.raisonnement);
      lignes.push('<details><summary>Raisonnement</summary>');
      lignes.push('');
      if (agg.transitions.length) {
        agg.transitions.forEach((t) => lignes.push('- ' + t));
        lignes.push('');
      }
      if (agg.texte) {
        lignes.push(agg.texte);
        lignes.push('');
      }
      lignes.push('</details>');
      lignes.push('');
    }
    lignes.push('---');
    lignes.push('');
  });
  return lignes.join('\n');
}
function telechargerMarkdown(nomFichier, contenu) {
  const blob = new Blob([contenu], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exporterConversation(id) {
  const c = conversations.find((x) => x.id === id) || conversationOuverte();
  if (!c) return;
  telechargerMarkdown(slugFichier(c.titre) + '-' + horodatageFichier() + '.md', conversationVersMarkdown(c));
}
function exporterToutesConversations() {
  const tri = [...conversations].sort((a, b) => (a.maj || 0) - (b.maj || 0));
  /* v20260922m (F17) : le produit s'appelle Athéna — plus de marque
     « Atelier IA » héritée dans l'entête et le nom de fichier. */
  const entete = '# Athéna — export des conversations\n\n*' + tri.length + ' conversation' + (tri.length > 1 ? 's' : '') + ' exportée' + (tri.length > 1 ? 's' : '') + ' le ' + dateLisible(Date.now()) + '*\n\n---\n';
  const parties = tri.map((c) => conversationVersMarkdown(c));
  telechargerMarkdown('athena-conversations-' + horodatageFichier() + '.md', entete + '\n' + parties.join('\n\n\n'));
}
/* Accès réservé aux tests/QA (console) — non utilisé par l'interface. */
publierHooks('__atelierExport', { conversationVersMarkdown, exporterConversation, exporterToutesConversations });

/* ---------- Import de conversations exportées (v8.7, section isolée) ----------
   Contrepartie de l'export Markdown : ré-importe vos fichiers .md (un par
   conversation, ou l'export groupé) dans l'application. Le contenu des
   messages est restauré tel quel ; le raisonnement replié est reconstitué ;
   les notes d'affichage (outils, vérification, base locale) ne sont pas
   réimportées — elles décrivaient la réponse d'origine, pas la vôtre. */
function importerConversationsDepuisTexte(texte) {
  const lignes = String(texte || '').split(/\r?\n/);
  /* Découpe en blocs : chaque titre h1 ouvre un bloc jusqu'au h1 suivant. */
  const blocs = [];
  let bloc = null;
  for (const ligne of lignes) {
    const h1 = /^# (.+)$/.exec(ligne);
    if (h1) { bloc = { titre: h1[1].trim(), lignes: [] }; blocs.push(bloc); }
    else if (bloc) bloc.lignes.push(ligne);
  }
  const crees = [];
  for (const b of blocs) {
    /* v20260922m (F17) : entête accepté sous les DEUX marques (rétrocompat
       avec les exports « Atelier IA » déjà produits avant le renommage). */
    if (b.titre === 'Athéna — export des conversations' || b.titre === 'Atelier IA — export des conversations') continue;
    const messages = [];
    let role = null;
    let contenu = [];
    let raisonnement = null;
    let dansDetails = false;
    const pousser = () => {
      if (!role) return;
      while (contenu.length && (/^(---|\s*)$/.test(contenu[contenu.length - 1]))) contenu.pop();
      const msg = { role, content: contenu.join('\n').trim() };
      if (raisonnement && raisonnement.length) msg.raisonnement = raisonnement;
      messages.push(msg);
    };
    for (const ligne of b.lignes) {
      const h2 = /^## (Vous|Assistant)\s*$/.exec(ligne.trim());
      if (h2 && !dansDetails) { pousser(); role = h2[1] === 'Vous' ? 'user' : 'assistant'; contenu = []; raisonnement = null; continue; }
      const t = ligne.trim();
      if (/^<details/i.test(t)) { dansDetails = true; continue; }
      if (/^<\/details>/i.test(t)) { dansDetails = false; continue; }
      if (dansDetails) {
        const puce = /^- (.+)$/.exec(t);
        if (puce) {
          if (!raisonnement) raisonnement = [];
          raisonnement.push({ etape: 'import', message: puce[1] });
        } else if (!/^<summary/i.test(t)) {
          /* v20260926g : le format d'export agrégé met le texte en
             paragraphes (plus en puces) — on le récupère tel quel.
             v20260926g-revue : les lignes vides séparent les paragraphes
             (sans elles tout fusionne en un bloc). */
          if (!raisonnement) raisonnement = [];
          if (!t) {
            const prec0 = raisonnement[raisonnement.length - 1];
            if (prec0 && prec0.etape === 'texte' && !prec0.message.endsWith('\n\n')) prec0.message += '\n\n';
          } else {
            const prec = raisonnement[raisonnement.length - 1];
            if (prec && prec.etape === 'texte') prec.message += (prec.message.endsWith('\n\n') ? '' : '\n') + t;
            else raisonnement.push({ etape: 'texte', message: t });
          }
        }
        continue;
      }
      if (role && t.startsWith('>')) continue; /* notes d'affichage de l'export */
      contenu.push(ligne);
    }
    pousser();
    if (!messages.some((m) => m.role === 'user' && m.content)) continue; /* bloc sans échange : ignoré */
    crees.push({ titre: b.titre || 'Conversation importée', messages });
  }
  return crees;
}
async function importerFichiersMarkdown(fichiers) {
  const liste = Array.from(fichiers || []).filter((f) => /\.(md|markdown|txt)$/i.test(f.name) || f.type === 'text/markdown');
  if (!liste.length) { await boiteModale({ titre: 'Import de conversations', message: 'Aucun fichier .md à importer.', info: true, labelOk: 'Fermer' }); return; }
  const places = Math.max(0, MAX_CONVOS_UI - conversations.length);
  if (!places) { await boiteModale({ titre: 'Import de conversations', message: 'Limite de ' + MAX_CONVOS_UI + ' conversations atteinte — supprimez-en avant d’importer.', info: true, labelOk: 'Fermer' }); return; }
  let importees = 0, ignorees = 0, doublons = 0;
  let premiereId = null;
  for (const fichier of liste) {
    if (importees >= places) { ignorees++; continue; }
    if (fichier.size > 2 * 1024 * 1024) { ignorees++; continue; }
    const texte = await fichier.text();
    for (const conv of importerConversationsDepuisTexte(texte)) {
      if (importees >= places) { ignorees++; break; }
      const sig = conv.titre + '|' + conv.messages.length + '|' + ((conv.messages.find((m) => m.role === 'user') || {}).content || '');
      const memeSignature = (x) => x.titre + '|' + x.messages.length + '|' + ((x.messages.find((m) => m.role === 'user') || {}).content || '');
      if (conversations.some((x) => memeSignature(x) === sig)) { doublons++; continue; }
      const c = creerConversation();
      c.titre = conv.titre;
      c.messages = conv.messages;
      conversations.push(c);
      if (!premiereId) premiereId = c.id;
      importees++;
    }
  }
  if (importees) { sauverConversations(); rendreConversations(); ouvrirConversation(premiereId); }
  /* v9.4 : modales d’information au lieu des window.alert natifs */
  if (!importees && !doublons) {
    await boiteModale({ titre: 'Import de conversations', message: 'Aucune conversation reconnue dans ce fichier (titres « ## Vous » / « ## Assistant » attendus).', info: true, labelOk: 'Fermer' });
  } else if (importees || doublons) {
    const parties = [importees + ' conversation' + (importees > 1 ? 's' : '') + ' importée' + (importees > 1 ? 's' : '')];
    if (doublons) parties.push(doublons + ' déjà présente' + (doublons > 1 ? 's' : ''));
    if (ignorees) parties.push(ignorees + ' fichier' + (ignorees > 1 ? 's' : '') + ' ignoré' + (ignorees > 1 ? 's' : ''));
    await boiteModale({ titre: 'Import de conversations', message: parties.join(' · '), info: true, labelOk: 'Fermer' });
  }
}
const entreeImportFichiers = document.createElement('input');
entreeImportFichiers.type = 'file';
entreeImportFichiers.id = 'import-fichiers';
entreeImportFichiers.accept = '.md,.markdown,.txt,text/markdown';
entreeImportFichiers.multiple = true;
entreeImportFichiers.hidden = true;
entreeImportFichiers.addEventListener('change', () => {
  const fichiers = entreeImportFichiers.files;
  if (fichiers && fichiers.length) importerFichiersMarkdown(fichiers);
  entreeImportFichiers.value = '';
});
document.body.appendChild(entreeImportFichiers);
publierHooks('__atelierImport', { importerConversationsDepuisTexte, importerFichiersMarkdown }); /* hook QA — non utilisé par l'interface */

/* ---------- Renommage d'une conversation (v8.8, section isolée) ----------
   Bouton « ✎ » au survol d'une conversation (même famille que ⤓ / ×) :
   remplace le libellé par un champ inline — Entrée enregistre, Échap
   annule, clic ailleurs enregistre. Délégation d'événements sur la liste
   (le DOM de la sidebar est reconstruit à chaque rendu). */
function renommerDepuisLigne(ligne) {
  if (!ligne || ligne.querySelector('.renommer-conversation')) return;
  /* v20260926d (kimi) : retrouver par id (dataset), jamais par index DOM —
     un index dérive dès que l'ordre change entre rendu et clic. */
  const ligneId = ligne.dataset ? ligne.dataset.convoId : null;
  const c = conversations.find((x) => x.id === ligneId);
  if (!c) return;
  const label = ligne.querySelector('.side-item-label');
  if (!label) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'renommer-conversation';
  input.value = c.titre;
  input.maxLength = 60;
  input.setAttribute('aria-label', 'Nouveau titre de la conversation');
  label.replaceWith(input);
  input.focus();
  input.select();
  let fini = false;
  const terminer = (enregistrer) => {
    if (fini) return;
    fini = true;
    if (enregistrer) {
      const v = input.value.trim();
      if (v) c.titre = v; /* champ vidé : on garde l'ancien titre */
    }
    sauverConversations();
    rendreConversations();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); /* ne pas déclencher les raccourcis globaux */
    if (e.key === 'Enter') { e.preventDefault(); terminer(true); }
    else if (e.key === 'Escape') { e.preventDefault(); terminer(false); }
  });
  input.addEventListener('blur', () => terminer(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}
if (listeConversationsEl) {
  listeConversationsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.convo-renommer');
    if (btn) renommerDepuisLigne(btn.closest('.convo-ligne'));
  });
}

/* ---------- Import par glisser-déposer sur la barre latérale (v8.8) ----------
   Dépose de fichiers .md n'importe où sur la sidebar -> import (même
   pipeline que Paramètres : dédupliques, garde-fous). Retour visuel sobre :
   contour pointillé fin sur la liste des conversations pendant le survol. */
const barreLaterale = document.getElementById('sidebar');
if (barreLaterale && listeConversationsEl) {
  const contientFichiers = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  barreLaterale.addEventListener('dragover', (e) => {
    if (!contientFichiers(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    listeConversationsEl.classList.add('import-md');
  });
  barreLaterale.addEventListener('dragleave', (e) => {
    if (!barreLaterale.contains(e.relatedTarget)) listeConversationsEl.classList.remove('import-md');
  });
  barreLaterale.addEventListener('drop', (e) => {
    listeConversationsEl.classList.remove('import-md');
    if (!contientFichiers(e)) return;
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length) importerFichiersMarkdown(e.dataTransfer.files);
  });
  barreLaterale.addEventListener('dragend', () => listeConversationsEl.classList.remove('import-md'));
}
publierHooks('__atelierRenommer', { renommerDepuisLigne }); /* hook QA — non utilisé par l'interface */

/* ---------- Épinglage d'une conversation (v8.9, section isolée) ----------
   Bouton « ↑ » au survol (4e de la famille ⤓ / ✎ / ×) : la conversation
   passe en tête de liste — épinglées d'abord, ordre d'activité conservé au
   sein du groupe. « ↓ » désépinglant. État visible sans survol : puce encre
   pleine + marqueur discret à la place du bouton. L'état vit avec la
   conversation (localStorage) ; l'export/import Markdown n'y touche pas
   (l'épinglage est une préférence locale, pas du contenu). */
function basculerEpingle(id) {
  const c = conversations.find((x) => x.id === id);
  if (!c) return;
  if (c.epingle) delete c.epingle;
  else c.epingle = true;
  sauverConversations();
  rendreConversations();
}
publierHooks('__atelierEpingler', {
  basculer: basculerEpingle,
  ordre: () => trierPourAffichage().map((c) => (c.epingle ? '▲ ' : '') + c.titre),
  epinglees: () => conversations.filter((c) => c.epingle).map((c) => c.id),
}); /* hook QA — non utilisé par l'interface */

/* ---------- Section « Projets » alimentée par les épinglées (v8.10, section isolée) ----------
   La section Projets de la barre latérale n'est plus un placeholder : elle
   liste les conversations épinglées (source unique d'état : c.epingle,
   ordre = trierPourAffichage). Cliquer ouvre la conversation ; ↓ désépingle
   directement depuis la section. Le rendu est déclenché par
   rendreConversations() — aucune copie de l'état, aucune dérive possible.
   La vue principale (bouton ▣) donne la même liste avec métadonnées et
   actions sobres (Ouvrir / Désépingler). « + » crée désormais une
   conversation Nommée ET épinglée : un projet est persistant (l'ancien
   projet purement DOM disparaissait au rechargement — bug). */
const listeProjetsEl = document.getElementById('liste-projets');
const projetVideEl = document.querySelector('.project-empty');

function rendreProjets() {
  if (!listeProjetsEl) return;
  listeProjetsEl.replaceChildren();
  const epinglees = trierPourAffichage().filter((c) => c.epingle);
  if (projetVideEl) projetVideEl.hidden = epinglees.length > 0;
  epinglees.forEach((c) => {
    const ligne = document.createElement('div');
    ligne.className = 'projet-ligne';
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'side-item projet-item' + (c.id === idConversation ? ' active' : '');
    bouton.title = c.titre;
    const l1 = document.createElement('span');
    l1.className = 'side-item-l1';
    l1.appendChild(icoSvg('pin'));
    const libelle = document.createElement('span');
    libelle.className = 'side-item-label';
    libelle.textContent = c.titre;
    l1.appendChild(libelle);
    bouton.appendChild(l1);
    bouton.addEventListener('click', () => ouvrirConversation(c.id));
    const desepingle = document.createElement('button');
    desepingle.type = 'button';
    desepingle.className = 'projet-desepingle';
    desepingle.appendChild(icoSvg('pinOff'));
    desepingle.title = 'Désépingler';
    desepingle.setAttribute('aria-label', 'Désépingler « ' + c.titre + ' »');
    desepingle.addEventListener('click', (e) => { e.stopPropagation(); basculerEpingle(c.id); });
    ligne.append(bouton, desepingle);
    listeProjetsEl.appendChild(ligne);
  });
}

function afficherProjets() {
  /* Vue de gestion complète : les épinglées d'abord (Ouvrir / Désépingler),
     puis les autres conversations (Ouvrir / Épingler) — on peut ré-épingler
     sans retourner à la liste de la barre latérale (backlog Task 14). */
  const epinglees = trierPourAffichage().filter((c) => c.epingle);
  const autres = trierPourAffichage().filter((c) => !c.epingle);
  const contenu = document.createElement('div');
  contenu.className = 'projets-liste';
  function ligneProjet(c, actionEpingler) {
    const ligne = document.createElement('div');
    ligne.className = 'ligne-projet';
    const copie = document.createElement('div');
    copie.className = 'ligne-projet-copie';
    const titre = document.createElement('span');
    titre.className = 'ligne-projet-titre';
    titre.textContent = c.titre;
    const meta = document.createElement('small');
    const nbMessages = c.messages.length;
    meta.textContent = (nbMessages ? nbMessages + ' message' + (nbMessages > 1 ? 's' : '') : 'vide') + ' · ' + dateLisible(c.maj);
    copie.append(titre, meta);
    const actions = document.createElement('div');
    actions.className = 'ligne-projet-actions';
    const ouvrir = document.createElement('button');
    ouvrir.type = 'button';
    ouvrir.className = 'projet-action';
    ouvrir.textContent = 'Ouvrir';
    ouvrir.addEventListener('click', () => ouvrirConversation(c.id));
    const bascule = document.createElement('button');
    bascule.type = 'button';
    bascule.className = 'projet-action';
    bascule.textContent = actionEpingler ? 'Épingler' : 'Désépingler';
    bascule.addEventListener('click', () => { basculerEpingle(c.id); afficherProjets(); });
    actions.append(ouvrir, bascule);
    ligne.append(copie, actions);
    return ligne;
  }
  if (epinglees.length === 0) {
    const vide = document.createElement('p');
    vide.className = 'projets-vide';
    vide.textContent = 'Aucun projet pour l’instant. Épinglez une conversation ci-dessous (ou ↑ dans la barre latérale).';
    contenu.appendChild(vide);
  } else {
    epinglees.forEach((c) => contenu.appendChild(ligneProjet(c, false)));
  }
  if (autres.length > 0) {
    const separateur = document.createElement('div');
    separateur.className = 'ligne-projet-separateur';
    separateur.textContent = 'Autres conversations';
    contenu.appendChild(separateur);
    autres.forEach((c) => contenu.appendChild(ligneProjet(c, true)));
  }
  afficherVue('Projets', 'Vos espaces de travail : les conversations épinglées de la barre latérale, et les autres à portée de clic.', contenu);
}
publierHooks('__atelierProjets', {
  rendre: rendreProjets,
  afficher: afficherProjets,
  titres: () => trierPourAffichage().filter((c) => c.epingle).map((c) => c.titre),
}); /* hook QA — non utilisé par l'interface */

const preferencesParDefaut = { animationsReduites: false, densiteCompacte: false, defilementAuto: true, confirmationEnvoi: false, sidebarVisible: true, outilsWeb: true, raisonnementVisible: true, executionAuto: false, dossierTravail: '', theme: 'dark', temperature: 0.6, contexteLocal: 32768 };
let preferences = { ...preferencesParDefaut };
try {
  preferences = { ...preferencesParDefaut, ...JSON.parse(localStorage.getItem('chat-preferences') || '{}') };
} catch { /* préférences locales indisponibles */ }

function appliquerPreferences() {
  document.documentElement.classList.toggle('reduce-animation', preferences.animationsReduites);
  document.documentElement.classList.toggle('compact-density', preferences.densiteCompacte);
  /* v1.2 (audit UI) : en mode manuel (executionAuto off), les blocs exec
     redeviennent visibles et cliquables — masqués, aucune exécution manuelle
     n'est possible (dead-end depuis le masquage v20260926h). */
  document.documentElement.classList.toggle('exec-manuel', preferences.executionAuto === false);
  document.getElementById('app').classList.toggle('sidebar-fermee', preferences.sidebarVisible === false);
  /* v20260926l : thème clair/sombre sur toute la page (défaut : sombre). */
  try {
    document.documentElement.dataset.theme = preferences.theme === 'light' ? 'light' : 'dark';
  } catch {}
  majBasculeSidebar();
}
function enregistrerPreference(cle, valeur) {
  preferences[cle] = valeur;
  try { localStorage.setItem('chat-preferences', JSON.stringify(preferences)); } catch { /* stockage optionnel */ }
  appliquerPreferences();
}
function creerLigneOption(titre, description, controle) {
  const ligne = document.createElement('label');
  ligne.className = 'setting-row';
  const copy = document.createElement('span');
  copy.className = 'setting-copy';
  const nom = document.createElement('span');
  nom.textContent = titre;
  const detail = document.createElement('small');
  detail.textContent = description;
  copy.append(nom, detail);
  ligne.append(copy, controle);
  return ligne;
}
/* v20260926l : choix du thème Sombre/Clair (toute la page). */
function creerChoixTheme() {
  const groupe = document.createElement('div');
  groupe.className = 'theme-choix';
  groupe.setAttribute('role', 'group');
  groupe.setAttribute('aria-label', 'Thème de l’interface');
  const boutons = {};
  const rafraichir = () => {
    const clair = preferences.theme === 'light';
    boutons.sombre.setAttribute('aria-pressed', String(!clair));
    boutons.clair.setAttribute('aria-pressed', String(clair));
  };
  [['sombre', 'Sombre', 'dark'], ['clair', 'Clair', 'light']].forEach(([cle, libelle, valeur]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = libelle;
    b.addEventListener('click', () => { enregistrerPreference('theme', valeur); rafraichir(); });
    groupe.appendChild(b);
    boutons[cle] = b;
  });
  rafraichir();
  const ligne = creerLigneOption('Thème', 'Sombre ou clair, sur toute la page.', groupe);
  return ligne;
}
function creerInterrupteur(cle, titre, description) {
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = Boolean(preferences[cle]);
  check.addEventListener('change', () => enregistrerPreference(cle, check.checked));
  return creerLigneOption(titre, description, check);
}
/* v1.2 : curseur de température (0 = précis, 2 = audacieux). */
function creerCurseurTemperature() {
  const zone = document.createElement('span');
  zone.className = 'setting-curseur-zone';
  const curseur = document.createElement('input');
  curseur.type = 'range';
  curseur.min = '0';
  curseur.max = '2';
  curseur.step = '0.1';
  curseur.className = 'setting-curseur';
  const valeur = (typeof preferences.temperature === 'number' && Number.isFinite(preferences.temperature))
    ? Math.max(0, Math.min(2, preferences.temperature)) : 0.6;
  curseur.value = String(valeur);
  curseur.setAttribute('aria-label', 'Température des modèles');
  const pastille = document.createElement('span');
  pastille.className = 'setting-curseur-valeur';
  pastille.textContent = Number(curseur.value).toFixed(1);
  const appliquer = () => {
    const v = Math.max(0, Math.min(2, Math.round(Number(curseur.value) * 10) / 10));
    pastille.textContent = v.toFixed(1);
    enregistrerPreference('temperature', v);
    majBadgeTemp();
  };
  curseur.addEventListener('input', () => { pastille.textContent = Number(curseur.value).toFixed(1); });
  curseur.addEventListener('change', appliquer);
  zone.append(curseur, pastille);
  return creerLigneOption('Température', 'Créativité des réponses : 0 précis, 0,6 équilibré, 2 audacieux. Certains modèles gardent leur réglage.', zone);
}
/* v1.2 (anti-bâclage, item 15) : ligne de réglage numérique (contexte local). */
function creerLigneNombre(cle, titre, description) {
  const champ = document.createElement('input');
  champ.type = 'number';
  champ.className = 'setting-champ';
  champ.min = '1024';
  champ.max = '1000000';
  champ.step = '1024';
  const v = parseInt(preferences[cle], 10);
  champ.value = Number.isFinite(v) && v > 0 ? String(v) : '';
  champ.placeholder = '32768';
  champ.setAttribute('aria-label', titre);
  champ.spellcheck = false;
  champ.addEventListener('change', () => {
    const n = parseInt(champ.value, 10);
    enregistrerPreference(cle, Number.isFinite(n) && n > 0 ? Math.min(n, 1000000) : 32768);
    majBadgeContexte();
  });
  return creerLigneOption(titre, description, champ);
}
/* v20260926e : ligne de réglage avec champ texte (ex. dossier de travail). */
function creerLigneChamp(cle, titre, description, placeholder) {
  const champ = document.createElement('input');
  champ.type = 'text';
  champ.className = 'setting-champ';
  champ.value = typeof preferences[cle] === 'string' ? preferences[cle] : '';
  champ.placeholder = placeholder || '';
  champ.setAttribute('aria-label', titre);
  champ.spellcheck = false;
  champ.addEventListener('change', () => enregistrerPreference(cle, champ.value.trim()));
  return creerLigneOption(titre, description, champ);
}

function afficherParametres(ongletActif = 'Apparence') {
  msgsEl.replaceChildren();
  const vue = document.createElement('section');
  vue.className = 'workspace-view settings-view';
  const entete = document.createElement('div');
  entete.className = 'settings-head';
  const titre = document.createElement('h2');
  titre.textContent = 'Paramètres';
  const intro = document.createElement('p');
  intro.textContent = 'Ajustez l’espace de discussion à votre façon.';
  entete.append(titre, intro);
  const layout = document.createElement('div');
  layout.className = 'settings-layout';
  const tabs = document.createElement('nav');
  tabs.className = 'settings-tabs';
  tabs.setAttribute('aria-label', 'Catégories de paramètres');
  const contenu = document.createElement('div');
  contenu.className = 'settings-content';
  const categories = ['Apparence', 'Discussion', 'Confidentialité', 'Raccourcis', 'Entraînement'];

  function afficherOnglet(nom) {
    arreterSondeEntrainement();
    contenu.replaceChildren();
    tabs.querySelectorAll('button').forEach((bouton) => bouton.classList.toggle('active', bouton.textContent === nom));
    const h = document.createElement('h3');
    h.textContent = nom;
    const description = document.createElement('p');
    contenu.append(h, description);
    if (nom === 'Apparence') {
      description.textContent = 'Réglez la densité et les mouvements de l’interface.';
      contenu.append(
        creerChoixTheme(),
        creerInterrupteur('animationsReduites', 'Réduire les animations', 'Désactive les mouvements décoratifs.'),
        creerInterrupteur('densiteCompacte', 'Affichage compact', 'Réduit l’espace vertical autour des messages.'),
      );
    } else if (nom === 'Discussion') {
      description.textContent = 'Choisissez le comportement de vos échanges.';
      contenu.append(
        creerInterrupteur('defilementAuto', 'Défilement automatique', 'Suit les nouveaux messages en bas de la discussion.'),
        creerInterrupteur('confirmationEnvoi', 'Confirmer avant l’envoi', 'Demande une confirmation avant chaque message.'),
        creerInterrupteur('outilsWeb', 'Outils web', 'Recherche internet, curl et lecture de pages quand la question le demande.'),
        creerInterrupteur('raisonnementVisible', 'Raisonnement visible', 'Affiche en direct les étapes : routage, recherche, mémoire, vérification.'),
        creerCurseurTemperature(),
        creerInterrupteur('executionAuto', 'Exécution automatique des commandes', 'Les blocs athena-exec partent seuls sur l’agent local (127.0.0.1:3020) — sans modale « Exécuter sur ce PC ? ». Décocher pour reprendre la confirmation manuelle.'),
        creerLigneChamp('dossierTravail', 'Dossier de travail (fichiers créés)', 'Dossier du PC où le modèle enregistre les fichiers (chemins relatifs). Vide = dossier de l’agent. Ex. C:\\Users\\moi\\Documents\\Athena',
          'C:\\Users\\moi\\Documents\\Athena'),
        creerLigneNombre('contexteLocal', 'Contexte des modèles locaux (tokens)', 'num_ctx RÉEL de votre modèle local (Ollama stock = 4096 ; 16384 si configuré). Sert la jauge et la compression auto.'),
      );
    } else if (nom === 'Confidentialité') {
      description.textContent = 'Les données de cette démo restent sur cet appareil.';
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'settings-tab';
      bouton.style.marginTop = '18px';
      bouton.textContent = 'Effacer l’historique de cette session';
      bouton.addEventListener('click', () => {
        const c = conversationOuverte();
        c.messages = [];
        c.maj = Date.now();
        sauverConversations();
        ouvrirConversation(c.id);
      });
      const exporterCourante = document.createElement('button');
      exporterCourante.type = 'button';
      exporterCourante.className = 'settings-tab';
      exporterCourante.style.marginTop = '8px';
      exporterCourante.textContent = 'Exporter la conversation courante (.md)';
      exporterCourante.addEventListener('click', () => exporterConversation(idConversation));
      const exporterTout = document.createElement('button');
      exporterTout.type = 'button';
      exporterTout.className = 'settings-tab';
      exporterTout.style.marginTop = '8px';
      exporterTout.textContent = 'Exporter toutes les conversations (.md)';
      exporterTout.addEventListener('click', exporterToutesConversations);
      const importerFichiers = document.createElement('button');
      importerFichiers.type = 'button';
      importerFichiers.className = 'settings-tab';
      importerFichiers.style.marginTop = '8px';
      importerFichiers.textContent = 'Importer des conversations (.md)';
      importerFichiers.addEventListener('click', () => entreeImportFichiers.click());
      contenu.append(bouton, exporterCourante, exporterTout, importerFichiers);
    } else if (nom === 'Entraînement') {
      description.textContent = 'Vos échanges et vos corrections servent à ré-entraîner l’IA. Tout reste sur cet appareil.';
      const info = document.createElement('p');
      info.id = 'entrainement-info';
      info.textContent = 'Chargement…';
      const progres = document.createElement('p');
      progres.id = 'entrainement-progres';
      progres.style.marginTop = '6px';
      const lancer = document.createElement('button');
      lancer.type = 'button';
      lancer.id = 'entrainement-lancer';
      lancer.className = 'settings-tab';
      lancer.style.marginTop = '14px';
      lancer.textContent = 'Entraîner avec mes conversations';
      lancer.addEventListener('click', lancerEntrainement);
      const etiquetteWeb = document.createElement('p');
      etiquetteWeb.style.marginTop = '16px';
      etiquetteWeb.style.maxWidth = '420px';
      etiquetteWeb.textContent = 'Entraînement depuis le web : donnez des sujets, l’IA cherche des informations et s’entraîne dessus.';
      const sujetsWeb = document.createElement('input');
      sujetsWeb.id = 'entrainement-sujets';
      sujetsWeb.type = 'text';
      sujetsWeb.placeholder = 'Sujets séparés par « ; » (ex. : LoRA ; Qwen2.5)';
      const boutonWeb = document.createElement('button');
      boutonWeb.type = 'button';
      boutonWeb.id = 'entrainement-web';
      boutonWeb.className = 'settings-tab';
      boutonWeb.style.marginTop = '8px';
      boutonWeb.textContent = 'Chercher sur le web et entraîner';
      boutonWeb.addEventListener('click', lancerEntrainementWeb);
      const voir = document.createElement('button');
      voir.type = 'button';
      voir.id = 'entrainement-voir';
      voir.className = 'settings-tab';
      voir.style.marginTop = '14px';
      voir.textContent = 'Voir / corriger les exemples capturés';
      voir.addEventListener('click', () => {
        const cible = document.getElementById('entrainement-exemples');
        cible.hidden = !cible.hidden;
        voir.textContent = cible.hidden ? 'Voir / corriger les exemples capturés' : 'Masquer les exemples';
        rafraichirEntrainement();
      });
      const exemplesBox = document.createElement('div');
      exemplesBox.id = 'entrainement-exemples';
      exemplesBox.hidden = true;
      const vider = document.createElement('button');
      vider.type = 'button';
      vider.className = 'settings-tab';
      vider.style.marginTop = '12px';
      vider.textContent = 'Vider les conversations enregistrées';
      vider.addEventListener('click', async () => {
        /* v9.4 : modale de confirmation au lieu de window.confirm */
        if (await boiteModale({ titre: 'Effacer les conversations enregistrées ?', message: 'Toutes les conversations enregistrées pour l’entraînement seront supprimées.', labelOk: 'Effacer', labelAnnuler: 'Annuler', danger: true })) {
          /* v20260922j (bug 9) : vérif r.ok — l'échec n'est plus silencieux */
          /* v20260922k : le serveur exige désormais une confirmation
             explicite ({confirm:true}) — plus aucun wipe accidentel. */
          fetch('/api/entrainer', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true }),
            signal: delaiFetch(10000),
          })
            .then((r) => { if (!r.ok) throw new Error('échec ' + r.status); return r.json(); })
            .then(() => rafraichirEntrainement())
            .catch(() => {
              const p = document.getElementById('entrainement-progres');
              if (p) p.textContent = 'Échec de la suppression — réessayez dans un instant.';
            });
        }
      });
      contenu.append(info, progres, lancer, etiquetteWeb, sujetsWeb, boutonWeb, voir, exemplesBox, vider);
      rafraichirEntrainement();
      if (!minuteurEntrainement) minuteurEntrainement = setInterval(rafraichirEntrainement, 3000);
    } else {
      description.textContent = 'Raccourcis disponibles dans la zone de message.';
      const liste = document.createElement('div');
      liste.className = 'shortcut-list';
      [['Envoyer un message', 'Entrée'], ['Arrêter la génération', '■'], ['Joindre un fichier', 'Alt + A'], ['Nouvelle discussion', 'Alt + N'], ['Régénérer la dernière réponse', 'Alt + R'], ['Historique de saisie', '↑ / ↓'], ['Barre latérale', 'Ctrl + B'], ['Exporter la conversation', 'Alt + E']].forEach(([action, touche]) => {
        const ligne = document.createElement('div');
        ligne.className = 'shortcut-row';
        const libelle = document.createElement('span');
        libelle.textContent = action;
        const raccourci = document.createElement('kbd');
        raccourci.textContent = touche;
        ligne.append(libelle, raccourci);
        liste.appendChild(ligne);
      });
      contenu.appendChild(liste);
    }
  }
  categories.forEach((nom) => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'settings-tab';
    bouton.textContent = nom;
    bouton.addEventListener('click', () => afficherOnglet(nom));
    tabs.appendChild(bouton);
  });
  layout.append(tabs, contenu);
  vue.append(entete, layout);
  msgsEl.appendChild(vue);
  afficherOnglet(ongletActif);
}

function afficherCompte() {
  const details = document.createElement('div');
  details.className = 'setting-row';
  const copy = document.createElement('span');
  copy.className = 'setting-copy';
  copy.innerHTML = '<span>Neyzoxx</span><small>Plan gratuit · compte local</small>';
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'settings-tab';
  action.textContent = 'Voir les préférences';
  action.addEventListener('click', () => afficherParametres());
  details.append(copy, action);
  afficherVue('Compte', 'Gérez vos informations et les préférences associées à cette session.', details);
}

async function ajouterProjet() {
  /* Un projet = une conversation nommée ET épinglée : elle apparaît dans la
     section Projets et en tête des Conversations, et SURVIT au rechargement
     (l'ancien bouton purement DOM était effacé à chaque reload).
     v9.4 : modale avec champ au lieu de window.prompt. */
  const nom = await boiteModale({
    titre: 'Nouveau projet',
    message: 'Un projet est une conversation épinglée en tête de liste.',
    champ: '', labelOk: 'Créer', labelAnnuler: 'Annuler',
  });
  if (!nom) return;
  const c = creerConversation();
  c.titre = nom;
  c.epingle = true;
  conversations.push(c);
  sauverConversations();
  ouvrirConversation(c.id);
}
appliquerPreferences();
/* v7.2.2 (BUG CRITIQUE — « L'UI bug ») : ouvrirConversation() était exécuté
   ICI, 178 lignes AVANT la déclaration d'une const du module (à l'époque :
   ICONES_ETAPES).
   Dès qu'une conversation contenait des étapes de raisonnement (v7.1+ —
   c'est le cas de TOUTES les conversations récentes), le rejeu au
   CHARGEMENT lisait cette const en Temporal Dead Zone -> ReferenceError ->
   le module ENTIER mourait : sidebar vide, bulles assistant absentes,
   bouton Envoyer sans listener, sonde morte — « l'UI bug ». L'appel est
   déplacé en FIN de module (toutes les déclarations y sont évaluées) ; un
   blindage par message est en place dans ouvrirConversation(). */

/* ---------- Sonde de l'onglet Entraînement ---------- */
let minuteurEntrainement = null;
function arreterSondeEntrainement() {
  if (minuteurEntrainement) { clearInterval(minuteurEntrainement); minuteurEntrainement = null; }
}
/* v20260922j (bug 9) : l'index ex.i est POSITIONNEL dans le JSONL et la liste
   se rafraîchit toutes les 3 s — un exemple capturé entre le rendu et le clic
   décale les indices (mauvaise ligne éditée/supprimée). On re-fetch la liste
   et on retrouve la ligne par signature STABLE (fichier + ts + question),
   puis on PATCH avec l'indice frais. Toute réponse HTTP non-ok lève une
   erreur visible (avant : « ✓ Enregistré » même sur échec). */
async function patcherExemple(ex, corps) {
  const r0 = await fetch('/api/entrainer', { cache: 'no-store', signal: delaiFetch(10000) });
  if (!r0.ok) throw new Error('liste indisponible (' + r0.status + ')');
  const d0 = await r0.json();
  const frais = (d0.exemples || []).find((x) => x.fichier === ex.fichier
    && String(x.ts ?? '') === String(ex.ts ?? '')
    && (x.question || '') === (ex.question || ''));
  if (!frais) throw new Error('exemple introuvable (liste décalée)');
  const r = await fetch('/api/entrainer', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...corps, i: frais.i, fichier: frais.fichier }),
    signal: delaiFetch(10000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || 'échec (' + r.status + ')');
  return d;
}
function rendreExemples(exemples) {
  const cible = document.getElementById('entrainement-exemples');
  if (!cible || cible.hidden) return;
  cible.replaceChildren();
  // l'API renvoie déjà les plus récents d'abord : ne pas inverser
  (exemples || []).forEach((ex) => {
    const carte = document.createElement('div');
    carte.className = 'ex-carte' + (ex.a_valider ? ' ex-avalider' : '');
    const q = document.createElement('input');
    q.className = 'ex-question';
    q.type = 'text';
    q.value = ex.question;
    q.setAttribute('aria-label', 'Question de l’exemple');
    const etiquettes = document.createElement('div');
    etiquettes.style.marginTop = '3px';
    if (ex.a_valider) {
      const tag = document.createElement('span');
      tag.className = 'ex-tag';
      tag.textContent = 'correction à valider';
      etiquettes.appendChild(tag);
    } else if (ex.editee) {
      const tag = document.createElement('span');
      tag.className = 'ex-tag';
      tag.style.background = '#e7f2e8';
      tag.style.color = '#2e7d32';
      tag.textContent = 'corrigée';
      etiquettes.appendChild(tag);
    }
    if (ex.fichier === 'web') {
      const tag = document.createElement('span');
      tag.className = 'ex-tag';
      tag.style.background = '#e8edf8';
      tag.style.color = '#3b5aa0';
      tag.textContent = 'web · ' + ((ex.url || '').replace(/^https?:\/\//, '').split('/')[0] || 'source');
      tag.title = ex.url || '';
      etiquettes.appendChild(tag);
    }
    if (ex.fichier === 'preuves') {
      const tag = document.createElement('span');
      tag.className = 'ex-tag';
      tag.style.background = '#f3ecdd';
      tag.style.color = '#8a6d2f';
      tag.textContent = 'preuve web · ' + ((ex.url || '').replace(/^https?:\/\//, '').split('/')[0] || (ex.outil || 'source'));
      tag.title = (ex.url || '') + ' — valider l\'ajoute à la base de connaissances (RAG)';
      etiquettes.appendChild(tag);
    }
    if (etiquettes.children.length) {
      /* v20260922j (bug 8) : q n'est appendé qu'UNE fois (ci-dessous) —
         l'ancien carte.append(q, …) + carte.append(q, ta, actions)
         DÉPLACAIT q après les étiquettes (ordre inversé). */
      carte.appendChild(q);
      carte.appendChild(etiquettes);
    } else {
      carte.appendChild(q);
    }
    const ta = document.createElement('textarea');
    ta.className = 'ex-reponse';
    ta.rows = 2;
    ta.value = ex.a_valider && !ex.editee ? (ex.proposition || ex.correction || '') : ex.reponse;
    ta.placeholder = 'Réponse à apprendre…';
    const actions = document.createElement('div');
    actions.className = 'ex-actions';
    const enregistrer = document.createElement('button');
    enregistrer.type = 'button';
    enregistrer.textContent = ex.a_valider ? 'Valider ✓' : 'Enregistrer';
    enregistrer.addEventListener('click', () => {
      enregistrer.disabled = true;
      patcherExemple(ex, {
        reponse: ta.value,
        question: q.value.trim() !== ex.question ? q.value.trim() : undefined,
      })
        .then(() => { enregistrer.textContent = 'Enregistré'; rafraichirEntrainement(); })
        .catch((e) => {
          /* v20260922j (bug 9) : échec visible — plus de « ✓ Enregistré »
             mensonger ; le bouton redevient actif avec la raison. */
          enregistrer.disabled = false;
          enregistrer.textContent = 'Réessayer';
          enregistrer.title = (e && e.message) || 'Échec — cliquez pour réessayer';
          setTimeout(() => {
            enregistrer.textContent = ex.a_valider ? 'Valider' : 'Enregistrer';
            enregistrer.removeAttribute('title');
          }, 3000);
        });
    });
    const suppr = document.createElement('button');
    suppr.type = 'button';
    suppr.textContent = 'Supprimer';
    suppr.addEventListener('click', () => {
      suppr.disabled = true;
      patcherExemple(ex, { action: 'supprimer' })
        .then(() => rafraichirEntrainement())
        .catch(() => {
          suppr.disabled = false;
          suppr.textContent = 'Échec';
          suppr.title = 'Échec de la suppression';
          setTimeout(() => { suppr.textContent = 'Supprimer'; suppr.removeAttribute('title'); }, 3000);
        });
    });
    actions.append(enregistrer, suppr);
    carte.append(ta, actions);
    cible.appendChild(carte);
  });
  if ((exemples || []).length === 0) {
    const vide = document.createElement('p');
    vide.style.marginTop = '8px';
    vide.textContent = 'Aucun exemple capturé pour le moment.';
    cible.appendChild(vide);
  }
}

function lancerEntrainementWeb() {
  const sujetsEl = document.getElementById('entrainement-sujets');
  const progres = document.getElementById('entrainement-progres');
  const boutonWeb = document.getElementById('entrainement-web');
  const sujets = sujetsEl.value.trim();
  if (!sujets) {
    progres.textContent = 'Indiquez au moins un sujet à chercher (ex. : « LoRA ; Qwen2.5 »).';
    return;
  }
  boutonWeb.disabled = true;
  fetch('/api/entrainer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sujets }),
    signal: delaiFetch(15000),
  })
    .then((r) => r.json())
    .then((d) => {
      /* v20260922j (bug 9) : les refus (400/409) affichent leur raison */
      if (d && d.erreur && progres) progres.textContent = d.erreur;
      rafraichirEntrainement();
    })
    .catch(() => { boutonWeb.disabled = false; });
}

function rafraichirEntrainement() {
  const info = document.getElementById('entrainement-info');
  const progres = document.getElementById('entrainement-progres');
  const lancer = document.getElementById('entrainement-lancer');
  const boutonWeb = document.getElementById('entrainement-web');
  if (!info || !progres || !lancer || !boutonWeb) { arreterSondeEntrainement(); return; }
  fetch('/api/entrainer', { signal: delaiFetch(10000) })
    .then((r) => r.json())
    .then((d) => {
      const p = d.progression || {};
      info.textContent = d.conversations + ' conversation' + (d.conversations === 1 ? '' : 's')
        + ' · ' + (d.base_connaissances ?? 0) + ' fait' + ((d.base_connaissances ?? 0) === 1 ? '' : 's')
        + ' dans la base (RAG)'
        + ' · ' + (d.preuves || 0) + ' preuve' + ((d.preuves || 0) === 1 ? '' : 's') + ' web à valider.';
      if (d.en_cours) {
        lancer.disabled = true;
        boutonWeb.disabled = true;
        const collecte = p.etape === 'collecte_web';
        lancer.textContent = collecte ? 'Recherche web en cours…' : 'Entraînement en cours…';
        let detail = '';
        if (collecte) detail = ' — sujet ' + ((p.sujets_faits || 0) + 1) + '/' + (p.sujets_total || '?') + ' : ' + (p.sujet_actuel || '…');
        else if (typeof p.pas === 'number' && p.total_pas) detail = ' — pas ' + p.pas + '/' + p.total_pas;
        progres.textContent = (collecte ? 'Collecte web en cours' : 'Le chat se met en pause pendant l’entraînement puis redémarre tout seul') + detail + '.';
      } else {
        lancer.disabled = false;
        boutonWeb.disabled = false;
        lancer.textContent = 'Entraîner avec mes conversations';
        if (p.erreur) progres.textContent = 'Dernier essai interrompu : ' + p.erreur;
        else if (p.termine && p.evalue) progres.textContent = 'Dernier entraînement terminé — éval ' + p.evalue + '.';
        else if (p.termine) progres.textContent = 'Dernier entraînement terminé.';
        else if (p.etape === 'en_pause') progres.textContent = 'Entraînement en pause (limite de temps) : relancez, il reprendra au checkpoint.';
        else if (p.etape === 'collecte_web_terminee') progres.textContent = 'Collecte web terminée — relancez un entraînement pour l’exploiter.';
        else progres.textContent = '';
      }
      rendreExemples(d.exemples);
    })
    .catch(() => { info.textContent = 'Service indisponible pour le moment.'; });
}
function lancerEntrainement() {
  fetch('/api/entrainer', { method: 'POST', signal: delaiFetch(15000) })
    .then((r) => r.json())
    .then((d) => {
      /* v20260922j (bug 9) : les refus (400/409) affichent leur raison */
      if (d && d.erreur) {
        const p = document.getElementById('entrainement-progres');
        if (p) p.textContent = d.erreur;
      }
      rafraichirEntrainement();
    })
    .catch(() => {});
}

/* ---------- v9.4 — RENDU MARKDOWN des bulles assistant (audit P1) ----------
   Les réponses du modèle contiennent des blocs de code, listes et titres
   affichés EN BRUT jusqu'ici. Rendu minimal, SANS dépendance, et surtout
   SÛR : tout texte est échappé AVANT toute transformation (aucun <script>
   ne peut passer par une réponse du modèle). Pris en charge : blocs de
   code ``` avec bouton copier, `inline code`, gras/italique, titres # à ##,
   listes - / 1., citations >, liens [t](http…), lignes ---, tableaux simples. */

function echapperHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Décodage des entités HTML les plus fréquentes (une seule passe, non
   superposable : &amp;lt; ne donne qu'&lt; — pas de décodage en cascade).
   À appeler AVANT echapperHtml, jamais après. */
const ENTITES_MD = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ',
  '&#39;': "'", '&#x27;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&copy;': '©', '&reg;': '®', '&rsquo;': '\u2019', '&lsquo;': '\u2018',
  '&ldquo;': '\u201C', '&rdquo;': '\u201D', '&trade;': '\u2122',
};
function decoderEntites(s) {
  return String(s == null ? '' : s).replace(
    /&(?:amp|lt|gt|quot|nbsp|mdash|ndash|hellip|copy|reg|rsquo|lsquo|ldquo|rdquo|trade);|&#(?:39|x27);/gi,
    (m) => {
      const cle = m.toLowerCase();
      if (cle === '&#39;' || cle === '&#x27;') return "'";
      return Object.prototype.hasOwnProperty.call(ENTITES_MD, cle) ? ENTITES_MD[cle] : m;
    }
  );
}

/* Inline : échappe puis applique code/gras/italique/liens/URLs nues. */
/* La contrainte « zéro émoji » (voir en-tête de ce fichier) porte sur le
   design — mais le texte vient du modèle, qui produit parfois ✅/⚠️ malgré
   la consigne système. On substitue les deux glyphes les plus fréquents
   par l'icône SVG du système plutôt que d'interdire au modèle un
   vocabulaire qu'il utilise pour structurer une réponse (listes de
   vérification, avertissements). Étendre STATUT_EMOJIS si d'autres
   glyphes reviennent souvent (❌, 🔴…). */
const STATUT_EMOJIS = {
  '\u2705': { icone: 'check', classe: 'ok' },       // ✅
  '\u26A0\uFE0F': { icone: 'alert', classe: 'doute' }, // ⚠️
  '\u26A0': { icone: 'alert', classe: 'doute' },       // ⚠ (sans variation selector)
};
function substituerEmojisStatut(s) {
  let t = s;
  for (const [glyphe, cfg] of Object.entries(STATUT_EMOJIS)) {
    // le glyphe est en tête de ligne ou de paragraphe, suivi d'un espace
    t = t.split(glyphe + ' ').join(
      '<span class="statut-ligne ' + cfg.classe + '">' + icoSvgTexte(cfg.icone) + '</span> '
    );
  }
  return t;
}
function markdownInline(texte) {
  /* v20260926n : les entités du modèle (&amp; &lt; &mdash;…) sont DÉCODÉES
     avant échappement — sans quoi &amp; s'affichait littéralement « &amp; »
     (double échappement, mesuré). L'échappement reste la DERNIÈRE opération :
     aucun <script> du modèle ne peut passer. */
  const s = echapperHtml(decoderEntites(texte));
  const morceaux = s.split(/(`+[^`]+`+)/g); // préserve les segments `code`
  return morceaux.map((morceau) => {
    if (/^`+[^`]+`+$/.test(morceau)) {
      return '<code>' + morceau.replace(/^`+/, '').replace(/`+$/, '') + '</code>';
    }
    let t = substituerEmojisStatut(morceau);
    // case à cocher GFM en tête de liste : « - [x] fait » / « - [ ] à faire »
    t = t.replace(/^\s*\[([ xX])\]\s+/, (_m, coche) =>
      /[xX]/.test(coche)
        ? '<span class="md-check faite" role="img" aria-label="fait">' + icoSvgTexte('check') + '</span>'
        : '<span class="md-check" role="img" aria-label="à faire"></span>');
    /* liens [texte](url) — http(s) uniquement, jamais de javascript:.
       La cible peut porter un titre ([t](http… "titre")) : sans cette
       branche, l'URL nue était ré-liée PAR-DESSUS le lien markdown et le
       rendu cassait en « [t](<a…>http…</a> "titre") » (mesuré). */
    t = t.replace(/\[([^\]]+)\]\(([^()]*)\)/g, (m, texte2, cible) => {
      /* la cible a été échappée (« devient &quot;) et peut être entourée de
         <> : on normalise AVANT de tester l'URL, sinon le titre faisait
         échouer la détection et l'URL était ré-liée par l'étape suivante. */
      const brut = cible.trim().replace(/^<([\s\S]*)>$/, '$1').trim();
      const dm = /^\s*(https?:\/\/[^\s)<]+)(?:\s+.*)?$/.exec(brut);
      if (!dm) return m;
      return '<a href="' + dm[1] + '" target="_blank" rel="noopener noreferrer">' + texte2 + '</a>';
    });
    // barré GFM : ~~texte~~
    t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    // URLs nues -> liens (le modèle sort rarement du [texte](url)), SAUF dans
    // les <a> déjà générés (v20260926d : une URL dans le texte d'un lien
    // re-matchait et imbriquait un second <a>).
    t = t.split(/(<a\s[^>]*>[\s\S]*?<\/a>)/gi).map((frag) => {
      if (/^<a\s/i.test(frag)) return frag;
      return frag.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (_m, avant, url) =>
        avant + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>');
    }).join('');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>');
    return t;
  }).join('');
}

/* Un bloc de code ``` avec étiquette de langage + bouton copier.
   Langage spécial « athena-exec » : bouton Exécuter → local-agent :3020
   (via /api/exec du shim). Confirmation modale obligatoire sauf agent --auto. */
function creerBlocCode(langage, code) {
  const pre = document.createElement('pre');
  const etiquette = document.createElement('span');
  etiquette.className = 'code-lang';
  etiquette.textContent = langage || '';
  const codeEl = document.createElement('code');
  codeEl.textContent = code;
  const copier = document.createElement('button');
  copier.type = 'button';
  copier.className = 'code-copier';
  copier.title = 'Copier le code';
  copier.setAttribute('aria-label', 'Copier le code');
  copier.appendChild(icoSvg('copy'));
  copier.addEventListener('click', () => copierTexte(code, copier));
  pre.append(etiquette, codeEl, copier);
  if ((langage || '').toLowerCase() === 'athena-exec') {
    pre.classList.add('exec-bloc');
    const executer = document.createElement('button');
    executer.type = 'button';
    executer.className = 'code-exec';
    executer.title = 'Exécuter via l’agent local (127.0.0.1:3020)';
    executer.setAttribute('aria-label', 'Exécuter la commande');
    executer.textContent = 'Exécuter';
    executer.addEventListener('click', async () => {
      /* v1.2 (anti-bâclage) : le mode MANUEL est le DÉFAUT du produit — or
         l'enchaînement ne vivait que dans le chemin auto. Résultat mesuré :
         clic + modale + confirmation, puis PLUS RIEN (1 appel LLM) : le
         modèle exécutait une commande et s'arrêtait, sans jamais lire la
         sortie. Le consentement est déjà donné (l'utilisateur a validé la
         modale) : on enchaîne donc aussi ici. */
      const c = conversationOuverte();
      if (c && c._budgetEpuise) {
        notifier('Budget de commandes épuisé : réponds par ton verdict, plus aucune commande ne sera lancée.');
        return;
      }
      const d = await lancerCommandeLocale(code, executer, codeEl);
      /* v1.2 (suite) : clic manuel → la suite continue dans la même bulle. */
      if (d) enchainerApresExec(c, [d], codeEl.closest ? (codeEl.closest('.bubble') || null) : null);
    });
    pre.appendChild(executer);
  }
  /* v20261001 : HTML/SVG → bouton « Interpréter » (rendu immédiat dans le
     HUD à droite, iframe sandboxée + console des erreurs). */
  if (/^(html?|xhtml|svg)$/i.test((langage || '').trim())) {
    const interp = document.createElement('button');
    interp.type = 'button';
    interp.className = 'code-interpreter';
    interp.title = 'Interpréter ce code dans le HUD à droite';
    interp.textContent = 'Interpréter';
    interp.addEventListener('click', () => {
      const ext = /^svg$/i.test((langage || '').trim()) ? 'svg' : 'html';
      ouvrirInterpreteur('code.' + ext, code);
    });
    pre.appendChild(interp);
  }
  return pre;
}

/* v20260926b (direct) : carte de fichier créé par le modèle
   (```athena-file chemin="..."). Le contenu COMPLET est gardé en mémoire
   (expando, jamais persisté en double — le texte du message le contient déjà)
   : le téléchargement survit au rechargement via re-rendu, et
   autoFileBlocs retrouve le contenu sans le DOM tronqué. */
function analyserCheminFichier(params) {
  const p = String(params || '').trim();
  if (!p) return 'fichier-sans-nom.txt';
  const m = /^(?:chemin|path|nom|fichier)\s*=\s*("([^"]+)"|'([^']+)'|(\S+))/.exec(p);
  if (m) return (m[2] || m[3] || m[4] || '').trim() || 'fichier-sans-nom.txt';
  const premier = p.split(/\s+/)[0].replace(/^["']|["']$/g, '');
  return premier || 'fichier-sans-nom.txt';
}
function nomBaseFichier(chemin) {
  const n = String(chemin || '').replace(/\\/g, '/').split('/');
  return n[n.length - 1] || String(chemin || '');
}
/* v20260926h : coloration syntaxique légère (façon VSCode sombre) pour
   l'aperçu des fichiers — sans librairie, sans réseau. Tokenizer par regex
   sur texte brut, sortie 100 % textContent (aucun HTML injecté → pas de XSS).
   Au-delà de 200 Ko : texte brut (l'affichage reste intégral, seule la
   couleur est désactivée pour ne pas janker). */
const COLORATION_MAX = 200000;
function langageFichier(chemin) {
  const ext = String(chemin || '').split('.').pop().toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'swift', 'kt', 'scala'].includes(ext)) return 'c';
  if (['py', 'pyw', 'sh', 'bash', 'zsh', 'ps1', 'pl', 'rb', 'lua', 'r'].includes(ext)) return 'script';
  if (['html', 'htm', 'xml', 'svg', 'vue', 'svelte'].includes(ext)) return 'html';
  if (['css', 'scss', 'less'].includes(ext)) return 'css';
  if (['sql'].includes(ext)) return 'sql';
  if (['json', 'jsonc'].includes(ext)) return 'json';
  if (['yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env'].includes(ext)) return 'conf';
  if (['md', 'markdown', 'txt', 'log'].includes(ext)) return 'prose';
  return 'defaut';
}
const MOTS_CLES = {
  c: ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'function', 'class', 'const', 'let', 'var', 'new', 'delete', 'typeof', 'import', 'export', 'from', 'default', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'this', 'true', 'false', 'null', 'undefined', 'struct', 'enum', 'impl', 'fn', 'pub', 'mut', 'package', 'func', 'var', 'nil', 'interface', 'extends', 'implements', 'static', 'public', 'private', 'void', 'int', 'string', 'bool'],
  script: ['if', 'else', 'elif', 'for', 'while', 'def', 'class', 'return', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'pass', 'break', 'continue', 'in', 'is', 'not', 'and', 'or', 'None', 'True', 'False', 'function', 'do', 'done', 'then', 'fi', 'case', 'esac', 'echo', 'exit', 'local', 'readonly', 'end', 'self', 'nil'],
  sql: ['select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'order', 'by', 'having', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'alter', 'drop', 'and', 'or', 'not', 'null', 'as', 'distinct', 'limit', 'offset'],
  json: ['true', 'false', 'null'],
  defaut: ['if', 'else', 'for', 'while', 'return', 'function', 'class', 'const', 'let', 'var', 'import', 'export', 'true', 'false', 'null'],
};
function reglesColoration(lang) {
  const com = [];
  const ch = [];
  if (lang === 'c' || lang === 'css' || lang === 'sql' || lang === 'defaut') {
    com.push(/\/\/[^\n]*/, /\/\*[\s\S]*?(?:\*\/|$)/);
  }
  if (lang === 'script' || lang === 'conf' || lang === 'sql' || lang === 'defaut') {
    com.push(/#[^\n]*/, /'''[\s\S]*?(?:'''|$)/, /"""[\s\S]*?(?:"""|$)/);
  }
  if (lang === 'html') com.push(/<!--[\s\S]*?(?:-->|$)/);
  if (lang === 'sql') com.push(/--[^\n]*/);
  ch.push(/'(?:[^'\\\n]|\\.)*'?/, /"(?:[^"\\\n]|\\.)*"?/);
  if (lang === 'c' || lang === 'script') ch.push(/`(?:[^`\\]|\\.)*`?/);
  return { com, ch };
}
function surlignerCode(texte, chemin) {
  const frag = document.createDocumentFragment();
  const src = String(texte == null ? '' : texte);
  const lang = langageFichier(chemin);
  if (lang === 'prose' || !src || src.length > COLORATION_MAX) {
    frag.appendChild(document.createTextNode(src));
    return frag;
  }
  const mots = MOTS_CLES[lang] || MOTS_CLES.defaut;
  const { com, ch } = reglesColoration(lang);
  const parties = [];
  com.forEach((r) => parties.push({ re: r, cls: 'tok-com' }));
  ch.forEach((r) => parties.push({ re: r, cls: 'tok-ch' }));
  parties.push({ re: /\b\d+(?:\.\d+)?\b/, cls: 'tok-nb' });
  parties.push({ re: new RegExp('\\b(?:' + mots.join('|') + ')\\b'), cls: 'tok-mot' });
  const union = new RegExp(parties.map((p) => '(' + p.re.source + ')').join('|'), 'g');
  let pos = 0;
  let m;
  while ((m = union.exec(src)) !== null) {
    if (m.index > pos) frag.appendChild(document.createTextNode(src.slice(pos, m.index)));
    let idx = -1;
    for (let g = 1; g < m.length; g++) {
      if (m[g] !== undefined) { idx = g - 1; break; }
    }
    const span = document.createElement('span');
    span.className = idx >= 0 ? parties[idx].cls : '';
    span.textContent = m[0];
    frag.appendChild(span);
    pos = m.index + m[0].length;
    if (m[0].length === 0) union.lastIndex++;
  }
  if (pos < src.length) frag.appendChild(document.createTextNode(src.slice(pos)));
  return frag;
}
function creerBlocFichier(params, contenu) {
  let chemin = analyserCheminFichier(params);
  let texte = contenu == null ? '' : String(contenu);
  /* v1.2 (audit 14:27) : le modèle met souvent le chemin en PREMIÈRE LIGNE
     DU CONTENU (« la première ligne donne le chemin » se lit des deux
     façons) avec un fence nu ```athena-file. Avant, cette ligne devenait du
     contenu et le fichier tombait en `fichier-sans-nom.txt` au mauvais
     endroit — puis l'exec qui le cherchait au bon endroit échouait
     (throw → code=1, tâche morte). On accepte les deux formes : si le fence
     ne donne aucun chemin et que la première ligne du contenu ressemble à
     un chemin, c'est le chemin (retiré du contenu). */
  if ((chemin === 'fichier-sans-nom.txt' || !chemin) && texte) {
    const lignes = texte.split('\n');
    const premiere = (lignes[0] || '').trim().replace(/^["']|["']$/g, '');
    if (premiere && !/\s/.test(premiere) && premiere.length <= 260
        && (/[/\\]/.test(premiere) || /\.[A-Za-z0-9]{1,5}$/.test(premiere))) {
      chemin = premiere;
      texte = lignes.slice(1).join('\n').replace(/^\n/, '');
    }
  }
  const carte = document.createElement('div');
  carte.className = 'file-bloc';
  carte.dataset.chemin = chemin;
  carte._contenuComplet = texte;
  const tete = document.createElement('div');
  tete.className = 'file-tete';
  tete.appendChild(icoSvg('file'));
  const nom = document.createElement('span');
  nom.className = 'file-nom';
  nom.textContent = nomBaseFichier(chemin);
  nom.title = chemin;
  const taille = document.createElement('span');
  taille.className = 'file-taille';
  try {
    taille.textContent = tailleFichier(new Blob([texte]).size);
  } catch (e) { taille.textContent = texte.length + ' car.'; }
  const statut = document.createElement('span');
  statut.className = 'file-statut';
  statut.textContent = 'prêt';
  tete.append(nom, taille, statut);
  /* v20260926k : l'aperçu ne s'affiche QU'AU CLIC — dans le HUD latéral.
     La carte reste compacte (en-tête cliquable + actions). */
  tete.classList.add('file-ouvre');
  tete.tabIndex = 0;
  tete.setAttribute('role', 'button');
  tete.title = 'Ouvrir l’aperçu : ' + chemin;
  const ouvrir = () => {
    /* HTML/SVG : HUD d'exécution à droite (rendu seul par défaut, la page
       se rétracte) — les autres fichiers restent dans le HUD latéral. */
    if (/\.(html?|xhtml|svg)$/i.test(chemin) && texte) {
      ouvrirInterpreteur(nomBaseFichier(chemin), texte);
      return;
    }
    document.querySelectorAll('.file-bloc.ouvert').forEach((c) => { if (c !== carte) c.classList.remove('ouvert'); });
    carte.classList.add('ouvert');
    ouvrirHudFichier(chemin, texte, carte);
    if (document.getElementById('hud-fichier')?.hidden) carte.classList.remove('ouvert');
  };
  tete.addEventListener('click', ouvrir);
  tete.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); }
  });
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  /* v20260926l : bouton « Enregistrer sur ce PC » retiré de l'UI (demande) —
     l'enregistrement passe par l'auto (carte + statut conservés). */
  const btnDl = document.createElement('button');
  btnDl.type = 'button';
  btnDl.className = 'file-telecharger';
  btnDl.textContent = 'Télécharger';
  btnDl.addEventListener('click', () => telechargerFichier(chemin, texte, btnDl));
  actions.append(btnDl);
  carte.append(tete, actions);
  return carte;
}
/* v20260926k (HUD fichier) : l'aperçu ne s'affiche QU'AU CLIC — dans un
   panneau latéral droit UNIFORME (une seule instance réutilisée), largeur
   réglable à la souris et persistée. */
const CLE_LARGEUR_HUD = 'athena_hud_fichier_largeur';
const LARGUEUR_HUD_DEFAUT = 480;
function largeurHudFichier() {
  try {
    const n = parseInt(localStorage.getItem(CLE_LARGEUR_HUD) || '', 10);
    if (Number.isFinite(n)) return Math.min(960, Math.max(300, n));
  } catch {}
  return LARGUEUR_HUD_DEFAUT;
}
/* La page se rétracte à la largeur réelle du HUD fichier (comme pour
   l'interprèteur) - l'aperçu recouvre plus rien : il pousse l'UI. */
function appliquerLargeurHudFichier(px) {
  document.documentElement.style.setProperty('--hudf-largeur', Math.round(px) + 'px');
  evaluerAdaptationHud();
}
function hudFichierRacine() {
  let hud = document.getElementById('hud-fichier');
  if (hud) return hud;
  hud = document.createElement('aside');
  hud.id = 'hud-fichier';
  hud.className = 'hud-fichier';
  hud.hidden = true;
  hud.setAttribute('aria-label', 'Aperçu du fichier');
  const poignee = document.createElement('div');
  poignee.className = 'hudf-poignee';
  poignee.title = 'Glisser pour régler la largeur (double-clic = réinitialiser)';
  const tete = document.createElement('div');
  tete.className = 'hudf-tete';
  const icone = document.createElement('span');
  icone.className = 'hudf-icone';
  icone.appendChild(icoSvg('file'));
  const nom = document.createElement('span');
  nom.className = 'hudf-nom';
  const taille = document.createElement('span');
  taille.className = 'hudf-taille';
  const fermer = document.createElement('button');
  fermer.type = 'button';
  fermer.className = 'hudf-fermer';
  fermer.title = 'Fermer l’aperçu';
  fermer.setAttribute('aria-label', 'Fermer l’aperçu du fichier');
  fermer.appendChild(icoSvg('x'));
  fermer.addEventListener('click', () => fermerHudFichier());
  tete.append(icone, nom, taille, fermer);
  const corps = document.createElement('pre');
  corps.className = 'hudf-corps file-apercu';
  corps.tabIndex = 0;
  const actions = document.createElement('div');
  actions.className = 'hudf-actions';
  const btnEdit = document.createElement('button');
  btnEdit.type = 'button';
  btnEdit.className = 'hudf-editer';
  btnEdit.textContent = 'Modifier';
  btnEdit.title = 'Modifier le fichier dans l’aperçu';
  const btnDl = document.createElement('button');
  btnDl.type = 'button';
  btnDl.className = 'file-telecharger';
  btnDl.textContent = 'Télécharger';
  const statut = document.createElement('span');
  statut.className = 'file-statut';
  statut.textContent = 'prêt';
  actions.append(btnEdit, btnDl, statut);
  hud.append(poignee, tete, corps, actions);
  document.body.appendChild(hud);
  /* Redimensionnement au pointeur (souris + tactile), persisté. */
  let enCours = false;
  const deplacer = (e) => {
    if (!enCours) return;
    const w = Math.min(960, Math.max(300, window.innerWidth - e.clientX));
    hud.style.width = w + 'px';
    appliquerLargeurHudFichier(hud.getBoundingClientRect().width || w);
  };
  const finir = () => {
    if (!enCours) return;
    enCours = false;
    try { localStorage.setItem(CLE_LARGEUR_HUD, String(parseInt(hud.style.width, 10) || LARGUEUR_HUD_DEFAUT)); } catch {}
    try { poignee.releasePointerCapture && poignee.releasePointerCapture(1); } catch {}
  };
  poignee.addEventListener('pointerdown', (e) => {
    enCours = true;
    try { poignee.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  poignee.addEventListener('pointermove', deplacer);
  poignee.addEventListener('pointerup', finir);
  poignee.addEventListener('pointercancel', finir);
  poignee.addEventListener('dblclick', () => {
    hud.style.width = LARGUEUR_HUD_DEFAUT + 'px';
    appliquerLargeurHudFichier(LARGUEUR_HUD_DEFAUT);
    try { localStorage.removeItem(CLE_LARGEUR_HUD); } catch {}
  });
  if (!window.__hudFichierEchap) {
    window.__hudFichierEchap = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const pile = window.__modalesAthena || [];
      if (pile.length) return; /* les modales d'abord */
      const hud = document.getElementById('hud-fichier');
      /* v20260926m : en pleine édition, Échap annule l'édition (pas le HUD). */
      if (hud && !hud.hidden && hud._enEdition && typeof hud._annulerEdition === 'function') {
        hud._annulerEdition();
        e.stopPropagation();
        return;
      }
      fermerHudFichier();
    });
  }
  return hud;
}
/* v20260926m : répercute un contenu édité dans le message d'origine (bloc
   ```athena-file correspondant) pour que la persistance suive. */
function mettreAJourFichierConversation(chemin, nouveau) {
  const convo = (typeof conversationOuverte === 'function') ? conversationOuverte() : null;
  if (!convo || !Array.isArray(convo.messages)) return false;
  let touche = false;
  for (const m of convo.messages) {
    if (!m || m.role !== 'assistant' || typeof m.content !== 'string') continue;
    const lignes = m.content.split('\n');
    const sortie = [];
    let i = 0;
    let change = false;
    while (i < lignes.length) {
      const ouv = /^\s*```\s*athena-file\s*(.*)$/.exec(lignes[i]);
      if (ouv && analyserCheminFichier(ouv[1] || '') === String(chemin || '')) {
        sortie.push(lignes[i]);
        i++;
        while (i < lignes.length && !/^\s*```\s*$/.test(lignes[i])) i++;
        sortie.push(String(nouveau == null ? '' : nouveau).replace(/\n$/, ''));
        if (i < lignes.length) { sortie.push(lignes[i]); i++; }
        else sortie.push('```');
        change = true;
      } else { sortie.push(lignes[i]); i++; }
    }
    if (change) { m.content = sortie.join('\n'); touche = true; }
  }
  return touche;
}
function ouvrirHudFichier(chemin, contenu, carte) {
  const hud = hudFichierRacine();
  /* Re-clic sur le même fichier = refermer (bascule). */
  if (!hud.hidden && hud.dataset.chemin === String(chemin || '')) {
    fermerHudFichier();
    return;
  }
  hud.dataset.chemin = String(chemin || '');
  hud._carte = carte || null;
  const texte = contenu == null ? '' : String(contenu);
  hud._texte = texte;
  hud._enEdition = false;
  hud._annulerEdition = () => { afficherHudLecture(); };
  hud.querySelector('.hudf-nom').textContent = nomBaseFichier(chemin);
  hud.querySelector('.hudf-nom').title = String(chemin || '');
  try {
    hud.querySelector('.hudf-taille').textContent = tailleFichier(new Blob([texte]).size);
  } catch { hud.querySelector('.hudf-taille').textContent = texte.length + ' car.'; }
  const corps = hud.querySelector('.hudf-corps');
  afficherHudLecture();
  corps.scrollTop = 0;
  const statut = hud.querySelector('.file-statut');
  if (statut) { statut.textContent = 'prêt'; statut.title = ''; }
  const btnDl = hud.querySelector('.file-telecharger');
  btnDl.onclick = () => telechargerFichier(chemin, hud._texte, btnDl);
  const btnEdit = hud.querySelector('.hudf-editer');
  btnEdit.textContent = 'Modifier';
  btnEdit.onclick = () => basculerEditionHud();
  if (!hud.style.width) hud.style.width = largeurHudFichier() + 'px';
  /* Exclusion stricte avec l'interprèteur : les deux HUD sont à droite, ils
     ne doivent jamais coexister (superposition du rendu et du code). */
  fermerInterpreteur();
  hud.hidden = false;
  if (pageDemoEl) pageDemoEl.classList.add('hudf-ouvert');
  appliquerLargeurHudFichier(hud.getBoundingClientRect().width || largeurHudFichier());
  document.querySelectorAll('.file-bloc.ouvert').forEach((c) => c.classList.remove('ouvert'));
  if (carte) carte.classList.add('ouvert');
}
/* v20260926m : édition DIRECTE dans le HUD — lecture colorée <-> zone de
   texte. Valider met à jour la carte, la conversation persistée, le
   téléchargement, et relance l'auto-save éventuel. */
function afficherHudLecture() {
  const hud = document.getElementById('hud-fichier');
  if (!hud) return;
  hud._enEdition = false;
  const corps = hud.querySelector('.hudf-corps');
  corps.replaceChildren(surlignerCode(hud._texte, hud.dataset.chemin));
  const btnEdit = hud.querySelector('.hudf-editer');
  if (btnEdit) btnEdit.textContent = 'Modifier';
}
function basculerEditionHud() {
  const hud = document.getElementById('hud-fichier');
  if (!hud || hud.hidden) return;
  if (hud._enEdition) {
    /* Valider. */
    const ta = hud.querySelector('.hudf-edition');
    const nouveau = ta ? ta.value : hud._texte;
    hud._texte = String(nouveau);
    hud._enEdition = false;
    afficherHudLecture();
    try {
      hud.querySelector('.hudf-taille').textContent = tailleFichier(new Blob([hud._texte]).size);
    } catch {}
    if (hud._carte) hud._carte._contenuComplet = hud._texte;
    if (mettreAJourFichierConversation(hud.dataset.chemin, hud._texte)) {
      try {
        sauverConversations();
        rendreConversations();
      } catch {}
    }
    const statut = hud.querySelector('.file-statut');
    if (statut) statut.textContent = 'modifié';
    if (preferences.executionAuto !== false && hud._carte) {
      delete hud._carte.dataset.fileAuto;
      enregistrerFichierLocal(hud.dataset.chemin || '', hud._texte, null, hud._carte, { auto: true });
    }
    try { notifier('Fichier mis à jour.'); } catch {}
    return;
  }
  /* Passer en édition. */
  const corps = hud.querySelector('.hudf-corps');
  const ta = document.createElement('textarea');
  ta.className = 'hudf-edition';
  ta.value = hud._texte;
  ta.setAttribute('aria-label', 'Modifier le contenu du fichier');
  ta.spellcheck = false;
  corps.replaceChildren(ta);
  hud._enEdition = true;
  const btnEdit = hud.querySelector('.hudf-editer');
  if (btnEdit) btnEdit.textContent = 'Valider';
  ta.focus();
}
function fermerHudFichier() {
  const hud = document.getElementById('hud-fichier');
  if (hud) hud.hidden = true;
  if (pageDemoEl) pageDemoEl.classList.remove('hudf-ouvert');
  document.querySelectorAll('.file-bloc.ouvert').forEach((c) => c.classList.remove('ouvert'));
  evaluerAdaptationHud();
}
function telechargerFichier(chemin, texte, bouton) {
  try {
    const url = URL.createObjectURL(new Blob([String(texte)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nomBaseFichier(chemin) || 'fichier.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    if (bouton) bouton.textContent = 'Échec';
  }
}

/* Compte-rendu repliable d'une commande exécutée. `donnees` reprend le
   format exact renvoyé par local-agent POST /exec :
   { commande, ok, code, stdout, stderr, duree_ms }.
   Replié par défaut (cohérent avec details.raisonnement) ; l'échec se
   distingue par la FORME (icône alerte + fond de sortie marqué), jamais
   par une teinte rouge seule — le design reste monochrome. */
function creerBlocTraceCommande(donnees) {
  const d = donnees || {};
  const det = document.createElement('details');
  det.className = 'trace-cmd' + (d.ok === false ? ' echec' : '');

  const sum = document.createElement('summary');
  sum.appendChild(icoSvg(d.ok === false ? 'alert' : 'terminal'));
  const label = document.createElement('span');
  label.className = 'trace-cmd-label';
  label.textContent = String(d.commande || '').trim() || '(commande)';
  const status = document.createElement('span');
  status.className = 'trace-cmd-status';
  status.textContent = d.ok === false ? 'échec' : 'succès';
  const meta = document.createElement('span');
  meta.className = 'trace-cmd-meta';
  const bits = [];
  if (typeof d.code === 'number') bits.push('code=' + d.code);
  if (typeof d.duree_ms === 'number') bits.push(Math.round(d.duree_ms) + ' ms');
  meta.textContent = bits.join(' · ');
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.appendChild(icoSvg('chevron'));
  sum.append(label, status, meta, chev);
  det.appendChild(sum);

  const corps = document.createElement('div');
  corps.className = 'trace-cmd-corps';
  const preCmd = document.createElement('pre');
  const codeCmd = document.createElement('code');
  codeCmd.textContent = '$ ' + String(d.commande || '');
  preCmd.appendChild(codeCmd);
  corps.appendChild(preCmd);
  if (d.stdout) {
    const l = document.createElement('div');
    l.className = 'trace-cmd-sortie-label';
    l.textContent = 'Sortie';
    corps.appendChild(l);
    const pre = document.createElement('pre');
    const c = document.createElement('code');
    c.textContent = String(d.stdout).slice(0, 8000);
    pre.appendChild(c);
    corps.appendChild(pre);
  }
  if (d.stderr) {
    const l = document.createElement('div');
    l.className = 'trace-cmd-sortie-label';
    l.textContent = 'Erreur';
    corps.appendChild(l);
    const pre = document.createElement('pre');
    pre.className = 'trace-cmd-err';
    const c = document.createElement('code');
    c.textContent = String(d.stderr).slice(0, 8000);
    pre.appendChild(c);
    corps.appendChild(pre);
  }
  det.appendChild(corps);
  return det;
}

/* v20260926b (direct) : terminal de sortie EN DIRECT — les paquets stdout /
   stderr s'ajoutent au fil de l'exécution (autoscroll), au lieu d'attendre
   la fin. Borné à 16 000 caractères affichés. */
function creerTerminalExec(codeEl, commande) {
  const pre = codeEl ? codeEl.closest('pre') : null;
  if (!pre) return { el: null, ajouter: () => {}, texte: () => '' };
  const term = document.createElement('div');
  term.className = 'exec-terminal';
  const tete = document.createElement('div');
  tete.className = 'exec-terminal-tete';
  tete.textContent = '$ ' + String(commande || '').slice(0, 200);
  const corps = document.createElement('pre');
  corps.className = 'exec-terminal-corps';
  term.append(tete, corps);
  pre.appendChild(term);
  let total = 0;
  let rafTerm = 0;
  function ajouter(canal, texte) {
    const t = String(texte || '');
    if (!t) return;
    /* v20260926f (kimi, lags) : on ne suit que si déjà en bas. */
    const presBas = term.scrollHeight - term.scrollTop - term.clientHeight < 40;
    const span = document.createElement('span');
    if (canal === 'stderr') span.className = 'term-err';
    span.textContent = t.slice(0, 8000);
    corps.appendChild(span);
    total += t.length;
    while (total > 16000 && corps.firstChild) {
      total -= (corps.firstChild.textContent || '').length;
      corps.removeChild(corps.firstChild);
    }
    if (presBas && !rafTerm) {
      rafTerm = requestAnimationFrame(() => {
        rafTerm = 0;
        try { term.scrollTop = term.scrollHeight; } catch {}
      });
    }
  }
  return { el: term, ajouter, texte: () => corps.textContent || '' };
}
/* Lit un flux NDJSON d'exécution : {type:'sortie'}* puis {type:'fin'}.
   Retourne l'objet 'fin', ou un objet {interrompu:true, stdout, stderr} si
   le flux casse en route (JAMAIS de re-POST : pas de double exécution). */
async function lireFluxExec(corpsFlux, terminal) {
  const lecteur = corpsFlux.getReader();
  const dec = new TextDecoder();
  let tampon = '';
  let stdout = '';
  let stderr = '';
  const traiter = (brute) => {
    const ligne = brute.trim();
    if (!ligne) return null;
    try {
      const ev = JSON.parse(ligne);
      if (ev && ev.type === 'sortie') {
        fluxStats.sorties += 1;
        const canal = ev.canal === 'stderr' ? 'stderr' : 'stdout';
        const txt = String(ev.texte || '');
        if (terminal) terminal.ajouter(canal, txt);
        if (canal === 'stderr') stderr += txt;
        else stdout += txt;
      } else if (ev && ev.type === 'fin') {
        return ev;
      }
    } catch (e) { /* ligne partielle -> ignorée */ }
    return null;
  };
  try {
    for (;;) {
      const lecture = await lecteur.read();
      if (lecture.done) break;
      tampon += dec.decode(lecture.value, { stream: true });
      let idx;
      while ((idx = tampon.indexOf('\n')) >= 0) {
        const fin = traiter(tampon.slice(0, idx));
        tampon = tampon.slice(idx + 1);
        if (fin) { try { lecteur.cancel(); } catch (e) {} return fin; }
      }
    }
    tampon += dec.decode();
    const fin = traiter(tampon);
    if (fin) return fin;
  } catch (e) { /* coupure -> sortie partielle ci-dessous */ }
  if (stdout || stderr) {
    return { commande: '', ok: false, code: null, stdout, stderr, duree_ms: null, interrompu: true };
  }
  return null;
}
/* Finalisation commune (flux ou JSON) : trace repliable + persistance. */
function conclureExec(codeEl, brut, d, auto, convoId) {
  const ancienneZone = codeEl.closest('pre')?.querySelector('.exec-sortie');
  if (ancienneZone) ancienneZone.remove();
  ajouterTraceActivite(codeEl, d);
  memoriserTraceActivite(brut, d, convoId);
  if (auto) {
    const p = codeEl.closest('pre');
    if (p) p.dataset.execAuto = '1';
  }
  return d;
}

/* Envoie la commande à /api/exec (shim → local-agent 127.0.0.1:3020 — le
   shell tourne SUR LE POSTE, jamais dans le navigateur). Deux chemins :
   - manuel (défaut, ou préférence executionAuto off) :
       1) POST confirme:false → 428 = confirmation requise (ou 403 bloqué)
       2) modale utilisateur
       3) POST confirme:true → sortie/stderr affichées sous le bloc
   - auto ({ auto: true }, préférence executionAuto ON) :
       UN SEUL POST confirme:true, sans modale — le modèle « appuie » sur
       la commande lui-même. Les garde-fous de l'agent (liste DENY, origine
       autorisée, bind 127.0.0.1, timeout, journal) restent inchangés.
   Retourne le détail {commande, ok, code, stdout, stderr, duree_ms} ou null. */
async function lancerCommandeLocale(commande, bouton, codeEl, opts) {
  const auto = Boolean(opts && opts.auto);
  if (bouton.disabled) return null;
  const brut = String(commande || '').trim();
  if (!brut) return null;
  const convoId = idConversation;
  bouton.disabled = true;
  bouton.textContent = '…';
  const zone = () => codeEl.closest('pre')?.querySelector('.exec-sortie')
    || (() => {
      const d = document.createElement('div');
      d.className = 'exec-sortie';
      codeEl.closest('pre')?.appendChild(d);
      return d;
    })();
  /* v1.2 (audit) : echec() ne doit JAMAIS lever — sinon l'erreur d'affichage
     masque l'erreur réelle (et le finally levait un ReferenceError TDZ qui
     tuait la promesse en silence).
     v1.2 (anti-bâclage) : RETOURNE `d`, plus null. Un refus (400 lint, 403
     liste de refus, agent injoignable) doit revenir au modèle comme un
     résultat : sinon la boucle s'arrêtait pile sur l'erreur et le modèle ne
     pouvait jamais corriger sa propre commande. */
  const echec = (raison, code) => {
    const d = { commande: brut, ok: false, stderr: raison, code: (code === undefined ? null : code), duree_ms: null };
    try {
      zone().textContent = raison;
      zone().className = 'exec-sortie err';
    } catch {}
    try { ajouterTraceActivite(codeEl, d); } catch {}
    try { memoriserTraceActivite(brut, d, convoId); } catch {}
    return d;
  };
  /* v1.2 (audit) : ces lets sont HORS du try, en tête de fonction — toute
     exception (y compris avant le flux) trouve le finally avec des variables
     initialisées : plus aucun ReferenceError masquant. */
    let terminal = null;
    let tFlux = null;
    const ctrlFlux = ('AbortController' in window) ? new AbortController() : null;
    /* v1.2 (anti-timeout) : borne client 90 s (agent : 60 s) — sans elle, un
       flux qui cale laisse le bouton sur '…' pour toujours. */
    const BORNE_FLUX_MS = 90000;
  try {
    if (!auto) {
      const probe = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commande: brut, confirme: false }),
      });
      const dj = await probe.json().catch(() => ({}));
      if (probe.status === 403 || (dj && dj.erreur && dj.motif)) {
        return echec('Bloqué : ' + (dj.motif || dj.erreur));
      }
      if (probe.status !== 428 && !probe.ok) {
        const msgProbe = (dj && dj.erreur) || ('Erreur agent (' + probe.status + ')');
        return echec(msgProbe + (dj && dj.aide ? ' — ' + dj.aide : ''));
      }
      const ok = await boiteModale({
        titre: 'Exécuter sur ce PC ?',
        message: 'Commande : ' + brut.slice(0, 180) + (brut.length > 180 ? '…' : '') +
          '\nAgent local 127.0.0.1:3020 — confirmez seulement si vous faites confiance à cette commande.',
        labelOk: 'Exécuter',
        danger: true,
      });
      if (!ok) { zone().textContent = 'Annulé.'; return null; }
    }
    /* v20260926b (direct) : UN SEUL POST avec flux:true — sortie EN DIRECT
       (terminal ci-dessus), ou JSON unique si l'agent est ancien. En cas de
       coupure on finalise le partiel : JAMAIS de second POST (la commande
       ne doit pas tourner deux fois). */
    try {
      terminal = creerTerminalExec(codeEl, brut);
      if (ctrlFlux) tFlux = setTimeout(() => { try { ctrlFlux.abort(); } catch {} }, BORNE_FLUX_MS);
      /* v1.2 : l'agent local peut tomber (redémarrage de la garde) au milieu
         d'une tâche longue — la commande est alors perdue à jamais et la
         chaîne s'arrête. On réessaie 3 fois avec attente : la garde le
         relance en 20 s, la commande repart. Seul l'échec RÉEL est rendu. */
      const posterExec = () => fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commande: brut, confirme: true, flux: true }),
        signal: ctrlFlux ? ctrlFlux.signal : undefined,
      });
      let rf = null;
      let dernierErr = null;
      for (let essai = 0; essai < 3; essai += 1) {
        if (essai > 0) {
          try { await new Promise((res) => { setTimeout(res, 3000); }); } catch {}
          if (ctrlFlux && ctrlFlux.signal.aborted) break;
        }
        try { rf = await posterExec(); break; }
        catch (e) {
          dernierErr = e;
          if (e && e.name === 'AbortError') break;
        }
      }
      if (!rf) {
        if (terminal && terminal.el) terminal.el.remove();
        return echec('Agent local injoignable après 3 tentatives — '
          + String((dernierErr && dernierErr.message) || dernierErr || '').slice(0, 200));
      }
      const ctypeF = rf.headers.get('content-type') || '';
      if (rf.ok && ctypeF.includes('ndjson') && rf.body) {
        const dFin = await lireFluxExec(rf.body, terminal);
        if (terminal && terminal.el) terminal.el.remove();
        if (dFin && !dFin.interrompu) {
          if (dFin.motif) return echec('Bloqué : ' + dFin.motif);
          return conclureExec(codeEl, brut, dFin, auto, convoId);
        }
        return conclureExec(codeEl, brut, {
          commande: brut,
          ok: false,
          code: (dFin && dFin.code) || null,
          stdout: (dFin && dFin.stdout) || '',
          stderr: ((dFin && dFin.stderr) || '') + '\n[flux interrompu — sortie partielle]',
          duree_ms: (dFin && dFin.duree_ms) || null,
        }, auto, convoId);
      }
      /* Vieil agent (sans flux) ou erreur structurée : JSON réutilisé tel quel. */
      const d = await rf.json().catch(() => ({}));
      if (terminal && terminal.el) terminal.el.remove();
      if (d && d.motif) return echec('Bloqué : ' + d.motif, 403);
      if (!rf.ok || d.erreur) {
        /* v1.2 : le code HTTP part au modèle (400 = refus lint + aide,
           403 = liste de refus) : sans lui il ne sait pas quoi corriger. */
        return echec((d && (d.erreur + (d.aide ? ' — ' + d.aide : ''))) || ('HTTP ' + rf.status), rf.status);
      }
      return conclureExec(codeEl, brut, d, auto, convoId);
    } catch (e) {
      if (terminal && terminal.el) terminal.el.remove();
      if (e && e.name === 'AbortError') return echec('Délai dépassé (90 s) — commande trop longue ou agent bloqué.');
      return echec(String((e && e.message) || e).slice(0, 400));
    }
  } catch (e) {
    return echec(String((e && e.message) || e).slice(0, 400));
  } finally {
    if (tFlux) clearTimeout(tFlux);
    bouton.disabled = false;
    bouton.textContent = 'Exécuter';
  }
}

/* Exécution automatique (préférence executionAuto, OFF par défaut depuis
   v1.2 — sécurité : pas d'exécution sans clic) :
   les blocs ```athena-exec de la réponse fraîche partent seuls sur
   l'agent local, dans l'ordre, sans modale. Appelé UNIQUEMENT après un
   rendu neuf (genererReponse) : recharger ou rouvrir une conversation
   ne ré-exécute JAMAIS rien. */
function autoExecBlocs(bulleEl) {
  const blocs = bulleEl ? [...bulleEl.querySelectorAll('.exec-bloc')] : [];
  if (!blocs.length) return Promise.resolve([]);
  /* v1.2 : budget d'exécution épuisé → on ne lance plus rien (une commande
     exécutée sans personne pour la lire ferait avancer le modèle à l'aveugle). */
  const convo = conversationOuverte();
  if (convo && convo._budgetEpuise) return Promise.resolve([]);
  /* v1.2 (anti-bâclage) : REND LES RÉSULTATS. Avant, le résultat de la
     commande partait dans le vide : le modèle emitait une commande,
     l'agent l'exécutait, la sortie s'affichait… et le tour s'arrêtait là
     (le modèle ne l'a jamais lue). Le tableau alimente enchainerApresExec. */
  return (async () => {
    const resultats = [];
    for (const pre of blocs) {
      const codeEl = pre.querySelector('code');
      const bouton = pre.querySelector('.code-exec');
      if (!codeEl || !bouton || pre.dataset.execAuto === '1') continue;
      /* eslint-disable-next-line no-await-in-loop — séquentiel volontaire */
      const d = await lancerCommandeLocale(codeEl.textContent, bouton, codeEl, { auto: true });
      if (d) resultats.push(d);
    }
    return resultats;
  })();
}

/* v1.2 (anti-bâclage, BOUCLE) : le résultat d'une commande revient au modèle.
   Symptôme : « analyse le code » → UNE commande, puis silence. Le modèle
   écrivait son bloc, l'agent l'exécutait, la sortie s'affichait sous le bloc
   — et personne ne la lui rendait. Aucune boucle = analyse jamais menée à
   terme (pour l'agent Python il existe max_etapes=14 ; pas ici).
   On ajoute donc un tour de suite : sortie+code de chaque commande repart
   dans l'historique, le modèle continue (autre commande OU verdict). Plafond
   MAX_TOURS_EXEC + arrêt si l'utilisateur interrompt — jamais de boucle infinie. */
/* v1.2 : la chaîne ne s'arrête que sur l'arrêt NATUREL du modèle (une réponse
   sans bloc de commande). Ces deux constantes ne servent plus à couper une
   tâche : FENETRE_EXEC borne la MÉMOIRE du journal d'exécution, et
   ABSOLU_TOURS_EXEC est un simple filet qui force le verdict final. */
const FENETRE_EXEC = 4;
const ABSOLU_TOURS_EXEC = 120;
/* v1.2 (pleine puissance) : 8000 car. par sortie de commande, c'était trop
   court pour un fichier (46 Ko = six pages tronquées) et le modèle en
   concluait « résultat inexploitable ». On monte à 40 000 : une page de code
   tient largement, la troncature est annoncée explicitement, et le journal
   reste borné par FENETRE_EXEC + la compression du shim. */
const MAX_SORTIE_EXEC_MODELE = 40000;

function corpsPourModele(d, repete) {
  const sortie = String((d && d.stdout) || '');
  const err = String((d && d.stderr) || '');
  const coupe = (t) => (t.length > MAX_SORTIE_EXEC_MODELE
    ? t.slice(0, MAX_SORTIE_EXEC_MODELE)
      + '\n[…sortie tronquée : ' + t.length + ' caractères au total…]'
    : t);
  const corps = ['<resultat_commande>', 'commande : ' + String((d && d.commande) || '')];
  corps.push('succes : ' + (d && d.ok ? 'oui' : 'non'));
  corps.push('code : ' + ((d && d.code) == null ? 'n/c' : d.code)
    + ((d && d.code) !== 0 && !err.trim() ? ' (code shell non nul MAIS aucune erreur affichée : sous PowerShell 5.1 un simple accès refusé suffit à le faire monter — la commande a donc réussi)' : ''));
  corps.push('duree_ms : ' + ((d && d.duree_ms) == null ? 'n/c' : d.duree_ms));
  if (sortie.trim()) corps.push('stdout :\n' + coupe(sortie));
  if (err.trim()) corps.push('stderr :\n' + coupe(err));
  if (!sortie.trim() && !err.trim()) corps.push('(aucune sortie)');
  if (repete) corps.push('ATTENTION : tu as déjà lancé cette commande exacte — '
    + 'elle est déjà exécutée, ne la réémet pas. Change d\'approche ou passe à la suite.');
  if (sortie.length > MAX_SORTIE_EXEC_MODELE) {
    corps.push('FIN DE SORTIE (tronquée). Cette sortie est probablement le DÉBUT d\'un '
      + 'gros fichier : relis-le par pages (Select-Object -Skip N -First 150), '
      + 'ne recommence pas à tout déverser.');
  }
  corps.push('</resultat_commande>');
  return corps.join('\n');
}

/* v1.2 (dernier maillon) : le modèle peut terminer sur une PROMESSE au lieu
   d'un acte. Constaté en run réel de 22 min / 196 commandes : après avoir lu
   les 1734 lignes, il a répondu « je vais maintenant cibler les sections,
   corriger, puis tester » — et s'est arrêté. Zéro fichier modifié.
   On relance UNE fois, en lui donnant deux sorties possibles : agir tout de
   suite (bloc de commande) ou donner le verdict. JAMAIS plus d'une relance par
   conversation — sinon on recrée la boucle qu'on vient de supprimer. */
/* Motif tolérant : on ne lit PAS le textContent de la bulle entière — le
   panneau « Raisonnement · 1 s » y est collé à la réponse, ce qui donne
   « …1 sJe vais… » et casse tout \b (mesuré : relance jamais déclenchée).
   On isole donc la réponse avant de tester. */
const PROMESSES = /\b(je vais|je poursuis|je continue|il me reste|prochainement|je dois (maintenant|encore)|je m['’]occupe|i['’]ll|i will|i['’]m going to|let me (check|try|look|run))\b/i;
function texteRepre(seul) {
  try {
    const copie = seul.cloneNode(true);
    copie.querySelectorAll('details.raisonnement, .coupe-badge, .voie-modele')
      .forEach((n) => { try { n.remove(); } catch (_) {} });
    return String(copie.textContent || '').replace(/\s+/g, ' ');
  } catch (_) { return String(seul && seul.textContent || ''); }
}
/* v1.2 (anti-boucle cognitive) : détecte la RÉTRO-ANALYSE — le modèle
   repasse des fois sur la même conclusion sans avancer. Signatures
   observées en run réel (56 appels, 0 écriture) :
   « Wait, but… », « Actually, I think… », « This is a bug! … This is a bug! »,
   « I think I've been going in circles », « OK, I think… ». Trois marques
   suffisent : la réponse est de l'hésitation, pas du travail. */
function tournerEnRond(t) {
  const s = String(t || '');
  if (s.length < 200) return false;             // trop court pour en juger
  let n = 0;
  if (/(wait,\s*but|but wait|actually,?\s*i think|i think i|going in circles|going in circles|i've been going|maybe i|or maybe|actually the issue|actually i)/i.test(s)) n += 1;
  /* la même affirmation répétée : « This is a bug! » au moins 2 fois */
  const fois = (motif) => (s.match(motif) || []).length;
  if (fois(/this is a bug/gi) >= 2) n += 1;
  if (fois(/\b(is (a|the) bug\b|bug !)/gi) >= 3) n += 1;
  return n >= 1;
}

function relancerSiPromesse(convo, bulleEl) {
  try {
    if (!convo || convo._relanceFaite || convo._budgetEpuise) return;
    if (!Number(convo._toursExec)) return;          // aucune tâche en cours
    const b = bulleEl || null;
    if (b && b.querySelector('.exec-bloc')) return; // il a agit : rien à relancer
    const reponse = b ? texteRepre(b) : '';
    /* v1.2 (anti-bouclecognitive) : le cas le plus destructeur n'est pas la
       promesse, c'est la RÉTRO-ANALYSE. Run réel mesuré : le modèle a
       réécrit six fois « nextX >= SIZE - 1 … This is a bug! Wait, … This is a
       bug! OK, I think I've been going in circles » et a consommé 56 appels
       sans jamais écrire. Aucun bloc, aucune promessefuture — donc la
       détection ci-dessous ne le voyait pas. On détecte l'hésitation
       circulaire et on tranche pour lui. */
    if (tournerEnRond(reponse) || PROMESSES.test(reponse)) {
      convo._relanceFaite = true;
      convo.messages.push({
        role: 'user',
        _exec: true,
        content: 'STOP. Tu tournes en rond sur le même point depuis plusieurs '
          + 'réponses — tu n\'avances plus et tu n\'as rien modifié. '
          + 'Décide MAINTENANT, sans plus réfléchir :\n'
          + '1) Si tu as un bug identifié, CORRIGE-LE : sauvegarde '
          + '(`Copy-Item -LiteralPath <f> -Destination <f.bak>`) puis écris le '
          + 'bloc de commande qui applique la correction. Vérifie en relisant le '
          + 'fichier. Un seul bug, mais corrigé et vérifié.\n'
          + '2) Si tu n\'as pas de certitude, livre ton verdict honnête : ce que '
          + 'tu as trouvé, ce que tu n\'as pas pu trancher.\n'
          + 'Dans les deux cas, pas de nouvelle analyse : AGIS ou REND TON VERDICT.',
      });
      convo.maj = Date.now();
      try { sauverConversations(); } catch (_) {}
      notifier('Le modèle tournait en rond — relance pour qu\'il tranche.');
      /* v1.2 (suite) : la relance continue DANS LA MÊME bulle. */
      const partagee = b && b.closest ? (b.closest('.bubble') || null) : null;
      genererReponse(convo, partagee ? { suiteDe: partagee } : undefined).catch(() => {});
      return;
    }
    return;
    /* (code conservé ci-dessous pour référence — plus atteint) */
    if (false) {
    convo.messages.push({
      role: 'user',
      _exec: true,
      content: 'Tu as ANNONCÉ une action mais tu ne l\'as pas faite. Deux sorties '
        + 'possibles, et une seule réponse :\n'
        + '1) Si le travail reste à faire, FAIS-LE MAINTENANT : écris le bloc '
        + '```athena-exec avec la commande qui l\'exécute. Elle part dès que tu '
        + 'écris le bloc — annoncer ne fait rien.\n'
        + '2) Si tu as vraiment fini, donne ton VERDICT COMPLET et terminal : '
        + 'les bugs trouvés (symptôme + cause + correction), les modifications '
        + 'réellement appliquées, et les tests passés. Pas un plan, pas un '
        + '« je vais… ».',
    });
    convo.maj = Date.now();
    try { sauverConversations(); } catch (_) {}
    notifier('Le modèle s\'est arrêté sur une promesse — relance pour qu\'agisse.');
    genererReponse(convo).catch(() => {});
    }
  } catch (_) { /* relance = confort, jamais bloquant */ }
}

function enchainerApresExec(convo, resultats, bulleSuite) {
  if (!convo || !Array.isArray(resultats) || !resultats.length) return;
  /* v1.2 : la chaîne ne s'arrête que sur l'arrêt NATUREL du modèle (une réponse
     sans bloc de commande) — plus de plafond arbitraire qui coupait une tâche
     en cours. ABSOLU_TOURS_EXEC est le seul filet, et il force le verdict
     final au lieu de simplement arrêter. */
  const deja = Number(convo._toursExec) || 0;
  /* Filet ABSOLU, atteint UNE seule fois. On n'enchaîne plus ensuite : sinon
     un modèle qui réémet indéfiniment des commandes reboucle pour toujours
     (mesuré : 86 appels et toujours pas d'arrêt avant correction). Un tour
     final est offert pour rendre le verdict, puis plus rien. */
  if (convo._budgetEpuise) return;
  const presse = deja >= ABSOLU_TOURS_EXEC;
  if (presse) convo._budgetEpuise = true;
  if (!Array.isArray(convo._cmdExecutees)) convo._cmdExecutees = [];
  const blocs = resultats.map((d) => {
    const c = String((d && d.commande) || '').trim();
    const repete = convo._cmdExecutees.indexOf(c) >= 0;
    convo._cmdExecutees.push(c);
    return corpsPourModele(d, repete);
  });
  /* v1.2 (audit) : _toursExec compte des COMMANDES, pas des tours. Avant,
     +1 par tour alors qu'un tour peut porter N commandes : `anciens`
     devenait négatif, et le journal montré au modèle listait de mauvaises
     « anciennes » commandes (slice(0, négatif)). Le budget ABSOLU porte
     donc sur des commandes, comme l'annonce le message. */
  convo._toursExec = deja + blocs.length;
  /* MÉMOIRE BORNÉE : sans ça, chaque tour ajoutait 8 000 caractères et le
     modèle oubliait le début de son propre travail (puis dérape — observé :
     20 commandes de déversement, aucun verdict). On ne garde QUE les
     FENETRE derniers résultats au mot, plus un relevé des commandes
     anciennes : la tâche avance sans que le contexte n'explose. */
  if (!Array.isArray(convo._fenetreExec)) convo._fenetreExec = [];
  blocs.forEach((b) => convo._fenetreExec.push(b));
  while (convo._fenetreExec.length > FENETRE_EXEC) convo._fenetreExec.shift();
  const anciens = convo._toursExec - convo._fenetreExec.length;
  const enonce = presse
    ? 'BUDGET DE COMMANDES ATTEINT (' + ABSOLU_TOURS_EXEC + '). Tu ne peux plus lancer '
      + 'de commande : RENDRE TON VERDICT MAINTENANT — ce que tu as trouvé, ce que '
      + 'tu as corrigé, ce qui reste. Ne réponds pas par une nouvelle commande.'
    : 'Poursuis : autre commande si elle sert la demande, sinon ton analyse et ton '
      + 'verdict. Ne réponds pas UNIQUEMENT par une commande.';
  /* v1.2 (association) : le DERNIER résultat est isolé et nommé. Sans ça les
     6 résultats de la fenêtre formaient une seule liste indistincte et le
     modèle ne retrouvait plus SA commande dans sa sortie — d'où son verdict
     exact en fin de run réel (173 commandes) : « une série de réponses
     successives sans résultat exploitable ». Il avait bien les sorties, il ne
     pouvait plus savoir laquelle était la sienne. */
  const dernier = convo._fenetreExec[convo._fenetreExec.length - 1] || '(aucun)';
  const precedents = convo._fenetreExec.slice(0, -1);
  let contenu = 'Commande(s) exécutée(s) : ' + convo._toursExec + '.'
    + (anciens > 0 ? ' Les ' + anciens + ' plus anciennes ne sont plus en mémoire ; '
      + 'elles étaient : ' + convo._cmdExecutees.slice(0, anciens).map((c) => c.slice(0, 90)).join(' | ') + '.'
      : '') + '\n\n'
    + '=== RÉSULTAT DE TA DERNIÈRE COMMANDE (c\'est celui-là qui compte) ===\n' + dernier
    + (precedents.length
      ? '\n\n=== RÉSULTATS PRÉCÉDENTS (contexte, pas la dernière commande) ===\n'
        + precedents.join('\n\n')
      : '')
    + '\n\n' + enonce;
  if (Number.isInteger(convo._msgExec) && convo.messages[convo._msgExec]
      && convo.messages[convo._msgExec]._exec) {
    /* Message unique réécrit à chaque tour : l'historique ne grossit pas.
       v1.2 (audit 14:27) : le message est AUSSI remis en DERNIER. Avant, il
       restait figé à son index : dès le 2e tour, le dernier message devenait
       la propre réponse précédente du modèle, et le résultat frais se
       retrouvait enterré au milieu — le modèle continuait sans l'avoir vu
       (mesuré : tour 3 sans LIGNE-A alors que l'exec avait réussi). C'est
       aussi l'ordre chronologique réel : le résultat arrive APRÈS la réponse
       qui a lancé la commande. */
    const msg = convo.messages.splice(convo._msgExec, 1)[0];
    msg._dernierIdx = blocs.length - 1;
    msg.content = contenu;
    convo.messages.push(msg);
    convo._msgExec = convo.messages.length - 1;
  } else {
    convo._msgExec = convo.messages.length;
    convo.messages.push({ role: 'user', content: contenu, _exec: true });
  }
  convo.maj = Date.now();
  try { sauverConversations(); } catch (_) {}
  try { rendreConversations(); } catch (_) {}
  /* v1.2 (suite) : la suite CONTINUE dans la même bulle — bulleSuite est la
     .bubble du tour précédent (transmise par l'appelant). Sans elle, chaque
     tour créait une nouvelle bulle : « il refait un message au lieu de
     continuer dans le même ».
     La suite s'affiche comme une réponse normale : l'utilisateur peut
     l'interrompre à tout moment (contrôleurEnCours) et les messages restent
     dans l'historique — un rechargement ne rejoue aucune commande. */
  genererReponse(convo, bulleSuite ? { suiteDe: bulleSuite } : undefined).catch(() => {});
}
/* v20260926b (direct) : enregistre un fichier créé par le modèle sur le PC
   (/api/write → agent local 127.0.0.1:3020).
   - manuel (défaut, executionAuto off) : probe 428 → modale (écrasement
     annoncé) → confirme + ecraser.
   - auto ({auto:true}, executionAuto ON) : UN SEUL POST, sans modale
     (écrasement inclus — comme l'exec auto).
   Sans agent : statut d'échec honnête, le bouton Télécharger reste disponible. */
async function enregistrerFichierLocal(chemin, contenu, bouton, carte, opts) {
  const auto = Boolean(opts && opts.auto);
  /* v20260926l : le bouton « Enregistrer sur ce PC » n'existe plus dans
     l'UI — l'enregistrement passe par l'auto (executionAuto) ; `bouton`
     est donc optionnel (null en auto). */
  if (bouton && bouton.disabled) return null;
  if (!auto && !bouton) return null;
  const brutChemin = String(chemin || '').trim();
  const texte = contenu == null ? '' : String(contenu);
  const statutEl = carte ? carte.querySelector('.file-statut') : null;
  const statut = (t, detail) => {
    if (statutEl) {
      statutEl.textContent = t;
      if (detail) statutEl.title = String(detail).slice(0, 200);
    }
  };
  if (!brutChemin) { statut('chemin vide'); return null; }
  const libelle = bouton ? bouton.textContent : '';
  const occuper = (on) => { if (bouton) { bouton.disabled = on; bouton.textContent = on ? '…' : libelle; } };
  occuper(true);
  statut('envoi…');
  try {
    let existe = false;
    let cheminAbs = brutChemin;
    if (!auto) {
      const probe = await fetch('/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /* v20260926e : dossier de travail choisi dans les réglages. */
        body: JSON.stringify({ chemin: brutChemin, contenu: texte, confirme: false,
          ...(preferences.dossierTravail ? { dossier: preferences.dossierTravail } : {}) }),
      });
      const dj = await probe.json().catch(() => ({}));
      if (!probe.ok && probe.status !== 428) {
        statut('échec', (dj && dj.erreur) || ('HTTP ' + probe.status));
        occuper(false);
        return null;
      }
      existe = Boolean(dj && dj.existe);
      if (dj && dj.chemin) cheminAbs = String(dj.chemin);
      const ok = await boiteModale({
        titre: 'Enregistrer sur ce PC ?',
        message: 'Fichier : ' + String(cheminAbs).slice(0, 180)
          + '\nTaille : ' + tailleFichier(texte.length)
          + (existe ? '\nRemplacera le fichier existant.' : '')
          + '\nAgent local 127.0.0.1:3020 — confirmez seulement si vous faites confiance à ce contenu.',
        labelOk: 'Enregistrer',
        danger: existe,
      });
      if (!ok) {
        statut('annulé');
        occuper(false);
        return null;
      }
    }
    const r = await fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chemin: brutChemin, contenu: texte, confirme: true, ecraser: true,
        ...(preferences.dossierTravail ? { dossier: preferences.dossierTravail } : {}) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) {
      statut('échec', (d && d.erreur) || ('HTTP ' + r.status));
      occuper(false);
      return null;
    }
    statut('enregistré' + (d.ecrase ? ' (remplacé)' : ''), String(d.chemin || ''));
    if (auto && carte) carte.dataset.fileAuto = '1';
    occuper(false);
    return d;
  } catch (e) {
    statut('échec', String((e && e.message) || e).slice(0, 200));
    occuper(false);
    return null;
  }
}
/* Comme autoExecBlocs : les cartes ```athena-file de la réponse FRAÎCHE sont
   enregistrées seules, dans l'ordre, sans modale. Jamais en rejeu.
   v1.2 (audit 14:27) : REND les résultats. Avant, le modèle ne savait JAMAIS
   où son fichier avait atterri (chemin absolu réel) : il devinait un chemin,
   l'exec le cherchait ailleurs, throw → code=1, tâche morte. Le retour
   alimente enchainerApresExec comme une commande. */
function autoFileBlocs(bulleEl) {
  const cartes = bulleEl ? [...bulleEl.querySelectorAll('.file-bloc')] : [];
  if (!cartes.length) return Promise.resolve([]);
  return (async () => {
    const resultats = [];
    for (const carte of cartes) {
      if (carte.dataset.fileAuto === '1') continue;
      const contenu = carte._contenuComplet != null ? carte._contenuComplet : '';
      /* eslint-disable-next-line no-await-in-loop — séquentiel volontaire */
      const d = await enregistrerFichierLocal(carte.dataset.chemin || '', contenu, null, carte, { auto: true });
      const demande = String(carte.dataset.chemin || '');
      if (d && d.chemin) {
        resultats.push({ commande: 'enregistrer ' + demande, ok: true, code: 0,
          stdout: 'Fichier enregistré : ' + String(d.chemin) + (d.ecrase ? ' (remplacé)' : ''),
          stderr: '', duree_ms: null });
      } else {
        /* v1.2 (audit 14:27) : la VRAIE raison part au modèle (chemin hors
           zone, dossier système, agent injoignable…), pas un « échec » sec —
           sinon il ne peut pas corriger et devine un autre chemin au hasard. */
        const carteStatut = carte.querySelector('.file-statut');
        const raison = (carteStatut && (carteStatut.title || carteStatut.textContent) || 'raison inconnue').slice(0, 300);
        resultats.push({ commande: 'enregistrer ' + demande, ok: false, code: null,
          stdout: '', stderr: 'Échec d\'enregistrement : ' + raison, duree_ms: null });
      }
    }
    return resultats;
  })();
}
function creerGroupeActivite() {
  const groupe = document.createElement('details');
  groupe.className = 'activity-group';
  groupe.open = true;
  const sum = document.createElement('summary');
  sum.appendChild(icoSvg('terminal'));
  const label = document.createElement('span');
  label.className = 'activity-label';
  label.textContent = 'Exécuté';
  const count = document.createElement('span');
  count.className = 'activity-count';
  count.textContent = '0 commande';
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.appendChild(icoSvg('chevron'));
  sum.append(label, count, chev);
  const body = document.createElement('div');
  body.className = 'activity-body';
  groupe.append(sum, body);
  return groupe;
}
function ajouterTraceAuGroupe(groupe, donnees) {
  const body = groupe.querySelector('.activity-body');
  body.appendChild(creerBlocTraceCommande({ ...donnees, ok: donnees.ok !== false }));
  const n = body.querySelectorAll('.trace-cmd').length;
  groupe.querySelector('.activity-count').textContent = n + ' commande' + (n > 1 ? 's' : '');
}
function ajouterTraceActivite(codeEl, donnees) {
  const pre = codeEl.closest('pre');
  const parent = pre?.parentElement;
  if (!pre || !parent) return;
  let groupe = parent.querySelector('.activity-group');
  if (!groupe) {
    groupe = creerGroupeActivite();
    parent.appendChild(groupe);
  }
  ajouterTraceAuGroupe(groupe, donnees);
}

function memoriserTraceActivite(commande, donnees, convoId = idConversation) {
  const c = conversations.find((item) => item.id === convoId) || conversationOuverte();
  const dernier = [...(c.messages || [])].reverse().find((m) => m && m.role === 'assistant');
  if (!dernier) return;
  dernier.traces = Array.isArray(dernier.traces) ? dernier.traces : [];
  dernier.traces.push({
    commande: String(commande || '').slice(0, 4000),
    ok: donnees.ok !== false,
    code: typeof donnees.code === 'number' ? donnees.code : null,
    stdout: String(donnees.stdout || '').slice(0, 8000),
    stderr: String(donnees.stderr || '').slice(0, 8000),
    duree_ms: typeof donnees.duree_ms === 'number' ? donnees.duree_ms : null,
  });
  c.maj = Date.now();
  sauverConversations();
}

/* v20260926d : tableau pipe minimal (| a | b | + séparateur |---|---|).
   Cellules en textContent (pas de HTML injecté) ; alignements :---: gérés. */
function estLigneSeparateurTableau(ligne) {
  const t = String(ligne || '').trim();
  if (!t.includes('-')) return false;
  return /^\|?[\s:|.-]*\|[\s:|.-]*$/.test(t) && !/[^|\s:.-]/.test(t);
}
function decouperCellules(ligne) {
  return String(ligne || '').trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}
function construireTableau(lignes, debut) {
  const entetes = decouperCellules(lignes[debut]);
  const aligns = decouperCellules(lignes[debut + 1]).map((c) => {
    const g = c.startsWith(':');
    const d = c.endsWith(':');
    return g && d ? 'center' : d ? 'right' : 'left';
  });
  const table = document.createElement('table');
  table.className = 'md-table';
  const thead = document.createElement('thead');
  const lr = document.createElement('tr');
  entetes.forEach((h, k) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (aligns[k] && aligns[k] !== 'left') th.style.textAlign = aligns[k];
    lr.appendChild(th);
  });
  thead.appendChild(lr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  let i = debut + 2;
  while (i < lignes.length && lignes[i].includes('|') && lignes[i].trim()) {
    const cels = decouperCellules(lignes[i]);
    const tr = document.createElement('tr');
    cels.forEach((c, k) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (aligns[k] && aligns[k] !== 'left') td.style.textAlign = aligns[k];
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    i++;
  }
  table.appendChild(tbody);
  return { el: table, fin: i };
}

/* Analyse bloc par bloc (ligne à ligne) ; retourne un DocumentFragment. */
function markdownVersFragment(texte) {
  const fragment = document.createDocumentFragment();
  const lignes = String(texte || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let paragraphe = [];
  const viderParagraphe = () => {
    if (!paragraphe.length) return;
    const p = document.createElement('p');
    p.innerHTML = markdownInline(paragraphe.join('\n'));
    fragment.appendChild(p);
    paragraphe = [];
  };
  while (i < lignes.length) {
    const ligne = lignes[i];
    // Bloc de code clôturé (le 1.5B oublie parfois le ``` final : on clôt
    // alors à la fin du texte — mieux qu'un affichage en brut)
    // v20260926b (direct) : le reste de la ligne d'ouverture est capturé
    // (params) pour ```athena-file chemin="...".
    /* v1.2 (étiquette collée) : ```athena-exec$f=… SANS saut de ligne — le
       (\S*) avalait la commande entière : elle devenait le « langage », le
       corps du bloc restait vide et le bloc perdait son bouton Exécuter (vu sur
       un export réel : tout le PowerShell s'affichait dans le badge .code-lang).
       On borne l'étiquette aux caractères de langage, on détache les étiquettes
       connues collées au code, et le reste de la ligne devient la 1re ligne du
       corps — fermeture collée comprise. */
    const ouverture = /^(\s*)```([A-Za-z0-9_+#.-]*)(.*)$/.exec(ligne);
    if (ouverture) {
      viderParagraphe();
      let langage = ouverture[2] || '';
      let resteLigne = ouverture[3] || '';
      const bas = langage.toLowerCase();
      ['athena-exec', 'athena-file'].forEach((spec) => {
        if (bas.indexOf(spec) === 0 && langage.length > spec.length) {
          resteLigne = langage.slice(spec.length) + resteLigne;
          langage = spec;
        }
      });
      let apresBloc = '';
      const fc = resteLigne.indexOf('```');
      if (fc >= 0) { apresBloc = resteLigne.slice(fc + 3); resteLigne = resteLigne.slice(0, fc); }
      const estFichier = langage.toLowerCase() === 'athena-file';
      const params = (estFichier ? resteLigne : '').trim();
      const retrait = ouverture[1].length;
      const dedenter = (l) => {
        let k = 0;
        while (k < retrait && k < l.length && /\s/.test(l[k])) k++;
        return l.slice(k);
      };
      const corps = [];
      const premiere = estFichier ? '' : resteLigne.replace(/\s+$/, '');
      if (premiere) corps.push(dedenter(premiere));
      i++;
      while (i < lignes.length && !/^\s*```/.test(lignes[i])) { corps.push(dedenter(lignes[i])); i++; }
      i++; // sauter le ``` de fermeture (ou dépasser la fin)
      /* v20260926b (direct) : ```athena-file → carte fichier (PC + download). */
      if (estFichier) {
        fragment.appendChild(creerBlocFichier(params, corps.join('\n')));
      } else {
        fragment.appendChild(creerBlocCode(langage, corps.join('\n')));
      }
      if (apresBloc.trim()) paragraphe.push(apresBloc.trim());
      continue;
    }
    /* v20260926d (kimi) : tableaux pipe — le commentaire les promettait, le
       rendu les crachait en paragraphes bruts. */
    if (ligne.includes('|') && i + 1 < lignes.length && estLigneSeparateurTableau(lignes[i + 1])) {
      viderParagraphe();
      const tab = construireTableau(lignes, i);
      fragment.appendChild(tab.el);
      i = tab.fin;
      continue;
    }
    if (!ligne.trim()) { viderParagraphe(); i++; continue; }
    const titre = /^(#{1,6})\s+(.*)$/.exec(ligne);
    if (titre) {
      viderParagraphe();
      const h = document.createElement('h' + Math.min(titre[1].length, 3));
      h.innerHTML = markdownInline(titre[2]);
      fragment.appendChild(h);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ligne)) {
      viderParagraphe();
      fragment.appendChild(document.createElement('hr'));
      i++;
      continue;
    }
    /* v20260926n : listes à puces ET numérotées confiées au même constructeur
       — l'ancienne version aplattissait tout (« - parent /   - enfant »
       sortait en 4 puces sur le même niveau) et coupait la liste en deux dès
       qu'un bloc de code ou un paragraphe suivait l'item. */
    if (/^\s*(?:[-*•]|\d+[.)])\s+\S/.test(ligne)) {
      viderParagraphe();
      const liste = construireListe(lignes, i);
      fragment.appendChild(liste.el);
      i = liste.fin;
      continue;
    }
    if (/^\s*>\s?/.test(ligne)) {
      viderParagraphe();
      const cite = document.createElement('blockquote');
      const contenu = [];
      while (i < lignes.length && /^\s*>\s?/.test(lignes[i])) {
        contenu.push(lignes[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      /* rendu récursif : une citation contient des listes, des titres et des
         blocs de code (« > ```js » sortait en texte brut avant) */
      cite.appendChild(markdownVersFragment(contenu.join('\n')));
      fragment.appendChild(cite);
      continue;
    }
    paragraphe.push(ligne);
    i++;
  }
  viderParagraphe();
  return fragment;
}

/* v20260926n : construit une liste (puces ou numérotée) à partir de sa
   PREMIÈRE ligne. Chaque item est découpé puis rendu par récursion, ce qui
   donne gratuitement l'imbrication (indentation > niveau de base = contenu de
   l'item courant) et les blocs internes (code, tableau, sous-liste).
   Retourne { el, fin } — fin = index de la première ligne HORS liste. */
const RE_ITEM_LISTE = /^(\s*)(?:[-*•]|\d+[.)])(?:[ \t]+(.*))?$/;
const RE_ITEM_ORDO = /^\s*\d+[.)](?:[ \t]|$)/;

function construireListe(lignes, debut) {
  const m0 = RE_ITEM_LISTE.exec(lignes[debut]);
  const indentBase = m0[1].length;
  const ordonnee = RE_ITEM_ORDO.test(lignes[debut]);
  const el = document.createElement(ordonnee ? 'ol' : 'ul');
  const items = [];
  const indentDe = (l) => l.length - l.replace(/^\s*/, '').length;
  /* large = liste LÂCHE (une ligne vide sépare deux items) → les <p> sont
     conservés. Un « 1. » qui suit une ligne vide relance la numérotation :
     c'est une NOUVELLE liste, pas un item de plus. */
  let large = false;
  let separateur = false;
  let courant = null;
  let i = debut;
  while (i < lignes.length) {
    const ligne = lignes[i];
    if (!ligne.trim()) {
      let j = i;
      while (j < lignes.length && !lignes[j].trim()) j++;
      if (j >= lignes.length || !courant) break;
      const mj = RE_ITEM_LISTE.exec(lignes[j]);
      const indJ = mj ? mj[1].length : indentDe(lignes[j]);
      if (mj && indJ >= indentBase) {
        separateur = true;          // sépare deux items : on ne range PAS le vide
        i++;
        continue;
      }
      if (indJ > indentBase) {
        large = true;               // contenu indenté de l'item courant
        courant.lignes.push('');
        i++;
        continue;
      }
      break;
    }
    const sep = separateur;
    separateur = false;
    const m = RE_ITEM_LISTE.exec(ligne);
    const ind = m ? m[1].length : indentDe(ligne);
    if (m && ind === indentBase) {
      // changement de type (puces ↔ numérotée) au même niveau = nouvelle liste
      if (courant && RE_ITEM_ORDO.test(ligne) !== ordonnee) break;
      const nm = /^\s*(\d+)[.)]/.exec(ligne);
      if (sep && nm && Number(nm[1]) === 1 && items.length) break;
      if (sep) large = true;
      courant = { lignes: [m[2] || ''] };
      items.push(courant);
      i++;
      continue;
    }
    if (!courant) break;
    if (ind <= indentBase) break;   // nouveau bloc hors liste (laziness refusée)
    // suite de l'item : dédentée de 2 espaces (ou de l'indentation dispo)
    courant.lignes.push(ligne.slice(Math.min(ind, indentBase + 2)));
    i++;
  }
  items.forEach((it) => {
    const li = document.createElement('li');
    const frag = markdownVersFragment(it.lignes.join('\n'));
    /* liste SERRÉE : les <p> de premier rang sont dépliés — sinon chaque
       puce prenait les marges d'un paragraphe et la liste doublait. */
    if (!large) {
      [...frag.childNodes].forEach((n) => {
        if (n.nodeType === 1 && n.nodeName === 'P') {
          const morceau = document.createDocumentFragment();
          while (n.firstChild) morceau.appendChild(n.firstChild);
          n.parentNode.insertBefore(morceau, n);
          n.remove();
        }
      });
    }
    li.appendChild(frag);
    el.appendChild(li);
  });
  return { el, fin: i };
}

/* ---------- v1.2 : la pensée interne ne doit JAMAIS atteindre la réponse ------
   Deux formes de fuite mesurées (test_fuite_raisonnement) :
   A) flux qui ne produit QUE du raisonnement → le shim substituait la pensée
      à la réponse (corrigé côté shim : la cascade retente le modèle suivant) ;
   C) modèle free qui baloque sa chaîne de pensée DANS le contenu
      (« **Thinking:** … », <thinking>…</thinking>, ```…```).
   Ces marqueurs sont retirés de l'affichage ET du contenu persisté (le texte
   repart donc aussi propre dans l'historique renvoyé au modèle).
   Ne touche JAMAIS aux vrais blocs de code : on ne traite que les marqueurs
   explicites de raisonnement, jamais les ``` qui ouvrent une commande. */
const MOTIF_PAIRE_COT = /<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?\s*>/gi;
const MOTIF_OUVREUR_COT = /^\s*<think(?:ing)?\b[^>]*>[\s\S]*$/i;
const MOTIF_ETIQUETTE_COT = /<\/?think(?:ing)?\b[^>]*>/gi;
/* En-tête de pensée : EXIGE soit du gras (« **Thinking:** »), soit un mot
   suivi de deux-points EN FIN DE LIGNE (« Réflexion :\n »). Une phrase
   légitime commençant par « Thinking: la réponse est… » (même ligne) n'est
   donc JAMAIS confondue avec de la pensée. */
const MOTIF_ENTETE_COT = new RegExp(
  '^\\s*(?:#{1,6}\\s*)?'
  + '(?:(?:\\*{1,2}|_{1,2})(?:thinking|pens\\u00e9e|pensee|r\\u00e9flexion|reflexion)\\s*:?\\s*(?:\\*{1,2}|_{1,2})?\\s*'
  + '|(?:#{1,6}\\s*)?(?:thinking|pens\\u00e9e|pensee|r\\u00e9flexion|reflexion)\\s*:\\s*(?=\\n))',
  'i');

function nettoyerCoT(texte) {
  let t = String(texte || '');
  if (!t || !t.trim()) return t;
  /* Garde économique : appelée à CHAQUE jeton du flux — on ne lance les
     motifs (dont un balayage de la réponse entière) que si la réponse en
     contient réellement un. */
  if (t.indexOf('<think') === -1 && t.indexOf('</think') === -1
    && !MOTIF_ENTETE_COT.test(t)) return t;
  /* 1. <thinking>…</thinking> : l'intérieur est de la pensée, pas de la
        réponse — retiré intégralement (les vrais ``` de code ne ressemblent
        pas à ces balises, ils sont intacts). */
  t = t.replace(MOTIF_PAIRE_COT, '');
  t = t.replace(MOTIF_OUVREUR_COT, '');
  t = t.replace(MOTIF_ETIQUETTE_COT, '');
  /* 2. En-tête « **Thinking:** » / « Réflexion : » en TÊTE de réponse : la
        pensée court jusqu'au premier saut de paragraphe (ou, à défaut de
        paragraphe, jusqu'à la dernière ligne) — le reste est la réponse. */
  if (MOTIF_ENTETE_COT.test(t)) {
    const sansEnTete = t.replace(MOTIF_ENTETE_COT, '');
    const paragraphes = sansEnTete.split(/\n\s*\n/);
    t = paragraphes.length > 1
      ? paragraphes.slice(1).join('\n\n')
      : (sansEnTete.trim().split(/\n/).pop() || '');
  }
  return t.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '');
}

/* Retire les étiquettes « Résultat : » / « Réponse : » puis rend le Markdown.
   (v9.4 : retourne un fragment DOM riche ; les bulles utilisateur continuent
   d'utiliser du texte brut — un message tapé n'est pas du Markdown.) */
function formater(texte) {
  /* v20260926j : le deux-points est désormais EXIGÉ — avant, « Réponse de
     test… » en début de message était avalé avec l'étiquette. */
  const sansEtiquette = String(texte || '')
    .replace(/(^|\n)\s*Résultat\s*:\s*/g, '$1')
    .replace(/(^|\n)\s*Réponse\s*:\s*/g, '$1')
    .replace(/\s+$/, '');
  /* v1.2 : historique ANCIEN nettoyé au rendu aussi (une conversation créée
     avant ce correctif contient encore la pensée brute). */
  return markdownVersFragment(nettoyerCoT(sansEtiquette));
}

/* ---------- v7.1 : panneau « raisonnement en direct » (canal de progression) ----------
   Rendu type « interfaces d'IA classiques » : en direct le panneau est
   déplié (spinner + dernière étape), puis il SE REPLIE à la réponse avec
   « Raisonnement · N étapes · Xs » — un clic pour revoir le détail.
   Les étapes sont une frise (point + trait) plutôt qu'une liste à puces. */
/* ---------- v20260926g (Claude) : RAISONNEMENT AGRÉGÉ ----------
   Les chunks du stream ne sont jamais des étapes : le panneau est UN SEUL
   composant conversationnel (en-tête compact + texte continu + statut).
   agregerRaisonnement() regroupe un tableau brut [{etape, message}] en
   { texte, transitions } — utilisé au rendu, à l'export et au rejeu, pour
   les sauvegardes neuves comme pour les anciennes (tranches historiques). */
function agregerRaisonnement(etapes) {
  const morceaux = [];
  const transitions = [];
  for (const et of etapes || []) {
    const etape = et && et.etape;
    const msg = String((et && et.message) || '').trim();
    if (!msg) continue;
    /* Masquage technique : jamais de noms de provider dans l'UI. */
    if (/^Appel · /.test(msg)) { transitions.push('Appel au modèle…'); continue; }
    if (/^Réponse générée via /.test(msg)) continue;
    if (etape === 'texte') { morceaux.push(msg); continue; }
    /* v20260926g-revue (kimi) : les imports et les longs messages sont du
       TEXTE, pas des transitions — sinon le raisonnement historique est
       perdu à l'affichage. */
    if (etape === 'import' || msg.length > 140) { morceaux.push(msg); continue; }
    if (etape === 'reasoning') { morceaux.push(msg.replace(/^…/, '')); continue; }
    if (etape === 'generation') {
      if (msg === 'Rédaction de la réponse…') { transitions.push(msg); continue; }
      morceaux.push(msg.replace(/^…/, ''));
      continue;
    }
    if (msg.length <= 140) transitions.push(msg);
  }
  /* v20260926g-revue : '\n' entre morceaux (les tranches historiques
     s'affichaient en lignes séparées) ; les blocs multi-\n sont réduits. */
  const texte = morceaux.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { texte, transitions };
}
function texteEtape(et) {
  /* le pipeline préfixe parfois « ⚠ » : gardé pour la classe .doute,
     retiré du texte affiché (marque visuelle gérée par le style). */
  return String((et && et.message) || '').replace(/^\s*⚠\s*/, '');
}
/* v20260926g : construireListeEtapes/estEtapeDoute supprimées — la frise
   d'événements (console de logs) est remplacée par le composant agrégé. */
function detailsRaisonnementDepuisEtapes(etapes) {
  /* v20260926g-revue : agrégat vide = pas de composant (panneau
     summary-seul = zone morte cliquable). */
  const agg0 = agregerRaisonnement(etapes);
  if (!agg0.texte && !agg0.transitions.length) return null;
  const det = document.createElement('details');
  det.className = 'raisonnement';
  const sum = document.createElement('summary');
  const titre = document.createElement('span');
  titre.className = 'raisonnement-titre';
  titre.textContent = '✦ Raisonnement';
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.appendChild(icoSvg('chevron'));
  sum.appendChild(titre);
  sum.appendChild(chev);
  det.appendChild(sum);
  /* v20260926g : restitue le composant agrégé (statut + texte continu),
     y compris depuis les sauvegardes historiques en tranches. */
  const agg = agregerRaisonnement(etapes);
  if (agg.transitions.length) {
    const statut = document.createElement('div');
    statut.className = 'raisonnement-phases';
    statut.textContent = agg.transitions.join(' · ');
    det.appendChild(statut);
  }
  if (agg.texte) {
    const p = document.createElement('div');
    p.className = 'raisonnement-texte';
    p.textContent = agg.texte;
    det.appendChild(p);
  }
  return det;
}
function creerPanneauRaisonnement(conteneur, gardeVue = null) {
  const det = document.createElement('details');
  det.className = 'raisonnement vivant';
  det.open = true;
  const sum = document.createElement('summary');
  /* v7.1.1 : le TITRE porte sa classe (finaliser() le retrouve via
     .raisonnement-titre, insensible à la coche ajoutée devant) —
     avant, il n'existait pas et le titre écrasait le chevron */
  const titre = document.createElement('span');
  titre.className = 'raisonnement-titre';
  /* v20260926f : en-tête façon Claude — ✦ + statut, bilan « Terminé · N s ». */
  titre.textContent = '✦ Raisonnement';
  const spin = document.createElement('span');
  spin.className = 'think';
  spin.textContent = 'Réflexion en cours…';
  const dernier = document.createElement('span');
  dernier.className = 'raisonnement-dernier';
  dernier.textContent = 'Démarrage du pipeline…';
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.appendChild(icoSvg('chevron'));
  sum.appendChild(titre);
  sum.appendChild(spin);
  sum.appendChild(dernier);
  sum.appendChild(chev);
  det.appendChild(sum);
  conteneur.appendChild(det);
  /* v20260926g : mémoire des transitions SÉMANTIQUES uniquement (appel,
     recherche, rédaction…) — jamais de tranches, jamais de frise. */
  const etapes = [];
  const t0 = performance.now();
  /* v7.2.2 : compteur de temps VIVANT — pendant une génération de 60 s+ le
     résumé restait figé sur « réfléchit… » (impresson de gel/bug). Le
     compteur s'auto-nettoie si le panneau est retiré du DOM (arrêt). */
  const minuteur = setInterval(() => {
    if (!det.isConnected) { clearInterval(minuteur); return; }
    spin.textContent = 'Réflexion en cours… ' + Math.floor((performance.now() - t0) / 1000) + ' s';
  }, 1000);
  function ajouter(ev) {
    if (!ev || !ev.etape) return;
    /* v20260926g : les tranches de contenu ('reasoning') ne sont JAMAIS des
       étapes — le texte continu arrive par les jetons (pensee-vive). Ici :
       transitions sémantiques seulement (statut + mémoire, bornée). */
    if (ev.etape === 'reasoning') return;
    /* la collecte a LIEU MÊME si la vue a changé (le raisonnement doit être
       persisté avec la réponse) ; seule la mise en forme DOM est suspendue
       — v20260922j (bug 3) : jamais de scroll ni d'écriture dans une vue
       qui n'est plus celle de la génération. */
    etapes.push({ etape: ev.etape, message: ev.message });
    /* v20260926g-revue : borne qui protège la PREMIÈRE transition (la plus
       significative : 'Appel…') — on élague au milieu, pas en tête. */
    if (etapes.length > 24) etapes.splice(1, etapes.length - 24);
    if (gardeVue && !gardeVue()) return;
    const txt = texteEtape(ev);
    dernier.textContent = txt.length > 72 ? txt.slice(0, 72) + '…' : txt;
    defilerSiBas();
  }
  function finaliser() {
    det.classList.remove('vivant');
    /* Style classique : à la réponse, le panneau SE REPLIE et affiche le
       bilan (N étapes · durée) — un clic pour rouvrir le détail. */
    clearInterval(minuteur);
    const secondes = Math.max(1, Math.round((performance.now() - t0) / 1000));
    det.open = false;
    spin.remove();
    dernier.remove();
    let titreAct = sum.querySelector('.raisonnement-titre');
    if (titreAct) titreAct.textContent = '✦ Raisonnement · ' + etapes.length + ' étape' + (etapes.length > 1 ? 's' : '') + ' · Terminé · ' + secondes + ' s';
    /* v20260926e (kimi) : coche discrète devant le bilan (le spinner animé
       a disparu avec `spin`). */
    const coche = document.createElement('span');
    coche.className = 'raisonnement-fini';
    coche.appendChild(icoSvg('check'));
    sum.insertBefore(coche, sum.firstChild);
  }
  return { el: det, ajouter, finaliser, etapes };
}

/* v20260926b (direct) : compteur de diffusion (frappe + sorties live),
   observable en test via window.__athenaFlux. */
const fluxStats = { jetons: 0, sorties: 0 };
window.__athenaFlux = fluxStats;

/* Zone de diffusion EN DIRECT : la réponse s'écrit sous les yeux (texte brut
   + curseur), la réflexion aussi (texte vif dans le panneau). Sans jetons
   (chemin tamponné), reveler() rejoue le texte final en machine à écrire. */
function creerZoneDiffusion(conteneur, panneau, gardeVue = null) {
  const zone = document.createElement('div');
  zone.className = 'diffusion';
  zone.hidden = true;
  let txtEl = document.createElement('span');
  txtEl.className = 'diffusion-texte';
  const curseur = document.createElement('span');
  curseur.className = 'diffusion-curseur';
  curseur.textContent = '▍';
  curseur.setAttribute('aria-hidden', 'true');
  zone.append(txtEl, curseur);
  conteneur.appendChild(zone);
  /* v1.2 (fluidité) : rendu markdown PROGRESSIF. Avant, la frappe diffusait
     le markdown BRUT (les ``` défilaient en texte), puis la bulle finale
     remplaçait tout d'un coup — le code « n'apparaissait pas fluidement ».
     Maintenant, dès qu'un bloc clôturé est complet, tout ce qui le précède
     est rendu en vrai markdown, et seule la queue continue en brut.
     SÉCURITÉ : les boutons du rendu intermédiaire (Exécuter, Enregistrer,
     Télécharger) sont DÉSACTIVÉS — un clic en cours de frappe exécuterait
     une commande ou un fichier TRONQUÉ. La bulle finale, elle, a les vrais
     boutons. */
  let renduJusqua = 0;
  /* v1.2 (esthétique) : vrai pendant que le curseur est DANS un bloc de code
     non clôturé. Dans ce cas la queue n'est JAMAIS affichée — sinon on voyait
     la commande s'écrire caractère par caractère en markdown brut (« je ne
     dois pas le voir écrire sa commande »). Le bloc apparaît d'un coup, rendu,
     à sa fermeture. */
  let blocOuvert = false;
  const afficherProgressif = () => {
    try {
      const lignes = reponse.split('\n');
      let dansBloc = false, pos = 0, finBloc = -1, debutBloc = -1;
      /* v1.2 (fence collé) : ```code…``` sur UNE seule ligne — l'ancien test
         (fermeture seule sur sa ligne) laissait le bloc « ouvert » à jamais :
         la queue restait masquée et la commande n'apparaissait jamais. On
         repère l'ouverture et la fermeture à l'intérieur de la ligne. */
      for (const l of lignes) {
        if (!dansBloc && /^\s*```/.test(l)) {
          const oi = l.indexOf('```');
          const fi = l.indexOf('```', oi + 3);
          if (fi >= 0) finBloc = pos + fi + 3;
          else { dansBloc = true; debutBloc = pos; }
        } else if (dansBloc && l.indexOf('```') >= 0) {
          dansBloc = false;
          finBloc = pos + l.indexOf('```') + 3;
        }
        pos += l.length + 1;
      }
      blocOuvert = dansBloc;
      const limite = dansBloc ? Math.max(0, debutBloc)
        : (finBloc < 0 ? 0 : Math.min(finBloc, reponse.length));
      if (limite > renduJusqua) {
        zone.replaceChildren();
        if (limite > 0) zone.appendChild(markdownVersFragment(reponse.slice(0, limite)));
        const queue = dansBloc ? '' : reponse.slice(limite);
        txtEl = document.createElement('span');
        txtEl.className = 'diffusion-texte';
        txtEl.textContent = queue;
        zone.append(txtEl, curseur);
        zone.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        afficheReponse = reponse;
        afficheQueue = queue;
        renduJusqua = limite;
      }
    } catch {}
    return blocOuvert;
  };
  let penseeEl = null;
  if (panneau && panneau.el) {
    penseeEl = document.createElement('div');
    penseeEl.className = 'pensee-vive';
    penseeEl.hidden = true;
    panneau.el.appendChild(penseeEl);
  }
  let reponse = '';
  let pensee = '';
  let recu = false;
  let flushTimer = null;
  /* v20260926f (kimi, lags) : ce qui est DÉJÀ dans le DOM — on n'ajoute que
     le delta (appendData), jamais de réécriture complète du nœud qui grossit. */
  let afficheReponse = '';
  let affichePensee = '';
  /* v1.2 : contenu brut ACTUELLEMENT dans txtEl (la queue après le dernier
     rendu markdown). Séparé d'afficheReponse car, depuis le rendu progressif,
     txtEl ne contient plus toute la réponse mais seulement la queue. */
  let afficheQueue = '';
  const FENETRE_DIFFUSION = 12000;
  const FENETRE_PENSEE = 6000;
  const flusher = () => {
    flushTimer = null;
    if (!gardeVue || gardeVue()) {
      /* Rendu progressif d'abord : fige en markdown tout bloc clôturé,
         recrée txtEl (la queue) et recale afficheQueue. Retourne true si le
         curseur est dans un bloc encore ouvert → la queue reste MASQUÉE. */
      const ouvert = afficherProgressif();
      /* Fenêtre anti-explosion : si la réponse brute dépasse, on n'affiche
         que la fin — mais en tenant compte de la partie déjà rendue. */
      const debutQueue = Math.max(renduJusqua, reponse.length - FENETRE_DIFFUSION);
      const queue = ouvert ? '' : reponse.slice(debutQueue);
      if (queue !== afficheQueue) {
        /* v20260926g : appendData n'existe que sur les Text — pour un
           élément, on ajoute un nœud texte (pas de réécriture complète). */
        if (queue.startsWith(afficheQueue)) txtEl.append(document.createTextNode(queue.slice(afficheQueue.length)));
        else txtEl.textContent = queue;
        afficheQueue = queue;
      }
      afficheReponse = reponse;
      if (penseeEl) {
        const cibleP = pensee.length > FENETRE_PENSEE ? pensee.slice(-FENETRE_PENSEE) : pensee;
        if (cibleP !== affichePensee) {
          if (cibleP.startsWith(affichePensee)) penseeEl.append(document.createTextNode(cibleP.slice(affichePensee.length)));
          else penseeEl.textContent = cibleP;
          affichePensee = cibleP;
        }
      }
      defilerSiBas();
    }
  };
  /* v20260926h : flush coalescé sur rAF (une image = un rendu) au lieu
     d'un timer 80 ms — la frappe suit le rafraîchissement écran. */
  const planifierFlush = () => {
    if (flushTimer) return;
    flushTimer = requestAnimationFrame(() => { flushTimer = 0; flusher(); });
  };
  function ingerer(ev) {
    if (!ev || ev.type !== 'jeton' || typeof ev.texte !== 'string' || !ev.texte) return;
    recu = true;
    fluxStats.jetons += 1;
    if (ev.canal === 'raisonnement') {
      pensee += ev.texte;
      if (penseeEl) { penseeEl.hidden = false; planifierFlush(); }
    } else {
      /* v1.2 : la réponse affichée est nettoyée AU FIL DE L'EAU — un modèle
         qui balance sa pensée en plein flux ne la montre jamais (sinon on
         voyait « **Thinking:** … » s'écrire sous les yeux). */
      reponse = nettoyerCoT(reponse + ev.texte);
      if (zone.hidden) zone.hidden = false;
      planifierFlush();
    }
  }
  async function reveler(texteFinal) {
    const cible = String(texteFinal || '');
    if (!cible || recu) return;
    recu = true;
    /* v20260926d (kimi) : un flush différé pouvait écraser la frappe
       progressive avec l'ancien acumulé. */
    if (flushTimer) {
      if (typeof cancelAnimationFrame === 'function') {
        try { cancelAnimationFrame(flushTimer); } catch {}
      } else clearTimeout(flushTimer);
      flushTimer = null;
    }
    zone.hidden = false;
    /* v20260926h : machine à écrire cadencée sur rAF (~48 car./image) —
       fluide au lieu de sauts de 140 caractères. */
    const pasImage = () => new Promise((res) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => res());
      else setTimeout(res, 16);
    });
    let i = 0;
    while (i < cible.length) {
      if ((gardeVue && !gardeVue()) || !zone.isConnected) return;
      i = Math.min(cible.length, i + 48);
      reponse = cible.slice(0, i);
      /* v1.2 : même rendu progressif que le flux — la machine à écrire ne
         diffuse plus le markdown brut. */
      afficherProgressif();
      const ouvertBloc = blocOuvert;
      const debutQueue = Math.max(renduJusqua, reponse.length - FENETRE_DIFFUSION);
      const queue = ouvertBloc ? '' : reponse.slice(debutQueue);
      if (queue !== afficheQueue) {
        if (queue.startsWith(afficheQueue)) txtEl.append(document.createTextNode(queue.slice(afficheQueue.length)));
        else txtEl.textContent = queue;
        afficheQueue = queue;
      }
      afficheReponse = reponse;
      defilerSiBas();
      await pasImage();
    }
  }
  return { ingerer, reveler, aRecu: () => recu, texte: () => reponse, pensee: () => pensee };
}

/* ---------- v7.4.1 : fenêtre d'historique envoyée à l'API ---------- */
/* v1.2 (audit) : les bornes historiques (30 messages / 8000 car.) mutilaient
   le contexte — milieux de messages remplacés par « tronqué », fins de tâche
   bâclées par manque d'infos. Les modèles actuels avalent 10× plus : on ne
   coupe qu'au-delà de 100 messages / 60000 car., et la compression auto du
   shim (85 % de la limite) prend le relais proprement par résumé. */
/* v1.2 (pleine puissance) : 100 messages / 60 000 car. bridaient le contexte
   bien avant saturation. Le shim sait compresser intelligemment (résumé LLM
   à 95 % de la fenêtre réelle) : on lui laisse le travail et on ne multiplie
   plus les seuils arbitraires. Fenêtre large + compression par le shim. */
const FENETRE_API = 400;
const MAX_CONTENU_API = 400000;
const MARQUEUR_COUPURE = '\n\n[… tronqué …]';

function preparerHistorique(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const coupure = (c) => {
    // début + fin conservés : la question en cours est presque toujours
    // en queue du message ; seul le milieu est sacrifié.
    const utile = MAX_CONTENU_API - MARQUEUR_COUPURE.length;
    const tete = Math.floor(utile * 0.55);
    return c.slice(0, tete) + MARQUEUR_COUPURE + c.slice(-(utile - tete));
  };
  const propres = messages
    .filter((m) => m && typeof m === 'object'
      && typeof m.content === 'string' && m.content.trim() !== '')
    .map((m) => {
      const content = m.content.length > MAX_CONTENU_API
        ? coupure(m.content)
        : m.content;
      const role = m.role === 'assistant' || m.role === 'system' ? m.role : 'user';
      return { role, content };
    });
  if (propres.length === 0) return propres;
  if (propres.length <= FENETRE_API) return propres;
  /* v1.2 (contexte) : l'ancienne formule ne gardait que le SYSTEME + les 399
     DERNIERS messages. Dès 400 messages de session, TOUT le début disparaissait
     sans trace — la demande initiale, le cadre posé, les décisions premières —
     et le modèle « oubliait la conversation » alors que l'historique affiché,
     lui, était intact. On garde MAINTENANT la TÊTE autant que la QUEUE, avec un
     marqueur explicite à la coupure pour que le modèle sache qu'un milieu manque
     au lieu de croire à une session qui a commencé au milieu. */
  const tete = propres[0].role === 'system' ? [propres[0]] : [];
  const debut = tete.length;
  const TETE_GARDE = 8;
  const queue = FENETRE_API - debut - TETE_GARDE - 1; // -1 : place au marqueur
  if (queue <= 0) return tete.concat(propres.slice(-(FENETRE_API - debut)));
  const gardeDebut = propres.slice(debut, debut + TETE_GARDE);
  const gardeFin = propres.slice(-queue);
  const retires = propres.length - debut - TETE_GARDE - queue;
  const marqueur = {
    role: 'system',
    content: '[Athéna · mémoire : ' + retires + ' messages du milieu de cette conversation ont été '
      + 'retirés pour tenir dans la fenêtre d\'envoi. Ce qui précède (demande initiale, cadre, '
      + 'décisions) et ce qui suit (suite récente) sont intacts — ne réinvente donc pas ce qui a '
      + 'déjà été dit, et réponds en tenant compte de la demande initiale.]',
  };
  return tete.concat(gardeDebut, [marqueur], gardeFin);
}

/* ---------- Sonde de santé rapide (v9.4 : utilisée entre les réessais) ---------- */
async function etatService() {
  /* v20260926d (kimi) : le timer survivait sur le chemin d'exception. */
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch('/api/chat', { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) return { up: false, pret: false };
    const d = await r.json();
    return { up: true, pret: Boolean(d.modele_charge) };
  } catch { return { up: false, pret: false }; }
  finally { clearTimeout(t); }
}

/* v9.4 / v10.6 (F20) — erreurs serveur HUMANISÉES. L'ancien ordre renvoyait
   le message BRUT AVANT la table FR : tout détail technique (stack, JSON,
   anglais) atterrissait tel quel dans la bulle. Désormais :
   - 5xx et réseau → TOUJOURS la table FR (rien de technique ne fuit) ;
   - 4xx → le message serveur S'IL est lisible (c'est lui qui dit quoi
     corriger), sinon la table ;
   - un détail technique reconnu (Traceback, JSON, HTML, exception…) est
     systématiquement remplacé. */
function detailLisible(brut) {
  const t = String(brut || '').trim();
  if (!t || t.length > 300) return false;
  if (/Traceback|Exception\b|\bError:\s|TypeError|ReferenceError|RangeError|\{["']|<\/?[a-z][\w-]*[\s>]/i.test(t)) return false;
  return true;
}
function humaniserErreur(detail, statut) {
  const brut = String(detail || '').trim();
  const lisible = detailLisible(brut);
  const base = {
    400: 'La requête a été refusée par le service.',
    422: 'La demande n\u2019a pas pu être traitée — vérifiez le format (fichier, corps) et réessayez.',
    429: 'Le service est saturé : trop de demandes à la fois. Réessayez dans un instant.',
    500: 'Le service du modèle a rencontré une erreur interne. Réessayez dans un instant.',
    502: 'Le service du modèle est momentanément injoignable (surcharge ou redémarrage). Réessayez dans un instant.',
    503: 'Le modèle se recharge ou est occupé. Réessayez dans un instant.',
    504: 'La génération a dépassé le délai disponible. Essayez une question plus courte.',
  };
  const repli = base[statut] || ('Erreur du service (' + (statut || 'réseau') + '). Réessayez dans un instant.');
  if (Number(statut) >= 500) return repli;
  return lisible ? brut : repli;
}

/* ---------- Appel API robuste (v9.4 : repli repensé) ---------- ----------
   AVANT : 5 essais × 5 s re-POSTaient la génération COMPLÈTE à l'aveugle.
   Sous charge (génération + vérification > délai de la passerelle), chaque
   repli relançait un pipeline entier : le modèle s'empilait les demandes et
   l'utilisateur voyait « service indisponible » alors que le modèle
   travaillait. DÉSORMAIS : 3 essais max, ESPACÉS (8 s), avec sonde de santé
   entre chaque, et un message final honnête selon la cause réelle. */
async function appelerApiClassique(historique, signal = null, attachments = []) {
  let cause = 'inconnue';
  for (let essai = 0; essai < 3; essai++) {
    if (essai > 0) {
      /* v20260926d : attente interruptible (Stop) ; v20260926f (lags) : 3 s
         au lieu de 8 — un bilan de santé suit juste après, et l'échec
         affiche quoi faire au lieu de faire poireauter. */
      await new Promise((res) => {
        if (signal && signal.aborted) { res(); return; }
        const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', annuler); res(); }, 3000);
        const annuler = () => { clearTimeout(t); res(); };
        if (signal) signal.addEventListener('abort', annuler, { once: true });
      });
      if (signal && signal.aborted) throw new DOMException('Abandon', 'AbortError');
      const sante = await etatService();
      if (!sante.up) cause = 'injoignable';
      else if (!sante.pret) cause = 'chargement';
      else cause = 'occupe';
    }
    try {
      const r = await fetch(endpointChat(attachments), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /* v20260922m (F2/F13) : conversation_id stable par conversation UI →
           le fil côté moteur devient réutilisable (compteur honnête,
           corrélation logs, format canonique « fil-xxxxxxxx »). */
        body: JSON.stringify({ messages: historique, outils: preferences.outilsWeb !== false,
          conversation_id: idConversation,
          /* v1.2 (anti-bâclage, item 12) : température préférée → route.ts → moteur. */
          temperature: temperatureChoisie(),
          /* v10.9.4 (HUD) : modèle choisi (sinon cascade par défaut) */
          ...(modeleChoisi ? { model_id: modeleChoisi.id } : {}),
          ...(attachments.length ? { attachments } : {}) }),
        signal,
      });
      const texte = await r.text();
      try {
        const d = JSON.parse(texte);
        if (!r.ok) return { ok: false, erreur: humaniserErreur(d.erreur, r.status), statut: r.status };
        if (d.modele_repli) notifier('Le modèle choisi ne répond pas — repli sur le modèle auto.');
        return { ok: true, reponse: d.reponse || '(réponse vide)', outil: d.outil || null, correction: Boolean(d.correction), verification: d.verification || null, rag: d.rag || null, tache: d.tache || null, raisonnement: d.raisonnement || null, tronquee: Boolean(d.tronquee), provider: typeof d.provider === 'string' ? d.provider : null, model: typeof d.model === 'string' ? d.model : null, modele_repli: Boolean(d.modele_repli) };
      } catch { cause = 'reponse'; /* corps non JSON -> réessai */ }
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;  // stop demandé : ne pas réessayer
      cause = 'reseau';
    }
  }
  const finales = {
    chargement: 'Le modèle se recharge (chargement ~30 s). Réessayez dans un instant — ou attendez que l’indicateur du composeur repasse à « prêt ».',
    injoignable: 'Le service du modèle ne répond pas pour le moment : il redémarre automatiquement. Réessayez dans un instant.',
    occupe: 'Le modèle termine encore une génération précédente. Patientez quelques secondes, puis utilisez « Régénérer ».',
    reseau: 'Connexion interrompue pendant l’appel. Utilisez « Régénérer » pour relancer la réponse.',
    reponse: 'Le service a renvoyé une réponse invalide (redémarrage en cours ?). Réessayez dans un instant.',
    inconnue: 'Le service n’a pas abouti après plusieurs tentatives. Réessayez dans un instant.',
  };
  return { ok: false, erreur: finales[cause] || finales.inconnue, cause };
}
/* v20260926b (direct) : surJeton reçoit les événements {type:'jeton',
   canal:'reponse'|'raisonnement', texte} — l'UI affiche la frappe EN DIRECT.
   Le compteur jetonsRecus permet le repli « machine à écrire » quand le
   chemin est tamponné (pas de jetons : stack locale). */
async function appelerApi(historique, signal = null, surProgression = null, attachments = [], surJeton = null) {
  let aRecuEvenement = false;
  let jetonsRecus = 0;
  try {
    const r = await fetch(endpointChat(attachments), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: historique, outils: preferences.outilsWeb !== false, stream: true,
        conversation_id: idConversation,
        /* v1.2 (anti-bâclage, item 12) : température préférée → route.ts → moteur. */
        temperature: temperatureChoisie(),
        /* v10.9.4 (HUD) : modèle choisi (sinon cascade par défaut) */
        ...(modeleChoisi ? { model_id: modeleChoisi.id } : {}),
        ...(attachments.length ? { attachments } : {}) }),
      signal,
    });
    const ctype = r.headers.get('content-type') || '';
    if (r.ok && ctype.includes('ndjson') && r.body) {
      const lecteur = r.body.getReader();
      const dec = new TextDecoder();
      let tampon = '';
      let final = null;
      let erreurFlux = null;
      /* v20260922j (bug 2) : UNE seule routine de parsing, réutilisée pour
         les lignes complètes ET le reliquat final — la dernière ligne émise
         sans \n terminal était perdue (réponse complète affichée « flux
         interrompu », raisonnement perdu), et le décodeur n'était jamais
         flushé (caractère multioctet à cheval sur deux chunks -> mojibake). */
      const traiterLigne = (brute) => {
        const ligne = brute.trim();
        if (!ligne) return;
        try {
          const ev = JSON.parse(ligne);
          if (ev.type === 'progress') { aRecuEvenement = true; if (surProgression) surProgression(ev); }
          else if (ev.type === 'jeton') { aRecuEvenement = true; jetonsRecus += 1; if (surJeton) surJeton(ev); }
          else if (ev.type === 'final') final = ev;
          else if (ev.type === 'erreur') erreurFlux = ev.erreur || 'Erreur du pipeline.';
        } catch { /* ligne partielle -> ignorée */ }
      };
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        tampon += dec.decode(value, { stream: true });
        let idx;
        while ((idx = tampon.indexOf('\n')) >= 0) {
          traiterLigne(tampon.slice(0, idx));
          tampon = tampon.slice(idx + 1);
        }
      }
      /* fin de flux : flush du décodeur + reliquat (dernière ligne sans \n) */
      tampon += dec.decode();
      traiterLigne(tampon);
      if (erreurFlux) return { ok: false, erreur: erreurFlux };
      if (final) {
        /* v10.9.4 (HUD) : repli discret si le modèle choisi n'a pas répondu */
        if (final.modele_repli) notifier('Le modèle choisi ne répond pas — repli sur le modèle auto.');
        /* v20260926d : final PARTIEL (reponse null) — pas de '(réponse vide)'
           ici, genererReponse reprend la frappe déjà diffusée. */
        return { ok: true, reponse: final.reponse || (final.partiel ? '' : '(réponse vide)'), outil: final.outil || null, correction: Boolean(final.correction), verification: final.verification || null, rag: final.rag || null, tache: final.tache || null, conversation_id: final.conversation_id || null, raisonnement: final.raisonnement || null, jetonsRecus, partiel: Boolean(final.partiel), tronquee: Boolean(final.tronquee), provider: typeof final.provider === 'string' ? final.provider : null, model: typeof final.model === 'string' ? final.model : null, modele_repli: Boolean(final.modele_repli) };
      }
      return { ok: false, erreur: 'Le flux de raisonnement a été interrompu avant la réponse — renvoyez votre message.' };
    }
    /* JSON classique (correction, sidecar sans flux) -> même lecture */
    const texte = await r.text();
    let d = null;
    try { d = JSON.parse(texte); } catch { d = null; }
    if (!r.ok) {
      /* v20260922j (bug 7) : un échec HTTP non-NDJSON (502 HTML de la
         passerelle, 503…) ne doit JAMAIS déclencher le re-POST aveugle du
         chemin classique — jusqu'à 3 relances du pipeline complet, captures
         d'entraînement en double. Erreur humaine immédiate ; « Régénérer »
         reste à l'utilisateur. */
      return { ok: false, erreur: humaniserErreur(d && d.erreur, r.status), statut: r.status };
    }
    if (d) {
      if (d.modele_repli) notifier('Le modèle choisi ne répond pas — repli sur le modèle auto.');
      return { ok: true, reponse: d.reponse || '(réponse vide)', outil: d.outil || null, correction: Boolean(d.correction), verification: d.verification || null, rag: d.rag || null, tache: d.tache || null, raisonnement: d.raisonnement || null, tronquee: Boolean(d.tronquee) };
    }
    /* r.ok mais corps illisible -> réessai via chemin classique (une fois) */
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;  // stop demandé : ne pas réessayer
    /* v7.1 : si le flux s'est interrompu APRÈS des étapes reçues (délai
       serveur, coupure réseau), NE PAS re-sender — le pipeline serait
       réexécuté en entier ; on signale l'interruption. */
    if (aRecuEvenement) {
      return { ok: false, erreur: 'Le flux de raisonnement a été interrompu en cours de route (délai du serveur ou coupure) — renvoyez votre message.' };
    }
    /* réseau indisponible AVANT toute étape -> réessai via chemin classique */
  }
  return appelerApiClassique(historique, signal, attachments);
}

/* ---------- Sonde d'état ---------- */
async function sonder() {
  try {
    /* v20260922l (20) : sonde bornée à 5 s — un /api/chat suspendu ne laisse
       plus un fetch fantôme pendant indéfiniment. */
    const r = await fetch('/api/chat', { cache: 'no-store', signal: delaiFetch(5000) });
    const d = await r.json();
    majStatut(d.modele_charge ? 'pret' : 'indisponible');
  } catch { majStatut('indisponible'); }
}
function majStatut(s) {
  if (!statutEl || !dotEl) return;
  statutEl.textContent = s === 'pret' ? 'prêt' : s === 'indisponible' ? 'redémarre…' : '…';
  /* v9.4 : les ids statut/dot EXISTENT désormais dans le HTML (indicateur
     « redémarre… » enfin visible au-dessus du composeur) ; couleurs par
     classes CSS (l'inline hérité est neutralisé). */
  dotEl.className = 'dot' + (s === 'pret' ? ' pret' : s === 'indisponible' ? ' indisponible' : '');
  dotEl.style.background = '';
  dotEl.style.boxShadow = '';
  /* Actionnable : clic = relance immédiate de la sonde (porte de sortie
     sur l'alerte pulsée, au lieu d'un signal sans action). */
  dotEl.setAttribute('data-actionnable', '1');
  dotEl.title = s === 'indisponible'
    ? 'Moteur indisponible — cliquer pour relancer la vérification'
    : 'État du moteur — cliquer pour revérifier';
}
if (dotEl) {
  dotEl.addEventListener('click', () => { sonder(); });
}
sonder();
setInterval(sonder, 25000);

/* ---------- v9.4 — Pastille « ↓ nouvelle réponse » ----------
   Défilement auto désactivé (ou remontée manuelle pendant la génération) :
   les nouveaux messages sortaient de l'écran sans AUCUN signe. Une pastille
   sobre apparaît dès qu'on n'est plus en bas, avec compteur ; un clic
   ramène en bas. (Avec le défilement auto, le seul moyen de la voir est de
   scroller soi-même pendant la génération — c'est voulu.) */
const pastilleReponseEl = document.createElement('button');
pastilleReponseEl.type = 'button';
pastilleReponseEl.className = 'pastille-reponse';
pastilleReponseEl.innerHTML = '<span class="pastille-fleche"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" transform="rotate(180 12 12)"/></svg></span><span>Nouvelle réponse</span><span class="pastille-nouveau" hidden>0</span>';
pastilleReponseEl.setAttribute('aria-label', 'Aller à la nouvelle réponse');
let nbHorsVue = 0;
function presDuBas() {
  return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
}
/* v20260926f (kimi, lags) : scroll en rAF, seulement si déjà en bas — fini
   les layouts synchrones (lecture scrollHeight + écriture) à chaque flush.
   Si l'utilisateur a remonté, on ne le ramène pas de force (la pastille
   « Nouvelle réponse » prend le relais via l'observateur). */
let defilRaf = 0;
function defilerSiBas() {
  if (defilRaf || !preferences.defilementAuto) return;
  defilRaf = requestAnimationFrame(() => {
    defilRaf = 0;
    try {
      if (presDuBas()) msgsEl.scrollTop = msgsEl.scrollHeight;
      /* v20260926i : la pastille « Nouvelle réponse » doit VRAIMENT
         apparaître quand l'utilisateur a remonté pendant un stream
         (avant : rien ne l'actualisait hors ajout de rangée). */
      else majPastilleReponse();
    } catch {}
  });
}
function majPastilleReponse() {
  const enBas = presDuBas();
  if (enBas) nbHorsVue = 0;
  const badge = pastilleReponseEl.querySelector('.pastille-nouveau');
  if (badge) { badge.textContent = String(nbHorsVue); badge.hidden = nbHorsVue === 0; }
  pastilleReponseEl.classList.toggle('visible', !enBas && msgsEl.querySelector('.row') !== null);
}
pastilleReponseEl.addEventListener('click', () => {
  nbHorsVue = 0;
  msgsEl.scrollTo({ top: msgsEl.scrollHeight, behavior: preferences.animationsReduites ? 'auto' : 'smooth' });
  majPastilleReponse();
});
msgsEl.addEventListener('scroll', majPastilleReponse, { passive: true });
/* v20260922l (21) : seules les BULLES IA réellement ajoutées comptent —
   l'ancien code comptait TOUTE mutation childList (retraits au changement de
   vue, re-rendus, bulles utilisateur) et gonflait le badge à chaque ouverture
   d'une autre conversation. Un re-rendu (renduVueEnCours) est ignoré. */
new MutationObserver((mutations) => {
  if (renduVueEnCours) return;
  let nouveaux = 0;
  for (const m of mutations) {
    m.addedNodes.forEach((n) => {
      if (n.nodeType === 1 && n.classList.contains('row') && n.classList.contains('bot')) nouveaux++;
    });
  }
  if (!nouveaux) return;
  if (!presDuBas()) nbHorsVue += nouveaux;
  majPastilleReponse();
}).observe(msgsEl, { childList: true, subtree: false });
document.querySelector('.chat-shell').appendChild(pastilleReponseEl);

function actionMessage(contenu, role) {
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  const ajouter = (icone, label, handler) => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.title = label;
    bouton.setAttribute('aria-label', label);
    bouton.appendChild(icoSvg(icone));
    if (handler) bouton.addEventListener('click', handler);
    actions.appendChild(bouton);
    return bouton;
  };
  ajouter('copy', 'Copier le message', (event) => copierTexte(contenu, event.currentTarget));
  if (role === 'assistant') {
    /* v20260926e (kimi) : lecture = bascule (clic = arrêter), état synchronisé
       pour les lecteurs d'écran, jamais de bouton coincé sur « actif ». */
    const lire = ajouter('volume', 'Lire le message', (event) => {
      const bouton = event.currentTarget;
      const arreter = () => { bouton.classList.remove('actif'); bouton.setAttribute('aria-pressed', 'false'); };
      if (bouton.classList.contains('actif')) {
        try { window.speechSynthesis.cancel(); } catch {}
        arreter();
        return;
      }
      if (!('speechSynthesis' in window)) {
        notifier('La lecture vocale n’est pas disponible dans ce navigateur.');
        return;
      }
      bouton.setAttribute('aria-pressed', 'true');
      try { window.speechSynthesis.cancel(); } catch {}
      const lecture = new SpeechSynthesisUtterance(contenu);
      lecture.lang = 'fr-FR';
      bouton.classList.add('actif');
      lecture.onend = arreter;
      lecture.onerror = arreter;
      try { window.speechSynthesis.speak(lecture); }
      catch { arreter(); }
    });
    lire.setAttribute('aria-pressed', 'false');
    /* v20260926e (kimi) : avis EXCLUSIF — un seul des deux actif à la fois. */
    const utile = ajouter('thumbUp', 'Réponse utile', null);
    const bof = ajouter('thumbDown', 'Réponse à améliorer', null);
    utile.setAttribute('aria-pressed', 'false');
    bof.setAttribute('aria-pressed', 'false');
    const basculeAvis = (positif) => {
      const cible = positif ? utile : bof;
      const autre = positif ? bof : utile;
      const nouvelEtat = !cible.classList.contains('actif');
      cible.classList.toggle('actif', nouvelEtat);
      cible.setAttribute('aria-pressed', String(nouvelEtat));
      autre.classList.remove('actif');
      autre.setAttribute('aria-pressed', 'false');
    };
    utile.addEventListener('click', () => basculeAvis(true));
    bof.addEventListener('click', () => basculeAvis(false));
    ajouter('refresh', 'Régénérer la réponse', () => regenererDerniereReponse());
  }
  return actions;
}

/* v20260926i : émojis style Twemoji (proche macOS) au lieu des émojis
   système (Microsoft sur Windows). Lib auto-hébergée (vendor/) ; images
   CDN avec repli gracieux (l'attribut alt garde l'émoji si hors-ligne).
   Jamais dans le code (pre) : la coloration syntaxique resterait lisible. */
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/';
function emojiser(racine) {
  try {
    if (!racine || !window.twemoji || typeof window.twemoji.parse !== 'function') return;
    if (racine.matches && (racine.matches('.bubble') || racine.matches('.md'))) {
      if (!racine.querySelector('pre')) {
        try { window.twemoji.parse(racine, { base: TWEMOJI_BASE }); } catch {}
        return;
      }
    }
    racine.querySelectorAll('p, li, h1, h2, h3, blockquote, td, th').forEach((el) => {
      if (el.closest('pre')) return;
      try { window.twemoji.parse(el, { base: TWEMOJI_BASE }); } catch {}
    });
  } catch {}
}
/* ---------- Rendu des messages ---------- */
/* v20260926e : options.actions === false → pas de .message-actions (bulle de
   réflexion : les actions n'apparaissent qu'une fois la réponse FINIE). */
function bulle(role, contenu, outil, meta, options) {
  const row = document.createElement('div');
  row.className = 'row ' + (role === 'user' ? 'user' : 'bot');
  /* v20260922m (F18) : chaque rangée est ÉTIQUETÉE avec sa conversation —
     la régénération ne colle plus son bouton à une rangée détachée ou
     re-rendue d'une autre vue (couplage DOM fragile de l'ancien code). */
  row.dataset.convo = String(idConversation || '');
  const b = document.createElement('div');
  b.className = 'bubble';
  if (role === 'assistant') {
    /* v9.4 : rendu Markdown (code/listes/titres) dans un conteneur .md */
    const corps = document.createElement('div');
    corps.className = 'md';
    corps.appendChild(formater(contenu));
    b.appendChild(corps);
  } else {
    b.textContent = contenu; // un message TAPÉ n'est pas du Markdown
  }
  if (meta && Array.isArray(meta.traces) && meta.traces.length) {
    const groupe = creerGroupeActivite();
    meta.traces.forEach((trace) => ajouterTraceAuGroupe(groupe, trace));
    b.appendChild(groupe);
  }
  /* v9.5 : fichiers joints du message (affichés, pas cousus dans le texte) */
  if (meta && meta.attachments && meta.attachments.length) {
    const carte = document.createElement('div');
    carte.className = 'fichier-joint';
    const entete = document.createElement('div');
    entete.className = 'fichier-joint-tete';
    entete.appendChild(icoSvg('file'));
    const titre = document.createElement('span');
    titre.className = 'fichier-joint-titre';
    titre.textContent = 'Fichier' + (meta.attachments.length > 1 ? 's analysés' : ' analysé');
    const compteur = document.createElement('span');
    compteur.className = 'fichier-joint-compte';
    compteur.textContent = String(meta.attachments.length);
    entete.append(titre, compteur);
    const liste = document.createElement('ul');
    liste.className = 'fichier-joint-liste';
    meta.attachments.forEach((piece) => {
      const nomComplet = piece && typeof piece.name === 'string' && piece.name.trim()
        ? piece.name
        : 'Fichier sans nom';
      const item = document.createElement('li');
      item.className = 'fichier-joint-item';
      const extension = extensionFichier(nomComplet);
      if (extension) {
        const pastille = document.createElement('span');
        pastille.className = 'fichier-joint-extension';
        pastille.textContent = extension;
        item.appendChild(pastille);
      }
      const nom = document.createElement('span');
      nom.className = 'fichier-joint-nom';
      nom.textContent = nomComplet;
      nom.title = nomComplet;
      item.appendChild(nom);
      const details = [];
      if (piece && Number.isFinite(piece.size)) details.push(tailleFichier(piece.size));
      if (piece && Number.isFinite(piece.chunks)) details.push(piece.chunks + ' seg.');
      if (piece && piece.status === 'indexed') details.push('indexé');
      if (details.length) {
        const metaFichier = document.createElement('span');
        metaFichier.className = 'fichier-joint-meta';
        metaFichier.textContent = details.join(' · ');
        item.appendChild(metaFichier);
      }
      liste.appendChild(item);
    });
    carte.append(entete, liste);
    b.appendChild(carte);
  }
  if (outil && outil.nom) {
    const badge = document.createElement('div');
    badge.className = 'outil-badge';
    const hote = (outil.sources && outil.sources[0]) ? outil.sources[0].replace(/^https?:\/\//, '').split('/')[0] : '';
    const noms = { curl: 'requête curl', recherche_web: 'recherche web', lecture_page: 'lecture de page' };
    badge.textContent = (noms[outil.nom] || outil.nom) + (hote ? ' — ' + hote : '');
    b.appendChild(badge);
  }
  /* v2 : badges de VÉRIFICATION et de RAG (base de connaissances) */
  if (meta) {
    const v = meta.verification;
    if (v && v.statut && v.statut !== 'ok') {
      const vb = document.createElement('div');
      vb.className = 'outil-badge';
      vb.appendChild(icoSvg(v.statut === 'corrige' ? 'check' : 'alert'));
      vb.appendChild(document.createTextNode(v.statut === 'corrige'
        ? (' ' + (v.detail || 'maths corrigée par recalcul'))
        : (' ' + (v.detail || 'doute sur la réponse'))));
      b.appendChild(vb);
    }
    if (meta.rag && meta.rag.utilise) {
      const rb = document.createElement('div');
      rb.className = 'outil-badge';
      rb.textContent = 'base de connaissances locale';
      b.appendChild(rb);
    }
    /* v7.1 : raisonnement conservé (replié) au-dessus de la réponse */
    if (meta.raisonnement && meta.raisonnement.length) {
      const det = detailsRaisonnementDepuisEtapes(meta.raisonnement);
      if (det) b.insertBefore(det, b.firstChild);
    }
  }
  row.appendChild(b);
  if (!options || options.actions !== false) row.appendChild(actionMessage(contenu, role));
  msgsEl.appendChild(row);
  emojiser(b);
  return b;
}
/* Écran d'accueil : la fonction avait été vidée (centre vide à l'ouverture)
   alors que le CSS (.examples/.chip) et le retrait à l'envoi existent toujours.
   Les pastilles envoient directement leur suggestion (clic explicite). */
function exemplesInitiaux() {
  if (!msgsEl || msgsEl.querySelector('.examples')) return;
  const accueil = document.createElement('div');
  accueil.className = 'examples';
  const titre = document.createElement('p');
  titre.textContent = 'Que puis-je faire pour vous ?';
  const rangee = document.createElement('div');
  rangee.className = 'examples-chips';
  const idees = [
    'Explique-moi un concept',
    'Écris un script pour moi',
    'Exécute une commande sur mon PC',
    'Crée un fichier sur mon PC',
  ];
  idees.forEach((texte) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = texte;
    b.addEventListener('click', () => { envoyer(texte); });
    rangee.appendChild(b);
  });
  accueil.append(titre, rangee);
  msgsEl.appendChild(accueil);
}

/* ---------- Envoi, arrêt, historique de saisie ---------- */
let controleurEnCours = null;
/* v20260926c (affichage) : le STOP fait rejeter en chaîne des promesses
   (fetch, lecteurs de flux) dont certaines n'ont plus de consommateur au
   moment de l'abort — AbortError bénin (l'interruption elle-même est gérée
   et affichée), jamais un crash : on l'absorbe pour ne pas polluer la
   console. v20260926d (kimi) : ciblé aux générations + 5 s après un stop —
   tout autre rejet remonte normalement. */
let dernierStop = 0;
window.addEventListener('unhandledrejection', (e) => {
  if (e && e.reason && e.reason.name === 'AbortError'
    && (occupe || Date.now() - dernierStop < 5000)) e.preventDefault();
});
const CLE_SAISIES = 'chat-saisies';
let saisies = chargerStockage(CLE_SAISIES, []);
if (!Array.isArray(saisies)) saisies = [];
let indexSaisie = saisies.length;
let brouillon = '';

function sauverSaisies() {
  try { localStorage.setItem(CLE_SAISIES, JSON.stringify(saisies)); } catch { /* optionnel */ }
}
function majBoutonArret() {
  if (occupe) {
    btnEl.replaceChildren(icoSvg('stop'));
    btnEl.title = 'Arrêter la génération';
    btnEl.setAttribute('aria-label', 'Arrêter la génération');
    btnEl.classList.add('en-cours');
  } else {
    btnEl.replaceChildren(icoSvg('send'));
    btnEl.title = 'Envoyer';
    btnEl.setAttribute('aria-label', 'Envoyer');
    btnEl.classList.remove('en-cours');
  }
}

async function envoyer(texte) {
  if (occupe) return;
  /* v20260922j (bug 12) : `let` — le contenu est RE-LU après les modales
     (le champ peut être édité pendant une modale via Tab, et l'ancien code
     écrasait cette édition avec la capture faite AVANT l'ouverture). */
  let contenu = (texte ?? saisieEl.value).trim();
  if (!contenu && fichiersJoints.length === 0) return;
  /* v20260922j (bugs 4+5) : verrou posé AVANT toute modale (double Entrée ->
     2 modales + 2 générations, 1er AbortController écrasé, ■ inactif) et
     envoi bloqué pendant un upload (fichiers silencieusement perdus +
     orphelins serveur, aucun DELETE, aucune erreur). */
  const verrouiller = () => { occupe = true; majBoutonArret(); };
  const deverrouiller = () => { occupe = false; majBoutonArret(); majBouton(); };
  if (fichiersJoints.some((f) => f.status === 'uploading')) {
    boiteModale({ titre: 'Fichier en cours d’envoi',
      message: 'Un fichier est encore en cours de transfert — attendez la fin de l’indexation ou retirez-le avant d’envoyer.',
      labelOk: 'OK', info: true }).catch(() => {});
    return;
  }
  const indexables = fichiersJoints.filter((f) => f.status === 'indexed');
  const echoues = fichiersJoints.filter((f) => f.status === 'failed');
  if (echoues.length && (contenu || indexables.length)) {
    /* v20260922j (bug 4) : les fichiers échoués ne partent JAMAIS en silence
       quand le message part quand même — confirmation explicite + purge. */
    verrouiller();
    const accord = await boiteModale({
      titre: 'Fichier non transmis',
      message: (echoues.length === 1
        ? '« ' + echoues[0].name + ' » n’a pas pu être indexé'
        : echoues.length + ' fichiers n’ont pas pu être indexés')
        + ' et ne sera' + (echoues.length > 1 ? 'ont' : '') + ' PAS transmis avec le message.',
      labelOk: indexables.length
        ? ('Envoyer sans ' + (echoues.length > 1 ? 'ces fichiers' : 'ce fichier'))
        : 'Envoyer le texte seul',
      labelAnnuler: 'Annuler',
    });
    if (!accord) return deverrouiller();
    echoues.forEach((f) => {
      if (f.file_id) fetch(API_FILES + '?id=' + f.file_id, { method: 'DELETE', signal: delaiFetch(5000) }).catch(() => {});
      const idx = fichiersJoints.indexOf(f);
      if (idx >= 0) fichiersJoints.splice(idx, 1);
    });
    afficherFichiers(); majBouton();
  }
  if (preferences.confirmationEnvoi) {
    if (!occupe) verrouiller();
    const accord = await boiteModale({ titre: 'Envoyer ce message ?', message: contenu.slice(0, 160) + (contenu.length > 160 ? '…' : ''), labelOk: 'Envoyer', labelAnnuler: 'Modifier' });
    if (!accord) return deverrouiller();
    if (texte == null) contenu = saisieEl.value.trim(); /* re-lecture (bug 12) */
    if (!contenu && indexables.length === 0) return deverrouiller();
  }
  /* v9.5 : seuls les fichiers INDEXÉS partent (file_id + nom) — le contenu
     ne transite plus par le texte du message. Filtre strict conservé. */
  const attaches = attachmentsEnvoyes();
  if (!contenu && attaches.length === 0) {
    if (fichiersJoints.length) {
      boiteModale({ titre: 'Aucun fichier exploitable',
        message: 'Aucun des fichiers joints n’a pu être indexé — retirez-les ou joignez un autre fichier.',
        labelOk: 'OK', info: true }).catch(() => {});
    }
    if (occupe) deverrouiller();
    return;
  }
  if (!occupe) verrouiller();
  const convo = conversationOuverte();
  saisieEl.value = '';
  ajusterSaisie();
  fichiersJoints = [];
  fichiersEl.value = '';
  afficherFichiers();
  majBouton();
  msgsEl.querySelector('.workspace-view')?.remove();
  const vide = msgsEl.querySelector('.examples');
  if (vide) vide.remove();
  if (convo.titre === 'Nouvelle discussion') {
    convo.titre = titreDepuis(contenu || 'Fichier : ' + attaches.map((a) => a.name).join(', '));
  }
  /* les attachments vivent sur le message (petit : file_id, nom et
     métadonnées d'affichage) — « Régénérer » les renvoie à l'identique,
     le re-rendu les affiche */
  const messageUtilisateur = { role: 'user', content: contenu };
  if (attaches.length) messageUtilisateur.attachments = attaches;
  convo.messages.push(messageUtilisateur);
  convo.maj = Date.now();
  rendreConversations();
  sauverConversations();
  bulle('user', contenu, null, { attachments: attaches });
  if (contenu) {
    saisies.push(contenu);
    if (saisies.length > 100) saisies = saisies.slice(-100);
    sauverSaisies();
    indexSaisie = saisies.length;
  }
  /* v1.2 (anti-bâclage) : budget d'enchaînement neuf pour chaque demande —
     sans cette remise à zéro, une conversation déjà à 6 commandes ne
     pourrait plus jamais enchaîner. */
  convo._toursExec = 0;
  convo._cmdExecutees = [];
  convo._fenetreExec = [];
  convo._msgExec = null;
  await genererReponse(convo);
}

/* v8.6 : fin d'envoyer() extraite telle quelle en fonction partagée —
   « Régénérer » rejoue EXACTEMENT le même pipeline (panneau de raisonnement,
   annulation, badges, persistance). Préconditions : occupe === true,
   historique de convo déjà en place, bulle utilisateur déjà affichée. */
async function genererReponse(convo, opts) {
  /* v20260922j (bug 3) : la réponse ne doit JAMAIS être injectée dans la vue
     affichée si l'utilisateur a changé de conversation ou ouvert une vue
     (Paramètres/Projets/Compte) pendant la génération. La persistance
     (convo.messages) reste correcte ; seule la mise en forme DOM est
     conditionnée à vueOuverte(), et un toast sobre propose « Ouvrir ». */
  const vueOuverte = () => idConversation === convo.id && !msgsEl.querySelector('.workspace-view');
  /* v1.2 (audit) : SUITE dans la même bulle. Avant, chaque tour de chaîne
     (commande → résultat → nouveau tour) créait une NOUVELLE bulle
     assistant : « le modèle refait un message au lieu de continuer dans le
     même ». opts.suiteDe = la .bubble du tour précédent : on y ajoute une
     section .suite (séparateur discret + pensée + diffusion + rendu) au lieu
     d'une nouvelle rangée. L'historique persisté reste découpé par tour
     (le modèle en a besoin), seul l'AFFICHAGE est continu. */
  const suiteDe = opts && opts.suiteDe && opts.suiteDe.isConnected
    ? (opts.suiteDe.closest('.bubble') || opts.suiteDe) : null;
  let think, suiteBox = null;
  if (suiteDe) {
    /* v1.2 (discrétion) : la suite ne rejoue PAS tout le cirque « le modèle
       réfléchit + panneau ouvert ». Avant, chaque commande terminée
       rouvrait un panneau de raisonnement complet : visuellement, on aurait
       dit qu'un nouveau message était envoyé. Maintenant : un liseré avec
       le numéro de suite, et le panneau de raisonnement reste REPLIÉ (son
       contenu s'accumule quand même, un clic le rouvre). */
    suiteBox = document.createElement('div');
    suiteBox.className = 'suite';
    const sep = document.createElement('div');
    sep.className = 'suite-sep';
    sep.setAttribute('aria-hidden', 'true');
    const nSuite = suiteDe.querySelectorAll(':scope > .suite').length + 1;
    const etiquette = document.createElement('span');
    etiquette.className = 'suite-nom';
    etiquette.textContent = 'Suite ' + nSuite;
    sep.appendChild(etiquette);
    suiteBox.appendChild(sep);
    suiteDe.appendChild(suiteBox);
    think = suiteBox;
  } else {
    think = bulle('assistant', '', null, null, { actions: false });
  }
  /* v20260926e (kimi) : indicateur animé « le modèle réfléchit » — visible
     même panneau replié/désactivé ; retiré avec la rangée au rendu final. */
  const indicateur = document.createElement('span');
  indicateur.className = 'thinking';
  indicateur.setAttribute('role', 'status');
  indicateur.setAttribute('aria-label', 'Le modèle réfléchit');
  indicateur.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  think.appendChild(indicateur);
  /* v7.1 : panneau « raisonnement en direct » (canal de progression NDJSON) */
  const panneau = preferences.raisonnementVisible !== false
    ? creerPanneauRaisonnement(think, vueOuverte) : null;
  if (suiteBox && panneau && panneau.el) {
    /* Suite : panneau replié d'office (voir commentaire discrétion). */
    try { panneau.el.open = false; } catch {}
  }
  if (!panneau) think.replaceChildren();
  /* v20260926b (direct) : la frappe et la réflexion s'affichent EN DIRECT. */
  const diffusion = creerZoneDiffusion(think, panneau, vueOuverte);
  if (vueOuverte() && preferences.defilementAuto) msgsEl.scrollTop = msgsEl.scrollHeight;
  controleurEnCours = new AbortController();
  let r = null;
  /* v1.2 (anti-bâclage) : les pièces de TOUS les messages utilisateur
     accompagnent l'appel (dédoublonnées par file_id, 10 au plus) — avant,
     seul le dernier message comptait et une question de suivi perdait le
     fichier. « Régénérer » rejoue à l'identique. */
  const piecesTour = [];
  const vusTour = new Set();
  for (const m of convo.messages) {
    if (!m || m.role !== 'user' || !Array.isArray(m.attachments)) continue;
    for (const a of m.attachments) {
      if (!a || !a.file_id || vusTour.has(a.file_id)) continue;
      vusTour.add(a.file_id);
      piecesTour.push(a);
      if (piecesTour.length >= MAX_PIECES) break;
    }
    if (piecesTour.length >= MAX_PIECES) break;
  }
  /* v20260926a : le contenu TEXTUEL lu à l'ajout (mémoire de session) est
     ajouté ici, au moment de l'appel — les conversations stockent file_id,
     name et des métadonnées d'affichage, jamais le contenu. */
  const attachesTour = enrichirPieces(piecesTour);
  try {
    r = await appelerApi(preparerHistorique(convo.messages), controleurEnCours.signal,
      panneau ? (ev) => panneau.ajouter(ev) : null, attachesTour,
      (ev) => diffusion.ingerer(ev));
  } catch (err) {
    if (err && err.name === 'AbortError') {
      /* v20260922j (bug 3) : pas de bulle « interrompue » dans une autre vue */
      if (vueOuverte()) {
        /* v20260922m (F3) : garde de retrait — la rangée peut avoir été
           détachée entre-temps (changement de vue/conversation). */
        if (suiteBox) {
          /* Mode suite : on ne touche PAS à la bulle partagée — on note
             juste l'interruption dans la section, qui reste visible. */
          const note = document.createElement('div');
          note.className = 'md';
          note.textContent = 'Génération interrompue.';
          suiteBox.appendChild(note);
        } else {
          const rangeePensee = think.closest ? think.closest('.row') : null;
          if (rangeePensee) rangeePensee.remove();
          bulle('assistant', 'Génération interrompue.');
        }
      }
      controleurEnCours = null;
      occupe = false;
      majBoutonArret();
      majBouton();
      if (vueOuverte()) saisieEl.focus();
      return;
    }
    r = { ok: false, erreur: 'Erreur inattendue.' };
  }
  controleurEnCours = null;
  /* v20260926d (kimi) : final PARTIEL (cascade stoppée côté shim pour ne pas
     doublonner) — la frappe déjà affichée devient la réponse, marquée. */
  if (r && r.ok && r.partiel) {
    const textePartiel = (r.reponse && r.reponse.trim()) ? r.reponse : diffusion.texte();
    r.reponse = (textePartiel || '(réponse vide)') + '\n\n[…réponse interrompue en cours de frappe — début conservé tel quel…]';
  }
  /* v1.2 (fuite raisonnement) : la réponse FINALE est nettoyée avant d'être
     rendue, persistée et renvoyée dans l'historique — la pensée du modèle ne
     survit nulle part (l'affichage live est déjà nettoyé dans ingerer()). */
  if (r && r.ok && typeof r.reponse === 'string') {
    r.reponse = nettoyerCoT(r.reponse);
  }
  /* v20260926b (direct) : chemin tamponné (aucun jeton reçu) — on révèle le
     texte final en machine à écrire plutôt que de l'afficher d'un bloc.
     Placé APRÈS le try/catch : ici r porte la réponse (jamais dans le catch). */
  if (r && r.ok && !r.jetonsRecus && vueOuverte()) {
    try { await diffusion.reveler(r.reponse); } catch (e) { /* rendu final direct */ }
  }
  /* v7.1.1 : si le panneau vivant n'a reçu AUCUN événement (repli JSON,
     flux coupé avant la 1re étape) mais que la réponse finale porte des
     étapes, on les utilise quand même */
  const etapesRaisonnement = (panneau && panneau.etapes.length) ? panneau.etapes.slice()
    : (r && r.raisonnement) || [];
  /* v20260926g : le texte CONTINU (jetons) est persisté tel quel sous
     etape:'texte' — jamais de tranches. */
  const penseeVive = diffusion && diffusion.pensee ? diffusion.pensee() : '';
  /* v20260926g-revue : pas de doublon si le texte existe déjà (rejeu,
     provider non-SSE qui le renvoie). */
  if (penseeVive && penseeVive.trim()
    && !etapesRaisonnement.some((e) => e && (e.etape === 'texte' || String(e.message || '').includes(penseeVive.slice(0, 80))))) {
    etapesRaisonnement.push({ etape: 'texte', message: penseeVive.slice(0, 4000) });
  }
  try {
    if (panneau) panneau.finaliser();
    /* v20260922m (F3) : si l'utilisateur a changé de conversation ou ouvert
       une vue pendant le stream, msgsEl.replaceChildren() a DÉTACHÉ la bulle
       « réfléchit… » — think.parentElement === null. L'ancien code exécutait
       think.parentElement.remove() sans garde → TypeError → occupe coincé
       (génération « fantôme »). Garde + retrait via closest('.row').
       v1.2 (suite) : en mode suite, think EST la section partagée dans la
       bulle commune — on ne la retire surtout pas, on retire juste
       l'indicateur animé. */
    const indicateurPensee = think.querySelector ? think.querySelector(':scope > .thinking') : null;
    if (suiteBox) {
      if (indicateurPensee) indicateurPensee.remove();
      /* v1.2 (audit rendu) : en mode suite, la zone de diffusion du tour a
         déjà servi (son contenu est rendu en .md juste après) — la laisser
         accumulait des dizaines de zones orphelines avec leur rendu
         progressif (mesuré : 28 .diffusion et 114 <pre> pour une seule
         réponse). On la retire, le panneau replié reste consultable. */
      try {
        suiteBox.querySelectorAll(':scope > .diffusion').forEach((z) => z.remove());
      } catch {}
    } else {
      const rangeePensee = think.closest ? think.closest('.row') : null;
      if (rangeePensee) rangeePensee.remove();
    }
    if (r && r.ok) {
      const reponseVue = vueOuverte();
      /* v1.2 : `r.reponse` est déjà le texte PUR du modèle — le raisonnement
         vit à part (etapesRaisonnement) et n'est jamais renvoyé au modèle
         (preparerHistorique ne lit que m.content). Référencer `bAssist`
         ici était un bug : il est déclaré plus bas dans le bloc `if`, donc
         TDZ → ReferenceError → la boucle exec ne démarrait jamais (le
         défaut exact « la requête s'arrête après une commande »). */
      convo.messages.push({ role: 'assistant', content: String(r.reponse || ''), outil: r.outil || null, verification: r.verification || null, rag: r.rag || null, raisonnement: etapesRaisonnement.length ? etapesRaisonnement : null });
      convo.maj = Date.now();
      rendreConversations();
      sauverConversations();
      if (reponseVue) {
        /* v1.2 (suite) : en mode suite, pas de nouvelle bulle — le rendu de
           ce tour S'AJOUTE à la bulle partagée, avec le panneau vivant déjà
           en place (créé dans suiteBox). bAssist désigne ici le conteneur du
           tour : la bulle entière en mode normal, la section en mode suite. */
        let bAssist, conteneurTour;
        if (suiteBox) {
          const md = document.createElement('div');
          md.className = 'md';
          md.appendChild(formater(r.reponse));
          suiteBox.appendChild(md);
          bAssist = suiteDe;
          conteneurTour = suiteBox;
        } else {
          bAssist = bulle('assistant', r.reponse, r.outil, { verification: r.verification, rag: r.rag });
          conteneurTour = bAssist;
        }
        /* v7.1 : le panneau survit à la réponse (replié, au-dessus du texte).
           v7.1.1 : inséré DANS la bulle (comme le rejeu) — avant, inséré comme
           frère de la bulle dans le .row flexbox -> panneau et réponse côte à
           côte, écrasés. */
        if (etapesRaisonnement.length && !suiteBox) {
          const det = (panneau && panneau.etapes.length) ? panneau.el
            : detailsRaisonnementDepuisEtapes(etapesRaisonnement);
          bAssist.insertBefore(det, bAssist.firstChild);
        }
        if (r.correction) {
          const versEntrainement = document.createElement('button');
          versEntrainement.type = 'button';
          versEntrainement.className = 'settings-tab';
          versEntrainement.style.marginTop = '8px';
          versEntrainement.textContent = 'Valider la correction dans Entraînement';
          versEntrainement.addEventListener('click', () => afficherParametres('Entraînement'));
          conteneurTour.appendChild(versEntrainement);
        }
        /* v1.2 (anti-bâclage) : réponse coupée par le budget (finish length) —
           badge persistant dans la bulle + toast : ce n'est pas le modèle qui
           bâcle, c'est la limite. Monter l'effort ou raccourcir la demande. */
        if (r.tronquee) {
          const badge = document.createElement('div');
          badge.className = 'coupe-badge';
          badge.textContent = 'Réponse coupée par la limite du modèle — demandez la suite ou montez l’effort.';
          conteneurTour.appendChild(badge);
          notifier('Réponse coupée par la limite du modèle (pas un bâclage).');
        }
        /* v1.2 (anti-bâclage, item 10) : voie réellement servie — discret,
           sous la réponse (ni provider techniques, juste le modèle). */
        if (r.model || r.provider) {
          const voie = document.createElement('div');
          voie.className = 'voie-modele';
          voie.textContent = 'via ' + (r.model || r.provider)
            + (r.modele_repli ? ' · repli' : '');
          conteneurTour.appendChild(voie);
        }
        /* v20260926a : exécution AUTOMATIQUE des blocs ```athena-exec
           (préférence executionAuto, ON par défaut) — la commande part
           seule sur l'agent local 127.0.0.1:3020, sans modale : c'est le
           modèle qui « appuie ». Chemin emprunté UNIQUEMENT sur une
           réponse fraîche : rejeu, rechargement et réouverture d'une
           conversation ne ré-exécutent rien.
           v1.2 (anti-bâclage) : le .then rend la sortie au modèle pour qu'il
           POURSUIVE l'analyse — sans cela il s'arrêtait à la 1re commande.
           v1.2 (suite) : on transmet la bulle partagée pour que le tour
           suivant continue DANS LA MÊME bulle, et le conteneur du tour
           pour ne scanner que les NOUVEAUX blocs. */
        if (preferences.executionAuto !== false) {
          /* v1.2 (audit 14:27) : UNE SEULE chaîne avec commandes + fichiers.
             Avant, les fichiers partaient en fire-and-forget : le modèle ne
             savait jamais où son fichier avait atterri, devinait un chemin,
             et l'exec suivante échouait dessus. */
          Promise.all([autoExecBlocs(conteneurTour), autoFileBlocs(conteneurTour)])
            .then(([resExec, resFich]) => enchainerApresExec(convo, [...resExec, ...resFich], bAssist))
            .catch(() => {});
        }
        /* v1.2 (suite) : on passe le CONTENEUR DU TOUR, pas la bulle
           partagée — sinon le .exec-bloc d'un tour précédent fait croire
           que CE tour a agi, et la relance ne part jamais. */
        relancerSiPromesse(convo, conteneurTour);
      } else {
        notifier('Réponse prête dans « ' + convo.titre + ' »', { label: 'Ouvrir', action: () => ouvrirConversation(convo.id) });
      }
    } else {
      if (vueOuverte()) {
        const bErr = bulle('assistant', r ? r.erreur : 'Erreur inattendue.');
        /* v7.1 : même en échec, les étapes observées restent consultables
           (v7.1.1 : dans la bulle, pas en frère flexbox) */
        if (panneau && panneau.etapes.length) {
          bErr.insertBefore(panneau.el, bErr.firstChild);
        }
      } else {
        notifier('Échec de la génération — « ' + convo.titre + ' »', { label: 'Ouvrir', action: () => ouvrirConversation(convo.id) });
      }
    }
  } catch (e) {
    /* v20260922m (F3) : un souci de rendu ne doit JAMAIS laisser l'interface
       « occupée » — l'état est rétabli ci-dessous quoi qu'il arrive. */
    if (console && console.warn) console.warn('rendu de la réponse : erreur non fatale', e);
  } finally {
    if (vueOuverte() && preferences.defilementAuto) msgsEl.scrollTop = msgsEl.scrollHeight;
    occupe = false;
    majBoutonArret();
    majBouton();
    if (vueOuverte()) saisieEl.focus();
  }
}
/* v9.4 — limite de saisie (audit : aucune borne) : 8 000 caractères, côté
   client (= borne `question` du sidecar). Le
   compteur n'apparaît qu'à l'approche de la limite — sobre par défaut. */
function majMirrorSaisie() {
  if (!saisieMirrorEl) return;
  const valeur = saisieEl.value;
  saisieMirrorEl.replaceChildren();
  if (!valeur) return;
  const commande = valeur.match(/^\/[^\s]+/);
  if (!commande) {
    saisieMirrorEl.textContent = valeur;
    return;
  }
  const bleu = document.createElement('span');
  bleu.className = 'commande';
  bleu.textContent = commande[0];
  saisieMirrorEl.append(bleu, document.createTextNode(valeur.slice(commande[0].length)));
}
function ajusterSaisie() {
  majMirrorSaisie();
  /* v20260926i : 44 px de départ (min-height carte), +24 px/ligne jusqu'à
     ~424 px puis scroll interne. Mesure explicite (scrollHeight) : robuste
     partout, sans dépendre de field-sizing. */
  saisieEl.style.height = 'auto';
  /* v20260926i : boîte content-box (+10 px de padding) — on vise 24 de
     contenu (34 de champ, 44 de carte), +24/ligne, plafond 404 (414 de
     champ, 424 de carte). */
  const h = Math.min(404, Math.max(24, saisieEl.scrollHeight - 10));
  saisieEl.style.height = h + 'px';
  saisieEl.style.overflowY = saisieEl.scrollHeight > h + 1 ? 'auto' : 'hidden';
  /* v20260926l : le miroir suit le scroll du champ (au-delà de 424 px le
     champ défile sous un miroir figé — caret détaché du texte). */
  if (saisieMirrorEl) saisieMirrorEl.scrollTop = saisieEl.scrollTop;
}
/* v1.2 (anti-bâclage, item 17) : 8000 = borne `question` du sidecar (au-delà,
   la passerelle garde la queue). */
const MAX_SAISIE = 8000;
saisieEl.maxLength = MAX_SAISIE;
function majCompteurSaisie() {
  if (!compteurSaisieEl) return;
  const n = saisieEl.value.length;
  const proche = n >= MAX_SAISIE - 400;
  compteurSaisieEl.textContent = n + ' / ' + MAX_SAISIE;
  compteurSaisieEl.classList.toggle('visible', proche);
  compteurSaisieEl.classList.toggle('limite', n >= MAX_SAISIE);
}
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (occupe) {
    if (controleurEnCours) controleurEnCours.abort();
    dernierStop = Date.now();
    return;
  }
  envoyer();
});
saisieEl.addEventListener('input', () => { ajusterSaisie(); majBouton(); majCompteurSaisie(); });
saisieEl.addEventListener('scroll', () => { if (saisieMirrorEl) saisieMirrorEl.scrollTop = saisieEl.scrollTop; });
saisieEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!occupe) envoyer();
    return;
  }
  if (e.key === 'ArrowUp') {
    if (saisies.length === 0) return;
    e.preventDefault();
    if (indexSaisie === saisies.length) brouillon = saisieEl.value;
    if (indexSaisie > 0) {
      indexSaisie--;
      saisieEl.value = saisies[indexSaisie];
      saisieEl.setSelectionRange(saisieEl.value.length, saisieEl.value.length);
    }
  } else if (e.key === 'ArrowDown') {
    if (indexSaisie >= saisies.length) return;
    e.preventDefault();
    indexSaisie++;
    if (indexSaisie >= saisies.length) {
      saisieEl.value = brouillon;
      indexSaisie = saisies.length;
    } else {
      saisieEl.value = saisies[indexSaisie];
    }
    saisieEl.setSelectionRange(saisieEl.value.length, saisieEl.value.length);
  }
});
attacherEl.addEventListener('click', () => fichiersEl.click());
fichiersEl.addEventListener('change', () => {
  const fichiers = Array.from(fichiersEl.files || []);
  fichiersEl.value = ''; /* permet de resélectionner le même fichier */
  ajouterFichiers(fichiers);
});
nouvelleDiscussionEl.addEventListener('click', () => nouvelleDiscussion());
/* v20260926m : tuiles retirées du DOM — gardes nulles (pas de crash). */
ouvrirProjetsEl?.addEventListener('click', () => afficherProjets());
ouvrirParametresEl?.addEventListener('click', () => afficherParametres());
navProjetsEl?.addEventListener('click', () => afficherProjets());
navArtefactsEl?.addEventListener('click', () => afficherVue('Artefacts', 'Les artefacts générés apparaîtront ici.'));
navCodeEl?.addEventListener('click', () => afficherVue('Code', 'Les extraits et commandes exécutables apparaîtront ici.'));
navPersonnaliserEl?.addEventListener('click', () => afficherParametres());
$('telecharger-conversations')?.addEventListener('click', () => exporterToutesConversations());
$('ouvrir-journal')?.addEventListener('click', () => afficherJournal());
$('rechercher-conversations')?.addEventListener('click', () => {
  const zone = document.querySelector('.side-recherche');
  if (!zone) return;
  zone.classList.toggle('ouverte');
  if (zone.classList.contains('ouverte')) rechercheConversationsEl?.focus();
});
$('filtre-discussions')?.addEventListener('click', () => {
  const zone = document.querySelector('.side-recherche');
  if (!zone) return;
  zone.classList.add('ouverte');
  rechercheConversationsEl?.focus();
});
ajouterProjetEl.addEventListener('click', ajouterProjet);
ouvrirCompteEl.addEventListener('click', () => {
  const estOuvert = !menuCompteEl.hidden;
  menuCompteEl.hidden = estOuvert;
  ouvrirCompteEl.setAttribute('aria-expanded', String(!estOuvert));
});
/* ---------- v20261001 : fichiers de la conversation + interpréteur HTML ----------
   Bouton « Fichiers » en haut à droite (à gauche de « Partager ») : liste les
   cartes athena-file de la conversation + les pièces jointes analysées. Un
   clic sur un .html/.svg ouvre l'interpréteur : le code tourne dans une iframe
   sandboxée (allow-scripts, sans allow-same-origin → aucun accès au stockage
   ni au DOM parent) avec relais console/erreurs via postMessage. */
function fichiersDeLaConversation() {
  const fichiers = [];
  const vus = new Set();
  document.querySelectorAll('#msgs .file-bloc').forEach((carte) => {
    const chemin = carte.dataset.chemin || 'fichier.txt';
    if (vus.has('c:' + chemin)) return;
    vus.add('c:' + chemin);
    const contenu = carte._contenuComplet != null ? String(carte._contenuComplet) : '';
    fichiers.push({ nom: nomBaseFichier(chemin), chemin, contenu, carte: carte, attache: null, meta: '' });
  });
  document.querySelectorAll('#msgs .fichier-joint-item').forEach((item) => {
    const n = item.querySelector('.fichier-joint-nom');
    const nom = (n && n.textContent) || 'Fichier sans nom';
    if (vus.has('a:' + nom)) return;
    vus.add('a:' + nom);
    const m = item.querySelector('.fichier-joint-meta');
    fichiers.push({ nom: nom, chemin: nom, contenu: null, carte: null, attache: item, meta: m ? m.textContent : 'analysé' });
  });
  return fichiers;
}
function rendrePanneauFichiers() {
  if (!panneauFichiersEl) return;
  panneauFichiersEl.textContent = '';
  const fichiers = fichiersDeLaConversation();
  const tete = document.createElement('div');
  tete.className = 'panneau-fichiers-tete';
  const titre = document.createElement('span');
  titre.textContent = 'Fichiers de la conversation';
  const nb = document.createElement('span');
  nb.textContent = fichiers.length ? fichiers.length + ' fichier' + (fichiers.length > 1 ? 's' : '') : '';
  tete.append(titre, nb);
  panneauFichiersEl.appendChild(tete);
  if (!fichiers.length) {
    const vide = document.createElement('p');
    vide.className = 'panneau-fichiers-vide';
    vide.textContent = 'Aucun fichier dans cette conversation pour l’instant.';
    panneauFichiersEl.appendChild(vide);
    return;
  }
  fichiers.forEach((f) => {
    const ext = (f.nom.split('.').pop() || '').toLowerCase();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panneau-fichier';
    btn.setAttribute('role', 'menuitem');
    btn.title = f.contenu != null ? f.chemin : f.chemin + ' — pièce jointe analysée';
    btn.appendChild(icoSvg('file'));
    const nom = document.createElement('span');
    nom.className = 'panneau-fichier-nom';
    nom.textContent = f.nom;
    const badge = document.createElement('span');
    badge.className = 'panneau-fichier-badge' + (/^html?$/.test(ext) || ext === 'svg' ? ' html' : '');
    badge.textContent = ext && ext.length <= 6 ? ext : 'txt';
    const meta = document.createElement('span');
    meta.className = 'panneau-fichier-meta';
    if (f.contenu != null) {
      try { meta.textContent = tailleFichier(new Blob([f.contenu]).size); } catch (e) { meta.textContent = f.contenu.length + ' car.'; }
    } else {
      meta.textContent = f.meta;
    }
    btn.append(nom, badge, meta);
    btn.addEventListener('click', () => { basculerPanneauFichiers(false); ouvrirDepuisListeFichiers(f); });
    panneauFichiersEl.appendChild(btn);
  });
}
function ouvrirDepuisListeFichiers(f) {
  if (f.contenu != null && /\.(html?|xhtml|svg)$/i.test(f.nom)) {
    ouvrirInterpreteur(f.nom, f.contenu);
    return;
  }
  if (f.carte) {
    f.carte.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const tete = f.carte.querySelector('.file-ouvre');
    if (tete) tete.click();
    return;
  }
  if (f.attache) f.attache.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function basculerPanneauFichiers(force) {
  if (!panneauFichiersEl || !listeFichiersEl) return;
  const ouvrir = typeof force === 'boolean' ? force : panneauFichiersEl.hidden;
  if (ouvrir) rendrePanneauFichiers();
  panneauFichiersEl.hidden = !ouvrir;
  listeFichiersEl.setAttribute('aria-expanded', String(ouvrir));
}
/* Pont injecté DANS le srcdoc : relais console/erreurs/chargement vers le
   parent. Concaténé en « <scr'+'ipt> » pour ne jamais fermer le script hôte. */
const PONT_INTERPRETEUR = [
  '<scr' + 'ipt>(function(){',
  'function env(type,data){try{parent.postMessage(Object.assign({source:"athena-interpreteur",type:type},data||{}),"*")}catch(e){}}',
  '["log","info","warn","error"].forEach(function(n){var o=console[n]?console[n].bind(console):null;',
  'console[n]=function(){var a=[].slice.call(arguments).map(function(x){try{return typeof x==="string"?x:JSON.stringify(x)}catch(e){return String(x)}});',
  'env("console",{niveau:n,texte:a.join(" ")});if(o)o.apply(null,arguments)}});',
  'window.addEventListener("error",function(e){env("erreur",{texte:e.message+" (ligne "+(e.lineno||0)+")"})});',
  'window.addEventListener("unhandledrejection",function(e){env("erreur",{texte:"Promise rejetee : "+((e.reason&&e.reason.message)||e.reason)})});',
  'window.addEventListener("load",function(){env("charge",{elements:document.querySelectorAll("*").length,titre:document.title||""})});',
  '})();</scr' + 'ipt>',
].join('');
function integrerPont(html) {
  const code = String(html == null ? '' : html);
  const tete = /<head[^>]*>/i.exec(code);
  if (tete) { const i = tete.index + tete[0].length; return code.slice(0, i) + PONT_INTERPRETEUR + code.slice(i); }
  const doctype = /<!doctype[^>]*>/i.exec(code);
  if (doctype) { const i = doctype.index + doctype[0].length; return code.slice(0, i) + PONT_INTERPRETEUR + code.slice(i); }
  return PONT_INTERPRETEUR + code;
}
/* v20261001 : liens du fichier HTML vers LES AUTRES fichiers de la
   conversation. Les cibles (CSS/JS/SVG/images) sont encodées en data: URL
   pour tourner dans l'iframe sandboxée (pas de same-origin → fiable), et
   leurs propres url()/imports sont réécrits en récursion bornée. */
const MIME_LIE = {
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', html: 'text/html', htm: 'text/html',
  txt: 'text/plain', md: 'text/plain', xml: 'application/xml',
  wasm: 'application/wasm'
};
const BINAIRES_LIE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'wasm'];
function normaliserChemin(p) {
  const sortie = [];
  for (const part of String(p || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { sortie.pop(); continue; }
    sortie.push(part);
  }
  return sortie.join('/');
}
function indexFichiersHud(cheminCourant) {
  const index = new Map();
  for (const f of fichiersDeLaConversation()) {
    if (f.contenu == null) continue;
    const n = normaliserChemin(f.chemin || f.nom);
    if (n && !index.has(n)) index.set(n, f.contenu);
  }
  return { index, dossier: normaliserChemin(cheminCourant).split('/').slice(0, -1).join('/') };
}
function resoudreLienHud(ref, ctx) {
  const r = String(ref || '').trim();
  if (!r || /^(https?:|data:|blob:|mailto:|javascript:|about:|vbscript:|tel:|#)/i.test(r)) return null;
  const i = r.search(/[?#]/);
  const suffixe = i >= 0 && r.indexOf('#', i) >= 0 ? r.slice(r.indexOf('#', i)) : '';
  const chemin = i >= 0 ? r.slice(0, i) : r;
  if (!chemin) return null;
  const candidats = [];
  if (chemin.charAt(0) === '/') candidats.push(normaliserChemin(chemin.slice(1)));
  else {
    candidats.push(normaliserChemin(ctx.dossier ? ctx.dossier + '/' + chemin : chemin));
    candidats.push(normaliserChemin(chemin));
  }
  for (const c of candidats) if (c && ctx.index.has(c)) return { contenu: ctx.index.get(c), chemin: c, suffixe };
  return null;
}
function dataUrlPour(chemin, contenu) {
  const ext = (chemin.split('.').pop() || '').toLowerCase();
  const mime = MIME_LIE[ext] || 'application/octet-stream';
  const texte = String(contenu);
  if (BINAIRES_LIE.indexOf(ext) >= 0) {
    const brut = texte.replace(/\s+/g, '');
    if (brut.length > 64 && /^[A-Za-z0-9+/]+=*$/.test(brut)) return 'data:' + mime + ';base64,' + brut;
  }
  return 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(texte);
}
function reecrireCssLien(css, ctx, niveau) {
  if (niveau > 3) return String(css);
  let out = String(css);
  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
    const l = resoudreLienHud(ref, ctx);
    return l ? 'url("' + dataUrlPour(l.chemin, l.contenu) + l.suffixe + '")' : m;
  });
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, ref) => {
    const l = resoudreLienHud(ref, ctx);
    if (!l) return m;
    const c = /\.css$/i.test(l.chemin) ? reecrireCssLien(l.contenu, ctx, niveau + 1) : l.contenu;
    return '@import url("' + dataUrlPour(l.chemin, c) + l.suffixe + '")';
  });
  return out;
}
function reecrireSpecsJs(js, ctx, niveau) {
  if (niveau > 2) return String(js);
  const resoudre = (ref) => {
    const l = resoudreLienHud(ref, ctx);
    if (!l) return null;
    const c = /\.m?js$/i.test(l.chemin) ? reecrireSpecsJs(l.contenu, ctx, niveau + 1) : l.contenu;
    return dataUrlPour(l.chemin, c) + l.suffixe;
  };
  let out = String(js);
  out = out.replace(/(\bfrom\s+|\bimport\s+|\bimport\(\s*)(["'])([^"']+)\2/g, (m, tete, q, ref) => {
    const d = resoudre(ref);
    return d ? tete + q + d + q : m;
  });
  out = out.replace(/\bexport\s+([\w*$\s{},]*?)\bfrom\s+(["'])([^"']+)\2/g, (m, mid, q, ref) => {
    const d = resoudre(ref);
    return d ? 'export ' + mid + 'from ' + q + d + q : m;
  });
  return out;
}
function integrerLiensHud(code, cheminCourant) {
  const brut = String(code == null ? '' : code);
  const ctx = indexFichiersHud(cheminCourant || 'index.html');
  if (!ctx.index.size) return brut;
  if (/\.svg$/i.test(cheminCourant || '') && /^\s*<svg[\s>]/i.test(brut)) return brut;
  let doc;
  try { doc = new DOMParser().parseFromString(brut, 'text/html'); } catch (e) { return brut; }
  if (!doc || !doc.documentElement) return brut;
  const cible = (el, attr) => {
    const l = resoudreLienHud(el.getAttribute(attr), ctx);
    if (!l) return;
    let c = l.contenu;
    const estCss = /\.css$/i.test(l.chemin);
    const estJs = /\.m?js$/i.test(l.chemin);
    if (estCss) c = reecrireCssLien(c, ctx, 0);
    if (estJs) {
      const estModule = (el.tagName === 'SCRIPT' && (el.getAttribute('type') || '').toLowerCase() === 'module') || /\.mjs$/i.test(l.chemin);
      if (estModule) c = reecrireSpecsJs(c, ctx, 0);
    }
    el.setAttribute(attr, dataUrlPour(l.chemin, c) + l.suffixe);
  };
  const srcset = (el) => {
    const v = el.getAttribute('srcset');
    if (!v) return;
    const out = v.split(',').map((parte) => {
      const t = parte.trim();
      if (!t) return '';
      const es = t.search(/\s/);
      const l = resoudreLienHud(es < 0 ? t : t.slice(0, es), ctx);
      return l ? dataUrlPour(l.chemin, l.contenu) + (es < 0 ? '' : t.slice(es)) : t;
    }).filter(Boolean).join(', ');
    el.setAttribute('srcset', out);
  };
  doc.querySelectorAll('link[href], script[src], img[src], source[src], video[src], audio[src], track[src], embed[src], object[data], use[href], image[href], input[type="image"][src]')
    .forEach((el) => cible(el, el.hasAttribute('src') ? 'src' : el.hasAttribute('href') ? 'href' : 'data'));
  doc.querySelectorAll('img[srcset], source[srcset]').forEach(srcset);
  doc.querySelectorAll('style').forEach((el) => { el.textContent = reecrireCssLien(el.textContent, ctx, 0); });
  doc.querySelectorAll('script:not([src])').forEach((el) => {
    if ((el.getAttribute('type') || '').toLowerCase() === 'module') el.textContent = reecrireSpecsJs(el.textContent, ctx, 0);
  });
  doc.querySelectorAll('[style*="url"]').forEach((el) => { el.setAttribute('style', reecrireCssLien(el.getAttribute('style') || '', ctx, 0)); });
  const doctype = doc.doctype ? '<!DOCTYPE ' + doc.doctype.name + '>' : '';
  return doctype + doc.documentElement.outerHTML;
}
function executerInterpreteur() {
  if (!interpreteurEl || interpreteurEl.hidden) return;
  const code = interpreteurCodeEl ? interpreteurCodeEl.value : '';
  if (interpreteurCadreEl) {
    interpreteurCadreEl.removeAttribute('data-rendu');
    interpreteurCadreEl.removeAttribute('data-journal');
    interpreteurCadreEl.removeAttribute('data-erreur');
  }
  try {
    const nom = interpreteurNomEl && interpreteurNomEl.textContent ? interpreteurNomEl.textContent : 'index.html';
    if (interpreteurCadreEl) interpreteurCadreEl.srcdoc = integrerPont(integrerLiensHud(code, nom));
  } catch (e) {
    if (interpreteurCadreEl) interpreteurCadreEl.dataset.erreur = (e && e.message) || String(e);
  }
}
/* Vue double par défaut : code à gauche, rendu à droite, largeurs réglables
   par la poignée #interpreteur-split (mémorisée dans localStorage).
   Le bouton « Code » masque/affiche le volet code. */
function basculerCodeInterpreteur(afficher) {
  if (interpreteurCorpsEl) interpreteurCorpsEl.classList.toggle('sans-code', !afficher);
  if (interpreteurToggleEl) interpreteurToggleEl.setAttribute('aria-pressed', afficher ? 'true' : 'false');
  ajusterSplitALaLargeur();
}
function appliquerLargeurCode(px) {
  if (!interpreteurCorpsEl || !(px > 0)) return;
  interpreteurCorpsEl.style.setProperty('--interp-largeur', Math.round(px) + 'px');
}
function largeurCodeEnregistree() {
  try {
    const v = Number(localStorage.getItem('athena_largeur_code'));
    return isFinite(v) && v > 0 ? v : 0;
  } catch (e) { return 0; }
}
function ajusterSplitALaLargeur() {
  if (!interpreteurCorpsEl) return;
  const dispo = Math.round(interpreteurCorpsEl.getBoundingClientRect().width);
  if (!(dispo > 0)) return;
  /* Sous 560 px (code 220 + poignée 8 + rendu 320 minimum) le double volet
     déborde : on empile (classe .etroit) au lieu de rogner le rendu. */
  const etroit = dispo < 560;
  interpreteurCorpsEl.classList.toggle('etroit', etroit);
  if (etroit) return;
  const actuelle = parseInt(interpreteurCorpsEl.style.getPropertyValue('--interp-largeur'), 10) || 0;
  const max = Math.max(220, dispo - 330);
  if (actuelle > max) appliquerLargeurCode(max);
}
/* Largeur du HUD = largeur réservée à la page (.page-demo.hud-ouvert en
   padding-right) : une seule variable --hud-largeur pilote les deux. */
function largeurHudEnregistree() {
  try {
    const v = Number(localStorage.getItem('athena_largeur_hud'));
    return isFinite(v) && v > 0 ? v : 0;
  } catch (e) { return 0; }
}
function appliquerLargeurHud(px) {
  const min = 420;
  const max = Math.max(min + 60, Math.round(window.innerWidth) - 600);
  document.documentElement.style.setProperty('--hud-largeur', Math.round(Math.min(Math.max(px, min), max)) + 'px');
  evaluerAdaptationHud();
}
/* Adaptation de la page : sous 920 px de contenu disponible (HUD large ou
   écran moyen), la barre latérale se rétracte (hud-economie) pour rendre la
   largeur à la conversation. Un clic sur la bascule pendant que le HUD est
   ouvert = choix manuel : on ne ré-évalue plus jusqu'à la réouverture. */
let adaptationHudManuelle = false;
function evaluerAdaptationHud() {
  const app = document.getElementById('app');
  if (!app || !pageDemoEl) return;
  /* Les deux HUD de droite (interprèteur + aperçu code) partagent la
     mécanique : l'un ou l'autre rétracte la page et la barre latérale. */
  const ouvertInterp = !!interpreteurEl && !interpreteurEl.hidden;
  const hudFichier = document.getElementById('hud-fichier');
  const ouvertHudf = !!hudFichier && !hudFichier.hidden;
  if ((!ouvertInterp && !ouvertHudf) || adaptationHudManuelle || app.classList.contains('sidebar-fermee')) {
    app.classList.remove('hud-economie');
    return;
  }
  const ouvert = ouvertInterp ? interpreteurEl : hudFichier;
  const hud = Math.round(ouvert.getBoundingClientRect().width);
  app.classList.toggle('hud-economie', hud > 0 && (window.innerWidth - hud) < 920);
}
window.addEventListener('resize', evaluerAdaptationHud);
window.addEventListener('resize', () => ajusterSplitALaLargeur());
window.addEventListener('resize', () => {
  const h = document.getElementById('hud-fichier');
  if (h && !h.hidden) appliquerLargeurHudFichier(h.getBoundingClientRect().width);
});
/* HUD ancré à DROITE : la page garde la priorité — .page-demo réserve la
   largeur du HUD en padding (conversation + barre latérale se réadaptent,
   jamais recouvertes). Code masqué par défaut : le rendu occupe tout le
   HUD, le bouton « Code » révèle l'éditeur (split interne réglable). */
function ouvrirInterpreteur(nom, code, opts) {
  if (!interpreteurEl) return;
  adaptationHudManuelle = false;
  if (interpreteurNomEl) interpreteurNomEl.textContent = nom || 'sans-titre.html';
  if (interpreteurCodeEl) interpreteurCodeEl.value = code == null ? '' : String(code);
  basculerCodeInterpreteur(!!(opts && opts.code === true));
  basculerPanneauFichiers(false);
  /* Exclusion stricte : jamais le rendu et l'aperçu de code côte à côte. */
  fermerHudFichier();
  const largeurHud = largeurHudEnregistree();
  if (largeurHud) appliquerLargeurHud(largeurHud);
  else document.documentElement.style.removeProperty('--hud-largeur');
  if (pageDemoEl) pageDemoEl.classList.add('hud-ouvert');
  interpreteurEl.hidden = false;
  const largeur = largeurCodeEnregistree();
  if (interpreteurCorpsEl) {
    if (largeur) appliquerLargeurCode(largeur);
    else interpreteurCorpsEl.style.removeProperty('--interp-largeur');
  }
  ajusterSplitALaLargeur();
  evaluerAdaptationHud();
  executerInterpreteur();
}
function fermerInterpreteur() {
  if (!interpreteurEl || interpreteurEl.hidden) return;
  interpreteurEl.hidden = true;
  if (interpreteurCadreEl) interpreteurCadreEl.srcdoc = '';
  if (pageDemoEl) pageDemoEl.classList.remove('hud-ouvert');
  adaptationHudManuelle = false;
  evaluerAdaptationHud();
}
window.addEventListener('message', (e) => {
  const d = e && e.data;
  if (!d || d.source !== 'athena-interpreteur' || !interpreteurEl || interpreteurEl.hidden || !interpreteurCadreEl) return;
  if (d.type === 'console') {
    interpreteurCadreEl.dataset.journal = ((interpreteurCadreEl.dataset.journal || '') + ' ' + d.texte).slice(-800);
  } else if (d.type === 'erreur') {
    interpreteurCadreEl.dataset.erreur = d.texte;
  } else if (d.type === 'charge') {
    interpreteurCadreEl.dataset.rendu = String(d.elements);
  }
});
if (listeFichiersEl) listeFichiersEl.addEventListener('click', () => basculerPanneauFichiers());
document.addEventListener('click', (e) => {
  if (panneauFichiersEl && !panneauFichiersEl.hidden && zoneFichiersEl && !zoneFichiersEl.contains(e.target)) basculerPanneauFichiers(false);
});
if (interpreteurExeEl) interpreteurExeEl.addEventListener('click', executerInterpreteur);
if (interpreteurFermerEl) interpreteurFermerEl.addEventListener('click', fermerInterpreteur);
if (interpreteurToggleEl) interpreteurToggleEl.addEventListener('click', () => {
  const sansCode = !!interpreteurCorpsEl && interpreteurCorpsEl.classList.contains('sans-code');
  basculerCodeInterpreteur(sansCode);
});
if (interpreteurSplitEl && interpreteurCorpsEl) {
  let glisse = false;
  let largeurGlissee = 0;
  interpreteurSplitEl.addEventListener('pointerdown', (e) => {
    if (interpreteurCorpsEl.classList.contains('sans-code')) return;
    glisse = true;
    interpreteurSplitEl.classList.add('drague');
    try { interpreteurSplitEl.setPointerCapture(e.pointerId); } catch (err) { /* capture facultative */ }
    e.preventDefault();
  });
  interpreteurSplitEl.addEventListener('pointermove', (e) => {
    if (!glisse) return;
    const boite = interpreteurCorpsEl.getBoundingClientRect();
    const min = 220, max = Math.round(boite.width) - 300;
    largeurGlissee = Math.min(Math.max(e.clientX - boite.left, min), Math.max(min, max));
    appliquerLargeurCode(largeurGlissee);
  });
  const finGlisse = () => {
    if (!glisse) return;
    glisse = false;
    interpreteurSplitEl.classList.remove('drague');
    if (largeurGlissee > 0) {
      try { localStorage.setItem('athena_largeur_code', String(Math.round(largeurGlissee))); } catch (err) { /* stockage facultatif */ }
    }
  };
  interpreteurSplitEl.addEventListener('pointerup', finGlisse);
  interpreteurSplitEl.addEventListener('pointercancel', finGlisse);
}
if (interpreteurBordEl) {
  let glisseHud = false;
  interpreteurBordEl.addEventListener('pointerdown', (e) => {
    glisseHud = true;
    interpreteurBordEl.classList.add('drague');
    try { interpreteurBordEl.setPointerCapture(e.pointerId); } catch (err) { /* capture facultative */ }
    e.preventDefault();
  });
  interpreteurBordEl.addEventListener('pointermove', (e) => {
    if (!glisseHud) return;
    appliquerLargeurHud(window.innerWidth - e.clientX);
    ajusterSplitALaLargeur();
  });
  const finGlisseHud = () => {
    if (!glisseHud) return;
    glisseHud = false;
    interpreteurBordEl.classList.remove('drague');
    const w = Math.round(interpreteurEl.getBoundingClientRect().width);
    if (w > 0) {
      try { localStorage.setItem('athena_largeur_hud', String(w)); } catch (err) { /* stockage facultatif */ }
    }
  };
  interpreteurBordEl.addEventListener('pointerup', finGlisseHud);
  interpreteurBordEl.addEventListener('pointercancel', finGlisseHud);
}
let minuteurInterpreteur = null;
if (interpreteurCodeEl) interpreteurCodeEl.addEventListener('input', () => {
  clearTimeout(minuteurInterpreteur);
  minuteurInterpreteur = setTimeout(executerInterpreteur, 900);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (interpreteurEl && !interpreteurEl.hidden) { fermerInterpreteur(); return; }
    if (panneauFichiersEl && !panneauFichiersEl.hidden) basculerPanneauFichiers(false);
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && interpreteurEl && !interpreteurEl.hidden) {
    e.preventDefault();
    executerInterpreteur();
  }
});
if (partagerEl) {
  partagerEl.addEventListener('click', async () => {
    const texte = conversationVersMarkdown(conversationOuverte());
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard indisponible');
      await navigator.clipboard.writeText(texte);
      notifier('Conversation copiée dans le presse-papiers.');
    } catch {
      telechargerMarkdown('athena-' + slugFichier(conversationOuverte().titre) + '.md', texte);
    }
  });
}
gererCompteEl.addEventListener('click', () => {
  menuCompteEl.hidden = true;
  ouvrirCompteEl.setAttribute('aria-expanded', 'false');
  afficherCompte();
});
preferencesCompteEl.addEventListener('click', () => {
  menuCompteEl.hidden = true;
  ouvrirCompteEl.setAttribute('aria-expanded', 'false');
  afficherParametres();
});
aideCompteEl.addEventListener('click', () => {
  menuCompteEl.hidden = true;
  ouvrirCompteEl.setAttribute('aria-expanded', 'false');
  afficherVue('Aide et assistance', 'Retrouvez ici les réglages de discussion, les pièces jointes et les projets de cette démo.');
});
plierConversationsEl.addEventListener('click', () => {
  const masque = !listeConversationsEl.hidden;
  listeConversationsEl.hidden = masque;
  plierConversationsEl.setAttribute('aria-expanded', String(!masque));
});

/* ---------- Barre latérale rétractable (état mémorisé, Ctrl + B) ---------- */
function majBasculeSidebar() {
  if (!basculeSidebarEl) return;
  const fermee = preferences.sidebarVisible === false;
  basculeSidebarEl.title = fermee ? 'Afficher la barre latérale' : 'Masquer la barre latérale';
  basculeSidebarEl.setAttribute('aria-label', basculeSidebarEl.title);
  basculeSidebarEl.setAttribute('aria-expanded', String(!fermee));
}
function basculerSidebar() {
  if (pageDemoEl && pageDemoEl.classList.contains('hud-ouvert')) adaptationHudManuelle = true;
  enregistrerPreference('sidebarVisible', preferences.sidebarVisible === false);
  evaluerAdaptationHud();
}
if (basculeSidebarEl) basculeSidebarEl.addEventListener('click', basculerSidebar);
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    basculerSidebar();
  }
  // AUDIT UI : le raccourci listé « Alt + N » n'avait jamais de gestionnaire
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    nouvelleDiscussion();
  }
  /* v20260922j (bug 13) : le raccourci documenté « + » n'était pas branché
     et Ctrl + E est réservé par le navigateur (recherche) — Alt + A joint
     un fichier, Alt + E exporte (Ctrl + E conservé en alias silencieux). */
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    fichiersEl.click();
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    exporterConversation(idConversation);
  }
  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    exporterConversation(idConversation);
  }
});
/* Les conversations sont rendues dynamiquement (rendreConversations) */

/* (Fond 3D Three.js supprimé — voir note en tête de fichier) */

/* ---------- Régénération de la dernière réponse (v8.6, section isolée) ----------
   Le bouton « ↻ Régénérer » sous la dernière réponse (btn-regenerer) a été
   retiré de l'interface ; la fonction reste accessible par le menu d'actions
   du message et le raccourci Alt + R. Elle supprime la réponse de
   l'historique et rejoue le pipeline d'envoi (genererReponse). Sert aussi
   de « réessayer » après une erreur ou une interruption (bulle non
   persistée : l'historique se termine alors par le message utilisateur). */

function regenererPossible() {
  if (occupe) return false;
  const rangees = msgsEl.querySelectorAll('.row');
  const derniere = rangees[rangees.length - 1];
  if (!derniere || !derniere.classList.contains('bot')) return false;
  /* v20260922m (F18) : la rangée doit appartenir à la conversation AFFICHÉE
     (étiquette dataset.convo posée par bulle()) — le bouton ne se colle plus
     à une rangée d'une autre vue, et un souci de classes ne masque plus la
     régénération de la dernière réponse de la conversation courante. */
  return !derniere.dataset.convo || derniere.dataset.convo === String(idConversation || '');
}
async function regenererDerniereReponse() {
  if (!regenererPossible()) {
    /* v20260926e (kimi) : retour silencieux = l'utilisateur croit le
       raccourci mort ; on le dit. */
    notifier('Rien à régénérer pour l’instant.');
    return;
  }
  /* v20260926e : on ne régénère pas par-dessus une lecture en cours. */
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch {}
  const convo = conversationOuverte();
  /* v20260922m (F18) : seules les rangées de LA conversation affichée sont
     candidates au retrait (étiquette dataset.convo). */
  const rangees = Array.from(msgsEl.querySelectorAll('.row'))
    .filter((r) => !r.dataset.convo || r.dataset.convo === String(idConversation || ''));
  const rangeesReponse = [];
  for (let i = rangees.length - 1; i >= 0 && rangees[i].classList.contains('bot'); i--) {
    rangeesReponse.unshift(rangees[i]);
  }
  /* Réponse persistée -> retirée de l'historique (on repart de la question).
     Sinon (erreur / interruption, bulle non persistée) -> simple relance. */
  if (convo.messages.length && convo.messages[convo.messages.length - 1].role === 'assistant') {
    convo.messages.pop();
  }
  /* v1.2 (audit) : Régénérer repart de la question — donc le budget et la
     mémoire de la chaîne repartent aussi. Avant, rien n'était réinitialisé :
     _toursExec gardait l'ancien compteur (budget fantôme), _budgetEpuise
     resté à true BLOQUAIT toute commande sans explication, _msgExec pointait
     après le pop() vers un autre message (le rewrite du journal écrasait le
     MAUVAIS message → historique corrompu envoyé au modèle), et
     _relanceFaite interdisait toute relance. */
  convo._toursExec = 0;
  convo._cmdExecutees = [];
  convo._fenetreExec = [];
  convo._msgExec = null;
  convo._budgetEpuise = false;
  convo._relanceFaite = false;
  convo.maj = Date.now();
  sauverConversations();
  rangeesReponse.forEach((rangee) => rangee.remove());
  rendreConversations();
  occupe = true;
  majBoutonArret();
  await genererReponse(convo);
}
window.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    regenererDerniereReponse();
  }
});
publierHooks('__atelierRegenerer', { regenerer: regenererDerniereReponse, visible: () => false }); /* hook QA — bouton retiré de l'interface */

/* ---------- v10.9.4 (HUD) — SÉLECTEUR DE MODÈLE DE LANGUE ----------
   Badge compact dans le header (modèle actif) + panneau overlay (sections
   Actif / Cloud / Local). Sélection persistée (localStorage
   « athena_selected_model ») et envoyée en `model_id` à /api/chat.
   - « auto » = meilleur disponible, sans relais — jamais un chemin parallèle ;
   - item down → grisé + title neutre (aucune erreur HTTP, N4) ;
   - si le modèle choisi échoue, son erreur honnête remonte (plus de repli
     silencieux) via les chemins d'appel ;
   - si aucun modèle local n'est détecté, la section Local n'est pas rendue ;
   - ↻ = rafraîchissement manuel (re-catalogue cloud + re-scan serveurs locaux
     Ollama / LM Studio / llama.cpp côté pont). */
const CLE_MODELE = 'athena_selected_model';
/* v1.2 (anti-bâclage, item 11) : efforts connus par modèle (remplis à chaque
   rendu du HUD) — pour griser le sélecteur d'effort quand il est sans effet.
   false tant que le catalogue n'a jamais chargé (on ne grise pas à l'aveugle). */
let effortsConnus = {};
let catalogueEffortsCharge = false;
/* v1.2 (anti-bâclage) : EFFORTS lus par majBadgeEffort() dès l'init
   (initHudModele) — déclarés ici, AVANT tout usage (même piège TDZ que
   LIMITES_CTX : une const lue trop tôt tue tout le chargement). */
const CLE_EFFORT = 'athena_effort';
const EFFORTS = [
  { v: 'low', nom: 'low', aide: 'Rapide — raisonnement court' },
  { v: 'medium', nom: 'medium', aide: 'Équilibré — raisonnement moyen' },
  { v: 'high', nom: 'high', aide: 'Approfondi — raisonnement long' },
  { v: 'max', nom: 'max', aide: 'Maximal — le plus profond (défaut)' },
];
const EFFORT_DEFAUT = 'max';
let effortChoisi = EFFORT_DEFAUT;

try {
  const brutEffort = localStorage.getItem(CLE_EFFORT);
  if (typeof brutEffort === 'string' && EFFORTS.some((e) => e.v === brutEffort)) {
    effortChoisi = brutEffort;
  }
} catch { /* stockage optionnel — « max » par défaut */ }
/* v1.2 : limites de contexte PARTOUT avant tout usage — ces consts sont lues
   par majBadgeContexte() dès l'init (initHudModele) ; déclarées après, c'est
   une TDZ qui tue tout le chargement (boutons morts, sidebar vide). */
const LIMITE_DEFAUT_CTX = 32768;
const LIMITES_CTX = {
  'pollinations:openai-fast': 131072, 'pollinations:openai': 131072,
  'openrouter:google/gemma-4-31b-it:free': 262144, 'openrouter:google/gemma-4-26b-a4b-it:free': 262144,
  'openrouter:qwen/qwen3.8-27b:free': 262144,
  'openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': 262144,
  'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free': 1048576,
  'openrouter:nvidia/nemotron-3-super-120b-a12b:free': 262144,
  'openrouter:nvidia/nemotron-3.5-lightning:free': 1048576,
  'openrouter:nvidia/nemotron-3.5-content-safety:free': 131072,
  'openrouter:poolside/laguna-s-2.1:free': 262144, 'openrouter:poolside/laguna-xs-2.1:free': 262144,
  'openrouter:cohere/north-mini-code:free': 262144,
  'openrouter:inclusionai/ling-3.0-flash-sante:free': 262144, 'openrouter:inclusionai/ling-3.0-flash-fin:free': 262144,
  'openrouter:dots-studio/dots-3-note-preview:free': 524288, 'openrouter:liquid/lfm-2.5-2.6b:free': 65536,
  'openrouter:stealth/space-bunny-alpha': 1048576, 'openrouter:openrouter/free': 32768,
};
let modeleChoisi = null;
let hudCharge = false;

try {
  const brut = JSON.parse(localStorage.getItem(CLE_MODELE) || 'null');
  if (brut && typeof brut.id === 'string' && brut.id !== 'auto'
      && /^[A-Za-z0-9._:/\-]+$/.test(brut.id) && brut.id.length <= 120
      && typeof brut.name === 'string') {
    /* v20260928 : tokenrouter retiré (quota épuisé) — un vieux choix
       mémorisé ne doit plus être rejoué (403 à chaque message). */
    if (!brut.id.startsWith('tokenrouter:')) {
      /* v1.2 (anti-bâclage, item 15) : le drapeau local est conservé pour
         la jauge de contexte (num_ctx du modèle local). */
      modeleChoisi = { id: brut.id, name: brut.name.slice(0, 80), local: brut.local === true };
    } else {
      try { localStorage.removeItem(CLE_MODELE); } catch {}
    }
  }
} catch { /* stockage optionnel — « auto » par défaut */ }

function majBadgeModele() {
  const el = document.getElementById('modele-actif-nom');
  if (el) el.textContent = modeleChoisi ? modeleChoisi.name : 'auto';
  if (modelePiedEl) modelePiedEl.textContent = modeleChoisi ? modeleChoisi.name : 'auto';
  const bouton = document.getElementById('btn-modele');
  if (bouton) {
    bouton.title = modeleChoisi
      ? `Modèle actif : ${modeleChoisi.name} - clic pour changer`
      : 'Modèle de langue - auto = meilleur dispo, sans relais';
  }
  majBadgeContexte();
  majBadgeEffort();
}

function fermerHud() {
  const panneau = document.getElementById('hud-modeles');
  const bouton = document.getElementById('btn-modele');
  if (panneau && !panneau.hidden) {
    panneau.hidden = true;
    if (bouton) bouton.setAttribute('aria-expanded', 'false');
  }
  fermerHudEffort();
  fermerHudTemp();
  fermerHudContexte();
}

function itemModeleHud(m, selectionCourante) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'hud-item' + (m.id === selectionCourante ? ' actif' : '') + (m.up ? '' : ' down');
  if (!m.up) item.title = 'Momentanément indisponible.';
  const point = document.createElement('span');
  point.className = 'hud-point';
  point.setAttribute('aria-hidden', 'true');
  const infos = document.createElement('span');
  infos.className = 'hud-item-infos';
  const nom = document.createElement('span');
  nom.className = 'hud-item-nom';
  nom.textContent = m.name || m.id;
  const provider = document.createElement('span');
  provider.className = 'hud-item-provider';
  provider.textContent = m.provider || '';
  infos.append(nom, provider);
  item.append(point, infos);
  if (m.id === selectionCourante) {
    const badge = document.createElement('span');
    badge.className = 'hud-badge actif';
    badge.textContent = 'actif';
    item.appendChild(badge);
  } else if (m.local) {
    const badge = document.createElement('span');
    badge.className = 'hud-badge';
    badge.textContent = 'local';
    item.appendChild(badge);
  }
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!m.up) return; // grisé : rien (tooltip neutre)
    /* « auto » = retour à la cascade par défaut : on RETIRE la sélection
       (aucun model_id envoyé) plutôt que de stocker un pseudo-modèle. */
    if (m.id === 'auto') {
      modeleChoisi = null;
      try { localStorage.removeItem(CLE_MODELE); } catch { /* stockage optionnel */ }
    } else {
      modeleChoisi = { id: m.id, name: m.name || m.id, local: m.local === true };
      try { localStorage.setItem(CLE_MODELE, JSON.stringify(modeleChoisi)); } catch { /* stockage optionnel */ }
    }
    majBadgeModele();
    fermerHud();
  });
  return item;
}

function rendreHud(modeles, dispo) {
  const panneau = document.getElementById('hud-modeles');
  if (!panneau) return;
  panneau.replaceChildren();
  /* v1.2 (anti-bâclage, item 11) : mémorise les efforts par modèle pour
     le grisage du sélecteur d'effort. */
  effortsConnus = {};
  (Array.isArray(modeles) ? modeles : []).forEach((m) => {
    if (m && typeof m.id === 'string') effortsConnus[m.id] = Array.isArray(m.efforts) ? m.efforts : null;
  });
  catalogueEffortsCharge = true;
  majBadgeEffort();
  const selectionCourante = modeleChoisi ? modeleChoisi.id : 'auto';

  const titreActif = document.createElement('div');
  titreActif.className = 'hud-section-titre';
  titreActif.textContent = 'Actif';
  panneau.appendChild(titreActif);
  panneau.appendChild(itemModeleHud({ id: 'auto', name: 'auto (sans relais)', provider: 'meilleur dispo, un seul essai', up: true, local: false, active: false }, selectionCourante));

  const cloud = modeles.filter((m) => !m.local);
  const locaux = modeles.filter((m) => m.local);
  if (cloud.length) {
    const titreCloud = document.createElement('div');
    titreCloud.className = 'hud-section-titre';
    titreCloud.textContent = 'Cloud';
    panneau.appendChild(titreCloud);
    for (const m of cloud) panneau.appendChild(itemModeleHud(m, selectionCourante));
  }
  if (locaux.length) {
    const titreLocal = document.createElement('div');
    titreLocal.className = 'hud-section-titre';
    titreLocal.textContent = 'Local';
    panneau.appendChild(titreLocal);
    for (const m of locaux) panneau.appendChild(itemModeleHud(m, selectionCourante));
  }
  if (!cloud.length && !locaux.length) {
    const vide = document.createElement('p');
    vide.className = 'hud-vide';
    vide.textContent = dispo
      ? 'Aucun modèle détecté pour le moment.'
      : 'Liste momentanément indisponible — la cascade par défaut reste active.';
    panneau.appendChild(vide);
  }

  const actions = document.createElement('div');
  actions.className = 'hud-actions';
  const note = document.createElement('span');
  note.className = 'hud-note';
  note.textContent = 'Si le modèle choisi échoue : erreur honnête, sans relais.';
  const rafraichir = document.createElement('button');
  rafraichir.type = 'button';
  rafraichir.className = 'hud-rafraichir';
  rafraichir.textContent = '↻ Rafraîchir';
  rafraichir.addEventListener('click', async (e) => {
    e.stopPropagation();
    rafraichir.disabled = true;
    rafraichir.textContent = '…';
    await chargerModelesHud(true);
    rafraichir.disabled = false;
    rafraichir.textContent = '↻ Rafraîchir';
  });
  actions.append(note, rafraichir);
  panneau.appendChild(actions);
}

async function chargerModelesHud(rafraichir = false) {
  try {
    const r = await fetch('/api/modeles', {
      method: rafraichir ? 'POST' : 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(rafraichir ? 20000 : 9000),
    });
    const d = await r.json();
    if (Array.isArray(d.modeles)) rendreHud(d.modeles, d.dispo !== false);
    hudCharge = true;
  } catch { /* silencieux : le panneau garde l'ancien contenu ou « indisponible » */ }
}

(function initHudModele() {
  const bouton = document.getElementById('btn-modele');
  const panneau = document.getElementById('hud-modeles');
  if (!bouton || !panneau) return;
  majBadgeModele();
  bouton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panneau.hidden) { fermerHud(); return; }
    fermerHudEffort(); /* un seul panneau ouvert à la fois */
    panneau.hidden = false;
    bouton.setAttribute('aria-expanded', 'true');
    if (!hudCharge) chargerModelesHud(false);
  });
  panneau.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', fermerHud);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fermerHud();
  });
  window.addEventListener('athena-modeles-rafraichir', () => chargerModelesHud(true));
  // Pré-chargement discret (liste prête à l'ouverture du panneau).
  setTimeout(() => chargerModelesHud(false), 2500);
})();

/* ---------- HUD — SÉLECTEUR D'EFFORT DE RAISONNEMENT ----------
   Bouton posé à droite du bouton modèle (celui-ci est poussé à gauche).
   L'effort est :
   - lu par api-shim.js et injecté dans le payload NVIDIA sous le nom
     `reasoning_effort` (échelle HUD : low / medium / high / max —
     repli automatique sur l'échelon admis par le modèle choisi :
     kimi-k3 refuse « medium » → low) ;
   - persisté comme la sélection de modèle (localStorage « athena_effort »).
   Un choix n'a d'effet que sur les chemins NVIDIA sans cadrage propre
   (llama-vision / content-safety refusent l'option). */
/* EFFORTS et effortChoisi déclarés près de CLE_MODELE (anti-TDZ, voir ci-dessus). */

function majBadgeEffort() {
  const el = document.getElementById('effort-actif-nom');
  if (el) el.textContent = effortChoisi;
  const bouton = document.getElementById('btn-effort');
  if (bouton) {
    const courant = EFFORTS.find((e) => e.v === effortChoisi);
    /* v1.2 (anti-bâclage, item 11) : l'effort ne sert qu'aux modèles qui
       l'acceptent (NVIDIA, entrées avec `efforts`) — sinon sélecteur grisé
       avec « sans effet » (plus de réglage mort). En auto ou catalogue
       inconnu : on laisse actif (la cascade peut viser un tel modèle). */
    const eff = modeleChoisi ? effortsConnus[modeleChoisi.id] : undefined;
    const sansEffet = Boolean(modeleChoisi) && catalogueEffortsCharge
      && !String(modeleChoisi.id).startsWith('nvidia:')
      && !(Array.isArray(eff) && eff.length);
    bouton.disabled = sansEffet;
    bouton.title = `Effort de raisonnement : ${effortChoisi} — ${courant ? courant.aide : ''} (clic pour changer)`
      + (sansEffet ? ' — sans effet sur ce modèle' : '');
  }
}

function fermerHudEffort() {
  const panneau = document.getElementById('hud-efforts');
  const bouton = document.getElementById('btn-effort');
  if (!panneau || panneau.hidden) return;
  panneau.hidden = true;
  if (bouton) bouton.setAttribute('aria-expanded', 'false');
}

function itemEffortHud(e) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'hud-item' + (e.v === effortChoisi ? ' actif' : '');
  const point = document.createElement('span');
  point.className = 'hud-point';
  point.setAttribute('aria-hidden', 'true');
  const infos = document.createElement('span');
  infos.className = 'hud-item-infos';
  const nom = document.createElement('span');
  nom.className = 'hud-item-nom';
  nom.textContent = e.nom;
  const aide = document.createElement('span');
  aide.className = 'hud-item-provider';
  aide.textContent = e.aide;
  infos.append(nom, aide);
  item.append(point, infos);
  if (e.v === effortChoisi) {
    const badge = document.createElement('span');
    badge.className = 'hud-badge actif';
    badge.textContent = 'actif';
    item.appendChild(badge);
  }
  item.addEventListener('click', (ev) => {
    ev.stopPropagation();
    effortChoisi = e.v;
    try { localStorage.setItem(CLE_EFFORT, e.v); } catch { /* stockage optionnel */ }
    majBadgeEffort();
    fermerHudEffort();
  });
  return item;
}

function rendreHudEffort() {
  const panneau = document.getElementById('hud-efforts');
  if (!panneau) return;
  panneau.replaceChildren();
  const titre = document.createElement('div');
  titre.className = 'hud-section-titre';
  titre.textContent = 'Effort de raisonnement';
  panneau.appendChild(titre);
  for (const e of EFFORTS) panneau.appendChild(itemEffortHud(e));
  const note = document.createElement('div');
  note.className = 'hud-note';
  note.textContent = 'Envoyé en reasoning_effort (payload NVIDIA) — repli automatique si le modèle refuse la valeur (ex. kimi-k3 : medium → low).';
  panneau.appendChild(note);
}

/* ---------- Température rapide (pied de page) ---------- */
const TEMPS = [
  { v: 0.2, nom: 'Précis', aide: 'Factuel, peu de fantaisie.' },
  { v: 0.6, nom: 'Équilibré', aide: 'Valeur par défaut recommandée.' },
  { v: 1.0, nom: 'Créatif', aide: 'Plus de variété et d’idées.' },
  { v: 1.5, nom: 'Audacieux', aide: 'Très créatif, inexactitudes possibles.' },
  { v: 2.0, nom: 'Maximum', aide: 'Chaos contrôlé.' },
];
function temperatureChoisie() {
  const v = preferences.temperature;
  return (typeof v === 'number' && Number.isFinite(v)) ? Math.max(0, Math.min(2, v)) : 0.6;
}
function majBadgeTemp() {
  const el = document.getElementById('temp-actif-nom');
  if (el) el.textContent = temperatureChoisie().toFixed(1);
  const bouton = document.getElementById('btn-temp');
  if (bouton) bouton.title = `Température des modèles : ${temperatureChoisie().toFixed(1)} — clic pour changer`;
}
function fermerHudTemp() {
  const panneau = document.getElementById('hud-temp');
  const bouton = document.getElementById('btn-temp');
  if (!panneau || panneau.hidden) return;
  panneau.hidden = true;
  if (bouton) bouton.setAttribute('aria-expanded', 'false');
}
function itemTempHud(e) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'hud-item' + (e.v === temperatureChoisie() ? ' actif' : '');
  const point = document.createElement('span');
  point.className = 'hud-point';
  point.setAttribute('aria-hidden', 'true');
  const infos = document.createElement('span');
  infos.className = 'hud-item-infos';
  const nom = document.createElement('span');
  nom.className = 'hud-item-nom';
  nom.textContent = e.v.toFixed(1) + ' · ' + e.nom;
  const aide = document.createElement('span');
  aide.className = 'hud-item-provider';
  aide.textContent = e.aide;
  infos.append(nom, aide);
  item.append(point, infos);
  if (e.v === temperatureChoisie()) {
    const badge = document.createElement('span');
    badge.className = 'hud-badge actif';
    badge.textContent = 'actif';
    item.appendChild(badge);
  }
  item.addEventListener('click', (ev) => {
    ev.stopPropagation();
    enregistrerPreference('temperature', e.v);
    majBadgeTemp();
    fermerHudTemp();
  });
  return item;
}
function rendreHudTemp() {
  const panneau = document.getElementById('hud-temp');
  if (!panneau) return;
  panneau.replaceChildren();
  const titre = document.createElement('div');
  titre.className = 'hud-section-titre';
  titre.textContent = 'Température des modèles';
  panneau.appendChild(titre);
  for (const e of TEMPS) panneau.appendChild(itemTempHud(e));
  const note = document.createElement('div');
  note.className = 'hud-note';
  note.textContent = '0 = précis, 2 = audacieux. Certains modèles gardent leur réglage propre (ex. NVIDIA).';
  panneau.appendChild(note);
}
(function initHudTemp() {
  const bouton = document.getElementById('btn-temp');
  const panneau = document.getElementById('hud-temp');
  if (!bouton || !panneau) return;
  majBadgeTemp();
  bouton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panneau.hidden) { fermerHudTemp(); return; }
    fermerHud();
    rendreHudTemp();
    panneau.hidden = false;
    bouton.setAttribute('aria-expanded', 'true');
  });
  panneau.addEventListener('click', (e) => e.stopPropagation());
})();

/* ---------- Contexte (tokens de la discussion) ---------- */
/* LIMITES_CTX déclarées près de CLE_MODELE (anti-TDZ à l'init). */
function jetonsDiscussion() {
  const c = typeof conversationOuverte === 'function' ? conversationOuverte() : null;
  let n = 0;
  ((c && c.messages) || []).forEach((m) => { n += Math.ceil(String((m && m.content) || '').length / 4) + 4; });
  return n;
}
function limiteDiscussion() {
  if (!modeleChoisi) return null;
  if (LIMITES_CTX[modeleChoisi.id] !== undefined) return LIMITES_CTX[modeleChoisi.id];
  if (String(modeleChoisi.id).startsWith('nvidia:')) return 131072;
  /* v1.2 (anti-bâclage, item 15) : modèles locaux → num_ctx RÉEL réglé par
     l'utilisateur (Ollama stock = 4096, pas 32768 — la jauge mentait). */
  if (modeleChoisi.local) {
    const n = parseInt(preferences.contexteLocal, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 1000000) : LIMITE_DEFAUT_CTX;
  }
  return LIMITE_DEFAUT_CTX;
}
function formatK(n) {
  const x = Math.round(n);
  if (x < 1000) return String(x);
  return (x / 1000).toFixed(x < 10000 ? 1 : 0).replace('.', ',') + 'k';
}
function majBadgeContexte() {
  const el = document.getElementById('contexte-actif-nom');
  if (!el) return;
  const u = jetonsDiscussion();
  const lim = limiteDiscussion();
  el.textContent = lim ? formatK(u) + '/' + formatK(lim) : formatK(u);
  const bouton = document.getElementById('btn-contexte');
  if (bouton) bouton.title = lim
    ? `Contexte : ${u} tokens estimés / ${lim} (${Math.round((u / lim) * 100)} %) — compression auto à 85 %`
    : `Contexte : ${u} tokens estimés (mode auto — limite selon le modèle) — compression auto à 85 %`;
}
function fermerHudContexte() {
  const panneau = document.getElementById('hud-contexte');
  const bouton = document.getElementById('btn-contexte');
  if (!panneau || panneau.hidden) return;
  panneau.hidden = true;
  if (bouton) bouton.setAttribute('aria-expanded', 'false');
}
function rendreHudContexte() {
  const panneau = document.getElementById('hud-contexte');
  if (!panneau) return;
  panneau.replaceChildren();
  majBadgeContexte();
  const titre = document.createElement('div');
  titre.className = 'hud-section-titre';
  titre.textContent = 'Contexte de la discussion';
  panneau.appendChild(titre);
  const c = conversationOuverte();
  const nb = (c.messages || []).length;
  const u = jetonsDiscussion();
  const lim = limiteDiscussion();
  const lignes = [
    ['Utilisés (estimés)', u + ' tokens'],
    ['Modèle', modeleChoisi ? modeleChoisi.name : 'auto (sans relais)'],
    ['Limite', lim ? lim + ' tokens' : 'selon le modèle choisi'],
    ['Remplissage', lim ? Math.round((u / lim) * 100) + ' %' : '—'],
    ['Messages', nb + ' message' + (nb > 1 ? 's' : '')],
  ];
  lignes.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'hud-note';
    row.textContent = k + ' : ' + v;
    panneau.appendChild(row);
  });
  const note = document.createElement('div');
  note.className = 'hud-note';
  note.textContent = 'Estimation : caractères / 4. Au-delà de 85 % de la limite, les anciens messages sont résumés automatiquement.';
  panneau.appendChild(note);
}
(function initHudContexte() {
  const bouton = document.getElementById('btn-contexte');
  const panneau = document.getElementById('hud-contexte');
  if (!bouton || !panneau) return;
  majBadgeContexte();
  bouton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panneau.hidden) { fermerHudContexte(); return; }
    fermerHud();
    rendreHudContexte();
    panneau.hidden = false;
    bouton.setAttribute('aria-expanded', 'true');
  });
  panneau.addEventListener('click', (e) => e.stopPropagation());
  setInterval(() => { try { majBadgeContexte(); } catch (_) {} }, 5000);
})();

(function initHudEffort() {
  const bouton = document.getElementById('btn-effort');
  const panneau = document.getElementById('hud-efforts');
  if (!bouton || !panneau) return;
  majBadgeEffort();
  bouton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panneau.hidden) { fermerHudEffort(); return; }
    fermerHud(); /* un seul panneau ouvert à la fois */
    rendreHudEffort();
    panneau.hidden = false;
    bouton.setAttribute('aria-expanded', 'true');
  });
  panneau.addEventListener('click', (e) => e.stopPropagation());
})();

/* ---------- INITIALISATION — v7.2.2 : déplacée ICI (fin de module) ----------
   Toutes les déclarations (consts du module, saisies, contrôleur…)
   sont évaluées avant le premier rendu : le rejeu d'une conversation avec
   étapes de raisonnement ne peut plus toucher une const en TDZ. */
appliquerPreferences();
ajusterSaisie();
ouvrirConversation(idConversation);
