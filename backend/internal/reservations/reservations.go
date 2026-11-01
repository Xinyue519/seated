// Package reservations puts booking behind a Provider interface. v1 ships a
// Postgres-backed mock provider; OpenTable/Resy can implement the same interface
// once partner access is approved.
package reservations

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound    = errors.New("reservation not found")
	ErrSlotTaken   = errors.New("slot no longer available")
	ErrUnavailable = errors.New("slot not offered")
	ErrInvalid     = errors.New("invalid reservation request")
)

// Reservation is the API shape (matches the frontend `Reservation` type).
type Reservation struct {
	ID           string `json:"id"`
	UserID       string `json:"-"`
	RestaurantID string `json:"restaurantId"`
	Date         string `json:"date"`
	Time         string `json:"time"`
	PartySize    int    `json:"partySize"`
	Status       string `json:"status"`
	BookedBy     string `json:"bookedBy"`
}

type BookRequest struct {
	UserID         string
	RestaurantID   string
	Date           string // YYYY-MM-DD
	Time           string // "7:30"
	PartySize      int
	IdempotencyKey string
}

type Provider interface {
	Name() string
	OpenSlots(ctx context.Context, restaurantID, date string) ([]string, error)
	Book(ctx context.Context, req BookRequest) (*Reservation, error)
	Modify(ctx context.Context, userID, reservationID, date, slot string, partySize int) (*Reservation, error)
	Cancel(ctx context.Context, userID, reservationID string) (*Reservation, error)
}

// ----------------------------------------------------------------- repo

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

const cols = `id::text, user_id::text, restaurant_id, res_date::text, res_time, party_size, status, booked_by`

func scan(row pgx.Row) (*Reservation, error) {
	var r Reservation
	if err := row.Scan(&r.ID, &r.UserID, &r.RestaurantID, &r.Date, &r.Time, &r.PartySize, &r.Status, &r.BookedBy); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &r, nil
}

func (r *Repo) ListForUser(ctx context.Context, userID string) ([]Reservation, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+cols+` FROM reservations WHERE user_id = $1 ORDER BY res_date, res_time`, userID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Reservation, error) {
		res, err := scan(row)
		if err != nil {
			return Reservation{}, err
		}
		return *res, nil
	})
	if out == nil {
		out = []Reservation{}
	}
	return out, err
}

// Upcoming returns confirmed reservations from `today` onward.
func (r *Repo) Upcoming(ctx context.Context, userID, today string) ([]Reservation, error) {
	all, err := r.ListForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := []Reservation{}
	for _, x := range all {
		if x.Status == "confirmed" && x.Date >= today {
			out = append(out, x)
		}
	}
	return out, nil
}

// GetForUser enforces ownership: other users' reservations look like ErrNotFound.
func (r *Repo) GetForUser(ctx context.Context, userID, id string) (*Reservation, error) {
	if !looksLikeUUID(id) {
		return nil, ErrNotFound
	}
	return scan(r.pool.QueryRow(ctx, `SELECT `+cols+` FROM reservations WHERE id = $1 AND user_id = $2`, id, userID))
}

// --------------------------------------------------------- mock provider

// MockProvider simulates a reservation API on top of the availability_slots table.
// Each slot is one table, so a confirmed reservation takes it.
type MockProvider struct {
	pool    *pgxpool.Pool
	repo    *Repo
	timeout time.Duration
}

func NewMockProvider(pool *pgxpool.Pool) *MockProvider {
	return &MockProvider{pool: pool, repo: NewRepo(pool), timeout: 5 * time.Second}
}

func (p *MockProvider) Name() string { return "mock" }

func (p *MockProvider) OpenSlots(ctx context.Context, restaurantID, date string) ([]string, error) {
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return nil, fmt.Errorf("%w: date must be YYYY-MM-DD", ErrInvalid)
	}
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	rows, err := p.pool.Query(ctx, `
		SELECT s.slot_time FROM availability_slots s
		WHERE s.restaurant_id = $1 AND s.slot_date = $2
		  AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.restaurant_id = s.restaurant_id
		                  AND r.res_date = s.slot_date AND r.res_time = s.slot_time AND r.status = 'confirmed')`,
		restaurantID, date)
	if err != nil {
		return nil, err
	}
	slots, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	SortSlots(slots)
	if slots == nil {
		slots = []string{}
	}
	return slots, nil
}

func (p *MockProvider) Book(ctx context.Context, req BookRequest) (*Reservation, error) {
	if req.PartySize < 1 || req.PartySize > 20 || req.IdempotencyKey == "" {
		return nil, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()

	// Idempotency: a retried request returns the original booking.
	if existing, err := scan(p.pool.QueryRow(ctx, `SELECT `+cols+` FROM reservations WHERE idempotency_key = $1`, req.IdempotencyKey)); err == nil {
		if existing.UserID != req.UserID {
			return nil, ErrInvalid
		}
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	if err := p.ensureOffered(ctx, req.RestaurantID, req.Date, req.Time); err != nil {
		return nil, err
	}
	res, err := scan(p.pool.QueryRow(ctx, `
		INSERT INTO reservations (user_id, restaurant_id, res_date, res_time, party_size, status, booked_by, provider, idempotency_key)
		VALUES ($1, $2, $3, $4, $5, 'confirmed', 'agent', 'mock', $6)
		RETURNING `+cols, req.UserID, req.RestaurantID, req.Date, req.Time, req.PartySize, req.IdempotencyKey))
	return res, translate(err)
}

func (p *MockProvider) Modify(ctx context.Context, userID, id, date, slot string, partySize int) (*Reservation, error) {
	if partySize < 1 || partySize > 20 {
		return nil, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	cur, err := p.repo.GetForUser(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if cur.Status != "confirmed" {
		return nil, fmt.Errorf("%w: reservation is %s", ErrInvalid, cur.Status)
	}
	if cur.Date != date || cur.Time != slot {
		if err := p.ensureOffered(ctx, cur.RestaurantID, date, slot); err != nil {
			return nil, err
		}
	}
	res, err := scan(p.pool.QueryRow(ctx, `
		UPDATE reservations SET res_date = $3, res_time = $4, party_size = $5, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'confirmed' RETURNING `+cols, id, userID, date, slot, partySize))
	return res, translate(err)
}

func (p *MockProvider) Cancel(ctx context.Context, userID, id string) (*Reservation, error) {
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	cur, err := p.repo.GetForUser(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if cur.Status == "cancelled" {
		return cur, nil // already cancelled: idempotent
	}
	return scan(p.pool.QueryRow(ctx, `
		UPDATE reservations SET status = 'cancelled', updated_at = now()
		WHERE id = $1 AND user_id = $2 RETURNING `+cols, id, userID))
}

func (p *MockProvider) ensureOffered(ctx context.Context, restaurantID, date, slot string) error {
	var ok bool
	err := p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM availability_slots WHERE restaurant_id = $1 AND slot_date = $2 AND slot_time = $3)`,
		restaurantID, date, slot).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrUnavailable
	}
	return nil
}

// translate maps the "one confirmed booking per slot" unique violation to ErrSlotTaken.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if pgErr.ConstraintName == "reservations_slot_taken" {
			return ErrSlotTaken
		}
	}
	return err
}

// SortSlots orders "5:30" < "6:00" < ... treating all times as evening.
func SortSlots(slots []string) {
	sort.Slice(slots, func(i, j int) bool { return slotMinutes(slots[i]) < slotMinutes(slots[j]) })
}

func slotMinutes(s string) int {
	h, m, _ := strings.Cut(s, ":")
	hh, _ := strconv.Atoi(h)
	mm, _ := strconv.Atoi(m)
	return hh*60 + mm
}

func looksLikeUUID(s string) bool {
	return len(s) == 36 && strings.Count(s, "-") == 4
}
