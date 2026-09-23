"""La VOIX — v10.9.1 : couche de sortie HUMAINE ET DIVERSE (global, modulaire).

PROBLÈME v10.9.0 (retour utilisateur) : tous les crans du ladder sortaient le
MÊME moule robotique, phrase mot pour mot (« Sur « hello », voici où j'en
suis. Ce qui manque pour aller plus loin : la précision attendue… »).

SOLUTION STRUCTURELLE (aucune règle au cas par cas « si salutation alors ») :
  classe terminale (décidée par le ladder de rendu_final)
      → POOL de formulations (≥ 8 variantes de fond ET de ton par classe)
      → DÉDUP STRUCTUREL (empreinte-squelette vs N dernières réponses)
      → STYLE (longueur calibrée sur la question, contenu d'abord,
        méta seulement si utile, jamais de nombrilisme pipeline).

MÉCANISME (couvre N'IMPORTE QUELLE question par la même mécanique) :
  1. calibrer(question) → échelle (micro/courte/standard) + langue (fr/en)
     — PUR signal générique : longueur + marqueurs interrogatifs, PAS un
     lexique « salutation » de cas par cas.
  2. realiser_*(...) → tire une VARIANTE du pool de la classe, contrainte
     par l'échelle ; chaque variante est une réalisation linguistique
     différente (directe, légère, pédagogique, concise…).
  3. empreinte(texte) → squelette (tokens de contenu + bigrammes + longueur)
     ; similarite() ≥ 0.6 avec l'une des N dernières réponses → la variante
     est REJETÉE et on en tire une autre (jusqu'à épuisement : la moins
     similaire gagne).
  4. memoriser(texte) → l'empreinte de TOUTE réponse finale rejoint
     l'historique (fenêtre glissante) — le dédup est GLOBAL, pas par classe.

INTERDITS CANARI (formules usées) : « voici où j'en suis », « détail
vérifiable », « plutôt que d'inventer », « je reprends la recherche », « état
exact de ce que je sais » — bannis de tous les pools (canari.violations,
tolérance zéro CI) et remplacés par des tournures variées.

INVARIANTS CONSERVÉS : rendu_final reste l'unique point de sortie ; les
pools ne décident RIEN de la POLITIQUE (le ladder a→d choisit la classe) ;
les verrous inconnu substantiel / edge_injection / math_long / anaphore
Troie restent intacts (le contenu substantiel est fourni, seule la
RÉALISATION varie).
"""
from __future__ import annotations

import hashlib
import random
import re
import unicodedata
from collections import deque
from typing import Any, Callable

# =====================================================================
# 1) CALIBRAGE — longueur adaptée à la question + langue (générique)
# =====================================================================
_MARQUEUR_QUESTION = re.compile(
    r"\?|^\s*(?:qu(?:e|'|elle|elles|oi)|comment|pourquoi|qui|où|quand|combien|"
    r"quel(?:le|s)?|est[- ]ce|peux[- ]tu|pouvez[- ]vous|explique|d[eé]finis|"
    r"traduis|calcule|r[eé]sous|donne(?:z)?(?:[- ]moi)?)\b", re.IGNORECASE)
_MARQUEUR_QUESTION_EN = re.compile(
    r"\?|^\s*(?:what|how|why|who|where|when|which|explain|define|compute|"
    r"solve|tell\s+me|give\s+me|do\s+you|can\s+you)\b", re.IGNORECASE)

_MOTS_FR = re.compile(
    r"\b(?:le|la|les|un|une|des|du|de|et|ou|est|sont|je|tu|il|elle|nous|vous|"
    r"pour|avec|dans|sur|pas|plus|que|qui|quoi|comment|pourquoi|bonjour|salut|"
    r"merci|au\s+revoir|combien|quel|quelle|peux|pouvez|aide|ça)\b",
    re.IGNORECASE)
_MOTS_EN = re.compile(
    r"\b(?:the|a|an|is|are|and|or|for|with|on|in|not|what|how|why|who|where|"
    r"when|hello|hi|hey|thanks|thank\s+you|please|help|can|could|you|your|"
    r"give|tell|explain|goodbye|bye)\b", re.IGNORECASE)

# fenêtre de dédup : les N dernières empreintes de réponses finales
_FENETRE_DEDUP = 8
_SEUIL_SIMILARITE = 0.60

_HISTORIQUE: deque[dict[str, Any]] = deque(maxlen=_FENETRE_DEDUP)


def langue_de(question: str) -> str:
    """« fr » | « en » — signal lexical brut (pas une règle métier)."""
    q = question or ""
    nf, ne = len(_MOTS_FR.findall(q)), len(_MOTS_EN.findall(q))
    if ne > nf and ne >= 1:
        return "en"
    return "fr"


def calibrer(question: str) -> dict[str, str]:
    """Échelle de longueur — signal GÉNÉRIQUE (longueur + marqueurs), jamais
    un lexique de cas par cas :
      - micro    : quasi pas de question (≤ 3 mots, aucun marqueur
                   interrogatif) → 1–2 phrases ;
      - courte   : question factuelle brève → réponse resserrée ;
      - standard : explication, raisonnement → développement normal.
    La même mécanique s'applique à « hello », « merci », « 2+2 », « Paris ? »
    comme à une question composée — rien n'est spécial-casé."""
    q = (question or "").strip()
    mots = re.findall(r"[\w'’À-ÿ]+", q)
    n = len(mots)
    marqueur = bool(_MARQUEUR_QUESTION.search(q) or _MARQUEUR_QUESTION_EN.search(q))
    if n <= 3 and not marqueur:
        echelle = "micro"
    elif n <= 6 and not marqueur:
        echelle = "courte"
    elif not marqueur and n <= 8:
        echelle = "courte"
    else:
        echelle = "standard"
    return {"echelle": echelle, "langue": langue_de(q)}


# =====================================================================
# 2) EMPREINTE SQUELLETTE + SIMILARITÉ (dédup STRUCTUREL, pas de mots)
# =====================================================================
_MOTS_VIDES = frozenset(
    "le la les un une des de du au aux et ou est sont sera etre avoir a ont "
    "je tu il elle on nous vous ils elles ce cet cette ces son sa ses leur "
    "leurs pour par avec dans sur sous pas plus moins que qui quoi ne me te "
    "se y en the a an is are and or for with on in not to of it this that "
    "you your my me at as be been was were will would can could should "
    "there here very just so if then aussi tres tout toute tous toutes "
    "mais donc or ni car comme".split())


def _normaliser(texte: str) -> list[str]:
    t = unicodedata.normalize("NFKD", (texte or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[*#`>_~|\[\]()«»\"']", " ", t)
    return re.findall(r"[a-z0-9]+", t)


def empreinte(texte: str) -> dict[str, Any]:
    """Squelette de la réponse : tokens de contenu (sans mots vides),
    bigrammes de contenu et seau de longueur. Deux réponses du même FOND
    mais de formulation différente ont des empreintes voisines mais sous le
    seuil dès que la tournure change ; deux réponses du même MOULE (même
    phrase) tombent ≥ seuil."""
    toks = _normaliser(texte)
    contenu = [t for t in toks if t not in _MOTS_VIDES and (len(t) >= 3 or t.isdigit())]
    squelette = frozenset(contenu)
    bigrammes = frozenset(zip(contenu, contenu[1:]))
    n = len(texte or "")
    longueur = ("micro" if n < 120 else "court" if n < 340
                else "moyen" if n < 900 else "long")
    return {"squelette": squelette, "bigrammes": bigrammes, "longueur": longueur}


def similarite(e1: dict[str, Any], e2: dict[str, Any]) -> float:
    """0.55 squelette (Jaccard) + 0.25 bigrammes + 0.20 longueur."""
    def j(a: frozenset, b: frozenset) -> float:
        if not a and not b:
            return 1.0
        if not a or not b:
            return 0.0
        return len(a & b) / len(a | b)
    s = 0.55 * j(e1["squelette"], e2["squelette"]) \
        + 0.25 * j(e1["bigrammes"], e2["bigrammes"])
    s += 0.20 * (1.0 if e1["longueur"] == e2["longueur"] else 0.0)
    return round(min(s, 1.0), 3)


def _trop_proche(emp: dict[str, Any]) -> bool:
    return any(similarite(emp, h["empreinte"]) >= _SEUIL_SIMILARITE for h in _HISTORIQUE)


def memoriser(texte: str, variante: str = "", classe: str = "") -> None:
    """Toute réponse FINALE rejoint la fenêtre de dédup (global)."""
    if not (texte or "").strip():
        return
    _HISTORIQUE.append({"empreinte": empreinte(texte), "variante": variante,
                        "classe": classe, "extrait": texte[:120]})


def reinitialiser() -> None:
    """Reset de la fenêtre (tests)."""
    _HISTORIQUE.clear()


def etat_historique() -> list[dict[str, Any]]:
    """Télémétrie : dernières empreintes (debug diversité)."""
    return [{"variante": h["variante"], "classe": h["classe"],
             "extrait": h["extrait"]} for h in _HISTORIQUE]


# =====================================================================
# 3) POOLS DE FORMULATIONS — ≥ 8 variantes de fond ET de ton par classe
# =====================================================================
VariantFn = Callable[..., str]

# ------------------------------------------------------------- outillée
# Le résultat VERIFIED est l'autorité ; seule la RÉALISATION varie.
def _outillee_directe(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return f"**{res}**\n\n{preuve}"


def _outillee_resultat(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    corps = f"Calcul : {expression} = **{res}**." if expression else preuve
    return f"Résultat : **{res}**.\n\n{corps}"


def _outillee_legere(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return f"Ça fait **{res}**.\n\n{preuve}"


def _outillee_pedagogique(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return f"La réponse est **{res}**.\n\nDétail du calcul : {preuve}"


def _outillee_concise(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return f"**{res}** ({preuve})"


def _outillee_reponse(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return f"Réponse : **{res}**.\n\n{preuve}"


def _outillee_confirmation(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return f"**{res}** — vérifié au calcul exact.\n\n{preuve}"


def _outillee_breve(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return f"**{res}**, tout simplement.\n\n{preuve}"


def _outillee_reduction(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return (f"**{res}** — le prix après réduction.\n\n"
            f"Calcul exact : {expression} = **{res}**.")


def _outillee_reduction_legere(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return f"Avec la réduction, vous payez **{res}**.\n\n{preuve}"


def _outillee_reduction_pedagogique(res: str, preuve: str, expression: str = "", **_: Any) -> str:
    return (f"Résultat : **{res}**.\n\nVoici le calcul : {expression} = **{res}** "
            "(montant final à payer).")


POOL_OUTILLEE: list[tuple[str, VariantFn]] = [
    ("outillee_directe", _outillee_directe),
    ("outillee_resultat", _outillee_resultat),
    ("outillee_legere", _outillee_legere),
    ("outillee_pedagogique", _outillee_pedagogique),
    ("outillee_concise", _outillee_concise),
    ("outillee_reponse", _outillee_reponse),
    ("outillee_confirmation", _outillee_confirmation),
    ("outillee_breve", _outillee_breve),
]
POOL_OUTILLEE_REDUCTION: list[tuple[str, VariantFn]] = [
    ("outillee_reduction", _outillee_reduction),
    ("outillee_reduction_legere", _outillee_reduction_legere),
    ("outillee_reduction_pedagogique", _outillee_reduction_pedagogique),
    ("outillee_legere", _outillee_legere),
    ("outillee_reponse", _outillee_reponse),
    ("outillee_directe", _outillee_directe),
    ("outillee_concise", _outillee_concise),
    ("outillee_breve", _outillee_breve),
]

# ----------------------------------------------------------------- hedge (c)
# Même contenu hedgé, préfixe et marque VARIÉS — plus jamais le même moule.
PREFIXES_HEGEE_FR = [
    "D'après ce que je sais :",
    "De mémoire :",
    "Ce que j'avancerais, sans garantie :",
    "Voici ce que je crois savoir :",
    "Sous toutes réserves :",
    "Ce n'est pas vérifié, mais voici l'idée :",
    "À prendre avec prudence :",
    "D'instinct, je dirais :",
    "Autant que je m'en souvienne :",
]
PREFIXES_HEGEE_EN = [
    "From what I know:",
    "Off the top of my head:",
    "Take it with a grain of salt:",
    "As far as I remember:",
    "Not verified, but here's the idea:",
]
_MARQUES_HEGEE = ["(à vérifier)", "(non vérifié)", "(à confirmer)", "*(à vérifier)*"]
_NOTES_HEGEE = [
    "*(issu de mes connaissances générales, sans source vérifiée)*",
    "*(de mémoire — les détails restent à confirmer)*",
    "",
]

# -------------------------------------------------- inconnu honnête (d)
# Chaque variante assemble le MÊME contenu substantiel (savoir + état de
# recherche + manque + alternative + SUJET) dans une réalisation différente
# — contenu d'abord, méta après, jamais deux fois la même tournure. Le sujet
# reste ANCRÉ dans chaque variante (la réponse doit toujours dire DE QUOI
# elle parle). `etat` (état réel de la recherche) est rendu SÉPARÉMENT du
# savoir : consulter des outils n'est pas « savoir ».
def _inconnu_direct(savoir: str, manque: str, alternative: str,
                    sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = []
    if savoir:
        parties.append(savoir)
    if etat:
        parties.append("État de la recherche : " + etat.replace("• ", "").strip())
    parties.append(f"Sur « {sujet} », je n'ai rien de fiable à ajouter"
                   + ((f" : {manque}") if manque else "") + ".")
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


def _inconnu_legere(savoir: str, manque: str, alternative: str,
                    sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = []
    if savoir:
        parties.append("Ce que j'ai sous la main :\n" + savoir)
    parties.append(f"Pour « {sujet} », je sèche honnêtement pour le reste"
                   + (f" — il me faudrait {manque}" if manque else "") + ".")
    if etat:
        parties.append("(" + etat.replace("• ", "").strip() + ")")
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


def _inconnu_pedagogique(savoir: str, manque: str, alternative: str,
                         sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = [f"Votre question porte sur « {sujet} »."]
    if savoir:
        parties.append("Voici ce dont je suis raisonnablement sûr :\n" + savoir)
    parties.append("Pour conclure, il faudrait " + (manque or "un élément que je n'ai pas") + ".")
    if etat:
        parties.append("Recherches menées : " + etat.replace("• ", "").strip())
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


def _inconnu_concise(savoir: str, manque: str, alternative: str,
                     sujet: str = "", etat: str = "", **_: Any) -> str:
    t = (savoir + "\n" if savoir else "")
    t += f"Sur « {sujet} », je n'ai rien de fiable de plus"
    if manque:
        t += f" ({manque})"
    t += "."
    if etat:
        t += "\n" + etat
    if alternative:
        t += "\n\n" + alternative
    return t


def _inconnu_franc(savoir: str, manque: str, alternative: str,
                   sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = []
    if savoir:
        parties.append(savoir)
    parties.append(f"Je préfère vous le dire tel quel : sur « {sujet} », "
                   "je n'ai pas d'élément fiable"
                   + (f" — {manque}" if manque else "") + ".")
    if etat:
        parties.append(etat.replace("• ", "— ").strip())
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


def _inconnu_poids(savoir: str, manque: str, alternative: str,
                   sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = []
    if savoir:
        parties.append("Point sûr : " + savoir.replace("\n• ", " ; ").replace("• ", ""))
    parties.append(f"Ce qui bloque pour « {sujet} » : "
                   + (manque or "je n'ai pas de source exploitable sur ce point")
                   + ". C'est, honnêtement, tout ce que je peux en dire pour l'instant.")
    if etat:
        parties.append(etat.replace("• ", "— ").strip())
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


def _inconnu_doux(savoir: str, manque: str, alternative: str,
                  sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = []
    if savoir:
        parties.append(savoir)
    parties.append(f"Bonne question sur « {sujet} » — et je n'ai pas mieux que "
                   "l'honnêteté : je ne sais pas, "
                   + (manque or "faute d'élément fiable") + ".")
    if etat:
        parties.append("(" + etat.replace("• ", "").strip() + ")")
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


def _inconnu_minimal(savoir: str, manque: str, alternative: str,
                     sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = [savoir] if savoir else []
    t = f"Sur « {sujet} » : rien de fiable de plus de mon côté"
    if manque:
        t += f" ({manque})"
    parties.append(t + ".")
    if etat:
        parties.append(etat)
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


def _inconnu_ouvert(savoir: str, manque: str, alternative: str,
                    sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = []
    if savoir:
        parties.append(savoir)
    parties.append(f"Si vous pouvez m'apporter " + (manque or "un élément de contexte")
                   + f" sur « {sujet} », je creuse avec ça.")
    if etat:
        parties.append("(" + etat.replace("• ", "").strip() + ")")
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


def _inconnu_en(savoir: str, manque: str, alternative: str,
                sujet: str = "", etat: str = "", **_: Any) -> str:
    parties = []
    if savoir:
        parties.append(savoir)
    if etat:
        parties.append("Research status: " + etat.replace("• ", "").strip())
    parties.append(f"About “{sujet}”, beyond that I honestly don't have anything reliable"
                   + (f" — {manque}" if manque else "") + ".")
    if alternative:
        parties.append(alternative)
    return "\n\n".join(parties)


POOL_INCONNU: list[tuple[str, VariantFn]] = [
    ("inconnu_direct", _inconnu_direct),
    ("inconnu_legere", _inconnu_legere),
    ("inconnu_pedagogique", _inconnu_pedagogique),
    ("inconnu_concise", _inconnu_concise),
    ("inconnu_franc", _inconnu_franc),
    ("inconnu_poids", _inconnu_poids),
    ("inconnu_doux", _inconnu_doux),
    ("inconnu_minimal", _inconnu_minimal),
    ("inconnu_ouvert", _inconnu_ouvert),
]
POOL_INCONNU_EN: list[tuple[str, VariantFn]] = [
    ("inconnu_en", _inconnu_en),
    ("inconnu_direct", _inconnu_direct),
    ("inconnu_franc", _inconnu_franc),
    ("inconnu_concise", _inconnu_concise),
]

# ------------------------------------------------------------- politique (a)
# Refus SUBSTANTIEL (raison + alternative) — la réalisation varie, le fond non.
def _politique_ferme(raison: str, alternative: str = "", **_: Any) -> str:
    t = f"Je ne peux pas le faire : {raison}."
    if alternative:
        t += f"\n\n{alternative}"
    return t


def _politique_explique(raison: str, alternative: str = "", **_: Any) -> str:
    t = f"Là, c'est non — et voici pourquoi : {raison}."
    if alternative:
        t += f"\n\n{alternative}"
    return t


def _politique_clair(raison: str, alternative: str = "", **_: Any) -> str:
    t = (raison[0].upper() + raison[1:] if raison else "Je ne peux pas le faire")
    t += " — je reste donc dans le cadre."
    if alternative:
        t += f"\n\n{alternative}"
    return t


def _politique_doux(raison: str, alternative: str = "", **_: Any) -> str:
    t = f"Je ne peux pas accéder à cette demande : {raison}."
    if alternative:
        t += f"\n\n{alternative}"
    return t


def _politique_direct(raison: str, alternative: str = "", **_: Any) -> str:
    t = f"Non, et voici la raison : {raison}."
    if alternative:
        t += f"\n\n{alternative}"
    return t


def _politique_pedagogique(raison: str, alternative: str = "", **_: Any) -> str:
    t = f"Petit point de cadre : {raison} Je ne peux donc pas suivre cette demande."
    if alternative:
        t += f"\n\n{alternative}"
    return t


def _politique_sobre(raison: str, alternative: str = "", **_: Any) -> str:
    t = f"Cette demande, je ne peux pas la satisfaire — {raison}."
    if alternative:
        t += f"\n\n{alternative}"
    return t


def _politique_engage(raison: str, alternative: str = "", **_: Any) -> str:
    t = f"Ma réponse est non, voici pourquoi : {raison}."
    if alternative:
        t += f"\n\n{alternative}"
    return t


POOL_POLITIQUE: list[tuple[str, VariantFn]] = [
    ("politique_ferme", _politique_ferme),
    ("politique_explique", _politique_explique),
    ("politique_clair", _politique_clair),
    ("politique_doux", _politique_doux),
    ("politique_direct", _politique_direct),
    ("politique_pedagogique", _politique_pedagogique),
    ("politique_sobre", _politique_sobre),
    ("politique_engage", _politique_engage),
]

# ----------------------------------------------------- conversationnelle
# Micro-social (accueil / gratitude / congé) — court, chaud, varié.
# L'indexation accueil/gratitude/congé est un INDEX DE POOL (le contenu doit
# coller au geste social), pas un cas particulier de comportement.
POOL_ACCUEIL_FR = [
    "Salut ! Comment puis-je vous aider ?",
    "Bonjour ! Qu'est-ce qui vous amène ?",
    "Hey, bonjour ! Une question, un souci, une idée à creuser ?",
    "Bonjour à vous ! Dites-moi tout.",
    "Salut ! Je vous écoute.",
    "Bonjour ! De quoi voulez-vous parler aujourd'hui ?",
    "Hello ! Ravi de vous voir — que puis-je faire pour vous ?",
    "Coucou ! Posez votre question, je m'en occupe.",
    "Bonjour ! Je suis là, allez-y.",
]
POOL_ACCUEIL_EN = [
    "Hi there! How can I help?",
    "Hello! What can I do for you today?",
    "Hey! Got a question? Fire away.",
    "Hi! Happy to help — what do you need?",
    "Hello there! What's on your mind?",
    "Hey, welcome! Ask me anything.",
    "Hi! What brings you here?",
    "Hello! I'm all ears.",
]
POOL_GRATITUDE_FR = [
    "Avec plaisir !",
    "Je vous en prie !",
    "Pas de souci — ravi d'avoir aidé.",
    "Content que ça vous serve !",
    "De rien ! Revenez quand vous voulez.",
    "Ça me fait plaisir. Autre chose ?",
    "Service ! N'hésitez pas si besoin.",
    "Avec joie — je reste dispo si vous avez autre chose.",
]
POOL_GRATITUDE_EN = [
    "You're welcome!",
    "Happy to help!",
    "Anytime!",
    "No worries — glad it helped.",
    "My pleasure. Anything else?",
    "Sure thing!",
    "Glad I could help — come back anytime.",
    "You're very welcome!",
]
POOL_CONGE_FR = [
    "À bientôt !",
    "Au revoir, et à la prochaine !",
    "Bonne continuation — je reste ici si besoin.",
    "À très vite !",
    "Prenez soin de vous, à bientôt !",
    "Au plaisir !",
    "Salut, à la prochaine fois !",
    "Bye, à bientôt !",
]
POOL_CONGE_EN = [
    "See you soon!",
    "Goodbye — come back anytime!",
    "Take care!",
    "Catch you later!",
    "Bye! I'll be here if you need me.",
    "Have a great one!",
    "See ya!",
    "Goodbye for now!",
]


SALUTATIONS = {"bonjour", "salut", "hello", "hi", "bonsoir", "hey", "coucou",
               "yo", "bonne", "journee", "soiree", "morning", "evening"}


def _pool_social(question: str, langue: str) -> list[tuple[str, str]]:
    """Index de pool social : accueil / gratitude / congé (FR ou EN).
    v10.9.2 : un geste social exige un SIGNAL POSITIF (gratitude, congé OU
    accueil détecté) — l'accueil n'est plus le défaut de tout le reste : une
    question mono-mot sans marque sociale (« Atlantide ») ne doit PAS recevoir
    un « Bonjour ! » (elle continue l'échelle (c)→(d) qui lui revient)."""
    toks = set(_normaliser(question))
    if toks & {"merci", "thanks", "thank", "thx"}:
        pool = POOL_GRATITUDE_EN if langue == "en" else POOL_GRATITUDE_FR
        return [(f"gratitude_{i}", v) for i, v in enumerate(pool)]
    if toks & {"revoir", "bye", "goodbye", "aurevoir", "ciao", "adieu", "later"}:
        pool = POOL_CONGE_EN if langue == "en" else POOL_CONGE_FR
        return [(f"conge_{i}", v) for i, v in enumerate(pool)]
    if toks & SALUTATIONS:
        pool = POOL_ACCUEIL_EN if langue == "en" else POOL_ACCUEIL_FR
        return [(f"accueil_{i}", v) for i, v in enumerate(pool)]
    return []  # aucun geste social détecté → PAS de cran social


# =====================================================================
# 4) SÉLECTION AVEC DÉDUP — jamais la même variante deux fois de suite
# =====================================================================
_DERNIERE_VARIANTE: dict[str, str] = {}


def _tirer(pool: list[tuple[str, Any]], executer: Callable[[Any], str],
           cle_dedup: str = "") -> tuple[str, str]:
    """Tire une variante du pool : jamais deux fois de suite la même ;
    rejette toute réalisation dont l'empreinte est ≥ seuil avec l'une des N
    dernières réponses finales ; à épuisement, garde la moins similaire.
    `pool` : liste de (nom, payload) — payload = fonction OU donnée ; la
    fonction `executer(payload)` produit le texte."""
    if not pool:
        return "", ""
    cle = cle_dedup or str(pool[0][0]).split("_")[0]
    indices = list(range(len(pool)))
    derniere = _DERNIERE_VARIANTE.get(cle)
    if derniere and len(pool) > 1:
        indices = [i for i in indices if pool[i][0] != derniere] or indices
    random.shuffle(indices)

    meilleur: tuple[float, str, str] | None = None  # (sim, texte, nom)
    for i in indices:
        nom, payload = pool[i]
        try:
            texte = executer(payload)
        except Exception:
            continue
        if not texte.strip():
            continue
        emp = empreinte(texte)
        if not _trop_proche(emp):
            _DERNIERE_VARIANTE[cle] = nom
            return texte, nom
        sim = max((similarite(emp, h["empreinte"]) for h in _HISTORIQUE), default=0.0)
        if meilleur is None or sim < meilleur[0]:
            meilleur = (sim, texte, nom)
    if meilleur:
        _DERNIERE_VARIANTE[cle] = meilleur[2]
        return meilleur[1], meilleur[2]
    return "", ""


# =====================================================================
# 5) API DE RÉALISATION — appelée UNIQUEMENT par rendu_final (policies)
# =====================================================================
def realiser_outillee(resultat: str, preuve: str, expression: str = "",
                      reduction: bool = False) -> tuple[str, str]:
    """Framing d'un résultat VERIFIED — fond fixe, formulation variable."""
    pool = POOL_OUTILLEE_REDUCTION if reduction else POOL_OUTILLEE

    def executer(fn: VariantFn) -> str:
        return fn(resultat, preuve, expression=expression)

    return _tirer(pool, executer, cle_dedup="outillee")


def realiser_hedge(contenu: str, langue: str = "fr") -> tuple[str, str]:
    """(c) — préfixe + marque + note VARIÉS autour du contenu hedgé."""
    prefixes = PREFIXES_HEGEE_EN if langue == "en" else PREFIXES_HEGEE_FR

    def executer(_: Any) -> str:
        prefixe = random.choice(prefixes)
        note = random.choice(_NOTES_HEGEE)
        corps = contenu.strip()
        t = f"{prefixe} {corps}"
        # un SEUL marque d'incertitude : si le contenu en porte déjà un
        # (modèle), on n'en rajoute pas — sinon tirage varié.
        if not re.search(r"\(?\*?\s*[àa]\s+v[ée]rifier|non\s+v[ée]rifi[ée]|[àa]\s+confirmer", t, re.IGNORECASE):
            t += f" {random.choice(_MARQUES_HEGEE)}"
        if note and note not in t:
            t += f"\n\n{note}"
        return t

    return _tirer([("hedge", "")], executer, cle_dedup="hedge")


def realiser_inconnu(*, savoir: str, manque: str, alternative: str,
                     sujet: str = "", etat: str = "", langue: str = "fr") -> tuple[str, str]:
    """(d) — inconnu honnête SUBSTANTIEL, réalisation variée (contenu d'abord,
    sujet ancré dans chaque variante ; état de recherche rendu séparément)."""
    pool = POOL_INCONNU_EN if langue == "en" else POOL_INCONNU
    return _tirer(pool, lambda fn: fn(savoir=savoir, manque=manque,
                                      alternative=alternative, sujet=sujet,
                                      etat=etat),
                  cle_dedup="inconnu")


# ------------------------------------------------- fait canonique direct (N2)
# Un fait stable CANONIQUE (capitale…) qui répond à la question est une
# AUTORITÉ — la réponse est le fait lui-même, directe et courte, réalisée
# par un pool varié (jamais un cadre « inconnu » pour un fait connu).
def _nu(f: str) -> str:
    """Fait sans point final ni majuscule d'attaque (pour l'incrustation)."""
    f = (f or "").strip().rstrip(".")
    return f[0].lower() + f[1:] if f else f


def _fait_brut(f: str, **_: Any) -> str:
    return f


def _fait_reponse(f: str, **_: Any) -> str:
    return f"Réponse : {_nu(f)}."


def _fait_sans_recherche(f: str, **_: Any) -> str:
    return f"Sans même avoir à chercher : {_nu(f)}."


def _fait_directe(f: str, **_: Any) -> str:
    return f"C'est établi : {_nu(f)}."


def _fait_breve(f: str, **_: Any) -> str:
    return f"{f} C'est un fait établi."


def _fait_simple(f: str, **_: Any) -> str:
    return f"Simple : {_nu(f)}."


def _fait_assure(f: str, **_: Any) -> str:
    return f"{f[0].upper() + f[1:] if f else f} — là, je suis sûr."


POOL_FAIT_DIRECT: list[tuple[str, VariantFn]] = [
    ("fait_brut", _fait_brut),
    ("fait_reponse", _fait_reponse),
    ("fait_sans_recherche", _fait_sans_recherche),
    ("fait_directe", _fait_directe),
    ("fait_breve", _fait_breve),
    ("fait_simple", _fait_simple),
    ("fait_assure", _fait_assure),
]


def realiser_fait_direct(contenu: str) -> tuple[str, str]:
    """Fait canonique qui répond directement — court, sûr, varié."""
    f = (contenu or "").strip()
    return _tirer(POOL_FAIT_DIRECT, lambda fn: fn(f), cle_dedup="fait_direct")


def realiser_politique(raison: str, alternative: str = "") -> tuple[str, str]:
    """(a) — refus de politique SUBSTANTIEL (raison + alternative), varié."""
    return _tirer(POOL_POLITIQUE, lambda fn: fn(raison=raison, alternative=alternative),
                  cle_dedup="politique")


def realiser_conversationnelle(question: str) -> tuple[str, str]:
    """Micro-social — accueil/gratitude/congé, FR ou EN, 1–2 phrases.
    Retourne ("", "") si AUCUN geste social n'est détecté (le cran (b'')
    doit alors être sauté — v10.9.2)."""
    langue = langue_de(question)
    pool = _pool_social(question, langue)
    if not pool:
        return "", ""
    texte, nom = _tirer(pool, lambda v: v, cle_dedup="conversationnelle")
    if not texte:  # filet : première entrée du pool
        texte, nom = pool[0][1], pool[0][0]
    return texte, nom


def matrix_similarite(textes: list[str]) -> list[list[float]]:
    """Matrice de similarité squelette (éval diversité)."""
    emps = [empreinte(t) for t in textes]
    return [[similarite(a, b) for b in emps] for a in emps]


def signature(texte: str) -> str:
    """Signature compacte et stable du squelette (télémétrie diversité)."""
    emp = empreinte(texte)
    base = " ".join(sorted(emp["squelette"])) + f"|{emp['longueur']}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:12]


# ===================================================== pools outillés dédiés
# CODE / LINGUISTIQUE / DEVINETTE VERIFIED : mêmes sous-pools « outillée »,
# réalisations spécifiques (≥ 4 variantes chacun).
def _code_affiche(c: dict, **_: Any) -> str:
    return (f"Ce code affiche :\n\n```\n{c['sortie']}\n```\n\n"
            f"Vérification : {c.get('croisement', 'simulation AST')} "
            f"({c.get('pas', '?')} pas simulés).")


def _code_sortie(c: dict, **_: Any) -> str:
    return (f"Sortie du programme :\n```\n{c['sortie']}\n```\n"
            f"({c.get('croisement', 'simulation AST')} — {c.get('pas', '?')} pas simulés)")


def _code_resultat(c: dict, **_: Any) -> str:
    return (f"**{c['sortie']}**\n\nVérifié par {c.get('croisement', 'simulation AST')} "
            f"sur {c.get('pas', '?')} pas de simulation.")


def _code_execution(c: dict, **_: Any) -> str:
    return (f"Résultat de l'exécution :\n```\n{c['sortie']}\n```\n\n"
            f"{c.get('croisement', 'simulation AST')} — {c.get('pas', '?')} pas simulés.")


POOL_CODE: list[tuple[str, VariantFn]] = [
    ("code_affiche", _code_affiche),
    ("code_sortie", _code_sortie),
    ("code_resultat", _code_resultat),
    ("code_execution", _code_execution),
]


def _ling_directe(c: dict, **_: Any) -> str:
    juge = "Oui — la phrase est correcte." if c["correcte"] else "Non — la phrase est incorrecte."
    t = f"**{juge}**\n\n- Règle : {c['regle']}\n- {c['explication']}"
    if not c["correcte"] and c.get("correction"):
        t += f"\n- Forme attendue : « {c['forme_attendue']} » → correction : {c['correction']}"
    return t


def _ling_sobre(c: dict, **_: Any) -> str:
    # v10.9.2 : verdict TOUJOURS explicite (« oui/non » + « correcte/incorrecte »)
    # — un verdict sobre reste sans ambiguïté pour un lecteur comme pour un juge.
    juge = "Oui — correcte." if c["correcte"] else "Non — incorrecte."
    t = f"**{juge}**\n\nRègle appliquée : {c['regle']}\n{c['explication']}"
    if not c["correcte"] and c.get("correction"):
        t += f"\nForme attendue : « {c['forme_attendue']} » → {c['correction']}"
    return t


def _ling_pedagogique(c: dict, **_: Any) -> str:
    t = ("Oui : la phrase est correcte." if c["correcte"]
         else "Non, la phrase n'est pas correcte.")
    t += f"\n\nPourquoi : {c['explication']}\nRègle de référence : {c['regle']}"
    if not c["correcte"] and c.get("correction"):
        t += f"\nOn attend : « {c['forme_attendue']} », soit « {c['correction']} »"
    return t


def _ling_legere(c: dict, **_: Any) -> str:
    t = ("Oui, rien à redire : la phrase est correcte !" if c["correcte"]
         else "Là, il y a une faute : la phrase est incorrecte.")
    t += f"\n\n{c['explication']} ({c['regle']})"
    if not c["correcte"] and c.get("correction"):
        t += f"\nCorrection : {c['correction']}"
    return t


POOL_LINGUISTIQUE: list[tuple[str, VariantFn]] = [
    ("ling_directe", _ling_directe),
    ("ling_sobre", _ling_sobre),
    ("ling_pedagogique", _ling_pedagogique),
    ("ling_legere", _ling_legere),
]


def _devinette_directe(c: dict, **_: Any) -> str:
    return (f"**{c['courte']}** — {c['justification']}\n\n"
            f"*Source : {c['source']} (réponse canonique).*")


def _devinette_legere(c: dict, **_: Any) -> str:
    return (f"C'est **{c['courte']}** !\n\n{c['justification']}\n\n"
            f"*Source : {c['source']}.*")


def _devinette_pedagogique(c: dict, **_: Any) -> str:
    return (f"Réponse : **{c['courte']}**.\n\nLe raisonnement : {c['justification']}\n\n"
            f"*Source : {c['source']} (réponse canonique).*")


def _devinette_breve(c: dict, **_: Any) -> str:
    return (f"**{c['courte']}** ({c['justification']} — {c['source']}).")


POOL_DEVINETTE: list[tuple[str, VariantFn]] = [
    ("devinette_directe", _devinette_directe),
    ("devinette_legere", _devinette_legere),
    ("devinette_pedagogique", _devinette_pedagogique),
    ("devinette_breve", _devinette_breve),
]


def realiser_code(sortie: str, croisement: str = "simulation AST",
                  pas: Any = "?") -> tuple[str, str]:
    ctx = {"sortie": sortie, "croisement": croisement, "pas": pas}
    return _tirer(POOL_CODE, lambda fn: fn(ctx), cle_dedup="code")


def realiser_linguistique(*, correcte: bool, regle: str, explication: str,
                          forme_attendue: str = "", correction: str = "") -> tuple[str, str]:
    ctx = {"correcte": correcte, "regle": regle, "explication": explication,
           "forme_attendue": forme_attendue, "correction": correction}
    return _tirer(POOL_LINGUISTIQUE, lambda fn: fn(ctx), cle_dedup="linguistique")


def realiser_devinette(*, courte: str, justification: str, source: str) -> tuple[str, str]:
    ctx = {"courte": courte, "justification": justification, "source": source}
    return _tirer(POOL_DEVINETTE, lambda fn: fn(ctx), cle_dedup="devinette")
