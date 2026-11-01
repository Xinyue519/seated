# Seated backend

Go modular monolith: REST API, a single "Ask Seated" agent built on OpenAI tool calling,
Postgres (pgvector + PostGIS) and Redis sessions. Implements the API the frontend's real mode
already calls (`frontend/src/services/http`).

## Run it locally

Prereqs: Docker, Go 1.26+ (an older Go 1.21+ will download the right toolchain automatically).

```bash
# 1. keys
cp .env.example .env          # then paste your OPENAI_API_KEY into backend/.env

# 2. Postgres + Redis
make up                       # = docker compose up -d (from the repo root compose file)

# 3. schema + demo data (+ restaurant embeddings when the key is set)
make seed

# 3b. optional: real addresses/coords/hours/photos for the 21 seeded restaurants
#     (needs GOOGLE_PLACES_API_KEY in .env; costs API calls, so run occasionally, not on every seed)
make import-places

# 4. API on :8080
make run

# 5. frontend in real mode (another terminal)
cd ../frontend && npm start   # http://localhost:5173, proxies /api to :8080
```

Log in as `stella@example.com` / `demo-password` (set in `.env`, re-run `make seed` to change).
Without `OPENAI_API_KEY` everything except the agent works; the agent replies that it isn't
configured, and similarity search falls back to cuisine/tag matching.

## Environment

| Variable | Needed | Notes |
|---|---|---|
| `OPENAI_API_KEY` | **yes, for the agent** | Chat (tool calling) + embeddings |
| `OPENAI_MODEL` | no | default `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | no | default `text-embedding-3-small` (1536 dims, matches the schema) |
| `DATABASE_URL`, `REDIS_URL` | no | defaults match `docker-compose.yml` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | no | creates an admin on `make seed` |
| `GOOGLE_PLACES_API_KEY` | no | server-side only; enables `make import-places` (real address/coords/hours/photos) |
| `COOKIE_SECURE` | prod | `true` behind HTTPS |

Secrets live only in `backend/.env`, which is gitignored (see the repo-root `.gitignore`).
Commit changes to `.env.example` instead.

## Layout

```
backend/
├── cmd/server            API entrypoint (migrates on start)
├── cmd/seed              migrations + demo data + embeddings
├── cmd/import-places     one-off: enrich seeded restaurants from Google Places
└── internal/
    ├── agent/            orchestrator loop, tool registry, prompt, conversation store
    ├── api/              routes, session/role middleware, handlers
    ├── llm/              Client interface + OpenAI implementation (plain HTTP)
    ├── places/           Google Places (New) client — Text Search + Photo Media (plain HTTP)
    ├── restaurants/      filters (SQL/PostGIS) + similarity (pgvector)
    ├── reservations/     Provider interface + Postgres-backed mock provider
    ├── workflows/        workflow runs + steps (trace / audit log), published workflows
    ├── users/            accounts, preferences, saved, visits
    ├── sessions/         Redis sessions
    ├── database/         pgx pool + embedded SQL migrations
    └── seed/             demo dataset (21 NYC restaurants) + workflow definitions
```

## Database schema

Source of truth: `internal/database/migrations/001_init.sql` (applied automatically by
`make seed` / `cmd/server` on startup). Summary:

| Table | Purpose |
|---|---|
| `users` | accounts (email/password hash/role); unique on lower(email) |
| `restaurants` | internal restaurant schema everything maps into; `location` is PostGIS `geography(Point)` for radius queries, `source` (jsonb) keeps attribution. `name`/`description`/`tags`/`cuisine_group`/`price_level` are hand-curated; `lat`/`lng`/`phone`/`website`/`hours`/`image_url` can be filled in from real data via `make import-places` |
| `restaurant_embeddings` | one `vector(1536)` per restaurant (text-embedding-3-small) + HNSW cosine index, for `find_similar_restaurants` |
| `user_preferences` | 1:1 with `users`: cuisines, price levels, dietary, party size |
| `saved_restaurants` | user ↔ restaurant bookmarks (composite PK) |
| `visits` | past visits, optional thumbs up/down feedback |
| `availability_slots` | mock provider inventory: one row = one bookable table at `(restaurant, date, time)` |
| `reservations` | bookings; unique on `(restaurant, date, time)` while `status = 'confirmed'` so slots can't double-book; `idempotency_key` makes retries safe |
| `conversations` / `messages` | chat history persisted per user; `messages.payload` carries the UI extras (chips, results, confirm card) |
| `workflows` | admin-defined, versioned workflow definitions; the agent only runs `status = 'published'` ones |
| `workflow_runs` / `workflow_steps` | one run per agent task, one step per tool call (inputs/outputs/timing/status) — the trace shown in the UI and the audit log |

Everything else (foreign keys, checks, indexes) is in the migration file itself — read that
instead of this table going stale.

## How the agent works

One agent, predefined tools, no framework (`internal/agent/orchestrator.go`):

1. Load the conversation (persisted in Postgres) and build the prompt with today's dates.
2. Call the model with the tool schemas. It proposes tool calls; the backend validates and runs
   them, recording each one as a workflow step (inputs, outputs, timing, status).
3. Repeat until the model answers in text, asks for approval, or hits `AGENT_MAX_STEPS`.

Tools: `search_restaurants`, `find_similar_restaurants`, `get_restaurant_details`,
`get_user_preferences`, `check_availability`, `get_user_reservations`, `present_restaurants`
(cards + map pins), and `request_reservation` / `request_modification` / `request_cancellation`.

The model can never write to the database. The `request_*` tools only create an approval card;
the booking happens when the user taps Confirm (`POST /api/agent/actions {type:"confirm"}`), which
the backend executes with an idempotency key. Other reliability pieces:

- **Permissions:** user id always comes from the session; reservations are looked up by
  `(id, user_id)`, so other users' bookings look like 404s. Admin routes check the role.
- **Published workflows:** consequential tools refuse unless their workflow is published.
- **Failure handling:** a taken slot returns the other open times; a fully booked restaurant
  leads to similar places with availability; tool errors go back to the model so it can recover.
- **Retries:** LLM/embedding calls retry on 429/5xx; booking calls are never blindly retried.
- **Timeouts** on every LLM call, tool and provider call.
- **Grounding:** `present_restaurants` drops ids that don't exist, so invented restaurants
  never reach the UI.

## API

| Method | Path | |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout` | HttpOnly `seated_session` cookie |
| GET | `/api/me/bootstrap` | user, preferences, restaurants, saved, visited, reservations, past |
| PATCH / PUT | `/api/me`, `/api/me/preferences` | |
| PUT / DELETE | `/api/me/saved/{restaurantId}` | |
| POST | `/api/me/visits/{id}/feedback` | `{value: "up" \| "down"}` |
| GET | `/api/me/runs` | your workflow runs (trace) |
| GET | `/api/restaurants`, `/api/restaurants/{id}/availability?date=` | |
| GET | `/api/reservations` | |
| POST | `/api/reservations/{id}/cancel` | approved on the Reservations page |
| POST | `/api/agent/messages` | `{text}` → `AgentTurn` |
| POST | `/api/agent/actions` | `{type: pick_slot \| confirm \| decline, …}` → `AgentTurn` |
| GET | `/api/admin/workflows`, `/api/admin/runs` | admin only |
| GET | `/healthz` | Postgres + Redis check |

## Not built yet (from the plan)

- gRPC between services: everything is one process for now, as the plan suggests.
- Workflow Builder UI (phase 10): the `workflows` table and the published check are in place.
- Real providers (OpenTable / Resy) behind `reservations.Provider`.
- `phone`/`website`/`hours` are populated by `make import-places` but not yet returned by
  `internal/restaurants` or shown in the frontend.
- Streaming agent responses, signup, email notifications, rate limiting.
