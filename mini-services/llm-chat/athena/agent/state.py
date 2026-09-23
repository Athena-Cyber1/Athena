"""État de l'agent : AgentState, Claim, Action, Observation, Budget.

Principes (spécification utilisateur) :
- La réponse finale n'est jamais la première chose produite par le modèle.
- Statuts riches : UNKNOWN, HYPOTHESIS, SUPPORTED, VERIFIED, DISPROVED, CONTRADICTED, STALE.
- confiance ≠ vérité : une sortie LLM à 0.99 ne devient jamais un fait.
- Mémoire ≠ vérité : tout élément porte source / confiance / preuves.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

STATUTS = ("UNKNOWN", "HYPOTHESIS", "SUPPORTED", "VERIFIED", "DISPROVED", "CONTRADICTED", "STALE")

TYPES_TACHE = ("MATH", "CODE", "LINGUISTIQUE", "DEVINETTE", "FACTUEL", "LOGIQUE", "CONVERSATIONNEL")

# Budget par phase (spécification point 23) — unités abstraites consommées
# par les appels LLM (≈ tokens/4) et par les étapes outils (20 u. / appel).
BUDGET_PHASES = {
    "planner": 300,
    "decision_outil": 150,
    "raisonnement": 900,
    "critique": 400,
    "verification": 300,
    "reponse": 700,
    "reserve": 1346,
}


@dataclass
class Claim:
    """Affirmation traçable : texte + type + preuves + statut."""
    id: str
    texte: str
    type: str = "general"            # math | code | grammaire | devinette | fait | general
    source: Optional[str] = None     # outil, fichier, url, "lexique", "llm"...
    preuves: list[str] = field(default_factory=list)   # ids d'observations/preuves
    confiance: float = 0.0
    statut: str = "UNKNOWN"
    verifie: bool = False

    def vers_dict(self) -> dict[str, Any]:
        return {
            "claim_id": self.id, "texte": self.texte, "type": self.type,
            "source": self.source, "preuves": list(self.preuves),
            "confiance": round(self.confiance, 2), "statut": self.statut,
            "verifie": self.verifie,
        }


@dataclass
class Action:
    """Décision du planner : une étape exécutable."""
    type: str                        # outil | raisonner | verifier | final
    objectif: str = ""
    outil: Optional[str] = None
    arguments: dict[str, Any] = field(default_factory=dict)
    phase_budget: str = "reserve"
    critique: bool = True            # étape critique pour le stop-success
    fait: bool = False

    def vers_dict(self) -> dict[str, Any]:
        return {"type": self.type, "objectif": self.objectif, "outil": self.outil}


@dataclass
class Observation:
    """Résultat RÉEL d'une action (outil ou LLM), jamais une supposition."""
    action: Action
    outil: str
    succes: bool
    resultat: dict[str, Any] = field(default_factory=dict)
    erreurs: list[str] = field(default_factory=list)
    duree_ms: int = 0
    id: str = ""

    def vers_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "outil": self.outil, "succes": self.succes,
            "resultat": self.resultat, "erreurs": self.erreurs, "duree_ms": self.duree_ms,
        }


@dataclass
class AgentState:
    """État complet d'un tour d'agent (spécification point 1)."""
    but: str
    historique: list[dict[str, str]] = field(default_factory=list)
    fil_id: str = "defaut"
    type_tache: str = "CONVERSATIONNEL"
    complexite: str = "simple"                     # simple | medium | hard
    contraintes: list[str] = field(default_factory=list)
    faits: list[dict[str, Any]] = field(default_factory=list)        # faits vérifiés/retrouvés
    hypotheses: list[dict[str, Any]] = field(default_factory=list)
    plan: list[Action] = field(default_factory=list)
    observations: list[Observation] = field(default_factory=list)
    appels_outils: list[dict[str, Any]] = field(default_factory=list)
    verification: list[dict[str, Any]] = field(default_factory=list)  # verdicts
    claims: list[Claim] = field(default_factory=list)
    erreurs: list[dict[str, Any]] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)
    etape_courante: int = 0
    trace_seq: int = 0
    max_etapes: int = 12
    statut: str = "EN_COURS"
    replans: int = 0
    max_replans: int = 2
    budget: dict[str, int] = field(default_factory=lambda: dict(BUDGET_PHASES))
    contextes_memoire: dict[str, Any] = field(default_factory=dict)
    # v10.3 — pièces jointes injectées en FILE_DATA (contenu extrait des
    # fichiers indexés, donnée NON FIABLE : règle 9). Rempli par
    # _contexte_fichiers() au démarrage de run_agent().
    pieces_jointes: list[dict[str, Any]] = field(default_factory=list)
    reponse_courte: str = ""
    reponse_finale: str = ""
    # v10.9 — INVARIANT « rendu_final, unique point de sortie » : les gates
    # (verdict≠SUPPORTED, RAG vide, critic, garde entité…) n'ANNOTENT plus et
    # ne TERMINENT plus — elles déposent ici des codes de raison INTERNES que
    # rendu_final lit pour choisir le cran de la politique de dégradation.
    codes_raison: list[str] = field(default_factory=list)
    # classe terminale de la réponse (canari de sortie, v10.9) :
    # outillee | modele | hegdee | inconnu_honnete | politique | conversationnelle
    classe_terminal: str = ""
    # v10.9.1 — variante de pool tirée par voix.py + signature squelette
    # (télémétrie diversité : taux de réponses uniques, répétitions).
    variante_terminal: str = ""
    # cache du hedge (c) : une seule seconde-chance LLM par tour, réutilisée si
    # rendu_final est rappelé après replanification.
    repli_hedge: str | None = None
    # v10.9.4 (HUD) : modèle choisi côté UI (id complet « genre:nom » ou id
    # provider). None = cascade par défaut. Porté par le state (créé par
    # requête → thread-safe) et transmis à raisonner_llm → MOTEUR.complete.
    model_id: str | None = None
    # v10.9.4 (HUD) : le modèle choisi a échoué → le pont a servi la cascade.
    # Drapeau NEUTRE (booléen) — remonte à l'UI pour un toast discret ; jamais
    # de nom de provider ni d'erreur HTTP (N4).
    mode_repli: bool = False

    # ------------------------------------------------------------------ util
    def annoter(self, code: str, detail: str = "") -> None:
        """v10.9 — une gate ANNOTE (code raison interne + trace) ; elle ne
        termine jamais la boucle et ne rédige jamais le texte utilisateur."""
        if code not in self.codes_raison:
            self.codes_raison.append(code)
        if detail:
            self.trace.append({"etape": self.prochain_evenement(), "canal": "agent",
                               "evenement": "annotation", "libelle": code,
                               "details": {"detail": detail[:300]}, "ts": 0})

    def prochain_id(self, prefixe: str) -> str:
        n = len(self.claims) + len(self.observations) + 1
        return f"{prefixe}-{n:03d}"

    def consommer(self, phase: str, quantite: int) -> int:
        """Consomme du budget : phase dédiée d'abord, puis réserve. Retourne le reste."""
        prise = min(self.budget.get(phase, 0), quantite)
        self.budget[phase] = self.budget.get(phase, 0) - prise
        reste = quantite - prise
        if reste > 0:
            prise2 = min(self.budget.get("reserve", 0), reste)
            self.budget["reserve"] = self.budget.get("reserve", 0) - prise2
        return self.budget.get(phase, 0) + self.budget.get("reserve", 0)

    def budget_epuise(self) -> bool:
        return sum(self.budget.values()) <= 0

    def ajouter_claim(self, claim: Claim) -> Claim:
        self.claims.append(claim)
        return claim

    def appliquer(self, obs: Observation) -> None:
        """state.apply(observation) — l'observation enrichit l'état."""
        self.observations.append(obs)
        self.appels_outils.append({"outil": obs.outil, "succes": obs.succes, "id": obs.id})
        action = obs.action
        if action is not None:
            action.fait = True
        self.consommer("verification" if action and action.type == "verifier" else "decision_outil", 20)

    def observation_de(self, outil: str) -> Optional[Observation]:
        for obs in reversed(self.observations):
            if obs.outil == outil and obs.succes:
                return obs
        return None

    def contradictions(self) -> list[dict[str, Any]]:
        return [v for v in self.verification if v.get("statut") == "CONTRADICTED" or v.get("contradiction")]

    # ------------------------------------------------------- stop conditions
    def etapes_critiques_faites(self) -> bool:
        return all(a.fait for a in self.plan if a.critique)

    def stop_succes(self) -> bool:
        """STOP si : preuve suffisante + reproductible + pas de contradiction
        + toutes les étapes critiques couvertes (spécification point 24)."""
        if self.contradictions():
            return False
        if not self.etapes_critiques_faites():
            return False
        authority = self.observation_de("solveur_math") or self.observation_de("simulateur_code") \
            or self.observation_de("verificateur_grammaire") or self.observation_de("analyseur_devinette")
        if self.type_tache in ("MATH", "CODE", "LINGUISTIQUE", "DEVINETTE"):
            return authority is not None and bool(self.reponse_courte)
        return bool(self.reponse_finale) or bool(self.reponse_courte)

    def stop_honnete(self) -> bool:
        """STOP HONNÊTE : info impossible, outils indisponibles, budget dépassé."""
        return (
            self.etape_courante >= self.max_etapes
            or self.budget_epuise()
            or any(e.get("type") == "outil_indisponible" for e in self.erreurs)
        )

    def echec_honnete_diagnostic(self) -> dict[str, Any]:
        """Raisons honnêtes d'arrêt (jamais une invention pour combler).
        v10.9.2 : les raisons sont des GROUPES NOMINAUX — elles sont reprises
        par le contenu (d) après « il faudrait … » / « il me faudrait … » :
        une clause (« le modèle était indisponible ») y casserait la phrase."""
        raisons = []
        if self.etape_courante >= self.max_etapes:
            raisons.append("plus de marge d'étapes d'analyse")
        if self.budget_epuise():
            raisons.append("un budget d'exécution plus large")
        for v in self.verification:
            if v.get("statut") == "CONTRADICTED":
                raisons.append(f"la résolution d'une contradiction non tranchée ({v.get('resume', 'détails dans la trace')})")
        for e in self.erreurs:
            if e.get("type") == "outil_indisponible":
                # v10.9.1 : libellé HONNÊTE mais sans l'interdit canari
                # « outil indisponible » (le diagnostic reste en interne, sa
                # forme lisible va dans la réponse (d)).
                outil = e.get("outil") or "?"
                if outil == "llm":
                    raisons.append("le concours du modèle de langue (momentanément indisponible)")
                else:
                    raisons.append(f"le concours de l'outil « {outil} » (momentanément indisponible)")
        if not raisons:
            raisons.append("des preuves supplémentaires pour conclure")
        return {"raisons": raisons, "etapes": self.etape_courante, "outils": [a["outil"] for a in self.appels_outils]}

    def prochain_evenement(self) -> int:
        self.trace_seq += 1
        return self.trace_seq

    def vers_dict_trace(self) -> list[dict[str, Any]]:
        return list(self.trace)
