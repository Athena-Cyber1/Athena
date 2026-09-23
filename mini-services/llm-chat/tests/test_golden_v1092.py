"""GOLDEN TESTS v10.9.2 — incident P0 « LLM indisponible : HTTP Error 502 ».

INVARIANT : AUCUNE chaîne d'infrastructure (HTTP Error, Bad Gateway, 429/502,
LLM indisponible, corps du pont, traceback, host upstream) n'atteint la
réponse finale NI les libellés de raisonnement visibles de l'utilisateur.
Les détails techniques vivent UNIQUEMENT dans detail_interne / logs serveur /
GET /telemetrie.

Lancement : cd mini-services/llm-chat && PYTHONPATH=. python3 -m pytest tests/ -v
"""
from __future__ import annotations

import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from athena.agent import observer  # noqa: E402
from athena.agent.agent import run_agent  # noqa: E402
from athena.agent.state import AgentState  # noqa: E402
from athena.llm import engine as moteur_module  # noqa: E402
from athena.verification import canari  # noqa: E402

# Signatures de FUITE INFRA (miroir canari MOTIFS_INTERDITS + sanitize route.ts)
SIGNATURES_FUITE = (
    "http error", "bad gateway", "too many requests", "llm indisponible",
    "bridge llm", "internal-api", "api request failed", "function invoke failed",
    "traceback", "rate limit", "erreur interne :",
)


def fuite_dans(texte: str) -> list[str]:
    t = (texte or "").lower()
    return [s for s in SIGNATURES_FUITE if s in t]


# ------------------------------------------------------------------ helpers HTTP
def http_error_502(corps: dict) -> urllib.error.HTTPError:
    """HTTPError urllib, comme le pont v1 en produisait (str(e) = fuite)."""
    return urllib.error.HTTPError(
        url="http://127.0.0.1:3015/complete", code=502, msg="Bad Gateway",
        hdrs={}, fp=io.BytesIO(json.dumps(corps).encode()))


# =========================================================================
# CANARI — les nouvelles signatures de fuite sont des interdits
# =========================================================================
class TestCanariFuitesInfra:
    def test_prefixe_llm_indisponible_interdit(self):
        assert "fuite_prefixe_llm_indispo" in canari.violations("LLM indisponible : HTTP Error 502")

    def test_signatures_sdk_interdites(self):
        assert "fuite_sdk_request" in canari.violations("API request failed with status 429")
        assert "fuite_sdk_invoke" in canari.violations("Function invoke failed with status 429")

    def test_host_upstream_interdit(self):
        assert "fuite_upstream_host" in canari.violations("https://internal-api.z.ai/v1")

    def test_messages_pont_neutres_interdits(self):
        """Si un message neutre du pont atteignait la réponse finale, c'est une fuite
        (le sidecar écrit son PROPRE texte, jamais celui du pont)."""
        assert "fuite_pont_sature" in canari.violations(
            "Le modèle de langue est momentanément saturé.")
        assert "fuite_pont_pause" in canari.violations(
            "Le modèle de langue est momentanément en pause (surchargé).")
        assert "fuite_pont_demandes" in canari.violations(
            "Le modèle de langue reçoit trop de demandes pour le moment.")

    def test_pas_de_faux_positif_contenu_legitime(self):
        """Une réponse LÉGITIME à une question cyber sur les codes HTTP ne doit
        PAS être ré-émise cran (d) — les nombres nus et les mentions pédagogiques
        restent autorisés (choix délibéré v10.9.2)."""
        assert canari.violations("502 + 8 = 510") == []
        assert canari.violations(
            "L'erreur 502 Bad Gateway indique une passerelle défaillante.") == []
        assert canari.violations(
            "Le code 429 correspond à Too Many Requests : trop de requêtes.") == []
        assert canari.violations(
            "Un rate limit protège un serveur contre les surcharges.") == []

    def test_libelle_neutre_sidecar_autorise(self):
        """Le libellé HONNÊTE du sidecar (cran d) ne contient aucune signature."""
        assert canari.violations(
            "Le modèle de langue était momentanément indisponible, "
            "j'ai répondu avec mes outils déterministes.") == []


# =========================================================================
# MOTEUR — erreurs CODIFIÉES (aucune chaîne brute ne sort d'engine.py)
# =========================================================================
class TestMoteurCodifie:
    def test_httperror_502_ne_fuite_pas(self, monkeypatch):
        """Le scénario EXACT de l'incident : HTTPError 502 « Bad Gateway »."""
        def faux_urlopen(req, timeout=0):
            raise http_error_502({"erreur": "x", "code": "UPSTREAM_ERREUR"})

        monkeypatch.setattr("urllib.request.urlopen", faux_urlopen)
        r = moteur_module.MOTEUR.complete([{"role": "user", "content": "q"}])
        assert r is not None and "erreur" in r
        assert r["erreur"] == "MODELE_INDISPONIBLE"
        assert r["code"] in ("UPSTREAM_ERREUR", "RATE_LIMITED", "TIMEOUT",
                             "CIRCUIT_OUVERT", "QUEUE_SATUREE")
        assert "bad gateway" not in json.dumps(r).lower()
        assert "http error" not in json.dumps(r).lower()

    def test_rate_limited_pas_de_reprise_inutile(self, monkeypatch):
        """429 codifié : UNE seule tentative (pas de double appel inutile)."""
        appels = []

        def faux_urlopen(req, timeout=0):
            appels.append(1)
            raise http_error_502({"erreur": "saturé", "code": "RATE_LIMITED"})

        monkeypatch.setattr("urllib.request.urlopen", faux_urlopen)
        r = moteur_module.MOTEUR.complete([{"role": "user", "content": "q"}])
        assert len(appels) == 1
        assert r["code"] == "RATE_LIMITED"

    def test_pont_injoignable_code_stable(self, monkeypatch):
        """Réseau mort : code PONT_INJOIGNABLE, type d'exception jamais exposé."""
        def faux_urlopen(req, timeout=0):
            raise OSError("connection refused 127.0.0.1:3015")

        monkeypatch.setattr("urllib.request.urlopen", faux_urlopen)
        r = moteur_module.MOTEUR.complete([{"role": "user", "content": "q"}])
        assert r["code"] == "PONT_INJOIGNABLE"
        assert "connection refused" not in json.dumps(r).lower()

    def test_disponible_lit_le_circuit(self, monkeypatch):
        """llm_disponible=false (circuit OUVERT du pont) → disponible() False."""
        class FauxReponse:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return json.dumps({"ok": True, "llm_disponible": False}).encode()

        monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=0: FauxReponse())
        m = moteur_module.MoteurLLM()
        assert m.disponible(cache_s=0.0) is False

    def test_search_erreur_code_stable(self, monkeypatch):
        def faux_urlopen(req, timeout=0):
            raise http_error_502({"erreur": "x", "code": "RATE_LIMITED"})

        monkeypatch.setattr("urllib.request.urlopen", faux_urlopen)
        r = moteur_module.MOTEUR.search("test")
        assert r == {"erreur": "RECHERCHE_INDISPONIBLE"}


# =========================================================================
# OBSERVER — erreurs codifiées, libellés neutres
# =========================================================================
class TestObserverNeutre:
    def test_erreur_moteur_ne_fuite_pas(self, monkeypatch):
        monkeypatch.setattr(moteur_module.MOTEUR, "disponible", lambda cache_s=0.0: True)
        monkeypatch.setattr(moteur_module.MOTEUR, "complete",
                            lambda *a, **k: {"erreur": "MODELE_INDISPONIBLE",
                                             "code": "RATE_LIMITED"})
        state = AgentState(but="test")
        obs = observer.raisonner_llm(state, [{"role": "user", "content": "q"}])
        assert not obs.succes
        assert obs.erreurs == ["MODELE_INDISPONIBLE"]
        brut = json.dumps(obs.vers_dict(), default=str).lower()
        assert fuite_dans(brut) == []

    def test_moteur_down_erreur_neutre(self, monkeypatch):
        monkeypatch.setattr(moteur_module.MOTEUR, "disponible", lambda cache_s=0.0: False)
        state = AgentState(but="test")
        obs = observer.raisonner_llm(state, [{"role": "user", "content": "q"}])
        assert obs.erreurs == ["MODELE_INDISPONIBLE"]
        brut = json.dumps(obs.vers_dict(), default=str).lower()
        assert fuite_dans(brut) == []


# =========================================================================
# E2E — pipeline complet, LLM en échec codifié : AUCUNE fuite dans la
# réponse finale NI dans les libellés de trace (canal raisonnement UI)
# =========================================================================
@pytest.fixture()
def llm_rate_limited(monkeypatch):
    """Le pont est saturé (429 persistant) : erreurs CODIFIÉES comme en réel."""
    def complete(*a, **k):
        return {"erreur": "MODELE_INDISPONIBLE", "code": "RATE_LIMITED",
                "detail_interne": "HTTP 502 depuis le pont (RATE_LIMITED)"}

    monkeypatch.setattr(moteur_module.MOTEUR, "disponible", lambda cache_s=0.0: True)
    monkeypatch.setattr(moteur_module.MOTEUR, "complete", complete)
    monkeypatch.setattr(moteur_module.MOTEUR, "search",
                        lambda *a, **k: {"erreur": "RECHERCHE_INDISPONIBLE"})


class TestE2EaucuneFuite:
    QUESTIONS = [
        "Qu'est-ce qu'un VPN ?",
        "bonjour",
        "Calcule 2+2",
        "Quelle est la capitale de la France ?",
        "Comment fonctionne le chiffrement ?",
    ]

    @pytest.mark.parametrize("question", QUESTIONS)
    def test_reponse_et_raisonnement_propres(self, llm_rate_limited, question):
        r = run_agent(question, fil_id="fil-gold1092")
        # réponse finale : aucune signature de fuite
        assert fuite_dans(r["reponse"]) == [], f"fuite dans réponse : {r['reponse'][:120]}"
        assert canari.violations(r["reponse"]) == []
        # raisonnement (libellés visibles UI) : aucune signature de fuite
        for ev in r.get("trace", []):
            libelle = str(ev.get("libelle", ""))
            fuites = fuite_dans(libelle)
            assert fuites == [], f"fuite dans trace « {ev.get('evenement')} » : {libelle[:120]}"
        # l'étape llm_indisponible porte le LIBELLÉ NEUTRE exact
        etapes_llm = [ev for ev in r.get("trace", []) if ev.get("evenement") == "llm_indisponible"]
        for ev in etapes_llm:
            assert ev["libelle"] == ("modèle de langue momentanément indisponible "
                                     "— poursuite en mode déterministe")
            # le code interne reste dans les DÉTAILS (non rendus), jamais dans le libellé
            assert "MODELE" not in ev["libelle"].upper()

    def test_reponse_non_vide_et_substantielle(self, llm_rate_limited):
        r = run_agent("Quelle est la capitale de la France ?", fil_id="fil-gold1092b")
        assert len(r["reponse"].strip()) >= 10
        assert canari.detecter_non_reponse(r["reponse"]) is None


# =========================================================================
# TÉLÉMÉTRIE — statut providers exposé sans chaîne brute
# =========================================================================
class TestTelemetrieProviders:
    def test_statut_providers_structure(self, monkeypatch):
        class FauxReponse:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return json.dumps({"dispo": False, "circuit": {"etat": "OUVERT"},
                                   "compteurs": {"complete_ok": 1}}).encode()

        monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=0: FauxReponse())
        m = moteur_module.MoteurLLM()
        s = m.statut_providers(cache_s=0.0)
        assert s["dispo"] is False
        assert s["circuit"]["etat"] == "OUVERT"
