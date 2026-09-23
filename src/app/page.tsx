import Script from "next/script";
import "./athena-demo.css";

/**
 * Coquille serveur du portage v10.6 : TOUTE la structure DOM attendue par le
 * chat-demo.js UTILISATEUR (v20260922l) est rendue ici, en SSR.
 *
 * Design (demandes explicites de l'utilisateur) :
 *  - palette MONOCHROME : blanc/noir en mode clair, noir/blanc en mode sombre ;
 *  - le ROUGE est réservé aux liens (voir athena-demo.css) ;
 *  - ZÉRO émoji : uniquement des symboles typographiques monochromes
 *    (◆ ▣ ⚙︎ ◐ ⊙ ＋ ▾ ☰ ↵ ? — les engrenages/balances forcent le rendu
 *    texte via U+FE0E pour ne jamais tomber sur un glyphe couleur) ;
 *  - l'épingle (trombone) du composeur est remplacée par un « ＋ » ;
 *  - PAS de pied de page (supprimé à la demande) ;
 *  - barre latérale réorganisée : marque → nouvelle discussion → bloc
 *    « Conversations » (titre + recherche + liste) → section « Projets » →
 *    pied en tuiles égales (Projets · Paramètres · Thème) → compte.
 *
 * Règles d'intégration (exigences du JS utilisateur) :
 *  - #saisie est un <input type="text"> (Entrée = envoi natif du formulaire) ;
 *  - #btn est type="submit" DANS #form (toggle envoi/arrêt via submit) ;
 *  - #dot ne porte que la classe "dot" (className réécrit par le JS) ;
 *  - #menu-compte démarre hidden ; #msgs est le conteneur scrollable ;
 *  - .chat-shell est position:relative (reçoit pastille + toasts) ;
 *  - ne PAS pré-créer : import-fichiers, entrainement-* (créés par le JS).
 */
export default function Accueil() {
  return (
    <div className="page-demo">
      <div id="app">
        {/* ————— Barre latérale ————— */}
        <aside id="sidebar" className="sidebar" aria-label="Barre latérale">
          <div className="side-head">
            <div className="marque">
              <span className="marque-icone" aria-hidden="true">
                ◆
              </span>
              <span className="marque-nom">Athéna</span>
              <span className="marque-version">v10.9.4</span>
            </div>
          </div>

          <div className="side-corps">
            <button id="nouvelle-discussion" type="button" className="btn-nouvelle">
              <span aria-hidden="true">＋</span> Nouvelle discussion
            </button>

            <div className="side-bloc">
              <div className="side-bloc-titre">
                <span>Conversations</span>
              </div>
              <div className="side-recherche">
                <input
                  id="recherche-conversations"
                  type="search"
                  className="recherche"
                  placeholder="Rechercher…"
                  aria-label="Rechercher une conversation"
                  autoComplete="off"
                />
                <button
                  id="plier-conversations"
                  type="button"
                  className="plier"
                  title="Plier / déplier la liste"
                  aria-label="Plier la liste des conversations"
                  aria-expanded="true"
                  aria-controls="liste-conversations"
                >
                  ▾
                </button>
              </div>
              <nav
                id="liste-conversations"
                className="liste-conversations"
                aria-label="Conversations"
              ></nav>
              <p id="aucun-resultat" className="aucun-resultat" hidden>
                Aucun résultat pour cette recherche.
              </p>
            </div>

            <div className="side-section">
              <div className="side-section-titre">
                <span>Projets</span>
                <button
                  id="ajouter-projet"
                  type="button"
                  className="btn-plus"
                  title="Nouveau projet (conversation épinglée)"
                  aria-label="Nouveau projet"
                >
                  ＋
                </button>
              </div>
              <div id="liste-projets"></div>
              <p className="project-empty">Aucun projet épinglé.</p>
            </div>
          </div>

          <div className="side-pied">
            <div className="side-actions">
              <button id="ouvrir-projets" type="button" className="side-onglet">
                <span className="onglet-ico" aria-hidden="true">
                  ▣
                </span>
                <span className="onglet-lib">Projets</span>
              </button>
              <button id="ouvrir-parametres" type="button" className="side-onglet">
                <span className="onglet-ico" aria-hidden="true">
                  {"\u2699\uFE0E"}
                </span>
                <span className="onglet-lib">Paramètres</span>
              </button>
              <button id="btn-theme" type="button" className="side-onglet">
                <span className="onglet-ico" aria-hidden="true">
                  ◐
                </span>
                <span className="onglet-lib">Thème…</span>
              </button>
            </div>

            <div className="compte-wrap">
              <button
                id="ouvrir-compte"
                type="button"
                className="compte-bouton"
                aria-haspopup="menu"
                aria-expanded="false"
                aria-controls="menu-compte"
              >
                <span className="avatar" aria-hidden="true">
                  N
                </span>
                <span className="compte-infos">
                  <span className="compte-nom">Neyzoxx</span>
                  <small>Plan gratuit · local</small>
                </span>
              </button>
              <div id="menu-compte" className="menu-compte" hidden role="menu" aria-label="Menu du compte">
                <button id="gerer-compte" type="button" role="menuitem">
                  <span aria-hidden="true">⊙</span> Gérer le compte
                </button>
                <button id="preferences-compte" type="button" role="menuitem">
                  <span aria-hidden="true">{"\u2699\uFE0E"}</span> Préférences
                </button>
                <button id="aide-compte" type="button" role="menuitem">
                  <span aria-hidden="true">?</span> Aide et assistance
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* ————— Zone de discussion ————— */}
        <main className="chat-shell">
          <header className="chat-tete">
            <button
              id="bascule-sidebar"
              type="button"
              className="bascule"
              title="Réduire la barre latérale (Ctrl+B)"
              aria-label="Réduire la barre latérale"
              aria-expanded="true"
              aria-controls="sidebar"
            >
              <span className="bascule-ico" aria-hidden="true">
                ☰
              </span>
            </button>
            <div className="chat-marque">
              <h1>Athéna</h1>
            </div>
            <div className="etat-moteur" role="status" aria-label="État du moteur">
              <span id="dot" className="dot" aria-hidden="true"></span>
              {/* v10.6 (F21) : état initial explicite — plus de « … » muet,
                  la sonde sonder() le remplace à la 1re mesure. */}
              <span id="statut">vérification…</span>
            </div>
            {/* v10.9.4 (HUD) — sélecteur de modèle de langue : badge compact du
                modèle actif (« auto » = cascade par défaut) + panneau overlay
                (contenu rendu par chat-demo.js : sections Actif / Cloud / Local). */}
            <div className="hud-modele-wrap">
              <button
                id="btn-modele"
                type="button"
                className="btn-modele"
                aria-haspopup="dialog"
                aria-expanded="false"
                aria-controls="hud-modeles"
                title="Modèle de langue — auto = cascade (gratuit → zai)"
              >
                <span id="modele-actif-nom" className="modele-actif-nom">
                  auto
                </span>
                <span className="modele-ico" aria-hidden="true">
                  ▾
                </span>
              </button>
              <div
                id="hud-modeles"
                className="hud-modeles"
                hidden
                role="dialog"
                aria-label="Choisir le modèle de langue"
              ></div>
            </div>
          </header>

          <div
            id="msgs"
            className="msgs"
            role="log"
            aria-live="polite"
            aria-label="Fil de discussion"
          ></div>

          <div id="file-preview" className="file-preview" aria-live="polite"></div>

          <form id="form" className="composeur">
            <div className="composeur-carte">
              <button
                id="attacher"
                type="button"
                className="btn-attacher"
                title="Joindre un fichier (Alt+A)"
                aria-label="Joindre un fichier"
              >
                ＋
              </button>
              <input
                id="saisie"
                name="saisie"
                type="text"
                className="saisie"
                autoComplete="off"
                placeholder="Écrivez à Athéna — je planifie, j'agis, je vérifie…"
                aria-label="Votre message"
              />
              <span id="compteur-saisie" className="compteur-saisie" aria-live="off">
                0 / 4000
              </span>
              <button
                id="btn"
                type="submit"
                className="btn-envoyer"
                title="Envoyer"
                aria-label="Envoyer"
              >
                ↵
              </button>
            </div>
            <input id="fichiers" type="file" multiple hidden aria-hidden="true" tabIndex={-1} />
          </form>
        </main>
      </div>

      {/* Chargeur de thème importé (/api/design) AVANT l'application. */}
      <Script src="/demo/theme-loader.js" strategy="afterInteractive" />
      <Script src="/demo/chat-demo.js" strategy="afterInteractive" />
    </div>
  );
}
