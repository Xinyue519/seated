// Package sessions stores login sessions in Redis. The browser only ever sees
// an opaque random id in an HttpOnly cookie.
package sessions

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const CookieName = "seated_session"

type Session struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

type Store struct {
	rdb *redis.Client
	ttl time.Duration
}

func New(redisURL string, ttl time.Duration) (*Store, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	return &Store{rdb: redis.NewClient(opts), ttl: ttl}, nil
}

func (s *Store) TTL() time.Duration { return s.ttl }

func (s *Store) Ping(ctx context.Context) error { return s.rdb.Ping(ctx).Err() }

func (s *Store) Close() error { return s.rdb.Close() }

func key(id string) string { return "session:" + id }

// Create stores a new session and returns its id.
func (s *Store) Create(ctx context.Context, sess Session) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(buf)
	data, err := json.Marshal(sess)
	if err != nil {
		return "", err
	}
	if err := s.rdb.Set(ctx, key(id), data, s.ttl).Err(); err != nil {
		return "", err
	}
	return id, nil
}

// Get returns the session (nil if missing or expired) and slides its expiry.
func (s *Store) Get(ctx context.Context, id string) (*Session, error) {
	if id == "" {
		return nil, nil
	}
	// GET + EXPIRE in one round trip (works on Redis < 6.2, which lacks GETEX).
	pipe := s.rdb.TxPipeline()
	get := pipe.Get(ctx, key(id))
	pipe.Expire(ctx, key(id), s.ttl)
	_, _ = pipe.Exec(ctx)
	data, err := get.Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var sess Session
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil, err
	}
	return &sess, nil
}

func (s *Store) Delete(ctx context.Context, id string) error {
	if id == "" {
		return nil
	}
	return s.rdb.Del(ctx, key(id)).Err()
}
