# Seated

Seated is a restaurant discovery and booking app built around a conversational agent: you tell it
what you're looking for (cuisine, neighborhood, party size, time) and it finds places, books,
modifies, or cancels reservations on your behalf.

## Structure

```
seated/
├── frontend/          React + TypeScript + Tailwind (Vite); runs standalone on mock data too
├── backend/           Go API + agent (OpenAI tool calling), Postgres + pgvector + PostGIS, Redis
├── infrastructure/    Docker images (Kubernetes manifests later)
└── docker-compose.yml local Postgres + Redis
```

## Quickstart

**Just the UI, no backend:**

```bash
cd frontend && npm install && npm run start:mock
```

**Full stack:**

```bash
cp backend/.env.example backend/.env    # add your OPENAI_API_KEY
docker compose up -d                    # Postgres + Redis
cd backend && make seed && make run     # API on :8080
cd frontend && npm start                # UI on :5173 (proxies /api)
```

See [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md).

## Secrets

Keys go in `backend/.env` (gitignored). Only `.env.example` templates are committed. If a key is
ever committed by accident, rotate it: removing it from a later commit doesn't remove it from history.
