"""Moteur LLM — provider abstrait, pont par défaut vers llm-bridge (:3015).

Le moteur n'est PAS l'autorité : il explique et synthétise à partir des
observations vérifiées. S'il est indisponible, les branches déterministes
continuent de fonctionner (réponses templates).

v10.9.2 (incident P0 « LLM indisponible : HTTP Error 502 ») — RÉSILIENCE :
- Toute erreur du pont est CODIFIÉE : `complete()` retourne
  {"erreur": "<libellé interne stable>", "code": "<CODE>", "detail_interne": …}.
  La chaîne brute (HTTPError urllib « HTTP Error 502: Bad Gateway », corps
  upstream, URL) ne quitte JAMAIS ce module — elle vit uniquement dans
  `detail_interne` (télémétrie/trace serveur, jamais rendue à l'utilisateur).
- `disponible()` lit le drapeau `llm_disponible` du pont v2 (circuit-breaker) :
  un circuit OUVERT court-circuite l'appel LLM immédiatement (latence ~0,
  les crans (c)/(d) prennent le relais sans attendre un timeout).
- Retry interne léger (1 reprise) sur erreur réseau pure (URLError) — le pont
  gère déjà 429/5xx avec backoff, doubler ici ne servirait qu'aux pannes réseau.
- `statut_providers()` : état du pont (/statut, cache 5 s) pour GET /telemetrie.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

BRIDGE = os.environ.get("ATHENA_LLM_BRIDGE", "http://127.0.0.1:3015")
TIMEOUT = 60

# Codes stables retournés par le pont v2 (miroir de index.ts) — utilisables
# pour la télémétrie et les décisions de repli, JAMAIS affichés tels quels.
CODES_CONUS = ("RATE_LIMITED", "TIMEOUT", "UPSTREAM_ERREUR", "CIRCUIT_OUVERT",
               "QUEUE_SATUREE", "REQUETE_INVALIDE", "CACHE_SERVI")

# Libellé interne UNIQUE (jamais un détail HTTP) — il reste dans la trace
# serveur ; l'utilisateur ne voit que la politique de dégradation (N4).
LIBELLE_INDISPONIBLE = "MODELE_INDISPONIBLE"


class MoteurLLM:
    def __init__(self, base: str = BRIDGE):
        self.base = base.rstrip("/")
        self._sante_ts = 0.0
        self._sante = False
        self._llm_dispo = False
        self._statut_ts = 0.0
        self._statut: dict[str, Any] | None = None
        self._modeles: dict[str, Any] | None = None
        self._modeles_ts = 0.0

    # ----------------------------------------------------------------- santé
    def disponible(self, cache_s: float = 15.0) -> bool:
        """v10.9.2 : santé = le pont répond ET son circuit n'est pas OUVERT.
        Un circuit ouvert signifie « l'upstream est saturé » : les appels
        seraient condamnés, autant passer immédiatement au mode déterministe."""
        if time.time() - self._sante_ts < cache_s:
            return self._llm_dispo
        ok = False
        llm_dispo = False
        try:
            with urllib.request.urlopen(f"{self.base}/sante", timeout=3) as r:
                data = json.loads(r.read().decode())
                ok = (r.status == 200)
                llm_dispo = bool(data.get("llm_disponible", ok))
        except Exception:
            ok = False
        self._sante = ok
        self._llm_dispo = ok and llm_dispo
        self._sante_ts = time.time()
        return self._llm_dispo

    # ------------------------------------------------------------- complétion
    def complete(self, messages: list[dict[str, str]], temperature: float = 0.6,
                 max_tokens: int = 1200, model_id: str | None = None) -> dict[str, Any] | None:
        """Complétion via le pont. En cas d'échec, retourne un dict codifié :
        {"erreur": LIBELLE_INDISPONIBLE, "code": <code pont>, "detail_interne": <brut>}.
        Le champ `detail_interne` ne doit JAMAIS être rendu à l'utilisateur.
        v10.9.4 (HUD) : `model_id` (id choisi dans le HUD) est transmis au pont
        qui route DIRECTEMENT vers ce modèle ; en cas d'échec le pont retombe
        sur la cascade et met "repli": true — drapeau NEUTRE qui remonte tel
        quel (jamais de nom de provider ni d'erreur HTTP dans ce champ)."""
        if not messages:
            return None
        corps_envoye: dict[str, Any] = {"messages": messages, "temperature": temperature,
                                        "max_tokens": max_tokens}
        if model_id and model_id.strip() and model_id.strip().lower() != "auto":
            corps_envoye["model"] = model_id.strip()[:120]
        corps = json.dumps(corps_envoye).encode()
        debut = time.time()
        dernier: dict[str, Any] | None = None
        for essai in range(2):  # 1 reprise : uniquement pannes réseau pures
            req = urllib.request.Request(f"{self.base}/complete", data=corps,
                                         headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    data = json.loads(r.read().decode())
                data["duree_ms"] = data.get("duree_ms") or int((time.time() - debut) * 1000)
                return data
            except urllib.error.HTTPError as e:
                # v10.9.2 : le corps du pont est JSON structuré {erreur, code}.
                # La chaîne str(e) (« HTTP Error 502: Bad Gateway ») est le
                # vecteur de fuite historique — elle reste ENCAPSULÉE ici.
                try:
                    corps_erreur = json.loads(e.read().decode())
                except Exception:
                    corps_erreur = {}
                code = str(corps_erreur.get("code") or "UPSTREAM_ERREUR")
                brut = f"HTTP {e.code} depuis le pont ({code})"
                dernier = {"erreur": LIBELLE_INDISPONIBLE, "code": code,
                           "detail_interne": brut,
                           "duree_ms": int((time.time() - debut) * 1000)}
                if code in ("RATE_LIMITED", "CIRCUIT_OUVERT", "QUEUE_SATUREE"):
                    break  # quota/circuit : une reprise immédiate ne sert à rien
            except Exception as e:
                # réseau pur (pont joignable ?) : une reprise peut suffire
                dernier = {"erreur": LIBELLE_INDISPONIBLE, "code": "PONT_INJOIGNABLE",
                           "detail_interne": f"{type(e).__name__}",
                           "duree_ms": int((time.time() - debut) * 1000)}
        return dernier

    # ------------------------------------------------------------- recherche
    def search(self, query: str, num: int = 6) -> dict[str, Any] | None:
        corps = json.dumps({"query": query, "num": num}).encode()
        req = urllib.request.Request(f"{self.base}/search", data=corps,
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception:
            # v10.9.2 : code stable, pas de chaîne brute (le pont logue le détail).
            return {"erreur": "RECHERCHE_INDISPONIBLE"}

    # ------------------------------------------------------------- télémétrie
    def statut_providers(self, cache_s: float = 5.0) -> dict[str, Any]:
        """État du pont v2 (circuit, compteurs, providers) — télémétrie seule."""
        if self._statut is not None and time.time() - self._statut_ts < cache_s:
            return self._statut
        try:
            with urllib.request.urlopen(f"{self.base}/statut", timeout=2) as r:
                self._statut = json.loads(r.read().decode())
        except Exception:
            self._statut = {"dispo": False, "erreur": "PONT_INJOIGNABLE"}
        self._statut_ts = time.time()
        return self._statut

    # --------------------------------------------------------- modèles (HUD)
    def liste_modeles(self, rafraichir: bool = False) -> dict[str, Any]:
        """v10.9.4 (HUD) : liste des modèles exposés par le pont — cloud
        (catalogue pollinations + zai) et locaux détectés (best-effort).
        GET /modeles (cache court) ou POST /modeles (rafraîchissement forcé :
        re-catalogue + re-scan locaux). Jamais bloquant : en cas de pont
        injoignable → {modeles: [], dispo: False} — le HUD affichera juste
        la sélection « auto » et la cascade par défaut continue de servir."""
        cache = self._modeles
        if not rafraichir and cache is not None and time.time() - self._modeles_ts < 5.0:
            return cache
        methode = "POST" if rafraichir else "GET"
        req = urllib.request.Request(f"{self.base}/modeles", method=methode)
        try:
            with urllib.request.urlopen(req, timeout=14 if rafraichir else 6) as r:
                data = json.loads(r.read().decode())
            sortie = {"dispo": True,
                      "modeles": [m for m in data.get("models", [])
                                  if isinstance(m, dict) and m.get("id")]}
        except Exception:
            sortie = {"dispo": False, "modeles": []}
        self._modeles = sortie
        self._modeles_ts = time.time()
        return sortie


MOTEUR = MoteurLLM()
