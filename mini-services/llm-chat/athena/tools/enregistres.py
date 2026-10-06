"""Outils déterministes enregistrés : solveur math, simulateur code, grammaire,
devinettes, python sandboxé, web, mémoire fichiers (spécification points 5/8/14/15/16).
"""
from __future__ import annotations

from typing import Any

from ..verification import code as vcode
from ..verification import grammar as vgram
from ..verification import math as vmath
from ..verification import riddle as vriddle
from ..memory import store as memoire
from ..llm.engine import MOTEUR
from .registry import outil

# ------------------------------------------------------------------ solveur math
@outil("solveur_math", "Résolution arithmétique exacte (pourcentages, expressions, problèmes types)",
       {"question": "str"}, risque="faible", autorite=True)
def solveur_math(question: str) -> dict[str, Any]:
    return vmath.resoudre(question)


# --------------------------------------------------------------- simulateur code
@outil("simulateur_code", "« Que va afficher ce code ? » → simulation AST + croisement sandbox",
       {"question": "str"}, risque="moyen", autorite=True)
def simulateur_code(question: str) -> dict[str, Any]:
    return vcode.resoudre_code(question)


# ----------------------------------------------------------- python sandbox brut
@outil("python_sandbox", "Exécute un petit script Python isolé (timeout 5 s) et retourne la sortie réelle",
       {"code": "str"}, risque="moyen", autorite=True)
def python_sandbox(code: str) -> dict[str, Any]:
    return vcode.sandbox(code)


# --------------------------------------------------------------------- grammaire
@outil("verificateur_grammaire", "Accord du participe passé (COD postposé/antéposé) — règles structurées",
       {"question": "str"}, risque="faible", autorite=True)
def verificateur_grammaire(question: str) -> dict[str, Any]:
    return vgram.resoudre_grammaire(question)


# --------------------------------------------------------------------- devinettes
@outil("analyseur_devinette", "Devinettes : lexique canonique ou refus honnête (jamais d'invention)",
       {"question": "str"}, risque="faible", autorite=True)
def analyseur_devinette(question: str) -> dict[str, Any]:
    return vriddle.resoudre(question)


# -------------------------------------------------------------------------- web
@outil("recherche_web", "Recherche web via bridge (résultats horodatés, fraîcheur annotée)",
       {"query": "str", "num": "int?"}, risque="moyen", autorite=False)
def recherche_web(query: str, num: int = 6) -> dict[str, Any]:
    from ..verification import facts as vfacts
    # v10.9.2 (P0) : raisons CODIFIÉES — plus jamais la chaîne d'erreur du pont
    # (elle était rendue dans la trace « observation » visible de l'UI).
    if not MOTEUR.disponible():
        return {"statut": "ERREUR", "raison": "recherche web momentanément indisponible"}
    r = MOTEUR.search(query, num=num)
    if not r or "erreur" in r:
        return {"statut": "ERREUR", "raison": "recherche web momentanément indisponible"}
    resultats = vfacts.horodater_web(r.get("resultats", []))
    return {"statut": "SUPPORTED", "resultats": resultats, "preuve": f"{len(resultats)} sources web horodatées"}


# ------------------------------------------------------------------- mémoire RAG
@outil("recherche_fichiers", "RAG symbole > fichier > lexical (BM25-lite) sur les fichiers ingérés",
       {"requete": "str"}, risque="faible", autorite=False)
def recherche_fichiers(requete: str) -> dict[str, Any]:
    resultats = memoire.chercher_fichiers(requete)
    if not resultats:
        return {"statut": "UNKNOWN", "raison": "aucun fichier ingéré ne correspond"}
    return {"statut": "SUPPORTED", "resultats": resultats, "preuve": "index fichiers (mémoire ≠ vérité)"}


# ------------------------------------------------------------------------ MCP
@outil("mcp_appel", "Appel réel d'un outil d'un serveur MCP externe (blender, google drive…). "
       "Syntaxe mcp(serveur.outil) {json} ou demande libre traduite en appel.",
       {"requete": "str"}, risque="moyen", autorite=False)
def mcp_appel(requete: str) -> dict[str, Any]:
    from . import mcp
    return mcp.appeler_depuis_texte(requete)


@outil("mcp_inventaire", "État des serveurs MCP branchés (connectés, outils, cause d'échec)",
       {}, risque="faible", autorite=False)
def mcp_inventaire() -> dict[str, Any]:
    from . import mcp
    vue = mcp.connecter()
    serveurs = vue.get("serveurs", [])
    connects = [s for s in serveurs if s.get("etat") == "connecte"]
    if not serveurs:
        return {"statut": "UNKNOWN", "raison": "aucun serveur configuré (mcp.json vide)"}
    if not connects:
        return {"statut": "UNKNOWN", "raison": "serveurs configurés mais aucun connecté",
                "serveurs": serveurs}
    return {"statut": "SUPPORTED", "serveurs": serveurs,
            "preuve": f"{len(connects)}/{len(serveurs)} serveur(s) MCP connecté(s)"}


# ------------------------------------------------- agent local (:3020) + navigateur
# Les skills « longue tâche » (goal-longue-tache, superpower, repair-code,
# browser-rendu) déclarent agent_local / navigateur. Sans registration dans ce
# registre, executor.py marque « outil inconnu » → state.erreurs
# outil_indisponible → STOP HONNÊTE, et la réponse finale devient « le concours
# de l'outil X est momentanément indisponible » : l'historique de la
# conversation n'est même pas consulté (« le contexte est perdu »).
# On branche les DEUX sur le local-agent Node (127.0.0.1:3020) : appel réel,
# résultat réel, jamais de simulation narrative.

AGENT_LOCAL = "http://127.0.0.1:3020"


def _agent_post(chemin: str, corps: dict[str, Any], timeout: float = 40.0) -> tuple[int, dict[str, Any]]:
    import json as _json
    import urllib.error
    import urllib.request
    req = urllib.request.Request(
        AGENT_LOCAL + chemin, data=_json.dumps(corps).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as rep:
            brut = rep.read().decode("utf-8", "replace")
            return int(rep.status), (_json.loads(brut) if brut.strip() else {})
    except urllib.error.HTTPError as e:
        try:
            brut = e.read().decode("utf-8", "replace")
        except Exception:
            brut = ""
        try:
            return int(e.code), (_json.loads(brut) if brut.strip() else {})
        except Exception:
            return int(e.code), {"erreur": brut[:300] or f"HTTP {e.code}"}
    except Exception as e:
        return 0, {"erreur": f"{type(e).__name__}: {e}"}


@outil("agent_local", "Exécution RÉELLE sur le poste via l'agent local (127.0.0.1:3020, POST /exec) : "
       "une commande shell/PowerShell unique, sortie ou erreur renvoyée telle quelle. "
       "Une phrase en français n'est pas une commande : la raison du shell est rapportée, "
       "jamais simulée.",
       {"requete": "str"}, risque="moyen", autorite=False)
def agent_local(requete: str) -> dict[str, Any]:
    commande = (requete or "").strip()
    if not commande:
        return {"statut": "UNKNOWN", "raison": "aucune commande reçue"}
    if len(commande) > 8000:
        return {"statut": "ERREUR", "raison": "commande trop longue (8000 caractères max)"}
    # confirme:False — pas d'exécution automatique d'une commande non validée :
    # la confirmation utilisateur passe par le bloc athena-exec côté UI.
    st, corps = _agent_post("/exec", {"commande": commande, "confirme": False, "timeout_ms": 30000},
                            timeout=45.0)
    if st == 0:
        return {"statut": "ERREUR",
                "raison": "agent local injoignable (127.0.0.1:3020) — "
                          + str(corps.get("erreur"))[:200]}
    if st == 200:
        sortie = str(corps.get("sortie") or corps.get("stdout") or "")
        if not sortie.strip():
            sortie = str({k: v for k, v in corps.items() if k != "sortie"})[:3000]
        return {"statut": "SUPPORTED", "sortie": sortie[:4000],
                "preuve": "local-agent POST /exec (exécution réelle)"}
    if st == 428:
        return {"statut": "UNKNOWN",
                "raison": "confirmation requise : l'agent local n'exécute rien sans validation "
                          "utilisateur (confirme:true après approbation, via un bloc athena-exec)"}
    raison = str(corps.get("erreur") or corps.get("aide") or corps.get("motif") or "")
    return {"statut": "ERREUR", "raison": f"agent local {st} : {raison[:300]}"}


_NAV_MEMO: dict[str, Any] = {"requete": None, "resultat": None}


@outil("navigateur", "Pilotage du navigateur RÉEL via l'agent local (127.0.0.1:3020, POST /browser) : "
       "ouvrir <url>, capture, texte, html… — retour de Firefox, jamais une description d'action.",
       {"requete": "str"}, risque="moyen", autorite=False)
def navigateur(requete: str) -> dict[str, Any]:
    import re as _re
    txt = (requete or "").strip()
    if not txt:
        return {"statut": "UNKNOWN", "raison": "aucune action de navigateur reçue"}
    bas = txt.lower()
    m = _re.search(r"https?://[^\s\"'<>()]+", txt)
    deuxieme = _NAV_MEMO.get("requete") == txt
    if deuxieme:
        action, arg = "texte", ""          # 2e appel du plan : état réel de la page
    elif m:
        action, arg = "ouvrir", m.group(0)
    elif any(k in bas for k in ("capture", "screenshot", "aperçu", "apercu", "rendu")):
        action, arg = "capture", ""
    elif any(k in bas for k in ("html", "dom")):
        action, arg = "html", ""
    else:
        action, arg = "texte", ""
    st, corps = _agent_post("/browser", {"action": action, "arg": arg}, timeout=60.0)
    if st == 0:
        return {"statut": "ERREUR",
                "raison": "agent local injoignable (127.0.0.1:3020) — "
                          + str(corps.get("erreur"))[:200]}
    if st == 200:
        propre = {k: v for k, v in (corps or {}).items()
                  if k not in ("png", "image", "data", "screenshot")}
        _NAV_MEMO["requete"], _NAV_MEMO["resultat"] = txt, propre
        return {"statut": "SUPPORTED", "action": action, "retour": propre,
                "preuve": "local-agent POST /browser (Firefox réel)"}
    return {"statut": "ERREUR",
            "raison": f"agent local {st} : "
                      + str(corps.get("erreur") or corps.get("aide") or "")[:300]}
