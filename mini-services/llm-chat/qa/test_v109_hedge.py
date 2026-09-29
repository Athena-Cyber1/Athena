"""Test rapide v10.9 — hedge (c) + anaphore Troie (mock LLM).

v1.2 (anti-bâclage, item 20) : converti en vraies fonctions de test (avant :
code au niveau module — collection impossible sans le fix model_id, et les
monkeypatchs MOTEUR + écritures mémoire polluaient les autres fichiers de
la suite). Restauration systématique du moteur après chaque test.
"""
import athena.llm.engine as engine


def complete(msgs, temperature=0.6, max_tokens=1200, model_id=None):
    dernier = msgs[-1]["content"]
    up = dernier.upper()
    if "RÉSOLUTION D" in up or "ANTÉCÉDENT" in up:
        return {"texte": "Vous parlez d Athéna : son rôle dans la guerre de Troie fut de "
                         "soutenir les Grecs (à vérifier).", "duree_ms": 5}
    if dernier.startswith("QUESTION :"):
        return {"texte": "Le pare-feu filtre le trafic réseau par règles (à vérifier).", "duree_ms": 5}
    return {"texte": "Je ne peux pas répondre à cette question.", "duree_ms": 5}


class MoteurMocke:
    """Garde-fou anti-pollution : le mock est posé et retiré par test."""

    def __init__(self, monkeypatch):
        self._sauve = (engine.MOTEUR.disponible, engine.MOTEUR.complete,
                       engine.MOTEUR.search)
        engine.MOTEUR.disponible = lambda cache_s=0.0: True
        engine.MOTEUR.complete = complete
        engine.MOTEUR.search = lambda *a, **k: {"erreur": "indisponible"}
        self._monkeypatch = monkeypatch

    def restaurer(self):
        (engine.MOTEUR.disponible, engine.MOTEUR.complete,
         engine.MOTEUR.search) = self._sauve


def test_hedge_parefeu(monkeypatch):
    mock = MoteurMocke(monkeypatch)
    try:
        from athena.agent.agent import run_agent  # noqa: E402
        r = run_agent("Explique le principe du pare-feu informatique", mode="auto")
        print("(c) pare-feu   :", r["classe_terminal"], "|", r["reponse"][:90].replace("\n", " "))
        assert r["reponse"]
    finally:
        mock.restaurer()


def test_anaphore_troie(monkeypatch):
    mock = MoteurMocke(monkeypatch)
    try:
        from athena.agent.agent import run_agent  # noqa: E402
        from athena.verification import canari  # noqa: E402
        hist = [
            {"role": "utilisateur", "contenu": "Athéna est la déesse grecque de la sagesse."},
            {"role": "assistant", "contenu": "Oui, Athéna est la déesse de la sagesse."},
        ]
        r2 = run_agent("Et quel était SON rôle dans la guerre de Troie ?", historique=hist, mode="auto")
        print("anaphore Troie :", r2["classe_terminal"], "|", r2["reponse"][:120].replace("\n", " "))
        print("canari:", canari.violations(r2["reponse"]), canari.detecter_non_reponse(r2["reponse"]))
        print("codes:", r2["codes_raison"])
        assert r2["reponse"]
    finally:
        mock.restaurer()
