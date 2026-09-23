"""Vérificateur code — simulateur AST Python + sandbox subprocess.

Le LLM n'explique QUE ; la sortie du code est déterminée par :
  1. le simulateur AST (sous-ensemble Python, pas d'exécution arbitraire),
  2. un croisement avec python sandboxé (subprocess, -I, timeout).
En cas de désaccord → le sandbox fait foi et une contradiction est levée.
"""
from __future__ import annotations

import ast
import subprocess
import sys
from typing import Any

MAX_PAS = 100_000
MAX_PROFONDEUR = 64
MAX_SORTIE = 4000


class ErreurSimulateur(Exception):
    def __init__(self, construct: str):
        super().__init__(construct)
        self.construct = construct


class _Env(dict):
    pass


class _Simulateur:
    """Interpréteur déterministe d'un sous-ensemble de Python."""

    def __init__(self, code: str):
        self.arbre = ast.parse(code)
        self.env: _Env = _Env()
        self.sortie: list[str] = []
        self.pas = 0

    # ------------------------------------------------------------- utilitaires
    def _tick(self):
        self.pas += 1
        if self.pas > MAX_PAS:
            raise ErreurSimulateur("limite de pas dépassée (boucle infinie ?)")

    def _fmt(self, v) -> str:
        if isinstance(v, str):
            return v
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        if isinstance(v, bool):
            return "True" if v else "False"
        if isinstance(v, list):
            return "[" + ", ".join(self._fmt(x) for x in v) + "]"
        return str(v)

    # ---------------------------------------------------------------- exec
    def executer(self) -> list[str]:
        self._bloc(self.arbre.body, global_env=True)
        return list(self.sortie)

    def _bloc(self, corps, global_env=False):
        for noeud in corps:
            self._tick()
            if isinstance(noeud, ast.Assign):
                val = self._eval(noeud.value)
                for cible in noeud.targets:
                    self._affecter(cible, val)
            elif isinstance(noeud, ast.AugAssign):
                val = self._eval(noeud.value)
                actuel = self._lire(noeud.target)
                self._affecter(noeud.target, self._binop(actuel, noeud.op, val))
            elif isinstance(noeud, ast.AnnAssign) and noeud.value is not None:
                self._affecter(noeud.target, self._eval(noeud.value))
            elif isinstance(noeud, ast.Expr):
                self._eval(noeud.value)
            elif isinstance(noeud, ast.If):
                if self._eval(noeud.test):
                    self._bloc(noeud.body)
                else:
                    self._bloc(noeud.orelse)
            elif isinstance(noeud, ast.For):
                iterable = self._iterable(noeud.iter)
                for item in iterable:
                    self._tick()
                    self._affecter(noeud.target, item)
                    try:
                        self._bloc(noeud.body)
                    except _Break:
                        break
                    except _Continue:
                        continue
                else:
                    self._bloc(noeud.orelse)
            elif isinstance(noeud, ast.While):
                garde = 0
                while self._eval(noeud.test):
                    self._tick()
                    garde += 1
                    if garde > MAX_PAS:
                        raise ErreurSimulateur("while infini")
                    try:
                        self._bloc(noeud.body)
                    except _Break:
                        break
                    except _Continue:
                        continue
            elif isinstance(noeud, ast.Break):
                raise _Break()
            elif isinstance(noeud, ast.Continue):
                raise _Continue()
            elif isinstance(noeud, ast.Pass):
                pass
            else:
                raise ErreurSimulateur(type(noeud).__name__)

    def _affecter(self, cible, val):
        if isinstance(cible, ast.Name):
            self.env[cible.id] = val
        elif isinstance(cible, ast.Subscript):
            base = self.env[cible.value.id]
            base[self._eval(cible.slice)] = val
        elif isinstance(cible, ast.Tuple):
            for c, v in zip(cible.elts, val):
                self._affecter(c, v)
        else:
            raise ErreurSimulateur(f"affectation {type(cible).__name__}")

    def _lire(self, cible):
        if isinstance(cible, ast.Name):
            if cible.id not in self.env:
                raise NameError(cible.id)
            return self.env[cible.id]
        if isinstance(cible, ast.Subscript):
            base = self.env[cible.value.id]
            return base[self._eval(cible.slice)]
        raise ErreurSimulateur(f"lecture {type(cible).__name__}")

    def _iterable(self, noeud):
        v = self._eval(noeud)
        if isinstance(v, (list, str)):
            return list(v)
        raise ErreurSimulateur("itérable non supporté")

    # ---------------------------------------------------------------- eval
    def _eval(self, noeud, profondeur=0):
        if profondeur > MAX_PROFONDEUR:
            raise ErreurSimulateur("profondeur d'expression")
        self._tick()
        if isinstance(noeud, ast.Constant):
            return noeud.value
        if isinstance(noeud, ast.Name):
            return self._lire(noeud)
        if isinstance(noeud, ast.BinOp):
            return self._binop(self._eval(noeud.left, profondeur + 1), noeud.op, self._eval(noeud.right, profondeur + 1))
        if isinstance(noeud, ast.UnaryOp):
            v = self._eval(noeud.operand, profondeur + 1)
            if isinstance(noeud.op, ast.USub):
                return -v
            if isinstance(noeud.op, ast.UAdd):
                return +v
            if isinstance(noeud.op, ast.Not):
                return not v
            raise ErreurSimulateur("unary op")
        if isinstance(noeud, ast.BoolOp):
            vals = [self._eval(v, profondeur + 1) for v in noeud.values]
            if isinstance(noeud.op, ast.And):
                return all(vals)
            return any(vals)
        if isinstance(noeud, ast.Compare):
            gauche = self._eval(noeud.left, profondeur + 1)
            for op, comp in zip(noeud.ops, noeud.comparators):
                droite = self._eval(comp, profondeur + 1)
                if not self._compare(op, gauche, droite):
                    return False
                gauche = droite
            return True
        if isinstance(noeud, ast.List):
            return [self._eval(e, profondeur + 1) for e in noeud.elts]
        if isinstance(noeud, ast.Tuple):
            return tuple(self._eval(e, profondeur + 1) for e in noeud.elts)
        if isinstance(noeud, ast.Subscript):
            base = self._eval(noeud.value, profondeur + 1)
            idx = self._eval(noeud.slice, profondeur + 1)
            return base[idx]
        if isinstance(noeud, ast.Slice):
            lo = self._eval(noeud.lower) if noeud.lower else None
            hi = self._eval(noeud.upper) if noeud.upper else None
            return slice(lo, hi)
        if isinstance(noeud, ast.JoinedStr):  # f-string
            morceaux = []
            for v in noeud.values:
                if isinstance(v, ast.Constant):
                    morceaux.append(str(v.value))
                elif isinstance(v, ast.FormattedValue):
                    morceaux.append(self._fmt(self._eval(v.value, profondeur + 1)))
            return "".join(morceaux)
        if isinstance(noeud, ast.Call):
            return self._appel(noeud, profondeur)
        if isinstance(noeud, ast.Attribute):
            base = self._eval(noeud.value, profondeur + 1)
            return _MethodeObjet(base, noeud.attr)
        raise ErreurSimulateur(type(noeud).__name__)

    def _compare(self, op, a, b):
        if isinstance(op, ast.Eq):
            return a == b
        if isinstance(op, ast.NotEq):
            return a != b
        if isinstance(op, ast.Lt):
            return a < b
        if isinstance(op, ast.LtE):
            return a <= b
        if isinstance(op, ast.Gt):
            return a > b
        if isinstance(op, ast.GtE):
            return a >= b
        if isinstance(op, ast.In):
            return a in b
        if isinstance(op, ast.NotIn):
            return a not in b
        raise ErreurSimulateur("comparaison")

    def _binop(self, a, op, b):
        if isinstance(op, ast.Add):
            return a + b
        if isinstance(op, ast.Sub):
            return a - b
        if isinstance(op, ast.Mult):
            return a * b
        if isinstance(op, ast.Div):
            return a / b
        if isinstance(op, ast.FloorDiv):
            return a // b
        if isinstance(op, ast.Mod):
            return a % b
        if isinstance(op, ast.Pow):
            return a ** b
        raise ErreurSimulateur("opérateur binaire")

    def _appel(self, noeud: ast.Call, profondeur: int):
        args = [self._eval(a, profondeur + 1) for a in noeud.args]
        kwargs = {k.arg: self._eval(k.value) for k in noeud.keywords}
        if isinstance(noeud.func, ast.Name):
            nom = noeud.func.id
            if nom == "print":
                sep = kwargs.get("sep", " ")
                fin = kwargs.get("end", "\n")
                self.sortie.append(sep.join(self._fmt(a) for a in args) + fin)
                return None
            if nom == "range":
                if len(args) == 1:
                    debut, fin, pas = 0, args[0], 1
                elif len(args) == 2:
                    debut, fin, pas = args[0], args[1], 1
                else:
                    debut, fin, pas = args[0], args[1], args[2]
                if pas == 0:
                    raise ValueError("range: pas nul")
                return list(range(int(debut), int(fin), int(pas)))
            if nom == "len":
                return len(args[0])
            if nom == "int":
                return int(float(args[0])) if args else 0
            if nom == "float":
                return float(args[0]) if args else 0.0
            if nom == "str":
                return self._fmt(args[0]) if args else ""
            if nom == "sum":
                return sum(args[0])
            if nom == "min":
                return min(*args)
            if nom == "max":
                return max(*args)
            if nom == "abs":
                return abs(args[0])
            if nom == "sorted":
                return sorted(args[0], reverse=kwargs.get("reverse", False))
            if nom == "reversed":
                return list(reversed(args[0]))
            if nom == "enumerate":
                return list(enumerate(args[0], start=kwargs.get("start", 0)))
            if nom == "list":
                return list(args[0]) if args else []
            if nom == "bool":
                return bool(args[0]) if args else False
            if nom == "round":
                return round(args[0], args[1] if len(args) > 1 else None)
            if nom == "divmod":
                return divmod(args[0], args[1])
            raise ErreurSimulateur(f"fonction {nom}")
        if isinstance(noeud.func, ast.Attribute):
            base_obj = noeud.func.value
            if isinstance(base_obj, ast.Name) and base_obj.id in self.env:
                conteneur = self.env[base_obj.id]
                methode = noeud.func.attr
                if isinstance(conteneur, list):
                    if methode == "append":
                        conteneur.append(args[0]); return None
                    if methode == "extend":
                        conteneur.extend(args[0]); return None
                    if methode == "pop":
                        return conteneur.pop(*args) if args else conteneur.pop()
                    if methode == "insert":
                        conteneur.insert(args[0], args[1]); return None
                    if methode == "sort":
                        conteneur.sort(reverse=kwargs.get("reverse", False)); return None
                if isinstance(conteneur, str):
                    if methode == "upper":
                        return conteneur.upper()
                    if methode == "lower":
                        return conteneur.lower()
                    if methode == "strip":
                        return conteneur.strip(*args)
                    if methode == "split":
                        return conteneur.split(*args)
                    if methode == "join":
                        return conteneur.join(args[0])
                    if methode == "replace":
                        return conteneur.replace(args[0], args[1])
                    if methode == "startswith":
                        return conteneur.startswith(args[0])
                    if methode == "endswith":
                        return conteneur.endswith(args[0])
                if isinstance(conteneur, dict):
                    if methode == "get":
                        return conteneur.get(args[0], args[1] if len(args) > 1 else None)
                    if methode == "keys":
                        return list(conteneur.keys())
                    if methode == "values":
                        return list(conteneur.values())
                    if methode == "items":
                        return list(conteneur.items())
            raise ErreurSimulateur(f"méthode .{noeud.func.attr}")
        raise ErreurSimulateur("appel")


class _Break(Exception):
    pass


class _Continue(Exception):
    pass


class _MethodeObjet:
    def __init__(self, base, nom):
        self.base, self.nom = base, nom


# ------------------------------------------------------------------- extraction
def extraire_code(question: str) -> str | None:
    """Extrait le code Python : blocs ``` sinon heuristique sur les lignes."""
    import re

    blocs = re.findall(r"```(?:python|py)?\s*\n(.*?)```", question, re.DOTALL | re.IGNORECASE)
    if blocs:
        return blocs[0].strip()

    lignes = [l for l in question.splitlines()]
    candidates = [l for l in lignes if re.search(r"\b(print\s*\(|=\s*|for\s+\w+\s+in\s+|while\s+|if\s+|def\s+)", l)]
    candidates = [l.strip() for l in candidates
                  if not re.match(r"^(que|quel|qu'|combien|que va|le code|ce code)", l.lower())]
    if not candidates:
        return None
    brut = "\n".join(candidates).strip()
    # retire un préfixe de consigne : « Exécute ce code Python : », « Ce script : »…
    brut = re.sub(r"^[^\n:]{0,80}code[^\n:]{0,40}:\s*", "", brut, flags=re.IGNORECASE)
    brut = re.sub(r"^[«\"']", "", brut)
    # variantes : code tel quel, ou points-virgules → sauts de ligne (sans espaces résiduels)
    # (« compteur=0; for i in range(3): x » est invalide à plat, valide en multi-lignes)
    variante_pv = re.sub(r"\s*;\s*", "\n", brut)
    for variante in (brut, variante_pv):
        if not variante.strip():
            continue
        try:
            ast.parse(variante)
            return variante
        except SyntaxError:
            continue
    return None


# ----------------------------------------------------------------------- API
def simuler(code: str) -> dict[str, Any]:
    """Simulation AST déterministe — retourne la sortie stdout collectée."""
    try:
        sim = _Simulateur(code)
        sortie = sim.executer()
        return {
            "statut": "VERIFIED", "sortie": "".join(sortie).strip(),
            "lignes_sortie": [s.rstrip("\n") for s in sortie],
            "variables": {k: sim._fmt(v) for k, v in sim.env.items()},
            "pas": sim.pas, "methode": "simulateur_ast",
        }
    except SyntaxError as e:
        return {"statut": "ERREUR", "raison": f"syntaxe invalide : {e.msg}", "methode": "simulateur_ast"}
    except ErreurSimulateur as e:
        return {"statut": "NON_SUPPORTÉ", "raison": f"construct non simulé : {e.construct}", "methode": "simulateur_ast"}
    except Exception as e:
        return {"statut": "ERREUR", "raison": f"{type(e).__name__}: {e}", "methode": "simulateur_ast"}


def sandbox(code: str, timeout: float = 5.0) -> dict[str, Any]:
    """Exécution python réelle isolée (subprocess, -I = isolé, timeout court)."""
    try:
        p = subprocess.run(
            [sys.executable, "-I", "-c", code],
            capture_output=True, text=True, timeout=timeout,
        )
        if p.returncode == 0:
            return {"statut": "VERIFIED", "sortie": p.stdout.strip(), "methode": "sandbox_python"}
        return {"statut": "ERREUR", "raison": p.stderr.strip()[-500:], "methode": "sandbox_python"}
    except subprocess.TimeoutExpired:
        return {"statut": "ERREUR", "raison": "timeout sandbox", "methode": "sandbox_python"}
    except Exception as e:
        return {"statut": "ERREUR", "raison": str(e), "methode": "sandbox_python"}


def resoudre_code(question: str) -> dict[str, Any]:
    """Outil principal : « Que va afficher ce code ? » → sortie réelle vérifiée."""
    code = extraire_code(question)
    if not code:
        return {"statut": "UNKNOWN", "raison": "aucun code Python extractible de la question"}

    sim = simuler(code)
    sbx = sandbox(code)

    if sim["statut"] == "VERIFIED":
        resultat = dict(sim)
        if sbx["statut"] == "VERIFIED":
            if sbx["sortie"] == sim["sortie"]:
                resultat["croisement"] = "ast == sandbox (reproductible)"
            else:
                resultat["statut"] = "CONTRADICTED"
                resultat["contradiction"] = True
                resultat["resume"] = f"AST={sim['sortie']!r} ≠ sandbox={sbx['sortie']!r}"
                resultat["sortie"] = sbx["sortie"]  # le sandbox fait foi
                resultat["croisement"] = "désaccord → sandbox fait foi"
        elif sbx["statut"] == "ERREUR" and "timeout" not in str(sbx.get("raison", "")):
            resultat["croisement"] = f"sandbox en erreur : {sbx.get('raison', '')[:120]}"
        return resultat
    if sim["statut"] == "NON_SUPPORTÉ" and sbx["statut"] == "VERIFIED":
        return {
            "statut": "VERIFIED", "sortie": sbx["sortie"], "methode": "sandbox_python",
            "croisement": f"AST non supporté ({sim.get('raison')}) → sandbox seul",
        }
    if sim["statut"] == "ERREUR" and "syntaxe" in str(sim.get("raison", "")):
        return sim
    return sbx if sbx["statut"] == "VERIFIED" else sim
