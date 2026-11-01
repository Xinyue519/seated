// Package agent is the single "Restaurant Concierge" agent: an orchestration loop on
// top of native LLM tool calling. The LLM proposes tool calls; this package validates
// and executes them, records every step, and pauses for user approval before any
// reservation is created, changed or cancelled.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"seated/internal/llm"
	"seated/internal/reservations"
	"seated/internal/restaurants"
	"seated/internal/users"
	"seated/internal/workflows"
)

var (
	ErrBadAction   = errors.New("unsupported action")
	ErrNotPending  = errors.New("that request is no longer waiting for approval")
	ErrInvalidText = errors.New("message text is required")
)

type Deps struct {
	LLM          llm.Client
	Restaurants  *restaurants.Repo
	Users        *users.Repo
	Reservations *reservations.Repo
	Provider     reservations.Provider
	Recorder     *workflows.Recorder
	Store        *Store
	Timezone     *time.Location
	MaxSteps     int
	Log          *slog.Logger
}

type Orchestrator struct {
	llm          llm.Client
	restaurants  *restaurants.Repo
	users        *users.Repo
	reservations *reservations.Repo
	provider     reservations.Provider
	recorder     *workflows.Recorder
	store        *Store
	tz           *time.Location
	maxSteps     int
	log          *slog.Logger
}

func New(d Deps) *Orchestrator {
	if d.MaxSteps <= 0 {
		d.MaxSteps = 8
	}
	if d.Log == nil {
		d.Log = slog.Default()
	}
	return &Orchestrator{
		llm: d.LLM, restaurants: d.Restaurants, users: d.Users, reservations: d.Reservations,
		provider: d.Provider, recorder: d.Recorder, store: d.Store, tz: d.Timezone, maxSteps: d.MaxSteps, log: d.Log,
	}
}

type presentation struct {
	ids     []string
	results []ResultItem
	chips   []Chip
	date    string
}

// turnState is everything one user turn accumulates while the loop runs.
type turnState struct {
	userID, convID, runID string
	now                   time.Time
	today                 string
	workflow              string
	saved, visited        []string
	semantic              bool
	seen                  map[string]string // restaurant ids the tools returned this turn
	presented             *presentation
	confirm               *ConfirmRequest
	toolsUsed             []string
	softFail              bool // a tool failed or found nothing bookable, and the agent recovered
}

// Action is a structured UI event (picked a time, approved, declined).
type Action struct {
	Type         string `json:"type"` // pick_slot | confirm | decline
	MessageID    string `json:"messageId"`
	RestaurantID string `json:"restaurantId"`
	Time         string `json:"time"`
	Date         string `json:"date"`
}

/* ------------------------------------------------------- entry points */

// Message handles a typed message. The frontend already shows the user's bubble.
func (o *Orchestrator) Message(ctx context.Context, userID, text string) (*Turn, error) {
	return o.turn(ctx, userID, text, false)
}

func (o *Orchestrator) Act(ctx context.Context, userID string, a Action) (*Turn, error) {
	switch a.Type {
	case "pick_slot":
		r, err := o.restaurants.Get(ctx, a.RestaurantID)
		if err != nil {
			return nil, err
		}
		today := o.now().Format("2006-01-02")
		text := fmt.Sprintf("%s at %s %s.", normalizeTime(a.Time), r.Name, dayPhrase(a.Date, today))
		// The UI didn't render a bubble for a click, so echo the user message back.
		return o.turn(ctx, userID, text, true)
	case "confirm":
		return o.confirm(ctx, userID, a.MessageID)
	case "decline":
		return o.decline(ctx, userID, a.MessageID)
	default:
		return nil, ErrBadAction
	}
}

// CancelReservation is a cancellation approved directly on the Reservations page.
func (o *Orchestrator) CancelReservation(ctx context.Context, userID, reservationID string) (*Turn, error) {
	res, err := o.reservations.GetForUser(ctx, userID, reservationID)
	if err != nil {
		return nil, err
	}
	r, _ := o.restaurants.Get(ctx, res.RestaurantID)
	name := res.RestaurantID
	if r != nil {
		name = r.Name
	}
	runID, err := o.recorder.Start(ctx, userID, "", workflows.Cancellation, "Cancel "+name+" (from Reservations)")
	if err != nil {
		return nil, err
	}
	o.step(ctx, runID, "verify_ownership", "ok", map[string]string{"reservation_id": res.ID}, nil, "user_id from session ✓", 0)
	o.step(ctx, runID, "request_user_confirmation", "ok", nil, nil, "approved on Reservations page", 0)
	start := time.Now()
	if _, err := o.provider.Cancel(ctx, userID, res.ID); err != nil {
		o.step(ctx, runID, "cancel_reservation", "failed", map[string]string{"reservation_id": res.ID}, errOut(err), err.Error(), time.Since(start))
		_ = o.recorder.SetStatus(ctx, runID, "stopped")
		return nil, err
	}
	o.step(ctx, runID, "cancel_reservation", "ok", map[string]string{"reservation_id": res.ID}, nil, "reservation "+res.ID, time.Since(start))
	_ = o.recorder.SetStatus(ctx, runID, "done")
	return o.finish(ctx, userID, []ChatMessage{}, runID, nil)
}

/* ------------------------------------------------------------- the loop */

func (o *Orchestrator) turn(ctx context.Context, userID, text string, echoUser bool) (*Turn, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, ErrInvalidText
	}
	if len(text) > 2000 {
		text = text[:2000]
	}
	user, err := o.users.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	convID, err := o.store.ActiveConversation(ctx, userID)
	if err != nil {
		return nil, err
	}
	history, err := o.store.History(ctx, convID, 24)
	if err != nil {
		return nil, err
	}
	userMsg, err := o.store.Add(ctx, convID, "user", text, Payload{}, "")
	if err != nil {
		return nil, err
	}
	runID, err := o.recorder.Start(ctx, userID, convID, workflows.Unclassified, text)
	if err != nil {
		return nil, err
	}

	out := []ChatMessage{}
	if echoUser {
		out = append(out, userMsg)
	}

	if !o.llm.Enabled() {
		o.step(ctx, runID, "understand_request", "failed", nil, nil, "OPENAI_API_KEY not set", 0)
		_ = o.recorder.SetStatus(ctx, runID, "stopped")
		msg, err := o.store.Add(ctx, convID, "agent", "The agent isn't configured yet: add OPENAI_API_KEY to backend/.env and restart the server.", Payload{}, "")
		if err != nil {
			return nil, err
		}
		return o.finish(ctx, userID, append(out, msg), runID, nil)
	}

	now := o.now()
	t := &turnState{
		userID: userID, convID: convID, runID: runID, now: now, today: now.Format("2006-01-02"),
		workflow: workflows.Unclassified, seen: map[string]string{},
	}
	if t.saved, err = o.users.SavedIDs(ctx, userID); err != nil {
		return nil, err
	}
	if t.visited, err = o.users.VisitedIDs(ctx, userID); err != nil {
		return nil, err
	}
	if n, err := o.restaurants.EmbeddingCount(ctx); err == nil && n > 0 {
		t.semantic = true
	}

	msgs := []llm.Message{{Role: "system", Content: systemPrompt(user.Name, now)}}
	for _, h := range history {
		msgs = append(msgs, historyMessage(h))
	}
	msgs = append(msgs, llm.Message{Role: "user", Content: text})

	finalText, stopped := o.loop(ctx, t, msgs)

	// Record which predefined workflow this turn ran.
	if t.workflow != workflows.Unclassified {
		_ = o.recorder.SetWorkflow(ctx, runID, t.workflow)
	}
	status := "done"
	switch {
	case stopped:
		status = "stopped"
	case t.confirm != nil:
		status = "waiting"
	case t.softFail:
		status = "recovered"
	}
	_ = o.recorder.SetStatus(ctx, runID, status)

	agentMsg, err := o.composeReply(ctx, t, finalText)
	if err != nil {
		return nil, err
	}
	out = append(out, agentMsg)

	var mapFilter *[]string
	if t.presented != nil {
		ids := append([]string{}, t.presented.ids...)
		mapFilter = &ids
	}
	return o.finish(ctx, userID, out, runID, mapFilter)
}

// loop runs model → tools → model until the model answers in text, asks for
// approval, or hits the step limit. Returns the final text and whether it gave up.
func (o *Orchestrator) loop(ctx context.Context, t *turnState, msgs []llm.Message) (string, bool) {
	toolset := o.tools()
	specs := o.toolSpecs()

	for i := 0; i < o.maxSteps; i++ {
		start := time.Now()
		resp, err := o.llm.Chat(ctx, msgs, specs)
		stepName := "understand_request"
		if i > 0 {
			stepName = "plan_next_step"
		}
		if err != nil {
			o.log.Error("llm call failed", "err", err, "run", t.runID)
			o.step(ctx, t.runID, stepName, "failed", nil, errOut(err), "model call failed: "+shorten(err.Error(), 120), time.Since(start))
			return "Sorry, I couldn't reach the model just now. Please try again in a moment.", true
		}
		o.step(ctx, t.runID, stepName, "ok", nil, map[string]any{"tool_calls": len(resp.Message.ToolCalls)},
			fmt.Sprintf("%s · %d tokens · %s", resp.Model, resp.Usage.PromptTokens+resp.Usage.CompletionTokens, plannedCalls(resp.Message.ToolCalls)),
			time.Since(start))

		if len(resp.Message.ToolCalls) == 0 {
			return strings.TrimSpace(resp.Message.Content), false
		}

		msgs = append(msgs, resp.Message)
		for _, call := range resp.Message.ToolCalls {
			result := o.execute(ctx, t, toolset, call)
			msgs = append(msgs, llm.Message{Role: "tool", ToolCallID: call.ID, Content: result})
		}
		// Approval requested: pause here. Execution only happens when the user confirms.
		if t.confirm != nil {
			_ = o.recorder.AddStep(ctx, t.runID, "request_user_confirmation", "waiting", t.confirm, nil, "awaiting user approval", 0)
			return strings.TrimSpace(resp.Message.Content), false
		}
	}
	o.step(ctx, t.runID, "step_limit", "failed", nil, nil, fmt.Sprintf("stopped after %d steps", o.maxSteps), 0)
	return "I couldn't finish that one. Could you rephrase or give me a bit more detail?", true
}

func (o *Orchestrator) execute(ctx context.Context, t *turnState, toolset map[string]tool, call llm.ToolCall) string {
	name := call.Function.Name
	t.toolsUsed = append(t.toolsUsed, name)
	args := json.RawMessage(call.Function.Arguments)
	if !json.Valid(args) {
		args = json.RawMessage(`{}`)
	}
	tl, ok := toolset[name]
	if !ok {
		o.step(ctx, t.runID, name, "failed", args, nil, "unknown tool", 0)
		t.softFail = true
		return `{"error":"unknown tool"}`
	}
	if t.confirm != nil {
		// Only one approval per turn; skip anything after it.
		return `{"error":"skipped: waiting for the user to approve the previous request"}`
	}

	toolCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	start := time.Now()
	out, detail, err := tl.run(toolCtx, t, args)
	dur := time.Since(start)
	if err != nil {
		var te toolError
		if !errors.As(err, &te) {
			o.log.Error("tool failed", "tool", name, "err", err, "run", t.runID)
			err = toolError{"internal error running tool"}
		}
		t.softFail = true
		o.step(ctx, t.runID, name, "failed", args, errOut(err), err.Error(), dur)
		data, _ := json.Marshal(map[string]string{"error": err.Error()})
		return string(data)
	}
	o.step(ctx, t.runID, name, "ok", args, out, detail, dur)
	data, err := json.Marshal(out)
	if err != nil {
		return `{"error":"could not encode result"}`
	}
	return string(data)
}

/* -------------------------------------------------- approval execution */

func (o *Orchestrator) confirm(ctx context.Context, userID, messageID string) (*Turn, error) {
	m, convID, err := o.store.Get(ctx, userID, messageID)
	if err != nil {
		return nil, err
	}
	c := m.Confirm
	if c == nil || c.State != "open" {
		return nil, ErrNotPending
	}
	if owner, err := o.recorder.Owner(ctx, c.RunID); err != nil || owner != userID {
		return nil, ErrNotPending
	}
	_ = o.recorder.SetStatus(ctx, c.RunID, "running")
	r, _ := o.restaurants.Get(ctx, c.RestaurantID)
	name := c.RestaurantID
	if r != nil {
		name = r.Name
	}
	today := o.now().Format("2006-01-02")
	key := c.RunID + ":" + c.Kind // retries of the same approval reuse the same key

	start := time.Now()
	var res *reservations.Reservation
	var stepName string
	switch c.Kind {
	case "book":
		stepName = "create_reservation"
		res, err = o.provider.Book(ctx, reservations.BookRequest{
			UserID: userID, RestaurantID: c.RestaurantID, Date: c.Date, Time: c.Time, PartySize: c.PartySize, IdempotencyKey: key,
		})
	case "modify":
		stepName = "modify_reservation"
		res, err = o.provider.Modify(ctx, userID, c.ReservationID, c.Date, c.Time, c.PartySize)
	case "cancel":
		stepName = "cancel_reservation"
		res, err = o.provider.Cancel(ctx, userID, c.ReservationID)
	default:
		return nil, ErrBadAction
	}
	dur := time.Since(start)

	var reply ChatMessage
	switch {
	case err == nil:
		o.step(ctx, c.RunID, stepName, "ok", c, res, fmt.Sprintf("idempotency_key=%s · status=%s", key, res.Status), dur)
		if c.Kind != "cancel" {
			o.step(ctx, c.RunID, "save_booking", "ok", nil, nil, "saved to your account", 0)
		}
		o.step(ctx, c.RunID, "notify_user", "ok", nil, nil, "in-app confirmation (email not wired up yet)", 0)
		_ = o.recorder.SetStatus(ctx, c.RunID, "done")
		c.State = "done"
		var text string
		switch c.Kind {
		case "book":
			text = fmt.Sprintf("You're booked. %s %s at %s for %d. It's in your Reservations.", name, dayPhrase(c.Date, today), c.Time, c.PartySize)
		case "modify":
			text = fmt.Sprintf("Updated. %s is now %s at %s for %d.", name, dayPhrase(c.Date, today), c.Time, c.PartySize)
		case "cancel":
			text = fmt.Sprintf("Done. Your %s reservation is cancelled.", name)
		}
		note := fmt.Sprintf("Executed %s: reservation %s at %s [%s] %s %s for %d.", c.Kind, res.ID, name, c.RestaurantID, c.Date, c.Time, c.PartySize)
		reply, err = o.store.Add(ctx, convID, "agent", text, Payload{Action: "reservations"}, note)

	case errors.Is(err, reservations.ErrSlotTaken) || errors.Is(err, reservations.ErrUnavailable):
		o.step(ctx, c.RunID, stepName, "failed", c, errOut(err), "SLOT_TAKEN from provider · not retried", dur)
		slots, _ := o.provider.OpenSlots(ctx, c.RestaurantID, c.Date)
		o.step(ctx, c.RunID, "check_availability", "ok", nil, slots, fmt.Sprintf("%d other slots %s", len(slots), dayPhrase(c.Date, today)), 0)
		_ = o.recorder.SetStatus(ctx, c.RunID, "recovered")
		c.State = "failed"
		p := Payload{ToolsSummary: stepName + " failed · recovered", ToolsTone: "warn"}
		text := fmt.Sprintf("That table at %s was taken just as I tried to book it. Nothing was booked.", name)
		if len(slots) > 0 {
			text += " Here are the other open times:"
			p.Results = []ResultItem{{RestaurantID: c.RestaurantID, Reasons: []string{}}}
			p.ResultsDate = c.Date
		} else {
			text += " There's nothing else open that day. Want me to look at similar places?"
		}
		reply, err = o.store.Add(ctx, convID, "agent", text, p, fmt.Sprintf("Booking %s %s %s failed: slot taken.", name, c.Date, c.Time))

	default:
		o.log.Error("approval execution failed", "kind", c.Kind, "err", err, "run", c.RunID)
		o.step(ctx, c.RunID, stepName, "failed", c, errOut(err), shorten(err.Error(), 120), dur)
		_ = o.recorder.SetStatus(ctx, c.RunID, "waiting")
		// Leave the card open: the idempotency key makes a retry safe.
		reply, err = o.store.Add(ctx, convID, "agent", "Something went wrong on our side and nothing was changed. You can try confirming again.", Payload{}, "")
	}
	if err != nil {
		return nil, err
	}
	m.Confirm = c
	if err := o.store.UpdatePayload(ctx, m.ID, m.Payload); err != nil {
		return nil, err
	}
	return o.finish(ctx, userID, []ChatMessage{m.ChatMessage, reply}, c.RunID, nil)
}

func (o *Orchestrator) decline(ctx context.Context, userID, messageID string) (*Turn, error) {
	m, convID, err := o.store.Get(ctx, userID, messageID)
	if err != nil {
		return nil, err
	}
	c := m.Confirm
	if c == nil || c.State != "open" {
		return nil, ErrNotPending
	}
	c.State = "declined"
	m.Confirm = c
	if err := o.store.UpdatePayload(ctx, m.ID, m.Payload); err != nil {
		return nil, err
	}
	o.step(ctx, c.RunID, "request_user_confirmation", "ok", nil, nil, "declined by user", 0)
	_ = o.recorder.SetStatus(ctx, c.RunID, "stopped")
	text := "No problem, nothing was booked. Pick another time, or tell me what to change."
	if c.Kind == "cancel" {
		text = "OK, I'll keep the reservation."
	}
	reply, err := o.store.Add(ctx, convID, "agent", text, Payload{}, fmt.Sprintf("User declined the %s request.", c.Kind))
	if err != nil {
		return nil, err
	}
	return o.finish(ctx, userID, []ChatMessage{m.ChatMessage, reply}, c.RunID, nil)
}

/* ------------------------------------------------------------ helpers */

func (o *Orchestrator) composeReply(ctx context.Context, t *turnState, text string) (ChatMessage, error) {
	p := Payload{}
	var notes []string
	if t.presented != nil {
		p.Results = t.presented.results
		p.ResultsDate = t.presented.date
		p.Chips = t.presented.chips
		var shown []string
		for _, id := range t.presented.ids {
			shown = append(shown, fmt.Sprintf("%s [%s]", t.seen[id], id))
		}
		notes = append(notes, fmt.Sprintf("Shown to user for %s: %s.", t.presented.date, strings.Join(shown, ", ")))
	}
	if t.confirm != nil {
		p.Confirm = t.confirm
		name := t.confirm.RestaurantID
		if r, err := o.restaurants.Get(ctx, t.confirm.RestaurantID); err == nil {
			name = r.Name
		}
		notes = append(notes, fmt.Sprintf("Waiting for user approval: %s %s [%s] %s %s for %d.",
			t.confirm.Kind, name, t.confirm.RestaurantID, t.confirm.Date, t.confirm.Time, t.confirm.PartySize))
		if text == "" {
			text = "Here are the details. Confirm when you're ready."
		}
	}
	if len(t.toolsUsed) > 0 {
		distinct := []string{}
		for _, n := range t.toolsUsed {
			if n != "present_restaurants" && !contains(distinct, n) {
				distinct = append(distinct, n)
			}
		}
		if len(distinct) > 0 {
			summary := strings.Join(distinct[:min(2, len(distinct))], ", ")
			if len(distinct) > 2 {
				summary += "…"
			}
			p.ToolsSummary = fmt.Sprintf("%d tools · %s", len(t.toolsUsed), summary)
		}
		if t.softFail {
			p.ToolsTone = "warn"
		}
	}
	if text == "" {
		text = "Done."
	}
	return o.store.Add(ctx, t.convID, "agent", text, p, strings.Join(notes, " "))
}

// finish attaches the touched run and the user's reservations.
func (o *Orchestrator) finish(ctx context.Context, userID string, msgs []ChatMessage, runID string, mapFilter *[]string) (*Turn, error) {
	turn := &Turn{Messages: msgs, MapFilter: mapFilter}
	if run, err := o.recorder.Get(ctx, runID); err == nil {
		turn.Runs = []workflows.Run{*run}
	}
	res, err := o.reservations.ListForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	turn.Reservations = res
	return turn, nil
}

func (o *Orchestrator) step(ctx context.Context, runID, name, status string, in, out any, detail string, dur time.Duration) {
	if err := o.recorder.AddStep(ctx, runID, name, status, in, out, detail, dur); err != nil {
		o.log.Warn("could not record step", "run", runID, "step", name, "err", err)
	}
}

func (o *Orchestrator) now() time.Time {
	if o.tz != nil {
		return time.Now().In(o.tz)
	}
	return time.Now()
}

func historyMessage(m storedMessage) llm.Message {
	if m.Role == "user" {
		return llm.Message{Role: "user", Content: m.Text}
	}
	content := m.Text
	if m.LLMNote != "" {
		content += "\n\n[app context: " + m.LLMNote + "]"
	}
	return llm.Message{Role: "assistant", Content: content}
}

func plannedCalls(calls []llm.ToolCall) string {
	if len(calls) == 0 {
		return "reply"
	}
	n := make([]string, 0, len(calls))
	for _, c := range calls {
		n = append(n, c.Function.Name)
	}
	return "→ " + strings.Join(n, ", ")
}

func errOut(err error) map[string]string { return map[string]string{"error": err.Error()} }

func shorten(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
