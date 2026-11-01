package agent

import (
	"seated/internal/reservations"
	"seated/internal/workflows"
)

// These mirror the frontend types in frontend/src/types.ts.

type Chip struct {
	Label   string `json:"label"`
	Missing bool   `json:"missing,omitempty"`
}

type ResultItem struct {
	RestaurantID string   `json:"restaurantId"`
	Reasons      []string `json:"reasons"`
}

type ConfirmRequest struct {
	Kind          string `json:"kind"` // book | modify | cancel
	RestaurantID  string `json:"restaurantId"`
	Date          string `json:"date"`
	Time          string `json:"time"`
	PartySize     int    `json:"partySize"`
	ReservationID string `json:"reservationId,omitempty"`
	RunID         string `json:"runId"`
	State         string `json:"state"` // open | working | done | failed | declined
}

// Payload is the UI-only part of a message, stored as JSON in messages.payload.
type Payload struct {
	Chips        []Chip          `json:"chips,omitempty"`
	ToolsSummary string          `json:"toolsSummary,omitempty"`
	ToolsTone    string          `json:"toolsTone,omitempty"` // ok | warn
	Results      []ResultItem    `json:"results,omitempty"`
	ResultsDate  string          `json:"resultsDate,omitempty"`
	Confirm      *ConfirmRequest `json:"confirm,omitempty"`
	Action       string          `json:"action,omitempty"` // "reservations"
	FollowUp     string          `json:"followUp,omitempty"`
}

type ChatMessage struct {
	ID   string `json:"id"`
	Role string `json:"role"` // user | agent
	Text string `json:"text,omitempty"`
	Payload
}

// Turn is what every agent endpoint returns (frontend `AgentTurn`).
type Turn struct {
	Messages     []ChatMessage              `json:"messages"`
	Runs         []workflows.Run            `json:"runs,omitempty"`
	MapFilter    *[]string                  `json:"mapFilter,omitempty"`
	Reservations []reservations.Reservation `json:"reservations,omitempty"`
}
