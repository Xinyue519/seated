package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// OpenAI talks to the Chat Completions and Embeddings endpoints directly over HTTP.
type OpenAI struct {
	apiKey     string
	baseURL    string
	model      string
	embedModel string
	http       *http.Client
}

func NewOpenAI(apiKey, baseURL, model, embedModel string, timeout time.Duration) *OpenAI {
	return &OpenAI{
		apiKey:     apiKey,
		baseURL:    baseURL,
		model:      model,
		embedModel: embedModel,
		http:       &http.Client{Timeout: timeout},
	}
}

func (o *OpenAI) Enabled() bool          { return o.apiKey != "" }
func (o *OpenAI) Model() string          { return o.model }
func (o *OpenAI) EmbeddingModel() string { return o.embedModel }

func (o *OpenAI) Chat(ctx context.Context, messages []Message, tools []Tool) (*ChatResponse, error) {
	if !o.Enabled() {
		return nil, ErrDisabled
	}
	body := map[string]any{"model": o.model, "messages": messages}
	if len(tools) > 0 {
		body["tools"] = tools
		body["parallel_tool_calls"] = true
	}
	var out struct {
		Model   string `json:"model"`
		Choices []struct {
			Message Message `json:"message"`
		} `json:"choices"`
		Usage Usage `json:"usage"`
	}
	if err := o.post(ctx, "/chat/completions", body, &out); err != nil {
		return nil, err
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("openai: empty response")
	}
	return &ChatResponse{Message: out.Choices[0].Message, Usage: out.Usage, Model: out.Model}, nil
}

func (o *OpenAI) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if !o.Enabled() {
		return nil, ErrDisabled
	}
	var out struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := o.post(ctx, "/embeddings", map[string]any{"model": o.embedModel, "input": texts}, &out); err != nil {
		return nil, err
	}
	vecs := make([][]float32, len(texts))
	for _, d := range out.Data {
		if d.Index >= 0 && d.Index < len(vecs) {
			vecs[d.Index] = d.Embedding
		}
	}
	return vecs, nil
}

// post retries transient failures (429 / 5xx / network). These calls are reads with no
// side effects, so retrying is safe. Booking calls are never retried blindly.
func (o *OpenAI) post(ctx context.Context, path string, body any, out any) error {
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
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+path, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+o.apiKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := o.http.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("openai %s: %d %s", path, resp.StatusCode, truncate(data))
			continue
		}
		if resp.StatusCode >= 400 {
			return fmt.Errorf("openai %s: %d %s", path, resp.StatusCode, truncate(data))
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
