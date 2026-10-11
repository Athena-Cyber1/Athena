/* Commande console : voir quelles versions le site SERT vraiment.
 *
 * A coller dans la console du navigateur (F12), sur localhost ou deployed.
 * Elle interroge le SERVEUR (cache:bust), pas le cache du navigateur, et
 * affiche l'epoch annoncee, la presence du code de coloration, et la
 * version reellement telechargee par la page.
 *
 * Aucune dependance, aucun import.
 */
(async function () {
  const lireUrl = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.src || el.href : '(absent)';
  };
  const epoch = (u) => {
    const m = /[?&]v=([^&"']+)/.exec(u || '');
    return m ? m[1] : '(aucun)';
  };

  const balises = [
    ['JS chat', 'script[src*="chat-demo.js"]'],
    ['CSS     ', 'link[href*="athena-demo.css"]'],
    ['shim    ', 'script[src*="api-shim.js"]'],
    ['vendor 1', 'script[src*="vendor/hljs/highlight.min.js"]'],
    ['vendor 2', 'script[src*="vendor/hljs/languages/powershell"]'],
  ];

  console.log('%c=== versions servies ===', 'color:#fff;background:#333;padding:2px 6px');
  const epochs = [];
  for (const [nom, sel] of balises) {
    const u = lireUrl(sel);
    const e = epoch(u);
    epochs.push(e);
    console.log(nom, '->', e, ' |', (u || '').split('/').pop());
  }
  const uniques = [...new Set(epochs)];
  console.log('%cepoch commune :', uniques.length === 1 ? uniques[0] : 'DIVERGENTE ' + uniques.join(' / '),
    uniques.length === 1 ? '' : '  <-- certains fichiers peuvent rester en cache');

  console.log('%c=== le code de coloration est-il servi ? ===', 'color:#fff;background:#333;padding:2px 6px');
  const r = await fetch('/chat-demo.js?bust=' + Date.now(), { cache: 'no-store' });
  const txt = await r.text();
  const presence = {
    'colorerCodeBloc()': txt.includes('function colorerCodeBloc'),
    'classe "hljs" sur le <code>': txt.includes("codeEl.className = 'hljs"),
    'retourne null si pas de coloration': /return null/.test(txt.slice(txt.indexOf('function colorerCodeBloc'), txt.indexOf('function colorerCodeBloc') + 2000)),
  };
  for (const [k, v] of Object.entries(presence)) console.log((v ? '%cOK   ' : '%cECHEC') + ' ' + k, 'color:' + (v ? '#2b2' : '#d33'));

  console.log('%c=== ce que la PAGE a reellement charge ===', 'color:#fff;background:#333;padding:2px 6px');
  const perf = performance.getEntriesByType('resource')
    .filter((e) => /chat-demo|athena-demo|vendor\/hljs/.test(e.name))
    .map((e) => ({ nom: e.name.split('/').pop(), ko: Math.round(e.transferSize / 1024) + ' Ko' }));
  console.table(perf);
  console.log('coloration active :', (typeof window.hljs !== 'undefined') ? 'OUI, ' + window.hljs.listLanguages().length + ' langages' : 'NON');
})();