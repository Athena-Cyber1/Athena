"""Canari de sortie — v10.9.1 (invariant « rendu_final, unique point de sortie »).

RÔLE (décision utilisateur) : le détecteur de non-réponse n'est PLUS le
mécanisme d'application — il est un CANARI :
  1. TÉLÉMÉTRIE : chaque réponse finale est classée dans une classe terminale
     (outillée / modèle / hedgée / inconnu honnête / politique) et enregistrée
     (memory.store.enregistrer_sortie) → distribution par domaine consultable
     via GET /telemetrie.
  2. TEST CI : les golden tests (tests/test_golden_v109.py) assert une tolérance
     ZÉRO aux motifs « reformulation sans contenu » et aux interdits de sortie.
  3. DÉFENSE EN PROFONDEUR : run_agent vérifie la réponse finale contre
     MOTIFS_INTERDITS ; une violation est loggée + annulée (le ladder de
     rendu_final est la seule mécanisme d'émission, le canari ne réécrit jamais).

Les DEUX templates de refus historiques sont traqués :
  - v10.7 : « Je n'ai pas de réponse utile à apporter. »
  - v10.8 : « Je n'ai pas pu construire une réponse complète … Reformulez ou
    précisez un aspect de la question … » (64 des 76 échecs du bench v10.8).
"""
from __future__ import annotations

import re
from typing import Any

# ------------------------------------------------------------- classes terminales
CLASSE_OUTILLEE = "outillee"            # (outil VERIFIED fait foi)
CLASSE_MODELE = "modele"                # (b) réponse du modèle non rejetée
CLASSE_HEGEE = "hegdee"                 # (c) hedge paramétrique, préfixe varié
CLASSE_INCONNU = "inconnu_honnete"      # (d) voisinage + manque — substantiel
CLASSE_POLITIQUE = "politique"          # (a) refus de politique SUBSTANTIEL
CLASSE_CONVERSATIONNELLE = "conversationnelle"  # micro-social (accueil/gratitude/congé)
CLASSES_TOUTES = (CLASSE_OUTILLEE, CLASSE_MODELE, CLASSE_HEGEE, CLASSE_INCONNU,
                  CLASSE_POLITIQUE, CLASSE_CONVERSATIONNELLE)

# --------------------------------------------------- détection de NON-RÉPONSE
# Un motif ici = le texte n'apporte AUCUN contenu à la question (refus sec,
# template de reformulation, réponse vide). Les refus SUBSTANTIELS (raisons +
# manque + alternative) ne matchent PAS : voir _MOTIFS_SUBSTANCE.
_MOTIFS_NON_REPONSE: list[tuple[str, re.Pattern[str]]] = [
    ("template_v10_8", re.compile(
        r"je n'ai pas pu construire une r[ée]ponse compl[eè]te", re.IGNORECASE)),
    ("template_v10_7", re.compile(
        r"je n'ai pas de r[ée]ponse utile", re.IGNORECASE)),
    ("reformulation_seche", re.compile(
        r"reformulez? ou (?:pr[ée]cisez?|d[ée]taillez?)", re.IGNORECASE)),
    ("refus_sec", re.compile(
        r"^\s*(?:je ne (?:peux|sais) pas|je n'ai (?:pas|aucune))\b[^.!?]*[.!?]?\s*$", re.IGNORECASE)),
]

# Marqueurs de SUBSTANCE : un texte qui en contient au moins UN n'est pas une
# non-réponse même s'il contient un motif de refus (ex. « … je ne trouve pas
# cette entité dans mes sources ; j'ai tenté une recherche web… »).
_MOTIFS_SUBSTANCE = re.compile(
    r"(?:d'apr[eè]s ce que je sais|ce que je sais|voisinage|ce qui manque|"
    r"alternative|je (?:peux|calcule|simule)\b|\n\s*[-*]\s|sources?\s*:|"
    r"faits?\s+stables|recherche(?:s)? (?:web )?(?:tent[ée]e|effectu[ée]e)|"
    r"\(\s*[àa]\s+v[ée]rifier\s*\))", re.IGNORECASE)

_LONGUEUR_SEC = 260  # au-delà, un texte avec marqueurs détaillés n'est plus « sec »


def detecter_non_reponse(texte: str) -> str | None:
    """Retourne le nom du motif de non-réponse détecté, ou None.
    Un refus suivi d'une substance (raisons, voisinage, alternative, liste)
    n'est PAS une non-réponse — c'est un inconnu honnête (exemption N1)."""
    t = (texte or "").strip()
    if not t:
        return "vide"
    substance = bool(_MOTIFS_SUBSTANCE.search(t)) or len(t) > _LONGUEUR_SEC
    for nom, motif in _MOTIFS_NON_REPONSE:
        if motif.search(t) and not substance:
            return nom
    # refus pur et simple (une seule phrase de refus, rien d'autre)
    if re.fullmatch(r"[^.!?]{10,240}[.!?]?", t) and \
            re.search(r"je ne (?:peux|sais) pas|je n'ai (?:pas|aucune)", t, re.IGNORECASE) \
            and not substance:
        return "refus_sec"
    return None


# --------------------------------------------------------- INTERDITS DE SORTIE
# Chaînes qui ne doivent JAMAIS atteindre la réponse finale (assert CI + garde
# défensive run_agent). Les codes de raison d'outils restent dans la TRACE
# (canal diagnostic), jamais dans la réponse utilisateur (N4).
MOTIFS_INTERDITS: list[tuple[str, str]] = [
    ("template_refus_v108", "je n'ai pas pu construire une réponse complète"),
    ("template_reformulation", "reformulez ou précisez un aspect"),
    ("template_refus_v107", "je n'ai pas de réponse utile"),
    ("raison_structure", "aucune structure"),
    ("raison_structure2", "structure non reconnue"),
    ("raison_parser", "non repéré"),
    ("raison_outil", "outil indisponible"),
    ("raison_technique_http", "http error"),
    ("raison_technique_traceback", "traceback"),
    ("raison_technique_exception", "erreur interne :"),
    ("raison_technique_bridge", "bridge llm"),
    ("raison_technique_ast", "syntaxerror"),
    # ---- v10.9.2 (P0 « HTTP Error 502 ») : signatures de FUITE INFRA du
    # pipeline (pont/SDK/upstream). Choix délibéré : on n'interdit PAS les
    # nombres nus (429/502) ni « bad gateway » seul — une réponse LÉGITIME à
    # une question cyber sur les codes HTTP peut les contenir (faux positif =
    # bonne réponse ré-émise cran (d)). Les signatures ci-dessous n'existent
    # que dans nos chaînes d'erreur internes.
    ("fuite_prefixe_llm_indispo", "llm indisponible"),
    ("fuite_sdk_request", "api request failed"),
    ("fuite_sdk_invoke", "function invoke failed"),
    ("fuite_upstream_host", "internal-api"),
    ("fuite_pont_sature", "modèle de langue est momentanément saturé"),
    ("fuite_pont_pause", "modèle de langue est momentanément en pause"),
    ("fuite_pont_demandes", "modèle de langue reçoit trop de demandes"),
    # ---- v10.9.1 : FORMULES USÉES du moule robotique (interdits canari) —
    # aucune réponse ne doit plus les contenir, sauf variante explicitement
    # assumée (les pools de voix.py ne les génèrent JAMAIS).
    ("formule_voici_ou_j_en_suis", "voici où j'en suis"),
    ("formule_detail_verifiable", "détail vérifiable"),
    ("formule_plutot_que_d_inventer", "plutôt que d'inventer"),
    ("formule_reprends_la_recherche", "je reprends la recherche"),
    ("formule_etat_exact", "état exact de ce que je sais"),
]


def violations(texte: str) -> list[str]:
    """Liste des interdits présents dans une réponse finale (vide = propre)."""
    t = (texte or "").lower()
    return [nom for nom, motif in MOTIFS_INTERDITS if motif in t]


def assert_propre(texte: str) -> None:
    """Assert CI : tolérance zéro. Lève AssertionError avec le détail."""
    v = violations(texte)
    if v:
        extrait = (texte or "")[:200].replace("\n", " ")
        raise AssertionError(f"interdits de sortie présents {v} — extrait : {extrait!r}")
    nr = detecter_non_reponse(texte)
    if nr and nr != "vide":
        extrait = (texte or "")[:200].replace("\n", " ")
        raise AssertionError(f"non-réponse détectée ({nr}) — extrait : {extrait!r}")


def resume_canari(texte: str) -> dict[str, Any]:
    """Résumé compact pour la trace / télémétrie."""
    return {"non_reponse": detecter_non_reponse(texte), "violations": violations(texte)}
