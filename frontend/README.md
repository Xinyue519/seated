# Seated frontend

React + TypeScript + Tailwind (Vite).

```bash
npm install

npm run start:mock   # no backend needed: mock data, mock API, scripted agent
npm start            # real mode: calls the Go API at /api (proxied to localhost:8080)

npm run build        # production build (real API)
npm run build:mock   # static demo build with mock data
```

In mock mode any email and password log you in. Point real mode at another backend with
`SEATED_API_TARGET=http://host:port npm start`.

## How the two modes work

`VITE_USE_MOCKS` (set in `.env` / `.env.mock`) decides which implementation `src/services/index.ts` loads:

| | Data API (`SeatedApi`) | Agent (`AgentClient`) |
|---|---|---|
| real | `services/http/httpApi.ts` | `services/http/httpAgent.ts` |
| mock | `mocks/mockApi.ts` | `mocks/agent/mockAgent.ts` |

Both implement the interfaces in `services/types.ts`, and the UI only talks to those interfaces
through `useApp()`. Everything in `src/mocks/` is loaded with a dynamic import, so none of it ends
up in the real build.

## Layout

```
src/
├── config.ts               env flags (useMocks, apiBaseUrl, Google Maps key + Map ID)
├── types.ts                domain types: restaurants, reservations, messages, workflow runs
├── services/
│   ├── types.ts            SeatedApi + AgentClient contracts, Bootstrap, AgentTurn
│   ├── index.ts            picks real vs mock
│   └── http/               fetch client, Go API + agent implementations
├── mocks/                  mock mode only
│   ├── restaurants.ts      21 NYC restaurants (seed)
│   ├── seed.ts             demo account (saved, reservations, history)
│   ├── provider.ts         mock reservation provider (slots, booked slots)
│   ├── mockApi.ts          in-memory SeatedApi
│   └── agent/              keyword parser, ranking, scripted orchestrator
├── store/                  app state (React context), login/logout, session restore
├── data/restaurants.ts     restaurant registry filled at login + static reference data
├── hooks/                  useAvailability, useToggleSaved
├── map/  chat/  pages/  components/
```

## Proposed API contract (real mode)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }`, sets HttpOnly session cookie |
| POST | `/api/auth/logout` | |
| GET | `/api/me/bootstrap` | `Bootstrap`: user, preferences, restaurants, saved, visited, reservations, past. 401 if no session |
| GET | `/api/restaurants/:id/availability?date=YYYY-MM-DD` | `{ slots: string[] }` |
| PUT / DELETE | `/api/me/saved/:restaurantId` | save / unsave |
| PATCH | `/api/me` | profile |
| PUT | `/api/me/preferences` | |
| POST | `/api/me/visits/:id/feedback` | `{ value: 'up' \| 'down' }` |
| POST | `/api/agent/messages` | `{ text, context }` → `AgentTurn` |
| POST | `/api/agent/actions` | `{ type: 'pick_slot' \| 'confirm' \| 'decline', … }` → `AgentTurn` |
| POST | `/api/reservations/:id/cancel` | → `AgentTurn` (records the cancellation run) |

`AgentTurn` = `{ messages, runs?, mapFilter?, reservations? }` using the shapes in `src/types.ts`.
Paths live in one place (`services/http/`), so they're easy to change once the backend settles.

## Mock-mode behaviours worth knowing

- Carbone and Torrisi are always full, which triggers the "similar places with availability" fallback.
- The first booking at Don Angie fails with `SLOT_TAKEN` to exercise failure handling.
- Bookings, cancellations and changes always go through an approval step.
- Refreshing the page logs you out and resets the demo data.

## Still a placeholder in both modes

The map (`map/MapBackground.tsx` + `lib/geo.ts`) is a stylized drawing. Swap it for Google Maps
(Maps JavaScript API, custom style hiding Google POIs); `MapView` already takes pins and a selected id.
