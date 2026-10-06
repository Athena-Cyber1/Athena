#!/usr/bin/env node
/**
 * Athéna local-agent — exécution de commandes sur le PC (localhost only).
 *
 * Port  : 3020 (127.0.0.1 uniquement)
 * Rôle  : pont entre la Pages (navigateur) et le shell du poste.
 *         Le navigateur ne peut JAMAIS lancer une commande tout seul —
 *         il faut un process local de confiance.
 *
 * Sécurité (obligatoire) :
 *  - bind 127.0.0.1 (jamais 0.0.0.0)
 *  - CORS restreint (Pages Athéna + localhost)
 *  - déni de motifs dangereux (rm -rf, format, del /s, etc.)
 *  - confirmation requise sauf mode --auto (dev)
 *  - timeout + capture stdout/stderr bornée
 *  - journal local des exécutions
 *  - écriture /write : dossiers système interdits, 2 Mo max, écrasement
 *    refusé sans ecraser:true (sauf --auto), sortie terminal en direct (flux)
 *
 * Usage :
 *   node index.js
 *   node index.js --auto          # pas de confirmation (dev/local only)
 *   node index.js --allow dir     # restreindre cwd (ex: C:\Users\...\Documents)
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 3020;
const HOST = '127.0.0.1';
const VERSION = '1.3.6';
const AUTO = process.argv.includes('--auto');
const TIMEOUT_MS = 60000;
const TIMEOUT_MIN_MS = 100;
const MAX_OUT = 64 * 1024;
/* v1.1 (direct) : écriture de fichiers créés par le modèle. */
const MAX_WRITE = 2 * 1024 * 1024;
/* §8.6-8 (spillover, opencode 50 Ko/2000 lignes en mémoire) : au-delà de
   MAX_OUT, la sortie COMPLÈTE (plafond SPILL_MAX) part dans un fichier à
   rétention 7 jours et le chemin est ajouté à la sortie tronquée — le modèle
   lit la trace ET garde le droit au détail. */
const SPILL_MAX = 2 * 1024 * 1024;
const SPILL_DIR = path.join(os.tmpdir(), 'athena', 'tool-output');
/* ---- v1.3 (navigateur) : Firefox intégré piloté par le modèle ----
   Session Playwright persistante en mémoire : une seule fenêtre vivante,
   réutilisée d'une action à l'autre (sinon chaque bloc relancerait un
   navigateur = 2-3 s et aucun état conservé). */
const NAV_ACTIONS = [
  'ouvrir', 'snapshot', 'texte', 'html', 'cliquer', 'taper',
  'js', 'capture', 'attente', 'fermer',
  /* v20260926f : surface interactive. Le panneau affiche la page et la
     personne clique/défile/tape dessus — ces actions parlent en COORDONNÉES
     écran de la capture (854×600), pas en sélecteurs CSS. */
  'point', 'defiler', 'touche', 'cadre',
  /* v1.4 (barre d'URL du HUD) : la personne pilote le navigateur comme un
     navigateur — retour/suivant/recharger + survol (mouse.move SEUL, pour
     que les liens se surlignent et que les menus :hover s'ouvrent). */
  'retour', 'suivant', 'recharger', 'survol',
  /* v1.7 (vraie souris) : glisser-déposer réel — sélection de texte, poignée
     de scrollbar, déplacement d'un objet. Un clic seul ne le remplace pas :
     Playwright doit maintenir le bouton enfoncé pendant le déplacement. */
  'glisser',
];
const NAV_COORD_MAX = 20000;            // bornes des coordonnées/pas reçus
/* v1.8 (50 i/s) : la capture coûte ~18 ms à 1280×900 et ~12 ms à 854×600
   (page animée, headless) — or c'est page.screenshot qui domine TOUT le
   flux du panneau (24 ms sur les 29 ms mesurés). On descend donc le viewport
   au même RATIO (854/600 = 1,423 ≈ 1280/900) : cadrage du HUD identique,
   coordonnées toujours en repère de capture, layouts desktop conservés
   (au-dessus des breakpoints mobiles), et la marge nécessaire pour tenir
   50 i/s minimum de bout en bout.
   v1.3.6 : c'est le CLIENT qui décide, à chaque `cadre`, de la taille RÉELLE
   de la boîte qui affiche l'image (.navigateur-corps) — le viewport la suit
   donc exactement. Résultat :1 px affiché = 1 px capturé, aucune barre noire
   autour de l'image, et page.screenshot ne paie QUE ce qui est vu (le panneau
   fait ~640 px de large, pas 854). NAV_TAILLE_VUE reste le viewport du
   LANCEMENT (avant que le panneau n'ait rien envoyé). */
const NAV_TAILLE_VUE = { w: 854, h: 600 };  // viewport au lancement
let navVue = { w: NAV_TAILLE_VUE.w, h: NAV_TAILLE_VUE.h };  // viewport courant
/* Fréquence réelle des requêtes /browser (fenêtre d'1 s) : un panneau qui
   STREAMER occupe le verrou la moitié du temps — deux clients ouverts, c'est
   deux fois moins d'images pour chacun. Visible dans /sante (nav_freq). */
let navFreqN = 0;
let navFreqDebut = Date.now();
function navNoteRequete() {
  const t = Date.now();
  if (t - navFreqDebut >= 1000) { navFreqDebut = t; navFreqN = 0; }
  navFreqN++;
}
/* Images RÉELLEMENT poussées par seconde (flux P0) : nav_freq ne compte plus
   que des requêtes HTTP, ce qui doit tomber à ~0 quand tout streame. */
let navFluxN = 0, navFluxDebut = Date.now(), navFluxI = 0;
function navNoteFlux() {
  const t = Date.now();
  if (t - navFluxDebut >= 1000) { navFluxI = navFluxN; navFluxDebut = t; navFluxN = 0; }
  navFluxN++;
}
/* Plafond de pixels, CALIBRÉ par balayage (probe-fps2, deviceScaleFactor 2) :
     699 kpx -> 19 ms/image (52,6 i/s) | 794 kpx -> 20 ms (50,0) | 1,0 Mpx -> 24 ms (41,7 ECHEC)
   Le plafond est donc 700 kpx : 52,6 i/s mesurés (5 ms de marge), et ×1,42 du
   CSS sur un écran dpr 2 au lieu de ×1 (c'est le « zoomé et pixélisé » corrigé).
   Coût agent mesuré = 11,7 ms + 0,0059 ms/kpx ; c'est le DÉCODAGE + rendu côté
   HUD (16,7 ns/px) qui devient le plafond au-delà de ~700 kpx.
   On garde le RATIO de la boîte : l'image remplit exactement la boîte, sans
   barre noire. Le client envoie la taille en pixels ÉCRAN (boîte × dpr). */
const NAV_VUE_MAX_PX = (() => {
  const v = Number(process.env.ATHENA_VUE_MAX_PX);
  return Number.isFinite(v) && v >= 100000 ? Math.round(v) : 700000;
})();

/* Une capture JPEG, quelle que soit la voie (action `cadre` = image par image,
   ou FLUX poussé = P0). Une seule source de vérité pour le coût :
   11,7 ms + 0,0059 ms/kpx mesuré, dont le redimensionnement (30 ms de
   reflow) n'est payé QUE quand la taille demandée a changé. */
/* P5 : un AUTRE groupe (abonné actif) demande-t-il une image plus grande que
   `aire` ? Si oui, on garde le grand viewport — voir navCapturer(). */
function fluxAutrePlusGrand(aire) {
  for (const g of fluxGroupes.values()) {
    if (g.abonnes.size && g.taille.w * g.taille.h > aire) return true;
  }
  return false;
}

async function navCapturer(page, voulue) {
  if (voulue && (voulue.w !== navVue.w || voulue.h !== navVue.h)) {
    /* P5 : deux abonnés de tailles différentes alternaient le resize à CHAQUE
       image — setViewportSize + relayout complet à chaque capture (~30 ms en
       plus) : le flux tombait à 6 i/s dès qu'un second panneau s'abonnait.
       On GRANDIT tout de suite (une image plus grande reste juste, le client
       lit naturalWidth/naturalHeight) et on ne RÉTRÉCIT que si personne
       d'autre n'attend plus grand — plus aucun aller-retour de taille. */
    const voulueA = voulue.w * voulue.h;
    const reduire = voulueA < navVue.w * navVue.h;
    if (!reduire || !fluxAutrePlusGrand(voulueA)) {
      try {
        await navBorne(page.setViewportSize({ width: voulue.w, height: voulue.h }), 5000);
        navVue = voulue;
        await navBorne(page.waitForTimeout(30), 2000);
      } catch (_) { /* on garde l'ancien viewport : la capture continue quand même */ }
    }
  }
  const t0 = Date.now();
  const buf = await navBorne(
    page.screenshot({ type: 'jpeg', quality: 60, fullPage: false }),
    NAV_TIMEOUT,
  );
  return { buf: buf, ms: Date.now() - t0 };
}

/* ==================== P0 : FLUX D'IMAGES POUSSÉ ====================
   Avant : le panneau lançait une requête `cadre` toutes les ~8 ms —
   par image : en-têtes HTTP + JSON + base64 (+33 %) + décodage JS, deux
   images en vol (donc une image rendue avec jusqu'à 2× le temps de service),
   et UN flux par client (deux panneaux = deux captures = ~28 i/s chacun).
   Maintenant : L'AGENT capture sur SA cadence et PUBLIE les mêmes octets à
   tous les abonnés d'une taille donnée. Format de trame :
     [type:1][largeur:2][hauteur:2][longueur:4][charge]   (big-endian)
     type 1 = JPEG, type 2 = métadonnées UTF-8 {navigateur,url,taille}
   Gains mesurés attendus : −4 à 6 ms/image (JSON+base64+aller-retour),
   cadence pilotée serveur (plus de creux de rythme client), zéro chaîne
   base64 (moins de GC), et N panneaux de MÊME taille = UNE capture. */
const FLUX_IMAGE = 1;
const FLUX_META = 2;
const fluxGroupes = new Map();   // "WxH" -> { taille, abonnes, tourne, meta }
let fluxAbonnesN = 0;

function fluxCle(t) { return t.w + 'x' + t.h; }

function fluxEntete(type, w, h, n) {
  const e = Buffer.alloc(9);
  e.writeUInt8(type, 0);
  e.writeUInt16BE(w & 65535, 1);
  e.writeUInt16BE(h & 65535, 3);
  e.writeUInt32BE(n >>> 0, 5);
  return e;
}

function fluxPublier(groupe, type, w, h, charge) {
  for (const abo of groupe.abonnes) fluxEcrire(abo, type, w, h, charge);
}

function fluxEcrire(abo, type, w, h, charge) {
  const res = abo.res;
  if (!res || res.writableEnded || res.destroyed) return;
  /* v1.3.6 : RETARD DE LECTURE. write() renvoie false quand le tampon du
     socket est plein : sans écouter `drain` on empile les trames en mémoire
     d'un client lent (onglet en arrière-plan) jusqu'à faire monter le RSS.
       On marque la trame comme sautable : tant que le lecteur n'a pas repris,
     on n'écrit PLUS rien (ni en-tête ni charge), donc jamais de trame à
     moitié écrite. Le flux reprend tout seul au prochain drain. */
  try {
    if (abo.sature) return;
    /* On écrit TOUJOURS l'en-tête ET la charge ensemble : un en-tête livré
       sans sa charge désynchronise le parseur côté client (il lirait les
       trames suivantes comme la charge de celle-ci). Le retard se reporte
       donc entièrement sur la TRAME SUIVANTE. */
    const enteteOk = res.write(fluxEntete(type, w, h, charge.length));
    const chargeOk = res.write(charge);
    if (!enteteOk || !chargeOk) abo.sature = true;
  } catch (_) { /* socket fermée : retirée par l'événement close */ }
}

/* Verrou BORNÉ : le flux ne patiente jamais derrière une pile d'images. Si le
   verrou n'est pas libre en `attente` ms, on rend la main tout de suite —
   c'est ce qui donne la priorité aux actions du modèle (P1). */
async function fluxVerrou(attente) {
  const precedent = navVerrou;
  let liberer = null;
  navVerrou = new Promise((r) => { liberer = r; });
  let ok = true;
  try { await navBorne(precedent, attente); } catch (_) { ok = false; }
  if (!ok) { liberer(); return null; }   // ne JAMAIS laisser la chaîne bloquée
  return liberer;
}

const fluxDormir = (ms) => new Promise((r) => setTimeout(r, ms));
/* Diagnostics : QUOI fait perdre les images (fenêtre de vie du compteur). */
const fluxTours = { image: 0, verrou: 0, action: 0, pasSession: 0, erreur: 0, tours: 0, pris: 0 };

/* P5 : UNE SEULE boucle sert TOUS les groupes. Avant, chaque taille = sa
   propre boucle = sa propre capture : deux panneaux ouverts se séquençaient
   sur le verrou (60 → 29 i/s POUR CHACUN) et alternaient les resizes du
   viewport à chaque image. Maintenant : une capture, publiée à tous les
   abonnés — N panneaux coûtent UNE capture, quelle que soit leur taille. */
let fluxTourneGlobal = false;
let fluxMetaDernier = 0;

function fluxTailleMax(cibles) {
  let max = null;
  for (const g of cibles) if (!max || g.taille.w * g.taille.h > max.w * max.h) max = g.taille;
  return max;
}

async function fluxBoucler(groupe) {
  if (fluxTourneGlobal) return;           // une boucle tourne déjà pour tout le monde
  fluxTourneGlobal = true;
  if (groupe) groupe.tourne = true;
  try {
    for (;;) {
      const cibles = [];
      for (const [cle, g] of fluxGroupes) {
        if (g.abonnes.size) { cibles.push(g); g.tourne = true; }
        else { g.tourne = false; fluxGroupes.delete(cle); }
      }
      if (!cibles.length) break;
      const t0 = Date.now();
      try {
        if (navEtat() !== 'pret' || !nav.page) {
          fluxTours.pasSession++;
          await fluxDormir(50);          // pas de session : rien à publier
        } else if (navActionEnCours) {
          fluxTours.action++;
          await fluxDormir(8);           // P1 : une action tourne, on n'empile pas
        } else {
          const liberer = await fluxVerrou(25);
          if (!liberer) {
            fluxTours.verrou++;
            await fluxDormir(6);         // verrou pris : on réessaie au prochain tour
          } else {
            try {
              const c = await navCapturer(nav.page, fluxTailleMax(cibles));
              for (const g of cibles) fluxPublier(g, FLUX_IMAGE, navVue.w, navVue.h, c.buf);
              navNoteFlux();
              /* MÊMES diagnostics que la voie `cadre` : coût réel de l'image
                 (nav_duree_ms = tour complet, nav_capture_ms = page.screenshot)
                 lus dans /sante pendant le streaming. */
              navNoteDuree(Date.now() - t0, c.ms);
              fluxTours.image++;
              /* Métadonnées : l'URL coûte un aller-retour Playwright (~3 ms) —
                 on ne la recalcule que 4 fois/s, une navigation reste vue en
                 <250 ms (et l'action pose déjà l'URL elle-même côté client). */
              if (Date.now() - fluxMetaDernier >= 250) {
                fluxMetaDernier = Date.now();
                const meta = JSON.stringify({ navigateur: navEtat(), url: navUrlCourante(), vue: navVue.w + 'x' + navVue.h });
                for (const g of cibles) {
                  if (meta !== g.meta) {
                    g.meta = meta;
                    fluxPublier(g, FLUX_META, 0, 0, Buffer.from(meta, 'utf8'));
                  }
                }
              }
            } finally { liberer(); }
          }
        }
      } catch (e) { fluxTours.erreur++; fluxTours.err = String((e && e.message) || e); await fluxDormir(30); }
      const pris = Date.now() - t0;
      fluxTours.pris += pris;
      fluxTours.tours++;
      if (pris < 2) await fluxDormir(2 - pris);   // jamais de boucle à vide
    }
  } finally {
    fluxTourneGlobal = false;
    for (const g of fluxGroupes.values()) g.tourne = false;
    if (!fluxGroupes.size) { navFluxI = 0; navFluxN = 0; }
    /* Abonné arrivé pendant la sortie : on repart (sinon son flux reste muet). */
    for (const g of fluxGroupes.values()) {
      if (g.abonnes.size) { fluxBoucler(g).catch(() => {}); break; }
    }
  }
}

/* Coût réel d'une image (fenêtre d'1 s) : mesuré SANS ajouter de requête —
   un outil de mesure qui double le trafic fausse le résultat. On regarde
   /sante pendant qu'UN SEUL panneau streame. */
let navDureeSomme = 0, navDureeN = 0, navDureeDebut = Date.now();
let navDureeMoy = 0, navCaptureMoy = 0;
function navNoteDuree(ms, capture) {
  const t = Date.now();
  if (t - navDureeDebut >= 1000) {
    navDureeMoy = navDureeN ? Math.round(navDureeSomme / navDureeN) : 0;
    navCaptureMoy = navDureeN ? Math.round(navCaptureSomme / navDureeN) : 0;
    navDureeDebut = t; navDureeSomme = 0; navDureeN = 0; navCaptureSomme = 0;
  }
  navDureeSomme += ms;
  if (typeof capture === 'number') navCaptureSomme += capture;
  navDureeN++;
}
let navCaptureSomme = 0;
/* Taille demandée par le client : entière, bornée. En dehors des bornes on
   ignore la demande et on garde le viewport courant (une boîte à 40 px ne
   doit pas rendre un site illisible — ni faire croire au client que si). */
function navTailleValide(t) {
  if (!t || typeof t !== 'object') return null;
  let w = Math.round(Number(t.w));
  let h = Math.round(Number(t.h));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < 240 || h < 200 || w > 4800 || h > 3200) return null;
  if (w * h > NAV_VUE_MAX_PX) {
    const k = Math.sqrt(NAV_VUE_MAX_PX / (w * h));
    w = Math.max(240, Math.round(w * k));
    h = Math.max(200, Math.round(h * k));
  }
  return { w: w, h: h };
}
const NAV_ARG_MAX = 4000;             // argument d'action (1 ligne, jamais un script)
const NAV_URL_MAX = 2048;
const NAV_TIMEOUT = 15000;            // par action (goto inclus)
const NAV_MAX_TEXTE = 40000;          // texte/html borné (même borne que stdout)
const NAV_CAPTURE_MAX = 500 * 1024;   // data-URL au-delà = chemin seul
const NAV_IDLE_MS = 10 * 60 * 1000;   // session seule : fermeture automatique
/* v1.5 : un Firefox PRÉCHAUFFÉ qui ne sert jamais est de la bougeotte en
   fond. On le laisse 60 s (le temps d'ouvrir le panneau, de lire la modale,
   de taper une adresse), puis on le referme vraiment : pas de navigateur
   qui tourne à rien. Une FOIS la session ouverte, la grâce redevient
   NAV_IDLE_MS — le modèle doit pouvoir travailler dix minutes sans choc. */
const NAV_PRECHAUFFE_MS = 60 * 1000;
const NAV_VERROU_MS = 30000;          // attente max sur le verrou (puis 409)
const NAV_ATTENTE_SEL = 8000;         // attente <sélecteur> : SPA / rendu asynchrone
const NAV_PROFIL = path.join(os.tmpdir(), 'athena-firefox-profile');
/* v1.5 (démarrage) : MESURÉ — un lancement Firefox coûte 1,9 s avec un
   profil vierge et 1,2 s avec un profil réutilisé ; l'action `ouvrir`
   complète arrive à 3,3 s au premier coup et 0,65 s ensuite. Le navigateur
   ne DOIT PAS tourner en veille (décision produit), donc on le lance
   UNIQUEMENT quand quelqu'un veut agir : ouverture du panneau, bloc
   ```athena-browser, saisie d'adresse, modale 428. Ces déclencheurs sont
   envoyés AVANT l'action elle-même, ce qui recouvre le lancement avec le
   temps de réflexion / d'affichage de la modale. */
const NAV_PRECHAUFFER = 'prechauffer';
/* Prefs Firefox de démarrage : pas de première exécution, pas de télémétrie,
   pas de vérification de navigateur par défaut — chaque chose en moins est
   un travail Firefox en moins au boot. Aucune pref ne touche à la sécurité. */
const NAV_PREFS = {
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'startup.homepage_welcome_url': '',
  'startup.homepage_welcome_url.additional': '',
  'browser.startup.page': 0,
  'browser.newtabpage.enabled': false,
  'browser.aboutConfig.showWarning': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'datareporting.healthreport.uploadEnabled': false,
  'toolkit.telemetry.enabled': false,
  'toolkit.telemetry.server': '',
  'app.update.disabledForTesting': true,
  'app.update.auto': false,
  'extensions.update.enabled': false,
  'extensions.getAddons.showPane': false,
  'network.captive-portal-service.enabled': false,
  'network.connectivity-service.enabled': false,
  'browser.safebrowsing.downloads.remote.enabled': false,
  'signon.rememberSignons': false,
};
/* Fichiers d'IDENTITÉ retirés à chaque fermeture : historique, mots de passe
   enregistrés, session. On GARDE le cache de démarrage (startupCache) —
   c'est lui qui fait passer le prochain lancement de 1,9 s à 1,2 s. */
const NAV_IDENTITE = ['places.sqlite', 'places.sqlite-wal', 'places.sqlite-shm',
  'logins.json', 'key3.db', 'key4.db',
  'sessionstore.jsonlz4', 'sessionstore-backups'];
/* Schémas refusés : ni exécution de code dans l'agent, ni pages « internes »
   (about:config, prefs) — le modèle navigue, il ne pilote pas Firefox. */
const NAV_URL_REFUS = /^(javascript|about|data|blob|view-source|resource|chrome|moz-extension):/i;
const DENY_WRITE = [
  /^[a-z]:\\windows([\\\/]|$)/i,
  /\\system32([\\\/]|$)/i,
  /\\syswow64([\\\/]|$)/i,
  /^[a-z]:\\program files([\\\/]|$)/i,
  /^[a-z]:\\programdata\\microsoft([\\\/]|$)/i,
  /^\/(etc|sys|proc|bin|sbin|usr\/bin|usr\/sbin|boot)([\/]|$)/,
];
const ALLOW_DIR = (() => {
  const i = process.argv.indexOf('--allow');
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
})();

const ORIGINS = new Set([
  'https://athena-cyber1.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3010',
  'null',
]);

const DENY = [
  /\brm\s+-rf\s+[\/~]/i,
  /\brm\s+-rf\s+\*+/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\s+\/q\s+[a-z]:/i,
  /\brd\s+\/s\s+\/q\s+[a-z]:/i,
  /\bRemove-Item\s+.*-Recurse.*-Force.*[\\\/]\s*$/i,
  /* v20260926d (kimi) : l'expression ci-dessus exigeait un slash final et ne
     matchait quasiment jamais (ex. `Remove-Item C:\Data -Recurse -Force`
     passait). Celle-ci vise la racine de lecteur, avec ou sans slash. */
  /\bRemove-Item\s+["']?[A-Z]:[\\\/]?(["']?(\s|$|;))/i,
  /\bRemove-Item\s+["']?([A-Z]:[\\\/]?|\\\\|[~\/]|\*)(["']?(\s|$|;))/i,
  /:\(\)\s*\{.*\|.*&.*\};/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwget\b.*\|\s*(ba)?sh\b/i,
  /\bInvoke-Expression\b|\bIEX\b/i,
  /\bStop-Computer\b|\bRestart-Computer\b/i,
  /\breg\s+delete\b/i,
  /\breg\s+add\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /--no-preserve-root/i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\btaskkill\b.*\/f.*\/im\s+(csrss|lsass|winlogon)/i,
  /* v1.2 (audit) : trous de contournement — tout passe par normaliser()
     (backticks/accents circonflexes d'échappement retirés) AVANT le test :
     - `-EncodedCommand`/`-enc` : le base64 rend tout motif illisible → bloqué
       d'office, ainsi que FromBase64String et les cradles web (iwr/curl|iex) ;
     - comptes et défense : net user/group, Defender, planificateur, WMI,
       rundll32/mshta, registre run-keys, compilation C# embarquée. */
  /* v1.2.1 (audit) : \b devant un tiret ne matche JAMAIS après une espace
     (transition non-mot→non-mot) — l'ancien motif laissait passer
     `-EncodedCommand`. Ancre explicite (^|espace) à la place. */
  /(?:^|\s)-(EncodedCommand|enc)\b|--encodedcommand|(?:^|\s)-e\s+[A-Za-z0-9+/=]{20,}/i,
  /\bFromBase64String\b/i,
  /\b(Invoke-WebRequest|Invoke-RestMethod|\bIWR\b|\bIRM\b)\b.*\|\s*(iex|powershell|cmd)/i,
  /\bAdd-Type\b/i,
  /\bnet\s+(user|localgroup)\b/i,
  /\b(Set|Add|Remove)-MpPreference\b/i,
  /\bschtasks\b.*\/create\b/i,
  /\bwmic\b.*(process\s+call\s+create|useraccount)/i,
  /\b(mshta|rundll32)\b/i,
  /\b(bcdedit|vssadmin)\b/i,
  /\b(cipher\s+\/w|sdelete)\b/i,
  /\\Microsoft\\Windows\\(CurrentVersion\\Run|CurrentVersion\\RunOnce)/i,
];

/* v1.2 (audit) : le journal survivait en RAM seulement — perdu à chaque
   redémarrage. Persisté en JSONL dans le dossier temporaire système
   (jamais dans le dépôt), relu au démarrage (200 dernières entrées). */
const JOURNAL_FICHIER = path.join(os.tmpdir(), 'athena-local-agent-journal.jsonl');
const JOURNAL_MAX = 200;
const journal = [];
let journalAppends = 0;
try {
  const brut = fs.readFileSync(JOURNAL_FICHIER, 'utf8').split('\n').filter(Boolean);
  for (const l of brut.slice(-JOURNAL_MAX)) {
    try { journal.push(JSON.parse(l)); } catch (_) {}
  }
  /* v1.4 : le fichier n'a JAMAIS été rogné — mesuré 558 Ko / 4668 lignes et
     il ne faisait que grossir. On le réécrit au démarrage s'il dépasse. */
  if (brut.length > JOURNAL_MAX) {
    fs.writeFileSync(JOURNAL_FICHIER, journal.map((j) => JSON.stringify(j)).join('\n') + '\n');
    console.log(`[local-agent] journal rogné : ${brut.length} → ${journal.length} entrées`);
  }
} catch (_) {}
function journaliser(entree) {
  journal.push(entree);
  if (journal.length > JOURNAL_MAX) journal.shift();
  journalAppends++;
  try {
    if (journalAppends % 50 === 0) {
      fs.writeFileSync(JOURNAL_FICHIER, journal.map((j) => JSON.stringify(j)).join('\n') + '\n');
    } else {
      fs.appendFileSync(JOURNAL_FICHIER, JSON.stringify(entree) + '\n');
    }
  } catch (e) {
    console.error(`[local-agent] journal persistant inaccessible : ${String((e && e.message) || e).slice(0, 120)}`);
  }
}

/* v1.2 (audit) : enfants actifs suivis pour l'arrêt propre (SIGINT). */
const enfantsActifs = new Set();

/* ==== v1.3 : session navigateur Firefox (Playwright) ==== */
let pw = null;
try { pw = require('playwright'); } catch (_) { pw = null; }
/* v1.5 : PREUVE que c'est bien Firefox — pas un autre moteur déguisé. Version
   réelle lue dans navigator.userAgent de la page + nom de l'exécutable,
   exposés par /sante et affichés par l'en-tête du panneau. */
let navVersion = '';
let navExec = '';
let navDemarrageMs = 0;
/* v1.5 : UN SEUL lancement à la fois. Deux launchPersistentContext sur le
   MÊME profil en parallèle = échec « profile in use » — c'est la cause
   n° 1 de « le navigateur ne redémarre plus ». Le panneau, le bloc du modèle
   et la modale 428 peuvent demander Firefox dans la même seconde : ils
   attendent TOUS la même promesse au lieu de se la disputer. */
let navLancement = null;
/* `ferme: true` au démarrage : aucun onglet n'existe encore, donc l'état
   est « inactif », pas « actif ». Un préchauffage ne crée pas de session —
   il ne fait que démarrer Firefox (nav_pret) : tant qu'aucune action n'est
   passée par navObtenirPage(), le panneau affiche « Firefox démarré », pas
   une fausse session sur une page de démarrage. */
const nav = { browser: null, page: null, ferme: true, fermePour: null, dernier: 0 };
const navOriginesValidees = new Set();  // origines confirmées par l'utilisateur
let navVerrou = Promise.resolve();   // sérialise les actions (1 page = 1 flux)
/* v1.4 : une action occupe TUJOURS la page, un `cadre` non. Tant qu'une
   action tourne, le flux d'images renvoie sa DERNIÈRE image au lieu de
   prendre le verrou — sinon le JPEG (~50 ms) s'intercale entre deux gestes
   du modèle et le rendu paraît décalé. */
let navActionEnCours = false;
let navCadreImage = null;      // dernière image de flux (renvoyée si occupé)
let navDialogue = null;        // alert()/confirm() intercepté (sinon dismiss muet)
let navTelechargement = null;  // téléchargement démarré (invisible sinon)

const NAV_OPTS = {
  headless: true,
  viewport: { width: NAV_TAILLE_VUE.w, height: NAV_TAILLE_VUE.h },
  ignoreHTTPSErrors: true,
  /* FR : sinon les sites servent la version anglaise, avec le fuseau du
     poste et le thème du système — le modèle lit alors une page qui n'est
     PAS celle que l'utilisateur connaît. */
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  colorScheme: 'light',
  acceptDownloads: true,
  firefoxUserPrefs: NAV_PREFS,
  args: [],
};

/* Le contexte peut mourir sans prévenir (crash, kill externe, fin de profile).
   Sans ce contrôle, nav.browser restait truthy, /sante disait « actif » et
   TOUTES les actions échouaient à répétition jusqu'au redémarrage de l'agent. */
function navContexteVivant(ctx) {
  if (!ctx || ctx.__athenaFerme) return false;
  try { ctx.pages(); return true; } catch (_) { return false; }
}

function navEtat() {
  if (!pw) return 'absent';
  if (nav.browser && !navContexteVivant(nav.browser)) {
    nav.browser = null; nav.page = null; navLancement = null;
  }
  if (nav.page && !nav.ferme && !nav.page.__athenaCrash) return 'pret';
  return 'inactif';
}

/* URL de la page courante (le flux l'écrit dans ses métadonnées ; `url()` de
   navAction est déclaré DANS navAction et n'existe pas ici). */
function navUrlCourante() {
  try { return nav.page && !nav.page.isClosed() ? String(nav.page.url() || '') : ''; } catch (_) { return ''; }
}

/* Firefox VIVANT déjà là (même si aucune session n'est ouverte) : le prochain
   ouvrir ne coûtera rien. C'est ce que /sante appelle nav_pret. */
function navPret() { return navContexteVivant(nav.browser); }

async function navLancerContexte() {
  const t = Date.now();
  try {
    const ctx = await pw.firefox.launchPersistentContext(NAV_PROFIL, NAV_OPTS);
    navDemarrageMs = Date.now() - t;
    return ctx;
  } catch (e1) {
    /* Verrou de profil périmé après un crash. Sans cette reconstruction,
       plus RIEN ne marche tant qu'on n'a pas tué l'agent à la main : c'est
       exactement le « il bug beaucoup » que l'on voit. */
    console.error('[local-agent] Firefox : lancement impossible ('
      + String((e1 && e1.message) || e1).slice(0, 160)
      + ') → profil réinitialisé, nouvelle tentative');
    try { await fs.promises.rm(NAV_PROFIL, { recursive: true, force: true }); } catch (_) {}
    const t2 = Date.now();
    const ctx = await pw.firefox.launchPersistentContext(NAV_PROFIL, NAV_OPTS);
    navDemarrageMs = Date.now() - t2;
    return ctx;
  }
}

function navDemarrer() {
  if (!pw) {
    return Promise.reject(new Error(
      'navigateur indisponible : Playwright non installé (npm install playwright && npx playwright install firefox)'));
  }
  if (navContexteVivant(nav.browser)) return Promise.resolve(nav.browser);
  if (!navExec) { try { navExec = path.basename(pw.firefox.executablePath()); } catch (_) {} }
  if (!navLancement) {
    navLancement = navLancerContexte().then((ctx) => {
      nav.browser = ctx;
      navEcouterContexte(ctx);
      return ctx;
    }).catch((e) => { navLancement = null; throw e; });
  }
  return navLancement;
}

/* Version RÉELLE de Firefox, lue dans la page (userAgent) — c'est la preuve
   que le modèle pilote bien un Firefox et pas un WebKit au déguisement. */
async function navLireVersion() {
  if (navVersion || !nav.page) return navVersion;
  try {
    const ua = await nav.page.evaluate(() => navigator.userAgent);
    const m = /Firefox\/([\d.]+)/.exec(String(ua || ''));
    if (m) navVersion = m[1];
  } catch (_) {}
  return navVersion;
}

async function navPageDuContexte(ctx) {
  const pages = ctx.pages().filter((p) => { try { return !p.isClosed() && !p.__athenaCrash; } catch (_) { return false; } });
  const p = pages.length ? pages[0] : await ctx.newPage();
  navEcouterPage(p);
  return p;
}

/* v1.5 : LANCEMENT SUR INTENTION. Le navigateur ne tourne JAMAIS en veille ;
   il est lancé dès qu'on SAIT qu'une action arrive — ouverture du panneau,
   bloc ```athena-browser, saisie d'adresse, modale 428 — pour recouvrir les
   ~1,9 s de démarrage avec le temps d'affichage et de réflexion. Ne marque
   PAS la session comme ouverte (l'état reste « inactif »). */
async function navPrechauffer() {
  if (!pw) {
    return {
      ok: false, erreur: 'Playwright non installé (npm install playwright && npx playwright install firefox)',
      navigateur: 'absent',
    };
  }
  const t = Date.now();
  const ctx = await navDemarrer();
  if (!nav.page) nav.page = await navPageDuContexte(ctx);
  await navLireVersion();
  nav.dernier = Date.now();
  const ms = Date.now() - t;
  console.log('[local-agent] Firefox préchauffé : ' + (navVersion || '?') + ' en ' + ms + ' ms'
    + ' (lancement ' + navDemarrageMs + ' ms, moteur ' + (navExec || '?') + ')');
  return {
    ok: true,
    message: 'Firefox ' + (navVersion || '?') + ' prêt en ' + ms + ' ms',
    moteur: 'firefox', version: navVersion || null, demarrage_ms: navDemarrageMs || null,
  };
}

async function navFermer(raison) {
  /* Un lancement peut être EN COURS (panneau ouvert pendant qu'on ferme) :
     on l'attend pour ne pas refermer un Firefox absent ni en laisser un
     fantôme derrière. */
  if (navLancement) { try { await navLancement; } catch (_) {} }
  const b = nav.browser;
  /* On ne signale « session fermée : … » QUE s'il y avait VRAIMENT une
     session. Fermer un préchauffage inutilisé (ou l'état initial) ne doit
     pas afficher un bandeau qui explique la disparition d'un onglet qui n'a
     jamais existé. */
  const avaitSession = !nav.ferme;
  nav.page = null;
  nav.browser = null;
  navLancement = null;
  nav.ferme = true;
  if (avaitSession) nav.fermePour = raison || 'fermeture';
  navCadreImage = null;
  navDialogue = null;
  navTelechargement = null;
  navVue = { w: NAV_TAILLE_VUE.w, h: NAV_TAILLE_VUE.h };
  navOriginesValidees.clear();
  if (b) {
    /* Identité oubliée AVANT la fermeture : cookies, stockage web, permissions.
       Sans ça, un « fermer » puis un « ouvrir » retrouvait l'utilisateur
       connecté sans que personne ne l'ait demandé. */
    try { await b.clearCookies(); } catch (_) {}
    try { await b.clearPermissions(); } catch (_) {}
    for (const p of b.pages()) {
      try { await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) {} }); } catch (_) {}
      try { await p.goto('about:blank', { timeout: 3000 }); } catch (_) {}
    }
    try { await b.close(); } catch (_) {}
  }
  /* Historique / mots de passe / session retirés du disque, MAIS le cache de
     démarrage est conservé : c'est lui qui fait passer le prochain lancement
     de 1,9 s à 1,2 s. Effacement best-effort (verrou Windows possible juste
     après close) — la session navigateur reste dans un dossier TEMPORAIRE
     isolé, jamais dans le Firefox réel de l'utilisateur. */
  for (const f of NAV_IDENTITE) {
    try { await fs.promises.rm(path.join(NAV_PROFIL, f), { recursive: true, force: true }); } catch (_) {}
  }
}

async function navObtenirPage() {
  /* Relance une session si l'utilisateur l'a fermée (nav.ferme), si la page
     a crashé ou si le process a redémarré — le modèle ne doit pas voir
     « aucune session » sur un simple restart. */
  nav.ferme = false;
  nav.fermePour = null;
  if (nav.page && nav.page.__athenaCrash) { nav.page = null; }
  if (nav.browser && !navContexteVivant(nav.browser)) { nav.browser = null; nav.page = null; navLancement = null; }
  /* v1.4 (fuite) : la session ne meurt PLUS parce qu'un onglet s'est fermé.
     On choisit juste un autre onglet du MÊME contexte. */
  if (nav.browser && nav.page) {
    try { if (nav.page.isClosed()) nav.page = null; } catch (_) { nav.page = null; }
  }
  let ctx = await navDemarrer();
  if (!navContexteVivant(ctx)) {
    /* Firefox est mort EN COURS de lancement : une seule relance. Une action
       ne doit jamais renvoyer « injoignable » alors qu'un redémarrage
       suffisait — c'était le bug « il ne marche plus jamais ». */
    nav.browser = null; nav.page = null; navLancement = null;
    ctx = await navDemarrer();
  }
  if (!nav.page) nav.page = await navPageDuContexte(ctx);
  if (!navVersion) navLireVersion().catch(() => {});
  nav.dernier = Date.now();
  return nav.page;
}

/* Attache un gestionnaire d'erreur UNE FOIS par page : sans lui, une page
   qui crashe au milieu d'une action laisse la promesse pendre jusqu'au
   timeout et le modèle croit à un navigateur gelé. */
function navEcouterPage(page) {
  if (page.__athenaEcoute) return;
  page.__athenaEcoute = true;
  const marquer = () => { try { page.__athenaCrash = true; } catch (_) {} };
  page.on('close', marquer);
  page.on('crash', marquer);
  /* v1.4 : sans écouteur, Playwright DISMASSE silencieusement toute boîte de
     dialogue — le modèle clique, « rien ne se passe », il recommence à
     l'aveugle. On mémorise le message : il repart dans la réponse. */
  page.on('dialog', (d) => {
    navDialogue = {
      type: String(d.type() || 'alert'),
      message: String(d.message() || '').slice(0, 300),
    };
    try { d.dismiss().catch(() => {}); } catch (_) {}
  });
  /* v1.4 : un téléchargement ne se voit nulle part en headless — on rend le
     nom + l'URL au modèle plutôt que de faire comme si le clic n'avait rien
     fait. */
  page.on('download', (dl) => {
    try {
      navTelechargement = {
        nom: String(dl.suggestedFilename() || '').slice(0, 200),
        url: String(dl.url() || '').slice(0, 300),
      };
    } catch (_) {}
  });
}

/* v1.4 : target=_blank ouvre un DEUXIÈME onglet. Sans ça, nav.page restait
   sur l'ancien, cliquer renvoyait l'URL d'avant et le modèle rebouclait. */
function navEcouterContexte(ctx) {
  if (ctx.__athenaEcoute) return;
  ctx.__athenaEcoute = true;
  /* v1.5 : si Firefox MEURT (crash, kill externe, fin de profile), le
     contexte se ferme tout seul. Sans ce marqueur, nav.browser restait
     truthy : /sante continuait à dire « actif » et chaque action échouait
     en boucle — l'agent ne se relançait JAMAIS. */
  ctx.on('close', () => {
    ctx.__athenaFerme = true;
    if (nav.browser === ctx) { nav.browser = null; nav.page = null; navLancement = null; }
    console.error('[local-agent] Firefox s’est arrêté (crash ou fin de profile) : le prochain ouvrir le relancera');
  });
  ctx.on('page', (p) => {
    try { navEcouterPage(p); } catch (_) {}
    nav.page = p;
    nav.dernier = Date.now();
    console.log('[local-agent] navigateur : nouvel onglet → ' + (p.url() || '(chargement)'));
  });
}

function navBorne(p, ms) {
  let timer = null;
  const e = new Promise((_, rej) => {
    timer = setTimeout(() => {
      const err = new Error('action navigateur dépassée (' + ms + ' ms)');
      err.code = 'NAVTMO';
      rej(err);
    }, ms);
  });
  return Promise.race([p, e]).finally(() => clearTimeout(timer));
}

/* Coupe le texte lu dans la page : borne + fin marquée (sinon le modèle
   croit que la page est terminée alors que c'est nous qui avons coupé). */
function navCouper(t, n) {
  const s = String(t == null ? '' : t);
  if (s.length <= n) return { texte: s, tronque: false };
  return { texte: s.slice(0, n) + '\n[…tronqué : ' + s.length + ' caractères au total…]', tronque: true };
}

/* Lit une liste d'entiers séparés par des virgules (« 640,320 »,
   « 10,20,-400,30 »). Renvoie null si un seul élément est invalide :
   l'appelant répond 400 au lieu d'exécuter un geste sur des coordonnées
   folles (hors capture, ou delta assez grand pour emmener la page ailleurs). */
function navCoords(arg, mini, maxi) {
  const parts = String(arg == null ? '' : arg).split(',').map((s) => s.trim());
  if (parts.length < mini || parts.length > maxi) return null;
  const n = [];
  for (const p of parts) {
    if (!/^-?\d{1,7}$/.test(p)) return null;
    const v = parseInt(p, 10);
    if (!Number.isFinite(v)) return null;
    n.push(v);
  }
  for (const v of n) if (v < -NAV_COORD_MAX || v > NAV_COORD_MAX) return null;
  return n;
}

/* Erreur d'usage : portée par le routeur en 200 {ok:false} avec le message
   exact, plutôt qu'un timeout Playwright incompréhensible. */
function navErreur(msg) {
  const e = new Error(msg);
  e.code = 'NAVUSAGE';
  return e;
}

/* v1.4 (cohérence des confirmations) : le prompt promettait « demande
   confirmation sur chaque nouveau site », mais seul `ouvrir` la demandait —
   un `cliquer` ou un `point` vers un AUTRE domaine passait en douce, donc en
   mode exécution automatique le modèle atterrit n'importe où sans modale.
   On résout l'URL visée AVANT l'action et on lève NAVCONFIRM. */
function navConfirmation(origine) {
  const e = new Error('confirmation requise pour cette origine');
  e.code = 'NAVCONFIRM';
  e.origine = origine;
  return e;
}

function navOrigineDe(href, base) {
  try {
    const u = new URL(String(href), base || undefined);
    if (u.protocol === 'file:') return 'file://';
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch (_) { return null; }
}

/* Origine d'un lien visé : locator <a href> ou élément sous le pointeur. */
function navOrigineVisee(page, href) {
  if (!href) return null;
  const o = navOrigineDe(href, urlDe(page));
  return o && !navOriginesValidees.has(o) ? o : null;
}

function urlDe(page) {
  try { return page.url(); } catch (_) { return null; }
}

/* v1.4 : la page COURANTE peut changer EN COURS d'action (nouvel onglet). */
function pageCourante(page) {
  let p = nav.page || page;
  try { if (p.isClosed()) p = page; } catch (_) { p = page; }
  return p;
}

/* v1.4 : après un clic, la page change rarement pile au moment où le clic se
   résout. Trois cas :
     - target=_blank → un NOUVEL onglet s'ouvre : il faut l'ADOPTER, sinon
       nav.page reste sur l'ancien et le snapshot renvoie l'ancienne page ;
     - un <a href> → navigation dans l'onglet : on attend le changement d'URL ;
     - le reste (bouton JS) → rien à attendre, sinon chaque clic coûterait
       plusieurs secondes.
   Le waiter est préparé AVANT le clic : sinon l'événement « page » est déjà
   passé quand on commence à attendre. */
function navPreparerSuite(page, meta) {
  if (meta && meta.target === '_blank') {
    return page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  }
  return null;
}

/* v1.4 : le défilement est appliqué par la fenêtre de façon ASYNCHRONE — lu
   juste après mouse.wheel, scrollY renvoie encore l'ancienne valeur (mesuré :
   0 au lieu de 800). On laisse une frame passer, puis on relit. */
async function navScrollY(page) {
  await new Promise((r) => setTimeout(r, 90));
  return page.evaluate(() => Math.round(window.scrollY)).catch(() => 0);
}

async function navAttendreSuite(page, meta, avant, attendu, rapide) {
  if (attendu) {
    const p = await attendu;
    if (p) {
      try { if (!p.isClosed()) { nav.page = p; navEcouterPage(p); } } catch (_) {}
      const cible = pageCourante(page);
      await navBorne(cible.waitForLoadState('load', { timeout: 6000 }).catch(() => {}), 6500);
      return;
    }
  }
  if (meta && meta.href) {
    /* v1.3.6 : on ne patiente QUE si le clic peut CHANGER de document. Un
       lien `javascript:`, `#` ou vers la page courante ne déclenche jamais
       de navigation : waitForURL allait jusqu'au bout du délai (2500 ms) et
       chaque clic sur un menu/onglet JS coûtait 2,5 s — autant dire un
       navigateur figé. */
    const base = (u) => String(u == null ? '' : u).split('#')[0];
    const href = String(meta.href);
    const memeDocument = /^javascript:/i.test(href) || base(href) === base(avant);
    if (!memeDocument) {
      const t = rapide ? 600 : 2500;
      await navBorne(
        page.waitForURL((u) => String(u.href) !== avant, { timeout: t, waitUntil: 'load' }).catch(() => {}),
        t + 500,
      );
      return;
    }
  }
  /* Pas de lien : laisse juste le script de la page se dérouler. 40 ms = deux
     images de rendu — assez pour que le DOM soit à jour, sans taxe de 120 ms
     sur CHAQUE clic (c'était ~50 % du temps perçu d'un geste). */
  await new Promise((r) => setTimeout(r, 40));
}

/* v1.7 : la référence d'un snapshot IA (`[ref=e13]`, ou `f1e5` pour un
   élément d'iframe) devient un sélecteur Playwright. Le modèle recopie la
   référence TELLE QU'IL LA VOIT, donc on accepte e13 / ref=e13 /
   aria-ref=e13 / F1E5. Tout autre texte reste un sélecteur classique
   (CSS, text=, role=…), inchangé. */
function navSelecteur(arg) {
  const t = String(arg == null ? '' : arg).trim();
  const m = /^(?:aria-ref=|ref=)?((?:f\d+)?e\d{1,6})$/i.exec(t);
  return m ? 'aria-ref=' + m[1].toLowerCase() : t;
}
function navEstRef(arg) { return navSelecteur(arg) !== String(arg == null ? '' : arg).trim(); }

async function navAction(action, arg, confirme, extra) {
  if (action === 'fermer') {
    await navFermer('action fermer');
    return { ok: true, message: 'session fermée (le prochain ouvrir relancera Firefox)' };
  }
  /* `let` : en cas d'échec réseau, on repart d'une page saine (voir ouvrir). */
  let page = await navObtenirPage();
  navEcouterPage(page);
  /* v1.4 : lit la page COURANTE (elle peut avoir changé avec un nouvel
     onglet pendant l'action) et pas seulement celle saisie au départ. */
  const url = () => urlDe(pageCourante(page));
  const lireTitre = async () => {
    try { return await pageCourante(page).title().catch(() => ''); } catch (_) { return ''; }
  };

  if (action === 'ouvrir') {
    const tGoto = Date.now();
    try {
      await navBorne(page.goto(arg, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }), NAV_TIMEOUT);
    } catch (e1) {
      /* v1.5 : UNE relance sur erreur transitoire (DNS, coupure, onglet mort
         pendant le lancement). Sans ça, un simple net::ERR faisait rater
         l'action et le modèle recommençait à l'aveugle en croyant à un
         navigateur cassé. Budget borné pour rester sous le proxy (30 s). */
      const reste = NAV_TIMEOUT - (Date.now() - tGoto);
      if (reste < 4000) throw e1;
      if (page.__athenaCrash) nav.page = null;
      page = await navObtenirPage();
      const t2 = Math.max(4000, Math.min(NAV_TIMEOUT, reste));
      await navBorne(page.goto(arg, { waitUntil: 'domcontentloaded', timeout: t2 }), t2 + 500);
    }
    /* v1.4 : on attendait 'domcontentloaded' DEUX fois — la 2e est un no-op
       (l'état est déjà atteint), donc le « laisse le JS se poser » du
       commentaire ne se produisait jamais : snapshot d'une SPA = page vide,
       modèle qui conclut « page cassée ». On attend maintenant 'load'. */
    await navBorne(page.waitForLoadState('load', { timeout: 6000 }).catch(() => {}), 6500);
    /* Laisse le JS de chargement se poser (SPA : le rendu arrive après load). */
    await navBorne(page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}), 3500);
    const titre = await page.title().catch(() => '');
    return { ok: true, url: url(), titre, action: 'ouvrir' };
  }

  if (action === 'snapshot') {
    /* Arbre accessible : C'EST ce que le modèle lit pour s'orienter
       (rôles + noms), pas le HTML complet.
       v1.7 : mode « ai » de Playwright 1.63 — chaque élément reçoit une
       RÉFÉRENCE `[ref=e13]` (et `f1e5` dans une iframe) plus sa boîte
       `[box=x,y,l,h]`. Le modèle clique `cliquer e13` au lieu de deviner un
       libellé ou une CSS qui bouge à chaque redesign, et les iframes sont
       DÉCRITES dans le même arbre au lieu d'être listées en vrac. */
    const snap = await navBorne(
      page.locator('body').ariaSnapshot({ mode: 'ai', boxes: true, timeout: NAV_TIMEOUT }),
      NAV_TIMEOUT);
    const c = navCouper(snap, NAV_MAX_TEXTE);
    const rep = { ok: true, snapshot: c.texte, tronque: c.tronque, url: url() };
    const frames = page.frames().filter((f) => f !== page.mainFrame())
      .map((f) => { try { return f.url(); } catch (_) { return ''; } })
      .filter((u) => u && u !== 'about:blank');
    if (frames.length) {
      rep.cadres = frames.slice(0, 10);
      rep.note = frames.length + ' cadre(s) iframe : leur contenu est DÉCRIT dans le snapshot '
        + 'avec des références préfixées « f…e… » — clique ces références directement.';
    }
    return rep;
  }

  if (action === 'texte') {
    const brut = await navBorne(
      page.evaluate(() => (document.body ? document.body.innerText : ''), null).catch(() => ''),
      NAV_TIMEOUT,
    );
    const c = navCouper(brut, NAV_MAX_TEXTE);
    return { ok: true, texte: c.texte, tronque: c.tronque, url: url() };
  }

  if (action === 'html') {
    const brut = await navBorne(page.content().catch(() => ''), NAV_TIMEOUT);
    const c = navCouper(brut, NAV_MAX_TEXTE);
    return { ok: true, html: c.texte, tronque: c.tronque, url: url() };
  }

  if (action === 'cliquer') {
    /* Échec RAPIDE et lisible si le sélecteur ne correspond à rien : sans
       ça, Playwright attend la pleine durée du timeout puis renvoie un
       « locator.click: Timeout » sans dire que l'élément est INEXISTANT —
       le modèle croit à un navigateur gelé et recommence à l'aveugle.
       4 s de grâce (DOM dynamique) puis erreur explicite + rappel snapshot. */
    /* Référence du snapshot (`cliquer e13`) ou sélecteur classique. */
    const sel = navSelecteur(arg);
    const estRef = sel !== String(arg || '').trim();
    const main = page.locator(sel);
    let loc = main.first();
    let frame = null;
    let n = 0;
    try { n = await navBorne(main.count(), 5000); } catch (_) { n = 0; }
    /* v1.4 (iframes) : page.locator() ne TRAVERSE pas les cadres — paiement,
       OAuth, cartes resteraient invisibles. On cherche donc dans chaque
       frame du contexte avant de conclure « 0 correspondance ». Les refs
       f…e… passent DÉJÀ au travers (Playwright saute de cadre tout seul),
       cette boucle reste pour le CSS / text=. */
    if (n === 0 && !estRef) {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const fl = f.locator(sel);
        const c = await navBorne(fl.count(), 3000).catch(() => 0);
        if (c > 0) { n = c; frame = f; loc = fl.first(); break; }
      }
    }
    if (n === 0) {
      const e = new Error('aucun élément ne correspond à ce sélecteur : ' + arg
        + ' (0 correspondance, cadres iframes compris). '
        + (estRef
          ? 'Les références [ref=eN] ne valent que pour le DERNIER snapshot : refais un '
            + 'snapshot pour en obtenir de fraîches (navigation ou rendu asynchrone les '
            + 'invalide).'
          : 'Relis le snapshot pour obtenir le libellé exact — ex. text=Libellé, un '
            + 'sélecteur CSS, ou la référence [ref=eN] qu\'il affiche.'));
      e.code = 'NAVPASLU';
      throw e;
    }
    let trouve = true;
    try {
      await navBorne(loc.waitFor({ state: 'attached', timeout: 4000 }), 4500);
    } catch (_) { trouve = false; }
    if (!trouve && n > 0) {
      /* L'élément existe mais n'est pas encore rattaché (DOM en cours). */
      await navBorne(loc.waitFor({ state: 'attached', timeout: 6000 }), 6500);
    }
    /* v1.4 (confirmation) : si la cible est un lien vers un domaine NON
       validé, on demande l'accord AVANT le clic — un clic ne se rattrape pas. */
    const href = await loc.getAttribute('href').catch(() => null);
    const target = await loc.getAttribute('target').catch(() => null);
    const origine = navOrigineVisee(page, href);
    if (origine && !confirme) throw navConfirmation(origine);
    if (origine) navOriginesValidees.add(origine);   /* confirmé : plus besoin de redemander */
    const meta = { href: href, target: target };
    const avant = urlDe(page);
    const attendu = navPreparerSuite(page, meta);
    await navBorne(loc.click({ timeout: NAV_TIMEOUT }), NAV_TIMEOUT);
    await navAttendreSuite(page, meta, avant, attendu, Boolean(frame));
    const p = pageCourante(page);
    const rep = { ok: true, url: urlDe(p), titre: await p.title().catch(() => ''), correspondances: n };
    if (frame) rep.cadre = true;
    return rep;
  }

  if (action === 'taper') {
    /* Frappe dans l'élément DÉJÀ focus : clique d'abord (cliquer) puis
       taper. Une seule grammaire, pas de devinettes sur les sélecteurs. */
    /* v1.4 : sans vérification, taper dans le vide renvoie ok:true — le
       modèle croit avoir rempli le champ et recommence à l'infini. On
       prévient (sans bloquer : certains sites écoutent le clavier global). */
    const ciblé = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return false;
      const t = String(a.tagName || '').toLowerCase();
      return t === 'input' || t === 'textarea' || t === 'select' || a.isContentEditable === true;
    }).catch(() => null);
    await navBorne(page.keyboard.type(arg, { delay: 15 }), NAV_TIMEOUT);
    const rep = { ok: true, url: url() };
    if (ciblé === false) {
      rep.avertissement = 'aucun champ éditable focalisé : les touches sont parties'
        + ' dans la page — clique (cliquer / point) le champ AVANT de taper.';
    }
    return rep;
  }

  /* ---- Surface interactive : on parle en coordonnées de la capture ---- */

  if (action === 'point') {
    /* arg = « x,y » (clic gauche), « x,y,2 » (double-clic),
       « x,y,3 » (clic droit — 2/3 = boutons de Playwright). */
    const c = navCoords(arg, 2, 3);
    if (!c) throw navErreur('point : coordonnées invalides (attendu « x,y » ou « x,y,2|3 »)');
    const x = c[0]; const y = c[1];
    const bouton = c.length === 3 ? (c[2] === 3 ? 'right' : 'none') : 'left';
    /* v1.4 (confirmation) : même garde-fou que `cliquer` — si la cible est un
       lien vers un domaine non validé, 428 AVANT le clic. On lit aussi le
       `target` : un lien target=_blank ouvre un nouvel onglet à adopter. */
    const meta = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      const a = el && el.closest ? el.closest('a[href]') : null;
      if (!a) return { href: null, target: null };
      return { href: a.getAttribute('href'), target: a.getAttribute('target') };
    }, [x, y]).catch(() => ({ href: null, target: null }));
    const origine = navOrigineVisee(page, meta && meta.href);
    if (origine && !confirme) throw navConfirmation(origine);
    if (origine) navOriginesValidees.add(origine);
    const avant = urlDe(page);
    const attendu = navPreparerSuite(page, meta);
    await navBorne(page.mouse.move(x, y), 5000);
    if (bouton === 'none') await navBorne(page.mouse.dblclick(x, y), NAV_TIMEOUT);
    else await navBorne(page.mouse.click(x, y, { button: bouton }), NAV_TIMEOUT);
    await navAttendreSuite(page, meta, avant, attendu, false);
    const p = pageCourante(page);
    return { ok: true, url: urlDe(p), titre: await p.title().catch(() => ''), x, y };
  }

  if (action === 'survol') {
    /* v1.4 : le SEUL mouse.move qui ne clique pas. Sans lui, aucun lien ne se
       surligne et aucun menu :hover ne s'ouvre — on ne voit pas où on va. */
    const c = navCoords(arg, 2, 2);
    if (!c) throw navErreur('survol : coordonnées invalides (attendu « x,y »)');
    await navBorne(page.mouse.move(c[0], c[1]), 5000);
    return { ok: true, url: url(), x: c[0], y: c[1] };
  }

  if (action === 'glisser') {
    /* v1.7 : « x1,y1,x2,y2[,pas] » — presser, glisser, relâcher.
       Les micro-mouvements sont INDISPENSABLES : un seul saut de A à B fait
       démarrer aucun drag (les sites écoutent mousemove/button pressed). Le
       bouton est toujours relevé, même si un déplacement échoue en route. */
    const c = navCoords(arg, 4, 5);
    if (!c) throw navErreur('glisser : coordonnées invalides (attendu « x1,y1,x2,y2 »)');
    const x1 = c[0]; const y1 = c[1]; const x2 = c[2]; const y2 = c[3];
    const pas = c.length === 5 && c[4] >= 1 ? Math.min(60, Math.round(c[4])) : 12;
    await navBorne(page.mouse.move(x1, y1), 5000);
    await navBorne(page.mouse.down(), 5000);
    try {
      for (let i = 1; i <= pas; i++) {
        const x = Math.round(x1 + (x2 - x1) * (i / pas));
        const y = Math.round(y1 + (y2 - y1) * (i / pas));
        await navBorne(page.mouse.move(x, y), 5000);
      }
    } finally {
      await navBorne(page.mouse.up(), 5000).catch(() => {});
    }
    return { ok: true, url: url(), x1, y1, x2, y2, pas };
  }

  if (action === 'retour' || action === 'suivant') {
    /* v1.4 : barre d'URL du HUD. Sans ça, un mauvais clic ne se rattrape pas
       (il fallait connaître l'URL précédente pour la ré-ouvrir). */
    const av = url();
    const faire = action === 'retour' ? () => page.goBack({ timeout: NAV_TIMEOUT })
      : () => page.goForward({ timeout: NAV_TIMEOUT });
    try {
      await navBorne(faire(), NAV_TIMEOUT);
    } catch (err) {
      /* Playwright renvoie `null` quand l'historique est vide : on ne crie pas
         timeout pour autant, on le dit simplement. */
      if (err && err.code === 'NAVTMO') {
        throw navErreur(action + ' : la page d\'origine ne répond pas (timeout)');
      }
    }
    await navBorne(page.waitForLoadState('load', { timeout: 5000 }).catch(() => {}), 5500);
    const ap = url();
    if (ap === av) {
      return {
        ok: false,
        erreur: action === 'retour' ? 'rien à faire : aucune page précédente (historique vide)'
          : 'rien à faire : aucune page suivante (historique vide)',
        url: ap,
      };
    }
    return { ok: true, url: ap, titre: await page.title().catch(() => '') };
  }

  if (action === 'recharger') {
    await navBorne(page.reload({ timeout: NAV_TIMEOUT }), NAV_TIMEOUT);
    await navBorne(page.waitForLoadState('load', { timeout: 6000 }).catch(() => {}), 6500);
    return { ok: true, url: url(), titre: await page.title().catch(() => '') };
  }

  if (action === 'defiler') {
    /* arg = « dx,dy » ou « x,y,dx,dy » (la molette, là où se trouve la souris). */
    const c = navCoords(arg, 2, 4);
    if (!c) throw navErreur('defiler : arguments invalides (attendu « dx,dy » ou « x,y,dx,dy »)');
    let x; let y; let dx; let dy;
    if (c.length === 2) {
      x = Math.round(navVue.w / 2); y = Math.round(navVue.h / 2); dx = c[0]; dy = c[1];
    } else { x = c[0]; y = c[1]; dx = c[2]; dy = c[3]; }
    await navBorne(page.mouse.move(x, y), 5000);
    await navBorne(page.mouse.wheel(dx, dy), NAV_TIMEOUT);
    const scrollY = await navScrollY(page);
    return { ok: true, url: url(), scrollY };
  }

  if (action === 'touche') {
    /* Touche ou raccourci tel que Playwright le nomme : Enter, Tab,
       Backspace, ArrowDown, Escape, Control+a… Une seule frappe.
       v1.4 : l'ancien filtre /^[\w+][\w+\- ]*$/ rejette ÉTABLISSEMENT
       l'espace, la ponctuation et les accents (\w = ASCII seul) — mesuré
       ' '=>false, 'é'=>false, '.'=>false. On tape donc :
         - un raccourci / nom de touche  → keyboard.press
         - UN caractère                    → keyboard.type (toute la langue)
       et surtout on ne `.trim()` plus l'argument : sinon « » (espace) devient
       vide et n'arrive jamais. */
    const kBrut = String(arg == null ? '' : arg);
    /* « espace » écrit par le modèle = la barre d'espace (le parser UI
       trime une chaîne réduite à un seul blanc). */
    const k = kBrut === 'espace' ? ' ' : kBrut;
    if (!k || k.length > 40 || k.indexOf('\0') >= 0) {
      throw navErreur('touche : nom de touche invalide (ex. Enter, Tab, Backspace, ArrowDown, Control+a, ou un caractère comme « é » ou « espace »)');
    }
    const raccourci = /^[A-Za-z]+\+[A-Za-z0-9]$/.test(k);
    const nom = /^(Enter|Tab|Escape|Backspace|Delete|Insert|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|CapsLock|Control|Shift|Alt|Meta|F\d{1,2})$/.test(k);
    try {
      if (raccourci || nom) await navBorne(page.keyboard.press(k), NAV_TIMEOUT);
      else if (k.length === 1) await navBorne(page.keyboard.type(k), NAV_TIMEOUT);
      else await navBorne(page.keyboard.press(k), NAV_TIMEOUT);
    } catch (_) {
      throw navErreur('touche : impossible d\'envoyer « ' + k.slice(0, 20)
        + ' » — utilise un nom Playwright (Enter, Tab, ArrowDown, Control+a) ou un seul caractère');
    }
    const scrollY = await navScrollY(page);
    return { ok: true, url: url(), scrollY };
  }

  if (action === 'cadre') {
    /* Flux d'aperçu pour le panneau : JPEG compressé, SANS écriture disque
       (le flux tourne ~2 fois/seconde — écrire un PNG à chaque image noierait
       le dossier temporaire). Le modèle garde `capture` (PNG sur disque). */
    /* v1.7 : qualité 50 → 60. Le flux tourne ~5 fois/seconde : la macro-
       blocisation JPEG se voyait sur le texte de la page (« affichage
       bizarre »). Le coût reste ~25 ms et le payload ~35 ko, très loin des
       500 ko de NAV_CAPTURE_MAX. */
    /* v1.3.6 : le viewport prend la taille de la boîte d'affichage (.navigateur-
       corps) reçue avec la demande. On ne redimensionne QUE si elle a CHANGÉ
       (une poignée tirée) : image par image, le coût est donc nul, et le
       premier cadre après un redimensionnement laisse la page se reflower. */
    const voulue = navTailleValide(extra && extra.taille);
    const c = await navCapturer(page, voulue);
    const buf = c.buf;
    const tCapture = c.ms;
    const rep = { ok: true, octets: buf.length, url: url(), image: null, ms_capture: tCapture, vue: navVue.w + 'x' + navVue.h };
    if (buf.length <= NAV_CAPTURE_MAX) {
      rep.image = 'data:image/jpeg;base64,' + buf.toString('base64');
      navCadreImage = rep.image;
    } else { rep.message = 'cadre trop volumineux (' + buf.length + ' o)'; }
    return rep;
  }

  if (action === 'js') {
    const brut = await navBorne(page.evaluate((code) => {
      try {
        const v = (0, eval)(code);   // eslint-disable-line no-eval
        if (v === undefined) return 'undefined';
        if (typeof v === 'string') return v;
        try { return JSON.stringify(v, null, 2); } catch (_) { return String(v); }
      } catch (e) { return 'ERREUR: ' + String((e && e.message) || e); }
    }, arg), NAV_TIMEOUT);
    const c = navCouper(brut, NAV_MAX_TEXTE);
    return { ok: true, sortie: c.texte, tronque: c.tronque, url: url() };
  }

  if (action === 'capture') {
    const buf = await navBorne(page.screenshot({ type: 'png' }), NAV_TIMEOUT);
    const nom = 'athena-nav-' + Date.now().toString(36) + '.png';
    const chemin = require('path').join(require('os').tmpdir(), nom);
    require('fs').writeFileSync(chemin, buf);
    const rep = { ok: true, chemin, octets: buf.length, url: url() };
    if (buf.length <= NAV_CAPTURE_MAX) rep.image = 'data:image/png;base64,' + buf.toString('base64');
    else rep.message = 'capture trop volumineuse pour l\'aperçu (' + buf.length + ' o) — chemin fourni';
    return rep;
  }

  if (action === 'attente') {
    /* v1.4 : deux formes. Un nombre = pause (ancien comportement).
       Un SÉLECTEUR = attends que l'élément apparaisse — sinon le modèle
       enchaîne « attente 1000 / snapshot » à l'aveugle sur une SPA. */
    const a = String(arg == null ? '' : arg);
    if (/^\d+$/.test(a.trim())) {
      const ms = Math.max(0, Math.min(10000, parseInt(a, 10) || 0));
      await new Promise((r) => setTimeout(r, ms));
      return { ok: true, message: 'attendu ' + ms + ' ms', url: url() };
    }
    if (!a.trim()) throw navErreur('attente : indique un nombre de ms ou un sélecteur (ex. attente 800 ou attente text=Bienvenue)');
    const loc = page.locator(navSelecteur(a)).first();
    try {
      await navBorne(loc.waitFor({ state: 'attached', timeout: NAV_ATTENTE_SEL }), NAV_ATTENTE_SEL + 500);
    } catch (_) {
      throw navErreur('attente : « ' + a.slice(0, 120) + ' » n\'est pas apparu en '
        + (NAV_ATTENTE_SEL / 1000) + ' s — relis le snapshot (le contenu a peut-être changé de nom)');
    }
    return { ok: true, message: 'élément trouvé : ' + a.slice(0, 120), url: url() };
  }

  const e = new Error('action non implémentée : ' + action);
  e.code = 'NAVINCONNU';
  throw e;
}


function cors(origin, req) {
  const o = origin || '';
  const ok = ORIGINES_OK(o);
  const h = {
    'Access-Control-Allow-Origin': ok ? (o === 'null' ? 'null' : o) : '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-athena-token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  /* Chrome Private Network Access : une page HTTPS publique appelle
     127.0.0.1 — le preflight exige cet en-tête sinon fetch échoue.
     v20260926d (kimi) : émis UNIQUEMENT aux origines autorisées (avant :
     dans les deux branches, y compris refusées). */
  if (ok) h['Access-Control-Allow-Private-Network'] = 'true';
  return h;
}

function ORIGINES_OK(origin) {
  if (!origin) return true; // client non-navigateur (curl local)
  if (ORIGINS.has(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

function json(res, status, body, origin, req) {
  const headers = cors(origin, req);
  for (const [k, v] of Object.entries(headers)) if (v) res.setHeader(k, v);
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function lireCorps(req, max) {
  const limite = typeof max === 'number' && max > 0 ? max : 8000;
  return new Promise((resolve, reject) => {
    let t = '';
    /* v1.2 roadmap §8.3 : un client qui envoie lentement (ou jamais finit)
       laissait le worker bloqué sans limite — 15 s max, timer nettoyé sur
       fin/erreur/trop-plein. */
    const tempo = setTimeout(() => {
      const e = new Error('délai dépassé en lecture du corps (15 s)');
      e.code = 408;
      reject(e);
      req.destroy();
    }, 15000);
    const arreter = () => { try { clearTimeout(tempo); } catch (_) {} };
    req.on('data', (c) => {
      t += c;
      if (t.length > limite) {
        /* v20260926d (kimi) : 413 explicite (avant : 500 générique). */
        arreter();
        const e = new Error('corps trop volumineux');
        e.code = 413;
        reject(e);
        req.destroy();
      }
    });
    req.on('end', () => { arreter(); resolve(t); });
    req.on('error', (e) => { arreter(); reject(e); });
  });
}

/* v1.2 (audit) : tuerArbre ne doit JAMAIS échouer en silence — un arbre
   survivant après timeout = process zombie qui tourne indéfiniment. */
function tuerArbre(enfant) {
  const pid = enfant && enfant.pid;
  try {
    if (process.platform === 'win32' && pid) {
      const t = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      t.on('error', (e) => {
        console.error(`[local-agent] taskkill impossible (pid=${pid}) : ${String((e && e.message) || e).slice(0, 120)}`);
        try { enfant.kill('SIGKILL'); } catch (e2) {
          console.error(`[local-agent] SIGKILL impossible (pid=${pid}) : ${String((e2 && e2.message) || e2).slice(0, 120)}`);
        }
      });
      return;
    }
  } catch (e) {
    console.error(`[local-agent] tuerArbre (taskkill) : ${String((e && e.message) || e).slice(0, 120)}`);
  }
  try { enfant.kill('SIGKILL'); } catch (e) {
    console.error(`[local-agent] tuerArbre (SIGKILL, pid=${pid}) : ${String((e && e.message) || e).slice(0, 120)}`);
  }
}

/* v1.2 (audit) : normalisation anti-contournement — les caractères
   d'échappement PowerShell (`) et cmd (^) permettent d'écrire
   `Re`move-Item` ou `I^EX` pour passer sous les motifs. On teste la
   commande brute ET sa forme dé-échappée. */
function normaliser(cmd) {
  return String(cmd || '').replace(/[`^]/g, '').replace(/\s+/g, ' ');
}

function refus(cmd) {
  const formes = [String(cmd || ''), normaliser(cmd)];
  for (const re of DENY) for (const f of formes) {
    if (re.test(f)) return re.toString().slice(0, 80);
  }
  return null;
}

/* v1.2 (audit UI) : syntaxes vouées à l'échec sous PowerShell (l'agent tourne
   sous powershell.exe, pas cmd/bash). 400 + correction plutôt qu'exécution
   ratée : le modèle peut se corriger au tour suivant au lieu d'empiler des
   code=1 incompréhensibles. Vérifié APRÈS refus() (la sécurité d'abord).
   fix CI (cv) : ces 3 règles ne valent que LÀ où le shell est PowerShell —
   sous linux l'agent spawn /bin/sh et `i=0;` / `export X` sont VALIDES ; les
   rejeter rendait test:agent rouge sur ubuntu (stdout vide, len=0). */
const SUR_POWERSHELL = process.platform === 'win32';
const LINT = [
  [/^start\s+""/i, 'syntaxe cmd : utilisez Start-Process -FilePath ...'],
  ...(SUR_POWERSHELL ? [
    [/^export\s+[A-Za-z_]/i, "syntaxe bash : utilisez $env:NOM='valeur'"],
    [/^[A-Za-z_][A-Za-z0-9_]*=(\S|$)/, "assignation bash : utilisez $env:NOM='valeur'"],
    [/^set\s+[A-Za-z_][A-Za-z0-9_]*=/i, "syntaxe cmd : utilisez $env:NOM='valeur'"],
  ] : []),
];
/* v1.2 (anti-timeout) : récursion NON BORNÉE sur une zone large = 20 s+ de
   balayage puis timeout garanti (ex. Get-ChildItem -Recurse $HOME). On refuse
   AVANT d'exécuter, avec la correction : -Depth + sous-dossier ciblé. Testé
   sur les deux formes (brute + dé-échappée) comme refus(). */
const RACINES_LARGES = String.raw`\$HOME|\$env:USERPROFILE|~(?![\w])|[A-Z]:[\\/]?(\s|$|["'])|\\\\|\\Desktop([\\/]|$)|\\Documents([\\/]|$)|\\Downloads([\\/]|$)|OneDrive|AppData|Program Files|\\Windows([\\/]|$)|\\Users([\\/]|$)`;
function lintRecursion(cmd) {
  /* v1.2 (anti-timeout, fix) : \b ne couvre PAS '-' (non-mot) — /\b-Recurse/
     ne matche jamais ' -Recurse', le garde-fou était mort-né. Ancre (?:^|\s)
     comme pour -EncodedCommand (v1.2.1). */
  for (const f of [String(cmd || ''), normaliser(cmd)]) {
    if (/(?:^|\s)-Recurse\b/i.test(f) && !/-Depth\s+\d+/i.test(f)
        && new RegExp(RACINES_LARGES, 'i').test(f)) {
      return 'recherche récursive non bornée sur une zone large (timeout garanti) : ajoutez -Depth (ex. -Depth 3) et ciblez un sous-dossier';
    }
  }
  return null;
}
function lint(cmd) {
  const t = String(cmd || '').trim();
  for (const [re, aide] of LINT) if (re.test(t)) return aide;
  return lintRecursion(cmd);
}

/* v1.2 (audit) : existe + est-dossier en UN SEUL appel (pas de TOCTOU
   existsSync→statSync : entre les deux, le chemin peut changer). */
function estDossier(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}
function estFichier(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}
/* v1.2 (audit) : résout les liens symboliques (null si inexistant).
   Un chemin peut sembler confiné tout en pointant dehors via symlink. */
function cheminReel(p) {
  try { return fs.realpathSync(p); } catch (_) { return null; }
}

function dansAllowDir(cwd) {
  if (!ALLOW_DIR) return true;
  const abs = path.resolve(cwd || process.cwd());
  /* v1.2 (audit) : un cwd symlinké peut sembler dedans et pointer dehors —
     on compare les chemins RÉELS. */
  const reel = cheminReel(abs) || abs;
  const baseReelle = cheminReel(ALLOW_DIR) || ALLOW_DIR;
  return reel === baseReelle || reel.startsWith(baseReelle + path.sep);
}

/* §8.6-6 (opencode DOOM_LOOP_THRESHOLD=3) : même commande 3 fois de suite
   sans résultat différent = boucle — l'historique mesure « le modèle relançait
   la même commande 49 fois » (commentaire §8.3 plus bas). Tant que la boucle
   dure on refuse (409) ; une commande différente remet le compteur à zéro. */
let doomCle = null;
let doomN = 0;
function verifierDoom(commande) {
  const cle = String(commande || '');
  if (!cle) return null;
  if (cle === doomCle) doomN += 1;
  else { doomCle = cle; doomN = 1; }
  if (doomN >= 3) {
    return "doom-loop : même commande exécutée 3 fois de suite sans résultat "
      + "différent — change d'approche (autre commande, autre outil) au lieu de "
      + "répéter. Une commande différente remet le compteur à zéro.";
  }
  return null;
}

/* §8.6-8 : purgatoire des sorties épinglées (> 7 jours) + écriture. */
function nettoyerDebordements() {
  try {
    const limite = Date.now() - 7 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(SPILL_DIR)) {
      const p = path.join(SPILL_DIR, f);
      try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch (_) {}
    }
  } catch (_) {}
}
function ecrireDebordement(txt) {
  try {
    fs.mkdirSync(SPILL_DIR, { recursive: true });
    nettoyerDebordements();
    const nom = 'sortie-' + Date.now().toString(36) + '-' + process.pid + '-'
      + Math.random().toString(36).slice(2, 6) + '.txt';
    const chemin = path.join(SPILL_DIR, nom);
    fs.writeFileSync(chemin, txt, 'utf8');
    return chemin;
  } catch (_) { return null; }
}

/* v1.1 (direct) : surDonnees(canal, texte) optionnel — appelé à chaque
   paquet stdout/stderr pour la diffusion EN DIRECT (NDJSON) ; sans lui,
   comportement historique (attente de la fin). capsule (optionnel) reçoit
   {tuer} pour interrompre l'arbre de process (déconnexion client en flux). */
function executer(commande, cwd, timeoutMs, surDonnees, capsule) {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    /* v1.2 roadmap §8.3 : PowerShell 5.1 écrit ses flux en IBM850 par défaut →
       le setEncoding('utf8') de node lit des octets hors-UTF8 : « é » → U+FFFD,
       CJK/emoji perdus (« ?? »). On force UTF-8 sur les DEUX flux à la SOURCE.
       La commande affichée aux clients (tickets/SSE) reste celle d'origine,
       sans ce préfixe technique. */
    const commandePs = process.platform === 'win32'
      ? '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + commande
      : commande;
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', commandePs]
      : ['-c', commande];
    const debut = Date.now();
    let sortie = '';
    let err = '';
    let code = null;
    let termine = false;
    /* §8.6-8 : copie COMPLÈTE (bornée SPILL_MAX) pour l'épingle disque. */
    let complet = '';

    const enfant = spawn(shell, args, {
      cwd: cwd && estDossier(cwd) ? cwd : process.cwd(),
      env: { ...process.env, ATHENA_LOCAL_AGENT: '1' },
      windowsHide: true,
    });
    enfantsActifs.add(enfant);
    const oublier = () => { enfantsActifs.delete(enfant); };
    /* v1.2 roadmap §8.3 : flux TEXTUEL UTF-8 — sinon un caractère multioctet
       (é, emoji…) peut être coupé à cheval entre deux chunks data : le résultat
       affichait du mojibake quand la fin d'un caractère tombait à la frontière. */
    try { enfant.stdout.setEncoding('utf8'); } catch (_) {}
    try { enfant.stderr.setEncoding('utf8'); } catch (_) {}
    /* v1.2 roadmap §8.3 : sortie LONGUE — on garde la TÊTE (contexte) ET la
       QUEUE : c'est souvent en FIN que vit le vrai signal (stacktrace, « ERR »
       final de npm/pytest) et les MAX_OUT premiers caractères le perdaient. */
    const emboutir = (acc, morceau) => {
      const d = String(morceau);
      if (acc.length + d.length <= MAX_OUT) return acc + d;
      const moitie = Math.floor(MAX_OUT / 2);
      const tete = acc.slice(0, moitie);
      const queue = (acc.slice(moitie) + d).slice(-moitie);
      return tete + '\n…[sortie tronquée au milieu — début et fin conservés]…\n' + queue;
    };
    /* §8.6-8 : si la sortie COMPLÈTE dépasse MAX_OUT, on l'épingle dans
       SPILL_DIR (rétention 7 jours) et on donne le chemin à côté de la
       tête+queue tronquée — le modèle ne perd jamais le détail. */
    const sortirSpill = (base) => {
      const tronquee = base.slice(0, MAX_OUT);
      if (complet.length <= MAX_OUT) return tronquee;
      const chemin = ecrireDebordement(complet);
      if (!chemin) return tronquee;
      return tronquee
        + '\n[sortie complète (' + complet.length + ' caractères, '
        + complet.split('\n').length + ' lignes) écrite dans : ' + chemin
        + ' — purgée après 7 jours]';
    };
    /* v20260926d (kimi) : la déconnexion client en plein flux tue l'arbre
       (sinon le process orphelin tourne jusqu'au timeout). */
    if (capsule) {
      capsule.tuer = () => {
        if (termine) return;
        termine = true;
        oublier();
        clearTimeout(coupe);
        tuerArbre(enfant);
      };
    }

    const coupe = setTimeout(() => {
      if (termine) return;
      termine = true;
      oublier();
      tuerArbre(enfant);
      resolve({
        ok: false,
        code: null,
        signal: 'TIMEOUT',
        stdout: sortirSpill(sortie),
        stderr: (err + `\n[timeout ${timeoutMs} ms]`).slice(0, MAX_OUT),
        duree_ms: Date.now() - debut,
      });
    }, timeoutMs);

    /* v1.2 (audit) : le total diffusé est borné comme le total gardé —
       avant, les morceaux de 8 Ko partaient sans plafond (NDJSON sans fin). */
    let diffuse = 0;
    const diffuser = (canal, d) => {
      if (typeof surDonnees !== 'function' || diffuse >= MAX_OUT) return;
      const reste = MAX_OUT - diffuse;
      const morceau = String(d).slice(0, Math.min(8000, reste));
      diffuse += Buffer.byteLength(morceau, 'utf8');
      try { surDonnees(canal, morceau); } catch (_) {}
    };
    enfant.stdout.on('data', (d) => {
      sortie = emboutir(sortie, d);
      if (complet.length < SPILL_MAX) complet = (complet + d).slice(0, SPILL_MAX);
      diffuser('stdout', d);
    });
    enfant.stderr.on('data', (d) => {
      err = emboutir(err, d);
      diffuser('stderr', d);
    });
    enfant.on('error', (e) => {
      if (termine) return;
      termine = true;
      oublier();
      clearTimeout(coupe);
      resolve({ ok: false, code: null, signal: null, stdout: sortie, stderr: String(e.message || e), duree_ms: Date.now() - debut });
    });
    enfant.on('close', (c) => {
      if (termine) return;
      termine = true;
      oublier();
      clearTimeout(coupe);
      code = c;
      const errFin = err.slice(0, MAX_OUT);
      resolve({
        /* v1.2 (anti-boucle) : le code de sortie de `powershell -Command`
           n'est PAS un signal de succès fiable sous Windows PowerShell 5.1.
           Mesuré : `Get-ChildItem -Recurse -Depth 3 -ErrorAction
           SilentlyContinue` sur C:\Users RUSSIT (stdout 356 car, stderr vide)
           et renvoie pourtant exit=1 — tout error record interne (accès refusé
           sur d'autres profils) fixe le code à 1 même masqué par
           -ErrorAction. Conséquence mesurée : l'agent annonçait « échec
           code=1 » sur une commande réussie, le modèle relançait la même
           commande 49 fois et la tâche n'avançait plus.
           Règle honnête : on ne déclare l'échec que si le shell a réellement
           signalé quelque chose (code != 0 ET stderr non vide), ou si le code
           est nul. Le `code` brut reste rapporté pour l'historique. */
        ok: !(c !== 0 && errFin.trim()),
        code: c,
        signal: null,
        stdout: sortirSpill(sortie),
        stderr: errFin,
        duree_ms: Date.now() - debut,
      });
    });
  });
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const origin = req.headers.origin || '';
  const chemin = url.pathname;

  if (req.method === 'OPTIONS') {
    const h = cors(origin, req);
    for (const [k, v] of Object.entries(h)) if (v) res.setHeader(k, v);
    res.writeHead(204);
    res.end();
    return;
  }

  if (!ORIGINES_OK(origin)) {
    json(res, 403, { erreur: 'origine non autorisée' }, origin, req);
    return;
  }

  /* §8.6-7 (opencode : loopback + bearer token) : HOST est déjà 127.0.0.1
     (unicast, pas de loopback-path-scan) ; si ATHENA_AGENT_TOKEN est défini,
     chaque route exige Authorization: Bearer <token> ou x-athena-token.
     Sans variable → mode historique inchangé (zéro friction). */
  const jeton = process.env.ATHENA_AGENT_TOKEN || '';
  if (jeton && req.method !== 'OPTIONS') {
    const hAuth = String(req.headers['authorization'] || req.headers['x-athena-token'] || '');
    const porteur = hAuth.startsWith('Bearer ') ? hAuth.slice(7) : hAuth;
    if (porteur !== jeton) {
      json(res, 401, { erreur: 'ATHENA_AGENT_TOKEN requis (Authorization: Bearer …)' }, origin, req);
      return;
    }
  }

  try {
    if (req.method === 'GET' && chemin === '/sante') {
      /* v1.2 (audit) : fini le username/hostname en réponse — localhost ou
         pas, ce sont des données personnelles superflues. */
      json(res, 200, {
        ok: true,
        service: 'athena-local-agent',
        version: VERSION,
        auto: AUTO,
        allow_dir: ALLOW_DIR,
        /* v1.2 : la garde planifiée (AthenaAgentGarde) lisait ce point toutes
           les 30 min et, sur un simple délai dépassé, REDÉMARRAIT l'agent —
           tuant la commande en cours au milieu d'une tâche longue (« execution
           agent is not reachable », mesuré sur un run de 27 commandes).
           en_cours = nombre de commandes vivantes : la sonde ne relance plus
           pendant qu'une tâche travaille. */
        en_cours: enfantsActifs.size,
        platform: process.platform,
        /* v1.3 : navigateur — absent = Playwright non installé (npm i). */
        navigateur: navEtat(),
        /* v1.4 : le panneau affiche POURQUOI il n'y a plus de session, et
           signale qu'une action est en cours (badge « occupé »). */
        nav_url: (() => { try { return nav.page && !nav.page.isClosed() ? nav.page.url() : null; } catch (_) { return null; } })(),
        nav_occupe: navActionEnCours,
        nav_ferme_pour: nav.ferme ? nav.fermePour : null,
        nav_origines: navOriginesValidees.size,
        /* v1.5 : preuve matérielle que c'est BIEN Firefox — moteur, version
           réelle (userAgent de la page) et exécutable lancé. nav_pret = un
           Firefox vivant est déjà là : le prochain ouvrir ne coûtera rien. */
        nav_moteur: pw ? 'firefox' : null,
        nav_version: navVersion || null,
        nav_exec: navExec || null,
        nav_pret: navPret(),
        nav_demarrage_ms: navDemarrageMs || null,
        /* v1.3.6 : viewport appliqué au panneau + cadence réelle des
           requêtes /browser (un flux « qui lag » = souvent deux clients). */
        nav_vue: navVue.w + 'x' + navVue.h,
        nav_freq: navFreqN,
        nav_duree_ms: navDureeMoy,
        nav_capture_ms: navCaptureMoy,
        nav_flux_i: navFluxI,
        flux_tours: fluxTours,
        flux_abonnes: fluxAbonnesN,
        flux_groupes: fluxGroupes.size,
        version_agent: VERSION,
      }, origin, req);
      return;
    }

    /* P0 : flux d'images POUSSÉ — une connexion par panneau, remplie de trames
       binaires [type:1][w:2][h:2][len:4][charge]. Plus d'en-têtes HTTP ni de
       JSON/base64 par image, et N panneaux de même taille partagent UNE
       capture. `?w=&h=` = taille de la boîte en pixels écran (bornée). */
    if (req.method === 'GET' && chemin === '/flux') {
      navNoteRequete();
      const w = parseInt(url.searchParams.get('w') || '', 10);
      const h = parseInt(url.searchParams.get('h') || '', 10);
      const voulue = navTailleValide({ w: w, h: h });
      if (!voulue) {
        json(res, 400, { erreur: 'taille invalide : ?w=&h= en pixels écran (ex. 845x1005)' }, origin, req);
        return;
      }
      const entetes = cors(origin, req);
      for (const [k, v] of Object.entries(entetes)) if (v) res.setHeader(k, v);
      res.writeHead(200, {
        'Content-Type': 'application/x-athena-frames',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      const cle = fluxCle(voulue);
      let groupe = fluxGroupes.get(cle);
      if (!groupe) {
        groupe = { cle: cle, taille: voulue, abonnes: new Set(), tourne: false, meta: null, metaDernier: 0 };
        fluxGroupes.set(cle, groupe);
      }
      const abo = { res: res, sature: false };
      /* Le lecteur a repris → on autorise la prochaine trame (voir fluxEcrire). */
      res.on('drain', () => { abo.sature = false; });
      groupe.abonnes.add(abo);
      /* Le premier abonné reçoit la méta du prochain tour ; un abonné qui
         REJOINT un groupe déjà chaud la recevrait sinon jamais (la méta n'est
         renvoyée qu'à la différence) : on la lui donne tout de suite. */
      if (groupe.meta) fluxEcrire(abo, FLUX_META, 0, 0, Buffer.from(groupe.meta, 'utf8'));
      fluxAbonnesN++;
      if (!groupe.tourne) fluxBoucler(groupe).catch(() => {});
      let retire = false;
      const retirer = () => {
        if (retire) return;
        retire = true;
        if (groupe.abonnes.delete(abo)) fluxAbonnesN--;
      };
      req.on('close', retirer);
      res.on('close', retirer);
      return;
    }

    if (req.method === 'GET' && chemin === '/journal') {
      /* v1.2 (audit) : ?limit= (défaut 50, max 200) — avant : 200 gardées,
         50 renvoyées, sans explication ni choix. */
      let limite = parseInt(url.searchParams.get('limit') || '50', 10);
      if (!Number.isFinite(limite)) limite = 50;
      limite = Math.max(1, Math.min(JOURNAL_MAX, limite));
      json(res, 200, { entrees: journal.slice(-limite), total: journal.length }, origin, req);
      return;
    }

    if (req.method === 'POST' && chemin === '/exec') {
      let brut;
      try {
        /* v1.2 (anti-bâclage) : la limite par défaut de lireCorps (8000, corps
           JSON COMPRIS) détruisait la socket au-delà de ~7970 caractères de
           commande → le client voyait « fetch failed » au lieu d'une erreur
           lisible. Le vrai plafond est LIMITE_COMMANDE (validation ci-dessous) :
           on laisse donc de la marge pour le JSON. */
        brut = await lireCorps(req, 64 * 1024);
      } catch (e) {
        json(res, (e && e.code) || 400, { erreur: (e && e.message) || 'corps illisible' }, origin, req);
        return;
      }
      let corps = {};
      try { corps = JSON.parse(brut || '{}'); } catch (_) {}
      /* v1.2 (audit) : validation stricte — avant, seuls la présence et la
         longueur étaient contrôlées (types fantaisistes acceptés, \0 passait,
         timeout négatif = immédiat). */
      if (corps !== null && typeof corps !== 'object') {
        json(res, 400, { erreur: 'corps JSON objet attendu' }, origin, req);
        return;
      }
      const commande = String(corps.commande || corps.command || '').trim();
      /* v1.2 (anti-bâclage) : 2000 rejetait SILENCIEMENT les scripts de
         vérification réels du modèle (~2500 car. : Chrome headless + lecture
         DOM + contrôle d'erreurs). Mesuré : 400 « commande absente ou trop
         longue » deux fois de suite → le modèle arrêtait la boucle
         écrire→tester→corriger et livrait un fichier cassé en croyant avoir
         fini. La borne suit la sortie de commande (MAX_OUT / 8000). */
      const LIMITE_COMMANDE = 8000;
      if (!commande || commande.length > LIMITE_COMMANDE || commande.includes('\0')) {
        json(res, 400, {
          erreur: 'commande absente ou trop longue (' + LIMITE_COMMANDE
            + ' caractères maximum, reçue : ' + commande.length + '). '
            + 'Écris le script dans un fichier .ps1 puis lance '
            + 'powershell -NoProfile -File <chemin>.ps1',
        }, origin, req);
        return;
      }
      if (corps.cwd !== undefined && (typeof corps.cwd !== 'string' || corps.cwd.length > 500 || corps.cwd.includes('\0'))) {
        json(res, 400, { erreur: 'cwd invalide (chaîne ≤500 car.)' }, origin, req);
        return;
      }
      if (corps.flux !== undefined && typeof corps.flux !== 'boolean') {
        json(res, 400, { erreur: 'flux invalide (booléen attendu)' }, origin, req);
        return;
      }
      if (corps.confirme !== undefined && typeof corps.confirme !== 'boolean') {
        json(res, 400, { erreur: 'confirme invalide (booléen attendu)' }, origin, req);
        return;
      }
      const confirme = corps.confirme === true || AUTO;
      const motif = refus(commande);
      if (motif) {
        json(res, 403, { erreur: 'commande bloquée par la liste de refus', motif }, origin, req);
        return;
      }
      const aide = lint(commande);
      if (aide) {
        json(res, 400, { erreur: 'commande non exécutable dans ce shell', aide }, origin, req);
        return;
      }
      if (!confirme) {
        json(res, 428, {
          erreur: 'confirmation requise',
          commande,
          pret: true,
          hint: 'Renvoyez avec confirme:true après validation utilisateur',
        }, origin, req);
        return;
      }
      /* §8.6-6 doom-loop : on ne compte que ce qui allait VRAIMENT s'exécuter
         (après validation/refus/lint/confirme) — 3 passages identiques = 409. */
      const avertDoom = verifierDoom(commande);
      if (avertDoom) {
        json(res, 409, { erreur: avertDoom, doom_loop: true }, origin, req);
        return;
      }
      const cwdDemande = typeof corps.cwd === 'string' && corps.cwd ? corps.cwd : process.cwd();
      /* v20260926d (kimi) : cwd inexistant = 400 explicite (avant : repli
         silencieux sur le cwd de l'agent — la commande tournait ailleurs).
         v1.2 : test atomique (pas de TOCTOU existsSync→statSync). */
      if (typeof corps.cwd === 'string' && corps.cwd && !estDossier(corps.cwd)) {
        json(res, 400, { erreur: 'répertoire inexistant : ' + String(corps.cwd).slice(0, 200), cwd: String(corps.cwd).slice(0, 200) }, origin, req);
        return;
      }
      const cwd = cwdDemande;
      if (!dansAllowDir(cwd)) {
        json(res, 403, { erreur: 'répertoire hors zone autorisée (--allow)' }, origin, req);
        return;
      }
      /* v1.2 : timeout borné des DEUX côtés (négatif/NaN = plancher 100 ms). */
      let t = Number(corps.timeout_ms);
      if (!Number.isFinite(t)) t = TIMEOUT_MS;
      t = Math.max(TIMEOUT_MIN_MS, Math.min(TIMEOUT_MS, t));
      /* v1.1 (direct) : flux:true (+confirme) → NDJSON EN DIRECT :
         {type:'sortie',canal,texte}* puis {type:'fin', ...résultat complet}.
         Le résultat complet reste dans 'fin' (même forme que le JSON unique)
         pour que l'UI persiste la trace à l'identique. */
      if (corps.flux === true) {
        const h = cors(origin, req);
        for (const [k, v] of Object.entries(h)) if (v) res.setHeader(k, v);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.writeHead(200);
        const ligne = (o) => { try { res.write(JSON.stringify(o) + '\n'); } catch (_) {} };
        const capsule = {};
        let reponseFinie = false;
        /* v20260926d : client parti en cours de stream → on tue l'arbre.
           v1.2 roadmap §8.3 : res.on('close') AUSSI (la socket serveur peut
           se fermer sans que req.close ait été vu — double garde-fou). */
        const tueSiParti = () => { if (!reponseFinie && capsule.tuer) { try { capsule.tuer(); } catch (_) {} } };
        req.on('close', tueSiParti);
        res.on('close', tueSiParti);
        const rf = await executer(commande, cwd, t, (canal, texte) => {
          ligne({ type: 'sortie', canal, texte });
        }, capsule);
        const entreef = {
          ts: Date.now(),
          commande: commande.slice(0, 200),
          ok: rf.ok,
          code: rf.code,
          duree_ms: rf.duree_ms,
        };
        journaliser(entreef);
        console.log(`[local-agent] ${rf.ok ? 'OK' : 'ERR'} code=${rf.code} ${rf.duree_ms}ms :: ${entreef.commande}`);
        ligne({ type: 'fin', ...rf, commande });
        reponseFinie = true;
        res.end();
        return;
      }
      const r = await executer(commande, cwd, t);
      const entree = {
        ts: Date.now(),
        commande: commande.slice(0, 200),
        ok: r.ok,
        code: r.code,
        duree_ms: r.duree_ms,
      };
      journaliser(entree);
      console.log(`[local-agent] ${r.ok ? 'OK' : 'ERR'} code=${r.code} ${r.duree_ms}ms :: ${entree.commande}`);
      json(res, 200, { ...r, commande }, origin, req);
      return;
    }

    /* v1.1 (direct) : écriture d'un fichier créé par le modèle.
       {chemin, contenu, confirme?, ecraser?} — chemin relatif = cwd de l'agent.
       confirme:false → 428 (avec `existe`) ; existe && !ecraser → 409.
       Garde-fous : origine (plus haut), DENY_WRITE (dossiers système),
       taille bornée, journal. */
    if (req.method === 'POST' && chemin === '/write') {
      let brutw;
      try {
        brutw = await lireCorps(req, 3 * 1024 * 1024);
      } catch (e) {
        json(res, (e && e.code) || 400, { erreur: (e && e.message) || 'corps illisible' }, origin, req);
        return;
      }
      let corpsw = {};
      try { corpsw = JSON.parse(brutw || '{}'); } catch (_) {}
      /* v1.2 (audit) : validation stricte du contenu, pas seulement de la
         longueur (types exigés, \0 interdit). */
      if (corpsw !== null && typeof corpsw !== 'object') {
        json(res, 400, { erreur: 'corps JSON objet attendu' }, origin, req);
        return;
      }
      const cheminDemande = String(corpsw.chemin || corpsw.path || '').trim();
      const contenu = typeof corpsw.contenu === 'string' ? corpsw.contenu : null;
      if (!cheminDemande || cheminDemande.length > 500 || cheminDemande.includes('\0') || contenu == null) {
        json(res, 400, { erreur: 'chemin (≤500 car.) et contenu requis' }, origin, req);
        return;
      }
      const dossierDemande = typeof corpsw.dossier === 'string' ? corpsw.dossier.trim() : '';
      if (corpsw.dossier !== undefined && (typeof corpsw.dossier !== 'string' || dossierDemande.length > 500 || dossierDemande.includes('\0'))) {
        json(res, 400, { erreur: 'dossier invalide (chaîne ≤500 car.)' }, origin, req);
        return;
      }
      if (corpsw.confirme !== undefined && typeof corpsw.confirme !== 'boolean') {
        json(res, 400, { erreur: 'confirme invalide (booléen attendu)' }, origin, req);
        return;
      }
      if (corpsw.ecraser !== undefined && typeof corpsw.ecraser !== 'boolean') {
        json(res, 400, { erreur: 'ecraser invalide (booléen attendu)' }, origin, req);
        return;
      }
      /* v20260926d (kimi) : la borne et les compteurs portent sur les OCTETS
         utf-8, pas les unités UTF-16. */
      const octetsContenu = Buffer.byteLength(contenu, 'utf8');
      if (octetsContenu > MAX_WRITE) {
        json(res, 413, { erreur: 'contenu trop volumineux (limite 2 Mo utiles)' }, origin, req);
        return;
      }
      /* v20260926e : dossier de travail choisi dans les réglages — les chemins
         relatifs s'y résolvent, avec confinement strict (../ ne peut pas en
         sortir). Sans dossier : comportement historique (cwd + DENY_WRITE). */
      let base = process.cwd();
      let confine = false;
      if (dossierDemande) {
        base = path.resolve(process.cwd(), dossierDemande);
        confine = true;
        if (ALLOW_DIR && !(base === ALLOW_DIR || base.startsWith(ALLOW_DIR + path.sep))) {
          json(res, 403, { erreur: 'dossier hors zone autorisée (--allow) : ' + base, dossier: base }, origin, req);
          return;
        }
      }
      /* v1.2 roadmap §8.3 : DENY_WRITE AVANT tout mkdir — le contrôle était
         posé APRÈS les mkdirSync (dossier + parent) : on CRÉAIT des dossiers
         embryonnaires dans des zones système, puis on refusait l'écriture.
         Test précoce sur abs/parent/base ; le contrôle realpath post-mkdir
         (symlinks) reste en place plus bas. */
      const abs = path.resolve(base, cheminDemande);
      const parentT = path.dirname(abs);
      if (DENY_WRITE.some((re) => re.test(abs) || re.test(parentT) || re.test(base))) {
        json(res, 403, { erreur: 'écriture bloquée : dossier système — ' + abs, chemin: abs }, origin, req);
        return;
      }
      if (dossierDemande) {
        try {
          fs.mkdirSync(base, { recursive: true });
        } catch (e) {
          json(res, 400, { erreur: 'dossier inutilisable : ' + String((e && e.message) || e).slice(0, 120) }, origin, req);
          return;
        }
      }
      if (confine && !(abs === base || abs.startsWith(base + path.sep))) {
        json(res, 403, { erreur: 'chemin hors du dossier de travail (../ interdit)', chemin: abs }, origin, req);
        return;
      }
      /* v1.2 (audit) : confinement ANTI-SYMLINK — un dossier ou fichier
         intermédiaire peut être un lien pointant hors zone (ex. sub/ → C:\).
         On compare les chemins RÉELS du dossier parent (créé si besoin) et,
         si le fichier existe déjà, du fichier lui-même. */
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
      } catch (e) {
        json(res, 400, { erreur: 'dossier parent inutilisable : ' + String((e && e.message) || e).slice(0, 120) }, origin, req);
        return;
      }
      const baseReelle = cheminReel(base);
      const dirReel = cheminReel(path.dirname(abs));
      if (!dirReel) {
        json(res, 400, { erreur: 'dossier parent inaccessible', chemin: abs }, origin, req);
        return;
      }
      /* v1.2 (audit 14:27) : le confinement strict « à l'intérieur de base »
         ne vaut QUE si un dossier de travail est demandé (confine). Sans lui,
         il interdisait tout chemin absolu hors du cwd de l'agent — alors que
         le prompt documente « relatif ou absolu », et que l'exec PowerShell
         (même agent, mêmes garde-fous DENY) peut écrire partout : la
         restriction était incohérente, pas protectrice. Mesuré : un .txt
         légitime en %TEMP% refusé en 403, tâche morte. */
      if (confine) {
        if (!baseReelle || !(dirReel === baseReelle || dirReel.startsWith(baseReelle + path.sep))) {
          json(res, 403, { erreur: 'chemin hors du dossier de travail (../ interdit)', chemin: abs }, origin, req);
          return;
        }
        const fichierReel = cheminReel(abs);
        if (fichierReel && !(fichierReel === abs || fichierReel.startsWith(baseReelle + path.sep))) {
          json(res, 403, { erreur: 'fichier existant hors zone (lien symbolique)', chemin: abs }, origin, req);
          return;
        }
      }
      /* Hors confinement : les liens sont résolus et le CHEMIN RÉEL est
         confronté à la liste de refus (dossiers système) — un symlink vers
         C:\Windows reste bloqué, un .txt en %TEMP% passe. */
      const cibleReelle = cheminReel(abs) || abs;
      if (DENY_WRITE.some((re) => re.test(abs) || re.test(cibleReelle))) {
        json(res, 403, { erreur: 'écriture bloquée : dossier système', chemin: abs }, origin, req);
        return;
      }
      /* v1.2 : test atomique (ni existsSync, ni double stat — pas de TOCTOU). */
      const existe = estFichier(abs);
      const confirmew = corpsw.confirme === true || AUTO;
      if (!confirmew) {
        json(res, 428, {
          erreur: 'confirmation requise',
          chemin: abs,
          existe,
          dossier: base,
          octets: octetsContenu,
          hint: 'Renvoyez avec confirme:true après validation utilisateur (ecraser:true si le fichier existe)',
        }, origin, req);
        return;
      }
      if (existe && corpsw.ecraser !== true && !AUTO) {
        json(res, 409, { erreur: 'le fichier existe déjà (ecraser:true pour remplacer)', chemin: abs, existe: true }, origin, req);
        return;
      }
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, contenu, 'utf8');
      } catch (e) {
        json(res, 500, { erreur: 'écriture impossible : ' + String((e && e.message) || e).slice(0, 160) }, origin, req);
        return;
      }
      const entreew = { ts: Date.now(), ecriture: abs.slice(0, 300), octets: octetsContenu, ecrase: existe };
      journaliser(entreew);
      console.log(`[local-agent] WRITE ${octetsContenu}o ${existe ? '(écrasé)' : ''} :: ${entreew.ecriture}`);
      json(res, 200, { ok: true, chemin: abs, octets: octetsContenu, ecrase: existe }, origin, req);
      return;
    }

    /* ==== v1.3 : navigateur Firefox intégré (Playwright) ====
       {action, arg?, confirme?} — UNE action par requête, sérialisées sur
       une session unique. Le résultat contient ce que le modèle doit LIRE
       (snapshot/texte/erreur), jamais le flux interne. */
    if (req.method === 'POST' && chemin === '/browser') {
      navNoteRequete();
      let brutn;
      try { brutn = await lireCorps(req, 16 * 1024); }
      catch (e) {
        json(res, (e && e.code) || 400, { erreur: (e && e.message) || 'corps illisible' }, origin, req);
        return;
      }
      let corpsn = {};
      try { corpsn = JSON.parse(brutn || '{}'); } catch (_) {}
      if (corpsn !== null && typeof corpsn !== 'object') {
        json(res, 400, { erreur: 'corps JSON objet attendu' }, origin, req);
        return;
      }
      const action = String(corpsn.action || '').trim().toLowerCase();
      /* v1.4 : ON NE TRIMME PAS `touche` — sinon « espace » (un seul blanc)
         devient une chaîne vide et n'est JAMAIS transmis à Firefox. Pour les
         autres actions (URL, sélecteurs) le trim protège contre les espaces
         de fin de bloc ```athena-browser. */
      const argBrut = String(corpsn.arg || corpsn.url || '');
      const arg = action === 'touche' ? argBrut : argBrut.trim();
      /* v1.5 : `prechauffer` n'est PAS une action de modèle (elle ne figure
         pas dans NAV_ACTIONS) : le CLIENT la lance dès qu'il SAIT qu'une
         action arrive, pour recouvrir les ~1,9 s de démarrage de Firefox
         avec le temps d'affichage / de la modale. Elle ne prend PAS le
         verrou : elle ne touche à aucune page, elle prépare seulement. */
      if (action === NAV_PRECHAUFFER) {
        try {
          const r = await navPrechauffer();
          json(res, r.ok ? 200 : 503, { ...r, navigateur: navEtat() }, origin, req);
        } catch (e) {
          json(res, 503, {
            erreur: 'lancement Firefox impossible : ' + String((e && e.message) || e).slice(0, 300),
            navigateur: 'absent',
          }, origin, req);
        }
        return;
      }
      if (!NAV_ACTIONS.includes(action)) {
        json(res, 400, {
          erreur: 'action inconnue : ' + (action || '(vide)'),
          actions: NAV_ACTIONS,
        }, origin, req);
        return;
      }
      if (arg.length > NAV_ARG_MAX || arg.includes('\0')) {
        json(res, 400, { erreur: 'argument trop long (' + NAV_ARG_MAX + ' caractères max, reçu : ' + arg.length + ')' }, origin, req);
        return;
      }
      if (!pw) {
        json(res, 503, {
          erreur: 'navigateur indisponible : Playwright non installé',
          aide: 'cd mini-services/local-agent && npm install playwright && npx playwright install firefox',
        }, origin, req);
        return;
      }
      if ((action === 'ouvrir' || action === 'taper' || action === 'touche') && !arg) {
        json(res, 400, { erreur: 'argument requis pour l\'action ' + action }, origin, req);
        return;
      }
      /* Geste piloté au pixel : on refuse ICI une coordonnée illisible, avant
         de prendre le verrou et d'exécuter un clic quelque part. */
      if (action === 'point' || action === 'defiler' || action === 'survol') {
        const c = navCoords(arg, 2, 4);
        const attendu = action === 'point' ? 'x,y [ou x,y,2|3]'
          : action === 'survol' ? 'x,y' : 'dx,dy [ou x,y,dx,dy]';
        const bon = action === 'point' ? (c && (c.length === 2 || c.length === 3))
          : action === 'survol' ? (c && c.length === 2)
            : (c && (c.length === 2 || c.length === 4));
        if (!bon) {
          json(res, 400, { erreur: action + ' : coordonnées invalides (attendu ' + attendu + ')' }, origin, req);
          return;
        }
      }
      /* Schémas refusés : javascript:, about:, data: — le modèle navigue,
         il ne crée pas de page-script. file:// reste autorisé (tester une
         page locale écrite par athena-file est le cas d'usage n° 1). */
      if (action === 'ouvrir' && NAV_URL_REFUS.test(arg)) {
        json(res, 400, { erreur: 'schéma d\'URL refusé', url: arg.slice(0, 120) }, origin, req);
        return;
      }
      /* Confirmation : ouvrir un SITE hors des origines déjà validées, ou
         évaluer du JS (équivalent d'une commande) demandent l'accord.
         Les actions de lecture dans la page ouverte ne redemandent pas. */
      const confirmeN = corpsn.confirme === true || AUTO;
      let origineCible = null;
      if (action === 'ouvrir') {
        try { origineCible = new URL(arg).origin; } catch (_) { origineCible = null; }
        if (!origineCible) {
          json(res, 400, { erreur: 'URL invalide (http(s):// ou file:// attendu)', url: arg.slice(0, 120) }, origin, req);
          return;
        }
        if (arg.startsWith('file:')) origineCible = 'file://';
      }
      const exigeConfirm = (action === 'ouvrir' && origineCible && !navOriginesValidees.has(origineCible))
        || action === 'js';
      if (exigeConfirm && !confirmeN) {
        json(res, 428, {
          erreur: 'confirmation requise',
          action,
          origine: origineCible,
          pret: true,
          hint: 'Renvoyez avec confirme:true après validation utilisateur',
        }, origin, req);
        return;
      }
      /* v1.4 (flux d'images) : le `cadre` ne prend PAS le verrou quand une
         action tourne — il renvoie sa DERNIÈRE image. Le JPEG (~50 ms) ne
         s'intercale plus entre deux gestes du modèle, et le rendu du panneau
         reste stable pendant un snapshot long. */
      if (action === 'cadre' && navActionEnCours && navCadreImage) {
        json(res, 200, {
          ok: true,
          image: navCadreImage,
          occupe: true,
          message: navCadreImage ? 'page occupée : image précédente conservée' : 'page occupée',
          navigateur: navEtat(),
        }, origin, req);
        return;
      }
      const debut = Date.now();
      let resultat;
      let httpAction = 200;
      try {
        /* Une seule action à la fois : la page est un état partagé.
           v1.4 : l'attente est BORNÉE. Avant, si launchPersistentContext
           restait bloqué (verrou de profil, Firefox fantôme), TOUTES les
           requêtes derrière pendaient jusqu'au client. Maintenant : 409. */
        const precedent = navVerrou;
        let liberer = null;
        navVerrou = new Promise((r) => { liberer = r; });
        let fileLibre = true;
        try { await navBorne(precedent, NAV_VERROU_MS); } catch (_) { fileLibre = false; }
        try {
          if (!fileLibre) {
            httpAction = 409;
            resultat = {
              ok: false,
              erreur: 'navigation déjà en cours (plus de ' + (NAV_VERROU_MS / 1000)
                + ' s d\'attente) — réessaie dans un instant.',
            };
          } else {
            const msFile = Date.now() - debut;
            /* P5 : `survol` ne déplace QUE la souris Playwright — aucun DOM
               touché. Si on gelait le flux pour ce geste (client : 1 envoi
               toutes les 80 ms), l'image s'arrêterait ~la moitié du temps où
               la souris bouge : c'était « ça lag quand je bouge ». */
            if (action !== 'cadre' && action !== 'survol') navActionEnCours = true;
            try { resultat = await navAction(action, arg, confirmeN, corpsn); }
            finally { navActionEnCours = false; }
            if (resultat && action === 'cadre') resultat.ms_file = msFile;
          }
        } finally { if (liberer) liberer(); }
        if (origineCible && action === 'ouvrir' && resultat && resultat.ok !== false) {
          navOriginesValidees.add(origineCible);
        }
      } catch (e) {
        /* v1.4 : un clic / un point vers un domaine NON validé lève
           NAVCONFIRM depuis navAction → 428, exactement comme `ouvrir`.
           La confirmation ne se fait JAMAIS côté agent. */
        if (e && e.code === 'NAVCONFIRM') {
          json(res, 428, {
            erreur: 'confirmation requise',
            action,
            origine: e.origine || null,
            pret: true,
            hint: 'Renvoyez avec confirme:true après validation utilisateur',
          }, origin, req);
          return;
        }
        const tmo = e && e.code === 'NAVTMO';
        resultat = {
          ok: false,
          erreur: String((e && e.message) || e).slice(0, 600),
          timeout: Boolean(tmo),
        };
      }
      /* v1.4 : une alert()/confirm() (dismissée en silence) ou un
         téléchargement (invisible en headless) deviennent LISIBLES. Ils sont
         consommés une seule fois. */
      if (resultat && resultat.ok !== false) {
        if (navDialogue) { resultat.dialogue = navDialogue; navDialogue = null; }
        if (navTelechargement) { resultat.telechargement = navTelechargement; navTelechargement = null; }
      }
      const duree = Date.now() - debut;
      if (action === 'cadre' && resultat && typeof resultat.ms_capture === 'number') {
        navNoteDuree(duree, resultat.ms_capture);
      }
      /* v1.4 : `cadre` tourne ~2 fois/seconde tant que le panneau est ouvert
         → il noyait le journal ET le fichier JSONL ne JAMAIS rogné (mesuré :
         558 Ko / 4668 lignes). On ne jauge pas le flux, et on rogne. */
      if (action !== 'cadre') {
        const entreeN = {
          ts: debut,
          navigation: action + (arg ? ' ' + arg.slice(0, 120) : ''),
          ok: resultat.ok !== false,
          duree_ms: duree,
        };
        journaliser(entreeN);
        console.log(`[local-agent] NAV ${entreeN.ok ? 'OK' : 'ERR'} ${duree}ms :: ${entreeN.navigation}`);
      }
      json(res, httpAction, { ...resultat, action, duree_ms: duree, navigateur: navEtat() }, origin, req);
      return;
    }

    json(res, 404, { erreur: 'route inconnue (GET /sante, GET /journal, POST /exec, POST /write, POST /browser)' }, origin, req);
  } catch (e) {
    json(res, 500, { erreur: String((e && e.message) || e).slice(0, 200) }, origin, req);
  }
});

serveur.listen(PORT, HOST, () => {
  console.log(`[athena-local-agent] v${VERSION} → http://${HOST}:${PORT}`);
  console.log(`  auto=${AUTO} allow=${ALLOW_DIR || '(tout)'}`);
  console.log('  POST /exec {commande, confirme:true, cwd?, timeout_ms?, flux?} (flux:true = NDJSON en direct)');
  console.log('  POST /write {chemin, contenu, confirme:true, ecraser?} (428 = confirmation requise)');
  console.log(`  POST /browser {action, arg?, confirme?} (navigateur : ${pw ? 'playwright ok' : 'playwright ABSENT — npm install playwright && npx playwright install firefox'})`);
  console.log(`  actions navigateur : ${NAV_ACTIONS.join(', ')}`);
});

/* v1.3 : session navigateur seule = fermeture automatique. Sans ça, une
   fenêtre Firefox ouverte oubliée reste affichée indéfiniment après la
   dernière action du modèle. */
setInterval(() => {
  if (!nav.browser) return;
  /* Préchauffé sans session = 60 s ; session ouverte = 10 min. */
  const delai = nav.ferme ? NAV_PRECHAUFFE_MS : NAV_IDLE_MS;
  if (Date.now() - nav.dernier > delai) {
    const pourquoi = nav.ferme ? 'préchauffage inutilisé' : 'inactivité';
    console.log('[local-agent] navigateur : ' + pourquoi + ' > '
      + Math.round(delai / 1000) + ' s → fermeture');
    navFermer(pourquoi).catch(() => {});
  }
}, 15000).unref();

/* v1.2 (audit) : arrêt propre — avant, SIGINT tuait le process en laissant
   les enfants tourner (zombies) et les requêtes en plan. */
async function arretPropre(signal) {
  console.log(`[local-agent] ${signal} : arrêt (${enfantsActifs.size} commande(s) en cours)…`);
  for (const e of [...enfantsActifs]) { try { tuerArbre(e); } catch (_) {} }
  enfantsActifs.clear();
  try { await navFermer('arrêt agent'); } catch (_) {}
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', () => arretPropre('SIGINT'));
process.on('SIGTERM', () => arretPropre('SIGTERM'));
