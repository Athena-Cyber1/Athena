"""Verifier — bus de vérification par type (spécification point 3 : CLAIM → PREUVE → VÉRIFICATION).

L'autorité : math/code/grammaire/devinettes = résultats d'outils.
Les faits LLM sans preuve restent HYPOTHESIS. Une divergence outil ↔ texte = CONTRADICTED.
"""
from __future__ import annotations

import re
from typing import Any

from ..verification import facts as vfacts
from ..verification import math as vmath
from .state import AgentState


def verifier(state: AgentState, genre: str) -> list[dict[str, Any]]:
    verdicts: list[dict[str, Any]] = []

    if genre == "math":
        obs = state.observation_de("solveur_math")
        if obs:
            attendu = obs.resultat.get("resultat")
            verdicts.append({"statut": "VERIFIED", "resume": f"solveur exact : {attendu}",
                             "preuve": obs.resultat.get("preuve"), "claim_id": "reponse"})
            # le chiffre final devra être celui-là — contrôlé par le critic
            state.contraintes.append(f"réponse numérique = {attendu}")

    elif genre == "code":
        obs = state.observation_de("simulateur_code")
        if obs:
            if obs.resultat.get("statut") == "CONTRADICTED":
                verdicts.append({"statut": "CONTRADICTED", "contradiction": True,
                                 "resume": obs.resultat.get("resume", "AST ≠ sandbox")})
            else:
                verdicts.append({"statut": "VERIFIED",
                                 "resume": f"sortie reproduite : {obs.resultat.get('sortie')!r} "
                                           f"({obs.resultat.get('croisement', 'ast')})",
                                 "preuve": "simulateur AST + sandbox python", "claim_id": "reponse"})
            state.contraintes.append(f"sortie code = {obs.resultat.get('sortie')!r}")

    elif genre == "grammaire":
        obs = state.observation_de("verificateur_grammaire")
        if obs and obs.resultat.get("statut") == "VERIFIED":
            verdicts.append({"statut": "VERIFIED",
                             "resume": f"phrase {'correcte' if obs.resultat.get('correcte') else 'incorrecte'} "
                                       f"— règle : {obs.resultat.get('regle')}",
                             "preuve": obs.resultat.get("preuve"), "claim_id": "reponse"})
            state.contraintes.append(f"verdict grammaire : correcte={obs.resultat.get('correcte')}")

    elif genre == "devinette":
        obs = state.observation_de("analyseur_devinette")
        if obs:
            r = obs.resultat
            if r.get("statut") == "VERIFIED":
                verdicts.append({"statut": "VERIFIED", "resume": f"réponse canonique : {r.get('reponse_courte')}",
                                 "preuve": r.get("source", "lexique"), "claim_id": "reponse"})
            else:
                verdicts.append({"statut": "UNKNOWN", "politique": "refus_honnete",
                                 "resume": "réponse incertaine → refus honnête exigé",
                                 "raisons": r.get("raisons", []), "claim_id": "reponse"})
                state.contraintes.append("interdiction d'inventer une réponse de devinette")

    elif genre == "faits":
        claims_llm = [c for c in state.claims if c.source in ("llm", None, "")]
        verdicts.extend(vfacts.verifier_claims_llm([c.vers_dict() for c in claims_llm])[:8])
        if not state.claims and state.type_tache == "FACTUEL":
            verdicts.append({"statut": "UNKNOWN", "resume": "aucun claim sourcé — réponse devra être prudente"})
        # v10.7 — JUGE SYSTÉMATIQUE (diagnostic §3.5) : le contrôle des faits
        # ne dépend plus d'un « chiffre présent » ou du type de tâche. Toute
        # réponse passe ici : les claims LLM sans preuve sont VISIBLEMENT
        # rétrogradés en hypothèses dans la trace (fini le juge muet →
        # faux confiant servi). Les claims sourcés gardent leur statut.
        elif state.claims:
            n_hyp = sum(1 for v in verdicts if v.get("statut") == "HYPOTHESIS")
            n_src = sum(1 for v in verdicts if v.get("statut") in ("SUPPORTED", "VERIFIED"))
            verdicts.append({"statut": "INFO", "resume":
                             f"juge faits : {n_src} claim(s) sourcé(s), {n_hyp} hypothèse(s) non prouvée(s)"})

    state.verification.extend(verdicts)
    for v in verdicts:
        state.consommer("verification", 10)
    return verdicts
