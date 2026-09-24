"""Boucle d'agent Athéna — cœur de l'architecture v10.

run_agent() :
  COMPRENDRE → PLANNER → [ACTION (outil/raisonner) → OBSERVE → VERIFY → CRITIC → REPLAN?] → FINALIZE
La réponse finale n'est JAMAIS la première production du modèle.

v10.7 — correctifs du diagnostic pipeline LLM :
- MEMORY_RECENT GATÉ : le fil récent n'est injecté QUE si la question
  montre une reprise (anaphore, marqueur de continuation) ou chevauche
  significativement le dernier tour. Question nouvelle = pas de mémoire
  récente (fini « le contexte ne mentionne que Athéna » pour une question VPN).
- La mémoire n'est JAMAIS étiquetée « contexte autoritaire » : indicatif, ≠ vérité.
- prompt_redaction reçoit a_observations=bool(outils) → les règles de refus
  (1)(2) ne sont envoyées que si des observations d'outils existent.

v10.8 — correctifs génériques du benchmark 112 questions :
- CLASSE 1 : a_observations passe au CONTENU RÉEL (une recherche vide ≠ une
  observation) — logique/définitions/conseils standards ne voient jamais de
  règle de sourçage → plus de refus vide sur questions triviales.
- CLASSE 4 : le flag anaphore de _fil_recent est transmis au prompt
  (instruction RÉSOLUTION D'ANAPHORE : antécédent identifié + explicité).
- CLASSE 7 : garde d'injection déterministe en TÊTE de boucle (policies.
  garde_injection) — prise de contrôle refusée poliment, « répète : X »
  traité en citation sans endossement, sans consommer un seul appel LLM.
"""
from __future__ import annotations

import re
import time
import uuid
from typing import Any, Callable

from .. import __version__
from ..llm import prompts
from ..memory import store as memoire
from ..verification import canari
from ..verification import facts as vfacts
from . import critic, executor, observer, planner, policies, skills, sous_agent, verifier, voix
from .state import Action, AgentState

Emitter = Callable[[dict[str, Any]], None]


def _trace(state: AgentState, canal: str, evenement: str, libelle: str, details: dict[str, Any] | None = None) -> None:
    state.trace.append({"etape": state.prochain_evenement(), "canal": canal, "evenement": evenement,
                        "libelle": libelle, "details": details or {}, "ts": round(time.time(), 3)})


def _contexte_memoire(state: AgentState) -> None:
    """L0/L2 (fil) + L3 (faits) + L4/L5 (documents, corpus) — mémoire ≠ vérité."""
    fil = memoire.retrouver_fil(state.fil_id, limite=6)
    faits = memoire.chercher_faits(state.but, limite=3)
    docs = memoire.chercher_fichiers(state.but, limite=3) if state.type_tache in ("FACTUEL", "LOGIQUE", "CONVERSATIONNEL") else []
    state.contextes_memoire = {"fil": fil, "faits": faits, "documents": docs}
    for f in faits:
        state.faits.append({"contenu": f["contenu"], "source": f.get("source", "memoire"),
                            "verifie": f.get("verifie", False), "confiance": f.get("confiance", 0.5),
                            "preuves": [f"memoire:{f.get('maj_ts', '')}"]})


def _resume_observations(state: AgentState) -> str:
    """Résumé des observations : les OUTILS d'autorité d'abord (rendus lisibles,
    ex. les résultats web nommés titre+url+extrait), puis la mémoire — qui
    reste INDICATIVE (≠ vérité), puis FILE_DATA."""
    lignes = []
    for obs in state.observations:
        if not obs.succes:
            continue
        if obs.outil == "recherche_web":
            for res in (obs.resultat.get("resultats") or [])[:4]:
                titre = str(res.get("titre", ""))[:120]
                url = str(res.get("url", ""))[:140]
                extrait = str(res.get("extrait", "")).replace("\n", " ")[:180]
                frais = res.get("frais", "")
                lignes.append(f"- [web{' · ' + frais if frais else ''}] {titre} — {url} : {extrait}")
            continue
        if obs.outil == "recherche_fichiers":
            for res in (obs.resultat.get("resultats") or [])[:3]:
                texte = str(res.get("texte", res.get("nom", ""))).replace("\n", " ")[:220]
                lignes.append(f"- [document mémoire «{res.get('nom', '?')}»] {texte}")
            continue
        lignes.append(f"- [{obs.outil}] {str(obs.resultat)[:400]}")
    for f in state.faits[:4]:
        if f.get("source") == "table_faits_stables":
            # v10.9 (N2) — les faits canoniques de la table stable sont une
            # autorité (pas une mémoire indicative) : étiquette dédiée.
            lignes.append(f"- [fait stable canonique ✓] {f['contenu'][:160]}")
        else:
            lignes.append(f"- [mémoire — INDICATIF, ≠ vérité{' ✓' if f.get('verifie') else ' (non vérifié)'}] {f['contenu'][:160]}")
    bloc_fichiers = _bloc_file_data(state)
    if bloc_fichiers:
        lignes.append(bloc_fichiers)
    return "\n".join(lignes) or "- (aucune observation)"


# v10.7 — gating du fil récent : reprise par anaphore / continuation, ou
# chevauchement significatif avec le dernier tour utilisateur.
# v10.9 — les motifs vivent dans policies (partagés avec le hedge (c)) pour
# garantir UNE seule détection (zéro divergence gating/hedge).
from .policies import marqueur_continuation as _CONTINUATION_MATCH
from .policies import marqueurs_anaphore as _marqueurs_anaphore_shared


def _bloc_fil_recent(state: AgentState) -> tuple[str, bool]:
    """v10.7/v10.8 — MEMORY_RECENT GATÉ (diagnostic §1 (b) + Classe 4).

    Le fil de conversation n'est envoyé au modèle QUE si la question actuelle
    est une reprise : anaphore (« son auteur », « ce sujet »), marqueur de
    continuation (« et ensuite », « plus de détails ») ou chevauchement
    significatif (≥ 2 jetons de contenu) avec le dernier tour utilisateur.
    Une question NOUVELLE (ex. VPN après Athéna) ne reçoit AUCUN fil récent.

    Retourne (bloc, anaphore) : anaphore=True si la reprise vient d'un marqueur
    d'anaphore (CLASSE 4 — le prompt ajoute alors l'instruction de résolution
    d'antécédent, et le fil s'étend à 6 tours pour couvrir N-1 ET N-2)."""
    fil = state.contextes_memoire.get("fil") or []
    tours = [t for t in fil if (t.get("contenu") or "").strip()]
    if not tours:
        return "", False
    question = state.but
    par_anaphore = _marqueurs_anaphore_shared(question)
    reprise = par_anaphore or _CONTINUATION_MATCH(question)
    if not reprise:
        dernier_user = next((t for t in reversed(tours) if t.get("role") == "utilisateur"), None)
        if dernier_user:
            commun = (set(memoire.jetons_significatifs(question))
                      & set(memoire.jetons_significatifs(dernier_user["contenu"])))
            reprise = len(commun) >= 2
    if not reprise:
        return "", False
    # CLASSE 4 : en anaphore, injecter PLUS de fil (N-1 ET N-2 visibles)
    if par_anaphore:
        tours = tours[-6:]
    else:
        tours = tours[-4:]
    lignes = []
    for t in tours:
        role = "Utilisateur" if t.get("role") == "utilisateur" else "Assistant"
        lignes.append(f"- {role} : {(t['contenu'] or '')[:200]}")
    return "\n".join(lignes), par_anaphore


def _bloc_file_data(state: AgentState) -> str:
    """v10.3 — FILE_DATA : contenu réel des fichiers joints, injecté comme
    DONNÉE NON FIABLE (règle 9). Budget global 8000 caractères pour ne pas
    noyer le modèle 1.5B. Ce n'est PAS une observation d'outil : le modèle
    doit s'en servir comme contenu du fichier, sans le présenter comme vérifié."""
    if not state.pieces_jointes:
        return ""
    lignes: list[str] = []
    budget = 8000
    for p in state.pieces_jointes:
        if budget <= 0:
            lignes.append(f"- [fichier «{p['nom']}»] (non inclus : budget FILE_DATA épuisé)")
            continue
        contenu = "\n".join(p.get("extraits") or []).strip()
        if not contenu:
            lignes.append(f"- [fichier «{p['nom']}»] (aucun texte extractible — type {p.get('mime', '?')})")
            continue
        if len(contenu) > budget:
            contenu = contenu[:budget] + "…[tronqué]"
        budget -= len(contenu)
        marque = " (tronqué)" if p.get("tronque") else ""
        lignes.append(
            f"- [fichier joint «{p['nom']}»{marque} — FILE_DATA, contenu NON vérifié]\n{contenu}"
        )
    return "\n".join(lignes)


def _explication(state: AgentState) -> str:
    """Demande au LLM une explication SAPPUYANT sur les observations (autorité)."""
    obs_msg = prompts.prompt_explication(state.type_tache, state.but, _resume_observations(state))
    obs = observer.raisonner_llm(state, obs_msg, phase="reponse")
    if obs.succes:
        return obs.resultat.get("texte", "")
    return ""


def _contexte_fichiers(state: AgentState, attachments: list[dict[str, str]] | None) -> None:
    """v10.3 — charge le contenu des pièces jointes (FILE_DATA).

    Le bug historique : les attachments arrivaient jusqu'ici mais n'étaient
    JAMAIS transmis au moteur, et les documents mémoire n'étaient jamais
    injectés dans un prompt — le modèle ne pouvait donc pas lire les fichiers.
    Désormais le contenu extrait est chargé dans state.pieces_jointes et rendu
    au LLM via _bloc_file_data() (donnée NON FIABLE, règle 9)."""
    ids: list[str] = []
    for a in attachments or []:
        fid = str((a or {}).get("file_id", "")).strip()
        if fid and fid not in ids:
            ids.append(fid)
    if not ids:
        return
    pieces = memoire.chunks_par_fichiers(ids)
    trouves = {p["file_id"] for p in pieces}
    manquants = [i for i in ids if i not in trouves]
    state.pieces_jointes = pieces
    state.contextes_memoire["pieces_jointes"] = pieces
    if pieces:
        total = sum(p["chars"] for p in pieces)
        noms = ", ".join(f"«{p['nom']}»" for p in pieces)
        _trace(state, "progress", "pieces_jointes",
               f"{len(pieces)} fichier(s) joint(s) chargé(s) en FILE_DATA ({total} caractères extraits) : {noms}",
               {"fichiers": [{"file_id": p["file_id"], "nom": p["nom"], "chars": p["chars"],
                              "chunks_total": p["chunks_total"], "tronque": p["tronque"]} for p in pieces]})
    if manquants:
        _trace(state, "progress", "pieces_jointes_absentes",
               f"{len(manquants)} fichier(s) introuvable(s) en mémoire (id inconnu ou purge)",
               {"file_ids": manquants})


def run_agent(question: str, historique: list[dict[str, str]] | None = None,
              fil_id: str | None = None, max_etapes: int = 14,
              mode: str = "auto", emetteur: Emitter | None = None,
              attachments: list[dict[str, str]] | None = None,
              model_id: str | None = None, skill: str | None = None) -> dict[str, Any]:
    debut = time.time()
    fil_id = fil_id or f"fil-{uuid.uuid4().hex[:8]}"
    historique = historique or []

    state = AgentState(but=question.strip(), historique=historique, fil_id=fil_id,
                       max_etapes=max_etapes, model_id=model_id)

    # v10.8 — CLASSE 7 : garde d'injection DÉTERMINISTE avant toute planification
    # (prise de contrôle « SYSTEM: » → refus poli + alternative ; « répète : X »
    # → citation sans endossement). Zéro appel LLM, zéro plan.
    garde = policies.garde_injection(state.but)
    if garde:
        state.reponse_finale = garde["reponse"]
        state.reponse_courte = garde["reponse_courte"]
        state.statut = garde["statut"]
        state.classe_terminal = canari.CLASSE_POLITIQUE
        state.variante_terminal = garde.get("_variante", "")
        state.annoter("POLITIQUE_INJECTION")
        _trace(state, "agent", "garde_injection",
               "Tentative de contournement/prise de contrôle neutralisée (réponse déterministe)",
               {"statut": garde["statut"]})
        memoire.memoriser_tour(fil_id, "utilisateur", state.but, state.type_tache, state.statut)
        memoire.memoriser_tour(fil_id, "assistant", state.reponse_finale[:3000], state.type_tache, state.statut)
        duree = int((time.time() - debut) * 1000)
        memoire.enregistrer_sortie(fil_id, state.type_tache, state.classe_terminal,
                                   state.codes_raison, duree,
                                   canari.detecter_non_reponse(state.reponse_finale) or "",
                                   variante=state.variante_terminal,
                                   empreinte=voix.signature(state.reponse_finale))
        return _paquet_final(state, fil_id, debut)

    state.type_tache = planner.classifier(state.but)
    comp = planner.estimer_complexite(state.but, state.type_tache)
    state.complexite = comp.niveau

    _trace(state, "progress", "comprehension",
           f"Question comprise — type {state.type_tache}, complexité {comp.niveau}",
           {"contraintes_detectees": comp.nb_contraintes, "calcul": comp.calcul_requis, "code": comp.analyse_code_requise})
    _contexte_memoire(state)
    if state.contextes_memoire.get("fil"):
        _trace(state, "agent", "memoire_fil", f"{len(state.contextes_memoire['fil'])} tours de fil chargés (mémoire ≠ vérité)")
    # v10.9 (N2) — accélérateur stable-facts : un fait canonique (capitale…)
    # est injecté comme AUTORITÉ avant même toute recherche — le modèle, le
    # critic et le fallback déterministe peuvent y référer sans dépendre du
    # web (indisponibilité du bridge/quota ≠ inexistence).
    canon = vfacts.fait_canonique(state.but)
    if canon:
        state.faits.append({"contenu": canon["contenu"], "source": canon["source"],
                            "verifie": True, "confiance": canon["confiance"],
                            "preuves": ["table_faits_stables"]})
        state.verification.append({"statut": "VERIFIED", "resume": canon["contenu"],
                                   "preuve": "table_faits_stables (N2)", "claim_id": "canonique"})
        _trace(state, "agent", "fait_canonique", f"Fait canonique injecté : {canon['contenu']}",
               {"entite": canon["entite"], "valeur": canon["valeur"]})
    _contexte_fichiers(state, attachments)

    plan = planner.creer_plan(state, skill_force=skill)
    _trace(state, "progress", "plan_cree",
           f"Plan établi ({state.skill or 'sans skill'}) : "
           f"{' → '.join(a.objectif for a in plan if a.type != 'final')}",
           {"etapes": [a.vers_dict() for a in plan], "skill": state.skill})
    if emetteur:
        emetteur({"event": "plan_created", "goal": state.but, "task_type": state.type_tache,
                  "skill": state.skill})

    explication = ""
    rendu = None

    for etape in range(state.max_etapes):
        state.etape_courante = etape + 1
        action = next((a for a in state.plan if not a.fait), None)
        if action is None:
            break

        # ------------------------------------------------------------- OUTIL
        if action.type == "outil":
            _trace(state, "progress", "action", f"→ {action.objectif}", {"outil": action.outil})
            obs = executor.executer(action, state)
            state.appliquer(obs)
            observer.observer(obs, state)  # observation → claims tracés (outil = autorité)
            _trace(state, "agent", "observation", f"[{obs.outil}] {'succès' if obs.succes else 'échec'} "
                   f"({obs.duree_ms} ms)", obs.vers_dict())
            if not obs.succes and obs.outil in ("solveur_math", "simulateur_code", "verificateur_grammaire",
                                                "analyseur_devinette"):
                state.erreurs.append({"type": "outil_echec", "outil": obs.outil, "raison": (obs.erreurs or ["?"])[0][:200]})

        # --------------------------------------------------------- VÉRIFIER
        elif action.type == "verifier":
            _trace(state, "progress", "verification", f"→ {action.objectif}", {"genre": action.outil})
            verdicts = verifier.verifier(state, action.outil or "faits")
            _trace(state, "agent", "verdict", f"{len(verdicts)} verdict(s)", {"verdicts": verdicts})
            action.fait = True

        # ---------------------------------------------------------- RAISONNER
        elif action.type == "raisonner":
            _trace(state, "progress", "raisonnement", f"→ {action.objectif}")
            if mode == "sec":
                explication = ""  # mode évals : déterministe pur
                action.fait = True
            else:
                if state.type_tache in ("MATH", "CODE", "LINGUISTIQUE", "DEVINETTE"):
                    msgs = prompts.prompt_explication(state.type_tache, state.but, _resume_observations(state))
                else:
                    # v10.8 — CLASSE 1 : a_observations reflète le CONTENU RÉEL
                    # des observations (une recherche vide ≠ une observation).
                    # Une question auto-suffisante (logique, définition, conseil
                    # standard) ne voit JAMAIS de règle de sourçage → zéro refus vide.
                    resume = _resume_observations(state)
                    a_observations = resume.strip() != "- (aucune observation)"
                    # v10.8 — CLASSE 4 : le flag anaphore pilote l'instruction
                    # de résolution d'antécédent dans le prompt.
                    fil_recent, reprise_anaphore = _bloc_fil_recent(state)
                    msgs = prompts.prompt_redaction(
                        resume, state.but,
                        fil_recent=fil_recent,
                        a_observations=a_observations,
                        anaphore=reprise_anaphore)
                obs = observer.raisonner_llm(state, msgs, phase="raisonnement")
                obs.action = action
                action.fait = True
                if obs.succes:
                    state.appliquer(obs)
                    _trace(state, "agent", "hypothese_llm", "proposition LLM reçue (HYPOTHESIS, soumise au critic)",
                           {"extrait": obs.resultat.get("texte", "")[:200]})
                    explication = obs.resultat.get("texte", "")
                else:
                    # v10.9.2 (P0) : le libellé VISIBLE est neutre et honnête —
                    # plus jamais la chaîne brute du pont (« HTTP Error 502 »…)
                    # qui remontait dans le raisonnement affiché. Le code interne
                    # va dans les détails de trace (canal serveur, non rendu).
                    _trace(state, "agent", "llm_indisponible",
                           "modèle de langue momentanément indisponible — poursuite en mode déterministe",
                           {"repli": "réponse déterministe uniquement",
                            "code_interne": (obs.resultat or {}).get("detail_interne", "")})

        # -------------------------------------------------------------- FINAL
        elif action.type == "final":
            action.fait = True  # l'étape est exécutée : le brouillon est produit et sera jugé
            rendu = policies.rendu_final(state, explication_llm=explication)
            projet = rendu["reponse"]
            _trace(state, "agent", "critique", "revue critique (10 questions)", {"taille_projet": len(projet)})
            avis = critic.critique(state, projet)
            _trace(state, "agent", "critique_verdict",
                   "critic : OK" if avis["ok"] else f"critic : {len(avis['erreurs'])} erreur(s) → {avis['action']}",
                   avis)
            state.consommer("critique", 40)
            if avis["ok"] or avis["action"] == "accepter" or state.replans >= state.max_replans:
                # v10.9 (N1) — replans épuisés : le critic ne TERMINE pas la
                # boucle avec un refus. S'il existe une contre-proposition
                # outillée (passes les mêmes gates, diffère de la rejetée),
                # c'est ELLE qui est prise ; sinon le rendu courant (déjà
                # passé par l'échelle a→d) reste la sortie.
                if not avis["ok"] and state.replans >= state.max_replans:
                    contre = critic.contre_proposition(state, avis["erreurs"])
                    if contre and contre["reponse"] != projet:
                        projet = contre["reponse"]
                        rendu["reponse"] = projet
                        rendu["reponse_courte"] = contre["reponse_courte"]
                        rendu["statut"] = contre["statut"]
                        state.classe_terminal = canari.CLASSE_OUTILLEE
                        state.annoter("CRITIC_CONTRE_PROPOSITION", contre.get("source", ""))
                        _trace(state, "agent", "contre_proposition",
                               f"Rejet critic assumé via contre-proposition outillée ({contre.get('source')})")
                    else:
                        state.annoter("CRITIC_REJET_SANS_PROPOSITION",
                                      "; ".join(e.get("type", "?") for e in avis["erreurs"])[:200])
                        _trace(state, "agent", "rejet_sans_proposition",
                               "Critic en rejet SANS contre-proposition recevable — loggé (télémétrie), "
                               "la réponse issue de l'échelle a→d reste la sortie.")
                # ---- v10.1 : SOUS-AGENT VÉRIFICATEUR (même modèle, rôle critique) ----
                # Le petit modèle juge 0.5B a été RETIRÉ (il biaisait les résultats) :
                # la relecture critique est faite par une seconde passe adversariale
                # du modèle principal. L'outil reste l'autorité absolue.
                if mode != "sec":
                    _trace(state, "progress", "sous_agent",
                           "Le sous-agent vérificateur (même modèle, rôle critique) relit la réponse…")
                    rapport = sous_agent.verifier_par_sous_agent(state, projet)
                    projet = rapport["reponse_ajustee"]
                    rendu["reponse"] = projet
                    resume = sous_agent.resume_court(rapport)
                    _trace(state, "agent", "sous_agent_verdict",
                           resume or "sous-agent : aucune qualification",
                           {"mode": rapport["mode"], "avis_global": rapport["avis_global"],
                            "concordes": rapport["concordes"], "doutes": rapport["doutes"],
                            "contredits": rapport["contredits"], "verdicts": rapport["verdicts"],
                            "duree_ms": rapport["duree_ms"]})
                state.reponse_courte = rendu["reponse_courte"]
                state.reponse_finale = projet
                state.statut = rendu["statut"]
                _trace(state, "progress", "final", "Réponse finalisée après vérification", {"statut": state.statut})
                break
            if avis["action"] == "recompute" and state.replans < state.max_replans:
                _trace(state, "progress", "replanification",
                       "Incohérence détectée → replanification ciblée", {"erreurs": avis["erreurs"][:2]})
                planner.replanifier(state)
            else:
                # v10.9 — le critic n'émet plus de refus : échec_honnete = cran
                # (d) de l'échelle (voisinage + manque), avec annotation.
                state.annoter("CRITIC_BUDGET_EPUISE")
                rendu = policies.echec_honnete(state)
                state.statut = "ECHEC_HONNETE"
                state.reponse_finale = rendu["reponse"]
                state.reponse_courte = rendu["reponse_courte"]
                state.classe_terminal = canari.CLASSE_INCONNU
                _trace(state, "progress", "final", "Échec honnête (budget replans) — cran (d) substantiel",
                       {"statut": state.statut})
                break

        # stop conditions
        if state.stop_succes():
            break
        if state.stop_honnete():
            # v10.9 — le STOP HONNÊTE annote puis laisse l'échelle produire la
            # réponse. v10.9.2 (P0) : il passe PAR rendu_final (unique sortie) —
            # il ne court-circuite PLUS le ladder : un résultat outillé VERIFIED,
            # un fait canonique ou un micro-social existant PRIMENT sur le cran
            # (d) (« 2+2 » vérifié ne doit pas devenir un inconnu, « bonjour »
            # reste un accueil). Les raisons STOP_HONNETE alimentent le contenu
            # (d) via _manque_defaut quand l'échelle y tombe d'elle-même.
            state.annoter("STOP_HONNETE")
            diag = state.echec_honnete_diagnostic()
            _trace(state, "progress", "stop_honnete", "Arrêt honnête — rendu par l'échelle unique (a→d)", diag)
            if not state.reponse_finale:
                rendu = policies.rendu_final(state, explication_llm=explication)
                state.reponse_finale = rendu["reponse"]
                state.reponse_courte = rendu["reponse_courte"]
                # statut honnête : le cran atteint, marqué ECHEC_HONNETE si (d)
                state.statut = ("ECHEC_HONNETE" if state.classe_terminal == canari.CLASSE_INCONNU
                                else rendu["statut"])
            break

    if rendu is None:
        rendu = policies.rendu_final(state, explication_llm=explication)
        if not state.reponse_finale:
            state.reponse_finale = rendu["reponse"]
            state.reponse_courte = rendu["reponse_courte"]
            state.statut = rendu["statut"]
            state.classe_terminal = state.classe_terminal or canari.CLASSE_INCONNU

    # mémoire du fil (L2) + tours
    memoire.memoriser_tour(fil_id, "utilisateur", state.but, state.type_tache, "")
    memoire.memoriser_tour(fil_id, "assistant", state.reponse_finale[:3000], state.type_tache, state.statut)

    # v10.9 — CANARI DE SORTIE (télémétrie, plus mécanisme d'application) :
    # 1) classe terminale enregistrée (outillee/modele/hegdee/inconnu/politique/
    #    conversationnelle) ;
    # 2) tolérance zéro aux INTERDITS de sortie (défense en profondeur : une
    #    violation est loggée et la réponse est ré-émise par le cran (d)).
    duree = int((time.time() - debut) * 1000)
    nr = canari.detecter_non_reponse(state.reponse_finale) or ""
    viols = canari.violations(state.reponse_finale)
    if viols:
        _trace(state, "agent", "canari_violation",
               f"INTERDITS de sortie détectés ({', '.join(viols)}) → ré-émission cran (d)",
               {"violations": viols})
        rendu_secours = policies.echec_honnete(state)
        state.reponse_finale = rendu_secours["reponse"]
        state.reponse_courte = rendu_secours["reponse_courte"]
        state.classe_terminal = canari.CLASSE_INCONNU
        nr = canari.detecter_non_reponse(state.reponse_finale) or ""
    # v10.9.1 — DÉDUP STRUCTUREL GLOBAL : toute réponse FINALE rejoint la
    # fenêtre d'empreintes (la réalisation suivante tirera une variante
    # différente si son squelette est trop proche).
    voix.memoriser(state.reponse_finale, variante=state.variante_terminal,
                   classe=state.classe_terminal or "?")
    memoire.enregistrer_sortie(fil_id, state.type_tache, state.classe_terminal or "?",
                               state.codes_raison, duree, nr,
                               variante=state.variante_terminal,
                               empreinte=voix.signature(state.reponse_finale))
    return _paquet_final(state, fil_id, debut)


def _paquet_final(state: AgentState, fil_id: str, debut: float) -> dict[str, Any]:
    """v10.9 — paquet de réponse mutualisé (boucle normale ET garde d'injection)
    + annotations du canari (codes_raison, classe terminale)."""
    duree = int((time.time() - debut) * 1000)
    return {
        "reponse": state.reponse_finale,
        "reponse_courte": state.reponse_courte,
        "type_tache": state.type_tache,
        "skill": state.skill,
        "statut": state.statut,
        "complexite": state.complexite,
        "classe_terminal": state.classe_terminal,
        "codes_raison": list(state.codes_raison),
        "verdicts": [c.vers_dict() for c in state.claims],
        "verification": state.verification,
        "trace": state.vers_dict_trace(),
        "budget_restant": state.budget,
        "replans": state.replans,
        "duree_ms": duree,
        "fil_id": fil_id,
        # v10.9.4 (HUD) : le modèle choisi a échoué → cascade servie. Booléen
        # neutre (aucun nom de provider, aucune erreur HTTP — N4) ; l'UI lèvera
        # un toast discret « repli sur le modèle auto ».
        "modele_repli": bool(getattr(state, "mode_repli", False)),
        "version": f"athena {__version__}",
    }
