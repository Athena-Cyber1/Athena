/* Reproduit LE CAS DE LA CI : le fichier arrive avec des fins de ligne LF au
   lieu de CRLF. Le garde doitconsiderer que c'est le MEME fichier — sinon il
   bloque tout build non-Windows. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = path.join(__dirname, '..');
const outil = path.join(dir, 'tools', 'cache-version.js');
const cible = path.join(dir, 'design', 'theme-loader.js');
const avant = fs.readFileSync(cible, 'utf8');

const lancer = () => execFileSync(process.execPath, [outil], { cwd: dir, encoding: 'utf8' });

console.log('fichier : ' + avant.length + ' car., CRLF=' + (avant.match(/\r\n/g) || []).length);
console.log('  reference          : ' + lancer().trim());

// ecrire la version LF (ce que fait un checkout sous Linux)
fs.writeFileSync(cible, avant.replace(/\r\n/g, '\n'));
try {
  lancer();
  console.log('  apres conversion LF : OK (conserve)  <- le garde ne doit PAS crier');
} catch (e) {
  console.log('  apres conversion LF : ECHEC');
  console.log('    ' + String(e.stdout || '').trim());
}

fs.writeFileSync(cible, avant);

// et une VRAIE modification doit toujours etre detectee
fs.writeFileSync(cible, avant + '\n/* vraie modification */\n');
try {
  lancer();
  console.log('  vraie modification   : NON DETECTEE  <<< le garde ne sert plus a rien');
  process.exitCode = 1;
} catch (e) {
  const sortie = String(e.stdout || '') + String(e.stderr || '');
  console.log('  vraie modification   : DETECTEE (' + (sortie.match(/contenu modifie/) ? 'bon motif' : 'AUTRE MOTIF : ' + sortie.trim().slice(0, 200)) + ')');
}
fs.writeFileSync(cible, avant);
console.log('restaure');
try { lancer(); console.log('  final               : ' + 'OK'); } catch (e) { console.log('  final : ECHEC'); process.exitCode = 1; }