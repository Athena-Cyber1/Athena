"""Skills — playbooks nommés branchés sur le planner.

Un skill regroupe : déclencheur (type de tâche), template de plan (liste
d'Actions), outils utilisés et genre de vérificateur. C'est la
généralisation des templates codés en dur dans planner._actions().

Contraintes inchangées :
- la réponse finale n'est jamais la première production du modèle ;
- seuls les outils autorité créent des claims VERIFIED ;
- rendu_final reste l'unique point de sortie.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .state import Action

# (question, niveau) -> plan d'actions exécutables
PlanBuilder = Callable[[str, str], list[Action]]


@dataclass
class Skill:
    nom: str
    description: str
    types: tuple[str, ...]                      # TYPES_TACHE couverts
    construire_plan: PlanBuilder
    outils: tuple[str, ...] = ()                # outils d'autorité / support
    genre_verificateur: Optional[str] = None    # math | code | grammaire | …
    autorite: bool = False                      # repose sur au moins un outil autorité
    motifs: tuple[str, ...] = ()                # regex optionnels de routing
    actif: bool = True

    def correspond(self, question: str) -> bool:
        if not self.motifs:
            return False
        q = question.lower()
        return any(re.search(m, q) for m in self.motifs)

    def vers_dict(self) -> dict[str, Any]:
        return {
            "nom": self.nom,
            "description": self.description,
            "types": list(self.types),
            "outils": list(self.outils),
            "genre_verificateur": self.genre_verificateur,
            "autorite": self.autorite,
            "actif": self.actif,
        }


SKILLS: dict[str, Skill] = {}


def skill(nom: str, description: str, types: tuple[str, ...],
          outils: tuple[str, ...] = (),
          genre_verificateur: Optional[str] = None, autorite: bool = False,
          motifs: tuple[str, ...] = ()):
    """Décorateur d'enregistrement (miroir de tools.registry.outil).

    La fonction décorée EST le construire_plan : (question, niveau) -> [Action].
    """
    def decorateur(fn: PlanBuilder) -> PlanBuilder:
        SKILLS[nom] = Skill(
            nom=nom, description=description, types=types,
            construire_plan=fn, outils=outils,
            genre_verificateur=genre_verificateur, autorite=autorite,
            motifs=motifs)
        return fn
    return decorateur


def lister() -> list[dict[str, Any]]:
    return [s.vers_dict() for s in SKILLS.values() if s.actif]


def obtenir(nom: str) -> Optional[Skill]:
    return SKILLS.get(nom)


def selectionner(type_tache: str, question: str,
                 skill_force: Optional[str] = None) -> Optional[Skill]:
    """Choisit le skill pour ce tour.

    1. skill_force (id fourni par l'API/UI) s'il existe et est actif ;
    2. premier skill actif dont `types` contient type_tache ;
    3. premier skill actif dont motifs matchent la question.
    """
    if skill_force:
        s = SKILLS.get(skill_force)
        if s and s.actif:
            return s
    for s in SKILLS.values():
        if s.actif and type_tache in s.types:
            return s
    for s in SKILLS.values():
        if s.actif and s.correspond(question):
            return s
    return None


def plan_de(s: Skill, question: str, niveau: str) -> list[Action]:
    return s.construire_plan(question, niveau)


# ---------------------------------------------------------------------------
# Skills intégrés — extraits des templates historiques de planner._actions()
# ---------------------------------------------------------------------------

@skill(
    "math-exact",
    "Résolution arithmétique exacte via le solveur d'autorité (pourcentages, expressions, problèmes types).",
    types=("MATH",),
    outils=("solveur_math", "python_sandbox"),
    genre_verificateur="math",
    autorite=True,
    motifs=(r"r[ée]duction|remise|rabais|pourcentage|tva", r"\d+\s*(?:€|euros?|%|kg)"),
)
def _plan_math(question: str, niveau: str) -> list[Action]:
    return [
        Action("outil", "résoudre par le solveur mathématique exact", "solveur_math",
               {"question": question}, "decision_outil", True),
        Action("verifier", "vérifier la cohérence du résultat", "math", {}, "verification", True),
        Action("raisonner", "expliquer le calcul à partir de l'observation", "", {}, "raisonnement", False),
        Action("final", "rédiger la réponse", "", {}, "reponse", True),
    ]


@skill(
    "code-simule",
    "Simulation de code Python : extraction AST + croisement sandbox, sortie reproduite.",
    types=("CODE",),
    outils=("simulateur_code",),
    genre_verificateur="code",
    autorite=True,
    motifs=(r"```(?:python|py)", r"que va (?:t['’]?|il )?affich", r"print\s*\("),
)
def _plan_code(question: str, niveau: str) -> list[Action]:
    return [
        Action("outil", "extraire et exécuter le code (AST + sandbox)", "simulateur_code",
               {"question": question}, "decision_outil", True),
        Action("verifier", "contrôler reproductibilité de la sortie", "code", {}, "verification", True),
        Action("raisonner", "expliquer l'exécution pas à pas", "", {}, "raisonnement", False),
        Action("final", "rédiger la réponse", "", {}, "reponse", True),
    ]


@skill(
    "grammaire-accord",
    "Règles d'accord du participe passé (COD postposé/antéposé) — déterministe.",
    types=("LINGUISTIQUE",),
    outils=("verificateur_grammaire",),
    genre_verificateur="grammaire",
    autorite=True,
    motifs=(r"se\s+sont\s+\w+[éèse]?\b", r"accord", r"participe\s+pass[ée]", r"grammair"),
)
def _plan_ling(question: str, niveau: str) -> list[Action]:
    return [
        Action("outil", "appliquer les règles d'accord (COD postposé/antéposé)", "verificateur_grammaire",
               {"question": question}, "decision_outil", True),
        Action("verifier", "vérifier la règle appliquée", "grammaire", {}, "verification", True),
        Action("raisonner", "expliquer la règle", "", {}, "raisonnement", False),
        Action("final", "rédiger la réponse", "", {}, "reponse", True),
    ]


@skill(
    "devinette-honnete",
    "Analyse de devinette (lexique / charade) avec politique d'honnêteté — jamais d'invention.",
    types=("DEVINETTE",),
    outils=("analyseur_devinette",),
    genre_verificateur="devinette",
    autorite=True,
    motifs=(r"mon\s+premier", r"qui\s+suis[-\s]je", r"\bai[-\s]je\b"),
)
def _plan_devinette(question: str, niveau: str) -> list[Action]:
    return [
        Action("outil", "analyser la devinette (lexique / charade) avec politique d'honnêteté",
               "analyseur_devinette", {"question": question}, "decision_outil", True),
        Action("verifier", "contrôler la politique anti-invention", "devinette", {}, "verification", True),
        Action("raisonner", "formuler la réponse ou le refus justifié", "", {}, "raisonnement", False),
        Action("final", "rédiger la réponse", "", {}, "reponse", True),
    ]


@skill(
    "factuel-sourcé",
    "Recherche multi-sources (mémoire documentaire + web horodaté) avec provenance des claims.",
    types=("FACTUEL",),
    outils=("recherche_fichiers", "recherche_web"),
    genre_verificateur="faits",
    autorite=False,
    motifs=(r"qui\s+(?:est|a)", r"capitale", r"qu['’]?est[- ]ce qu[e']?"),
)
def _plan_factuel(question: str, niveau: str) -> list[Action]:
    return [
        Action("outil", "chercher dans la mémoire documentaire (symbole > fichier > lexique)",
               "recherche_fichiers", {"requete": question}, "decision_outil", False),
        Action("outil", "recherche web horodatée si le bridge est disponible", "recherche_web",
               {"query": question[:400], "num": 5}, "decision_outil", False),
        Action("raisonner", "synthétiser avec provenance (faits vs hypothèses)", "", {}, "raisonnement", False),
        Action("verifier", "contrôler provenance des claims", "faits", {}, "verification", True),
        Action("final", "rédiger la réponse", "", {}, "reponse", True),
    ]


@skill(
    "logique-premisses",
    "Extraction de prémisses et contrôle de cohérence — jamais de conclusion directe.",
    types=("LOGIQUE",),
    outils=(),
    genre_verificateur="faits",
    autorite=False,
    motifs=(r"si\s+.*alors", r"syllogisme", r"pr[ée]misse"),
)
def _plan_logique(question: str, niveau: str) -> list[Action]:
    return [
        Action("raisonner", "extraire contraintes et prémisses (jamais de conclusion directe)",
               "", {}, "raisonnement", True),
        Action("verifier", "contrôler cohérence prémisses → conclusion", "faits", {}, "verification", True),
        Action("final", "rédiger la réponse", "", {}, "reponse", True),
    ]


@skill(
    "conversationnelle",
    "Réponse conversationnelle nuancée : recherche mémoire si pertinent, juge faits systématique.",
    types=("CONVERSATIONNEL",),
    outils=("recherche_fichiers",),
    genre_verificateur="faits",
    autorite=False,
)
def _plan_conversationnelle(question: str, niveau: str) -> list[Action]:
    actions: list[Action] = []
    if re.search(r"\b\w{3,}\(\)|\b(?:analyse|trouve|où est|cherche|lis)\b\s+\w+", question.lower()):
        actions.append(Action("outil", "chercher le symbole/fichier dans la mémoire documentaire "
                              "(symbole exact > fichier > lexical)", "recherche_fichiers",
                              {"requete": question}, "decision_outil", False))
    actions.extend([
        Action("raisonner", "comprendre la demande et répondre avec nuance", "", {}, "raisonnement", False),
        Action("verifier", "contrôler les affirmations (juge faits systématique)", "faits",
               {}, "verification", False),
        Action("final", "rédiger la réponse", "", {}, "reponse", True),
    ])
    return actions
