"""Policies — v10.9.1 : INVARIANT « rendu_final, unique point de sortie »
+ COUCHE DE SORTIE HUMAINE (pools de formulations, dédup structurel, style).

CONCEPTION (décisions utilisateur v10.9 + v10.9.1) :
1. Les GATES (verdict≠SUPPORTED, RAG vide, critic, garde entité, verif…) ne
   font qu'ANNOTER des codes de raison internes (state.annoter) — elles ne
   TERMINENT jamais la boucle et ne rédigent jamais le texte utilisateur.
2. rendu_final est l'UNIQUE point de sortie. Le ladder FIXE décide la CLASSE
   terminale, dans l'ordre :
     (a) refus de politique (safety_block « ne peut pas » / devinette
         « ne doit pas ») → SUBSTANTIEL : raison + alternative ;
     (b) réponse du modèle non rejetée → réponse du modèle ;
     (b') micro-social conversationnel sans LLM → pool conversationnel
         (accueil/gratitude/congé — un accueil n'a ni hedge ni inconnu) ;
     (c) hedge paramétrique (seconde chance LLM, préfixe varié) ;
     (d) inconnu honnête SUBSTANTIEL (savoir + manque + alternative).
   La RÉALISATION LINGUISTIQUE n'est plus écrite ici : elle est prise dans
   les POOLS de voix.py (≥ 8 variantes de fond et de ton par classe), avec
   DÉDUP STRUCTUREL (empreinte-squelette, seuil 0.6 vs N dernières réponses)
   et calibrage de longueur (une salutation courte, une question factuelle
   brève → réponse courte, jamais un paragraphe de méthodologie).
3. Le détecteur de non-réponse (verification.canari) reste un CANARI
   (télémétrie + tests CI), pas le mécanisme d'application.
4. Les formules usées (« voici où j'en suis », « détail vérifiable »,
   « plutôt que d'inventer », « je reprends la recherche », « état exact de
   ce que je sais ») sont des INTERDITS canari — aucun pool ne les génère.

EXEMPTIONS N1 (codées explicitement) :
- Inconnu honnête ≠ refus vide : (d) donne savoir + manque + alternative.
- Les refus de POLITIQUE (« ne peut pas » injection, « ne doit pas »
  devinette) sont SUBSTANTIELS et EXEMPTÉS du fallback « forcer une
  réponse » — edge_injection doit rester OK.
- MATH : pas de hedge NUMÉRIQUE (le solveur est l'autorité ; inventer un
  calcul serait pire qu'un inconnu honnête) → (d) direct si l'outil n'a pas
  tranché, avec les nombres détectés + les capacités exactes du solveur.

N2 — garde d'entité TRI-STATE :
- sources en échec/timeout → la garde NE PARLE PAS (indisponibilité ≠
  inexistence) → fallback hedge direct (c) ;
- sources consultées sans l'entité + pas de fait canonique → tag → (d)
  inconnu honnête substantiel ;
- whitelist stable-facts (capitales, verification.facts) = accélérateur :
  un fait canonique présent bloque la garde et alimente (b)/(c)/(d).
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

from ..llm import prompts
from ..verification import canari
from ..verification.facts import entite_canonique
from . import voix
from .state import AgentState

# ------------------------------------------------------------------ (b) détection
# Le texte LLM ne devient la réponse (b) que s'il n'est PAS une non-réponse
# (canari) — v10.7/v10.8 remplaçaient alors par un TEMPLATE (la cause des 64
# échecs) ; v10.9 descend l'échelle (c) puis (d) au lieu de réécrire un refus.


def _reponse_utilisable(texte: str) -> bool:
    """(b) : la réponse du modèle est-elle recevable telle quelle ?"""
    t = (texte or "").strip()
    if not t:
        return False
    return canari.detecter_non_reponse(t) is None


# ----------------------------------------------------- N2 — garde entité tri-state
_RE_QUESTION_ENTITE = re.compile(
    r"\b(?:capitale|pr[ée]sident(?:e)?|roi|reine|monarque|fondateur(?:rice)?|maire|"
    r"population|devise|drapeau|continent|fleuve|rivi[èe]re|montagne\s+la\s+plus\s+haute|"
    r"langue|monnaie|hymne)\s+(?:officielle\s+)?(?:de|du|d['’]|de\s+la|de\s+l['’])\s*"
    r"([A-ZÉÈÀÂÎÔÛ][\wÀ-ÿ'’\-]*)")


def _norme(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def _garde_entite(state: AgentState) -> dict[str, Any] | None:
    """N2 — TRI-STATE (la garde ANNOTE, elle ne rédige plus) :
    - {"etat": "silencieux"}    : rien à dire (pas de question d'entité, ou fait
      canonique présent) → l'échelle (b)/(c) tourne normalement ;
    - {"etat": "indisponible"}  : la recherche de sources a ÉCHOUÉ
      (rate-limit/timeout) → indisponibilité ≠ inexistence → la garde se tait
      et le rendu descend au hedge (c), pas à l'inconnu ;
    - {"etat": "absente"}       : sources CONSULTÉES (succès, résultats présents)
      sans trace de l'entité + aucun fait canonique → tag → cran (d)."""
    m = _RE_QUESTION_ENTITE.search(state.but or "")
    if not m:
        return None
    entite = m.group(1).rstrip("?!. ")
    if len(entite) < 4:
        return None
    if entite_canonique(entite):  # whitelist stable-facts = accélérateur N2
        return {"etat": "silencieux", "entite": entite, "canonique": True}
    obs_web = state.observation_de("recherche_web")
    if not obs_web:
        # aucune tentative : on ne peut rien conclure, garde muette
        return {"etat": "silencieux", "entite": entite}
    resultats = obs_web.resultat.get("resultats") or []
    if not resultats:
        # la recherche a été tentée mais n'a RIEN renvoyé (échec, 429, timeout)
        # → indisponibilité ≠ inexistence : la garde ne parle pas (N2-1)
        return {"etat": "indisponible", "entite": entite}
    corpus = [c.texte for c in state.claims]
    for res in resultats:
        corpus.append(str(res.get("titre", "")))
        corpus.append(str(res.get("extrait", "")))
        corpus.append(str(res.get("url", "")))
    todo = _norme(entite)
    commence = todo[:5]
    for brut in corpus:
        n = _norme(brut)
        if todo in n or (len(n) >= 5 and commence in n):
            return {"etat": "silencieux", "entite": entite}  # entité trouvée
    # sources consultées, entité absente, pas de fait canonique → N2-2 : tag
    return {"etat": "absente", "entite": entite,
            "n_sources": len(resultats)}


# ---------------------------------------------------------------- (c) hedge
def _hedge(state: AgentState) -> str:
    """(c) hedge paramétrique — seconde chance LLM, mise en cache par tour.
    Le préfixe d'aveu d'incertitude et le marque (à vérifier)/(non vérifié)/
    (à confirmer) sont pris dans le pool voix (v10.9.1) — plus jamais la même
    tournure mot pour mot. Le hedge PRÉSERVE la résolution d'anaphore (la
    question « quel était SON rôle » retrouve son antécédent)."""
    if state.repli_hedge is not None:
        return state.repli_hedge
    texte = ""
    from ..llm.engine import MOTEUR
    from . import observer
    if MOTEUR.disponible():
        msgs = prompts.prompt_hedge(state.but, _voisinage_resume(state),
                                    anaphore=marqueurs_anaphore(state.but))
        obs = observer.raisonner_llm(state, msgs, phase="reponse", temperature=0.4, max_tokens=700)
        if obs.succes:
            brut = (obs.resultat.get("texte") or "").strip()
            if brut and not canari.detecter_non_reponse(brut):
                texte = brut
    if texte:
        calib = voix.calibrer(state.but)
        texte, nom = voix.realiser_hedge(texte, langue=calib["langue"])
        state.variante_terminal = nom
    state.repli_hedge = texte  # cache ("" = hedge indisponible, ne pas retenter)
    return texte


# -------------------------------------------- anaphore / continuation (v10.7→v10.9)
# Déplacées d'agent.py vers policies : le hedge (c) et le gating du fil récent
# partagent la MÊME détection (un seul jeu de motifs, zéro divergence).
_ANAPHORE = re.compile(
    r"\b(?:ce|cet|cette|ces|son|sa|ses|leur|leurs|celui|celle|ceux|celles|"
    r"lui|eux|le m[eê]me|la m[eê]me|ce dernier|cette derni[eè]re)\b", re.IGNORECASE)
_CONTINUATION = re.compile(
    r"^\s*(?:et\b|puis\b|en\s+savoir\s+plus|plus\s+de\s+d[eé]tails?|d[eé]taille?s?|"
    r"pr[ée]cise?s?|continue[rz]?|ensuite\b|aussi\b|pourquoi\s*\?|donne[- ]moi\s+plus)", re.IGNORECASE)


def marqueurs_anaphore(question: str) -> bool:
    """v10.8 (Classe 4) — détection d'anaphore SANS faux positifs : les
    constructions interrogatives « qu'est-ce que », « est-ce que » contiennent
    « ce » qui n'est PAS un démonstratif anaphorique. On les neutralise avant
    le match (« son rôle », « ce protocole », « cet algorithme » restent
    détectés)."""
    q = re.sub(r"qu[\s'’]?est[- ]ce qu[e']?", " ", question or "", flags=re.IGNORECASE)
    q = re.sub(r"est[- ]ce que", " ", q, flags=re.IGNORECASE)
    return bool(_ANAPHORE.search(q))


def marqueur_continuation(question: str) -> bool:
    """« Et ensuite », « plus de détails »… — reprise de fil non anaphorique."""
    return bool(_CONTINUATION.match(question or ""))


# ------------------------------------------------- (d) inconnu honnête SUBSTANTIEL
def _voisinage_resume(state: AgentState) -> str:
    """Ce qu'on SAIT du voisinage de la question — contexte partiel du hedge (c)."""
    lignes: list[str] = []
    for f in state.faits[:4]:
        if f.get("source") == "table_faits_stables":
            lignes.append(f"- [fait stable canonique ✓] {f['contenu']}")
        else:
            lignes.append(f"- [mémoire — indicatif] {f['contenu'][:160]}")
    fil = state.contextes_memoire.get("fil") or []
    if fil:
        dernier = next((t for t in reversed(fil) if t.get("role") == "utilisateur"), None)
        if dernier and dernier.get("contenu"):
            lignes.append(f"- [fil récent] dernier sujet utilisateur : {dernier['contenu'][:140]}")
    return "\n".join(lignes)


def _savoir_pieces(state: AgentState) -> list[str]:
    """Contenu d'abord : faits canoniques / mémoire / documents (puces neutres,
    la réalisation générale est ajoutée par le pool)."""
    pieces: list[str] = []
    canoniques = [f for f in state.faits if f.get("source") == "table_faits_stables"]
    memoire_f = [f for f in state.faits if f.get("source") != "table_faits_stables"]
    docs = [d for d in (state.contextes_memoire.get("documents") or []) if d.get("nom")]
    for f in canoniques[:2]:
        pieces.append(f"• {f['contenu']}")
    for f in memoire_f[:2]:
        pieces.append(f"• (mémoire, indicatif) {f['contenu'][:120]}")
    if docs:
        det = ", ".join(f"« {d.get('nom', '?')} »" for d in docs[:2])
        pieces.append(f"• documents indexés potentiellement liés : {det}")
    return pieces


def _etat_recherche_piece(state: AgentState) -> str:
    """État réel de la recherche (contenu honnête, libellés lisibles).
    L'observation web est lue MÊME en échec (429/timeout) : indisponibilité
    ≠ inexistence — l'utilisateur doit savoir que la recherche a été TENTÉE."""
    _LIBELLES_OUTILS = {
        "solveur_math": "solveur mathématique exact", "simulateur_code": "simulateur de code",
        "verificateur_grammaire": "vérificateur grammatical", "analyseur_devinette": "analyse de devinette",
        "python_sandbox": "sandbox Python", "recherche_web": "recherche web",
        "recherche_fichiers": "mémoire documentaire",
    }
    webs = [o for o in state.observations if o.outil == "recherche_web"]
    if webs:
        dernier = webs[-1]
        resultats = (dernier.resultat.get("resultats") or []) if dernier.succes else []
        if dernier.succes and resultats:
            return (f"• recherche web effectuée : {len(resultats)} résultat(s) consulté(s), "
                    "aucun ne répond directement à la question.")
        if dernier.succes:
            return "• recherche web effectuée : aucun résultat exploitable."
        return ("• recherche web tentée mais indisponible au moment de la réponse "
                "(quota/timeout) — impossible d'en conclure une absence de preuve.")
    tentes = sorted({_LIBELLES_OUTILS.get(o.outil, o.outil)
                     for o in state.observations if o.outil != "llm_raisonnement"})
    if tentes:
        return f"• outils consultés : {', '.join(tentes)}."
    return ""


def _sujet_propre(state: AgentState) -> str:
    """Sujet de la réponse : l'entité quand la question est une question
    d'attribut (« Quelle est la capitale de l'Atlantide ? » → « Atlantide »),
    sinon la question nettoyée — le sujet ancre chaque variante (d)."""
    m = _RE_QUESTION_ENTITE.search(state.but or "")
    if m:
        return m.group(1).rstrip("?!. ")
    return (state.but or "").strip().rstrip("?").strip()[:180]


def _manque_defaut(state: AgentState) -> str:
    """Ce qui manque — dérivé des codes de raison (JAMAIS la formule usée)."""
    manque: list[str] = []
    if "RAG_VIDE" in state.codes_raison:
        # v10.9.2 : groupe NOMINAL — la phrase est reprise après « il faudrait… ».
        manque.append("une source exploitable (aucune n'a été trouvée)")
    if "STOP_HONNETE" in state.codes_raison:
        diag = state.echec_honnete_diagnostic()
        manque.extend(diag["raisons"][:2])
    if not manque:
        manque.append("un détail de contexte qui lève l'ambiguïté (terme, époque, domaine)")
    return " ; ".join(manque)


_ALTERNATIVE_DEFAUT = ("Avec un terme, une époque ou un contexte précis, je creuse avec plaisir.")


def _inconnu_honnete(state: AgentState, savoir_sup: str = "",
                     manque_sup: str = "", alternative_sup: str = "") -> str:
    """(d) — SUBSTANTIEL par construction : savoir (voisinage) + état de la
    recherche (rendu SÉPARÉMENT : consulter des outils n'est pas « savoir »)
    + manque + alternative, réalisés par le pool voix (≥ 9 variantes, dédup,
    sujet ancré). JAMAIS un « reformulez » sec, JAMAIS une formule usée."""
    savoir = "\n".join(_savoir_pieces(state))
    if savoir_sup:
        savoir = (f"• {savoir_sup}" + ("\n" + savoir if savoir else ""))
    etat = _etat_recherche_piece(state)
    manque = manque_sup or _manque_defaut(state)
    alternative = alternative_sup or _ALTERNATIVE_DEFAUT
    sujet = _sujet_propre(state)
    calib = voix.calibrer(state.but)
    texte, nom = voix.realiser_inconnu(savoir=savoir, manque=manque,
                                       alternative=alternative, sujet=sujet,
                                       etat=etat, langue=calib["langue"])
    state.variante_terminal = nom
    return texte


# --------------------------------------------------------------- échec honnête (d)
def echec_honnete(state: AgentState) -> dict[str, Any]:
    """v10.9 — l'arrêt honnête est UNE FORME du cran (d) : il passe par
    l'inconnu honnête substantiel (savoir + manque), jamais un template.
    Les causes d'arrêt sont annotées puis reprises par le contenu (d)."""
    if "STOP_HONNETE" not in state.codes_raison:
        state.annoter("STOP_HONNETE")
    texte = _inconnu_honnete(state)
    return {"reponse_courte": "Je ne peux pas déterminer la réponse avec certitude.",
            "reponse": texte, "statut": "ECHEC_HONNETE"}


# =========================================================== rendu_final (UNIQUE SORTIE)
def rendu_final(state: AgentState, explication_llm: str = "") -> dict[str, Any]:
    """UNIQUE point de sortie de la boucle agent (invariant v10.9).

    Le ladder FIXE décide la CLASSE terminale :
      (a) refus de politique substantiel (safety_block / devinette) ;
      (b) réponse du modèle non rejetée ;
      (b') micro-social conversationnel sans LLM (accueil/gratitude/congé) ;
      (c) hedge paramétrique (seconde chance LLM, préfixe varié) ;
      (d) inconnu honnête substantiel (savoir + manque).
    La RÉALISATION linguistique est prise dans les POOLS de voix.py (dédup
    structurel + longueur calibrée). Les branches outillées VERIFIED (outil =
    autorité) s'appliquent d'abord ; leur échec rejoint la même échelle —
    jamais un template, jamais une raison technique utilisateur."""
    t = state.type_tache
    obs = None
    texte = ""
    courte = ""
    statut = "UNKNOWN"
    classe = canari.CLASSE_INCONNU

    if t == "MATH":
        obs = state.observation_de("solveur_math")
        r = obs.resultat if obs else {}
        if r.get("statut") == "VERIFIED":
            courte = f"{r['resultat']}"
            reduction = r.get("methode") == "reduction_pourcentage"
            texte, nom = voix.realiser_outillee(
                str(r["resultat"]), str(r.get("preuve", "")),
                expression=str(r.get("expression", "")), reduction=reduction)
            state.variante_terminal = nom
            if explication_llm and _reponse_utilisable(explication_llm):
                texte += f"\n\n{explication_llm.strip()}"
            statut = "VERIFIED"
            classe = canari.CLASSE_OUTILLEE
        else:
            # N4 : raison = code interne (STRUCTURE_NON_RECONNUE), jamais affiché.
            # Pas de hedge NUMÉRIQUE (le solveur est l'autorité — inventer un
            # calcul serait une fabrication) → cran (d) substantiel.
            state.annoter("MATH_SOLVEUR_INCOMPLET", str(r.get("detail_interne", ""))[:200])
            nombres = ", ".join(r.get("nombres_detectes", [])[:4]) or "aucun nombre isolable"
            manque = (f"une structure calculable de façon certaine "
                      f"(nombres détectés dans la question : {nombres})")
            alternative = ("Je calcule de façon exacte : expressions arithmétiques "
                           "(+ − × ÷ ^, parenthèses, négatifs), pourcentages (réductions, TVA, "
                           "hausses), fractions en mots (moitié, tiers, quarts), conversions de "
                           "température (°C↔°F↔K), conversions d'unités (longueurs, masses, "
                           "durées, volumes) et constantes (365 j/an, 1440 min/j…). Par "
                           "politique, un calcul non vérifié ne sort pas — pas d'estimation "
                           "inventée.")
            texte = _inconnu_honnete(state, manque_sup=manque, alternative_sup=alternative)
            courte = "Je ne peux pas calculer ce point de façon certaine."
            statut = "UNKNOWN"
            classe = canari.CLASSE_INCONNU

    elif t == "CODE":
        obs = state.observation_de("simulateur_code")
        r = obs.resultat if obs else {}
        if r.get("statut") == "VERIFIED":
            courte = str(r.get("sortie", ""))
            texte, nom = voix.realiser_code(courte, str(r.get("croisement", "simulation AST")),
                                            r.get("pas", "?"))
            state.variante_terminal = nom
            if explication_llm and _reponse_utilisable(explication_llm):
                texte += f"\n\n{explication_llm.strip()}"
            statut = "VERIFIED"
            classe = canari.CLASSE_OUTILLEE
        elif r.get("statut") == "CONTRADICTED":
            courte = str(r.get("sortie", ""))
            texte = (f"**Conflit détecté et arbitré** : {r.get('resume')}\n"
                     f"Sortie retenue (sandbox fait foi) :\n```\n{courte}\n```")
            statut = "CONTRADICTED"
            classe = canari.CLASSE_OUTILLEE
        elif r.get("statut") == "ERREUR":
            courte = "Le code produit une erreur."
            texte = f"**Erreur d'exécution** : {r.get('raison')}"
            statut = "DISPROVED"
            classe = canari.CLASSE_OUTILLEE
        else:
            # N4 — code non simulable : échelle (b)→(b')→(c)→(d), raison interne.
            state.annoter("CODE_SIMULATION_INCOMPLETE", str(r.get("raison", ""))[:200])
            alternative = ("Je simule de façon vérifiable les affectations, boucles for/while, "
                           "conditions et print() — un fragment hors de cette portée ne reçoit "
                           "pas d'estimation inventée.")
            texte, statut, classe = _echelle_generale(state, explication_llm,
                                                       alternative_sup=alternative)
            courte = _courte_de(texte)

    elif t == "LINGUISTIQUE":
        obs = state.observation_de("verificateur_grammaire")
        r = obs.resultat if obs else {}
        if r.get("statut") == "VERIFIED":
            courte = "Oui, la phrase est correcte." if r.get("correcte") else "Non, la phrase est incorrecte."
            texte, nom = voix.realiser_linguistique(
                correcte=bool(r.get("correcte")), regle=str(r.get("regle", "")),
                explication=str(r.get("explication", "")),
                forme_attendue=str(r.get("forme_attendue", "")),
                correction=str(r.get("correction", "")))
            state.variante_terminal = nom
            if explication_llm and _reponse_utilisable(explication_llm):
                texte += f"\n\n{explication_llm.strip()}"
            statut = "VERIFIED"
            classe = canari.CLASSE_OUTILLEE
        else:
            # N4 (cas « participé passé non repéré ») : raison = code interne ;
            # le contenu expose la RÈGLE générale, jamais le diagnostic parser.
            state.annoter("GRAMMAIRE_ANALYSE_INCOMPLETE", str(r.get("raison", ""))[:200])
            regle = ("La règle de référence : participe passé avec « être » réfléchi — COD direct "
                     "postposé (« se sont lavé les mains ») → invariable ; sans COD postposé, le "
                     "pronom réfléchi antéposé est le COD → accord avec le sujet "
                     "(« elles se sont lavées »).")
            texte, statut, classe = _echelle_generale(state, explication_llm,
                                                       savoir_sup=regle)
            courte = _courte_de(texte)

    elif t == "DEVINETTE":
        obs = state.observation_de("analyseur_devinette")
        r = obs.resultat if obs else {}
        if r.get("statut") == "VERIFIED":
            courte = r.get("reponse_courte", "")
            texte, nom = voix.realiser_devinette(
                courte=str(courte), justification=str(r.get("justification", "")),
                source=str(r.get("source", "")))
            state.variante_terminal = nom
            if explication_llm and _reponse_utilisable(explication_llm):
                texte += f"\n\n{explication_llm.strip()}"
            statut = "VERIFIED"
            classe = canari.CLASSE_OUTILLEE
        else:
            # (a) refus de POLITIQUE « ne doit pas » (inventer) — SUBSTANTIEL et
            # EXEMPTÉ du fallback « forcer une réponse » (exemption N1).
            courte = r.get("reponse_courte", "Je ne peux pas déterminer la réponse avec certitude.")
            raisons = "\n".join(f"- {x}" for x in r.get("raisons", ["preuves insuffisantes"]))
            raison = ("une charade résolue par invention serait fausse par construction — chaque "
                      "indice doit mener à une solution unique et vérifiable")
            alternative = (f"Raisons :\n{raisons}\n\nCe qui manque : chaque indice doit avoir une "
                           "solution unique et « mon tout » doit être cohérent (nombre de lettres). "
                           "Donnez-moi un indice supplémentaire ou vérifiez-en un avec moi, et je "
                           "poursuis.")
            texte, nom = voix.realiser_politique(raison, alternative)
            state.variante_terminal = nom
            statut = "UNKNOWN"
            classe = canari.CLASSE_POLITIQUE
            state.annoter("POLITIQUE_DEVINETTE_PAS_INVENTER")

    elif t == "FACTUEL":
        # N2 — garde d'entité TRI-STATE : ANNOTE, ne rédige plus, ne termine plus.
        garde = _garde_entite(state)
        entite_absente = None
        if garde and garde["etat"] == "absente":
            state.annoter("ENTITE_ABSENTE_SOURCES",
                          f"{garde['entite']} absente de {garde.get('n_sources', 0)} source(s) web consultée(s)")
            entite_absente = garde["entite"]
        elif garde and garde["etat"] == "indisponible":
            state.annoter("SOURCES_INDISPONIBLES", "la recherche web a échoué (≠ inexistence)")
        # CLASSE 2 (v10.8, conservé) — « Sources » = uniquement des sources web réelles.
        sources = [c for c in state.claims
                   if c.type == "fait" and c.preuves and str(c.source or "").startswith("http")]
        if entite_absente:
            # cran (d) spécialisé entité : honnête, substantiel, JAMAIS d'invention
            savoir = (f"Je ne trouve pas « {entite_absente} » dans les sources consultées — "
                      "peut-être une entité fictive, une orthographe différente ou un nom peu "
                      "documenté.")
            manque = "l'orthographe exacte de l'entité ou une source qui la documente"
            alternative = ("Vérifiez l'orthographe ou précisez la source et je réessaie. Je ne "
                           "fabrique pas d'attribut pour une entité non sourcée.")
            texte = _inconnu_honnete(state, savoir_sup=savoir, manque_sup=manque,
                                     alternative_sup=alternative)
            courte = f"Je ne trouve pas « {entite_absente} » dans mes sources."
            statut = "UNKNOWN"
            classe = canari.CLASSE_INCONNU
        else:
            # échelle standard : (b) modèle → (b') micro → (c) hedge → (d)
            texte, statut, classe = _echelle_generale(state, explication_llm)
            courte = _courte_de(texte)
        if sources and not _refus_like(texte):
            texte += "\n\n**Sources :**\n" + "\n".join(f"- {c.texte[:120]} ({c.source})" for c in sources[:4])
        hyps = [c for c in state.claims if c.statut == "HYPOTHESIS"]
        if hyps and not _refus_like(texte):
            texte += "\n\n*Parts non vérifiées (hypothèses) :* " + "; ".join(c.texte[:80] for c in hyps[:2])

    else:
        # CONVERSATIONNEL / LOGIQUE — échelle standard, avec cran (b') micro-social
        texte, statut, classe = _echelle_generale(state, explication_llm)
        courte = _courte_de(texte)

    state.classe_terminal = classe
    return {"reponse_courte": courte, "reponse": texte, "statut": statut}


def _refus_like(texte: str) -> bool:
    """True si le texte est un refus/non-réponse (évite d'habiller d'un bloc
    Sources ou Hypothèses une réponse qui n'existe pas)."""
    return not _reponse_utilisable(texte)


def _courte_de(texte: str) -> str:
    """Réponse courte dérivée : première phrase utile (ou extrait)."""
    brut = (texte or "").strip()
    brut = re.sub(r"[*#`>]", "", brut)
    phrase = re.split(r"(?<=[.!?])\s", brut, maxsplit=1)
    courte = (phrase[0] if phrase and phrase[0] else brut).strip()
    return courte[:220]


def _echelle_generale(state: AgentState, explication_llm: str,
                      savoir_sup: str = "", alternative_sup: str = "") -> tuple[str, str, str]:
    """Échelle (b)→(b'-fact)→(b''-social)→(c)→(d) pour les branches non
    outillées. Retourne (texte, statut, classe)."""
    calib = voix.calibrer(state.but)

    # ---- (b) réponse du modèle non rejetée
    if _reponse_utilisable(explication_llm):
        return explication_llm.strip(), "SUPPORTED", canari.CLASSE_MODELE
    state.annoter("MODELE_REPONSE_INUTILISABLE")

    # ---- (b'-fact) fait canonique qui répond DIRECTEMENT (N2, accélérateur) :
    # un fait stable de la whitelist est une AUTORITÉ — la réponse est le fait
    # lui-même, courte et sûre, jamais un cadre « inconnu » pour un fait connu.
    if state.type_tache == "FACTUEL":
        canoniques = [f for f in state.faits if f.get("source") == "table_faits_stables"]
        if canoniques:
            texte, nom = voix.realiser_fait_direct(str(canoniques[0]["contenu"]))
            if texte:
                state.variante_terminal = nom
                state.annoter("FAIT_CANONIQUE_DIRECT")
                return texte, "VERIFIED", canari.CLASSE_OUTILLEE

    # ---- (b''-social) micro-social conversationnel (accueil/gratitude/congé) :
    # un geste social n'a NI hedge ni inconnu — réponse directe du pool,
    # courte et naturelle. Deux signaux POSITIFS requis (v10.9.2) :
    #   1. un geste social DÉTECTÉ dans le texte (merci/bye/accueil — le pool
    #      vide = aucun geste, le cran est sauté) ;
    #   2. entrée brève SANS marque interrogative (micro/courte — « Salut,
    #      qu'est-ce qu'un VPN ? » reste une vraie question, pas un accueil).
    if (state.type_tache == "CONVERSATIONNEL"
            and calib["echelle"] in ("micro", "courte")):
        texte, nom = voix.realiser_conversationnelle(state.but)
        if texte:
            state.variante_terminal = nom
            state.annoter("MICRO_SOCIAL_DETERMINISTE")
            return texte, "SUPPORTED", canari.CLASSE_CONVERSATIONNELLE

    # ---- (c) hedge paramétrique (seconde chance LLM)
    hedge = _hedge(state)
    if hedge:
        return hedge, "HYPOTHESIS", canari.CLASSE_HEGEE
    state.annoter("HEDGE_INDISPONIBLE")

    # ---- (d) inconnu honnête substantiel
    return _inconnu_honnete(state, savoir_sup=savoir_sup,
                            alternative_sup=alternative_sup), "UNKNOWN", canari.CLASSE_INCONNU


# ------------------------------------------------- CLASSE 7 — garde d'injection (a)
_MOTIFS_PRISE_DE_CONTROLE = re.compile(
    r"^\s*(?:system|syst[eè]me)\s*[:\-]"
    r"|<\|im_start\|>|<\|system\|>"
    r"|ignore\s+(?:toutes?\s+)?(?:les\s+)?(?:instructions|consignes|r[èe]gles?)\s+"
    r"(?:pr[ée]c[ée]dentes?|ci[- ]dessus|syst[èe]me|donn[ée]es)"
    r"|oublie\s+(?:tes\s+|toutes\s+les\s+)?(?:instructions|consignes|r[èe]gles?)"
    r"|tu\s+es\s+d[ée]sormais|d[ée]sormais\s+tu\s+(?:es|seras)"
    r"|tu\s+(?:dois|vas)\s+(?:d[ée]sormais\s+)?(?:jouer|agir)\s+comme",
    re.IGNORECASE)
_REPETITION = re.compile(
    r"^\s*r[ée]p[èe]tes?\s*(?:[-:]|apr[èe]s\s+moi)\s*[:\-]?\s*(.*)$", re.IGNORECASE | re.DOTALL)


def garde_injection(question: str) -> dict[str, Any] | None:
    """CLASSE 7 — (a) refus de politique DÉTERMINISTE, sans LLM, appelé en tête
    de run_agent (AVANT toute planification). « Ne peut pas » ≠ « ne veut pas » :
    réponse SUBSTANTIELLE (raison expliquée + alternative sûre), EXEMPTÉE du
    fallback « forcer une réponse » (exemption N1 — edge_injection verrouillé).
    1) prise de contrôle (« SYSTEM: », contournement) → refus poli + alternative ;
    2) « répète : X » → citation de X SANS endossement (jamais l'obéissance).
    v10.9.1 : la RÉALISATION passe par le pool politique (≥ 8 variantes) —
    raison et alternative restent substantiels, seule la formulation varie.
    Retourne None quand la question est normale."""
    q = (question or "").strip()
    if not q:
        return None
    if _MOTIFS_PRISE_DE_CONTROLE.search(q):
        raison = ("ce message prétend être une instruction système, mais il s'agit de simple "
                  "texte utilisateur — je ne suis pas autorisée à le suivre")
        alternative = ("Je peux en revanche vous aider normalement : posez votre question "
                       "ou décrivez votre besoin, et j'y répondrai avec mes règles habituelles.")
        texte, nom = voix.realiser_politique(raison, alternative)
        return {
            "reponse_courte": "Je ne peux pas ignorer mes règles ni changer de rôle.",
            "reponse": texte,
            "statut": "REFUSE_POLI",
            "_variante": nom,
        }
    m = _REPETITION.match(q)
    if m:
        contenu = (m.group(1) or "").strip().rstrip("?").strip()
        if not contenu:
            return {
                "reponse_courte": "Que souhaitez-vous que je répète ?",
                "reponse": ("Vous me demandez de répéter quelque chose, mais le texte à "
                            "répéter est vide. Précisez-le et je le reproduirai en le citant "
                            "comme votre message, sans l'endosser."),
                "statut": "REFUSE_POLI",
            }
        return {
            "reponse_courte": f"« {contenu} » — cité sans endossement.",
            "reponse": (f"Vous me demandez de répéter : « {contenu} ».\n\n"
                        "Je le reproduis ci-dessus comme CITATION de votre message, sans "
                        "l'endosser : répéter un texte n'en fait pas un fait vérifié. Si vous "
                        "souhaitez que je vérifie cette affirmation ou que je l'explique, "
                        "dites-le moi et je m'en occupe."),
            "statut": "CITE_SANS_ENDOSSEMENT",
        }
    return None
