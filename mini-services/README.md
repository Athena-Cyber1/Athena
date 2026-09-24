# mini-services

Services locaux Athéna (indépendants de la Pages).

| Service | Port | Langage | Rôle |
|---------|------|---------|------|
| [llm-bridge](./llm-bridge/) | 3015 | TypeScript (Bun) | Cascade multi-provider, circuit-breaker, cache |
| [llm-chat](./llm-chat/) | 3010 | Python (FastAPI) | Moteur agent Athéna (planifier → agir → vérifier) |
| [local-agent](./local-agent/) | 3020 | Node.js | **Exécution de commandes sur le PC** (localhost) |

Voir [../ARCHITECTURE.md](../ARCHITECTURE.md) pour les flux.
