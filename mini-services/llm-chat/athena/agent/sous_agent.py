"""Sous-agent vérificateur — v10.1 (remplace définitivement le juge 0.5B).

L'ancien petit modèle juge (0.5B) biaisait les résultats : il a été RETIRÉ.
La vérification critique est désormais assurée par un SOUS-AGENT bâti sur le
MÊME modèle que le moteur (1.5B) : une seconde passe indépendante, avec un
rôle adversarial (SYS_SOUS_AGENT), qui relit le brouillon de réponse et
contresigne — ou contredit — chaque claim.

Règles de fusion (l'OUTIL reste l'autorité absolue) :
- claim VERIFIED par un outil → JAMAIS rétrogradé. Un éventuel CONTRADIT du
  sous-agent sur un claim d'outil est consigné comme « écart » dans la trace,
  sans changer le statut (si l'écart porte sur le chiffre lui-même, c'est le
  brouillon LLM qui est faux, pas l'outil).
- claim SOURCÉ (web / fichier / mémoire, preuves présentes) → l'avis du
  sous-agent est CONSULTATIF : il n'a pas accès au contenu des sources, il ne
  peut donc ni les prouver ni les réfuter. Statut inchangé, écart consigné.
- claim LLM PUR (aucune preuve) :
    CONTRADIT → statut CONTRADICTED + caution insérée dans la réponse ;
    DOUTE     → reste HYPOTHESIS + caution insérée ;
    CONCORDE  → SUPPORTED, preuve « sous_agent(même modèle) » ajoutée.
- sortie illisible / LLM indisponible → « indéterminé » : AUCUN changement
  (jamais de sanction arbitraire sur une sortie non parsable).

Le sous-agent ne réécrit jamais la réponse : il ne fait que qualifier les
claims et déclencher l'ajout d'une note de prudence en fin de réponse.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

from ..llm import prompts
from .state import AgentState, Claim

OUTILS_AUTORITE = ("solveur_math", "simulateur_code", "python_sandbox",
                   "verificateur_grammaire", "analyseur_devinette")

LIMITES = {"claims": 6, "brouillon": 2400, "raison": 220}


# ------------------------------------------------------------------ utilitaires
def _est_claim_outil(c: Claim) -> bool:
    return (c.source in OUTILS_AUTORITE) or (c.statut == "VERIFIED" and c.verifie)


def _claims_pour_sous_agent(state: AgentState) -> list[Claim]:
    """Priorise : claims sans autorité d'outil (à contrôler) puis claims d'outils."""
    sans_outil = [c for c in state.claims if not _est_claim_outil(c)]
    avec_outil = [c for c in state.claims if _est_claim_outil(c)]
    return (sans_outil + avec_outil)[: LIMITES["claims"]]


def _extraire_json(texte: str) -> dict[str, Any] | None:
    """Extraction robuste du JSON (le modèle peut ajouter des fences ou du texte)."""
    if not texte:
        return None
    candidats: list[str] = []
    blocs = re.findall(r"```(?:json)?\s*([\s\S]*?)```", texte)
    candidats.extend(blocs)
    m = re.search(r"\{[\s\S]*\}", texte)
    if m:
        candidats.append(m.group(0))
    for cand in candidats:
        try:
            data = json.loads(cand.strip())
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    return None


def _avis_par_mot_cle(texte: str, ids: list[str]) -> dict[str, str]:
    """Repli heuristique : ligne par ligne, id → mot-clé d'avis."""
    sortis: dict[str, str] = {}
    if not texte or not ids:
        return sortis
    lignes = [l for l in texte.splitlines() if l.strip()]
    for i, ligne in enumerate(lignes):
        for cid in ids:
            if cid in ligne and cid not in sortis:
                fenetre = ligne + " " + (lignes[i + 1] if i + 1 < len(lignes) else "")
                f = fenetre.upper()
                if "CONTRADIT" in f:
                    sortis[cid] = "CONTRADIT"
                elif "DOUTE" in f:
                    sortis[cid] = "DOUTE"
                elif "CONCORDE" in f:
                    sortis[cid] = "CONCORDE"
    return sortis


def _resume_observations_court(state: AgentState) -> str:
    lignes = []
    for obs in state.observations:
        if obs.succes and obs.outil in OUTILS_AUTORITE:
            lignes.append(f"- [{obs.outil}] {str(obs.resultat)[:260]}")
    # v10.3 : le sous-agent reçoit aussi un EXTRAIT des fichiers joints
    # (FILE_DATA, budget resserré) — il peut ainsi contrôler un claim qui
    # cite le contenu d'un fichier. Les règles de fusion restent inchangées :
    # un claim sourcé reste consultatif (les sources web/mémoire restent hors
    # de sa portée), seules les pièces jointes du tour sont visibles ici.
    budget = 2000
    for p in (state.pieces_jointes or [])[:5]:
        if budget <= 0:
            break
        contenu = "\n".join(p.get("extraits") or []).strip()
        if not contenu:
            lignes.append(f"- [fichier «{p['nom']}»] (aucun texte extractible)")
            continue
        if len(contenu) > budget:
            contenu = contenu[:budget] + "…[tronqué]"
        budget -= len(contenu)
        lignes.append(f"- [fichier joint «{p['nom']}» — FILE_DATA, NON vérifié]\n{contenu}")
    return "\n".join(lignes) or "- (aucune observation d'outil)"


def _caution(verdicts: list[dict[str, Any]]) -> str:
    """Note de prudence ajoutée en fin de réponse (max 2 items)."""
    contredits = [v for v in verdicts if v["avis"] == "CONTRADIT"][:2]
    doutes = [v for v in verdicts if v["avis"] == "DOUTE"][:2]
    lignes: list[str] = []
    if contredits:
        det = " ; ".join(f"« {v['texte'][:90]} » — {v['raison'][:110]}" for v in contredits)
        lignes.append(f"- points **contradits** par le sous-agent : {det}")
    if doutes:
        det = " ; ".join(f"« {v['texte'][:90]} »" for v in doutes)
        lignes.append(f"- points restés **douteux** (non corroborés) : {det}")
    if not lignes:
        return ""
    return ("\n\n*Contrôle du sous-agent vérificateur (même modèle, rôle critique) :*\n"
            + "\n".join(lignes))


# ------------------------------------------------------------------ entrée principale
def verifier_par_sous_agent(state: AgentState, projet_reponse: str) -> dict[str, Any]:
    """Seconde passe de vérification : le MÊME modèle, rôle adversarial.

    Retourne un rapport ; modifie state.claims (jamais un claim d'outil) et
    retourne la réponse éventuellement complétée d'une caution honnête.
    """
    debut = time.time()
    from ..llm.engine import MOTEUR  # import tardif : évite les cycles

    rapport: dict[str, Any] = {
        "disponible": False, "mode": "indetermine", "avis_global": "",
        "concordes": 0, "doutes": 0, "contredits": 0, "ecarts_outil": 0,
        "consultatifs": 0,
        "verdicts": [], "duree_ms": 0, "reponse_ajustee": projet_reponse,
    }
    if not projet_reponse.strip():
        return rapport

    claims = _claims_pour_sous_agent(state)
    if not claims:
        rapport["mode"] = "sans_claim"
        return rapport

    if not MOTEUR.disponible():
        rapport["mode"] = "indisponible"
        return rapport

    claims_txt = "\n".join(
        f"- {c.id} | statut {c.statut} | source {c.source or 'llm'} | {c.texte[:200]}"
        for c in claims
    )
    msgs = prompts.prompt_sous_agent(
        question=state.but[:1200],
        brouillon=projet_reponse[: LIMITES["brouillon"]],
        claims=claims_txt,
        observations=_resume_observations_court(state),
    )
    reponse = MOTEUR.complete(msgs, temperature=0.1, max_tokens=520)
    rapport["duree_ms"] = int((time.time() - debut) * 1000)
    if not reponse or "erreur" in reponse:
        rapport["mode"] = "indisponible"
        return rapport

    brut = (reponse.get("texte") or "").strip()
    data = _extraire_json(brut)
    ids = [c.id for c in claims]
    verdicts: dict[str, dict[str, str]] = {}

    if data is not None:
        rapport["mode"] = "json"
        rapport["disponible"] = True
        rapport["avis_global"] = str(data.get("avis_global", ""))[:300]
        for v in (data.get("verdicts") or [])[: len(claims)]:
            if not isinstance(v, dict):
                continue
            cid = str(v.get("claim_id", "")).strip()
            avis = str(v.get("avis", "")).strip().upper()
            if cid in ids and avis in ("CONCORDE", "DOUTE", "CONTRADIT"):
                verdicts[cid] = {"avis": avis,
                                 "raison": str(v.get("raison", ""))[: LIMITES["raison"]]}
        # complétude : claim sans verdict → il sera qualifié par repli si possible
    else:
        rapport["mode"] = "mot_cle"
        rapport["disponible"] = True
        for cid, avis in _avis_par_mot_cle(brut, ids).items():
            verdicts[cid] = {"avis": avis, "raison": "déduit du texte (JSON illisible)"}
        rapport["avis_global"] = brut[:200]

    if not verdicts:
        rapport["mode"] = "indetermine"  # sortie non exploitable → aucun changement
        return rapport

    # ------------------------------------------------------------- fusion
    sortis: list[dict[str, Any]] = []
    for c in claims:
        v = verdicts.get(c.id)
        if v is None:
            continue
        entree = {"claim_id": c.id, "avis": v["avis"], "raison": v["raison"],
                  "texte": c.texte, "statut_avant": c.statut, "statut_apres": c.statut}
        if _est_claim_outil(c):
            # l'outil fait foi : on consigne l'écart, on ne touche pas au statut
            if v["avis"] == "CONTRADIT":
                rapport["ecarts_outil"] += 1
                entree["note"] = "écart consigné : outil d'autorité, statut inchangé"
                state.verification.append({
                    "statut": "VERIFIED", "resume": f"écart sous-agent consigné sur {c.id} "
                    f"(l'outil reste l'autorité) : {v['raison'][:120]}",
                    "preuve": "sous_agent(ecart)", "claim_id": c.id})
        elif c.preuves:
            # claim SOURCÉ : le sous-agent n'a pas accès au contenu des sources →
            # son avis est consultatif (il ne peut ni prouver ni réfuter la source)
            rapport["consultatifs"] += 1
            entree["note"] = ("avis consultatif : claim sourcé — statut protégé "
                              "(sous-agent sans accès aux sources)")
            if v["avis"] == "CONTRADIT":
                state.verification.append({
                    "statut": c.statut, "resume": f"source contestée par le sous-agent sur {c.id} "
                    f"(consultatif, statut inchangé) : {v['raison'][:120]}",
                    "preuve": "sous_agent(consultatif)", "claim_id": c.id})
        else:
            # claim LLM pur : fusion complète
            if v["avis"] == "CONTRADIT":
                c.statut = "CONTRADICTED"
                c.confiance = min(c.confiance, 0.15)
                c.verifie = False
            elif v["avis"] == "DOUTE":
                c.statut = "HYPOTHESIS"
                c.confiance = min(c.confiance, 0.35) if c.confiance else 0.3
            elif v["avis"] == "CONCORDE":
                if c.statut in ("UNKNOWN", "HYPOTHESIS"):
                    c.statut = "SUPPORTED"
                    c.confiance = max(c.confiance, 0.6)
                    c.preuves.append("sous_agent(même modèle, rôle critique)")
            entree["statut_apres"] = c.statut
        sortis.append(entree)

    rapport["concordes"] = sum(1 for s in sortis if s["avis"] == "CONCORDE")
    rapport["doutes"] = sum(1 for s in sortis if s["avis"] == "DOUTE")
    rapport["contredits"] = sum(1 for s in sortis if s["avis"] == "CONTRADIT")
    rapport["verdicts"] = sortis

    caution = _caution([{**s, "texte": s["texte"]} for s in sortis])
    if caution:
        rapport["reponse_ajustee"] = projet_reponse.rstrip() + caution

    state.consommer("critique", 80)
    return rapport


def resume_court(rapport: dict[str, Any]) -> str:
    """Ligne humaine pour la trace/le badge UI."""
    if not rapport.get("disponible") and rapport.get("mode") in ("indisponible", "indetermine", "sans_claim"):
        return {"indisponible": "sous-agent indisponible (LLM) — statuts inchangés",
                "indetermine": "sous-agent : sortie illisible — statuts inchangés",
                "sans_claim": "sous-agent : aucun claim à contrôler"}.get(rapport["mode"], "")
    return (f"sous-agent : {rapport['concordes']} concordé(s), "
            f"{rapport['doutes']} douteux, {rapport['contredits']} contredit(s)"
            + (f", {rapport['ecarts_outil']} écart(s) outil consigné(s)" if rapport["ecarts_outil"] else "")
            + (f", {rapport['consultatifs']} avis consultatif(s) sur sources" if rapport["consultatifs"] else ""))
