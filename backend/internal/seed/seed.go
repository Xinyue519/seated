// Package seed loads the demo dataset: restaurants, mock availability, published
// workflows, a demo user (and optionally an admin), and restaurant embeddings.
// Safe to re-run.
package seed

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"seated/internal/llm"
	"seated/internal/restaurants"
	"seated/internal/users"
	"seated/internal/workflows"
)

//go:embed data/restaurants.json
var restaurantsJSON []byte

type seedRestaurant struct {
	restaurants.Restaurant
	AlwaysFull bool `json:"alwaysFull"`
}

type Options struct {
	DemoEmail     string
	DemoPassword  string
	AdminEmail    string
	AdminPassword string
	Timezone      *time.Location
	Days          int // how many days of availability to generate
}

func Run(ctx context.Context, pool *pgxpool.Pool, client llm.Client, opt Options) error {
	var list []seedRestaurant
	if err := json.Unmarshal(restaurantsJSON, &list); err != nil {
		return fmt.Errorf("parse restaurants.json: %w", err)
	}
	if opt.Days <= 0 {
		opt.Days = 45
	}
	now := time.Now().In(opt.Timezone)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, opt.Timezone)

	if err := upsertRestaurants(ctx, pool, list); err != nil {
		return err
	}
	slog.Info("seeded restaurants", "count", len(list))

	if err := seedAvailability(ctx, pool, list, today, opt.Days); err != nil {
		return err
	}
	slog.Info("seeded availability", "days", opt.Days)

	rec := workflows.NewRecorder(pool)
	for _, d := range Workflows {
		if err := rec.UpsertPublished(ctx, d); err != nil {
			return err
		}
	}
	slog.Info("published workflows", "count", len(Workflows))

	userRepo := users.NewRepo(pool)
	demo, err := userRepo.Upsert(ctx, opt.DemoEmail, "Stella", opt.DemoPassword, "user")
	if err != nil {
		return fmt.Errorf("demo user: %w", err)
	}
	if err := seedDemoData(ctx, pool, userRepo, demo.ID, today); err != nil {
		return err
	}
	slog.Info("seeded demo user", "email", opt.DemoEmail)

	if opt.AdminEmail != "" && opt.AdminPassword != "" {
		if _, err := userRepo.Upsert(ctx, opt.AdminEmail, "Admin", opt.AdminPassword, "admin"); err != nil {
			return fmt.Errorf("admin user: %w", err)
		}
		slog.Info("seeded admin user", "email", opt.AdminEmail)
	}

	if client.Enabled() {
		n, err := embedRestaurants(ctx, restaurants.NewRepo(pool), client, list)
		if err != nil {
			return fmt.Errorf("embeddings: %w", err)
		}
		slog.Info("embedded restaurants", "updated", n)
	} else {
		slog.Warn("OPENAI_API_KEY not set: skipped embeddings (similarity falls back to cuisine/tag matching)")
	}
	return nil
}

func upsertRestaurants(ctx context.Context, pool *pgxpool.Pool, list []seedRestaurant) error {
	for _, r := range list {
		source, _ := json.Marshal(map[string]string{"name": "seed", "note": "demo dataset; descriptions are hand-written placeholders"})
		_, err := pool.Exec(ctx, `
			INSERT INTO restaurants (id, name, cuisine, cuisine_group, neighborhood, price_level, lat, lng, location,
				tags, description, description_is_generated, vegetarian, image_url, source, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography,
				$9, $10, true, $11, $12, $13, now())
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, cuisine = EXCLUDED.cuisine, cuisine_group = EXCLUDED.cuisine_group,
				neighborhood = EXCLUDED.neighborhood, price_level = EXCLUDED.price_level, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
				location = EXCLUDED.location, tags = EXCLUDED.tags, description = EXCLUDED.description,
				vegetarian = EXCLUDED.vegetarian, image_url = EXCLUDED.image_url, source = EXCLUDED.source, updated_at = now()`,
			r.ID, r.Name, r.Cuisine, r.Group, r.Neighborhood, r.PriceLevel, r.Lat, r.Lng, r.Tags, r.Description, r.Vegetarian, r.ImageURL, source)
		if err != nil {
			return fmt.Errorf("restaurant %s: %w", r.ID, err)
		}
	}
	return nil
}

var slotTimes = []string{"5:30", "6:00", "6:45", "7:30", "8:15", "9:00", "9:45"}

// jsHash matches the frontend mock's hash so mock and real mode show the same times.
func jsHash(s string) int {
	h := 7
	for _, c := range s {
		h = (h*31 + int(c)) % 100003
	}
	return h
}

// seedAvailability gives each restaurant a deterministic set of slots per day.
// "alwaysFull" restaurants get none, which exercises the agent's fallback path.
func seedAvailability(ctx context.Context, pool *pgxpool.Pool, list []seedRestaurant, today time.Time, days int) error {
	if _, err := pool.Exec(ctx, `DELETE FROM availability_slots WHERE slot_date < $1`, today.Format("2006-01-02")); err != nil {
		return err
	}
	for _, r := range list {
		if r.AlwaysFull {
			continue
		}
		for d := 0; d < days; d++ {
			date := today.AddDate(0, 0, d).Format("2006-01-02")
			h := jsHash(r.ID + ":" + date)
			for i, t := range slotTimes {
				if (h>>i)&1 == 1 || i == h%len(slotTimes) {
					if _, err := pool.Exec(ctx, `INSERT INTO availability_slots (restaurant_id, slot_date, slot_time) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
						r.ID, date, t); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

func seedDemoData(ctx context.Context, pool *pgxpool.Pool, repo *users.Repo, userID string, today time.Time) error {
	if err := repo.PutPreferences(ctx, userID, users.Preferences{
		Cuisines: []string{"italian", "japanese"}, PriceLevels: []int32{2, 3}, Dietary: []string{}, PartySize: 2,
	}); err != nil {
		return err
	}
	for _, id := range []string{"lartusi", "rubirosa", "raouls", "torrisi", "nakazawa"} {
		if err := repo.SetSaved(ctx, userID, id, true); err != nil {
			return err
		}
	}

	var visits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM visits WHERE user_id = $1`, userID).Scan(&visits); err != nil {
		return err
	}
	if visits == 0 {
		for _, v := range []struct {
			id          string
			daysAgo     int
			party       int
			recommended bool
		}{{"balthazar", 8, 2, true}, {"lartusi", 22, 2, false}, {"raouls", 30, 2, false}, {"rubirosa", 35, 5, true}} {
			if _, err := pool.Exec(ctx, `INSERT INTO visits (user_id, restaurant_id, visited_on, party_size, recommended) VALUES ($1, $2, $3, $4, $5)`,
				userID, v.id, today.AddDate(0, 0, -v.daysAgo).Format("2006-01-02"), v.party, v.recommended); err != nil {
				return err
			}
		}
	}

	var upcoming int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM reservations WHERE user_id = $1 AND res_date >= $2`, userID, today.Format("2006-01-02")).Scan(&upcoming); err != nil {
		return err
	}
	if upcoming == 0 {
		// Saturday after next, 8:00 for 4 at Raoul's.
		sat := today.AddDate(0, 0, (int(time.Saturday)-int(today.Weekday())+7)%7+7).Format("2006-01-02")
		if _, err := pool.Exec(ctx, `INSERT INTO availability_slots (restaurant_id, slot_date, slot_time) VALUES ('raouls', $1, '8:00') ON CONFLICT DO NOTHING`, sat); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO reservations (user_id, restaurant_id, res_date, res_time, party_size, status, booked_by, idempotency_key)
			VALUES ($1, 'raouls', $2, '8:00', 4, 'confirmed', 'agent', $3) ON CONFLICT DO NOTHING`,
			userID, sat, "seed:"+userID+":"+sat); err != nil {
			return err
		}
	}
	return nil
}

func embedRestaurants(ctx context.Context, repo *restaurants.Repo, client llm.Client, list []seedRestaurant) (int, error) {
	var ids, texts, hashes []string
	for _, r := range list {
		text := restaurants.EmbeddingText(r.Restaurant)
		sum := sha256.Sum256([]byte(client.EmbeddingModel() + "\n" + text))
		hash := hex.EncodeToString(sum[:])
		existing, err := repo.EmbeddingHash(ctx, r.ID)
		if err != nil {
			return 0, err
		}
		if existing == hash {
			continue // unchanged: don't pay to re-embed
		}
		ids, texts, hashes = append(ids, r.ID), append(texts, text), append(hashes, hash)
	}
	if len(texts) == 0 {
		return 0, nil
	}
	vecs, err := client.Embed(ctx, texts)
	if err != nil {
		return 0, err
	}
	for i, id := range ids {
		if len(vecs[i]) != 1536 {
			return 0, fmt.Errorf("embedding for %s has %d dims; the schema expects 1536 (text-embedding-3-small)", id, len(vecs[i]))
		}
		if err := repo.UpsertEmbedding(ctx, id, vecs[i], hashes[i], client.EmbeddingModel()); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}
