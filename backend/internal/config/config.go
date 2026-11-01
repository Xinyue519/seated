// Package config loads settings from environment variables (and a local .env file in dev).
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Port        string
	DatabaseURL string
	RedisURL    string

	OpenAIAPIKey         string
	OpenAIBaseURL        string
	OpenAIModel          string
	OpenAIEmbeddingModel string

	// Server-side only; used by cmd/import-places, never sent to the frontend.
	GooglePlacesAPIKey string
	// Upper bound on LLM tool-calling iterations per user turn.
	AgentMaxSteps int
	LLMTimeout    time.Duration

	SessionTTL     time.Duration
	CookieSecure   bool
	FrontendOrigin string
	Timezone       *time.Location
}

// Load reads .env (if present) and then the process environment.
func Load() (*Config, error) {
	// Missing .env is fine (production sets real env vars).
	_ = godotenv.Load()

	tzName := env("APP_TIMEZONE", "America/New_York")
	tz, err := time.LoadLocation(tzName)
	if err != nil {
		return nil, fmt.Errorf("APP_TIMEZONE %q: %w", tzName, err)
	}

	c := &Config{
		Port:                 env("PORT", "8080"),
		DatabaseURL:          env("DATABASE_URL", "postgres://seated:seated@localhost:5432/seated?sslmode=disable"),
		RedisURL:             env("REDIS_URL", "redis://localhost:6379/0"),
		OpenAIAPIKey:         strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
		OpenAIBaseURL:        strings.TrimRight(env("OPENAI_BASE_URL", "https://api.openai.com/v1"), "/"),
		OpenAIModel:          env("OPENAI_MODEL", "gpt-4o-mini"),
		OpenAIEmbeddingModel: env("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
		GooglePlacesAPIKey:   strings.TrimSpace(os.Getenv("GOOGLE_PLACES_API_KEY")),
		AgentMaxSteps:        envInt("AGENT_MAX_STEPS", 8),
		LLMTimeout:           envDuration("LLM_TIMEOUT", 45*time.Second),
		SessionTTL:           envDuration("SESSION_TTL", 7*24*time.Hour),
		CookieSecure:         envBool("COOKIE_SECURE", false),
		FrontendOrigin:       env("FRONTEND_ORIGIN", "http://localhost:5173"),
		Timezone:             tz,
	}
	return c, nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v, err := strconv.ParseBool(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}
