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
    2. les MOTIFS : un skill qui reconnaît une intention explicite l'emporte —
       « cherche des bugs » doit partir en repair-code, pas en code-simule
       (v10.11) ;
    3. le premier skill actif dont `types` contient type_tache.

    v10.11 : les motifs passent DEVANT le routage par type. Sans ça, tout skill
    long déclaré types=("CODE",) captait toutes les questions de code, et le
    modèle partait en mode tâche longue sur « que va afficher ce code ? ».
    """
    if skill_force:
        s = SKILLS.get(skill_force)
        if s and s.actif:
            return s
    for s in SKILLS.values():
        if s.actif and s.correspond(question):
            return s
    for s in SKILLS.values():
        if s.actif and type_tache in s.types:
            return s
    return None


def plan_de(s: Skill, question: str, niveau: str) -> list[Action]:
    return s.construire_plan(question, niveau)


# ---------------------------------------------------------------------------
# SKILLS « LONGUE TÂCHE » (v10.11) — goals, superpower, repair, navigateur
# ---------------------------------------------------------------------------
# SKILLS « LONGUE TÂCHE » (v10.11) — goals, superpower, repair, navigateur
# ---------------------------------------------------------------------------
#
# Les skills historiques répondent à UNE question. Les quatre suivants
# couvrent le tout autre régime : une tâche qui se déploie en dizaines de
# tours, où le modèle agit sur une machine (commandes, fichiers, navigateur)
# et doit LIVRER, pas décrire.
#
# ORDRE D'ENREGISTREMENT = ordre de PRIORITÉ de routage (SKILLS est un dict
# parcouru dans l'ordre d'insertion, et le premier type/motif qui matche
# gagne). Donc : repair et browser AVANT le plan générique, sinon « cherche
# des bugs » serait capté par goal-longue-tache au lieu de repair-code.

@skill(
    "goal-longue-tache",
    "TÂCHE LONGUE : transformer une demande en objectif mesurable, avancer par "
    "pas vérifiables, et ne livrer qu'un résultat constaté. Utilise les commandes "
    "(agent local) et le skill browser-rendu pour prouver.",
    # types VIDE, volontairement : ce plan est un filet de dernier recours
    # (tâche large sans signal précis). Avec types=("CODE",…) il captait TOUT
    # — « combien fait 2+2 ? » partait en tâche longue au lieu de math-exact.
    types=(),
    outils=("agent_local",),
    motifs=(r"\b(refais|nettoie|complète|termine)\b",
            r"\b(fais|exécute|lance)\s+(?:une\s+)?(?:migration|upgrade|release)\b"),
)
def _plan_goal_longue_tache(question: str, niveau: str) -> list[Action]:
    return [
        Action("raisonner",
               "OBJECTIF : reformuler la demande en un résultat vérifiable "
               "(un fichier modifié + relu, un test qui passe). Écris-le en une "
               "phrase, avec le critère de fin. Ne commence pas les commandes "
               "avant d'avoir cet objectif.", "", {}, "raisonnement", False),
        Action("outil",
               "état des lieux : lister les fichiers concernés et mesurer leur "
               "taille avant toute lecture massive",
               "agent_local", {"requete": question}, "decision_outil", True),
        Action("raisonner",
               "PLAN : choisir un seul sous-objectif à chaque tour (pas les dix), "
               "et dire la commande qui l'accomplit. Tu as droit à un seul bug "
               "corrigé et vérifié plutôt qu'à dix bugs supposés.",
               "", {}, "raisonnement", False),
        Action("verifier",
               "Vérifier par l'EXÉCUTION : le fichier a-t-il changé ? la "
               "commande de test passe-t-elle ? Un correctif non relu n'est pas "
               "un correctif.", "code", {}, "verification", True),
        Action("final",
               "VERDICT TERMINAL : ce qui a été trouvé, ce qui a été réellement "
               "modifié (chemin + lignes), ce qui a été testé et son résultat, "
               "et ce qui reste hors de portée. Aucune promesse d'action future.",
               "", {}, "reponse", True),
    ]


@skill(
    "superpower",
    "SUPERPOWER : mode pleine puissance. Aucun plafond de tokens, contexte large, "
    "compression seulement en dernier recours, et interdiction de s'arrêter sur "
    "une intention ou une rétro-analyse. Pour les travaux longs et techniques.",
    types=("CODE",),
    outils=("agent_local",),
    motifs=(r"\bsuperpower\b", r"\bpleine puissance\b", r"\bmode (?:max|maximum)\b"),
)
def _plan_superpower(question: str, niveau: str) -> list[Action]:
    return [
        Action("raisonner",
               "SUPERPOWER : pas de plan, que de l'exécution. À chaque tour : "
               "une commande, un résultat, la suivante. Aucune réponse d'intention, "
               "aucune re-analyse du même point : si tu hésites entre deux "
               "hypothèses, tranche et teste — le test tranche pour toi.",
               "", {}, "raisonnement", False),
        Action("outil",
               "exécuter la prochaine étape réelle (lecture ciblée, test, "
               "correction, sauvegarde)",
               "agent_local", {"requete": question}, "decision_outil", True),
        Action("verifier",
               "constater par la machine, jamais par affirmation : relire le "
               "fichier, relancer le test, comparer avant/après",
               "code", {}, "verification", True),
        Action("final",
               "bilan factuel et complet. Si une partie n'a pas été faite, dis-le "
               "explicitement plutôt que de l'annoncer comme acquise.",
               "", {}, "reponse", True),
    ]


@skill(
    "repair-code",
    "REPAIR : trouver de VRAIS bugs de fonctionnement (pas des vulnérabilités, "
    "pas du style), corriger à Surgical avec sauvegarde, et prouver par exécution.",
    types=("CODE",),
    outils=("agent_local", "simulateur_code"),
    genre_verificateur="code",
    motifs=(r"\bbugs?\b", r"\bbogue?s?\b", r"\bne (?:marche|joue|funcionne) pas\b",
            r"\bplante\b", r"\bcrash", r"\bne (?:se|l') (?:déplace|ouvre|charge)"),
)
def _plan_repair_code(question: str, niveau: str) -> list[Action]:
    return [
        Action("raisonner",
               "chercher des DÉFAUTS DE FONCTIONNEMENT : conditions d'arrêt, "
               "limites de tableau hors bornes, divisions par zéro, gestion "
               "d'erreur manquante, vecteurs mal normalisés, état non réinitialisé. "
               "PAS de style, PAS de sécurité — l'utilisateur les a exclus.",
               "", {}, "raisonnement", False),
        Action("outil",
               "sauvegarder AVANT toute modification : "
               "Copy-Item -LiteralPath <f> -Destination <f.bak>", "agent_local",
               {"requete": question}, "decision_outil", True),
        Action("outil",
               "corriger au plus juste (une ligne si possible), puis relire le "
               "fichier pour confirmer l'écriture",
               "agent_local", {"requete": question}, "decision_outil", True),
        Action("verifier",
               "PREUVE : node --check sur du JS, exécution du jeu en navigateur "
               "si possible, sinon relecture ciblée du correctif. Distingue "
               "explicitement ce qui est testé de ce qui ne l'est pas.",
               "code", {}, "verification", True),
        Action("final",
               "bugs trouvés (symptôme + cause + correctif) + modifications "
               "réellement écrites + tests réellement passés",
               "", {}, "reponse", True),
    ]


@skill(
    "browser-rendu",
    "NAVIGATEUR : ouvrir réellement une page web et constater le rendu (capture, "
               "erreurs console, DOM), au lieu de supposer que ça marche.",
    types=("CODE",),
    outils=("navigateur",),
    motifs=(r"\bteste? (?:le |la )?(?:jeu|page|site|app|web|interface)\b",
            r"\b(rendu|rendez|capture|screenshot|aperçu)\b",
            r"\bouvr(?:e|ez|ir) (?:le jeu|la page|mon site)\b"),
)
def _plan_browser_rendu(question: str, niveau: str) -> list[Action]:
    return [
        Action("raisonner",
               "TESTER DANS UN VRAI NAVIGATEUR, pas seulement en statique. Trois "
               "niveaux de preuve, du plus faible au plus fort : (1) node --check "
               "= syntaxe ; (2) exécution headless = le script ne plante pas et "
               "la page rend ; (3) interaction = on bouge, on tire, on vérifie "
               "l'état du jeu. Ne présente JAMAIS (1) comme si c'était (3).",
               "", {}, "raisonnement", False),
        Action("outil",
               "lancer un navigateur headless et capturer : "
               "msedge --headless=new --disable-gpu --screenshot=<f>.png "
               "--window-size=1280,800 <url>  (ou chrome ; trouve le binaire "
               "avec Get-Command msedge,chrome,chromium -ErrorAction "
               "SilentlyContinue)", "navigateur", {"requete": question},
               "decision_outil", True),
        Action("outil",
               "relire les erreurs console (WebGL, script) et le DOM rendu : "
               "sans elles, un canvas noir passe pour un succès",
               "navigateur", {"requete": question}, "decision_outil", True),
        Action("verifier",
               "constater le rendu (fichier image non vide) et l'absence d'erreur "
               "console bloquante", "code", {}, "verification", True),
        Action("final",
               "dire EXACTEMENT ce qui a été exécuté et ce qui reste non testé",
               "", {}, "reponse", True),
    ]


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


# ---------------------------------------------------------------------------
# MCP (Model Context Protocol) — n'importe quel serveur externe branchable
# ---------------------------------------------------------------------------
# Routage PAR MOTIF uniquement (types=()) : une question qui cite « mcp » ou un
# serveur configuré part en appel réel, sinon rien ne change au routage normal.
# Les noms de serveurs viennent de mcp.json — la liste reste dynamique.

def _motifs_mcp() -> tuple[str, ...]:
    from ..tools import mcp as pont_mcp
    noms = sorted({n.lower() for n in pont_mcp.lire_config()}
                  - {"fetch", "http", "github", "files"})
    motifs = [r"\bmcp\b", r"\bmodel context protocol\b"]
    motifs += [rf"\b{re.escape(n)}\b" for n in noms if len(n) >= 4]
    motifs += [rf"\b{re.escape(n)}\s*\.\s*[a-z_]+\b" for n in noms if len(n) >= 4]
    return tuple(motifs)


@skill(
    "mcp-appel",
    "MCP : appeler un outil d'un serveur externe branché (blender, google drive…). "
    "L'appel est réel — résultat du serveur, jamais une description d'action.",
    types=(),
    outils=("mcp_appel", "mcp_inventaire"),
    motifs=_motifs_mcp(),
)
def _plan_mcp_appel(question: str, niveau: str) -> list[Action]:
    return [
        Action("outil",
               "appel réel du serveur MCP : syntaxe mcp(serveur.outil) {args json} "
               "si précisé, sinon l'outil choisit dans l'inventaire — une erreur "
               "MCP est un résultat à rapporter, pas à masquer",
               "mcp_appel", {"requete": question}, "decision_outil", True),
        Action("verifier",
               "contrôler le retour du serveur (statut + contenu) et distinguer ce "
               "qui est constaté côté serveur de ce qui reste à faire",
               "faits", {}, "verification", False),
        Action("final", "rédiger la réponse avec la provenance : serveur + outil appelé",
               "", {}, "reponse", True),
    ]

