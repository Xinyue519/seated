# Seated

Seated is a restaurant discovery and booking app built around a conversational agent: you tell it
what you're looking for (cuisine, neighborhood, party size, time) and it finds places, books,
modifies, or cancels reservations on your behalf.

## Structure

```
seated/
└── frontend/   React + TypeScript + Tailwind (Vite) client, runnable standalone against mock data
```

There's no backend in this repo yet — `frontend/` runs fully self-contained in mock mode (mock
restaurants, mock reservations, a scripted mock agent) so the UI can be built and demoed without a
real API. See [`frontend/README.md`](frontend/README.md) for setup, the real-vs-mock architecture,
and the proposed API contract for when a backend lands.

## Quickstart

```bash
cd frontend
npm install
npm run start:mock
```
