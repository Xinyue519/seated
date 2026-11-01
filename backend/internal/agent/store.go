package agent

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrMessageNotFound = errors.New("message not found")

// Store persists conversations and messages so the agent keeps context across turns
// and an in-progress workflow survives a closed browser tab.
type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

type storedMessage struct {
	ChatMessage
	LLMNote string
}

// ActiveConversation returns the user's conversation from the last 12 hours, or starts one.
func (s *Store) ActiveConversation(ctx context.Context, userID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		SELECT id::text FROM conversations
		WHERE user_id = $1 AND updated_at > now() - interval '12 hours'
		ORDER BY updated_at DESC LIMIT 1`, userID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	err = s.pool.QueryRow(ctx, `INSERT INTO conversations (user_id) VALUES ($1) RETURNING id::text`, userID).Scan(&id)
	return id, err
}

func (s *Store) Add(ctx context.Context, conversationID, role, text string, p Payload, llmNote string) (ChatMessage, error) {
	data, err := json.Marshal(p)
	if err != nil {
		return ChatMessage{}, err
	}
	var id string
	err = s.pool.QueryRow(ctx, `
		INSERT INTO messages (conversation_id, role, content, payload, llm_note) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
		conversationID, role, text, data, llmNote).Scan(&id)
	if err != nil {
		return ChatMessage{}, err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE conversations SET updated_at = now() WHERE id = $1`, conversationID)
	return ChatMessage{ID: id, Role: role, Text: text, Payload: p}, nil
}

// Get loads a message only if it belongs to one of userID's conversations.
func (s *Store) Get(ctx context.Context, userID, messageID string) (*storedMessage, string, error) {
	var m storedMessage
	var payload []byte
	var convID string
	err := s.pool.QueryRow(ctx, `
		SELECT m.id::text, m.role, m.content, m.payload, m.llm_note, m.conversation_id::text
		FROM messages m JOIN conversations c ON c.id = m.conversation_id
		WHERE m.id::text = $1 AND c.user_id = $2`, messageID, userID).
		Scan(&m.ID, &m.Role, &m.Text, &payload, &m.LLMNote, &convID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrMessageNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if err := json.Unmarshal(payload, &m.Payload); err != nil {
		return nil, "", err
	}
	return &m, convID, nil
}

func (s *Store) UpdatePayload(ctx context.Context, messageID string, p Payload) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE messages SET payload = $2 WHERE id::text = $1`, messageID, data)
	return err
}

// History returns the last `limit` messages, oldest first.
func (s *Store) History(ctx context.Context, conversationID string, limit int) ([]storedMessage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, role, content, payload, llm_note FROM (
			SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2
		) recent ORDER BY created_at`, conversationID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (storedMessage, error) {
		var m storedMessage
		var payload []byte
		if err := row.Scan(&m.ID, &m.Role, &m.Text, &payload, &m.LLMNote); err != nil {
			return m, err
		}
		err := json.Unmarshal(payload, &m.Payload)
		return m, err
	})
}
