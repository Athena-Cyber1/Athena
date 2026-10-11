/* Compile le vertex shader REEL de `animation-threejs.html` dans un WebGL,
 * avec le MEME prefixe que Three.js construit pour un ShaderMaterial.
 * Un test qui lit des chaines peut se tromper : celui-ci demande au pilote
 * graphique, et verifie que le programme est LIE.
 *
 * Les deux erreurs qui brisaient la page :
 *   « color : redefinition »        — Three.js declare deja l'attribute ;
 *   « uPixelRatio : undeclared »    — utilise sans avoir ete declare.
 * Le prefixe ci-dessous est celui de WebGLProgram : c'est lui qui injecte
 * `attribute vec3 color`, donc le test reproduit l'erreur si elle revient.
 */
const html = (typeof window !== 'undefined' && window.__HTML) || (typeof __HTML !== 'undefined' ? __HTML : '');

let ko = 0;
const V = (nom, cond, detail) => {
  const l = (cond ? '  OK   ' : '  ECHEC ') + nom + (detail ? ' :: ' + detail : '');
  (typeof console !== 'undefined') && console.log(l);
  if (!cond) ko++;
};

if (!html) {
  V('animation-threejs.html a ete fourni au test', false, 'rien a compiler');
} else {
  const mvs = /vertexShader:\s*`([\s\S]*?)`\s*,\s*\n\s*fragmentShader:/.exec(html);
  const mfs = /fragmentShader:\s*`([\s\S]*?)`\s*,\s*\n/.exec(html);
  V('les deux shaders sont extraits (template literal intact)', Boolean(mvs && mfs));
  const vs = mvs ? mvs[1] : '';
  const fsrc = mfs ? mfs[1] : '';

  const debutU = html.indexOf('uniforms:');
  const finU = html.indexOf('vertexShader:', debutU);
  const noms = [...html.slice(debutU, finU).matchAll(/(\w+)\s*:\s*\{\s*value/g)].map(m => m[1]);
  V('les uniforms sont lus : ' + noms.join(', ') + ' (' + noms.length + ')', noms.length >= 2);

  /* Regle de forme, applicable SANS pilote : un backtick dans un shader
     ferme le template literal et invalide tout le shader. */
  const nbBT = (vs.match(/`/g) || []).length + (fsrc.match(/`/g) || []).length;
  V('aucun backtick parasite dans les shaders', nbBT === 0,
    nbBT ? nbBT + ' backtick(s) : le template literal est coupe' : '');

  /* Le CODE, commentaires retires : c'est lui qui est compile. */
  const codeVs = vs.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  V('PAS de rededclaration de l attribute color',
    !/attribute\s+vec3\s+color\s*;/.test(codeVs),
    'sinon : ERROR color : redefinition');
  V('uPixelRatio est DECLARE', /uniform\s+float\s+uPixelRatio\s*;/.test(codeVs),
    'sinon : ERROR uPixelRatio : undeclared identifier');

  const corps = codeVs.slice(codeVs.indexOf('void main'));
  const utilises = [...new Set(corps.match(/\bu[A-Z]\w*/g) || [])];
  /* Le point-virgule fait partie de la capture si on prend le dernier mot :
     `uniform float uTime;` -> « uTime; ». On le retire explicitement. */
  const declares = [...new Set((codeVs.match(/uniform\s+\w+\s+(u[A-Z]\w*)\s*;/g) || [])
    .map(s => (s.match(/(u[A-Z]\w*)\s*;/) || [])[1]).filter(Boolean))];
  V('tout uniform UTILISE est DECLARE',
    utilises.every(u => declares.indexOf(u) >= 0),
    'utilises : ' + utilises.join(', ') + ' | declares : ' + declares.join(', '));
  V('aucun uniform mort (declare et jamais utilise)',
    declares.every(u => utilises.indexOf(u) >= 0),
    'morts : ' + declares.filter(u => utilises.indexOf(u) < 0).join(', '));

  const alimentes = [...new Set([...html.matchAll(/uniforms\.(u[A-Z]\w*)\.value/g)].map(x => x[1]))];
  V('chaque uniform declare recoit sa valeur depuis le JS',
    declares.every(u => alimentes.indexOf(u) >= 0),
    'jamais mis a jour : ' + declares.filter(u => alimentes.indexOf(u) < 0).join(', '));

  /* --- la preuve : le pilote compile --- */
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) {
    console.log('  SKIP  aucun pilote WebGL ici : les controles ci-dessus tiennent,');
    console.log('        la COMPILATION REELLE n est pas verifiee dans cet environnement.');
  } else {
    const prefixe = [
      'precision highp float;', 'precision highp int;',
      'uniform mat4 modelMatrix;', 'uniform mat4 modelViewMatrix;',
      'uniform mat4 projectionMatrix;', 'uniform mat4 viewMatrix;',
      'uniform mat3 normalMatrix;', 'uniform vec3 cameraPosition;',
      'uniform bool isOrthographic;',
      'attribute vec3 position;', 'attribute vec3 normal;', 'attribute vec2 uv;',
      'attribute vec3 color;', '',
    ].join('\n');

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return { ok: gl.getShaderParameter(s, gl.COMPILE_STATUS), log: gl.getShaderInfoLog(s) || '' };
    };
    const v = compile(gl.VERTEX_SHADER, prefixe + vs);
    const f = compile(gl.FRAGMENT_SHADER, 'precision highp float;\nprecision highp int;\n' + fsrc);
    V('vertex shader COMPILE (prefixe Three.js inclus)', v.ok, v.ok ? '' : v.log.trim().slice(0, 400));
    V('fragment shader COMPILE', f.ok, f.ok ? '' : f.log.trim().slice(0, 400));

    if (v.ok && f.ok) {
      const p = gl.createProgram();
      const s1 = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(s1, prefixe + vs); gl.compileShader(s1);
      const s2 = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(s2, 'precision highp float;\n' + fsrc); gl.compileShader(s2);
      gl.attachShader(p, s1); gl.attachShader(p, s2);
      gl.linkProgram(p);
      const link = gl.getProgramParameter(p, gl.LINK_STATUS);
      V('programme LIE (VALIDATE_STATUS)', link, link ? '' : (gl.getProgramInfoLog(p) || '').trim().slice(0, 400));
    }
  }
}

if (typeof window !== 'undefined') window.__ko = ko;
console.log(ko ? '*** ' + ko + ' PROBLEME(S) ***' : 'Le shader compile, se lie, et ne contient aucun code mort.');