package seed

import "seated/internal/workflows"

// Workflows are published at seed time. Later, the admin Workflow Builder will
// create and publish these; the agent never invents workflows at runtime.
var Workflows = []workflows.Definition{
	{Name: workflows.Discovery, Trigger: "discovery_request",
		Steps: []string{"extract_intent", "get_user_preferences", "search_restaurants", "check_availability", "present_restaurants"}},
	{Name: workflows.Similar, Trigger: "similar_request",
		Steps: []string{"extract_intent", "get_restaurant_details", "find_similar_restaurants", "check_availability", "present_restaurants"}},
	{Name: workflows.Reservation, Trigger: "reservation_request",
		Steps: []string{"extract_reservation_details", "search_restaurants", "check_availability", "request_user_confirmation", "create_reservation", "save_booking"}},
	{Name: workflows.Modification, Trigger: "modification_request",
		Steps: []string{"get_user_reservations", "check_availability", "request_user_confirmation", "modify_reservation"}},
	{Name: workflows.Cancellation, Trigger: "cancellation_request",
		Steps: []string{"get_user_reservations", "verify_ownership", "request_user_confirmation", "cancel_reservation"}},
	{Name: workflows.Lookup, Trigger: "reservation_lookup",
		Steps: []string{"get_user_reservations"}},
	{Name: workflows.Questions, Trigger: "restaurant_question",
		Steps: []string{"get_restaurant_details"}},
}
