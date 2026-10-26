# upchat-signal

Serveur de signalisation HTTP pour le **mode internet** d’UpChat (déployé sur Vercel ou Render).

## Endpoints

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/api/health` | Vérifie le stockage et le mode d’authentification |
| `POST` | `/api/register` | Enregistre `userId`, `name`, `phone` |
| `GET` | `/api/lookup?phone=` | Recherche un utilisateur par numéro |
| `POST` | `/api/presence` | Heartbeat de présence |
| `POST` | `/api/message` | Dépose un message dans l’inbox destinataire |
| `GET` | `/api/inbox?userId=` | Récupère (et vide) l’inbox |

## Authentification Firebase

Lorsque `FIREBASE_SERVICE_ACCOUNT_JSON` ou `GOOGLE_APPLICATION_CREDENTIALS` est défini, les routes privées vérifient `Authorization: Bearer <Firebase ID token>` avec Firebase Admin `verifyIdToken`. La route `/api/health` indique alors `auth: firebase-admin`.

Variables recommandées en production :

- `FIREBASE_SERVICE_ACCOUNT_JSON` : JSON du compte de service, fourni comme secret d’environnement ;
- `FIREBASE_PROJECT_ID` : projet Firebase correspondant aux applications Flutter ;
- `DATABASE_URL` : PostgreSQL ;
- `UPCHAT_ALLOWED_ORIGINS` : liste séparée par des virgules des origines autorisées.

Si Firebase Admin n’est pas configuré, le serveur expose temporairement le mode de compatibilité `legacy-device-token` pour les anciennes installations. Ce mode doit être supprimé après migration.

## Numéros de téléphone

- Normalisation : chiffres uniquement, `+` conservé si présent.
- Le téléphone est **optionnel** en offline, **recommandé** pour le mode internet.
- Lookup : un utilisateur n'est trouvable que s'il s'est enregistré avec un numéro.
- La preuve de possession d’un numéro doit être faite avec Firebase Phone Auth/SMS ; Google et E-mail seuls ne prouvent pas un numéro.

## Vérification de disponibilité

```sh
curl https://<hôte>/api/health
```

Une réponse saine contient `ok: true`, le type de stockage et le mode d’authentification actif.

## Stockage

Mémoire process (dev / proto). Pour la production, utiliser PostgreSQL via `DATABASE_URL`.

## Déploiement

```bash
npm ci
npx vercel --prod
```

Puis mets à jour `AppConstants.signalingBaseUrl` dans l'app Flutter si l'URL diffère.
