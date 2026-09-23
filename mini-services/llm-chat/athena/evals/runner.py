"""Runner d'évaluation — suite de régression continue (spécification point 21).

Nouvelle modification → tout rejouer → régression ? NON → accepter, OUI → refuser.
Mode « sec » par défaut : déterministe pur, sans LLM (rapide, reproductible).
Enregistre chaque échec dans le corpus d'erreurs (erreur → cause → régression → verrouillage).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

from ..agent.agent import run_agent
from ..memory import store as memoire

DOSSIER_DATASETS = Path(__file__).resolve().parent / "datasets"


def _charger(nom: str = "core.json") -> list[dict[str, Any]]:
    with open(DOSSIER_DATASETS / nom, encoding="utf-8") as f:
        data = json.load(f)
    return data["tests"]


def _extraire_core(reponse: str) -> str:
    """Récupère la partie factuelle (nombre/mot-clé) de la réponse."""
    import re
    blocs = re.findall(r"```\n?(.*?)```", reponse, re.DOTALL)
    if blocs:
        return blocs[0].strip()
    gras = re.findall(r"\*\*(.+?)\*\*", reponse)
    if gras:
        return gras[0].strip()
    return reponse.strip()


def valider(test: dict[str, Any], reponse: str) -> tuple[bool, str]:
    v = test["validator"]
    attendu = str(test.get("attendu", ""))
    core = _extraire_core(reponse)
    rl = reponse.lower()

    if v == "exact":
        return core.strip() == attendu, f"attendu exact {attendu!r}, obtenu {core.strip()!r}"
    if v == "math":
        import re
        nums = re.findall(r"-?\d+(?:[.,]\d+)?", core)
        nums = [n.replace(",", ".") for n in nums]
        return (attendu in nums or attendu.replace(",", ".") in nums,
                f"attendu {attendu}, nombres trouvés {nums[:5]}")
    if v == "contient":
        ok = attendu.lower() in rl
        return ok, f"attendu « {attendu} » dans la réponse"
    if v == "grammaire_correcte":
        ok = ("correcte" in rl and ("oui" in rl or "bien" in rl)) and "incorrecte" not in rl
        return ok, "la réponse doit affirmer que la phrase est CORRECTE"
    if v == "grammaire_incorrecte":
        ok = ("incorrecte" in rl or "fausse" in rl or "non," in rl)
        return ok, "la réponse doit affirmer que la phrase est INCORRECTE"
    if v == "incertitude":
        # v10.9.2 : l'INTENTION du validator est « refus honnête explicite » —
        # depuis v10.9.1 les pools de voix réalisent le refus en plusieurs
        # formulations (politique_ferme/doux/sobre…). La liste reconnaît donc
        # toutes les formulations de refus explicite (jamais une invention).
        honnete = (
            "pas déterminer" in rl or "pas avec certitude" in rl
            or "je ne peux pas" in rl or "ne peux pas déterminer" in rl
            or "c'est non" in rl or "ma réponse est non" in rl
            or "non, et voici la raison" in rl
            or "je ne peux donc pas" in rl
            or "je reste donc dans le cadre" in rl
            or "je ne dois pas" in rl or "ne doit pas inventer" in rl
        )
        return honnete, "la réponse doit être un refus honnête explicite"

    return False, f"validator inconnu : {v}"


def lancer(nom_dataset: str = "core.json", mode: str = "sec", verbose: bool = True) -> dict[str, Any]:
    tests = _charger(nom_dataset)
    resultats: list[dict[str, Any]] = []
    par_categorie: dict[str, dict[str, int]] = {}

    for t in tests:
        debut = time.time()
        try:
            r = run_agent(t["q"], mode=mode, max_etapes=10)
            reponse = r["reponse"]
            statut = r["statut"]
            type_tache = r["type_tache"]
        except Exception as e:
            # v10.6 (F16) : « ? » n'est pas un label — un vrai type honnête.
            reponse, statut, type_tache = f"CRASH: {type(e).__name__}: {e}", "ERREUR_RUNNER", "inconnue"
        duree = int((time.time() - debut) * 1000)
        ok, message = valider(t, reponse)

        interdits = t.get("interdits", [])
        violation = [i for i in interdits if i.lower() in reponse.lower()]
        if violation:
            ok = False
            message += f" — INTERDITS présents : {violation}"

        cat = t["categorie"]
        stats = par_categorie.setdefault(cat, {"total": 0, "passes": 0})
        stats["total"] += 1
        stats["passes"] += int(ok)
        resultats.append({"id": t["id"], "categorie": cat, "ok": ok, "message": message,
                          "statut": statut, "type": type_tache, "duree_ms": duree,
                          "extrait": reponse[:160].replace("\n", " ")})
        if not ok:
            memoire.memoriser_erreur(t["q"], reponse[:500], t.get("attendu", ""), "eval_regression",
                                     corrige=False, source="eval", tache=type_tache)

    total = sum(s["total"] for s in par_categorie.values())
    passes = sum(s["passes"] for s in par_categorie.values())
    # v10.7 — boucle erreur → cause → régression → VERROUILLAGE : les
    # questions du corpus d'erreurs qui PASSENT désormais sont marquées
    # corrige=1 (aucune destruction : la ligne reste, elle est juste soldée).
    questions_ok = [t["q"] for t, res in zip(tests, resultats) if res["ok"]]
    corrigees = memoire.marquer_erreurs_corrigees(questions_ok)
    # les 5 tests utilisateur (U*) sont bloquants
    bloquants = [r for r in resultats if r["id"].startswith("U") and not r["ok"]]
    retour = {
        "dataset": nom_dataset, "mode": mode,
        "total": total, "passes": passes, "taux": round(100 * passes / max(total, 1), 1),
        "erreurs_corrigees": corrigees,
        "par_categorie": {k: {"taux": round(100 * v["passes"] / v["total"], 1), **v}
                          for k, v in par_categorie.items()},
        "bloquants": bloquants,
        "succes_global": len(bloquants) == 0 and passes == total,
        "resultats": resultats,
        "ts": time.time(),
    }
    if verbose:
        _afficher(retour)
    return retour


def _afficher(r: dict[str, Any]) -> None:
    ligne = "─" * 62
    print(f"\nATHÉNA — suite de régression ({r['dataset']}, mode {r['mode']})")
    print(ligne)
    for res in r["resultats"]:
        marque = "✅" if res["ok"] else "❌"
        print(f"{marque} {res['id']:3} [{res['categorie']:13}] {res['duree_ms']:5} ms  {res['message'][:60]}")
        if not res["ok"]:
            print(f"     ↳ extrait : {res['extrait'][:100]}")
    print(ligne)
    for cat, s in r["par_categorie"].items():
        print(f"   {cat:15} {s['taux']:5} %  ({s['passes']}/{s['total']})")
    print(ligne)
    print(f"   GLOBAL : {r['taux']} %  ({r['passes']}/{r['total']}) — bloquants U* : {len(r['bloquants'])}")
    print(f"   VERDICT : {'ACCEPTÉ ✅' if r['succes_global'] else 'RÉGRESSION — CHANGEMENT REFUSÉ ❌'}")


if __name__ == "__main__":
    mode = "sec"
    if len(sys.argv) > 1 and sys.argv[1] == "--full":
        mode = "auto"
    r = lancer(mode=mode)
    sys.exit(0 if r["succes_global"] else 1)
