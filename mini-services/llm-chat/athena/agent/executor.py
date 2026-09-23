"""Executor — exécute une action via le registre d'outils, en mesurant le réel."""
from __future__ import annotations

import time
from typing import Any

from ..tools import registry as reg
from ..tools import enregistres  # noqa: F401 — enregistre les outils au registre
from .state import Action, Observation


def executer(action: Action, state) -> Observation:
    """outil → résultat réel (jamais une simulation narrative)."""
    if action.type == "outil":
        nom = action.outil
        if nom not in reg.REGISTRE:
            obs = Observation(action=action, outil=nom, succes=False,
                              erreurs=[f"outil inconnu : {nom}"], id=f"O-{state.etape_courante:02d}")
            state.erreurs.append({"type": "outil_indisponible", "outil": nom})
            return obs
        debut = time.time()
        try:
            resultat = reg.executer(nom, dict(action.arguments))
            succes = resultat.get("statut") not in ("ERREUR",)
        except Exception as e:
            resultat, succes = {"statut": "ERREUR", "raison": f"{type(e).__name__}: {e}"}, False
        return Observation(action=action, outil=nom, succes=succes, resultat=resultat,
                           erreurs=[] if succes else [resultat.get("raison", "échec outil")],
                           duree_ms=int((time.time() - debut) * 1000), id=f"O-{state.etape_courante:02d}")
    # actions raisonner/verifier/final gérées dans agent.py
    return Observation(action=action, outil=action.outil or action.type, succes=False,
                       erreurs=["action non exécutable par l'executor"], id=f"O-{state.etape_courante:02d}")
