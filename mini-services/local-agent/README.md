# local-agent (:3020)

Agent de confiance qui exécute des commandes shell **sur votre PC**
à la demande de l'UI Athéna (Pages ou stack local).

## Démarrage

```bash
node index.js                 # confirmation requise à chaque commande
node index.js --auto          # dev : pas de confirmation
node index.js --allow "C:\Users\moi\Documents"   # restreint un dossier
```

Écoute uniquement sur `http://127.0.0.1:3020`.

## API

| Route | Méthode | Description |
|-------|---------|-------------|
| `/sante` | GET | santé + version |
| `/journal` | GET | 50 dernières exécutions |
| `/exec` | POST | `{commande, confirme?, cwd?, timeout_ms?}` |

Sans `confirme: true` → HTTP **428** (l'UI demande d'abord à l'utilisateur).

## Sécurité

- Bind `127.0.0.1` uniquement
- CORS : Pages Athéna + localhost
- Liste de refus : `rm -rf /`, `format`, `del /s /q C:`, pipes `curl|sh`, `IEX`, etc.
- Timeout 20 s, sortie bornée à 64 Ko
- Journal local en mémoire

## Intégration UI

`chat-demo.js` détecte les blocs :

```athena-exec
hostname
```

et propose un bouton **Exécuter** qui appelle `POST /api/exec`
(intercepté par `api-shim.js` → `http://127.0.0.1:3020/exec`).
