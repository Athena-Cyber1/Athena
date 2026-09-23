"""Vérificateur devinettes — politique d'incertitude honnête.

RÈGLES D'AUTORITÉ (anti-hallucination) :
- Charade (« mon premier… / mon second… / mon tout… ») : chaque indice doit se
  résoudre avec UNE seule candidate dominante ET « mon tout » doit être cohérent
  (nombre de lettres). Sinon → UNKNOWN + refus honnête explicite. JAMAIS d'invention.
- Devinette classique connue → lexique canonique (statut VERIFIED, source=lexique).
- Devinette inconnue → UNKNOWN + « Je ne peux pas déterminer la réponse avec certitude ».
"""
from __future__ import annotations

import re
from typing import Any

MARKERS = (r"mon\s+premier", r"mon\s+second", r"mon\s+deuxi[eè]me", r"mon\s+troisi[eè]me", r"mon\s+tout",
           r"qui\s+suis[-\s]je", r"\bai[-\s]je\b.*\?", r"des\s+dents", r"je\s+suis\s+.*\bmais\b")

# ------------------------------------------------------------- lexique indices
LEXIQUE_INDICES: dict[str, list[str]] = {
    "boisson chaude": ["thé", "café", "chocolat chaud"],
    "boisson chaude matinale": ["café"],
    "il cou": ["girafe"], "le cou": ["girafe"],
    "aime le fromage": ["souris"], "raconte le fromage": ["souris"],
    "animal qui aime le fromage": ["souris"],
    "a des ailes": ["oiseau", "papillon", "avion"],
    "vole la nuit": ["chauve-souris", "hibou"],
}

# --------------------------------------------------- lexique devinettes classiques
LEXIQUE_CLASSIQUES: list[dict[str, Any]] = [
    {"cle": r"des\s+dents\s+(?:mais|et)\s+ne\s+mord(?:s|ent)?\s+pas", "reponse": "un peigne",
     "courte": "un peigne", "justification": "Le peigne possède des dents mais ne mord pas."},
    {"cle": r"plus\s+je\s+suis\s+chaude.*plus\s+je\s+suis\s+fra[iî]che", "reponse": "le pain",
     "courte": "le pain", "justification": "Devinette classique : le pain sort chaud du four et rafraîchit."},
    {"cle": r"je\s+suis\s+plein\s+de\s+trous.*retiens\s+l['’]eau", "reponse": "une éponge",
     "courte": "une éponge", "justification": "L'éponge est pleine de trous mais retient l'eau."},
    {"cle": r"plus\s+on\s+en\s+prend.*plus\s+on\s+(?:en\s+)?laisse", "reponse": "des pas / des empreintes",
     "courte": "des empreintes de pas", "justification": "Plus on marche, plus on laisse de traces."},
    {"cle": r"peut\s+remplir\s+une\s+pi[eè]ce.*ne\s+prend\s+pas\s+de\s+place", "reponse": "la lumière",
     "courte": "la lumière", "justification": "La lumière remplit une pièce sans occuper d'espace."},
    {"cle": r"toujours\s+devant\s+toi.*invisible", "reponse": "le futur", "courte": "le futur",
     "justification": "Le futur est devant nous mais invisible."},
    {"cle": r"monte\s+et\s+descend.*reste\s+toujours\s+au\s+m[êe]me\s+endroit", "reponse": "un escalier",
     "courte": "un escalier", "justification": "L'escalier monte et descend sans bouger."},
    {"cle": r"a\s+un\s+cou.*pas\s+de\s+t[êe]te", "reponse": "une bouteille", "courte": "une bouteille",
     "justification": "La bouteille a un cou mais pas de tête."},
]


def est_devinette(question: str) -> bool:
    ql = question.lower()
    return any(re.search(m, ql) for m in MARKERS)


def _normaliser(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


# -------------------------------------------------------------- charades
def _decouper_charade(question: str) -> dict[str, str] | None:
    """Découpe « mon premier X / mon second Y / mon tout Z » en indices."""
    motifs = r"(?:mon\s+premier(?:e)?|mon\s+second|mon\s+deuxi[eè]me|mon\s+troisi[eè]me|mon\s+quatri[eè]me|mon\s+tout)"
    parts = re.split(motifs, question, flags=re.IGNORECASE)
    cles = re.findall(motifs, question, flags=re.IGNORECASE)
    if len(cles) < 2:
        return None
    indices = {}
    for cle, reste in zip(cles, parts[1:]):
        reste = re.split(r"[.,;!?]", reste)[0]
        reste = re.sub(r"^\s*est\s+", "", reste, flags=re.IGNORECASE).strip()  # enlève « est » initial seulement
        indices[_normaliser(cle)] = _normaliser(reste)
    return indices if indices else None


def _resoudre_indice(indice: str) -> list[str]:
    for cle, candidates in LEXIQUE_INDICES.items():
        if cle in indice or indice in cle:
            return candidates
    if "cou" in indice and "cou" != indice:
        return ["girafe"]
    if "fromage" in indice:
        return ["souris"]
    return []


def resoudre_charade(question: str) -> dict[str, Any]:
    indices = _decouper_charade(question)
    if not indices:
        return {"statut": "UNKNOWN", "raison": "structure de charade non reconnue"}
    cles = list(indices.keys())
    cles_indice = [c for c in cles if c != "mon tout"]
    resolu: dict[str, list[str]] = {}
    ambiguites: list[str] = []
    for cle in cles_indice:
        candidates = _resoudre_indice(indices[cle])
        if not candidates:
            ambiguites.append(f"indice non résolu : « {indices[cle]} »")
        elif len(candidates) > 1:
            ambiguites.append(f"indice ambigu « {indices[cle]} » : candidats {candidates}")
        else:
            resolu[cle] = candidates
    tout = indices.get("mon tout", "")

    if ambiguites:
        return {
            "statut": "UNKNOWN",
            "politique": "refus_honnete",
            "reponse_courte": "Je ne peux pas déterminer la réponse avec certitude.",
            "raisons": ambiguites + [
                "une charade exige que CHAQUE indice ait une solution unique et que « mon tout » soit cohérent "
                "(longueur des lettres) — inventer une réponse violerait la politique anti-hallucination."],
            "indices": indices,
        }

    # tous les indices résolus → vérifie la cohérence « mon tout »
    lettres = 0
    for candidats in resolu.values():
        lettres += len(candidats[0].replace(" ", ""))
    n_attendu = re.search(r"(\d+)\s+lettres", tout)
    if n_attendu and int(n_attendu.group(1)) != lettres:
        return {"statut": "UNKNOWN", "politique": "refus_honnete",
                "reponse_courte": "Je ne peux pas déterminer la réponse avec certitude.",
                "raisons": [f"« mon tout » annonce {n_attendu.group(1)} lettres, "
                            f"la concaténation des indices en donne {lettres}."],
                "indices": indices}
    return {"statut": "UNKNOWN", "politique": "refus_honnete",
            "reponse_courte": "Je ne peux pas déterminer la réponse avec certitude.",
            "raisons": ["indices résolus mais « mon tout » non vérifiable de façon déterministe"],
            "indices": indices, "lettres_calculees": lettres}


# ------------------------------------------------------------- devinettes classiques
def resoudre_classique(question: str) -> dict[str, Any] | None:
    ql = _normaliser(question)
    for entree in LEXIQUE_CLASSIQUES:
        if re.search(entree["cle"], ql):
            return {"statut": "VERIFIED", "reponse_courte": entree["courte"], "reponse": entree["reponse"],
                    "justification": entree["justification"], "source": "lexique_devinettes",
                    "preuve": "entrée canonique du lexique de devinettes"}
    return None


def resoudre(question: str) -> dict[str, Any]:
    """API outil : analyse de devinette avec politique d'honnêteté stricte."""
    if not est_devinette(question):
        return {"statut": "UNKNOWN", "raison": "pas une devinette"}

    classique = resoudre_classique(question)
    if classique:
        return classique

    if re.search(r"mon\s+premier|mon\s+second|mon\s+tout", question, re.IGNORECASE):
        return resoudre_charade(question)

    return {
        "statut": "UNKNOWN", "politique": "refus_honnete",
        "reponse_courte": "Je ne peux pas déterminer la réponse avec certitude.",
        "raisons": ["devinette absente du lexique de références ; "
                    "deviner produirait une réponse plausible mais non vérifiée"],
    }
