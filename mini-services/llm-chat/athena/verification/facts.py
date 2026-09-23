"""Vérification des faits : provenance + fraîcheur.

Règle : un claim sans preuve d'outil/document n'est jamais VERIFIED.
Sortie LLM → HYPOTHESIS au mieux. Web vérifié → SUPPORTED (source + date).

v10.9 — N2 : TABLE DE FAITS STABLES (capitales) = ACCÉLÉRATEUR, jamais le
seul garde-fou. Un fait canonique (France→Paris) est injecté comme faits
vérifiés dès la question posée : le modèle, le critic et le fallback
déterministe du rendu_final peuvent l'utiliser SANS dépendre du web
(quota 429 ≠ inexistence). La garde d'entité (policies._garde_entite) reste
l'anti-fabrication pour tout ce qui n'est pas dans la table.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

MOTIFS_FACTUEL = re.compile(r"\b(qui|quel(?:le)?s?|quand|où|combien|pourquoi|le premier|la capitale|l'auteur)\b", re.IGNORECASE)


# ------------------------------------------------------------ v10.9 N2 : faits stables
# Table compacte de faits CANONIQUES stables (capitales) — accélérateur N2.
_CAPITALES = {
    "france": "Paris", "japon": "Tokyo", "australie": "Canberra", "allemagne": "Berlin",
    "italie": "Rome", "espagne": "Madrid", "portugal": "Lisbonne", "belgique": "Bruxelles",
    "suisse": "Berne", "canada": "Ottawa", "etats-unis": "Washington", "usa": "Washington",
    "royaume-uni": "Londres", "angleterre": "Londres", "chine": "Pékin", "russie": "Moscou",
    "bresil": "Brasilia", "brésil": "Brasilia", "argentine": "Buenos Aires", "mexique": "Mexico",
    "inde": "New Delhi", "egypte": "Le Caire", "égypte": "Le Caire", "maroc": "Rabat",
    "algerie": "Alger", "algérie": "Alger", "tunisie": "Tunis", "senegal": "Dakar", "sénégal": "Dakar",
    "nigeria": "Abuja", "afrique du sud": "Pretoria", "kenya": "Nairobi",
    "arabie saoudite": "Riyad", "turquie": "Ankara", "grece": "Athènes", "grèce": "Athènes",
    "pays-bas": "Amsterdam", "autriche": "Vienne", "pologne": "Varsovie", "suede": "Stockholm",
    "suède": "Stockholm", "norvege": "Oslo", "norvège": "Oslo", "danemark": "Copenhague",
    "finlande": "Helsinki", "irlande": "Dublin", "islande": "Reykjavik", "coree du sud": "Séoul",
    "corée du sud": "Séoul", "thailande": "Bangkok", "thaïlande": "Bangkok", "vietnam": "Hanoï",
    "indonesie": "Jakarta", "indonésie": "Jakarta", "nouvelle-zelande": "Wellington",
    "nouvelle-zélande": "Wellington", "ukraine": "Kyiv", "israel": "Jérusalem", "israël": "Jérusalem",
}


def _norme(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


_RE_CAPITALE = re.compile(
    r"capitale\s+(?:officielle\s+)?"
    r"(de\s+la|de\s+l['’]|du|de|d['’])\s*"
    r"([a-zà-ÿA-ZÉÈÀ\-'’]+(?:\s+[a-zà-ÿA-ZÉÈÀ\-'’]+)?)\s*\??\s*$", re.IGNORECASE)
_RE_CAPITALE_MILIEU = re.compile(
    r"capitale\s+(?:officielle\s+)?"
    r"(de\s+la|de\s+l['’]|du|de|d['’])\s*"
    r"([A-ZÉÈÀÂÎÔÛ][\wÀ-ÿ'’\-]*(?:\s+[A-ZÉÈÀÂÎÔÛ][\wÀ-ÿ'’\-]*)?)")


def fait_canonique(question: str) -> dict[str, Any] | None:
    """N2 — accélérateur : si la question demande la capitale d'un pays de la
    table, retourne un fait canonique (valeur certaine, source table). Utilisé
    par run_agent (injection) et par le fallback déterministe du rendu_final."""
    q = (question or "").strip().rstrip("?!. ")
    for motif in (_RE_CAPITALE_MILIEU, _RE_CAPITALE):
        m = motif.search(q)
        if not m:
            continue
        article = re.sub(r"\s+", " ", m.group(1).lower().strip())
        entite = m.group(2).strip().rstrip("?!. ")
        cle = _norme(entite)
        valeur = _CAPITALES.get(cle)
        if valeur is None:
            continue
        joint = "" if article.endswith("'") else " "
        return {
            "contenu": f"La capitale {article}{joint}{entite} est {valeur}.",
            "entite": entite, "attribut": "capitale", "valeur": valeur,
            "source": "table_faits_stables", "confiance": 0.95, "verifie": True,
        }
    return None


def entite_canonique(entite: str) -> str | None:
    """Valeur canonique de l'entité (capitale) si elle est dans la table —
    utilisé par la garde d'entité tri-state : fait canonique présent → la garde
    ne bloque pas (l'entité existe au sens canonique)."""
    return _CAPITALES.get(_norme(entite))


def est_factuel(question: str) -> bool:
    return bool(MOTIFS_FACTUEL.search(question))


def verifier_claims_llm(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Applique la règle de provenance : LLM sans preuve → HYPOTHESIS (jamais fait)."""
    sortis = []
    for c in claims:
        preuves = c.get("preuves") or []
        source = c.get("source") or ""
        if preuves or (source and source not in ("llm", "")):
            statut = c.get("statut") if c.get("statut") in ("VERIFIED", "SUPPORTED", "DISPROVED", "CONTRADICTED") else "SUPPORTED"
        else:
            statut = "HYPOTHESIS"
        sortis.append({**c, "statut": statut,
                       "note": "claim LLM sans preuve d'outil → hypothèse (confiance ≠ vérité)" if statut == "HYPOTHESIS" else "preuves présentes"})
    return sortis


def horodater_web(resultats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ajoute retrieved_at + fraîcheur : mémoire ≠ vérité, le web daté ≠ web frais."""
    maintenant = datetime.now(timezone.utc).isoformat()
    for r in resultats:
        r["retrieved_at"] = maintenant
        extrait = (r.get("extrait") or "") + " " + (r.get("titre") or "")
        annee = re.search(r"\b(20\d{2})\b", extrait)
        r["frais"] = "inconnu" if not annee else ("récent" if int(annee.group(1)) >= 2024 else f"daté {annee.group(1)}")
    return resultats
