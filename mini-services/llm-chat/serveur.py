"""Athéna v10.6 — serveur HTTP MINCE (spécification point 29 : HTTP → Agent).

Toute l'intelligence vit dans athena/ ; ce fichier ne fait que :
POST /chat               → run_agent() (attachments[] → FILE_DATA, ids validés)
POST /entrainer          → corpus (paire Q/R dédoublonnée par (question, source))
GET  /entrainer          → état (conversations = fils distincts)
DELETE /entrainer        → purge conversations (exige {confirm:true}, F1)
GET  /files              → liste harmonisée (status/kind/sha256/taille, F7)
GET  /files/{id}         → fiche d'un fichier ; /files/{id}/contenu → texte brut (F9)
DELETE /files/{id}       → purge réelle d'un fichier (F4)
POST /files/ingest       → ingestion multipart (exécutables refusés, F14)
POST /evals              → suite de régression (5/5 obligatoire)
GET  /sante              → santé
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import uuid  # noqa: E402

from athena import __version__  # noqa: E402
from athena.agent.agent import run_agent  # noqa: E402
from athena.evals import runner as evals  # noqa: E402
from athena.llm.engine import MOTEUR  # noqa: E402
from athena.memory import store as memoire  # noqa: E402
from athena.tools import files as tfiles  # noqa: E402

app = FastAPI(title="Athéna", version=__version__, docs_url=None, redoc_url=None)


class MessageHistorique(BaseModel):
    role: str = Field(pattern="^(utilisateur|assistant)$")
    contenu: str


class PieceJointe(BaseModel):
    """v10.3 — pièce jointe transmise par la passerelle (file_id + nom)."""
    file_id: str = Field(min_length=1, max_length=200)
    name: str | None = Field(default=None, max_length=300)


class RequeteChat(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    historique: list[MessageHistorique] = []
    fil_id: str | None = None
    options: dict = {}
    attachments: list[PieceJointe] = []
    # v10.9.4 (HUD) : modèle choisi côté UI (id complet « genre:nom »).
    # Optionnel : absent/vide/"auto" → cascade par défaut inchangée.
    model_id: str | None = Field(default=None, max_length=120)


class RequeteEntrainement(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    reponse_attendue: str = Field(min_length=1, max_length=4000)


class RequeteConfirmation(BaseModel):
    """v10.6 (F1) : toute purge exige une confirmation EXPLICITE du corps —
    plus aucun wipe possible par un DELETE nu."""
    confirm: bool = False


@app.get("/sante")
def sante() -> dict:
    return {"ok": True, "service": "athena", "version": __version__,
            "llm": MOTEUR.disponible(), "memoire": memoire.stat()}


@app.get("/telemetrie")
def telemetrie() -> dict:
    """v10.9 — canari de sortie : distribution des classes terminales
    (outillee / modele / hegdee / inconnu_honnete / politique /
    conversationnelle) par domaine, compteur de non-réponses détectées (doit
    tendre vers 0), v10.9.1 DIVERSITÉ des sorties (signatures uniques,
    taux_unique_pct, top_repetees) et v10.9.2 ÉTAT PROVIDERS (circuit,
    compteurs du pont LLM — télémétrie infrastructure, aucune chaîne brute)."""
    distribution = memoire.distribution_sortie()
    # v10.9.2 : état du pont LLM (best-effort, timeout court, cache 5 s).
    try:
        distribution["providers"] = MOTEUR.statut_providers()
    except Exception:
        distribution["providers"] = {"dispo": False, "erreur": "PONT_INJOIGNABLE"}
    return distribution


@app.post("/chat")
def chat(req: RequeteChat) -> dict:
    try:
        max_etapes = int(req.options.get("max_etapes", 14))
        mode = req.options.get("mode", "auto")
        historique = [{"role": m.role, "contenu": m.contenu} for m in req.historique][:20]
        pieces = [{"file_id": p.file_id, "name": p.name} for p in req.attachments][:10]
        # v10.6 (F15) : un file_id FANTÔME n'est plus accepté en silence —
        # l'utilisateur croyait le fichier joint alors qu'il n'existait pas.
        # Refus dédié (400) avec la liste des ids inconnus.
        inconnus = [p["file_id"] for p in pieces if memoire.lire_fichier(p["file_id"]) is None]
        if inconnus:
            return JSONResponse(status_code=400, content={
                "erreur": "fichier(s) joint(s) introuvable(s) dans le registre : "
                          + ", ".join(inconnus),
                "fichiers_inconnus": inconnus,
            })
        return run_agent(req.question, historique=historique, fil_id=req.fil_id,
                         max_etapes=max_etapes, mode=mode, attachments=pieces,
                         model_id=(req.model_id or None))
    except Exception as e:  # jamais de crash silencieux : échec honnête
        # v10.9.2 (P0) : le DÉTAIL (type + message d'exception) reste dans le
        # log serveur (uvicorn/console). Le corps HTTP n'emporte qu'une phrase
        # neutre — la route.ts ne doit jamais pouvoir afficher une traceback.
        print(f"[serveur] erreur interne /chat : {type(e).__name__}: {e}", flush=True)
        return JSONResponse(status_code=500, content={
            "erreur": "une erreur interne est survenue côté moteur",
            "reponse": "Une erreur interne est survenue. Je préfère l'admettre que d'inventer une réponse.",
            "statut": "ECHEC_HONNETE"})


@app.post("/entrainer")
def entrainer(req: RequeteEntrainement) -> dict:
    return memoire.entrainer(req.question, req.reponse_attendue)


@app.get("/entrainer")
def etat_entrainement() -> dict:
    """État d'entraînement (lecture seule) pour la passerelle : compteurs
    mémoire + corpus d'erreurs récents. v10.6 (F2) : « conversations » compte
    les FILS DISTINCTS (vraies conversations), plus le nombre brut de lignes
    mémoire — un échange question/réponse ne gonfle plus le compteur de 2.
    La machine d'état complète (collecte web, progression, PATCH) n'existe pas
    dans ce moteur — la passerelle le présente honnêtement comme « en pause »."""
    s = memoire.stat()
    lignes = [
        {
            "id": r.get("id"),
            "question": r.get("question", ""),
            "attendu": r.get("attendu", ""),
            "prediction": r.get("prediction", ""),
            "source": r.get("source", "eval"),
            "tache": r.get("tache", ""),
            "ts": r.get("ts", 0),
            "corrige": bool(r.get("corrige")),
        }
        for r in memoire.corpus_erreurs(50)
    ]
    return {
        "conversations": memoire.compter_conversations(),
        "tours_memoire": s.get("tours", 0),
        "base_connaissances": s.get("faits", 0),
        "preuves": s.get("chunks", 0),
        "exemples": lignes,
    }


@app.delete("/entrainer")
def entrainer_delete(req: RequeteConfirmation) -> dict:
    """v10.6 (F1) : purge RÉELLE des conversations enregistrées — uniquement
    avec {confirm:true} (anti-wipe accidentel, contrat du frontend v20260922k).
    Seule la mémoire de conversation (tours) est vidée : le corpus d'erreurs
    (L5) et les faits (L3) sont préservés."""
    if not req.confirm:
        return JSONResponse(status_code=400, content={
            "erreur": "confirmation manquante : renvoyer {\"confirm\": true} pour purger les conversations."
        })
    supprimes = memoire.purger_tours()
    return {
        "statut": "purge",
        "tours_supprimes": supprimes,
        "conversations": 0,
        "message": f"{supprimes} ligne(s) de conversation supprimée(s). Corpus d'erreurs et base de connaissances conservés.",
    }


@app.get("/files")
def lister_fichiers() -> dict:
    return {"fichiers": memoire.lister_fichiers()}


@app.get("/files/{file_id}")
def ficher_fichier(file_id: str) -> dict:
    """v10.6 (F8/F10) : fiche d'UN fichier — le client peut cibler un id."""
    rec = memoire.lire_fichier(file_id)
    if rec is None:
        raise HTTPException(404, "fichier introuvable")
    return {"fichier": rec}


@app.get("/files/{file_id}/contenu")
def contenu_fichier(file_id: str) -> Response:
    """v10.6 (F9) : contenu BRUT du fichier (chunks réassemblés, ordre idx) —
    support du téléchargement ?raw=1 de la passerelle."""
    texte = memoire.lire_contenu_fichier(file_id)
    if texte is None:
        raise HTTPException(404, "fichier introuvable")
    rec = memoire.lire_fichier(file_id)
    nom = (rec or {}).get("nom") or f"{file_id}.txt"
    return Response(
        content=texte,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nom}"'},
    )


@app.delete("/files/{file_id}")
def purger_fichier(file_id: str) -> dict:
    """v10.6 (F4) : purge RÉELLE — le frontend appelle DELETE ?id=… pour les
    échecs d'upload, les chips retirées et les envois abandonnés."""
    if not memoire.supprimer_fichier(file_id):
        raise HTTPException(404, "fichier introuvable")
    return {"statut": "purge", "file_id": file_id}


@app.post("/files/ingest")
async def ingest(fichier: UploadFile = File(...)) -> dict:
    octets = await fichier.read()
    if not octets:
        raise HTTPException(400, "fichier vide")
    resultat = tfiles.ingester(fichier.filename or "fichier", octets)
    if resultat.get("statut") == "ERREUR":
        # v10.6 (F14/F22) : un refus est traçable (registre « failed ») et
        # renvoyé comme 422 explicite — plus d'exe « indexé » en silence.
        file_id = uuid.uuid4().hex[:12]
        memoire.enregistrer_echec_fichier(
            file_id, fichier.filename or "fichier",
            resultat.get("mime", "application/octet-stream"),
            len(octets), resultat.get("raison", "ingestion refusée"))
        return JSONResponse(status_code=422, content={
            "statut": "ERREUR",
            "raison": resultat.get("raison", "ingestion refusée"),
            "file_id": file_id,
            "nom": fichier.filename or "fichier",
        })
    return resultat


@app.post("/evals")
def lancer_evals() -> dict:
    r = evals.lancer(verbose=False)
    return JSONResponse(status_code=200 if r["succes_global"] else 500, content=r)


@app.get("/modeles")
def modeles_liste() -> dict:
    """v10.9.4 (HUD) : liste des modèles (cloud + locaux best-effort) via le
    pont. Jamais bloquant : pont injoignable → {dispo: False, modeles: []} —
    l'UI garde la sélection « auto » et la cascade continue de servir."""
    try:
        return MOTEUR.liste_modeles(rafraichir=False)
    except Exception as e:
        print(f"[serveur] /modeles : {type(e).__name__}", flush=True)
        return {"dispo": False, "modeles": []}


@app.post("/modeles")
def modeles_rafraichir() -> dict:
    """v10.9.4 (HUD) : rafraîchissement manuel (re-catalogue cloud + re-scan
    des serveurs locaux Ollama/LM Studio/llama.cpp)."""
    try:
        return MOTEUR.liste_modeles(rafraichir=True)
    except Exception as e:
        print(f"[serveur] /modeles POST : {type(e).__name__}", flush=True)
        return {"dispo": False, "modeles": []}
