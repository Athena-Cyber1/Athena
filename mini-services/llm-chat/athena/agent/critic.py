"""Critic — les 10 questions de critique de raisonnement (spécification point 7).

Sortie structurée : {"ok": bool, "erreurs": [{"type", "claim", "attendu"}], "action": ...}

v10.9 — N1 (invariant « rendu_final, unique point de sortie ») :
- le critic ne REJETE plus en solo : toute erreur détectée est accompagnée
  d'une CONTRE-PROPOSITION (contre_proposition) — en général la ré-émission
  outillée (l'outil d'autorité fait foi), qui passe les mêmes gates par
  construction et diffère de la réponse rejetée ;
- un rejet SANS contre-proposition possible est LOGGÉ (rejet_sans_proposition)
  et le rendu final revient de toute façon à l'échelle de dégradation du
  rendu_final — jamais un refus sec du critic.
"""
from __future__ import annotations

import re
from typing import Any

from .state import AgentState


def critique(state: AgentState, projet_reponse: str) -> dict[str, Any]:
    erreurs: list[dict[str, Any]] = []
    action = "accepter"

    # 1. Ai-je répondu à la bonne question ? (couverture minimale par type)
    if state.type_tache in ("MATH", "CODE") and not state.observation_de("solveur_math") and not state.observation_de("simulateur_code"):
        erreurs.append({"type": "etape_manquante", "claim": "aucun outil d'autorité exécuté",
                        "attendu": "solveur_math ou simulateur_code"})

    # 4. Ai-je sauté une étape ?
    sautees = [a.objectif for a in state.plan if a.critique and not a.fait]
    if sautees:
        erreurs.append({"type": "etape_manquante", "claim": f"étapes critiques non couvertes : {sautees[:2]}",
                        "attendu": "toutes les étapes critiques"})

    # 5. Contradiction produite ?
    contradictions = [v for v in state.verification if v.get("contradiction")]
    if contradictions:
        erreurs.append({"type": "contradiction", "claim": contradictions[0].get("resume", ""),
                        "attendu": "cohérence AST/sandbox"})
        action = "recompute"

    # 8. La conclusion suit-elle les prémisses ? (nombres du texte = observation d'autorité)
    if state.type_tache == "MATH":
        obs = state.observation_de("solveur_math")
        if obs and obs.resultat.get("statut") == "VERIFIED":
            # v10.8 (Classe 3) : certains résultats vérifiés ne sont PAS numériques
            # (ex. « indéfini (division par zéro) ») — le contrôle numérique est
            # simplement sauté, JAMAIS une erreur de critic.
            attendu_num = obs.resultat.get("resultat_num")
            if attendu_num is not None:
                attendu = float(attendu_num)
                nums = [float(n.replace(",", ".")) for n in re.findall(r"-?\d+(?:[.,]\d+)?", projet_reponse)]
                if not any(abs(n - attendu) < 1e-9 for n in nums):
                    erreurs.append({"type": "arithmetic", "claim": f"nombres {nums[:4]}", "attendu": attendu})
                    action = "recompute"

    if state.type_tache == "CODE":
        obs = state.observation_de("simulateur_code")
        if obs and obs.resultat.get("sortie") is not None:
            sortie = str(obs.resultat.get("sortie")).strip()
            if sortie and sortie not in projet_reponse:
                erreurs.append({"type": "resultat_absent", "claim": f"sortie {sortie!r} absente du texte",
                                "attendu": sortie})
                action = "recompute"

    # 9. Hypothèse présentée comme fait ?
    if state.type_tache == "DEVINETTE":
        obs = state.observation_de("analyseur_devinette")
        if obs and obs.resultat.get("statut") == "UNKNOWN":
            honnete = ("pas déterminer" in projet_reponse.lower()
                       or "pas avec certitude" in projet_reponse.lower()
                       or "je ne peux pas" in projet_reponse.lower())
            if not honnete:
                erreurs.append({"type": "invention", "claim": "réponse de devinette sans preuve",
                                "attendu": "refus honnête explicite"})
                action = "recompute"
            if obs.resultat.get("raisons") and re.search(r"\b(vache|escargot)\b", projet_reponse.lower()):
                erreurs.append({"type": "invention", "claim": "réponse inventée malgré incertitude",
                                "attendu": "aucune invention"})

    # 3. Fait inventé (claim sans preuve marqué fait)
    for c in state.claims:
        if c.type == "fait" and not c.preuves and c.statut in ("VERIFIED", "SUPPORTED") and c.source in ("llm", None, ""):
            erreurs.append({"type": "invention", "claim": c.texte[:80], "attendu": "statut HYPOTHESIS"})
            c.statut = "HYPOTHESIS"
            action = "accepter" if action == "recompute" else action

    # 10. Reproductible ? (code : re-simuler une 2e fois)
    if state.type_tache == "CODE" and not any(e.get("type") == "non_reproductible" for e in erreurs):
        obs = state.observation_de("simulateur_code")
        if obs and obs.resultat.get("statut") == "VERIFIED":
            from ..verification import code as vcode
            re_sim = vcode.resoudre_code(state.but)
            if re_sim.get("sortie") != obs.resultat.get("sortie"):
                erreurs.append({"type": "non_reproductible", "claim": "deux exécutions divergent", "attendu": obs.resultat.get("sortie")})
                action = "recompute"

    ok = not erreurs
    if not ok and action == "accepter" and any(e["type"] in ("arithmetic", "contradiction", "invention") for e in erreurs):
        action = "recompute"
    if state.replans >= state.max_replans and action == "recompute":
        action = "echec_honnete"
    return {"ok": ok, "erreurs": erreurs, "action": action}


# ------------------------------------------------------------- v10.9 N1
def contre_proposition(state: AgentState, erreurs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """N1 — un rejet n'est recevable qu'accompagné d'une contre-proposition qui
    passe les mêmes gates et DIFFÈRE de la réponse rejetée. Ici, la seule
    source de contre-proposition recevable est l'OUTIL d'autorité : on
    ré-émet la réponse à partir du résultat vérifié (jamais du LLM, qui serait
    rejeté par les mêmes gates). Retourne None si aucune contre-proposition
    recevable → l'appelant logge un « rejet_sans_proposition » et laisse le
    rendu_final appliquer sa politique de dégradation."""
    if not erreurs:
        return None
    types = {e["type"] for e in erreurs}

    # mismatch arithmétique → le solveur fait foi : ré-émission outillée
    if "arithmetic" in types:
        obs = state.observation_de("solveur_math")
        if obs and obs.resultat.get("statut") == "VERIFIED":
            return {
                "reponse": (f"**{obs.resultat.get('resultat')}**\n\n{obs.resultat.get('preuve', '')}"),
                "reponse_courte": str(obs.resultat.get("resultat")),
                "statut": "VERIFIED", "source": "outil:solveur_math",
            }

    # sortie de code absente du texte → le sandbox fait foi
    if "resultat_absent" in types:
        obs = state.observation_de("simulateur_code")
        if obs and obs.resultat.get("sortie") is not None:
            sortie = str(obs.resultat.get("sortie"))
            return {
                "reponse": (f"Ce code affiche :\n\n```\n{sortie}\n```\n\n"
                            f"Vérification : {obs.resultat.get('croisement', 'simulation AST')} "
                            f"({obs.resultat.get('pas', '?')} pas simulés)."),
                "reponse_courte": sortie,
                "statut": "VERIFIED", "source": "outil:simulateur_code",
            }

    # contradiction sandbox/AST → ré-exécution arbitrée par le sandbox
    if "contradiction" in types or "non_reproductible" in types:
        obs = state.observation_de("simulateur_code")
        if obs and obs.resultat.get("sortie") is not None:
            sortie = str(obs.resultat.get("sortie"))
            return {
                "reponse": (f"**Conflit détecté et arbitré** : le sandbox fait foi.\n"
                            f"Sortie retenue :\n```\n{sortie}\n```"),
                "reponse_courte": sortie,
                "statut": "VERIFIED", "source": "outil:simulateur_code",
            }

    return None
