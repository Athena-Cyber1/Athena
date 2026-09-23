"""Vérificateur grammatical français — règles structurées, aucune devinette LLM.

Règle d'autorité (accord du participe passé avec « être » réfléchi) :
  sujet + (se) + auxiliaire + PARTICIPE + COD ?
  - COD DIRECT postposé (« se sont lavé les mains »)  → participe INVARIABLE.
  - COD absent / = pronom réfléchi antéposé (« elles se sont lavées ») → accord sujet.
  - Complément indirect (préposition) → invariable.
"""
from __future__ import annotations

import re
from typing import Any

_DETERMINANTS = r"(?:le|la|l'|les|un|une|des|du|de la|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs|ce|cet|cette|ces|quelques|plusieurs|trois|deux|quatre|cinq)"
_PREPOSITIONS = r"(?:à|au|aux|de|du|des|par|pour|avec|sur|sous|dans|en|chez|vers|pendant|contre|sans)"
_PARTICIPES_INCONGRUS = {"parti", "partis", "partie", "parties", "allé", "allés", "venu", "venus",
                         "arrivé", "arrivés", "resté", "restés", "mort", "morts", "né", "nés",
                         "descendu", "monté", "sorti", "sortis", "entré", "entrés", "tombé", "tombés",
                         "retourné", "reparti", "devenu", "devenus", "restées", "allées", "venues"}

_AUXX_REFLECHIS = {"me", "te", "se", "nous", "vous"}
_AUXX = {"sont": "pluriel", "est": "singulier", "sommes": "pluriel", "êtes": "pluriel", "es": "singulier", "étais": None}


def _tokens(phrase: str) -> list[str]:
    return re.findall(r"[\wàâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]+|l'|d'", phrase.lower())


def _est_participe(tok: str) -> bool:
    return bool(re.fullmatch(r"\w+(é|és|ée|ées|i|is|it|its|u|us|ut)", tok)) and len(tok) > 2 and tok not in {
        "ici", "aussi", "deja", "déjà", "tout", "toute", "tous", "très", "tres", "bien", "puis", "aujourd'hui", "qui"}


def _sujet(phrase: str) -> dict[str, Any]:
    t = _tokens(phrase)
    pluriel_f = re.search(r"\b(?:elles|femmes|filles|personnes?\s+f[ée]minines?)\b", phrase, re.IGNORECASE) and bool(re.search(r"\belles\b", phrase, re.IGNORECASE))
    if re.search(r"\belles\b", phrase, re.IGNORECASE):
        return {"genre": "f", "nombre": "p", "mot": "elles"}
    if re.search(r"\bils\b", phrase, re.IGNORECASE):
        return {"genre": "m", "nombre": "p", "mot": "ils"}
    if re.search(r"\belle\b", phrase, re.IGNORECASE):
        return {"genre": "f", "nombre": "s", "mot": "elle"}
    if re.search(r"\bil\b", phrase, re.IGNORECASE):
        return {"genre": "m", "nombre": "s", "mot": "il"}
    if re.search(r"\bje\b", phrase, re.IGNORECASE):
        return {"genre": "?", "nombre": "s", "mot": "je"}
    if re.search(r"\bnous\b", phrase, re.IGNORECASE):
        return {"genre": "?", "nombre": "p", "mot": "nous"}
    if re.search(r"\bvous\b", phrase, re.IGNORECASE):
        return {"genre": "?", "nombre": "p", "mot": "vous"}
    # noms communs
    m = re.search(r"\b(?:les|des)\s+(\w+(?:es|s))\b", phrase, re.IGNORECASE)
    if m:
        mot = m.group(1)
        return {"genre": "f" if mot.endswith("es") else "?", "nombre": "p", "mot": mot}
    return {"genre": "?", "nombre": "?", "mot": t[0] if t else "?"}


def _base_participe(participe: str) -> str:
    """Retire les marques d'accord : lavées→lavé, lavés→lavé, venue→venu, partis→parti."""
    for suf, ajout in (("ées", "é"), ("és", "é"), ("ée", "é"), ("es", ""), ("e", ""), ("s", "")):
        if participe.endswith(suf) and len(participe) > len(suf) + 2:
            return participe[:-len(suf)] + ajout
    return participe


def _accord_participe(participe: str, sujet: dict[str, Any]) -> str:
    base = _base_participe(participe)
    g, n = sujet.get("genre", "?"), sujet.get("nombre", "?")
    fin = ""
    if n == "p":
        fin += "s"
    if g == "f":
        fin = "e" + fin
    return base + fin


def analyser_participe(phrase: str) -> dict[str, Any]:
    """Analyse « [sujet] se sont/est PARTICIPE [COD ?] » → verdict déterministe."""
    t = _tokens(phrase)
    verdict = {"phrase": phrase.strip()}

    # localise auxiliaire précédé du pronom réfléchi
    idx_aux = None
    for i, tok in enumerate(t):
        if tok in _AUXX and i > 0 and t[i - 1] in _AUXX_REFLECHIS:
            idx_aux = i
            break
    if idx_aux is None:
        for i, tok in enumerate(t):
            if tok in _AUXX:
                idx_aux = i
                break
    if idx_aux is None:
        return {"statut": "UNKNOWN", "raison": "pas d'auxiliaire « être » repéré", **verdict}

    participe = None
    for tok in t[idx_aux + 1: idx_aux + 4]:
        if _est_participe(tok):
            participe = tok
            break
    if participe is None:
        return {"statut": "UNKNOWN", "raison": "participe passé non repéré", **verdict}
    verdict["participe"] = participe

    reste = t[idx_aux + 1 + t[idx_aux + 1: idx_aux + 4].index(participe) + 1:] if participe in t[idx_aux + 1: idx_aux + 4] else []
    apres = phrase.lower().split(participe, 1)[1] if participe in phrase.lower() else ""

    # COD direct postposé : déterminant + nom, sans préposition juste après
    m_cod = re.match(rf"\s*{_DETERMINANTS}\s+\w+", apres.strip())
    m_prep = re.match(rf"\s*{_PREPOSITIONS}\b", apres.strip())
    cod_postpose = bool(m_cod) and not m_prep

    sujet = _sujet(phrase)
    intransitif = participe in _PARTICIPES_INCONGRUS

    if cod_postpose:
        forme_attendue = _base_participe(participe)  # INVARIABLE (base sans marque d'accord)
        regle = "COD direct postposé → le participe passé avec « être » réfléchi reste INVARIABLE."
        correcte = participe == forme_attendue
        correction = None if correcte else re.sub(
            rf"\b{participe}\b", forme_attendue, phrase, flags=re.IGNORECASE)
        verdict.update({
            "statut": "VERIFIED", "correcte": correcte, "regle": regle,
            "forme_attendue": forme_attendue, "correction": correction,
            "explication": f"« {participe} » est suivi du COD direct (« {m_cod.group(0).strip()}… ») "
                           f"placé après le verbe : pas d'accord.",
        })
        return verdict

    if m_prep:
        forme_attendue = participe
        verdict.update({
            "statut": "VERIFIED", "correcte": True, "regle": "Complément indirect (préposition) → invariable.",
            "forme_attendue": forme_attendue, "correction": None,
            "explication": f"Le complément est introduit par une préposition (« {m_prep.group(0).strip()} ») : "
                           f"ce n'est pas un COD direct, donc pas d'accord.",
        })
        return verdict

    if intransitif:
        forme_attendue = _accord_participe(participe, sujet)
        correcte = participe == forme_attendue
        verdict.update({
            "statut": "VERIFIED", "correcte": correcte,
            "regle": "Verbe intransitif conjugué avec « être » → accord avec le sujet.",
            "forme_attendue": forme_attendue,
            "correction": None if correcte else re.sub(rf"\b{participe}\b", forme_attendue, phrase, flags=re.IGNORECASE),
            "explication": f"« {participe} » : verbe intransitif → accord avec le sujet (« {sujet['mot']} »).",
        })
        return verdict

    # pas de COD après : le pronom réfléchi antéposé est le COD → accord avec le sujet
    forme_attendue = _accord_participe(participe, sujet)
    correcte = participe == forme_attendue
    verdict.update({
        "statut": "VERIFIED", "correcte": correcte,
        "regle": "Sans COD postposé, le pronom réfléchi antéposé est le COD → accord avec le sujet.",
        "forme_attendue": forme_attendue,
        "correction": None if correcte else re.sub(rf"\b{participe}\b", forme_attendue, phrase, flags=re.IGNORECASE),
        "explication": f"Aucun COD après le verbe : le « se » antéposé est le COD → accord avec « {sujet['mot']} » "
                       f"→ forme attendue « {forme_attendue} ».",
    })
    return verdict


# --------------------------------------------------------------------- API outil
def resoudre_grammaire(question: str) -> dict[str, Any]:
    """« La phrase X est-elle correcte ? » / « pourquoi ... pas accord » → verdict déterministe."""
    ql = question.strip()

    # phrases entre guillemets analysables
    candidates = re.findall(r"[««\"“]([^»»\"”]+)[»»\"”]", ql)
    if not candidates:
        # heuristique : la portion après « : » ou la phrase contenant « se sont »
        m = re.search(r"([AÀA-ZÉÈ][^.?!]*\b(?:se\s+)?(?:sont|est)\b[^.?!]*)", ql)
        candidates = [m.group(1)] if m else ([ql] if re.search(r"\b(?:se\s+)?(?:sont|est)\b", ql) else [])

    if not candidates:
        return {"statut": "UNKNOWN", "raison": "aucune phrase analysable trouvée"}

    analyses = [analyser_participe(c) for c in candidates[:4]]
    verifiables = [a for a in analyses if a.get("statut") == "VERIFIED"]
    if not verifiables:
        return {"statut": "UNKNOWN", "raison": analyses[0].get("raison", "analyse impossible"),
                "analyses": analyses}

    cible = verifiables[0]
    return {
        "statut": "VERIFIED",
        "correcte": cible.get("correcte", False),
        "phrase": cible.get("phrase"),
        "participe": cible.get("participe"),
        "forme_attendue": cible.get("forme_attendue"),
        "regle": cible.get("regle"),
        "explication": cible.get("explication"),
        "correction": cible.get("correction"),
        "preuve": f"règle appliquée : {cible.get('regle')}",
    }
