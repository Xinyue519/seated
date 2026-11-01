// Command seed applies migrations and loads the demo dataset.
//
//	go run ./cmd/seed
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"seated/internal/config"
	"seated/internal/database"
	"seated/internal/llm"
	"seated/internal/seed"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))
	cfg, err := config.Load()
	if err != nil {
		fail(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fail(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool); err != nil {
		fail(err)
	}

	client := llm.NewOpenAI(cfg.OpenAIAPIKey, cfg.OpenAIBaseURL, cfg.OpenAIModel, cfg.OpenAIEmbeddingModel, cfg.LLMTimeout)
	err = seed.Run(ctx, pool, client, seed.Options{
		DemoEmail:     envOr("SEED_DEMO_EMAIL", "stella@example.com"),
		DemoPassword:  envOr("SEED_DEMO_PASSWORD", "demo-password"),
		AdminEmail:    os.Getenv("SEED_ADMIN_EMAIL"),
		AdminPassword: os.Getenv("SEED_ADMIN_PASSWORD"),
		Timezone:      cfg.Timezone,
	})
	if err != nil {
		fail(err)
	}
	slog.Info("seed complete")
}

func envOr(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}

func fail(err error) {
	slog.Error("seed failed", "err", err)
	os.Exit(1)
}
