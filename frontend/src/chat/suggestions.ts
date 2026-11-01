import type { AppState } from '@/store/state';

/** Quick replies shown above the composer, based on where the conversation is. */
export function getSuggestions(s: AppState): string[] {
  const p = s.pending;
  if (p?.time && !p.partySize) {
    const sizes = [...new Set([s.preferences.partySize, 2, 4, 6])].slice(0, 4);
    return sizes.map((n) => `${n} ${n === 1 ? 'person' : 'people'}`);
  }
  if (s.messages.length <= 1) {
    return [
      "Dinner this Friday, somewhere like L'Artusi in the West Village. Not somewhere I've saved.",
      'Cheap eats in the East Village for 4',
      'Book Carbone Saturday at 8pm for 2',
    ];
  }
  const last = s.messages[s.messages.length - 1];
  if (last?.results?.length && !p) return ['Show more options', 'Something cheaper', 'What are my reservations?'];
  return ['Cancel my next reservation', 'Something vegetarian in the LES', 'Sushi tomorrow for 2'];
}
