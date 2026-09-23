"""Registre d'outils — déclaratif (spécification point 14), plus de branches codées en dur.

outil → résultat réel ; jamais « LLM → j'ai exécuté ».
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class Tool:
    nom: str
    description: str
    schema_entree: dict[str, str]
    risque: str                       # faible | moyen | eleve
    executer: Callable[..., dict[str, Any]]
    verificateur: Optional[Callable[..., dict[str, Any]]] = None
    autorite: bool = False            # True = vérité déterministe (spéc. point 31)


REGISTRE: dict[str, Tool] = {}


def outil(nom: str, description: str, schema: dict[str, str], risque: str = "faible",
          autorite: bool = False, verificateur: Optional[Callable] = None):
    def decorateur(fn: Callable[..., dict[str, Any]]):
        REGISTRE[nom] = Tool(nom=nom, description=description, schema_entree=schema,
                             risque=risque, executer=fn, verificateur=verificateur, autorite=autorite)
        return fn
    return decorateur


def executer(nom: str, arguments: dict[str, Any]) -> dict[str, Any]:
    t = REGISTRE.get(nom)
    if t is None:
        return {"statut": "ERREUR", "raison": f"outil inconnu : {nom}"}
    return t.executer(**arguments)


def lister() -> list[dict[str, Any]]:
    return [{"nom": t.nom, "description": t.description, "risque": t.risque, "autorite": t.autorite}
            for t in REGISTRE.values()]
