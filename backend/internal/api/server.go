// Package api is the HTTP layer: routing, sessions, permissions and JSON handlers.
// Paths match frontend/src/services/http.
package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"seated/internal/agent"
	"seated/internal/config"
	"seated/internal/reservations"
	"seated/internal/restaurants"
	"seated/internal/sessions"
	"seated/internal/users"
	"seated/internal/workflows"
)

type Server struct {
	cfg          *config.Config
	pool         *pgxpool.Pool
	sessions     *sessions.Store
	users        *users.Repo
	restaurants  *restaurants.Repo
	reservations *reservations.Repo
	provider     reservations.Provider
	recorder     *workflows.Recorder
	agent        *agent.Orchestrator
	log          *slog.Logger
}

type Deps struct {
	Config       *config.Config
	Pool         *pgxpool.Pool
	Sessions     *sessions.Store
	Users        *users.Repo
	Restaurants  *restaurants.Repo
	Reservations *reservations.Repo
	Provider     reservations.Provider
	Recorder     *workflows.Recorder
	Agent        *agent.Orchestrator
	Log          *slog.Logger
}

func New(d Deps) *Server {
	return &Server{
		cfg: d.Config, pool: d.Pool, sessions: d.Sessions, users: d.Users, restaurants: d.Restaurants,
		reservations: d.Reservations, provider: d.Provider, recorder: d.Recorder, agent: d.Agent, log: d.Log,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.health)

	// Auth
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.logout)

	// Current user
	mux.Handle("GET /api/me/bootstrap", s.authed(s.bootstrap))
	mux.Handle("PATCH /api/me", s.authed(s.updateProfile))
	mux.Handle("PUT /api/me/preferences", s.authed(s.updatePreferences))
	mux.Handle("PUT /api/me/saved/{restaurantID}", s.authed(s.setSaved(true)))
	mux.Handle("DELETE /api/me/saved/{restaurantID}", s.authed(s.setSaved(false)))
	mux.Handle("POST /api/me/visits/{visitID}/feedback", s.authed(s.feedback))
	mux.Handle("GET /api/me/runs", s.authed(s.myRuns))

	// Restaurants + reservations
	mux.Handle("GET /api/restaurants", s.authed(s.listRestaurants))
	mux.Handle("POST /api/restaurants/upsert", s.authed(s.upsertRestaurant))
	mux.Handle("GET /api/restaurants/{id}/availability", s.authed(s.availability))
	mux.Handle("GET /api/reservations", s.authed(s.listReservations))
	mux.Handle("POST /api/reservations/{id}/cancel", s.authed(s.cancelReservation))

	// Agent
	mux.Handle("POST /api/agent/messages", s.authed(s.agentMessage))
	mux.Handle("POST /api/agent/actions", s.authed(s.agentAction))

	// Admin
	mux.Handle("GET /api/admin/workflows", s.admin(s.listWorkflows))
	mux.Handle("GET /api/admin/runs", s.admin(s.allRuns))

	return s.recoverer(s.logRequests(s.cors(mux)))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	status := map[string]string{"postgres": "ok", "redis": "ok"}
	code := http.StatusOK
	if err := s.pool.Ping(ctx); err != nil {
		status["postgres"] = err.Error()
		code = http.StatusServiceUnavailable
	}
	if err := s.sessions.Ping(ctx); err != nil {
		status["redis"] = err.Error()
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, status)
}
