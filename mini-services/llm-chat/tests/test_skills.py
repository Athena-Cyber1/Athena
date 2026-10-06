"""Tests du registre de skills (v10.10).

Vérifie : enregistrement des skills intégrés, sélection par type/motifs/force,
construction de plans, et que creer_plan branche bien le skill sur le state.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from athena.agent import planner, skills  # noqa: E402
from athena.agent.state import Action, AgentState  # noqa: E402


def test_registre_complet():
    noms = {s["nom"] for s in skills.lister()}
    attendus = {
        "math-exact", "code-simule", "grammaire-accord", "devinette-honnete",
        "factuel-sourcé", "logique-premisses", "conversationnelle",
        # v10.11 — tâches longues
        "goal-longue-tache", "superpower", "repair-code", "browser-rendu",
        # MCP — routage par motifs de serveur
        "mcp-appel",
    }
    assert attendus.issubset(noms), f"manquants : {attendus - noms}"
    for s in skills.lister():
        assert s["nom"] and s["description"]
        # types peut être VIDE : les skills de tâche longue (v10.11) et
        # mcp-appel se routent par MOTIFS uniquement, pour ne pas capturer
        # tout CODE / toute question.
        assert isinstance(s["types"], list)
        assert isinstance(s["outils"], list)
        assert isinstance(s["autorite"], bool)
        if not s["types"]:
            # un skill sans type doit donc avoir des motifs, sinon il est
            # inatteignable
            assert skills.SKILLS[s["nom"]].motifs, s["nom"]


def test_selection_par_type():
    s = skills.selectionner("MATH", "combien fait 2+2 ?")
    assert s is not None and s.nom == "math-exact"
    s = skills.selectionner("CODE", "que va afficher ce code ?")
    assert s is not None and s.nom == "code-simule"
    s = skills.selectionner("CONVERSATIONNEL", "bonjour")
    assert s is not None and s.nom == "conversationnelle"


def test_selection_force():
    s = skills.selectionner("MATH", "x", skill_force="code-simule")
    assert s is not None and s.nom == "code-simule"
    # skill inconnu → repli sur la sélection automatique
    s = skills.selectionner("MATH", "x", skill_force="inexistant")
    assert s is not None and s.nom == "math-exact"


def test_plan_math_autorite():
    s = skills.obtenir("math-exact")
    assert s is not None
    plan = skills.plan_de(s, "2+2", "simple")
    assert plan and isinstance(plan[0], Action)
    assert plan[0].type == "outil" and plan[0].outil == "solveur_math"
    assert plan[0].critique is True
    assert plan[-1].type == "final"


def test_plan_factuel_multi_outils():
    s = skills.obtenir("factuel-sourcé")
    assert s is not None
    plan = skills.plan_de(s, "capital de la France", "simple")
    outils = [a.outil for a in plan if a.type == "outil"]
    assert "recherche_fichiers" in outils and "recherche_web" in outils


def test_creer_plan_branche_state():
    state = AgentState(but="combien font 15*3 ?")
    state.type_tache = planner.classifier(state.but)
    state.complexite = "simple"
    plan = planner.creer_plan(state)
    assert state.skill == "math-exact"
    assert plan is state.plan
    assert any(a.outil == "solveur_math" for a in plan if a.type == "outil")


def test_creer_plan_force():
    state = AgentState(but="bonjour")
    state.type_tache = "CONVERSATIONNEL"
    state.complexite = "simple"
    planner.creer_plan(state, skill_force="logique-premisses")
    assert state.skill == "logique-premisses"
    assert all(a.type != "outil" or not a.outil for a in state.plan
               if a.type == "outil") or state.plan


def test_types_cohérents_avec_classifier():
    # Chaque skill non conversationnel doit matcher un type que le classifier produit
    types_connus = {"MATH", "CODE", "LINGUISTIQUE", "DEVINETTE",
                    "FACTUEL", "LOGIQUE", "CONVERSATIONNEL"}
    for s in skills.lister():
        for t in s["types"]:
            assert t in types_connus, f"{s['nom']} → type inconnu {t}"

# ---------------------------------------------------------------------------
# v10.11 — skills de tâche longue
# ---------------------------------------------------------------------------

def test_routing_motifs_taches_longues():
    """Les skills de repair/tâche longue se déclenchent sur des questions
    réelles, pas seulement sur un mot-clé exact."""
    cas = [
        ("cherche des bugs dans donjon-threejs.html", "repair-code"),
        ("le jeu plante quand je tire", "repair-code"),
        ("le bot ne se déplace plus", "repair-code"),
        ("teste le jeu donjon-threejs.html", "browser-rendu"),
        ("fais une capture de la page", "browser-rendu"),
        ("nettoie tout le projet", "goal-longue-tache"),
        ("active le mode superpower", "superpower"),
    ]
    for question, attendu in cas:
        s = skills.selectionner("CODE", question)
        assert s is not None, f"aucun skill pour : {question}"
        assert s.nom == attendu, f"{question!r} -> {s.nom}, attendu {attendu}"


def test_selection_force_superpower():
    s = skills.selectionner("CODE", "x", skill_force="superpower")
    assert s is not None and s.nom == "superpower"


def test_plans_longue_tache_exigent_livraison():
    """Un plan de tâche longue doit finir par une vérification ET un verdict
    terminal — jamais par une réponse d'intention."""
    for nom in ("goal-longue-tache", "superpower", "repair-code", "browser-rendu"):
        s = skills.obtenir(nom)
        plan = skills.plan_de(s, "corrige le jeu", "complexe")
        assert plan, f"{nom} : plan vide"
        assert plan[-1].type == "final", f"{nom} : ne finit pas par 'final'"
        assert any(a.type == "verifier" for a in plan), f"{nom} : aucune vérification"
        for a in plan:
            assert a.objectif and a.objectif.strip(), f"{nom} : action sans objectif"


def test_repair_mentionne_sauvegarde_et_preuve():
    s = skills.obtenir("repair-code")
    plan = skills.plan_de(s, "corrige les bugs", "complexe")
    texte = " ".join(a.objectif for a in plan).lower()
    assert "bak" in texte, "pas de sauvegarde avant modification"
    assert "test" in texte or "preuve" in texte, "pas d'exigence de preuve"


def test_browser_rendu_distingue_niveaux_de_preuve():
    s = skills.obtenir("browser-rendu")
    texte = " ".join(a.objectif for a in skills.plan_de(s, "teste le jeu", "complexe")).lower()
    assert "headless" in texte or "navigateur" in texte
    assert "jamais" in texte, "l'interdiction de présenter la syntaxe comme un test doit rester"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"OK   {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"ERR  {fn.__name__}: {type(e).__name__}: {e}")
    print(f"{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
