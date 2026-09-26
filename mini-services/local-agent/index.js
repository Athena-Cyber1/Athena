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
const VERSION = '1.1.0';
const AUTO = process.argv.includes('--auto');
const TIMEOUT_MS = 20000;
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
  /:\(\)\s*\{.*\|.*&.*\};/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwget\b.*\|\s*(ba)?sh\b/i,
  /\bInvoke-Expression\b|\bIEX\b/i,
  /\bStop-Computer\b|\bRestart-Computer\b/i,
  /\breg\s+delete\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /--no-preserve-root/i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\btaskkill\b.*\/f.*\/im\s+(csrss|lsass|winlogon)/i,
];

const journal = [];

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
     127.0.0.1 — le preflight exige cet en-tête sinon fetch échoue. */
  if (req && req.headers && (req.headers['access-control-request-private-network'] || req.headers['access-control-request-private-network'] === 'true')) {
    h['Access-Control-Allow-Private-Network'] = 'true';
  } else {
    h['Access-Control-Allow-Private-Network'] = 'true';
  }
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
        reject(new Error('corps trop volumineux'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(t));
    req.on('error', reject);
  });
}

function refus(cmd) {
  for (const re of DENY) if (re.test(cmd)) return re.toString().slice(0, 80);
  return null;
}

function dansAllowDir(cwd) {
  if (!ALLOW_DIR) return true;
  const abs = path.resolve(cwd || process.cwd());
  return abs === ALLOW_DIR || abs.startsWith(ALLOW_DIR + path.sep);
}

/* v1.1 (direct) : surDonnees(canal, texte) optionnel — appelé à chaque
   paquet stdout/stderr pour la diffusion EN DIRECT (NDJSON) ; sans lui,
   comportement historique (attente de la fin). */
function executer(commande, cwd, timeoutMs, surDonnees) {
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
      cwd: cwd && fs.existsSync(cwd) ? cwd : process.cwd(),
      env: { ...process.env, ATHENA_LOCAL_AGENT: '1' },
      windowsHide: true,
    });

    const coupe = setTimeout(() => {
      if (termine) return;
      termine = true;
      try { enfant.kill('SIGKILL'); } catch (_) {}
      resolve({
        ok: false,
        code: null,
        signal: 'TIMEOUT',
        stdout: sortie.slice(0, MAX_OUT),
        stderr: (err + `\n[timeout ${timeoutMs} ms]`).slice(0, MAX_OUT),
        duree_ms: Date.now() - debut,
      });
    }, timeoutMs);

    enfant.stdout.on('data', (d) => {
      if (sortie.length < MAX_OUT) sortie += d;
      if (typeof surDonnees === 'function') {
        try { surDonnees('stdout', String(d).slice(0, 8000)); } catch (_) {}
      }
    });
    enfant.stderr.on('data', (d) => {
      if (err.length < MAX_OUT) err += d;
      if (typeof surDonnees === 'function') {
        try { surDonnees('stderr', String(d).slice(0, 8000)); } catch (_) {}
      }
    });
    enfant.on('error', (e) => {
      if (termine) return;
      termine = true;
      clearTimeout(coupe);
      resolve({ ok: false, code: null, signal: null, stdout: sortie, stderr: String(e.message || e), duree_ms: Date.now() - debut });
    });
    enfant.on('close', (c) => {
      if (termine) return;
      termine = true;
      clearTimeout(coupe);
      code = c;
      resolve({
        ok: c === 0,
        code: c,
        signal: null,
        stdout: sortie.slice(0, MAX_OUT),
        stderr: err.slice(0, MAX_OUT),
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
      json(res, 200, {
        ok: true,
        service: 'athena-local-agent',
        version: VERSION,
        auto: AUTO,
        allow_dir: ALLOW_DIR,
        platform: process.platform,
        user: os.userInfo().username,
        host: os.hostname(),
      }, origin, req);
      return;
    }

    if (req.method === 'GET' && chemin === '/journal') {
      json(res, 200, { entrees: journal.slice(-50) }, origin, req);
      return;
    }

    if (req.method === 'POST' && chemin === '/exec') {
      const brut = await lireCorps(req);
      let corps = {};
      try { corps = JSON.parse(brut || '{}'); } catch (_) {}
      const commande = String(corps.commande || corps.command || '').trim();
      if (!commande || commande.length > 2000) {
        json(res, 400, { erreur: 'commande absente ou trop longue' }, origin, req);
        return;
      }
      const confirme = corps.confirme === true || AUTO;
      const motif = refus(commande);
      if (motif) {
        json(res, 403, { erreur: 'commande bloquée par la liste de refus', motif }, origin, req);
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
      const cwd = typeof corps.cwd === 'string' && corps.cwd ? corps.cwd : process.cwd();
      if (!dansAllowDir(cwd)) {
        json(res, 403, { erreur: 'répertoire hors zone autorisée (--allow)' }, origin, req);
        return;
      }
      const t = Math.min(Number(corps.timeout_ms) || TIMEOUT_MS, TIMEOUT_MS);
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
        const rf = await executer(commande, cwd, t, (canal, texte) => {
          ligne({ type: 'sortie', canal, texte });
        });
        const entreef = {
          ts: Date.now(),
          commande: commande.slice(0, 200),
          ok: rf.ok,
          code: rf.code,
          duree_ms: rf.duree_ms,
        };
        journal.push(entreef);
        if (journal.length > 200) journal.shift();
        console.log(`[local-agent] ${rf.ok ? 'OK' : 'ERR'} code=${rf.code} ${rf.duree_ms}ms :: ${entreef.commande}`);
        ligne({ type: 'fin', ...rf, commande });
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
      journal.push(entree);
      if (journal.length > 200) journal.shift();
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
      const brutw = await lireCorps(req, 3 * 1024 * 1024);
      let corpsw = {};
      try { corpsw = JSON.parse(brutw || '{}'); } catch (_) {}
      const cheminDemande = String(corpsw.chemin || corpsw.path || '').trim();
      const contenu = typeof corpsw.contenu === 'string' ? corpsw.contenu : null;
      if (!cheminDemande || cheminDemande.length > 500 || contenu == null) {
        json(res, 400, { erreur: 'chemin (≤500 car.) et contenu requis' }, origin, req);
        return;
      }
      if (contenu.length > MAX_WRITE) {
        json(res, 413, { erreur: 'contenu trop volumineux (limite 2 Mo)' }, origin, req);
        return;
      }
      const abs = path.resolve(process.cwd(), cheminDemande);
      if (DENY_WRITE.some((re) => re.test(abs))) {
        json(res, 403, { erreur: 'écriture bloquée : dossier système', chemin: abs }, origin, req);
        return;
      }
      let existe = false;
      try { existe = fs.existsSync(abs) && fs.statSync(abs).isFile(); } catch (_) { existe = false; }
      const confirmew = corpsw.confirme === true || AUTO;
      if (!confirmew) {
        json(res, 428, {
          erreur: 'confirmation requise',
          chemin: abs,
          existe,
          octets: contenu.length,
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
      const entreew = { ts: Date.now(), ecriture: abs.slice(0, 300), octets: contenu.length, ecrase: existe };
      journal.push(entreew);
      if (journal.length > 200) journal.shift();
      console.log(`[local-agent] WRITE ${contenu.length}o ${existe ? '(écrasé)' : ''} :: ${entreew.ecriture}`);
      json(res, 200, { ok: true, chemin: abs, octets: contenu.length, ecrase: existe }, origin, req);
      return;
    }

    json(res, 404, { erreur: 'route inconnue (GET /sante, GET /journal, POST /exec, POST /write)' }, origin, req);
  } catch (e) {
    json(res, 500, { erreur: String((e && e.message) || e).slice(0, 200) }, origin, req);
  }
});

serveur.listen(PORT, HOST, () => {
  console.log(`[athena-local-agent] v${VERSION} → http://${HOST}:${PORT}`);
  console.log(`  auto=${AUTO} allow=${ALLOW_DIR || '(tout)'} user=${os.userInfo().username}`);
  console.log('  POST /exec {commande, confirme:true, cwd?, timeout_ms?, flux?} (flux:true = NDJSON en direct)');
  console.log('  POST /write {chemin, contenu, confirme:true, ecraser?} (428 = confirmation requise)');
});
