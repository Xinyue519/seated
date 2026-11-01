// Package places is a minimal client for the Google Places API (New), used only by
// cmd/import-places to enrich the curated restaurant dataset with real addresses,
// coordinates, hours and photos. Never called at request time, so there's no
// per-user-search cost. The API key is server-side only and never reaches the frontend.
package places

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const baseURL = "https://places.googleapis.com/v1"

// Fields we actually use. Keeping the field mask narrow matters: the New Places API
// bills by which field groups you request (Essentials/Pro/Enterprise tiers).
const searchFieldMask = "places.id,places.formattedAddress,places.location," +
	"places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours.weekdayDescriptions," +
	"places.priceLevel,places.rating,places.userRatingCount,places.photos.name"

type Client struct {
	apiKey string
	http   *http.Client
}

func New(apiKey string, timeout time.Duration) *Client {
	return &Client{apiKey: apiKey, http: &http.Client{Timeout: timeout}}
}

func (c *Client) Enabled() bool { return c.apiKey != "" }

// Place is the subset of a Google Places result we map into our restaurants table.
type Place struct {
	ID                  string
	FormattedAddress    string
	Lat, Lng            float64
	Phone               string
	Website             string
	WeekdayDescriptions []string
	PriceLevel          string
	Rating              float64
	UserRatingCount     int
	PhotoName           string // first photo's resource name, e.g. "places/.../photos/..."
}

// FindRestaurant runs a Text Search biased to Manhattan and returns the top match.
// Returns (nil, nil) when the search succeeds but finds nothing — that's a normal
// "no match for this name" outcome, not an error.
func (c *Client) FindRestaurant(ctx context.Context, query string) (*Place, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("places: no API key configured")
	}
	body := map[string]any{
		"textQuery":      query,
		"maxResultCount": 1,
		"includedType":   "restaurant",
		// Manhattan, generous radius — every seed restaurant is somewhere downtown.
		"locationBias": map[string]any{
			"circle": map[string]any{
				"center": map[string]float64{"latitude": 40.735, "longitude": -73.995},
				"radius": 15000,
			},
		},
	}
	var out struct {
		Places []struct {
			ID               string `json:"id"`
			FormattedAddress string `json:"formattedAddress"`
			Location         struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
			} `json:"location"`
			NationalPhoneNumber string  `json:"nationalPhoneNumber"`
			WebsiteURI          string  `json:"websiteUri"`
			PriceLevel          string  `json:"priceLevel"`
			Rating              float64 `json:"rating"`
			UserRatingCount     int     `json:"userRatingCount"`
			RegularOpeningHours struct {
				WeekdayDescriptions []string `json:"weekdayDescriptions"`
			} `json:"regularOpeningHours"`
			Photos []struct {
				Name string `json:"name"`
			} `json:"photos"`
		} `json:"places"`
	}
	if err := c.post(ctx, "/places:searchText", searchFieldMask, body, &out); err != nil {
		return nil, err
	}
	if len(out.Places) == 0 {
		return nil, nil
	}
	p := out.Places[0]
	place := &Place{
		ID:                  p.ID,
		FormattedAddress:    p.FormattedAddress,
		Lat:                 p.Location.Latitude,
		Lng:                 p.Location.Longitude,
		Phone:               p.NationalPhoneNumber,
		Website:             p.WebsiteURI,
		WeekdayDescriptions: p.RegularOpeningHours.WeekdayDescriptions,
		PriceLevel:          p.PriceLevel,
		Rating:              p.Rating,
		UserRatingCount:     p.UserRatingCount,
	}
	if len(p.Photos) > 0 {
		place.PhotoName = p.Photos[0].Name
	}
	return place, nil
}

// PhotoURI resolves a photo resource name to a long-lived Google-hosted image URL
// (no API key embedded in it, so it's safe to store and serve to the browser).
func (c *Client) PhotoURI(ctx context.Context, photoName string, maxWidthPx int) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("places: no API key configured")
	}
	url := fmt.Sprintf("%s/%s/media?maxWidthPx=%d&skipHttpRedirect=true", baseURL, photoName, maxWidthPx)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Goog-Api-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("places photo media: %d %s", resp.StatusCode, truncate(data))
	}
	var out struct {
		PhotoURI string `json:"photoUri"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", err
	}
	return out.PhotoURI, nil
}

// post retries transient failures (429 / 5xx / network). Imports are a low-volume,
// manually-triggered batch job, so a few retries with backoff is worth the cost.
func (c *Client) post(ctx context.Context, path, fieldMask string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt*attempt) * 700 * time.Millisecond):
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Goog-Api-Key", c.apiKey)
		req.Header.Set("X-Goog-FieldMask", fieldMask)

		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("places %s: %d %s", path, resp.StatusCode, truncate(data))
			continue
		}
		if resp.StatusCode >= 400 {
			return fmt.Errorf("places %s: %d %s", path, resp.StatusCode, truncate(data))
		}
		return json.Unmarshal(data, out)
	}
	return lastErr
}

func truncate(b []byte) string {
	if len(b) > 300 {
		return string(b[:300]) + "…"
	}
	return string(b)
}
