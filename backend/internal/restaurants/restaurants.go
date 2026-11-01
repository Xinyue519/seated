// Package restaurants is restaurant retrieval: structured filters (SQL + PostGIS)
// and semantic similarity (pgvector).
package restaurants

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("restaurant not found")

// Restaurant is the API shape (matches the frontend `Restaurant` type).
type Restaurant struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Cuisine      string   `json:"cuisine"`
	Group        string   `json:"group"`
	Neighborhood string   `json:"neighborhood"`
	PriceLevel   int      `json:"priceLevel"`
	Lat          float64  `json:"lat"`
	Lng          float64  `json:"lng"`
	Tags         []string `json:"tags"`
	Description  string   `json:"description"`
	ImageURL     *string  `json:"imageUrl,omitempty"`
	Vegetarian   bool     `json:"vegetarian,omitempty"`
	Website      *string  `json:"website,omitempty"`
}

// Neighborhood centers used for "near X" searches.
var Neighborhoods = map[string][2]float64{
	"West Village":      {40.7362, -74.0062},
	"Greenwich Village": {40.7300, -73.9985},
	"SoHo":              {40.7240, -74.0030},
	"Nolita":            {40.7212, -73.9940},
	"Tribeca":           {40.7168, -74.0095},
	"East Village":      {40.7280, -73.9828},
	"Lower East Side":   {40.7170, -73.9875},
	"Flatiron":          {40.7405, -73.9905},
	"NoMad":             {40.7455, -73.9880},
}

// CanonicalNeighborhood maps loose input ("west village", "LES") to a known name.
func CanonicalNeighborhood(s string) (string, bool) {
	n := strings.ToLower(strings.TrimSpace(s))
	aliases := map[string]string{"les": "Lower East Side", "the village": "West Village", "village": "West Village"}
	if v, ok := aliases[n]; ok {
		return v, true
	}
	for name := range Neighborhoods {
		if strings.ToLower(name) == n {
			return name, true
		}
	}
	return "", false
}

type Filter struct {
	Group        string
	Neighborhood string // canonical; matches the neighborhood or anything within RadiusM of its center
	RadiusM      float64
	MinPrice     int
	MaxPrice     int
	Vegetarian   bool
	ExcludeIDs   []string
	OnlyIDs      []string
	Limit        int
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

const cols = `r.id, r.name, r.cuisine, r.cuisine_group, r.neighborhood, r.price_level, r.lat, r.lng, r.tags, r.description, r.image_url, r.vegetarian, r.website`

func scan(row pgx.Row) (Restaurant, error) {
	var x Restaurant
	err := row.Scan(&x.ID, &x.Name, &x.Cuisine, &x.Group, &x.Neighborhood, &x.PriceLevel, &x.Lat, &x.Lng, &x.Tags, &x.Description, &x.ImageURL, &x.Vegetarian, &x.Website)
	return x, err
}

func collect(rows pgx.Rows) ([]Restaurant, error) {
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Restaurant, error) { return scan(row) })
	if out == nil {
		out = []Restaurant{}
	}
	return out, err
}

func (r *Repo) List(ctx context.Context) ([]Restaurant, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+cols+` FROM restaurants r ORDER BY r.name`)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

func (r *Repo) Get(ctx context.Context, id string) (*Restaurant, error) {
	x, err := scan(r.pool.QueryRow(ctx, `SELECT `+cols+` FROM restaurants r WHERE r.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &x, nil
}

func (r *Repo) GetMany(ctx context.Context, ids []string) (map[string]Restaurant, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+cols+` FROM restaurants r WHERE r.id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	list, err := collect(rows)
	out := make(map[string]Restaurant, len(list))
	for _, x := range list {
		out[x.ID] = x
	}
	return out, err
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9 ]+`)

func normalizeName(s string) string {
	return strings.Join(strings.Fields(nonAlnum.ReplaceAllString(strings.ToLower(s), "")), " ")
}

// FindByName does a forgiving name match ("lartusi", "L'Artusi", "artusi").
func (r *Repo) FindByName(ctx context.Context, name string) (*Restaurant, error) {
	n := normalizeName(name)
	if n == "" {
		return nil, ErrNotFound
	}
	x, err := scan(r.pool.QueryRow(ctx, `
		SELECT `+cols+` FROM restaurants r
		WHERE regexp_replace(lower(r.name), '[^a-z0-9 ]+', '', 'g') LIKE '%' || $1 || '%'
		   OR $1 LIKE '%' || regexp_replace(lower(r.name), '[^a-z0-9 ]+', '', 'g') || '%'
		ORDER BY length(r.name) LIMIT 1`, n))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &x, nil
}

// where builds the SQL predicate for a Filter. Args start at $start.
func where(f Filter, start int) (string, []any) {
	var conds []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", start+len(args)-1)
	}
	if f.Group != "" {
		conds = append(conds, "r.cuisine_group = "+arg(f.Group))
	}
	if f.Neighborhood != "" {
		radius := f.RadiusM
		if radius <= 0 {
			radius = 700
		}
		c := Neighborhoods[f.Neighborhood]
		conds = append(conds, fmt.Sprintf("(r.neighborhood = %s OR ST_DWithin(r.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s))",
			arg(f.Neighborhood), arg(c[1]), arg(c[0]), arg(radius)))
	}
	if f.MinPrice > 0 {
		conds = append(conds, "r.price_level >= "+arg(f.MinPrice))
	}
	if f.MaxPrice > 0 {
		conds = append(conds, "r.price_level <= "+arg(f.MaxPrice))
	}
	if f.Vegetarian {
		conds = append(conds, "(r.vegetarian OR 'vegetables' = ANY(r.tags))")
	}
	if len(f.ExcludeIDs) > 0 {
		conds = append(conds, "NOT (r.id = ANY("+arg(f.ExcludeIDs)+"))")
	}
	if f.OnlyIDs != nil {
		conds = append(conds, "r.id = ANY("+arg(f.OnlyIDs)+")")
	}
	if len(conds) == 0 {
		return "TRUE", args
	}
	return strings.Join(conds, " AND "), args
}

func limit(n int) int {
	if n <= 0 || n > 20 {
		return 8
	}
	return n
}

// Search applies structured filters, closest to the neighborhood first when one is given.
func (r *Repo) Search(ctx context.Context, f Filter) ([]Restaurant, error) {
	w, args := where(f, 1)
	order := "r.name"
	if c, ok := Neighborhoods[f.Neighborhood]; ok {
		order = fmt.Sprintf("ST_Distance(r.location, ST_SetSRID(ST_MakePoint(%f, %f), 4326)::geography)", c[1], c[0])
	}
	rows, err := r.pool.Query(ctx, fmt.Sprintf(`SELECT %s FROM restaurants r WHERE %s ORDER BY %s LIMIT %d`, cols, w, order, limit(f.Limit)), args...)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

// Scored is a restaurant with a similarity in [0,1] (1 = identical).
type Scored struct {
	Restaurant
	Similarity float64
}

// EmbeddingCount reports how many restaurants have embeddings (0 = semantic search unavailable).
func (r *Repo) EmbeddingCount(ctx context.Context) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_embeddings`).Scan(&n)
	return n, err
}

// SimilarToVector ranks by cosine similarity to an embedding (pgvector).
func (r *Repo) SimilarToVector(ctx context.Context, vec []float32, f Filter) ([]Scored, error) {
	w, args := where(f, 2)
	return r.similar(ctx, fmt.Sprintf(`
		SELECT %s, 1 - (e.embedding <=> $1::vector) AS sim
		FROM restaurants r JOIN restaurant_embeddings e ON e.restaurant_id = r.id
		WHERE %s ORDER BY e.embedding <=> $1::vector LIMIT %d`, cols, w, limit(f.Limit)),
		append([]any{VectorLiteral(vec)}, args...)...)
}

// SimilarToRestaurants ranks by similarity to the average embedding of the given restaurants.
func (r *Repo) SimilarToRestaurants(ctx context.Context, refIDs []string, f Filter) ([]Scored, error) {
	w, args := where(f, 2)
	return r.similar(ctx, fmt.Sprintf(`
		WITH ref AS (SELECT avg(embedding) AS v FROM restaurant_embeddings WHERE restaurant_id = ANY($1))
		SELECT %s, 1 - (e.embedding <=> ref.v) AS sim
		FROM restaurants r JOIN restaurant_embeddings e ON e.restaurant_id = r.id, ref
		WHERE ref.v IS NOT NULL AND %s ORDER BY e.embedding <=> ref.v LIMIT %d`, cols, w, limit(f.Limit)),
		append([]any{refIDs}, args...)...)
}

func (r *Repo) similar(ctx context.Context, sql string, args ...any) ([]Scored, error) {
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Scored, error) {
		var s Scored
		x := &s.Restaurant
		err := row.Scan(&x.ID, &x.Name, &x.Cuisine, &x.Group, &x.Neighborhood, &x.PriceLevel, &x.Lat, &x.Lng, &x.Tags, &x.Description, &x.ImageURL, &x.Vegetarian, &x.Website, &s.Similarity)
		return s, err
	})
	if out == nil {
		out = []Scored{}
	}
	return out, err
}

// SimilarByAttributes is the fallback when no embeddings exist: cuisine, shared tags and price.
func SimilarByAttributes(refs []Restaurant, candidates []Restaurant, n int) []Scored {
	out := make([]Scored, 0, len(candidates))
	for _, c := range candidates {
		best := 0.0
		for _, ref := range refs {
			score := 0.0
			if c.Group == ref.Group {
				score += 3
			}
			for _, t := range c.Tags {
				for _, rt := range ref.Tags {
					if t == rt {
						score++
					}
				}
			}
			if c.PriceLevel == ref.PriceLevel {
				score++
			}
			if score > best {
				best = score
			}
		}
		out = append(out, Scored{Restaurant: c, Similarity: best / 8})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Similarity > out[j].Similarity })
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// VectorLiteral formats a float slice as a pgvector literal: [0.1,0.2,...].
func VectorLiteral(v []float32) string {
	var b strings.Builder
	b.Grow(len(v) * 10)
	b.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%g", f)
	}
	b.WriteByte(']')
	return b.String()
}

func (r *Repo) EmbeddingHash(ctx context.Context, id string) (string, error) {
	var h string
	err := r.pool.QueryRow(ctx, `SELECT text_hash FROM restaurant_embeddings WHERE restaurant_id = $1`, id).Scan(&h)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return h, err
}

func (r *Repo) UpsertEmbedding(ctx context.Context, id string, vec []float32, hash, model string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO restaurant_embeddings (restaurant_id, embedding, text_hash, model, updated_at)
		VALUES ($1, $2::vector, $3, $4, now())
		ON CONFLICT (restaurant_id) DO UPDATE SET embedding = EXCLUDED.embedding, text_hash = EXCLUDED.text_hash,
			model = EXCLUDED.model, updated_at = now()`, id, VectorLiteral(vec), hash, model)
	return err
}

// EmbeddingText is what gets embedded for a restaurant.
func EmbeddingText(x Restaurant) string {
	return fmt.Sprintf("%s. %s restaurant in %s, NYC. Price %s. %s Tags: %s.",
		x.Name, x.Cuisine, x.Neighborhood, strings.Repeat("$", x.PriceLevel), x.Description, strings.Join(x.Tags, ", "))
}
