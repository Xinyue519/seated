import type { Bootstrap } from '@/services/types';
import { addDays, resolveDay } from '@/lib/dates';
import { MOCK_RESTAURANTS } from './restaurants';

/** Demo account data returned by the mock `bootstrap()`. */
export function createMockBootstrap(email: string): Bootstrap {
  return {
    user: { name: 'Stella', email },
    preferences: { cuisines: ['italian', 'japanese'], priceLevels: [2, 3], dietary: [], partySize: 2 },
    restaurants: MOCK_RESTAURANTS,
    saved: ['lartusi', 'rubirosa', 'raouls', 'torrisi', 'nakazawa'],
    visited: ['lartusi', 'raouls'],
    reservations: [
      {
        id: 'res_seed_1',
        restaurantId: 'raouls',
        date: addDays(resolveDay('saturday'), 7),
        time: '8:00',
        partySize: 4,
        status: 'confirmed',
        bookedBy: 'agent',
      },
    ],
    past: [
      { id: 'past_1', restaurantId: 'balthazar', label: 'Oct 24 · 2 guests · Recommended by Ask Seated', recommended: true },
      { id: 'past_2', restaurantId: 'lartusi', label: 'Oct 10 · 2 guests', recommended: false },
      { id: 'past_3', restaurantId: 'rubirosa', label: 'Sep 28 · 5 guests · Recommended by Ask Seated', recommended: true },
    ],
  };
}
