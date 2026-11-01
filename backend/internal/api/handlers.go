package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"seated/internal/agent"
	"seated/internal/reservations"
	"seated/internal/restaurants"
	"seated/internal/sessions"
	"seated/internal/users"
)

/* ---------------------------------------------------------------- auth */

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil || body.Email == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}
	u, err := s.users.GetByEmail(r.Context(), body.Email)
	if err != nil && !errors.Is(err, users.ErrNotFound) {
		s.serverError(w, err)
		return
	}
	// Same response for unknown email and wrong password.
	if u == nil || !users.CheckPassword(u.PasswordHash, body.Password) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	id, err := s.sessions.Create(r.Context(), sessions.Session{UserID: u.ID, Role: u.Role})
	if err != nil {
		s.serverError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessions.CookieName, Value: id, Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode, MaxAge: int(s.sessions.TTL().Seconds()),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessions.CookieName); err == nil {
		_ = s.sessions.Delete(r.Context(), c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessions.CookieName, Value: "", Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

/* ------------------------------------------------------------------ me */

type pastVisit struct {
	ID           string `json:"id"`
	RestaurantID string `json:"restaurantId"`
	Label        string `json:"label"`
	Recommended  bool   `json:"recommended"`
	Feedback     string `json:"feedback,omitempty"`
}

func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid := sessionFrom(r).UserID
	u, err := s.users.GetByID(ctx, uid)
	if errors.Is(err, users.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, "account no longer exists")
		return
	} else if err != nil {
		s.serverError(w, err)
		return
	}
	prefs, err := s.users.GetPreferences(ctx, uid)
	if err != nil {
		s.serverError(w, err)
		return
	}
	list, err := s.restaurants.List(ctx)
	if err != nil {
		s.serverError(w, err)
		return
	}
	saved, err := s.users.SavedIDs(ctx, uid)
	if err != nil {
		s.serverError(w, err)
		return
	}
	visited, err := s.users.VisitedIDs(ctx, uid)
	if err != nil {
		s.serverError(w, err)
		return
	}
	res, err := s.reservations.ListForUser(ctx, uid)
	if err != nil {
		s.serverError(w, err)
		return
	}
	visits, err := s.users.Visits(ctx, uid)
	if err != nil {
		s.serverError(w, err)
		return
	}
	past := make([]pastVisit, 0, len(visits))
	for _, v := range visits {
		label := fmt.Sprintf("%s · %d %s", v.VisitedOn.Format("Jan 2"), v.PartySize, plural(v.PartySize, "guest", "guests"))
		if v.Recommended {
			label += " · Recommended by Ask Seated"
		}
		pv := pastVisit{ID: v.ID, RestaurantID: v.RestaurantID, Label: label, Recommended: v.Recommended}
		if v.Feedback != nil {
			pv.Feedback = *v.Feedback
		}
		past = append(past, pv)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":         u,
		"preferences":  prefs,
		"restaurants":  list,
		"saved":        saved,
		"visited":      visited,
		"reservations": res,
		"past":         past,
	})
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.Name) == "" || !strings.Contains(body.Email, "@") {
		writeError(w, http.StatusBadRequest, "name and a valid email are required")
		return
	}
	err := s.users.UpdateProfile(r.Context(), sessionFrom(r).UserID, body.Name, body.Email)
	if errors.Is(err, users.ErrEmailTaken) {
		writeError(w, http.StatusConflict, err.Error())
		return
	} else if err != nil {
		s.serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) updatePreferences(w http.ResponseWriter, r *http.Request) {
	var p users.Preferences
	if err := readJSON(r, &p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid preferences")
		return
	}
	if err := s.users.PutPreferences(r.Context(), sessionFrom(r).UserID, p); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setSaved(saved bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := s.users.SetSaved(r.Context(), sessionFrom(r).UserID, r.PathValue("restaurantID"), saved)
		if errors.Is(err, users.ErrNotFound) {
			writeError(w, http.StatusNotFound, "restaurant not found")
			return
		} else if err != nil {
			s.serverError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) feedback(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Value string `json:"value"`
	}
	if err := readJSON(r, &body); err != nil || (body.Value != "up" && body.Value != "down") {
		writeError(w, http.StatusBadRequest, `value must be "up" or "down"`)
		return
	}
	err := s.users.SetFeedback(r.Context(), sessionFrom(r).UserID, r.PathValue("visitID"), body.Value)
	if errors.Is(err, users.ErrNotFound) {
		writeError(w, http.StatusNotFound, "visit not found")
		return
	} else if err != nil {
		s.serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) myRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.recorder.ListForUser(r.Context(), sessionFrom(r).UserID, 50)
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

/* ---------------------------------------------- restaurants + bookings */

func (s *Server) listRestaurants(w http.ResponseWriter, r *http.Request) {
	list, err := s.restaurants.List(r.Context())
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"restaurants": list})
}

func (s *Server) availability(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	date := r.URL.Query().Get("date")
	if _, err := time.Parse("2006-01-02", date); err != nil {
		writeError(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
		return
	}
	if _, err := s.restaurants.Get(r.Context(), id); errors.Is(err, restaurants.ErrNotFound) {
		writeError(w, http.StatusNotFound, "restaurant not found")
		return
	}
	slots, err := s.provider.OpenSlots(r.Context(), id, date)
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"slots": slots})
}

func (s *Server) listReservations(w http.ResponseWriter, r *http.Request) {
	res, err := s.reservations.ListForUser(r.Context(), sessionFrom(r).UserID)
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reservations": res})
}

func (s *Server) cancelReservation(w http.ResponseWriter, r *http.Request) {
	turn, err := s.agent.CancelReservation(r.Context(), sessionFrom(r).UserID, r.PathValue("id"))
	s.writeTurn(w, turn, err)
}

/* --------------------------------------------------------------- agent */

func (s *Server) agentMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	turn, err := s.agent.Message(r.Context(), sessionFrom(r).UserID, body.Text)
	s.writeTurn(w, turn, err)
}

func (s *Server) agentAction(w http.ResponseWriter, r *http.Request) {
	var a agent.Action
	if err := readJSON(r, &a); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	turn, err := s.agent.Act(r.Context(), sessionFrom(r).UserID, a)
	s.writeTurn(w, turn, err)
}

func (s *Server) writeTurn(w http.ResponseWriter, turn *agent.Turn, err error) {
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, turn)
	case errors.Is(err, agent.ErrInvalidText), errors.Is(err, agent.ErrBadAction):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, agent.ErrMessageNotFound), errors.Is(err, reservations.ErrNotFound), errors.Is(err, restaurants.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, agent.ErrNotPending):
		writeError(w, http.StatusConflict, err.Error())
	default:
		s.serverError(w, err)
	}
}

/* --------------------------------------------------------------- admin */

func (s *Server) listWorkflows(w http.ResponseWriter, r *http.Request) {
	list, err := s.recorder.ListWorkflows(r.Context())
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workflows": list})
}

func (s *Server) allRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.recorder.ListAll(r.Context(), 100)
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

/* ------------------------------------------------------------- helpers */

func (s *Server) serverError(w http.ResponseWriter, err error) {
	s.log.Error("request failed", "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
