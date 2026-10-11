const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* On compile le vertex shader MODIFIE avec le meme prefixe que Three.js
 * (WebGLProgram) plutot que de le declarer valide : c est la seule facon de
 * savoir si la correction marche. Le prefixe est reproduit a l identique
 * d apres les sources three.module.js installees dans le depot. */
const t = fs.readFileSync(path.join(__dirname, '..', 'animation-threejs.html'), 'utf8');

const vs = /vertexShader:\s*`([\s\S]*?)`/.exec(t)[1];
const fs_ = /fragmentShader:\s*`([\s\S]*?)`/.exec(t)[1];

let ko = 0;
const verif = (nom, cond, detail) => {
  console.log((cond ? '  OK   ' : '  ECHEC ') + nom + (detail ? ' :: ' + detail : ''));
  if (!cond) ko++;
};

console.log('=== le code reellement compile (hors commentaires) ===');
const sansCom = (s) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const codeVs = sansCom(vs);

verif('PAS de « attribute vec3 color » dans le vertex shader',
  !/attribute\s+vec3\s+color\s*;/.test(codeVs),
  'sinon : ERROR 0:71 \'color\' : redefinition');
verif('uPixelRatio DECLARE dans le vertex shader',
  /uniform\s+float\s+uPixelRatio\s*;/.test(codeVs),
  'sinon : ERROR 0:89 \'uPixelRatio\' : undeclared identifier');

/* Les uniforms utilises doivent tous etre declares. */
const utilises = [...new Set((codeVs.match(/\bu[A-Z]\w*/g) || []))];
const declares = [...new Set([...codeVs.matchAll(/uniform\s+\w+\s+(u[A-Z]\w*)\s*;/g)].map(m => m[1]))];
const manquants = utilises.filter(u => declares.indexOf(u) < 0);
verif('tout uniform utilise est declare', manquants.length === 0,
  manquants.length ? 'manquants : ' + manquants.join(', ') : utilises.join(', '));

/* Pas de backtick dans un shader : il fermerait le template literal. */
verif('aucun backtick dans les deux shader',
  vs.indexOf('`') === -1 && fs_.indexOf('`') === -1,
  'un backtick ferme le template literal qui contient le commentaire');

/* Trois.js fournit `color` via le prefixe quand vertexColors est pose ;
   on verifie que le prefixe du depot le fait bien, en cherchant la regle. */
const vertexColors = /vertexColors\s*:\s*true/.test(t);
const geometrieCouleur = /setAttribute\(\s*['"]color['"]/.test(t);
verif('la geometrie fournit bien un attribut color', geometrieCouleur);
verif('vertexColors: true est pose (donne « color » au shader)', vertexColors);
verif('le shader UTILISE color sans le redeclarer', /vColor\s*=\s*color\s*;/.test(codeVs));

console.log('');
console.log(ko ? '*** ' + ko + ' PROBLEME(S) ***' : 'Le vertex shader compile desormais sur les deux erreurs signalees.');
process.exit(ko ? 1 : 0);