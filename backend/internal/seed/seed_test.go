package seed

import (
	"encoding/json"
	"testing"
)

// The backend's availability must match the frontend mock (src/mocks/provider.ts)
// so mock mode and real mode show the same times.
func TestJSHashMatchesFrontend(t *testing.T) {
	cases := map[string]int{"isodi:2026-11-06": 11209, "lartusi:2026-12-25": 90931}
	for in, want := range cases {
		if got := jsHash(in); got != want {
			t.Errorf("jsHash(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestSeedDataParses(t *testing.T) {
	var list []seedRestaurant
	if err := json.Unmarshal(restaurantsJSON, &list); err != nil {
		t.Fatal(err)
	}
	if len(list) < 20 {
		t.Fatalf("expected the demo restaurants, got %d", len(list))
	}
	seen := map[string]bool{}
	for _, r := range list {
		if r.ID == "" || seen[r.ID] || r.PriceLevel < 1 || r.PriceLevel > 4 {
			t.Errorf("bad restaurant %+v", r.Restaurant)
		}
		seen[r.ID] = true
	}
}
