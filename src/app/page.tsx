import Script from "next/script";
import "../../design/athena-demo.css";

/**
 * Coquille SSR alignée sur docs/index.html (GitHub Pages) — même DOM,
 * mêmes ids/classes, mêmes scripts (?v= cache-bust).
 */
export default function Accueil() {
  return (
    <div className="page-demo">
      <div id="app">
        <aside id="sidebar" className="sidebar" aria-label="Barre latérale">
          <div className="side-corps">
            <div className="side-brand">
              <span>Athéna</span>
            </div>
            <button id="nouvelle-discussion" type="button" className="btn-nouvelle">
              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Nouvelle discussion
            </button>

            <nav className="side-nav" aria-label="Navigation principale">
              <button id="nav-projets" className="side-nav-item" type="button">
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.2L11 6.5H18A2.5 2.5 0 0 1 20.5 9v7.5A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" /></svg>
                <span>Projets</span>
              </button>
              <button id="nav-artefacts" className="side-nav-item" type="button">
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 4-7 4-7-4 7-4Z" /><path d="m5 12 7 4 7-4M5 17l7 4 7-4" /></svg>
                <span>Artefacts</span>
              </button>
              <button id="nav-code" className="side-nav-item" type="button">
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" /></svg>
                <span>Code</span>
                <span className="nav-badge">Mettre à niveau</span>
              </button>
              <button id="nav-personnaliser" className="side-nav-item" type="button">
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h16v11H4zM8 8.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2.5M4 12h16M10 12v2h4v-2" /></svg>
                <span>Personnaliser</span>
              </button>
            </nav>

            <div className="side-bloc">
              <div className="side-bloc-titre">
                <span>Discussions et tâches</span>
                <button id="filtre-discussions" className="filtre-discussions" type="button" title="Filtrer les discussions" aria-label="Filtrer les discussions">
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                </button>
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
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
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

            <div className="side-section" hidden>
              <div className="side-section-titre">
                <span>Projets</span>
                <button
                  id="ajouter-projet"
                  type="button"
                  className="btn-plus"
                  title="Nouveau projet (conversation épinglée)"
                  aria-label="Nouveau projet"
                >
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              </div>
              <div id="liste-projets"></div>
              <p className="project-empty">Aucun projet épinglé.</p>
            </div>
          </div>

          <div className="side-pied">
            <div className="side-actions" hidden>
              <button id="ouvrir-projets" type="button" className="side-onglet">
                <span className="onglet-ico" aria-hidden="true">
                  <svg className="ico" viewBox="0 0 24 24"><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.2L11 6.5H18A2.5 2.5 0 0 1 20.5 9v7.5A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" /></svg>
                </span>
                <span className="onglet-lib">Projets</span>
              </button>
              <button id="ouvrir-parametres" type="button" className="side-onglet">
                <span className="onglet-ico" aria-hidden="true">
                  <svg className="ico" viewBox="0 0 24 24"><path d="M4 7.5h8M17.5 7.5H20M4 16.5h3.5M13 16.5H20" /><circle cx="14.5" cy="7.5" r="2.2" /><circle cx="10" cy="16.5" r="2.2" /></svg>
                </span>
                <span className="onglet-lib">Paramètres</span>
              </button>
              <button id="btn-theme" type="button" className="side-onglet">
                <span className="onglet-ico" aria-hidden="true">
                  <svg className="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" /></svg>
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
                <span className="avatar" aria-hidden="true">N</span>
                <span className="compte-infos">
                  <span className="compte-nom">Neyzoxx</span>
                  <small>Free</small>
                </span>
              </button>
              <div id="menu-compte" className="menu-compte" hidden role="menu" aria-label="Menu du compte">
                <button id="gerer-compte" type="button" role="menuitem">
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5.5 19.5c1.4-3 3.8-4.5 6.5-4.5s5.1 1.5 6.5 4.5" /></svg> Gérer le compte
                </button>
                <button id="preferences-compte" type="button" role="menuitem">
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h8M17.5 7.5H20M4 16.5h3.5M13 16.5H20" /><circle cx="14.5" cy="7.5" r="2.2" /><circle cx="10" cy="16.5" r="2.2" /></svg> Préférences
                </button>
                <button id="aide-compte" type="button" role="menuitem">
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .9-1 1.6v.3" /><path d="M12 16.8h.01" /></svg> Aide et assistance
                </button>
              </div>
            </div>
            <div className="side-utilitaires">
              <button id="telecharger-conversations" type="button" title="Télécharger les conversations" aria-label="Télécharger les conversations">
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 3.5-3.5M12 14.5 8.5 11M5 19.5h14" /></svg>
              </button>
              <button id="rechercher-conversations" type="button" title="Rechercher une discussion" aria-label="Rechercher une discussion">
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
              </button>
            </div>
          </div>
        </aside>

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
              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9.5 4v16" /></svg>
            </button>
            <div className="chat-marque">
              <h1 id="titre-conversation">Nouvelle discussion</h1>
            </div>
            <button id="partager" className="btn-partager" type="button" title="Copier la conversation">
              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L8 8m4-4 4 4" /><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
              <span>Partager</span>
            </button>
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
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <div className="saisie-zone">
                <span id="saisie-mirror" className="saisie-mirror" aria-hidden="true"></span>
                <textarea
                  id="saisie"
                  name="saisie"
                  className="saisie"
                  rows={1}
                  maxLength={4000}
                  autoComplete="off"
                  placeholder="Écrivez votre message…"
                  aria-label="Votre message"
                ></textarea>
              </div>
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
                <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10l-5 5 5 5M4 15h11a4 4 0 0 0 4-4V7" /></svg>
              </button>
            </div>
            <div className="composeur-pied">
              <span>Athéna est une IA et peut commettre des erreurs. Vérifiez les réponses.</span>
              <div className="composeur-modele">
                <div className="hud-modele-wrap hud-modele-bas">
                  <button id="btn-modele" type="button" className="btn-modele" aria-haspopup="dialog" aria-expanded="false" aria-controls="hud-modeles" title="Modèle de langue — auto = cascade (gratuit → zai)">
                    <span id="modele-actif-nom" className="modele-actif-nom">auto</span>
                    <span className="modele-ico" aria-hidden="true"><svg className="ico" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></span>
                  </button>
                  <div id="hud-modeles" className="hud-modeles" hidden role="dialog" aria-label="Choisir le modèle de langue"></div>
                </div>
                <span className="composeur-niveau">Élevé</span>
              </div>
            </div>
            <input id="fichiers" type="file" multiple hidden aria-hidden="true" tabIndex={-1} />
          </form>
        </main>
      </div>

      <Script src="/design/theme-loader.js" strategy="beforeInteractive" />
      <Script src="/keys.js?v=20260925ad" strategy="beforeInteractive" />
      <Script src="/chat-demo.js?v=20260925ad" strategy="beforeInteractive" />
    </div>
  );
}
