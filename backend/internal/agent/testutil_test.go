package agent

import "time"

func parseDay(s string) (time.Time, error) { return time.Parse("2006-01-02", s) }
