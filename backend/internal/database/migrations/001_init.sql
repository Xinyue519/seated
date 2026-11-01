-- Seated initial schema. Matches "Database tables" in the build plan.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    name          text NOT NULL,
    password_hash text NOT NULL,
    role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- ---------------------------------------------------------- restaurants
-- Internal restaurant schema: every source maps into this shape; `source` keeps attribution.
CREATE TABLE restaurants (
    id                       text PRIMARY KEY,           -- stable slug, e.g. 'lartusi'
    name                     text NOT NULL,
    cuisine                  text NOT NULL,              -- display label, e.g. 'Tuscan'
    cuisine_group            text NOT NULL,              -- 'italian', 'french', ...
    neighborhood             text NOT NULL,
    price_level              smallint NOT NULL CHECK (price_level BETWEEN 1 AND 4),
    lat                      double precision NOT NULL,
    lng                      double precision NOT NULL,
    location                 geography(Point, 4326) NOT NULL,
    tags                     text[] NOT NULL DEFAULT '{}',
    description              text NOT NULL DEFAULT '',
    description_is_generated boolean NOT NULL DEFAULT false,
    vegetarian               boolean NOT NULL DEFAULT false,
    image_url                text,
    phone                    text,
    website                  text,
    hours                    jsonb,
    source                   jsonb,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurants_location_idx ON restaurants USING gist (location);
CREATE INDEX restaurants_group_idx ON restaurants (cuisine_group);

-- text-embedding-3-small = 1536 dimensions. Change both if you switch embedding models.
CREATE TABLE restaurant_embeddings (
    restaurant_id text PRIMARY KEY REFERENCES restaurants (id) ON DELETE CASCADE,
    embedding     vector(1536) NOT NULL,
    text_hash     text NOT NULL,                         -- only re-embed when the text changes
    model         text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurant_embeddings_hnsw ON restaurant_embeddings USING hnsw (embedding vector_cosine_ops);

-- ----------------------------------------------------- user-owned data
CREATE TABLE user_preferences (
    user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    cuisines     text[] NOT NULL DEFAULT '{}',
    price_levels smallint[] NOT NULL DEFAULT '{}',
    dietary      text[] NOT NULL DEFAULT '{}',
    party_size   smallint NOT NULL DEFAULT 2,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_restaurants (
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    restaurant_id text NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, restaurant_id)
);

CREATE TABLE visits (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    restaurant_id text NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
    visited_on    date NOT NULL,
    party_size    smallint NOT NULL,
    recommended   boolean NOT NULL DEFAULT false,         -- recommended by the agent
    feedback      text CHECK (feedback IN ('up', 'down')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visits_user_idx ON visits (user_id, visited_on DESC);

-- --------------------------------------------- mock reservation provider
-- Inventory for the v1 mock provider: one row = one bookable table at a time.
CREATE TABLE availability_slots (
    restaurant_id text NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
    slot_date     date NOT NULL,
    slot_time     text NOT NULL,                         -- '7:30' (evening, matches the UI)
    PRIMARY KEY (restaurant_id, slot_date, slot_time)
);

CREATE TABLE reservations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    restaurant_id   text NOT NULL REFERENCES restaurants (id),
    res_date        date NOT NULL,
    res_time        text NOT NULL,
    party_size      smallint NOT NULL CHECK (party_size BETWEEN 1 AND 20),
    status          text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    booked_by       text NOT NULL DEFAULT 'agent' CHECK (booked_by IN ('agent', 'user')),
    provider        text NOT NULL DEFAULT 'mock',
    provider_ref    text,
    idempotency_key text UNIQUE,                         -- retries never create duplicates
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservations_user_idx ON reservations (user_id, res_date);
-- The mock provider has one table per slot, so only one confirmed booking per slot.
CREATE UNIQUE INDEX reservations_slot_taken ON reservations (restaurant_id, res_date, res_time) WHERE status = 'confirmed';

-- ------------------------------------------------------- conversations
CREATE TABLE conversations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_idx ON conversations (user_id, updated_at DESC);

CREATE TABLE messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN ('user', 'agent')),
    content         text NOT NULL DEFAULT '',            -- text shown to the user / sent to the LLM
    payload         jsonb NOT NULL DEFAULT '{}',          -- UI extras: chips, results, confirm card
    llm_note        text NOT NULL DEFAULT '',             -- extra context for the LLM (ids shown, outcomes)
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

-- ----------------------------------------------------------- workflows
-- Admin-defined workflows. The agent only runs published ones.
CREATE TABLE workflows (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    version    int NOT NULL DEFAULT 1,
    definition jsonb NOT NULL,
    status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

CREATE TABLE workflow_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
    workflow_name   text NOT NULL,
    title           text NOT NULL,
    status          text NOT NULL CHECK (status IN ('running', 'waiting', 'done', 'recovered', 'stopped', 'failed')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_runs_user_idx ON workflow_runs (user_id, created_at DESC);

-- Audit log: tool inputs, outputs, timing and status for every step.
CREATE TABLE workflow_steps (
    id          bigserial PRIMARY KEY,
    run_id      uuid NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
    seq         int NOT NULL,
    step_name   text NOT NULL,
    status      text NOT NULL CHECK (status IN ('ok', 'waiting', 'failed')),
    inputs      jsonb,
    outputs     jsonb,
    detail      text NOT NULL DEFAULT '',
    duration_ms int,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, seq)
);
