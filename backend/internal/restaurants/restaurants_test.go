package restaurants

import "testing"

func TestCanonicalNeighborhood(t *testing.T) {
	for in, want := range map[string]string{"west village": "West Village", "LES": "Lower East Side", "soho": "SoHo"} {
		if got, ok := CanonicalNeighborhood(in); !ok || got != want {
			t.Errorf("CanonicalNeighborhood(%q) = %q,%v", in, got, ok)
		}
	}
	if _, ok := CanonicalNeighborhood("Narnia"); ok {
		t.Error("unknown neighborhood should not match")
	}
}

func TestSimilarByAttributes(t *testing.T) {
	ref := Restaurant{ID: "ref", Group: "italian", PriceLevel: 3, Tags: []string{"pasta", "wine"}}
	got := SimilarByAttributes([]Restaurant{ref}, []Restaurant{
		{ID: "thai", Group: "thai", PriceLevel: 2, Tags: []string{"casual"}},
		{ID: "pasta", Group: "italian", PriceLevel: 3, Tags: []string{"pasta", "wine"}},
	}, 2)
	if got[0].ID != "pasta" {
		t.Errorf("expected the Italian pasta place first, got %s", got[0].ID)
	}
}

func TestVectorLiteral(t *testing.T) {
	if got := VectorLiteral([]float32{0.5, -1, 2}); got != "[0.5,-1,2]" {
		t.Errorf("got %s", got)
	}
}
