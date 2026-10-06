/* tests/agent-fixes.test.cjs — §8.3/§8.4 : tests d'intégration local-agent.
   Vérifie les correctifs v1.2 : DENY_WRITE AVANT tout mkdir (aucun dossier
   système créé, message avec le chemin), sortie LONGUE tronquée au milieu
   (tête ET queue conservées), UTF-8 intact (setEncoding + OutputEncoding PS).
   S'exécute seul (auto-start :3020 si besoin) ou sur un agent déjà levé.
   Windows et Linux (CI ubuntu) : les commandes sont adaptées par plateforme. */
const { spawn } = require('child_process');
const path = require('path');

const B = 'http://127.0.0.1:3020';
const WIN = process.platform === 'win32';
/* Zone interdite par DENY_WRITE (index.js) : C:\Windows… ou /etc… */
const DOSSIER_INTERDIT = WIN ? 'C:\\Windows\\athena-deny-probe-tmp' : '/etc/athena-deny-probe-tmp';
const CHEMIN_MOTIF = WIN ? 'C:' : '/etc';

const CMD = {
  existe: WIN
    ? "Test-Path -LiteralPath '" + DOSSIER_INTERDIT + "'"
    : "[ -d '" + DOSSIER_INTERDIT + "' ] && echo True || echo False",
  longue: WIN
    ? "for($i=0;$i -lt 400;$i++){ 'L' + $i + ' ' + ('x' * 300) }"
    : "i=0; while [ $i -lt 400 ]; do printf 'L%s ' \"$i\"; printf 'x%.0s' $(seq 1 300); printf '\\n'; i=$((i+1)); done",
  utf8: WIN
    ? "Write-Output 'café 中文 😀'"
    : "printf '%s\\n' 'café 中文 😀'",
};

let echecs = 0;
const V = (ok, txt, det) => {
  console.log((ok ? '  OK  ' : '  ECHEC  ') + txt + (det ? ' :: ' + det : ''));
  if (!ok) echecs++;
};

function post(route, corps) {
  return fetch(B + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify(corps),
  }).then(async (r) => ({ st: r.status, j: await r.json().catch(() => ({})) }));
}

async function sante() {
  try {
    const r = await fetch(B + '/sante', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch (_) { return false; }
}

async function attendreAgent(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await sante()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  /* Auto-start : on ne casse pas un agent déjà vivant (usage local). */
  let demarre = false;
  if (!(await sante())) {
    const enfant = spawn(process.execPath, [path.join(__dirname, '..', 'mini-services', 'local-agent', 'index.js')], {
      cwd: path.join(__dirname, '..'),
      stdio: 'ignore',
      detached: true,
    });
    enfant.unref();
    demarre = true;
    if (!(await attendreAgent(15000))) {
      console.log('  ECHEC  agent :3020 injoignable (auto-start impossible)');
      process.exit(1);
    }
  }

  /* 1. DENY_WRITE AVANT mkdir : 403 avec chemin + AUCUNE trace sur disque. */
  const w = await post('/write', {
    chemin: 'x.txt', dossier: DOSSIER_INTERDIT, contenu: 'test', confirme: true,
  });
  V(w.st === 403, 'write dossier systeme -> 403', 'st=' + w.st + ' ' + JSON.stringify(w.j));
  V(String(w.j.erreur || '').includes(CHEMIN_MOTIF), 'message 403 contient le chemin', String(w.j.erreur));
  const v = await post('/exec', { commande: CMD.existe, confirme: true });
  V(!/True/i.test(String(v.j.stdout || '')), 'aucun dossier cree dans la zone refusee', JSON.stringify(v.j.stdout || v.j.erreur));

  /* 2. Sortie LONGUE (> MAX_OUT) : tête et queue conservées. */
  const e2 = await post('/exec', { commande: CMD.longue, confirme: true, timeout_ms: 30000 });
  const s2 = String(e2.j.stdout || '');
  V(s2.includes('[sortie tronquée au milieu'), 'sortie > MAX_OUT tronquee au milieu', 'len=' + s2.length);
  V(/^L0 /.test(s2), 'DEBUT de sortie conserve (tete)', JSON.stringify(s2.slice(0, 40)));
  V(/L399 /.test(s2), 'FIN de sortie conservee (queue)', JSON.stringify(s2.slice(-60)));

  /* 3. UTF-8 : multioctets intacts (setEncoding node + OutputEncoding PS). */
  const e3 = await post('/exec', { commande: CMD.utf8, confirme: true });
  const s3 = String(e3.j.stdout || '');
  V(s3.includes('café') && s3.includes('中文') && s3.includes('😀'), 'UTF-8 intact (pas de mojibake)', JSON.stringify(s3.trim()));

  console.log(echecs ? `  RESULTAT: ${echecs} ECHEC(S)` : '  RESULTAT: 7/7 OK' + (demarre ? ' (agent auto-start)' : ''));
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
