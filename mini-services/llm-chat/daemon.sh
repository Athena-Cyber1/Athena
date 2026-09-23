#!/usr/bin/env bash
# Lance le sidecar Athéna en daemon RÉELLEMENT persistant (double-fork).
# Les processus lancés normalement depuis les shells d'agent sont tués à la
# fin de l'appel ; le double-fork ré-orpheline le process vers PID 1 (tini),
# hors de l'arbre contrôlé. Usage : bash daemon.sh [--reload]
set -e
cd "$(dirname "$0")"
if curl -s -m 2 http://127.0.0.1:3010/sante | grep -q '"ok":true'; then
  echo "sidecar déjà en marche ($(curl -s -m 2 http://127.0.0.1:3010/sante | head -c 60))"
  exit 0
fi
FLAGS=""
[ "${1:-}" = "--reload" ] && FLAGS="--reload"
python3 - "$FLAGS" <<'EOF'
import os, sys
if os.fork() > 0:
    os._exit(0)
os.setsid()
if os.fork() > 0:
    os._exit(0)
flags = sys.argv[1] if len(sys.argv) > 1 else ""
argv = ["python3", "-m", "uvicorn", "serveur:app", "--host", "127.0.0.1", "--port", "3010"] + flags.split()
with open("/tmp/athena.pid", "w") as f:
    f.write(str(os.getpid()))
os.execvp("python3", argv)
EOF
for i in $(seq 1 20); do
  curl -s -m 2 http://127.0.0.1:3010/sante | grep -q '"ok":true' && { echo "sidecar démarré (pid $(cat /tmp/athena.pid))"; exit 0; }
  sleep 1
done
echo "échec du démarrage" >&2
exit 1
