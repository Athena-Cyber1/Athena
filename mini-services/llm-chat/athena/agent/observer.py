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

    elif obs.succes and (obs.outil == "mcp_appel"
                         or (obs.outil.startswith("mcp_") and obs.outil != "mcp_inventaire")):
        # v20261005 (MCP) — résultat de serveur externe branché : le serveur
        # EST l'autorité de son propre état (« constaté côté serveur »), le
        # claim porte la provenance complète. Sans cette branche, aucun claim
        # n'était créé : la synthèse n'avait rien à citer et retombait en hedge
        # « non vérifié » sur un résultat pourtant SUPPORTED avec preuve.
        r = obs.resultat or {}
        if r.get("statut") in ("SUPPORTED", "VERIFIED"):
            cible = f"{r.get('serveur', '?')}.{r.get('outil', obs.outil)}"
            contenu = str(r.get("resultat", ""))[:400]
            preuve = str(r.get("preuve") or f"MCP · {cible}")
            claim = state.ajouter_claim(Claim(
                id=state.prochain_id("C"),
                texte=f"constaté côté serveur ({cible}) : {contenu}",
                type="fait", source=f"mcp:{cible}", preuves=[obs.id],
                confiance=0.7, statut="SUPPORTED"))
            state.faits.append({"contenu": f"{cible} → {contenu}", "source": f"mcp:{cible}",
                                "verifie": False, "confiance": 0.7,
                                "preuves": [obs.id], "preuve": preuve})
            if contenu and len(contenu) <= 220:
                state.reponse_courte = contenu
        elif r.get("statut") == "ERREUR":
            state.ajouter_claim(Claim(
                id=state.prochain_id("C"),
                texte=f"erreur serveur MCP ({r.get('serveur', '?')}.{r.get('outil', '?')}) : "
                      f"{str(r.get('raison', ''))[:300]}",
                type="fait", source="mcp_erreur", preuves=[obs.id],
                confiance=0.2, statut="UNKNOWN"))

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
                  temperature: float | None = None, max_tokens: int = 4096) -> Observation:
    """Action « reason » : le LLM produit une PROPOSITION, jamais une autorité.

    v10.7 — diagnostic §3.1/§3.2 : température > 0 (0.5, léger : évite la
    platitude du greedy sans casser la cohérence).
    P0 (audit « modèles fainéants », 2026-10-05) :
    - max_tokens 900 → 4096 : la mesure montrait fin=length en plein milieu
      de code (réponse amputée = « modèle paresseux qui s'arrête ») ;
    - UNE prolongation bornée si fin=length reste « length » (même modèle
      continue) ;
    - effort du HUD (state.effort) transmis à chaque appel (reasoning_effort).
    Le sous-agent juge reste à 0.1/520 (déterminisme de la critique).
    v1.2 (anti-bâclage, item 12) : temperature explicite > préférence UI
    (state.temperature, 0..2 validée) > défaut 0.5. Le motif de fin et la
    voie réelle (provider/model du pont) sont versés dans le state (item 9)."""
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
    temp = temperature if temperature is not None else (
        state.temperature if state.temperature is not None else 0.5)
    effort = getattr(state, "effort", None)
    reponse = MOTEUR.complete(prompt_messages, temperature=temp,
                              max_tokens=max_tokens,
                              model_id=getattr(state, "model_id", None),
                              effort=effort)
    if not reponse or "erreur" in reponse:
        code = str((reponse or {}).get("code") or "INCONNU")
        obs.erreurs = ["MODELE_INDISPONIBLE"]
        obs.resultat = {"statut": "UNKNOWN", "texte": "",
                        "detail_interne": f"code moteur : {code}"}
        return obs
    # P0 (audit fainéant) : fin=length → UNE prolongation bornée. Le MÊME
    # modèle (model_id identique) continue le texte ; la consigne interdit de
    # répéter/reformuler. Si la suite échoue ou est vide, le premier jeton est
    # conservé tel quel (jamais de pire que l'ancien comportement).
    if reponse.get("fin") == "length" and (reponse.get("texte") or "").strip():
        suite = MOTEUR.complete(
            prompt_messages + [
                {"role": "assistant", "content": reponse.get("texte", "")},
                {"role": "user",
                 "content": "Continue exactement à la fin de ce texte, sans le répéter, "
                            "sans le résumer, sans reformuler ce qui est déjà écrit."},
            ],
            temperature=temp, max_tokens=max_tokens,
            model_id=getattr(state, "model_id", None), effort=effort)
        if suite and "erreur" not in suite and (suite.get("texte") or "").strip():
            concat = (reponse.get("texte") or "") + suite.get("texte", "")
            duree_totale = (reponse.get("duree_ms") or 0) + (suite.get("duree_ms") or 0)
            reponse = dict(suite)
            reponse["texte"] = concat
            reponse["duree_ms"] = duree_totale
    # v1.2 (anti-bâclage, items 9/10) : voie réelle + motif de fin dans le
    # state — le final portera `tronquee`, `provider`, `model`.
    if isinstance(reponse.get("fin"), str):
        state.derniere_fin = reponse["fin"]
    if isinstance(reponse.get("provider"), str):
        state.dernier_provider = reponse["provider"]
    if isinstance(reponse.get("model"), str):
        state.dernier_modele = reponse["model"]
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
