import type { Entities, Preferences, RankedResult } from '@/types';
import { allRestaurants, CUISINE_LABELS, findRestaurant, NEIGHBORHOODS } from '@/data/restaurants';
import { distance } from '@/lib/geo';
import { hash } from '@/lib/format';
import { getSlots } from '../provider';

/**
 * Stand-in for RAG retrieval + ranking (pgvector similarity + structured filters).
 * Produces grounded "reasons" the way the LLM explanation step would.
 */
export interface RankInput {
  query: Entities;
  preferences: Preferences;
  saved: string[];
  visited: string[];
  date: string;
}

export function rankRestaurants({ query: e, preferences, saved, visited, date }: RankInput): RankedResult[] {
  const savedSet = new Set(saved);
  const visitedSet = new Set(visited);
  const savedGroupCounts: Record<string, number> = {};
  saved.forEach((id) => {
    const g = findRestaurant(id)?.group;
    if (g) savedGroupCounts[g] = (savedGroupCounts[g] ?? 0) + 1;
  });

  const out: RankedResult[] = [];
  for (const r of allRestaurants()) {
    if (e.reference && e.similar && r.id === e.reference.id) continue;
    if (e.excludeSaved && (savedSet.has(r.id) || visitedSet.has(r.id))) continue;
    if (e.onlySaved && !savedSet.has(r.id)) continue;
    if (e.cuisine && r.group !== e.cuisine && !(e.cuisine === 'vegetarian' && r.tags.includes('vegetables'))) continue;
    if (e.vegetarian && !r.vegetarian && !r.tags.includes('vegetables')) continue;
    if (e.maxPrice && r.priceLevel > e.maxPrice) continue;
    if (e.minPrice && r.priceLevel < e.minPrice) continue;

    let score = 0;
    const reasons: string[] = [];

    if (e.reference && e.similar) {
      const ref = e.reference;
      if (r.group === ref.group) {
        score += 3;
        reasons.push(`Same ${CUISINE_LABELS[r.group]} focus as ${ref.name}`);
      }
      const shared = r.tags.filter((tag) => ref.tags.includes(tag));
      score += shared.length;
      if (shared.length) reasons.push(shared.slice(0, 2).join(', '));
      if (r.priceLevel === ref.priceLevel) score += 1;
    }

    if (e.likeSaved) {
      const n = savedGroupCounts[r.group] ?? 0;
      score += n;
      if (n) reasons.push(`Like the ${CUISINE_LABELS[r.group]} places you saved`);
    }

    if (e.neighborhood) {
      const center = NEIGHBORHOODS[e.neighborhood];
      const d = distance([r.lat, r.lng], center);
      if (r.neighborhood === e.neighborhood) {
        score += 3;
        reasons.push(`In ${e.neighborhood}`);
      } else if (d < 0.008) {
        score += 1.5;
        reasons.push(`Near ${e.neighborhood}`);
      } else {
        score -= d * 60;
      }
    }

    if (e.cuisine && !e.similar) reasons.push(CUISINE_LABELS[e.cuisine]);
    if (preferences.cuisines.includes(r.group)) {
      score += 1;
      if (!e.similar && !e.cuisine) reasons.push('Matches your cuisine preferences');
    }
    if (preferences.priceLevels.includes(r.priceLevel)) score += 0.5;
    if (preferences.dietary.includes('vegetarian') && (r.vegetarian || r.tags.includes('vegetables'))) {
      score += 1;
      reasons.push('Good for vegetarians');
    }
    if (e.minPrice && r.tags.includes('date night')) score += 1;
    if (!getSlots(r, date).length) score -= 2.5;
    if (e.excludeSaved) reasons.push('Not in your saved list');

    // Tiny deterministic tiebreaker so ordering is stable.
    out.push({ restaurantId: r.id, score: score + (hash(r.id) % 10) / 100, reasons });
  }

  return out.sort((a, b) => b.score - a.score);
}
