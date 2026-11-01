package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"seated/internal/llm"
	"seated/internal/reservations"
	"seated/internal/restaurants"
	"seated/internal/workflows"
)

// A tool has a JSON-schema contract. The LLM proposes calls; the backend validates
// arguments and executes. No tool writes reservations: consequential actions only
// create an approval request that the user confirms in the UI.
type tool struct {
	spec llm.Tool
	run  func(ctx context.Context, t *turnState, args json.RawMessage) (out any, detail string, err error)
}

// toolError is returned to the model as {"error": ...} so it can recover (ask, retry, offer alternatives).
type toolError struct{ msg string }

func (e toolError) Error() string { return e.msg }

func badArgs(format string, a ...any) error { return toolError{fmt.Sprintf(format, a...)} }

func fn(name, description, params string) llm.Tool {
	return llm.Tool{Type: "function", Function: llm.FunctionSpec{Name: name, Description: description, Parameters: json.RawMessage(params)}}
}

const cuisineEnum = `["italian","pizza","french","japanese","mexican","korean","thai","deli","american","vegetarian"]`

func (o *Orchestrator) tools() map[string]tool {
	return map[string]tool{
		"search_restaurants": {
			spec: fn("search_restaurants",
				"Search restaurants with structured filters. Optional `query` does semantic search over descriptions (e.g. 'cozy date night pasta').",
				`{"type":"object","properties":{
					"query":{"type":"string"},
					"cuisine":{"type":"string","enum":`+cuisineEnum+`},
					"neighborhood":{"type":"string","description":"e.g. West Village, SoHo, Nolita, Tribeca, East Village, Lower East Side, Greenwich Village, Flatiron, NoMad"},
					"min_price":{"type":"integer","minimum":1,"maximum":4},
					"max_price":{"type":"integer","minimum":1,"maximum":4},
					"vegetarian":{"type":"boolean"},
					"exclude_saved":{"type":"boolean"},
					"exclude_visited":{"type":"boolean"},
					"only_saved":{"type":"boolean"},
					"limit":{"type":"integer","minimum":1,"maximum":10}}}`),
			run: o.toolSearch,
		},
		"find_similar_restaurants": {
			spec: fn("find_similar_restaurants",
				"Find restaurants similar to a reference restaurant (by id or name), or to the user's saved places (like_saved). Uses semantic similarity.",
				`{"type":"object","properties":{
					"restaurant_id":{"type":"string"},
					"restaurant_name":{"type":"string"},
					"like_saved":{"type":"boolean"},
					"neighborhood":{"type":"string"},
					"cuisine":{"type":"string","enum":`+cuisineEnum+`},
					"min_price":{"type":"integer","minimum":1,"maximum":4},
					"max_price":{"type":"integer","minimum":1,"maximum":4},
					"exclude_saved":{"type":"boolean"},
					"exclude_visited":{"type":"boolean"},
					"limit":{"type":"integer","minimum":1,"maximum":10}}}`),
			run: o.toolSimilar,
		},
		"get_restaurant_details": {
			spec: fn("get_restaurant_details", "Get full details for one restaurant by id or name.",
				`{"type":"object","properties":{"restaurant_id":{"type":"string"},"name":{"type":"string"}}}`),
			run: o.toolDetails,
		},
		"get_user_preferences": {
			spec: fn("get_user_preferences", "The user's dining preferences, saved restaurants and visited restaurants.", `{"type":"object","properties":{}}`),
			run:  o.toolPreferences,
		},
		"check_availability": {
			spec: fn("check_availability", "Open reservation times for up to 6 restaurants on a date.",
				`{"type":"object","properties":{
					"restaurant_ids":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":6},
					"date":{"type":"string","description":"YYYY-MM-DD"}},
				"required":["restaurant_ids","date"]}`),
			run: o.toolAvailability,
		},
		"get_user_reservations": {
			spec: fn("get_user_reservations", "The user's upcoming confirmed reservations (with reservation ids).", `{"type":"object","properties":{}}`),
			run:  o.toolReservations,
		},
		"present_restaurants": {
			spec: fn("present_restaurants",
				"Show restaurant cards (with bookable times) to the user and pin them on the map. Use ids from tool results only.",
				`{"type":"object","properties":{
					"restaurants":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"object","properties":{
						"restaurant_id":{"type":"string"},
						"reasons":{"type":"array","items":{"type":"string"},"maxItems":3}},"required":["restaurant_id","reasons"]}},
					"date":{"type":"string","description":"YYYY-MM-DD the times are for"},
					"understood":{"type":"array","items":{"type":"string"},"description":"short chips for what you understood"},
					"missing":{"type":"array","items":{"type":"string"},"description":"short chips for info still needed, e.g. 'Party size?'"}},
				"required":["restaurants","date"]}`),
			run: o.toolPresent,
		},
		"request_reservation": {
			spec: fn("request_reservation",
				"Ask the user to approve a new booking. Requires all details. Does NOT book; the user confirms in the app.",
				`{"type":"object","properties":{
					"restaurant_id":{"type":"string"},
					"date":{"type":"string","description":"YYYY-MM-DD"},
					"time":{"type":"string","description":"slot like 7:30"},
					"party_size":{"type":"integer","minimum":1,"maximum":20}},
				"required":["restaurant_id","date","time","party_size"]}`),
			run: o.toolRequestBooking,
		},
		"request_modification": {
			spec: fn("request_modification", "Ask the user to approve changing an existing reservation. Omitted fields stay the same.",
				`{"type":"object","properties":{
					"reservation_id":{"type":"string"},
					"date":{"type":"string"},
					"time":{"type":"string"},
					"party_size":{"type":"integer","minimum":1,"maximum":20}},
				"required":["reservation_id"]}`),
			run: o.toolRequestModify,
		},
		"request_cancellation": {
			spec: fn("request_cancellation", "Ask the user to approve cancelling one of their reservations.",
				`{"type":"object","properties":{"reservation_id":{"type":"string"}},"required":["reservation_id"]}`),
			run: o.toolRequestCancel,
		},
	}
}

func (o *Orchestrator) toolSpecs() []llm.Tool {
	ts := o.tools()
	names := make([]string, 0, len(ts))
	for n := range ts {
		names = append(names, n)
	}
	slices.Sort(names)
	out := make([]llm.Tool, 0, len(names))
	for _, n := range names {
		out = append(out, ts[n].spec)
	}
	return out
}

/* ------------------------------------------------------------ helpers */

type compact struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Cuisine      string   `json:"cuisine"`
	Neighborhood string   `json:"neighborhood"`
	Price        string   `json:"price"`
	Tags         []string `json:"tags"`
	Description  string   `json:"description"`
	Saved        bool     `json:"saved"`
	Visited      bool     `json:"visited"`
	Similarity   *float64 `json:"similarity,omitempty"`
}

func (t *turnState) compact(r restaurants.Restaurant, sim *float64) compact {
	t.seen[r.ID] = r.Name
	return compact{
		ID: r.ID, Name: r.Name, Cuisine: r.Cuisine, Neighborhood: r.Neighborhood,
		Price: strings.Repeat("$", r.PriceLevel), Tags: r.Tags, Description: r.Description,
		Saved: slices.Contains(t.saved, r.ID), Visited: slices.Contains(t.visited, r.ID), Similarity: sim,
	}
}

func names(list []compact) string {
	n := make([]string, 0, len(list))
	for _, c := range list {
		n = append(n, c.Name)
	}
	if len(n) == 0 {
		return "no matches"
	}
	return strings.Join(n, ", ")
}

func (t *turnState) setWorkflow(w string, strong bool) {
	if strong || t.workflow == workflows.Unclassified || t.workflow == workflows.Lookup {
		t.workflow = w
	}
}

func (t *turnState) validDate(date string) (time.Time, error) {
	d, err := time.ParseInLocation("2006-01-02", date, t.now.Location())
	if err != nil {
		return d, badArgs("date must be YYYY-MM-DD")
	}
	if date < t.today {
		return d, badArgs("%s is in the past (today is %s)", date, t.today)
	}
	if d.After(t.now.AddDate(0, 0, 60)) {
		return d, badArgs("reservations open up to 60 days ahead")
	}
	return d, nil
}

func (o *Orchestrator) resolve(ctx context.Context, id, name string) (*restaurants.Restaurant, error) {
	if id != "" {
		if r, err := o.restaurants.Get(ctx, id); err == nil {
			return r, nil
		}
	}
	if name != "" {
		if r, err := o.restaurants.FindByName(ctx, name); err == nil {
			return r, nil
		}
	}
	if id == "" && name == "" {
		return nil, badArgs("give restaurant_id or a name")
	}
	return nil, badArgs("no restaurant matches %q", firstNonEmpty(id, name))
}

func baseFilter(cuisine, neighborhood string, minP, maxP int) (restaurants.Filter, string) {
	f := restaurants.Filter{Group: cuisine, MinPrice: minP, MaxPrice: maxP}
	note := ""
	if neighborhood != "" {
		if n, ok := restaurants.CanonicalNeighborhood(neighborhood); ok {
			f.Neighborhood = n
		} else {
			note = fmt.Sprintf("unknown neighborhood %q ignored", neighborhood)
		}
	}
	return f, note
}

func (t *turnState) exclusions(saved, visited bool) []string {
	var ex []string
	if saved {
		ex = append(ex, t.saved...)
	}
	if visited {
		ex = append(ex, t.visited...)
	}
	return ex
}

/* -------------------------------------------------------------- tools */

func (o *Orchestrator) toolSearch(ctx context.Context, t *turnState, raw json.RawMessage) (any, string, error) {
	var a struct {
		Query          string `json:"query"`
		Cuisine        string `json:"cuisine"`
		Neighborhood   string `json:"neighborhood"`
		MinPrice       int    `json:"min_price"`
		MaxPrice       int    `json:"max_price"`
		Vegetarian     bool   `json:"vegetarian"`
		ExcludeSaved   bool   `json:"exclude_saved"`
		ExcludeVisited bool   `json:"exclude_visited"`
		OnlySaved      bool   `json:"only_saved"`
		Limit          int    `json:"limit"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, "", badArgs("invalid arguments: %v", err)
	}
	t.setWorkflow(workflows.Discovery, false)
	f, note := baseFilter(a.Cuisine, a.Neighborhood, a.MinPrice, a.MaxPrice)
	f.Vegetarian = a.Vegetarian
	f.ExcludeIDs = t.exclusions(a.ExcludeSaved, a.ExcludeVisited)
	f.Limit = a.Limit
	if a.OnlySaved {
		f.OnlyIDs = append([]string{}, t.saved...)
	}

	run := func(f restaurants.Filter) ([]compact, string, error) {
		if a.Query != "" && t.semantic {
			vecs, err := o.llm.Embed(ctx, []string{a.Query})
			if err == nil && len(vecs) == 1 && len(vecs[0]) > 0 {
				scored, err := o.restaurants.SimilarToVector(ctx, vecs[0], f)
				if err != nil {
					return nil, "", err
				}
				out := make([]compact, 0, len(scored))
				for _, s := range scored {
					sim := round2(s.Similarity)
					out = append(out, t.compact(s.Restaurant, &sim))
				}
				return out, "semantic", nil
			}
		}
		list, err := o.restaurants.Search(ctx, f)
		if err != nil {
			return nil, "", err
		}
		out := make([]compact, 0, len(list))
		for _, r := range list {
			out = append(out, t.compact(r, nil))
		}
		return out, "filters", nil
	}

	out, mode, err := run(f)
	if err != nil {
		return nil, "", err
	}
	if len(out) == 0 && f.Neighborhood != "" {
		hood := f.Neighborhood
		f.Neighborhood = ""
		if out, mode, err = run(f); err != nil {
			return nil, "", err
		}
		note = strings.TrimSpace(note + fmt.Sprintf(" no matches in %s, so searched all neighborhoods", hood))
	}
	return map[string]any{"restaurants": out, "note": note}, fmt.Sprintf("%d results (%s) · %s", len(out), mode, names(out)), nil
}

func (o *Orchestrator) toolSimilar(ctx context.Context, t *turnState, raw json.RawMessage) (any, string, error) {
	var a struct {
		RestaurantID   string `json:"restaurant_id"`
		RestaurantName string `json:"restaurant_name"`
		LikeSaved      bool   `json:"like_saved"`
		Neighborhood   string `json:"neighborhood"`
		Cuisine        string `json:"cuisine"`
		MinPrice       int    `json:"min_price"`
		MaxPrice       int    `json:"max_price"`
		ExcludeSaved   bool   `json:"exclude_saved"`
		ExcludeVisited bool   `json:"exclude_visited"`
		Limit          int    `json:"limit"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, "", badArgs("invalid arguments: %v", err)
	}
	t.setWorkflow(workflows.Similar, false)

	var refs []restaurants.Restaurant
	if a.RestaurantID != "" || a.RestaurantName != "" {
		r, err := o.resolve(ctx, a.RestaurantID, a.RestaurantName)
		if err != nil {
			return nil, "", err
		}
		refs = append(refs, *r)
	}
	if a.LikeSaved {
		m, err := o.restaurants.GetMany(ctx, t.saved)
		if err != nil {
			return nil, "", err
		}
		for _, r := range m {
			refs = append(refs, r)
		}
	}
	if len(refs) == 0 {
		return nil, "", badArgs("need a reference restaurant or like_saved=true (and saved places)")
	}
	refIDs := make([]string, 0, len(refs))
	for _, r := range refs {
		refIDs = append(refIDs, r.ID)
		t.seen[r.ID] = r.Name
	}

	f, note := baseFilter(a.Cuisine, a.Neighborhood, a.MinPrice, a.MaxPrice)
	f.ExcludeIDs = append(t.exclusions(a.ExcludeSaved, a.ExcludeVisited), refIDs...)
	limit := a.Limit
	if limit <= 0 {
		limit = 6
	}

	var scored []restaurants.Scored
	mode := "embeddings"
	if t.semantic {
		f.Limit = limit
		var err error
		if scored, err = o.restaurants.SimilarToRestaurants(ctx, refIDs, f); err != nil {
			return nil, "", err
		}
	}
	if len(scored) == 0 {
		mode = "attributes"
		f.Limit = 20
		candidates, err := o.restaurants.Search(ctx, f)
		if err != nil {
			return nil, "", err
		}
		scored = restaurants.SimilarByAttributes(refs, candidates, limit)
	}
	out := make([]compact, 0, len(scored))
	for _, s := range scored {
		sim := round2(s.Similarity)
		out = append(out, t.compact(s.Restaurant, &sim))
	}
	refNames := make([]string, 0, len(refs))
	for _, r := range refs {
		refNames = append(refNames, r.Name)
	}
	return map[string]any{"reference": refNames, "restaurants": out, "note": note},
		fmt.Sprintf("like %s (%s) · %s", strings.Join(refNames, ", "), mode, names(out)), nil
}

func (o *Orchestrator) toolDetails(ctx context.Context, t *turnState, raw json.RawMessage) (any, string, error) {
	var a struct {
		RestaurantID string `json:"restaurant_id"`
		Name         string `json:"name"`
	}
	_ = json.Unmarshal(raw, &a)
	r, err := o.resolve(ctx, a.RestaurantID, a.Name)
	if err != nil {
		return nil, "", err
	}
	t.setWorkflow(workflows.Questions, false)
	c := t.compact(*r, nil)
	return c, fmt.Sprintf("%s · %s · %s", r.Name, r.Cuisine, c.Price), nil
}

func (o *Orchestrator) toolPreferences(ctx context.Context, t *turnState, _ json.RawMessage) (any, string, error) {
	prefs, err := o.users.GetPreferences(ctx, t.userID)
	if err != nil {
		return nil, "", err
	}
	all := append(append([]string{}, t.saved...), t.visited...)
	m, err := o.restaurants.GetMany(ctx, all)
	if err != nil {
		return nil, "", err
	}
	label := func(ids []string) []map[string]string {
		out := []map[string]string{}
		for _, id := range ids {
			if r, ok := m[id]; ok {
				out = append(out, map[string]string{"id": id, "name": r.Name, "cuisine": r.Cuisine, "neighborhood": r.Neighborhood})
			}
		}
		return out
	}
	return map[string]any{"preferences": prefs, "saved": label(t.saved), "visited": label(t.visited)},
		fmt.Sprintf("%d saved · %d visited · prefers %s", len(t.saved), len(t.visited), firstNonEmpty(strings.Join(prefs.Cuisines, ", "), "anything")), nil
}

func (o *Orchestrator) toolAvailability(ctx context.Context, t *turnState, raw json.RawMessage) (any, string, error) {
	var a struct {
		RestaurantIDs []string `json:"restaurant_ids"`
		Date          string   `json:"date"`
	}
	if err := json.Unmarshal(raw, &a); err != nil || len(a.RestaurantIDs) == 0 {
		return nil, "", badArgs("restaurant_ids and date are required")
	}
	if _, err := t.validDate(a.Date); err != nil {
		return nil, "", err
	}
	if len(a.RestaurantIDs) > 6 {
		a.RestaurantIDs = a.RestaurantIDs[:6]
	}
	m, err := o.restaurants.GetMany(ctx, a.RestaurantIDs)
	if err != nil {
		return nil, "", err
	}
	type avail struct {
		RestaurantID string   `json:"restaurant_id"`
		Name         string   `json:"name"`
		OpenSlots    []string `json:"open_slots"`
	}
	out := []avail{}
	var parts []string
	for _, id := range a.RestaurantIDs {
		r, ok := m[id]
		if !ok {
			continue
		}
		slots, err := o.provider.OpenSlots(ctx, id, a.Date)
		if err != nil {
			return nil, "", err
		}
		t.seen[id] = r.Name
		out = append(out, avail{id, r.Name, slots})
		parts = append(parts, fmt.Sprintf("%s: %d", r.Name, len(slots)))
	}
	return map[string]any{"date": a.Date, "availability": out}, fmt.Sprintf("%s · %s", dayLabel(a.Date, t.today), strings.Join(parts, ", ")), nil
}

func (o *Orchestrator) toolReservations(ctx context.Context, t *turnState, _ json.RawMessage) (any, string, error) {
	t.setWorkflow(workflows.Lookup, false)
	up, err := o.reservations.Upcoming(ctx, t.userID, t.today)
	if err != nil {
		return nil, "", err
	}
	ids := make([]string, 0, len(up))
	for _, r := range up {
		ids = append(ids, r.RestaurantID)
	}
	m, _ := o.restaurants.GetMany(ctx, ids)
	type item struct {
		ReservationID string `json:"reservation_id"`
		RestaurantID  string `json:"restaurant_id"`
		Restaurant    string `json:"restaurant"`
		Date          string `json:"date"`
		Time          string `json:"time"`
		PartySize     int    `json:"party_size"`
	}
	out := []item{}
	for _, r := range up {
		out = append(out, item{r.ID, r.RestaurantID, m[r.RestaurantID].Name, r.Date, r.Time, r.PartySize})
	}
	return map[string]any{"upcoming": out}, fmt.Sprintf("%d upcoming", len(out)), nil
}

func (o *Orchestrator) toolPresent(ctx context.Context, t *turnState, raw json.RawMessage) (any, string, error) {
	var a struct {
		Restaurants []struct {
			RestaurantID string   `json:"restaurant_id"`
			Reasons      []string `json:"reasons"`
		} `json:"restaurants"`
		Date       string   `json:"date"`
		Understood []string `json:"understood"`
		Missing    []string `json:"missing"`
	}
	if err := json.Unmarshal(raw, &a); err != nil || len(a.Restaurants) == 0 {
		return nil, "", badArgs("restaurants and date are required")
	}
	if _, err := t.validDate(a.Date); err != nil {
		return nil, "", err
	}
	ids := make([]string, 0, len(a.Restaurants))
	for _, r := range a.Restaurants {
		ids = append(ids, r.RestaurantID)
	}
	m, err := o.restaurants.GetMany(ctx, ids)
	if err != nil {
		return nil, "", err
	}
	p := &presentation{date: a.Date}
	var shown []string
	for _, r := range a.Restaurants {
		x, ok := m[r.RestaurantID]
		if !ok || slices.Contains(p.ids, x.ID) {
			continue // drop unknown ids instead of showing a hallucinated restaurant
		}
		reasons := r.Reasons
		if len(reasons) > 3 {
			reasons = reasons[:3]
		}
		if reasons == nil {
			reasons = []string{}
		}
		p.ids = append(p.ids, x.ID)
		p.results = append(p.results, ResultItem{RestaurantID: x.ID, Reasons: reasons})
		shown = append(shown, x.Name)
	}
	if len(p.results) == 0 {
		return nil, "", badArgs("none of those restaurant ids exist; use ids from tool results")
	}
	for _, u := range a.Understood {
		if s := strings.TrimSpace(u); s != "" {
			p.chips = append(p.chips, Chip{Label: s})
		}
	}
	for _, m := range a.Missing {
		if s := strings.TrimSpace(m); s != "" {
			p.chips = append(p.chips, Chip{Label: s, Missing: true})
		}
	}
	t.presented = p
	return map[string]any{"shown": len(p.results)}, strings.Join(shown, ", "), nil
}

func (o *Orchestrator) requirePublished(ctx context.Context, name string) error {
	ok, err := o.recorder.IsPublished(ctx, name)
	if err != nil {
		return err
	}
	if !ok {
		return toolError{fmt.Sprintf("workflow %s is not published, so this action is unavailable", name)}
	}
	return nil
}

func (o *Orchestrator) toolRequestBooking(ctx context.Context, t *turnState, raw json.RawMessage) (any, string, error) {
	var a struct {
		RestaurantID string `json:"restaurant_id"`
		Date         string `json:"date"`
		Time         string `json:"time"`
		PartySize    int    `json:"party_size"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, "", badArgs("invalid arguments: %v", err)
	}
	if err := o.requirePublished(ctx, workflows.Reservation); err != nil {
		return nil, "", err
	}
	if a.PartySize < 1 || a.PartySize > 20 {
		return nil, "", badArgs("party_size is required (1-20); ask the user")
	}
	if _, err := t.validDate(a.Date); err != nil {
		return nil, "", err
	}
	r, err := o.restaurants.Get(ctx, a.RestaurantID)
	if err != nil {
		return nil, "", badArgs("unknown restaurant_id %q", a.RestaurantID)
	}
	a.Time = normalizeTime(a.Time)
	slots, err := o.provider.OpenSlots(ctx, r.ID, a.Date)
	if err != nil {
		return nil, "", err
	}
	t.setWorkflow(workflows.Reservation, true)
	if !slices.Contains(slots, a.Time) {
		t.softFail = true
		return map[string]any{"available": false, "open_slots": slots},
			fmt.Sprintf("%s not open at %s · %d other slots", a.Time, r.Name, len(slots)), nil
	}
	t.confirm = &ConfirmRequest{Kind: "book", RestaurantID: r.ID, Date: a.Date, Time: a.Time, PartySize: a.PartySize, RunID: t.runID, State: "open"}
	return map[string]any{"status": "awaiting_user_approval"},
		fmt.Sprintf("%s · %s %s · %d guests · slot open", r.Name, dayLabel(a.Date, t.today), a.Time, a.PartySize), nil
}

func (o *Orchestrator) toolRequestModify(ctx context.Context, t *turnState, raw json.RawMessage) (any, string, error) {
	var a struct {
		ReservationID string `json:"reservation_id"`
		Date          string `json:"date"`
		Time          string `json:"time"`
		PartySize     int    `json:"party_size"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, "", badArgs("invalid arguments: %v", err)
	}
	if err := o.requirePublished(ctx, workflows.Modification); err != nil {
		return nil, "", err
	}
	res, err := o.reservations.GetForUser(ctx, t.userID, a.ReservationID)
	if errors.Is(err, reservations.ErrNotFound) {
		return nil, "", badArgs("no reservation %q for this user; call get_user_reservations", a.ReservationID)
	} else if err != nil {
		return nil, "", err
	}
	if res.Status != "confirmed" {
		return nil, "", badArgs("that reservation is %s", res.Status)
	}
	date, slot, party := firstNonEmpty(a.Date, res.Date), normalizeTime(firstNonEmpty(a.Time, res.Time)), res.PartySize
	if a.PartySize > 0 {
		party = a.PartySize
	}
	if _, err := t.validDate(date); err != nil {
		return nil, "", err
	}
	t.setWorkflow(workflows.Modification, true)
	if date != res.Date || slot != res.Time {
		slots, err := o.provider.OpenSlots(ctx, res.RestaurantID, date)
		if err != nil {
			return nil, "", err
		}
		if !slices.Contains(slots, slot) {
			t.softFail = true
			return map[string]any{"available": false, "open_slots": slots}, fmt.Sprintf("%s not open on %s", slot, date), nil
		}
	}
	t.seen[res.RestaurantID] = res.RestaurantID
	t.confirm = &ConfirmRequest{Kind: "modify", RestaurantID: res.RestaurantID, Date: date, Time: slot, PartySize: party, ReservationID: res.ID, RunID: t.runID, State: "open"}
	return map[string]any{"status": "awaiting_user_approval"}, fmt.Sprintf("move to %s %s · %d guests", dayLabel(date, t.today), slot, party), nil
}

func (o *Orchestrator) toolRequestCancel(ctx context.Context, t *turnState, raw json.RawMessage) (any, string, error) {
	var a struct {
		ReservationID string `json:"reservation_id"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, "", badArgs("invalid arguments: %v", err)
	}
	if err := o.requirePublished(ctx, workflows.Cancellation); err != nil {
		return nil, "", err
	}
	res, err := o.reservations.GetForUser(ctx, t.userID, a.ReservationID)
	if errors.Is(err, reservations.ErrNotFound) {
		return nil, "", badArgs("no reservation %q for this user; call get_user_reservations", a.ReservationID)
	} else if err != nil {
		return nil, "", err
	}
	if res.Status != "confirmed" {
		return nil, "", badArgs("that reservation is already %s", res.Status)
	}
	t.setWorkflow(workflows.Cancellation, true)
	t.confirm = &ConfirmRequest{Kind: "cancel", RestaurantID: res.RestaurantID, Date: res.Date, Time: res.Time, PartySize: res.PartySize, ReservationID: res.ID, RunID: t.runID, State: "open"}
	return map[string]any{"status": "awaiting_user_approval"}, "ownership verified · needs approval", nil
}

func round2(f float64) float64 { return float64(int(f*100+0.5)) / 100 }

// normalizeTime turns "7:30pm", "19:30", "7" into the "7:30" / "7:00" form slots use.
func normalizeTime(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimSuffix(strings.TrimSuffix(s, "pm"), "am")
	s = strings.TrimSpace(s)
	h, m, ok := strings.Cut(s, ":")
	if !ok {
		m = "00"
	}
	var hh int
	fmt.Sscanf(h, "%d", &hh)
	if hh > 12 {
		hh -= 12
	}
	if len(m) == 1 {
		m = "0" + m
	}
	return fmt.Sprintf("%d:%s", hh, m)
}

// dayLabel: "Tonight" or "Fri, Nov 6".
func dayLabel(date, today string) string {
	if date == today {
		return "Tonight"
	}
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return d.Format("Mon, Jan 2")
}

// dayPhrase for mid-sentence use: "tonight" or "on Fri, Nov 6".
func dayPhrase(date, today string) string {
	if date == today {
		return "tonight"
	}
	return "on " + dayLabel(date, today)
}
