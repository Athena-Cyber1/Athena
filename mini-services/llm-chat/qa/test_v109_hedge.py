"""Test rapide v10.9 — hedge (c) + anaphore Troie (mock LLM)."""
import athena.llm.engine as engine


def complete(msgs, temperature=0.6, max_tokens=1200):
    dernier = msgs[-1]["content"]
    up = dernier.upper()
    if "RÉSOLUTION D" in up or "ANTÉCÉDENT" in up:
        return {"texte": "Vous parlez d Athéna : son rôle dans la guerre de Troie fut de "
                         "soutenir les Grecs (à vérifier).", "duree_ms": 5}
    if dernier.startswith("QUESTION :"):
        return {"texte": "Le pare-feu filtre le trafic réseau par règles (à vérifier).", "duree_ms": 5}
    return {"texte": "Je ne peux pas répondre à cette question.", "duree_ms": 5}


engine.MOTEUR.disponible = lambda cache_s=0.0: True
engine.MOTEUR.complete = complete
engine.MOTEUR.search = lambda *a, **k: {"erreur": "indisponible"}

from athena.agent.agent import run_agent  # noqa: E402
from athena.verification import canari  # noqa: E402

r = run_agent("Explique le principe du pare-feu informatique", mode="auto")
print("(c) pare-feu   :", r["classe_terminal"], "|", r["reponse"][:90].replace("\n", " "))
hist = [
    {"role": "utilisateur", "contenu": "Athéna est la déesse grecque de la sagesse."},
    {"role": "assistant", "contenu": "Oui, Athéna est la déesse de la sagesse."},
]
r2 = run_agent("Et quel était SON rôle dans la guerre de Troie ?", historique=hist, mode="auto")
print("anaphore Troie :", r2["classe_terminal"], "|", r2["reponse"][:120].replace("\n", " "))
print("canari:", canari.violations(r2["reponse"]), canari.detecter_non_reponse(r2["reponse"]))
print("codes:", r2["codes_raison"])
