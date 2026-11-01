// Package workflows records workflow runs and their steps (the execution trace /
// audit log) and knows which workflows an admin has published.
package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Names of the predefined workflows. The agent only runs ones that are published.
const (
	Discovery    = "restaurant_discovery"
	Similar      = "similar_restaurants"
	Reservation  = "restaurant_reservation"
	Modification = "reservation_modification"
	Cancellation = "reservation_cancellation"
	Lookup       = "reservation_lookup"
	Questions    = "restaurant_questions"
	Unclassified = "concierge"
)

var ErrNotFound = errors.New("run not found")

// Step and Run are the API shapes (match the frontend `TraceStep` / `WorkflowRun`).
type Step struct {
	Name       string `json:"name"`
	Status     string `json:"status"` // ok | waiting | failed
	DurationMs *int   `json:"durationMs,omitempty"`
	Detail     string `json:"detail,omitempty"`
}

type Run struct {
	ID        string    `json:"id"`
	Workflow  string    `json:"workflow"`
	Title     string    `json:"title"`
	Status    string    `json:"status"` // running | waiting | done | recovered | stopped
	Steps     []Step    `json:"steps"`
	CreatedAt time.Time `json:"createdAt"`
}

type Definition struct {
	Name    string   `json:"workflow_name"`
	Trigger string   `json:"trigger"`
	Steps   []string `json:"steps"`
}

type Workflow struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Version    int             `json:"version"`
	Status     string          `json:"status"`
	Definition json.RawMessage `json:"definition"`
	CreatedAt  time.Time       `json:"createdAt"`
}

type Recorder struct{ pool *pgxpool.Pool }

func NewRecorder(pool *pgxpool.Pool) *Recorder { return &Recorder{pool: pool} }

func (r *Recorder) Start(ctx context.Context, userID, conversationID, workflow, title string) (string, error) {
	var id string
	var conv any
	if conversationID != "" {
		conv = conversationID
	}
	if len(title) > 120 {
		title = title[:117] + "…"
	}
	err := r.pool.QueryRow(ctx, `
		INSERT INTO workflow_runs (user_id, conversation_id, workflow_name, title, status)
		VALUES ($1, $2, $3, $4, 'running') RETURNING id::text`, userID, conv, workflow, title).Scan(&id)
	return id, err
}

// AddStep appends a step with its inputs/outputs (audit log). Errors are returned but
// callers generally log and continue: tracing must never break a user request.
func (r *Recorder) AddStep(ctx context.Context, runID, name, status string, inputs, outputs any, detail string, dur time.Duration) error {
	in, _ := json.Marshal(inputs)
	out, _ := json.Marshal(outputs)
	var ms *int
	if dur > 0 {
		v := int(dur.Milliseconds())
		ms = &v
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO workflow_steps (run_id, seq, step_name, status, inputs, outputs, detail, duration_ms)
		VALUES ($1, (SELECT coalesce(max(seq), 0) + 1 FROM workflow_steps WHERE run_id = $1), $2, $3, $4, $5, $6, $7)`,
		runID, name, status, in, out, detail, ms)
	return err
}

func (r *Recorder) SetStatus(ctx context.Context, runID, status string) error {
	_, err := r.pool.Exec(ctx, `UPDATE workflow_runs SET status = $2, updated_at = now() WHERE id = $1`, runID, status)
	return err
}

func (r *Recorder) SetWorkflow(ctx context.Context, runID, workflow string) error {
	_, err := r.pool.Exec(ctx, `UPDATE workflow_runs SET workflow_name = $2, updated_at = now() WHERE id = $1`, runID, workflow)
	return err
}

// Owner returns the user who owns a run (for permission checks).
func (r *Recorder) Owner(ctx context.Context, runID string) (string, error) {
	var uid string
	err := r.pool.QueryRow(ctx, `SELECT user_id::text FROM workflow_runs WHERE id = $1`, runID).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return uid, err
}

func (r *Recorder) Get(ctx context.Context, runID string) (*Run, error) {
	runs, err := r.list(ctx, `WHERE wr.id = $1`, runID)
	if err != nil {
		return nil, err
	}
	if len(runs) == 0 {
		return nil, ErrNotFound
	}
	return &runs[0], nil
}

func (r *Recorder) ListForUser(ctx context.Context, userID string, limit int) ([]Run, error) {
	return r.list(ctx, `WHERE wr.user_id = $1 ORDER BY wr.created_at DESC LIMIT `+itoa(limit), userID)
}

func (r *Recorder) ListAll(ctx context.Context, limit int) ([]Run, error) {
	return r.list(ctx, `ORDER BY wr.created_at DESC LIMIT `+itoa(limit))
}

func (r *Recorder) list(ctx context.Context, tail string, args ...any) ([]Run, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT wr.id::text, wr.workflow_name, wr.title, wr.status, wr.created_at,
			coalesce((SELECT json_agg(json_build_object('name', s.step_name, 'status', s.status,
				'durationMs', s.duration_ms, 'detail', s.detail) ORDER BY s.seq)
				FROM workflow_steps s WHERE s.run_id = wr.id), '[]'::json)
		FROM workflow_runs wr `+tail, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Run, error) {
		var run Run
		var steps []byte
		if err := row.Scan(&run.ID, &run.Workflow, &run.Title, &run.Status, &run.CreatedAt, &steps); err != nil {
			return run, err
		}
		if err := json.Unmarshal(steps, &run.Steps); err != nil {
			return run, err
		}
		if run.Status == "failed" {
			run.Status = "stopped" // the UI has no "failed" run state
		}
		return run, nil
	})
	if out == nil {
		out = []Run{}
	}
	return out, err
}

// IsPublished reports whether an admin has published a workflow with this name.
func (r *Recorder) IsPublished(ctx context.Context, name string) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workflows WHERE name = $1 AND status = 'published')`, name).Scan(&ok)
	return ok, err
}

func (r *Recorder) ListWorkflows(ctx context.Context) ([]Workflow, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text, name, version, status, definition, created_at FROM workflows ORDER BY name, version`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Workflow, error) {
		var w Workflow
		err := row.Scan(&w.ID, &w.Name, &w.Version, &w.Status, &w.Definition, &w.CreatedAt)
		return w, err
	})
	if out == nil {
		out = []Workflow{}
	}
	return out, err
}

// UpsertPublished creates or republishes a workflow definition (used by the seed script).
func (r *Recorder) UpsertPublished(ctx context.Context, d Definition) error {
	def, _ := json.Marshal(d)
	_, err := r.pool.Exec(ctx, `
		INSERT INTO workflows (name, version, definition, status) VALUES ($1, 1, $2, 'published')
		ON CONFLICT (name, version) DO UPDATE SET definition = EXCLUDED.definition, status = 'published'`, d.Name, def)
	return err
}

// itoa clamps a LIMIT value and formats it (only ever our own ints, never user input).
func itoa(n int) string {
	if n <= 0 || n > 500 {
		n = 50
	}
	return strconv.Itoa(n)
}
