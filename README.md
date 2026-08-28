# MOTAED Backend

API Express + PostgreSQL (Supabase) pour MOTAED.

## Développement

```bash
npm install
npm run server
```

L'API sera disponible sur `http://localhost:3001`.

## Base de données

Le schéma se trouve dans `supabase/schema.sql`.  
Exécutez-le dans Supabase SQL Editor avant de démarrer.

## Variables d'environnement

Copier `.env.example` vers `.env` et remplir :
- `DATABASE_URL`
- `JWT_SECRET`
- `PORT`
- `FRONTEND_URL`
