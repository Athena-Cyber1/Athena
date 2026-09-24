/* Athéna v10.4 — chargeur de thème importé (/api/design).
   1. Au boot : GET /api/design → tokens déjà validés côté serveur → double
      validation client (aucune url(), aucun caractère de break-out) →
      <style id="ath-theme-importe"> :root{…} (gagne la cascade).
   2. Bouton ◐ (#btn-theme) de la coquille : import d'un fichier de design
      (.css/.html/.js/.txt ≤ 300 Ko) OU collage → POST /api/design →
      application immédiate ; « Réinitialiser » → DELETE /api/design.
      Réutilise la modale/le toast du chat si présents, sinon confirm(). */
(function () {
  "use strict";

  var MOTIFS = [
    /url\s*\(/i, /expression\s*\(/i, /@/, /</, />/, /\{/, /\}/, /;/, /\\/,
    /javascript/i, /behavior/i, /binding/i, /import/i, /\/\*/,
  ];
  var AUTORISES = {};
  ["fond", "carte", "carte-doux", "texte", "texte-doux", "bord", "bord-fort",
    "primaire", "primaire-fort", "primaire-doux", "primaire-texte",
    "sur-primaire", "lien",
    "violet", "violet-doux", "violet-texte",
    "ambre-fond", "ambre-bord", "ambre-texte",
    "danger-fond", "danger-bord", "danger-texte",
    "rouge-fond", "rouge-bord", "rouge-texte",
    "gris-fond", "gris-bord", "gris-texte",
    "code-fond", "heros", "ombre",
  ].forEach(function (t) { AUTORISES[t] = true; });

  function valeurSure(v) {
    v = String(v || "").trim();
    if (!v || v.length > 300) return false;
    for (var i = 0; i < MOTIFS.length; i++) if (MOTIFS[i].test(v)) return false;
    return true;
  }

  function appliquerTokens(tokens) {
    var declarations = [];
    Object.keys(tokens || {}).forEach(function (k) {
      var v = String(tokens[k] || "").trim();
      if (AUTORISES[k] && valeurSure(v)) declarations.push("--" + k + ":" + v);
    });
    var ancien = document.getElementById("ath-theme-importe");
    if (ancien) ancien.remove();
    if (!declarations.length) { majReset(false); return false; }
    var st = document.createElement("style");
    st.id = "ath-theme-importe";
    st.textContent = ":root{" + declarations.join(";") + "}";
    document.head.appendChild(st);
    majReset(true);
    return true;
  }

  /* Affordance visible : bouton « Réinitialiser » à côté de #btn-theme
     dès qu'un thème importé est actif (le clic droit restait invisible
     et impossible au toucher). */
  function majReset(actif) {
    var bouton = document.getElementById("btn-theme");
    if (!bouton) return;
    var r = document.getElementById("btn-reset-theme");
    if (!r) {
      r = document.createElement("button");
      r.id = "btn-reset-theme";
      r.type = "button";
      r.className = "side-onglet";
      r.title = "Rétablir le thème par défaut (noir & blanc)";
      r.textContent = "Réinitialiser le thème";
      if (bouton.parentNode) bouton.parentNode.insertBefore(r, bouton.nextSibling);
      r.addEventListener("click", function (e) {
        e.stopPropagation();
        reinitialiser();
      });
    }
    r.hidden = !actif;
  }

  function reinitialiser() {
    fetch("/api/design", { method: "DELETE" })
      .then(function () {
        var ancien = document.getElementById("ath-theme-importe");
        if (ancien) ancien.remove();
        majReset(false);
        notifier("Thème réinitialisé (noir & blanc par défaut, liens rouges).");
      })
      .catch(function () { notifier("Réinitialisation du thème impossible."); });
  }

  function chargerAuDemarrage() {
    fetch("/api/design", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (t) {
        if (t && t.tokens && Object.keys(t.tokens).length) {
          appliquerTokens(t.tokens);
        } else {
          majReset(false);
        }
      })
      .catch(function () {});
  }

  function notifier(message) {
    var zone = document.querySelector(".chat-shell");
    if (!zone) return;
    var t = document.createElement("div");
    t.className = "toast-notice";
    t.setAttribute("role", "status");
    var m = document.createElement("div");
    m.className = "toast-message";
    m.textContent = message;
    t.appendChild(m);
    zone.appendChild(t);
    setTimeout(function () {
      t.classList.add("part");
      setTimeout(function () { t.remove(); }, 280);
    }, 4200);
  }

  function envoyerDesign(contenu, nom) {
    fetch("/api/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenu: contenu, nom: nom || "design" }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          notifier("Thème refusé : " + (res.d.erreur || "contenu non valide."));
          return;
        }
        var n = appliquerTokens(res.d.tokens || {});
        notifier(n
          ? "Thème « " + (res.d.nom || "importé") + " » appliqué (" + Object.keys(res.d.tokens || {}).length + " tokens)."
          : "Aucun token de thème exploitable dans ce contenu — design par défaut conservé.");
      })
      .catch(function () { notifier("Import de thème impossible (service injoignable)."); });
  }

  function brancherBouton() {
    var bouton = document.getElementById("btn-theme");
    if (!bouton) return;
    var entree = document.createElement("input");
    entree.type = "file";
    entree.accept = ".css,.html,.htm,.js,.txt,.json,text/css,text/html,text/plain";
    entree.hidden = true;
    document.body.appendChild(entree);
    entree.addEventListener("change", function () {
      var f = entree.files && entree.files[0];
      entree.value = "";
      if (!f) return;
      if (f.size > 300000) { notifier("Fichier trop gros (300 Ko max)."); return; }
      var lecteur = new FileReader();
      lecteur.onload = function () { envoyerDesign(String(lecteur.result || ""), f.name); };
      lecteur.onerror = function () { notifier("Lecture du fichier impossible."); };
      lecteur.readAsText(f);
    });
    bouton.addEventListener("click", function () {
      entree.click();
    });
    /* Clic droit conservé comme raccourci power-user ; l'affordance
       principale est le bouton #btn-reset-theme visible. */
    bouton.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      reinitialiser();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      chargerAuDemarrage();
      brancherBouton();
    });
  } else {
    chargerAuDemarrage();
    brancherBouton();
  }
})();
