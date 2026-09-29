"""Hygiène de suite (v1.2, anti-bâclage) : la fenêtre de dédup `voix._HISTORIQUE`
est un état global de processus — sans reset, l'ordre d'exécution change les
résultats (ex. `test_edge_injection_varie_et_substantiel` exige 3 variantes
distinctes). Reset automatique avant chaque test.
"""
import pytest

from athena.agent import voix


@pytest.fixture(autouse=True)
def _fenetre_dedup_vierge():
    voix.reinitialiser()
    yield
    voix.reinitialiser()
