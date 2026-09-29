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
const VERSION = '1.2.1';
const AUTO = process.argv.includes('--auto');
const TIMEOUT_MS = 60000;
const TIMEOUT_MIN_MS = 100;
const MAX_OUT = 64 * 1024;
/* v1.1 (direct) : écriture de fichiers créés par le modèle. */
const MAX_WRITE = 2 * 1024 * 1024;
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
try {
  const lignes = fs.readFileSync(JOURNAL_FICHIER, 'utf8').split('\n').filter(Boolean);
  for (const l of lignes.slice(-JOURNAL_MAX)) {
    try { journal.push(JSON.parse(l)); } catch (_) {}
  }
} catch (_) {}
function journaliser(entree) {
  journal.push(entree);
  if (journal.length > JOURNAL_MAX) journal.shift();
  try { fs.appendFileSync(JOURNAL_FICHIER, JSON.stringify(entree) + '\n'); } catch (e) {
    console.error(`[local-agent] journal persistant inaccessible : ${String((e && e.message) || e).slice(0, 120)}`);
  }
}

/* v1.2 (audit) : enfants actifs suivis pour l'arrêt propre (SIGINT). */
const enfantsActifs = new Set();

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
    req.on('data', (c) => {
      t += c;
      if (t.length > limite) {
        /* v20260926d (kimi) : 413 explicite (avant : 500 générique). */
        const e = new Error('corps trop volumineux');
        e.code = 413;
        reject(e);
        req.destroy();
      }
    });
    req.on('end', () => resolve(t));
    req.on('error', reject);
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
   code=1 incompréhensibles. Vérifié APRÈS refus() (la sécurité d'abord). */
const LINT = [
  [/^start\s+""/i, 'syntaxe cmd : utilisez Start-Process -FilePath ...'],
  [/^export\s+[A-Za-z_]/i, "syntaxe bash : utilisez $env:NOM='valeur'"],
  [/^[A-Za-z_][A-Za-z0-9_]*=(\S|$)/, "assignation bash : utilisez $env:NOM='valeur'"],
  [/^set\s+[A-Za-z_][A-Za-z0-9_]*=/i, "syntaxe cmd : utilisez $env:NOM='valeur'"],
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

/* v1.1 (direct) : surDonnees(canal, texte) optionnel — appelé à chaque
   paquet stdout/stderr pour la diffusion EN DIRECT (NDJSON) ; sans lui,
   comportement historique (attente de la fin). capsule (optionnel) reçoit
   {tuer} pour interrompre l'arbre de process (déconnexion client en flux). */
function executer(commande, cwd, timeoutMs, surDonnees, capsule) {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', commande]
      : ['-c', commande];
    const debut = Date.now();
    let sortie = '';
    let err = '';
    let code = null;
    let termine = false;

    const enfant = spawn(shell, args, {
      cwd: cwd && estDossier(cwd) ? cwd : process.cwd(),
      env: { ...process.env, ATHENA_LOCAL_AGENT: '1' },
      windowsHide: true,
    });
    enfantsActifs.add(enfant);
    const oublier = () => { enfantsActifs.delete(enfant); };
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
        stdout: sortie.slice(0, MAX_OUT),
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
      if (sortie.length < MAX_OUT) sortie += d;
      diffuser('stdout', d);
    });
    enfant.stderr.on('data', (d) => {
      if (err.length < MAX_OUT) err += d;
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
        stdout: sortie.slice(0, MAX_OUT),
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
      }, origin, req);
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
        brut = await lireCorps(req);
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
      if (!commande || commande.length > 2000 || commande.includes('\0')) {
        json(res, 400, { erreur: 'commande absente ou trop longue' }, origin, req);
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
      const cwdDemande = typeof corps.cwd === 'string' && corps.cwd ? corps.cwd : process.cwd();
      /* v20260926d (kimi) : cwd inexistant = 400 explicite (avant : repli
         silencieux sur le cwd de l'agent — la commande tournait ailleurs).
         v1.2 : test atomique (pas de TOCTOU existsSync→statSync). */
      if (typeof corps.cwd === 'string' && corps.cwd && !estDossier(corps.cwd)) {
        json(res, 400, { erreur: 'répertoire inexistant', cwd: String(corps.cwd).slice(0, 200) }, origin, req);
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
        /* v20260926d : client parti en cours de stream → on tue l'arbre. */
        req.on('close', () => { if (!reponseFinie && capsule.tuer) { try { capsule.tuer(); } catch (_) {} } });
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
          json(res, 403, { erreur: 'dossier hors zone autorisée (--allow)', dossier: base }, origin, req);
          return;
        }
        try {
          fs.mkdirSync(base, { recursive: true });
        } catch (e) {
          json(res, 400, { erreur: 'dossier inutilisable : ' + String((e && e.message) || e).slice(0, 120) }, origin, req);
          return;
        }
      }
      const abs = path.resolve(base, cheminDemande);
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
      if (!baseReelle || !dirReel || !(dirReel === baseReelle || dirReel.startsWith(baseReelle + path.sep))) {
        json(res, 403, { erreur: 'chemin hors zone après résolution des liens', chemin: abs }, origin, req);
        return;
      }
      const fichierReel = cheminReel(abs);
      if (fichierReel && !(fichierReel === abs || fichierReel.startsWith(baseReelle + path.sep))) {
        json(res, 403, { erreur: 'fichier existant hors zone (lien symbolique)', chemin: abs }, origin, req);
        return;
      }
      if (DENY_WRITE.some((re) => re.test(abs))) {
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

    json(res, 404, { erreur: 'route inconnue (GET /sante, GET /journal, POST /exec, POST /write)' }, origin, req);
  } catch (e) {
    json(res, 500, { erreur: String((e && e.message) || e).slice(0, 200) }, origin, req);
  }
});

serveur.listen(PORT, HOST, () => {
  console.log(`[athena-local-agent] v${VERSION} → http://${HOST}:${PORT}`);
  console.log(`  auto=${AUTO} allow=${ALLOW_DIR || '(tout)'}`);
  console.log('  POST /exec {commande, confirme:true, cwd?, timeout_ms?, flux?} (flux:true = NDJSON en direct)');
  console.log('  POST /write {chemin, contenu, confirme:true, ecraser?} (428 = confirmation requise)');
});

/* v1.2 (audit) : arrêt propre — avant, SIGINT tuait le process en laissant
   les enfants tourner (zombies) et les requêtes en plan. */
function arretPropre(signal) {
  console.log(`[local-agent] ${signal} : arrêt (${enfantsActifs.size} commande(s) en cours)…`);
  for (const e of [...enfantsActifs]) { try { tuerArbre(e); } catch (_) {} }
  enfantsActifs.clear();
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', () => arretPropre('SIGINT'));
process.on('SIGTERM', () => arretPropre('SIGTERM'));
