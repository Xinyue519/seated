// Command import-places enriches the curated restaurant rows (already loaded by
// `make seed`) with real data from the Google Places API: address, coordinates,
// phone, website, hours and a real photo. It never touches name, cuisine,
// description, tags or price_level — those stay hand-curated.
//
// Run occasionally, not on every deploy: each restaurant costs one Places Text
// Search call (plus one Photo Media call when a photo is found).
//
//	go run ./cmd/import-places
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"seated/internal/config"
	"seated/internal/database"
	"seated/internal/places"
)

type row struct {
	ID           string
	Name         string
	Neighborhood string
}

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))
	cfg, err := config.Load()
	if err != nil {
		fail(err)
	}
	if cfg.GooglePlacesAPIKey == "" {
		fail(fmt.Errorf("GOOGLE_PLACES_API_KEY is not set"))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fail(err)
	}
	defer pool.Close()

	client := places.New(cfg.GooglePlacesAPIKey, 15*time.Second)

	rows, err := pool.Query(ctx, `SELECT id, name, neighborhood FROM restaurants ORDER BY id`)
	if err != nil {
		fail(err)
	}
	var restaurants []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.ID, &r.Name, &r.Neighborhood); err != nil {
			fail(err)
		}
		restaurants = append(restaurants, r)
	}
	rows.Close()

	var updated, noMatch, noPhoto, failed int
	for _, r := range restaurants {
		query := fmt.Sprintf("%s, %s, New York, NY", r.Name, r.Neighborhood)
		place, err := client.FindRestaurant(ctx, query)
		if err != nil {
			slog.Warn("places search failed", "restaurant", r.ID, "err", err)
			failed++
			time.Sleep(150 * time.Millisecond)
			continue
		}
		if place == nil {
			slog.Warn("no Google Places match", "restaurant", r.ID, "query", query)
			noMatch++
			continue
		}

		var photoURL string
		if place.PhotoName != "" {
			photoURL, err = client.PhotoURI(ctx, place.PhotoName, 800)
			if err != nil {
				slog.Warn("photo lookup failed", "restaurant", r.ID, "err", err)
				noPhoto++
			}
		} else {
			noPhoto++
		}

		hours, _ := json.Marshal(place.WeekdayDescriptions)
		source, _ := json.Marshal(map[string]string{
			"provider":   "google_places",
			"place_id":   place.ID,
			"fetched_at": time.Now().UTC().Format(time.RFC3339),
		})

		_, err = pool.Exec(ctx, `
			UPDATE restaurants SET
				lat = $2, lng = $3,
				location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
				phone = NULLIF($4, ''),
				website = NULLIF($5, ''),
				hours = $6,
				image_url = COALESCE(NULLIF($7, ''), image_url),
				source = $8,
				updated_at = now()
			WHERE id = $1`,
			r.ID, place.Lat, place.Lng, place.Phone, place.Website, hours, photoURL, source)
		if err != nil {
			slog.Error("update failed", "restaurant", r.ID, "err", err)
			failed++
			continue
		}
		updated++
		slog.Info("imported", "restaurant", r.ID, "address", place.FormattedAddress, "has_photo", photoURL != "")

		// Stay well under Places' per-second quota; this is a one-off batch job, not a hot path.
		time.Sleep(150 * time.Millisecond)
	}

	slog.Info("import-places complete", "updated", updated, "no_match", noMatch, "no_photo", noPhoto, "failed", failed, "total", len(restaurants))
}

func fail(err error) {
	slog.Error("import-places failed", "err", err)
	os.Exit(1)
}
