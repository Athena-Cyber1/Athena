"""Planner — classification déterministe, estimateur de complexité, décomposition.

La réponse finale n'est jamais la première chose produite : chaque plan passe
par outil(s) d'autorité → observation → vérification → (explication LLM) → critic.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import skills as skill_reg
from .state import Action, AgentState

# ------------------------------------------------------------ classification
MOTIFS = {
    "CODE": (r"```(?:python|py)", r"que va (?:t['’]?|il )?affich", r"quel (?:est le )?(?:r[ée]sultat|sortie) du (?:code|programme)",
             r"for\s+\w+\s+in\s+range\(", r"while\s+.*:", r"print\s*\(", r"compteur\s*[+\-]?=", r"def\s+\w+\(.*\)\s*:"),
    "MATH": (r"r[ée]duction|remise|rabais|solde|augment|hausse|pourcentage|tva|taxe", r"\d+\s*(?:€|euros?|%|kg|km\/h)",
             r"combien\s+(?:co[ûu]te|font|fait|de)", r"\d+\s*[\+\-\*\/×÷\^]\s*\d+", r"quel\s+(?:est\s+le\s+)?(?:prix|montant|total|résultat)",
             # v10.8 (Classe 3) — comptage de lettres : outil déterministe, pas du LLM
             r"(?:combien\s+de\s+lettres\s+dans|nombre\s+de\s+lettres\s+dans)",
             # v10.9 (N3) — fractions en mots, conversions (ratio + températures
             # affines), constantes triviales : tout ce que le solveur sait
             # résoudre de façon DÉTERMINISTE route vers MATH.
             r"\b(?:quarts?|tiers|moiti[ée]|demie?|cinqui[eè]mes?|sixi[eè]mes?|dixi[eè]mes?|centi[eè]mes?)\s+(?:de|du|des|d['’])\s*",
             r"\bconverti[rsz]?\b",
             r"\ben\s+(?:m|km|cm|mm|kg|g|t|l|ml|min|h|s|jours?|heures?|minutes?|secondes?|semaines?|fahrenheit|celsius|kelvin)\b",
             r"\b(?:fahrenheit|celsius|kelvin)\b|\b°\s*[cfk]\b",
             r"combien\s+(?:y\s+a[\s\-t]*il\s+)?de\s+(?:jours?|minutes?|heures?|secondes?|semaines?|km|m|cm|mm|kg|g|tonnes?|litres?|ml)\b",
             r"\b(?:multipli[ée]s?\s+par|divis[ée]s?\s+par|divis[ée]s?\s+par\s+z[ée]ro)\b",
             r"\b(?:vingts?|trente|quarante|cinquante|soixante|mille|cents?)\b.*\b(?:fois|multipli|divis)\b"),
    "DEVINETTE": (r"mon\s+premier", r"mon\s+second", r"mon\s+deuxi[eè]me", r"mon\s+tout", r"qui\s+suis[-\s]je",
                  r"des\s+dents.*mord", r"je\s+suis\s+.*mais", r"\bai[-\s]je\b"),
    "LINGUISTIQUE": (r"se\s+sont\s+\w+[éèse]?\b|accord|participe\s+pass[ée]|grammair|orthographe|conjugaison|"
                     r"phrase\s+(?:est[-\s]elle|correcte|fausse)|correcte\s*\?|bien\s+[ée]crit|lav[ée]+s?\b",),
    "LOGIQUE": (r"tous?\s+les?\s+.*sont|si\s+.*alors|syllogisme|paradoxe|d[ée]duction|pr[ée]misse",),
    "FACTUEL": (r"qui\s+(?:est|a|a [ée]crit)|quel(?:le)?s?\s+(?:est|sont|a)|quand|où\s+se|c'est quoi|c['’]est quoi|"
                r"capitale|président|population|date\s+de",
                # v10.7 — diagnostic §1/§3 : « Qu'est-ce qu'un VPN ? » tombait en
                # CONVERSATIONNEL → ni RAG, ni web, ni juge → refus « contexte
                # insuffisant ». Perceptions d'information + vocabulaire
                # technique/réseau (regex cyber élargie) routent vers FACTUEL.
                r"qu['’]?est[- ]ce qu[e']?", r"comment\s+(?:fonctionne|marche|s'utilise)",
                r"\bà quoi (?:sert|servent)\b", r"d[ée]fin(?:is|ir|ition)\b",
                r"\bexplique[- ]moi\b", r"que\s+(?:veut dire|signifie)\b",
                r"\b(?:vpn|proxy|pare-?feu|firewall|chiffrement|cryptage|dns|ssh|https?|"
                r"tcp|udp|adresse\s+ip|serveur|protocole|routeur|bande\s+passante|"
                r"algorithme|base\s+de\s+donn[ée]es|blockchain|machine\s+learning|"
                r"intelligence\s+artificielle|syst[eè]me\s+d'exploitation|ransomware|phishing)\b",),
}


def classifier(question: str) -> str:
    q = question.lower()
    # v10.8 (Classe 1 du benchmark) — intention DÉFINITION de code : la question
    # PARLE d'une fonction (« que fait print() ? », « à quoi sert len() ? »)
    # sans en CONTENIR le corps → question de connaissance, pas de simulation.
    # Le simulateur ne peut rien exécuter dessus → il produisait un refus vide.
    if (_RE_INTENTION_DEF_CODE.search(question)
            and not _RE_INDICATEURS_CODE_REEL.search(question)):
        return "FACTUEL"
    for type_tache, motifs in MOTIFS.items():
        if any(re.search(m, q) for m in motifs):
            return type_tache
    return "CONVERSATIONNEL"


# v10.8 — intention définitionnelle (parle D'UNE fonction sans montrer de code)
_RE_INTENTION_DEF_CODE = re.compile(
    r"(?:que\s+fait|que\s+font|qu['’]?est[- ]ce\s+qu[e']|[àa]\s+quoi\s+sert)\s+"
    r"(?:la\s+(?:fonction|m[ée]thode|classe)\s+)?\w+\s*\(\s*\)", re.IGNORECASE)
_RE_INDICATEURS_CODE_REEL = re.compile(
    r"```|\bdef\s+\w+\s*\(|\bfor\s+\w+\s+in\b|\bwhile\b|\bimport\b|^\s*\w+\s*=\s*\S",
    re.MULTILINE)


# --------------------------------------------------------- estimateur complexité
@dataclass
class ComplexiteTache:
    nb_contraintes: int = 0
    nb_entites: int = 0
    profondeur_dependances: int = 0
    ambiguite: float = 0.0
    info_externe_requise: bool = False
    calcul_requis: bool = False
    analyse_code_requise: bool = False
    multi_etapes: bool = False
    appels_outils_attendus: int = 1
    niveau: str = "simple"


def estimer_complexite(question: str, type_tache: str) -> ComplexiteTache:
    c = ComplexiteTache()
    c.nb_entites = len(re.findall(r"\b[A-ZÉÈÀ]\w+\b", question))
    c.nb_contraintes = len(re.findall(r"\b(?:et|puis|ensuite|de plus|après|avant)\b", question.lower()))
    c.calcul_requis = type_tache == "MATH"
    c.analyse_code_requise = type_tache == "CODE"
    c.info_externe_requise = type_tache in ("FACTUEL",)
    c.multi_etapes = c.nb_contraintes >= 2 or type_tache in ("CODE", "MATH")
    c.appels_outils_attendus = 2 if type_tache in ("CODE",) else 1
    if type_tache in ("MATH", "CODE", "LINGUISTIQUE", "DEVINETTE"):
        c.niveau = "medium"
    if c.nb_contraintes >= 3 or (c.multi_etapes and c.info_externe_requise):
        c.niveau = "hard"
    return c


# ------------------------------------------------------------------------ plans
def _actions(type_tache: str, question: str, niveau: str) -> list[Action]:
    if type_tache == "MATH":
        return [
            Action("outil", "résoudre par le solveur mathématique exact", "solveur_math",
                   {"question": question}, "decision_outil", True),
            Action("verifier", "vérifier la cohérence du résultat", "math", {}, "verification", True),
            Action("raisonner", "expliquer le calcul à partir de l'observation", "", {}, "raisonnement", False),
            Action("final", "rédiger la réponse", "", {}, "reponse", True),
        ]
    if type_tache == "CODE":
        return [
            Action("outil", "extraire et exécuter le code (AST + sandbox)", "simulateur_code",
                   {"question": question}, "decision_outil", True),
            Action("verifier", "contrôler reproductibilité de la sortie", "code", {}, "verification", True),
            Action("raisonner", "expliquer l'exécution pas à pas", "", {}, "raisonnement", False),
            Action("final", "rédiger la réponse", "", {}, "reponse", True),
        ]
    if type_tache == "LINGUISTIQUE":
        return [
            Action("outil", "appliquer les règles d'accord (COD postposé/antéposé)", "verificateur_grammaire",
                   {"question": question}, "decision_outil", True),
            Action("verifier", "vérifier la règle appliquée", "grammaire", {}, "verification", True),
            Action("raisonner", "expliquer la règle", "", {}, "raisonnement", False),
            Action("final", "rédiger la réponse", "", {}, "reponse", True),
        ]
    if type_tache == "DEVINETTE":
        return [
            Action("outil", "analyser la devinette (lexique / charade) avec politique d'honnêteté",
                   "analyseur_devinette", {"question": question}, "decision_outil", True),
            Action("verifier", "contrôler la politique anti-invention", "devinette", {}, "verification", True),
            Action("raisonner", "formuler la réponse ou le refus justifié", "", {}, "raisonnement", False),
            Action("final", "rédiger la réponse", "", {}, "reponse", True),
        ]
    if type_tache == "FACTUEL":
        return [
            Action("outil", "chercher dans la mémoire documentaire (symbole > fichier > lexique)",
                   "recherche_fichiers", {"requete": question}, "decision_outil", False),
            Action("outil", "recherche web horodatée si le bridge est disponible", "recherche_web",
                   {"query": question[:400], "num": 5}, "decision_outil", False),
            Action("raisonner", "synthétiser avec provenance (faits vs hypothèses)", "", {}, "raisonnement", False),
            Action("verifier", "contrôler provenance des claims", "faits", {}, "verification", True),
            Action("final", "rédiger la réponse", "", {}, "reponse", True),
        ]
    if type_tache == "LOGIQUE":
        return [
            Action("raisonner", "extraire contraintes et prémisses (jamais de conclusion directe)", "", {}, "raisonnement", True),
            Action("verifier", "contrôler cohérence prémisses → conclusion", "faits", {}, "verification", True),
            Action("final", "rédiger la réponse", "", {}, "reponse", True),
        ]
    actions: list[Action] = []
    # question orientée code/symbole → chercher d'abord dans la mémoire documentaire
    if re.search(r"\b\w{3,}\(\)|\b(?:analyse|trouve|où est|cherche|lis)\b\s+\w+", question.lower()):
        actions.append(Action("outil", "chercher le symbole/fichier dans la mémoire documentaire "
                              "(symbole exact > fichier > lexical)", "recherche_fichiers",
                              {"requete": question}, "decision_outil", False))
    actions.extend([
        Action("raisonner", "comprendre la demande et répondre avec nuance", "", {}, "raisonnement", False),
        # v10.7 — juge systématique : la réponse conversationnelle est aussi
        # contrôlée (claims LLM → hypothèses, verdict visible en trace).
        Action("verifier", "contrôler les affirmations (juge faits systématique)", "faits", {}, "verification", False),
        Action("final", "rédiger la réponse", "", {}, "reponse", True),
    ])
    return actions


def creer_plan(state: AgentState, skill_force: str | None = None) -> list[Action]:
    """Construit le plan via le registre de skills (fallback : templates historiques).

    skill_force (option API/UI) sélectionne explicitement un skill actif ;
    sinon le skill est choisi par type de tâche / motifs. Le skill retenu est
    stocké sur le state pour la trace et le paquet final.
    """
    s = skill_reg.selectionner(state.type_tache, state.but, skill_force=skill_force)
    if s is not None:
        actions = skill_reg.plan_de(s, state.but, state.complexite)
        state.skill = s.nom
        state.plan = actions
        return actions
    actions = _actions(state.type_tache, state.but, state.complexite)
    state.skill = ""
    state.plan = actions
    return actions


def replanifier(state: AgentState) -> list[Action]:
    """Après un échec du critic : ajoute une re-computation ciblée + contre-vérification."""
    state.replans += 1
    supplement: list[Action] = []
    if state.type_tache == "MATH":
        m = re.search(r"-?\d+(?:[.,]\d+)?", state.reponse_courte or "")
        expr = m.group(0).replace(",", ".") if m else "0"
        supplement = [Action("outil", "re-calcul par python sandboxé (contre-vérification)", "python_sandbox",
                             {"code": f"print({expr})"}, "verification", True)]
    elif state.type_tache == "CODE":
        supplement = [Action("outil", "re-exécuter le code via sandbox seul", "simulateur_code",
                             {"question": state.but}, "verification", True)]
    elif state.type_tache == "DEVINETTE":
        supplement = [Action("raisonner", "formuler le refus honnête structuré (raisons listées)", "", {},
                             "reponse", True)]
    else:
        supplement = [Action("raisonner", "reformuler avec preuves disponibles uniquement", "", {}, "raisonnement", True)]
    supplement.append(Action("final", "rédiger à nouveau la réponse corrigée", "", {}, "reponse", True))
    state.plan.extend(supplement)
    return supplement
