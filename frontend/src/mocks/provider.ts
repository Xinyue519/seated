import type { Restaurant } from '@/types';
import { hash } from '@/lib/format';

/**
 * Mock reservation provider (stands in for the Go mock reservation API).
 * Holds which slots have been booked during this session.
 */
export const SLOT_TIMES = ['5:30', '6:00', '6:45', '7:30', '8:15', '9:00', '9:45'];

const taken = new Set<string>();

const key = (restaurantId: string, date: string, time: string) => `${restaurantId}|${date}|${time}`;

export function getSlots(r: Restaurant, date: string): string[] {
  if (r.alwaysFull) return [];
  const h = hash(`${r.id}:${date}`);
  return SLOT_TIMES.filter((t, i) => (((h >> i) & 1) === 1 || i === h % SLOT_TIMES.length) && !taken.has(key(r.id, date, t)));
}

export function takeSlot(restaurantId: string, date: string, time: string): void {
  taken.add(key(restaurantId, date, time));
}

export function releaseSlot(restaurantId: string, date: string, time: string): void {
  taken.delete(key(restaurantId, date, time));
}

export function idempotencyKey(restaurantId: string, date: string, time: string): number {
  return hash(key(restaurantId, date, time));
}
