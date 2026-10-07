/* Régression J1 : la borne d'appel à l'agent doit couvrir la LECTURE DU CORPS,
   pas seulement la réception des en-têtes.
   Symptôme : `fetch` se résout dès les en-têtes ; le minuteur était levé dans
   `.finally`, donc avant que `.json()` / `.text()` n'ait lu quoi que ce soit.
   Un agent qui renvoyait les en-têtes puis se taisait laissait l'appel pendre
   sans fin — l'accroche « Délai dépassé » annoncée n'était jamais émise. */
const http = require("http");
const assert = require("assert");

const BORNES = {_MS: 300};
const ATTENTE = 1200;

/* Serveur piège : répond 200 + en-têtes, puis n'écrit JAMAIS le corps. */
function piege() {
  return http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "9999" });
    res.flushHeaders();
    /* on ne termine jamais : le client reste coincé sur la lecture */
  });
}

/* Ancienne logique (celle d'avant la correction) : `fetch` est rendu à
   l'appelant, le minuteur est levé dans `.finally` — donc à la réception des
   EN-TÊTES — et c'est l'appelant qui lit ensuite le corps. */
function appelAgentAvant(url, ms) {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .then((r) => r)                                  // <- rendu dès l'en-tête
    .catch((e) => { if (e && e.name === "AbortError") return null; throw e; })
    .finally(() => clearTimeout(minuterie))           // <- minuteur levé ICI
    .then((r) => (r ? r.json() : "delai"));           // <- lecture par l'appelant, sans borne
}

/* Logique corrigée : le corps est bufferisé AVANT de rendre la main, donc la
   borne reste active pendant toute la lecture. */
function appelAgentApres(url, ms) {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .then(async (r) => {
      const tampon = await r.arrayBuffer();
      return new Response(tampon, { status: r.status, statusText: r.statusText, headers: r.headers });
    })
    .then((r) => r.json())
    .catch((e) => { if (e && e.name === "AbortError") return "delai"; return "autre:" + e.message; })
    .finally(() => clearTimeout(minuterie));
}

/* Course entre l'appel et un garde-fou externe : renvoie la réponse si elle
   arrive, sinon 'PENDANT' — c'est exactement ce que voyait l'utilisateur. */
function sousBorne(promesse, ms) {
  return Promise.race([
    promesse,
    new Promise((r) => setTimeout(() => r("PENDANT"), ms)),
  ]);
}

(async () => {
  const serveur = piege();
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + serveur.address().port + "/muet";

  let ok = 0, ko = 0;
  const verifier = (nom, cond, detail) => {
    if (cond) { ok++; console.log("OK   " + nom + (detail ? " :: " + detail : "")); }
    else { ko++; console.log("ECHEC " + nom + (detail ? " :: " + detail : "")); }
  };

  /* 1) L'ancien code pend : la promesse ne se résout pas (bouton figé). */
  const avant = await sousBorne(appelAgentAvant(url, BORNES._MS), ATTENTE);
  verifier("ancien code : pend au-dela de la borne (bug)", avant === "PENDANT", avant);

  /* 2) Le code corrigé, lui, expirent — et le signale. */
  const apres = await sousBorne(appelAgentApres(url, BORNES._MS), ATTENTE);
  verifier("code corrige : la borne couvre la lecture du corps", apres === "delai", apres);

  /* 3) Une réponse normale reste inchangée (pas de régression). */
  const srv2 = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, n: 42 }));
  });
  await new Promise((r) => srv2.listen(0, "127.0.0.1", r));
  const url2 = "http://127.0.0.1:" + srv2.address().port + "/ok";
  const data = await appelAgentApres(url2, 3000);
  verifier("reponse normale preservee", data && data.ok === true && data.n === 42, JSON.stringify(data));

  /* On laisse l'annulation se stabiliser avant de fermer : sous Windows, un
   `closeAllConnections()` effectué pendant un `AbortController` encore en cours
   fait
   exploser l'assertion native UV_HANDLE_CLOSING à la sortie du process. */
await new Promise((r) => setTimeout(r, 400));
  serveur.closeAllConnections();
  srv2.closeAllConnections();
  serveur.close();
  srv2.close();
  console.log("RESULTAT: " + ok + "/" + (ok + ko) + (ko ? " ECHEC" : " OK"));
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error("ERREUR", e && e.message); process.exit(1); });