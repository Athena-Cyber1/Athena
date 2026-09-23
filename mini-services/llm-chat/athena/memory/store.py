"""Mémoire hiérarchique L0→L5 + mini-RAG symbole/lexique + corpus d'erreurs.

- mémoire ≠ vérité : chaque élément porte source / confiance / verifie / preuves.
- RAG orienté code : correspondance symbole exacte > nom de fichier > lexique BM25-lite.
- Mémoire des erreurs : erreur → cause → test de régression → verrouillage.
"""
from __future__ import annotations

import json
import math
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

DOSSIER = Path(__file__).resolve().parent.parent.parent / "data"
DB = DOSSIER / "memoire.db"
CORPUS = DOSSIER / "corpus.ndjson"
_VERROU = threading.Lock()


def _connexion() -> sqlite3.Connection:
    DOSSIER.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


_CONN = _connexion()
_CONN.executescript(
    """
    CREATE TABLE IF NOT EXISTS tours (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fil_id TEXT, ts REAL, role TEXT,
        contenu TEXT, type_tache TEXT, statut TEXT);
    CREATE TABLE IF NOT EXISTS faits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, contenu TEXT, source TEXT,
        confiance REAL DEFAULT 0.5, verifie INTEGER DEFAULT 0, scope TEXT DEFAULT 'conversation',
        preuves TEXT DEFAULT '[]', maj_ts REAL);
    CREATE TABLE IF NOT EXISTS erreurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT, prediction TEXT, attendu TEXT,
        type_erreur TEXT, corrige INTEGER DEFAULT 0, source TEXT, tache TEXT, ts REAL);
    CREATE TABLE IF NOT EXISTS fichiers (
        file_id TEXT PRIMARY KEY, nom TEXT, mime TEXT, sha256 TEXT, langue TEXT,
        lignes INTEGER, symboles TEXT DEFAULT '[]', ts REAL);
    CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, file_id TEXT, idx INTEGER, texte TEXT,
        symboles TEXT DEFAULT '[]');
    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
    CREATE INDEX IF NOT EXISTS idx_tours_fil ON tours(fil_id);
    CREATE TABLE IF NOT EXISTS telemetrie_sorties (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, fil_id TEXT, type_tache TEXT,
        classe TEXT, codes TEXT, duree_ms INTEGER, non_reponse TEXT);
    """
)

# --- v10.6 migrations douces (ALTER idempotent) -----------------------------
def _colonne_existe(table: str, colonne: str) -> bool:
    rows = _CONN.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == colonne for r in rows)


if not _colonne_existe("fichiers", "statut"):
    _CONN.execute("ALTER TABLE fichiers ADD COLUMN statut TEXT DEFAULT 'indexed'")
if not _colonne_existe("fichiers", "taille"):
    _CONN.execute("ALTER TABLE fichiers ADD COLUMN taille INTEGER DEFAULT 0")
if not _colonne_existe("fichiers", "erreur"):
    _CONN.execute("ALTER TABLE fichiers ADD COLUMN erreur TEXT")
# v10.9.1 — télémétrie de diversité : variante de pool + signature squelette
if not _colonne_existe("telemetrie_sorties", "variante"):
    _CONN.execute("ALTER TABLE telemetrie_sorties ADD COLUMN variante TEXT DEFAULT ''")
if not _colonne_existe("telemetrie_sorties", "empreinte"):
    _CONN.execute("ALTER TABLE telemetrie_sorties ADD COLUMN empreinte TEXT DEFAULT ''")
_CONN.commit()

# v10.6 (F14) : les exécutables n'auraient jamais dû être indexés comme
# documents texte — purge des entrées binaires existantes (PE/ELF) et de leurs
# chunks. Migration UNIQUE, exécutée au démarrage.
_n = _CONN.execute(
    "SELECT COUNT(*) c FROM fichiers WHERE mime IN ('application/x-pe','application/x-elf')"
).fetchone()["c"]
if _n:
    _CONN.execute(
        "DELETE FROM chunks WHERE file_id IN "
        "(SELECT file_id FROM fichiers WHERE mime IN ('application/x-pe','application/x-elf'))"
    )
    _CONN.execute("DELETE FROM fichiers WHERE mime IN ('application/x-pe','application/x-elf')")
    _CONN.commit()

# v10.6 (F16) : dédoublonnage du corpus d'erreurs — une ligne par
# (question, source), la plus récente gagne. Migration UNIQUE au démarrage.
_CONN.execute(
    "DELETE FROM erreurs WHERE id NOT IN "
    "(SELECT MAX(id) FROM erreurs GROUP BY question, source)"
)
_CONN.commit()

# ---------------------------------------------------------------------- L0/L2 fil
_TOUR_BORNE = 2000          # mémoire de conversation bornée (pas une fuite)
_compteur_tours = {"n": 0}


def memoriser_tour(fil_id: str, role: str, contenu: str, type_tache: str = "", statut: str = "") -> None:
    with _VERROU:
        _CONN.execute("INSERT INTO tours (fil_id, ts, role, contenu, type_tache, statut) VALUES (?,?,?,?,?,?)",
                      (fil_id, time.time(), role, contenu[:6000], type_tache, statut))
        # v10.6 (F2) : la mémoire L0/L2 est bornée — au-delà de _TOUR_BORNE
        # tours, les plus anciens sont retirés (pas de gonflement infini).
        _compteur_tours["n"] += 1
        if _compteur_tours["n"] % 50 == 0:
            _CONN.execute(
                "DELETE FROM tours WHERE id NOT IN "
                "(SELECT id FROM tours ORDER BY id DESC LIMIT ?)", (_TOUR_BORNE,))
        _CONN.commit()


def compter_conversations() -> int:
    """v10.6 (F2) : nombre de VRAIES conversations (fils distincts), pas de
    lignes brutes (question + réponse = 2 lignes pour UN même échange)."""
    row = _CONN.execute(
        "SELECT COUNT(DISTINCT fil_id) c FROM tours WHERE fil_id IS NOT NULL AND fil_id != ''"
    ).fetchone()
    return int(row["c"])


def purger_tours() -> int:
    """v10.6 (F1) : purge RÉELLE des conversations enregistrées (mémoire L0/L2).
    Le corpus d'erreurs (L5) et la base de connaissances (faits L3) sont
    préservés — on ne vide que l'historique de discussion."""
    with _VERROU:
        n = _CONN.execute("SELECT COUNT(*) c FROM tours").fetchone()["c"]
        _CONN.execute("DELETE FROM tours")
        _CONN.commit()
    return int(n)


def retrouver_fil(fil_id: str, limite: int = 8) -> list[dict[str, Any]]:
    rows = _CONN.execute(
        "SELECT role, contenu, type_tache, statut, ts FROM tours WHERE fil_id=? ORDER BY id DESC LIMIT ?",
        (fil_id, limite)).fetchall()
    return [dict(r) for r in reversed(rows)]


# ---------------------------------------------------------------------- L3 faits
def memoriser_fait(contenu: str, source: str = "utilisateur", confiance: float = 0.5,
                   verifie: bool = False, scope: str = "conversation", preuves: list[str] | None = None) -> int:
    with _VERROU:
        cur = _CONN.execute(
            "INSERT INTO faits (contenu, source, confiance, verifie, scope, preuves, maj_ts) VALUES (?,?,?,?,?,?,?)",
            (contenu[:4000], source, confiance, int(verifie), scope, json.dumps(preuves or []), time.time()))
        _CONN.commit()
        return cur.lastrowid


# v10.7 — mots vides français : un match sur ces jetons ne prouve AUCUNE
# pertinence (ex. « est » faisait matcher la mémoire « Athéna → déesse » pour
# une question VPN — cause racine du refus « le contexte ne mentionne que
# Athéna »). Un jeton SIGNIFICATIF (≥ 4 car., hors mots vides) est exigé.
_MOTS_VIDES = {
    "est", "sont", "que", "quoi", "qui", "quel", "quelle", "quels", "quelles",
    "comment", "pourquoi", "combien", "quand", "puis", "ainsi", "donc", "mais",
    "les", "des", "une", "mon", "ton", "son", "ses", "leur", "leurs",
    "avec", "sans", "pour", "par", "sur", "dans", "entre", "chez", "etre",
    "avoir", "fait", "faire", "peut", "plus", "moins", "tres", "tous",
    "tout", "toute", "cette", "cet", "ces", "ceux", "celle", "celui", "comme",
    "elle", "elles", "ils", "nous", "vous", "moi", "toi",
    "cest", "veux", "voudrais", "peux", "pouvez", "merci",
    "salut", "bonjour", "bonsoir", "explique", "dire", "parle",
    "pas", "aux", "car", "soit", "rien", "voir", "comme",
}


def jetons_significatifs(requete: str) -> list[str]:
    """Jetons de la requête qui portent du contenu (≥ 3 car. HORS mots vides —
    « vpn », « dns », « ssh » sont significatifs ; « est », « que » jamais)."""
    sortis = []
    for w in re.findall(r"\w{3,}", requete.lower()):
        if w not in _MOTS_VIDES and w not in sortis:
            sortis.append(w)
    return sortis[:10]


# v10.8 (Classe 2 du benchmark) — les documents de TEST/fixture ne doivent
# JAMAIS sortir dans le RAG destiné à l'utilisateur (fuite observée : « Rapport
# secret ATHENA-FILEDATA », « payEnergyBill », « Contenu de test Athéna v10.3 »
# listés comme sources). Détection par JETONS du nom (séparateurs . _ - espace) :
# test_athena.py, probe.txt, ui-test.txt, fake-v106.exe, rapport-secret…
# Le filtre s'applique à la RECHERCHE (chercher_fichiers) ; les docs restent
# visibles dans l'API d'administration /files et restent chargeables
# explicitement comme pièces jointes (chunks_par_fichiers = intention utilisateur).
_JETONS_FIXTURES = {
    "test", "tests", "probe", "fake", "fixture", "fixtures", "secret",
    "confidentiel", "draft", "brouillon", "demo", "démo",
    "athenafiledata", "filedata",
}


def _est_fixture(nom: str | None) -> bool:
    if not nom:
        return False
    bas = nom.lower()
    if "contenu de test" in bas or "athena-filedata" in bas or "athéna-filedata" in bas:
        return True
    jetons = re.split(r"[._\-\s]+", bas)
    return any(j in _JETONS_FIXTURES for j in jetons)


def chercher_faits(requete: str, limite: int = 4) -> list[dict[str, Any]]:
    """v10.7 : ne retourne un fait QUE s'il matche au moins un jeton
    SIGNIFICATIF de la question (≥ 3 car., hors mots vides). Avant, le mot
    vide « est » suffisait → la mémoire Athéna était injectée comme
    « contexte pertinent » pour n'importe quelle question contenant un
    verbe être — cause racine du refus Athéna/VPN (diagnostic §1)."""
    significatifs = jetons_significatifs(requete)
    if not significatifs:
        return []
    rows = _CONN.execute("SELECT contenu, source, confiance, verifie, maj_ts FROM faits ORDER BY id DESC LIMIT 400").fetchall()
    scores = []
    for r in rows:
        contenu = r["contenu"].lower()
        score = sum(1 for m in significatifs if m in contenu)
        if score:
            scores.append((score, dict(r)))
    scores.sort(key=lambda x: -x[0])
    return [{**s, "verifie": bool(s["verifie"]), "score": sc} for sc, s in scores[:limite]]


# ------------------------------------------------------------------- corpus erreurs
def memoriser_erreur(question: str, prediction: str, attendu: str, type_erreur: str,
                     corrige: bool, source: str = "eval", tache: str = "") -> None:
    """v10.6 (F16) : une entrée UNIQUE par (question, source) — la plus
    récente remplace l'ancienne (fini les doublons ×3/×4 d'un même cas)."""
    with _VERROU:
        _CONN.execute("DELETE FROM erreurs WHERE question=? AND source=?", (question[:2000], source))
        _CONN.execute(
            "INSERT INTO erreurs (question, prediction, attendu, type_erreur, corrige, source, tache, ts) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (question[:2000], prediction[:2000], str(attendu)[:500], type_erreur, int(corrige), source, tache, time.time()))
        _CONN.commit()


def corpus_erreurs(limite: int = 50) -> list[dict[str, Any]]:
    rows = _CONN.execute("SELECT * FROM erreurs ORDER BY id DESC LIMIT ?", (limite,)).fetchall()
    return [dict(r) for r in rows]


def marquer_erreurs_corrigees(questions: list[str]) -> int:
    """v10.7 — boucle erreur → cause → régression → VERROUILLAGE : une question
    du corpus d'erreurs qui PASSE désormais la suite est marquée corrige=1.
    La ligne reste dans l'historique (aucune destruction), elle est juste
    validée comme corrigée — le corpus sert alors de base de ré-entraînement
    fiable (exemples validés) au lieu d'une liste de plaintes jamais soldées."""
    if not questions:
        return 0
    n = 0
    with _VERROU:
        for q in questions[:100]:
            cur = _CONN.execute("UPDATE erreurs SET corrige=1 WHERE question=? AND corrige=0", (q[:2000],))
            n += cur.rowcount
        _CONN.commit()
    return n


# ----------------------------------------------------------------------- L4 fichiers
_GENRE_PAR_MIME = (
    ("application/pdf", "document"), ("application/zip", "archive"),
    ("application/gzip", "archive"), ("image/", "image"),
)


def _genre(mime: str | None) -> str:
    m = mime or ""
    for prefixe, genre in _GENRE_PAR_MIME:
        if m.startswith(prefixe):
            return genre
    if m.startswith("text/") or m in ("application/json",):
        return "document"
    return "autre"


def enregistrer_fichier(rec: dict[str, Any], morceaux: list[dict[str, Any]]) -> str:
    with _VERROU:
        _CONN.execute(
            "INSERT OR REPLACE INTO fichiers (file_id, nom, mime, sha256, langue, lignes, symboles, ts, statut, taille, erreur) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rec["file_id"], rec.get("nom"), rec.get("mime"), rec.get("sha256"), rec.get("langue"),
             rec.get("lignes", 0), json.dumps(rec.get("symboles", [])), time.time(),
             rec.get("statut", "indexed"), rec.get("taille", 0), rec.get("erreur")))
        _CONN.execute("DELETE FROM chunks WHERE file_id=?", (rec["file_id"],))
        for c in morceaux:
            _CONN.execute("INSERT INTO chunks (file_id, idx, texte, symboles) VALUES (?,?,?,?)",
                          (rec["file_id"], c.get("idx", 0), c.get("texte", ""), json.dumps(c.get("symboles", []))))
        _CONN.commit()
    return rec["file_id"]


def enregistrer_echec_fichier(file_id: str, nom: str, mime: str, taille: int, erreur: str) -> str:
    """v10.6 (F7/F22) : un upload REFUSÉ laisse une trace honnête dans le
    registre (statut « failed » + raison), au lieu de disparaître."""
    with _VERROU:
        _CONN.execute(
            "INSERT OR REPLACE INTO fichiers (file_id, nom, mime, sha256, langue, lignes, symboles, ts, statut, taille, erreur) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (file_id, nom, mime, "", "", 0, "[]", time.time(), "failed", taille, erreur[:300]))
        _CONN.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
        _CONN.commit()
    return file_id


def supprimer_fichier(file_id: str) -> bool:
    """v10.6 (F4) : purge RÉELLE d'un fichier indexé (registre + chunks)."""
    with _VERROU:
        n = _CONN.execute("SELECT COUNT(*) c FROM fichiers WHERE file_id=?", (file_id,)).fetchone()["c"]
        _CONN.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
        _CONN.execute("DELETE FROM fichiers WHERE file_id=?", (file_id,))
        _CONN.commit()
    return n > 0


def lister_fichiers() -> list[dict[str, Any]]:
    """v10.6 (F7/F22) : schéma harmonisé avec la réponse d'upload —
    filename (= nom), status, kind, sha256, size_bytes, chunks, erreur."""
    rows = _CONN.execute(
        "SELECT f.file_id, f.nom, f.mime, f.sha256, f.langue, f.lignes, f.ts, "
        "f.statut, f.taille, f.erreur, "
        "(SELECT COUNT(*) FROM chunks c WHERE c.file_id = f.file_id) AS chunks "
        "FROM fichiers f ORDER BY f.ts DESC"
    ).fetchall()
    return [
        {
            "file_id": r["file_id"],
            "nom": r["nom"],
            "filename": r["nom"],
            "mime": r["mime"],
            "langue": r["langue"],
            "lignes": r["lignes"],
            "ts": r["ts"],
            "status": r["statut"] or "indexed",
            "kind": _genre(r["mime"]),
            "sha256": r["sha256"] or "",
            "size_bytes": r["taille"] or 0,
            "chunks": r["chunks"],
            "erreur": r["erreur"],
        }
        for r in rows
    ]


def lire_fichier(file_id: str) -> dict[str, Any] | None:
    row = _CONN.execute("SELECT * FROM fichiers WHERE file_id=?", (file_id,)).fetchone()
    if not row:
        return None
    rec = dict(row)
    rec["symboles"] = json.loads(rec.get("symboles") or "[]")
    rec["filename"] = rec.get("nom")
    rec["status"] = rec.get("statut") or "indexed"
    rec["kind"] = _genre(rec.get("mime"))
    rec["size_bytes"] = rec.get("taille") or 0
    rec["chunks"] = _CONN.execute(
        "SELECT COUNT(*) c FROM chunks WHERE file_id=?", (file_id,)).fetchone()["c"]
    return rec


def lire_contenu_fichier(file_id: str, max_chars: int = 2_000_000) -> str | None:
    """v10.6 (F9) : texte COMPLET d'un fichier, chunks réassemblés dans l'ordre."""
    row = _CONN.execute("SELECT file_id FROM fichiers WHERE file_id=?", (file_id,)).fetchone()
    if not row:
        return None
    chunks = _CONN.execute(
        "SELECT idx, texte FROM chunks WHERE file_id=? ORDER BY idx ASC", (file_id,)
    ).fetchall()
    if not chunks:
        return ""
    reunion = "\n".join((c["texte"] or "") for c in chunks)
    return reunion[:max_chars]


def _tok(s: str) -> list[str]:
    return re.findall(r"[a-zA-Z_àâäéèêëîïôöùûüç][\wàâäéèêëîïôöùûüç]*", s.lower())


def _bm25(requete: str, docs: list[tuple[int, str]], k1: float = 1.2, b: float = 0.75) -> list[tuple[float, int]]:
    n = len(docs) or 1
    freqs, longueurs = [], []
    for _, texte in docs:
        tks = _tok(texte)
        longueurs.append(len(tks) or 1)
        freqs.append({})
        for t in tks:
            freqs[-1][t] = freqs[-1].get(t, 0) + 1
    moyenne = sum(longueurs) / len(longueurs) if longueurs else 1
    df: dict[str, int] = {}
    for f in freqs:
        for t in f:
            df[t] = df.get(t, 0) + 1
    # v10.7 : la requête est purgée de ses mots vides — « est/quoi/les » ont
    # un idf non nul sur petit corpus et génèrent du bruit classé « pertinent ».
    q = [t for t in _tok(requete) if t not in _MOTS_VIDES]
    scores = []
    for i, f in enumerate(freqs):
        score = 0.0
        for t in set(q):
            if t in f:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                score += idf * (f[t] * (k1 + 1)) / (f[t] + k1 * (1 - b + b * longueurs[i] / moyenne))
        scores.append((score, docs[i][0]))
    scores.sort(key=lambda x: -x[0])
    return scores


def chunks_par_fichiers(file_ids: list[str], max_chars: int = 3000) -> list[dict[str, Any]]:
    """v10.3 — contenu réel des pièces jointes pour l'injection FILE_DATA.

    Retourne, pour chaque file_id connu, les chunks ORDONNÉS (idx) jusqu'à
    max_chars par fichier. Les file_ids inconnus sont signalés (absents de la
    sortie) pour que l'agent puisse l'admettre honnêtement. Ce contenu reste
    une DONNÉE NON FIABLE (règle 9) : c'est ce que le fichier contient, jamais
    une affirmation vérifiée par un outil.
    """
    sortis: list[dict[str, Any]] = []
    for fid in (file_ids or [])[:10]:
        row = _CONN.execute(
            "SELECT file_id, nom, mime, langue FROM fichiers WHERE file_id=?", (fid,)
        ).fetchone()
        if row is None:
            continue
        chunks = _CONN.execute(
            "SELECT idx, texte FROM chunks WHERE file_id=? ORDER BY idx ASC", (fid,)
        ).fetchall()
        extraits: list[str] = []
        utilise = 0
        tronque = False
        for c in chunks:
            t = (c["texte"] or "").strip()
            if not t:
                continue
            reste = max_chars - utilise
            if reste <= 0:
                tronque = True
                break
            if len(t) > reste:
                extraits.append(t[:reste] + "…[tronqué]")
                utilise += reste
                tronque = True
                break
            extraits.append(t)
            utilise += len(t)
        sortis.append({
            "file_id": fid, "nom": row["nom"], "mime": row["mime"], "langue": row["langue"],
            "chunks_total": len(chunks), "extraits": extraits, "chars": utilise,
            "tronque": tronque,
        })
    return sortis


def chercher_fichiers(requete: str, limite: int = 6) -> list[dict[str, Any]]:
    """RAG orienté agent de code : symbole exact > nom de fichier > lexical BM25.
    v10.8 (Classe 2) : les documents marqués test/fixture/secret sont EXCLUS
    du RAG destiné à l'utilisateur (aucune fuite de fixtures dans les sources)."""
    req = requete.strip()
    resultats: dict[str, dict[str, Any]] = {}
    files_all = _CONN.execute("SELECT file_id, nom, langue, symboles FROM fichiers").fetchall()
    fixtures = {f["file_id"] for f in files_all if _est_fixture(f["nom"])}
    files = [f for f in files_all if f["file_id"] not in fixtures]

    # 1) symbole exact (fonction/classe) — priorité maximale
    symbole = None
    m = re.search(r"\b([a-zA-Z_]\w{2,})\s*\(", req)
    if m:
        symbole = m.group(1)
    for f in files:
        syms = json.loads(f["symboles"] or "[]")
        if symbole and any(symbole == s or symbole in s.split(".") for s in syms):
            resultats.setdefault(f["file_id"], {"file_id": f["file_id"], "nom": f["nom"], "rangée": "symbole_exact", "score": 100})

    # 2) nom de fichier mentionné
    for f in files:
        nom = (f["nom"] or "").lower()
        base = nom.rsplit(".", 1)[0] if "." in nom else nom
        if base and len(base) > 2 and base in req.lower():
            resultats.setdefault(f["file_id"], {"file_id": f["file_id"], "nom": f["nom"], "rangée": "nom_fichier", "score": 80})

    # 3) chunks : symbole dans chunk > BM25
    docs = [(r["id"], r["texte"]) for r in _CONN.execute("SELECT id, texte FROM chunks").fetchall()]
    if docs:
        bm = _bm25(req, docs[:2000])
        # v10.7/v10.8 : SEUIL BM25 RELEVÉ (0.8 → 2.0) — un match sur UN seul
        # token (ex. « capitale » dans une docstring) n'est plus classé
        # « résultat ». Vide honnête au lieu de bruit.
        rank = {cid: sc for sc, cid in bm[: limite * 3] if sc > 2.0}
        rows = _CONN.execute(f"SELECT id, file_id, idx, texte, symboles FROM chunks WHERE id IN ({','.join('?' * min(len(rank), 30))})",
                             list(rank.keys())[:30]).fetchall() if rank else []
        for r in rows:
            if r["file_id"] in fixtures:   # v10.8 (Classe 2) : fixtures exclues
                continue
            syms = json.loads(r["symboles"] or "[]")
            priorite = 60 if (symbole and symbole in syms) else 30
            score = priorite + rank.get(r["id"], 0)
            cle = f"{r['file_id']}#{r['idx']}"
            resultats[cle] = {"file_id": r["file_id"], "idx": r["idx"], "rangée": "chunk",
                              "texte": r["texte"][:600], "score": round(score, 2)}

    tries = sorted(resultats.values(), key=lambda x: -x.get("score", 0))[:limite]
    return tries


def stat() -> dict[str, Any]:
    def compte(table):
        return _CONN.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]
    return {"tours": compte("tours"), "faits": compte("faits"), "erreurs": compte("erreurs"),
            "fichiers": compte("fichiers"), "chunks": compte("chunks")}


# ------------------------------------------------------- télémétrie de sortie (v10.9)
def enregistrer_sortie(fil_id: str, type_tache: str, classe: str, codes: list[str],
                       duree_ms: int = 0, non_reponse: str = "",
                       variante: str = "", empreinte: str = "") -> None:
    """v10.9 — canari de sortie : chaque réponse terminale est classée
    (outillee / modele / hegdee / inconnu_honnete / politique /
    conversationnelle) avec ses codes de raison internes. v10.9.1 ajoute la
    VARIANTE de pool tirée et la SIGNATURE squelette (mesure de diversité :
    taux de réponses uniques, répétitions de moule). Le canari est de la
    TÉLÉMÉTRIE, pas un mécanisme d'application : il ne réécrit jamais."""
    with _VERROU:
        _CONN.execute(
            "INSERT INTO telemetrie_sorties (ts, fil_id, type_tache, classe, codes, duree_ms, "
            "non_reponse, variante, empreinte) VALUES (?,?,?,?,?,?,?,?,?)",
            (time.time(), fil_id[:60], type_tache[:30], classe[:30],
             json.dumps(codes or [])[:500], int(duree_ms), (non_reponse or "")[:60],
             (variante or "")[:60], (empreinte or "")[:20]))
        # borne douce : 20 000 dernières entrées suffisent pour une distribution
        _CONN.execute(
            "DELETE FROM telemetrie_sorties WHERE id NOT IN "
            "(SELECT id FROM telemetrie_sorties ORDER BY id DESC LIMIT 20000)")
        _CONN.commit()


def distribution_sortie() -> dict[str, Any]:
    """Distribution des classes terminales (global + par domaine type_tache),
    le taux de non-réponses détectées par le canari (doit tendre vers 0) et,
    v10.9.1, la DIVERSITÉ des sorties (réponses uniques / répétitions de
    moule, mesurée sur la signature squelette)."""
    rows = _CONN.execute("SELECT type_tache, classe, non_reponse, variante, empreinte "
                         "FROM telemetrie_sorties").fetchall()
    global_classes: dict[str, int] = {}
    par_domaine: dict[str, dict[str, int]] = {}
    n_nr = 0
    empreintes: dict[str, int] = {}
    for r in rows:
        cl = r["classe"] or "?"
        global_classes[cl] = global_classes.get(cl, 0) + 1
        par_domaine.setdefault(r["type_tache"] or "?", {})
        par_domaine[r["type_tache"] or "?"][cl] = par_domaine[r["type_tache"] or "?"].get(cl, 0) + 1
        if (r["non_reponse"] or "").strip():
            n_nr += 1
        emp = (r["empreinte"] or "").strip()
        if emp:
            empreintes[emp] = empreintes.get(emp, 0) + 1
    total = len(rows)
    n_emps = len(empreintes)
    top = sorted(empreintes.items(), key=lambda x: -x[1])[:5]
    diversite = {
        "signatures": n_emps,
        "avec_signature": sum(empreintes.values()),
        "taux_unique_pct": round(100 * n_emps / sum(empreintes.values()), 1)
                           if empreintes else 0.0,
        "top_repetees": [{"signature": s, "n": n} for s, n in top if n > 1],
    }
    return {
        "total": total,
        "non_reponses": n_nr,
        "diversite": diversite,
        "par_classe": {k: {"n": v, "pct": round(100 * v / total, 1)} for k, v in
                       sorted(global_classes.items(), key=lambda x: -x[1])} if total else {},
        "par_domaine": {d: {k: {"n": v, "pct": round(100 * v / sum(dc.values()), 1)}
                            for k, v in sorted(dc.items(), key=lambda x: -x[1])}
                        for d, dc in sorted(par_domaine.items())},
    }


# ------------------------------------------------------------------ entrainement
def entrainer(question: str, reponse_attendue: str, source: str = "api") -> dict[str, Any]:
    """Ajoute une paire Q/R au corpus (mémoire L5, source traçable, jamais vérité absolue)."""
    DOSSIER.mkdir(parents=True, exist_ok=True)
    entree = {"question": question, "reponse_attendue": reponse_attendue, "source": source, "ts": time.time()}
    with open(CORPUS, "a", encoding="utf-8") as f:
        f.write(json.dumps(entree, ensure_ascii=False) + "\n")
    id_fait = memoriser_fait(f"{question.strip()} → {reponse_attendue.strip()}", source=f"corpus:{source}",
                             confiance=0.7, verifie=False, scope="general")
    return {"statut": "SUPPORTED", "ajoute": True, "fait_id": id_fait}
