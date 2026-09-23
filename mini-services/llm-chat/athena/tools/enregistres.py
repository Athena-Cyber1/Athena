"""Outils déterministes enregistrés : solveur math, simulateur code, grammaire,
devinettes, python sandboxé, web, mémoire fichiers (spécification points 5/8/14/15/16).
"""
from __future__ import annotations

from typing import Any

from ..verification import code as vcode
from ..verification import grammar as vgram
from ..verification import math as vmath
from ..verification import riddle as vriddle
from ..memory import store as memoire
from ..llm.engine import MOTEUR
from .registry import outil

# ------------------------------------------------------------------ solveur math
@outil("solveur_math", "Résolution arithmétique exacte (pourcentages, expressions, problèmes types)",
       {"question": "str"}, risque="faible", autorite=True)
def solveur_math(question: str) -> dict[str, Any]:
    return vmath.resoudre(question)


# --------------------------------------------------------------- simulateur code
@outil("simulateur_code", "« Que va afficher ce code ? » → simulation AST + croisement sandbox",
       {"question": "str"}, risque="moyen", autorite=True)
def simulateur_code(question: str) -> dict[str, Any]:
    return vcode.resoudre_code(question)


# ----------------------------------------------------------- python sandbox brut
@outil("python_sandbox", "Exécute un petit script Python isolé (timeout 5 s) et retourne la sortie réelle",
       {"code": "str"}, risque="moyen", autorite=True)
def python_sandbox(code: str) -> dict[str, Any]:
    return vcode.sandbox(code)


# --------------------------------------------------------------------- grammaire
@outil("verificateur_grammaire", "Accord du participe passé (COD postposé/antéposé) — règles structurées",
       {"question": "str"}, risque="faible", autorite=True)
def verificateur_grammaire(question: str) -> dict[str, Any]:
    return vgram.resoudre_grammaire(question)


# --------------------------------------------------------------------- devinettes
@outil("analyseur_devinette", "Devinettes : lexique canonique ou refus honnête (jamais d'invention)",
       {"question": "str"}, risque="faible", autorite=True)
def analyseur_devinette(question: str) -> dict[str, Any]:
    return vriddle.resoudre(question)


# -------------------------------------------------------------------------- web
@outil("recherche_web", "Recherche web via bridge (résultats horodatés, fraîcheur annotée)",
       {"query": "str", "num": "int?"}, risque="moyen", autorite=False)
def recherche_web(query: str, num: int = 6) -> dict[str, Any]:
    from ..verification import facts as vfacts
    # v10.9.2 (P0) : raisons CODIFIÉES — plus jamais la chaîne d'erreur du pont
    # (elle était rendue dans la trace « observation » visible de l'UI).
    if not MOTEUR.disponible():
        return {"statut": "ERREUR", "raison": "recherche web momentanément indisponible"}
    r = MOTEUR.search(query, num=num)
    if not r or "erreur" in r:
        return {"statut": "ERREUR", "raison": "recherche web momentanément indisponible"}
    resultats = vfacts.horodater_web(r.get("resultats", []))
    return {"statut": "SUPPORTED", "resultats": resultats, "preuve": f"{len(resultats)} sources web horodatées"}


# ------------------------------------------------------------------- mémoire RAG
@outil("recherche_fichiers", "RAG symbole > fichier > lexical (BM25-lite) sur les fichiers ingérés",
       {"requete": "str"}, risque="faible", autorite=False)
def recherche_fichiers(requete: str) -> dict[str, Any]:
    resultats = memoire.chercher_fichiers(requete)
    if not resultats:
        return {"statut": "UNKNOWN", "raison": "aucun fichier ingéré ne correspond"}
    return {"statut": "SUPPORTED", "resultats": resultats, "preuve": "index fichiers (mémoire ≠ vérité)"}
