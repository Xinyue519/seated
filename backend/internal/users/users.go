// Package users holds accounts, preferences, saved restaurants and visit history.
package users

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrEmailTaken = errors.New("email already in use")
)

type User struct {
	ID           string `json:"-"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	Role         string `json:"-"`
	PasswordHash string `json:"-"`
}

type Preferences struct {
	Cuisines    []string `json:"cuisines"`
	PriceLevels []int32  `json:"priceLevels"`
	Dietary     []string `json:"dietary"`
	PartySize   int      `json:"partySize"`
}

type Visit struct {
	ID           string
	RestaurantID string
	VisitedOn    time.Time
	PartySize    int
	Recommended  bool
	Feedback     *string
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

func HashPassword(pw string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(h), err
}

// CheckPassword compares in constant time; false on any mismatch.
func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

const userCols = `id::text, email, name, role, password_hash`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.PasswordHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &u, nil
}

func (r *Repo) GetByEmail(ctx context.Context, email string) (*User, error) {
	return scanUser(r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE lower(email) = lower($1)`, strings.TrimSpace(email)))
}

func (r *Repo) GetByID(ctx context.Context, id string) (*User, error) {
	return scanUser(r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id))
}

// Upsert creates the user or updates name/role/password (used by the seed script).
func (r *Repo) Upsert(ctx context.Context, email, name, password, role string) (*User, error) {
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	existing, err := r.GetByEmail(ctx, email)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	if existing != nil {
		_, err = r.pool.Exec(ctx, `UPDATE users SET name = $2, role = $3, password_hash = $4 WHERE id = $1`, existing.ID, name, role, hash)
		if err != nil {
			return nil, err
		}
		return r.GetByID(ctx, existing.ID)
	}
	return scanUser(r.pool.QueryRow(ctx,
		`INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING `+userCols,
		email, name, hash, role))
}

func (r *Repo) UpdateProfile(ctx context.Context, id, name, email string) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET name = $2, email = $3 WHERE id = $1`, id, strings.TrimSpace(name), strings.TrimSpace(email))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrEmailTaken
	}
	return err
}

func (r *Repo) GetPreferences(ctx context.Context, userID string) (Preferences, error) {
	p := Preferences{Cuisines: []string{}, PriceLevels: []int32{}, Dietary: []string{}, PartySize: 2}
	err := r.pool.QueryRow(ctx,
		`SELECT cuisines, price_levels::int[], dietary, party_size FROM user_preferences WHERE user_id = $1`, userID,
	).Scan(&p.Cuisines, &p.PriceLevels, &p.Dietary, &p.PartySize)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	return p, err
}

func (r *Repo) PutPreferences(ctx context.Context, userID string, p Preferences) error {
	if p.PartySize < 1 || p.PartySize > 20 {
		return fmt.Errorf("partySize must be between 1 and 20")
	}
	for _, lvl := range p.PriceLevels {
		if lvl < 1 || lvl > 4 {
			return fmt.Errorf("priceLevels must be 1-4")
		}
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_preferences (user_id, cuisines, price_levels, dietary, party_size, updated_at)
		VALUES ($1, $2, $3::int[]::smallint[], $4, $5, now())
		ON CONFLICT (user_id) DO UPDATE SET cuisines = EXCLUDED.cuisines, price_levels = EXCLUDED.price_levels,
			dietary = EXCLUDED.dietary, party_size = EXCLUDED.party_size, updated_at = now()`,
		userID, nonNil(p.Cuisines), nonNilInt(p.PriceLevels), nonNil(p.Dietary), p.PartySize)
	return err
}

func (r *Repo) SavedIDs(ctx context.Context, userID string) ([]string, error) {
	return r.ids(ctx, `SELECT restaurant_id FROM saved_restaurants WHERE user_id = $1 ORDER BY created_at`, userID)
}

func (r *Repo) VisitedIDs(ctx context.Context, userID string) ([]string, error) {
	return r.ids(ctx, `SELECT DISTINCT restaurant_id FROM visits WHERE user_id = $1`, userID)
}

func (r *Repo) SetSaved(ctx context.Context, userID, restaurantID string, saved bool) error {
	var err error
	if saved {
		_, err = r.pool.Exec(ctx, `INSERT INTO saved_restaurants (user_id, restaurant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userID, restaurantID)
	} else {
		_, err = r.pool.Exec(ctx, `DELETE FROM saved_restaurants WHERE user_id = $1 AND restaurant_id = $2`, userID, restaurantID)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return ErrNotFound
	}
	return err
}

func (r *Repo) Visits(ctx context.Context, userID string) ([]Visit, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, restaurant_id, visited_on, party_size, recommended, feedback
		FROM visits WHERE user_id = $1 ORDER BY visited_on DESC`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Visit, error) {
		var v Visit
		err := row.Scan(&v.ID, &v.RestaurantID, &v.VisitedOn, &v.PartySize, &v.Recommended, &v.Feedback)
		return v, err
	})
}

// SetFeedback only touches visits owned by userID.
func (r *Repo) SetFeedback(ctx context.Context, userID, visitID, value string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE visits SET feedback = $3 WHERE id::text = $1 AND user_id = $2`, visitID, userID, value)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) ids(ctx context.Context, sql string, args ...any) ([]string, error) {
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if out == nil {
		out = []string{}
	}
	return out, err
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func nonNilInt(s []int32) []int32 {
	if s == nil {
		return []int32{}
	}
	return s
}
