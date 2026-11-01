import type { DayWord } from '@/types';

const WEEKDAYS: DayWord[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Resolves a relative day word to a concrete date (next occurrence, today counts). */
export function resolveDay(word?: DayWord): string {
  const d = startOfToday();
  if (!word || word === 'today') return toISODate(d);
  if (word === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }
  const target = word === 'weekend' ? 6 : WEEKDAYS.indexOf(word);
  d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
  return toISODate(d);
}

export function addDays(iso: string, days: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function todayISO(): string {
  return toISODate(startOfToday());
}

/** "Tonight" for today, otherwise "Fri, Nov 6". */
export function formatDay(iso: string): string {
  if (iso === todayISO()) return 'Tonight';
  return fromISODate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** For use mid-sentence: "tonight" or "on Fri, Nov 6". */
export function dayPhrase(iso: string): string {
  return iso === todayISO() ? 'tonight' : `on ${formatDay(iso)}`;
}

export function dateParts(iso: string): { month: string; day: string; weekday: string } {
  const d = fromISODate(iso);
  return {
    month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: String(d.getDate()),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
  };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
