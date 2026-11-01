// Package llm is a small interface over chat completions with tool calling and
// embeddings, so the model/provider can be swapped later.
package llm

import (
	"context"
	"encoding/json"
	"errors"
)

var ErrDisabled = errors.New("LLM is not configured (set OPENAI_API_KEY)")

type Message struct {
	Role       string     `json:"role"` // system | user | assistant | tool
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"` // "function"
	Function FunctionCall `json:"function"`
}

type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string, as the API returns it
}

type Tool struct {
	Type     string       `json:"type"` // "function"
	Function FunctionSpec `json:"function"`
}

type FunctionSpec struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type ChatResponse struct {
	Message Message
	Usage   Usage
	Model   string
}

type Client interface {
	Enabled() bool
	Model() string
	Chat(ctx context.Context, messages []Message, tools []Tool) (*ChatResponse, error)
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	EmbeddingModel() string
}
