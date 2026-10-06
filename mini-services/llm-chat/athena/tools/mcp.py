"""Pont MCP (Model Context Protocol) — n'importe quel serveur devient un outil Athéna.

Deux transports, même contrat JSON-RPC 2.0 :
- local   : sous-processus stdio, messages délimités par « \\n » ;
- distant : HTTP (Streamable HTTP) — POST JSON-RPC, réponse JSON ou SSE.

Configuration : `mini-services/llm-chat/mcp.json` (format « mcpServers »
compatible Claude / opencode) :

    {"mcpServers": {
        "fetch":  {"type": "local",  "command": ["…/uvx.exe", "mcp-server-fetch"]},
        "drive":  {"type": "remote", "url": "https://…/mcp", "headers": {}}
    }}

RÈGLE ABSOLUE : aucun échec MCP ne doit casser /chat. Un serveur mort, un
binaire absent ou un timeout sont CONSTATÉS (`lister()` → etat + raison)
et le résultat d'appel sort en {"statut": "ERREUR", "raison": <codée>}.
"""
from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

CHEMIN_CONFIG = Path(__file__).resolve().parents[2] / "mcp.json"
PROTOCOLE = "2024-11-05"
DELAI_INIT = 12.0        # secondes — démarrage d'un serveur local (uvx/npx)
DELAI_APPEL = 45.0       # secondes — tools/call
DELAI_HTTP = 15.0

_INFO_CLIENT = {"name": "athena", "version": "1.0"}
_FIN = object()          # sentinelle : stdout du sous-processus fermé


class ErreurMCP(Exception):
    """Échec RPC côté serveur (ou timeout) — jamais rendu brut à l'utilisateur."""


# ------------------------------------------------------------------ configuration
def lire_config(chemin: Path | None = None) -> dict[str, dict[str, Any]]:
    """{nom: config} des serveurs activés. Format accepté : mcpServers ou plat."""
    p = chemin or CHEMIN_CONFIG
    try:
        brut = json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(brut, dict):
        return {}
    serveurs = brut.get("mcpServers") or brut.get("serveurs") or brut
    if not isinstance(serveurs, dict):
        return {}
    actifs: dict[str, dict[str, Any]] = {}
    for nom, cfg in serveurs.items():
        if not isinstance(cfg, dict):
            continue
        if cfg.get("enabled") is False:
            continue
        actifs[str(nom)] = cfg
    return actifs


# ----------------------------------------------------------------------- local
class ClientLocal:
    """Serveur MCP en sous-processus stdio."""

    def __init__(self, nom: str, commande: list[str], env: dict | None = None,
                 dossier: str | None = None):
        self.nom = nom
        self.commande = [str(c) for c in commande]
        self.env = {str(k): str(v) for k, v in (env or {}).items()}
        self.dossier = dossier
        self._proc: subprocess.Popen | None = None
        self._q: queue.Queue = queue.Queue()
        self._verrou = threading.Lock()
        self._id = 0

    def demarrer(self) -> dict[str, Any]:
        if not self.commande:
            raise ErreurMCP("commande absente dans mcp.json")
        cmd = list(self.commande)
        # Windows : CreateProcess n'exécute pas .bat/.cmd sans cmd.exe.
        if os.name == "nt" and cmd[0].lower().endswith((".bat", ".cmd")):
            cmd = [os.environ.get("COMSPEC", "cmd.exe"), "/c"] + cmd
        env = {**os.environ, **self.env}
        self._proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
            cwd=self.dossier, env=env)
        threading.Thread(target=self._boucle_lecture, daemon=True).start()
        rep = self._rpc("initialize", {
            "protocolVersion": PROTOCOLE,
            "capabilities": {},
            "clientInfo": _INFO_CLIENT,
        }, delai=DELAI_INIT)
        self._notifier("notifications/initialized")
        return rep if isinstance(rep, dict) else {}

    def _boucle_lecture(self) -> None:
        assert self._proc and self._proc.stdout
        try:
            for ligne in self._proc.stdout:
                ligne = ligne.strip()
                if ligne:
                    try:
                        self._q.put(json.loads(ligne))
                    except Exception:
                        pass  # bannière/bruit d'un serveur chaleureux
        finally:
            self._q.put(_FIN)

    def _ecrire(self, message: dict[str, Any]) -> None:
        if not self._proc or not self._proc.stdin:
            raise ErreurMCP("sous-processus non démarré")
        self._proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self._proc.stdin.flush()

    def _notifier(self, methode: str, params: dict | None = None) -> None:
        try:
            self._ecrire({"jsonrpc": "2.0", "method": methode, "params": params or {}})
        except Exception:
            pass  # notifications non critiques

    def _rpc(self, methode: str, params: dict | None = None,
             delai: float = DELAI_APPEL) -> Any:
        with self._verrou:
            if not self._proc or self._proc.poll() is not None:
                raise ErreurMCP("serveur local arrêté")
            self._id += 1
            rid = self._id
            self._ecrire({"jsonrpc": "2.0", "id": rid, "method": methode,
                          "params": params or {}})
            fin = time.time() + delai
            while True:
                reste = fin - time.time()
                if reste <= 0:
                    raise ErreurMCP(f"timeout {methode} ({delai:.0f}s)")
                try:
                    msg = self._q.get(timeout=min(reste, 1.0))
                except queue.Empty:
                    continue
                if msg is _FIN:
                    raise ErreurMCP("serveur local fermé pendant l'appel")
                if not isinstance(msg, dict) or msg.get("id") != rid:
                    continue  # notification ou réponse d'un autre id
                if "error" in msg:
                    err = msg["error"] or {}
                    raise ErreurMCP(str(err.get("message") or err.get("code") or "erreur RPC"))
                return msg.get("result")

    def outils(self) -> list[dict[str, Any]]:
        res = self._rpc("tools/list", {}, delai=DELAI_APPEL)
        outils = res.get("tools") if isinstance(res, dict) else None
        return outils if isinstance(outils, list) else []

    def appeler(self, nom: str, arguments: dict[str, Any]) -> dict[str, Any]:
        res = self._rpc("tools/call", {"name": nom, "arguments": arguments or {}},
                        delai=DELAI_APPEL)
        if not isinstance(res, dict):
            raise ErreurMCP("réponse illisible")
        if res.get("isError"):
            raise ErreurMCP(_texte_de_contenu(res) or "le serveur a signalé une erreur")
        return res

    def fermer(self) -> None:
        try:
            if self._proc and self._proc.poll() is None:
                self._proc.terminate()
                self._proc.wait(timeout=3)
        except Exception:
            pass


# --------------------------------------------------------------------- distant
class ClientDistant:
    """Serveur MCP distant — Streamable HTTP (POST JSON-RPC, réponse JSON ou SSE)."""

    def __init__(self, nom: str, url: str, entetes: dict | None = None):
        self.nom = nom
        self.url = url
        self.entetes = {str(k): str(v) for k, v in (entetes or {}).items()}
        self._verrou = threading.Lock()
        self._id = 0

    def _post(self, payload: dict[str, Any], delai: float) -> dict[str, Any] | None:
        corps = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        entetes = {"Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream",
                   **self.entetes}
        req = urllib.request.Request(self.url, data=corps, headers=entetes, method="POST")
        with urllib.request.urlopen(req, timeout=delai) as r:
            type_c = (r.headers.get("Content-Type") or "").lower()
            brut = r.read().decode("utf-8", "replace")
        if not brut.strip():
            return None                       # 202 — accusé de réception
        if "text/event-stream" in type_c:
            for ligne in brut.splitlines():
                ligne = ligne.strip()
                if ligne.startswith("data:"):
                    try:
                        return json.loads(ligne[5:].strip())
                    except Exception:
                        continue
            return None
        try:
            return json.loads(brut)
        except Exception:
            return None

    def demarrer(self) -> dict[str, Any]:
        with self._verrou:
            self._id += 1
            rep = self._post({
                "jsonrpc": "2.0", "id": self._id, "method": "initialize",
                "params": {"protocolVersion": PROTOCOLE, "capabilities": {},
                           "clientInfo": _INFO_CLIENT},
            }, DELAI_INIT)
        if not isinstance(rep, dict) or "error" in rep:
            detail = (rep or {}).get("error", {}).get("message") if isinstance(rep, dict) else None
            raise ErreurMCP(detail or "initialize refusé")
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, DELAI_HTTP)
        return rep.get("result") if isinstance(rep.get("result"), dict) else {}

    def _rpc(self, methode: str, params: dict | None = None,
             delai: float = DELAI_APPEL) -> Any:
        with self._verrou:
            self._id += 1
            rep = self._post({"jsonrpc": "2.0", "id": self._id, "method": methode,
                              "params": params or {}}, delai)
        if not isinstance(rep, dict):
            raise ErreurMCP("réponse vide/illisible")
        if "error" in rep:
            err = rep["error"] or {}
            raise ErreurMCP(str(err.get("message") or err.get("code") or "erreur RPC"))
        return rep.get("result")

    def outils(self) -> list[dict[str, Any]]:
        res = self._rpc("tools/list", {}, DELAI_APPEL)
        outils = res.get("tools") if isinstance(res, dict) else None
        return outils if isinstance(outils, list) else []

    def appeler(self, nom: str, arguments: dict[str, Any]) -> dict[str, Any]:
        res = self._rpc("tools/call", {"name": nom, "arguments": arguments or {}}, DELAI_APPEL)
        if not isinstance(res, dict):
            raise ErreurMCP("réponse illisible")
        if res.get("isError"):
            raise ErreurMCP(_texte_de_contenu(res) or "le serveur a signalé une erreur")
        return res

    def fermer(self) -> None:
        pass


# ------------------------------------------------------------------- état global
_VERROU_ETAT = threading.Lock()
_CLIENTS: dict[str, Any] = {}
_ETATS: dict[str, dict[str, Any]] = {}     # nom -> {type, etat, erreur, outils[]}
_CONNECTE = False


def _texte_de_contenu(res: dict[str, Any]) -> str:
    """content[{type:text|…}] → texte lisible, sinon JSON compact."""
    contenu = res.get("content")
    if isinstance(contenu, list):
        morceaux = []
        for part in contenu:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    morceaux.append(str(part.get("text") or ""))
                else:
                    morceaux.append(json.dumps(part, ensure_ascii=False))
        texte = "\n".join(m for m in morceaux if m).strip()
        if texte:
            return texte[:8000]
    return json.dumps(res, ensure_ascii=False)[:8000]


def _nom_registre(serveur: str, outil: str) -> str:
    brut = f"mcp_{serveur}_{outil}".lower()
    nettoye = re.sub(r"[^a-z0-9_]+", "_", brut)
    return re.sub(r"_+", "_", nettoye).strip("_")[:96]


def _construire_client(nom: str, cfg: dict[str, Any]):
    type_srv = str(cfg.get("type") or ("remote" if cfg.get("url") else "local")).lower()
    if type_srv in ("remote", "http", "sse", "url"):
        url = cfg.get("url")
        if not url:
            raise ErreurMCP("champ « url » manquant (type remote)")
        return ClientDistant(nom, str(url), cfg.get("headers"))
    commande = cfg.get("command") or cfg.get("args")
    if isinstance(commande, str):
        commande = commande.split()
    if not commande:
        raise ErreurMCP("champ « command » manquant (type local)")
    return ClientLocal(nom, list(commande), cfg.get("env"), cfg.get("cwd") or cfg.get("dossier"))


def connecter(force: bool = False) -> dict[str, Any]:
    """Démarre tous les serveurs de mcp.json (une seule fois) + enregistre leurs outils.

    Un serveur en échec est RELEVÉ (etat=erreur), jamais remonté en exception.
    """
    global _CONNECTE
    with _VERROU_ETAT:
        if _CONNECTE and not force:
            return lister()
        config = lire_config()
        for nom, cfg in config.items():
            if nom in _ETATS and not force:
                continue
            try:
                client = _construire_client(nom, cfg)
                client.demarrer()
                outils = client.outils()
                _CLIENTS[nom] = client
                _ETATS[nom] = {"type": "local" if isinstance(client, ClientLocal) else "remote",
                               "etat": "connecte", "erreur": None,
                               "outils": [_fiche_outil(nom, o) for o in outils]}
            except Exception as e:            # noqa: BLE001 — tout est constaté
                _CLIENTS.pop(nom, None)
                _ETATS[nom] = {"type": str(cfg.get("type") or "local"),
                               "etat": "erreur", "erreur": str(e)[:300], "outils": []}
        # retirer les serveurs disparus de la config
        for nom in list(_ETATS):
            if nom not in config:
                _CLIENTS.pop(nom, None)
                _ETATS.pop(nom, None)
        _CONNECTE = True
        _enregistrer_outils()
        return lister()


def _fiche_outil(serveur: str, brut: dict[str, Any]) -> dict[str, Any]:
    nom = str(brut.get("name") or "").strip()
    schema = brut.get("inputSchema")
    props = (schema or {}).get("properties") if isinstance(schema, dict) else None
    return {
        "nom": nom,
        "registre": _nom_registre(serveur, nom),
        "description": str(brut.get("description") or "")[:400],
        "parametres": sorted(props.keys()) if isinstance(props, dict) else [],
        "risque": "moyen",
    }


def _enregistrer_outils() -> None:
    """Ajoute un outil `mcp_<serveur>_<outil>` au registre d'Athéna."""
    from .registry import REGISTRE, Tool
    for nom, etat in _ETATS.items():
        for o in etat.get("outils", []):
            if not o["nom"]:
                continue
            REGISTRE[o["registre"]] = Tool(
                nom=o["registre"],
                description=f"MCP · {nom}.{o['nom']} — {o['description'] or 'outil serveur externe'}",
                schema_entree={p: "str" for p in o["parametres"]} or {"requete": "str"},
                risque="moyen",
                autorite=False,
                executer=_fabriquer_appeleur(nom, o["nom"], o["parametres"]),
            )


def _fabriquer_appeleur(serveur: str, outil: str, parametres: list[str]):
    def _appeler(**kwargs: Any) -> dict[str, Any]:
        args = {k: v for k, v in kwargs.items() if v is not None}
        return appeler(serveur, outil, args)
    _appeler.__name__ = f"mcp_{serveur}_{outil}"
    return _appeler


def lister() -> dict[str, Any]:
    """Vue d'ensemble pour l'API/UI (état + outils + raisons d'échec)."""
    return {
        "config": str(CHEMIN_CONFIG),
        "serveurs": [
            {"nom": n, **e, "nombre_outils": len(e.get("outils", []))}
            for n, e in sorted(_ETATS.items())
        ],
    }


def appeler(serveur: str, outil: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Appel synchrone (endpoint /mcp/appel + outils du registre)."""
    with _VERROU_ETAT:
        etat = _ETATS.get(serveur)
        client = _CLIENTS.get(serveur)
    if etat is None or client is None:
        connecter()
        etat = _ETATS.get(serveur)
        client = _CLIENTS.get(serveur)
    if client is None:
        return {"statut": "ERREUR",
                "raison": f"serveur MCP « {serveur} » absent ou non connecté"
                          + (f" ({etat.get('erreur')})" if etat and etat.get("erreur") else "")}
    essais_instance = 0
    while True:
        try:
            rep = client.appeler(outil, arguments or {})
            break
        except ErreurMCP as e:
            # v20261005 (roblox) — latence d'enregistrement d'instance : un
            # proxy StudioMCP neuf met ~5-20 s à voir la session ouverte ; le
            # PREMIER appel d'une session tombait en « No Roblox Studio
            # instances are connected ». Reprise bornée sur ce signal seul.
            if "No Roblox Studio instances" in str(e) and essais_instance < 3:
                essais_instance += 1
                time.sleep(4)
                continue
            return {"statut": "ERREUR", "raison": str(e)[:400]}
        except Exception as e:                # noqa: BLE001 — constaté, pas propagé
            return {"statut": "ERREUR", "raison": str(e)[:400]}
    texte = _texte_de_contenu(rep)
    return {"statut": "SUPPORTED", "serveur": serveur, "outil": outil,
            "resultat": texte, "preuve": f"MCP · {serveur}.{outil}"}


# ------------------------------------------- appel « automatique » depuis un texte
_MOTIF_PARENTH = re.compile(r"mcp\s*[\(\[]\s*([^\)\]]{1,200})[\)\]]", re.IGNORECASE)
_MOTIF_NU = re.compile(r"\b([A-Za-z0-9_-]{2,60})[.:]([A-Za-z0-9_.-]{1,80})\b")


def _extraire_appel_direct(texte: str) -> tuple[str, str, dict[str, Any]] | None:
    """Syntaxe explicite : mcp(serveur.outil) {…json…} | serveur.outil {…}."""
    m = _MOTIF_PARENTH.search(texte)
    if m:
        cible, debut = m.group(1).strip(), m.start()
    else:
        m = _MOTIF_NU.search(texte)
        if not m:
            return None
        cible, debut = f"{m.group(1)}.{m.group(2)}", m.start()
    cible = cible.strip().strip("\"'").strip()
    serveur, outil = cible, ""
    for sep in (".", ":", "/"):
        if sep in cible:
            parties = [p.strip() for p in cible.split(sep, 1)]
            serveur, outil = parties[0], parties[1] if len(parties) > 1 else ""
            break
    args: dict[str, Any] = {}
    crochet = texte.find("{", debut)
    if crochet >= 0:
        fin = texte.find("}", crochet)
        if fin > crochet:
            try:
                extraits = json.loads(texte[crochet:fin + 1])
                if isinstance(extraits, dict):
                    args = extraits
            except Exception:
                pass
    return serveur, outil, args


def _liste_outils_utiles() -> list[dict[str, Any]]:
    sortie = []
    for nom, etat in sorted(_ETATS.items()):
        if etat.get("etat") != "connecte":
            continue
        for o in etat.get("outils", []):
            sortie.append({"serveur": nom, "outil": o["nom"],
                           "description": o["description"],
                           "parametres": o["parametres"]})
    return sortie


def appeler_depuis_texte(texte: str) -> dict[str, Any]:
    """Outil `mcp_appel` : traduit une demande en appel réel d'un serveur MCP.

    1. syntaxe explicite mcp(serveur.outil) {…}  → appel direct ;
    2. sinon, le LLM choisit serveur+outil+arguments parmi l'inventaire ;
    3. sinon ERREUR CODÉE listant les outils disponibles (jamais d'invention).
    """
    connecter()
    disponible = _liste_outils_utiles()
    direct = _extraire_appel_direct(texte) if texte else None
    if direct:
        serveur, outil, args = direct
        if outil and (serveur in _ETATS or any(d["serveur"] == serveur for d in disponible)):
            return appeler(serveur, outil, args)
    if not disponible:
        return {"statut": "UNKNOWN",
                "raison": "aucun serveur MCP connecté — voir /mcp pour la cause "
                          "(config mcp.json)"}
    choix = _choisir_avec_llm(texte, disponible)
    if choix is None:
        return {"statut": "UNKNOWN", "raison": "outil MCP non identifié dans la demande",
                "outils_disponibles": disponible[:40]}
    serveur, outil, args = choix
    return appeler(serveur, outil, args)


def _choisir_avec_llm(texte: str, disponible: list[dict[str, Any]]) -> tuple[str, str, dict] | None:
    """Le LLM ne fait que TRADUIRE la demande en (serveur, outil, arguments).

    Il ne décide pas de l'action et ne voit que l'inventaire : toute hésitation
    renvoie None → l'appel n'a pas lieu (pas d'invention d'outil).
    """
    from ..llm.engine import MOTEUR
    if not texte or not MOTEUR.disponible():
        return None
    inventaire = json.dumps(disponible[:60], ensure_ascii=False, indent=1)
    rep = MOTEUR.complete([
        {"role": "system", "content":
            "Tu traduis une demande en appel d'outil MCP. Réponds UNIQUEMENT par un objet JSON "
            "de la forme {\"serveur\": str, \"outil\": str, \"arguments\": {}} pris dans "
            "l'inventaire fourni. Aucun texte autour. Si l'inventaire ne contient pas l'outil "
            "voulu, réponds exactement null."},
        {"role": "user", "content": f"INVENTAIRE :\n{inventaire}\n\nDEMANDE :\n{texte}"},
    ], temperature=0.0, max_tokens=600)
    if not isinstance(rep, dict):
        return None
    if "erreur" in rep:
        return None
    brut = str(rep.get("texte") or "")
    if not brut.strip():
        return None
    m = re.search(r"\{.*\}|\bnull\b", brut, re.DOTALL)
    if not m:
        return None
    if m.group(0) == "null":
        return None
    try:
        choix = json.loads(m.group(0))
    except Exception:
        return None
    if not isinstance(choix, dict):
        return None
    serveur, outil = str(choix.get("serveur") or ""), str(choix.get("outil") or "")
    if not serveur or not outil:
        return None
    if not any(d["serveur"] == serveur and d["outil"] == outil for d in disponible):
        return None
    args = choix.get("arguments")
    return serveur, outil, args if isinstance(args, dict) else {}
