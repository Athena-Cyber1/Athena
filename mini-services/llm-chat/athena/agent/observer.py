"""Observer — transforme une observation brute en faits/claims tracés dans l'état."""
from __future__ import annotations

from typing import Any

from ..agent.state import AgentState, Claim, Observation
from ..llm.engine import MOTEUR


def observer(obs: Observation, state: AgentState) -> None:
    """Observation → claims : l'outil d'autorité crée des claims VERIFIED ; le LLM jamais."""
    if obs.outil in ("solveur_math", "simulateur_code", "verificateur_grammaire", "analyseur_devinette",
                     "python_sandbox") and obs.succes:
        r = obs.resultat
        texte = r.get("sortie") or r.get("resultat") or r.get("reponse_courte") or ""
        type_claim = {"solveur_math": "math", "simulateur_code": "code", "python_sandbox": "code",
                      "verificateur_grammaire": "grammaire", "analyseur_devinette": "devinette"}[obs.outil]
        statut = r.get("statut", "SUPPORTED")
        if statut == "VERIFIED":
            claim = state.ajouter_claim(Claim(
                id=state.prochain_id("C"), texte=f"résultat vérifié : {texte}", type=type_claim,
                source=obs.outil, preuves=[obs.id], confiance=1.0, statut="VERIFIED", verifie=True))
            state.reponse_courte = str(texte)
        else:
            claim = state.ajouter_claim(Claim(
                id=state.prochain_id("C"), texte=r.get("raison", "incertitude outil"), type=type_claim,
                source=obs.outil, preuves=[obs.id], confiance=0.2, statut="UNKNOWN"))
            if obs.outil == "analyseur_devinette" and r.get("reponse_courte"):
                state.reponse_courte = r["reponse_courte"]
        state.faits.append({"contenu": claim.texte, "source": obs.outil, "verifie": True,
                            "confiance": claim.confiance, "preuves": [obs.id]})

    elif obs.outil == "recherche_web" and obs.succes:
        for res in obs.resultat.get("resultats", [])[:4]:
            state.ajouter_claim(Claim(id=state.prochain_id("C"),
                                      texte=f"{res.get('titre','')} — {res.get('url','')}",
                                      type="fait", source=res.get("url", "web"),
                                      preuves=[obs.id], confiance=0.6, statut="SUPPORTED"))
        state.faits.append({"contenu": f"{len(obs.resultat.get('resultats', []))} sources web horodatées",
                            "source": "recherche_web", "verifie": False, "confiance": 0.6,
                            "preuves": [obs.id], "frais": "voir resultats"})

    elif obs.outil == "recherche_fichiers" and obs.succes:
        for res in obs.resultat.get("resultats", [])[:3]:
            state.ajouter_claim(Claim(id=state.prochain_id("C"),
                                      texte=f"mémoire documentaire : {res.get('nom', res.get('texte', ''))[:140]}",
                                      type="fait", source=f"file:{res.get('file_id')}", preuves=[obs.id],
                                      confiance=0.55, statut="SUPPORTED"))

    elif obs.outil == "llm_raisonnement":
        state.hypotheses.append({"contenu": (obs.resultat.get("texte") or "")[:1200],
                                 "source": "llm", "confiance": 0.3})


def raisonner_llm(state: AgentState, prompt_messages: list[dict[str, str]], phase: str = "raisonnement",
                  temperature: float = 0.5, max_tokens: int = 900) -> Observation:
    """Action « reason » : le LLM produit une PROPOSITION, jamais une autorité.

    v10.7 — diagnostic §3.1/§3.2 : température > 0 (0.5, léger : évite la
    platitude du greedy sans casser la cohérence) et budget généreux
    (max_tokens 900 ≥ 512) pour laisser des chaînes multi-étapes respirer.
    Le sous-agent juge reste à 0.1/520 (déterminisme de la critique)."""
    debut = __import__("time").time()
    obs = Observation(action=None, outil="llm_raisonnement", succes=False, id=f"L-{state.etape_courante:02d}")
    # v10.9.2 (P0) : PLUS AUCUNE chaîne technique (HTTP 502/429, corps du pont)
    # dans obs.erreurs — c'était le vecteur de fuite vers le raisonnement UI.
    # Les erreurs sont CODIFIÉES (codes stables du moteur), le détail brut
    # reste dans detail_interne (télémétrie serveur uniquement, N4).
    if not MOTEUR.disponible():
        obs.erreurs = ["MODELE_INDISPONIBLE"]
        obs.resultat = {"statut": "UNKNOWN", "texte": "",
                        "detail_interne": "circuit modèle ouvert ou pont injoignable"}
        state.erreurs.append({"type": "outil_indisponible", "outil": "llm"})
        return obs
    reponse = MOTEUR.complete(prompt_messages, temperature=temperature, max_tokens=max_tokens,
                              model_id=getattr(state, "model_id", None))
    if not reponse or "erreur" in reponse:
        code = str((reponse or {}).get("code") or "INCONNU")
        obs.erreurs = ["MODELE_INDISPONIBLE"]
        obs.resultat = {"statut": "UNKNOWN", "texte": "",
                        "detail_interne": f"code moteur : {code}"}
        return obs
    # v10.9.4 (HUD) : le modèle choisi a échoué, le pont a servi la cascade →
    # drapeau NEUTRE porté par le state (l'UI lèvera un toast discret ; aucun
    # nom de provider ni d'erreur HTTP ne traverse, N4 inchangé).
    if (reponse or {}).get("repli"):
        state.mode_repli = True
    obs.succes = True
    obs.resultat = {"statut": "HYPOTHESIS", "texte": reponse.get("texte", ""),
                    "note": "proposition LLM — soumise à vérification"}
    obs.duree_ms = reponse.get("duree_ms", int((__import__("time").time() - debut) * 1000))
    state.consommer(phase, max(50, len(reponse.get("texte", "")) // 3))
    return obs
