import { useEffect, useState } from 'react';
import { useApp } from '@/store/AppStore';

/** Open time slots for a restaurant on a date. `null` while loading. */
export function useAvailability(restaurantId: string, date: string): string[] | null {
  const { api, state } = useApp();
  const version = state.availabilityVersion;
  const [slots, setSlots] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAvailability(restaurantId, date)
      .then((s) => !cancelled && setSlots(s))
      .catch(() => !cancelled && setSlots([]));
    return () => {
      cancelled = true;
    };
  }, [api, restaurantId, date, version]);

  return slots;
}
