# upchat-signal

Serveur de signalisation HTTP pour le **mode internet** d'UpChat (déployé sur Vercel).

## Endpoints

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `POST` | `/api/register` | Enregistre `userId`, `name`, `phone` |
| `GET` | `/api/lookup?phone=` | Recherche un utilisateur par numéro |
| `POST` | `/api/presence` | Heartbeat de présence |
| `POST` | `/api/message` | Dépose un message dans l'inbox destinataire |
| `GET` | `/api/inbox?userId=` | Récupère (et vide) l'inbox |

## Numéros de téléphone

- Normalisation : chiffres uniquement, `+` conservé si présent.
- Le téléphone est **optionnel** en offline, **recommandé** pour le mode internet.
- Lookup : un utilisateur n'est trouvable que s'il s'est enregistré avec un numéro.

## Stockage

Mémoire process (dev / proto). Pour la production, brancher **Vercel KV** ou une base.

## Déploiement

```bash
npx vercel --prod
```

Puis mets à jour `AppConstants.signalingBaseUrl` dans l'app Flutter si l'URL diffère.
