"""Solveur mathématique déterministe — AUTORITÉ sur les calculs.

Canonisation : « 80 € avec 25 % de réduction » → 80 × (1 − 25/100) = 60.
Arithmétique exacte via Fraction. Aucun LLM dans cette boucle.

v10.8 — Classe 3 du benchmark (arithmétique non déterministe) :
- Négatifs acceptés comme opérande ET opérateur (« -7 + -3 », « 7*-3 »),
  espaces variables, opérateurs unicode × ÷ −.
- Division par zéro : cas codé en dur → « indéfini (division par zéro) »,
  JAMAIS transmis au LLM (aucune place pour le modèle là-dessus).
- Expression complète avec parenthèses (« (3+4)×5 ») évaluée directement.
- Comptage de lettres (« combien de lettres dans chat ») — outil déterministe.
- Grands produits : l'expression extraite passe TOUJOURS par Fraction (exact),
  le LLM ne fait que présenter le résultat.

v10.9 — N3 (normalisation FR + conversions, invariant « aucune structure
reconnue n'atteint jamais l'UI ») :
- Nombres en lettres : parseur FR interne (« vingt-cinq », « quatre-vingt-dix-sept »,
  « deux mille trois cents ») — num2words ne sait faire QUE nombre→lettres, la
  direction lettresa→nombre est codée ici (convention documentée).
- Fractions en mots : « trois quarts de 80 » → 60, « la moitié de 90 » → 45.
- Températures : °C↔°F↔K AFFINES (×9/5+32) traités À PART des conversions
  par ratio (une conversion de température n'est pas proportionnelle).
- Unités par ratio : km/m/cm, kg/g/t, l/ml, h/min/s/jours, semaines…
- Table de constantes triviales : 365 j (année NON bissextile = convention),
  366 j (bissextile), 1440 min/j, 168 h/semaine, 52 semaines/an, 30 j/mois.
- CONVENTION : t/tonne = tonne métrique (1 000 kg) ; « année » = année
  standard non bissextile sauf mention contraire.
- Échec de parse → raison = CODE INTERNE (STRUCTURE_NON_RECONNUE +
  detail_interne pour la trace) : JAMAIS de prose technique dans la réponse
  utilisateur — la politique de dégradation du rendu_final s'applique (N4).
"""
from __future__ import annotations

import ast
import operator
import re
from fractions import Fraction
from typing import Any

_POURCENT = r"(\d+(?:[.,]\d+)?)\s*(?:%|pour\s?cents?|pourcents?)"
_PRIX = r"(\d+(?:[.,]\d+)?)\s*(?:€|eur\b|euros?|euros?)"

_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv, ast.USub: operator.neg, ast.UAdd: operator.pos,
}

_MOTS_NOMBRES = {
    "zéro": 0, "zero": 0, "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4,
    "cinq": 5, "six": 6, "sept": 7, "huit": 8, "neuf": 9, "dix": 10,
    "onze": 11, "douze": 12, "treize": 13, "quatorze": 14, "quinze": 15,
    "seize": 16, "vingt": 20, "trente": 30, "quarante": 40, "cinquante": 50,
    "soixante": 60, "cent": 100, "mille": 1000,
}

# ------------------------------------------------------- v10.9 N3 : nombres en lettres
# num2words sait faire nombre→lettres mais PAS lettres→nombre : le parseur
# inverse est codé ici (zéro dépendance, déterministe, testé par golden tests).
_PETITS = {"un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5,
           "six": 6, "sept": 7, "huit": 8, "neuf": 9, "dix": 10, "onze": 11,
           "douze": 12, "treize": 13, "quatorze": 14, "quinze": 15, "seize": 16,
           "vingt": 20, "vingts": 20, "trente": 30, "quarante": 40, "cinquante": 50,
           "soixante": 60, "dix": 10}
_RE_MOT_NOMBRE = ("(?:seize|quinze|quatorze|treize|douze|onze|dix|neuf|huit|sept|six|cinq|"
                  "quatre|trois|deux|un[ei]?|vingts?|trente|quarante|cinquante|soixante|"
                  "mille|millions?|milliards?|cents?)")
_RE_SPAN_NOMBRE = re.compile(
    rf"\b{_RE_MOT_NOMBRE}(?:[\s\-]+(?:et[\s\-]+)?{_RE_MOT_NOMBRE})+\b", re.IGNORECASE)


def _lettres_vers_nombre(texte: str) -> int | None:
    """« quatre-vingt-dix-sept » → 97, « deux mille trois cents » → 2300,
    « soixante et onze » → 71. Retourne None si un mot n'est pas un nombre
    (aucune interprétation hasardeuse)."""
    mots = [m for m in re.findall(r"[a-zà-ÿ]+", (texte or "").lower()) if m != "et"]
    if not mots:
        return None
    # « quatre-vingt(s) » = token composite 80 (avant tout traitement)
    i = 0
    while i < len(mots):
        if mots[i] == "quatre" and i + 1 < len(mots) and mots[i + 1] in ("vingt", "vingts"):
            mots[i:i + 2] = ["quatre-vingts"]
            continue
        i += 1
    total, courant, vu = 0, 0, False
    for m in mots:
        if m in ("mille",):
            courant = (courant or 1) * 1000
            total += courant
            courant = 0
            vu = True
        elif m in ("million", "millions"):
            courant = (courant or 1) * 1_000_000
            total += courant
            courant = 0
            vu = True
        elif m in ("milliard", "milliards"):
            courant = (courant or 1) * 1_000_000_000
            total += courant
            courant = 0
            vu = True
        elif m in ("cent", "cents"):
            courant = (courant or 1) * 100
            vu = True
        elif m == "quatre-vingts":
            courant += 80
            vu = True
        elif m in _PETITS:
            courant += _PETITS[m]
            vu = True
        else:
            return None
    return total + courant if vu else None


def _normaliser_nombres_mots(q: str) -> str:
    """Remplace les nombres COMPOSÉS en lettres par des chiffres
    (« quatre-vingt-dix-sept » → 97) ; les nombres simples sont gérés par la
    table _MOTS_NOMBRES (comportement v10.8 conservé)."""
    def remp(m: re.Match[str]) -> str:
        span = m.group(0)
        s = re.sub(r"[\s\-]+", " ", span.lower()).strip()
        s = s.replace("quatre vingts", "quatre-vingts").replace("quatre vingt", "quatre-vingts")
        n = _lettres_vers_nombre(s.replace("quatre-vingts", "quatre-vingt"))
        return str(n) if n is not None else span
    return _RE_SPAN_NOMBRE.sub(remp, q)


# --------------------------------------------------- v10.9 N3 : fractions en mots
_FRACTIONS_MOTS = {
    "moitie": (1, 2), "moitié": (1, 2), "demi": (1, 2), "demie": (1, 2),
    "tiers": (1, 3), "quart": (1, 4), "quarts": (1, 4),
    "cinquieme": (1, 5), "cinquième": (1, 5), "cinquiemes": (1, 5), "cinquièmes": (1, 5),
    "sixieme": (1, 6), "sixième": (1, 6), "huitieme": (1, 8), "huitième": (1, 8),
    "dixieme": (1, 10), "dixième": (1, 10), "centieme": (1, 100), "centième": (1, 100),
}
_RE_FRACTION_MOTS = re.compile(
    r"(?:([a-zà-ÿ\-]+|[\d.]+)\s+)?(moiti[eé]|demie?|tiers?|quarts?|cinqui[eè]mes?|"
    r"sixi[eè]mes?|huiti[eè]mes?|dixi[eè]mes?|centi[eè]mes?)\s+(?:de|du|des|d['’])\s*"
    r"(\d+(?:[.,]\d+)?)", re.IGNORECASE)


def _resoudre_fraction_mots(q: str) -> dict[str, Any] | None:
    """« trois quarts de 80 » → 60 ; « la moitié de 90 » → 45 ; « deux tiers de 90 » → 60."""
    m = _RE_FRACTION_MOTS.search(q)
    if not m:
        return None
    num_brut, den_mot, n_brut = m.group(1), m.group(2).lower(), m.group(3)
    if num_brut:
        num = _lettres_vers_nombre(num_brut)
        if num is None:
            try:
                num = int(float(num_brut.replace(",", ".")))
            except ValueError:
                num = 1
    else:
        num = 1
    den = _FRACTIONS_MOTS.get(den_mot.replace("moité", "moitié"))
    if den is None:
        # formes : « moitié » sans accent / pluriels « quarts » déjà couverts
        den = _FRACTIONS_MOTS.get(den_mot.rstrip("s")) or _FRACTIONS_MOTS.get(den_mot + "s")
    if den is None:
        return None
    n = _fr(n_brut)
    res = n * Fraction(num) * Fraction(den[0], den[1])
    num_aff = {1: "un", 2: "deux", 3: "trois", 4: "quatre"}.get(num, str(num))
    den_aff = {2: "deux", 3: "trois", 4: "quarts", 5: "cinquièmes", 6: "sixièmes",
               8: "huitièmes", 10: "dixièmes", 100: "centièmes"}.get(den[1], f"1/{den[1]}")
    if den[1] == 2:
        expr = f"{num_aff} moitié(s) × {n}" if num != 1 else f"la moitié de {n}"
    elif den[1] == 3:
        expr = f"{num_aff} tiers × {n}"
    else:
        expr = f"{num_aff} {den_aff} × {n}"
    return {"methode": "fraction_mots", "resultat": res, "expression": expr}


# ------------------------------------------------- v10.9 N3 : température (affine)
_UNIT_TEMP = {"c": "C", "celsius": "C", "celcius": "C", "f": "F", "fahrenheit": "F",
              "k": "K", "kelvin": "K"}
_RE_TEMPERATURE = re.compile(
    r"(-?\d+(?:[.,]\d+)?)\s*(?:°\s*)?(?:degr[eé]s?\s*)?"
    r"([cf]|celsius|celcius|fahrenheit|kelvin|k)\b[\s\w]*?"
    r"(?:en|vers|pour obtenir des?|→)\s*(?:°\s*)?(?:degr[eé]s?\s*)?"
    r"([cf]|celsius|celcius|fahrenheit|kelvin|k)\b", re.IGNORECASE)


def _convertir_temperature(v: Fraction, src: str, dst: str) -> Fraction:
    """Conversions AFFINES (≠ ratio) : C→F ×9/5+32, F→C (F−32)×5/9, C↔K ±273.15."""
    if src == dst:
        return v
    c = v if src == "C" else (v - Fraction(32)) * Fraction(5, 9) if src == "F" \
        else v - Fraction("273.15")
    if dst == "C":
        return c
    if dst == "F":
        return c * Fraction(9, 5) + Fraction(32)
    return c + Fraction("273.15")  # K


def _resoudre_temperature(q: str) -> dict[str, Any] | None:
    m = _RE_TEMPERATURE.search(q)
    if not m:
        return None
    v, src, dst = _fr(m.group(1)), _UNIT_TEMP.get(m.group(2).lower()), _UNIT_TEMP.get(m.group(3).lower())
    if src is None or dst is None or src == dst:
        return None
    res = _convertir_temperature(v, src, dst)
    affine = {"C": f"{v} °C", "F": f"{v} °F", "K": f"{v} K"}[src]
    formule = {("C", "F"): "°C × 9/5 + 32", ("F", "C"): "(°F − 32) × 5/9",
               ("C", "K"): "°C + 273,15", ("K", "C"): "K − 273,15",
               ("F", "K"): "(°F − 32) × 5/9 + 273,15", ("K", "F"): "(K − 273,15) × 9/5 + 32"}[(src, dst)]
    return {"methode": "conversion_temperature", "resultat": res,
            "unite": {"C": "°C", "F": "°F", "K": "K"}[dst], "expression": f"{affine} → {formule}",
            "note": "conversion affine (décalage + pente), ≠ conversion par ratio"}


# ------------------------------------------------- v10.9 N3 : unités (ratio) + constantes
# CONVENTION (documentée) : t/tonne = tonne MÉTRIQUE (1 000 kg) ; « année » =
# année standard NON bissextile (365 j) sauf mention explicite contraire.
_UNITES_RATIO: dict[tuple[str, str], Fraction] = {
    ("km", "m"): Fraction(1000), ("m", "cm"): Fraction(100), ("cm", "mm"): Fraction(10),
    ("m", "mm"): Fraction(1000), ("km", "cm"): Fraction(100000), ("m", "km"): Fraction(1, 1000),
    ("cm", "m"): Fraction(1, 100), ("mm", "m"): Fraction(1, 1000), ("mm", "cm"): Fraction(1, 10),
    ("kg", "g"): Fraction(1000), ("g", "kg"): Fraction(1, 1000),
    ("t", "kg"): Fraction(1000), ("tonne", "kg"): Fraction(1000), ("tonnes", "kg"): Fraction(1000),
    ("kg", "t"): Fraction(1, 1000), ("l", "ml"): Fraction(1000), ("litre", "ml"): Fraction(1000),
    ("litres", "ml"): Fraction(1000), ("ml", "l"): Fraction(1, 1000),
    ("h", "min"): Fraction(60), ("heure", "min"): Fraction(60), ("heures", "min"): Fraction(60),
    ("min", "h"): Fraction(1, 60), ("minute", "h"): Fraction(1, 60), ("minutes", "h"): Fraction(1, 60),
    ("min", "s"): Fraction(60), ("minute", "s"): Fraction(60), ("minutes", "s"): Fraction(60),
    ("s", "min"): Fraction(1, 60), ("h", "s"): Fraction(3600), ("heures", "s"): Fraction(3600),
    ("jour", "h"): Fraction(24), ("jours", "h"): Fraction(24),
    ("jour", "min"): Fraction(1440), ("jours", "min"): Fraction(1440),
    ("h", "jour"): Fraction(1, 24), ("heures", "jour"): Fraction(1, 24),
    ("semaine", "jour"): Fraction(7), ("semaine", "jours"): Fraction(7),
    ("semaines", "jours"): Fraction(7), ("jour", "semaine"): Fraction(1, 7),
    ("km", "h"): Fraction(1),  # garde-fou : km/h est une vitesse, pas convertible
}
_RE_CONVERTIR = re.compile(
    r"(?:converti[rs]?|convertissez|)[\s:]*(-?\d+(?:[.,]\d+)?)\s*"
    r"(km|kg|t|tonnes?|ml|mm|cm|km|m|l|litres?|g|s|seconds?|secondes?|min|minutes?|h|heures?|jours?|semaines?)"
    r"\s*(?:en|vers|→|pour obtenir des?)\s*"
    r"(km|kg|t|tonnes?|ml|mm|cm|m|l|litres?|g|s|seconds?|secondes?|min|minutes?|h|heures?|jours?|semaines?)\b",
    re.IGNORECASE)
_RE_COMBIEN_DANS = re.compile(
    r"combien\s+(?:y\s+a[\s\-t]*il\s+)?de\s+(km|kg|t|tonnes?|ml|mm|cm|m|l|litres?|g|s|seconds?|secondes?|"
    r"min|minutes?|h|heures?|jours?|semaines?)\s+(?:y\s+a[\s\-t]*il\s+)?(?:dans|en)\s+"
    r"(\d+(?:[.,]\d+)?)\s*(km|kg|t|tonnes?|ml|mm|cm|m|l|litres?|g|s|seconds?|secondes?|min|minutes?|"
    r"h|heures?|jours?|semaines?)", re.IGNORECASE)


_UNITES_CANONIQUES = {"seconde": "s", "seconds": "s", "secondes": "s", "sec": "s",
                      "minute": "min", "minutes": "min", "heure": "h", "heures": "h",
                      "jour": "jour", "jours": "jour", "semaine": "semaine", "semaines": "semaine",
                      "litre": "l", "litres": "l", "tonne": "t", "tonnes": "t"}


def _canon_u(u: str) -> str:
    u = (u or "").lower().strip()
    return _UNITES_CANONIQUES.get(u, u)


def _resoudre_conversion(q: str) -> dict[str, Any] | None:
    """Conversions par RATIO (km↔m, kg↔g, h↔min…). Les températures sont
    traitées À PART (affines). Convention : t = tonne métrique = 1 000 kg."""
    m_combien = _RE_COMBIEN_DANS.search(q)
    m_conv = _RE_CONVERTIR.search(q)
    if not m_combien and not m_conv:
        return None
    if m_combien and not m_conv:
        u2, n, u1 = m_combien.group(1), m_combien.group(2), m_combien.group(3)
    else:
        m = m_conv
        n, u1, u2 = m.group(1), m.group(2), m.group(3)
    u1, u2 = _canon_u(u1), _canon_u(u2)
    ratio = _UNITES_RATIO.get((u1, u2))
    if ratio is None or ratio == 1:  # inconnue, ou km/h (vitesse, pas convertible)
        return None
    res = _fr(n) * ratio
    return {"methode": "conversion_unites", "resultat": res,
            "unite": u2, "expression": f"{n} {u1} × {ratio} = {_afficher(res)} {u2}",
            "note": "conversion par ratio (proportionnelle) — convention : t = tonne métrique"}


# constantes triviales : (motif, code, exception(bissextile), valeur Fraction, libellé)
_CONSTANTES = (
    (re.compile(r"jours?.*(?:dans|par|pour).*(?:ann[ée]e|an)\b", re.IGNORECASE), "jours_par_annee",
     ("bissextile", Fraction(366)), Fraction(365),
     "365 jours (année standard NON bissextile — convention ; bissextile : 366)"),
    (re.compile(r"(?:minutes?|mins?).*(?:dans|par).*(?:jour|journ[ée]e)", re.IGNORECASE), "minutes_par_jour",
     None, Fraction(1440), "1 440 minutes (24 h × 60 min)"),
    (re.compile(r"(?:heures?).*(?:dans|par).*(?:semaine)", re.IGNORECASE), "heures_par_semaine",
     None, Fraction(168), "168 heures (7 j × 24 h)"),
    (re.compile(r"(?:secondes?|secs?).*(?:dans|par).*(?:heure)", re.IGNORECASE), "secondes_par_heure",
     None, Fraction(3600), "3 600 secondes (60 min × 60 s)"),
    (re.compile(r"(?:jours?).*(?:dans|par).*(?:semaine)", re.IGNORECASE), "jours_par_semaine",
     None, Fraction(7), "7 jours"),
    (re.compile(r"(?:semaines?).*(?:dans|par).*(?:ann[ée]e|an)\b", re.IGNORECASE), "semaines_par_annee",
     None, Fraction(52), "52 semaines (convention courante ; 52,14 en valeur exacte)"),
    (re.compile(r"(?:heures?).*(?:dans|par).*(?:jour|journ[ée]e)", re.IGNORECASE), "heures_par_jour",
     None, Fraction(24), "24 heures"),
)


def _resoudre_constantes(q: str) -> dict[str, Any] | None:
    """« combien de jours dans une année (non bissextile) » → 365 — constante
    triviale, codée en dur avec sa convention documentée."""
    ql = q.lower()
    for motif, cle, exception, valeur, libelle in _CONSTANTES:
        if not motif.search(ql):
            continue
        if exception:
            # « non bissextile » = année STANDARD (365) — vérifier la négation
            # AVANT le mot « bissextile » seul.
            if re.search(r"\bnon[\s\-]?bissextile\b", ql):
                return {"methode": cle, "resultat": valeur, "expression": libelle}
            if re.search(rf"\b{exception[0]}\b", ql):
                return {"methode": cle, "resultat": exception[1],
                        "expression": "366 jours (année bissextile)"}
        return {"methode": cle, "resultat": valeur, "expression": libelle}
    return None


def _fr(x: str) -> Fraction:
    return Fraction(str(x).strip().replace(",", ".").replace(" ", ""))


def _afficher(f: Fraction) -> str:
    if f.denominator == 1:
        return str(f.numerator)
    v = float(f)
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return s


# ------------------------------------------------------------------ arithmétique
def evaluer_expression_detaillee(expr: str) -> tuple[Fraction | None, str | None]:
    """v10.8 — évaluation SÛRE avec raison d'échec distinguée.
    Retourne (Fraction, None) en succès ; (None, "division par zéro") pour ÷0 ;
    (None, None) si l'expression n'est pas arithmétique."""
    expr = expr.replace("×", "*").replace("÷", "/").replace("^", "**").replace("−", "-")
    if not re.fullmatch(r"[\d\s\.\,\+\-\*\/\(\)%]+", expr):
        return None, None
    expr = re.sub(r"(\d+(?:[.,]\d+)?)\s*%", r"(\1/100)", expr)
    try:
        arbre = ast.parse(expr, mode="eval")

        def ev(node) -> Fraction:
            if isinstance(node, ast.Expression):
                return ev(node.body)
            if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
                return Fraction(str(node.value))
            if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
                return _OPS[type(node.op)](ev(node.left), ev(node.right))
            if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
                return _OPS[type(node.op)](ev(node.operand))
            raise ValueError("nœud non autorisé")

        return ev(arbre), None
    except ZeroDivisionError:
        return None, "division par zéro"
    except Exception:
        return None, None


def evaluer_expression(expr: str) -> Fraction | None:
    """Évalue une expression arithmétique (+ - * / ^ % parenthèses) de façon sûre."""
    return evaluer_expression_detaillee(expr)[0]


def _extraire_expression(question: str) -> str | None:
    # v10.8 (Classe 3) — négatifs en opérande ET en opérande droit :
    # « -7 + -3 », « 7*-3 », « 987654321×123456789 », espaces variables,
    # unicode × ÷ ^ −. Plus longue suite calculable du texte.
    candidats = re.findall(
        r"-?\d+(?:[.,]\d+)?(?:\s*(?:[\+\-\*\/×÷\^−]|mod)\s*-?\d+(?:[.,]\d+)?)+",
        question.replace("**", "^"),
    )
    if not candidats:
        return None
    return max(candidats, key=len)


def _expression_complete(q: str) -> str | None:
    """v10.8 (Classe 3) — la question EST (presque) une expression : ex.
    « (3+4)×5 », « 987654321×123456789 », « calcule -7 + -3 ». Gère les
    parenthèses, que l'extracteur de chaînes ne couvre pas."""
    nettoie = q.strip().rstrip("?!. ").strip()
    nettoie = re.sub(
        r"^(?:calcule(?:r|z)?|[ée]value(?:r|z)?|r[ée]sous|résous|combien\s+(?:font|fait)|"
        r"quel\s+est\s+le\s+r[ée]sultat\s+(?:de|d['’])\s*|combien\s+de)\s*",
        "", nettoie, flags=re.IGNORECASE).strip()
    nettoie = re.sub(r"\s*(?:=|c'est|font|fait|donne|[ée]gale)\s*$", "", nettoie,
                     flags=re.IGNORECASE).strip()
    if not nettoie or not re.search(r"[\+\-\*\/×÷\^−]", nettoie):
        return None
    if re.fullmatch(r"[\d\s\.\,\+\-\*\/×÷\^−%\(\)]+", nettoie):
        return nettoie
    return None


def _compter_lettres(q: str) -> dict[str, Any] | None:
    """v10.8 (Classe 3) — comptage de lettres déterministe :
    « combien de lettres dans \"chat\" » → 4. Zéro LLM."""
    m = re.search(
        r"(?:combien\s+(?:y\s+a[\s\-t]*il\s+)?de\s+|nombre\s+de\s+)?lettres?\s+"
        r"(?:dans|de)\s+[«\"“'’]?([A-Za-zÀ-ÿ0-9\-]+)[»\"”'’]?",
        q, re.IGNORECASE)
    if not m:
        return None
    mot = m.group(1)
    if mot.lower() in _MOTS_NOMBRES or not re.search(r"[A-Za-zÀ-ÿ]", mot):
        return None
    n = sum(1 for ch in mot if ch.isalpha())
    return {"methode": "comptage_lettres", "resultat": str(n),
            "expression": f"lettres de « {mot} »",
            "preuve": f"« {mot} » comporte {n} lettre(s) (comptage direct, caractère par caractère)."}


# ----------------------------------------------------------------- pourcentages
def _resoudre_pourcentages(q: str) -> dict[str, Any] | None:
    ql = q.lower()
    prix_m = re.search(_PRIX, q)
    pourcent_m = re.search(_POURCENT, ql)

    if not (prix_m and pourcent_m):
        return None
    prix = _fr(prix_m.group(1))
    p = _fr(pourcent_m.group(1))

    if re.search(r"r[ée]duction|remise|rabais|solde|baisse|moins cher|coûte", ql):
        res = prix * (1 - p / 100)
        return {"methode": "reduction_pourcentage", "resultat": res,
                "expression": f"{_afficher(prix)} × (1 − {p}/100)", "prix": prix, "taux": p}
    if re.search(r"augment|hausse|majoration|plus cher", ql):
        res = prix * (1 + p / 100)
        return {"methode": "augmentation_pourcentage", "resultat": res,
                "expression": f"{_afficher(prix)} × (1 + {p}/100)", "prix": prix, "taux": p}
    if re.search(r"\b(TVA|taxe)\b", ql):
        res = prix * (1 + p / 100)
        return {"methode": "taxe_pourcentage", "resultat": res,
                "expression": f"{_afficher(prix)} × (1 + {p}/100)", "prix": prix, "taux": p}
    return None


def _resoudre_pourcentage_de(q: str) -> dict[str, Any] | None:
    m = re.search(_POURCENT + r"\s*(?:de|du|des|sur)\s*(\d+(?:[.,]\d+)?)", q, re.IGNORECASE)
    if not m:
        return None
    p, n = _fr(m.group(1)), _fr(m.group(2))
    res = n * p / 100
    return {"methode": "pourcentage_de", "resultat": res, "expression": f"{p}% × {n}"}


# -------------------------------------------------------------- problèmes types
def _resoudre_probleme(q: str) -> dict[str, Any] | None:
    ql = q.lower()
    # vitesse × temps → distance
    v = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:km\/h|km par heure|kmh)", ql)
    t = re.search(r"(?:pendant|durant|en)\s*(\d+(?:[.,]\d+)?)\s*(?:h\b|heures?|minutes?)", ql)
    if v and t:
        duree = _fr(t.group(1))
        if "minute" in t.group(0):
            duree = duree / 60
        res = _fr(v.group(1)) * duree
        return {"methode": "vitesse_temps", "resultat": res,
                "expression": f"{v.group(1)} km/h × {_afficher(duree)} h", "formula": "distance = vitesse × temps"}
    # prix unitaire × quantité
    pu = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:€|euros?)\s*(?:le|la|par)\s*(?:pièce|kilo|kg|litre|unité)", ql)
    qte = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:pièces?|kilos?|kg|litres?|unités?)", ql)
    if pu and qte:
        res = _fr(pu.group(1)) * _fr(qte.group(1))
        return {"methode": "prix_quantite", "resultat": res,
                "expression": f"{pu.group(1)} × {qte.group(1)}", "formula": "total = prix unitaire × quantité"}
    return None


# --------------------------------------------------------------------- API outil
def _paquet_verifie(r: dict[str, Any]) -> dict[str, Any]:
    """Enveloppe commune des résultats VERIFIED : resultat affiché + resultat_num
    pour le critic. Les notes de convention (ratio/affine) sont conservées pour
    la preuve."""
    res = r["resultat"]
    unite = r.get("unite", "")
    aff = _afficher(res) + (f" {unite}" if unite else "")
    note = f" ({r['note']})" if r.get("note") else ""
    return {
        "statut": "VERIFIED", "resultat": aff, "resultat_num": float(res),
        "expression": r["expression"], "methode": r["methode"],
        "preuve": f"calcul exact (fractions) : {r['expression']} = {aff}{note}",
    }


def resoudre(question: str) -> dict[str, Any]:
    """Résout de façon DÉTERMINISTE. Retourne statut VERIFIED + résultat, ou UNKNOWN.
    v10.9 : nombres en lettres, fractions en mots, températures affines,
    conversions par ratio, constantes triviales — et l'échec de parse donne un
    CODE de raison interne (jamais de prose technique vers l'utilisateur, N4)."""
    q = question.strip()

    # v10.8 — comptage de lettres (outil déterministe, avant toute génération)
    r_lettres = _compter_lettres(q)
    if r_lettres:
        return {
            "statut": "VERIFIED", "resultat": r_lettres["resultat"],
            "resultat_num": float(r_lettres["resultat"]),
            "expression": r_lettres["expression"], "methode": r_lettres["methode"],
            "preuve": r_lettres["preuve"],
        }

    # v10.9 (N3) — températures AFFINES d'abord (≠ ratio), puis conversions ratio,
    # constantes triviales, fractions en mots, pourcentages, problèmes types.
    for solveur in (_resoudre_temperature, _resoudre_conversion, _resoudre_constantes,
                    _resoudre_fraction_mots, _resoudre_pourcentages, _resoudre_pourcentage_de,
                    _resoudre_probleme):
        r = solveur(q)
        if r:
            return _paquet_verifie(r)

    # v10.8 — expression complète avec parenthèses : « (3+4)×5 », « -7 + -3 »
    expr = _expression_complete(q)
    if expr:
        res, raison = evaluer_expression_detaillee(expr)
        if raison == "division par zéro":
            return _division_par_zero(expr)
        if res is not None:
            return {
                "statut": "VERIFIED", "resultat": _afficher(res), "resultat_num": float(res),
                "expression": expr, "methode": "arithmetique_exacte",
                "preuve": f"calcul exact (fractions) : {expr} = {_afficher(res)}",
            }

    expr = _extraire_expression(q)
    if expr:
        res, raison = evaluer_expression_detaillee(expr)
        if raison == "division par zéro":
            return _division_par_zero(expr)
        if res is not None:
            return {
                "statut": "VERIFIED", "resultat": _afficher(res), "resultat_num": float(res),
                "expression": expr, "methode": "arithmetique_exacte",
                "preuve": f"calcul exact (fractions) : {expr} = {_afficher(res)}",
            }

    # nombres en lettres (simples ET composés) : « douze fois sept » → 12*7,
    # « vingt-cinq multiplié par quatre » → 25*4. Les mots-opérateurs AMBIGUS
    # (« plus », « moins » — fréquents en langage naturel) ne sont PAS mappés :
    # convention documentée, zéro faux calcul.
    mots = {m: str(v) for m, v in _MOTS_NOMBRES.items()}
    q2 = _normaliser_nombres_mots(q.lower())
    for mot in sorted(mots, key=len, reverse=True):
        q2 = re.sub(rf"\b{mot}\b", mots[mot], q2)
    q2 = re.sub(r"\b(?:multipli[ée]|multiplier)\s+par\b|\bfois\b", "*", q2)
    q2 = re.sub(r"\bdivis[ée]s?\s+par\b|\bsur\b", "/", q2)
    expr2 = re.search(r"(-?\d+(?:\s*[\+\-\*x×\/]\s*-?\d+)+)", q2)
    if expr2:
        res, raison = evaluer_expression_detaillee(expr2.group(1).replace("x", "*"))
        if raison == "division par zéro":
            return _division_par_zero(expr2.group(1))
        if res is not None:
            return {
                "statut": "VERIFIED", "resultat": _afficher(res), "resultat_num": float(res),
                "expression": expr2.group(1), "methode": "arithmetique_mots",
                "preuve": f"calcul exact : {expr2.group(1)} = {_afficher(res)}",
            }

    # v10.9 (N4) — échec de parse : raison = CODE INTERNE, jamais affiché.
    # Le detail_interne reste dans la trace (diagnostic), la réponse utilisateur
    # sortira par la politique de dégradation du rendu_final (hedge/inconnu).
    nombres = re.findall(r"-?\d+(?:[.,]\d+)?", q)[:6]
    return {"statut": "UNKNOWN", "raison": "STRUCTURE_NON_RECONNUE",
            "detail_interne": f"aucune structure calculable identifiée : {q[:160]}",
            "nombres_detectes": nombres}


def _division_par_zero(expr: str) -> dict[str, Any]:
    """v10.8 (Classe 3) — cas codé en dur : la division par zéro est indéfinie.
    AUCUNE place pour le LLM là-dessus (le refus « structure non reconnue »
    était pire qu'une réponse)."""
    return {
        "statut": "VERIFIED", "resultat": "indéfini (division par zéro)",
        "expression": expr, "methode": "division_par_zero",
        "preuve": (f"{expr} : la division par zéro est indéfinie en arithmétique "
                   "(aucun nombre multiplié par 0 ne donne le dividende). "
                   "Résultat déterministe, sans estimation."),
    }


def verifier_nombre(reponse: str, attendu: str | float) -> dict[str, Any]:
    """Vérifie que la réponse contient le nombre attendu (et pas un autre)."""
    nums = re.findall(r"-?\d+(?:[.,]\d+)?", reponse)
    nums = [float(n.replace(",", ".")) for n in nums]
    attendu_f = float(attendu) if not isinstance(attendu, float) else attendu
    if any(abs(n - attendu_f) < 1e-9 for n in nums):
        return {"statut": "VERIFIED", "resume": "nombre attendu présent dans la réponse"}
    if nums:
        return {"statut": "CONTRADICTED", "resume": f"nombres trouvés {nums} ≠ attendu {attendu_f}",
                "contradiction": True}
    return {"statut": "UNKNOWN", "resume": "aucun nombre dans la réponse"}
