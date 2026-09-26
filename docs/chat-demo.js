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

const ROUGE = '#E02600';
const ENCRE = '#1C1A1A';

const $ = (id) => document.getElementById(id);
/* v9.4 — sécurité (audit) : les hooks window.__atelier* étaient exposés en
   prod (surface d'attaque + empreinte). Ils ne sont publiés QUE avec ?qa
   dans l'URL (tests automatisés) ; l'application n'y touche jamais. */
const MODE_QA = new URLSearchParams(location.search).has('qa');
function publierHooks(nom, obj) { if (MODE_QA) window[nom] = obj; }
const msgsEl = $('msgs'), saisieEl = $('saisie'), btnEl = $('btn');
const titreConversationEl = $('titre-conversation'), partagerEl = $('partager');
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
   du fichier, indexé par file_id. Non persisté (les conversations ne gardent
   que {file_id,name}) : la lecture est donc valable pour la SESSION en cours,
   y compris après la purge des puces (envoyer) et pendant une régénération. */
const contenusFichiers = new Map();
/* v20260922l (21) : true PENDANT un re-rendu complet de vue (changement de
   conversation) — l'observateur de pastille ignore ces mutations-là. */
let renduVueEnCours = false;

function tailleFichier(octets) {
  if (octets < 1024 * 1024) return Math.max(1, Math.round(octets / 1024)) + ' Ko';
  return (octets / (1024 * 1024)).toFixed(1) + ' Mo';
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
/* v20260922l (17) : même borne que le sidecar (ZAI_MAX_UPLOAD, défaut 20 Mo).
   Contrôle AVANT lecture FileReader : un fichier trop gros ne gonfle plus la
   RAM en base64 (+33 %) pour récolter un 413 garanti. */
const MAX_OCTETS_CLIENT = 20000000;
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
    erreur: indexe ? null : (d.erreur || (r.status === 422
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
/* Seuls les fichiers INDEXÉS partent avec le message. */
function attachmentsEnvoyes() {
  return fichiersJoints
    .filter((f) => f.file_id && f.status === 'indexed')
    .map((f) => ({ file_id: f.file_id, name: f.name }));
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
   propre borne de découpage/indexation). */
const MAX_CONTENU_JOINT = 200000;
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
  if (!fichier || fichier.size <= 0 || fichier.size > MAX_CONTENU_JOINT) return null;
  const texte = await lectureTexte(fichier);
  if (texte == null || !texte.length) return null;
  if (compteOctetsDeControle(texte) / texte.length > 0.02) return null;
  return texte;
}
/* v20260926a : le contenu lu part UNIQUEMENT au moment de l'appel (jamais
   persisté avec la conversation — seul {file_id,name} est stocké). */
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
    const etat = fichier.status === 'indexed'
      ? '✓ indexé · ' + (fichier.chunks || 0) + ' seg.'
      : fichier.status === 'failed'
      ? 'échec : ' + (fichier.erreur || 'extraction impossible')
      : '… ' + (fichier.status === 'uploading' ? 'envoi' : 'indexation');
    nom.textContent = fichier.name + ' · ' + tailleFichier(fichier.size || 0) + ' · ' + etat;
    if (fichier.status === 'indexed') {
      chip.title = 'Fichier indexé côté serveur — les segments pertinents seront fournis au modèle (FILE_DATA).';
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
       UNIQUE prévient que la persistance est saturée. */
    while (garde.length > 1) {
      const victime = garde
        .map((c, i) => ({ c, i }))
        .filter((x) => !x.c.epingle && x.c.id !== idConversation)
        .sort((a, b) => a.c.maj - b.c.maj)[0];
      if (!victime) break;
      garde.splice(victime.i, 1);
      try { ecrire(garde); quotaAverti = false; return; } catch { /* on continue d'élaguer */ }
    }
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
function titreDepuis(texte) {
  const premiereLigne = (texte || '').split('\n')[0].trim();
  if (!premiereLigne) return 'Nouvelle discussion';
  return premiereLigne.length > 30 ? premiereLigne.slice(0, 30) + '…' : premiereLigne;
}
/* Aperçu sobre sous le titre (2e ligne de la conversation) + heure. */
function apercuConversation(c) {
  const dernier = [...(c.messages || [])].reverse().find((m) => m && m.content && String(m.content).trim());
  if (!dernier) return 'Conversation vide';
  const t = String(dernier.content).replace(/\s+/g, ' ').trim();
  return (dernier.role === 'user' ? 'Vous : ' : '') + (t.length > 72 ? t.slice(0, 72) + '…' : t);
}
function heureCourt(ts) {
  try { return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
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
      /* v7.2.2 : UN message corrompu (ancien format, champ inattendu) ne doit
         JAMAIS tuer tout le rejeu ni la sidebar — on rend un placeholder et on
         continue (avant : exception -> module mort au chargement). */
      try {
        bulle(m.role === 'user' ? 'user' : 'assistant', m.content, m.outil, { verification: m.verification, rag: m.rag, raisonnement: m.raisonnement, attachments: m.attachments || null, traces: m.traces || null });
      } catch (e) {
        if (console && console.warn) console.warn('rejeu : message non rendu', e);
        bulle('assistant', '(message non affiché — erreur de rejeu)');
      }
    });
    rendreConversations();
    sauverConversations();
  } finally {
    setTimeout(() => { renduVueEnCours = false; }, 0);
  }
  saisieEl.focus();
}
async function supprimerConversation(id) {
  const c = conversations.find((x) => x.id === id);
  if (!c) return;
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
      voile.remove();
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
    const surTouche = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fermer(false); }
    };
    document.addEventListener('keydown', surTouche);
    document.body.appendChild(voile);
    /* NB : le focus va au champ (ou au bouton) ; Escape/Entrée sont traités
       LOCALEMENT (puis stopPropagation) car stopPropagation empêcherait
       sinon l'événement d'atteindre le listener document — Échap semblerait
       inopérant (bug attrapé par la QA navigateur v9.4). */
    const surToucheChamp = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fermer(true); }
      else if (e.key === 'Escape') { e.preventDefault(); fermer(false); }
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
  document.querySelector('.chat-shell').appendChild(t);
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
      lignes.push('<details><summary>Raisonnement — ' + m.raisonnement.length + ' étape' + (m.raisonnement.length > 1 ? 's' : '') + '</summary>');
      lignes.push('');
      m.raisonnement.forEach((et) => lignes.push('- ' + (et.message || et.etape || '')));
      lignes.push('');
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
        if (puce) { if (!raisonnement) raisonnement = []; raisonnement.push({ etape: 'import', message: puce[1] }); }
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
  const tri = trierPourAffichage(); /* MÊME ordre que le rendu (épinglées d'abord) */
  const idx = Array.from(listeConversationsEl.querySelectorAll('.convo-ligne')).indexOf(ligne);
  const c = tri[idx];
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

const preferencesParDefaut = { animationsReduites: false, densiteCompacte: false, defilementAuto: true, confirmationEnvoi: false, sidebarVisible: true, outilsWeb: true, raisonnementVisible: false, executionAuto: true };
let preferences = { ...preferencesParDefaut };
try {
  preferences = { ...preferencesParDefaut, ...JSON.parse(localStorage.getItem('chat-preferences') || '{}') };
} catch { /* préférences locales indisponibles */ }

function appliquerPreferences() {
  document.documentElement.classList.toggle('reduce-animation', preferences.animationsReduites);
  document.documentElement.classList.toggle('compact-density', preferences.densiteCompacte);
  document.getElementById('app').classList.toggle('sidebar-fermee', preferences.sidebarVisible === false);
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
function creerInterrupteur(cle, titre, description) {
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = Boolean(preferences[cle]);
  check.addEventListener('change', () => enregistrerPreference(cle, check.checked));
  return creerLigneOption(titre, description, check);
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
        creerInterrupteur('executionAuto', 'Exécution automatique des commandes', 'Les blocs athena-exec partent seuls sur l’agent local (127.0.0.1:3020) — sans modale « Exécuter sur ce PC ? ». Décocher pour reprendre la confirmation manuelle.'),
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  const s = echapperHtml(texte);
  const morceaux = s.split(/(`+[^`]+`+)/g); // préserve les segments `code`
  return morceaux.map((morceau) => {
    if (/^`+[^`]+`+$/.test(morceau)) {
      return '<code>' + morceau.replace(/^`+/, '').replace(/`+$/, '') + '</code>';
    }
    let t = substituerEmojisStatut(morceau);
    // liens [texte](https://…) — http(s) uniquement, jamais de javascript:
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, texte2, url) =>
      '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + texte2 + '</a>');
    // URLs nues -> liens (le modèle sort rarement du [texte](url))
    t = t.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (_m, avant, url) =>
      avant + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>');
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
    executer.addEventListener('click', () => lancerCommandeLocale(code, executer, codeEl));
    pre.appendChild(executer);
  }
  return pre;
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
  const echec = (raison) => {
    const d = { commande: brut, ok: false, stderr: raison, code: null, duree_ms: null };
    zone().textContent = raison;
    zone().className = 'exec-sortie err';
    ajouterTraceActivite(codeEl, d);
    memoriserTraceActivite(brut, d, convoId);
    return null;
  };
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
        return echec((dj && dj.erreur) || ('Erreur agent (' + probe.status + ')'));
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
    const r = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commande: brut, confirme: true }),
    });
    const d = await r.json().catch(() => ({}));
    if (d && d.motif) return echec('Bloqué : ' + d.motif);
    if (!r.ok || d.erreur) {
      return echec((d && d.erreur) || ('HTTP ' + r.status));
    }
    // v-next : compte-rendu repliable (commande + code + durée + sortie)
    // plutôt qu'un dump de texte brut — voir creerBlocTraceCommande.
    const ancienneZone = codeEl.closest('pre')?.querySelector('.exec-sortie');
    if (ancienneZone) ancienneZone.remove();
    ajouterTraceActivite(codeEl, d);
    memoriserTraceActivite(brut, d, convoId);
    if (auto) {
      const p = codeEl.closest('pre');
      if (p) p.dataset.execAuto = '1';
    }
    return d;
  } catch (e) {
    return echec(String((e && e.message) || e).slice(0, 400));
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Exécuter';
  }
}

/* Exécution automatique (préférence executionAuto, ON par défaut) :
   les blocs ```athena-exec de la réponse fraîche partent seuls sur
   l'agent local, dans l'ordre, sans modale. Appelé UNIQUEMENT après un
   rendu neuf (genererReponse) : recharger ou rouvrir une conversation
   ne ré-exécute JAMAIS rien. */
function autoExecBlocs(bulleEl) {
  const blocs = bulleEl ? [...bulleEl.querySelectorAll('.exec-bloc')] : [];
  if (!blocs.length) return;
  (async () => {
    for (const pre of blocs) {
      const codeEl = pre.querySelector('code');
      const bouton = pre.querySelector('.code-exec');
      if (!codeEl || !bouton || pre.dataset.execAuto === '1') continue;
      /* eslint-disable-next-line no-await-in-loop — séquentiel volontaire */
      await lancerCommandeLocale(codeEl.textContent, bouton, codeEl, { auto: true });
    }
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
    const ouverture = /^\s*```\s*(\S*)\s*$/.exec(ligne);
    if (ouverture) {
      viderParagraphe();
      const langage = ouverture[1] || '';
      const corps = [];
      i++;
      while (i < lignes.length && !/^\s*```\s*$/.test(lignes[i])) { corps.push(lignes[i]); i++; }
      i++; // sauter le ``` de fermeture (ou dépasser la fin)
      fragment.appendChild(creerBlocCode(langage, corps.join('\n')));
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
    const puce = /^\s*[-*•]\s+(.*)$/.exec(ligne);
    if (puce) {
      viderParagraphe();
      const ul = document.createElement('ul');
      while (i < lignes.length) {
        const m = /^\s*[-*•]\s+(.*)$/.exec(lignes[i]);
        if (!m) break;
        const li = document.createElement('li');
        li.innerHTML = markdownInline(m[1]);
        ul.appendChild(li);
        i++;
      }
      fragment.appendChild(ul);
      continue;
    }
    const num = /^\s*(\d+)[.)]\s+(.*)$/.exec(ligne);
    if (num) {
      viderParagraphe();
      const ol = document.createElement('ol');
      while (i < lignes.length) {
        const m = /^\s*(\d+)[.)]\s+(.*)$/.exec(lignes[i]);
        if (!m) break;
        const li = document.createElement('li');
        li.innerHTML = markdownInline(m[2]);
        ol.appendChild(li);
        i++;
      }
      fragment.appendChild(ol);
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
      cite.innerHTML = markdownInline(contenu.join('\n'));
      fragment.appendChild(cite);
      continue;
    }
    paragraphe.push(ligne);
    i++;
  }
  viderParagraphe();
  return fragment;
}

/* Retire les étiquettes « Résultat : » / « Réponse : » puis rend le Markdown.
   (v9.4 : retourne un fragment DOM riche ; les bulles utilisateur continuent
   d'utiliser du texte brut — un message tapé n'est pas du Markdown.) */
function formater(texte) {
  const sansEtiquette = String(texte || '')
    .replace(/(^|\n)\s*Résultat\s*:?\s*/g, '$1')
    .replace(/(^|\n)\s*Réponse\s*:?\s*/g, '$1')
    .replace(/\s+$/, '');
  return markdownVersFragment(sansEtiquette);
}

/* ---------- v7.1 : panneau « raisonnement en direct » (canal de progression) ----------
   Rendu type « interfaces d'IA classiques » : en direct le panneau est
   déplié (spinner + dernière étape), puis il SE REPLIE à la réponse avec
   « Raisonnement · N étapes · Xs » — un clic pour revoir le détail.
   Les étapes sont une frise (point + trait) plutôt qu'une liste à puces. */
function texteEtape(et) {
  /* le pipeline préfixe parfois « ⚠ » : gardé pour la classe .doute,
     retiré du texte affiché (marque visuelle gérée par le style). */
  return String((et && et.message) || '').replace(/^\s*⚠\s*/, '');
}
function estEtapeDoute(et) {
  return !!(et && (String(et.message || '').startsWith('⚠') || et.etape === 'erreur'));
}
function construireListeEtapes(etapes) {
  const ol = document.createElement('ol');
  for (const et of etapes) {
    const li = document.createElement('li');
    if (estEtapeDoute(et)) li.className = 'doute';
    const m = document.createElement('span');
    m.textContent = texteEtape(et);
    li.appendChild(m);
    ol.appendChild(li);
  }
  return ol;
}
function detailsRaisonnementDepuisEtapes(etapes) {
  const det = document.createElement('details');
  det.className = 'raisonnement';
  const sum = document.createElement('summary');
  const titre = document.createElement('span');
  titre.textContent = 'Raisonnement · ' + etapes.length + ' étape' + (etapes.length > 1 ? 's' : '');
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.appendChild(icoSvg('chevron'));
  sum.appendChild(titre);
  sum.appendChild(chev);
  det.appendChild(sum);
  det.appendChild(construireListeEtapes(etapes));
  return det;
}
function creerPanneauRaisonnement(conteneur, gardeVue = null) {
  const det = document.createElement('details');
  det.className = 'raisonnement vivant';
  det.open = true;
  const sum = document.createElement('summary');
  /* v7.1.1 : le TITRE est le 1er span (finaliser() le retrouve via :first-child) —
     avant, il n'existait pas et le titre écrasait le chevron */
  const titre = document.createElement('span');
  titre.textContent = 'Raisonnement';
  const spin = document.createElement('span');
  spin.className = 'think';
  spin.textContent = 'réfléchit…';
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
  const ol = document.createElement('ol');
  det.appendChild(sum);
  det.appendChild(ol);
  conteneur.appendChild(det);
  const etapes = [];
  const t0 = performance.now();
  /* v7.2.2 : compteur de temps VIVANT — pendant une génération de 60 s+ le
     résumé restait figé sur « réfléchit… » (impresson de gel/bug). Le
     compteur s'auto-nettoie si le panneau est retiré du DOM (arrêt). */
  const minuteur = setInterval(() => {
    if (!det.isConnected) { clearInterval(minuteur); return; }
    spin.textContent = 'réfléchit… ' + Math.floor((performance.now() - t0) / 1000) + ' s';
  }, 1000);
  function ajouter(ev) {
    if (!ev || !ev.etape) return;
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    /* la collecte a LIEU MÊME si la vue a changé (le raisonnement doit être
       persisté avec la réponse) ; seule la mise en forme DOM est suspendue
       — v20260922j (bug 3) : jamais de scroll ni d'écriture dans une vue
       qui n'est plus celle de la génération. */
    etapes.push({ etape: ev.etape, message: ev.message });
    if (gardeVue && !gardeVue()) return;
    const li = document.createElement('li');
    if (estEtapeDoute(ev)) li.className = 'doute';
    const t = document.createElement('span');
    t.className = 'etape-t';
    t.textContent = '+' + dt + ' s';
    const m = document.createElement('span');
    m.textContent = texteEtape(ev);
    li.appendChild(m);
    li.appendChild(t);
    ol.appendChild(li);
    while (ol.children.length > 40) ol.removeChild(ol.firstChild);
    dernier.textContent = texteEtape(ev).length > 72 ? texteEtape(ev).slice(0, 72) + '…' : texteEtape(ev);
    if (preferences.defilementAuto) msgsEl.scrollTop = msgsEl.scrollHeight;
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
    let titreAct = sum.querySelector('span:first-child');
    if (titreAct) titreAct.textContent = 'Raisonnement · ' + etapes.length + ' étape' + (etapes.length > 1 ? 's' : '') + ' · ' + secondes + ' s';
  }
  return { el: det, ajouter, finaliser, etapes };
}

/* ---------- v7.4.1 : fenêtre d'historique envoyée à l'API ---------- */
/* L'API n'accepte que 40 messages / 8 000 caractères par message. On coupe
   CÔTÉ CLIENT (les plus anciens tombent, une ouverture system éventuelle est
   conservée, les contenus trop longs sont réduits) pour que la conversation
   AFFICHÉE reste complète dans localStorage sans jamais déclencher
   « Messages invalides » après ~20 échanges. */
const FENETRE_API = 30;
const MAX_CONTENU_API = 8000;
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
  const tete = propres[0].role === 'system' ? [propres[0]] : [];
  return tete.concat(propres.slice(-(FENETRE_API - tete.length)));
}

/* ---------- Sonde de santé rapide (v9.4 : utilisée entre les réessais) ---------- */
async function etatService() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('/api/chat', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { up: false, pret: false };
    const d = await r.json();
    return { up: true, pret: Boolean(d.modele_charge) };
  } catch { return { up: false, pret: false }; }
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
      await new Promise((res) => setTimeout(res, 8000));
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
        return { ok: true, reponse: d.reponse || '(réponse vide)', outil: d.outil || null, correction: Boolean(d.correction), verification: d.verification || null, rag: d.rag || null, tache: d.tache || null, raisonnement: d.raisonnement || null };
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
async function appelerApi(historique, signal = null, surProgression = null, attachments = []) {
  let aRecuEvenement = false;
  try {
    const r = await fetch(endpointChat(attachments), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: historique, outils: preferences.outilsWeb !== false, stream: true,
        conversation_id: idConversation,
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
        return { ok: true, reponse: final.reponse || '(réponse vide)', outil: final.outil || null, correction: Boolean(final.correction), verification: final.verification || null, rag: final.rag || null, tache: final.tache || null, conversation_id: final.conversation_id || null, raisonnement: final.raisonnement || null };
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
      return { ok: true, reponse: d.reponse || '(réponse vide)', outil: d.outil || null, correction: Boolean(d.correction), verification: d.verification || null, rag: d.rag || null, tache: d.tache || null, raisonnement: d.raisonnement || null };
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
    ajouter('volume', 'Lire le message', (event) => {
      const bouton = event.currentTarget;
      if (!('speechSynthesis' in window)) {
        notifier('La lecture vocale n’est pas disponible dans ce navigateur.');
        return;
      }
      window.speechSynthesis.cancel();
      const lecture = new SpeechSynthesisUtterance(contenu);
      lecture.lang = 'fr-FR';
      bouton.classList.add('actif');
      lecture.onend = () => bouton.classList.remove('actif');
      window.speechSynthesis.speak(lecture);
    });
    const like = ajouter('thumbUp', 'Réponse utile', () => like.classList.toggle('actif'));
    ajouter('thumbDown', 'Réponse à améliorer', () => like.classList.remove('actif'));
    ajouter('refresh', 'Régénérer la réponse', () => regenererDerniereReponse());
  }
  return actions;
}

/* ---------- Rendu des messages ---------- */
function bulle(role, contenu, outil, meta) {
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
    const ligne = document.createElement('div');
    ligne.className = 'fichier-joint';
    ligne.textContent = 'Fichier' + (meta.attachments.length > 1 ? 's' : '') + ' analysé'
      + (meta.attachments.length > 1 ? 's' : '') + ' : '
      + meta.attachments.map((a) => a.name).join(', ');
    b.appendChild(ligne);
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
      b.insertBefore(detailsRaisonnementDepuisEtapes(meta.raisonnement), b.firstChild);
    }
  }
  row.appendChild(b);
  row.appendChild(actionMessage(contenu, role));
  msgsEl.appendChild(row);
  return b;
}
function exemplesInitiaux() {}

/* ---------- Envoi, arrêt, historique de saisie ---------- */
let controleurEnCours = null;
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
  /* les attachments vivent sur le message (petit : file_id + nom) —
     « Régénérer » les renvoie à l'identique, le re-rendu les affiche */
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
  await genererReponse(convo);
}

/* v8.6 : fin d'envoyer() extraite telle quelle en fonction partagée —
   « Régénérer » rejoue EXACTEMENT le même pipeline (panneau de raisonnement,
   annulation, badges, persistance). Préconditions : occupe === true,
   historique de convo déjà en place, bulle utilisateur déjà affichée. */
async function genererReponse(convo) {
  /* v20260922j (bug 3) : la réponse ne doit JAMAIS être injectée dans la vue
     affichée si l'utilisateur a changé de conversation ou ouvert une vue
     (Paramètres/Projets/Compte) pendant la génération. La persistance
     (convo.messages) reste correcte ; seule la mise en forme DOM est
     conditionnée à vueOuverte(), et un toast sobre propose « Ouvrir ». */
  const vueOuverte = () => idConversation === convo.id && !msgsEl.querySelector('.workspace-view');
  const think = bulle('assistant', '');
  /* v7.1 : panneau « raisonnement en direct » (canal de progression NDJSON) */
  const panneau = preferences.raisonnementVisible !== false
    ? creerPanneauRaisonnement(think, vueOuverte) : null;
  if (!panneau) think.replaceChildren();
  if (vueOuverte() && preferences.defilementAuto) msgsEl.scrollTop = msgsEl.scrollHeight;
  controleurEnCours = new AbortController();
  let r = null;
  /* v9.5 : les fichiers joints au DERNIER message utilisateur (s'il y en a)
     accompagnent cet appel — « Régénérer » les renvoie donc à l'identique. */
  const dernierUser = [...convo.messages].reverse().find((m) => m.role === 'user');
  /* v20260926a : le contenu TEXTUEL lu à l'ajout (mémoire de session) est
     ajouté ici, au moment de l'appel — les conversations ne stockent jamais
     que {file_id,name}. */
  const attachesTour = enrichirPieces((dernierUser && dernierUser.attachments) || []);
  try {
    r = await appelerApi(preparerHistorique(convo.messages), controleurEnCours.signal,
      panneau ? (ev) => panneau.ajouter(ev) : null, attachesTour);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      /* v20260922j (bug 3) : pas de bulle « interrompue » dans une autre vue */
      if (vueOuverte()) {
        /* v20260922m (F3) : garde de retrait — la rangée peut avoir été
           détachée entre-temps (changement de vue/conversation). */
        const rangeePensee = think.closest ? think.closest('.row') : null;
        if (rangeePensee) rangeePensee.remove();
        bulle('assistant', 'Génération interrompue.');
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
  /* v7.1.1 : si le panneau vivant n'a reçu AUCUN événement (repli JSON,
     flux coupé avant la 1re étape) mais que la réponse finale porte des
     étapes, on les utilise quand même */
  const etapesRaisonnement = (panneau && panneau.etapes.length) ? panneau.etapes.slice()
    : (r && r.raisonnement) || [];
  try {
    if (panneau) panneau.finaliser();
    /* v20260922m (F3) : si l'utilisateur a changé de conversation ou ouvert
       une vue pendant le stream, msgsEl.replaceChildren() a DÉTACHÉ la bulle
       « réfléchit… » — think.parentElement === null. L'ancien code exécutait
       think.parentElement.remove() sans garde → TypeError → occupe coincé
       (génération « fantôme »). Garde + retrait via closest('.row'). */
    const rangeePensee = think.closest ? think.closest('.row') : null;
    if (rangeePensee) rangeePensee.remove();
    if (r && r.ok) {
      /* persistance TOUJOURS (la donnée va dans la bonne conversation) */
      convo.messages.push({ role: 'assistant', content: r.reponse, outil: r.outil || null, verification: r.verification || null, rag: r.rag || null, raisonnement: etapesRaisonnement.length ? etapesRaisonnement : null });
      convo.maj = Date.now();
      rendreConversations();
      sauverConversations();
      if (vueOuverte()) {
        const bAssist = bulle('assistant', r.reponse, r.outil, { verification: r.verification, rag: r.rag });
        /* v7.1 : le panneau survit à la réponse (replié, au-dessus du texte).
           v7.1.1 : inséré DANS la bulle (comme le rejeu) — avant, inséré comme
           frère de la bulle dans le .row flexbox -> panneau et réponse côte à
           côte, écrasés. */
        if (etapesRaisonnement.length) {
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
          bAssist.appendChild(versEntrainement);
        }
        /* v20260926a : exécution AUTOMATIQUE des blocs ```athena-exec
           (préférence executionAuto, ON par défaut) — la commande part
           seule sur l'agent local 127.0.0.1:3020, sans modale : c'est le
           modèle qui « appuie ». Chemin emprunté UNIQUEMENT sur une
           réponse fraîche : rejeu, rechargement et réouverture d'une
           conversation ne ré-exécutent rien. */
        if (preferences.executionAuto !== false) autoExecBlocs(bAssist);
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
/* v9.4 — limite de saisie (audit : aucune borne) : 4 000 caractères, côté
   client (la borne serveur est 8 000 par message avec pièces jointes). Le
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
  saisieEl.style.height = '40px';
  saisieEl.style.overflowY = 'hidden';
  if (saisieMirrorEl) saisieMirrorEl.scrollTop = 0;
}
const MAX_SAISIE = 4000;
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
ouvrirProjetsEl.addEventListener('click', () => afficherProjets());
ouvrirParametresEl.addEventListener('click', () => afficherParametres());
navProjetsEl?.addEventListener('click', () => afficherProjets());
navArtefactsEl?.addEventListener('click', () => afficherVue('Artefacts', 'Les artefacts générés apparaîtront ici.'));
navCodeEl?.addEventListener('click', () => afficherVue('Code', 'Les extraits et commandes exécutables apparaîtront ici.'));
navPersonnaliserEl?.addEventListener('click', () => afficherParametres());
$('telecharger-conversations')?.addEventListener('click', () => exporterToutesConversations());
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
  enregistrerPreference('sidebarVisible', preferences.sidebarVisible === false);
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
  if (!regenererPossible()) return;
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
   - « auto » = cascade par défaut (gratuit → zai) — jamais un chemin parallèle ;
   - item down → grisé + title neutre (aucune erreur HTTP, N4) ;
   - si le modèle choisi échoue, le moteur sert la cascade et lève un toast
     discret (« repli sur le modèle auto ») via les chemins d'appel ;
   - si aucun modèle local n'est détecté, la section Local n'est pas rendue ;
   - ↻ = rafraîchissement manuel (re-catalogue cloud + re-scan serveurs locaux
     Ollama / LM Studio / llama.cpp côté pont). */
const CLE_MODELE = 'athena_selected_model';
let modeleChoisi = null;
let hudCharge = false;

try {
  const brut = JSON.parse(localStorage.getItem(CLE_MODELE) || 'null');
  if (brut && typeof brut.id === 'string' && brut.id !== 'auto'
      && /^[A-Za-z0-9._:/\-]+$/.test(brut.id) && brut.id.length <= 120
      && typeof brut.name === 'string') {
    modeleChoisi = { id: brut.id, name: brut.name.slice(0, 80) };
  }
} catch { /* stockage optionnel — « auto » par défaut */ }

function majBadgeModele() {
  const el = document.getElementById('modele-actif-nom');
  if (el) el.textContent = modeleChoisi ? modeleChoisi.name : 'auto';
  if (modelePiedEl) modelePiedEl.textContent = modeleChoisi ? modeleChoisi.name : 'auto';
  const bouton = document.getElementById('btn-modele');
  if (bouton) {
    bouton.title = modeleChoisi
      ? `Modèle actif : ${modeleChoisi.name} — clic pour changer`
      : 'Modèle de langue — auto = cascade (gratuit → zai)';
  }
}

function fermerHud() {
  const panneau = document.getElementById('hud-modeles');
  const bouton = document.getElementById('btn-modele');
  if (panneau && !panneau.hidden) {
    panneau.hidden = true;
    if (bouton) bouton.setAttribute('aria-expanded', 'false');
  }
  fermerHudEffort();
}

function itemModeleHud(m, selectionCourante) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'hud-item' + (m.id === selectionCourante ? ' actif' : '') + (m.up ? '' : ' down');
  if (!m.up) item.title = 'Momentanément indisponible — la cascade couvrira ce modèle.';
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
      modeleChoisi = { id: m.id, name: m.name || m.id };
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
  const selectionCourante = modeleChoisi ? modeleChoisi.id : 'auto';

  const titreActif = document.createElement('div');
  titreActif.className = 'hud-section-titre';
  titreActif.textContent = 'Actif';
  panneau.appendChild(titreActif);
  panneau.appendChild(itemModeleHud({ id: 'auto', name: 'auto (cascade)', provider: 'gratuit → zai → pools', up: true, local: false, active: false }, selectionCourante));

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
  note.textContent = 'Si le modèle choisi échoue : repli auto.';
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

function majBadgeEffort() {
  const el = document.getElementById('effort-actif-nom');
  if (el) el.textContent = effortChoisi;
  const bouton = document.getElementById('btn-effort');
  if (bouton) {
    const courant = EFFORTS.find((e) => e.v === effortChoisi);
    bouton.title = `Effort de raisonnement : ${effortChoisi} — ${courant ? courant.aide : ''} (clic pour changer)`;
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
