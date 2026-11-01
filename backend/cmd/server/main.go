// Command server runs the Seated API (modular monolith).
//
//	go run ./cmd/server
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"seated/internal/agent"
	"seated/internal/api"
	"seated/internal/config"
	"seated/internal/database"
	"seated/internal/llm"
	"seated/internal/reservations"
	"seated/internal/restaurants"
	"seated/internal/sessions"
	"seated/internal/users"
	"seated/internal/workflows"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	slog.SetDefault(log)

	if err := run(log); err != nil {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool); err != nil {
		return err
	}

	sess, err := sessions.New(cfg.RedisURL, cfg.SessionTTL)
	if err != nil {
		return err
	}
	defer sess.Close()
	if err := sess.Ping(ctx); err != nil {
		return errors.New("redis unreachable at " + cfg.RedisURL + ": " + err.Error())
	}

	client := llm.NewOpenAI(cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, cfg.OpenAIModel, cfg.OpenAIEmbeddingModel, cfg.LLMTimeout)
	if !client.Enabled() {
		log.Warn("OPENAI_API_KEY is not set: the API runs, but the agent will reply that it isn't configured")
	}

	userRepo := users.NewRepo(pool)
	restaurantRepo := restaurants.NewRepo(pool)
	reservationRepo := reservations.NewRepo(pool)
	provider := reservations.NewMockProvider(pool)
	recorder := workflows.NewRecorder(pool)

	orchestrator := agent.New(agent.Deps{
		LLM: client, Restaurants: restaurantRepo, Users: userRepo, Reservations: reservationRepo,
		Provider: provider, Recorder: recorder, Store: agent.NewStore(pool),
		Timezone: cfg.Timezone, MaxSteps: cfg.AgentMaxSteps, Log: log,
	})

	srv := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: api.New(api.Deps{
			Config: cfg, Pool: pool, Sessions: sess, Users: userRepo, Restaurants: restaurantRepo,
			Reservations: reservationRepo, Provider: provider, Recorder: recorder, Agent: orchestrator, Log: log,
		}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// Agent turns can take several LLM round-trips.
		WriteTimeout: 2 * time.Minute,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", srv.Addr, "model", cfg.OpenAIModel, "provider", provider.Name())
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
