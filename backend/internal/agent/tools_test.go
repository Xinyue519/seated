package agent

import "testing"

func TestNormalizeTime(t *testing.T) {
	cases := map[string]string{"7:30": "7:30", "7:30pm": "7:30", "19:30": "7:30", "8pm": "8:00", " 9:45 PM ": "9:45", "6:5": "6:05"}
	for in, want := range cases {
		if got := normalizeTime(in); got != want {
			t.Errorf("normalizeTime(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDayPhrase(t *testing.T) {
	if got := dayPhrase("2026-11-06", "2026-11-06"); got != "tonight" {
		t.Errorf("today: got %q", got)
	}
	if got := dayPhrase("2026-11-06", "2026-11-01"); got != "on Fri, Nov 6" {
		t.Errorf("future: got %q", got)
	}
}

func TestValidDate(t *testing.T) {
	ts := &turnState{today: "2026-11-01"}
	ts.now, _ = parseDay("2026-11-01")
	if _, err := ts.validDate("2026-10-31"); err == nil {
		t.Error("past date should fail")
	}
	if _, err := ts.validDate("2026-11-06"); err != nil {
		t.Errorf("future date failed: %v", err)
	}
	if _, err := ts.validDate("Friday"); err == nil {
		t.Error("non-ISO date should fail")
	}
}
