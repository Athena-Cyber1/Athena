#!/usr/bin/env bash
# Lance le bridge LLM (:3015) en daemon RÉELLEMENT persistant (double-fork),
# même mécanisme que le daemon.sh du sidecar : les processus lancés depuis les
# shells d'agent sont tués à la fin de l'appel ; le double-fork ré-orpheline
# le process vers PID 1 (tini), hors de l'arbre contrôlé.
# Usage : bash daemon.sh
set -e
cd "$(dirname "$0")"
if curl -s -m 2 http://127.0.0.1:3015/sante | grep -q '"ok":true'; then
  echo "bridge déjà en marche ($(curl -s -m 2 http://127.0.0.1:3015/sante | head -c 60))"
  exit 0
fi
python3 - <<'EOF'
import os
if os.fork() > 0:
    os._exit(0)
os.setsid()
if os.fork() > 0:
    os._exit(0)
argv = ["bun", "--hot", "index.ts"]
with open("/tmp/llm-bridge.pid", "w") as f:
    f.write(str(os.getpid()))
log = os.open("/tmp/llm-bridge.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(log, 1)  # stdout → log
os.dup2(log, 2)  # stderr → log
os.execvp("bun", argv)
EOF
for i in $(seq 1 20); do
  curl -s -m 2 http://127.0.0.1:3015/sante | grep -q '"ok":true' && { echo "bridge démarré (pid $(cat /tmp/llm-bridge.pid))"; exit 0; }
  sleep 1
done
echo "échec du démarrage du bridge" >&2
exit 1
